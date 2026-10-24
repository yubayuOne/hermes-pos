import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow, IconButton } from '../../components/Button';
import { Chip, Label, Tag } from '../../components/bits';
import { AmountBox, ChangeBox } from '../../components/Field';
import { Keypad } from '../../components/Keypad';
import { ActionFooter, Sheet } from '../../components/Sheet';
import { Slip, SlipRow, SlipRule } from '../../components/Slip';
import { ReceiptView } from '../../components/ReceiptView';
import { useLayout } from '../../hooks/useLayout';
import { useAppStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { fetchBillItems } from '../../services/transaction/repository';
import { enqueueCheckout, provisionalNumber, resolveOpenShift, submitCheckout } from '../../services/transaction/offlineQueue';
import { nextBill } from '../../services/local/billNumber';
import { clearPendingCheckout, savePendingCheckout } from '../../services/transaction/pendingCheckout';
import { useCheckoutQueue } from '../../services/transaction/useCheckoutQueue';
import { refreshSubscription } from '../../services/subscription/subscription';
import { printerService } from '../../services/printer/service';
import { ReceiptData } from '../../services/printer/types';
import { CartItem, CustomerInfo, PaymentMethod } from '../../types/domain';
import { billTotals } from '../../utils/voucher';
import { isExpiredError, isUnknownCheckoutOutcome } from '../../utils/errors';
import { reportPrintResult } from '../../utils/printFeedback';
import { receiptFromCart, withServerLines } from '../../utils/receipt';
import { haptic } from '../../utils/haptics';
import { colors } from '../../theme';
import { money, num, t, useT } from '../../i18n';

type Done = { receipt: ReceiptData; number: string; transactionId?: string; queued: boolean; change: number };

/** Quick amounts (DESIGN I4): exact, then rounded up to 10rb, 50rb, 100rb above the total. */
export function quickAmounts(total: number): number[] {
  if (total <= 0) return [];
  const up = (step: number) => Math.ceil(total / step) * step;
  const out = [total];
  for (const v of [up(10000), up(50000), up(100000), up(50000) + 50000, up(100000) + 100000]) {
    if (!out.includes(v) && v > total) out.push(v);
    if (out.length === 4) break;
  }
  return out;
}
const short = (v: number) => (v % 1000 === 0 ? t('{n}rb', { n: num(v / 1000) }) : num(v));

/**
 * Cash payment (DESIGN I5.6 to I5.8). One confirmation with total, cash, and change; the button is locked while it
 * runs so it cannot be sent twice. Network trouble on a normal bill stores it in the offline queue with a TUNDA
 * number (PRD E1). Held and split bills cannot be queued and fall back to the recovery banner.
 */
export function PaymentScreen({
  visible,
  onClose,
  onDone,
  itemsOverride,
  customerOverride,
  parentTransactionId = null,
  existingTransactionId = null,
  clearCartOnSuccess = true,
  meta,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: (r: { number: string; transactionId?: string }) => void;
  itemsOverride?: CartItem[];
  customerOverride?: CustomerInfo;
  parentTransactionId?: string | null;
  existingTransactionId?: string | null;
  clearCartOnSuccess?: boolean;
  meta?: string;
}) {
  useT();
  const notify = useNotify();
  const { wide, tablet, phoneLandscape } = useLayout();
  const {
    session,
    shift,
    cart,
    customer,
    billDiscount,
    voucher,
    clearCart,
    setShift,
    beginPaymentIntent,
    clearPaymentIntent,
    adjustStock,
    bumpHeld,
    activeHeldNumber,
  } = useAppStore();
  const queue = useCheckoutQueue();
  const items = itemsOverride ?? cart;
  const cust = customerOverride ?? customer;
  const split = !!itemsOverride;
  const payVoucher = split ? null : voucher;
  const totals = billTotals(items, split ? null : billDiscount, payVoucher);
  const total = totals.total;
  const [paid, setPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const lock = useRef(false);
  const own = useRef<{ key: string; transactionId: string; number: string } | null>(null);
  const received = paymentMethod === 'qris' ? total : Number(paid || 0);
  const change = paymentMethod === 'qris' ? 0 : Math.max(0, received - total);
  const enough = received >= total && total > 0;
  const offlineLikely = queue.some((e) => e.status === 'waiting');

  useEffect(() => {
    if (!visible) return;
    setPaid('');
    setPaymentMethod('cash');
    setDone(null);
    setPrinting(null);
    setLoading(false);
    lock.current = false;
  }, [visible]);

  // Built only when paying, not on every cart change while the screen is closed.
  const fingerprint = () =>
    JSON.stringify({
      shift: shift?.id,
      cashier: session?.cashierId,
      items: items.map((i) => ({ p: i.productId, q: i.quantity, d: i.discount ?? null, n: i.note ?? null })).sort((a, b) => a.p.localeCompare(b.p)),
      cust: [cust.name, cust.phone, cust.table],
      bill: split ? null : billDiscount,
      voucher: payVoucher?.code ?? null,
      paymentMethod,
      received,
      parentTransactionId,
      existingTransactionId,
    });

  // Closed: render nothing, so tapping menu items does not rebuild this screen. It stays a moment after closing for
  // the sheet's fade-out.
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) return setMounted(true);
    const id = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(id);
  }, [visible]);

  const count = items.reduce((n, i) => n + i.quantity, 0);
  const sub = meta ?? [cust.table ? t('Meja {n}', { n: cust.table }) : null, t('{n} item', { n: count }), session?.cashierName].filter(Boolean).join(' · ');
  const discountTotal = totals.itemDiscount + totals.billDiscount + totals.voucherCut;

  const start = async () => {
    // Locked from the first tap: a second tap would queue a second dialog that, confirmed after the first
    // payment cleared the intent, pays the same bill again under a new key.
    if (!shift || !items.length || !enough || loading || lock.current) return;
    lock.current = true;
    beginPaymentIntent(fingerprint());
    const key = await notify.dialog({
      title: t('Catat pembayaran ini?'),
      details: [
        { label: t('Total'), value: money(total) },
        { label: t('Metode pembayaran'), value: paymentMethod === 'qris' ? t('QRIS') : t('Tunai') },
        { label: paymentMethod === 'qris' ? t('Nominal QRIS') : t('Uang diterima'), value: money(received) },
        { label: t('Kembalian'), value: money(change), tone: 'success' },
      ],
      message: offlineLikely
        ? t('Tanpa internet, pembayaran disimpan dan dikirim otomatis.')
        : t('Setelah dicatat, stok dan kas laci diperbarui. Struk bisa dicetak sesudahnya.'),
      actions: [
        { key: 'back', label: t('Periksa lagi'), variant: 'secondary' },
        { key: 'pay', label: t('Catat pembayaran'), variant: 'primary' },
      ],
      dismissKey: 'back',
    });
    if (key === 'pay') void pay();
    else lock.current = false;
  };

  const finish = (d: Done) => {
    clearPaymentIntent();
    if (clearCartOnSuccess) clearCart();
    setDone(d);
    haptic.success();
  };

  const pay = async () => {
    // Called only from start(), which holds the lock.
    if (!shift || !session) {
      lock.current = false;
      return;
    }
    let paid = false;
    const key = beginPaymentIntent(fingerprint());
    setLoading(true);
    // A new bill gets this phone's id and final number once per payment; a retry keeps them (054). Paying a held bill
    // keeps the number it got when held. No terminal code yet: the server numbers it as before.
    if (!existingTransactionId && own.current?.key !== key) {
      const next = await nextBill(session.outletId).catch(() => null);
      own.current = next ? { key, ...next } : null;
    }
    const bill = !existingTransactionId && own.current?.key === key ? own.current : null;
    const base = {
      transactionId: bill?.transactionId ?? null,
      number: bill?.number ?? null,
      shiftId: shift.id,
      cashierId: session.cashierId,
      outletId: session.outletId,
      items,
      customer: cust,
      billDiscount: split ? null : billDiscount,
      voucherCode: payVoucher?.code ?? null,
      payment: { method: paymentMethod, amountReceived: received },
      idempotencyKey: key,
    };
    try {
      await savePendingCheckout({
        ...base,
        parentTransactionId,
        existingTransactionId,
        kind: existingTransactionId ? 'held' : parentTransactionId ? 'split' : 'normal',
      });
      const r = await submitCheckout({ ...base, parentTransactionId, existingTransactionId });
      await clearPendingCheckout().catch(() => undefined);
      if (existingTransactionId) bumpHeld();
      let receipt = receiptFromCart({
        number: r.transactionNumber,
        session,
        items,
        customer: cust,
        gross: totals.gross,
        discount: discountTotal,
        total: r.total,
        paymentMethod,
        paid: paymentMethod === 'qris' ? r.total : received,
        change: paymentMethod === 'qris' ? 0 : r.change,
      });
      if (r.total !== total) {
        // Prices changed after the menu loaded: print the server's lines so subtotal minus discount equals the total.
        // The payment is already recorded, so a failed lookup keeps the till's receipt instead of failing.
        const lines = await fetchBillItems(r.transactionId).catch(() => null);
        if (lines) receipt = withServerLines(receipt, lines);
      }
      paid = true;
      finish({
        receipt,
        number: r.transactionNumber,
        transactionId: r.transactionId,
        queued: false,
        change: r.change,
      });
    } catch (e) {
      const unknown = isUnknownCheckoutOutcome(e);
      // A recalled held bill and a split part are queued too: the server pays that same bill (or that part of it), or
      // refuses if it was paid, changed or deleted meanwhile.
      if (unknown) {
        try {
          await enqueueCheckout({ ...base, existingTransactionId, parentTransactionId, total });
          await clearPendingCheckout().catch(() => undefined);
          adjustStock(items);
          const final = bill?.number ?? (existingTransactionId ? activeHeldNumber : null);
          const number = final ?? provisionalNumber(key);
          paid = true;
          finish({
            receipt: receiptFromCart({
              number,
              session,
              items,
              customer: cust,
              gross: totals.gross,
              discount: discountTotal,
              total,
              paymentMethod,
              paid: paymentMethod === 'qris' ? total : received,
              change,
              provisional: !final,
            }),
            number,
            queued: true,
            change,
          });
          return;
        } catch {
          /* storage failed: keep the bill on screen, the recovery banner takes over */
        }
      }
      haptic.error();
      try {
        setShift(await resolveOpenShift(session.cashierId));
      } catch {
        /* keep what is shown */
      }
      if (isExpiredError(e)) void refreshSubscription().catch(() => undefined);
      if (unknown) {
        void notify.dialog({
          tone: 'warning',
          title: t('Pembayaran belum terkonfirmasi'),
          message: t('Koneksi putus. Pembayaran ini mungkin sudah tercatat.'),
          hint: t('Jangan buat pembayaran baru. Pilih Lanjutkan di tab Jual.'),
        });
      } else {
        await clearPendingCheckout().catch(() => undefined);
        void notify.fail(t('Pembayaran ditolak'), e);
      }
    } finally {
      setLoading(false);
      // A recorded payment keeps the screen locked until it is opened again for the next bill.
      if (!paid) lock.current = false;
    }
  };

  const print = async (kind: 'customer' | 'kitchen' | 'bar') => {
    if (!done) return;
    setPrinting(kind);
    try {
      const results =
        kind === 'customer'
          ? await printerService.printReceipt(done.receipt, false)
          : kind === 'kitchen'
            ? await printerService.printKitchen(done.receipt, false)
            : await printerService.printBar(done.receipt, false);
      reportPrintResult(notify, results, {
        missingTitle: t('Printer belum diatur'),
        missingMessage:
          kind === 'customer'
            ? t('Belum ada printer dengan peran Struk pelanggan.')
            : kind === 'kitchen'
              ? t('Belum ada printer dengan peran Dapur.')
              : t('Belum ada printer dengan peran Bar.'),
        successTitle: kind === 'customer' ? t('Struk dicetak') : kind === 'kitchen' ? t('Tiket dapur dicetak') : t('Tiket bar dicetak'),
        successMessage: done.number,
      });
    } catch (e) {
      void notify.fail(t('Cetak gagal'), e);
    } finally {
      setPrinting(null);
    }
  };

  const close = () => {
    if (loading) return;
    if (done) {
      const d = done;
      setDone(null);
      onDone({ number: d.number, transactionId: d.transactionId });
      return;
    }
    onClose();
  };

  if (!mounted) return null;

  // ---------------------------------------------------------------- success (I5.8)
  if (done) {
    const kitchen = done.receipt.kitchenItems.length > 0;
    const bar = done.receipt.barItems.length > 0;
    return (
      <Sheet visible={visible} onClose={close} size="full" label={t('Pembayaran tercatat.')}>
        <ScrollView className="flex-1" contentContainerClassName="px-4 pb-6 pt-4">
          <View style={wide ? { flexDirection: 'row', gap: 24 } : undefined}>
            <View style={wide ? { flex: 1 } : undefined}>
              {done.queued ? <Tag tone="fire" label={t('belum terkirim · offline')} /> : <Tag tone="pine" label={t('lunas')} />}
              <Display size={34} className="mt-2" accessibilityRole="header">
                {done.queued ? t('Tersimpan di perangkat.') : t('Pembayaran tercatat.')}
              </Display>
              <Text className="mt-1.5 text-[14px] text-mute">
                {done.queued
                  ? t('Nomor resmi terbit setelah sinkron. Jangan tutup shift sebelum antrean kosong.')
                  : t('{number} · stok dan kas laci diperbarui.', { number: done.number })}
              </Text>
              <View accessibilityLiveRegion="polite" className="mt-4 flex-row items-center justify-between rounded-k border-k border-ink bg-pine px-4 py-3.5">
                <Text className="font-body-600 text-[15px] text-paper">{done.receipt.paymentMethod === 'qris' ? t('Pembayaran QRIS') : t('Kembalian')}</Text>
                <Display size={44} className="ml-3 min-w-0 flex-1 text-right" numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.paper }}>
                  {money(done.receipt.paymentMethod === 'qris' ? done.receipt.total : done.change)}
                </Display>
              </View>
              <Label className="mt-4">{t('Cetak')}</Label>
              <View className="mt-1.5 gap-2.5">
                <Button
                  label={printing === 'customer' ? t('Mencetak...') : t('Cetak struk pelanggan')}
                  loading={printing === 'customer'}
                  disabled={!!printing}
                  onPress={() => void print('customer')}
                />
                {kitchen || bar ? (
                  <ButtonRow>
                    {kitchen ? (
                      <Button
                        size="sm"
                        label={printing === 'kitchen' ? t('Mencetak...') : t('Tiket dapur')}
                        disabled={!!printing}
                        onPress={() => void print('kitchen')}
                      />
                    ) : null}
                    {bar ? (
                      <Button
                        size="sm"
                        label={printing === 'bar' ? t('Mencetak...') : t('Tiket bar')}
                        disabled={!!printing}
                        onPress={() => void print('bar')}
                      />
                    ) : null}
                  </ButtonRow>
                ) : null}
              </View>
              <Text className="mt-2 text-[14px] text-mute">{t('Opsional')}</Text>
            </View>
            <View style={wide ? { flex: 1 } : { marginTop: 16 }}>
              <ReceiptView data={done.receipt} totalBand={false} />
            </View>
          </View>
        </ScrollView>
        <ActionFooter>
          <Button size="lg" variant="fire" label={split ? t('Kembali ke pisah bill') : t('Bill baru')} disabled={!!printing} onPress={close} />
        </ActionFooter>
      </Sheet>
    );
  }

  // ---------------------------------------------------------------- input (I5.6)
  const amountPart = (
    <View className={phoneLandscape ? 'gap-2' : 'gap-2.5'}>
      {phoneLandscape ? null : (
        <>
          <View className="flex-row items-end justify-between">
            <Mono className="text-[14px] text-mute">{t('Total tagihan')}</Mono>
            <Display size={40} className="ml-3 min-w-0 flex-1 text-right" numberOfLines={1} adjustsFontSizeToFit>
              {money(total)}
            </Display>
          </View>
          <Label>{t('Metode pembayaran')}</Label>
        </>
      )}
      <View className="flex-row gap-2">
        <Chip
          grow
          label={t('Tunai')}
          selected={paymentMethod === 'cash'}
          disabled={loading}
          onPress={() => {
            setPaymentMethod('cash');
            setPaid('');
          }}
        />
        <Chip
          grow
          label={t('QRIS')}
          selected={paymentMethod === 'qris'}
          disabled={loading}
          onPress={() => {
            setPaymentMethod('qris');
            setPaid('');
          }}
        />
      </View>
      {paymentMethod === 'cash' ? (
        <>
          <AmountBox label={t('Uang diterima')} value={paid ? money(received) : 'Rp0'} compact={phoneLandscape} />
          <ChangeBox
            state={!paid ? 'empty' : enough ? 'change' : 'short'}
            label={!paid ? t('Kembalian') : enough ? t('Kembalian') : t('Kurang')}
            value={!paid ? '-' : enough ? money(change) : money(total - received)}
          />
          <View className="flex-row gap-2">
            {quickAmounts(total).map((v, i) => (
              <Chip key={v} grow label={i === 0 ? t('Pas') : short(v)} selected={received === v} onPress={() => setPaid(String(v))} />
            ))}
          </View>
        </>
      ) : (
        <View className="rounded-k border-k border-ink bg-fireSoft px-3.5 py-3">
          <Text className="font-body-600 text-[15px]">{t('Nominal QRIS: {amount}', { amount: money(total) })}</Text>
          <Text className="mt-1 text-[14px] text-mute">{t('Cek QRIS masuk dulu.')}</Text>
        </View>
      )}
    </View>
  );
  const pad = paymentMethod === 'cash' ? <Keypad value={paid} onChange={setPaid} compact={phoneLandscape} disabled={loading} /> : null;
  const summary = (
    <Slip>
      <View className="flex-row justify-between">
        <Mono className="font-mono-600 text-[14px]">BILL</Mono>
        <Mono className="text-[14px] text-mute">{cust.table ? t('Meja {n}', { n: cust.table }) : ''}</Mono>
      </View>
      <SlipRule />
      {items.map((i) => (
        <SlipRow key={i.productId} left={`${i.quantity}× ${i.name}`} right={num(i.unitPrice * i.quantity)} />
      ))}
      <SlipRule />
      {discountTotal ? <SlipRow left={t('Diskon dan voucher')} right={`-${money(discountTotal)}`} tone="pine" /> : null}
      <SlipRow strong left={t('Total')} right={money(total)} />
    </Slip>
  );
  const payLabel = loading
    ? t('Mencatat...')
    : paymentMethod === 'qris'
      ? t('Konfirmasi QRIS {amount}', { amount: money(total) })
      : !paid
        ? t('Masukkan uang diterima')
        : !enough
          ? t('Kurang {amount}', { amount: money(total - received) })
          : t('Bayar {amount}', { amount: money(total) });

  const payButton = <Button size="lg" variant="fire" label={payLabel} loading={loading} disabled={!enough || loading} onPress={() => void start()} />;

  return (
    <Sheet visible={visible} onClose={close} size="full" label={t('Pembayaran')}>
      <View className={`flex-row items-center gap-3 border-b-k border-ink px-4 ${phoneLandscape ? 'py-1.5' : 'pb-3 pt-3'}`}>
        <IconButton icon="chevron-left" label={t('Kembali ke bill')} onPress={close} disabled={loading} />
        <View className="min-w-0 flex-1">
          <Display size={phoneLandscape ? 22 : 27} accessibilityRole="header">
            {t('Pembayaran')}
          </Display>
          <Mono numberOfLines={1} className="mt-0.5 text-[14px] text-mute">
            {sub}
          </Mono>
        </View>
        {phoneLandscape ? (
          <Display size={30} className="ml-3" numberOfLines={1} accessibilityLabel={`${t('Total tagihan')} ${money(total)}`}>
            {money(total)}
          </Display>
        ) : null}
      </View>
      {phoneLandscape ? (
        // Phone landscape: the total sits in the header, the keypad beside the amount, and the pay button is pinned
        // under the amount so it never scrolls out of sight on a 390px-high screen.
        <View className="flex-1 flex-row gap-4 px-4 py-2">
          <View className="flex-1">
            <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {amountPart}
            </ScrollView>
            <View className="pt-2">{payButton}</View>
          </View>
          <View className="flex-1 justify-center">{pad}</View>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 py-4" keyboardShouldPersistTaps="handled">
          {tablet ? (
            <View className="flex-row gap-5">
              <View style={{ width: '38%' }}>{summary}</View>
              <View className="flex-1 gap-2.5">
                {amountPart}
                {pad}
              </View>
            </View>
          ) : (
            <View className="gap-2.5">
              {amountPart}
              {pad}
            </View>
          )}
        </ScrollView>
      )}
      {!phoneLandscape ? <ActionFooter>{payButton}</ActionFooter> : null}
    </Sheet>
  );
}

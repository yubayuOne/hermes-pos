import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Chip, Label, Stepper } from '../../components/bits';
import { TextField } from '../../components/Field';
import { ActionFooter, Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { useAppStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { refundItems, RefundResult } from '../../services/transaction/repository';
import { refreshSubscription } from '../../services/subscription/subscription';
import { TransactionItemSummary, TransactionSummary } from '../../types/domain';
import { describeError, isExpiredError, isNetworkError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { reportPrintResult } from '../../utils/printFeedback';
import { receiptForRefund } from '../../utils/receipt';
import { printerService } from '../../services/printer/service';
import { colors } from '../../theme';
import { estimateRefund, refundLeft as left, RefundLine as Line } from '../../utils/refund';
import { money, t, useT } from '../../i18n';

// Labels passed through t(variable): listed in scripts/i18n-check.js.
const QUICK_REASONS = ['Salah pesan', 'Item rusak', 'Pelanggan batal', 'Pesanan terlalu lama'];

/**
 * Refund (migration 033): pick items and quantities, a reason, how the money goes back, and the owner's 6-digit code.
 * Lands in the current shift; cash refunds leave the drawer. Needs internet, never queued.
 */
export function RefundSheet({
  bill,
  items,
  onClose,
  onRefunded,
}: {
  bill: TransactionSummary | null;
  items: TransactionItemSummary[] | null;
  onClose: () => void;
  onRefunded: (r: Extract<RefundResult, { ok: true }>) => void;
}) {
  useT();
  const notify = useNotify();
  const { shift, session } = useAppStore();
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [method, setMethod] = useState<'cash' | 'qris'>('cash');
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ items?: string; reason?: string; code?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const key = useRef('');
  useEffect(() => {
    if (!bill) return;
    setLines({});
    setMethod('cash');
    setReason('');
    setCode('');
    setErrors({});
    // One key per opened sheet: a retry after a lost response refunds once.
    key.current = `refund:${session?.cashierId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }, [bill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (items ?? []).filter((i) => i.itemId && left(i) > 0);
  const picked = open.filter((i) => (lines[i.itemId!]?.qty ?? 0) > 0);
  const est = bill && items ? estimateRefund(bill, items, lines) : 0;
  const setQty = (i: TransactionItemSummary, qty: number) => {
    setLines((l) => ({ ...l, [i.itemId!]: { qty: Math.max(0, Math.min(left(i), qty)), restock: l[i.itemId!]?.restock ?? false } }));
    setErrors((x) => ({ ...x, items: undefined, form: undefined }));
  };

  const submit = async () => {
    if (!bill || !shift || !session || saving) return;
    const e: typeof errors = {};
    if (!picked.length) e.items = t('Pilih minimal satu item.');
    if (reason.trim().length < 3) e.reason = t('Tulis alasan minimal 3 huruf.');
    if (!/^\d{6}$/.test(code)) e.code = t('Kode persetujuan 6 digit angka.');
    setErrors(e);
    if (e.items || e.reason || e.code) return;
    setSaving(true);
    try {
      const r = await refundItems({
        transactionId: bill.id,
        shiftId: shift.id,
        cashierId: session.cashierId,
        method,
        reason: reason.trim(),
        code,
        idempotencyKey: key.current,
        items: picked.map((i) => ({ itemId: i.itemId!, quantity: lines[i.itemId!].qty, restock: !!(i.trackStock && lines[i.itemId!].restock) })),
      });
      if (!r.ok) {
        haptic.error();
        setCode('');
        if (r.reason === 'wrong') setErrors({ code: t('Kode salah. Sisa percobaan: {n}.', { n: r.attemptsLeft }) });
        else if (r.reason === 'locked') setErrors({ code: t('Terlalu banyak kode salah. Coba lagi dalam 5 menit.') });
        else setErrors({ form: t('Pemilik belum membuat kode persetujuan di backoffice.') });
        return;
      }
      haptic.heavy();
      const slip = receiptForRefund(
        bill,
        picked.map((i) => ({ ...i, quantity: lines[i.itemId!].qty })),
        { amount: r.amount, method: r.method, reason: reason.trim() },
        session,
      );
      const print = () => {
        printerService
          .reprint(slip)
          .then((results) =>
            reportPrintResult(notify, results, {
              missingTitle: t('Printer belum diatur'),
              missingMessage: t('Belum ada printer dengan peran Cetak ulang atau Struk pelanggan.'),
              successTitle: t('Struk refund dicetak'),
              successMessage: r.number,
            }),
          )
          .catch((e) => void notify.fail(t('Cetak gagal'), e));
      };
      // Printing is optional: a failed printer never undoes the refund.
      notify.success(
        t('Refund tercatat'),
        r.method === 'cash'
          ? t('{n} · {amount} keluar dari kas laci.', { n: r.number, amount: money(r.amount) })
          : t('{n} · kembalikan {amount} lewat QRIS atau transfer.', { n: r.number, amount: money(r.amount) }),
        { label: t('Cetak struk'), onPress: print },
      );
      onRefunded(r);
    } catch (err) {
      if (isExpiredError(err)) void refreshSubscription().catch(() => undefined);
      setErrors({ form: isNetworkError(err) ? t('Refund perlu internet. Sambungkan internet lalu coba lagi.') : describeError(err).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={!!bill}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="tall"
      label={t('Refund item')}
    >
      <SheetHeader
        title={t('Refund item')}
        subtitle={bill ? `${bill.number} · ${money(bill.total)} · ${bill.paymentMethod === 'qris' ? t('QRIS') : t('tunai')}` : undefined}
        onClose={onClose}
      />
      <SheetBody contentClassName="gap-3.5">
        <Text className="text-[15px] leading-[22px] text-mute">{t('Pilih item yang dikembalikan. Refund masuk ke shift ini dan tidak bisa dibatalkan.')}</Text>
        <Label>{t('Item')}</Label>
        <View className="gap-2.5">
          {open.length ? (
            open.map((i) => {
              const l = lines[i.itemId!];
              return (
                <View key={i.itemId} className="gap-2 rounded-k border-k border-ink bg-slip px-3 py-2.5">
                  <View className="flex-row items-center gap-3">
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={2} className="font-body-600 text-[15px]">
                        {i.productName}
                      </Text>
                      <Mono className="text-[14px] text-mute">{t('sisa {n} dari {m}', { n: left(i), m: i.quantity })}</Mono>
                    </View>
                    <Stepper
                      label={i.productName}
                      value={l?.qty ?? 0}
                      onMinus={() => setQty(i, (l?.qty ?? 0) - 1)}
                      onPlus={() => setQty(i, (l?.qty ?? 0) + 1)}
                      minusDisabled={!l?.qty}
                      plusDisabled={(l?.qty ?? 0) >= left(i)}
                    />
                  </View>
                  {l?.qty && i.trackStock ? (
                    <Chip
                      label={t('Kembalikan ke stok')}
                      selected={l.restock}
                      onPress={() => setLines((x) => ({ ...x, [i.itemId!]: { ...l, restock: !l.restock } }))}
                    />
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text className="text-[15px] text-mute">{t('Semua item sudah direfund.')}</Text>
          )}
          {errors.items ? (
            <Text accessibilityRole="alert" className="font-body-600 text-[14px] text-error">
              {errors.items}
            </Text>
          ) : null}
        </View>
        <Label>{t('Uang dikembalikan lewat')}</Label>
        <View className="flex-row gap-2">
          <Chip grow label={t('Tunai')} selected={method === 'cash'} onPress={() => setMethod('cash')} />
          <Chip grow label={t('QRIS/transfer')} selected={method === 'qris'} onPress={() => setMethod('qris')} />
        </View>
        <View
          accessibilityLiveRegion="polite"
          className="flex-row items-center justify-between rounded-k px-3.5 py-3"
          style={{ borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.tint3 }}
        >
          <Text className="font-body-600 text-[15px]">{t('Perkiraan refund')}</Text>
          <Mono className="font-mono-600 ml-3 min-w-0 flex-1 text-right text-[16px]" numberOfLines={1} adjustsFontSizeToFit>
            {money(est)}
          </Mono>
        </View>
        <View className="flex-row flex-wrap gap-2" accessibilityLabel={t('Alasan cepat')}>
          {QUICK_REASONS.map((r) => (
            <Chip
              key={r}
              label={t(r)}
              selected={reason === t(r)}
              onPress={() => {
                setReason(t(r));
                setErrors((x) => ({ ...x, reason: undefined, form: undefined }));
              }}
            />
          ))}
        </View>
        <TextField
          label={t('Alasan')}
          value={reason}
          onChangeText={(v) => {
            setReason(v);
            setErrors((x) => ({ ...x, reason: undefined, form: undefined }));
          }}
          placeholder={t('Menu salah, pelanggan komplain')}
          multiline
          maxLength={200}
          error={errors.reason}
        />
        <TextField
          label={t('Kode persetujuan pemilik')}
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/\D/g, '').slice(0, 6));
            setErrors((x) => ({ ...x, code: undefined, form: undefined }));
          }}
          placeholder={t('6 digit')}
          keyboardType="number-pad"
          secureTextEntry
          mono
          maxLength={6}
          error={errors.code}
          help={t('Minta pemilik mengetik kodenya di perangkat ini. Kode diatur di backoffice.')}
        />
        {errors.form ? (
          <Text accessibilityRole="alert" className="font-body-600 text-[14px] text-error">
            {errors.form}
          </Text>
        ) : null}
      </SheetBody>
      <ActionFooter>
        <ButtonRow>
          <Button label={t('Batal')} disabled={saving} onPress={onClose} />
          <Button
            variant="danger-solid"
            label={saving ? t('Memproses...') : t('Refund {amount}', { amount: money(est) })}
            loading={saving}
            disabled={!picked.length}
            onPress={() => void submit()}
          />
        </ButtonRow>
      </ActionFooter>
    </Sheet>
  );
}

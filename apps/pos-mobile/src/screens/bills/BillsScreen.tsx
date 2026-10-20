import { useCallback, useEffect, useRef, useState } from 'react';
import { Tap } from '../../components/Tap';
import { ActivityIndicator, FlatList, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow, IconButton } from '../../components/Button';
import { Banner, Card, Label, Tabs, Tag } from '../../components/bits';
import { SearchInput, TextField } from '../../components/Field';
import { ActionFooter, Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { Slip, SlipBand, SlipRow, SlipRule } from '../../components/Slip';
import { Header } from '../../components/chrome';
import { ChoiceButton } from '../../components/ChoiceSheet';
import { useLayout } from '../../hooks/useLayout';
import { useAppStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { fetchBillItems, fetchBillRefunds, fetchRecentClosedShifts, voidTransaction } from '../../services/transaction/repository';
import { concerns as billWaitsOn, entryNumber, QueuedCheckout, settlesHeldBill, takeBackHold } from '../../services/transaction/offlineQueue';
import { lineDiscount, lineGross } from '../../utils/discount';
import { readShift, ShiftData, syncShift } from '../../services/local/shiftData';
import { loadDeviceCashiers } from '../../services/supabase/session';
import { useCheckoutQueue, useQueueSyncing } from '../../services/transaction/useCheckoutQueue';
import { deleteHeldBill, recallHeldBillWithItems, RecalledBill } from '../../services/transaction/heldBills';
import { isLocked, refreshSubscription, useSubscription } from '../../services/subscription/subscription';
import { printerService } from '../../services/printer/service';
import { CartItem, Refund, Shift, TransactionItemSummary, TransactionSummary } from '../../types/domain';
import { RefundSheet } from './RefundSheet';
import { describeError, isExpiredError, isNetworkError } from '../../utils/errors';
import { reportPrintResult } from '../../utils/printFeedback';
import { receiptFromBill } from '../../utils/receipt';
import { haptic } from '../../utils/haptics';
import { colors } from '../../theme';
import { fmtDateTime, fmtTime, money, num, t, useT } from '../../i18n';

type Status = 'completed' | 'held' | 'voided';

function statusTag(b: TransactionSummary) {
  if (b.status === 'held') return <Tag label={t('ditahan')} tone="fire" />;
  if (b.status === 'voided') return <Tag label={t('void')} tone="error" />;
  if (b.refundedTotal)
    return <Tag label={b.refundedTotal >= b.total ? t('refund') : t('refund sebagian')} tone={b.refundedTotal >= b.total ? 'error' : 'fire'} />;
  return <Tag label={t('lunas')} tone="pine" />;
}

/** Cart lines as bill lines (preview only: the server recomputes prices and discounts). */
const lineSummaries = (lines: CartItem[]): TransactionItemSummary[] =>
  lines.map((i) => ({
    productId: i.productId,
    productName: i.name,
    station: i.station,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    subtotal: lineGross(i),
    discount: lineDiscount(i),
    note: i.note,
  }));

/** A queue entry shown as a bill: paid or held on this phone, not on the server yet (provisional number). */
const queuedRow = (e: QueuedCheckout): TransactionSummary => ({
  id: e.transactionId ?? e.id,
  number: entryNumber(e),
  customerName: e.customer.name,
  customerPhone: e.customer.phone,
  table: e.customer.table,
  status: e.kind === 'hold' ? 'held' : 'completed',
  total: e.total,
  paymentMethod: e.kind === 'hold' ? null : e.payment.method,
  createdAt: new Date(e.queuedAt).toISOString(),
  itemCount: e.items.reduce((n, i) => n + i.quantity, 0),
  items: [],
});

const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000; // same limit as refund_items_approved; the server is the one that enforces it

function BillRow({ bill, selected, queued, onPress }: { bill: TransactionSummary; selected: boolean; queued: boolean; onPress: () => void }) {
  const where = bill.table ? t('Meja {n}', { n: bill.table }) : t('Tanpa meja');
  const line = [
    fmtTime(bill.createdAt),
    where,
    bill.customerName?.trim() || null,
    bill.status === 'held' ? t('{n} porsi tersisa', { n: bill.itemCount }) : t('{n} item', { n: bill.itemCount }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Tap
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${bill.number}, ${money(bill.total)}`}
      onPress={onPress}
      className="min-h-[72px] justify-center gap-1 rounded-k px-3.5 py-2.5"
      style={({ pressed }) => ({ borderWidth: selected ? 2.5 : 1.5, borderColor: colors.ink, backgroundColor: pressed ? colors.tint : colors.slip })}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Mono className="min-w-0 flex-1 font-mono-600 text-[15px]" numberOfLines={1}>
          {bill.number}
        </Mono>
        <Mono className="font-mono-600 text-[15px]">{money(bill.total)}</Mono>
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 text-[14px] text-mute" numberOfLines={1}>
          {line}
        </Text>
        {queued ? <Tag label={t('belum terkirim')} tone="fire" /> : statusTag(bill)}
      </View>
    </Tap>
  );
}

/** Bill as a receipt: time, table, customer, cashier, items with notes and discounts, total, refunds with their reasons. */
function BillReceipt({
  bill,
  items,
  cashier,
  refunds,
}: {
  bill: TransactionSummary;
  items: TransactionItemSummary[] | null;
  cashier: string;
  refunds: Refund[];
}) {
  const gross = (items ?? []).reduce((n, i) => n + i.subtotal, 0);
  return (
    <Slip>
      <SlipRow left={t('Waktu')} right={fmtDateTime(bill.createdAt)} />
      <SlipRow left={t('Meja')} right={bill.table || '-'} />
      <SlipRow left={t('Pelanggan')} right={bill.customerName?.trim() || '-'} />
      <SlipRow left={t('Kasir')} right={cashier} />
      <SlipRule />
      {items === null ? (
        <View className="items-center py-4" accessibilityLabel={t('Memuat data...')}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : (
        items.map((i, k) => (
          <View key={k}>
            <SlipRow left={`${i.quantity}× ${i.productName}`} right={num(i.subtotal)} />
            {i.note ? <SlipRow sub left={`   ${i.note}`} /> : null}
            {i.discount > 0 ? <SlipRow sub left={`   ${t('Diskon')}`} right={`-${num(i.discount)}`} /> : null}
            {i.refundedQty ? <SlipRow sub tone="error" left={`   ${t('Direfund {n}', { n: i.refundedQty })}`} /> : null}
          </View>
        ))
      )}
      {items && gross > bill.total ? (
        <>
          <SlipRule />
          <SlipRow left={t('Diskon dan voucher')} right={`-${money(gross - bill.total)}`} tone="pine" />
        </>
      ) : null}
      <SlipBand left="TOTAL" right={money(bill.total)} tone={bill.status === 'voided' ? 'error' : 'fire'} />
      {bill.status === 'completed' ? <SlipRow left={t('Pembayaran')} right={bill.paymentMethod === 'qris' ? t('QRIS · lunas') : t('Tunai · lunas')} /> : null}
      {bill.status === 'held' ? <SlipRow left={t('Status')} right={t('Belum dibayar')} /> : null}
      {bill.refundedTotal ? (
        <>
          <SlipRule />
          {refunds.map((r) => (
            <View key={r.id}>
              <SlipRow
                left={`${t('Refund')} ${fmtTime(r.createdAt)} · ${r.method === 'qris' ? t('QRIS') : t('Tunai')}`}
                right={`-${money(r.amount)}`}
                tone="error"
              />
              <SlipRow sub left={`   ${t('Alasan: {reason}', { reason: r.reason })}`} />
            </View>
          ))}
          {refunds.length ? null : <SlipRow left={t('Refund')} right={`-${money(bill.refundedTotal)}`} tone="error" />}
          <SlipRow strong left={t('Bersih')} right={money(bill.total - bill.refundedTotal)} />
        </>
      ) : null}
    </Slip>
  );
}

export function BillsScreen({
  onQueue,
  onBell,
  onRecalled,
  onOpenShift,
}: {
  onQueue: () => void;
  onBell: () => void;
  onRecalled: () => void;
  onOpenShift: () => void;
}) {
  useT();
  const notify = useNotify();
  const { wide, phoneLandscape } = useLayout();
  const insets = useSafeAreaInsets();
  const { shift, session, cart, replaceCart, setActiveHeldBillId, setActiveHeldNumber, activeHeldBillId, clearCart, bumpHeld, setHeldCount, heldTick } =
    useAppStore();
  // Entries of this shift still on the device. Each one sent changes the list, so it reloads (below).
  const queued = useCheckoutQueue().filter((e) => e.shiftId === shift?.id);
  const queuedHolds = queued.filter((e) => e.kind === 'hold' && e.status === 'waiting').length;
  // Held bills paid offline stay held on the server until the payment is sent: hide them so they are not paid twice.
  const paidQueued = new Set(queued.map(settlesHeldBill).filter(Boolean));
  const [deviceList, setDeviceList] = useState(false);
  const syncing = useQueueSyncing();
  // The queue entry that makes this bill (a payment or a hold), by its own id (054) or the entry id of older ones.
  const entryOf = (id: string) => queued.find((e) => e.kind !== 'update' && (e.id === id || (!!e.transactionId && e.transactionId === id)));
  // A bill held on this phone as last saved: its newest queued change, or the hold itself.
  const holdHasDependents = (e: QueuedCheckout) => !!e.transactionId && queued.some((o) => o.id !== e.id && billWaitsOn(o, e.transactionId as string));
  const latestUpdate = (id: string) => [...queued].reverse().find((u) => u.kind === 'update' && u.existingTransactionId === id);
  const latestOf = (e: QueuedCheckout) => (e.transactionId && latestUpdate(e.transactionId)) || e;
  const queuedPaid = queued.filter((e) => (e.kind ?? 'checkout') === 'checkout').length;
  const { status } = useSubscription();
  const locked = isLocked(status);
  const [data, setData] = useState<ShiftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Status>('completed');
  const [selected, setSelected] = useState<TransactionSummary | null>(null);
  const [items, setItems] = useState<TransactionItemSummary[] | null>(null);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  // A closed shift of the last 24 hours, picked to refund its bills; null = the open shift.
  const [view, setView] = useState<Shift | null>(null);
  const [past, setPast] = useState<Shift[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const req = useRef(0);
  const detailReq = useRef(0);
  const viewed = view ?? shift;

  useEffect(() => {
    const h = setTimeout(() => setQ(query.trim()), 350);
    return () => clearTimeout(h);
  }, [query]);
  useEffect(() => {
    if (!session) return;
    fetchRecentClosedShifts(session.outletId)
      .then((list) => {
        setPast(list);
        // Closed shifts of the last day come to the phone too, so their bills can be opened and reprinted offline.
        list.forEach((p) => void syncShift(p.id, session.outletId).catch(() => undefined));
      })
      .catch(() => undefined);
    loadDeviceCashiers()
      .then((l) => setNames(Object.fromEntries(l.map((c) => [c.cashierId, c.cashierName]))))
      .catch(() => undefined);
  }, [session?.outletId, shift?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The shift from the local database (055): shown at once, then refreshed from the server. Offline the last copy stays,
  // with a banner; never an empty list for a failed load (PRD B, rules).
  const load = useCallback(async () => {
    if (!viewed || !session) {
      setData(null);
      setLoading(false);
      return;
    }
    const id = ++req.current;
    const shiftId = viewed.id;
    const local = await readShift(shiftId).catch(() => null);
    if (id !== req.current) return;
    if (local) setData(local);
    setLoading(!local);
    const synced = await syncShift(shiftId, session.outletId).then(
      () => true,
      () => false,
    );
    const fresh = synced ? await readShift(shiftId).catch(() => null) : null;
    if (id !== req.current) return;
    if (fresh) setData(fresh);
    if (fresh && !view) setHeldCount(fresh.bills.filter((b) => b.status === 'held').length); // the badge is the open shift's
    setDeviceList(!synced && !!local);
    setLoadError(!synced && !local);
    setLoading(false);
  }, [viewed?.id, view, session?.outletId, setHeldCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [viewed?.id, heldTick, queued.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = data?.bills ?? [];
  const counts = {
    completed: all.filter((b) => b.status === 'completed').length,
    held: all.filter((b) => b.status === 'held').length,
    voided: all.filter((b) => b.status === 'voided').length,
  };
  const needleRows = q.toLowerCase();
  const rows = all.filter((b) => b.status === filter && (!needleRows || `${b.number} ${b.customerName} ${b.table}`.toLowerCase().includes(needleRows)));

  const open = (bill: TransactionSummary, fromServer = false) => {
    const id = ++detailReq.current;
    setSelected(bill);
    setItems(null);
    setRefunds([]);
    // Still in the queue: its items are on the device, the server does not know it yet.
    const entry = entryOf(bill.id);
    if (entry) return setItems(lineSummaries(latestOf(entry).items));
    // A held bill changed offline: the change waiting in the queue is newer than the server's items.
    const changed = latestUpdate(bill.id);
    if (changed) return setItems(lineSummaries(changed.items));
    // In the local copy of the shift (055): items and refunds without a request, also offline.
    const lines = fromServer ? undefined : data?.items[bill.id];
    if (lines) {
      setItems(lines);
      setRefunds((data?.refunds ?? []).filter((r) => r.number === bill.number));
      return;
    }
    if (bill.refundedTotal)
      fetchBillRefunds(bill.id)
        .then((r) => {
          if (id === detailReq.current) setRefunds(r);
        })
        .catch(() => undefined); // the bill still shows the refunded total without the reasons
    fetchBillItems(bill.id)
      .then((r) => {
        if (id === detailReq.current) setItems(r);
      })
      .catch((e) => {
        if (id !== detailReq.current) return;
        setItems([]);
        void notify.fail(t('Rincian bill belum dimuat'), e);
      });
  };
  const closeDetail = () => {
    detailReq.current++;
    setSelected(null);
    setItems(null);
  };

  const reprint = async (kind: 'customer' | 'kitchen' | 'bar') => {
    if (!selected || !items) return;
    setBusy(kind);
    try {
      const owner = viewed && names[viewed.cashierId];
      const data = {
        ...receiptFromBill(selected, items, session && owner ? { ...session, cashierName: owner } : session),
        refunds: kind === 'customer' ? refunds : undefined,
      };
      const results =
        kind === 'customer'
          ? await printerService.reprint(data)
          : kind === 'kitchen'
            ? await printerService.printKitchen(data, false)
            : await printerService.printBar(data, false);
      reportPrintResult(notify, results, {
        missingTitle: t('Printer belum diatur'),
        missingMessage:
          kind === 'customer'
            ? t('Belum ada printer dengan peran Cetak ulang atau Struk pelanggan.')
            : kind === 'kitchen'
              ? t('Belum ada printer dengan peran Dapur.')
              : t('Belum ada printer dengan peran Bar.'),
        successTitle: t('Dicetak ulang'),
        successMessage: selected.number,
      });
    } catch (e) {
      void notify.fail(t('Cetak gagal'), e);
    } finally {
      setBusy(null);
    }
  };

  const recall = async () => {
    if (!selected || selected.status !== 'held' || busy) return;
    if (cart.length && activeHeldBillId !== selected.id) {
      const ok = await notify.confirm({
        title: t('Ganti bill di layar?'),
        message: t('Bill yang sedang dibuat akan diganti. Tahan dulu kalau masih dipakai.'),
        confirmLabel: t('Ganti bill'),
      });
      if (!ok) return;
    }
    setBusy('recall');
    try {
      // A change still in the queue is newer than the server's copy: recall that version then.
      const changed = latestUpdate(selected.id);
      let recalled: RecalledBill;
      try {
        recalled = changed
          ? {
              header: {
                customerName: changed.customer.name,
                customerPhone: changed.customer.phone,
                tableNumber: changed.customer.table,
                billDiscount: changed.billDiscount ?? null,
              },
              items: changed.items,
            }
          : await recallHeldBillWithItems(selected.id);
      } catch (e) {
        // Offline: the bill as the server last sent it, in the local copy of the open shift (057).
        const copy = isNetworkError(e) && !view ? data?.held[selected.id] : undefined;
        if (!copy) throw e;
        recalled = copy;
        notify.toast(
          'warning',
          t('Dipanggil dari data di perangkat'),
          t('Tidak ada internet. Perubahan dan pembayaran dikirim otomatis saat internet kembali.'),
        );
      }
      const { header, items: lines } = recalled;
      replaceCart(
        lines,
        { name: header.customerName || selected.customerName || '', phone: header.customerPhone || '', table: header.tableNumber || selected.table || '' },
        header.billDiscount,
      );
      setActiveHeldBillId(selected.id);
      setActiveHeldNumber(selected.number);
      closeDetail();
      onRecalled();
    } catch (e) {
      void notify.fail(t('Bill belum bisa dipanggil'), e);
    } finally {
      setBusy(null);
    }
  };

  /** A held bill made offline back on screen: off the queue first, so it is never sent and also paid. */
  const recallOffline = async () => {
    if (!selected || busy) return;
    if (cart.length) {
      const ok = await notify.confirm({
        title: t('Ganti bill di layar?'),
        message: t('Bill yang sedang dibuat akan diganti. Tahan dulu kalau masih dipakai.'),
        confirmLabel: t('Ganti bill'),
      });
      if (!ok) return;
    }
    setBusy('recall');
    try {
      const entry = entryOf(selected.id);
      if (entry?.transactionId) {
        // Held on this phone with its own id (054): recalled as the same held bill. A change or payment queues behind
        // the hold, so the server gets them in order.
        const v = latestOf(entry);
        replaceCart(v.items, v.customer, v.billDiscount ?? null);
        setActiveHeldBillId(entry.transactionId);
        setActiveHeldNumber(entryNumber(entry));
        closeDetail();
        onRecalled();
        notify.toast('warning', t('Dipanggil dari data di perangkat'), t('Perubahan dan pembayaran dikirim otomatis saat internet kembali.'));
        return;
      }
      // Older offline holds without their own id: taken off the queue and recalled as a new bill.
      const e = entry ? await takeBackHold(entry.id) : null;
      if (!e) {
        void notify.warning(
          t('Bill belum bisa dipanggil'),
          t('Bill ini sedang dikirim. Tunggu sebentar, lalu buka lagi.'),
        );
        return;
      }
      replaceCart(e.items, e.customer, e.billDiscount ?? null);
      setActiveHeldBillId(null);
      setActiveHeldNumber(null);
      closeDetail();
      onRecalled();
      notify.toast('warning', t('Bill dipanggil dari perangkat'), t('Bill ini belum pernah terkirim. Bayar atau tahan lagi seperti bill baru.'));
    } catch (err) {
      void notify.fail(t('Bill belum bisa dipanggil'), err);
    } finally {
      setBusy(null);
    }
  };

  const removeOffline = async () => {
    if (!selected || busy) return;
    const target = selected;
    const ok = await notify.confirm({
      title: t('Hapus bill ditahan?'),
      message: t('{n} akan dihapus dan tidak bisa dipanggil lagi.', { n: target.number }),
      confirmLabel: t('Hapus bill'),
      destructive: true,
    });
    if (!ok) return;
    setBusy('delete');
    try {
      const entry = entryOf(target.id);
      // Only a hold nothing else in the queue depends on (no change, part or payment of it) comes off the queue.
      const e = entry && !holdHasDependents(entry) ? await takeBackHold(entry.id) : null;
      if (!e) {
        void notify.warning(
          t('Bill belum terhapus'),
          t('Bill ini sedang dikirim. Tunggu sebentar, lalu buka lagi.'),
        );
        return;
      }
      closeDetail();
      notify.success(t('Bill dihapus'), target.number);
    } catch (err) {
      void notify.fail(t('Bill belum terhapus'), err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!selected || selected.status !== 'held') return;
    const target = selected;
    const ok = await notify.confirm({
      title: t('Hapus bill ditahan?'),
      message: t('{n} akan dihapus dan tidak bisa dipanggil lagi.', { n: target.number }),
      confirmLabel: t('Hapus bill'),
      destructive: true,
    });
    if (!ok) return;
    setBusy('delete');
    try {
      await deleteHeldBill(target.id);
      if (activeHeldBillId === target.id) {
        clearCart();
        setActiveHeldBillId(null);
        setActiveHeldNumber(null);
      }
      closeDetail();
      bumpHeld(); // reloads the list (heldTick)
      notify.success(t('Bill dihapus'), target.number);
    } catch (e) {
      void notify.fail(t('Bill belum terhapus'), e);
    } finally {
      setBusy(null);
    }
  };

  const onVoided = () => {
    closeDetail();
    void load();
  };

  const onRefunded = (refundedTotal: number) => {
    if (!selected) return;
    const next = { ...selected, refundedTotal };
    setRefundOpen(false);
    void load();
    open(next, true); // the server's items, with the new refunded quantities
  };
  const canRefund =
    !!selected &&
    selected.status === 'completed' &&
    !!items &&
    Date.now() - new Date(selected.createdAt).getTime() < REFUND_WINDOW_MS &&
    items.some((i) => i.itemId && i.quantity - (i.refundedQty ?? 0) > 0);

  const header = <Header title={t('Bill')} onQueue={onQueue} onBell={onBell} />;

  if (!shift) {
    return (
      <View className="flex-1 bg-paper">
        {header}
        <View className="p-4">
          <Card>
            <Display size={26}>{t('Belum ada shift yang buka.')}</Display>
            <Text className="mt-2 text-[15px] text-mute">
              {t('Hanya bill shift ini. Riwayat lama ada di backoffice.')}
            </Text>
            {!locked ? <Button className="mt-4" variant="fire" label={t('Buka shift')} onPress={onOpenShift} /> : null}
          </Card>
        </View>
      </View>
    );
  }

  // Bills paid or held on this phone and still in the queue, newest first, above the server's list of the open shift.
  const needle = q.toLowerCase();
  const deviceRows = view
    ? []
    : queued
        .filter((e) =>
          filter === 'completed' ? (e.kind ?? 'checkout') === 'checkout' : filter === 'held' && e.kind === 'hold' && !paidQueued.has(e.transactionId ?? ''),
        )
        .map((e) => ({
          ...latestOf(e),
          id: e.id,
          transactionId: e.transactionId,
          idempotencyKey: e.idempotencyKey,
          number: e.number,
          queuedAt: e.queuedAt,
          kind: e.kind,
        }))
        .map(queuedRow)
        .filter((r) => !needle || `${r.number} ${r.customerName} ${r.table}`.toLowerCase().includes(needle))
        .reverse();

  const closedNote = t('Shift sudah ditutup. Refund masih bisa dalam 24 jam.');
  const total = filter === 'completed' ? counts.completed : filter === 'held' ? counts.held : counts.voided;
  const list = (
    <View className="flex-1">
      <View className="gap-2.5 px-3.5 pb-2.5 pt-3" style={{ flexShrink: 0 }}>
        <SearchInput value={query} onChangeText={setQuery} placeholder={t('Nomor bill, meja, atau nama')} />
        {past.length ? (
          <ChoiceButton
            title={t('Pilih shift')}
            options={[
              { key: '', label: t('Shift ini') },
              ...past.map((p) => ({
                key: p.id,
                label: `S${p.shiftNumber} · ${names[p.cashierId] ?? t('Kasir')} · ${fmtTime(p.openedAt)}–${p.closedAt ? fmtTime(p.closedAt) : ''}`,
              })),
            ]}
            value={view?.id ?? ''}
            onChange={(k) => {
              setView(past.find((p) => p.id === k) ?? null);
              closeDetail();
            }}
          />
        ) : null}
        {view && !wide ? <Text className="text-[14px] text-mute">{closedNote}</Text> : null}
        <Tabs<Status>
          value={filter}
          onChange={(k) => {
            setFilter(k);
            closeDetail();
          }}
          items={[
            { key: 'completed', label: t('Selesai'), count: counts.completed + (view ? 0 : queuedPaid) },
            { key: 'held', label: t('Ditahan'), count: view ? counts.held : Math.max(0, counts.held + queuedHolds - paidQueued.size) },
            { key: 'voided', label: t('Void'), count: counts.voided },
          ]}
        />
        {deviceList ? (
          <Banner
            tone="slip"
            compact={phoneLandscape}
            title={t('Offline: daftar terakhir di perangkat')}
            message={
              phoneLandscape
                ? null
                : filter === 'held'
                  ? t('Bill tetap bisa diubah dan dibayar, lalu dikirim saat online.')
                  : t('Bill bisa dibuka dan dicetak ulang. Void dan refund perlu internet.')
            }
          />
        ) : null}
        {loadError && deviceRows.length ? (
          <Banner
            tone="error"
            compact={phoneLandscape}
            title={t('Daftar dari server belum bisa dimuat.')}
            message={phoneLandscape ? null : t('Hanya bill dari HP ini yang belum terkirim.')}
          >
            <ButtonRow>
              <Button size="sm" variant="pine" label={t('Coba lagi')} onPress={() => void load()} />
            </ButtonRow>
          </Banner>
        ) : null}
      </View>
      {loading && !deviceRows.length ? (
        <View className="items-center py-10" accessibilityLabel={t('Memuat data...')}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : loadError && !deviceRows.length ? (
        <View className="px-3.5">
          <Banner
            tone="error"
            title={t('Daftar bill belum bisa dimuat.')}
            message={t('Daftar ini kosong karena gagal dimuat, bukan karena tidak ada bill. Periksa internet.')}
          >
            <ButtonRow>
              <Button size="sm" variant="pine" label={t('Coba lagi')} onPress={() => void load()} />
            </ButtonRow>
          </Banner>
        </View>
      ) : (
        <FlatList
          // Bills still on this phone first, then the shift's bills from the local copy (055).
          data={[...deviceRows, ...(filter === 'held' && !view ? rows.filter((r) => !paidQueued.has(r.id)) : rows)]}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16 + (wide ? insets.bottom : 0), gap: 8 }}
          refreshing={false}
          onRefresh={() => void load()}
          renderItem={({ item }) => <BillRow bill={item} selected={wide && selected?.id === item.id} queued={!!entryOf(item.id)} onPress={() => open(item)} />}
          ListEmptyComponent={
            <Text className="py-8 text-center text-[15px] text-mute">
              {q
                ? t('Tidak ada bill yang cocok.')
                : filter === 'held'
                  ? t('Belum ada bill ditahan.')
                  : filter === 'voided'
                    ? t('Belum ada bill yang di-void.')
                    : t('Belum ada bill selesai di shift ini.')}
            </Text>
          }
          ListFooterComponent={
            rows.length ? (
              <Mono className="py-3 text-center text-[13px] text-mute">{t('Menampilkan {n} dari {m} bill.', { n: rows.length, m: total })}</Mono>
            ) : null
          }
        />
      )}
    </View>
  );

  const detailBody = selected ? (
    <>
      <BillReceipt bill={selected} items={items} refunds={refunds} cashier={(viewed && names[viewed.cashierId]) || session?.cashierName || ''} />
      {selected.status === 'voided' ? (
        <View className="mt-3 rounded-k px-3.5 py-3" style={{ borderWidth: 1.5, borderColor: colors.errorLine, backgroundColor: colors.errorSoft }}>
          <Label>{t('Alasan void · disetujui pemilik')}</Label>
          <Text className="mt-1 text-[15px]">{selected.voidReason?.trim() || '-'}</Text>
        </View>
      ) : null}
      {selected.status !== 'voided' ? (
        <>
          <Label className="mt-4">{t('Cetak ulang')}</Label>
          <View className="mt-1.5">
            <ButtonRow>
              <Button size="sm" label={busy === 'customer' ? '...' : t('Struk')} disabled={!items || !!busy} onPress={() => void reprint('customer')} />
              <Button size="sm" label={busy === 'kitchen' ? '...' : t('Dapur')} disabled={!items || !!busy} onPress={() => void reprint('kitchen')} />
              <Button size="sm" label={busy === 'bar' ? '...' : t('Bar')} disabled={!items || !!busy} onPress={() => void reprint('bar')} />
            </ButtonRow>
          </View>
        </>
      ) : null}
    </>
  ) : null;

  const selEntry = selected ? entryOf(selected.id) : undefined;
  // Deleting an offline hold takes it off the queue: only when it never left the phone and nothing depends on it.
  // Recalling one with its own id (054) is always safe; an older one without it is taken off the queue, same rule.
  const deleteLocked = !!selEntry && (!!selEntry.maybeSent || syncing || holdHasDependents(selEntry));
  const recallLocked = !!selEntry && !selEntry.transactionId && (!!selEntry.maybeSent || syncing);
  // The hint explains the locks that come from the server side (sent or sending); dependents only block Hapus.
  const holdLocked = !!selEntry && (!!selEntry.maybeSent || syncing);
  const detailActions = selected ? (
    selEntry && selected.status === 'completed' ? (
      // Paid on this phone, not on the server yet: void and refund need the server, reprint does not.
      <Button
        variant="pine"
        label={t('Cetak ulang struk')}
        loading={busy === 'customer'}
        disabled={!items || !!busy}
        onPress={() => void reprint('customer')}
      />
    ) : selEntry ? (
      <View className="gap-2">
        {holdLocked ? (
          <Text className="text-[14px] text-mute">
            {t('Bill ini sedang dikirim. Tunggu sebentar, lalu buka lagi.')}
          </Text>
        ) : null}
        <ButtonRow>
          <Button variant="danger" label={t('Hapus')} loading={busy === 'delete'} disabled={!!busy || deleteLocked} onPress={() => void removeOffline()} />
          <Button
            variant="fire"
            label={t('Panggil bill')}
            loading={busy === 'recall'}
            disabled={!!busy || locked || recallLocked}
            onPress={() => void recallOffline()}
          />
        </ButtonRow>
      </View>
    ) : selected.status === 'completed' ? (
      <ButtonRow>
        {/* Void after a refund would take the cash out twice; the server refuses it too. */}
        {!view ? (
          <Button variant="danger" label={t('Void bill')} disabled={locked || !!busy || !!selected.refundedTotal} onPress={() => setVoidOpen(true)} />
        ) : null}
        {canRefund ? (
          <Button variant="fire" label={t('Refund item')} disabled={locked || !!busy} onPress={() => setRefundOpen(true)} />
        ) : (
          <Button
            variant="pine"
            label={t('Cetak ulang struk')}
            loading={busy === 'customer'}
            disabled={!items || !!busy}
            onPress={() => void reprint('customer')}
          />
        )}
      </ButtonRow>
    ) : selected.status === 'held' ? (
      <ButtonRow>
        <Button variant="danger" label={t('Hapus')} loading={busy === 'delete'} disabled={!!busy} onPress={() => void remove()} />
        <Button variant="fire" label={t('Panggil bill')} loading={busy === 'recall'} disabled={!!busy || locked} onPress={() => void recall()} />
      </ButtonRow>
    ) : (
      <Button label={t('Tutup')} onPress={closeDetail} />
    )
  ) : null;

  return (
    <View className="flex-1 bg-paper">
      {header}
      {wide ? (
        <View className="flex-1 flex-row">
          <View style={{ width: '46%' }} className="border-r-k border-ink">
            {list}
          </View>
          <View className="flex-1 bg-slip">
            {selected ? (
              <>
                <View className="flex-row items-start gap-3 border-b-k border-ink px-4 py-3">
                  <View className="min-w-0 flex-1">
                    <Label>{t('Rincian bill')}</Label>
                    <Display size={24} numberOfLines={1}>
                      {selected.number}
                    </Display>
                  </View>
                  {statusTag(selected)}
                  <IconButton icon="close" label={t('Tutup')} onPress={closeDetail} />
                </View>
                <ScrollView className="flex-1" contentContainerClassName="p-4">
                  {detailBody}
                </ScrollView>
                <View className="gap-3 border-t-k border-ink px-4 py-3">{detailActions}</View>
              </>
            ) : (
              <View className="flex-1 items-center justify-center gap-3 p-6">
                <Text className="text-[15px] text-mute">{t('Pilih bill di kiri.')}</Text>
                {/* Wide screens keep the list short, so the closed-shift note lives here. */}
                {view ? <Text className="max-w-[380px] text-center text-[14px] text-mute">{closedNote}</Text> : null}
              </View>
            )}
          </View>
        </View>
      ) : (
        list
      )}

      {!wide ? (
        <Sheet visible={!!selected} onClose={closeDetail} size="tall" label={t('Rincian bill')}>
          {selected ? (
            <>
              <SheetHeader eyebrow={t('Rincian bill')} title={selected.number} titleSize={22} right={statusTag(selected)} onClose={closeDetail} />
              <SheetBody>{detailBody}</SheetBody>
              <ActionFooter>{detailActions}</ActionFooter>
            </>
          ) : null}
        </Sheet>
      ) : null}

      <VoidSheet
        bill={voidOpen ? selected : null}
        onClose={() => setVoidOpen(false)}
        onVoided={() => {
          setVoidOpen(false);
          onVoided();
        }}
      />
      <RefundSheet bill={refundOpen ? selected : null} items={items} onClose={() => setRefundOpen(false)} onRefunded={(r) => onRefunded(r.refundedTotal)} />
    </View>
  );
}

/**
 * Void (DESIGN I5.11, PRD C8): the whole bill, a reason, and the owner's 6-digit approval code. Needs internet;
 * never queued. Stock comes back and the cash drawer is corrected by the server.
 */
function VoidSheet({ bill, onClose, onVoided }: { bill: TransactionSummary | null; onClose: () => void; onVoided: (b: TransactionSummary) => void }) {
  useT();
  const notify = useNotify();
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; code?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (bill) {
      setReason('');
      setCode('');
      setErrors({});
    }
  }, [bill?.id]);

  const submit = async () => {
    if (!bill || saving) return;
    const e: typeof errors = {};
    if (reason.trim().length < 3) e.reason = t('Tulis alasan minimal 3 huruf.');
    if (!/^\d{6}$/.test(code)) e.code = t('Kode persetujuan 6 digit angka.');
    setErrors(e);
    if (e.reason || e.code) return;
    setSaving(true);
    try {
      const r = await voidTransaction(bill.id, reason.trim(), code);
      if (!r.ok) {
        haptic.error();
        setCode('');
        if (r.reason === 'wrong') setErrors({ code: t('Kode salah. Sisa percobaan: {n}.', { n: r.attemptsLeft }) });
        else if (r.reason === 'locked') setErrors({ code: t('Terlalu banyak kode salah. Coba lagi dalam 5 menit.') });
        else setErrors({ form: t('Pemilik belum membuat kode persetujuan di backoffice.') });
        return;
      }
      haptic.heavy();
      notify.success(t('Bill di-void'), t('{n} · stok kembali, kas laci dikoreksi.', { n: r.number }));
      onVoided(bill);
    } catch (err) {
      if (isExpiredError(err)) void refreshSubscription().catch(() => undefined);
      setErrors({ form: isNetworkError(err) ? t('Void perlu internet. Sambungkan internet lalu coba lagi.') : describeError(err).message });
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
      label={t('Void bill')}
    >
      <SheetHeader
        title={t('Void bill')}
        subtitle={bill ? `${bill.number} · ${money(bill.total)} · ${bill.paymentMethod === 'qris' ? t('QRIS') : t('tunai')}` : undefined}
        onClose={onClose}
      />
      <SheetBody contentClassName="gap-3.5">
        <Text className="text-[15px] leading-[22px] text-mute">
          {t('Stok kembali dan kas laci dikoreksi. Tidak bisa diurungkan, perlu internet.')}
        </Text>
        <TextField
          label={t('Alasan')}
          value={reason}
          onChangeText={(v) => {
            setReason(v);
            setErrors((x) => ({ ...x, reason: undefined, form: undefined }));
          }}
          placeholder={t('Pelanggan batal, minuman belum dibuat')}
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
          <Button variant="danger-solid" label={saving ? t('Memproses...') : t('Void bill ini')} loading={saving} onPress={() => void submit()} />
        </ButtonRow>
      </ActionFooter>
    </Sheet>
  );
}

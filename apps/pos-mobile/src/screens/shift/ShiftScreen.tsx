import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Banner, Card, Chip, Dashed, Label, Tag } from '../../components/bits';
import { AmountBox, TextField } from '../../components/Field';
import { Tap } from '../../components/Tap';
import { Keypad } from '../../components/Keypad';
import { ActionFooter, Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { Slip, SlipBand, SlipRow, SlipRule } from '../../components/Slip';
import { Header } from '../../components/chrome';
import { useLayout } from '../../hooks/useLayout';
import { useAppStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { useCheckoutQueue } from '../../services/transaction/useCheckoutQueue';
import { getQueueSnapshot, loadQueue, resolveOpenShift, settlesHeldBill, syncCheckoutQueue } from '../../services/transaction/offlineQueue';
import { isOnline } from '../../services/network/network';
import { forgetPin } from '../../services/supabase/offlinePin';
import {
  closeShift,
  DashboardSummary,
  fetchShiftRefunds,
  fetchTodayShifts,
  forgetOpenShift,
  openShift,
  takeOverShift,
} from '../../services/transaction/repository';
import { deviceId, onOtherDevice } from '../../services/device';
import { haptic } from '../../utils/haptics';
import { randomUUID } from 'expo-crypto';
import { readShift, ShiftData, syncShift } from '../../services/local/shiftData';
import { SalesReport } from '../../services/report/report';
import { isLocked, refreshSubscription, useSubscription } from '../../services/subscription/subscription';
import { printerService } from '../../services/printer/service';
import { Shift } from '../../types/domain';
import { describeError, isExpiredError, isNetworkError } from '../../utils/errors';
import { reportPrintResult } from '../../utils/printFeedback';
import { reportText } from '../../utils/shiftReport';
import { colors } from '../../theme';
import { fmtBusinessDate, fmtTime, money, num, t, useT } from '../../i18n';

type Cash = { cashIn: number; cashOut: number; expectedCash: number };
type Closed = {
  shiftNumber: number;
  expected: number;
  counted: number;
  variance: number;
  qrisReported: number | null;
  qrisVariance: number | null;
  sales: number;
  bills: number;
  closedAt: string;
  openedAt: string;
  shiftId: string;
  report: SalesReport | null;
};

/** Hourly bars, busiest hour orange, values in thousands (DESIGN B, bar chart). */
function HourBars({ hourly }: { hourly: DashboardSummary['hourly'] }) {
  const data = hourly.filter((h) => h.total > 0);
  if (!data.length) return <Text className="py-4 text-[14px] text-mute">{t('Belum ada penjualan di shift ini.')}</Text>;
  const max = Math.max(...data.map((h) => h.total));
  const peak = data.find((h) => h.total === max)?.hour;
  return (
    <View>
      <View className="mt-2 flex-row items-end justify-between" style={{ height: 120, gap: 6 }} accessibilityLabel={t('Penjualan per jam')}>
        {data.map((h) => (
          <View key={h.hour} className="flex-1 items-center justify-end">
            <Mono className="mb-1 text-[12px] text-mute">{Math.round(h.total / 1000)}</Mono>
            <View
              style={{ width: '70%', maxWidth: 28, height: Math.max(4, (h.total / max) * 90), backgroundColor: h.hour === peak ? colors.fire : colors.pine }}
            />
          </View>
        ))}
      </View>
      <View className="mt-1 flex-row justify-between" style={{ gap: 6 }}>
        {data.map((h) => (
          <Mono key={h.hour} className="flex-1 text-center text-[12px] text-mute">
            {String(h.hour).padStart(2, '0')}
          </Mono>
        ))}
      </View>
      <Text className="mt-2 text-[13px] text-mute">{t('Dalam ribu rupiah. Batang oranye adalah jam tersibuk shift ini.')}</Text>
    </View>
  );
}

type PadField = { label: string; value: string; onChange: (v: string) => void };

/** One keypad for one amount, or for two (tap a box to choose which one the keypad fills). */
function MoneyPad({ label, value, onChange, presets, second }: PadField & { presets?: number[]; second?: PadField }) {
  const { phoneLandscape } = useLayout();
  const [onSecond, setOnSecond] = useState(false);
  const pick = (f: PadField, active: boolean, select: () => void) => (
    <Tap accessibilityRole="button" accessibilityLabel={`${f.label} ${money(Number(f.value || 0))}`} accessibilityState={{ selected: active }} onPress={select}>
      <AmountBox label={f.label} value={money(Number(f.value || 0))} active={active} compact={phoneLandscape} />
    </Tap>
  );
  const box = (
    <View className="gap-2.5">
      {second ? (
        <>
          {pick({ label, value, onChange }, !onSecond, () => setOnSecond(false))}
          {pick(second, onSecond, () => setOnSecond(true))}
        </>
      ) : (
        <AmountBox label={label} value={money(Number(value || 0))} compact={phoneLandscape} />
      )}
      {presets ? (
        <View className="flex-row gap-2">
          {presets.map((p) => (
            <Chip
              key={p}
              grow
              label={p ? t('{n}rb', { n: num(p / 1000) }) : 'Rp0'}
              selected={value !== '' && Number(value) === p}
              onPress={() => onChange(String(p))}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
  const pad = second && onSecond ? <Keypad value={second.value} onChange={second.onChange} compact={phoneLandscape} /> : <Keypad value={value} onChange={onChange} compact={phoneLandscape} />;
  return phoneLandscape ? (
    <View className="flex-row gap-4">
      <View className="flex-1">{box}</View>
      <View className="flex-1">{pad}</View>
    </View>
  ) : (
    <View className="gap-2.5">
      {box}
      {pad}
    </View>
  );
}

/**
 * What the tab last showed per cashier and shift, in memory only, so switching tabs shows it at once. The data itself is
 * the local copy of the shift (055, 057), which also covers a restart without internet.
 */
type ShiftSnap = { report: SalesReport | null; cash: Cash | null; dash: DashboardSummary | null; today: Shift[] };
const shiftCache = new Map<string, ShiftSnap>();

export function ShiftScreen({
  onQueue,
  onBell,
  onOpenBills,
  onOpenHistory,
}: {
  onQueue: () => void;
  onBell: () => void;
  onOpenBills: () => void;
  onOpenHistory: () => void;
}) {
  useT();
  const notify = useNotify();
  const { wide } = useLayout();
  const { session, shift, setShift, clearCart, clearSplitBill, setActiveHeldBillId, setActiveHeldNumber, heldCount, setHeldCount, heldTick } = useAppStore();
  const { status } = useSubscription();
  const locked = isLocked(status);
  const queue = useCheckoutQueue();
  const ofShift = shift ? queue.filter((e) => e.shiftId === shift.id) : [];
  // Waiting entries do not block closing: the queued close is sent after them. Refused ones must be reviewed first.
  const rejected = ofShift.filter((e) => e.status === 'conflict').length;
  const waitingHolds = ofShift.filter((e) => e.status === 'waiting' && e.kind === 'hold').length;
  const waitingHeldPaid = ofShift.filter((e) => settlesHeldBill(e)).length;
  const held = Math.max(0, heldCount + waitingHolds - waitingHeldPaid);
  const pendingSales = ofShift.filter((e) => e.status === 'waiting' && (e.kind ?? 'checkout') === 'checkout');
  const pendingQris = pendingSales.reduce((n, e) => n + (e.payment.method === 'qris' ? e.total : 0), 0);
  const pendingCash = pendingSales.reduce((n, e) => n + (e.payment.method === 'qris' ? 0 : e.total), 0);
  const cacheKey = `${session?.cashierId ?? '-'}|${shift?.id ?? '-'}`;
  const snap = shiftCache.get(cacheKey);
  const [report, setReport] = useState<SalesReport | null>(snap?.report ?? null);
  const [cash, setCash] = useState<Cash | null>(snap?.cash ?? null);
  const [dash, setDash] = useState<DashboardSummary | null>(snap?.dash ?? null);
  const [today, setToday] = useState<Shift[]>(snap?.today ?? []);
  const [loading, setLoading] = useState(!snap);
  const [offline, setOffline] = useState(false);
  const [openSheet, setOpenSheet] = useState(false);
  const [closeSheet, setCloseSheet] = useState(false);
  const [opening, setOpening] = useState('');
  const [counted, setCounted] = useState('');
  const [qris, setQris] = useState('');
  // The QRIS total from the merchant app is asked only when the shift may have QRIS money (unknown counts as maybe).
  const askQris = !report || report.qrisRevenue !== 0 || pendingQris !== 0;
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [closed, setClosed] = useState<Closed | null>(null);
  const [takeOver, setTakeOver] = useState(false);
  const otherDevice = onOtherDevice(shift);

  const load = useCallback(async () => {
    if (!session) return;
    if (!shiftCache.has(cacheKey)) setLoading(true);
    const apply = (s: ShiftData | null, list: Shift[]) => {
      const next = { report: s?.report ?? null, cash: s?.cash ?? null, dash: s?.dashboard ?? null, today: list };
      shiftCache.set(cacheKey, next);
      setReport(next.report);
      setCash(next.cash);
      setDash(next.dash);
      setToday(next.today);
    };
    // The local copy first (also offline), then one sync; a failed load never shows zero (PRD B, rules).
    const local = shift ? await readShift(shift.id).catch(() => null) : null;
    if (local) apply(local, shiftCache.get(cacheKey)?.today ?? []);
    const [list, failure] = await Promise.all([
      fetchTodayShifts(session.cashierId).catch(() => null), // offline: the shifts in the local database
      shift
        ? syncShift(shift.id, session.outletId).then(
            () => null,
            (e: unknown) => e,
          )
        : Promise.resolve(null),
    ]);
    const fresh = shift && !failure ? await readShift(shift.id).catch(() => null) : null;
    if (fresh || !shift) apply(fresh, list ?? shiftCache.get(cacheKey)?.today ?? []);
    else if (list) setToday(list);
    if (fresh) setHeldCount(fresh.bills.filter((b) => b.status === 'held').length);
    setOffline(!!failure && isNetworkError(failure));
    if (failure && !isNetworkError(failure)) void notify.fail(t('Laporan shift belum dimuat'), failure);
    setLoading(false);
  }, [session?.cashierId, shift?.id, heldTick, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!shift && session)
      resolveOpenShift(session.cashierId)
        .then((s) => {
          if (s) setShift(s);
        })
        .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening and closing a shift need internet (owner's choice, 18 Oct 2026): the server numbers the shift and counts the
  // drawer. Only what happens inside an open shift (sales, held bills) works offline.
  const needsInternet = (title: string) =>
    void notify.warning(title, t('Buka dan tutup shift butuh internet. Penjualan yang sudah tercatat tetap aman di HP.'));

  const doOpen = async () => {
    if (!session || busy) return;
    if (!isOnline()) return needsInternet(t('Shift belum dibuka'));
    // shortcut: a close queued by an app version before 18 Oct 2026 must reach the server first; drop this check once
    // no phone runs such a version.
    if (getQueueSnapshot().some((e) => e.kind === 'close_shift' && e.cashierId === session.cashierId)) {
      void notify.warning(t('Shift sebelumnya masih dikirim'), t('Tunggu sampai penutupan shift sebelumnya terkirim, lalu buka shift lagi.'));
      return;
    }
    setBusy(true);
    try {
      const s = await openShift({
        shiftId: randomUUID(),
        cashierId: session.cashierId,
        outletId: session.outletId,
        openingCash: Number(opening || 0),
        openedAt: new Date().toISOString(),
      });
      setShift(s);
      setOpenSheet(false);
      setOpening('');
      notify.success(t('Shift {n} dibuka', { n: s.shiftNumber }), t('Kas awal {amount}.', { amount: money(s.openingCash) }));
    } catch (e) {
      if (isExpiredError(e)) void refreshSubscription().catch(() => undefined);
      if (isNetworkError(e)) needsInternet(t('Shift belum dibuka'));
      else void notify.fail(t('Shift belum dibuka'), e);
      // Opened on the server although the answer was lost or refused as a second one: show the shift that is open.
      if (isNetworkError(e) || /shift yang sedang berjalan/i.test(describeError(e).message)) {
        try {
          const open = await resolveOpenShift(session.cashierId);
          if (open) {
            setShift(open);
            setOpenSheet(false);
          }
        } catch {
          /* keep */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const doClose = async () => {
    if (!shift || !session || busy) return;
    if (!isOnline()) return needsInternet(t('Shift belum ditutup'));
    setBusy(true);
    try {
      // Everything of this shift still on the phone goes to the server first, so the close counts all of it.
      await loadQueue().catch(() => undefined);
      if (getQueueSnapshot().some((e) => e.shiftId === shift.id && e.status === 'waiting'))
        await syncCheckoutQueue({ cashierId: session.cashierId, outletId: session.outletId });
      const left = getQueueSnapshot().filter((e) => e.shiftId === shift.id);
      if (left.some((e) => e.status === 'conflict')) {
        setCloseSheet(false);
        void notify.warning(t('Ada entri yang ditolak server'), t('Tinjau entri yang ditolak dulu. Shift ditutup setelah semua entrinya beres.'));
        return;
      }
      if (left.length) return needsInternet(t('Shift belum ditutup'));
      const amount = Number(counted || 0);
      const closedAt = new Date().toISOString();
      const r = await closeShift({ shiftId: shift.id, physicalCash: amount, closedAt, qrisReported: askQris ? Number(qris || 0) : 0 });
      // A restart without internet must not bring the closed shift back from the device copy; the next shift starts
      // with a PIN checked by the server.
      await forgetOpenShift(session.cashierId);
      await forgetPin();
      const snapshot: Closed = {
        shiftNumber: shift.shiftNumber,
        expected: r.expected_cash,
        counted: amount,
        variance: r.variance,
        qrisReported: r.qris_reported,
        qrisVariance: r.qris_variance,
        sales: report?.totalRevenue ?? 0,
        bills: report?.totalTransactions ?? 0,
        closedAt,
        openedAt: shift.openedAt,
        shiftId: shift.id,
        report,
      };
      setCloseSheet(false);
      setCounted('');
      setQris('');
      setShift(null);
      clearCart();
      clearSplitBill();
      setActiveHeldBillId(null);
      setActiveHeldNumber(null);
      setClosed(snapshot);
      try {
        setToday(await fetchTodayShifts(session.cashierId));
      } catch {
        /* reloads later */
      }
    } catch (e) {
      if (isNetworkError(e)) needsInternet(t('Shift belum ditutup'));
      else void notify.fail(t('Shift belum ditutup'), e);
    } finally {
      setBusy(false);
    }
  };

  const print = async (closedInfo?: Closed) => {
    const r = closedInfo?.report ?? report;
    const shiftId = closedInfo?.shiftId ?? shift?.id;
    if (!r || !session || !shiftId) return;
    setPrinting(true);
    try {
      // Refunds are read now, so the paper matches the server even right after closing. Offline: the local copy of the
      // shift (055).
      const refunds = await fetchShiftRefunds(shiftId).catch(async (e) => {
        const local = isNetworkError(e) ? await readShift(shiftId).catch(() => null) : null;
        if (!local) throw e;
        return local.refunds;
      });
      const text = reportText({
        shiftNumber: closedInfo?.shiftNumber ?? shift?.shiftNumber ?? 0,
        cashierName: session.cashierName,
        outletName: session.outletName,
        openedAt: closedInfo?.openedAt ?? shift?.openedAt ?? new Date().toISOString(),
        closedAt: closedInfo?.closedAt ?? null,
        report: closedInfo ? { ...r, expectedCash: closedInfo.expected, actualCash: closedInfo.counted, variance: closedInfo.variance } : r,
        refunds,
      });
      const results = await printerService.printReportText(text);
      reportPrintResult(notify, results, {
        missingTitle: t('Printer laporan belum diatur'),
        missingMessage: t('Belum ada printer dengan peran Laporan.'),
        successTitle: t('Laporan dicetak'),
      });
    } catch (e) {
      void notify.fail(t('Cetak gagal'), e);
    } finally {
      setPrinting(false);
    }
  };

  const blockers: Array<{ text: string; action?: { label: string; onPress: () => void } }> = [];
  if (shift) {
    if (held > 0)
      blockers.push({ text: t('{n} bill masih ditahan. Bayar atau hapus dulu.', { n: held }), action: { label: t('Lihat'), onPress: onOpenBills } });
    if (rejected > 0) blockers.push({ text: t('{n} entri ditolak server', { n: rejected }), action: { label: t('Tinjau'), onPress: onQueue } });
    if (otherDevice) blockers.push({ text: t('Shift ini dibuka di HP lain.'), action: { label: t('Pindahkan ke HP ini'), onPress: () => setTakeOver(true) } });
  }
  const canClose = !!shift && blockers.length === 0;
  const avg = report && report.totalTransactions ? Math.round(report.totalRevenue / report.totalTransactions) : 0;
  const top = (dash?.top ?? []).slice(0, 5);
  const topMax = Math.max(1, ...top.map((x) => x.subtotal));

  // The drawer, from the server's cash ledger. The ledger books the opening cash as money in, so cash sales are what came
  // in besides it; opening + cash sales - cash out = what should be in the drawer (the server's expected cash).
  const openingCash = shift?.openingCash ?? 0;
  const cashSales = cash ? Math.max(0, cash.cashIn - openingCash) : (report?.cashRevenue ?? 0);
  const expectedCash = cash?.expectedCash ?? report?.expectedCash ?? 0;
  // Still on this phone (not in the ledger yet): cash sales in. Shown as an estimate.
  const pendingDrawer = pendingCash;
  const drawerRows = (
    <>
      <SlipRow left={t('Kas awal (modal)')} right={money(openingCash)} />
      <SlipRow left={t('Penjualan tunai')} right={money(cashSales)} />
      <SlipRow left={t('Kas keluar (refund)')} right={`-${money(cash?.cashOut ?? 0)}`} />
      <SlipBand tone="pineSoft" left={t('Total cash')} right={money(expectedCash)} />
      {pendingDrawer !== 0 ? (
        <>
          <SlipRow sub left={t('Belum terkirim (tunai)')} right={`${pendingDrawer > 0 ? '+' : '-'}${money(Math.abs(pendingDrawer))}`} />
          <SlipRow strong left={t('Perkiraan di laci sekarang')} right={money(expectedCash + pendingDrawer)} />
        </>
      ) : null}
    </>
  );

  const running = shift ? (
    <>
      {otherDevice ? (
        <Banner
          tone="error"
          title={t('Shift ini dibuka di HP lain.')}
          message={t('Jualan dan tutup shift hanya bisa di HP itu. Kalau HP itu hilang atau rusak, pemilik bisa memindahkan shift ini ke HP ini.')}
        >
          <ButtonRow>
            <Button size="sm" variant="danger" label={t('Pindahkan ke HP ini')} onPress={() => setTakeOver(true)} />
          </ButtonRow>
        </Banner>
      ) : null}
      {offline ? (
        <Banner
          tone="slip"
          title={t('Offline: angka terakhir yang dimuat')}
          message={t('Penjualan offline belum masuk ke angka ini. Tutup shift butuh internet.')}
        />
      ) : null}
      {pendingSales.length ? (
        // Sales still on this phone: a preview from the queue, the server's figures below take them in once sent.
        <Card className="bg-fireSoft">
          <Label>{t('Belum terkirim · {n} bill', { n: pendingSales.length })}</Label>
          <Mono className="font-mono-600 mt-1 text-[16px]">{money(pendingCash + pendingQris)}</Mono>
          <Text className="mt-1 text-[14px] text-mute">
            {t('Tunai {cash} · QRIS {qris}. Perkiraan dari HP ini; masuk ke laporan setelah terkirim.', { cash: money(pendingCash), qris: money(pendingQris) })}
          </Text>
        </Card>
      ) : null}
      <Card>
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Label>{t('Total omset · shift {n}', { n: shift.shiftNumber })}</Label>
          <Tag tone="pine" label={t('buka sejak {time}', { time: fmtTime(shift.openedAt) })} />
        </View>
        <Display size={52} className="mt-2" numberOfLines={1} adjustsFontSizeToFit>
          {money(report?.totalRevenue ?? 0)}
        </Display>
        <Dashed className="my-3" />
        <View className="flex-row gap-4">
          <View className="min-w-0 flex-1">
            <Mono className="text-[13px] text-mute">{t('Cash')}</Mono>
            <Mono className="font-mono-600 mt-0.5 text-[16px]" numberOfLines={1} adjustsFontSizeToFit>
              {money(report?.cashRevenue ?? 0)}
            </Mono>
          </View>
          <View className="min-w-0 flex-1">
            <Mono className="text-[13px] text-mute">{t('QRIS')}</Mono>
            <Mono className="font-mono-600 mt-0.5 text-[16px]" numberOfLines={1} adjustsFontSizeToFit>
              {money(report?.qrisRevenue ?? 0)}
            </Mono>
          </View>
        </View>
        <Dashed className="my-3" />
        <View className="flex-row">
          {[
            [t('Bill'), String(report?.totalTransactions ?? 0)],
            [t('Rata-rata'), money(avg)],
            [t('Void'), String(report?.voidedCount ?? 0)],
          ].map(([l, v]) => (
            <View key={l} className="min-w-0 flex-1 px-1">
              <Mono className="text-[13px] text-mute" numberOfLines={1}>
                {l}
              </Mono>
              <Mono className="font-mono-600 mt-0.5 text-[16px]" numberOfLines={1} adjustsFontSizeToFit>
                {v}
              </Mono>
            </View>
          ))}
        </View>
        {report?.refundCount ? (
          <View className="mt-3 flex-row items-center justify-between gap-3">
            <Mono className="text-[13px] text-mute">{t('Refund ({n})', { n: report.refundCount })}</Mono>
            <Mono className="font-mono-600 min-w-0 flex-1 text-right text-[16px] text-error" numberOfLines={1} adjustsFontSizeToFit>
              -{money(report.refundTotal)}
            </Mono>
          </View>
        ) : null}
      </Card>
      <ButtonRow>
        <Button label={printing ? t('Mencetak...') : t('Cetak laporan')} disabled={printing || !report} onPress={() => void print()} />
        <Button
          variant="fire"
          label={canClose ? t('Tutup shift') : t('Belum bisa ditutup')}
          disabled={!canClose}
          onPress={() => {
            setCounted('');
            setCloseSheet(true);
          }}
        />
      </ButtonRow>
      {blockers.length ? (
        <View className="rounded-k border-k border-ink bg-fireSoft px-3.5 py-3">
          <Text className="font-body-700 text-[15px]">{t('Shift belum bisa ditutup')}</Text>
          {blockers.map((b, i) => (
            <View key={i} className="mt-2 flex-row items-center gap-3">
              <Text className="min-w-0 flex-1 text-[14px]">{b.text}</Text>
              {b.action ? <Button size="sm" label={b.action.label} onPress={b.action.onPress} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </>
  ) : (
    <Card>
      <Tag label={t('belum ada shift')} />
      <Display size={30} className="mt-2">
        {t('Buka shift untuk mulai jualan.')}
      </Display>
      <Text className="mt-2 text-[15px] text-mute">{t('Hitung uang di laci lalu masukkan sebagai kas awal. Tanggal bisnis dikunci saat shift dibuka.')}</Text>
      <Button
        className="mt-4"
        size="lg"
        variant="fire"
        label={locked ? t('Terkunci: langganan berakhir') : t('Buka shift')}
        disabled={locked}
        onPress={() => {
          setOpening('');
          setOpenSheet(true);
        }}
      />
    </Card>
  );

  const details = shift ? (
    <>
      <Card>
        <View className="flex-row items-center justify-between">
          <Display size={22}>{t('Penjualan per jam')}</Display>
          <Mono className="text-[13px] text-mute">{t('ribu rupiah')}</Mono>
        </View>
        {dash ? (
          <HourBars hourly={dash.hourly} />
        ) : loading ? (
          <ActivityIndicator className="py-6" color={colors.ink} />
        ) : (
          <Text className="py-4 text-[14px] text-mute">{t('Belum bisa dimuat.')}</Text>
        )}
      </Card>
      <Slip>
        <View className="flex-row justify-between">
          <Mono className="font-mono-600 text-[14px]">{t('KAS LACI')}</Mono>
          <Mono className="text-[14px] text-mute">{t('Shift {n}', { n: shift.shiftNumber })}</Mono>
        </View>
        <SlipRule />
        {drawerRows}
        <SlipRow sub left={t('Dihitung server dari buku kas. Tidak ada input kas manual.')} />
      </Slip>
      <Card>
        <Display size={22}>{t('Menu terlaris shift ini')}</Display>
        {top.length ? (
          top.map((x, i) => (
            <View key={i} className={`py-2.5 ${i ? 'border-t border-rule' : ''}`}>
              <View className="flex-row justify-between gap-2">
                <Text numberOfLines={1} className="min-w-0 flex-1 font-body-600 text-[15px]">
                  {x.name}
                </Text>
                <Mono className="text-[14px]">
                  {x.qty} · {num(x.subtotal)}
                </Mono>
              </View>
              <View className="mt-1.5 h-[6px] bg-tint2">
                <View className="h-[6px] bg-pine" style={{ width: `${(x.subtotal / topMax) * 100}%` }} />
              </View>
            </View>
          ))
        ) : (
          <Text className="mt-2 text-[14px] text-mute">{t('Belum ada penjualan di shift ini.')}</Text>
        )}
      </Card>
    </>
  ) : null;

  const todayCard = (
    <Card>
      <Display size={22}>{t('Shift hari ini')}</Display>
      {today.length === 0 ? (
        <Text className="mt-2 text-[14px] text-mute">{t('Belum ada shift hari ini.')}</Text>
      ) : (
        today.map((s, i) => (
          <View key={s.id} className={`flex-row items-start justify-between gap-2 py-2.5 ${i ? 'border-t border-rule' : ''}`}>
            <View className="min-w-0 flex-1">
              <Text className="font-body-600 text-[15px]">
                {t('Shift {n}', { n: s.shiftNumber })} · {session?.cashierName}
              </Text>
              <Text className="mt-0.5 text-[13px] text-mute">
                {s.closedAt
                  ? t('{a} sampai {b}', { a: fmtTime(s.openedAt), b: fmtTime(s.closedAt) })
                  : t('Dibuka {time} · kas awal {amount}', { time: fmtTime(s.openedAt), amount: money(s.openingCash) })}
              </Text>
            </View>
            <Mono className="text-[13px]" style={{ color: (s.variance ?? 0) < 0 ? colors.error : colors.ink }}>
              {s.status === 'open' ? t('berjalan') : t('selisih {amount}', { amount: money(s.variance ?? 0) })}
            </Mono>
          </View>
        ))
      )}
      {today[0] ? <Mono className="mt-1 text-[13px] text-mute">{fmtBusinessDate(today[0].businessDate)}</Mono> : null}
      <Button className="mt-3" icon="chevron-right" label={t('Riwayat laporan shift')} onPress={onOpenHistory} />
    </Card>
  );

  return (
    <View className="flex-1 bg-paper">
      <Header title={t('Shift')} onQueue={onQueue} onBell={onBell} />
      <ScrollView contentContainerClassName="gap-3 px-3.5 pb-8 pt-3">
        {wide ? (
          <View className="flex-row gap-3">
            <View className="flex-1 gap-3">
              {running}
              {details ? details : todayCard}
            </View>
            {details ? <View className="flex-1 gap-3">{todayCard}</View> : null}
          </View>
        ) : (
          <>
            {running}
            {details}
            {todayCard}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={openSheet}
        onClose={() => {
          if (!busy) setOpenSheet(false);
        }}
        label={t('Buka shift')}
      >
        <SheetHeader title={t('Buka shift')} subtitle={t('Hitung uang di laci, lalu masukkan sebagai kas awal.')} onClose={() => setOpenSheet(false)} />
        <SheetBody>
          <MoneyPad label={t('Kas awal')} value={opening} onChange={setOpening} presets={[0, 100000, 200000, 300000]} />
        </SheetBody>
        <ActionFooter>
          <ButtonRow>
            <Button label={t('Batal')} disabled={busy} onPress={() => setOpenSheet(false)} />
            <Button variant="fire" label={busy ? t('Membuka...') : t('Buka shift')} loading={busy} disabled={opening === ''} onPress={() => void doOpen()} />
          </ButtonRow>
        </ActionFooter>
      </Sheet>

      <Sheet
        visible={closeSheet}
        onClose={() => {
          if (!busy) setCloseSheet(false);
        }}
        label={t('Tutup shift')}
      >
        <SheetHeader
          title={t('Tutup shift {n}', { n: shift?.shiftNumber ?? '' })}
          subtitle={t('Hitung semua uang di laci, lalu masukkan jumlahnya.')}
          onClose={() => setCloseSheet(false)}
        />
        <SheetBody contentClassName="gap-2.5">
          {/* The same drawer figures as on the Shift tab, so the cashier counts against them without leaving the sheet. */}
          <Slip torn={false}>{drawerRows}</Slip>
          <MoneyPad
            label={t('Uang di laci')}
            value={counted}
            onChange={setCounted}
            second={askQris ? { label: t('QRIS di aplikasi merchant'), value: qris, onChange: setQris } : undefined}
          />
          {askQris ? (
            <Text className="text-[13px] text-mute">{t('Buka aplikasi merchant QRIS, lihat total uang masuk selama shift ini, lalu ketik di kotak QRIS.')}</Text>
          ) : null}
          <Text className="text-[13px] text-mute">{t('Server menghitung selisih setelah shift ditutup. Perlu internet.')}</Text>
        </SheetBody>
        <ActionFooter>
          <ButtonRow>
            <Button label={t('Batal')} disabled={busy} onPress={() => setCloseSheet(false)} />
            <Button
              variant="fire"
              label={busy ? t('Menutup...') : t('Tutup shift')}
              loading={busy}
              disabled={counted === '' || (askQris && qris === '')}
              onPress={() => void doClose()}
            />
          </ButtonRow>
        </ActionFooter>
      </Sheet>

      <TakeOverSheet
        shift={takeOver ? shift : null}
        onClose={() => setTakeOver(false)}
        onDone={(s) => {
          setShift(s);
          setTakeOver(false);
        }}
      />

      <Sheet visible={!!closed} onClose={() => setClosed(null)} label={t('Hasil tutup shift')}>
        {closed ? (
          <>
            <SheetHeader
              title={
                closed.variance === 0
                  ? t('Kas sesuai.')
                  : closed.variance < 0
                    ? t('Kas kurang {amount}.', { amount: money(-closed.variance) })
                    : t('Kas lebih {amount}.', { amount: money(closed.variance) })
              }
              subtitle={closed.variance === 0 ? t('Uang di laci sama dengan hitungan server.') : t('Laci berbeda dengan hitungan server.')}
            />
            <SheetBody>
              <Slip>
                <SlipRow strong left={t('SHIFT {n} DITUTUP', { n: closed.shiftNumber })} right={fmtTime(closed.closedAt)} />
                <SlipRule />
                <SlipRow left={t('Kas seharusnya')} right={money(closed.expected)} />
                <SlipRow left={t('Hitungan kasir')} right={money(closed.counted)} />
                <SlipBand tone={closed.variance === 0 ? 'pineSoft' : 'error'} left={t('Selisih')} right={money(closed.variance)} />
                <SlipRow left={t('Total omset')} right={money(closed.sales)} />
                <SlipRow left={t('Cash')} right={money(closed.report?.cashRevenue ?? 0)} />
                <SlipRow left={t('QRIS')} right={money(closed.report?.qrisRevenue ?? 0)} />
                <SlipRow left={t('Bill')} right={String(closed.bills)} />
                {closed.qrisVariance !== null && closed.qrisReported !== null ? (
                  <>
                    <SlipRule />
                    <SlipRow left={t('QRIS di aplikasi merchant')} right={money(closed.qrisReported)} />
                    <SlipBand tone={closed.qrisVariance === 0 ? 'pineSoft' : 'error'} left={t('Selisih QRIS')} right={money(closed.qrisVariance)} />
                  </>
                ) : null}
              </Slip>
              {closed.variance ? (
                <Text className="mt-3 text-[14px] text-mute">
                  {t('Hitung ulang laci dan periksa bill tunai shift ini. Selisih tercatat di laporan shift dan terlihat oleh pemilik di backoffice.')}
                </Text>
              ) : null}
              {closed.qrisVariance ? (
                <Text className="mt-3 text-[14px] text-mute">
                  {t('Cocokkan riwayat di aplikasi merchant dengan bill QRIS shift ini. Selisih QRIS terlihat oleh pemilik di backoffice.')}
                </Text>
              ) : null}
            </SheetBody>
            <ActionFooter>
              <ButtonRow>
                <Button
                  label={printing ? t('Mencetak...') : t('Cetak laporan')}
                  disabled={printing || !closed.report || closed.variance === null}
                  onPress={() => void print(closed)}
                />
                <Button variant="pine" label={t('Selesai|tombol')} onPress={() => setClosed(null)} />
              </ButtonRow>
            </ActionFooter>
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

/**
 * Move a shift opened on another phone to this one (migration 051), for a lost or broken phone. Needs the owner's
 * approval code and internet. Entries the old phone still has in its queue are refused afterwards.
 */
function TakeOverSheet({ shift, onClose, onDone }: { shift: Shift | null; onClose: () => void; onDone: (s: Shift) => void }) {
  useT();
  const notify = useNotify();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCode('');
    setError('');
  }, [shift?.id]);

  const submit = async () => {
    if (!shift || saving) return;
    if (!/^\d{6}$/.test(code)) return setError(t('Kode persetujuan 6 digit angka.'));
    setSaving(true);
    try {
      const r = await takeOverShift(shift.id, code);
      if (!r.ok) {
        haptic.error();
        setCode('');
        setError(
          r.reason === 'wrong'
            ? t('Kode salah. Sisa percobaan: {n}.', { n: r.attemptsLeft })
            : r.reason === 'locked'
              ? t('Terlalu banyak kode salah. Coba lagi dalam 5 menit.')
              : t('Pemilik belum membuat kode persetujuan. Kode dibuat di backoffice, Pengaturan, tab Bisnis dan struk.'),
        );
        return;
      }
      haptic.heavy();
      notify.success(t('Shift dipindahkan ke HP ini'), t('Shift {n} sekarang dipakai di HP ini.', { n: shift.shiftNumber }));
      onDone({ ...shift, deviceId: await deviceId() });
    } catch (err) {
      setError(isNetworkError(err) ? t('Memindahkan shift perlu internet. Sambungkan internet lalu coba lagi.') : describeError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={!!shift}
      onClose={() => {
        if (!saving) onClose();
      }}
      label={t('Pindahkan shift ke HP ini')}
    >
      <SheetHeader title={t('Pindahkan shift ke HP ini')} subtitle={shift ? t('Shift {n}', { n: shift.shiftNumber }) : undefined} onClose={onClose} />
      <SheetBody contentClassName="gap-3.5">
        <Text className="text-[15px] leading-[22px] text-mute">
          {t(
            'Pakai ini hanya kalau HP yang membuka shift hilang atau rusak. Penjualan yang masih tersimpan di HP itu akan ditolak server setelah shift dipindahkan.',
          )}
        </Text>
        <TextField
          label={t('Kode persetujuan pemilik')}
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/\D/g, '').slice(0, 6));
            setError('');
          }}
          placeholder={t('6 digit')}
          keyboardType="number-pad"
          secureTextEntry
          mono
          maxLength={6}
          error={error || undefined}
          help={t('Minta pemilik mengetik kodenya di perangkat ini. Kode diatur di backoffice.')}
        />
      </SheetBody>
      <ActionFooter>
        <ButtonRow>
          <Button label={t('Batal')} disabled={saving} onPress={onClose} />
          <Button variant="danger-solid" label={saving ? t('Memproses...') : t('Pindahkan')} loading={saving} onPress={() => void submit()} />
        </ButtonRow>
      </ActionFooter>
    </Sheet>
  );
}

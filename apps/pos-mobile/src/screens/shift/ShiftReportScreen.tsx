import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, ScrollView, Share, View } from 'react-native';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Card, Dashed, Label, Tag } from '../../components/bits';
import { Slip, SlipBand, SlipRow, SlipRule } from '../../components/Slip';
import { Header } from '../../components/chrome';
import { useShellStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { SalesReport } from '../../services/report/report';
import { readShift, ShiftData, syncShift } from '../../services/local/shiftData';
import { printerService } from '../../services/printer/service';
import { Expense, Refund, ShiftRecord } from '../../types/domain';
import { reportPrintResult } from '../../utils/printFeedback';
import { reportText, ShiftReportData, waText } from '../../utils/shiftReport';
import { colors } from '../../theme';
import { fmtBusinessDate, fmtTime, money, num, t, useT } from '../../i18n';

type Bundle = { report: SalesReport; refunds: Refund[]; expense: Expense | null };

/** Shows `ShiftReportData` on screen: sales, payment methods, refunds with reasons, expenses, and cash. */
export function ShiftReportBody({ d }: { d: ShiftReportData }) {
  useT();
  const r = d.report;
  const items = d.expense?.items ?? [];
  return (
    <>
      <Card>
        <Label>{t('Total omset')}</Label>
        <Display size={44} className="mt-1" numberOfLines={1} adjustsFontSizeToFit>
          {money(r.totalRevenue)}
        </Display>
        <Dashed className="my-3" />
        <View className="flex-row flex-wrap gap-4">
          {[
            [t('Cash'), money(r.cashRevenue)],
            [t('QRIS'), money(r.qrisRevenue)],
            [t('Bill'), String(r.totalTransactions)],
          ].map(([l, v]) => (
            <View key={l} className="min-w-[30%] flex-1">
              <Mono className="text-small text-mute">{l}</Mono>
              <Mono className="font-mono-600 mt-0.5 text-body" numberOfLines={1} adjustsFontSizeToFit>
                {v}
              </Mono>
            </View>
          ))}
        </View>
        {r.discountTotal > 0 || r.voidedCount > 0 ? (
          <Text className="mt-3 text-small text-mute">
            {[
              r.discountTotal > 0 ? t('Diskon {amount}', { amount: money(r.discountTotal) }) : null,
              r.voidedCount > 0 ? t('Void {n} bill, {amount}', { n: r.voidedCount, amount: money(r.voidedTotal) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
      </Card>

      <Slip torn={false}>
        <SlipRow strong left={t('MENU TERJUAL ({n} item)', { n: String(r.totalItems).replace('.', ',') })} right={money(r.grossSales)} />
        <SlipRule />
        {r.categories.length ? (
          r.categories.map((c) => (
            <View key={c.categoryId} className="mb-1.5">
              <SlipRow strong left={c.name} right={num(c.total)} />
              {c.products.map((p) => (
                <SlipRow key={p.productId} left={`   ${String(p.qty).replace('.', ',')}× ${p.name}`} right={num(p.total)} />
              ))}
            </View>
          ))
        ) : (
          <SlipRow sub left={t('Belum ada menu terjual.')} />
        )}
        {r.discountTotal > 0 ? <SlipRow left={t('Diskon dan voucher')} right={`-${num(r.discountTotal)}`} tone="pine" /> : null}
      </Slip>

      <Slip torn={false}>
        <SlipRow strong left={t('REFUND ({n})', { n: d.refunds.length })} right={d.refunds.length ? `-${money(r.refundTotal)}` : ''} />
        {r.refundCash > 0 ? <SlipRow sub left={`   ${t('Refund tunai')}`} right={`-${num(r.refundCash)}`} /> : null}
        {r.refundQris > 0 ? <SlipRow sub left={`   ${t('Refund QRIS')}`} right={`-${num(r.refundQris)}`} /> : null}
        <SlipRule />
        {d.refunds.length ? (
          d.refunds.map((x) => (
            <View key={x.id} className="mb-1.5">
              <SlipRow
                left={`${fmtTime(x.createdAt)} ${x.number} · ${x.method === 'qris' ? t('QRIS') : t('Tunai')}`}
                right={`-${num(x.amount)}`}
                tone="error"
              />
              {x.items.map((i, k) => (
                <SlipRow
                  key={k}
                  sub
                  left={`   ${String(i.quantity).replace('.', ',')}× ${i.productName}`}
                  right={i.amount != null ? `-${num(i.amount)}` : undefined}
                />
              ))}
              <SlipRow sub left={`   ${t('Alasan: {reason}', { reason: x.reason })}`} />
            </View>
          ))
        ) : (
          <SlipRow sub left={t('Tidak ada refund.')} />
        )}
      </Slip>

      <Slip torn={false}>
        <SlipRow strong left={t('PENGELUARAN')} right={items.length ? money(d.expense?.total ?? 0) : ''} />
        <SlipRule />
        {items.length ? (
          items.map((i, k) => (
            <View key={k}>
              <SlipRow left={i.name} right={num(i.amount)} />
              <SlipRow
                sub
                left={`   ${String(i.quantity).replace('.', ',')} ${i.unit} · ${i.category === 'operasional' ? t('Operasional') : t('Belanja')} · ${
                  i.paidFrom === 'drawer' ? t('kas laci') : t('bukan dari laci')
                }`}
              />
            </View>
          ))
        ) : (
          <SlipRow sub left={t('Tidak ada pengeluaran.')} />
        )}
      </Slip>

      <Slip>
        <SlipRow strong left={t('KAS LACI')} right="" />
        <SlipRule />
        <SlipRow left={t('Kas awal')} right={money(r.pettyCash)} />
        <SlipBand tone="pineSoft" left={t('Kas seharusnya')} right={money(r.expectedCash)} />
        {r.actualCash != null ? (
          <>
            <SlipRow left={t('Hitungan kasir')} right={money(r.actualCash)} />
            <SlipRow strong left={t('Selisih')} right={money(r.variance ?? 0)} tone={(r.variance ?? 0) === 0 ? undefined : 'error'} />
          </>
        ) : null}
      </Slip>
    </>
  );
}

/** One shift's report (open or closed): from the local database, synced with the server, printed again, or sent to WhatsApp. */
export function ShiftReportScreen({ shift, onBack, onQueue, onBell }: { shift: ShiftRecord; onBack: () => void; onQueue: () => void; onBell: () => void }) {
  useT();
  const notify = useNotify();
  const { session } = useShellStore();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<'print' | 'wa' | null>(null);
  const req = useRef(0);

  // The shift from the local database (055): shown at once, then synced in one request (nothing downloaded when it did
  // not change). Never shown as zero: offline the last copy stays with a note, or the error shows (PRD B, rules).
  const load = useCallback(async () => {
    if (!session) return;
    const id = ++req.current;
    setError(false);
    const show = (s: ShiftData) => setData({ report: s.report, refunds: s.refunds, expense: s.expenses[0] ?? null });
    const local = await readShift(shift.id).catch(() => null);
    if (id !== req.current) return;
    if (local) show(local);
    const synced = await syncShift(shift.id, session.outletId).then(
      () => true,
      () => false,
    );
    const fresh = synced ? await readShift(shift.id).catch(() => null) : null;
    if (id !== req.current) return;
    if (fresh) show(fresh);
    setStale(!fresh && !!local);
    setError(!fresh && !local);
  }, [shift.id, session?.outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const d: ShiftReportData | null = data
    ? {
        shiftNumber: shift.shiftNumber,
        cashierName: shift.cashierName,
        outletName: session?.outletName ?? '',
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        ...data,
      }
    : null;

  const print = async () => {
    if (!d) return;
    setBusy('print');
    try {
      const results = await printerService.printReportText(reportText(d));
      reportPrintResult(notify, results, {
        missingTitle: t('Printer laporan belum diatur'),
        missingMessage: t('Belum ada printer dengan peran Laporan.'),
        successTitle: t('Laporan dicetak'),
      });
    } catch (e) {
      void notify.fail(t('Cetak gagal'), e);
    } finally {
      setBusy(null);
    }
  };

  const sendWa = async () => {
    if (!d) return;
    const text = waText(d);
    setBusy('wa');
    try {
      await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(text)}`);
    } catch {
      const share = await notify.confirm({
        title: t('WhatsApp belum terpasang'),
        message: t('WhatsApp tidak terpasang. Bagikan lewat aplikasi lain.'),
        confirmLabel: t('Bagikan'),
      });
      if (share) await Share.share({ message: text }).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="flex-1 bg-paper">
      <Header title={t('Laporan shift {n}', { n: shift.shiftNumber })} onBack={onBack} onQueue={onQueue} onBell={onBell} />
      <ScrollView contentContainerClassName="gap-3 px-3.5 pb-8 pt-3">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="min-w-0 flex-1 font-body-600 text-body">
            {fmtBusinessDate(shift.businessDate)} · {shift.cashierName}
          </Text>
          <Tag
            tone={shift.status === 'open' ? 'pine' : 'neutral'}
            label={
              shift.closedAt
                ? t('{a} sampai {b}', { a: fmtTime(shift.openedAt), b: fmtTime(shift.closedAt) })
                : t('buka sejak {time}', { time: fmtTime(shift.openedAt) })
            }
          />
        </View>
        {stale ? (
          <View className="flex-row items-center gap-3 rounded-k border-k border-ink bg-fireSoft px-3.5 py-3">
            <Text className="min-w-0 flex-1 text-small">{t('Belum tersambung. Ini laporan yang terakhir tersimpan di perangkat.')}</Text>
            <Button size="sm" label={t('Coba lagi')} onPress={() => void load()} />
          </View>
        ) : null}
        {d ? (
          <ShiftReportBody d={d} />
        ) : error ? (
          <Card>
            <Text className="font-body-700 text-body">{t('Laporan shift belum dimuat')}</Text>
            <Text className="mt-1 text-small text-mute">{t('Periksa internet, lalu coba lagi.')}</Text>
            <Button className="mt-3" label={t('Coba lagi')} onPress={() => void load()} />
          </Card>
        ) : (
          <View className="items-center py-10" accessibilityLabel={t('Memuat data...')}>
            <ActivityIndicator color={colors.ink} />
          </View>
        )}
        {d ? (
          <ButtonRow>
            <Button
              label={busy === 'print' ? t('Mencetak...') : t('Cetak laporan')}
              loading={busy === 'print'}
              disabled={!!busy}
              onPress={() => void print()}
            />
            <Button variant="pine" label={t('Kirim ke WA')} disabled={!!busy} onPress={() => void sendWa()} />
          </ButtonRow>
        ) : null}
      </ScrollView>
    </View>
  );
}

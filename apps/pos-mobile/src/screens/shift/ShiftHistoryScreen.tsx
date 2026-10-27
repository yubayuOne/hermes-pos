import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';
import { Tap } from '../../components/Tap';
import { Mono, Text } from '../../components/Text';
import { Button } from '../../components/Button';
import { Card, Chip, Tag } from '../../components/bits';
import { Header } from '../../components/chrome';
import { useShellStore } from '../../hooks/AppStore';
import { getCache, setCache } from '../../services/cache/cache';
import { fetchOutletShifts } from '../../services/transaction/repository';
import { ShiftRecord } from '../../types/domain';
import { ShiftReportScreen } from './ShiftReportScreen';
import { colors } from '../../theme';
import { fmtBusinessDate, fmtTime, money, t, useT } from '../../i18n';

const PAGE = 30;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000; // the first page stays readable offline for 30 days
type Period = 7 | 30 | 0; // 0 = all
const PERIODS: Period[] = [7, 30, 0];

function ShiftRow({ s, onPress }: { s: ShiftRecord; onPress: () => void }) {
  const hours = s.closedAt ? t('{a} sampai {b}', { a: fmtTime(s.openedAt), b: fmtTime(s.closedAt) }) : t('buka sejak {time}', { time: fmtTime(s.openedAt) });
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={`${fmtBusinessDate(s.businessDate)}, ${t('Shift {n}', { n: s.shiftNumber })}, ${s.cashierName}, ${money(s.sales)}`}
      onPress={onPress}
      className="mx-3.5 mb-2.5 min-h-[76px] justify-center gap-1 rounded-k px-3.5 py-2.5"
      style={({ pressed }) => ({ borderWidth: 1.5, borderColor: colors.ink, backgroundColor: pressed ? colors.tint : colors.slip })}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 font-body-600 text-body" numberOfLines={1}>
          {t('Shift {n}', { n: s.shiftNumber })} · {s.cashierName}
        </Text>
        <Mono className="font-mono-600 text-body">{money(s.sales)}</Mono>
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 text-small text-mute" numberOfLines={1}>
          {hours}
        </Text>
        <Tag tone={s.status === 'open' ? 'pine' : 'neutral'} label={s.status === 'open' ? t('berjalan') : t('ditutup')} />
      </View>
    </Tap>
  );
}

/** Rows come newest first, so each business date is one run; the header sums the shifts shown. */
function byDay(rows: ShiftRecord[]) {
  const out: Array<{ title: string; total: number; data: ShiftRecord[] }> = [];
  for (const s of rows) {
    const last = out[out.length - 1];
    if (last?.title === s.businessDate) {
      last.data.push(s);
      last.total += s.sales;
    } else out.push({ title: s.businessDate, total: s.sales, data: [s] });
  }
  return out;
}

/**
 * Riwayat laporan shift (also the shift list): every shift of the outlet, open and closed, newest first, grouped by
 * business date, with hours, cashier, and net sales. Tap one for its report. 30 per page while scrolling; the first page
 * of "Semua" is kept on the device for offline reading.
 */
export function ShiftHistoryScreen({ onBack, onQueue, onBell }: { onBack: () => void; onQueue: () => void; onBell: () => void }) {
  useT();
  const { session } = useShellStore();
  const [period, setPeriod] = useState<Period>(0);
  const [rows, setRows] = useState<ShiftRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<ShiftRecord | null>(null);
  const key = `shift-history:${session?.outletId}`;

  const load = useCallback(
    async (before: string | null) => {
      if (!session) return;
      try {
        const from = period ? new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString() : null;
        const page = await fetchOutletShifts(session.cashierId, session.outletId, before, PAGE, from);
        setRows((r) => (before ? [...(r ?? []), ...page] : page));
        setHasMore(page.length === PAGE);
        setError(false);
        if (!before && !period) void setCache(key, page).catch(() => undefined);
      } catch {
        setError(true);
      }
    },
    [session?.cashierId, session?.outletId, key, period], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    setRows(null);
    setHasMore(false);
    if (!period)
      void getCache<ShiftRecord[]>(key, KEEP_MS)
        .then((c) => {
          if (c) setRows((r) => r ?? c);
        })
        .catch(() => undefined);
    void load(null);
  }, [key, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setRefreshing(true);
    await load(null);
    setRefreshing(false);
  };
  const next = async () => {
    const last = rows?.[rows.length - 1];
    if (!last || !hasMore || more) return;
    setMore(true);
    await load(last.openedAt);
    setMore(false);
  };

  if (open) return <ShiftReportScreen shift={open} onBack={() => setOpen(null)} onQueue={onQueue} onBell={onBell} />;

  const periods = (
    <View className="flex-row gap-2 px-3.5 pb-1 pt-3" accessibilityLabel={t('Periode')}>
      {PERIODS.map((p) => (
        <Chip key={p} grow label={p ? t('{n} hari', { n: p }) : t('Semua')} selected={period === p} onPress={() => setPeriod(p)} />
      ))}
    </View>
  );

  return (
    <View className="flex-1 bg-paper">
      <Header title={t('Riwayat shift')} onBack={onBack} onQueue={onQueue} onBell={onBell} />
      {periods}
      {rows === null ? (
        error ? (
          <View className="px-3.5 pt-3">
            <Card>
              <Text className="font-body-700 text-body">{t('Riwayat shift belum dimuat')}</Text>
              <Text className="mt-1 text-small text-mute">{t('Periksa internet, lalu coba lagi.')}</Text>
              <Button className="mt-3" label={t('Coba lagi')} onPress={() => void load(null)} />
            </Card>
          </View>
        ) : (
          <View className="items-center py-10" accessibilityLabel={t('Memuat data...')}>
            <ActivityIndicator color={colors.ink} />
          </View>
        )
      ) : (
        <SectionList
          sections={byDay(rows)}
          keyExtractor={(s) => s.id}
          stickySectionHeadersEnabled
          contentContainerClassName="pb-8"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          onEndReached={() => void next()}
          onEndReachedThreshold={0.4}
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-baseline justify-between gap-3 bg-paper px-3.5 pb-2 pt-3" accessibilityRole="header">
              <Text className="font-body-700 text-body">{fmtBusinessDate(section.title)}</Text>
              <Mono className="text-small text-mute">{money(section.total)}</Mono>
            </View>
          )}
          ListHeaderComponent={
            error ? (
              <View className="mx-3.5 mt-2 flex-row items-center gap-3 rounded-k border-k border-ink bg-fireSoft px-3.5 py-3">
                <Text className="min-w-0 flex-1 text-small">{t('Belum tersambung. Ini daftar yang terakhir tersimpan di perangkat.')}</Text>
                <Button size="sm" label={t('Coba lagi')} onPress={() => void refresh()} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Card className="mx-3.5 mt-2">
              <Text className="font-body-700 text-body">{period ? t('Tidak ada shift di periode ini.') : t('Belum ada shift.')}</Text>
            </Card>
          }
          ListFooterComponent={
            more ? (
              <ActivityIndicator className="py-4" color={colors.ink} />
            ) : rows.length && !hasMore ? (
              <Mono className="py-3 text-center text-small text-mute">{t('Sudah semua · {n} shift', { n: rows.length })}</Mono>
            ) : null
          }
          renderItem={({ item }) => <ShiftRow s={item} onPress={() => setOpen(item)} />}
        />
      )}
    </View>
  );
}

import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  BarChart,
  Card,
  CardTitle,
  Empty,
  Hl,
  ListBar,
  Loading,
  SkCard,
  addDays,
  amount,
  btn,
  compactMillions,
  dayDiff,
  isoDay,
  money,
  useI18n,
  weekday,
} from '@hermes-pos/ui';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { OutletFilter } from '../../components/OutletFilter';
import { Stat } from '../../components/Stat';
import { Page } from '../../components/Page';
import { useApp } from '../../lib/app';
import type { SalesSummary } from '../../lib/types';
import { getSummary } from '../../server/summary';
import { pageHead } from '../../lang';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';

type Search = PeriodSearch & { outlet?: string };

export const Route = createFileRoute('/_app/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    const data = await getSummary({ data: { from: range.from, to: range.to, outletId: deps.outlet ?? null, today, tz } });
    return { period: data.period, week: data.week, todayData: data.today, lastVariance: data.lastVariance, range, today };
  },
  pendingMs: 150,
  pendingComponent: SummaryLoading,
  head: ({ match }) => pageHead(match.context.lang, 'Ringkasan|menu'),
  component: Summary,
});

function SummaryLoading() {
  const { t } = useI18n();
  return (
    <Page title={t('Ringkasan')}>
      <Loading className="grid gap-5">
        <div className="grid items-start gap-5 xl:grid-cols-[7fr_5fr]">
          <SkCard />
          <SkCard />
        </div>
        <div className="grid items-start gap-5 xl:grid-cols-[7fr_5fr]">
          <SkCard bars />
          <SkCard bars />
        </div>
      </Loading>
    </Page>
  );
}

function Summary() {
  const { t } = useI18n();
  const app = useApp();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }) });
  const periodLabel = usePeriodLabel(search, data.range);
  const outletName = search.outlet ? (app.outlets.find((o) => o.id === search.outlet)?.name ?? '') : t('semua outlet');
  const p = data.period;
  const nothingYet = p.count === 0 && data.week.sales === 0 && data.week.count === 0;
  // The database compares with the same number of days just before the period.
  const days = dayDiff(data.range.from, data.range.to) + 1;
  const diff = p.sales - p.previousSales;
  const vars = { diff: money(Math.abs(diff)), n: days, amount: money(p.previousSales) };
  const versusText =
    days === 1
      ? diff > 0
        ? t('Naik {diff} dari hari sebelumnya ({amount}).', vars)
        : diff < 0
          ? t('Turun {diff} dari hari sebelumnya ({amount}).', vars)
          : t('Sama dengan hari sebelumnya ({amount}).', vars)
      : diff > 0
        ? t('Naik {diff} dari {n} hari sebelumnya ({amount}).', vars)
        : diff < 0
          ? t('Turun {diff} dari {n} hari sebelumnya ({amount}).', vars)
          : t('Sama dengan {n} hari sebelumnya ({amount}).', vars);

  return (
    <Page title={t('Ringkasan')} tools={<OutletFilter value={search.outlet ?? null} onChange={(id) => set({ outlet: id ?? undefined })} />}>
      <PeriodFilter value={search} range={data.range} today={data.today} onChange={set}>
        <p className="w-full pt-1 text-[14px] text-mute sm:ml-2 sm:w-auto sm:pt-0">{t('Grafik selalu 7 hari terakhir dan jam hari ini.')}</p>
        {/* The full report (A4, print or PDF) for the same period and outlet as this page. */}
        <Link to="/reports" search={search} className={`${btn('plain')} w-full sm:ml-auto sm:w-auto`}>
          {t('Laporan')}
        </Link>
      </PeriodFilter>
      {nothingYet ? (
        <Empty
          className="mt-5"
          title={t('Belum ada penjualan.')}
          action={
            <>
              <Link to="/products" className={btn('fire')}>
                {t('Buat produk')}
              </Link>
              <Link to="/cashiers" className={btn('plain')}>
                {t('Buat kasir')}
              </Link>
            </>
          }
        >
          {t('Siapkan menu dan kasir, lalu buka shift di aplikasi kasir.')}
        </Empty>
      ) : (
        <>
          <div className="mt-5 grid gap-5 xl:grid-cols-[7fr_5fr]">
            <Card className="animate-rise" aria-label={t('Total omset')}>
              <p className="font-mono text-[14px] text-mute">
                {t('Total omset, bersih setelah refund')} · {periodLabel} · {outletName}
              </p>
              <p className="big-num mt-4 break-words">
                <Hl>{money(p.sales)}</Hl>
              </p>
              <p className="mt-3 text-[14px] text-mute">{versusText}</p>
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t-[1.5px] border-ink pt-5">
                <Stat label={t('Omset tunai')} value={money(p.cash)} />
                <Stat label={t('Omset QRIS')} value={money(p.qris)} />
                <Stat label={t('Jumlah bill')} value={String(p.count)} />
                <Stat label={t('Rata-rata per bill')} value={money(p.count ? p.sales / p.count : 0)} />
                <Stat label={t('Item terjual')} value={amount(p.totalItems)} />
                <Stat label={t('Diskon diberikan')} value={money(p.discountTotal)} />
                <Stat label="Void" value={`${p.voidedCount} · ${money(p.voidedTotal)}`} />
                <Stat label="Refund" value={`${p.refundCount} · ${money(p.refundTotal)}`} />
              </dl>
            </Card>
            <Card className="animate-rise [animation-delay:60ms]" aria-label={t('Omset setelah pengeluaran')}>
              <p className="font-mono text-[14px] text-mute">{t('Omset setelah pengeluaran')}</p>
              <p className="mt-3 font-display text-[clamp(38px,4vw,52px)] font-extrabold leading-none tracking-[-0.035em] text-pine">
                {money(p.salesAfterExpenses)}
              </p>
              <p className="mt-2 text-[14px] text-mute">{t('Semua pengeluaran dikurangkan, dari kas laci maupun dari luar laci.')}</p>
              <dl className="mt-5 grid grid-cols-2 gap-6 border-t border-dashed border-ink pt-5">
                <Stat label={t('Pengeluaran')} value={money(p.expenses.total)} />
                <Stat label={t('Dari kas laci')} value={money(p.expenses.drawer)} />
                <Stat label={t('Dari luar laci')} value={money(p.expenses.other)} />
                <Stat label={t('Laba kotor')} value={money(p.profit)} />
                <Stat label={t('Selisih kas terakhir')} value={data.lastVariance ? money(data.lastVariance.amount) : '-'} />
              </dl>
            </Card>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-[7fr_5fr]">
            <DailyChart week={data.week} today={data.today} />
            <HourlyChart today={data.todayData} />
          </div>
          {/* Two even columns per row; the tall top-products list is matched by the two short cards stacked beside it. */}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <ListCard
              ranked
              title={t('Produk terlaris')}
              empty={t('Belum ada produk terjual di periode ini.')}
              rows={p.top.slice(0, 6).map((x) => ({ key: x.name, name: x.name, value: x.subtotal, sub: t('{n} terjual', { n: x.qty }) }))}
            />
            <div className="grid gap-5 lg:grid-rows-2">
              <ListCard
                title={t('Cara bayar')}
                empty={t('Belum ada penjualan di periode ini.')}
                rows={[
                  { key: 'cash', name: t('Tunai'), value: p.cash },
                  { key: 'qris', name: 'QRIS', value: p.qris },
                ].filter((r) => r.value !== 0)}
              />
              <ListCard
                title={t('Pengeluaran per kategori')}
                empty={t('Belum ada pengeluaran di periode ini.')}
                rows={[
                  { key: 'operasional', name: t('Operasional'), value: p.expenses.operasional },
                  { key: 'belanja', name: t('Belanja'), value: p.expenses.belanja },
                ].filter((r) => r.value > 0)}
              />
            </div>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {!search.outlet && (
              <ListCard
                title={t('Per outlet')}
                empty={t('Belum ada penjualan di periode ini.')}
                rows={p.byOutlet.map((o) => ({ key: o.outletId, name: o.name, value: o.sales, sub: t('{n} bill', { n: o.count }) }))}
              />
            )}
            <ListCard
              className={search.outlet ? 'lg:col-span-2' : undefined}
              title={t('Per kasir')}
              empty={t('Belum ada penjualan di periode ini.')}
              rows={p.byCashier.map((c) => ({ key: c.cashierId, name: c.name, value: c.sales, sub: t('{n} bill', { n: c.count }) }))}
            />
          </div>
        </>
      )}
    </Page>
  );
}

function DailyChart({ week, today }: { week: SalesSummary; today: string }) {
  const { t, lang } = useI18n();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const values = days.map((d) => week.daily.find((x) => x.date.slice(0, 10) === d)?.total ?? 0);
  return (
    <Card className="animate-rise">
      <CardTitle sub={t('7 hari terakhir, dalam juta rupiah. Batang oranye adalah hari ini.')}>{t('Penjualan per hari')}</CardTitle>
      <div className="mt-6">
        <BarChart
          values={values}
          labels={days.map((d) => weekday(d, lang))}
          accent={6}
          valueLabel={(v) => compactMillions(v, lang)}
          ariaLabel={t('Penjualan per hari, 7 hari terakhir')}
          caption={days.map((d, i) => `${weekday(d, lang)} ${money(values[i])}`).join(', ')}
        />
      </div>
    </Card>
  );
}

/** 12 hours around the busiest window of today; 08 to 19 when there are no sales yet. */
function HourlyChart({ today }: { today: SalesSummary }) {
  const { t } = useI18n();
  const totals = Array.from({ length: 24 }, (_, h) => today.hourly.find((x) => Number(x.hour) === h)?.total ?? 0);
  let start = 8;
  if (totals.some((v) => v > 0)) {
    let best = -1;
    for (let s = 0; s <= 12; s++) {
      const sum = totals.slice(s, s + 12).reduce((a, b) => a + b, 0);
      if (sum > best) {
        best = sum;
        start = s;
      }
    }
  }
  const hours = Array.from({ length: 12 }, (_, i) => start + i);
  const values = hours.map((h) => totals[h]);
  const peak = values.some((v) => v > 0) ? values.indexOf(Math.max(...values)) : -1;
  return (
    <Card className="animate-rise [animation-delay:60ms]">
      <CardTitle sub={t('Hari ini, dalam ribu rupiah. Batang oranye adalah jam tersibuk.')}>{t('Penjualan per jam')}</CardTitle>
      <div className="mt-6">
        <BarChart
          values={values}
          labels={hours.map((h) => String(h).padStart(2, '0'))}
          accent={peak}
          valueLabel={(v) => String(Math.round(v / 1000))}
          ariaLabel={t('Penjualan per jam hari ini')}
          caption={hours.map((h, i) => `${String(h).padStart(2, '0')}.00 ${money(values[i])}`).join(', ')}
        />
      </div>
    </Card>
  );
}

function ListCard({
  title,
  rows,
  empty,
  ranked,
  className,
}: {
  title: string;
  rows: { key: string; name: string; value: number; sub?: string }[];
  empty: string;
  ranked?: boolean;
  className?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return (
    <Card className={`animate-rise flex flex-col ${className ?? ''}`}>
      <CardTitle className="border-b border-rule pb-3">{title}</CardTitle>
      {sorted.length === 0 ? (
        // Centered in whatever height the row gives the card, so a stretched empty card does not look unfinished.
        <p className="flex flex-1 items-center justify-center py-6 text-center text-mute">{empty}</p>
      ) : (
        <ul className="mt-1">
          {sorted.map((r, i) => (
            <ListBar
              key={r.key}
              rank={ranked ? i + 1 : undefined}
              name={r.name}
              value={money(r.value)}
              sub={r.sub}
              ratio={r.value / max}
              top={i === 0}
              delay={i * 60}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

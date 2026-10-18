import { Link, createFileRoute } from '@tanstack/react-router';
import { Button, Empty, Loading, SkCard, addDays, btn, dateRange, dayDiff, isoDay, useI18n } from '@hermes-pos/ui';
import { Page } from '../../components/Page';
import { ReportDocument } from '../../components/ReportDocument';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';
import { getReport } from '../../server/report';
import { pageHead } from '../../lang';

type Search = PeriodSearch & { outlet?: string };

/**
 * The report as A4 sheets (DESIGN.md F, PRD F6), opened from the "Laporan" button on Ringkasan for its period and outlet
 * (owner's request, 17 Oct 2026: no menu entry of its own). "Cetak / simpan PDF" prints the same sheets.
 */
export const Route = createFileRoute('/_app/reports')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const p = parsePeriod(s);
    // Older links carried only the dates: read them as a chosen range.
    return { ...p, period: p.period ?? (p.from && p.to ? 'custom' : undefined), outlet: typeof s.outlet === 'string' ? s.outlet : undefined };
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    // Same periods as Ringkasan; nothing chosen means today.
    const range = periodRange(deps, isoDay(new Date(), tz));
    const data = await getReport({ data: { from: range.from, to: range.to, outletId: deps.outlet ?? null, tz } });
    return { data, range };
  },
  pendingMs: 150,
  pendingComponent: ReportsLoading,
  head: ({ match }) => pageHead(match.context.lang, 'Laporan|menu'),
  component: Reports,
});

function ReportsLoading() {
  const { t } = useI18n();
  return (
    <Page title={t('Laporan')}>
      <Loading className="grid gap-5">
        <SkCard />
        <SkCard bars />
        <SkCard />
      </Loading>
    </Page>
  );
}

/** Week for 7 days, month for a whole calendar month, otherwise a free period. */
function kindOf(from: string, to: string): 'week' | 'month' | 'period' {
  if (dayDiff(from, to) === 6) return 'week';
  const monthEnd = addDays(`${addDays(`${from.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1);
  return from.endsWith('-01') && to.slice(0, 7) === from.slice(0, 7) && to <= monthEnd ? 'month' : 'period';
}

function Reports() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const { data, range } = Route.useLoaderData();
  const r = data.report;
  const empty = r.pnl.count === 0 && r.pnl.refunds === 0 && r.shifts.length === 0 && r.expenses.total === 0;

  return (
    <Page title={t('Laporan')}>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link to="/" search={search} className={btn('plain')}>
          {t('Kembali ke Ringkasan')}
        </Link>
        <p className="text-[14px] text-mute">{dateRange(range.from, range.to, lang)}</p>
        {!empty && (
          <Button variant="ink" className="sm:ml-auto" onClick={() => window.print()}>
            {t('Cetak / simpan PDF')}
          </Button>
        )}
      </div>
      {!empty && (
        <p className="mt-3 text-[14px] text-mute print:hidden">
          {t('Di jendela cetak, pilih "Simpan sebagai PDF". Teks dan angka di PDF tetap bisa dipilih dan dicari.')}
        </p>
      )}

      {empty ? (
        <Empty className="mt-5" title={t('Belum ada data di periode ini.')}>
          {t('Laporan berisi penjualan, shift, dan pengeluaran yang dicatat kasir di aplikasi. Pilih periode lain atau outlet lain.')}
        </Empty>
      ) : (
        <div className="-mx-4 mt-6 overflow-x-hidden bg-tint-2 px-3 py-6 sm:mx-0 sm:rounded sm:px-6 sm:py-8 print:m-0 print:bg-transparent print:p-0">
          <ReportDocument data={data} range={range} kind={kindOf(range.from, range.to)} outletId={search.outlet ?? null} />
        </div>
      )}
    </Page>
  );
}

import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isoDay } from '@hermes-pos/ui';
import { Card, Empty, FormAlert, Loading, SkCard, Tag, dateLong, money, useI18n } from '@hermes-pos/ui';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { Pagination } from '../../components/Pagination';
import { Stat } from '../../components/Stat';
import type { Expense, ExpenseItem } from '../../lib/types';
import { describeError } from '../../lib/errors';
import { listExpenses } from '../../server/expenses';
import { pageHead } from '../../lang';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';

type Search = PeriodSearch & { outlet?: string };

export const Route = createFileRoute('/_app/expenses')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    const list = await listExpenses({ data: { outletId: deps.outlet ?? null, ...range, tz, before: null } });
    return { ...list, range, today, tz };
  },
  pendingMs: 150,
  pendingComponent: ExpensesLoading,
  head: ({ match }) => pageHead(match.context.lang, 'Pengeluaran|menu'),
  component: Expenses,
});

const CATEGORY: Record<ExpenseItem['category'], string> = { operasional: 'Operasional', belanja: 'Belanja' };
const PAID_FROM: Record<ExpenseItem['paidFrom'], string> = { drawer: 'Kas laci', other: 'Bukan dari laci' };
const qty = (n: number) => String(n).replace('.', ',');
/** Shift records per page, as the server sends them (server/expenses.ts). */
const EXPENSE_PAGE = 50;

function ExpensesLoading() {
  const { t } = useI18n();
  return (
    <Page title={t('Pengeluaran')}>
      <Loading className="grid gap-5">
        <SkCard />
        <SkCard />
      </Loading>
    </Page>
  );
}

/**
 * D9: cashiers record expenses in the POS (migrations 040, 041). They count at once (043); the owner can correct any
 * shift's items here, and the shift's cash is recomputed in the database.
 */
function Expenses() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/expenses' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }) });
  const periodLabel = usePeriodLabel(search, data.range);
  // Pages of 50 shift records (server cursor: createdAt of the last row). Pages already seen are kept, so Sebelumnya
  // needs no request; a new filter or a saved edit starts again at page 1.
  const [pages, setPages] = useState<Expense[][]>([data.rows]);
  const [at, setAt] = useState(0);
  useEffect(() => {
    setPages([data.rows]);
    setAt(0);
  }, [data]);
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const rows = pages[at] ?? [];
  const pageCount = Math.max(1, Math.ceil(data.total / EXPENSE_PAGE));
  const goTo = async (page: number) => {
    const i = page - 1;
    if (pages[i]) return setAt(i);
    setMore({ busy: true, error: null });
    try {
      const last = pages[pages.length - 1];
      const next = await listExpenses({
        data: { outletId: search.outlet ?? null, ...data.range, tz: data.tz, before: last[last.length - 1]?.createdAt ?? null },
      });
      setPages((p) => [...p, next.rows]);
      setAt(i);
      setMore({ busy: false, error: null });
    } catch (err) {
      setMore({ busy: false, error: describeError(err) });
    }
  };

  // Rows come newest first, so each business date is one run.
  const byDay = rows.reduce<[string, Expense[]][]>((acc, e) => {
    const last = acc[acc.length - 1];
    if (last?.[0] === e.businessDate) last[1].push(e);
    else acc.push([e.businessDate, [e]]);
    return acc;
  }, []);

  return (
    <Page title={t('Pengeluaran')} tools={<OutletFilter value={search.outlet ?? null} onChange={(id) => set({ outlet: id ?? undefined })} />}>
      <p className="max-w-[46em] text-mute">
        {t(
          'Kasir mencatat belanja dan biaya operasional di aplikasi; semua catatan satu shift jadi satu daftar. Nominal yang salah dikoreksi di menu Balancing.',
        )}
      </p>
      <div className="mt-5">
        <PeriodFilter value={search} range={data.range} today={data.today} onChange={set} />
      </div>

      <Card className="mt-5" aria-label={t('Total pengeluaran')}>
        <p className="font-mono text-[14px] text-mute">{t('Total pengeluaran · {period}', { period: periodLabel })}</p>
        <p className="big-num mt-3 break-words">{money(data.totals.total)}</p>
        <dl className="mt-5 grid grid-cols-2 gap-6 border-t-[1.5px] border-ink pt-4">
          <Stat label={t('Operasional')} value={money(data.totals.operasional)} />
          <Stat label={t('Belanja')} value={money(data.totals.belanja)} />
        </dl>
        {data.totals.adjustments !== 0 && (
          <p className="mt-4 text-[14px] text-mute">{t('Termasuk penyesuaian dari Balancing: {amount}', { amount: money(data.totals.adjustments) })}</p>
        )}
      </Card>

      {data.rows.length === 0 ? (
        <Empty className="mt-5" title={t('Belum ada pengeluaran di periode ini.')}>
          {t('Pengeluaran yang dicatat kasir di aplikasi (menu Shift, Catat pengeluaran) muncul di sini per shift.')}
        </Empty>
      ) : (
        <div className="mt-6 grid gap-8">
          {byDay.map(([day, list]) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-[1.5px] border-ink pb-2">
                <span className="font-display text-[22px] font-extrabold tracking-[-0.02em]">{dateLong(`${day}T12:00:00Z`, lang, 'UTC')}</span>
                <span className="font-mono text-[15px]">{money(data.dayTotals[day] ?? 0)}</span>
              </h2>
              <div className="mt-4 grid gap-5">
                {list.map((e) => (
                  <ExpenseCard key={e.id} expense={e} />
                ))}
              </div>
            </section>
          ))}
          <div className="grid justify-items-center gap-3">
            <p className="font-mono text-[14px] text-mute">{t('{total} catatan shift di periode ini', { total: data.total })}</p>
            <Pagination page={at + 1} pages={pageCount} busy={more.busy} onPage={(p) => void goTo(p)} />
            <FormAlert>{more.error && t(more.error)}</FormAlert>
          </div>
        </div>
      )}
    </Page>
  );
}

function ExpenseCard({ expense: e }: { expense: Expense }) {
  const { t } = useI18n();
  return (
    <Card as="article" aria-label={t('Pengeluaran shift {n}, {amount}', { n: e.shiftNumber, amount: money(e.total) })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[14px] text-mute">
            {t('Shift {n}', { n: e.shiftNumber })} · {e.outletName}
            {e.cashierName ? ` · ${e.cashierName}` : ''}
          </p>
          <p className="mt-1 font-display text-[28px] font-extrabold leading-none tracking-[-0.03em]">{money(e.total)}</p>
          {e.drawerTotal > 0 && <p className="mt-1.5 text-[15px] text-mute">{t('{amount} dari kas laci', { amount: money(e.drawerTotal) })}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{e.shiftOpen && <Tag tone="fire">{t('shift masih buka')}</Tag>}</div>
      </div>
      <div className="tbl-wrap mt-4">
        <table className="tbl tbl-card">
          <thead>
            <tr>
              <th scope="col">{t('Barang atau biaya')}</th>
              <th scope="col">{t('Kategori')}</th>
              <th scope="col">{t('Uang dari')}</th>
              <th scope="col" className="num">
                {t('Jumlah|barang')}
              </th>
              <th scope="col" className="num">
                {t('Harga total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {e.items.map((i, k) => (
              <tr key={k}>
                <td data-l={t('Barang atau biaya')}>{i.name}</td>
                <td data-l={t('Kategori')}>{t(CATEGORY[i.category])}</td>
                <td data-l={t('Uang dari')}>{t(PAID_FROM[i.paidFrom])}</td>
                <td data-l={t('Jumlah|barang')} className="num">
                  {qty(i.quantity)} {i.unit}
                </td>
                <td data-l={t('Harga total')} className="num">
                  {money(i.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {e.shiftOpen && <p className="mt-4 text-[15px] text-mute">{t('Kasir masih bisa menambah barang selama shift buka.')}</p>}
    </Card>
  );
}

import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Empty, dateShort, isoDay, money, useI18n } from '@hermes-pos/ui';
import { FilterBar, OutletField, SearchBox } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination } from '../../components/Pagination';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { useApp } from '../../lib/app';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';
import { CUSTOMER_PAGE, listCustomers } from '../../server/customers';
import { pageHead } from '../../lang';

type Search = PeriodSearch & { outlet?: string; q?: string; page?: number };

export const Route = createFileRoute('/_app/customers')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    q: typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 40) : undefined,
    page: Number.isInteger(s.page) && (s.page as number) > 1 ? (s.page as number) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    const list = await listCustomers({ data: { outletId: deps.outlet ?? null, ...range, tz, q: deps.q ?? '', page: deps.page ?? 1 } });
    return { list, range, today };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Pelanggan|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Pelanggan|menu'),
  component: Customers,
});

/** Customers by the name typed on paid bills (081), biggest spender first. */
function Customers() {
  const { t, lang } = useI18n();
  const app = useApp();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/customers' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [q, setQ] = useState(search.q ?? '');
  const tz = app.business.timezone;
  const outletName = app.outlets.find((o) => o.id === search.outlet)?.name ?? t('Semua outlet');
  const pages = Math.max(1, Math.ceil(data.list.total / CUSTOMER_PAGE));
  return (
    <Page title={t('Pelanggan|menu')}>
      <FilterBar
        search={
          <SearchBox
            label={t('Cari pelanggan')}
            placeholder={t('Cari nama')}
            value={q}
            onChange={setQ}
            onSubmit={() => (q.trim() || undefined) !== search.q && set({ q: q.trim() || undefined, page: undefined })}
          />
        }
        active={(search.outlet ? 1 : 0) + (search.period ? 1 : 0)}
        summary={[outletName, usePeriodLabel(search, data.range), t('{n} pelanggan', { n: data.list.total })].join(' · ')}
        onReset={() => set({ outlet: undefined, period: undefined, from: undefined, to: undefined, page: undefined })}
      >
        <OutletField all value={search.outlet ?? null} onChange={(id) => set({ outlet: id ?? undefined, page: undefined })} />
        <PeriodFilter value={search} range={data.range} today={data.today} onChange={(patch) => set({ ...patch, page: undefined })} />
      </FilterBar>
      {data.list.rows.length === 0 ? (
        <Empty className="mt-6" title={search.q ? t('Tidak ada pelanggan yang cocok.') : t('Belum ada pelanggan di periode ini.')}>
          {t('Nama yang diisi kasir di bill muncul di sini.')}
        </Empty>
      ) : (
        <div className="tbl-wrap mt-5">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Nama')}</th>
                <th scope="col" className="num">
                  {t('Bill')}
                </th>
                <th scope="col" className="num">
                  {t('Total belanja')}
                </th>
                <th scope="col">{t('Terakhir belanja')}</th>
              </tr>
            </thead>
            <tbody>
              {data.list.rows.map((c) => (
                <tr key={c.name.toLowerCase()}>
                  <td data-l={t('Nama')} className="font-semibold">
                    {c.name}
                  </td>
                  <td data-l={t('Bill')} className="num">
                    {c.bills}
                  </td>
                  <td data-l={t('Total belanja')} className="num">
                    {money(c.total)}
                  </td>
                  <td data-l={t('Terakhir belanja')} className="font-mono text-small">
                    {dateShort(c.lastAt, lang, tz)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={search.page ?? 1} pages={pages} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
    </Page>
  );
}

import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Card, Chip, Dialog, Empty, Field, FormAlert, Input, Select, Tag, amount, dateShort, isoDay, money, time, useI18n } from '@hermes-pos/ui';
import { OutletField } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination } from '../../components/Pagination';
import { PeriodFilter } from '../../components/PeriodFilter';
import { useApp, useLock } from '../../lib/app';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';
import { stockDocumentSchema } from '../../lib/schemas';
import type { StockDocument, StockItem } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { listStock, listStockDocuments, saveStockDocument } from '../../server/stock';
import { pageHead } from '../../lang';

type Search = PeriodSearch & { outlet?: string; tab?: 'history'; page?: number };
type Kind = 'stock_in' | 'adjustment' | 'opname';
/** Documents per page, as the server sends them (owner_list_stock_documents). */
const PAGE = 50;

export const Route = createFileRoute('/_app/stock')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    tab: s.tab === 'history' ? 'history' : undefined,
    page: Number.isInteger(s.page) && (s.page as number) > 1 ? (s.page as number) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    if (!outletId) return { outletId, today, range, items: [] as StockItem[], docs: null };
    if (deps.tab === 'history') {
      return { outletId, today, range, items: [] as StockItem[], docs: await listStockDocuments({ data: { outletId, ...range, tz, page: deps.page ?? 1 } }) };
    }
    return { outletId, today, range, items: await listStock({ data: { outletId } }), docs: null };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Stok|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Stok|menu'),
  component: Stock,
});

/**
 * D15. Stock of tracked products changes only by sales, voids, refunds, and the documents made here (074): stock in,
 * adjustment (damaged, lost, used, found), and count. Every document stays in the history.
 */
function Stock() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const lock = useLock();
  const navigate = useNavigate({ from: '/stock' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [kind, setKind] = useState<Kind | null>(null);
  return (
    <Page title={t('Stok|menu')}>
      <nav aria-label={t('Bagian stok')} className="flex flex-wrap gap-2">
        <Chip aria-current={search.tab ? undefined : 'page'} onClick={() => set({ tab: undefined, page: undefined })}>
          {t('Stok sekarang')}
        </Chip>
        <Chip aria-current={search.tab === 'history' ? 'page' : undefined} onClick={() => set({ tab: 'history', page: undefined })}>
          {t('Riwayat')}
        </Chip>
      </nav>
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1 sm:max-w-[280px]">
          <OutletField all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, page: undefined })} />
        </div>
        {search.tab === 'history' && (
          <PeriodFilter value={search} range={data.range} today={data.today} onChange={(patch) => set({ ...patch, page: undefined })} />
        )}
      </div>

      {search.tab === 'history' ? (
        <History docs={data.docs?.rows ?? []} total={data.docs?.total ?? 0} set={set} />
      ) : data.items.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada produk yang stoknya dilacak.')}>
          {t('Aktifkan Lacak stok di menu Produk.')}
        </Empty>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="fire" onClick={() => setKind('stock_in')} {...lock.props}>
              {lock.label(t('Stok masuk'))}
            </Button>
            <Button onClick={() => setKind('adjustment')} {...lock.props}>
              {lock.label(t('Penyesuaian'))}
            </Button>
            <Button onClick={() => setKind('opname')} {...lock.props}>
              {lock.label(t('Hitung stok'))}
            </Button>
          </div>
          <StockTable items={data.items} />
        </>
      )}
      {kind && data.outletId && <DocumentDialog outletId={data.outletId} kind={kind} items={data.items} onClose={() => setKind(null)} />}
    </Page>
  );
}

function StockTable({ items }: { items: StockItem[] }) {
  const { t, lang } = useI18n();
  const tz = useApp().business.timezone;
  return (
    <div className="tbl-wrap mt-5">
      <table className="tbl tbl-card">
        <thead>
          <tr>
            <th scope="col">{t('Produk')}</th>
            <th scope="col" className="num">
              {t('Stok')}
            </th>
            <th scope="col" className="num">
              {t('Nilai (HPP)')}
            </th>
            <th scope="col">{t('Hitung terakhir')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.productId}>
              <td data-l={t('Produk')}>
                <span className="font-semibold">{p.name}</span>
                <span className="block text-[14px] text-mute">
                  {p.category || t('Tanpa kategori')}
                  {!p.isActive && ` · ${t('nonaktif')}`}
                </span>
              </td>
              <td data-l={t('Stok')} className="num">
                {amount(p.stock)}
              </td>
              <td data-l={t('Nilai (HPP)')} className="num">
                {money(p.value)}
              </td>
              <td data-l={t('Hitung terakhir')} className="text-[15px]">
                {p.lastCount ? dateShort(p.lastCount, lang, tz) : <span className="text-mute">{t('belum pernah')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const KIND_LABEL: Record<StockDocument['kind'], string> = {
  opening: 'Saldo awal',
  initial: 'Mulai dilacak',
  tracking_off: 'Berhenti dilacak',
  stock_in: 'Stok masuk',
  adjustment: 'Penyesuaian',
  opname: 'Hitung stok',
};

function History({ docs, total, set }: { docs: StockDocument[]; total: number; set: (p: Partial<Search>) => void }) {
  const { t, lang } = useI18n();
  const tz = useApp().business.timezone;
  const search = Route.useSearch();
  if (docs.length === 0)
    return (
      <Empty className="mt-6" title={t('Belum ada dokumen stok di periode ini.')}>
        {t('Stok masuk, penyesuaian, dan hitung stok muncul di sini.')}
      </Empty>
    );
  return (
    <>
      <div className="mt-5 grid gap-4">
        {docs.map((d) => (
          <Card key={d.id} as="article">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold">{t(KIND_LABEL[d.kind])}</p>
              <span className="font-mono text-[14px] text-mute">
                {dateShort(d.createdAt, lang, tz)} {time(d.createdAt, tz)}
              </span>
            </div>
            {d.reason && <p className="text-[15px] text-mute">{d.reason}</p>}
            <ul className="mt-3 grid gap-1 border-t border-rule pt-3 text-[15px]">
              {d.lines.map((l) => (
                <li key={l.productId} className="flex flex-wrap justify-between gap-x-4">
                  <span>{l.productName}</span>
                  <span className="font-mono">
                    {d.kind === 'opname' && l.counted !== null
                      ? t('dihitung {count}, sistem {book}, selisih {diff}', { count: amount(l.counted), book: amount(l.bookQty ?? 0), diff: signed(l.qty) })
                      : signed(l.qty)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <Pagination page={search.page ?? 1} pages={Math.max(1, Math.ceil(total / PAGE))} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
    </>
  );
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${amount(Math.abs(n))}`;

const KIND_TEXT: Record<Kind, { title: string; help: string; input: string; save: string }> = {
  stock_in: {
    title: 'Stok masuk',
    help: 'Barang yang diterima: kiriman pemasok atau hasil produksi. Isi jumlah yang masuk.',
    input: 'Masuk',
    save: 'Simpan stok masuk',
  },
  adjustment: {
    title: 'Penyesuaian stok',
    help: 'Barang rusak, hilang, kedaluwarsa, atau dipakai sendiri (kurangi), atau ditemukan (tambah). Nilainya dicatat sebagai biaya.',
    input: 'Jumlah',
    save: 'Simpan penyesuaian',
  },
  opname: {
    title: 'Hitung stok',
    help: 'Hitung barang di rak lalu isi jumlahnya. Selisih dengan stok sistem dicatat otomatis. Kosongkan produk yang tidak dihitung.',
    input: 'Hasil hitung',
    save: 'Simpan hasil hitung',
  },
};

/** One document for many products: only the rows with a number are saved. */
function DocumentDialog({ outletId, kind, items, onClose }: { outletId: string; kind: Kind; items: StockItem[]; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const text = KIND_TEXT[kind];
  const shown = useMemo(() => items.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lines = Object.entries(values)
      .filter(([, v]) => v.trim() !== '')
      .map(([productId, v]) => ({ productId, qty: (kind === 'adjustment' && direction === 'out' ? -1 : 1) * Number(v.replace(',', '.')) }));
    const check = stockDocumentSchema.safeParse({ outletId, kind, reason, lines });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => saveStockDocument({ data: check.data }), {
      success: t('{title} disimpan untuk {n} produk.', { title: t(text.title), n: lines.length }),
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t(text.title)}
      description={t(text.help)}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="stock-doc" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t(text.save)}
          </Button>
        </>
      }
    >
      <form id="stock-doc" noValidate onSubmit={save} className="grid gap-4">
        {kind === 'adjustment' && (
          <Field label={t('Arah')}>
            <Select value={direction} onChange={(e) => setDirection(e.target.value === 'in' ? 'in' : 'out')}>
              <option value="out">{t('Kurangi stok (rusak, hilang, dipakai)')}</option>
              <option value="in">{t('Tambah stok (ditemukan)')}</option>
            </Select>
          </Field>
        )}
        <Input type="search" aria-label={t('Cari produk')} placeholder={t('Cari nama produk')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grid max-h-[46vh] gap-2 overflow-y-auto pr-1">
          {shown.map((p) => (
            <label key={p.productId} className="flex items-center gap-3 rounded border border-rule bg-slip px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block font-mono text-[13px] text-mute">{t('Stok sistem {n}', { n: amount(p.stock) })}</span>
              </span>
              <Input
                aria-label={`${t(text.input)} ${p.name}`}
                inputMode="decimal"
                className="w-[110px] text-right font-mono"
                value={values[p.productId] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [p.productId]: e.target.value.replace(/[^\d.,]/g, '').slice(0, 10) }))}
              />
            </label>
          ))}
        </div>
        <Field label={kind === 'adjustment' ? t('Alasan') : t('Keterangan')} optional={kind !== 'adjustment'}>
          <Input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {kind === 'opname' && <Tag className="justify-self-start">{t('Produk yang dikosongkan tidak diubah.')}</Tag>}
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

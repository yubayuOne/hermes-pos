import { useEffect, useMemo, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Card, Chip, Dialog, Empty, Field, FormAlert, Input, Select, Tag, amount, dateShort, isoDay, money, time, useI18n } from '@hermes-pos/ui';
import { FilterBar } from '../../components/Filters';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination } from '../../components/Pagination';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { describeError } from '../../lib/errors';
import { useApp, useLock } from '../../lib/app';
import { type PeriodSearch, parsePeriod, periodError, periodRange } from '../../lib/period';
import { stockDocumentSchema, stockSheetSchema } from '../../lib/schemas';
import { sheetAmount, sheetVariance } from '../../lib/stockSheet';
import type { StockDocument, StockItem } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { listStock, listStockDocuments, listStockOpenings, saveStockDocument, saveStockSheet } from '../../server/stock';
import { pageHead } from '../../lang';

type Search = PeriodSearch & { outlet?: string; tab?: 'history'; page?: number };
type Kind = 'stock_in' | 'adjustment';
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
  pendingComponent: () => <PageLoading title="Stok produk|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Stok produk|menu'),
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
  const app = useApp();
  const lock = useLock();
  const navigate = useNavigate({ from: '/stock' });
  const periodLabel = usePeriodLabel(search, data.range);
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [kind, setKind] = useState<Kind | null>(null);
  const [counting, setCounting] = useState(false);
  return (
    <Page title={t('Stok produk|menu')}>
      <nav aria-label={t('Bagian stok')} className="flex flex-wrap gap-2">
        <Chip aria-current={search.tab ? undefined : 'page'} onClick={() => set({ tab: undefined, page: undefined })}>
          {t('Stok sekarang')}
        </Chip>
        <Chip aria-current={search.tab === 'history' ? 'page' : undefined} onClick={() => set({ tab: 'history', page: undefined })}>
          {t('Riwayat')}
        </Chip>
      </nav>
      <div className="mt-5">
        <FilterBar
          outlet={<OutletFilter all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, page: undefined })} />}
          active={search.tab === 'history' && search.period ? 1 : 0}
          summary={[app.outlets.find((o) => o.id === data.outletId)?.name, search.tab === 'history' ? periodLabel : undefined].filter(Boolean).join(' · ')}
          current={search}
          validate={(v) => periodError(v, data.today)}
          onApply={(c) => set({ ...c, page: undefined })}
        >
          {search.tab === 'history' ? (d) => <PeriodFilter value={d.values} range={data.range} today={data.today} onChange={d.set} /> : undefined}
        </FilterBar>
      </div>

      {search.tab === 'history' ? (
        <History docs={data.docs?.rows ?? []} total={data.docs?.total ?? 0} set={set} />
      ) : data.items.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada produk yang stoknya dilacak.')}>
          <Link to="/products" className="btn btn-ink btn-sm">
            {t('Buka Produk')}
          </Link>
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
            <Button onClick={() => setCounting(true)} {...lock.props}>
              {lock.label(t('Hitung stok'))}
            </Button>
          </div>
          <StockTable items={data.items} />
        </>
      )}
      {kind && data.outletId && <DocumentDialog outletId={data.outletId} kind={kind} items={data.items} onClose={() => setKind(null)} />}
      {counting && data.outletId && <CountSheet outletId={data.outletId} items={data.items} today={data.today} onClose={() => setCounting(false)} />}
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
              {t('Modal (HPP)')}
            </th>
            <th scope="col">{t('Hitung terakhir')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.productId}>
              <td data-l={t('Produk')}>
                <span className="font-semibold">{p.name}</span>
                <span className="block text-small text-mute">
                  {p.category || t('Tanpa kategori')}
                  {!p.isActive && ` · ${t('nonaktif')}`}
                </span>
              </td>
              <td data-l={t('Stok')} className="num">
                {amount(p.stock)}
              </td>
              <td data-l={t('Modal (HPP)')} className="num">
                {money(p.value)}
              </td>
              <td data-l={t('Hitung terakhir')} className="text-body">
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
              <span className="font-mono text-small text-mute">
                {dateShort(d.createdAt, lang, tz)} {time(d.createdAt, tz)}
              </span>
            </div>
            {d.reason && <p className="text-body text-mute">{d.reason}</p>}
            <ul className="mt-3 grid gap-1 border-t border-rule pt-3 text-body">
              {d.lines.map((l) => (
                <li key={l.productId} className="flex flex-wrap justify-between gap-x-4">
                  <span>{l.productName}</span>
                  <span className="font-mono">
                    {d.kind === 'opname' && l.counted !== null
                      ? t('dihitung {count}, sistem {book}, selisih {diff}', { count: amount(l.counted), book: amount(l.bookQty ?? 0), diff: signed(l.variance ?? 0) })
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

/** Count sheet (096): Awal, Masuk, Keluar, Akhir, and Selisih per product, for any day up to today. */
type SheetRow = { opening: string; received: string; issued: string; counted: string; note: string };
const BLANK_ROW: SheetRow = { opening: '', received: '', issued: '', counted: '', note: '' };
const sheetInput = (v: string) => v.replace(/[^\d.,]/g, '').slice(0, 10);

function CountSheet({ outletId, items, today, onClose }: { outletId: string; items: StockItem[]; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [date, setDate] = useState(today);
  /** Opening per product for the chosen day; null in the map = never counted, the admin types it. */
  const [openings, setOpenings] = useState<Record<string, number | null> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, SheetRow>>({});
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);

  useEffect(() => {
    let alive = true;
    setOpenings(null);
    setRows({});
    setLoadError(null);
    listStockOpenings({ data: { outletId, date } })
      .then((list) => alive && setOpenings(Object.fromEntries(list.map((o) => [o.productId, o.opening]))))
      .catch((e) => alive && setLoadError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [outletId, date]);

  const known = (id: string) => openings?.[id] ?? null;
  const setCell = (id: string, field: keyof SheetRow, value: string) =>
    setRows((r) => ({ ...r, [id]: { ...BLANK_ROW, ...r[id], [field]: value } }));
  /** Selisih as the server computes it; null while a number is missing. */
  const varianceOf = (id: string) => {
    const r = rows[id] ?? BLANK_ROW;
    const counted = sheetAmount(r.counted);
    const opening = known(id) ?? sheetAmount(r.opening);
    if (counted === null || opening === null || Number.isNaN(counted) || Number.isNaN(opening)) return null;
    return sheetVariance({ opening, received: sheetAmount(r.received) ?? 0, issued: sheetAmount(r.issued) ?? 0, counted });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lines = items.flatMap((p) => {
      const r = rows[p.productId];
      if (!r || Object.values(r).every((v) => v.trim() === '')) return [];
      return [
        {
          productId: p.productId,
          opening: known(p.productId) === null ? sheetAmount(r.opening) : null,
          received: sheetAmount(r.received),
          issued: sheetAmount(r.issued),
          counted: sheetAmount(r.counted),
          note: r.note.trim(),
        },
      ];
    });
    const check = stockSheetSchema.safeParse({ outletId, date, lines });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => saveStockSheet({ data: check.data }), {
      success: t('Hitung stok disimpan untuk {n} produk.', { n: lines.length }),
    });
    if (res) onClose();
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Hitung stok')}
      description={t('Isi hasil hitung di rak. Selisih dihitung otomatis. Kosongkan produk yang tidak dihitung.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="count-sheet" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')} disabled={openings === null}>
            {t('Simpan hitung stok')}
          </Button>
        </>
      }
    >
      <form id="count-sheet" noValidate onSubmit={save} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <Field label={t('Tanggal hitung')}>
            <Input type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Input type="search" aria-label={t('Cari produk')} placeholder={t('Cari nama produk')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {date < today && <Tag className="justify-self-start">{t('Hitung untuk hari lalu dicatat di akhir hari itu.')}</Tag>}
        {loadError && <FormAlert>{loadError}</FormAlert>}
        <div className="tbl-wrap max-h-[46vh] overflow-y-auto">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Produk')}</th>
                <th scope="col" className="num">{t('Awal')}</th>
                <th scope="col" className="num">{t('Stok masuk')}</th>
                <th scope="col" className="num">{t('Stok keluar')}</th>
                <th scope="col" className="num">{t('Akhir')}</th>
                <th scope="col" className="num">{t('Selisih')}</th>
                <th scope="col">{t('Catatan selisih')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const r = rows[p.productId] ?? BLANK_ROW;
                const k = known(p.productId);
                const v = varianceOf(p.productId);
                return (
                  <tr key={p.productId}>
                    <td data-l={t('Produk')} className="font-semibold">{p.name}</td>
                    <td data-l={t('Awal')} className="num">
                      {openings === null ? (
                        <span className="text-mute">{t('Memuat...')}</span>
                      ) : k !== null ? (
                        amount(k)
                      ) : (
                        <Input aria-label={`${t('Awal')} ${p.name}`} inputMode="decimal" className="w-[96px] text-right font-mono" value={r.opening} onChange={(e) => setCell(p.productId, 'opening', sheetInput(e.target.value))} />
                      )}
                    </td>
                    <td data-l={t('Stok masuk')} className="num">
                      <Input aria-label={`${t('Stok masuk')} ${p.name}`} inputMode="decimal" className="w-[96px] text-right font-mono" value={r.received} onChange={(e) => setCell(p.productId, 'received', sheetInput(e.target.value))} />
                    </td>
                    <td data-l={t('Stok keluar')} className="num">
                      <Input aria-label={`${t('Stok keluar')} ${p.name}`} inputMode="decimal" className="w-[96px] text-right font-mono" value={r.issued} onChange={(e) => setCell(p.productId, 'issued', sheetInput(e.target.value))} />
                    </td>
                    <td data-l={t('Akhir')} className="num">
                      <Input aria-label={`${t('Akhir')} ${p.name}`} inputMode="decimal" className="w-[96px] text-right font-mono" value={r.counted} onChange={(e) => setCell(p.productId, 'counted', sheetInput(e.target.value))} />
                    </td>
                    <td data-l={t('Selisih')} className="num font-mono">
                      {v === null ? <span className="text-mute">—</span> : <span className={v === 0 ? undefined : 'text-error'}>{signed(v)}</span>}
                    </td>
                    <td data-l={t('Catatan selisih')}>
                      <Input aria-label={`${t('Catatan selisih')} ${p.name}`} maxLength={200} value={r.note} onChange={(e) => setCell(p.productId, 'note', e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
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
                <span className="block font-mono text-small text-mute">{t('Stok sistem {n}', { n: amount(p.stock) })}</span>
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
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Button,
  Chip,
  Dialog,
  Empty,
  Field,
  FormAlert,
  Input,
  Select,
  Tag,
  Textarea,
  amount,
  dateShort,
  isoDay,
  money,
  time,
  toast,
  useI18n,
} from '@hermes-pos/ui';
import { FilterBar, OutletField, SearchBox } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination, pageOf } from '../../components/Pagination';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { useApp, useLock } from '../../lib/app';
import { describeError } from '../../lib/errors';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';
import type { Bill, BillEdit, BillItem, BillRefund, BillSnapshot, Product } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { BILL_PAGE, correctBill, getBill, listBills, voidBill } from '../../server/bills';
import { billCorrectionSchema } from '../../lib/schemas';
import { listCatalog } from '../../server/manage';
import { listProductSales } from '../../server/summary';
import { pageHead } from '../../lang';
import { ReasonChips } from '../../components/ReasonChips';

const STATUSES = [
  { value: 'completed', label: 'Selesai' },
  { value: 'voided', label: 'Dibatalkan' },
  { value: 'all', label: 'Semua' },
] as const;
const SORTS = [
  { value: 'qty', label: 'Terlaris' },
  { value: 'sales', label: 'Penjualan terbesar' },
  { value: 'name', label: 'Nama A-Z' },
] as const;
type Status = (typeof STATUSES)[number]['value'];
type Sort = (typeof SORTS)[number]['value'];
type Search = PeriodSearch & {
  tab?: 'products';
  outlet?: string;
  status?: Exclude<Status, 'completed'>;
  q?: string;
  sort?: Exclude<Sort, 'qty'>;
  page?: number;
};

export const Route = createFileRoute('/_app/transactions')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    tab: s.tab === 'products' ? 'products' : undefined,
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    status: s.status === 'voided' || s.status === 'all' ? s.status : undefined,
    q: typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 40) : undefined,
    sort: s.sort === 'sales' || s.sort === 'name' ? s.sort : undefined,
    page: Number.isInteger(s.page) && (s.page as number) > 1 ? (s.page as number) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    if (deps.tab === 'products') {
      // Products belong to one outlet, so this tab always has one chosen.
      const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
      if (!outletId) return { tab: 'products' as const, outletId, range, today, products: [] as Product[], sold: {} };
      const [catalog, sold] = await Promise.all([listCatalog({ data: { outletId } }), listProductSales({ data: { outletId, ...range, tz } })]);
      return { tab: 'products' as const, outletId, range, today, products: catalog.products, sold };
    }
    const bills = await listBills({
      data: { outletId: deps.outlet ?? null, ...range, tz, status: deps.status ?? 'completed', q: deps.q ?? '', page: deps.page ?? 1 },
    });
    return { tab: 'bills' as const, outletId: deps.outlet ?? null, range, today, bills };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Transaksi|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Transaksi|menu'),
  component: Transactions,
});

/** Bills of the period (view and void), and every product of an outlet with what it sold. */
function Transactions() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/transactions' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  return (
    <Page title={t('Transaksi|menu')}>
      <nav aria-label={t('Bagian transaksi')} className="mb-5 flex flex-wrap gap-2">
        <Chip aria-current={data.tab === 'bills' ? 'page' : undefined} onClick={() => set({ tab: undefined, page: undefined })}>
          {t('Bill')}
        </Chip>
        <Chip aria-current={data.tab === 'products' ? 'page' : undefined} onClick={() => set({ tab: 'products', page: undefined })}>
          {t('Produk terjual')}
        </Chip>
      </nav>
      {data.tab === 'bills' ? <BillsTab bills={data.bills} set={set} /> : <ProductsTab products={data.products} sold={data.sold} set={set} />}
    </Page>
  );
}

/** Outlet and period, the first two fields of both tabs' Filter dialog. */
function CommonFilters({ set, all }: { set: (p: Partial<Search>) => void; all: boolean }) {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  return (
    <>
      <OutletField all={all} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, page: undefined })} />
      <PeriodFilter value={search} range={data.range} today={data.today} onChange={(patch) => set({ ...patch, page: undefined })} />
    </>
  );
}

/** Filters that differ from the default, and the outlet and period part of the summary line. */
function useCommon(all: boolean) {
  const { t } = useI18n();
  const app = useApp();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const outletName = app.outlets.find((o) => o.id === data.outletId)?.name ?? t('Semua outlet');
  const outletSet = all ? !!search.outlet : !!search.outlet && search.outlet !== app.outlets[0]?.id;
  return {
    active: (outletSet ? 1 : 0) + (search.period ? 1 : 0),
    summary: [outletName, usePeriodLabel(search, data.range)],
    reset: { outlet: undefined, period: undefined, from: undefined, to: undefined, page: undefined } satisfies Partial<Search>,
  };
}

function BillsTab({ bills, set }: { bills: { rows: Bill[]; total: number }; set: (p: Partial<Search>) => void }) {
  const { t, lang } = useI18n();
  const app = useApp();
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? '');
  const [open, setOpen] = useState<Bill | null>(null);
  const tz = app.business.timezone;
  const pages = Math.max(1, Math.ceil(bills.total / BILL_PAGE));
  const common = useCommon(true);
  const status = search.status ?? 'completed';
  return (
    <>
      <FilterBar
        search={
          <SearchBox
            label={t('Cari bill')}
            placeholder={t('Cari nomor, nama, atau meja')}
            value={q}
            onChange={setQ}
            onSubmit={() => (q.trim() || undefined) !== search.q && set({ q: q.trim() || undefined, page: undefined })}
          />
        }
        active={common.active + (search.status ? 1 : 0)}
        summary={[...common.summary, t(STATUSES.find((s) => s.value === status)?.label ?? ''), t('{n} bill', { n: bills.total })].join(' · ')}
        onReset={() => set({ ...common.reset, status: undefined })}
      >
        <CommonFilters set={set} all />
        <Field label={t('Status bill')}>
          <Select
            value={status}
            onChange={(e) => set({ status: e.target.value === 'completed' ? undefined : (e.target.value as Search['status']), page: undefined })}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      {bills.rows.length === 0 ? (
        <Empty className="mt-6" title={search.q ? t('Tidak ada bill yang cocok.') : t('Tidak ada bill di periode ini.')}>
          {t('Bill yang dibayar di aplikasi kasir muncul di sini.')}
        </Empty>
      ) : (
        <>
          <div className="tbl-wrap mt-5">
            <table className="tbl tbl-card">
              <thead>
                <tr>
                  <th scope="col">{t('Bill')}</th>
                  <th scope="col">{t('Waktu')}</th>
                  <th scope="col">{t('Kasir')}</th>
                  <th scope="col">{t('Bayar')}</th>
                  <th scope="col" className="num">
                    {t('Total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bills.rows.map((b) => (
                  <tr key={b.id}>
                    <td data-l={t('Bill')}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-left font-semibold underline-offset-4 hover:underline"
                        onClick={() => setOpen(b)}
                        aria-label={t('Buka bill {number}', { number: b.number })}
                      >
                        {b.number}
                      </button>
                      <span className="block text-small text-mute">
                        {[b.customerName, b.tableNumber && t('Meja {n}', { n: b.tableNumber }), !search.outlet && b.outletName].filter(Boolean).join(' · ')}
                      </span>
                      <BillTags bill={b} />
                    </td>
                    <td data-l={t('Waktu')} className="font-mono text-small">
                      {dateShort(b.createdAt, lang, tz)} {time(b.createdAt, tz)}
                    </td>
                    <td data-l={t('Kasir')}>{b.cashierName}</td>
                    <td data-l={t('Bayar')}>{b.paymentMethod ? t(METHOD[b.paymentMethod]) : '-'}</td>
                    <td data-l={t('Total')} className="num">
                      {money(b.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Pagination page={search.page ?? 1} pages={pages} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
      {open && <BillDialog bill={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const METHOD: Record<'cash' | 'qris', string> = { cash: 'Tunai', qris: 'QRIS' };

function BillTags({ bill: b }: { bill: Bill }) {
  const { t } = useI18n();
  if (b.status !== 'voided' && b.refundedTotal <= 0 && b.editCount === 0 && !b.correctsNumber) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {b.status === 'voided' && (
        <Tag tone="mute">{b.correctedByNumber ? t('dikoreksi, diganti {number}', { number: b.correctedByNumber }) : t('dibatalkan')}</Tag>
      )}
      {b.correctsNumber && <Tag>{t('pengganti {number}', { number: b.correctsNumber })}</Tag>}
      {b.status !== 'voided' && b.refundedTotal > 0 && <Tag tone="fire">{b.refundedTotal >= b.total ? t('refund') : t('refund sebagian')}</Tag>}
      {b.editCount > 0 && !b.correctedByNumber && <Tag>{t('diubah {n}x', { n: b.editCount })}</Tag>}
    </span>
  );
}

const EDIT_KIND: Record<BillEdit['kind'], string> = {
  void: 'Dibatalkan',
  correction: 'Koreksi bill',
  payment: 'Metode bayar',
  details: 'Nama, meja, catatan',
  items: 'Item',
};
const itemsText = (s: BillSnapshot) => s.items.map((i) => `${amount(i.quantity)}× ${i.productName}`).join(', ');
const methodText = (m: string) => (m === 'cash' || m === 'qris' ? METHOD[m] : '-');

/** Every owner edit, oldest first, with what it changed (migration 067). */
function EditHistory({ edits }: { edits: BillEdit[] }) {
  const { t, lang } = useI18n();
  const tz = useApp().business.timezone;
  if (!edits.length) return null;
  return (
    <section aria-labelledby="bill-edits" className="grid gap-2 border-t-[1.5px] border-ink pt-4 text-small">
      <h3 id="bill-edits" className="font-semibold">
        {t('Riwayat perubahan')}
      </h3>
      <ol className="grid gap-2">
        {edits.map((e) => (
          <li key={e.id}>
            <span className="font-mono text-mute">
              {dateShort(e.createdAt, lang, tz)} {time(e.createdAt, tz)}
            </span>{' '}
            · <span className="font-semibold">{t(EDIT_KIND[e.kind])}</span>
            {e.reason && <> · {e.reason}</>}
            <span className="block text-mute">
              {(e.kind === 'items' || e.kind === 'correction') && `${itemsText(e.before)} → ${itemsText(e.after)} · `}
              {e.kind === 'correction' &&
                e.before.paymentMethod !== e.after.paymentMethod &&
                `${t(methodText(e.before.paymentMethod))} → ${t(methodText(e.after.paymentMethod))} · `}
              {e.kind === 'payment' && `${t(methodText(e.before.paymentMethod))} → ${t(methodText(e.after.paymentMethod))} · `}
              {e.kind === 'details' &&
                `${[e.after.customerName, e.after.tableNumber && t('Meja {n}', { n: e.after.tableNumber })].filter(Boolean).join(' · ') || '-'} · `}
              {e.before.total === e.after.total ? money(e.after.total) : `${money(e.before.total)} → ${money(e.after.total)}`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Editing a bill of an earlier day changes that day's reports and its shift's variance; say so before saving. */
function PastNote({ bill: b }: { bill: Bill }) {
  const { t, lang } = useI18n();
  const tz = useApp().business.timezone;
  if (isoDay(new Date(b.createdAt), tz) >= isoDay(new Date(), tz)) return null;
  return (
    <p role="note" className="rounded border-[1.5px] border-fire bg-tint p-3 text-small">
      {t('Bill ini dari {date}. Laporan dan kas shift hari itu ikut berubah.', {
        date: dateShort(b.createdAt, lang, tz),
      })}
    </p>
  );
}

type Mode = 'view' | 'void' | 'correct';

/** One bill: items, refunds, and its history. Mistakes are fixed with Koreksi bill (void + replacement, 073) or Batalkan bill. */
function BillDialog({ bill: b, onClose }: { bill: Bill; onClose: () => void }) {
  const { t, lang } = useI18n();
  const app = useApp();
  const lock = useLock();
  const [mode, setMode] = useState<Mode>('view');
  const [detail, setDetail] = useState<{ items: BillItem[]; refunds: BillRefund[]; edits: BillEdit[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    getBill({ data: { id: b.id } }).then(setDetail, (err) => setLoadError(describeError(err)));
  }, [b.id]);
  const voidable = b.status === 'completed' && b.refundedTotal === 0 && !lock.locked;
  const tz = app.business.timezone;

  if (mode === 'void') return <VoidDialog bill={b} onClose={onClose} onBack={() => setMode('view')} />;
  if (mode === 'correct' && detail) return <CorrectDialog bill={b} items={detail.items} onClose={onClose} onBack={() => setMode('view')} />;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Bill {number}', { number: b.number })}
      description={`${dateShort(b.createdAt, lang, tz)} ${time(b.createdAt, tz)} · ${b.outletName} · ${b.cashierName}`}
      footer={<Button onClick={onClose}>{t('Tutup')}</Button>}
    >
      <BillTags bill={b} />
      {b.status === 'voided' && b.voidReason && <p className="text-body">{t('Alasan batal: {reason}', { reason: b.voidReason })}</p>}
      {(b.customerName || b.tableNumber) && (
        <p className="text-body">{[b.customerName, b.tableNumber && t('Meja {n}', { n: b.tableNumber })].filter(Boolean).join(' · ')}</p>
      )}
      {loadError ? (
        <FormAlert>{t(loadError)}</FormAlert>
      ) : !detail ? (
        <p className="text-mute" role="status">
          {t('Memuat data...')}
        </p>
      ) : (
        <>
          <ul className="grid gap-2">
            {detail.items.map((i) => (
              <li key={i.itemId} className="flex justify-between gap-3 border-b-[1.5px] border-dashed border-ink/30 pb-2">
                <span className="min-w-0">
                  <span className="font-semibold">
                    {amount(i.quantity)} × {i.productName}
                  </span>
                  <span className="block font-mono text-small text-mute">@ {money(i.unitPrice)}</span>
                  {i.note && <span className="block text-small text-mute">{i.note}</span>}
                  {i.refundedQty > 0 && <span className="block text-small text-fire">{t('Direfund {n}', { n: amount(i.refundedQty) })}</span>}
                </span>
                <span className="text-right font-mono">
                  {money(i.subtotal)}
                  {i.discount > 0 && <span className="block text-small text-mute">−{money(i.discount)}</span>}
                </span>
              </li>
            ))}
          </ul>
          <dl className="grid gap-1 font-mono text-body">
            {b.discount > 0 && (
              <div className="flex justify-between">
                <dt>{t('Diskon')}</dt>
                <dd>−{money(b.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <dt>{t('Total')}</dt>
              <dd>{money(b.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('Bayar')}</dt>
              <dd>{b.paymentMethod ? t(METHOD[b.paymentMethod]) : '-'}</dd>
            </div>
            {b.refundedTotal > 0 && (
              <>
                <div className="flex justify-between">
                  <dt>{t('Refund')}</dt>
                  <dd>−{money(b.refundedTotal)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>{t('Bersih')}</dt>
                  <dd>{money(b.total - b.refundedTotal)}</dd>
                </div>
              </>
            )}
          </dl>
          {detail.refunds.length > 0 && (
            <section aria-label={t('Refund')} className="grid gap-1 text-small">
              {detail.refunds.map((r) => (
                <p key={r.id}>
                  {dateShort(r.createdAt, lang, tz)} {time(r.createdAt, tz)} · {r.cashierName} · {money(r.amount)} · {r.reason}
                </p>
              ))}
            </section>
          )}
          <EditHistory edits={detail.edits} />
          {voidable && (
            <div className="flex flex-wrap justify-end gap-2 border-t-[1.5px] border-ink pt-4">
              <Button sm onClick={() => setMode('correct')}>
                {t('Koreksi bill')}
              </Button>
              <Button sm variant="ink" onClick={() => setMode('void')}>
                {t('Batalkan bill')}
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

type EditProps = { bill: Bill; onClose: () => void; onBack: () => void };

function EditFooter({ busy, onBack, label, danger }: { busy: boolean; onBack: () => void; label: string; danger?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <Button onClick={onBack} disabled={busy}>
        {t('Kembali')}
      </Button>
      <Button type="submit" form="bill-edit" variant={danger ? 'ink' : 'fire'} busy={busy} busyLabel={t('Menyimpan...')}>
        {label}
      </Button>
    </>
  );
}

function VoidDialog({ bill: b, onClose, onBack }: EditProps) {
  const { t } = useI18n();
  const act = useAction();
  const [reason, setReason] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) return act.setError('Tulis alasan pembatalan, minimal 3 huruf.');
    const res = await act.run(() => voidBill({ data: { id: b.id, reason } }), { success: t('Bill {number} dibatalkan.', { number: b.number }) });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Batalkan bill {number}?', { number: b.number })}
      description={t('Stok kembali dan {amount} keluar dari penjualan. Tidak bisa diurungkan.', {
        amount: money(b.total),
      })}
      footer={<EditFooter busy={act.busy} onBack={onBack} label={t('Batalkan bill')} danger />}
    >
      <form id="bill-edit" noValidate onSubmit={save} className="grid gap-4">
        <PastNote bill={b} />
        <ReasonChips options={['Salah input', 'Pelanggan batal']} onPick={setReason} />
        <Field label={t('Alasan')}>
          <Textarea autoFocus rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

/**
 * Koreksi bill (073): the whole bill as it should have been. Lines keep their original price and discount; new products
 * come at today's price. The database voids this bill and records the new one at the same day and shift.
 */
function CorrectDialog({ bill: b, items, onClose, onBack }: EditProps & { items: BillItem[] }) {
  const { t } = useI18n();
  const act = useAction();
  const [rows, setRows] = useState(
    items.map((i) => ({ key: i.itemId, itemId: i.itemId, productId: '', name: i.productName, price: i.unitPrice, qty: String(i.quantity) })),
  );
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [pick, setPick] = useState('');
  const [method, setMethod] = useState<'cash' | 'qris'>(b.paymentMethod === 'qris' ? 'qris' : 'cash');
  const [name, setName] = useState(b.customerName);
  const [table, setTable] = useState(b.tableNumber);
  const [reason, setReason] = useState('');
  useEffect(() => {
    listCatalog({ data: { outletId: b.outletId } }).then(
      (c) => setCatalog(c.products.filter((p) => p.isActive)),
      () => setCatalog([]),
    );
  }, [b.outletId]);
  const setQty = (key: string, qty: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, qty: qty.replace(/\D/g, '').slice(0, 4) } : r)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const check = billCorrectionSchema.safeParse({
      id: b.id,
      items: rows.map((r) => (r.itemId ? { itemId: r.itemId, quantity: Number(r.qty || 0) } : { productId: r.productId, quantity: Number(r.qty || 0) })),
      paymentMethod: method,
      customerName: name,
      tableNumber: table,
      reason,
    });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => correctBill({ data: check.data }));
    if (res?.ok && res.data) {
      onClose();
      toast.success(t('Bill {old} diganti {number}, total {amount}.', { old: b.number, number: res.data.number, amount: money(res.data.total) }));
    }
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Koreksi bill {number}', { number: b.number })}
      description={t('Bill lama dibatalkan dan diganti bill baru di shift yang sama.')}
      footer={<EditFooter busy={act.busy} onBack={onBack} label={t('Simpan koreksi')} />}
    >
      <form id="bill-edit" noValidate onSubmit={save} className="grid gap-4">
        <PastNote bill={b} />
        <fieldset className="grid gap-3">
          <legend className="fld-l">{t('Item dan jumlah')}</legend>
          {rows.map((r) => (
            <div key={r.key} className="flex items-end gap-3">
              <Field label={`${r.name} · ${money(r.price)}`} className="flex-1">
                <Input inputMode="numeric" className="font-mono" value={r.qty} onChange={(e) => setQty(r.key, e.target.value)} />
              </Field>
              <Button sm className="mb-1" onClick={() => setQty(r.key, '0')} disabled={r.qty === '0'}>
                {t('Hapus')}
                <span className="sr-only"> {r.name}</span>
              </Button>
            </div>
          ))}
          {catalog.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('Tambah produk')} className="min-w-[200px] flex-1">
                <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                  {catalog.map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.name} · ${money(p.price)}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                className="mb-1"
                disabled={!pick}
                onClick={() => {
                  const p = catalog.find((x) => x.id === pick);
                  if (p) setRows((rs) => [...rs, { key: `new-${rs.length}`, itemId: '', productId: p.id, name: p.name, price: p.price, qty: '1' }]);
                  setPick('');
                }}
              >
                {t('Tambah')}
              </Button>
            </div>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Dibayar dengan')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value === 'qris' ? 'qris' : 'cash')}>
              <option value="cash">{t('Tunai')}</option>
              <option value="qris">QRIS</option>
            </Select>
          </Field>
          <Field label={t('Nama pelanggan')} optional>
            <Input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Meja')} optional>
            <Input maxLength={6} value={table} onChange={(e) => setTable(e.target.value)} />
          </Field>
        </div>
        <ReasonChips options={['Salah input', 'Pelanggan ganti menu']} onPick={setReason} />
        <Field label={t('Alasan koreksi')}>
          <Input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

function ProductsTab({
  products,
  sold,
  set,
}: {
  products: Product[];
  sold: Record<string, { qty: number; sales: number }> | null;
  set: (p: Partial<Search>) => void;
}) {
  const { t } = useI18n();
  const search = Route.useSearch();
  const common = useCommon(false);
  // Searched in the browser: the tab already holds every product of the outlet.
  const [q, setQ] = useState('');
  const sort: Sort = search.sort ?? 'qty';
  const of = (id: string) => sold?.[id] ?? { qty: 0, sales: 0 };
  const needle = q.trim().toLowerCase();
  const sorted = products
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .sort((a, z) => (sort === 'name' ? a.name.localeCompare(z.name) : of(z.id)[sort] - of(a.id)[sort] || a.name.localeCompare(z.name)));
  const view = pageOf(sorted, search.page ?? 1);
  return (
    <>
      <FilterBar
        search={
          <SearchBox
            label={t('Cari produk')}
            placeholder={t('Cari nama produk')}
            value={q}
            onChange={(v) => {
              setQ(v);
              if (search.page) set({ page: undefined });
            }}
          />
        }
        active={common.active + (search.sort ? 1 : 0)}
        summary={[...common.summary, t(SORTS.find((s) => s.value === sort)?.label ?? ''), t('{n} produk', { n: sorted.length })].join(' · ')}
        onReset={() => set({ ...common.reset, sort: undefined })}
      >
        <CommonFilters set={set} all={false} />
        <Field label={t('Urutkan')}>
          <Select value={sort} onChange={(e) => set({ sort: e.target.value === 'qty' ? undefined : (e.target.value as Search['sort']), page: undefined })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-small text-mute">{t('Dari bill selesai. Penjualan setelah semua diskon, refund belum dikurangi.')}</p>
      </FilterBar>
      {sold === null && (
        <p role="status" className="mt-3 text-small font-semibold text-error">
          {t('Jumlah terjual belum bisa dimuat. Muat ulang halaman sebentar lagi.')}
        </p>
      )}
      {products.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada produk.')}>
          {t('Produk dibuat di menu Produk.')}
        </Empty>
      ) : sorted.length === 0 ? (
        <p className="slipc mt-5 text-mute">{t('Tidak ada produk yang cocok. Ubah pencarian atau kategori.')}</p>
      ) : (
        <div className="tbl-wrap mt-5">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Produk')}</th>
                <th scope="col" className="num">
                  {t('Terjual')}
                </th>
                <th scope="col" className="num">
                  {t('Penjualan')}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((p) => (
                <tr key={p.id}>
                  <td data-l={t('Produk')}>
                    <span className="font-semibold">{p.name}</span>
                    {!p.isActive && <span className="block text-small text-mute">{t('nonaktif')}</span>}
                  </td>
                  <td data-l={t('Terjual')} className="num">
                    {amount(of(p.id).qty)}
                  </td>
                  <td data-l={t('Penjualan')} className="num">
                    {money(of(p.id).sales)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={view.page} pages={view.pages} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
    </>
  );
}

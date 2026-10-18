import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DropdownMenu as Menu } from 'radix-ui';
import {
  Button,
  btn,
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
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination, pageOf } from '../../components/Pagination';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { useApp, useLock } from '../../lib/app';
import { describeError } from '../../lib/errors';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';
import type { Bill, BillEdit, BillItem, BillRefund, BillSnapshot, Product } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { BILL_PAGE, getBill, listBills, setBillPayment, updateBillDetails, updateBillItems, voidBill } from '../../server/bills';
import { listCatalog } from '../../server/manage';
import { listProductSales } from '../../server/summary';
import { pageHead } from '../../lang';

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

/** Bills of the period with owner edits (migration 066), and every product of an outlet with what it sold. */
function Transactions() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/transactions' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  return (
    <Page
      title={t('Transaksi|menu')}
      tools={<OutletFilter all={data.tab === 'bills'} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, page: undefined })} />}
    >
      <nav aria-label={t('Bagian transaksi')} className="flex flex-wrap gap-2">
        <Chip aria-current={data.tab === 'bills' ? 'page' : undefined} onClick={() => set({ tab: undefined, page: undefined })}>
          {t('Bill')}
        </Chip>
        <Chip aria-current={data.tab === 'products' ? 'page' : undefined} onClick={() => set({ tab: 'products', page: undefined })}>
          {t('Produk terjual')}
        </Chip>
      </nav>
      <div className="mt-5">
        <PeriodFilter value={search} range={data.range} today={data.today} onChange={(patch) => set({ ...patch, page: undefined })} />
      </div>
      {data.tab === 'bills' ? <BillsTab bills={data.bills} set={set} /> : <ProductsTab products={data.products} sold={data.sold} set={set} />}
    </Page>
  );
}

function BillsTab({ bills, set }: { bills: { rows: Bill[]; total: number }; set: (p: Partial<Search>) => void }) {
  const { t, lang } = useI18n();
  const app = useApp();
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? '');
  const [open, setOpen] = useState<Bill | null>(null);
  const tz = app.business.timezone;
  const pages = Math.max(1, Math.ceil(bills.total / BILL_PAGE));
  return (
    <>
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <Field label={t('Status bill')} className="w-full sm:w-[200px]">
          <Select
            value={search.status ?? 'completed'}
            onChange={(e) => set({ status: e.target.value === 'completed' ? undefined : (e.target.value as Search['status']), page: undefined })}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </Select>
        </Field>
        <form
          className="min-w-[220px] flex-1 md:max-w-[340px]"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: q.trim() || undefined, page: undefined });
          }}
        >
          <Field label={t('Cari bill')}>
            <Input type="search" maxLength={40} placeholder={t('Nomor, nama, atau meja')} value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
        </form>
      </div>
      {bills.rows.length === 0 ? (
        <Empty className="mt-6" title={t('Tidak ada bill di periode ini.')}>
          {t('Bill yang dibayar di aplikasi kasir muncul di sini.')}
        </Empty>
      ) : (
        <>
          <p className="mt-6 font-mono text-[14px] text-mute" role="status">
            {t('{n} bill', { n: bills.total })}
          </p>
          <div className="tbl-wrap mt-3">
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
                      <button type="button" className="text-left font-semibold underline-offset-4 hover:underline" onClick={() => setOpen(b)}>
                        {b.number}
                      </button>
                      <span className="block text-[14px] text-mute">
                        {[b.customerName, b.tableNumber && t('Meja {n}', { n: b.tableNumber }), !search.outlet && b.outletName].filter(Boolean).join(' · ')}
                      </span>
                      <BillTags bill={b} />
                    </td>
                    <td data-l={t('Waktu')} className="font-mono text-[14px]">
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
  if (b.status !== 'voided' && b.refundedTotal <= 0 && b.editCount === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {b.status === 'voided' && <Tag tone="mute">{t('dibatalkan')}</Tag>}
      {b.status !== 'voided' && b.refundedTotal > 0 && <Tag tone="fire">{b.refundedTotal >= b.total ? t('refund') : t('refund sebagian')}</Tag>}
      {b.editCount > 0 && <Tag>{t('diubah {n}x', { n: b.editCount })}</Tag>}
    </span>
  );
}

const EDIT_KIND: Record<BillEdit['kind'], string> = { void: 'Dibatalkan', payment: 'Metode bayar', details: 'Nama, meja, catatan', items: 'Item' };
const itemsText = (s: BillSnapshot) => s.items.map((i) => `${amount(i.quantity)}× ${i.productName}`).join(', ');
const methodText = (m: string) => (m === 'cash' || m === 'qris' ? METHOD[m] : '-');

/** Every owner edit, oldest first, with what it changed (migration 067). */
function EditHistory({ edits }: { edits: BillEdit[] }) {
  const { t, lang } = useI18n();
  const tz = useApp().business.timezone;
  if (!edits.length) return null;
  return (
    <section aria-labelledby="bill-edits" className="grid gap-2 border-t-[1.5px] border-ink pt-4 text-[14px]">
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
              {e.kind === 'items' && `${itemsText(e.before)} → ${itemsText(e.after)} · `}
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
    <p role="note" className="rounded border-[1.5px] border-fire bg-tint p-3 text-[14px]">
      {t('Bill ini dari {date}. Laporan hari itu dan selisih kas shift-nya ikut berubah. Perubahan ini tercatat di riwayat bill.', {
        date: dateShort(b.createdAt, lang, tz),
      })}
    </p>
  );
}

/** Item and payment changes need a reason (migration 067), like a void. */
function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <Field label={t('Alasan perubahan')} help={t('Tercatat di riwayat bill.')}>
      <Input maxLength={200} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

type Mode = 'view' | 'items' | 'details' | 'payment' | 'void';

/** One bill: items and refunds, then one edit at a time. The database recomputes totals, stock, and the cash book. */
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
  const editable = b.status === 'completed' && !lock.locked;
  const moneyEdits = editable && b.refundedTotal === 0;
  const tz = app.business.timezone;

  if (detail && mode === 'items') return <ItemsDialog bill={b} items={detail.items} onClose={onClose} onBack={() => setMode('view')} />;
  if (detail && mode === 'details') return <DetailsDialog bill={b} items={detail.items} onClose={onClose} onBack={() => setMode('view')} />;
  if (mode === 'payment') return <PaymentDialog bill={b} onClose={onClose} onBack={() => setMode('view')} />;
  if (mode === 'void') return <VoidDialog bill={b} onClose={onClose} onBack={() => setMode('view')} />;
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
      {b.status === 'voided' && b.voidReason && <p className="text-[15px]">{t('Alasan batal: {reason}', { reason: b.voidReason })}</p>}
      {(b.customerName || b.tableNumber) && (
        <p className="text-[15px]">{[b.customerName, b.tableNumber && t('Meja {n}', { n: b.tableNumber })].filter(Boolean).join(' · ')}</p>
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
                  <span className="block font-mono text-[13px] text-mute">@ {money(i.unitPrice)}</span>
                  {i.note && <span className="block text-[14px] text-mute">{i.note}</span>}
                  {i.refundedQty > 0 && <span className="block text-[14px] text-fire">{t('Direfund {n}', { n: amount(i.refundedQty) })}</span>}
                </span>
                <span className="text-right font-mono">
                  {money(i.subtotal)}
                  {i.discount > 0 && <span className="block text-[13px] text-mute">−{money(i.discount)}</span>}
                </span>
              </li>
            ))}
          </ul>
          <dl className="grid gap-1 font-mono text-[15px]">
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
            <section aria-label={t('Refund')} className="grid gap-1 text-[14px]">
              {detail.refunds.map((r) => (
                <p key={r.id}>
                  {dateShort(r.createdAt, lang, tz)} {time(r.createdAt, tz)} · {r.cashierName} · {money(r.amount)} · {r.reason}
                </p>
              ))}
            </section>
          )}
          <EditHistory edits={detail.edits} />
          {editable && (
            <div className="grid gap-3 border-t-[1.5px] border-ink pt-4">
              {/* One menu for the edits and one button for the void, instead of four buttons in a row (owner's request, 18 Oct 2026). */}
              <div className="flex flex-wrap justify-between gap-2">
                {moneyEdits ? (
                  <Menu.Root>
                    <Menu.Trigger className={btn('plain', { sm: true })}>{t('Ubah bill')} ▾</Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content
                        align="start"
                        sideOffset={4}
                        collisionPadding={12}
                        className="z-[70] min-w-[220px] rounded border-[1.5px] border-ink bg-slip p-1 shadow-[var(--shadow-hard-3)]"
                      >
                        {(
                          [
                            ['details', t('Nama, meja, catatan')],
                            ['items', t('Item dan jumlah')],
                            ['payment', b.paymentMethod === 'qris' ? t('Ganti ke tunai') : t('Ganti ke QRIS')],
                          ] as const
                        ).map(([m, label]) => (
                          <Menu.Item
                            key={m}
                            onSelect={() => setMode(m)}
                            className="flex min-h-11 cursor-pointer items-center rounded px-3 text-[16px] outline-none data-[highlighted]:bg-tint-2"
                          >
                            {label}
                          </Menu.Item>
                        ))}
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                ) : (
                  <Button sm onClick={() => setMode('details')}>
                    {t('Ubah nama, meja, catatan')}
                  </Button>
                )}
                {moneyEdits && (
                  <Button sm variant="ink" onClick={() => setMode('void')}>
                    {t('Batalkan bill')}
                  </Button>
                )}
              </div>
              {!moneyEdits && <p className="text-[14px] text-mute">{t('Bill yang sudah direfund hanya bisa diubah nama, meja, dan catatannya.')}</p>}
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

/** Quantities of the bill's lines (0 removes one) and new lines at today's price. */
function ItemsDialog({ bill: b, items, onClose, onBack }: EditProps & { items: BillItem[] }) {
  const { t } = useI18n();
  const act = useAction();
  const [rows, setRows] = useState(items.map((i) => ({ key: i.itemId, itemId: i.itemId, productId: '', name: i.productName, qty: String(i.quantity) })));
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [pick, setPick] = useState('');
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
    const list = rows.map((r) => (r.itemId ? { itemId: r.itemId, quantity: Number(r.qty || 0) } : { productId: r.productId, quantity: Number(r.qty || 0) }));
    if (!list.some((r) => r.quantity > 0)) return act.setError('Bill harus berisi minimal satu item.');
    if (reason.trim().length < 3) return act.setError('Tulis alasan perubahan, minimal 3 huruf.');
    const res = await act.run(() => updateBillItems({ data: { id: b.id, items: list, reason } }));
    if (res?.ok) {
      onClose();
      toast.success(t('Bill {number} disimpan. Total baru {amount}.', { number: b.number, amount: money(res.data ?? 0) }));
    }
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Ubah item {number}', { number: b.number })}
      description={t('Total, diskon, stok, dan kas shift dihitung ulang oleh server. Isi 0 untuk menghapus item.')}
      footer={<EditFooter busy={act.busy} onBack={onBack} label={t('Simpan item')} />}
    >
      <form id="bill-edit" noValidate onSubmit={save} className="grid gap-3">
        <PastNote bill={b} />
        {rows.map((r) => (
          <div key={r.key} className="flex items-end gap-3">
            <Field label={r.name} className="flex-1">
              <Input inputMode="numeric" className="font-mono" value={r.qty} onChange={(e) => setQty(r.key, e.target.value)} />
            </Field>
            <Button sm className="mb-1" onClick={() => setQty(r.key, '0')} disabled={r.qty === '0'}>
              {t('Hapus')}
              <span className="sr-only"> {r.name}</span>
            </Button>
          </div>
        ))}
        {catalog.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 border-t-[1.5px] border-ink pt-3">
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
                if (p) setRows((rs) => [...rs, { key: `new-${rs.length}`, itemId: '', productId: p.id, name: p.name, qty: '1' }]);
                setPick('');
              }}
            >
              {t('Tambah')}
            </Button>
          </div>
        )}
        <ReasonField value={reason} onChange={setReason} />
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

function DetailsDialog({ bill: b, items, onClose, onBack }: EditProps & { items: BillItem[] }) {
  const { t } = useI18n();
  const act = useAction();
  const [name, setName] = useState(b.customerName);
  const [table, setTable] = useState(b.tableNumber);
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [i.itemId, i.note])));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await act.run(() => updateBillDetails({ data: { id: b.id, customerName: name, tableNumber: table, notes } }), {
      success: t('Bill {number} disimpan.', { number: b.number }),
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Ubah detail {number}', { number: b.number })}
      footer={<EditFooter busy={act.busy} onBack={onBack} label={t('Simpan')} />}
    >
      <form id="bill-edit" noValidate onSubmit={save} className="grid gap-4">
        <PastNote bill={b} />
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label={t('Nama pelanggan')} optional>
            <Input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Meja')} optional>
            <Input maxLength={6} value={table} onChange={(e) => setTable(e.target.value)} />
          </Field>
        </div>
        {items.map((i) => (
          <Field key={i.itemId} label={t('Catatan {name}', { name: i.productName })} optional>
            <Input maxLength={200} value={notes[i.itemId] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [i.itemId]: e.target.value }))} />
          </Field>
        ))}
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

function PaymentDialog({ bill: b, onClose, onBack }: EditProps) {
  const { t } = useI18n();
  const act = useAction();
  const to = b.paymentMethod === 'qris' ? 'cash' : 'qris';
  const [reason, setReason] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) return act.setError('Tulis alasan perubahan, minimal 3 huruf.');
    const res = await act.run(() => setBillPayment({ data: { id: b.id, method: to, reason } }), {
      success: t('Bill {number} sekarang dibayar {method}.', { number: b.number, method: t(METHOD[to]) }),
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={to === 'qris' ? t('Ganti ke QRIS?') : t('Ganti ke tunai?')}
      description={
        to === 'qris'
          ? t('{amount} keluar dari kas laci shift bill ini. Kalau shift sudah ditutup, selisihnya dihitung ulang.', { amount: money(b.total) })
          : t('{amount} masuk ke kas laci shift bill ini. Kalau shift sudah ditutup, selisihnya dihitung ulang.', { amount: money(b.total) })
      }
      footer={<EditFooter busy={act.busy} onBack={onBack} label={to === 'qris' ? t('Ganti ke QRIS') : t('Ganti ke tunai')} />}
    >
      <form id="bill-edit" noValidate onSubmit={save} className="grid gap-4">
        <PastNote bill={b} />
        <ReasonField value={reason} onChange={setReason} />
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
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
      description={t('Stok dikembalikan dan {amount} keluar dari penjualan. Kalau tunai, kas shift ikut dihitung ulang. Tidak bisa diurungkan.', {
        amount: money(b.total),
      })}
      footer={<EditFooter busy={act.busy} onBack={onBack} label={t('Batalkan bill')} danger />}
    >
      <form id="bill-edit" noValidate onSubmit={save} className="grid gap-4">
        <PastNote bill={b} />
        <Field label={t('Alasan')}>
          <Textarea autoFocus rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
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
  const range = Route.useLoaderData().range;
  const periodLabel = usePeriodLabel(search, range);
  const sort: Sort = search.sort ?? 'qty';
  const of = (id: string) => sold?.[id] ?? { qty: 0, sales: 0 };
  const sorted = [...products].sort((a, z) =>
    sort === 'name' ? a.name.localeCompare(z.name) : of(z.id)[sort] - of(a.id)[sort] || a.name.localeCompare(z.name),
  );
  const view = pageOf(sorted, search.page ?? 1);
  if (products.length === 0)
    return (
      <Empty className="mt-6" title={t('Belum ada produk.')}>
        {t('Produk dibuat di menu Produk.')}
      </Empty>
    );
  return (
    <>
      <Field label={t('Urutkan')} className="mt-5 w-full sm:w-[240px]">
        <Select value={sort} onChange={(e) => set({ sort: e.target.value === 'qty' ? undefined : (e.target.value as Search['sort']), page: undefined })}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.label)}
            </option>
          ))}
        </Select>
      </Field>
      <p className="mt-4 text-[14px] text-mute">
        {t('{period}, dari bill selesai. Penjualan setelah diskon item, refund belum dikurangi.', { period: periodLabel })}
      </p>
      {sold === null && (
        <p role="status" className="mt-3 text-[14px] font-semibold text-error">
          {t('Jumlah terjual belum bisa dimuat. Muat ulang halaman sebentar lagi.')}
        </p>
      )}
      <div className="tbl-wrap mt-4">
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
                  {!p.isActive && <span className="block text-[14px] text-mute">{t('nonaktif')}</span>}
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
      <Pagination page={view.page} pages={view.pages} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
    </>
  );
}

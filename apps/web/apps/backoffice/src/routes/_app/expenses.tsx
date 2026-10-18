import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isoDay } from '@hermes-pos/ui';
import { Button, Card, Dialog, Empty, FormAlert, Input, Loading, Select, SkCard, Tag, dateLong, money, useI18n } from '@hermes-pos/ui';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { Pagination } from '../../components/Pagination';
import { Stat } from '../../components/Stat';
import { useLock } from '../../lib/app';
import { EXPENSE_UNITS, expenseItemSchema } from '../../lib/schemas';
import type { Expense, ExpenseItem } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { describeError } from '../../lib/errors';
import { listExpenses, updateExpense } from '../../server/expenses';
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
  const [editing, setEditing] = useState<Expense | null>(null);
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
          'Kasir mencatat belanja dan biaya operasional di aplikasi. Semua catatan satu shift jadi satu daftar dan langsung dihitung. Anda bisa mengubahnya kapan saja; kas shift itu ikut dihitung ulang.',
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
                  <ExpenseCard key={e.id} expense={e} onEdit={() => setEditing(e)} />
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

      {editing && <EditDialog expense={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function ExpenseCard({ expense: e, onEdit }: { expense: Expense; onEdit: () => void }) {
  const { t } = useI18n();
  const lock = useLock();
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
        <div className="flex flex-wrap items-center gap-2">
          {e.shiftOpen && <Tag tone="fire">{t('shift masih buka')}</Tag>}
          <Button onClick={onEdit} {...lock.props}>
            {lock.label(t('Ubah'))}
          </Button>
        </div>
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

type Row = { name: string; category: ExpenseItem['category']; quantity: string; unit: string; amount: string; paidFrom: ExpenseItem['paidFrom'] };
const toRow = (i: ExpenseItem): Row => ({
  name: i.name,
  category: i.category,
  quantity: qty(i.quantity),
  unit: i.unit,
  amount: String(i.amount),
  paidFrom: i.paidFrom,
});

/** The owner can correct every field of the shift's items. The database recomputes the total, the cash book, and a closed shift's expected cash. */
function EditDialog({ expense: e, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [rows, setRows] = useState<Row[]>(e.items.map(toRow));
  const [errors, setErrors] = useState<string[]>([]);
  const parsed = rows.map((r) => ({
    name: r.name,
    category: r.category,
    unit: r.unit,
    paidFrom: r.paidFrom,
    quantity: Number(r.quantity.trim().replace(',', '.')),
    amount: Number(r.amount.replace(/\./g, '')),
  }));
  const total = parsed.reduce((n, r) => n + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const set = (k: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === k ? { ...r, ...patch } : r)));
    setErrors((es) => es.map((x, j) => (j === k ? '' : x)));
  };

  async function save() {
    const checks = parsed.map((r) => expenseItemSchema.safeParse({ ...r, quantity: r.quantity, amount: r.amount }));
    const errs = checks.map((c) => (c.success ? '' : (c.error.issues[0]?.message ?? 'Data tidak valid.')));
    setErrors(errs);
    if (errs.some(Boolean) || !rows.length) return;
    const items = checks.map((c) => (c.success ? c.data : null)).filter((x) => x !== null);
    const res = await act.run(() => updateExpense({ data: { id: e.id, items } }), {
      success: t('Pengeluaran shift {n} disimpan: {amount}.', { n: e.shiftNumber, amount: money(total) }),
    });
    if (res) onClose();
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Ubah pengeluaran shift {n}', { n: e.shiftNumber })}
      description={
        e.shiftOpen
          ? t('Shift masih buka. Kas seharusnya di aplikasi kasir ikut berubah.')
          : t('Shift sudah ditutup. Kas seharusnya dan selisih shift itu dihitung ulang; hitungan uang kasir tetap.')
      }
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button variant="fire" busy={act.busy} onClick={save}>
            {t('Simpan {amount}', { amount: money(total) })}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {rows.map((r, k) => (
          // One card per item: name across the top, then two and three fields per row. Phones get two columns.
          <fieldset key={k} className="grid grid-cols-2 gap-3 rounded border-[1.5px] border-ink bg-slip p-4 sm:grid-cols-6">
            <legend className="sr-only">{t('Barang {n}', { n: k + 1 })}</legend>
            <div className="col-span-full flex items-center justify-between gap-3">
              <span aria-hidden className="font-mono text-[14px] text-mute">
                {t('Barang {n}', { n: k + 1 })}
              </span>
              <Button
                sm
                disabled={rows.length === 1}
                onClick={() => {
                  setRows((rs) => rs.filter((_, j) => j !== k));
                  setErrors((es) => es.filter((_, j) => j !== k));
                }}
              >
                {t('Hapus')}
                <span className="sr-only"> {t('barang {n}', { n: k + 1 })}</span>
              </Button>
            </div>
            <label className="col-span-full grid min-w-0 gap-1.5">
              <span className="text-[14px] font-semibold">{t('Barang atau biaya')}</span>
              <Input value={r.name} maxLength={60} onChange={(ev) => set(k, { name: ev.target.value })} />
            </label>
            <label className="grid min-w-0 gap-1.5 sm:col-span-3">
              <span className="text-[14px] font-semibold">{t('Kategori')}</span>
              <Select value={r.category} onChange={(ev) => set(k, { category: ev.target.value as Row['category'] })}>
                <option value="belanja">{t('Belanja')}</option>
                <option value="operasional">{t('Operasional')}</option>
              </Select>
            </label>
            <label className="grid min-w-0 gap-1.5 sm:col-span-3">
              <span className="text-[14px] font-semibold">{t('Uang dari')}</span>
              <Select value={r.paidFrom} onChange={(ev) => set(k, { paidFrom: ev.target.value as Row['paidFrom'] })}>
                <option value="drawer">{t('Kas laci')}</option>
                <option value="other">{t('Bukan dari laci')}</option>
              </Select>
            </label>
            <label className="grid min-w-0 gap-1.5 sm:col-span-2">
              <span className="text-[14px] font-semibold">{t('Jumlah|barang')}</span>
              <Input
                value={r.quantity}
                inputMode="decimal"
                className="font-mono"
                onChange={(ev) => set(k, { quantity: ev.target.value.replace(/[^\d.,]/g, '') })}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 sm:col-span-2">
              <span className="text-[14px] font-semibold">{t('Satuan')}</span>
              <Select value={r.unit} onChange={(ev) => set(k, { unit: ev.target.value })}>
                {EXPENSE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </label>
            <label className="col-span-full grid min-w-0 gap-1.5 sm:col-span-2">
              <span className="text-[14px] font-semibold">{t('Harga total')}</span>
              <Input
                value={r.amount && Number(r.amount).toLocaleString('id-ID')}
                inputMode="numeric"
                maxLength={13}
                className="font-mono"
                onChange={(ev) => {
                  // The dots move as digits are typed: put the caret back after the same digit, not at the end.
                  const el = ev.target;
                  const before = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, '').length;
                  set(k, { amount: el.value.replace(/\D/g, '') });
                  requestAnimationFrame(() => {
                    let pos = 0;
                    for (let seen = 0; pos < el.value.length && seen < before; pos++) if (/\d/.test(el.value[pos])) seen++;
                    el.setSelectionRange(pos, pos);
                  });
                }}
              />
            </label>
            {errors[k] && (
              <p role="alert" className="col-span-full text-[14px] font-semibold text-error">
                {t(errors[k])}
              </p>
            )}
          </fieldset>
        ))}
        {rows.length < 200 && (
          <Button
            className="justify-self-start"
            onClick={() => setRows((rs) => [...rs, { name: '', category: 'belanja', quantity: '1', unit: 'pcs', amount: '', paidFrom: 'other' }])}
          >
            {t('Tambah barang')}
          </Button>
        )}
        <p className="flex justify-between border-t-[1.5px] border-ink pt-3 font-semibold">
          <span>{t('Total')}</span>
          <span className="font-mono">{money(total)}</span>
        </p>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </div>
    </Dialog>
  );
}

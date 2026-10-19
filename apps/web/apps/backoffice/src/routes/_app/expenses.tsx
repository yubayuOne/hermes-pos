import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isoDay } from '@hermes-pos/ui';
import { Button, Card, Dialog, Empty, Field, FormAlert, Input, Loading, Select, SkCard, Tag, dateLong, dateShort, money, time, useI18n } from '@hermes-pos/ui';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { Pagination } from '../../components/Pagination';
import { Stat } from '../../components/Stat';
import type { Expense, ExpenseItem } from '../../lib/types';
import { describeError } from '../../lib/errors';
import { addExpenseItems, cancelExpenseItem, listExpenses } from '../../server/expenses';
import { EXPENSE_UNITS, expenseCancelSchema, expenseItemSchema } from '../../lib/schemas';
import { useApp, useLock } from '../../lib/app';
import { useAction } from '../../lib/useAction';
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
 * D9: cashiers record expenses in the POS (migrations 040, 041). They count at once (043); the owner cancels an item with a
 * reason or adds items to any shift (073), and the shift's cash is recomputed in the database.
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
          'Kasir mencatat belanja dan biaya operasional di aplikasi; semua catatan satu shift jadi satu daftar. Barang yang salah dibatalkan dengan alasan, lalu dicatat ulang dengan Tambah barang.',
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
          <p className="mt-4 text-[14px] text-mute">{t('Termasuk koreksi pengeluaran lama: {amount}', { amount: money(data.totals.adjustments) })}</p>
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
  const { t, lang } = useI18n();
  const lock = useLock();
  const tz = useApp().business.timezone;
  const [cancelling, setCancelling] = useState<ExpenseItem | null>(null);
  const [adding, setAdding] = useState(false);
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
          <Button sm onClick={() => setAdding(true)} {...lock.props}>
            {lock.label(t('Tambah barang'))}
          </Button>
        </div>
      </div>
      {e.items.length > 0 && (
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
                <th scope="col">
                  <span className="sr-only">{t('Aksi')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {e.items.map((i) => (
                <tr key={i.id}>
                  <td data-l={t('Barang atau biaya')}>{i.name}</td>
                  <td data-l={t('Kategori')}>{t(CATEGORY[i.category])}</td>
                  <td data-l={t('Uang dari')}>{t(PAID_FROM[i.paidFrom])}</td>
                  <td data-l={t('Jumlah|barang')} className="num">
                    {qty(i.quantity)} {i.unit}
                  </td>
                  <td data-l={t('Harga total')} className="num">
                    {money(i.amount)}
                  </td>
                  <td data-l="" className="text-right">
                    <Button sm onClick={() => setCancelling(i)} {...lock.props}>
                      {t('Batalkan')}
                      <span className="sr-only"> {i.name}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {e.cancelled.length > 0 && (
        <ul className="mt-4 grid gap-1 border-t border-rule pt-3 text-[14px] text-mute" aria-label={t('Barang yang dibatalkan')}>
          {e.cancelled.map((i) => (
            <li key={i.id}>
              <span className="line-through">
                {i.name} · {money(i.amount)}
              </span>{' '}
              · {t('dibatalkan {date}: {reason}', { date: `${dateShort(i.cancelledAt, lang, tz)} ${time(i.cancelledAt, tz)}`, reason: i.reason })}
            </li>
          ))}
        </ul>
      )}
      {e.shiftOpen && <p className="mt-4 text-[15px] text-mute">{t('Kasir masih bisa menambah barang selama shift buka.')}</p>}
      {cancelling && <CancelDialog expense={e} item={cancelling} onClose={() => setCancelling(null)} />}
      {adding && <AddDialog expense={e} onClose={() => setAdding(false)} />}
    </Card>
  );
}

/** The item stops counting (and leaves the drawer's books if it was paid from there) but stays visible with the reason. */
function CancelDialog({ expense: e, item: i, onClose }: { expense: Expense; item: ExpenseItem; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [reason, setReason] = useState('');
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    const check = expenseCancelSchema.safeParse({ itemId: i.id, reason });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => cancelExpenseItem({ data: check.data }), { success: t('{name} dibatalkan.', { name: i.name }) });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Batalkan {name}?', { name: i.name })}
      description={
        i.paidFrom === 'drawer'
          ? t('{amount} tidak dihitung lagi dan kembali ke kas seharusnya shift {n}. Catatannya tetap terlihat.', { amount: money(i.amount), n: e.shiftNumber })
          : t('{amount} tidak dihitung lagi sebagai pengeluaran. Catatannya tetap terlihat.', { amount: money(i.amount) })
      }
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Kembali')}
          </Button>
          <Button type="submit" form="cancel-expense" variant="ink" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Batalkan barang')}
          </Button>
        </>
      }
    >
      <form id="cancel-expense" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Alasan')} help={t('Contoh: dicatat dua kali, nominal salah (catat ulang yang benar dengan Tambah barang).')}>
          <Input autoFocus maxLength={200} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

type Draft = { name: string; category: ExpenseItem['category']; quantity: string; unit: string; amount: string };
const blank = (): Draft => ({ name: '', category: 'belanja', quantity: '1', unit: 'pcs', amount: '' });

/** New items for this shift, all paid the same way. The database recomputes the total and the shift's cash. */
function AddDialog({ expense: e, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [paidFrom, setPaidFrom] = useState<ExpenseItem['paidFrom']>('other');
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: number, patch: Partial<Draft>) => {
    setRows((rs) => rs.map((r, j) => (j === k ? { ...r, ...patch } : r)));
    setErrors((es) => es.map((x, j) => (j === k ? '' : x)));
  };
  async function save() {
    const checks = rows.map((r) =>
      expenseItemSchema.safeParse({ ...r, quantity: Number(r.quantity.trim().replace(',', '.')), amount: Number(r.amount.replace(/\./g, '')) }),
    );
    const errs = checks.map((c) => (c.success ? '' : (c.error.issues[0]?.message ?? 'Data tidak valid.')));
    setErrors(errs);
    if (errs.some(Boolean)) return;
    const items = checks.map((c) => (c.success ? c.data : null)).filter((x) => x !== null);
    const res = await act.run(() => addExpenseItems({ data: { shiftId: e.shiftId, paidFrom, items } }), {
      success: t('Pengeluaran shift {n} ditambah.', { n: e.shiftNumber }),
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Tambah barang ke shift {n}', { n: e.shiftNumber })}
      description={
        e.shiftOpen
          ? t('Shift masih buka. Kas seharusnya di aplikasi kasir ikut berubah kalau dibayar dari laci.')
          : t('Shift sudah ditutup. Kalau dibayar dari laci, kas seharusnya dan selisih shift dihitung ulang.')
      }
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')} onClick={save}>
            {t('Simpan barang')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('Uang dari')}>
          <Select value={paidFrom} onChange={(ev) => setPaidFrom(ev.target.value === 'drawer' ? 'drawer' : 'other')}>
            <option value="other">{t('Bukan dari laci')}</option>
            <option value="drawer">{t('Kas laci')}</option>
          </Select>
        </Field>
        {rows.map((r, k) => (
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
            <label className="col-span-full grid min-w-0 gap-1.5 sm:col-span-2">
              <span className="text-[14px] font-semibold">{t('Kategori')}</span>
              <Select value={r.category} onChange={(ev) => set(k, { category: ev.target.value === 'operasional' ? 'operasional' : 'belanja' })}>
                <option value="belanja">{t('Belanja')}</option>
                <option value="operasional">{t('Operasional')}</option>
              </Select>
            </label>
            <label className="grid min-w-0 gap-1.5 sm:col-span-1">
              <span className="text-[14px] font-semibold">{t('Jumlah|barang')}</span>
              <Input
                value={r.quantity}
                inputMode="decimal"
                className="font-mono"
                onChange={(ev) => set(k, { quantity: ev.target.value.replace(/[^\d.,]/g, '') })}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 sm:col-span-1">
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
                onChange={(ev) => set(k, { amount: ev.target.value.replace(/\D/g, '') })}
              />
            </label>
            {errors[k] && (
              <p role="alert" className="col-span-full text-[14px] font-semibold text-error">
                {t(errors[k])}
              </p>
            )}
          </fieldset>
        ))}
        {rows.length < 30 && (
          <Button className="justify-self-start" onClick={() => setRows((rs) => [...rs, blank()])}>
            {t('Tambah baris')}
          </Button>
        )}
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </div>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isoDay } from '@hermes-pos/ui';
import { Button, Card, Dialog, Empty, Field, FormAlert, Input, Loading, Select, SkCard, Tag, dateLong, money, useI18n } from '@hermes-pos/ui';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { Pagination } from '../../components/Pagination';
import type { DayShift, Expense, ExpenseItem, Ingredient } from '../../lib/types';
import { listIngredients } from '../../server/ingredients';

import { getSummary } from '../../server/summary';
import { describeError } from '../../lib/errors';
import { addExpenseItems, listExpenses } from '../../server/expenses';
import { ExpenseItemDialog } from '../../components/ExpenseItemDialog';
import { BarangPicker, LAIN } from '../../components/BarangPicker';
import { getDay } from '../../server/closing';
import { OutletField } from '../../components/Filters';
import { EXPENSE_UNITS, expenseItemSchema } from '../../lib/schemas';
import { useApp, useLock } from '../../lib/app';
import { useAction } from '../../lib/useAction';
import { pageHead } from '../../lang';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { FilterBar } from '../../components/Filters';
import { type PeriodSearch, parsePeriod, periodError, periodRange } from '../../lib/period';

type Search = PeriodSearch & { outlet?: string };

export const Route = createFileRoute('/_app/expenses')({
  // The expense page opens on this month (owner's request, 7 Nov 2026).
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    period: parsePeriod(s).period ?? 'month',
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    // Kas Outlet is the sales of the same days and outlet (owner's definition, 7 Nov 2026); Sisa Kas is that minus the expenses.
    const [list, summary] = await Promise.all([
      listExpenses({ data: { outletId: deps.outlet ?? null, ...range, tz, before: null } }),
      getSummary({ data: { outletId: deps.outlet ?? null, from: range.from, to: range.to, today, tz } }),
    ]);
    return { ...list, range, today, tz, kasOutlet: summary.period.sales };
  },
  pendingMs: 150,
  pendingComponent: ExpensesLoading,
  head: ({ match }) => pageHead(match.context.lang, 'Pengeluaran|menu'),
  component: Expenses,
});

const PAID_FROM: Record<ExpenseItem['paidFrom'], string> = { drawer: 'Kas Laci', other: 'Kas Outlet' };
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
 * D9: the owner records expenses here, on a shift of the day they were paid (077: the POS no longer records them, and they
 * never come out of the drawer). They count at once; the owner cancels an item with a reason or adds items to any shift.
 */
function Expenses() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/expenses' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }) });
  const app = useApp();
  const periodLabel = usePeriodLabel(search, data.range);
  const lock = useLock();
  const [recording, setRecording] = useState(false);
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
    <Page title={t('Pengeluaran')}>
      <FilterBar
        outlet={<OutletFilter value={search.outlet ?? null} onChange={(id) => set({ outlet: id ?? undefined })} />}
        active={search.period && search.period !== 'month' ? 1 : 0}
        summary={[app.outlets.find((o) => o.id === search.outlet)?.name ?? t('Semua outlet'), periodLabel].join(' · ')}
        current={search}
        validate={(v) => periodError(v, data.today)}
        onApply={set}
        action={
          <Button variant="fire" onClick={() => setRecording(true)} {...lock.props}>
            {lock.label(t('Catat pengeluaran'))}
          </Button>
        }
      >
        {(d) => <PeriodFilter value={d.values} range={data.range} today={data.today} onChange={d.set} />}
      </FilterBar>
      {recording && <AddDialog outletId={search.outlet ?? null} today={data.today} onClose={() => setRecording(false)} />}

      <Card className="mt-5" aria-label={t('Ringkasan kas')}>
        <p className="font-mono text-small text-mute">{periodLabel}</p>
        <dl className="mt-4 grid gap-5 sm:grid-cols-3">
          <div>
            <dt className="font-mono text-small text-mute">{t('Kas Outlet')}</dt>
            <dd className="mt-1 font-display text-2xl font-extrabold break-words">{money(data.kasOutlet)}</dd>
          </div>
          <div>
            <dt className="font-mono text-small text-mute">{t('Pengeluaran')}</dt>
            <dd className="mt-1 font-display text-2xl font-extrabold break-words">{money(data.totals.total)}</dd>
          </div>
          <div>
            <dt className="font-mono text-small text-mute">{t('Sisa Kas')}</dt>
            <dd className={`mt-1 font-display text-2xl font-extrabold break-words ${data.kasOutlet - data.totals.total < 0 ? 'text-error' : ''}`}>
              {money(data.kasOutlet - data.totals.total)}
            </dd>
          </div>
        </dl>
        {data.totals.adjustments !== 0 && (
          <p className="mt-4 text-small text-mute">{t('Termasuk koreksi pengeluaran lama: {amount}', { amount: money(data.totals.adjustments) })}</p>
        )}
      </Card>

      {data.rows.length === 0 ? (
        <Empty className="mt-5" title={t('Belum ada pengeluaran di periode ini.')}>
          {t('Tekan Catat pengeluaran untuk mulai.')}
        </Empty>
      ) : (
        <div className="mt-6 grid gap-8">
          {byDay.map(([day, list]) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-[1.5px] border-ink pb-2">
                <span className="font-display text-heading font-extrabold tracking-[-0.02em]">{dateLong(`${day}T12:00:00Z`, lang, 'UTC')}</span>
                <span className="font-mono text-body">{money(data.dayTotals[day] ?? 0)}</span>
              </h2>
              <div className="mt-4 grid gap-5">
                {list.map((e) => (
                  <ExpenseCard key={e.id} expense={e} />
                ))}
              </div>
            </section>
          ))}
          <div className="grid justify-items-center gap-3">
            <p className="font-mono text-small text-mute">{t('{total} catatan shift di periode ini', { total: data.total })}</p>
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
  const lock = useLock();
  const [editing, setEditing] = useState<ExpenseItem | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Card as="article" aria-label={t('Pengeluaran shift {n}, {amount}', { n: e.shiftNumber, amount: money(e.total) })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-small text-mute">
            {t('Shift {n}', { n: e.shiftNumber })} · {e.outletName}
            {e.cashierName ? ` · ${e.cashierName}` : ''}
          </p>
          <p className="mt-1 font-display text-[28px] font-extrabold leading-none tracking-[-0.03em]">{money(e.total)}</p>
          {e.drawerTotal > 0 && <p className="mt-1.5 text-body text-mute">{t('{amount} dari kas laci', { amount: money(e.drawerTotal) })}</p>}
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
                  <td data-l={t('Barang atau biaya')}>
                    {i.name}
                    {i.ingredientId && <span className="block text-small text-mute">{i.ingredientName}</span>}
                    <details className="text-small text-mute">
                      <summary className="cursor-pointer">{t('Lihat detail')}</summary>
                      <p>
                        {t('Sumber uang')}: {t(PAID_FROM[i.paidFrom])}
                      </p>
                    </details>
                  </td>
                  <td data-l={t('Kategori')}>{i.category ?? '—'}</td>
                  <td data-l={t('Jumlah|barang')} className="num">
                    {qty(i.quantity)} {i.unit}
                  </td>
                  <td data-l={t('Harga total')} className="num">
                    {money(i.amount)}
                  </td>
                  <td data-l="" className="text-right">
                    <Button sm onClick={() => setEditing(i)} {...lock.props}>
                      {t('Ubah')}
                      <span className="sr-only"> {i.name}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ExpenseItemDialog item={editing} shiftNumber={e.shiftNumber} outletId={e.outletId} onClose={() => setEditing(null)} />}
      {adding && <AddDialog shift={{ id: e.shiftId, number: e.shiftNumber }} onClose={() => setAdding(false)} />}
    </Card>
  );
}



/** `ingredientId` is a barang's id, LAIN for "Barang lain" (typed name and unit), or '' until one is picked. */
type Draft = { ingredientId: string; name: string; unit: string; quantity: string; amount: string };
const blank = (): Draft => ({ ingredientId: '', name: '', unit: 'pcs', quantity: '1', amount: '' });

/**
 * New items for a shift. With `shift` (Tambah barang on a shift's card) that shift; without it (Catat pengeluaran) the owner
 * picks an outlet, a date, and one of that day's shifts, the latest by default: every expense belongs to a shift.
 * The owner says whether the money came from the drawer: from the drawer it leaves that shift's cash (087). The database recomputes the total.
 */
function AddDialog({ shift, outletId, today, onClose }: { shift?: { id: string; number: number }; outletId?: string | null; today?: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const app = useApp();
  const act = useAction();
  const [outlet, setOutlet] = useState<string | null>(outletId ?? app.outlets[0]?.id ?? null);
  const [date, setDate] = useState(today ?? '');
  const [shifts, setShifts] = useState<DayShift[] | null>(null);
  // The day the shifts come from: the chosen date, or the nearest earlier day with a shift (a purchase on a closed day).
  const [shiftDay, setShiftDay] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [paidFrom, setPaidFrom] = useState<'drawer' | 'other'>('other');
  const [barang, setBarang] = useState<Ingredient[]>([]);
  useEffect(() => {
    if (!outlet) return;
    let live = true;
    listIngredients({ data: { outletId: outlet } }).then((list) => live && setBarang(list), () => undefined);
    return () => {
      live = false;
    };
  }, [outlet]);
  useEffect(() => {
    if (shift || !outlet || !date) return;
    let live = true;
    setShifts(null);
    (async () => {
      for (let back = 0; back <= 7; back++) {
        const day = new Date(Date.parse(`${date}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
        const d = await getDay({ data: { outletId: outlet, date: day } });
        if (!live) return;
        if (d.shifts.length || back === 7) {
          setShiftDay(day);
          setShifts(d.shifts);
          setShiftId(d.shifts[d.shifts.length - 1]?.id ?? '');
          return;
        }
      }
    })().catch(() => live && setShifts([]));
    return () => {
      live = false;
    };
  }, [shift, outlet, date]);
  const target = shift ?? (shifts ?? []).filter((s) => s.id === shiftId).map((s) => ({ id: s.id, number: s.shiftNumber }))[0] ?? null;
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: number, patch: Partial<Draft>) => {
    setRows((rs) => rs.map((r, j) => (j === k ? { ...r, ...patch } : r)));
    setErrors((es) => es.map((x, j) => (j === k ? '' : x)));
  };
  async function save() {
    const checks = rows.map((r) => {
      const free = r.ingredientId === LAIN;
      if (!r.ingredientId) return { success: false as const, error: { issues: [{ message: 'Pilih barang.' }] } };
      if (free && !r.name.trim()) return { success: false as const, error: { issues: [{ message: 'Tulis nama barang atau biaya.' }] } };
      if (free && !EXPENSE_UNITS.includes(r.unit as (typeof EXPENSE_UNITS)[number])) return { success: false as const, error: { issues: [{ message: 'Pilih satuan.' }] } };
      return expenseItemSchema.safeParse({
        name: free ? r.name.trim() : '',
        unit: free ? r.unit : '',
        quantity: Number(r.quantity.trim().replace(',', '.')),
        amount: Number(r.amount.replace(/\./g, '')),
        ingredientId: free ? null : r.ingredientId,
      });
    });
    const errs = checks.map((c) => (c.success ? '' : (c.error.issues[0]?.message ?? 'Data tidak valid.')));
    setErrors(errs);
    if (errs.some(Boolean) || !target) return;
    const items = checks.map((c) => (c.success ? c.data : null)).filter((x) => x !== null);
    const res = await act.run(() => addExpenseItems({ data: { shiftId: target.id, paidFrom, items } }), {
      success: t('Pengeluaran shift {n} ditambah.', { n: target.number }),
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={shift ? t('Tambah barang ke shift {n}', { n: shift.number }) : t('Catat pengeluaran')}
      description={t('Dari laci: kas shift berkurang.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')} disabled={!target} onClick={save}>
            {t('Simpan')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!shift && (
          <div className="grid gap-3 sm:grid-cols-3">
            <OutletField all={false} value={outlet} onChange={setOutlet} />
            <Field label={t('Tanggal')}>
              <Input type="date" max={today} value={date} onChange={(ev) => ev.target.value && setDate(ev.target.value)} />
            </Field>
            <Field label={t('Shift')}>
              <Select value={shiftId} disabled={!shifts?.length} onChange={(ev) => setShiftId(ev.target.value)}>
                {shifts === null && <option value="">{t('Memuat...')}</option>}
                {shifts?.length === 0 && <option value="">{t('Tidak ada shift')}</option>}
                {shifts?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t('Shift {n}', { n: s.shiftNumber })} · {s.cashierName}
                  </option>
                ))}
              </Select>
            </Field>
            {shifts?.length === 0 && (
              <p role="status" className="col-span-full text-small text-mute">
                {t('Tidak ada shift dalam 7 hari sampai {date}.', { date: dateLong(`${date}T12:00:00Z`, lang, 'UTC') })}
              </p>
            )}
            {!!shifts?.length && shiftDay !== date && (
              <p role="status" className="col-span-full text-small text-mute">
                {t('Tidak ada shift pada tanggal ini. Dicatat di shift {date}.', { date: dateLong(`${shiftDay}T12:00:00Z`, lang, 'UTC') })}
              </p>
            )}
          </div>
        )}
        <Field label={t('Sumber uang')}>
          <Select value={paidFrom} onChange={(ev) => setPaidFrom(ev.target.value === 'drawer' ? 'drawer' : 'other')}>
            <option value="drawer">{t('Kas Laci')}</option>
            <option value="other">{t('Kas Outlet')}</option>
          </Select>
        </Field>
        {rows.map((r, k) => {
          const picked = barang.find((b) => b.id === r.ingredientId);
          const free = r.ingredientId === LAIN;
          return (
            <fieldset key={k} className="grid gap-3 rounded border border-rule bg-slip p-3 sm:grid-cols-6">
              <legend className="sr-only">{t('Barang {n}', { n: k + 1 })}</legend>
              <div className="col-span-full flex items-center justify-between gap-3">
                <span className="font-semibold">{t('Barang {n}', { n: k + 1 })}</span>
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
              <Field label={t('Barang')} className="col-span-full sm:col-span-3">
                <BarangPicker items={barang} value={r.ingredientId} onChange={(v) => set(k, { ingredientId: v })} allowFree />
              </Field>
              {free && (
                <Field label={t('Nama')} className="col-span-full sm:col-span-3">
                  <Input value={r.name} maxLength={60} onChange={(ev) => set(k, { name: ev.target.value })} />
                </Field>
              )}
              <Field label={picked ? `${t('Jumlah')} (${picked.baseUnit})` : t('Jumlah')} className="sm:col-span-2">
                <Input
                  value={r.quantity}
                  inputMode="decimal"
                  className="font-mono"
                  onChange={(ev) => set(k, { quantity: ev.target.value.replace(/[^\d.,]/g, '') })}
                />
              </Field>
              {free && (
                <Field label={t('Satuan')} className="sm:col-span-2">
                  <Select value={r.unit} onChange={(ev) => set(k, { unit: ev.target.value })}>
                    {EXPENSE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t('Harga total')} className="col-span-full sm:col-span-2">
                <Input
                  value={r.amount && Number(r.amount).toLocaleString('id-ID')}
                  inputMode="numeric"
                  maxLength={13}
                  className="font-mono"
                  onChange={(ev) => set(k, { amount: ev.target.value.replace(/\D/g, '') })}
                />
              </Field>
              {errors[k] && (
                <p role="alert" className="col-span-full text-small font-semibold text-error">
                  {t(errors[k])}
                </p>
              )}
            </fieldset>
          );
        })}
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

/**
 * The Laporan in four parts (prompt 5): every grouping and every insight sentence, as plain data. No DOM and no
 * translation here: the page formats numbers and dates, and insight sentences are keys with typed parameters.
 * Days are YYYY-MM-DD in the business time zone (the server converts them, owner_report_detail, 098).
 */

export type Bill = { day: string; hour: number; total: number; method: string; customer: string; subtotal: number };
export type ItemRow = { day: string; name: string; qty: number; value: number };
export type ExpenseRow = { day: string; category: string; name: string; quantity: number; unit: string; amount: number; paidFrom: string };
export type ReportDetail = { bills: Bill[]; items: ItemRow[]; expenses: ExpenseRow[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const rows = (v: unknown): unknown[][] => (Array.isArray(v) ? v.filter((x): x is unknown[] => Array.isArray(x)) : []);

/** Reads the compact rows from owner_report_detail. A row that does not fit its shape is left out. */
export function toDetail(raw: unknown): ReportDetail {
  const r = (raw ?? {}) as Record<string, unknown>;
  const bills: Bill[] = [];
  for (const [at, total, method, customer, subtotal] of rows(r.bills)) {
    const t = num(total);
    const s = num(subtotal);
    if (typeof at !== 'string' || !STAMP.test(at) || t === null || s === null || text(method) === null || text(customer) === null) continue;
    bills.push({ day: at.slice(0, 10), hour: Number(at.slice(11, 13)), total: t, method: method as string, customer: customer as string, subtotal: s });
  }
  const items: ItemRow[] = [];
  for (const [day, name, qty, value] of rows(r.items)) {
    const q = num(qty);
    const v = num(value);
    if (typeof day !== 'string' || !DAY.test(day) || text(name) === null || q === null || v === null) continue;
    items.push({ day, name: name as string, qty: q, value: v });
  }
  const expenses: ExpenseRow[] = [];
  for (const [day, category, name, quantity, unit, amount, paidFrom] of rows(r.expenses)) {
    const q = num(quantity);
    const a = num(amount);
    if (typeof day !== 'string' || !DAY.test(day) || text(category) === null || text(name) === null || q === null || a === null || text(unit) === null || text(paidFrom) === null) continue;
    expenses.push({ day, category: category as string, name: name as string, quantity: q, unit: unit as string, amount: a, paidFrom: paidFrom as string });
  }
  return { bills, items, expenses };
}

// ---------------------------------------------------------------- days, weeks, months
export const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDay(d, 1)) out.push(d);
  return out;
}
/** Monday of the week that holds the day (weeks run Monday to Sunday). */
export const weekStart = (d: string) => addDay(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
/** Monday = 0 ... Sunday = 6. */
export const weekdayIndex = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
export const monthEnd = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export type Week = { start: string; end: string; days: string[]; partial: boolean };
/** Weeks that touch the range, each cut to the range. A week cut by the range is partial (shown with *). */
export function weeksOf(from: string, to: string): Week[] {
  const out: Week[] = [];
  for (let s = weekStart(from); s <= to; s = addDay(s, 7)) {
    const e = addDay(s, 6);
    out.push({ start: s, end: e, days: daysBetween(s > from ? s : from, e < to ? e : to), partial: s < from || e > to });
  }
  return out;
}

export type Month = { key: string; from: string; to: string; days: string[]; partial: boolean };
/** Calendar months that touch the range, each cut to it. A month that is not whole is partial (shown with *). */
export function monthsOf(from: string, to: string): Month[] {
  const out: Month[] = [];
  for (let s = `${from.slice(0, 7)}-01`; s <= to; s = addDay(monthEnd(s), 1)) {
    const end = monthEnd(s);
    const f = s > from ? s : from;
    const t = end < to ? end : to;
    out.push({ key: s.slice(0, 7), from: f, to: t, days: daysBetween(f, t), partial: s < from || end > to });
  }
  return out;
}

// ---------------------------------------------------------------- sales
const inDays = (days: string[]) => new Set(days);
export const billsIn = (bills: Bill[], days: string[]) => {
  const s = inDays(days);
  return bills.filter((b) => s.has(b.day));
};
export const itemsIn = (items: ItemRow[], days: string[]) => {
  const s = inDays(days);
  return items.filter((i) => s.has(i.day));
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const share = (a: number, b: number) => (b ? (a / b) * 100 : 0);

export type SalesStats = {
  count: number;
  sales: number;
  portions: number;
  activeDays: number;
  bestDay: { day: string; total: number } | null;
  avgPerBill: number;
  avgPerDay: number;
  portionsPerBill: number;
  menus: number;
  cashCount: number;
  cash: number;
  qrisCount: number;
  qris: number;
  freeCount: number;
  freeSubtotal: number;
};
/** Sales of the bills and items given (already cut to the days wanted). Free bills count as bills and add 0 to sales. */
export function salesStats(bills: Bill[], items: ItemRow[], days: string[]): SalesStats {
  const perDay = dailyOmzet(bills, days);
  const active = perDay.filter((d) => d.count > 0);
  const best = active.reduce<{ day: string; total: number } | null>((b, d) => (!b || d.total > b.total ? { day: d.day, total: d.total } : b), null);
  const count = bills.length;
  const sales = sum(bills.map((b) => b.total));
  const portions = sum(items.map((i) => i.qty));
  const cash = bills.filter((b) => b.method === 'cash');
  const qris = bills.filter((b) => b.method === 'qris');
  const free = bills.filter((b) => b.total === 0);
  return {
    count,
    sales,
    portions,
    activeDays: active.length,
    bestDay: best,
    avgPerBill: count ? sales / count : 0,
    avgPerDay: active.length ? sales / active.length : 0,
    portionsPerBill: count ? portions / count : 0,
    menus: new Set(items.map((i) => menuKey(i.name))).size,
    cashCount: cash.length,
    cash: sum(cash.map((b) => b.total)),
    qrisCount: qris.length,
    qris: sum(qris.map((b) => b.total)),
    freeCount: free.length,
    freeSubtotal: sum(free.map((b) => b.subtotal)),
  };
}

/** Net sales per calendar day, days with no bill included (0). */
export function dailyOmzet(bills: Bill[], days: string[]): { day: string; count: number; total: number }[] {
  return days.map((day) => {
    const xs = bills.filter((b) => b.day === day);
    return { day, count: xs.length, total: sum(xs.map((b) => b.total)) };
  });
}

/** Bills per hour of the day (0 to 23), with their share of the bills. */
export function hoursOf(bills: Bill[]): { hour: number; count: number; total: number; share: number }[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const xs = bills.filter((b) => b.hour === hour);
    return { hour, count: xs.length, total: sum(xs.map((b) => b.total)), share: share(xs.length, bills.length) };
  });
}

/** Monday to Sunday: calendar days, bills, average sales per calendar day. */
export function weekdaysOf(bills: Bill[], days: string[]) {
  return Array.from({ length: 7 }, (_, i) => {
    const cal = days.filter((d) => weekdayIndex(d) === i);
    const xs = bills.filter((b) => weekdayIndex(b.day) === i);
    const total = sum(xs.map((b) => b.total));
    return { index: i, calendarDays: cal.length, count: xs.length, total, avgPerDay: cal.length ? total / cal.length : 0 };
  });
}

/** Sales per day as a grid: Monday to Sunday (rows) by week (columns). null = outside the period (grey). */
export function heatmapOf(bills: Bill[], weeks: Week[]): (number | null)[][] {
  const perDay = new Map<string, number>();
  for (const b of bills) perDay.set(b.day, (perDay.get(b.day) ?? 0) + b.total);
  return Array.from({ length: 7 }, (_, row) =>
    weeks.map((w) => {
      const d = addDay(w.start, row);
      return w.days.includes(d) ? (perDay.get(d) ?? 0) : null;
    }),
  );
}

export type Customer = { name: string; count: number; total: number };
/** The name typed on the bill. Blank, "Umum", "Tamu" (any case) and names of digits only (table numbers) are left out. */
export const isNamedCustomer = (raw: string) => {
  const n = raw.trim();
  return n !== '' && !/^(umum|tamu)$/i.test(n) && !/^\d+$/.test(n);
};
export function topCustomers(bills: Bill[], n = 10): Customer[] {
  const byKey = new Map<string, Customer>();
  for (const b of bills) {
    if (!isNamedCustomer(b.customer)) continue;
    const key = b.customer.trim().toLowerCase();
    const c = byKey.get(key) ?? { name: b.customer.trim(), count: 0, total: 0 };
    c.count += 1;
    c.total += b.total;
    byKey.set(key, c);
  }
  return [...byKey.values()].sort((a, z) => z.total - a.total || a.name.localeCompare(z.name)).slice(0, n);
}

/** Menus with the same name (also from two outlets) are one menu. */
export const menuKey = (name: string) => name.trim().toLowerCase();
export type MenuRank = { name: string; qty: number; value: number; share: number };
export function menuRanking(items: ItemRow[]): { rows: MenuRank[]; qty: number; value: number } {
  const byKey = new Map<string, { name: string; qty: number; value: number }>();
  for (const i of items) {
    const k = menuKey(i.name);
    const m = byKey.get(k) ?? { name: i.name.trim(), qty: 0, value: 0 };
    m.qty += i.qty;
    m.value += i.value;
    byKey.set(k, m);
  }
  const qty = sum([...byKey.values()].map((m) => m.qty));
  const value = sum([...byKey.values()].map((m) => m.value));
  const rows = [...byKey.values()]
    .sort((a, z) => z.qty - a.qty || a.name.localeCompare(z.name))
    .map((m) => ({ ...m, share: share(m.qty, qty) }));
  return { rows, qty, value };
}

export type WeekStat = {
  week: Week;
  activeDays: number;
  count: number;
  portions: number;
  sales: number;
  perDay: number;
  vsPrev: number | null;
  cashCount: number;
  qrisCount: number;
};
/** Week by week: bills, portions, sales, average per active day, change against the week before (per active day). */
export function weekStats(bills: Bill[], items: ItemRow[], weeks: Week[]): WeekStat[] {
  const stats = weeks.map((week) => {
    const bs = billsIn(bills, week.days);
    const ds = dailyOmzet(bs, week.days).filter((d) => d.count > 0).length;
    const sales = sum(bs.map((b) => b.total));
    return {
      week,
      activeDays: ds,
      count: bs.length,
      portions: sum(itemsIn(items, week.days).map((i) => i.qty)),
      sales,
      perDay: ds ? sales / ds : 0,
      vsPrev: null as number | null,
      cashCount: bs.filter((b) => b.method === 'cash').length,
      qrisCount: bs.filter((b) => b.method === 'qris').length,
    };
  });
  return stats.map((s, i) => ({ ...s, vsPrev: i > 0 && stats[i - 1].perDay ? ((s.perDay - stats[i - 1].perDay) / stats[i - 1].perDay) * 100 : null }));
}

/** Full weeks only (a week cut by the range is not compared). */
export const fullWeeks = (stats: WeekStat[]) => stats.filter((s) => !s.week.partial && s.activeDays > 0);

/** Menu by week: portions for the menus given (each menu a row, each week a column). */
export function menuByWeek(items: ItemRow[], weeks: Week[], menus: string[]): number[][] {
  return menus.map((name) => {
    const k = menuKey(name);
    return weeks.map((w) => sum(itemsIn(items, w.days).filter((i) => menuKey(i.name) === k).map((i) => i.qty)));
  });
}

/** The top menus of each week (name and portions). */
export function topPerWeek(items: ItemRow[], weeks: Week[], n: number) {
  return weeks.map((w) => {
    const r = menuRanking(itemsIn(items, w.days)).rows.slice(0, n);
    return { week: w, menus: r };
  });
}

/** Portions per active day of each week for the menus given (the trend that ignores quiet days). */
export function trendPerActiveDay(bills: Bill[], items: ItemRow[], weeks: Week[], menus: string[]): number[][] {
  const active = weeks.map((w) => dailyOmzet(billsIn(bills, w.days), w.days).filter((d) => d.count > 0).length);
  return menuByWeek(items, weeks, menus).map((row) => row.map((q, i) => (active[i] ? q / active[i] : 0)));
}

// ---------------------------------------------------------------- menu movers (insight rule)
/** A menu moves when its portions per calendar day change by at least 50% between the two halves of the period.
 *  Only a menu that sold at least 1 portion per day in one of the halves counts; the period needs two days. */
export const MOVE_RATIO = 1.5;
export function menuMovers(items: ItemRow[], days: string[]) {
  if (days.length < 2) return { up: null, down: null };
  const mid = Math.floor(days.length / 2);
  const first = days.slice(0, mid);
  const second = days.slice(mid);
  const { rows } = menuRanking(items);
  const rate = (name: string, ds: string[]) => {
    const k = menuKey(name);
    return sum(itemsIn(items, ds).filter((i) => menuKey(i.name) === k).map((i) => i.qty)) / ds.length;
  };
  let up: { name: string; from: number; to: number } | null = null;
  let down: { name: string; from: number; to: number } | null = null;
  for (const m of rows) {
    const r1 = rate(m.name, first);
    const r2 = rate(m.name, second);
    if (Math.max(r1, r2) < 1) continue;
    if (r2 > r1 * MOVE_RATIO && (!up || r2 - r1 > up.to - up.from)) up = { name: m.name, from: r1, to: r2 };
    if (r2 * MOVE_RATIO < r1 && (!down || r1 - r2 > down.from - down.to)) down = { name: m.name, from: r1, to: r2 };
  }
  return { up, down };
}

// ---------------------------------------------------------------- expenses
export type ExpenseStats = { total: number; entries: number; dayCount: number; avgPerDay: number; operasional: number; belanja: number; drawer: number; other: number };
export function expenseStats(expenses: ExpenseRow[], days: string[]): ExpenseStats {
  const total = sum(expenses.map((e) => e.amount));
  const dayCount = new Set(expenses.map((e) => e.day)).size;
  return {
    total,
    entries: expenses.length,
    dayCount,
    avgPerDay: days.length ? total / days.length : 0,
    operasional: sum(expenses.filter((e) => e.category === 'operasional').map((e) => e.amount)),
    belanja: sum(expenses.filter((e) => e.category === 'belanja').map((e) => e.amount)),
    drawer: sum(expenses.filter((e) => e.paidFrom === 'drawer').map((e) => e.amount)),
    other: sum(expenses.filter((e) => e.paidFrom !== 'drawer').map((e) => e.amount)),
  };
}
export const expensesIn = (expenses: ExpenseRow[], days: string[]) => {
  const s = inDays(days);
  return expenses.filter((e) => s.has(e.day));
};
export function dailyExpenses(expenses: ExpenseRow[], days: string[]): { day: string; total: number }[] {
  return days.map((day) => ({ day, total: sum(expenses.filter((e) => e.day === day).map((e) => e.amount)) }));
}
export function expenseRanking(expenses: ExpenseRow[]) {
  const byKey = new Map<string, { name: string; count: number; total: number }>();
  for (const e of expenses) {
    const k = menuKey(e.name);
    const x = byKey.get(k) ?? { name: e.name.trim(), count: 0, total: 0 };
    x.count += 1;
    x.total += e.amount;
    byKey.set(k, x);
  }
  const total = sum([...byKey.values()].map((x) => x.total));
  const rows = [...byKey.values()].sort((a, z) => z.total - a.total || a.name.localeCompare(z.name)).map((x) => ({ ...x, share: share(x.total, total) }));
  return { rows, total };
}

// ---------------------------------------------------------------- insights
export type InsightParam = { kind: 'money' | 'pct' | 'day' | 'month' | 'hour' | 'weekday' | 'num' | 'text'; value: number | string };
export type Insight = { key: string; params: Record<string, InsightParam>; source: string };
const pMoney = (v: number): InsightParam => ({ kind: 'money', value: v });
const pPct = (v: number): InsightParam => ({ kind: 'pct', value: v });
const pDay = (v: string): InsightParam => ({ kind: 'day', value: v });
const pNum = (v: number): InsightParam => ({ kind: 'num', value: v });
const pText = (v: string): InsightParam => ({ kind: 'text', value: v });

/** Sentences that the data supports. Each one names its source chapter. Nothing is written when the data is missing. */
export function insightsOf(input: {
  bills: Bill[];
  items: ItemRow[];
  expenses: ExpenseRow[];
  days: string[];
  weeks: Week[];
  months: Month[];
}): Insight[] {
  const { bills, items, expenses, days, weeks, months } = input;
  // Average sales per active day of each month that has sales (the months to compare).
  const monthSales = months
    .map((m) => ({ key: m.key, avgPerDay: salesStats(billsIn(bills, m.days), [], m.days).avgPerDay, active: salesStats(billsIn(bills, m.days), [], m.days).activeDays }))
    .filter((m) => m.active > 0);
  const out: Insight[] = [];
  const s = salesStats(bills, items, days);
  if (s.count === 0) return out;

  const full = fullWeeks(weekStats(bills, items, weeks));
  if (full.length >= 2) {
    const best = full.reduce((b, w) => (w.perDay > b.perDay ? w : b));
    const low = full.reduce((b, w) => (w.perDay < b.perDay ? w : b));
    const span = { start: pDay(best.week.start), end: pDay(best.week.end) };
    out.push({ key: 'Minggu penuh terbaik: {start} sampai {end}, rata-rata {avg} per hari berjualan.', params: { ...span, avg: pMoney(best.perDay) }, source: 'BAB 1.5' });
    out.push({
      key: 'Minggu penuh terendah: {start} sampai {end}, rata-rata {avg} per hari berjualan.',
      params: { start: pDay(low.week.start), end: pDay(low.week.end), avg: pMoney(low.perDay) },
      source: 'BAB 1.5',
    });
    const first = full[0].perDay;
    const last = full[full.length - 1].perDay;
    if (first > 0) {
      const change = ((last - first) / first) * 100;
      out.push({
        key: change >= 0 ? 'Rata-rata omzet per hari naik {pct} dari minggu penuh pertama ke minggu penuh terakhir.' : 'Rata-rata omzet per hari turun {pct} dari minggu penuh pertama ke minggu penuh terakhir.',
        params: { pct: pPct(Math.abs(change)) },
        source: 'BAB 1.5',
      });
    }
  }

  if (monthSales.length >= 2) {
    const best = monthSales.reduce((b, m) => (m.avgPerDay > b.avgPerDay ? m : b));
    const low = monthSales.reduce((b, m) => (m.avgPerDay < b.avgPerDay ? m : b));
    out.push({ key: 'Bulan dengan rata-rata omzet per hari tertinggi: {month}, {avg} per hari.', params: { month: { kind: 'month', value: best.key }, avg: pMoney(best.avgPerDay) }, source: 'BAB 1.2' });
    out.push({ key: 'Bulan dengan rata-rata omzet per hari terendah: {month}, {avg} per hari.', params: { month: { kind: 'month', value: low.key }, avg: pMoney(low.avgPerDay) }, source: 'BAB 1.2' });
  }

  const menu = menuRanking(items);
  if (menu.rows.length > 0) {
    const top = menu.rows[0];
    out.push({ key: 'Menu terlaris: {name}, {qty} porsi, {pct} dari total porsi.', params: { name: pText(top.name), qty: pNum(top.qty), pct: pPct(top.share) }, source: 'BAB 1.4' });
  }
  const movers = menuMovers(items, days);
  if (movers.up) out.push({ key: 'Menu yang paling naik: {name}, dari {from} porsi per hari menjadi {to} porsi per hari.', params: { name: pText(movers.up.name), from: pNum(round2(movers.up.from)), to: pNum(round2(movers.up.to)) }, source: 'BAB 1.7' });
  if (movers.down) out.push({ key: 'Menu yang paling turun: {name}, dari {from} porsi per hari menjadi {to} porsi per hari.', params: { name: pText(movers.down.name), from: pNum(round2(movers.down.from)), to: pNum(round2(movers.down.to)) }, source: 'BAB 1.7' });

  const hours = hoursOf(bills).filter((h) => h.count > 0).sort((a, z) => z.count - a.count || a.hour - z.hour);
  if (hours.length >= 2) {
    out.push({
      key: 'Jam paling ramai: {h1} dan {h2}, masing-masing {p1} dan {p2} dari nota.',
      params: { h1: { kind: 'hour', value: hours[0].hour }, h2: { kind: 'hour', value: hours[1].hour }, p1: pPct(hours[0].share), p2: pPct(hours[1].share) },
      source: 'BAB 1.9',
    });
  } else if (hours.length === 1) {
    out.push({ key: 'Jam paling ramai: {h1}, {p1} dari nota.', params: { h1: { kind: 'hour', value: hours[0].hour }, p1: pPct(hours[0].share) }, source: 'BAB 1.9' });
  }
  const weekdays = weekdaysOf(bills, days).filter((w) => w.total > 0);
  if (weekdays.length > 0) {
    const busiest = weekdays.reduce((b, w) => (w.avgPerDay > b.avgPerDay ? w : b));
    out.push({ key: 'Hari paling ramai: {weekday}, rata-rata {avg} per hari.', params: { weekday: { kind: 'weekday', value: busiest.index }, avg: pMoney(busiest.avgPerDay) }, source: 'BAB 1.9' });
  }

  if (s.sales > 0) out.push({ key: 'QRIS {pct} dari omzet.', params: { pct: pPct(share(s.qris, s.sales)) }, source: 'BAB 1.3' });
  if (s.freeCount > 0) out.push({ key: 'Nota gratis: {n} nota, nilai harga menu {value}.', params: { n: pNum(s.freeCount), value: pMoney(s.freeSubtotal) }, source: 'BAB 1.3' });

  const ex = expenseStats(expenses, days);
  if (ex.total > 0) {
    out.push({ key: 'Pengeluaran {pct} dari omzet.', params: { pct: pPct(share(ex.total, s.sales)) }, source: 'BAB 3.1' });
    const top = expenseRanking(expenses).rows[0];
    out.push({ key: 'Item pengeluaran terbesar: {name}, {amount}.', params: { name: pText(top.name), amount: pMoney(top.total) }, source: 'BAB 2.4' });
    out.push({ key: 'Belanja bahan {pct} dari total pengeluaran.', params: { pct: pPct(share(ex.belanja, ex.total)) }, source: 'BAB 2.3' });
  }
  return out;
}
const round2 = (v: number) => Math.round(v * 100) / 100;

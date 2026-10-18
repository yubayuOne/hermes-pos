/** Period filter of Ringkasan and Pengeluaran (owner's choice, 18 Oct 2026). Days are YYYY-MM-DD in the business time zone. */
export type Period = 'today' | 'month' | 'last-month' | 'custom';
export type PeriodSearch = { period?: Period; from?: string; to?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day: Date.parse rolls 2026-02-30 over to March, so compare the round trip. */
export const isDay = (v: string) => DAY.test(v) && new Date(Date.parse(v) || 0).toISOString().slice(0, 10) === v;
const day = (v: unknown) => (typeof v === 'string' && isDay(v) ? v : undefined);

/** Reads the URL; anything else (old `7d`, `30d`, a broken date) falls back to today. */
export const parsePeriod = (s: Record<string, unknown>): PeriodSearch => ({
  period: (['month', 'last-month', 'custom'] as const).find((p) => p === s.period),
  from: day(s.from),
  to: day(s.to),
});

/** This month runs to today; last month is the whole previous calendar month. */
export function periodRange(s: PeriodSearch, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (s.period === 'month') return { from: monthStart, to: today };
  if (s.period === 'last-month') {
    const end = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return { from: `${end.slice(0, 7)}-01`, to: end };
  }
  if (s.period === 'custom' && s.from && s.to) return { from: s.from, to: s.to };
  return { from: today, to: today };
}

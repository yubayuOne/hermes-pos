import type { BusinessType, PlanCode, TimeZone } from './types';

// Prices in rupiah (owner's request, 7 Nov 2026). `list` is the struck-through price, `price` is what the buyer pays.
// The database computes the amount due with the same numbers (plan_quote, migration 109).
export const TRIAL_DAYS = 14;
export const PAID_PLANS = [
  { code: 'daily', name: 'Harian', unit: 'hari', months: 0, days: 1, list: 15_000, price: 7_000, extraOutlet: 3_000 },
  { code: 'weekly', name: 'Mingguan', unit: 'minggu', months: 0, days: 7, list: 100_000, price: 47_000, extraOutlet: 23_000 },
  { code: 'monthly', name: 'Bulanan', unit: 'bulan', months: 1, days: 0, list: 500_000, price: 147_000, extraOutlet: 99_000 },
  { code: 'annual', name: 'Tahunan', unit: 'tahun', months: 12, days: 0, list: 1_500_000, price: 697_000, extraOutlet: 1_188_000 },
] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type PaidCode = PaidPlan['code'];

export const PLAN_NAME: Record<PlanCode, string> = {
  trial: 'Trial',
  daily: 'Harian',
  weekly: 'Mingguan',
  monthly: 'Bulanan',
  semiannual: '6 bulan',
  annual: 'Tahunan',
  unlimited: 'Unlimited',
};

/** Unknown or trial codes fall back to Bulanan. */
export const planByCode = (c: string): PaidPlan => PAID_PLANS.find((p) => p.code === c) ?? PAID_PLANS[2];
/** What the buyer saves against the struck-through price. */
export const saving = (p: PaidPlan) => p.list - p.price;
/** Amount due: the plan price plus each extra outlet at the plan's extra price (same as plan_quote). */
export const quote = (p: PaidPlan, extra: number) => p.price + extra * p.extraOutlet;

/** Extra outlet price of the Bulanan plan (kept for the copy that quotes one month). */
export const EXTRA_OUTLET = planByCode('monthly').extraOutlet;

/** New expiry date (YYYY-MM-DD) shown before payment. Months clamp to the month's last day, as Postgres does (31 Jan + 1 = 28 Feb). */
export function addPeriod(day: string, p: PaidPlan) {
  return p.months > 0 ? addMonths(day, p.months) : addDays(day, p.days);
}
export function addDays(day: string, days: number) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** New expiry date (YYYY-MM-DD) shown before payment. Clamps to the month's last day, as Postgres does (31 Jan + 1 = 28 Feb). */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

// Payment and support details (owner, 18 Oct 2026). Square brackets: still to be given by the owner.
export const BANK = { bank: 'BCA', account: '0865432122', holder: '[ATAS NAMA]' };
export const SUPPORT = { whatsapp: '0851-5858-3200', email: 'yubayu2004@gmail.com', hours: 'pukul 07.00–24.00 WIB setiap hari' };
/** Landing page. VITE_LANDING_URL wins; otherwise localhost while developing and the real domain in a build. */
export const LANDING_URL = import.meta.env?.VITE_LANDING_URL ?? (import.meta.env?.DEV ? 'http://localhost:3000' : 'https://hermes-pos.com');
/** Terms of service and privacy policy live on the landing page. */
export const TERMS_URL = `${LANDING_URL}/terms`;
export const PRIVACY_URL = `${LANDING_URL}/privacy`;

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'kafe', label: 'Kafe' },
  { value: 'restoran', label: 'Restoran' },
  { value: 'kedai', label: 'Warung makan' },
  { value: 'bakeri', label: 'Bakery' },
  { value: 'lainnya', label: 'Lainnya' },
];
export const TIMEZONES: { value: TimeZone; label: string }[] = [
  { value: 'Asia/Jakarta', label: 'WIB' },
  { value: 'Asia/Makassar', label: 'WITA' },
  { value: 'Asia/Jayapura', label: 'WIT' },
];

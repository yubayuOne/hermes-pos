import type { BusinessType, PlanCode, TimeZone } from './types';

// Prices in rupiah (PRD section 6). The database computes the amount due with the same numbers (plan_quote).
export const EXTRA_OUTLET = 99_000;
export const MONTHLY = 149_000;
export const PAID_PLANS = [
  { code: 'monthly', name: 'Bulanan', months: 1, price: 149_000 },
  { code: 'semiannual', name: '6 bulan', months: 6, price: 699_000 },
  { code: 'annual', name: 'Tahunan', months: 12, price: 1_399_000 },
] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type PaidCode = PaidPlan['code'];

export const PLAN_NAME: Record<PlanCode, string> = { trial: 'Trial', monthly: 'Bulanan', semiannual: '6 bulan', annual: 'Tahunan' };

export const planByCode = (c: string): PaidPlan => PAID_PLANS.find((p) => p.code === c) ?? PAID_PLANS[0];
export const perMonth = (p: PaidPlan) => Math.round(p.price / p.months);
export const saving = (p: PaidPlan) => MONTHLY * p.months - p.price;
/** Approximate extra outlet charge: Rp99.000 x plan months (DESIGN.md H4 item 1). */
export const quote = (p: PaidPlan, extra: number) => p.price + extra * EXTRA_OUTLET * p.months;

/** New expiry date (YYYY-MM-DD) shown before payment. Clamps to the month's last day, as Postgres does (31 Jan + 1 = 28 Feb). */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

// Payment and support details (owner, 18 Oct 2026). Square brackets: still to be given by the owner.
export const BANK = { bank: 'BCA', account: '0865432122', holder: '[ATAS NAMA]' };
export const SUPPORT = { whatsapp: '0851-5858-3200', email: 'yubayu2004@gmail.com', hours: 'pukul 07.00–24.00 WIB setiap hari' };
/** Landing page (hermes-pos.com). Defaults to localhost for testing; set VITE_LANDING_URL for production (PRD open question 18). */
export const LANDING_URL = import.meta.env?.VITE_LANDING_URL ?? 'http://localhost:3000';
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

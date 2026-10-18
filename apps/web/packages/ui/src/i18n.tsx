import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Two languages (DESIGN.md A8). Interface text is written in Indonesian in the markup and looked up in an
 * English dictionary keyed by that Indonesian text, so the two versions stay side by side. Text built from
 * variables uses {name} placeholders. A key may carry a context after "|" ("Kasir|menu") when one Indonesian
 * word needs two English words; the context is never shown. User data (product names) never goes through t().
 */
export type Lang = 'id' | 'en';
export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;

export const LANG_KEY = 'hermes-pos-lang';

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (text: string, vars?: Vars) => string };
const I18nContext = createContext<Ctx | null>(null);

export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function LangProvider({ initial, dict, children }: { initial: Lang; dict: Dict; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // Storage can be blocked (private mode); the cookie below still carries the choice.
    }
    document.cookie = `${LANG_KEY}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }, []);
  const t = useCallback(
    (text: string, vars?: Vars) => {
      if (lang === 'id') return fill(text.split('|')[0], vars);
      const en = dict[text];
      if (en === undefined && import.meta.env?.DEV) console.warn(`[i18n] missing EN: ${text}`);
      return fill(en ?? text.split('|')[0], vars);
    },
    [lang, dict],
  );
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside LangProvider');
  return ctx;
}

/** After hydration: a choice saved in localStorage but missing from the cookie (older visit) wins once. */
export function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' || v === 'id' ? v : null;
  } catch {
    return null;
  }
}

// ---------- Formats (DESIGN.md A8) ----------
export const DEFAULT_TZ = 'Asia/Jakarta';
const locale = (l: Lang) => (l === 'en' ? 'en-US' : 'id-ID');

/** Rp4.280.000 in both languages. */
export function money(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return (v < 0 ? '-Rp' : 'Rp') + Math.abs(v).toLocaleString('id-ID');
}
/** 4.280.000 without the currency, for receipts. */
export function amount(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('id-ID');
}
/** 63,9 (id) or 63.9 (en). */
export function decimal(n: number, lang: Lang, digits = 1): string {
  return n.toLocaleString(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** Chart labels: 3,1jt or 3.1M; 610 rb stays 610. */
export function compactMillions(n: number, lang: Lang): string {
  return decimal(n / 1_000_000, lang, 1) + (lang === 'en' ? 'M' : 'jt');
}

function parts(d: Date | string, lang: Lang, tz: string, opts: Intl.DateTimeFormatOptions) {
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d;
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locale(lang), { timeZone: tz, ...opts }).formatToParts(date)) out[p.type] = p.value;
  return out;
}
/** Min, 11 Okt 2026 / Sun, 11 Oct 2026 */
export function dateLong(d: Date | string, lang: Lang, tz = DEFAULT_TZ): string {
  const p = parts(d, lang, tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.weekday}, ${p.day} ${p.month.replace('.', '')} ${p.year}`;
}
/** 11 Okt 2026 */
export function dateShort(d: Date | string, lang: Lang, tz = DEFAULT_TZ): string {
  const p = parts(d, lang, tz, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.day} ${p.month.replace('.', '')} ${p.year}`;
}
/** 13.05 in both languages. */
export function time(d: Date | string, tz = DEFAULT_TZ): string {
  const p = parts(d, 'id', tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}.${p.minute}`;
}
/** Short weekday (Sen / Mon). */
export function weekday(d: Date | string, lang: Lang, tz = DEFAULT_TZ): string {
  return parts(d, lang, tz, { weekday: 'short' }).weekday;
}
/** 5 sampai 11 Okt 2026 / 5 to 11 Oct 2026 */
export function dateRange(a: string, b: string, lang: Lang, tz = DEFAULT_TZ): string {
  const sep = lang === 'en' ? ' to ' : ' sampai ';
  if (a === b) return dateShort(a, lang, tz);
  const pa = parts(a, lang, tz, { day: 'numeric', month: 'short', year: 'numeric' });
  const pb = parts(b, lang, tz, { day: 'numeric', month: 'short', year: 'numeric' });
  if (pa.year === pb.year && pa.month === pb.month) return `${pa.day}${sep}${dateShort(b, lang, tz)}`;
  if (pa.year === pb.year) return `${pa.day} ${pa.month.replace('.', '')}${sep}${dateShort(b, lang, tz)}`;
  return dateShort(a, lang, tz) + sep + dateShort(b, lang, tz);
}
/** YYYY-MM-DD in a time zone. */
export function isoDay(d: Date, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
/** Adds whole days to a YYYY-MM-DD string. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Whole days between two YYYY-MM-DD strings (b - a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

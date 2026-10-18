import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EN } from './en';

/*
 * Two languages (PRD X1). Indonesian text is written in the code and is also the dictionary key; the English
 * dictionary maps it. Keys with a "|context" suffix disambiguate the same Indonesian word. Placeholders use
 * {name}. Values in the dictionary can be [singular, plural] chosen by {n}.
 *
 * `t` works outside React too (error messages, receipts), reading the language last chosen.
 * Components call useT() so they re-render when the language changes.
 */
export type Lang = 'id' | 'en';
export type Vars = Record<string, string | number>;

const KEY = '@hermes-pos/lang';
let current: Lang = 'id';
const missing = new Set<string>();

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

export function t(key: string, vars?: Vars): string {
  const plain = key.includes('|') ? key.slice(0, key.indexOf('|')) : key;
  if (current === 'id') return fill(plain, vars);
  const hit = EN[key] ?? EN[plain];
  if (hit === undefined) {
    if (__DEV__ && !missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] missing EN: ${key}`);
    }
    return fill(plain, vars);
  }
  if (Array.isArray(hit)) return fill(Number(vars?.n) === 1 ? hit[0] : hit[1], vars);
  return fill(hit, vars);
}

export const getLang = () => current;

// ---------------------------------------------------------------- formats (DESIGN A8)
const DAY = { id: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const MON = {
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const group = (n: number) =>
  Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Rp84.200, -Rp1.800. Same in both languages. */
export const money = (n: number) => `${n < 0 ? '-' : ''}Rp${group(n)}`;
/** 84.200 without Rp (product cards). */
export const num = (n: number) => `${n < 0 ? '-' : ''}${group(n)}`;
const d2 = (n: number) => String(n).padStart(2, '0');
const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));
/** 13.05 */
export const fmtTime = (v: string | number | Date) => {
  const d = toDate(v);
  return `${d2(d.getHours())}.${d2(d.getMinutes())}`;
};
/** 11 Okt 2026 */
export const fmtDate = (v: string | number | Date) => {
  const d = toDate(v);
  return `${d.getDate()} ${MON[current][d.getMonth()]} ${d.getFullYear()}`;
};
/** Min, 11 Okt 2026 */
export const fmtDay = (v: string | number | Date) => {
  const d = toDate(v);
  return `${DAY[current][d.getDay()]}, ${fmtDate(d)}`;
};
/** Min, 11 Okt 2026 12.58 */
export const fmtDateTime = (v: string | number | Date) => `${fmtDay(v)} ${fmtTime(v)}`;
/** Min 11/10 13.05, for receipts where space is short. */
export const fmtShort = (v: string | number | Date) => {
  const d = toDate(v);
  return `${DAY[current][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${fmtTime(d)}`;
};
/** Business date "2026-10-11" without time zone shifts. */
export const fmtBusinessDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? fmtDate(new Date(y, m - 1, d)) : iso;
};

// ---------------------------------------------------------------- provider
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'id', setLang: () => undefined });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'en' || v === 'id') {
          current = v;
          setLangState(v);
        }
      })
      .catch(() => undefined);
  }, []);
  const setLang = useCallback((l: Lang) => {
    current = l;
    setLangState(l);
    void AsyncStorage.setItem(KEY, l).catch(() => undefined);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Subscribe to the language. Returns `t` so call sites read naturally. */
export function useT() {
  const { lang, setLang } = useContext(Ctx);
  return { t, lang, setLang };
}

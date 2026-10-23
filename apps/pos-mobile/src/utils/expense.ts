import { ExpenseCategory, ExpenseItem } from '../types/domain';

/** Same list as the check in migration 040. */
export const EXPENSE_UNITS = ['kg', 'gr', 'L', 'ml', 'pcs', 'pack', 'dus', 'botol', 'sachet', 'ikat', 'karung', 'lusin'] as const;

/** One row while the cashier types: text as typed, checked on submit. */
export interface ExpenseLine {
  name: string;
  category: ExpenseCategory;
  quantity: string;
  unit: string;
  amount: string;
}
export const emptyLine = (category: ExpenseCategory = 'belanja'): ExpenseLine => ({ name: '', category, quantity: '1', unit: 'pcs', amount: '' });

/** "1,5" or "1.5" -> 1.5. At most 3 decimals, more than 0, at most 100.000. Null when not valid. */
export function parseQuantity(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= 100000 ? n : null;
}

/** Rupiah as typed, "25.000" or "25000" -> 25000. Whole rupiah, more than 0, at most 100 juta. Null when not valid. */
export function parseAmount(s: string): number | null {
  const v = s.trim().replace(/\./g, '');
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= 100_000_000 ? n : null;
}

/** Field errors per row (Indonesian source text, translated by the caller), or the items to send when all rows are valid. */
export function checkLines(lines: ExpenseLine[]): { errors: Array<Partial<Record<keyof ExpenseLine, string>>>; items: ExpenseItem[] | null } {
  const items: ExpenseItem[] = [];
  const errors = lines.map((l) => {
    const e: Partial<Record<keyof ExpenseLine, string>> = {};
    const name = l.name.trim();
    const quantity = parseQuantity(l.quantity);
    const amount = parseAmount(l.amount);
    if (!name) e.name = 'Tulis nama barang atau biaya.';
    else if (name.length > 60) e.name = 'Nama barang maksimal 60 huruf.';
    if (quantity === null) e.quantity = 'Jumlah lebih dari 0, maksimal 3 angka di belakang koma.';
    if (!(EXPENSE_UNITS as readonly string[]).includes(l.unit)) e.unit = 'Pilih satuan.';
    if (amount === null) e.amount = 'Harga total lebih dari Rp0, tanpa koma.';
    if (!Object.keys(e).length) items.push({ name, category: l.category, quantity: quantity!, unit: l.unit, amount: amount! });
    return e;
  });
  return { errors, items: lines.length && items.length === lines.length ? items : null };
}

import { ExpenseCategory, ExpenseItem } from '../types/domain';

/** Same list as the check in migration 040, plus g (a barang's own unit, 101). */
export const EXPENSE_UNITS = ['kg', 'gr', 'g', 'L', 'ml', 'pcs', 'pack', 'dus', 'botol', 'sachet', 'ikat', 'karung', 'lusin'] as const;

/** `ingredientId` of a barang, LAIN for "Barang lain" (name, category, and unit typed here), or '' until one is picked. */
export const LAIN = '__lain';

/** One row while the cashier types: text as typed, checked on submit. */
export interface ExpenseLine {
  name: string;
  category: ExpenseCategory;
  ingredientId: string;
  quantity: string;
  unit: string;
  amount: string;
}
export const emptyLine = (): ExpenseLine => ({ name: '', category: '', ingredientId: '', quantity: '1', unit: 'pcs', amount: '' });

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

/**
 * Field errors per row (Indonesian source text, translated by the caller), or the items to send when all rows are valid.
 * A barang row sends only the barang, quantity and amount: the server takes its name, category and unit from the barang.
 * A "Barang lain" row sends its own name, category (optional) and unit.
 */
export function checkLines(lines: ExpenseLine[]): { errors: Array<Partial<Record<keyof ExpenseLine, string>>>; items: ExpenseItem[] | null } {
  const items: ExpenseItem[] = [];
  const errors = lines.map((l) => {
    const e: Partial<Record<keyof ExpenseLine, string>> = {};
    const name = l.name.trim();
    const quantity = parseQuantity(l.quantity);
    const amount = parseAmount(l.amount);
    const free = l.ingredientId === LAIN;
    if (!l.ingredientId) e.ingredientId = 'Pilih barang.';
    if (free && !name) e.name = 'Tulis nama barang atau biaya.';
    else if (name.length > 60) e.name = 'Nama barang maksimal 60 huruf.';
    if (free && !(EXPENSE_UNITS as readonly string[]).includes(l.unit)) e.unit = 'Pilih satuan.';
    if (quantity === null) e.quantity = 'Jumlah lebih dari 0, maksimal 3 angka di belakang koma.';
    if (amount === null) e.amount = 'Harga total lebih dari Rp0, tanpa koma.';
    if (!Object.keys(e).length)
      items.push({
        name,
        category: free ? l.category.trim() || null : null,
        ingredientId: free || !l.ingredientId ? null : l.ingredientId,
        quantity: quantity!,
        unit: l.unit,
        amount: amount!,
      });
    return e;
  });
  return { errors, items: lines.length && items.length === lines.length ? items : null };
}

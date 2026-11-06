import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { expenseAddSchema, expenseCategorySchema, expenseEditSchema, expenseItemRefSchema, expenseListSchema, parser } from '../lib/schemas';
import type { ActionResult, ExpenseCategory, ExpenseList } from '../lib/types';
import { toExpenseList } from './normalize';
import { startOf } from './summary';

/** Expenses from the POS (migrations 040, 041, 043, 045): one page of shift records from `from` to `to` (business days), newest first. Totals cover the whole period. */
export const listExpenses = createServerFn({ method: 'GET' })
  .validator(parser(expenseListSchema))
  .handler(async ({ data }): Promise<ExpenseList> => {
    const { readRpc } = await import('./supabase.server');
    return toExpenseList(
      await readRpc('owner_list_expenses', {
        p_outlet_id: data.outletId,
        p_from: startOf(data.from, data.tz),
        p_to: startOf(addDays(data.to, 1), data.tz),
        p_before: data.before,
        p_limit: 50,
      }),
    );
  });

/** Changes one item of a shift's expenses (102): the barang, name, category, unit, quantity, amount, and stock amount. */
export const updateExpenseItem = createServerFn({ method: 'POST' })
  .validator(parser(expenseEditSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_update_expense_item', {
      p_item_id: data.itemId,
      p_ingredient_id: data.ingredientId ?? null,
      p_name: data.name,
      p_category: data.category,
      p_unit: data.unit,
      p_quantity: data.quantity,
      p_amount: data.amount,
      p_stock_qty: null,
    });
    return res.ok ? { ok: true } : res;
  });

/** Deletes one item of a shift's expenses (102). Its stock and the shift's cash go back; nothing is kept on record. */
export const deleteExpenseItem = createServerFn({ method: 'POST' })
  .validator(parser(expenseItemRefSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_delete_expense_item', { p_item_id: data.itemId });
    return res.ok ? { ok: true } : res;
  });

/** Adds items to a shift's expenses (073), from the drawer or not; the shift's cash follows. */
export const addExpenseItems = createServerFn({ method: 'POST' })
  .validator(parser(expenseAddSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_add_expense_items', { p_shift_id: data.shiftId, p_paid_from: data.paidFrom, p_items: data.items });
    return res.ok ? { ok: true } : res;
  });

/** The business's expense categories, active and switched off (099). */
export const listExpenseCategories = createServerFn({ method: 'GET' }).handler(async (): Promise<ExpenseCategory[]> => {
  const { readRpc } = await import('./supabase.server');
  const raw = (await readRpc<{ id: string; name: string; active: boolean }[] | null>('owner_list_expense_categories', {})) ?? [];
  return raw.map((c) => ({ id: String(c.id), name: String(c.name), active: c.active === true }));
});

/** Adds a category (no id) or renames and switches one on or off (099). */
export const saveExpenseCategory = createServerFn({ method: 'POST' })
  .validator(parser(expenseCategorySchema))
  .handler(async ({ data }): Promise<ActionResult<string>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<string>('owner_save_expense_category', { p_id: data.id ?? null, p_name: data.name, p_active: data.active });
    return res.ok ? { ok: true, data: res.data } : res;
  });

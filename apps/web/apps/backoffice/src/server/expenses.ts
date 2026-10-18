import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { expenseListSchema, expenseUpdateSchema, parser } from '../lib/schemas';
import type { ActionResult, ExpenseList } from '../lib/types';
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

/** Replaces the shift's items. Totals, the cash book, and a closed shift's expected cash are recomputed in the database. */
export const updateExpense = createServerFn({ method: 'POST' })
  .validator(parser(expenseUpdateSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_update_expense', { p_expense_id: data.id, p_items: data.items });
    return res.ok ? { ok: true } : res;
  });

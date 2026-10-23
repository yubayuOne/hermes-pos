import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { expenseAddSchema, expenseCancelSchema, expenseListSchema, parser } from '../lib/schemas';
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

/** Cancels one item (073): it stops counting but stays on record with the reason; the shift's cash follows. */
export const cancelExpenseItem = createServerFn({ method: 'POST' })
  .validator(parser(expenseCancelSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_cancel_expense_item', { p_item_id: data.itemId, p_reason: data.reason });
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

import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { expenseAddSchema, expenseCancelSchema, expenseListSchema, expenseRefSchema, linkExpenseItemsSchema, parser } from '../lib/schemas';
import type { ActionResult, ExpenseList, ExpenseStockLink } from '../lib/types';
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

/** Records belanja items as one stock purchase (089). No cash moves: the expense already counted. The server refuses items older than 90 days. */
export const linkExpenseItems = createServerFn({ method: 'POST' })
  .validator(parser(linkExpenseItemsSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_link_expense_items', { p_outlet_id: data.outletId, p_lines: data.lines });
    return res.ok ? { ok: true } : res;
  });

/** Which items of one expense record already went into stock, and as what (089). */
export const listExpenseStockLinks = createServerFn({ method: 'GET' })
  .validator(parser(expenseRefSchema))
  .handler(async ({ data }): Promise<ExpenseStockLink[]> => {
    const { readRpc } = await import('./supabase.server');
    const raw = (await readRpc<Record<string, unknown>[] | null>('owner_stock_links_for_expense', { p_expense_id: data.expenseId })) ?? [];
    return raw.map((r) => ({
      expenseItemId: String(r.expenseItemId ?? ''),
      purchaseId: String(r.purchaseId ?? ''),
      ingredientId: String(r.ingredientId ?? ''),
      ingredientName: String(r.ingredientName ?? ''),
      packs: Number(r.packs ?? 0),
      active: r.active === true,
    }));
  });

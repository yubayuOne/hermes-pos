import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { adjustmentSchema, balanceListSchema, parser } from '../lib/schemas';
import type { ActionResult, ShiftBalanceList } from '../lib/types';
import { toShiftBalanceList } from './normalize';
import { startOf } from './summary';

/** Shifts opened in the period (business days), newest first, 50 a page, with their adjustments (migration 071). */
export const listBalances = createServerFn({ method: 'GET' })
  .validator(parser(balanceListSchema))
  .handler(async ({ data }): Promise<ShiftBalanceList> => {
    const { readRpc } = await import('./supabase.server');
    return toShiftBalanceList(
      await readRpc('owner_list_shift_balances', {
        p_outlet_id: data.outletId,
        p_from: startOf(data.from, data.tz),
        p_to: startOf(addDays(data.to, 1), data.tz),
        p_page: data.page,
      }),
    );
  });

/** Adds one balancing line. The database writes the cash book for cash lines and recomputes a closed shift's variance. */
export const addAdjustment = createServerFn({ method: 'POST' })
  .validator(parser(adjustmentSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_add_shift_adjustment', {
      p_shift_id: data.shiftId,
      p_kind: data.kind,
      p_amount: data.amount,
      p_category: data.category,
      p_reason: data.reason,
    });
    return res.ok ? { ok: true } : res;
  });

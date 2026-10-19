import { createServerFn } from '@tanstack/react-start';
import { cashMovementSchema, dayCloseSchema, parser } from '../lib/schemas';
import type { ActionResult, DayClose } from '../lib/types';
import { toDayClose } from './normalize';

/** One outlet, one business date: every shift's cash and QRIS reconciliation and the day's checks (073). */
export const getDay = createServerFn({ method: 'GET' })
  .validator(parser(dayCloseSchema))
  .handler(async ({ data }): Promise<DayClose> => {
    const { readRpc } = await import('./supabase.server');
    return toDayClose(await readRpc('owner_day_close', { p_outlet_id: data.outletId, p_date: data.date }));
  });

/** Cash put into or taken out of a drawer (073). The cash book and a closed shift's variance follow. */
export const addCashMovement = createServerFn({ method: 'POST' })
  .validator(parser(cashMovementSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_add_cash_movement', {
      p_shift_id: data.shiftId,
      p_direction: data.direction,
      p_amount: data.amount,
      p_reason: data.reason,
    });
    return res.ok ? { ok: true } : res;
  });

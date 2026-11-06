import { createServerFn } from '@tanstack/react-start';
import { cashMovementSchema, dayCloseSchema, parser, shiftListSchema } from '../lib/schemas';
import type { ActionResult, DayClose, ShiftList } from '../lib/types';
import { toDayClose, toDayShift } from './normalize';

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

/** The shifts of a period, ten a page, newest first; total counts every shift of the period (104). */
export const listShifts = createServerFn({ method: 'GET' })
  .validator(parser(shiftListSchema))
  .handler(async ({ data }): Promise<ShiftList> => {
    const { readRpc } = await import('./supabase.server');
    const raw = await readRpc<{ total?: unknown; rows?: unknown[] } | null>('owner_list_shifts', {
      p_outlet_id: data.outletId,
      p_from: data.from,
      p_to: data.to,
      p_page: data.page,
    });
    return { total: Number(raw?.total ?? 0), rows: (raw?.rows ?? []).map((r) => toDayShift(r as Record<string, unknown>)) };
  });

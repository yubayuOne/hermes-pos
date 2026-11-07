import { createServerFn } from '@tanstack/react-start';
import { incomeEditSchema, incomeIdSchema, incomeListSchema, incomeSchema, parser } from '../lib/schemas';
import type { ActionResult, OutletIncome, OutletIncomeList } from '../lib/types';

type Row = Record<string, unknown>;
const toIncome = (r: Row): OutletIncome => ({
  id: String(r.id),
  outletId: String(r.outletId),
  businessDate: String(r.businessDate),
  amount: Number(r.amount) || 0,
  reason: String(r.reason ?? ''),
  createdAt: String(r.createdAt),
});

/** Money into the outlet from outside the shifts (104): one page of ten, newest first; sum and total cover the period. */
export const listOutletIncome = createServerFn({ method: 'GET' })
  .validator(parser(incomeListSchema))
  .handler(async ({ data }): Promise<OutletIncomeList> => {
    const { readRpc } = await import('./supabase.server');
    const r = await readRpc<Row>('owner_list_outlet_income', {
      p_outlet_id: data.outletId,
      p_from: data.from,
      p_to: data.to,
      p_page: data.page,
    });
    return { total: Number(r.total) || 0, sum: Number(r.sum) || 0, rows: ((r.rows as Row[]) ?? []).map(toIncome) };
  });

export const addOutletIncome = createServerFn({ method: 'POST' })
  .validator(parser(incomeSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_add_outlet_income', {
      p_outlet_id: data.outletId,
      p_business_date: data.businessDate,
      p_amount: data.amount,
      p_reason: data.reason,
    });
    return res.ok ? { ok: true } : res;
  });

export const updateOutletIncome = createServerFn({ method: 'POST' })
  .validator(parser(incomeEditSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_update_outlet_income', {
      p_id: data.id,
      p_business_date: data.businessDate,
      p_amount: data.amount,
      p_reason: data.reason,
    });
    return res.ok ? { ok: true } : res;
  });

export const deleteOutletIncome = createServerFn({ method: 'POST' })
  .validator(parser(incomeIdSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_delete_outlet_income', { p_id: data.id });
    return res.ok ? { ok: true } : res;
  });

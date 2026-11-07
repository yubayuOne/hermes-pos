import { createServerFn } from '@tanstack/react-start';
import { opnameListSchema, opnameSaveSchema, parser } from '../lib/schemas';
import type { ActionResult, OpnameRow } from '../lib/types';
import { toOpnameRow } from './normalize';

/** The Stock Opname sheet of one day: every counted barang of the outlet, with its opening, incoming, out, and difference (106). */
export const listStockOpname = createServerFn({ method: 'GET' })
  .validator(parser(opnameListSchema))
  .handler(async ({ data }): Promise<OpnameRow[]> => {
    const { readRpc } = await import('./supabase.server');
    const rows = await readRpc<Record<string, unknown>[]>('owner_list_stock_opname', { p_outlet_id: data.outletId, p_date: data.date });
    return (rows ?? []).map(toOpnameRow);
  });

/** Saves the counted rows of one day (106). The database checks the counts, the first opening, and the barang. */
export const saveStockOpname = createServerFn({ method: 'POST' })
  .validator(parser(opnameSaveSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_save_stock_opname', {
      p_outlet_id: data.outletId,
      p_date: data.date,
      p_rows: data.rows.map((r) => ({ ingredientId: r.ingredientId, opening: r.opening, in: r.in, out: r.out, closing: r.closing, note: r.note })),
    });
    return res.ok ? { ok: true } : res;
  });

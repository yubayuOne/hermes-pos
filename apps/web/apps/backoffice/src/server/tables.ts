import { createServerFn } from '@tanstack/react-start';
import { outletRefSchema, parser, tableActiveSchema, tableSchema } from '../lib/schemas';
import type { ActionResult, OutletTable } from '../lib/types';
import { toTable } from './normalize';

type Row = Record<string, unknown>;

/** The tables of one outlet, with whether each has a held bill and since when (091). */
export const listTables = createServerFn({ method: 'GET' })
  .validator(parser(outletRefSchema))
  .handler(async ({ data }): Promise<OutletTable[]> => {
    const { readRpc } = await import('./supabase.server');
    return ((await readRpc<Row[] | null>('list_tables', { p_outlet_id: data.outletId })) ?? []).map(toTable);
  });

/** Creates (no id) or renames a table. Renaming a table with a held bill is refused by the database. Returns the id. */
export const saveTable = createServerFn({ method: 'POST' })
  .validator(parser(tableSchema))
  .handler(async ({ data }): Promise<ActionResult<string>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<string>('owner_save_table', { p_outlet_id: data.outletId, p_id: data.id ?? null, p_name: data.name });
    return res.ok ? { ok: true, data: res.data } : res;
  });

/** Turns a table on or off. A table with a held bill cannot be turned off (091). */
export const setTableActive = createServerFn({ method: 'POST' })
  .validator(parser(tableActiveSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_set_table_active', { p_id: data.id, p_active: data.active });
    return res.ok ? { ok: true } : res;
  });

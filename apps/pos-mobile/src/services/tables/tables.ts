import { supabase } from '../supabase/client';
import { getCache, setCache } from '../cache/cache';

export type TableRow = { id: string; name: string; occupied: boolean; since: string | null; heldTotal: number };

const key = (outletId: string) => `tables:${outletId}`;

/** The outlet's active tables (list_tables, migration 091). Kept on the phone so the list still opens offline. */
export async function fetchTables(outletId: string): Promise<TableRow[]> {
  const { data, error } = await supabase.rpc('list_tables', { p_outlet_id: outletId });
  if (error) throw error;
  const rows = ((data as any[]) ?? [])
    .filter((r) => r.isActive !== false)
    .map((r) => ({ id: r.id as string, name: r.name as string, occupied: !!r.occupied, since: (r.since as string) ?? null, heldTotal: Number(r.heldTotal ?? 0) }));
  await setCache(key(outletId), rows);
  return rows;
}

export const cachedTables = (outletId: string) => getCache<TableRow[]>(key(outletId));

/** Moves a held bill to a free table on the server. Needs internet; the server refuses an occupied table. */
export async function moveHeldBill(transactionId: string, tableName: string) {
  const { error } = await supabase.rpc('move_held_bill', { p_transaction_id: transactionId, p_table_name: tableName });
  if (error) throw error;
}

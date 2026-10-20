import { supabase } from '../supabase/client';
import { localDb } from './db';
import { DashboardSummary, toBillItem, toBillRow, toCashSummary, toDashboard, toRefunds } from '../transaction/repository';
import { RecalledBill, toRecalledBill, toRemainingItems } from '../transaction/heldBills';
import { SalesReport, toSalesReport } from '../report/report';
import { CartItem, Refund, TransactionItemSummary, TransactionSummary } from '../../types/domain';

/**
 * Whole shifts on the phone (offline architecture, stage 3; migrations 055 and 057): every bill of the shift from any
 * phone, the items of each, refunds, the server's report, kas laci, the dashboard figures and what a recall of
 * each held bill needs. syncShift refreshes one; readShift never touches the network. Bills still in this phone's queue
 * are not in here: the screens add them on top (they are not on the server).
 */
export interface ShiftData {
  bills: TransactionSummary[];
  items: Record<string, TransactionItemSummary[]>;
  refunds: Refund[];
  report: SalesReport;
  /** Null until migration 057 is applied on the server. */
  cash: { cashIn: number; cashOut: number; expectedCash: number } | null;
  dashboard: DashboardSummary | null;
  held: Record<string, HeldBill>;
  syncedAt: string;
}

/** A held bill as the server last sent it: what a recall puts on screen, and what is left for the next split part. */
export type HeldBill = RecalledBill & { remaining: Array<CartItem & { remainingDiscount: number }> };

/** Snapshots not synced for this long are dropped: closed shifts older than the 24 h refund window are never opened. */
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const running = new Map<string, Promise<void>>();

/** Downloads the shift when it changed. One run per shift at a time. */
export function syncShift(shiftId: string, outletId: string): Promise<void> {
  const busy = running.get(shiftId);
  if (busy) return busy;
  const run = (async () => {
    const db = await localDb();
    const known = await db.getFirstAsync<{ version: string }>('select version from shift_snapshots where shift_id = ?', [shiftId]);
    const { data, error } = await supabase.rpc('pos_shift_snapshot', { p_shift_id: shiftId, p_version: known?.version ?? null });
    if (error) throw error;
    const s: any = data ?? {};
    const now = new Date().toISOString();
    if (s.unchanged) await db.runAsync('update shift_snapshots set synced_at = ? where shift_id = ?', [now, shiftId]);
    else {
      const { version, ...content } = s;
      await db.runAsync('insert or replace into shift_snapshots (shift_id, outlet_id, version, synced_at, data) values (?, ?, ?, ?, ?)', [
        shiftId,
        outletId,
        String(version),
        now,
        JSON.stringify(content),
      ]);
    }
    await db.runAsync('delete from shift_snapshots where synced_at < ?', [new Date(Date.now() - KEEP_MS).toISOString()]);
  })().finally(() => running.delete(shiftId));
  running.set(shiftId, run);
  return run;
}

/** The shift as last synced, or null when this phone never loaded it. */
export async function readShift(shiftId: string): Promise<ShiftData | null> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ data: string; synced_at: string }>('select data, synced_at from shift_snapshots where shift_id = ?', [shiftId]);
  if (!row) return null;
  const d = JSON.parse(row.data);
  const items: Record<string, TransactionItemSummary[]> = {};
  for (const [id, lines] of Object.entries((d.items ?? {}) as Record<string, any[]>)) items[id] = (lines ?? []).map(toBillItem);
  const held: Record<string, HeldBill> = {};
  for (const [id, h] of Object.entries((d.held ?? {}) as Record<string, any>)) held[id] = { ...toRecalledBill(h), remaining: toRemainingItems(h?.items) };
  return {
    bills: ((d.bills ?? []) as any[]).map(toBillRow),
    items,
    refunds: toRefunds(d.refunds),
    report: toSalesReport(d.report),
    cash: d.cash ? toCashSummary(d.cash) : null,
    dashboard: d.dashboard ? toDashboard(d.dashboard) : null,
    held,
    syncedAt: row.synced_at,
  };
}

/** One held bill of the shift as last synced, or null (never loaded, or not held any more). */
export async function readHeldBill(shiftId: string, billId: string): Promise<HeldBill | null> {
  return (await readShift(shiftId))?.held[billId] ?? null;
}

import { randomUUID } from 'expo-crypto';
import { supabase } from '../supabase/client';
import { localDb } from './db';

/**
 * Bill ids and numbers made on the phone (offline architecture, stage 2; migration 054). The phone is a terminal of the
 * outlet with a short code (A1, A2, ...); its bills are numbered #HPOS-YYYYMMDD-<code>-NNNN from its own daily counter,
 * so a receipt printed offline already carries the final number and two phones never share one.
 */

/** Asks the server for this phone's terminal code at the outlet (once; the same phone always gets the same code). */
export async function registerTerminal(outletId: string): Promise<string> {
  const db = await localDb();
  const known = await db.getFirstAsync<{ code: string }>('select code from terminals where outlet_id = ?', [outletId]);
  if (known) return known.code;
  const { data, error } = await supabase.rpc('register_terminal', { p_outlet_id: outletId });
  if (error) throw error;
  const code = String(data);
  await db.runAsync('insert or replace into terminals (outlet_id, code) values (?, ?)', [outletId, code]);
  return code;
}

/** meta key of the business's zone, stored from the reference snapshot (migration 064). */
export const TIMEZONE_KEY = 'timezone';

/** The business's zone as last synced; WIB until the first sync, as the server assumes. */
export async function businessTimeZone(): Promise<string> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ value: string }>('select value from meta where key = ?', [TIMEZONE_KEY]);
  return row?.value || 'Asia/Jakarta';
}

/** Business date as on the server (the business's zone), as YYYYMMDD. */
export function businessDay(at = new Date(), timeZone = 'Asia/Jakarta') {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}${v('month')}${v('day')}`;
}

/**
 * A new bill's id and number, or null when this phone has no terminal code yet (never online since 054): then the
 * server numbers the bill as before. Each call takes the next number, also when the payment is cancelled after.
 */
export async function nextBill(outletId: string): Promise<{ transactionId: string; number: string } | null> {
  const db = await localDb();
  const terminal = await db.getFirstAsync<{ code: string }>('select code from terminals where outlet_id = ?', [outletId]);
  if (!terminal) return null;
  const day = businessDay(new Date(), await businessTimeZone());
  const key = `${outletId}:${terminal.code}:${day}`;
  let value = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ value: number }>('select value from counters where key = ?', [key]);
    value = (row?.value ?? 0) + 1;
    await tx.runAsync('insert or replace into counters (key, value) values (?, ?)', [key, value]);
  });
  return { transactionId: randomUUID(), number: `#HPOS-${day}-${terminal.code}-${String(value).padStart(4, '0')}` };
}

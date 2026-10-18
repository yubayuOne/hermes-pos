import { supabase } from '../supabase/client';
import { localDb } from './db';
import { TIMEZONE_KEY, registerTerminal } from './billNumber';
import { dropOldPinHashes } from '../supabase/offlinePin';
import { DeviceCashier, Product, Voucher } from '../../types/domain';

/**
 * The outlet's reference data on the phone (offline architecture, stage 1): cashiers (no PIN hash since 059), menu,
 * categories and today's vouchers, from pos_reference_snapshot (migration 052). syncReference brings the local copy up
 * to date; the read* functions never touch the network, so every screen works the same online and offline.
 */
type Snapshot = {
  version: string;
  unchanged?: boolean;
  business_date?: string;
  /** The business's zone (migration 064); older servers do not send it. */
  timezone?: string;
  cashiers?: any[];
  products?: any[];
  categories?: any[];
  vouchers?: any[];
  open_shifts?: any[];
};

const versionKey = (outletId: string) => `ref-version:${outletId}`;
let running = new Map<string, Promise<void>>();

/** Downloads the outlet's snapshot when it changed and stores it in one transaction. One run per outlet at a time. */
export function syncReference(outletId: string): Promise<void> {
  const busy = running.get(outletId);
  if (busy) return busy;
  const run = (async () => {
    const db = await localDb();
    const known = await db.getFirstAsync<{ value: string }>('select value from meta where key = ?', [versionKey(outletId)]);
    const { data, error } = await supabase.rpc('pos_reference_snapshot', { p_outlet_id: outletId, p_version: known?.value ?? null });
    if (error) throw error;
    const s = (data ?? {}) as Snapshot;
    // Online now: make sure this phone has its terminal code, so its bills can be numbered offline (054).
    await registerTerminal(outletId).catch(() => undefined);
    if (s.unchanged) return;
    const before = await db.getAllAsync<{ cashier_id: string }>('select cashier_id from cashiers where outlet_id = ?', [outletId]);
    const cashiers = s.cashiers ?? [];
    // Every cashier's PIN hash kept by older app versions goes (signing in needs the server now, offlinePin.ts).
    await dropOldPinHashes([...before.map((b) => b.cashier_id), ...cashiers.map((c) => String(c.cashier_id))]);
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const table of ['cashiers', 'products', 'categories', 'vouchers', 'open_shifts'])
        await tx.runAsync(`delete from ${table} where outlet_id = ?`, [outletId]);
      // A server before migration 059 still sends the hash: never stored.
      for (const [i, c] of cashiers.entries()) {
        const { pin_hash: _hash, ...rest } = c;
        await tx.runAsync('insert into cashiers (cashier_id, outlet_id, position, data) values (?, ?, ?, ?)', [
          String(c.cashier_id),
          outletId,
          i,
          JSON.stringify(rest),
        ]);
      }
      for (const [i, p] of (s.products ?? []).entries())
        await tx.runAsync('insert into products (id, outlet_id, position, data) values (?, ?, ?, ?)', [String(p.id), outletId, i, JSON.stringify(p)]);
      for (const [i, c] of (s.categories ?? []).entries())
        await tx.runAsync('insert into categories (id, outlet_id, position, data) values (?, ?, ?, ?)', [String(c.id), outletId, i, JSON.stringify(c)]);
      for (const [i, v] of (s.vouchers ?? []).entries())
        await tx.runAsync('insert or replace into vouchers (outlet_id, code, position, data) values (?, ?, ?, ?)', [
          outletId,
          String(v.code).toUpperCase(),
          i,
          JSON.stringify(v),
        ]);
      for (const sh of s.open_shifts ?? [])
        await tx.runAsync('insert or replace into open_shifts (cashier_id, outlet_id, data) values (?, ?, ?)', [
          String(sh.cashier_id),
          outletId,
          JSON.stringify(sh),
        ]);
      await tx.runAsync('insert or replace into meta (key, value) values (?, ?)', [versionKey(outletId), s.version]);
      if (s.timezone) await tx.runAsync('insert or replace into meta (key, value) values (?, ?)', [TIMEZONE_KEY, s.timezone]);
      await tx.runAsync('insert or replace into meta (key, value) values (?, ?)', [`ref-synced:${outletId}`, new Date().toISOString()]);
    });
  })().finally(() => running.delete(outletId));
  running.set(outletId, run);
  return run;
}

/** The menu as the server last sent it (same shape fetchCatalog always returned). */
export async function readCatalog(outletId: string): Promise<{ products: Product[]; categories: { id: string; name: string }[] }> {
  const db = await localDb();
  const products = await db.getAllAsync<{ data: string }>('select data from products where outlet_id = ? order by position', [outletId]);
  const categories = await db.getAllAsync<{ data: string }>('select data from categories where outlet_id = ? order by position', [outletId]);
  return {
    products: products.map(({ data }) => {
      const p = JSON.parse(data);
      return {
        id: p.id,
        categoryId: p.category_id,
        name: p.name,
        hpp: Number(p.hpp ?? 0),
        price: Number(p.selling_price ?? 0),
        stock: Number(p.stock ?? 0),
        trackStock: p.track_stock !== false,
        imageUrl: p.image_url,
        station: (p.station ?? 'kitchen') as 'kitchen' | 'bar',
      };
    }),
    categories: categories.map(({ data }) => {
      const c = JSON.parse(data);
      return { id: String(c.id), name: String(c.name) };
    }),
  };
}

/** The outlet's cashiers. The lock state lives on the phone offline (offlinePin), so it is not shown from here. */
export async function readCashiers(outletId: string): Promise<DeviceCashier[]> {
  const db = await localDb();
  const rows = await db.getAllAsync<{ data: string }>('select data from cashiers where outlet_id = ? order by position', [outletId]);
  return rows.map(({ data }) => {
    const r = JSON.parse(data);
    return {
      cashierId: r.cashier_id,
      cashierName: r.cashier_name,
      outletId: r.outlet_id,
      outletName: r.outlet_name,
      outletPhone: r.outlet_phone ?? null,
      outletAddress: r.outlet_address ?? null,
      outletReceiptHeader: r.outlet_receipt_header ?? null,
      outletReceiptFooter: r.outlet_receipt_footer ?? null,
      outletLogoUrl: r.outlet_logo_url ?? null,
      outletLogoPrintUrl: r.outlet_logo_print_url ?? null,
      terminalName: r.terminal_name,
      hasPin: !!r.has_pin,
      pinLockedUntil: null,
    };
  });
}

/** Vouchers usable today: the server's list, minus any that ended since it was sent (quota is checked at checkout). */
export async function readVouchers(outletId: string, toVoucher: (d: any) => Voucher): Promise<Voucher[]> {
  const db = await localDb();
  const rows = await db.getAllAsync<{ data: string }>('select data from vouchers where outlet_id = ? order by position', [outletId]);
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return rows
    .map(({ data }) => JSON.parse(data))
    .filter((v) => !v.expires_on || String(v.expires_on) >= today)
    .map(toVoucher);
}

/** The cashier's open shift as of the last sync (row of `shifts`, migration 053), or null. */
export async function readOpenShiftRow(cashierId: string): Promise<any | null> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ data: string }>('select data from open_shifts where cashier_id = ?', [cashierId]);
  return row ? JSON.parse(row.data) : null;
}

/** After a close made on this phone: the snapshot still lists the shift as open until the next sync. */
export async function forgetOpenShiftRow(cashierId: string) {
  const db = await localDb();
  await db.runAsync('delete from open_shifts where cashier_id = ?', [cashierId]);
}

/** Sign-out: nothing of the account stays on the phone (old PIN hashes included). */
export async function clearReference() {
  const db = await localDb();
  const cashiers = await db.getAllAsync<{ cashier_id: string }>('select cashier_id from cashiers');
  await dropOldPinHashes(cashiers.map((c) => c.cashier_id));
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const table of ['cashiers', 'products', 'categories', 'vouchers', 'open_shifts', 'shift_snapshots', 'meta']) await tx.runAsync(`delete from ${table}`);
  });
  running = new Map();
}

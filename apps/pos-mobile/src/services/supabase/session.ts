import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './client';
import { AppSession, DeviceCashier, PinResult } from '../../types/domain';
import { clearOldCaches, getCache, removeCache, setCache } from '../cache/cache';
import { invalidateCatalogFreshness } from '../catalog/freshness';
import { checkActivePin, forgetPin, rememberPin } from './offlinePin';
import { clearReference, readCashiers, syncReference } from '../local/reference';

/*
 * Two-step sign-in:
 *  1. The device account (owner) signs in with email + password. This Supabase session lasts until logout.
 *  2. The cashier picks their name and enters a 6-digit PIN (checked by the server via verify_cashier_pin).
 * The phone is pinned to one outlet (chosen once, cleared by Keluar akun): the list and the PIN check are for that outlet only.
 * The last active cashier is remembered on the device so a force-closed app does not ask for the PIN mid-shift.
 * "Ganti kasir" (switch cashier) forgets it and returns to the cashier list without signing the account out.
 */

const LIST_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const listKey = (userId: string) => `device-cashiers:${userId}`;
const activeKey = (userId: string) => `@hermes-pos/active-cashier:${userId}`;
const outletKey = (userId: string) => `@hermes-pos/device-outlet:${userId}`;

async function authUser() {
  // getSession() reads the local token (no network request). RLS still validates the token on the server.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user ?? null;
}

/** Email of the signed-in device account, or null when signed out. */
export async function getAccountEmail(): Promise<string | null> {
  const user = await authUser();
  return user ? (user.email ?? 'HERMES POS') : null;
}

function mapCashier(row: any): DeviceCashier {
  return {
    cashierId: row.cashier_id,
    cashierName: row.cashier_name,
    outletId: row.outlet_id,
    outletName: row.outlet_name,
    outletPhone: row.outlet_phone ?? null,
    outletAddress: row.outlet_address ?? null,
    outletReceiptHeader: row.outlet_receipt_header ?? null,
    outletReceiptFooter: row.outlet_receipt_footer ?? null,
    outletLogoUrl: row.outlet_logo_url ?? null,
    outletLogoPrintUrl: row.outlet_logo_print_url ?? null,
    terminalName: row.terminal_name,
    hasPin: !!row.has_pin,
    pinLockedUntil: row.pin_locked_until ?? null,
  };
}

/** The account's cashiers. When the network fails the last copy is used so the cashier picker still opens. */
export async function loadDeviceCashiers(): Promise<DeviceCashier[]> {
  return (await loadDeviceCashierList()).list;
}

/** The outlet this phone belongs to, or null until it is chosen (and when the account has several outlets). */
async function boundOutlet(userId: string): Promise<string | null> {
  return AsyncStorage.getItem(outletKey(userId)).catch(() => null);
}

/** Pins this phone to one outlet. Only a new sign-in of the owner account changes it again. */
export async function bindOutlet(outletId: string) {
  const user = await authUser();
  if (!user) return;
  await AsyncStorage.setItem(outletKey(user.id), outletId);
  await removeCache(listKey(user.id)).catch(() => undefined);
  void syncReference(outletId).catch(() => undefined); // first download for offline use
}

/**
 * Same list, and whether it came from the device copy (offline banner on the cashier list). `needsOutlet` is true on a
 * phone that is not pinned yet and whose account has cashiers in several outlets: the picker asks which outlet first.
 * One outlet only: the phone is pinned to it silently.
 */
export async function loadDeviceCashierList(): Promise<{ list: DeviceCashier[]; cached: boolean; needsOutlet: boolean }> {
  const user = await authUser();
  if (!user) return { list: [], cached: false, needsOutlet: false };
  let outletId = await boundOutlet(user.id);
  if (outletId) {
    // A bound phone reads its local database, refreshed from the outlet snapshot (migration 052) when online.
    const synced = await syncReference(outletId).then(
      () => true,
      () => false,
    );
    const local = await readCashiers(outletId).catch(() => [] as DeviceCashier[]);
    if (local.length) return { list: local, cached: !synced, needsOutlet: false };
  }
  // Not bound yet (first start, several outlets) or nothing synced yet: the server's list.
  const { data, error } = await supabase.rpc('list_device_cashiers', { p_outlet_id: outletId });
  let list: DeviceCashier[];
  let cached = false;
  if (error) {
    const copy = await getCache<DeviceCashier[]>(listKey(user.id), LIST_CACHE_MAX_AGE).catch(() => null);
    if (!copy) throw error;
    list = copy.map((c) => ({ ...c, pinLockedUntil: null }));
    cached = true;
  } else {
    list = ((data ?? []) as any[]).map(mapCashier);
    void setCache(listKey(user.id), list).catch(() => undefined);
  }
  if (!outletId && list.length && list.every((c) => c.outletId === list[0].outletId)) {
    outletId = list[0].outletId;
    await AsyncStorage.setItem(outletKey(user.id), outletId).catch(() => undefined);
    void syncReference(outletId).catch(() => undefined); // first download for offline use
  }
  return { list, cached, needsOutlet: !outletId && list.length > 0 };
}

/**
 * Checks the PIN on the server; signing a cashier in needs internet (owner's choice, 18 Oct 2026). Once accepted, the
 * phone keeps its own check of this cashier for reopening the app during the shift (offlinePin.ts).
 */
export async function verifyCashierPin(cashierId: string, pin: string): Promise<PinResult> {
  const user = await authUser();
  const outletId = user ? await boundOutlet(user.id) : null;
  const { data, error } = await supabase.rpc('verify_cashier_pin', { p_cashier_id: cashierId, p_pin: pin, p_outlet_id: outletId });
  if (error) throw error;
  const r = (data ?? {}) as any;
  if (r.ok) {
    // Without it the next reopen asks the server again: never a reason to refuse the sign-in.
    await rememberPin(cashierId, pin).catch(() => undefined);
    return { ok: true };
  }
  if (r.reason === 'wrong') return { ok: false, reason: 'wrong', attemptsLeft: Number(r.attempts_left ?? 0) };
  if (r.reason === 'locked') return { ok: false, reason: 'locked', lockedUntil: String(r.locked_until ?? '') };
  if (r.reason === 'no_pin') return { ok: false, reason: 'no_pin' };
  return { ok: false, reason: 'not_found' };
}

/**
 * Reopening the app during a shift: the PIN of the cashier still signed in, checked on this phone so it works offline.
 * Without that check (made before this version, forgotten, or locked after five wrong PINs) the server decides.
 */
export async function confirmActiveCashier(cashierId: string, pin: string): Promise<PinResult> {
  const local = await checkActivePin(cashierId, pin);
  if (local.ok || local.reason === 'wrong') return local;
  return verifyCashierPin(cashierId, pin);
}

export function toSession(c: DeviceCashier): AppSession {
  return {
    cashierId: c.cashierId,
    cashierName: c.cashierName,
    outletId: c.outletId,
    outletName: c.outletName,
    outletPhone: c.outletPhone ?? null,
    outletAddress: c.outletAddress ?? null,
    outletReceiptHeader: c.outletReceiptHeader ?? null,
    outletReceiptFooter: c.outletReceiptFooter ?? null,
    outletLogoUrl: c.outletLogoUrl ?? null,
    outletLogoPrintUrl: c.outletLogoPrintUrl ?? null,
    terminalName: c.terminalName,
  };
}

/** Saves the cashier who just passed the PIN check as this device's active cashier. */
export async function rememberActiveCashier(cashierId: string) {
  const user = await authUser();
  if (user) await AsyncStorage.setItem(activeKey(user.id), cashierId);
}

/** Used by "Ganti kasir" (switch cashier): the account stays signed in, but the next cashier must pick a name and enter a PIN. */
export async function clearActiveCashier() {
  const user = await authUser();
  if (user) await AsyncStorage.removeItem(activeKey(user.id));
  await forgetPin();
  invalidateCatalogFreshness();
}

/** The last active cashier session, or null (show the cashier picker). */
export async function loadSession(): Promise<AppSession | null> {
  const user = await authUser();
  if (!user) return null;
  const id = await AsyncStorage.getItem(activeKey(user.id));
  if (!id) return null;
  // Startup must not wait for the network: the local database first. The caller checks the fresh list in the
  // background (cashierStillActive) and ends the session of a cashier removed in the backoffice.
  const outletId = await boundOutlet(user.id);
  const local = outletId ? (await readCashiers(outletId).catch(() => [])).find((c) => c.cashierId === id) : undefined;
  if (local) return toSession(local);
  const copy = await getCache<DeviceCashier[]>(listKey(user.id), LIST_CACHE_MAX_AGE).catch(() => null);
  const cached = copy?.find((c) => c.cashierId === id);
  if (cached) return toSession(cached);
  const list = await loadDeviceCashiers();
  const match = list.find((c) => c.cashierId === id);
  return match ? toSession(match) : null;
}

/**
 * False only when the server answered and the cashier is no longer in the list (removed or deactivated in the
 * backoffice). Offline or on an error it stays true: the session is kept, and the server still refuses their writes.
 */
export async function cashierStillActive(cashierId: string): Promise<boolean> {
  const r = await loadDeviceCashierList().catch(() => null);
  return !r || r.cached || r.list.some((c) => c.cashierId === cashierId);
}

/** Email or username. For a username the server gives the email only with the right password (migration 060). */
export async function signIn(identifier: string, password: string) {
  let email = identifier;
  if (!identifier.includes('@')) {
    const { data, error: lookup } = await supabase.rpc('pos_login_email', { p_username: identifier, p_password: password });
    if (lookup) throw lookup;
    if (!data) throw new Error('Invalid login credentials');
    email = String(data);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const user = await authUser();
  await supabase.auth.signOut();
  // The next account on this phone must not see this outlet's data or sign in with its PINs offline.
  await clearReference().catch(() => undefined);
  await forgetPin();
  if (user) {
    await AsyncStorage.removeItem(activeKey(user.id)).catch(() => undefined);
    await AsyncStorage.removeItem(outletKey(user.id)).catch(() => undefined);
    await removeCache(listKey(user.id)).catch(() => undefined);
  }
  // Do not leave the previous cashier's catalog on the device. Payment recovery data is kept on purpose.
  invalidateCatalogFreshness();
  await clearOldCaches().catch(() => undefined);
}

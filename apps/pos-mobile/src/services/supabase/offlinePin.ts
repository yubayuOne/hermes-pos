import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import bcrypt from 'bcryptjs';

/**
 * The phone's own check of the cashier who is signed in (owner's choice, 18 Oct 2026). Signing a cashier in needs the
 * server; after it accepts the PIN the phone keeps a bcrypt hash of that PIN joined with a random key of this phone,
 * both in the Android keystore (expo-secure-store). Reopening the app during the shift asks for the PIN again and
 * checks it here, so it also works offline. The server never sends a PIN hash (migration 059). Five wrong PINs lock the
 * check until the server confirms the PIN again; ganti kasir, tutup shift and keluar akun forget it.
 */
const MAX_WRONG = 5;
const COST = 10;
const KEY = 'activepin.key';
const HASH = 'activepin.hash';
const LOCK = 'activepin.wrong';

// bcryptjs needs random bytes for its salt; React Native has no WebCrypto, expo-crypto has.
bcrypt.setRandomFallback((n: number) => Array.from(getRandomBytes(n)));

export type ActivePinResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  /** No check on this phone (never made, or forgotten) or locked after five wrong PINs: the server must check it. */
  | { ok: false; reason: 'server' };

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
// 64 hex characters + ':' + 6 digits = 71 bytes, inside bcrypt's 72.
const secret = (key: string, pin: string) => `${key}:${pin}`;

/** After the server accepted the PIN: the check for reopening the app, replacing any earlier one. */
export async function rememberPin(cashierId: string, pin: string) {
  const key = toHex(getRandomBytes(32));
  const hash = await bcrypt.hash(secret(key, pin), COST);
  await SecureStore.setItemAsync(KEY, key);
  await SecureStore.setItemAsync(HASH, JSON.stringify({ cashierId, hash }));
  await SecureStore.deleteItemAsync(LOCK).catch(() => undefined);
}

/** Checks the PIN of the signed-in cashier on this phone. Async: at cost 10 a sync check would freeze the screen. */
export async function checkActivePin(cashierId: string, pin: string): Promise<ActivePinResult> {
  const [key, raw, wrongRaw] = await Promise.all([KEY, HASH, LOCK].map((k) => SecureStore.getItemAsync(k).catch(() => null)));
  let saved: { cashierId?: string; hash?: string } | null = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const wrong = Number(wrongRaw ?? 0) || 0;
  if (!key || !saved?.hash || saved.cashierId !== cashierId || wrong >= MAX_WRONG) return { ok: false, reason: 'server' };
  if (/^\d{6}$/.test(pin) && (await bcrypt.compare(secret(key, pin), saved.hash))) {
    if (wrong) await SecureStore.deleteItemAsync(LOCK).catch(() => undefined);
    return { ok: true };
  }
  try {
    await SecureStore.setItemAsync(LOCK, String(wrong + 1));
  } catch {
    // The count could not be saved: hand the check to the server instead of giving uncounted attempts.
    return { ok: false, reason: 'server' };
  }
  return wrong + 1 >= MAX_WRONG ? { ok: false, reason: 'server' } : { ok: false, reason: 'wrong', attemptsLeft: MAX_WRONG - wrong - 1 };
}

/** Ganti kasir, tutup shift, keluar akun: the check goes. */
export async function forgetPin() {
  await Promise.all([KEY, HASH, LOCK].map((k) => SecureStore.deleteItemAsync(k).catch(() => undefined)));
}

/** Hashes every cashier's PIN kept by app versions before migration 059 (`pinhash.<id>`, `pinlock.<id>`). */
export async function dropOldPinHashes(cashierIds: string[]) {
  const safe = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_');
  await Promise.all(
    cashierIds.flatMap((id) => [`pinhash.${safe(id)}`, `pinlock.${safe(id)}`].map((k) => SecureStore.deleteItemAsync(k).catch(() => undefined))),
  );
}

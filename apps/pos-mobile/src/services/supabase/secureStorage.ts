import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/*
 * Storage for the Supabase session (access and refresh token). Tokens go to the platform keystore, not to plain
 * AsyncStorage. A session is larger than one SecureStore value is meant to hold, so it is cut into pieces of CHUNK
 * characters stored under "<key>.0", "<key>.1", ... with the piece count under "<key>.n".
 * A session saved in AsyncStorage by an older version is moved here the first time it is read.
 */

const CHUNK = 1800;
// SecureStore keys may only hold letters, digits, ".", "-" and "_".
const safe = (key: string) => key.replace(/[^\w.-]/g, '_');

export async function getItem(key: string): Promise<string | null> {
  const base = safe(key);
  const count = Number(await SecureStore.getItemAsync(`${base}.n`));
  if (Number.isInteger(count) && count > 0) {
    const parts = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${base}.${i}`)));
    // A missing piece means a write was cut short; treat it as signed out rather than hand back half a token.
    return parts.every((p) => p !== null) ? parts.join('') : null;
  }
  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;
  await setItem(key, legacy);
  await AsyncStorage.removeItem(key);
  return legacy;
}

export async function setItem(key: string, value: string): Promise<void> {
  const base = safe(key);
  const before = Number(await SecureStore.getItemAsync(`${base}.n`)) || 0;
  const count = Math.max(1, Math.ceil(value.length / CHUNK));
  for (let i = 0; i < count; i++) await SecureStore.setItemAsync(`${base}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  await SecureStore.setItemAsync(`${base}.n`, String(count));
  // The new value is shorter than the old one: drop the pieces that are left over.
  for (let i = count; i < before; i++) await SecureStore.deleteItemAsync(`${base}.${i}`);
}

export async function removeItem(key: string): Promise<void> {
  const base = safe(key);
  const count = Number(await SecureStore.getItemAsync(`${base}.n`)) || 0;
  await SecureStore.deleteItemAsync(`${base}.n`);
  for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${base}.${i}`);
  await AsyncStorage.removeItem(key);
}

export const secureStorage = { getItem, setItem, removeItem };

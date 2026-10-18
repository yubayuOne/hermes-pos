import AsyncStorage from '@react-native-async-storage/async-storage';
const PREFIX = '@hermes-pos/cache/';
export async function setCache<T>(key: string, value: T) {
  await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ v: 1, at: Date.now(), data: value }));
}
export async function getCache<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<T | null> {
  const raw = await AsyncStorage.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.at > maxAgeMs) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}
export async function removeCache(key: string) {
  await AsyncStorage.removeItem(PREFIX + key);
}
export async function clearHermesPosCache() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
}

// Copies screens kept before the local database had their data (offline architecture, stage 4).
const OLD = ['catalog:', 'held:', 'shift-screen:', 'shift-report:', 'recent-closed:'];

/** Removes those copies (on start and on sign-out). Deliberately does NOT touch `pending-checkout:v1` (recovery of unconfirmed payments). */
export async function clearOldCaches() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => OLD.some((o) => k.startsWith(PREFIX + o))));
}

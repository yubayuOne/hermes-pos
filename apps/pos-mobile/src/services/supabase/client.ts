import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { secureStorage } from './secureStorage';
import { isOnline } from '../network/network';
import { deviceId } from '../device';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(url && key && !url.includes('YOUR_PROJECT'));
/**
 * A request that hangs on a weak signal would keep a spinner up for a minute or more. After 15 s it is aborted:
 * reads show their error box, and checkout takes the offline path (same idempotency key, never recorded twice).
 */
const TIMEOUT_MS = 15_000;
const fetchWithTimeout: typeof fetch = async (input, init) => {
  // No network at all: fail now with the same error a dropped request gives, so callers take their offline path at once.
  if (!isOnline()) throw new TypeError('Network request failed');
  // The phone's id: the server keeps a shift to the phone that opened it (migration 051).
  const headers = new Headers(init?.headers);
  headers.set('x-device-id', await deviceId());
  const controller = new AbortController();
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, headers, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  global: { fetch: fetchWithTimeout },
});

// React Native timers stop in the background, so the token can expire there: refresh it as the app comes back
// (Supabase React Native guide), before the first request after a long pause or offline spell.
AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});

import type { AppContext } from './types';

// This cache exists only in the browser. Never retain tenant data in a Node
// module singleton, where a server process could share it between users.
// Writes that change it (counts, outlets) clear it at once (useAction refreshAppContext), so it can live a while.
const MAX_AGE_MS = 5 * 60_000;
let cached: { value: AppContext; savedAt: number } | null = null;

export function getCachedAppContext(): AppContext | null {
  if (typeof window === 'undefined' || !cached) return null;
  if (Date.now() - cached.savedAt > MAX_AGE_MS) {
    cached = null;
    return null;
  }
  return cached.value;
}

export function rememberAppContext(value: AppContext): void {
  if (typeof window === 'undefined') return;
  cached = { value, savedAt: Date.now() };
}

export function clearAppContextCache(): void {
  if (typeof window !== 'undefined') cached = null;
}

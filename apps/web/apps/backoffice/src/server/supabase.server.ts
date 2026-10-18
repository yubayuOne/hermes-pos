import { createServerClient } from '@supabase/ssr';
import { getCookie, getCookies, setCookie } from '@tanstack/react-start/server';
import { describeError } from '../lib/errors';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} is not set`);
  return v;
}

/** Base of every link in auth emails. Without APP_URL a production build still points at the real domain, never localhost. */
export function appUrl(): string {
  const fallback = process.env.NODE_ENV === 'production' ? 'https://backoffice.hermes-pos.com' : 'http://localhost:3001';
  return (process.env.APP_URL || fallback).replace(/\/$/, '');
}

/** "Ingat saya" off: auth cookies become session cookies that end when the browser closes. */
export const REMEMBER_COOKIE = 'hermes-pos-remember';

// One client per request. The session lives in HttpOnly cookies set by @supabase/ssr, so no token is
// readable from browser JavaScript.
export function supabaseServer() {
  const remember = getCookie(REMEMBER_COOKIE) !== '0';
  return createServerClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
      },
      setAll(list) {
        for (const { name, value, options } of list) {
          const opts = { ...options, httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' };
          if (!remember && value) {
            delete opts.maxAge;
            delete opts.expires;
          }
          setCookie(name, value, opts);
        }
      },
    },
  });
}

export async function requireClient() {
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) throw new Error('Sesi berakhir. Silakan masuk lagi.');
  return supabase;
}

/**
 * Call a database RPC directly with the user's cookie-backed JWT.
 * PostgREST validates the JWT and PostgreSQL RLS/each owner-scoped RPC must
 * enforce tenant permissions. Running getClaims() immediately before every
 * RPC adds a serial network/auth step but does not replace database authorization.
 */
export async function callRpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabaseServer().rpc(name, args);
    if (error) return { ok: false, error: describeError(error) };
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/** Read-only RPC variant for loaders; permission checks remain in Postgres/RPC. */
export async function readRpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseServer().rpc(name, args);
  if (error) throw new Error(describeError(error));
  return data as T;
}

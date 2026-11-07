import { createServerClient } from '@supabase/ssr';
import { getCookies, setCookie } from '@tanstack/react-start/server';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} is not set`);
  return v;
}

// One client per request. The session lives in HttpOnly cookies, so no token is readable from browser JavaScript.
export function supabaseServer() {
  return createServerClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
      },
      setAll(list) {
        for (const { name, value, options } of list) {
          setCookie(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        }
      },
    },
  });
}

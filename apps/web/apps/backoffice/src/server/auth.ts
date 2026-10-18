import { createServerFn } from '@tanstack/react-start';
import { describeError } from '../lib/errors';
import { codeSchema, forgotSchema, loginSchema, oauthSchema, parser, registerSchema, resetSchema, username } from '../lib/schemas';
import type { ActionResult, Session } from '../lib/types';

export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<Session | null> => {
  const { supabaseServer } = await import('./supabase.server');
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || !claims.email) return null;
  const [{ data: businessId }, { data: profile }] = await Promise.all([supabase.rpc('my_business_id'), supabase.rpc('get_my_profile')]);
  return {
    email: String(claims.email),
    userId: String(claims.sub),
    businessId: (businessId as string | null) ?? null,
    username: ((profile as { username?: string } | null)?.username as string | undefined) ?? null,
  };
});

export const signIn = createServerFn({ method: 'POST' })
  .validator(parser(loginSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer, REMEMBER_COOKIE } = await import('./supabase.server');
    const { setCookie } = await import('@tanstack/react-start/server');
    let email = data.identifier.toLowerCase();
    if (!email.includes('@')) {
      // Same lookup as the POS (migration 060): the email comes back only with the right password, and ten wrong ones
      // lock the username for 15 minutes. No service-role key needed.
      const { data: resolved, error: lookup } = await supabaseServer().rpc('pos_login_email', { p_username: email, p_password: data.password });
      if (lookup) return { ok: false, error: lookup.hint === 'login_locked' ? lookup.message : describeError(lookup) };
      // Same message as a wrong password, so the form cannot be used to find out which usernames exist.
      if (!resolved) return { ok: false, error: describeError('invalid login credentials') };
      email = String(resolved);
    }
    setCookie(REMEMBER_COOKIE, data.remember ? '1' : '0', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 400 });
    const { error } = await supabaseServer().auth.signInWithPassword({ email, password: data.password });
    return error ? { ok: false, error: describeError(error) } : { ok: true };
  });

export const usernameAvailable = createServerFn({ method: 'POST' })
  .validator(parser(username))
  .handler(async ({ data }): Promise<boolean> => {
    const { supabaseServer } = await import('./supabase.server');
    const { data: ok, error } = await supabaseServer().rpc('username_available', { p_username: data });
    return error ? true : Boolean(ok);
  });

export const signUp = createServerFn({ method: 'POST' })
  .validator(parser(registerSchema))
  .handler(async ({ data }): Promise<ActionResult<'verify' | 'ready'>> => {
    const { supabaseServer, appUrl } = await import('./supabase.server');
    const supabase = supabaseServer();
    const { data: free } = await supabase.rpc('username_available', { p_username: data.username });
    if (free === false) return { ok: false, field: 'username', error: 'Username sudah dipakai. Pilih username lain.' };
    const { data: res, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${appUrl()}/auth/callback?next=/onboarding`,
        // Read back by onboarding, which creates the business and the profile in one go.
        data: { business_name: data.business, username: data.username },
      },
    });
    if (error) return { ok: false, error: describeError(error) };
    // An existing email returns a user without identities so accounts cannot be probed.
    if (res.user && (res.user.identities?.length ?? 0) === 0) return { ok: false, field: 'email', error: describeError('user already registered') };
    return { ok: true, data: res.session ? 'ready' : 'verify' };
  });

export const googleUrl = createServerFn({ method: 'POST' })
  .validator(parser(oauthSchema))
  .handler(async ({ data }): Promise<ActionResult<string>> => {
    const { supabaseServer, appUrl } = await import('./supabase.server');
    const { data: res, error } = await supabaseServer().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${appUrl()}/auth/callback?next=${data.next}`, skipBrowserRedirect: true },
    });
    if (error || !res.url) return { ok: false, error: 'Masuk dengan Google belum aktif. Pakai email dan kata sandi.' };
    return { ok: true, data: res.url };
  });

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  const { supabaseServer } = await import('./supabase.server');
  await supabaseServer().auth.signOut();
  return { ok: true as const };
});

export const requestPasswordReset = createServerFn({ method: 'POST' })
  .validator(parser(forgotSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer, appUrl } = await import('./supabase.server');
    const { error } = await supabaseServer().auth.resetPasswordForEmail(data.email, {
      redirectTo: `${appUrl()}/auth/callback?next=/reset-password`,
    });
    // Same answer whether or not the email exists, except for rate limits.
    if (error && /rate limit|too many/i.test(error.message)) return { ok: false, error: describeError(error) };
    return { ok: true };
  });

export const updatePassword = createServerFn({ method: 'POST' })
  .validator(parser(resetSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { error } = await supabaseServer().auth.updateUser({ password: data.password });
    return error ? { ok: false, error: describeError(error) } : { ok: true };
  });

/** Exchanges the code from an email link or Google for a session (PKCE). */
export const exchangeCode = createServerFn({ method: 'POST' })
  .validator(parser(codeSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { error } = await supabaseServer().auth.exchangeCodeForSession(data.code);
    return error ? { ok: false, error: 'Tautan tidak berlaku atau sudah kedaluwarsa. Minta tautan baru.' } : { ok: true };
  });

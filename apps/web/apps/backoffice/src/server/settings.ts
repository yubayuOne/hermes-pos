import { createServerFn } from '@tanstack/react-start';
import { businessSchema, changePasswordSchema, notifySchema, parser, profileSchema, receiptSchema, voidCodeSchema } from '../lib/schemas';
import type { ActionResult } from '../lib/types';

export const saveProfile = createServerFn({ method: 'POST' })
  .validator(parser(profileSchema))
  .handler(async ({ data }): Promise<ActionResult<'email'>> => {
    const { callRpc, requireClient } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    const res = await callRpc('save_my_profile', { p_full_name: data.fullName, p_username: data.username, p_whatsapp: data.whatsapp });
    if (!res.ok) return { ok: false, error: res.error, field: /username/i.test(res.error) ? 'username' : undefined };
    const supabase = await requireClient();
    const { data: user } = await supabase.auth.getUser();
    if (user.user && user.user.email !== data.email) {
      // Supabase sends a confirmation link to the new address; the email changes after it is opened.
      const { error } = await supabase.auth.updateUser({ email: data.email });
      if (error) return { ok: false, field: 'email', error: describeError(error) };
      return { ok: true, data: 'email' };
    }
    return { ok: true };
  });

export const changePassword = createServerFn({ method: 'POST' })
  .validator(parser(changePasswordSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { requireClient } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    const supabase = await requireClient();
    const { data: user } = await supabase.auth.getUser();
    const email = user.user?.email;
    if (!email) return { ok: false, error: 'Sesi berakhir. Silakan masuk lagi.' };
    // Confirms the current password before changing it.
    const check = await supabase.auth.signInWithPassword({ email, password: data.current });
    if (check.error) return { ok: false, field: 'current', error: 'Kata sandi saat ini salah.' };
    const { error } = await supabase.auth.updateUser({ password: data.password });
    return error ? { ok: false, field: 'password', error: describeError(error) } : { ok: true };
  });

export const saveBusiness = createServerFn({ method: 'POST' })
  .validator(parser(businessSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_update_business', { p_name: data.name, p_business_type: data.type, p_city: data.city, p_timezone: data.timezone });
    return res.ok ? { ok: true } : res;
  });

export const saveReceipt = createServerFn({ method: 'POST' })
  .validator(parser(receiptSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_update_receipt', { p_receipt: data });
    return res.ok ? { ok: true } : res;
  });

export const saveNotify = createServerFn({ method: 'POST' })
  .validator(parser(notifySchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_update_notify', { p_notify: data });
    return res.ok ? { ok: true } : res;
  });

/** Whether the owner has set the void approval code (the code itself is never readable). */
export const voidCodeStatus = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean | null> => {
  const { callRpc } = await import('./supabase.server');
  const res = await callRpc<{ has_code?: boolean }>('owner_void_code_status');
  return res.ok ? !!res.data?.has_code : null;
});

/** Set or change the code. Allowed while the subscription is expired too. */
export const saveVoidCode = createServerFn({ method: 'POST' })
  .validator(parser(voidCodeSchema))
  .handler(async ({ data }): Promise<ActionResult<'code'>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_set_void_code', { p_code: data.code });
    return res.ok ? { ok: true } : { ok: false, field: 'code', error: res.error };
  });

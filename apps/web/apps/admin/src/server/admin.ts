import { createServerFn } from '@tanstack/react-start';
import { loginSchema, parser, paymentIdSchema, paymentListSchema, paymentRejectSchema } from '../lib/schemas';
import type { ActionResult, AdminPaymentList } from '../lib/types';
import { describeError } from '../lib/errors';
import { toAdminPaymentList } from './normalize';

// Every call runs with the admin's own session: the database checks the platform admin list (admin_users, 110).

/** Whether the signed-in user is a platform admin. */
export const isPlatformAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean> => {
  const { supabaseServer } = await import('./supabase.server');
  const { data, error } = await supabaseServer().rpc('is_platform_admin');
  return !error && data === true;
});

/** Signs in with email and password. Anyone who is not a platform admin is signed out again at once. */
export const signIn = createServerFn({ method: 'POST' })
  .validator(parser(loginSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const client = supabaseServer();
    const { error } = await client.auth.signInWithPassword({ email: data.email, password: data.password });
    if (error) return { ok: false, error: describeError(error) };
    const { data: admin, error: rpcError } = await client.rpc('is_platform_admin');
    if (rpcError || admin !== true) {
      await client.auth.signOut();
      return { ok: false, error: 'Akun ini tidak punya akses admin.' };
    }
    return { ok: true };
  });

export const signOut = createServerFn({ method: 'POST' }).handler(async (): Promise<void> => {
  const { supabaseServer } = await import('./supabase.server');
  await supabaseServer().auth.signOut();
});

export const listAdminPayments = createServerFn({ method: 'GET' })
  .validator(parser(paymentListSchema))
  .handler(async ({ data }): Promise<AdminPaymentList> => {
    const { supabaseServer } = await import('./supabase.server');
    const { data: raw, error } = await supabaseServer().rpc('admin_list_payments', { p_status: data.status, p_page: data.page });
    if (error) throw new Error(describeError(error));
    return toAdminPaymentList(raw);
  });

/** Approves a bank transfer waiting for review (manual transfers only; Midtrans settles itself). */
export const verifyPayment = createServerFn({ method: 'POST' })
  .validator(parser(paymentIdSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { error } = await supabaseServer().rpc('admin_verify_payment', { p_id: data.id });
    return error ? { ok: false, error: describeError(error) } : { ok: true };
  });

export const rejectPayment = createServerFn({ method: 'POST' })
  .validator(parser(paymentRejectSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { error } = await supabaseServer().rpc('admin_reject_payment', { p_id: data.id, p_reason: data.reason });
    return error ? { ok: false, error: describeError(error) } : { ok: true };
  });

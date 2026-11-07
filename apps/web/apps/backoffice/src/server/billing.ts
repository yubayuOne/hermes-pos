import { createServerFn } from '@tanstack/react-start';
import { parser, paymentStartSchema } from '../lib/schemas';
import type { ActionResult, Payment } from '../lib/types';
import { toPayment } from './normalize';

export const listPayments = createServerFn({ method: 'GET' }).handler(async (): Promise<Payment[]> => {
  const { readRpc } = await import('./supabase.server');
  const rows = await readRpc<Record<string, unknown>[]>('owner_list_payments');
  return (rows ?? []).map(toPayment);
});

/** Starts a Midtrans payment for the plan. The database prices it and keeps one open order; this returns the page to pay on (110). */
export const startMidtransPayment = createServerFn({ method: 'POST' })
  .validator(parser(paymentStartSchema))
  .handler(async ({ data }): Promise<ActionResult<{ url: string }>> => {
    const { callRpc, supabaseAdmin, supabaseServer } = await import('./supabase.server');
    const begun = await callRpc<{ invoice: string; amount: number; paymentUrl: string | null; business: string }>('owner_begin_midtrans', {
      p_plan_code: data.plan,
      p_extra_outlets: data.extraOutlets,
    });
    if (!begun.ok) return begun;
    if (begun.data.paymentUrl) return { ok: true, data: { url: begun.data.paymentUrl } };
    const { createSnapTransaction } = await import('./midtrans');
    const { describeError } = await import('../lib/errors');
    try {
      const { data: user } = await supabaseServer().auth.getUser();
      const url = await createSnapTransaction({
        orderId: begun.data.invoice,
        amount: begun.data.amount,
        name: begun.data.business,
        email: user.user?.email ?? '',
      });
      const saved = await supabaseAdmin().rpc('midtrans_save_payment_url', { p_invoice: begun.data.invoice, p_url: url });
      if (saved.error) return { ok: false, error: describeError(saved.error) };
      return { ok: true, data: { url } };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  });

/**
 * Midtrans notification (POST /api/midtrans/notify). Authentic only with Midtrans' signature; the database checks the
 * amount and applies each status once. An error answers non-200, so Midtrans sends the notice again.
 */
export async function midtransNotify(request: Request): Promise<Response> {
  const { notificationIsAuthentic } = await import('./midtrans');
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !notificationIsAuthentic(body)) return new Response('invalid signature', { status: 403 });
  const { supabaseAdmin } = await import('./supabase.server');
  const { error } = await supabaseAdmin().rpc('midtrans_settle', {
    p_invoice: String(body.order_id),
    p_transaction_id: String(body.transaction_id ?? ''),
    p_status: String(body.transaction_status ?? ''),
    p_gross: Math.round(Number(body.gross_amount)),
  });
  if (error) return new Response('not applied', { status: 400 });
  return Response.json({ ok: true });
}

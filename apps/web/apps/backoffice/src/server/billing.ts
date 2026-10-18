import { createServerFn } from '@tanstack/react-start';
import { parser, paymentSchema } from '../lib/schemas';
import type { ActionResult, Payment } from '../lib/types';
import { toPayment } from './normalize';

export const listPayments = createServerFn({ method: 'GET' }).handler(async (): Promise<Payment[]> => {
  const { readRpc } = await import('./supabase.server');
  const rows = await readRpc<Record<string, unknown>[]>('owner_list_payments');
  return (rows ?? []).map(toPayment);
});

export const submitPayment = createServerFn({ method: 'POST' })
  .validator(parser(paymentSchema))
  .handler(async ({ data }): Promise<ActionResult<Payment>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<Record<string, unknown>>('owner_submit_payment', {
      p_plan_code: data.plan,
      p_extra_outlets: data.extraOutlets,
      p_sender_name: data.sender,
      p_bank_name: data.bank,
      p_transfer_date: data.date,
      p_amount_paid: data.amount,
      p_note: data.note,
    });
    return res.ok ? { ok: true, data: toPayment(res.data) } : res;
  });

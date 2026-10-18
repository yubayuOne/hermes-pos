import { createServerFn } from '@tanstack/react-start';
import { parser, voucherActiveSchema, voucherSchema } from '../lib/schemas';
import type { ActionResult, Voucher } from '../lib/types';
import { toVoucher } from './normalize';

export type PickerProduct = { id: string; name: string; category: string; outlet: string };

export const listVouchers = createServerFn({ method: 'GET' }).handler(async (): Promise<Voucher[]> => {
  const { readRpc } = await import('./supabase.server');
  return ((await readRpc<Record<string, unknown>[]>('owner_list_vouchers')) ?? []).map(toVoucher);
});

/** Active products of every outlet, for the voucher product picker. Loaded only when the picker opens. */
export const listVoucherProducts = createServerFn({ method: 'GET' }).handler(async (): Promise<PickerProduct[]> => {
  const { supabaseServer } = await import('./supabase.server');
  const { describeError } = await import('../lib/errors');
  // RLS on products limits the rows to the owner's business.
  const prods = await supabaseServer()
    .from('products')
    .select('id,name,categories(name),outlets(name)')
    .eq('is_temporary', false)
    .eq('is_active', true)
    .order('name');
  if (prods.error) throw new Error(describeError(prods.error));
  return (prods.data ?? []).map((p) => {
    const cat = p.categories as unknown as { name?: string } | null;
    const out = p.outlets as unknown as { name?: string } | null;
    return { id: p.id as string, name: p.name as string, category: cat?.name ?? '', outlet: out?.name ?? '' };
  });
});

export const saveVoucher = createServerFn({ method: 'POST' })
  .validator(parser(voucherSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_save_voucher', {
      p_id: data.id ?? null,
      p_code: data.code,
      p_scope: data.scope,
      p_discount_type: data.discountType,
      p_value: data.value,
      p_min_spend: data.minSpend,
      p_quota: data.quota,
      p_expires_on: data.expiresOn,
      p_product_ids: data.scope === 'products' ? data.productIds : null,
    });
    return res.ok ? { ok: true } : { ok: false, error: res.error, field: /kode/i.test(res.error) ? 'code' : undefined };
  });

export const setVoucherActive = createServerFn({ method: 'POST' })
  .validator(parser(voucherActiveSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_set_voucher_active', { p_id: data.id, p_active: data.active });
    return res.ok ? { ok: true } : res;
  });

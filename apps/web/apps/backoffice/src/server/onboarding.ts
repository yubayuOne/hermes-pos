import { createServerFn } from '@tanstack/react-start';
import { onboardOutletSchema, parser } from '../lib/schemas';
import type { ActionResult } from '../lib/types';

export type OnboardingState = {
  businessName: string;
  /** Username chosen at sign-up; null after Google sign-up, so step 1 asks for it. */
  username: string | null;
  hasProfile: boolean;
  business: { name: string; type: string; city: string } | null;
  outlet: { id: string; name: string } | null;
  cashiers: number;
  products: number;
};

/** Prefill and progress for the onboarding wizard (A9). */
export const getOnboardingState = createServerFn({ method: 'GET' }).handler(async (): Promise<OnboardingState> => {
  const { requireClient } = await import('./supabase.server');
  const supabase = await requireClient();
  const [{ data: user }, { data: profile }, { data: businessId }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('get_my_profile'),
    supabase.rpc('my_business_id'),
  ]);
  const meta = (user.user?.user_metadata ?? {}) as { business_name?: string; username?: string };
  const base = {
    businessName: meta.business_name ?? '',
    username: meta.username ?? null,
    hasProfile: Boolean((profile as { username?: string } | null)?.username),
  };
  if (!businessId) return { ...base, business: null, outlet: null, cashiers: 0, products: 0 };
  const [biz, outlets, cashiers, products] = await Promise.all([
    supabase.rpc('owner_get_business'),
    supabase.from('outlets').select('id,name').order('created_at').limit(1),
    supabase.rpc('owner_list_cashiers'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_temporary', false),
  ]);
  const b = (biz.data ?? {}) as { name?: string; business_type?: string; city?: string };
  return {
    ...base,
    business: { name: b.name ?? '', type: b.business_type ?? 'kafe', city: b.city ?? '' },
    outlet: outlets.data?.[0] ?? null,
    cashiers: Array.isArray(cashiers.data) ? cashiers.data.length : 0,
    products: products.count ?? 0,
  };
});

/**
 * Steps 1 and 2 together: creates the business, its first outlet, and the 3-day trial (register_business),
 * then saves the profile (username from sign-up) and the business type and city.
 */
export const createBusiness = createServerFn({ method: 'POST' })
  .validator(parser(onboardOutletSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { requireClient } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    const supabase = await requireClient();
    const { data: user } = await supabase.auth.getUser();
    const meta = (user.user?.user_metadata ?? {}) as { username?: string };
    const name = data.business.username ?? meta.username;
    if (name) {
      const profile = await supabase.rpc('save_my_profile', { p_full_name: '', p_username: name, p_whatsapp: '' });
      if (profile.error) return { ok: false, field: 'username', error: describeError(profile.error) };
    }
    const reg = await supabase.rpc('register_business', {
      p_business_name: data.business.name,
      p_outlet_name: data.outlet,
      p_outlet_phone: data.phone || null,
    });
    if (reg.error) return { ok: false, error: describeError(reg.error) };
    const upd = await supabase.rpc('owner_update_business', {
      p_name: data.business.name,
      p_business_type: data.business.type,
      p_city: data.business.city,
      p_timezone: 'Asia/Jakarta',
    });
    if (upd.error) return { ok: false, error: describeError(upd.error) };
    if (data.address) {
      const { data: outlets } = await supabase.from('outlets').select('id,name,phone').limit(1);
      const o = outlets?.[0];
      if (o) await supabase.rpc('owner_update_outlet', { p_outlet_id: o.id, p_name: o.name, p_address: data.address, p_phone: o.phone, p_is_active: true });
    }
    return { ok: true };
  });

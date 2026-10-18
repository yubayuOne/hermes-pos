import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { parser } from '../lib/schemas';
import type { AppContext, Notification, Outlet, Session } from '../lib/types';
import { toBusiness, toNotification, toSubscription } from './normalize';
import type { requireClient } from './supabase.server';

type ShellContext = Omit<AppContext, 'session'>;
type BootstrapResult = { session: Session | null; app: ShellContext | null };

/**
 * Load the shared shell data using an already-created authenticated client.
 * Keeping this separate lets the protected layout read auth claims only once
 * instead of calling getSession() and requireClient() independently.
 */
async function loadAppContext(supabase: Awaited<ReturnType<typeof requireClient>>): Promise<ShellContext> {
  const { describeError } = await import('../lib/errors');
  const [biz, sub, profile, outlets, cashiers, counts] = await Promise.all([
    supabase.rpc('owner_get_business'),
    supabase.rpc('get_subscription_status'),
    supabase.rpc('get_my_profile'),
    supabase.from('outlets').select('id,name,address,phone,is_active,logo_url,receipt_header,receipt_footer').order('created_at'),
    supabase.rpc('owner_list_cashiers'),
    // Products and vouchers counted per business on the server (062), not through RLS over every business's rows.
    supabase.rpc('owner_shell_counts'),
  ]);
  const shell = (counts.data ?? {}) as { products?: unknown; vouchers?: unknown };
  if (sub.error) throw new Error(describeError(sub.error));
  if (outlets.error) throw new Error(describeError(outlets.error));
  const outletRows: Outlet[] = (outlets.data ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    address: o.address,
    phone: o.phone,
    isActive: o.is_active,
    logoUrl: o.logo_url || null,
    receiptHeader: o.receipt_header || null,
    receiptFooter: o.receipt_footer || null,
  }));
  const p = profile.data as { username?: string; full_name?: string; whatsapp?: string; email?: string } | null;
  return {
    business: toBusiness(biz.data),
    subscription: toSubscription(sub.data),
    profile: p?.username ? { username: p.username, fullName: p.full_name ?? '', whatsapp: p.whatsapp ?? '', email: p.email ?? '' } : null,
    counts: {
      outlets: outletRows.length,
      cashiers: Array.isArray(cashiers.data) ? cashiers.data.length : 0,
      products: Number(shell.products ?? 0),
      vouchers: Number(shell.vouchers ?? 0),
    },
    outlets: outletRows,
  };
}

/** Shell data for standalone subscription pages. */
export const getAppContext = createServerFn({ method: 'GET' }).handler(async (): Promise<ShellContext> => {
  const { requireClient } = await import('./supabase.server');
  return loadAppContext(await requireClient());
});

/**
 * Protected-layout bootstrap: one client, one claims check, one profile/business read.
 * The business id and username are derived from the same rows used to build the shell.
 */
export const getBackofficeBootstrap = createServerFn({ method: 'GET' }).handler(async (): Promise<BootstrapResult> => {
  const { supabaseServer } = await import('./supabase.server');
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || !claims.email) return { session: null, app: null };

  const app = await loadAppContext(supabase);
  const session: Session = {
    email: String(claims.email),
    userId: String(claims.sub),
    businessId: app.business.id || null,
    username: app.profile?.username ?? null,
  };
  return { session, app };
});

export const listNotifications = createServerFn({ method: 'GET' }).handler(async (): Promise<Notification[]> => {
  const { readRpc } = await import('./supabase.server');
  const rows = await readRpc<Record<string, unknown>[]>('list_notifications');
  return (rows ?? []).map(toNotification);
});

export const markNotificationsRead = createServerFn({ method: 'POST' })
  .validator(parser(z.object({ ids: z.array(z.string()) })))
  .handler(async ({ data }) => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('mark_notifications_read', { p_ids: data.ids });
    return { ok: res.ok };
  });

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase/client';
import { t } from '../../i18n';

/*
 * Subscription state for the POS (PRD G1 to G4, migration 030). Read-only for cashiers.
 * The last known status is kept on the device so the app still knows it is locked when it opens offline.
 * The database is the real lock: shifts, sales, and voids are refused there after expiry.
 */
export type SubState = 'trial' | 'active' | 'expired';
export interface SubscriptionStatus {
  state: SubState;
  planCode: string;
  planName: string;
  expiresAt: string;
  startedAt: string | null;
  daysLeft: number;
  unread: number;
  limits: { outlets: number; cashiersPerOutlet: number; productsPerOutlet: number } | null;
  checkedAt: number;
}
export interface AppNotification {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const KEY = '@hermes-pos/subscription:v1';
let status: SubscriptionStatus | null = null;
let failed = false;
const listeners = new Set<() => void>();
const emit = () =>
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });

function normalize(raw: any): SubscriptionStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const state: SubState = raw.state === 'expired' || raw.state === 'trial' ? raw.state : 'active';
  return {
    state,
    planCode: String(raw.plan_code ?? ''),
    planName: String(raw.plan_name ?? raw.plan_code ?? ''),
    expiresAt: String(raw.expires_at ?? ''),
    startedAt: raw.started_at ?? null,
    daysLeft: Math.max(0, Number(raw.days_left ?? 0)),
    unread: Number(raw.unread ?? 0),
    limits: raw.limits
      ? {
          outlets: Number(raw.limits.outlets ?? 1),
          cashiersPerOutlet: Number(raw.limits.cashiers_per_outlet ?? 0),
          productsPerOutlet: Number(raw.limits.products_per_outlet ?? 0),
        }
      : null,
    checkedAt: Date.now(),
  };
}

/** Expiry can pass while the app is open; recompute from the stored date. */
function withClock(s: SubscriptionStatus | null): SubscriptionStatus | null {
  if (!s || s.state === 'expired' || !s.expiresAt) return s;
  const left = new Date(s.expiresAt).getTime() - Date.now();
  return left <= 0 ? { ...s, state: 'expired', daysLeft: 0 } : s;
}

export async function loadCachedSubscription() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw && !status) {
      status = JSON.parse(raw);
      emit();
    }
  } catch {
    /* nothing cached */
  }
}

export async function refreshSubscription(): Promise<SubscriptionStatus | null> {
  const { data, error } = await supabase.rpc('get_subscription_status');
  if (error) {
    failed = true;
    emit();
    throw error;
  }
  failed = false;
  status = normalize(data);
  emit();
  if (status) void AsyncStorage.setItem(KEY, JSON.stringify(status)).catch(() => undefined);
  return status;
}

export async function clearSubscription() {
  status = null;
  emit();
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}

export function setUnread(n: number) {
  if (!status) return;
  status = { ...status, unread: n };
  emit();
}

export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc('list_notifications', { p_limit: limit });
  if (error) throw error;
  return ((data as any[]) ?? []).map((n) => ({ id: n.id, kind: n.kind, params: n.params ?? {}, readAt: n.read_at ?? null, createdAt: n.created_at }));
}

export async function markNotificationsRead(ids?: string[]) {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null });
  if (error) throw error;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
let last: { src: SubscriptionStatus | null; failed: boolean; lapsed: boolean; value: { status: SubscriptionStatus | null; failed: boolean } } | null = null;
const getSnap = () => {
  const lapsed = !!status && status.state !== 'expired' && !!status.expiresAt && new Date(status.expiresAt).getTime() <= Date.now();
  if (!last || last.src !== status || last.failed !== failed || last.lapsed !== lapsed) {
    last = { src: status, failed, lapsed, value: { status: withClock(status), failed } };
  }
  return last.value;
};

export function useSubscription() {
  return useSyncExternalStore(subscribe, getSnap, getSnap);
}

export const isLocked = (s: SubscriptionStatus | null) => s?.state === 'expired';

/** Plan name in the chosen language from the plan code (the database stores the Indonesian name). */
export function planLabel(s: Pick<SubscriptionStatus, 'planCode' | 'planName'> | null): string {
  switch (s?.planCode) {
    case 'trial':
      return t('Trial');
    case 'monthly':
      return t('Bulanan');
    case 'semiannual':
      return t('6 bulan|paket');
    case 'annual':
      return t('Tahunan');
    case 'unlimited':
      return t('Unlimited');
    default:
      return s?.planName ?? '-';
  }
}

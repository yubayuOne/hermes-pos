import { CartItem, CustomerInfo, Discount, PaymentInput } from '../../types/domain';
import { getCache, removeCache, setCache } from '../cache/cache';

export interface PendingCheckout {
  version: 1;
  savedAt: number;
  shiftId: string;
  cashierId: string;
  outletId: string;
  items: CartItem[];
  customer: CustomerInfo;
  billDiscount?: Discount | null;
  voucherCode?: string | null;
  payment: PaymentInput;
  idempotencyKey: string;
  parentTransactionId?: string | null;
  existingTransactionId?: string | null;
  /** The phone's id and number for the bill (054): a resend keeps them. */
  transactionId?: string | null;
  number?: string | null;
  kind: 'normal' | 'held' | 'split';
}

const KEY = 'pending-checkout:v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

export async function savePendingCheckout(value: Omit<PendingCheckout, 'version' | 'savedAt'>) {
  await setCache(KEY, { ...value, version: 1 as const, savedAt: Date.now() });
}

export async function getPendingCheckout(): Promise<PendingCheckout | null> {
  const value = await getCache<PendingCheckout>(KEY, MAX_AGE);
  if (!value || value.version !== 1 || !value.idempotencyKey) return null;
  return value;
}

export async function clearPendingCheckout() {
  await removeCache(KEY);
}

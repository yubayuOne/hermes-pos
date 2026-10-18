import AsyncStorage from '@react-native-async-storage/async-storage';
import { CartItem, CheckoutResult, CustomerInfo, Discount, ExpenseItem, PaymentInput, ProductStation, Shift } from '../../types/domain';
import { cachedOpenShift, checkout, closeShift, createTemporaryProduct, fetchOpenShift, forgetOpenShift, openShiftWithId, recordExpense } from './repository';
import { fetchRemainingBillItems, saveHeldBill, updateHeldBill } from './heldBills';
import { readHeldBill } from '../local/shiftData';
import { describeError, isUnknownCheckoutOutcome } from '../../utils/errors';
import { t } from '../../i18n';
import { isOnline } from '../network/network';
import { lineDiscount } from '../../utils/discount';

/**
 * Offline checkout queue.
 *
 * Used ONLY for payments (not split bills), held bills and their changes, and expenses that failed because of the network
 * ("unknown outcome"). The cashier has already taken the money, so the payment is stored on the
 * device and resent with the SAME idempotency key: if the first request did get recorded, the
 * server returns that transaction instead of creating a new one.
 *
 * - Stored in AsyncStorage directly (not through cache.ts) so it never expires and is not removed
 *   by clearHermesPosCache / clearOldCaches.
 * - Status: `waiting` (waiting for internet, sent automatically) or `conflict` (the server definitely
 *   refused, e.g. out of stock or shift closed; the cashier must review it, it is never dropped silently).
 * - A shift cannot close while it still has queued entries (checked in ShiftScreen).
 */

export type QueuedStatus = 'waiting' | 'conflict';
/**
 * 'checkout' = bill payment (default, older data), also of a recalled held bill when `existingTransactionId` is set;
 * 'hold' = a held bill not sent yet; 'update' = changes saved to a recalled held bill; 'expense' = an expense entry (043);
 * 'open_shift' / 'close_shift' / 'temp_product' = opening or closing `shiftId`, adding a temporary menu item (050).
 * shortcut: since 18 Oct 2026 shifts open and close only online, so nothing queues 'open_shift' or 'close_shift' any more;
 * they are still sent for phones that queued them with an older version. Remove both once no phone runs one.
 */
export type QueuedKind = 'checkout' | 'hold' | 'update' | 'expense' | 'open_shift' | 'close_shift' | 'temp_product';

export interface QueuedCheckout {
  /** Same as idempotencyKey. */
  id: string;
  idempotencyKey: string;
  kind?: QueuedKind;
  queuedAt: number;
  shiftId: string;
  cashierId: string;
  outletId: string;
  items: CartItem[];
  customer: CustomerInfo;
  billDiscount?: Discount | null;
  /** Voucher code; the server applies it again when the entry is sent (migration 032). */
  voucherCode?: string | null;
  payment: PaymentInput;
  /** Bill total (display only); the server recomputes it from database prices. */
  total: number;
  /** The held bill on the server: paid by a 'checkout', changed by an 'update'. The server refuses it if the bill is gone. */
  existingTransactionId?: string | null;
  /** A split-bill part of this held bill (a 'checkout'); parts go in order, the server keeps what remains. */
  parentTransactionId?: string | null;
  /** The phone's id and number for a new bill or held bill (migration 054). Older entries have none (TUNDA number). */
  transactionId?: string | null;
  number?: string | null;
  /** On the last split part: nothing of the parent is left to pay, so the held bill counts as paid. */
  closesParent?: boolean;
  /** kind 'expense' only; `items`, `customer`, and `payment` stay empty for it. */
  expense?: { paidFrom: 'drawer' | 'other'; items: ExpenseItem[] };
  /** kind 'open_shift' / 'close_shift' / 'temp_product' only, likewise with empty `items`. */
  shiftOpen?: { openingCash: number; openedAt: string };
  shiftClose?: { physicalCash: number; closedAt: string };
  product?: { id: string; name: string; price: number; station: ProductStation };
  status: QueuedStatus;
  /**
   * True once a request for it left while the phone was online and got no answer: the server may have it. A hold that
   * never left can be taken back off the queue and recalled; one that may have arrived cannot (it would be doubled).
   */
  maybeSent?: boolean;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export type EnqueueInput = Omit<QueuedCheckout, 'id' | 'queuedAt' | 'status' | 'attempts' | 'lastAttemptAt' | 'lastError'>;

export interface SyncSummary {
  synced: number;
  conflicts: number;
  remaining: number;
  /** True when it stopped because the network is still failing. */
  offline: boolean;
  /** True when another sync was already running (the result comes from that run). */
  shared: boolean;
}

export const QUEUE_KEY = '@hermes-pos/queue/checkout:v1';
/** Timeout for one checkout request. A weak signal often hangs without an error. */
export const CHECKOUT_TIMEOUT_MS = 15000;

let items: QueuedCheckout[] = [];
let loaded: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let running: Promise<SyncSummary> | null = null;
const listeners = new Set<() => void>();

/** Runs read-modify-write operations one at a time so they do not overwrite each other. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a listener must not break the queue */
    }
  });
}

async function persist(next: QueuedCheckout[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  items = next;
  emit();
}

function ensureLoaded() {
  if (!loaded) {
    loaded = (async () => {
      let raw: string | null;
      try {
        raw = await AsyncStorage.getItem(QUEUE_KEY);
      } catch (e) {
        // Do not treat an unreadable store as empty: the next persist would overwrite unsent sales.
        loaded = null;
        throw e;
      }
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        items = Array.isArray(parsed) ? parsed.filter((x) => x && x.idempotencyKey && x.shiftId) : [];
      } catch {
        // Corrupt JSON: keep the raw text so the sales can still be recovered by hand.
        await AsyncStorage.setItem(`${QUEUE_KEY}:corrupt`, raw ?? '').catch(() => undefined);
        items = [];
      }
      emit();
    })();
  }
  return loaded;
}

/** Loads the queue from storage (safe to call repeatedly). */
export async function loadQueue(): Promise<QueuedCheckout[]> {
  await ensureLoaded();
  return items;
}

export function getQueueSnapshot(): QueuedCheckout[] {
  return items;
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when this shift still has queued entries (waiting or conflict). */
export function hasQueuedForShift(shiftId: string): boolean {
  return items.some((i) => i.shiftId === shiftId);
}

/**
 * Adds a payment to the queue. Throws when storage fails; the caller must NOT clear the cart
 * if this fails.
 */
export async function enqueueCheckout(input: EnqueueInput): Promise<QueuedCheckout> {
  await ensureLoaded();
  return locked(async () => {
    const existing = items.find((i) => i.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const entry: QueuedCheckout = { ...input, id: input.idempotencyKey, queuedAt: Date.now(), status: 'waiting', attempts: 0 };
    await persist([...items, entry]);
    return entry;
  });
}

export async function removeQueued(id: string) {
  await ensureLoaded();
  await locked(async () => {
    if (!items.some((i) => i.id === id)) return;
    await persist(items.filter((i) => i.id !== id));
  });
}

/**
 * Takes an offline hold back off the queue, so it can go back on screen to be paid or changed. Only a hold that never
 * left the phone (not maybeSent) and only while no sync runs: otherwise the server may already have it, and recalling
 * it here would make a second bill. Returns null when it is not safe.
 */
export async function takeBackHold(id: string): Promise<QueuedCheckout | null> {
  await ensureLoaded();
  return locked(async () => {
    const e = items.find((i) => i.id === id);
    if (!e || e.kind !== 'hold' || e.maybeSent || running) return null;
    await persist(items.filter((i) => i.id !== id));
    return e;
  });
}

/** Moves a conflict entry back to `waiting` so it is retried (e.g. after the stock is fixed). */
export async function retryQueued(id: string) {
  await ensureLoaded();
  await locked(async () => {
    await persist(items.map((i) => (i.id === id ? { ...i, status: 'waiting' as const, lastError: undefined } : i)));
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Network timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * True while something an action needs exists only in the queue: its shift's opening or a temporary menu item. Sent
 * straight to the server it would be refused, so the action must queue behind it instead.
 */
export function waitsForQueue(shiftId: string, productIds: string[] = []) {
  return items.some(
    (i) => (i.kind === 'open_shift' && i.shiftId === shiftId) || (i.kind === 'temp_product' && !!i.product && productIds.includes(i.product.id)),
  );
}

/**
 * The cashier's open shift: the server's, or the one opened offline whose opening still waits in the queue (the
 * server does not know it yet). Otherwise the device copy is dropped, e.g. after a close made on another device.
 */
export async function resolveOpenShift(cashierId: string): Promise<Shift | null> {
  const shift = await fetchOpenShift(cashierId);
  await ensureLoaded().catch(() => undefined);
  const closing = (id: string) => items.some((c) => c.kind === 'close_shift' && c.shiftId === id);
  // Still open on the server but closed on this phone (the close waits in the queue): not open any more.
  if (shift && !closing(shift.id)) return shift;
  const opening = items.find((e) => e.kind === 'open_shift' && e.cashierId === cashierId && !closing(e.shiftId));
  const copy = opening ? await cachedOpenShift(cashierId) : null;
  if (copy && copy.id === opening?.shiftId) return copy;
  await forgetOpenShift(cashierId);
  return null;
}

/** The error a dropped request gives: callers take their offline path, which queues the action in order. */
export const queueFirst = () => new TypeError('Network request failed');

/** The held bill a waiting entry settles: paid whole, or its last split part. Shown as paid until the server knows. */
export function settlesHeldBill(e: QueuedCheckout): string | null {
  if (e.status !== 'waiting' || (e.kind ?? 'checkout') !== 'checkout') return null;
  return e.existingTransactionId || (e.closesParent ? (e.parentTransactionId ?? null) : null);
}

/**
 * What is left to pay of a held bill for the next split part. Online: the server's count. Offline: the count in the
 * local copy of the shift (057), or the bill as held or changed offline when that is still queued, minus the parts still
 * in the queue, which carry exactly the quantities and discounts the server will book. Null when the device has no count
 * for it (never loaded, or changed offline with a bill discount).
 */
export async function remainingForSplit(shiftId: string, parentId: string): Promise<Array<CartItem & { remainingDiscount: number }> | null> {
  await ensureLoaded();
  try {
    if (!billWaits(parentId)) return await fetchRemainingBillItems(parentId);
  } catch (e) {
    if (!isUnknownCheckoutOutcome(e)) throw e;
  }
  // A hold or change still queued is newer than the server's count, which then no longer matches the bill.
  const queuedVersion = items.some((e) => (e.kind === 'update' && e.existingTransactionId === parentId) || (e.kind === 'hold' && e.transactionId === parentId));
  const base = queuedVersion ? latestOfflineVersion(parentId) : ((await readHeldBill(shiftId, parentId).catch(() => null))?.remaining ?? null);
  if (!base) return null;
  const left = new Map(base.map((i) => [i.productId, { ...i }]));
  for (const part of items.filter((e) => e.parentTransactionId === parentId)) {
    for (const p of part.items) {
      const l = left.get(p.productId);
      if (!l) continue;
      l.quantity -= p.quantity;
      l.remainingDiscount -= p.discount?.type === 'amount' ? p.discount.value : 0;
    }
  }
  return [...left.values()].filter((i) => i.quantity > 0).map((i) => ({ ...i, remainingDiscount: Math.max(0, i.remainingDiscount) }));
}

/**
 * A held bill as last saved on this phone and not sent yet (its queued hold or newest change), as split lines. Each
 * line's discount is its own (item discount, the same rounding as the server). Null with a bill discount: how the
 * server spreads that over the lines is its decision, so that split waits for the server's count.
 */
function latestOfflineVersion(billId: string): Array<CartItem & { remainingDiscount: number }> | null {
  const v = [...items].reverse().find((e) => (e.kind === 'update' && e.existingTransactionId === billId) || (e.kind === 'hold' && e.transactionId === billId));
  if (!v || v.billDiscount) return null;
  return v.items.map((i) => ({ ...i, remainingDiscount: lineDiscount(i) }));
}

/** Marks the newest queued part of a split bill as its last one (nothing left), see settlesHeldBill. */
export async function markParentClosed(parentId: string) {
  await ensureLoaded();
  await locked(async () => {
    const last = [...items].reverse().find((e) => e.parentTransactionId === parentId);
    if (!last || last.closesParent) return;
    await persist(items.map((i) => (i.id === last.id ? { ...i, closesParent: true } : i)));
  });
}

/** Whether a queue entry is about this bill: makes it (hold), changes it, pays it, or pays a part of it. */
export const concerns = (e: QueuedCheckout, billId: string) =>
  e.transactionId === billId || e.existingTransactionId === billId || e.parentTransactionId === billId;

/** True while something for this held bill is still queued: anything new for it must queue behind (not go straight out). */
export const billWaits = (billId: string) => items.some((e) => concerns(e, billId));

/** checkout() with a timeout. A timeout counts as an "unknown outcome" (isUnknownCheckoutOutcome). */
export function submitCheckout(args: Parameters<typeof checkout>[0], timeoutMs = CHECKOUT_TIMEOUT_MS): Promise<CheckoutResult> {
  // A payment of a held bill or of a split part never overtakes what is queued for that bill before it: the hold made
  // offline, its changes, or earlier parts.
  const at = items.findIndex((e) => e.idempotencyKey === args.idempotencyKey);
  const earlier = at === -1 ? items : items.slice(0, at);
  const bill = args.existingTransactionId ?? args.parentTransactionId;
  if (
    (!!bill && earlier.some((e) => concerns(e, bill))) ||
    waitsForQueue(
      args.shiftId,
      args.items.map((i) => i.productId),
    )
  )
    return Promise.reject(queueFirst());
  return withTimeout(checkout(args), timeoutMs);
}

async function patch(id: string, fields: Partial<QueuedCheckout>) {
  await locked(async () => {
    if (!items.some((i) => i.id === id)) return;
    await persist(items.map((i) => (i.id === id ? { ...i, ...fields } : i)));
  });
}

async function runSync(who: { cashierId?: string; outletId: string } | null): Promise<SyncSummary> {
  await ensureLoaded();
  let synced = 0;
  let conflicts = 0;
  let offline = false;

  // Oldest first. Entries of other cashiers/outlets are skipped (they cannot pass assert_cashier).
  const todo = items.filter((i) => i.status === 'waiting' && (!who || (i.outletId === who.outletId && (!who.cashierId || i.cashierId === who.cashierId))));
  for (const entry of todo) {
    if (!items.some((i) => i.id === entry.id)) continue; // taken off the queue meanwhile (e.g. an offline hold recalled)
    // Leaves the phone only when online and not held back behind another entry; see maybeSent.
    const tried =
      isOnline() &&
      !waitsForQueue(
        entry.shiftId,
        entry.items.map((i) => i.productId),
      );
    // A close goes last for its shift: while any other entry of that shift is still here (waiting or refused), the
    // close and everything after it (the next shift) wait, so nothing lands in a closed shift.
    if (entry.kind === 'close_shift' && items.some((i) => i.shiftId === entry.shiftId && i.id !== entry.id && i.kind !== 'close_shift')) break;
    try {
      if (entry.kind === 'open_shift' && entry.shiftOpen) {
        await withTimeout(
          openShiftWithId({ shiftId: entry.shiftId, cashierId: entry.cashierId, outletId: entry.outletId, ...entry.shiftOpen }),
          CHECKOUT_TIMEOUT_MS,
        );
      } else if (entry.kind === 'close_shift' && entry.shiftClose) {
        await withTimeout(closeShift({ shiftId: entry.shiftId, ...entry.shiftClose }), CHECKOUT_TIMEOUT_MS);
      } else if (entry.kind === 'temp_product' && entry.product) {
        await withTimeout(
          createTemporaryProduct({ productId: entry.product.id, cashierId: entry.cashierId, outletId: entry.outletId, ...entry.product }),
          CHECKOUT_TIMEOUT_MS,
        );
      } else if (entry.kind === 'expense' && entry.expense) {
        await withTimeout(
          recordExpense({
            shiftId: entry.shiftId,
            cashierId: entry.cashierId,
            outletId: entry.outletId,
            paidFrom: entry.expense.paidFrom,
            items: entry.expense.items,
            idempotencyKey: entry.idempotencyKey,
          }),
          CHECKOUT_TIMEOUT_MS,
        );
      } else if (entry.kind === 'hold') {
        await withTimeout(
          saveHeldBill({
            shiftId: entry.shiftId,
            cashierId: entry.cashierId,
            outletId: entry.outletId,
            items: entry.items,
            customer: entry.customer,
            billDiscount: entry.billDiscount,
            idempotencyKey: entry.idempotencyKey,
            transactionId: entry.transactionId ?? null,
            number: entry.number ?? null,
          }),
          CHECKOUT_TIMEOUT_MS,
        );
      } else if (entry.kind === 'update' && entry.existingTransactionId) {
        await withTimeout(
          updateHeldBill({ transactionId: entry.existingTransactionId, items: entry.items, customer: entry.customer, billDiscount: entry.billDiscount }),
          CHECKOUT_TIMEOUT_MS,
        );
      } else {
        await submitCheckout({
          shiftId: entry.shiftId,
          cashierId: entry.cashierId,
          outletId: entry.outletId,
          items: entry.items,
          customer: entry.customer,
          billDiscount: entry.billDiscount,
          voucherCode: entry.voucherCode ?? null,
          payment: entry.payment,
          idempotencyKey: entry.idempotencyKey,
          existingTransactionId: entry.existingTransactionId ?? null,
          parentTransactionId: entry.parentTransactionId ?? null,
          transactionId: entry.transactionId ?? null,
          number: entry.number ?? null,
        });
      }
      await removeQueued(entry.id);
      synced++;
    } catch (e) {
      if (isUnknownCheckoutOutcome(e)) {
        await patch(entry.id, { attempts: entry.attempts + 1, lastAttemptAt: Date.now(), maybeSent: !!entry.maybeSent || tried });
        offline = true;
        break; // network still failing: do not try other entries now
      }
      // The server definitely refused (transaction rolled back). The money was taken, so do NOT drop it:
      // mark it as a conflict for the cashier to review.
      await patch(entry.id, {
        status: 'conflict',
        attempts: entry.attempts + 1,
        lastAttemptAt: Date.now(),
        lastError: describeError(e, t('Server menolak pembayaran ini.')).message,
      });
      conflicts++;
    }
  }
  return { synced, conflicts, remaining: items.length, offline, shared: false };
}

/**
 * Sends the queue to the server. Only one run at a time; other callers wait for the result of
 * the same run.
 */
export function syncCheckoutQueue(who: { cashierId?: string; outletId: string } | null = null): Promise<SyncSummary> {
  if (running) return running.then((r) => ({ ...r, shared: true }));
  running = runSync(who).finally(() => {
    running = null;
    emit();
  });
  emit();
  return running;
}

/**
 * Subtracts queued sales (not recorded on the server yet) from catalog stock, so the cashier does
 * not oversell while offline. Called every time the catalog reloads from the server.
 * Only `waiting` entries; sent ones were already subtracted by the server.
 */
export function applyQueuedStock<T extends { id: string; stock: number; trackStock?: boolean }>(products: T[]): T[] {
  const used = new Map<string, number>();
  for (const e of items) {
    // Only payments reduce stock: not holds, held-bill changes, or expenses.
    if (e.status !== 'waiting' || (e.kind && e.kind !== 'checkout')) continue;
    for (const i of e.items) used.set(i.productId, (used.get(i.productId) ?? 0) + i.quantity);
  }
  if (!used.size) return products;
  return products.map((p) => {
    const q = used.get(p.id);
    return q && p.trackStock !== false ? { ...p, stock: Math.max(0, p.stock - q) } : p;
  });
}

export function isSyncing() {
  return running !== null;
}

/** Tests only. */
export function __resetForTests() {
  items = [];
  loaded = null;
  chain = Promise.resolve();
  running = null;
  listeners.clear();
}

/** Provisional number printed and shown until the server issues the real one (PRD E1). */
/** The number to show for a queue entry: its final number (054), or the provisional one of older entries. */
export const entryNumber = (e: QueuedCheckout) => e.number ?? provisionalNumber(e.idempotencyKey);

export function provisionalNumber(key: string) {
  return `TUNDA-${key
    .replace(/[^a-z0-9]/gi, '')
    .slice(-6)
    .toUpperCase()}`;
}

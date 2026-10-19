import { supabase } from '../supabase/client';
import { t } from '../../i18n';
import { invalidateCatalogFreshness } from '../catalog/freshness';
import { getCache, removeCache, setCache } from '../cache/cache';
import { isNetworkError } from '../../utils/errors';
import { forgetOpenShiftRow, readCatalog, readOpenShiftRow, readVouchers, syncReference } from '../local/reference';
import { cleanNote } from '../../utils/note';
import { billPayload } from './heldBills';
import { localDb } from '../local/db';
import { businessDay, businessTimeZone } from '../local/billNumber';
import {
  CartItem,
  CheckoutResult,
  CustomerInfo,
  Discount,
  Expense,
  ExpenseItem,
  PaymentInput,
  Product,
  ProductStation,
  Refund,
  Shift,
  ShiftRecord,
  TransactionItemSummary,
  TransactionSummary,
  Voucher,
} from '../../types/domain';
/**
 * The menu, from the local database (offline architecture, stage 1). It syncs first; when that fails (offline) the
 * last synced copy is used. Throws only when there is none at all yet (first start without internet).
 */
export async function fetchCatalog(outletId: string): Promise<{ products: Product[]; categories: { id: string; name: string }[] }> {
  let failure: unknown = null;
  await syncReference(outletId).catch((e) => {
    failure = e;
  });
  const local = await readCatalog(outletId);
  if (failure && !local.products.length && !local.categories.length) throw failure;
  return local;
}
const SHIFT_COLS = 'id,cashier_id,business_date,shift_number,opened_at,opening_cash,status,closed_at,closing_cash,expected_cash,variance,device_id';
export const toShift = (row: any): Shift => ({
  id: row.id,
  cashierId: row.cashier_id,
  businessDate: row.business_date,
  shiftNumber: Number(row.shift_number),
  openedAt: row.opened_at,
  openingCash: Number(row.opening_cash ?? 0),
  status: row.status,
  closedAt: row.closed_at,
  closingCash: row.closing_cash == null ? null : Number(row.closing_cash),
  expectedCash: row.expected_cash == null ? null : Number(row.expected_cash),
  variance: row.variance == null ? null : Number(row.variance),
  deviceId: row.device_id ?? null,
});

/**
 * The cashier's open shift. Offline, the last answer kept on the device is used, so an app restarted without internet
 * can still sell; the server still refuses queued sales if that shift was closed elsewhere meanwhile.
 */
export async function fetchOpenShift(cashierId: string): Promise<Shift | null> {
  const key = `open-shift:${cashierId}`;
  const { data, error } = await supabase.from('shifts').select(SHIFT_COLS).eq('cashier_id', cashierId).eq('status', 'open').maybeSingle();
  if (error) {
    if (!isNetworkError(error)) throw error;
    // Offline: this phone's own copy first (it may hold a shift opened offline), then the outlet snapshot (053), which
    // knows a shift opened on another phone or before this cashier ever signed in here. Null = none open.
    const copy = await getCache<Shift>(key, 48 * 60 * 60 * 1000).catch(() => null);
    if (copy) return copy;
    const row = await readOpenShiftRow(cashierId).catch(() => null);
    return row ? toShift(row) : null;
  }
  const shift = data ? toShift(data) : null;
  // No open shift: the device copy is dropped by resolveOpenShift, which knows whether an opening still waits in the queue.
  if (shift) rememberShift(shift);
  return shift;
}

/** The device copy of the cashier's open shift, or null. */
export async function cachedOpenShift(cashierId: string): Promise<Shift | null> {
  return getCache<Shift>(`open-shift:${cashierId}`, 48 * 60 * 60 * 1000).catch(() => null);
}

/**
 * Shifts of this outlet, any cashier, closed in the last 24 hours: their bills can still be refunded (migration 033).
 * The POS signs in with the owner account, so RLS "owner reads shifts" covers every cashier of the outlet.
 */
export async function fetchRecentClosedShifts(outletId: string): Promise<Shift[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('shifts')
    .select(SHIFT_COLS)
    .eq('outlet_id', outletId)
    .eq('status', 'closed')
    .gte('closed_at', since)
    .order('opened_at', { ascending: false })
    .limit(10);
  if (error) {
    if (!isNetworkError(error)) throw error;
    // Offline: the closed shifts in the local database (055), so their bills can still be picked in the Bill tab.
    return (await localShifts(outletId))
      .filter((s) => s.status === 'closed' && !!s.closedAt && Date.parse(s.closedAt) >= Date.parse(since))
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
      .slice(0, 10);
  }
  return (data ?? []).map(toShift);
}

/** The shifts this phone keeps in its local database (055), as last synced; null = every outlet. */
async function localShifts(outletId: string | null): Promise<Shift[]> {
  const db = await localDb();
  const rows = await db.getAllAsync<{ outlet_id: string; shift: string | null }>(
    "select outlet_id, json_extract(data, '$.shift') as shift from shift_snapshots",
  );
  return rows.filter((r) => r.shift && (!outletId || r.outlet_id === outletId)).map((r) => toShift(JSON.parse(r.shift as string)));
}
export async function fetchTodayShifts(cashierId: string): Promise<Shift[]> {
  // Same date the server gives a shift that opens now (064: the business's zone).
  const d = businessDay(new Date(), await businessTimeZone());
  const businessDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  const { data, error } = await supabase
    .from('shifts')
    .select(SHIFT_COLS)
    .eq('cashier_id', cashierId)
    .eq('business_date', businessDate)
    .order('shift_number', { ascending: true });
  if (error) {
    if (!isNetworkError(error)) throw error;
    // Offline: today's shifts of this cashier that are in the local database (055).
    return (await localShifts(null)).filter((s) => s.cashierId === cashierId && s.businessDate === businessDate).sort((a, b) => a.shiftNumber - b.shiftNumber);
  }
  return (data ?? []).map(toShift);
}

/** Opens a shift with an id made on the phone (migration 050), so the offline queue can resend it safely. */
export async function openShiftWithId(args: { shiftId: string; cashierId: string; outletId: string; openingCash: number; openedAt: string }) {
  const { error } = await supabase.rpc('open_shift_with_id', {
    p_shift_id: args.shiftId,
    p_cashier_id: args.cashierId,
    p_outlet_id: args.outletId,
    p_opening_cash: args.openingCash,
    p_opened_at: args.openedAt,
  });
  if (error) throw error;
}

export async function openShift(args: { shiftId: string; cashierId: string; outletId: string; openingCash: number; openedAt: string }): Promise<Shift> {
  await openShiftWithId(args);
  const opened = await fetchOpenShift(args.cashierId);
  if (!opened) throw new Error(t('Shift sudah dibuka tetapi belum bisa dimuat. Buka tab Shift lagi.'));
  return opened;
}

/** Device copy of the open shift, so the app reopened without internet goes on with it. */
function rememberShift(shift: Shift) {
  void setCache(`open-shift:${shift.cashierId}`, shift).catch(() => undefined);
}

/** Moves a shift opened on another (lost or broken) phone to this one, with the owner's approval code (migration 051). */
export async function takeOverShift(shiftId: string, code: string): Promise<{ ok: true } | Exclude<VoidResult, { ok: true }>> {
  const { data, error } = await supabase.rpc('take_over_shift', { p_shift_id: shiftId, p_code: code });
  if (error) throw error;
  const d: any = data ?? {};
  if (d.ok) return { ok: true };
  if (d.reason === 'wrong') return { ok: false, reason: 'wrong', attemptsLeft: Number(d.attempts_left ?? 0) };
  if (d.reason === 'locked') return { ok: false, reason: 'locked', lockedUntil: String(d.locked_until ?? '') };
  return { ok: false, reason: 'no_code' };
}

/** Forgets the device copy of the open shift, after a close (online or queued). */
export async function forgetOpenShift(cashierId: string) {
  await removeCache(`open-shift:${cashierId}`).catch(() => undefined);
  await forgetOpenShiftRow(cashierId).catch(() => undefined); // the snapshot copy too, until the next sync
}
export interface CloseShiftResult {
  expected_cash: number;
  variance: number;
  cash_in: number;
  cash_out: number;
  qris_reported: number | null;
  qris_variance: number | null;
}

/**
 * Closes a shift (migration 050; the QRIS total from the merchant app since 075). Resending the same close returns the
 * stored result, so the queue can retry it. A close queued by an older version has no QRIS total.
 */
export async function closeShift(args: { shiftId: string; physicalCash: number; closedAt: string; qrisReported?: number }): Promise<CloseShiftResult> {
  const { data, error } = await supabase.rpc('close_shift_at', {
    p_shift_id: args.shiftId,
    p_physical_cash: args.physicalCash,
    p_closed_at: args.closedAt,
    p_qris_reported: args.qrisReported ?? null,
  });
  if (error) throw error;

  const d = data as any;
  return {
    expected_cash: Number(d?.expected_cash ?? 0),
    variance: Number(d?.variance ?? 0),
    cash_in: Number(d?.cash_in ?? 0),
    cash_out: Number(d?.cash_out ?? 0),
    qris_reported: d?.qris_reported == null ? null : Number(d.qris_reported),
    qris_variance: d?.qris_variance == null ? null : Number(d.qris_variance),
  };
}

export async function checkout(args: {
  shiftId: string;
  cashierId: string;
  outletId: string;
  items: CartItem[];
  customer: CustomerInfo;
  billDiscount?: Discount | null;
  payment: PaymentInput;
  idempotencyKey: string;
  parentTransactionId?: string | null;
  existingTransactionId?: string | null;
  voucherCode?: string | null;
  /** The phone's id and number for a new bill (migration 054); without them the server numbers it. */
  transactionId?: string | null;
  number?: string | null;
}): Promise<CheckoutResult> {
  // The server recomputes every discount from database prices; the client only sends type and value.
  const payload = { ...billPayload(args.items, args.customer, args.billDiscount), ...(args.voucherCode ? { voucher_code: args.voucherCode } : {}) };
  const own = args.transactionId && args.number ? { p_transaction_id: args.transactionId, p_number: args.number } : null;
  const { data, error } = await supabase.rpc(own ? 'complete_checkout_v2' : 'complete_checkout', {
    ...own,
    p_shift_id: args.shiftId,
    p_cashier_id: args.cashierId,
    p_outlet_id: args.outletId,
    p_payload: payload,
    p_payment_method: args.payment.method,
    p_amount_received: args.payment.amountReceived,
    p_external_reference: args.payment.externalReference ?? null,
    p_idempotency_key: args.idempotencyKey,
    p_parent_transaction_id: args.parentTransactionId ?? null,
    p_existing_transaction_id: args.existingTransactionId ?? null,
  });
  invalidateCatalogFreshness(args.outletId); // stock changed on the server -> the sell screen refetches the catalog
  if (error) throw error;
  return data as CheckoutResult;
}
/** Temporary menu item with an id made on the phone (migration 050), so the offline queue can resend it safely. */
export async function createTemporaryProduct(args: {
  productId: string;
  cashierId: string;
  outletId: string;
  name: string;
  price: number;
  station: ProductStation;
}): Promise<Product> {
  const { data, error } = await supabase.rpc('create_temporary_product_with_id', {
    p_product_id: args.productId,
    p_cashier_id: args.cashierId,
    p_outlet_id: args.outletId,
    p_name: args.name,
    p_price: args.price,
    p_station: args.station,
  });
  if (error) throw error;
  return {
    id: data as string,
    categoryId: null,
    name: args.name,
    hpp: 0,
    price: args.price,
    stock: 0,
    trackStock: false,
    imageUrl: null,
    station: args.station,
  };
}

/** get_shift_cash_summary's answer, inside pos_shift_snapshot (057). */
export const toCashSummary = (data: unknown) => ({
  cashIn: Number((data as any)?.cash_in ?? 0),
  cashOut: Number((data as any)?.cash_out ?? 0),
  expectedCash: Number((data as any)?.expected_cash ?? 0),
});

export interface DashboardSummary {
  count: number;
  sales: number;
  cash: number;
  qris: number;
  refundTotal: number;
  totalItems: number;
  menuCount: number;
  previousSales: number;
  hourly: { hour: number; total: number }[];
  top: { name: string; station: ProductStation; qty: number; subtotal: number }[];
}

/** get_dashboard_summary's answer for the shift, inside pos_shift_snapshot (057). */
export function toDashboard(data: unknown): DashboardSummary {
  const d: any = data ?? {};
  return {
    count: Number(d.count ?? 0),
    sales: Number(d.sales ?? 0),
    cash: Number(d.cash ?? 0),
    qris: Number(d.qris ?? 0),
    refundTotal: Number(d.refundTotal ?? 0),
    totalItems: Number(d.totalItems ?? 0),
    menuCount: Number(d.menuCount ?? 0),
    previousSales: Number(d.previousSales ?? 0),
    hourly: (d.hourly ?? []).map((h: any) => ({ hour: Number(h.hour), total: Number(h.total ?? 0) })),
    top: (d.top ?? []).map((x: any) => ({
      name: x.name,
      station: (x.station ?? 'kitchen') as ProductStation,
      qty: Number(x.qty ?? 0),
      subtotal: Number(x.subtotal ?? 0),
    })),
  };
}

export interface BillPage {
  rows: TransactionSummary[];
  completedCount: number;
  heldCount: number;
  voidedCount: number;
}

/** One page of the compact bill list (no items). Held bills: total and count are what remains after splits. */
export async function fetchShiftBills(args: {
  shiftId: string;
  status: 'completed' | 'held' | 'voided';
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<BillPage> {
  const { data, error } = await supabase.rpc('list_shift_bills', {
    p_shift_id: args.shiftId,
    p_status: args.status,
    p_search: args.search ?? '',
    p_limit: args.limit ?? 30,
    p_offset: args.offset ?? 0,
  });
  if (error) throw error;
  const d: any = data ?? {};
  return {
    completedCount: Number(d.completedCount ?? 0),
    heldCount: Number(d.heldCount ?? 0),
    voidedCount: Number(d.voidedCount ?? 0),
    rows: (d.rows ?? []).map(toBillRow),
  };
}

/** A row of list_shift_bills (also inside pos_shift_snapshot, 055). */
export const toBillRow = (t: any): TransactionSummary => ({
  id: t.id,
  number: t.number,
  customerName: t.customerName ?? '',
  customerPhone: t.customerPhone ?? '',
  table: t.table ?? '',
  status: t.status,
  total: Number(t.total ?? 0),
  paymentMethod: t.paymentMethod,
  createdAt: t.createdAt,
  itemCount: Number(t.itemCount ?? 0),
  subtotal: Number(t.subtotal ?? t.total ?? 0),
  itemDiscount: Number(t.itemDiscount ?? 0),
  billDiscount: Number(t.billDiscount ?? 0),
  voidReason: t.voidReason ?? null,
  refundedTotal: Number(t.refundedTotal ?? 0),
  items: [],
});

/** Items of one bill (held bill: remaining items). Loaded when the detail opens. */
export async function fetchBillItems(transactionId: string): Promise<TransactionItemSummary[]> {
  const { data, error } = await supabase.rpc('get_bill_items', { p_transaction_id: transactionId });
  if (error) throw error;
  return ((data as any[]) ?? []).map(toBillItem);
}

/** A line of get_bill_items (also inside pos_shift_snapshot, 055). */
export const toBillItem = (i: any): TransactionItemSummary => ({
  itemId: i.itemId ?? undefined,
  refundedQty: Number(i.refundedQty ?? 0),
  trackStock: i.trackStock !== false,
  productId: i.productId,
  productName: i.productName ?? t('Produk'),
  station: (i.station ?? 'kitchen') as ProductStation,
  quantity: Number(i.quantity ?? 0),
  unitPrice: Number(i.unitPrice ?? 0),
  subtotal: Number(i.subtotal ?? 0),
  discount: Number(i.discount ?? 0),
  note: cleanNote(i.note) || null,
});

export type VoidResult =
  | { ok: true; number: string; total: number; paymentMethod: string | null; alreadyVoided: boolean }
  | { ok: false; reason: 'no_code' }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; lockedUntil: string };

/**
 * Void a paid bill with the owner's approval code (migration 032). Shift must still be open; stock comes back and
 * the cash drawer is corrected. Needs internet and is never queued.
 */
export async function voidTransaction(transactionId: string, reason: string, code: string): Promise<VoidResult> {
  const { data, error } = await supabase.rpc('void_transaction_approved', { p_transaction_id: transactionId, p_reason: reason, p_code: code });
  if (error) throw error;
  const d: any = data ?? {};
  if (!d.ok) {
    if (d.reason === 'wrong') return { ok: false, reason: 'wrong', attemptsLeft: Number(d.attempts_left ?? 0) };
    if (d.reason === 'locked') return { ok: false, reason: 'locked', lockedUntil: String(d.locked_until ?? '') };
    return { ok: false, reason: 'no_code' };
  }
  invalidateCatalogFreshness();
  return { ok: true, number: d.number ?? '', total: Number(d.total ?? 0), paymentMethod: d.paymentMethod ?? null, alreadyVoided: !!d.alreadyVoided };
}

export type RefundResult =
  | { ok: true; refundId: string; number: string; amount: number; method: 'cash' | 'qris'; refundedTotal: number; fullyRefunded: boolean }
  | Exclude<VoidResult, { ok: true }>;

/**
 * Refund items of a paid bill with the owner's approval code (migration 033). Amounts are computed by the server; the
 * refund lands in the caller's open shift. Pass the same idempotencyKey on retry so a double tap refunds once.
 * Needs internet and is never queued.
 */
export async function refundItems(args: {
  transactionId: string;
  shiftId: string;
  cashierId: string;
  method: 'cash' | 'qris';
  reason: string;
  code: string;
  idempotencyKey: string;
  items: Array<{ itemId: string; quantity: number; restock: boolean }>;
}): Promise<RefundResult> {
  const { data, error } = await supabase.rpc('refund_items_approved', {
    p_transaction_id: args.transactionId,
    p_shift_id: args.shiftId,
    p_cashier_id: args.cashierId,
    p_items: args.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity, restock: i.restock })),
    p_method: args.method,
    p_reason: args.reason,
    p_code: args.code,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
  const d: any = data ?? {};
  if (!d.ok) {
    if (d.reason === 'wrong') return { ok: false, reason: 'wrong', attemptsLeft: Number(d.attempts_left ?? 0) };
    if (d.reason === 'locked') return { ok: false, reason: 'locked', lockedUntil: String(d.locked_until ?? '') };
    return { ok: false, reason: 'no_code' };
  }
  if (args.items.some((i) => i.restock)) invalidateCatalogFreshness();
  return {
    ok: true,
    refundId: String(d.refundId),
    number: d.number ?? '',
    amount: Number(d.amount ?? 0),
    method: d.method === 'qris' ? 'qris' : 'cash',
    refundedTotal: Number(d.refundedTotal ?? 0),
    fullyRefunded: !!d.fullyRefunded,
  };
}

/**
 * Vouchers the cashier can pick today (migrations 044, 052), from the local database after a sync. `fresh` is false
 * when the sync failed and the last synced list is shown (owner's choice: vouchers work offline; checkout checks again).
 */
export async function loadVouchers(outletId: string): Promise<{ list: Voucher[]; fresh: boolean }> {
  const fresh = await syncReference(outletId).then(
    () => true,
    () => false,
  );
  return { list: await readVouchers(outletId, toVoucher), fresh };
}

function toVoucher(d: any): Voucher {
  return {
    code: String(d.code ?? '').toUpperCase(),
    scope: d.scope === 'products' ? 'products' : 'bill',
    discountType: d.discount_type === 'amount' ? 'amount' : 'percent',
    value: Number(d.value ?? 0),
    minSpend: Number(d.min_spend ?? 0),
    productIds: Array.isArray(d.product_ids) ? d.product_ids.map(String) : [],
  };
}

export const toExpense = (d: any): Expense => ({
  id: String(d.id),
  createdAt: String(d.createdAt),
  total: Number(d.total ?? 0),
  drawerTotal: Number(d.drawerTotal ?? 0),
  items: ((d.items as any[]) ?? []).map((i) => ({
    name: String(i.name),
    category: i.category === 'operasional' ? 'operasional' : 'belanja',
    quantity: Number(i.quantity),
    unit: String(i.unit),
    amount: Number(i.amount),
    paidFrom: i.paidFrom === 'other' ? 'other' : 'drawer',
  })),
});

/** Adds items to the shift's expense record (migrations 040, 041, 043) and returns that record. From the drawer it leaves the shift's cash at once. Offline: queued (offlineQueue). */
export async function recordExpense(args: {
  shiftId: string;
  cashierId: string;
  outletId: string;
  paidFrom: 'drawer' | 'other';
  items: ExpenseItem[];
  idempotencyKey: string;
}): Promise<Expense> {
  const { data, error } = await supabase.rpc('record_expense', {
    p_shift_id: args.shiftId,
    p_cashier_id: args.cashierId,
    p_outlet_id: args.outletId,
    p_paid_from: args.paidFrom,
    p_items: args.items,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
  return toExpense(data);
}

/** Zero or one record: one per shift since 041. */
export async function fetchShiftExpenses(shiftId: string): Promise<Expense[]> {
  const { data, error } = await supabase.rpc('list_shift_expenses', { p_shift_id: shiftId });
  if (error) throw error;
  return ((data as any[]) ?? []).map(toExpense);
}

/** Every shift of the outlet (open and closed), newest first. Next page: pass the last row's openedAt as `before`. `from`: period start (045). */
export async function fetchOutletShifts(
  cashierId: string,
  outletId: string,
  before: string | null,
  limit = 30,
  from: string | null = null,
): Promise<ShiftRecord[]> {
  const { data, error } = await supabase.rpc('list_outlet_shifts', {
    p_cashier_id: cashierId,
    p_outlet_id: outletId,
    p_before: before,
    p_limit: limit,
    p_from: from,
  });
  if (error) throw error;
  return ((data as any[]) ?? []).map((d) => ({
    ...toShift({
      id: d.id,
      cashier_id: d.cashierId,
      business_date: d.businessDate,
      shift_number: d.shiftNumber,
      opened_at: d.openedAt,
      opening_cash: d.openingCash,
      status: d.status,
      closed_at: d.closedAt,
      closing_cash: d.closingCash,
      expected_cash: d.expectedCash,
      variance: d.variance,
    }),
    cashierName: String(d.cashierName ?? ''),
    sales: Number(d.sales ?? 0),
    expenses: Number(d.expenses ?? 0),
  }));
}

export const toRefunds = (data: unknown): Refund[] =>
  ((data as any[]) ?? []).map((d) => ({
    id: String(d.id),
    createdAt: String(d.createdAt),
    number: String(d.number ?? ''),
    method: d.method === 'qris' ? 'qris' : 'cash',
    amount: Number(d.amount ?? 0),
    reason: String(d.reason ?? ''),
    cashierName: String(d.cashierName ?? ''),
    items: ((d.items as any[]) ?? []).map((i) => ({
      productName: String(i.productName),
      quantity: Number(i.quantity),
      amount: i.amount == null ? undefined : Number(i.amount),
    })),
  }));

/** Refunds made in this shift (any bill), oldest first. */
export async function fetchShiftRefunds(shiftId: string): Promise<Refund[]> {
  const { data, error } = await supabase.rpc('list_shift_refunds', { p_shift_id: shiftId });
  if (error) throw error;
  return toRefunds(data);
}

/** Refunds of one bill with their reasons, oldest first. */
export async function fetchBillRefunds(transactionId: string): Promise<Refund[]> {
  const { data, error } = await supabase.rpc('list_bill_refunds', { p_transaction_id: transactionId });
  if (error) throw error;
  return toRefunds(data);
}

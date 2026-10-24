import { DEFAULT_TZ, dayDiff, isoDay } from '@hermes-pos/ui';
import { UNITS, type Unit } from '../lib/units';
import { expenseItemIdOf } from '../lib/purchase';
import type {
  Ingredient,
  OutletTable,
  IngredientImpact,
  CountResultLine,
  Purchase,
  PurchaseList,
  RecipeCost,
  StockDocument,
  StockDocumentList,
  StockItem,
  ExpenseItem,
  Bill,
  CheckFailure,
  DayClose,
  TrailEntry,
  BillEdit,
  BillItem,
  BillSnapshot,
  BillList,
  BillRefund,
  Business,
  Expense,
  ExpenseList,
  Notification,
  Payment,
  PlanCode,
  Pnl,
  Report,
  Subscription,
  Voucher,
} from '../lib/types';

// Maps database rows to the shapes the screens use. get_subscription_status and list_notifications come from
// migration 030; the readers accept the few key spellings that migration may use.

type Row = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v === null || v === undefined ? d : String(v));
const pick = (r: Row, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== null);

const PLAN_CODES: PlanCode[] = ['trial', 'monthly', 'semiannual', 'annual', 'unlimited'];
function planCode(v: unknown): PlanCode {
  const s = str(v).toLowerCase();
  if ((PLAN_CODES as string[]).includes(s)) return s as PlanCode;
  if (s.includes('6') || s.includes('semi') || s.includes('half')) return 'semiannual';
  if (s.includes('year') || s.includes('annual') || s.includes('tahun') || s.includes('12')) return 'annual';
  if (s.includes('trial')) return 'trial';
  return 'monthly';
}
const PERIOD_DAYS: Record<PlanCode, number> = { trial: 3, monthly: 30, semiannual: 182, annual: 365, unlimited: 0 };

export function toSubscription(raw: unknown): Subscription {
  const r = (raw ?? {}) as Row;
  const plan = planCode(pick(r, 'plan_code', 'plan', 'planCode'));
  const expiresAt = str(pick(r, 'expires_at', 'expiresAt'), new Date().toISOString());
  const today = isoDay(new Date(), DEFAULT_TZ);
  const computedDays = Math.max(0, dayDiff(today, isoDay(new Date(expiresAt), DEFAULT_TZ)));
  const expired = new Date(expiresAt).getTime() <= Date.now();
  const rawState = str(pick(r, 'state', 'status')).toLowerCase();
  const state = expired || rawState === 'expired' ? 'expired' : plan === 'trial' || rawState === 'trial' ? 'trial' : 'active';
  const limits = (pick(r, 'limits') ?? {}) as Row;
  const usageRows = (pick(r, 'usage', 'outlets') ?? []) as Row[];
  return {
    state,
    plan,
    expiresAt,
    daysLeft: expired ? 0 : num(pick(r, 'days_left', 'daysLeft'), computedDays),
    periodDays: PERIOD_DAYS[plan],
    extraOutlets: num(pick(r, 'extra_outlets', 'extraOutlets')),
    limits: {
      outlets: num(pick(limits, 'outlets', 'max_outlets', 'outlet_limit') ?? pick(r, 'outlet_limit', 'max_outlets'), 1),
      cashiers: num(pick(limits, 'cashiers_per_outlet', 'cashiers', 'max_cashiers') ?? pick(r, 'cashier_limit', 'max_cashiers'), plan === 'trial' ? 2 : 3),
      products: num(pick(limits, 'products_per_outlet', 'products', 'max_products') ?? pick(r, 'product_limit', 'max_products'), plan === 'trial' ? 40 : 100),
    },
    usage: Array.isArray(usageRows)
      ? usageRows.map((u) => ({
          outletId: str(pick(u, 'outlet_id', 'id')),
          name: str(pick(u, 'outlet_name', 'name')),
          cashiers: num(pick(u, 'active_cashiers', 'cashiers', 'cashier_count')),
          products: num(pick(u, 'active_products', 'products', 'product_count')),
        }))
      : [],
    unread: num(pick(r, 'unread', 'unread_count', 'unread_notifications')),
  };
}

export function toNotification(r: Row): Notification {
  const read = pick(r, 'read_at') ? true : Boolean(pick(r, 'is_read', 'read'));
  return {
    id: str(r.id),
    kind: str(r.kind),
    params: (pick(r, 'params', 'payload') ?? {}) as Notification['params'],
    read,
    createdAt: str(pick(r, 'created_at', 'createdAt')),
  };
}

const RECEIPT_DEFAULT = {
  show_logo: true,
  show_header: true,
  show_address: true,
  show_phone: true,
  show_cashier: true,
  show_notes: true,
  show_tax: true,
  show_footer: true,
};
export function toBusiness(raw: unknown, fallbackName = ''): Business {
  const r = (raw ?? {}) as Row;
  return {
    id: str(r.id),
    name: str(r.name, fallbackName),
    type: str(r.business_type, 'kafe') as Business['type'],
    city: str(r.city),
    timezone: str(r.timezone, 'Asia/Jakarta') as Business['timezone'],
    receipt: { ...RECEIPT_DEFAULT, ...((r.receipt ?? {}) as object) },
    notify: { subscription: true, cash_variance: true, low_stock: true, ...((r.notify ?? {}) as object) },
  };
}

export function toExpense(r: Row): Expense {
  return {
    id: str(r.id),
    createdAt: str(r.createdAt),
    outletId: str(r.outletId),
    outletName: str(r.outletName),
    businessDate: str(r.businessDate),
    shiftNumber: num(r.shiftNumber),
    shiftOpen: r.shiftOpen === true,
    cashierName: r.cashierName ? str(r.cashierName) : null,
    total: num(r.total),
    drawerTotal: num(r.drawerTotal),
    shiftId: str(r.shiftId),
    items: rows(r.items).map(toExpenseItem),
    cancelled: rows(r.cancelled).map((i) => ({ ...toExpenseItem(i), reason: str(i.reason), cancelledAt: str(i.cancelledAt) })),
  };
}

function toExpenseItem(i: Row): ExpenseItem {
  return {
    id: str(i.id),
    name: str(i.name),
    category: i.category === 'operasional' ? 'operasional' : 'belanja',
    quantity: num(i.quantity),
    unit: str(i.unit),
    amount: num(i.amount),
    paidFrom: i.paidFrom === 'other' ? 'other' : 'drawer',
  };
}

const rows = (v: unknown) => (v as Row[]) ?? [];
const nullable = (v: unknown) => (v === null || v === undefined ? null : num(v));
function toPnl(raw: unknown): Pnl {
  const r = (raw ?? {}) as Row;
  return {
    grossSales: num(r.grossSales),
    discounts: num(r.discounts),
    refunds: num(r.refunds),
    adjustments: num(r.adjustments),
    netSales: num(r.netSales),
    count: num(r.count),
    hpp: num(r.hpp),
    grossProfit: num(r.grossProfit),
    operatingExpenses: num(r.operatingExpenses),
    inventoryPurchases: num(r.inventoryPurchases),
    stockAdjustments: num(r.stockAdjustments),
    cashDifference: num(r.cashDifference),
    qrisDifference: num(r.qrisDifference),
    operatingProfit: num(r.operatingProfit),
  };
}

export function toReport(raw: unknown): Report {
  const r = (raw ?? {}) as Row;
  const c = (r.cash ?? {}) as Row;
  const e = (r.expenses ?? {}) as Row;
  const d = (r.drawer ?? {}) as Row;
  const pt = (r.productTotals ?? {}) as Row;
  return {
    pnl: toPnl(r.pnl),
    previousPnl: toPnl(r.previousPnl),
    outlets: ((r.outlets as unknown[]) ?? []).map((x) => str(x)),
    drawer: {
      opening: num(d.opening),
      cashSales: num(d.cashSales),
      refunds: num(d.refunds),
      expenses: num(d.expenses),
      other: num(d.other),
      expected: num(d.expected),
      counted: num(d.counted),
    },
    voidsByCashier: rows(r.voidsByCashier).map((v) => ({ name: str(v.name), count: num(v.count), total: num(v.total) })),
    discounts: rows(r.discounts).map((x) => ({ voucher: x.voucher ? str(x.voucher) : null, count: num(x.count), amount: num(x.amount) })),
    cashierOutlets: Object.fromEntries(Object.entries((r.cashierOutlets ?? {}) as Row).map(([k, v]) => [k, str(v)])),
    productTotals: { qty: num(pt.qty), sales: num(pt.sales), hpp: num(pt.hpp) },
    shifts: rows(r.shifts).map((s) => ({
      id: str(s.id),
      businessDate: str(s.businessDate),
      shiftNumber: num(s.shiftNumber),
      outletName: str(s.outletName),
      cashierName: str(s.cashierName),
      open: s.open === true,
      openingCash: num(s.openingCash),
      expectedCash: nullable(s.expectedCash),
      closingCash: nullable(s.closingCash),
      variance: nullable(s.variance),
    })),
    cash: {
      closed: num(c.closed),
      open: num(c.open),
      variance: num(c.variance),
      matched: num(c.matched),
      shortCount: num(c.shortCount),
      short: num(c.short),
      overCount: num(c.overCount),
      over: num(c.over),
    },
    expenses: {
      total: num(e.total),
      belanja: num(e.belanja),
      belanjaCount: num(e.belanjaCount),
      operasional: num(e.operasional),
      operasionalCount: num(e.operasionalCount),
      drawer: num(e.drawer),
      other: num(e.other),
      daily: rows(e.daily).map((d) => ({ date: str(d.date), total: num(d.total) })),
      top: rows(e.top).map((i) => ({
        name: str(i.name),
        category: i.category === 'operasional' ? 'operasional' : 'belanja',
        quantity: num(i.quantity),
        unit: str(i.unit),
        amount: num(i.amount),
        businessDate: str(i.businessDate),
        outletName: str(i.outletName),
      })),
    },
    byCategory: rows(r.byCategory).map((x) => ({ name: str(x.name), qty: num(x.qty), sales: num(x.sales), hpp: num(x.hpp) })),
    products: rows(r.products).map((x) => ({
      name: str(x.name),
      category: str(x.category),
      qty: num(x.qty),
      sales: num(x.sales),
      hpp: num(x.hpp),
      profit: num(x.profit),
    })),
    productCount: num(r.productCount),
  };
}

export function toExpenseList(raw: unknown): ExpenseList {
  const r = (raw ?? {}) as Row;
  const a = (r.totals ?? {}) as Row;
  return {
    rows: ((r.rows as Row[]) ?? []).map(toExpense),
    total: num(r.total),
    dayTotals: Object.fromEntries(Object.entries((r.dayTotals ?? {}) as Row).map(([d, v]) => [d, num(v)])),
    totals: { total: num(a.total), operasional: num(a.operasional), belanja: num(a.belanja), adjustments: num(a.adjustments) },
  };
}

export function toVoucher(r: Row): Voucher {
  return {
    id: str(r.id),
    code: str(r.code),
    scope: r.scope === 'products' ? 'products' : 'bill',
    discountType: r.discount_type === 'amount' ? 'amount' : 'percent',
    value: num(r.value),
    minSpend: num(r.min_spend),
    quota: r.quota === null || r.quota === undefined ? null : num(r.quota),
    usedCount: num(r.used_count),
    expiresOn: str(r.expires_on),
    isActive: Boolean(r.is_active),
    status: str(r.status, 'active') as Voucher['status'],
    productIds: Array.isArray(r.product_ids) ? (r.product_ids as string[]) : [],
  };
}

export function toPayment(r: Row): Payment {
  return {
    id: str(r.id),
    invoiceNumber: str(r.invoice_number),
    planCode: str(r.plan_code, 'monthly') as Payment['planCode'],
    extraOutlets: num(r.extra_outlets),
    amountDue: num(r.amount_due),
    amountPaid: num(r.amount_paid),
    senderName: str(r.sender_name),
    bankName: str(r.bank_name),
    transferDate: str(r.transfer_date),
    note: str(r.note),
    status: str(r.status, 'submitted') as Payment['status'],
    rejectReason: (r.reject_reason as string | null) ?? null,
    newExpiresAt: (r.new_expires_at as string | null) ?? null,
    createdAt: str(r.created_at),
  };
}

export function toBillList(raw: unknown): BillList {
  const r = (raw ?? {}) as Row;
  return {
    total: num(r.total),
    rows: rows(r.rows).map((b): Bill => ({
      id: str(b.id),
      number: str(b.number),
      status: str(b.status, 'completed') as Bill['status'],
      total: num(b.total),
      paymentMethod: b.paymentMethod === 'cash' || b.paymentMethod === 'qris' ? b.paymentMethod : null,
      createdAt: str(b.createdAt),
      customerName: str(b.customerName),
      tableNumber: str(b.tableNumber),
      outletId: str(b.outletId),
      outletName: str(b.outletName),
      cashierName: str(b.cashierName),
      voidReason: b.voidReason ? str(b.voidReason) : null,
      discount: num(b.discount),
      refundedTotal: num(b.refundedTotal),
      editCount: num(b.editCount),
      correctsNumber: b.correctsNumber ? str(b.correctsNumber) : null,
      correctedByNumber: b.correctedByNumber ? str(b.correctedByNumber) : null,
    })),
  };
}

export function toBillItem(r: Row): BillItem {
  return {
    itemId: str(r.itemId),
    productId: str(r.productId),
    productName: str(r.productName),
    quantity: num(r.quantity),
    unitPrice: num(r.unitPrice),
    subtotal: num(r.subtotal),
    discount: num(r.discount),
    note: str(r.note),
    refundedQty: num(r.refundedQty),
  };
}

export function toBillRefund(r: Row): BillRefund {
  return { id: str(r.id), createdAt: str(r.createdAt), cashierName: str(r.cashierName), method: str(r.method), amount: num(r.amount), reason: str(r.reason) };
}

function toSnapshot(raw: unknown): BillSnapshot {
  const r = (raw ?? {}) as Row;
  return {
    total: num(r.total),
    paymentMethod: str(r.paymentMethod),
    customerName: str(r.customerName),
    tableNumber: str(r.tableNumber),
    items: rows(r.items).map((i) => ({ productName: str(i.productName), quantity: num(i.quantity) })),
  };
}

export function toBillEdit(r: Row): BillEdit {
  const kind = r.kind === 'void' || r.kind === 'correction' || r.kind === 'payment' || r.kind === 'details' ? r.kind : 'items';
  return {
    id: str(r.id),
    createdAt: str(r.createdAt),
    kind,
    reason: r.reason ? str(r.reason) : null,
    before: toSnapshot(r.before),
    after: toSnapshot(r.after),
  };
}

const TRAIL_KINDS: TrailEntry['kind'][] = ['void', 'correction', 'refund', 'expense_cancel', 'stock_adjustment', 'stock_opname'];

export function toDayClose(raw: unknown): DayClose {
  const r = (raw ?? {}) as Row;
  const c = r.closed as Row | null | undefined;
  return {
    date: str(r.date),
    closed: c
      ? {
          closedAt: str(c.closedAt),
          qrisBook: num(c.qrisBook),
          qrisSettled: nullable(c.qrisSettled),
          qrisDifference: nullable(c.qrisDifference),
          note: str(c.note),
        }
      : null,
    log: rows(r.log).map((g) => ({
      action: g.action === 'reopen' ? 'reopen' : 'close',
      reason: str(g.reason),
      qrisSettled: nullable(g.qrisSettled),
      at: str(g.at),
    })),
    trail: rows(r.trail).map((e) => ({
      kind: TRAIL_KINDS.includes(e.kind as TrailEntry['kind']) ? (e.kind as TrailEntry['kind']) : 'void',
      at: str(e.at),
      ref: e.ref ? str(e.ref) : null,
      amount: num(e.amount),
      reason: str(e.reason),
    })),
    checks: rows(r.checks).map((f) => ({
      rule: str(f.rule) as CheckFailure['rule'],
      ref: f.ref ? str(f.ref) : null,
      detail: (f.detail ?? {}) as CheckFailure['detail'],
    })),
    shifts: rows(r.shifts).map((s) => ({
      id: str(s.id),
      shiftNumber: num(s.shiftNumber),
      open: s.open === true,
      openedAt: str(s.openedAt),
      closedAt: s.closedAt ? str(s.closedAt) : null,
      cashierName: str(s.cashierName),
      bills: num(s.bills),
      opening: num(s.opening),
      cashSales: num(s.cashSales),
      cashRefunds: num(s.cashRefunds),
      drawerExpenses: num(s.drawerExpenses),
      cashIn: num(s.cashIn),
      cashOut: num(s.cashOut),
      expected: num(s.expected),
      counted: nullable(s.counted),
      variance: nullable(s.variance),
      qrisSales: num(s.qrisSales),
      qrisRefunds: num(s.qrisRefunds),
      qrisExpected: num(s.qrisExpected),
      qrisReported: nullable(s.qrisReported),
      qrisVariance: nullable(s.qrisVariance),
      netSales: num(s.netSales),
      movements: rows(s.movements).map((m) => ({
        id: str(m.id),
        direction: m.direction === 'in' ? 'in' : 'out',
        amount: num(m.amount),
        reason: str(m.reason),
        createdAt: str(m.createdAt),
      })),
      oldCorrections: rows(s.oldCorrections).map((a) => ({
        id: str(a.id),
        kind: a.kind === 'expense' ? 'expense' : 'sales',
        category: a.category === 'operasional' || a.category === 'belanja' ? a.category : null,
        amount: num(a.amount),
        reason: str(a.reason),
        createdAt: str(a.createdAt),
      })),
    })),
  };
}

export function toStockItem(r: Row): StockItem {
  return {
    productId: str(r.productId),
    name: str(r.name),
    category: str(r.category),
    stock: num(r.stock),
    hpp: num(r.hpp),
    value: num(r.value),
    isActive: r.isActive !== false,
    lastCount: r.lastCount ? str(r.lastCount) : null,
  };
}

export function toStockDocument(r: Row): StockDocument {
  return {
    id: str(r.id),
    kind: str(r.kind, 'stock_in') as StockDocument['kind'],
    reason: str(r.reason),
    createdAt: str(r.createdAt),
    lines: rows(r.lines).map((l) => ({
      productId: str(l.productId),
      productName: str(l.productName),
      qty: num(l.qty),
      counted: nullable(l.counted),
      bookQty: nullable(l.bookQty),
      value: num(l.value),
    })),
  };
}

export function toStockDocumentList(raw: unknown): StockDocumentList {
  const r = (raw ?? {}) as Row;
  return { total: num(r.total), rows: rows(r.rows).map(toStockDocument) };
}

// ---------- Ingredients and recipes (084) ----------
const unitOf = (v: unknown): Unit => (UNITS.includes(v as Unit) ? (v as Unit) : 'g');

export function toTable(r: Row): OutletTable {
  return { id: str(r.id), name: str(r.name), isActive: r.isActive === true, occupied: r.occupied === true, since: r.since ? str(r.since) : null, heldTotal: num(r.heldTotal) };
}

export function toIngredient(r: Row): Ingredient {
  const base = str(r.baseUnit);
  return {
    id: str(r.id),
    name: str(r.name),
    price: num(r.price),
    packQty: num(r.packQty),
    packUnit: unitOf(r.packUnit),
    unitCost: num(r.unitCost),
    baseUnit: base === 'ml' || base === 'pcs' ? base : 'g',
    usedBy: num(r.usedBy),
    stock: num(r.stock),
    stockStarted: r.stockStarted === true,
    packLabel: str(r.packLabel),
    lastCountedAt: r.lastCountedAt ? str(r.lastCountedAt) : null,
  };
}

export function toPurchase(r: Row): Purchase {
  return {
    id: str(r.id),
    boughtOn: str(r.boughtOn),
    total: num(r.total),
    cancelledAt: r.cancelledAt ? str(r.cancelledAt) : null,
    lines: rows(r.lines).map((l) => ({
      ingredientId: str(l.ingredientId),
      name: str(l.name),
      packLabel: str(l.packLabel),
      packs: num(l.packs),
      total: num(l.total),
      priceBefore: num(l.priceBefore),
      priceAfter: num(l.priceAfter),
      expenseItemId: expenseItemIdOf(l.expenseItemId),
    })),
  };
}

export function toPurchaseList(raw: unknown): PurchaseList {
  const r = (raw ?? {}) as Row;
  return { total: num(r.total), rows: rows(r.rows).map(toPurchase) };
}

export function toCountLine(r: Row): CountResultLine {
  return { ingredientId: str(r.ingredientId), name: str(r.name), kind: r.kind === 'count' ? 'count' : 'opening', before: num(r.before), after: num(r.after), diff: num(r.diff), value: num(r.value) };
}

export function toRecipeCost(r: Row | null): RecipeCost {
  const lines = Array.isArray(r?.lines) ? (r.lines as Row[]) : [];
  return {
    source: r?.source === 'recipe' ? 'recipe' : 'manual',
    lines: lines.map((l) => ({
      ingredientId: str(l.ingredientId),
      name: str(l.name),
      qty: num(l.qty),
      unit: unitOf(l.unit),
      cost: num(l.cost),
      incomplete: l.incomplete === true,
    })),
    hpp: num(r?.hpp),
    incomplete: r?.incomplete === true,
  };
}

export function toImpact(r: Row): IngredientImpact {
  return { productId: str(r.productId), name: str(r.name), oldHpp: num(r.oldHpp), newHpp: num(r.newHpp) };
}

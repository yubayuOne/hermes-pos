import { DEFAULT_TZ, dayDiff, isoDay } from '@hermes-pos/ui';
import type {
  ShiftBalanceList,
  Bill,
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
    items: ((r.items as Row[]) ?? []).map((i) => ({
      name: str(i.name),
      category: i.category === 'operasional' ? 'operasional' : 'belanja',
      quantity: num(i.quantity),
      unit: str(i.unit),
      amount: num(i.amount),
      paidFrom: i.paidFrom === 'other' ? 'other' : 'drawer',
    })),
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
  const kind = r.kind === 'void' || r.kind === 'payment' || r.kind === 'details' ? r.kind : 'items';
  return {
    id: str(r.id),
    createdAt: str(r.createdAt),
    kind,
    reason: r.reason ? str(r.reason) : null,
    before: toSnapshot(r.before),
    after: toSnapshot(r.after),
  };
}

export function toShiftBalanceList(raw: unknown): ShiftBalanceList {
  const r = (raw ?? {}) as Row;
  return {
    total: num(r.total),
    rows: rows(r.rows).map((s) => ({
      id: str(s.id),
      outletName: str(s.outletName),
      cashierName: str(s.cashierName),
      businessDate: str(s.businessDate),
      shiftNumber: num(s.shiftNumber),
      open: s.open === true,
      openedAt: str(s.openedAt),
      closedAt: s.closedAt ? str(s.closedAt) : null,
      openingCash: num(s.openingCash),
      expectedCash: num(s.expectedCash),
      closingCash: nullable(s.closingCash),
      variance: nullable(s.variance),
      sales: num(s.sales),
      expenses: num(s.expenses),
      adjustments: rows(s.adjustments).map((a) => ({
        id: str(a.id),
        kind: a.kind === 'sales' || a.kind === 'expense' ? a.kind : 'cash',
        category: a.category === 'operasional' || a.category === 'belanja' ? a.category : null,
        amount: num(a.amount),
        reason: str(a.reason),
        createdAt: str(a.createdAt),
      })),
    })),
  };
}

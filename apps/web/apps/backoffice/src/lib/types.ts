export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; field?: string };

export type Session = { email: string; userId: string; businessId: string | null; username: string | null };

export type SubState = 'trial' | 'active' | 'expired';
/** 'unlimited' is granted by the admin only (migration 065): never ends, not for sale. */
export type PlanCode = 'trial' | 'monthly' | 'semiannual' | 'annual' | 'unlimited';

/** Subscription as shown in the sidebar card, banners, and Settings (G1). */
export type Subscription = {
  state: SubState;
  plan: PlanCode;
  expiresAt: string;
  daysLeft: number;
  /** Total length of the current period in days, for the progress bar. */
  periodDays: number;
  extraOutlets: number;
  limits: { outlets: number; cashiers: number; products: number };
  usage: { outletId: string; name: string; cashiers: number; products: number }[];
  unread: number;
};

export type Business = {
  id: string;
  name: string;
  type: BusinessType;
  city: string;
  timezone: TimeZone;
  receipt: ReceiptSettings;
  notify: NotifySettings;
};
export type BusinessType = 'kafe' | 'restoran' | 'kedai' | 'bakeri' | 'lainnya';
export type TimeZone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura';
export type ReceiptSettings = {
  show_logo: boolean;
  show_header: boolean;
  show_address: boolean;
  show_phone: boolean;
  show_cashier: boolean;
  show_notes: boolean;
  show_tax: boolean;
  show_footer: boolean;
};
export type NotifySettings = { subscription: boolean; cash_variance: boolean; low_stock: boolean };

export type Profile = { username: string; fullName: string; whatsapp: string; email: string };

/** Everything the app shell needs on every page. */
export type AppContext = {
  session: Session;
  business: Business;
  subscription: Subscription;
  profile: Profile | null;
  counts: { outlets: number; cashiers: number; products: number; vouchers: number };
  outlets: Outlet[];
};

export type Notification = { id: string; kind: string; params: Record<string, string | number | boolean | null>; read: boolean; createdAt: string };

export type SalesSummary = {
  count: number;
  sales: number;
  profit: number;
  cash: number;
  voidedCount: number;
  voidedTotal: number;
  refundCount: number;
  refundTotal: number;
  daily: { date: string; count: number; total: number }[];
  hourly: { hour: number; total: number }[];
  byOutlet: { outletId: string; name: string; count: number; sales: number }[];
  byCashier: { cashierId: string; name: string; count: number; sales: number }[];
  top: { name: string; qty: number; subtotal: number }[];
  discountTotal: number;
  /** QRIS sales net of QRIS refunds; can be negative. */
  qris: number;
  /** Net sales and bills of the same number of days just before (owner_sales_summary). */
  previousSales: number;
  previousCount: number;
  /** Items sold on completed bills, before refunds. */
  totalItems: number;
  /** The period's expenses (migration 056), all subtracted from sales whether paid from the drawer or not. */
  expenses: { total: number; operasional: number; belanja: number; drawer: number; other: number };
  /** sales - expenses.total, made by the database (056). */
  salesAfterExpenses: number;
};

/** Owner report (POS migration 042). Sales per day, outlet, and cashier come from SalesSummary. */
export type Pnl = {
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  count: number;
  hpp: number;
  grossProfit: number;
  operatingExpenses: number;
  inventoryPurchases: number;
  operatingProfit: number;
};
export type ReportShift = {
  id: string;
  businessDate: string;
  shiftNumber: number;
  outletName: string;
  cashierName: string;
  open: boolean;
  openingCash: number;
  expectedCash: number | null;
  closingCash: number | null;
  variance: number | null;
};
export type Report = {
  pnl: Pnl;
  previousPnl: Pnl;
  outlets: string[];
  shifts: ReportShift[];
  cash: { closed: number; open: number; variance: number; matched: number; shortCount: number; short: number; overCount: number; over: number };
  /** Closed shifts only: opening + cashSales - refunds - expenses + other = expected. */
  drawer: { opening: number; cashSales: number; refunds: number; expenses: number; other: number; expected: number; counted: number };
  expenses: {
    total: number;
    belanja: number;
    belanjaCount: number;
    operasional: number;
    operasionalCount: number;
    drawer: number;
    other: number;
    daily: { date: string; total: number }[];
    top: { name: string; category: ExpenseItem['category']; quantity: number; unit: string; amount: number; businessDate: string; outletName: string }[];
  };
  voidsByCashier: { name: string; count: number; total: number }[];
  /** voucher null = manual cashier discounts. */
  discounts: { voucher: string | null; count: number; amount: number }[];
  cashierOutlets: Record<string, string>;
  byCategory: { name: string; qty: number; sales: number; hpp: number }[];
  products: { name: string; category: string; qty: number; sales: number; hpp: number; profit: number }[];
  productTotals: { qty: number; sales: number; hpp: number };
  productCount: number;
};

/** Expenses of one shift (POS migrations 040, 041). Count at once; the owner can edit them any time (043). */
export type ExpenseItem = { name: string; category: 'operasional' | 'belanja'; quantity: number; unit: string; amount: number; paidFrom: 'drawer' | 'other' };
export type Expense = {
  id: string;
  createdAt: string;
  outletId: string;
  outletName: string;
  businessDate: string;
  shiftNumber: number;
  shiftOpen: boolean;
  cashierName: string | null;
  total: number;
  drawerTotal: number;
  items: ExpenseItem[];
};
export type ExpenseList = {
  rows: Expense[];
  /** All shift records in the period; `rows` is one page of them. */
  total: number;
  dayTotals: Record<string, number>;
  totals: { total: number; operasional: number; belanja: number };
};

/** A bill from owner_list_bills (migrations 028, 034). Money comes from the database. */
export type Bill = {
  id: string;
  number: string;
  status: 'completed' | 'held' | 'voided' | 'cancelled';
  total: number;
  paymentMethod: 'cash' | 'qris' | null;
  createdAt: string;
  customerName: string;
  tableNumber: string;
  outletId: string;
  outletName: string;
  cashierName: string;
  voidReason: string | null;
  discount: number;
  refundedTotal: number;
  /** Owner edits logged since migration 067. */
  editCount: number;
};
export type BillList = { rows: Bill[]; total: number };
export type BillItem = {
  itemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  note: string;
  refundedQty: number;
};
/** One owner edit with the bill before and after it (migration 067). */
export type BillSnapshot = {
  total: number;
  paymentMethod: string;
  customerName: string;
  tableNumber: string;
  items: { productName: string; quantity: number }[];
};
export type BillEdit = {
  id: string;
  createdAt: string;
  kind: 'void' | 'payment' | 'details' | 'items';
  reason: string | null;
  before: BillSnapshot;
  after: BillSnapshot;
};
export type BillRefund = { id: string; createdAt: string; cashierName: string; method: string; amount: number; reason: string };
/** Completed bills only, refunds not subtracted; sales = line totals after item discounts (migration 066). */
export type ProductSale = { qty: number; sales: number };

export type Outlet = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  logoUrl: string | null;
  /** Receipt text of this outlet (migration 047); empty means none (the footer then prints "Terima kasih"). */
  receiptHeader: string | null;
  receiptFooter: string | null;
};
export type Cashier = { cashierId: string; name: string; outletId: string; outletName: string; isActive: boolean; lockedUntil: string | null };
export type Category = { id: string; name: string };
export type Product = {
  id: string;
  categoryId: string | null;
  name: string;
  hpp: number;
  price: number;
  stock: number;
  trackStock: boolean;
  station: 'kitchen' | 'bar';
  isActive: boolean;
};

export type VoucherStatus = 'active' | 'expired' | 'used_up' | 'inactive';
export type Voucher = {
  id: string;
  code: string;
  scope: 'bill' | 'products';
  discountType: 'percent' | 'amount';
  value: number;
  minSpend: number;
  quota: number | null;
  usedCount: number;
  expiresOn: string;
  isActive: boolean;
  status: VoucherStatus;
  productIds: string[];
};

export type Payment = {
  id: string;
  invoiceNumber: string;
  planCode: Exclude<PlanCode, 'trial'>;
  extraOutlets: number;
  amountDue: number;
  amountPaid: number;
  senderName: string;
  bankName: string;
  transferDate: string;
  note: string;
  status: 'submitted' | 'verified' | 'rejected';
  rejectReason: string | null;
  newExpiresAt: string | null;
  createdAt: string;
};

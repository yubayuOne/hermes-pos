import type { Unit } from './units';

export type { Unit };
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
  /** Sales corrections from balancing (071), signed; already in netSales. */
  adjustments: number;
  netSales: number;
  count: number;
  hpp: number;
  grossProfit: number;
  operatingExpenses: number;
  inventoryPurchases: number;
  /** From the ledger (075): stock losses and count differences (a cost), and drawer and QRIS differences (signed, a surplus is a gain). */
  stockAdjustments: number;
  cashDifference: number;
  qrisDifference: number;
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

/** Expenses of one shift (POS migrations 040, 041). Count at once; the owner cancels or adds items (073). */
export type ExpenseItem = {
  id: string;
  name: string;
  category: 'operasional' | 'belanja';
  quantity: number;
  unit: string;
  amount: number;
  paidFrom: 'drawer' | 'other';
};
/** A cancelled item: it no longer counts, but stays on record with the reason (073). */
export type CancelledExpenseItem = ExpenseItem & { reason: string; cancelledAt: string };
export type Expense = {
  id: string;
  createdAt: string;
  outletId: string;
  outletName: string;
  shiftId: string;
  businessDate: string;
  shiftNumber: number;
  shiftOpen: boolean;
  cashierName: string | null;
  total: number;
  drawerTotal: number;
  items: ExpenseItem[];
  cancelled: CancelledExpenseItem[];
};
export type ExpenseList = {
  rows: Expense[];
  /** All shift records in the period; `rows` is one page of them. */
  total: number;
  dayTotals: Record<string, number>;
  /** Totals include the old expense corrections (071); `adjustments` is their part. */
  totals: { total: number; operasional: number; belanja: number; adjustments: number };
};

/** Cash put into or taken out of a drawer (073). */
export type CashMovement = { id: string; direction: 'in' | 'out'; amount: number; reason: string; createdAt: string };
/** A sales or expense correction made with the old balancing (071); kept and shown, no longer made. */
export type OldCorrection = {
  id: string;
  kind: 'sales' | 'expense';
  category: 'operasional' | 'belanja' | null;
  amount: number;
  reason: string;
  createdAt: string;
};
/** One shift's reconciliation on the Tutup hari page (owner_day_close). All money from the database. */
export type DayShift = {
  id: string;
  shiftNumber: number;
  open: boolean;
  openedAt: string;
  closedAt: string | null;
  cashierName: string;
  bills: number;
  opening: number;
  cashSales: number;
  cashRefunds: number;
  drawerExpenses: number;
  cashIn: number;
  cashOut: number;
  expected: number;
  counted: number | null;
  variance: number | null;
  qrisSales: number;
  qrisRefunds: number;
  qrisExpected: number;
  /** The QRIS total the cashier read from the merchant app at closing (075); null: not asked (older app). */
  qrisReported: number | null;
  qrisVariance: number | null;
  netSales: number;
  movements: CashMovement[];
  oldCorrections: OldCorrection[];
};
/** A balance rule that failed (docs/ACCOUNTING.md section 1). */
export type CheckFailure = { rule: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P7'; ref: string | null; detail: Record<string, string | number | boolean | null> };
/** A closed (locked) day (075). qrisSettled null: the bank amount was not entered. */
export type DayLock = { closedAt: string; qrisBook: number; qrisSettled: number | null; qrisDifference: number | null; note: string };
export type DayLogEntry = { action: 'close' | 'reopen'; reason: string; qrisSettled: number | null; at: string };
/** What undid or changed something on the day (075): voids, bill corrections, refunds, cancelled expenses, stock losses and counts. */
export type TrailEntry = {
  kind: 'void' | 'correction' | 'refund' | 'expense_cancel' | 'stock_adjustment' | 'stock_opname';
  at: string;
  ref: string | null;
  amount: number;
  reason: string;
};
export type DayClose = { date: string; closed: DayLock | null; log: DayLogEntry[]; trail: TrailEntry[]; shifts: DayShift[]; checks: CheckFailure[] };
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
  /** The bill this one corrects, and the bill that corrected this one (073). */
  correctsNumber: string | null;
  correctedByNumber: string | null;
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
  kind: 'void' | 'correction' | 'payment' | 'details' | 'items';
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
  imageUrl: string | null;
  /** 'recipe': hpp is computed from the product's recipe and cannot be typed (084). */
  hppSource: 'manual' | 'recipe';
};

// ---------- Ingredients and recipes (084) ----------
export type Ingredient = {
  id: string;
  name: string;
  price: number;
  packQty: number;
  packUnit: Unit;
  /** Price per base unit, as the database computes it. */
  unitCost: number;
  baseUnit: 'g' | 'ml' | 'pcs';
  usedBy: number;
};
export type RecipeLineInput = { ingredientId: string; qty: number; unit: Unit };
export type RecipeCostLine = RecipeLineInput & { name: string; cost: number; incomplete: boolean };
export type RecipeCost = { source: 'manual' | 'recipe'; lines: RecipeCostLine[]; hpp: number; incomplete: boolean };
export type IngredientImpact = { productId: string; name: string; oldHpp: number; newHpp: number };

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

/** A tracked product on the Stok page (owner_list_stock, 074). Value = stock x HPP, from the database. */
export type StockItem = {
  productId: string;
  name: string;
  category: string;
  stock: number;
  hpp: number;
  value: number;
  isActive: boolean;
  lastCount: string | null;
};
export type StockDocumentKind = 'opening' | 'initial' | 'tracking_off' | 'stock_in' | 'adjustment' | 'opname';
/** A stock document: every change of stock that is not a sale, void, or refund (074). */
export type StockDocument = {
  id: string;
  kind: StockDocumentKind;
  reason: string;
  createdAt: string;
  lines: { productId: string; productName: string; qty: number; counted: number | null; bookQty: number | null; value: number }[];
};
export type StockDocumentList = { rows: StockDocument[]; total: number };

/** Customers by the name typed on paid bills (owner_customers, migration 081). */
export type Customer = { name: string; bills: number; total: number; lastAt: string };
export type CustomerList = { rows: Customer[]; total: number };

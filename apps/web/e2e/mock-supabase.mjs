// Mock Supabase (Auth + PostgREST + RPC) for local previews and screenshots of the backoffice without a
// real project. Not used in production. Start: node e2e/mock-supabase.mjs (port 54400), then run the
// backoffice with SUPABASE_URL=http://localhost:54400 SUPABASE_ANON_KEY=mock APP_URL=http://localhost:3001.
// Switch scenarios with GET /__scenario?status=active|trial|expired&data=full|empty.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 54400);
const DAY = 86_400_000;
const scenario = { status: 'active', data: 'full', biz: 'yes' };

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'rina@kopipojok.id',
  aud: 'authenticated',
  role: 'authenticated',
  user_metadata: { business_name: 'Kopi Pojok', username: 'kopipojok' },
  identities: [{ id: '1' }],
};
const BIZ = '10000000-0000-4000-8000-000000000001';
const O1 = '20000000-0000-4000-8000-000000000001';
const O2 = '20000000-0000-4000-8000-000000000002';
const C1 = '30000000-0000-4000-8000-000000000001';
const C2 = '30000000-0000-4000-8000-000000000002';

let business = {
  id: BIZ,
  name: 'Kopi Pojok',
  business_type: 'kafe',
  city: 'Bandung',
  timezone: 'Asia/Jakarta',
  receipt: {
    header: 'Jl. Braga 12, Bandung',
    footer: 'Terima kasih, sampai jumpa lagi',
    show_logo: true,
    show_header: true,
    show_address: true,
    show_phone: true,
    show_cashier: true,
    show_notes: true,
    show_tax: false,
    show_footer: true,
  },
  notify: { subscription: true, cash_variance: true, low_stock: false },
};
let outlets = [
  {
    id: O1,
    name: 'Outlet Utama',
    address: 'Jl. Braga 12, Bandung',
    phone: '022 420 1234',
    is_active: true,
    logo_url: null,
    logo_print_url: null,
    receipt_header: null,
    receipt_footer: null,
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    id: O2,
    name: 'Outlet Cabang 2',
    address: null,
    phone: null,
    is_active: true,
    logo_url: null,
    logo_print_url: null,
    receipt_header: null,
    receipt_footer: null,
    created_at: '2026-09-15T00:00:00Z',
  },
];
let cashiers = [
  ['Sari', O1, true],
  ['Budi', O1, true],
  ['Wulan', O2, true],
  ['Dedi', O1, true],
].map(([n, o, a], i) => ({
  cashier_id: `40000000-0000-4000-8000-00000000000${i + 1}`,
  cashier_name: n,
  outlet_id: o,
  outlet_name: o === O1 ? 'Outlet Utama' : 'Outlet Cabang 2',
  is_active: a,
  locked_until: null,
}));
const categories = [
  { id: C1, name: 'Minuman', outlet_id: O1, is_active: true },
  { id: C2, name: 'Makanan', outlet_id: O1, is_active: true },
];
let products = [
  ['Kopi susu', C1, 22000, 8000, true, 120, 'bar'],
  ['Latte', C1, 26000, 9500, false, 0, 'bar'],
  ['Americano', C1, 18000, 6000, false, 0, 'bar'],
  ['Teh tarik', C1, 15000, 5000, false, 0, 'bar'],
  ['Roti bakar', C2, 18000, 7000, true, 40, 'kitchen'],
  ['Croissant', C2, 24000, 11000, true, 12, 'kitchen'],
  ['Nasi goreng', C2, 32000, 14000, false, 0, 'kitchen'],
  ['Pisang goreng', C2, 15000, 5000, false, 0, 'kitchen'],
].map(([name, cat, price, hpp, track, stock, station], i) => ({
  id: `50000000-0000-4000-8000-00000000000${i + 1}`,
  outlet_id: O1,
  category_id: cat,
  name,
  selling_price: price,
  hpp,
  stock,
  track_stock: track,
  station,
  is_active: i !== 7,
  is_temporary: false,
  categories: { name: cat === C1 ? 'Minuman' : 'Makanan' },
  outlets: { name: 'Outlet Utama' },
}));
const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.parse(`${today()}T16:59:00Z`) + n * DAY).toISOString();
let vouchers = [
  {
    id: 'v1',
    code: 'HEMAT10',
    scope: 'bill',
    discount_type: 'percent',
    value: 10,
    min_spend: 50000,
    quota: 100,
    used_count: 37,
    expires_on: plusDays(30).slice(0, 10),
    is_active: true,
    status: 'active',
    product_ids: [],
  },
  {
    id: 'v2',
    code: 'KOPIPAGI',
    scope: 'products',
    discount_type: 'amount',
    value: 5000,
    min_spend: 0,
    quota: null,
    used_count: 12,
    expires_on: plusDays(14).slice(0, 10),
    is_active: true,
    status: 'active',
    product_ids: [products[0].id, products[1].id],
  },
  {
    id: 'v3',
    code: 'MERDEKA',
    scope: 'bill',
    discount_type: 'percent',
    value: 17,
    min_spend: 0,
    quota: 50,
    used_count: 50,
    expires_on: plusDays(-40).slice(0, 10),
    is_active: true,
    status: 'expired',
    product_ids: [],
  },
  {
    id: 'v4',
    code: 'TEMAN20',
    scope: 'bill',
    discount_type: 'amount',
    value: 20000,
    min_spend: 100000,
    quota: 20,
    used_count: 20,
    expires_on: plusDays(60).slice(0, 10),
    is_active: true,
    status: 'used_up',
    product_ids: [],
  },
];
let payments = [
  {
    id: 'p1',
    invoice_number: 'INV-20260918-00012',
    plan_code: 'monthly',
    extra_outlets: 1,
    amount_due: 248000,
    amount_paid: 248000,
    sender_name: 'Rina Sari',
    bank_name: 'BCA',
    transfer_date: '2026-09-18',
    note: '',
    status: 'verified',
    reject_reason: null,
    new_expires_at: plusDays(7),
    created_at: '2026-09-18T03:12:00Z',
  },
];
let notifications = [
  {
    id: 'n1',
    kind: 'subscription_expiring',
    params: { days_left: 7, expires_at: plusDays(7) },
    read_at: null,
    created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: 'n2',
    kind: 'subscription_expiring',
    params: { days_left: 14, expires_at: plusDays(7) },
    read_at: '2026-10-04T02:00:00Z',
    created_at: '2026-10-04T01:00:00Z',
  },
];
let voidCodeSet = false;
const files = new Set(); // outlet-logos object paths
// Expenses from the POS (migrations 040, 041, 043), one record per shift: one open, two closed. They count at once.
const exp = (id, shiftNumber, shiftOpen, items, hoursAgo) => {
  const createdAt = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const sum = (xs) => xs.reduce((n, i) => n + i.amount, 0);
  return {
    id,
    createdAt,
    outletId: O1,
    outletName: 'Outlet Utama',
    shiftId: `s-${id}`,
    businessDate: createdAt.slice(0, 10),
    shiftNumber,
    shiftOpen,
    cashierName: 'Sari',
    total: sum(items),
    drawerTotal: sum(items.filter((i) => i.paidFrom === 'drawer')),
    items,
  };
};
let expenses = [
  exp(
    'e1',
    2,
    true,
    [
      { id: 'i1', name: 'Gula pasir', category: 'belanja', quantity: 2, unit: 'kg', amount: 36000, paidFrom: 'drawer' },
      { id: 'i2', name: 'Galon', category: 'operasional', quantity: 1, unit: 'pcs', amount: 20000, paidFrom: 'drawer' },
    ],
    2,
  ),
  exp(
    'e2',
    1,
    false,
    [
      { id: 'i3', name: 'Listrik', category: 'operasional', quantity: 1, unit: 'pcs', amount: 150000, paidFrom: 'other' },
      { id: 'i5', name: 'Es batu', category: 'belanja', quantity: 3, unit: 'pack', amount: 15000, paidFrom: 'drawer' },
    ],
    5,
  ),
  exp('e3', 1, false, [{ id: 'i4', name: 'Susu UHT', category: 'belanja', quantity: 1.5, unit: 'L', amount: 45000, paidFrom: 'drawer' }], 30),
];
// Today's shifts for the Shift page and the expense form's shift picker (owner_day_close, 073 to 078).
const dayShift = (id, shiftNumber, open, hoursAgo, opening, cashSales, counted) => ({
  id,
  shiftNumber,
  open,
  openedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  closedAt: open ? null : new Date(Date.now() - (hoursAgo - 7) * 3_600_000).toISOString(),
  cashierName: 'Sari',
  bills: 14,
  netSales: cashSales + 120000,
  opening,
  cashSales,
  cashRefunds: 0,
  drawerExpenses: 0,
  cashIn: 0,
  cashOut: 0,
  expected: opening + cashSales,
  counted,
  variance: counted === null ? null : counted - (opening + cashSales),
  qrisSales: 120000,
  qrisRefunds: 0,
  qrisExpected: 120000,
  qrisReported: open ? null : 120000,
  qrisVariance: open ? null : 0,
  movements: [],
  oldCorrections: [],
});
let dayShifts = [dayShift('s-e3', 1, false, 9, 300000, 850000, 1145000), dayShift('s-e1', 2, true, 2, 300000, 410000, null)];
let profile = { username: 'kopipojok', full_name: 'Rina Sari', whatsapp: '0812 3456 7890' };

function subscription() {
  const s = scenario.status;
  const expires = s === 'expired' ? plusDays(-9) : s === 'trial' ? plusDays(2) : plusDays(7);
  const trial = s === 'trial';
  return {
    state: s,
    plan_code: trial ? 'trial' : 'monthly',
    expires_at: expires,
    extra_outlets: trial ? 0 : 1,
    limits: { outlets: trial ? 1 : 2, cashiers_per_outlet: trial ? 2 : 3, products_per_outlet: trial ? 40 : 100 },
    usage: outlets.map((o) => ({
      outlet_id: o.id,
      outlet_name: o.name,
      active_cashiers: cashiers.filter((c) => c.outlet_id === o.id && c.is_active).length,
      active_products: products.filter((p) => p.outlet_id === o.id && p.is_active).length,
    })),
    unread: notifications.filter((n) => !n.read_at).length,
  };
}

function summary(args) {
  if (scenario.data === 'empty')
    return {
      count: 0,
      sales: 0,
      profit: 0,
      cash: 0,
      voidedCount: 0,
      voidedTotal: 0,
      refundCount: 0,
      refundTotal: 0,
      daily: [],
      hourly: [],
      byOutlet: [],
      byCashier: [],
      top: [],
    };
  const days = Math.max(1, Math.round((Date.parse(args.p_to) - Date.parse(args.p_from)) / DAY));
  const k = days === 1 ? 1 : (days / 7) * 6.2;
  const daily = [3.1, 2.6, 3.4, 2.9, 3.9, 5.1, 4.28].map((v, i) => ({
    date: new Date(Date.parse(args.p_to) - (7 - i) * DAY + 8 * 3_600_000).toISOString().slice(0, 10),
    count: Math.round(v * 18),
    total: Math.round(v * 1_000_000),
  }));
  const hourly = [120, 260, 210, 340, 520, 610, 480, 350, 300, 420, 380, 290].map((v, i) => ({ hour: 8 + i, total: v * 1000 }));
  const one = args.p_outlet_id === O2 ? 1630 / 4280 : args.p_outlet_id === O1 ? 2650 / 4280 : 1;
  const f = (n) => Math.round(n * k * one);
  return {
    count: f(78),
    sales: f(4_280_000),
    profit: f(1_610_000),
    cash: f(4_280_000),
    voidedCount: f(2),
    voidedTotal: f(76_000),
    refundCount: f(1),
    refundTotal: f(28_000),
    daily,
    hourly,
    byOutlet: [
      { outletId: O1, name: 'Outlet Utama', count: f(48), sales: f(2_650_000) },
      { outletId: O2, name: 'Outlet Cabang 2', count: f(30), sales: f(1_630_000) },
    ],
    byCashier: [
      ['Dedi', 44, 1_630_000],
      ['Sari', 38, 1_420_000],
      ['Budi', 21, 760_000],
      ['Wulan', 13, 470_000],
    ].map(([n, c, s], i) => ({ cashierId: `c${i}`, name: n, count: f(c), sales: f(s) })),
    top: [
      ['Kopi susu', 48, 1_056_000],
      ['Latte', 29, 754_000],
      ['Americano', 33, 594_000],
      ['Roti bakar', 27, 486_000],
      ['Croissant', 16, 384_000],
      ['Nasi goreng', 9, 288_000],
    ].map(([n, q, s]) => ({ name: n, qty: f(q), subtotal: f(s) })),
  };
}

const expired = () => scenario.status === 'expired';
const fail = (message, code = 'P0001') => ({ status: 400, body: { code, message, details: null, hint: null } });
const RPC = {
  my_business_id: () => (scenario.biz === 'none' ? null : BIZ),
  get_my_profile: () => (scenario.biz === 'none' ? null : { ...profile, email: user.email }),
  username_available: ({ p_username }) => !['kopipojok', 'admin'].includes(p_username),
  owner_get_business: () => business,
  get_subscription_status: subscription,
  list_notifications: () => notifications,
  mark_notifications_read: () => {
    notifications = notifications.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }));
    return null;
  },
  owner_list_cashiers: () => (scenario.data === 'empty' ? [] : cashiers),
  // 063: the Laporan page in one call.
  owner_report_page: (a) => ({ ...RPC.owner_report(a), sales: summary(a) }),
  // 062: the Ringkasan page in one call, and the sidebar counts.
  owner_dashboard: (a) => {
    const period = summary(a);
    const week = summary({ ...a, p_from: a.p_week_from, p_to: a.p_today_to });
    const today = summary({ ...a, p_from: a.p_today_from, p_to: a.p_today_to });
    return {
      period: { ...period, expenses: { total: 0, operasional: 0, belanja: 0, drawer: 0, other: 0 }, salesAfterExpenses: period?.sales ?? 0 },
      week: { count: week.count, sales: week.sales, daily: week.daily },
      today: { hourly: today.hourly },
      lastVariance: scenario.data === 'empty' ? null : { amount: 0, closedAt: new Date().toISOString() },
    };
  },
  owner_shell_counts: () => ({ products: scenario.data === 'empty' ? 0 : products.length, vouchers: scenario.data === 'empty' ? 0 : vouchers.length }),
  // 061: quantity sold per product id; the mock sells nothing.
  owner_product_sales: () => ({}),
  owner_list_vouchers: () => (scenario.data === 'empty' ? [] : vouchers),
  owner_list_payments: () => payments,
  save_my_profile: (a) => {
    profile = { username: a.p_username, full_name: a.p_full_name, whatsapp: a.p_whatsapp };
    return { ...profile, email: user.email };
  },
  owner_update_business: (a) =>
    expired()
      ? fail('Langganan berakhir. Perpanjang paket untuk mengubah data.')
      : ((business = { ...business, name: a.p_name, business_type: a.p_business_type, city: a.p_city, timezone: a.p_timezone }), business),
  owner_update_receipt: (a) =>
    expired()
      ? fail('Langganan berakhir. Perpanjang paket untuk mengubah data.')
      : ((business.receipt = { ...business.receipt, ...a.p_receipt }), business.receipt),
  owner_update_notify: (a) => ((business.notify = { ...business.notify, ...a.p_notify }), business.notify),
  owner_void_code_status: () => ({ has_code: voidCodeSet }),
  owner_set_void_code: (a) =>
    /^\d{6}$/.test(a.p_code)
      ? ((voidCodeSet = true), { has_code: true })
      : { status: 400, body: { code: '22023', message: 'Kode persetujuan harus 6 digit angka.' } },
  owner_set_cashier_active: (a) => {
    cashiers = cashiers.map((c) => (c.cashier_id === a.p_cashier_id ? { ...c, is_active: a.p_active } : c));
    return null;
  },
  owner_create_cashier: (a) =>
    a.p_name === 'Penuh'
      ? fail('Batas 3 kasir aktif di outlet ini tercapai.')
      : (cashiers.push({
          cashier_id: crypto.randomUUID(),
          cashier_name: a.p_name,
          outlet_id: a.p_outlet_id,
          outlet_name: 'Outlet Utama',
          is_active: true,
          locked_until: null,
        }),
        null),
  owner_set_cashier_pin: () => null,
  owner_set_product_active: (a) => {
    products = products.map((p) => (p.id === a.p_product_id ? { ...p, is_active: a.p_active } : p));
    return null;
  },
  owner_save_voucher: (a) =>
    vouchers.some((v) => v.code === a.p_code && v.id !== a.p_id)
      ? fail('Kode voucher sudah dipakai. Pakai kode lain.', '23505')
      : (vouchers.unshift({
          id: crypto.randomUUID(),
          code: a.p_code,
          scope: a.p_scope,
          discount_type: a.p_discount_type,
          value: a.p_value,
          min_spend: a.p_min_spend,
          quota: a.p_quota,
          used_count: 0,
          expires_on: a.p_expires_on,
          is_active: true,
          status: 'active',
          product_ids: a.p_product_ids ?? [],
        }),
        'id'),
  owner_set_voucher_active: (a) => {
    vouchers = vouchers.map((v) => (v.id === a.p_id ? { ...v, is_active: a.p_active, status: a.p_active ? 'active' : 'inactive' } : v));
    return null;
  },
  owner_submit_payment: (a) => {
    const p = {
      id: crypto.randomUUID(),
      invoice_number: 'INV-' + today().replaceAll('-', '') + '-00013',
      plan_code: a.p_plan_code,
      extra_outlets: a.p_extra_outlets,
      amount_due:
        { monthly: 149000, semiannual: 699000, annual: 1399000 }[a.p_plan_code] +
        a.p_extra_outlets * 99000 * { monthly: 1, semiannual: 6, annual: 12 }[a.p_plan_code],
      amount_paid: a.p_amount_paid,
      sender_name: a.p_sender_name,
      bank_name: a.p_bank_name,
      transfer_date: a.p_transfer_date,
      note: a.p_note,
      status: 'submitted',
      reject_reason: null,
      new_expires_at: null,
      created_at: new Date().toISOString(),
    };
    payments.unshift(p);
    return p;
  },
  owner_list_expenses: (a) => {
    const mine = (scenario.data === 'empty' ? [] : expenses).filter((e) => !a.p_outlet_id || e.outletId === a.p_outlet_id);
    const inRange = (e) => (!a.p_from || e.createdAt >= a.p_from) && (!a.p_to || e.createdAt < a.p_to);
    const sum = (xs) => xs.reduce((n, i) => n + i.amount, 0);
    const rows = mine.filter(inRange).sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0));
    const ok = rows.flatMap((e) => e.items);
    return {
      rows: rows.filter((e) => !a.p_before || e.createdAt < a.p_before).slice(0, a.p_limit ?? 50),
      total: rows.length,
      dayTotals: rows.reduce((d, e) => ({ ...d, [e.businessDate]: (d[e.businessDate] ?? 0) + e.total }), {}),
      totals: { total: sum(ok), operasional: sum(ok.filter((i) => i.category === 'operasional')), belanja: sum(ok.filter((i) => i.category === 'belanja')) },
    };
  },
  owner_report: () => {
    const zero = {
      grossSales: 0,
      discounts: 0,
      refunds: 0,
      netSales: 0,
      count: 0,
      hpp: 0,
      grossProfit: 0,
      operatingExpenses: 0,
      inventoryPurchases: 0,
      operatingProfit: 0,
    };
    const none = { opening: 0, cashSales: 0, refunds: 0, expenses: 0, other: 0, expected: 0, counted: 0 };
    if (scenario.data === 'empty')
      return {
        pnl: zero,
        previousPnl: zero,
        outlets: ['Outlet Utama', 'Outlet Cabang 2'],
        shifts: [],
        cash: { closed: 0, open: 0, variance: 0, matched: 0, shortCount: 0, short: 0, overCount: 0, over: 0 },
        drawer: none,
        expenses: {
          total: 0,
          belanja: 0,
          belanjaCount: 0,
          operasional: 0,
          operasionalCount: 0,
          drawer: 0,
          other: 0,
          daily: [],
          top: [],
        },
        voidsByCashier: [],
        discounts: [],
        cashierOutlets: {},
        byCategory: [],
        products: [],
        productTotals: { qty: 0, sales: 0, hpp: 0 },
        productCount: 0,
      };
    const pnl = (sales, disc, refunds, hpp, opex, inv) => ({
      grossSales: sales + disc,
      discounts: disc,
      refunds,
      netSales: sales - refunds,
      count: Math.round(sales / 55000),
      hpp,
      grossProfit: sales - refunds - hpp,
      operatingExpenses: opex,
      inventoryPurchases: inv,
      operatingProfit: sales - refunds - hpp - opex,
    });
    const day = (n) => new Date(Date.now() - n * DAY + 8 * 3_600_000).toISOString().slice(0, 10);
    return {
      pnl: pnl(26_540_000, 412_000, 28_000, 9_127_500, 400_000, 860_000),
      previousPnl: pnl(24_100_000, 380_000, 0, 8_520_000, 390_000, 700_000),
      outlets: ['Outlet Utama', 'Outlet Cabang 2'],
      shifts: [
        {
          id: 'r1',
          businessDate: day(1),
          shiftNumber: 1,
          outletName: 'Outlet Utama',
          cashierName: 'Sari',
          open: false,
          openingCash: 200000,
          expectedCash: 1_840_000,
          closingCash: 1_825_000,
          variance: -15000,
        },
        {
          id: 'r2',
          businessDate: day(1),
          shiftNumber: 2,
          outletName: 'Outlet Utama',
          cashierName: 'Budi',
          open: false,
          openingCash: 200000,
          expectedCash: 2_120_000,
          closingCash: 2_120_000,
          variance: 0,
        },
        {
          id: 'r3',
          businessDate: day(0),
          shiftNumber: 1,
          outletName: 'Outlet Utama',
          cashierName: 'Sari',
          open: true,
          openingCash: 200000,
          expectedCash: null,
          closingCash: null,
          variance: null,
        },
      ],
      cash: { closed: 2, open: 1, variance: -15000, matched: 1, shortCount: 1, short: -15000, overCount: 0, over: 0 },
      drawer: { opening: 400_000, cashSales: 3_885_000, refunds: 15_000, expenses: 310_000, other: 0, expected: 3_960_000, counted: 3_945_000 },
      expenses: {
        total: 1_260_000,
        belanja: 860_000,
        belanjaCount: 3,
        operasional: 400_000,
        operasionalCount: 1,
        drawer: 610_000,
        other: 650_000,
        daily: [
          { date: day(2), total: 410_000 },
          { date: day(1), total: 850_000 },
        ],
        top: [
          { name: 'Listrik', category: 'operasional', quantity: 1, unit: 'pcs', amount: 400_000, businessDate: day(1), outletName: 'Outlet Utama' },
          { name: 'Susu UHT', category: 'belanja', quantity: 12, unit: 'L', amount: 260_000, businessDate: day(2), outletName: 'Outlet Utama' },
        ],
      },
      voidsByCashier: [{ name: 'Budi', count: 2, total: 76_000 }],
      discounts: [
        { voucher: 'HEMAT10', count: 14, amount: 196_000 },
        { voucher: null, count: 11, amount: 216_000 },
      ],
      cashierOutlets: { c0: 'Outlet Cabang 2', c1: 'Outlet Utama', c2: 'Outlet Utama', c3: 'Outlet Utama' },
      byCategory: [
        { name: 'Minuman', qty: 640, sales: 15_900_000, hpp: 5_100_000 },
        { name: 'Makanan', qty: 310, sales: 9_800_000, hpp: 3_777_500 },
        { name: '', qty: 20, sales: 840_000, hpp: 250_000 },
      ],
      products: [
        { name: 'Kopi susu', category: 'Minuman', qty: 300, sales: 6_600_000, hpp: 2_400_000, profit: 4_200_000 },
        { name: 'Croissant', category: 'Makanan', qty: 96, sales: 2_304_000, hpp: 1_056_000, profit: 1_248_000 },
      ],
      productTotals: { qty: 970, sales: 26_540_000, hpp: 9_127_500 },
      productCount: 2,
    };
  },
  owner_day_close: (a) => ({
    date: a.p_date,
    closed: null,
    log: [],
    trail: [],
    checks: [],
    shifts: scenario.data === 'empty' || a.p_date !== today() ? [] : dayShifts,
  }),
  owner_add_cash_movement: (a) => {
    const s = dayShifts.find((x) => x.id === a.p_shift_id);
    if (!s) return fail('Shift tidak ditemukan');
    if (expired()) return fail('Langganan berakhir. Perpanjang paket untuk mencatat uang laci.');
    const m = { id: crypto.randomUUID(), direction: a.p_direction, amount: a.p_amount, reason: a.p_reason, createdAt: new Date().toISOString() };
    s.movements.push(m);
    if (a.p_direction === 'in') s.cashIn += a.p_amount;
    else s.cashOut += a.p_amount;
    s.expected = s.opening + s.cashSales - s.cashRefunds + s.cashIn - s.cashOut;
    if (s.counted !== null) s.variance = s.counted - s.expected;
    return m;
  },
  owner_add_expense_items: (a) => {
    if (expired()) return fail('Langganan berakhir. Perpanjang paket untuk mencatat pengeluaran.');
    if (a.p_paid_from !== 'other') return fail('Pengeluaran tidak diambil dari kas laci.');
    const s = dayShifts.find((x) => x.id === a.p_shift_id);
    let e = expenses.find((x) => x.shiftId === a.p_shift_id);
    if (!e) {
      e = { ...exp(crypto.randomUUID(), s?.shiftNumber ?? 1, s?.open ?? false, [], 0), shiftId: a.p_shift_id };
      expenses.unshift(e);
    }
    e.items.push(...a.p_items.map((i) => ({ id: crypto.randomUUID(), ...i, paidFrom: 'other' })));
    e.total = e.items.reduce((n, i) => n + i.amount, 0);
    return e;
  },
  owner_update_expense: (a) => {
    const e = expenses.find((x) => x.id === a.p_expense_id);
    if (!e) return fail('Pengeluaran tidak ditemukan');
    if (expired()) return fail('Langganan berakhir. Perpanjang paket untuk mengubah pengeluaran.');
    Object.assign(e, {
      items: a.p_items,
      total: a.p_items.reduce((n, i) => n + i.amount, 0),
      drawerTotal: a.p_items.filter((i) => i.paidFrom === 'drawer').reduce((n, i) => n + i.amount, 0),
    });
    return e;
  },
  create_category: () => crypto.randomUUID(),
  create_product: () => 'id',
  update_product: () => 'id',
  register_business: () => BIZ,
  owner_update_outlet: (a) =>
    expired()
      ? fail('Langganan berakhir. Perpanjang paket untuk mengubah data.')
      : ((outlets = outlets.map((o) =>
          o.id === a.p_outlet_id
            ? {
                ...o,
                name: a.p_name,
                address: a.p_address || null,
                phone: a.p_phone || null,
                receipt_header: a.p_receipt_header == null ? o.receipt_header : a.p_receipt_header || null,
                receipt_footer: a.p_receipt_footer == null ? o.receipt_footer : a.p_receipt_footer || null,
              }
            : o,
        )),
        null),
  owner_set_outlet_logo: (a) =>
    expired()
      ? fail('Langganan berakhir. Perpanjang paket untuk mengubah data.')
      : ((outlets = outlets.map((o) =>
          o.id === a.p_outlet_id ? { ...o, logo_url: a.p_logo_url || null, logo_print_url: (a.p_logo_url && a.p_print_url) || null } : o,
        )),
        null),
  owner_set_product_image: (a) => {
    const p = products.find((x) => x.id === a.p_product_id);
    if (!p) return fail('Produk tidak ditemukan');
    if (expired()) return fail('Langganan berakhir. Perpanjang paket untuk mengubah foto produk.');
    p.image_url = a.p_image_url || null;
    return null;
  },
};

const TABLES = {
  outlets: () => outlets,
  products: () => (scenario.data === 'empty' ? [] : products),
  categories: () => categories,
  vouchers: () => (scenario.data === 'empty' ? [] : vouchers),
  shifts: () => (scenario.data === 'empty' ? [] : [{ status: 'closed', variance: 0, closed_at: new Date().toISOString() }]),
};

function jwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`;
}
const session = () => ({
  access_token: jwt(),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-refresh',
  user,
});

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body && req.headers['content-type']?.includes('json') ? JSON.parse(body) : {};
  const send = (status, data, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  const p = url.pathname;
  if (p === '/__scenario') {
    for (const k of ['status', 'data', 'biz']) if (url.searchParams.get(k)) scenario[k] = url.searchParams.get(k);
    return send(200, scenario);
  }
  if (p === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password' && json.password !== 'rahasia123')
      return send(400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
        msg: 'Invalid login credentials',
        code: 'invalid_credentials',
      });
    return send(200, session());
  }
  if (p === '/auth/v1/user') return send(200, user);
  if (p === '/auth/v1/logout') return send(204);
  if (p === '/auth/v1/signup') return send(200, { ...user, id: crypto.randomUUID(), email: json.email });
  if (p === '/auth/v1/recover') return send(200, {});
  if (p.startsWith('/auth/v1/.well-known')) return send(200, { keys: [] });
  // Storage (buckets outlet-logos and product-images): upload, list a folder, remove.
  if (p.startsWith('/storage/v1/object/list/')) {
    const prefix = json.prefix ? json.prefix + '/' : '';
    return send(
      200,
      [...files].filter((f) => f.startsWith(prefix)).map((f) => ({ name: f.slice(prefix.length) })),
    );
  }
  if (p.startsWith('/storage/v1/object/') && req.method === 'DELETE') {
    for (const f of json.prefixes ?? []) files.delete(f);
    return send(200, []);
  }
  if (p.startsWith('/storage/v1/object/') && req.method === 'POST') {
    const key = decodeURIComponent(p.slice('/storage/v1/object/'.length));
    files.add(key.slice(key.indexOf('/') + 1));
    return send(200, { Key: key, Id: crypto.randomUUID() });
  }
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = RPC[p.slice('/rest/v1/rpc/'.length)];
    if (!fn) return send(404, { code: 'PGRST202', message: `Could not find the function ${p}` });
    const out = fn(json);
    if (out && out.status && out.body) return send(out.status, out.body);
    return send(200, out ?? null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.slice('/rest/v1/'.length);
    let rows = (TABLES[table] ?? (() => []))();
    for (const [k, v] of url.searchParams) {
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
    }
    const range = `0-${Math.max(0, rows.length - 1)}/${rows.length}`;
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-range': range });
      return res.end();
    }
    return send(200, rows, { 'content-range': range });
  }
  send(404, { message: 'not mocked: ' + p });
}).listen(PORT, () => console.log(`mock supabase on :${PORT}`));

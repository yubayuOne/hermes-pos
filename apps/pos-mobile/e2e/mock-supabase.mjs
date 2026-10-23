// Mock Supabase (Auth + PostgREST + RPC) for previewing the POS on the web without a real project.
// Not used by the app in production. Start: node e2e/mock-supabase.mjs (port 54500), then build the web preview
// with EXPO_PUBLIC_SUPABASE_URL=http://localhost:54500 EXPO_PUBLIC_SUPABASE_ANON_KEY=mock.
// Owner password: rahasia123. Cashier PIN: 123456.
// Scenarios: GET /__scenario?sub=active|trial|expired&shift=open|none&menu=ok|fail|slow&photos=yes|no&void=yes|no&net=up|down
// net=down drops checkout, hold, and voucher requests, so the app takes its offline path.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 54500);
const DAY = 86_400_000;
const scenario = { sub: 'active', shift: 'open', menu: 'ok', photos: 'no', void: 'yes', net: 'up', held: 'yes' };

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'rina@kopipojok.example',
  aud: 'authenticated',
  role: 'authenticated',
  user_metadata: {},
  identities: [{ id: '1' }],
};
const O1 = '20000000-0000-4000-8000-000000000001';
const K = ['Kopi', 'Non-kopi', 'Makanan', 'Lainnya'].map((name, i) => ({ id: `c000000${i}-0000-4000-8000-000000000000`, name }));
const cashiers = [
  { cashier_id: '40000000-0000-4000-8000-000000000001', cashier_name: 'Sari', has_pin: true, pin_locked_until: null },
  { cashier_id: '40000000-0000-4000-8000-000000000002', cashier_name: 'Budi', has_pin: true, pin_locked_until: null },
  { cashier_id: '40000000-0000-4000-8000-000000000003', cashier_name: 'Wulan', has_pin: false, pin_locked_until: null },
  {
    cashier_id: '40000000-0000-4000-8000-000000000004',
    cashier_name: 'Dedi',
    has_pin: true,
    pin_locked_until: new Date(Date.now() + 4 * 60_000).toISOString(),
  },
].map((c) => ({
  ...c,
  outlet_id: O1,
  outlet_name: 'Outlet Utama',
  outlet_phone: '022 420 1234',
  outlet_address: 'Jl. Braga 12, Bandung',
  outlet_receipt_header: null,
  outlet_receipt_footer: null,
  outlet_logo_url: null,
  outlet_logo_print_url: null,
  terminal_name: 'POS 1',
}));
const photo = (seed) => `https://picsum.photos/seed/${seed}/640/480`;
let products = [
  ['Kopi susu', 0, 22000, true, 120],
  ['Americano', 0, 18000, false, 0],
  ['Latte', 0, 26000, false, 0],
  ['Es kopi gula aren', 0, 24000, false, 0],
  ['Teh tarik', 1, 20000, false, 0],
  ['Matcha latte', 1, 28000, false, 0],
  ['Roti bakar', 2, 18000, true, 24],
  ['Croissant', 2, 24000, true, 3],
  ['Pisang goreng', 2, 15000, true, 0],
  ['Kentang goreng', 2, 20000, false, 0],
  ['Air mineral', 3, 6000, true, 48],
].map(([name, cat, price, track, stock], i) => ({
  id: `50000000-0000-4000-8000-0000000000${String(i + 10)}`,
  category_id: K[cat].id,
  name,
  selling_price: price,
  hpp: Math.round(price * 0.4),
  stock,
  track_stock: track,
  station: cat === 2 ? 'kitchen' : 'bar',
  image_url: null,
}));
const now = () => new Date();
const at = (h, m) => {
  const d = now();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
let shift = {
  id: '60000000-0000-4000-8000-000000000003',
  cashier_id: cashiers[0].cashier_id,
  business_date: now().toISOString().slice(0, 10),
  shift_number: 3,
  opened_at: at(7, 2),
  opening_cash: 200000,
  status: 'open',
  closed_at: null,
  closing_cash: null,
  expected_cash: null,
  variance: null,
};
let txSeq = 43;
const bills = [
  ['#HPOS-20261011-0042', '12.58', '7', '', 3, 76000, 'completed'],
  ['#HPOS-20261011-0041', '12.41', '', 'Nadia', 2, 48000, 'completed'],
  ['#HPOS-20261011-0040', '12.16', '4', '', 3, 60000, 'completed'],
  ['#HPOS-20261011-0038', '11.52', '1', '', 2, 36000, 'completed'],
  ['#HPOS-20261011-0037', '11.30', '5', '', 2, 46800, 'completed'],
  ['#HPOS-20261011-0035', '11.02', '', '', 3, 32000, 'completed'],
  ['#HPOS-20261011-0039', '12.05', '9', '', 3, 60000, 'held'],
  ['#HPOS-20261011-0036', '11.40', '2', 'Raka', 2, 44000, 'held'],
  ['#HPOS-20261011-0030', '10.12', '3', '', 1, 26000, 'voided'],
].map(([number, time, table, name, count, total, status], i) => {
  const [h, m] = time.split('.').map(Number);
  return {
    id: `70000000-0000-4000-8000-00000000000${i}`,
    number,
    table,
    customerName: name,
    customerPhone: '',
    itemCount: count,
    total,
    status,
    paymentMethod: 'cash',
    createdAt: at(h, m),
    voidReason: status === 'voided' ? 'Pelanggan batal, minuman belum dibuat' : null,
  };
});
const notifications = [
  {
    id: 'n1',
    kind: 'subscription_expiring',
    params: { days_left: 7, threshold: 7, expires_at: new Date(Date.now() + 7 * DAY).toISOString() },
    read_at: null,
    created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: 'n2',
    kind: 'subscription_expiring',
    params: { days_left: 14, threshold: 14, expires_at: new Date(Date.now() + 7 * DAY).toISOString() },
    read_at: '2026-10-04T02:00:00Z',
    created_at: '2026-10-04T01:00:00Z',
  },
];

function status() {
  const s = scenario.sub;
  const expires = s === 'expired' ? new Date(Date.now() - 9 * DAY) : s === 'trial' ? new Date(Date.now() + 2 * DAY) : new Date(Date.now() + 7 * DAY);
  return {
    state: s,
    plan_code: s === 'trial' ? 'trial' : 'monthly',
    plan_name: s === 'trial' ? 'Trial' : 'Bulanan',
    started_at: new Date(expires.getTime() - (s === 'trial' ? 3 : 30) * DAY).toISOString(),
    expires_at: expires.toISOString(),
    days_left: s === 'expired' ? 0 : s === 'trial' ? 2 : 7,
    extra_outlets: 0,
    limits: { outlets: 1, cashiers_per_outlet: s === 'trial' ? 2 : 3, products_per_outlet: s === 'trial' ? 40 : 100 },
    usage: [],
    unread: notifications.filter((n) => !n.read_at).length,
  };
}
const items = (bill) =>
  bill.number.endsWith('0042')
    ? [
        { productId: products[2].id, productName: 'Latte', station: 'bar', quantity: 2, unitPrice: 26000, subtotal: 52000, discount: 0, note: null },
        { productId: products[7].id, productName: 'Croissant', station: 'kitchen', quantity: 1, unitPrice: 24000, subtotal: 24000, discount: 0, note: null },
      ]
    : [
        { productId: products[0].id, productName: 'Kopi susu', station: 'bar', quantity: 1, unitPrice: 22000, subtotal: 22000, discount: 0, note: 'tanpa es' },
        { productId: products[4].id, productName: 'Teh tarik', station: 'bar', quantity: 1, unitPrice: 20000, subtotal: 20000, discount: 0, note: null },
        { productId: products[6].id, productName: 'Roti bakar', station: 'kitchen', quantity: 1, unitPrice: 18000, subtotal: 18000, discount: 0, note: null },
      ];

// Expenses (migrations 040, 041): the shift's one record; record_expense adds items to it.
const expense = {
  id: 'ex-1',
  createdAt: at(9, 10),
  outletId: O1,
  outletName: 'Outlet Utama',
  shiftId: shift.id,
  businessDate: shift.business_date,
  shiftNumber: shift.shift_number,
  shiftOpen: true,
  cashierName: 'Sari',
  status: 'pending',
  total: 56000,
  drawerTotal: 56000,
  reviewedAt: null,
  rejectReason: null,
  items: [
    { id: 'exi-1', name: 'Gula pasir', category: 'belanja', quantity: 2, unit: 'kg', amount: 36000, paidFrom: 'drawer' },
    { id: 'exi-2', name: 'Galon', category: 'operasional', quantity: 1, unit: 'pcs', amount: 20000, paidFrom: 'drawer' },
  ],
};

const RPC = {
  record_expense: (b) => {
    const added = b.p_items.reduce((n, i) => n + i.amount, 0);
    expense.items.push(...b.p_items.map((i, k) => ({ id: `exi-n${expense.items.length + k}`, ...i, paidFrom: b.p_paid_from })));
    expense.total += added;
    if (b.p_paid_from === 'drawer') expense.drawerTotal += added;
    return { ok: true, replayed: false, ...expense };
  },
  list_shift_expenses: () => (scenario.shift === 'open' ? [expense] : []),
  list_device_cashiers: (b) => (b?.p_outlet_id ? cashiers.filter((c) => c.outlet_id === b.p_outlet_id) : cashiers),
  verify_cashier_pin: (b) => (b.p_pin === '123456' ? { ok: true } : { ok: false, reason: 'wrong', attempts_left: 3 }),
  get_subscription_status: () => status(),
  list_notifications: () => notifications,
  mark_notifications_read: () => {
    notifications.forEach((n) => {
      n.read_at = n.read_at ?? now().toISOString();
    });
    return 1;
  },
  owner_get_business: () => ({
    id: 'b1',
    name: 'Kopi Pojok',
    receipt: {
      header: 'Jl. Braga 12, Bandung',
      footer: 'Terima kasih, sampai jumpa lagi',
      show_header: true,
      show_footer: true,
      show_phone: false,
      show_cashier: true,
      show_notes: true,
    },
  }),
  open_shift: (b) => {
    shift = { ...shift, status: 'open', opening_cash: b.p_opening_cash, opened_at: now().toISOString(), shift_number: 4 };
    scenario.shift = 'open';
    return shift.id;
  },
  close_shift: (b) => {
    scenario.shift = 'none';
    return { expected_cash: 2042000, variance: b.p_physical_cash - 2042000, cash_in: 1868000, cash_out: 26000 };
  },
  get_shift_report: () => ({
    totalRevenue: 1842000,
    cashRevenue: 1868000,
    qrisRevenue: 0,
    openingCash: 200000,
    expectedCash: 2042000,
    closingCash: null,
    variance: null,
    totalItems: 96,
    totalTransactions: 42,
    grossSales: 1860000,
    discountTotal: 18000,
    voidedCount: 1,
    voidedTotal: 26000,
    categories: [
      { categoryId: K[0].id, name: 'Kopi', qty: 39, total: 888000, products: [{ productId: products[0].id, name: 'Kopi susu', qty: 24, total: 528000 }] },
    ],
  }),
  get_shift_cash_summary: () => ({ cash_in: 1868000, cash_out: 26000, expected_cash: 2042000 }),
  get_dashboard_summary: (b) =>
    new Date(b.p_to) <= new Date(b.p_from) || new Date(b.p_prev_to) <= new Date(b.p_prev_from)
      ? { status: 400, body: { code: 'P0001', message: 'Rentang tanggal tidak valid' } }
      : {
          count: 42,
          sales: 1842000,
          cash: 1842000,
          qris: 0,
          totalItems: 96,
          menuCount: 11,
          previousSales: 0,
          hourly: [
            [7, 186],
            [8, 242],
            [9, 318],
            [10, 274],
            [11, 296],
            [12, 402],
            [13, 124],
          ].map(([hour, k]) => ({ hour, total: k * 1000 })),
          top: [
            ['Kopi susu', 24, 528000],
            ['Es kopi gula aren', 15, 360000],
            ['Roti bakar', 12, 216000],
            ['Americano', 10, 180000],
            ['Croissant', 6, 144000],
          ].map(([name, qty, subtotal]) => ({ name, qty, subtotal, station: 'bar' })),
        },
  list_shift_bills: (b) => {
    const all = bills.filter((x) => scenario.shift === 'open' && (scenario.held === 'yes' || x.status !== 'held'));
    const rows = all.filter(
      (x) => x.status === b.p_status && (!b.p_search || `${x.number} ${x.table} ${x.customerName}`.toLowerCase().includes(String(b.p_search).toLowerCase())),
    );
    return {
      rows: rows.slice(b.p_offset ?? 0, (b.p_offset ?? 0) + (b.p_limit ?? 30)),
      completedCount: all.filter((x) => x.status === 'completed').length + 36,
      heldCount: all.filter((x) => x.status === 'held').length,
      voidedCount: all.filter((x) => x.status === 'voided').length,
    };
  },
  get_bill_items: (b) => items(bills.find((x) => x.id === b.p_transaction_id) ?? bills[0]),
  recall_held_bill_with_items: (b) => {
    const bill = bills.find((x) => x.id === b.p_transaction_id) ?? bills[6];
    return {
      customerName: bill.customerName,
      customerPhone: '',
      tableNumber: bill.table,
      items: items(bill).map((i) => ({
        productId: i.productId,
        name: i.productName,
        unitPrice: i.unitPrice,
        hpp: 0,
        quantity: i.quantity,
        stock: 99,
        trackStock: false,
        station: i.station,
        note: i.note,
      })),
    };
  },
  start_split_from_held: () => ({}),
  get_held_bill_items: () =>
    items(bills[6]).map((i) => ({
      productId: i.productId,
      name: i.productName,
      unitPrice: i.unitPrice,
      hpp: 0,
      quantity: i.quantity,
      stock: 99,
      trackStock: false,
      station: i.station,
      note: i.note,
      discountAmount: 0,
    })),
  complete_checkout: (b) => {
    if (scenario.sub === 'expired')
      return { status: 400, body: { code: 'P0001', message: 'Langganan berakhir. Perpanjang paket untuk menambah transaksi.', hint: 'subscription_expired' } };
    const total = (b.p_payload.items ?? []).reduce((n, i) => n + (products.find((p) => p.id === i.product_id)?.selling_price ?? 0) * i.quantity, 0);
    return { transactionId: crypto.randomUUID(), transactionNumber: `#HPOS-20261011-00${txSeq++}`, total, change: Math.max(0, b.p_amount_received - total) };
  },
  save_held_bill: () => crypto.randomUUID(),
  update_held_bill: (b) => b.p_transaction_id,
  delete_held_bill: () => ({}),
  create_temporary_product: () => crypto.randomUUID(),
  pos_list_vouchers: () => [
    { code: 'HEMAT10', scope: 'bill', discount_type: 'percent', value: 10, min_spend: 40000, product_ids: [] },
    { code: 'ROTI50', scope: 'products', discount_type: 'percent', value: 50, min_spend: 0, product_ids: [products[6].id] },
  ],
  void_transaction_approved: (b) =>
    b.p_code === '481516'
      ? { ok: true, number: '#HPOS-20261011-0042', total: 76000, paymentMethod: 'cash', alreadyVoided: false }
      : scenario.void === 'no'
        ? { ok: false, reason: 'no_code' }
        : { ok: false, reason: 'wrong', attempts_left: 4 },
};

const TABLES = {
  products: () => products.map((p) => ({ ...p, image_url: scenario.photos === 'yes' && p.name !== 'Americano' ? photo(p.name.replace(/\s/g, '')) : null })),
  categories: () => K,
  shifts: () =>
    scenario.shift === 'open' ? [shift] : [{ ...shift, id: 's2', shift_number: 2, status: 'closed', opened_at: at(6, 0), closed_at: at(7, 0), variance: 0 }],
};

const jwt = () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`;
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'access-control-expose-headers': '*',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : {};
  const send = (code, data, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', ...cors, ...headers });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  const p = url.pathname;
  if (p === '/__scenario') {
    for (const k of Object.keys(scenario)) if (url.searchParams.get(k)) scenario[k] = url.searchParams.get(k);
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
    return send(200, {
      access_token: jwt(),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'mock-refresh',
      user,
    });
  }
  if (p === '/auth/v1/user') return send(200, user);
  if (p === '/auth/v1/logout') return send(204);
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.slice('/rest/v1/rpc/'.length);
    if (scenario.net === 'down' && ['complete_checkout', 'save_held_bill', 'pos_list_vouchers', 'void_transaction_approved', 'close_shift'].includes(name))
      return req.socket.destroy();
    if (scenario.menu === 'fail' && name === 'nothing') return send(500, {});
    const fn = RPC[name];
    if (!fn) return send(404, { code: 'PGRST202', message: `Could not find the function ${name}` });
    const out = fn(json);
    if (out && out.status && out.body) return send(out.status, out.body);
    return send(200, out ?? null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.slice('/rest/v1/'.length);
    if (table === 'products' && scenario.menu === 'fail') return send(503, { message: 'upstream unavailable' });
    if (table === 'products' && scenario.menu === 'slow') await new Promise((r) => setTimeout(r, 60_000));
    let rows = (TABLES[table] ?? (() => []))();
    for (const [k, v] of url.searchParams) if (v.startsWith('eq.')) rows = rows.filter((r) => r[k] === undefined || String(r[k]) === v.slice(3));
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
    if (single) return rows.length ? send(200, rows[0]) : send(406, { code: 'PGRST116', message: 'no rows' });
    return send(200, rows, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
  }
  send(404, { message: 'not mocked: ' + p });
}).listen(PORT, () => console.log(`mock supabase (POS) on :${PORT}`));

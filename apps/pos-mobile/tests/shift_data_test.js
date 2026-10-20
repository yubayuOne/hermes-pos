// Tests src/services/local/shiftData.ts (shift snapshots 055/057) against an in-memory stand-in for SQLite. Run from
// apps/pos-mobile: node tests/shift_data_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const compile = (rel, req) => {
  const out = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out)(mod, mod.exports, req);
  return mod.exports;
};
// --- fake SQLite: only the statements shiftData.ts runs ---
let rows = [];
const db = {
  getFirstAsync: async (sql, p) => {
    const r = rows.find((x) => x.shift_id === p[0]);
    if (!r) return null;
    return sql.startsWith('select version') ? { version: r.version } : { data: r.data, synced_at: r.synced_at };
  },
  runAsync: async (sql, p) => {
    if (sql.startsWith('insert or replace')) {
      rows = rows.filter((x) => x.shift_id !== p[0]);
      rows.push({ shift_id: p[0], outlet_id: p[1], version: p[2], synced_at: p[3], data: p[4] });
    } else if (sql.startsWith('update shift_snapshots set synced_at')) rows.find((x) => x.shift_id === p[1]).synced_at = p[0];
    else if (sql.startsWith('delete from shift_snapshots where synced_at <')) rows = rows.filter((x) => x.synced_at >= p[0]);
    else throw new Error('unexpected sql: ' + sql);
  },
};
let answer = null;
let calls = [];
const supabase = { rpc: async (name, args) => (calls.push(args), answer instanceof Error ? { data: null, error: answer } : { data: answer, error: null }) };
const i18n = { t: (s) => s };
const held = compile('src/services/transaction/heldBills.ts', (id) =>
  id.endsWith('/client') ? { supabase } : id.endsWith('/i18n') ? i18n : id.endsWith('/note') ? { cleanNote: (n) => n ?? '', notePayload: () => ({}) } : {},
);
const repo = {
  toBillRow: (b) => ({ id: b.id, status: b.status }),
  toBillItem: (i) => i,
  toRefunds: (r) => r ?? [],
  toCashSummary: (c) => ({ cashIn: Number(c.cash_in), cashOut: Number(c.cash_out), expectedCash: Number(c.expected_cash) }),
  toDashboard: (d) => ({ hourly: d.hourly ?? [], top: d.top ?? [] }),
};
const S = compile('src/services/local/shiftData.ts', (id) =>
  id.endsWith('/client')
    ? { supabase }
    : id.endsWith('/db')
      ? { localDb: async () => db }
      : id.endsWith('/repository')
        ? repo
        : id.endsWith('/heldBills')
          ? held
          : id.endsWith('/report')
            ? { toSalesReport: (r) => r ?? {} }
            : {},
);
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const line = (productId, quantity, discountAmount) => ({
  productId,
  name: productId,
  unitPrice: 10000,
  quantity,
  discountAmount,
  discountType: discountAmount ? 'amount' : null,
  discountValue: discountAmount,
});

(async () => {
  answer = {
    version: 'v1',
    bills: [{ id: 'H', status: 'held' }],
    items: {},
    report: { totalRevenue: 0 },
    held: { H: { customerName: 'Budi', tableNumber: '4', billDiscountType: 'percent', billDiscountValue: 10, items: [line('kopi', 2, 2000)] } },
    cash: { cash_in: '50000', cash_out: '5000', expected_cash: '45000' },
    dashboard: { hourly: [{ hour: 9, total: 1 }] },
  };
  await S.syncShift('s1', 'o1');
  const d = await S.readShift('s1');
  const h = d.held.H;
  ok(h.header.customerName === 'Budi' && h.header.tableNumber === '4' && h.header.billDiscount.value === 10, 'D1 a held bill keeps its recall header (057)');
  ok(h.items[0].quantity === 2 && h.items[0].discount.value === 2000 && h.remaining[0].remainingDiscount === 2000, 'D2 its items and remaining split count');
  ok(d.cash.expectedCash === 45000 && d.dashboard.hourly.length === 1, 'D3 kas laci and dashboard figures come with the shift');
  ok((await S.readHeldBill('s1', 'H')).header.customerName === 'Budi' && (await S.readHeldBill('s1', 'X')) === null, 'D4 one held bill, or null');

  answer = { version: 'v1', unchanged: true };
  calls = [];
  await S.syncShift('s1', 'o1');
  ok(calls[0].p_version === 'v1' && (await S.readShift('s1')).held.H, 'D5 unchanged: nothing downloaded, the copy stays');

  answer = { version: 'v0', bills: [], items: {}, report: {} };
  await S.syncShift('s0', 'o1');
  const old = await S.readShift('s0');
  ok(old.cash === null && old.dashboard === null && Object.keys(old.held).length === 0, 'D6 a server without 057: no kas laci, no dashboard, no held copies');

  rows.find((x) => x.shift_id === 's0').synced_at = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  answer = { version: 'v1', unchanged: true };
  await S.syncShift('s1', 'o1');
  ok((await S.readShift('s0')) === null && (await S.readShift('s1')) !== null, 'D7 a shift not synced for 3 days is dropped');

  answer = new TypeError('Network request failed');
  let threw = false;
  await S.syncShift('s1', 'o1').catch(() => (threw = true));
  ok(threw && (await S.readShift('s1')).held.H, 'D8 offline: the sync fails, the last copy stays readable');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

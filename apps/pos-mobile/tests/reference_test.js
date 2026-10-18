// Tests src/services/local/reference.ts against an in-memory stand-in for SQLite. Run from apps/pos-mobile:
// node tests/reference_test.js
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
// --- fake SQLite: only the statements reference.ts runs ---
const tables = { meta: [], cashiers: [], products: [], categories: [], vouchers: [], open_shifts: [], shift_snapshots: [] };
let failInsert = false;
const exec = (sql, p = []) => {
  let m;
  if ((m = sql.match(/^delete from (\w+) where (\w+) = \?$/))) tables[m[1]] = tables[m[1]].filter((r) => r[m[2]] !== p[0]);
  else if ((m = sql.match(/^delete from (\w+)$/))) tables[m[1]] = [];
  else if ((m = sql.match(/^insert (or replace )?into (\w+) \(([^)]+)\)/))) {
    if (failInsert && m[2] === 'products') throw new Error('disk full');
    const cols = m[3].split(',').map((c) => c.trim());
    const row = Object.fromEntries(cols.map((c, i) => [c, p[i]]));
    if (m[2] === 'meta') tables.meta = tables.meta.filter((r) => r.key !== row.key);
    tables[m[2]].push(row);
  } else throw new Error('unexpected sql: ' + sql);
};
const db = {
  getFirstAsync: async (sql, p) => {
    const m = sql.match(/^select \w+ from (\w+) where (\w+) = \?$/);
    return tables[m[1]].find((r) => r[m[2]] === p[0]) ?? null;
  },
  runAsync: async (sql, p) => exec(sql, p),
  getAllAsync: async (sql, p = []) => {
    const m = sql.match(/^select (\w+) from (\w+)(?: where outlet_id = \?)?/);
    const rows = tables[m[2]].filter((r) => !p.length || r.outlet_id === p[0]).sort((a, b) => a.position - b.position);
    return rows.map((r) => ({ [m[1]]: r[m[1]] }));
  },
  withExclusiveTransactionAsync: async (task) => {
    const backup = JSON.parse(JSON.stringify(tables));
    try {
      await task({ runAsync: async (sql, p) => exec(sql, p) });
    } catch (e) {
      Object.assign(tables, backup); // rollback
      throw e;
    }
  },
};
let snapshot = null;
let rpcCalls = [];
const supabase = {
  rpc: async (name, args) => (rpcCalls.push(args), snapshot instanceof Error ? { data: null, error: snapshot } : { data: snapshot, error: null }),
};
// Since 059 the snapshot has no PIN hashes; a sync only drops the ones older versions kept.
let dropped = [];
const offlinePin = { dropOldPinHashes: async (ids) => (dropped = [...dropped, ...ids]) };
const R = compile('src/services/local/reference.ts', (id) =>
  id.endsWith('/client')
    ? { supabase }
    : id.endsWith('/billNumber')
      ? { registerTerminal: async () => 'A1', TIMEZONE_KEY: 'timezone' }
      : id.endsWith('/db')
        ? { localDb: async () => db }
        : id.endsWith('/offlinePin')
          ? offlinePin
          : {},
);
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const cashier = (id, hash) => ({
  cashier_id: id,
  cashier_name: id.toUpperCase(),
  outlet_id: 'o1',
  outlet_name: 'Outlet',
  terminal_name: 'POS 1',
  has_pin: !!hash,
  pin_hash: hash,
});
const snap = (extra = {}) => ({
  version: 'v1',
  cashiers: [cashier('a', '$2a$06$aaa'), cashier('b', null)],
  products: [
    { id: 'p1', category_id: 'c1', name: 'Kopi', hpp: '5000', selling_price: '15000', stock: '7', track_stock: true, image_url: null, station: 'bar' },
  ],
  categories: [{ id: 'c1', name: 'Minuman' }],
  vouchers: [
    { code: 'hemat', scope: 'bill', discount_type: 'percent', value: 10, min_spend: 0, expires_on: '2999-01-01', product_ids: [] },
    { code: 'LAMA', scope: 'bill', discount_type: 'amount', value: 5000, min_spend: 0, expires_on: '2000-01-01', product_ids: [] },
  ],
  ...extra,
});
const toVoucher = (d) => ({ code: String(d.code).toUpperCase(), value: Number(d.value) });

(async () => {
  snapshot = snap();
  await R.syncReference('o1');
  const cat = await R.readCatalog('o1');
  ok(
    cat.products.length === 1 && cat.products[0].price === 15000 && cat.products[0].stock === 7 && cat.categories[0].name === 'Minuman',
    'R1 menu stored and read back with numbers',
  );
  const cashiers = await R.readCashiers('o1');
  ok(cashiers.length === 2 && cashiers[0].cashierName === 'A' && cashiers[0].hasPin && !cashiers[1].hasPin, 'R2 cashiers stored');
  ok(!tables.cashiers.some((r) => r.data.includes('pin_hash')), 'R3 a hash from a server before 059 never lands in the local database');
  ok(dropped.includes('a') && dropped.includes('b'), 'R4 PIN hashes kept by older versions are dropped from the keystore');
  const vouchers = await R.readVouchers('o1', toVoucher);
  ok(vouchers.length === 1 && vouchers[0].code === 'HEMAT', 'R5 vouchers that ended are left out');

  snapshot = { version: 'v1', unchanged: true };
  rpcCalls = [];
  await R.syncReference('o1');
  ok(rpcCalls[0].p_version === 'v1' && (await R.readCatalog('o1')).products.length === 1, 'R6 same version: nothing downloaded, local copy kept');

  snapshot = snap({ version: 'v2', cashiers: [cashier('a', '$2a$06$new')], products: [] });
  dropped = [];
  await R.syncReference('o1');
  ok((await R.readCatalog('o1')).products.length === 0 && (await R.readCashiers('o1')).length === 1, 'R7 changes replace the outlet rows');
  ok(dropped.includes('b') && dropped.includes('a'), 'R8 a removed cashier loses its old hash too');

  snapshot = new TypeError('Network request failed');
  let threw = false;
  await R.syncReference('o1').catch(() => (threw = true));
  ok(threw && (await R.readCashiers('o1')).length === 1, 'R9 offline: sync fails, the last copy stays readable');

  snapshot = snap({ version: 'v3' });
  failInsert = true;
  threw = false;
  await R.syncReference('o1').catch(() => (threw = true));
  failInsert = false;
  const meta = tables.meta.find((r) => r.key === 'ref-version:o1');
  ok(
    threw && meta.value === 'v2' && (await R.readCashiers('o1')).length === 1,
    'R10 a failed write rolls back: the old copy and version stay, the next sync retries',
  );

  snapshot = snap({ version: 'v4' });
  rpcCalls = [];
  await Promise.all([R.syncReference('o1'), R.syncReference('o1')]);
  ok(rpcCalls.length === 1, 'R11 two syncs at once: one download');

  const shiftRow = {
    id: 's9',
    cashier_id: 'a',
    business_date: '2026-10-17',
    shift_number: 2,
    opened_at: '2026-10-17T01:00:00Z',
    opening_cash: 0,
    status: 'open',
    device_id: 'dev',
  };
  snapshot = snap({ version: 'v5', open_shifts: [shiftRow] });
  await R.syncReference('o1');
  ok((await R.readOpenShiftRow('a')).id === 's9' && (await R.readOpenShiftRow('b')) === null, 'R13 the open shift of each cashier is kept (053)');
  await R.forgetOpenShiftRow('a');
  ok((await R.readOpenShiftRow('a')) === null, 'R14 closed on this phone: the snapshot copy goes until the next sync');
  snapshot = snap({ version: 'v6', open_shifts: [] });
  await R.syncReference('o1');
  ok((await R.readOpenShiftRow('a')) === null, 'R15 closed elsewhere: the next sync drops it');

  const zone = () => tables.meta.find((r) => r.key === 'timezone')?.value;
  ok(zone() === undefined, 'R16 a server before 064 sends no zone: none stored, bills stay in WIB');
  snapshot = snap({ version: 'v7', timezone: 'Asia/Makassar' });
  await R.syncReference('o1');
  ok(zone() === 'Asia/Makassar', "R17 the business zone is stored for bill numbers and today's shifts (064)");

  dropped = [];
  await R.clearReference();
  ok(Object.values(tables).every((t) => t.length === 0) && dropped.includes('a'), 'R12 sign-out: every table and old PIN hash cleared');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

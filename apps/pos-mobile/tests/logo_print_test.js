// Tests the printed logo (migration 037): src/services/printer/logo.ts (isLogoRaster) and its insertion in escpos.ts.
// Run from apps/pos-mobile: node tests/logo_print_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const load = (file, deps = {}) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'printer', file), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(
    mod,
    mod.exports,
    (n) => deps[n] ?? {},
  );
  return mod.exports;
};
const { isLogoRaster } = load('logo.ts');
const { buildEscPosReceipt } = load('escpos.ts', { '../../i18n': { t: (s) => s } });
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};

// GS v 0: 1 byte per row, 2 rows, then a second band of 1 row.
const raster = Uint8Array.from([0x1d, 0x76, 0x30, 0, 1, 0, 2, 0, 0xff, 0x81, 0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0x3c]);
ok(isLogoRaster(raster), 'L1 two complete GS v 0 bands accepted');
ok(!isLogoRaster(raster.subarray(0, raster.length - 1)), 'L2 truncated band rejected');
ok(!isLogoRaster(Uint8Array.from([0x1b, 0x40, 0x0a])), 'L3 other command (not GS v 0) rejected');
ok(!isLogoRaster(Uint8Array.from([0x1d, 0x76, 0x30, 0, 49, 0, 1, 0, ...new Array(49).fill(0)])), 'L4 wider than 58 mm (49 bytes/row) rejected');
ok(!isLogoRaster(new Uint8Array(0)), 'L5 empty file rejected');

const base = {
  number: 'B-1',
  date: '15/10',
  cashier: 'Dedi',
  outlet: 'Outlet',
  customer: {},
  items: [],
  kitchenItems: [],
  barItems: [],
  subtotal: 0,
  total: 0,
  paymentMethod: 'cash',
  paid: 0,
  change: 0,
};
const has = (bytes) => {
  const s = Array.from(bytes).join(',');
  return s.includes(Array.from(raster).join(','));
};
const out = buildEscPosReceipt({ ...base, logoRaster: raster });
ok(has(out) && out[0] === 0x1b && out[1] === 0x40 && out[2] === 0x1b && out[3] === 0x61 && out[4] === 0x01, 'E1 logo printed centered, right after ESC @');
ok(!has(buildEscPosReceipt({ ...base, logoRaster: raster, printKind: 'kitchen' })), 'E2 kitchen ticket without logo');
ok(
  has(buildEscPosReceipt({ ...base, logoRaster: raster, printKind: 'refund', refund: { amount: 1, method: 'cash', reason: 'x' } })),
  'E3 refund slip with logo',
);
ok(buildEscPosReceipt(base)[2] === 0x1b && buildEscPosReceipt(base)[4] === 0x00, 'E4 no logo: receipt unchanged');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

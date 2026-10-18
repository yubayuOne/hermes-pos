// Tests src/utils/voucher.ts: the till's copy of how migration 032 applies a voucher (applyVoucher, billTotals).
// Run from apps/pos-mobile: node tests/voucher_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const compile = (rel, req) => {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(
    mod,
    mod.exports,
    req,
  );
  return mod.exports;
};
const i18n = { t: (k) => k, money: (n) => `Rp${n}` };
const discount = compile('src/utils/discount.ts', () => i18n);
const { applyVoucher, billTotals } = compile('src/utils/voucher.ts', (id) => (id === './discount' ? discount : i18n));
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const item = (id, price, qty, d = null) => ({ productId: id, name: id, unitPrice: price, hpp: 0, quantity: qty, stock: 99, station: 'bar', discount: d });
const bill = (type, value, minSpend = 0) => ({ code: 'B', scope: 'bill', discountType: type, value, minSpend, productIds: [] });
const prod = (type, value, ids, minSpend = 0) => ({ code: 'P', scope: 'products', discountType: type, value, minSpend, productIds: ids });
// Coffee 2 x 22,000 and bread 1 x 18,000: gross 62,000.
const cart = [item('kopi', 22000, 2), item('roti', 18000, 1)];

// No voucher
let r = applyVoucher(cart, null, null);
ok(r.items === cart && r.cut === 0 && r.error === null, 'V1 no voucher: cart unchanged, no cut');
let b = billTotals(cart, null, null);
ok(b.total === 62000 && b.voucherCut === 0 && b.voucherError === null, 'V2 billTotals without voucher = gross');

// Bill vouchers
r = applyVoucher(cart, null, bill('percent', 10));
ok(r.cut === 6200 && r.billDiscount.type === 'percent' && r.billDiscount.value === 10 && r.error === null, 'V3 bill 10%: cut 6,200 becomes the bill discount');
b = billTotals(cart, null, bill('percent', 10));
ok(b.total === 55800 && b.voucherCut === 6200 && b.billDiscount === 0 && b.itemDiscount === 0, 'V4 billTotals separates the voucher from manual discounts');
ok(billTotals(cart, null, bill('amount', 5000)).total === 57000, 'V5 bill amount 5,000');
ok(applyVoucher(cart, null, bill('amount', 62000)).error !== null, 'V6 bill amount equal to the total is refused (server: value >= base)');
ok(billTotals(cart, null, bill('amount', 61999)).total === 1, 'V7 bill amount just under the total leaves Rp1');
ok(applyVoucher([item('a', 9999, 1)], null, bill('percent', 15)).cut === 1500, 'V8 rounding half up: 15% of 9,999 = 1,499.85 -> 1,500');
ok(applyVoucher(cart, { type: 'amount', value: 1000 }, bill('percent', 10)).error !== null, 'V9 bill voucher refused next to a manual bill discount');
const discounted = [item('kopi', 22000, 2, { type: 'percent', value: 10 }), item('roti', 18000, 1)];
r = applyVoucher(discounted, null, bill('percent', 10));
ok(r.error === null && r.cut === 5760, 'V10 bill voucher applies after manual item discounts (base 57,600)');

// Minimum spend compares with the gross subtotal
ok(applyVoucher(cart, null, bill('percent', 10, 62000)).error === null, 'V11 min spend equal to gross is accepted');
ok(applyVoucher(cart, null, bill('percent', 10, 62001)).error !== null, 'V12 min spend above gross is refused');
ok(applyVoucher(discounted, null, bill('percent', 10, 62000)).error === null, 'V13 min spend uses gross, before item discounts');

// Product vouchers
r = applyVoucher(cart, null, prod('percent', 50, ['kopi']));
ok(r.cut === 22000 && r.items[0].discount.value === 50 && r.items[1].discount === null, 'V14 product 50% on the coffee line only');
b = billTotals(cart, null, prod('percent', 50, ['kopi']));
ok(b.total === 40000 && b.itemDiscount === 0 && b.voucherCut === 22000, 'V15 billTotals: product voucher counted as voucher, not item discount');
r = applyVoucher(cart, null, prod('amount', 30000, ['roti']));
ok(r.cut === 18000 && r.items[1].discount.value === 18000, 'V16 product amount is capped at the line price');
ok(applyVoucher(cart, null, prod('amount', 5000, ['kopi'])).cut === 5000, 'V17 product amount applies once per line, not per unit');
ok(applyVoucher([item('a', 9999, 1)], null, prod('percent', 12.5, ['a'])).cut === 1250, 'V18 rounding: 12.5% of 9,999 -> 1,250');
ok(applyVoucher(discounted, null, prod('percent', 10, ['kopi'])).error !== null, 'V19 product voucher refused on a line with a manual discount');
ok(applyVoucher(cart, null, prod('percent', 10, ['teh'])).error !== null, 'V20 product voucher with no matching line is refused');
ok(applyVoucher([item('free', 0, 1)], null, prod('percent', 10, ['free'])).error !== null, 'V21 zero-price lines do not count as a match');
b = billTotals(cart, { type: 'percent', value: 10 }, prod('percent', 50, ['roti']));
ok(b.voucherCut === 9000 && b.billDiscount === 5300 && b.total === 47700, 'V22 product voucher with a manual bill discount: bill 10% of 53,000');

// A refused voucher leaves the totals as if there were none
b = billTotals(cart, null, bill('percent', 10, 100000));
ok(b.total === 62000 && b.voucherCut === 0 && b.voucherError !== null, 'V23 refused voucher: no cut, error reported');
ok(billTotals([], null, null).total === 0, 'V24 empty cart = 0');

// Same error order as the server: a product clash is reported before the minimum spend.
ok(
  applyVoucher(discounted, null, prod('percent', 10, ['kopi'], 100000)).error === 'Voucher menu tidak bisa digabung dengan diskon item di menu yang sama.',
  'V25 product clash wins over an unmet minimum spend',
);
ok(
  applyVoucher(cart, null, prod('percent', 10, ['teh'], 100000)).error === 'Belanja minimal {amount} untuk voucher ini.',
  'V26 minimum spend wins over no matching line',
);
ok(
  applyVoucher(cart, { type: 'amount', value: 1000 }, bill('percent', 10, 100000)).error === 'Belanja minimal {amount} untuk voucher ini.',
  'V27 bill voucher: minimum spend first, as on the server',
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Tests src/utils/discount.ts: results MUST match public.calc_discount / the server flow (see test_023.sql).
// Run from apps/pos-mobile: node tests/discount_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'discount.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(
  mod,
  mod.exports,
  () => ({ t: (k) => k }),
);
const { calcDiscount, cartTotals, validateDiscount, splitLineDiscount } = mod.exports;
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const item = (price, qty, discount) => ({ productId: 'p' + price, name: 'x', unitPrice: price, hpp: 0, quantity: qty, stock: 99, station: 'bar', discount });
// same numbers as test_023.sql
ok(calcDiscount(30000, { type: 'percent', value: 10 }) === 3000, 'A2 10% of 30000');
ok(calcDiscount(15000, { type: 'amount', value: 5000 }) === 5000, 'A3 amount 5000');
let t = cartTotals([item(10000, 2, { type: 'percent', value: 10 }), item(15000, 1)], { type: 'percent', value: 5 });
ok(t.gross === 35000 && t.itemDiscount === 2000 && t.billDiscount === 1650 && t.total === 31350, 'A4 item 10% + bill 5% = 31350');
ok(calcDiscount(9999, { type: 'percent', value: 15 }) === 1500, 'A5 15% of 9999 = 1499.85 -> 1500');
ok(calcDiscount(9999, { type: 'percent', value: 12.5 }) === 1250, 'A5b 12.5% of 9999 = 1249.875 -> 1250');
ok(calcDiscount(10, { type: 'percent', value: 5 }) === 1, 'half up: 5% of 10 = 0.5 -> 1');
ok(calcDiscount(30, { type: 'percent', value: 5 }) === 2, 'half up: 5% of 30 = 1.5 -> 2');
ok(
  calcDiscount(0, { type: 'percent', value: 10 }) === 0 && calcDiscount(100, null) === 0 && calcDiscount(100, { type: 'amount', value: 0 }) === 0,
  'no discount = 0',
);
ok(calcDiscount(1000, { type: 'amount', value: 5000 }) === 1000, 'amount never exceeds the base (clamped)');
// 3-way split: remaining discount 100, qty 3 -> 33, 34, 33 (sum 100)
let remD = 100,
  remQ = 3,
  parts = [];
for (let k = 0; k < 3; k++) {
  const d = splitLineDiscount(remD, remQ, 1, 3333);
  parts.push(d);
  remD -= d;
  remQ -= 1;
}
ok(parts.join() === '33,34,33' && parts.reduce((a, b) => a + b) === 100, '3-way split 33/34/33');
ok(splitLineDiscount(4500, 3, 3, 45000) === 4500 && splitLineDiscount(6000, 4, 1, 15000) === 1500, 'split: the last part takes all that remains; 1 of 4');
// brute force: client results match round-half-up on integers
let bad = 0;
for (let base = 1; base <= 3000; base += 7)
  for (const v of [1, 2.5, 5, 7.5, 10, 12.5, 15, 33.33, 50, 99.99, 100]) {
    const exact = BigInt(base) * BigInt(Math.round(v * 100)); // base x percent x 100
    const q = exact / 10000n,
      r = exact % 10000n;
    const want = Number(r >= 5000n ? q + 1n : q);
    if (calcDiscount(base, { type: 'percent', value: v }) !== want) bad++;
  }
ok(bad === 0, 'brute force: matches integer half-up rounding (no float error)');
ok(
  validateDiscount(10000, { type: 'percent', value: 101 }) !== null &&
    validateDiscount(10000, { type: 'amount', value: 10001 }) !== null &&
    validateDiscount(10000, { type: 'amount', value: 10000 }) === null,
  'limit validation',
);
ok(
  validateDiscount(10000, { type: 'percent', value: 100 }, { mustLeavePositive: true }) !== null &&
    validateDiscount(10000, { type: 'percent', value: 99 }, { mustLeavePositive: true }) === null,
  'total must not be zero',
);
ok(
  validateDiscount(10000, { type: 'percent', value: 12.345 }) !== null && validateDiscount(10000, { type: 'amount', value: 100.5 }) !== null,
  'max 2 decimals; whole rupiah',
);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

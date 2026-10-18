// Tests quickAmounts in src/screens/pay/PaymentScreen.tsx: the cash chips under the amount received.
// Run from apps/pos-mobile: node tests/payment_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'pay', 'PaymentScreen.tsx'), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020', jsx: ts.JsxEmit.ReactJSX } }).outputText;
const mod = { exports: {} };
// Only the pure function is used; every import resolves to an empty module.
new Function('module', 'exports', 'require', out)(mod, mod.exports, () => ({}));
const { quickAmounts } = mod.exports;
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

ok(same(quickAmounts(84200), [84200, 90000, 100000, 150000]), 'Q1 exact, then up to 10rb, 50rb, then the next 50rb step');
ok(same(quickAmounts(100000), [100000, 150000, 200000]), 'Q2 round total: no chip equal to the total twice');
ok(same(quickAmounts(45000), [45000, 50000, 100000, 200000]), 'Q3 duplicates are skipped, at most 4 chips');
ok(same(quickAmounts(150000), [150000, 200000, 300000]), 'Q4 total on a 50rb step');
ok(same(quickAmounts(1), [1, 10000, 50000, 100000]), 'Q5 tiny total');
ok(same(quickAmounts(0), []) && same(quickAmounts(-500), []), 'Q6 zero or negative total: no chips');
ok(
  quickAmounts(123456).every((v, i, a) => i === 0 || v > a[i - 1]),
  'Q7 chips are strictly increasing',
);
ok(
  quickAmounts(123456)
    .slice(1)
    .every((v) => v % 10000 === 0),
  'Q8 every chip after the exact amount is a round amount',
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

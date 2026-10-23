// Tests src/utils/expense.ts: cashier input (decimal quantity, rupiah price) before it is sent to record_expense (migration 040).
// Run from apps/pos-mobile: node tests/expense_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'expense.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(
  mod,
  mod.exports,
  () => ({}),
);
const { parseQuantity, parseAmount, checkLines, emptyLine, EXPENSE_UNITS } = mod.exports;
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};

ok(parseQuantity('1,5') === 1.5 && parseQuantity('1.5') === 1.5 && parseQuantity(' 2 ') === 2, 'Q1 comma or dot as decimal separator');
ok(
  parseQuantity('0') === null && parseQuantity('') === null && parseQuantity('1.2345') === null && parseQuantity('abc') === null,
  'Q2 zero, empty, 4 decimals, letters rejected',
);
ok(parseQuantity('100000') === 100000 && parseQuantity('100001') === null, 'Q3 limit 100,000');
ok(parseAmount('25.000') === 25000 && parseAmount('25000') === 25000, 'M1 thousands dots removed');
ok(
  parseAmount('0') === null && parseAmount('1000,5') === null && parseAmount('') === null && parseAmount('100000001') === null,
  'M2 zero, decimals, empty, over 100 million rejected',
);

const good = { name: ' Gula pasir ', category: 'belanja', quantity: '2', unit: 'kg', amount: '36000' };
const r1 = checkLines([good, { ...good, name: 'Galon', category: 'operasional', quantity: '1,5', unit: 'pcs', amount: '20.000' }]);
ok(
  r1.items && r1.items.length === 2 && r1.items[0].name === 'Gula pasir' && r1.items[1].quantity === 1.5 && r1.items[1].amount === 20000,
  'C1 two valid lines become items ready to send',
);
const r2 = checkLines([good, { ...good, name: '', quantity: '0', unit: 'ton', amount: '' }]);
ok(
  r2.items === null && r2.errors[0].name === undefined && r2.errors[1].name && r2.errors[1].quantity && r2.errors[1].unit && r2.errors[1].amount,
  'C2 one bad line: nothing is sent, errors per field',
);
ok(checkLines([]).items === null, 'C3 no lines: nothing is sent');
ok(
  EXPENSE_UNITS.includes(emptyLine().unit) && emptyLine('operasional').category === 'operasional',
  'C4 a new line uses a known unit and the previous category',
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

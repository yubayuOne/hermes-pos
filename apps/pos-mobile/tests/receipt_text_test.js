// Tests printed receipt text: lines typed by the owner stay one per line, brand and outlet each get their own line, and only
// ASCII is sent to the printer (UTF-8 prints as Chinese characters on GB18030 printers).
// Run from apps/pos-mobile: node tests/receipt_text_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'printer', 'escpos.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(
  mod,
  mod.exports,
  () => ({ t: (s) => s }),
);
const { buildReceiptText, asciiBytes } = mod.exports;
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};

const base = {
  number: '#HPOS-20261015-00001',
  date: '15/10 10.00',
  cashier: 'Dedi',
  outlet: 'Classic Coffee\nCipendok',
  customer: {},
  items: [{ name: 'Kopi susu', quantity: 2, total: 44000, station: 'bar' }],
  kitchenItems: [],
  barItems: [],
  subtotal: 44000,
  total: 44000,
  paymentMethod: 'cash',
  paid: 50000,
  change: 6000,
  customHeader: ['Wifi : Classic Coffee\nPassword : classic7n8'],
  customFooter: ['Terima kasih\n\nWifi : Classic Coffee\nPassword : classic7n8'],
};
const lines = buildReceiptText(base, 32)
  .split('\n')
  .map((l) => l.trim());
const at = (s) => lines.indexOf(s);

ok(at('CLASSIC COFFEE') === 0 && at('CIPENDOK') === 1, 'T1 brand and outlet one line each, centered');
ok(at('Wifi : Classic Coffee') > 1 && at('Password : classic7n8') === at('Wifi : Classic Coffee') + 1, 'T2 header text stays 2 lines as typed');
const foot = lines.lastIndexOf('Wifi : Classic Coffee');
ok(foot > at('Terima kasih') && lines[foot - 1] === '' && lines[foot + 1] === 'Password : classic7n8', 'T3 footer text: blank line kept, each line separate');
ok(
  buildReceiptText({ ...base, customHeader: ['a'.repeat(40)] }, 32)
    .split('\n')
    .some((l) => l.trim() === 'a'.repeat(8)),
  'T4 a line longer than the paper still wraps to the next line',
);

const withAddress = buildReceiptText({ ...base, outletAddress: 'Jl. Braga 12', outletPhone: '022 111' }, 32)
  .split('\n')
  .map((l) => l.trim());
ok(withAddress[2] === 'Jl. Braga 12' && withAddress[3] === '022 111', 'T5 address sits under the outlet name, before the phone');
ok(!lines.includes('Jl. Braga 12'), 'T6 no address line when the outlet has none');

const refunded = buildReceiptText({ ...base, refunds: [{ amount: 22000, reason: 'Salah pesan' }] }, 32)
  .split('\n')
  .map((l) => l.trim());
ok(
  refunded.some((l) => /^Refund\s+-Rp22\.000$/.test(l)) &&
    refunded.includes('Alasan: Salah pesan') &&
    refunded.some((l) => /^Bersih\s+Rp22\.000$/.test(l)) &&
    refunded.indexOf('Alasan: Salah pesan') < refunded.indexOf('Terima kasih'),
  'F1 reprint of a refunded bill: refund, reason, and net before the footer',
);
ok(!lines.some((l) => l.startsWith('Refund')), 'F2 no refund lines on a bill without refunds');

const bytes = asciiBytes('Brand · Outlet 2× Café — “ok”');
ok(
  bytes.every((b) => b === 0x0a || (b >= 0x20 && b < 0x7f)),
  'A1 every byte is ASCII (no Chinese characters on the printer)',
);
ok(String.fromCharCode(...bytes) === 'Brand - Outlet 2x Cafe - "ok"', 'A2 symbols replaced with ASCII equivalents, accents dropped');
ok(String.fromCharCode(...asciiBytes('Teh 茶')) === 'Teh ?', 'A3 other characters become "?"');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

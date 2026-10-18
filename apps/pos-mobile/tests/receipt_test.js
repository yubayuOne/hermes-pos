// Tests src/utils/receipt.ts: receipt totals for a new bill, a reprint, and a bill whose prices changed on the server.
// Run from apps/pos-mobile: node tests/receipt_test.js
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
const i18n = { t: (k) => k, fmtShort: () => 'Sen 12/10 10.00' };
const discount = compile('src/utils/discount.ts', () => i18n);
const { receiptFromCart, receiptFromBill, withServerLines, receiptTexts } = compile('src/utils/receipt.ts', (id) => (id === './discount' ? discount : i18n));
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const adds = (r) => r.subtotal - (r.discount ?? 0) === r.total;
const cartItem = (id, price, qty, d = null, station = 'bar') => ({
  productId: id,
  name: id,
  unitPrice: price,
  hpp: 0,
  quantity: qty,
  stock: 9,
  station,
  discount: d,
});
const billItem = (name, price, qty, disc = 0, station = 'bar') => ({
  productId: name,
  productName: name,
  station,
  quantity: qty,
  unitPrice: price,
  subtotal: price * qty,
  discount: disc,
});
const bill = (total, status = 'completed') => ({
  id: 't',
  number: '#HPOS-1',
  customerName: 'Andi',
  customerPhone: '',
  table: '4',
  status,
  total,
  paymentMethod: 'cash',
  createdAt: '2026-10-12T03:00:00Z',
  itemCount: 0,
  items: [],
});

// New bill from the cart
const r1 = receiptFromCart({
  number: 'N1',
  session: { cashierName: 'Dedi', outletName: 'Kopi' },
  items: [cartItem('kopi', 22000, 2, { type: 'percent', value: 10 }), cartItem('roti', 18000, 1, null, 'kitchen')],
  customer: { name: '', phone: '', table: '' },
  gross: 62000,
  discount: 4400,
  total: 57600,
  paymentMethod: 'cash',
  paid: 60000,
  change: 2400,
});
ok(r1.items[0].total === 44000 && r1.items[0].discount === 4400 && r1.items[1].discount === 0, 'C1 lines carry gross and their own discount');
ok(r1.kitchenItems.length === 1 && r1.barItems.length === 1 && adds(r1), 'C2 stations split, subtotal - discount = total');

// Reprint from the shift history
const r2 = receiptFromBill(bill(55800), [billItem('kopi', 22000, 2), billItem('roti', 18000, 1, 0, 'kitchen')], null);
ok(r2.subtotal === 62000 && r2.discount === 6200 && r2.total === 55800 && adds(r2), 'B1 bill discount = gross - total');
ok(r2.paid === 55800 && r2.change === 0 && r2.isPaid === true && r2.customer.table === '4', 'B2 a paid bill prints as paid, change 0');
const r3 = receiptFromBill(bill(40000, 'held'), [billItem('kopi', 20000, 2)], null);
ok(r3.discount === 0 && r3.subtotal === 40000 && r3.paid === 0 && r3.isPaid === false, 'B3 no discount: subtotal = total; a held bill is unpaid');
ok(receiptFromBill(bill(0), [], null).subtotal === 0, 'B4 empty bill');

// The server charged a different total than the till showed (price changed after the menu loaded)
const till = { ...r1, total: 63600 }; // server total after coffee went up to 25,000
const r4 = withServerLines(till, [billItem('kopi', 25000, 2, 5000), billItem('roti', 18000, 1, 0, 'kitchen')]);
ok(r4.subtotal === 68000 && r4.discount === 4400 && adds(r4), 'S1 server lines: subtotal and discount follow the server total');
ok(
  r4.items[0].total === 50000 && r4.paid === till.paid && r4.change === till.change && r4.number === 'N1',
  'S2 server prices on the lines; payment and number kept',
);
const r5 = withServerLines({ ...r1, total: 70000 }, [billItem('kopi', 26000, 2), billItem('roti', 18000, 1)]);
ok(r5.discount === 0 && r5.subtotal === 70000, 'S3 gross equal to the total: no discount row');

// Outlet address, header, and footer (migrations 047, 048): they come from the outlet; the owner's switches can hide them.
const biz = { showAddress: true, showHeader: true, showFooter: true };
const own = { outletAddress: ' Jl. Braga 12 ', outletHeader: 'Cabang Braga', outletFooter: 'IG @braga' };
const t1 = receiptTexts(biz, own);
ok(t1.address === 'Jl. Braga 12' && t1.header[0] === 'Cabang Braga' && t1.footer[0] === 'IG @braga', 'X1 outlet text shows, trimmed');
const t2 = receiptTexts(biz, { outletAddress: null, outletHeader: '  ', outletFooter: '' });
ok(t2.address === null && t2.header.length === 0 && t2.footer.length === 0, 'X2 empty outlet text: nothing printed (the footer line falls back to Terima kasih)');
const t3 = receiptTexts({ showAddress: false, showHeader: false, showFooter: false }, own);
ok(t3.address === null && t3.header.length === 0 && t3.footer.length === 0, 'X3 the owner switches hide address, header, and footer');
const t4 = receiptTexts(biz, {});
ok(t4.address === null && t4.header.length === 0 && t4.footer.length === 0, 'X4 an outlet without any text (older data) prints none');
const sess = { cashierName: 'A', outletName: 'Cabang', outletAddress: 'Jl. X', outletReceiptHeader: 'H', outletReceiptFooter: 'F' };
const rc = receiptFromCart({ number: 'n', session: sess, items: [], customer: {}, gross: 0, discount: 0, total: 0, paid: 0, change: 0 });
ok(rc.outletAddress === 'Jl. X' && rc.outletHeader === 'H' && rc.outletFooter === 'F', 'X5 a new bill carries the outlet address and text');
ok(receiptFromBill({ number: 'n', createdAt: '2026-10-15', total: 0, status: 'completed' }, [], sess).outletAddress === 'Jl. X', 'X6 a reprint carries them too');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

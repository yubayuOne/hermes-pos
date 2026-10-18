// Tests src/utils/refund.ts: the refund estimate MUST match refund_items_approved (migration 033).
// Run from apps/pos-mobile: node tests/refund_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'refund.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(
  mod,
  mod.exports,
  () => ({}),
);
const { estimateRefund } = mod.exports;
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const item = (id, price, qty, discount = 0, refundedQty = 0) => ({
  itemId: id,
  productId: 'p' + id,
  productName: id,
  station: 'bar',
  quantity: qty,
  unitPrice: price,
  subtotal: price * qty,
  discount,
  refundedQty,
});
const pick = (o) => Object.fromEntries(Object.entries(o).map(([k, q]) => [k, { qty: q, restock: false }]));

// Coffee 2 x 22,000, bread 1 x 18,000, bill discount 10%: net 62,000, total 55,800.
const bill = { total: 55800, refundedTotal: 0 };
const items = [item('kopi', 22000, 2), item('roti', 18000, 1)];
ok(estimateRefund(bill, items, {}) === 0, 'R1 no item picked = 0');
ok(estimateRefund(bill, items, pick({ kopi: 1 })) === 19800, 'R2 1 coffee gets its share of the bill discount: 22,000 x 0.9 = 19,800');
ok(estimateRefund(bill, items, pick({ roti: 1 })) === 16200, 'R3 bread 18,000 x 0.9 = 16,200');
ok(estimateRefund(bill, items, pick({ kopi: 2, roti: 1 })) === 55800, 'R4 all items = exact total');
// After 1 coffee was refunded (19,800), the remaining coffee + bread must use up exactly what remains.
const after = [item('kopi', 22000, 2, 0, 1), item('roti', 18000, 1)];
ok(estimateRefund({ total: 55800, refundedTotal: 19800 }, after, pick({ kopi: 1, roti: 1 })) === 36000, 'R5 last refund = remaining 36,000');
// Rounding: total 10,000 split over 3 equal items; the first two refunds are rounded, the last takes the remainder.
const three = [item('a', 3500, 1), item('b', 3500, 1), item('c', 3500, 1)];
const b3 = { total: 10000, refundedTotal: 0 };
const a = estimateRefund(b3, three, pick({ a: 1 }));
const b = estimateRefund({ total: 10000, refundedTotal: a }, [item('a', 3500, 1, 0, 1), item('b', 3500, 1), item('c', 3500, 1)], pick({ b: 1 }));
const c = estimateRefund({ total: 10000, refundedTotal: a + b }, [item('a', 3500, 1, 0, 1), item('b', 3500, 1, 0, 1), item('c', 3500, 1)], pick({ c: 1 }));
ok(a === 3333 && b === 3333 && c === 3334 && a + b + c === 10000, 'R6 three refunds 3,333 + 3,333 + 3,334 = 10,000');
// Item discount applies: coffee 22,000 with 2,000 off, no bill discount.
ok(
  estimateRefund({ total: 38000, refundedTotal: 0 }, [item('kopi', 22000, 1, 2000), item('roti', 18000, 1)], pick({ kopi: 1 })) === 20000,
  'R7 item discount deducted',
);
// A free item (100% discount) adds nothing.
ok(estimateRefund({ total: 18000, refundedTotal: 0 }, [item('kopi', 22000, 1, 22000), item('roti', 18000, 1)], pick({ kopi: 1 })) === 0, 'R8 free item = 0');

// Brute force against the server formula in exact arithmetic: round(net * qty / quantity * total / netSum), half away from zero.
const exact = (net, q, quantity, total, netSum) => {
  const n = BigInt(net) * BigInt(q) * BigInt(total),
    d = BigInt(quantity) * BigInt(netSum);
  return Number((2n * n + d) / (2n * d));
};
let bad = 0,
  checked = 0,
  example = '';
for (let p1 = 1000; p1 <= 60000; p1 += 1700)
  for (const p2 of [999, 4500, 12345, 18000])
    for (const qty of [2, 3, 7])
      for (const pct of [3, 7.5, 10, 12.5, 33.33]) {
        const net = p1 * qty + p2;
        const total = net - Math.round((net * Math.round(pct * 100)) / 10000);
        for (let q = 1; q < qty; q++) {
          const got = estimateRefund({ total, refundedTotal: 0 }, [item('a', p1, qty), item('b', p2, 1)], pick({ a: q }));
          const want = exact(p1 * qty, q, qty, total, net);
          checked++;
          if (got !== want && !bad++) example = `price ${p1} x ${qty}, refund ${q}, total ${total}: got ${got}, server ${want}`;
        }
      }
// Exactly half: 11 * 5 / 6 * 27 / 33 = 7.5 -> server 8. Floating point lands just under .5 and gave 7.
ok(estimateRefund({ total: 27, refundedTotal: 0 }, [item('a', 2, 6, 1), item('b', 22, 1)], pick({ a: 5 })) === 8, 'R10 an exact .5 rounds up like the server');
ok(bad === 0, `R9 brute force: ${checked} partial refunds match the server rounding exactly${bad ? ` (${bad} off, e.g. ${example})` : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

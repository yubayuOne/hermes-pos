// Tests per-item notes (src/utils/note.ts) and how notes print on receipts. Run from apps/pos-mobile: node tests/note_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const compile = (rel) => {
  const out = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, (id) =>
    id.endsWith('/i18n')
      ? { t: (k, v) => (k.includes('|') ? k.slice(0, k.indexOf('|')) : k).replace(/\{(\w+)\}/g, (x, n) => (v && v[n] !== undefined ? String(v[n]) : x)) }
      : {},
  );
  return m.exports;
};
const N = compile('src/utils/note.ts'),
  E = compile('src/services/printer/escpos.ts');
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
ok(N.cleanNote('  tanpa   es \n gula ') === 'tanpa es gula', 'spaces and newlines collapsed');
ok(N.cleanNote(null) === '' && N.cleanNote(undefined) === '' && N.cleanNote('   ') === '', 'empty / spaces / null -> empty string');
ok(N.cleanNote('x'.repeat(300)).length === N.NOTE_MAX && N.NOTE_MAX === 200, 'cut at 200 characters (same as the database)');
ok(
  JSON.stringify(N.notePayload('  pedas ')) === '{"note":"pedas"}' &&
    JSON.stringify(N.notePayload('  ')) === '{}' &&
    JSON.stringify(N.notePayload(null)) === '{}',
  'RPC payload carries note only when present',
);
const base = {
  number: 'N1',
  date: 'd',
  cashier: 'k',
  outlet: 'O',
  customer: {},
  kitchenItems: [],
  barItems: [],
  subtotal: 20000,
  total: 20000,
  paymentMethod: 'cash',
  paid: 20000,
  change: 0,
};
const items = [
  { name: 'Kopi', quantity: 2, total: 20000, note: 'tanpa gula', station: 'bar' },
  { name: 'Roti', quantity: 1, total: 5000, station: 'kitchen' },
];
for (const kind of ['customer', 'kitchen', 'bar']) {
  const t = E.buildReceiptText({ ...base, items, printKind: kind });
  ok(t.includes('  * tanpa gula') && t.split('* ').length === 2, `${kind} bill: note printed under the item, items without a note stay clean`);
}
// 58 mm = 32 characters, 80 mm = 48: no printed line may be wider than the paper (PRD D3).
const longItems = [
  {
    name: 'Es kopi susu gula aren dengan tambahan espresso dobel',
    quantity: 12,
    total: 1234567,
    discount: 23456,
    note: 'tanpa es, gula setengah, pakai sedotan kertas',
    station: 'bar',
  },
];
for (const w of [32, 48]) {
  const txt = E.buildReceiptText(
    {
      ...base,
      outlet: 'Kopi Pojok Cabang Jalan Panjang Sekali',
      items: longItems,
      subtotal: 1234567,
      discount: 23456,
      total: 1211111,
      paid: 1300000,
      change: 88889,
    },
    w,
  );
  const widest = Math.max(...txt.split('\n').map((l) => l.length));
  ok(widest <= w, `${w}-char receipt: widest line ${widest}`);
  ok(/TOTAL\s+Rp1\.211\.111$/m.test(txt), `${w}-char receipt: total right-aligned`);
}
// Refund slip (migration 033): only the refunded quantities, total from the server, method, reason; no payment lines.
for (const w of [32, 48]) {
  const txt = E.buildReceiptText(
    {
      ...base,
      items: [{ name: 'Kopi', quantity: 1, total: 0, station: 'bar' }],
      printKind: 'refund',
      refund: { amount: 19800, method: 'cash', reason: 'menu salah, kopi terlalu manis untuk pelanggan' },
    },
    w,
  );
  ok(
    txt.includes('STRUK REFUND') && /TOTAL REFUND\s+Rp19\.800$/m.test(txt) && /Dikembalikan\s+Tunai$/m.test(txt),
    `refund ${w}: title, right-aligned total, method`,
  );
  ok(
    txt.includes('Alasan: menu salah') && !txt.includes('Kembalian') && txt.split('\n').every((l) => l.length <= w),
    `refund ${w}: reason printed, no change line, fits the paper`,
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

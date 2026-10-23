// Tests src/utils/shiftReport.ts: the printed shift report and the WhatsApp message show the server's numbers, every
// refund with its reason, every expense, and the cash. Run from apps/pos-mobile: node tests/shift_report_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const compile = (rel, req) => {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(
    mod,
    mod.exports,
    req,
  );
  return mod.exports;
};
const group = (n) =>
  Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const i18n = {
  t: (k, v) => k.replace(/\{(\w+)\}/g, (m, x) => (v && v[x] !== undefined ? String(v[x]) : m)),
  money: (n) => `${n < 0 ? '-' : ''}Rp${group(n)}`,
  num: (n) => `${n < 0 ? '-' : ''}${group(n)}`,
  fmtTime: (v) => new Date(v).toISOString().slice(11, 16).replace(':', '.'),
  fmtDay: (v) => new Date(v).toISOString().slice(0, 10),
};
const escpos = compile('src/services/printer/escpos.ts', () => i18n);
const { reportText, waText } = compile('src/utils/shiftReport.ts', (id) => (id.endsWith('/escpos') ? escpos : i18n));
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};

const report = {
  totalRevenue: 44000,
  cashRevenue: 44000,
  qrisRevenue: 0,
  pettyCash: 100000,
  expectedCash: 89000,
  actualCash: 89000,
  variance: 0,
  totalItems: 3,
  totalTransactions: 2,
  grossSales: 66000,
  discountTotal: 0,
  voidedCount: 0,
  voidedTotal: 0,
  refundCount: 1,
  refundTotal: 22000,
  refundCash: 22000,
  refundQris: 0,
  categories: [{ categoryId: 'c', name: 'Minuman', qty: 3, total: 66000, products: [{ productId: 'p', name: 'Kopi susu', qty: 3, total: 66000 }] }],
};
const d = {
  shiftNumber: 2,
  cashierName: 'Tia',
  outletName: 'Warung Tia',
  openedAt: '2026-10-15T01:00:00Z',
  closedAt: '2026-10-15T09:30:00Z',
  report,
  refunds: [
    {
      id: 'r',
      createdAt: '2026-10-15T03:00:00Z',
      number: '#HPOS-20261015-00002',
      method: 'cash',
      amount: 22000,
      reason: 'Salah pesan',
      cashierName: 'Tia',
      items: [{ productName: 'Kopi susu', quantity: 1, amount: 22000 }],
    },
  ],
  expense: {
    id: 'e',
    createdAt: '2026-10-15T02:00:00Z',
    total: 35000,
    drawerTotal: 30000,
    items: [
      { name: 'Gula pasir', category: 'belanja', quantity: 1.5, unit: 'kg', amount: 30000, paidFrom: 'drawer' },
      { name: 'Es batu', category: 'belanja', quantity: 1, unit: 'pack', amount: 5000, paidFrom: 'other' },
    ],
  },
};

const p = reportText(d, 32).split('\n');
ok(
  p.every((l) => l.length <= 32),
  'P1 every printed line fits 32 columns',
);
ok(p[0] === 'LAPORAN SHIFT 2' && p.some((l) => /^Jam\s+01\.00 - 09\.30$/.test(l)), 'P2 title, shift hours');
ok(
  p.includes('  Alasan: Salah pesan') && p.some((l) => /^  1x Kopi susu\s+-22\.000$/.test(l)) && p.some((l) => /#HPOS-20261015-00002\s+-22\.000$/.test(l)),
  'P3 refund line, each item with its amount, reason',
);
ok(
  p.includes('  Metode: Tunai') && p.some((l) => /^Refund tunai\s+-Rp22\.000$/.test(l)) && !p.some((l) => l.startsWith('Refund QRIS')),
  'P7 refund method, cash and QRIS refund totals',
);
const p48 = reportText(d, 48).split('\n');
ok(
  p48.some((l) => /^Gula pasir 1,5 kg\s+30\.000$/.test(l)) &&
    p48.some((l) => /^Es batu 1 pack \(bukan laci\)\s+5\.000$/.test(l)) &&
    p.some((l) => /^Total pengeluaran\s+Rp35\.000$/.test(l)),
  'P4 expenses with decimal quantity, source, and total',
);
ok(p.some((l) => /^Kas seharusnya\s+Rp89\.000$/.test(l)) && p.some((l) => /^Selisih\s+Rp0$/.test(l)), 'P5 cash from the server, variance 0 printed');

const open = reportText(
  { ...d, closedAt: null, refunds: [], expense: null, report: { ...report, actualCash: null, variance: null, refundCount: 0 } },
  32,
).split('\n');
ok(
  open.some((l) => /^Jam\s+01\.00 - berjalan$/.test(l)) &&
    !open.includes('REFUND') &&
    !open.includes('PENGELUARAN') &&
    !open.some((l) => l.startsWith('Selisih')),
  'P6 open shift: no refund, expense, or count sections',
);

const wa = waText(d);
ok(wa.startsWith('*LAPORAN SHIFT 2*\nWarung Tia · Tia\n2026-10-15 · 01.00 - 09.30'), 'W1 header: bold title, outlet, cashier, date, hours');
ok(wa.includes('*Ringkasan penjualan*\nTotal omset: Rp44.000\nJumlah bill: 2'), 'W2 sales summary');
ok(wa.includes('*Metode pembayaran*\nTunai: Rp44.000\nQRIS: Rp0\nRefund tunai: -Rp22.000'), 'W3 payment methods with refunds per method');
ok(
  wa.includes('*Refund (1)*\n1. #HPOS-20261015-00002, -Rp22.000 (Tunai)\n   1x Kopi susu: -Rp22.000\n   Alasan: Salah pesan'),
  'W4 refunds with item amounts and reason',
);
ok(wa.includes('*Menu terjual (3 item)*\nMinuman\n- 3x Kopi susu: Rp66.000'), 'W9 menu sold per category');
const oldRefund = { ...d.refunds[0], items: [{ productName: 'Kopi susu', quantity: 1 }] };
ok(waText({ ...d, refunds: [oldRefund] }).includes('   1x Kopi susu\n'), 'W10 a refund saved before amounts were kept still prints its items');
ok(
  wa.includes('*Pengeluaran*\n1. Gula pasir 1,5 kg: Rp30.000\n2. Es batu 1 pack: Rp5.000 (bukan dari laci)\nTotal pengeluaran: Rp35.000'),
  'W5 expenses with source and total',
);
ok(wa.endsWith('*Kas*\nKas awal: Rp100.000\nKas seharusnya: Rp89.000\nHitungan kasir: Rp89.000\nSelisih: Rp0'), 'W6 cash at the end');
const waEmpty = waText({ ...d, refunds: [], expense: null });
ok(waEmpty.includes('*Refund (0)*\nTidak ada refund.') && waEmpty.includes('*Pengeluaran*\nTidak ada pengeluaran.'), 'W7 empty sections say so');
ok(!wa.includes('—'), 'W8 no em dash');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

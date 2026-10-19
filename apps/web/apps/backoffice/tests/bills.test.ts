import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billCorrectionSchema, billListSchema, billVoidSchema, cashMovementSchema, expenseAddSchema, expenseCancelSchema } from '../src/lib/schemas.ts';

const other = '00000000-0000-4000-8000-000000000002';

const id = '00000000-0000-4000-8000-000000000001';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

test('void needs a reason of 3 to 200 characters', () => {
  assert.equal(first(billVoidSchema.safeParse({ id, reason: '  ab ' })), 'Tulis alasan pembatalan, minimal 3 huruf.');
  assert.equal(first(billVoidSchema.safeParse({ id, reason: 'x'.repeat(201) })), 'Maksimal 200 karakter.');
  assert.ok(billVoidSchema.safeParse({ id, reason: 'Pesanan dobel' }).success);
});

test('list: only known statuses, a sane page, at most 366 days', () => {
  const base = { outletId: null, from: '2026-10-01', to: '2026-10-18', tz: 'Asia/Jakarta', status: 'completed', q: '', page: 1 };
  assert.ok(billListSchema.safeParse(base).success);
  assert.ok(!billListSchema.safeParse({ ...base, status: 'held' }).success);
  assert.ok(!billListSchema.safeParse({ ...base, page: 0 }).success);
  assert.equal(first(billListSchema.safeParse({ ...base, from: '2024-01-01' })), 'Rentang maksimal 366 hari.');
});

test('correction: lines by itemId or productId, whole numbers, cash or QRIS, a reason (migration 073)', () => {
  const base = {
    id,
    items: [
      { itemId: other, quantity: 1 },
      { productId: id, quantity: 2 },
    ],
    paymentMethod: 'qris',
    customerName: ' Ani ',
    tableNumber: 'A3',
    reason: ' Salah input ',
  };
  const r = billCorrectionSchema.safeParse(base);
  assert.ok(r.success);
  assert.equal(r.data.reason, 'Salah input');
  assert.equal(r.data.customerName, 'Ani');
  const bad = (patch: object) => first(billCorrectionSchema.safeParse({ ...base, ...patch }));
  assert.equal(bad({ items: [{ itemId: other, quantity: 1.5 }] }), 'Jumlah tanpa koma.');
  assert.equal(bad({ items: [{ itemId: other, quantity: 0 }] }), 'Bill harus berisi minimal satu item.');
  assert.equal(bad({ items: [{ itemId: other, productId: id, quantity: 1 }] }), 'Data tidak valid.');
  assert.equal(bad({ reason: 'ok' }), 'Tulis alasan, minimal 3 huruf.');
  assert.equal(bad({ tableNumber: '1234567' }), 'Nomor meja maksimal 6 karakter.');
  assert.ok(!billCorrectionSchema.safeParse({ ...base, paymentMethod: 'card' }).success);
  assert.ok(!billCorrectionSchema.safeParse({ ...base, items: [{ itemId: "' OR 1=1--", quantity: 1 }] }).success);
});

test('cash in or out: a positive whole amount and a reason', () => {
  const base = { shiftId: id, direction: 'out', amount: 20000, reason: 'Diambil pemilik' };
  assert.ok(cashMovementSchema.safeParse(base).success);
  assert.equal(first(cashMovementSchema.safeParse({ ...base, amount: 0 })), 'Nominal harus lebih dari Rp0.');
  assert.equal(first(cashMovementSchema.safeParse({ ...base, amount: -500 })), 'Nominal harus lebih dari Rp0.');
  assert.equal(first(cashMovementSchema.safeParse({ ...base, amount: 100.5 })), 'Nominal tanpa koma.');
  assert.equal(first(cashMovementSchema.safeParse({ ...base, amount: 1_000_000_001 })), 'Nominal maksimal Rp1.000.000.000.');
  assert.equal(first(cashMovementSchema.safeParse({ ...base, amount: Number.NaN })), 'Isi nominal.');
  assert.ok(!cashMovementSchema.safeParse({ ...base, direction: 'keluar' }).success);
});

test('expenses: items like the POS, a reason to cancel', () => {
  const item = { name: ' Gula ', category: 'belanja', quantity: 1.5, unit: 'kg', amount: 36000 };
  const r = expenseAddSchema.safeParse({ shiftId: id, paidFrom: 'drawer', items: [item] });
  assert.ok(r.success);
  assert.equal(r.data.items[0].name, 'Gula');
  const bad = (patch: object) => first(expenseAddSchema.safeParse({ shiftId: id, paidFrom: 'drawer', items: [{ ...item, ...patch }] }));
  assert.equal(bad({ unit: 'ton' }), 'Pilih satuan.');
  assert.equal(bad({ amount: 0 }), 'Harga total harus lebih dari Rp0.');
  assert.equal(bad({ quantity: 1.2345 }), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(expenseAddSchema.safeParse({ shiftId: id, paidFrom: 'drawer', items: [] })), 'Isi minimal satu barang.');
  assert.equal(first(expenseAddSchema.safeParse({ shiftId: id, paidFrom: 'bank', items: [item] })), 'Pilih sumber uang.');
  assert.equal(first(expenseCancelSchema.safeParse({ itemId: id, reason: ' x ' })), 'Tulis alasan, minimal 3 huruf.');
  assert.ok(expenseCancelSchema.safeParse({ itemId: id, reason: 'Dicatat dua kali' }).success);
});

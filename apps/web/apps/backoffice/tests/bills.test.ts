import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billDetailsSchema, billItemsSchema, billListSchema, billPaymentSchema, billVoidSchema } from '../src/lib/schemas.ts';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

test('item edits: existing lines and new products, whole numbers 0 to 9999', () => {
  assert.ok(
    billItemsSchema.safeParse({
      id,
      reason: 'Salah input',
      items: [
        { itemId: other, quantity: 0 },
        { productId: id, quantity: 2 },
      ],
    }).success,
  );
  const bad = (quantity: number) => first(billItemsSchema.safeParse({ id, reason: 'Salah input', items: [{ itemId: other, quantity }] }));
  assert.equal(bad(1.5), 'Jumlah tanpa koma.');
  assert.equal(bad(-1), 'Jumlah tidak boleh minus.');
  assert.equal(bad(10000), 'Jumlah maksimal 9.999.');
  assert.equal(bad(Number.NaN), 'Jumlah harus angka.');
  assert.equal(bad(0), 'Bill harus berisi minimal satu item.');
  assert.equal(first(billItemsSchema.safeParse({ id, reason: 'Salah input', items: [] })), 'Bill harus berisi minimal satu item.');
  assert.ok(!billItemsSchema.safeParse({ id, reason: 'Salah input', items: [{ itemId: "' OR 1=1--", quantity: 1 }] }).success);
});

test('details: same limits as the POS, trimmed', () => {
  const r = billDetailsSchema.safeParse({ id, customerName: '  Ani ', tableNumber: ' A3 ', notes: { [other]: ' manis ' } });
  assert.ok(r.success);
  assert.equal(r.data.customerName, 'Ani');
  assert.equal(r.data.notes[other], 'manis');
  assert.equal(first(billDetailsSchema.safeParse({ id, customerName: '', tableNumber: '1234567', notes: {} })), 'Nomor meja maksimal 6 karakter.');
  assert.equal(first(billDetailsSchema.safeParse({ id, customerName: 'x'.repeat(41), tableNumber: '', notes: {} })), 'Nama pelanggan maksimal 40 karakter.');
  assert.ok(!billDetailsSchema.safeParse({ id, customerName: '', tableNumber: '', notes: { 'not-an-id': 'x' } }).success);
});

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

test('item and payment changes need a reason (migration 067)', () => {
  const items = [{ itemId: other, quantity: 1 }];
  assert.equal(first(billItemsSchema.safeParse({ id, items, reason: ' x ' })), 'Tulis alasan perubahan, minimal 3 huruf.');
  assert.equal(first(billPaymentSchema.safeParse({ id, method: 'qris', reason: '' })), 'Tulis alasan perubahan, minimal 3 huruf.');
  assert.equal(first(billPaymentSchema.safeParse({ id, method: 'qris', reason: 'x'.repeat(201) })), 'Maksimal 200 karakter.');
  assert.ok(billPaymentSchema.safeParse({ id, method: 'cash', reason: 'Salah tekan' }).success);
  assert.ok(!billPaymentSchema.safeParse({ id, method: 'card', reason: 'Salah tekan' }).success);
});

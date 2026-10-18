import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseUpdateSchema } from '../src/lib/schemas.ts';

const id = '00000000-0000-4000-8000-000000000001';
const item = { name: 'Gula pasir', category: 'belanja', quantity: 1.5, unit: 'kg', amount: 36000, paidFrom: 'drawer' };
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

test('edited items pass; names are trimmed', () => {
  const r = expenseUpdateSchema.safeParse({ id, items: [{ ...item, name: '  Gula  ' }] });
  assert.ok(r.success);
  assert.equal(r.data.items[0].name, 'Gula');
});

test('item limits match migration 040', () => {
  const bad = (patch: object) => first(expenseUpdateSchema.safeParse({ id, items: [{ ...item, ...patch }] }));
  assert.equal(bad({ unit: 'ton' }), 'Pilih satuan.');
  assert.equal(bad({ amount: 0 }), 'Harga total harus lebih dari Rp0.');
  assert.equal(bad({ amount: 1000.5 }), 'Harga total tanpa koma.');
  assert.equal(bad({ quantity: 1.2345 }), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(bad({ quantity: 0 }), 'Jumlah harus lebih dari 0.');
  assert.equal(bad({ name: ' ' }), 'Tulis nama barang atau biaya.');
  assert.equal(bad({ category: 'lain' }), 'Pilih kategori.');
  assert.equal(bad({ paidFrom: 'bank' }), 'Pilih sumber uang.');
  assert.ok(expenseUpdateSchema.safeParse({ id, items: [{ ...item, quantity: 0.125 }] }).success);
});

test('at least one item', () => {
  assert.equal(first(expenseUpdateSchema.safeParse({ id, items: [] })), 'Isi minimal satu barang.');
});

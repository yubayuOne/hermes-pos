import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseStockSchema } from '../src/lib/schemas.ts';

const itemId = '00000000-0000-4000-8000-000000000101';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const stock = (qty: number | null) => expenseStockSchema.safeParse({ itemId, qty });

test('the amount that came into stock: a positive amount with up to 3 decimals, or null to wait again', () => {
  assert.ok(stock(1050).success);
  assert.ok(stock(0.5).success);
  assert.ok(stock(null).success);
  assert.equal(first(stock(0)), 'Jumlah masuk stok harus lebih dari 0.');
  assert.equal(first(stock(1.2345)), 'Jumlah masuk stok maksimal 3 angka di belakang koma.');
  assert.equal(first(stock(1_000_000)), 'Jumlah masuk stok terlalu besar.');
});

test('the texts of the stock amount are translated', async () => {
  const { EN } = await import('../src/dict.ts');
  const texts = ['Jumlah masuk stok', 'Simpan jumlah', 'Isi jumlah masuk stok', 'Ubah jumlah masuk stok', 'Stok {name} dicatat.', 'belum masuk stok', 'masuk stok {qty}'];
  assert.deepEqual(texts.filter((k) => !(k in EN)), []);
});

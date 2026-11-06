import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseAddSchema, expenseItemSchema } from '../src/lib/schemas.ts';

const shiftId = '00000000-0000-4000-8000-000000000001';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const item = (over: Record<string, unknown> = {}) => ({ name: 'Gula', category: 'belanja', quantity: 1, unit: 'kg', amount: 30000, ...over });
const one = (over: Record<string, unknown> = {}) => expenseItemSchema.safeParse(item(over));
const add = (over: Record<string, unknown> = {}) => expenseAddSchema.safeParse({ shiftId, paidFrom: 'drawer', items: [item()], ...over });

test('owner expense items: the money comes from the drawer or not (migration 087)', () => {
  assert.ok(add().success);
  assert.ok(add({ paidFrom: 'other' }).success);
  assert.equal(first(add({ paidFrom: undefined })), 'Pilih sumber uang.');
  assert.equal(first(add({ paidFrom: 'lain' })), 'Pilih sumber uang.');
  assert.equal(first(add({ items: [] })), 'Isi minimal satu barang.');
  assert.equal(first(add({ items: Array.from({ length: 31 }, () => item()) })), 'Maksimal 30 barang sekali simpan.');
});

test('an item: a category of the owner list, and optionally a barang with the amount that came into its stock (099)', () => {
  assert.ok(one({ category: 'Listrik' }).success);
  assert.ok(one({ ingredientId: '00000000-0000-4000-8000-000000000201', stockQty: 1050 }).success);
  assert.ok(one({ ingredientId: null, stockQty: null }).success);
  assert.ok(add({ items: [item({ category: '' })] }).success); // no category is allowed (100)
  assert.equal(first(one({ stockQty: 0 })), 'Jumlah masuk stok harus lebih dari 0.');
});

test('the texts of the drawer choice are translated', async () => {
  const { EN } = await import('../src/dict.ts');
  const texts = [
    'Uang dari',
    'Kas laci',
    'Bukan dari laci',
    'Pilih sumber uang.',
    'Kalau dibayar dari laci, kas seharusnya shift itu berkurang dan selisihnya dihitung ulang.',
  ];
  assert.deepEqual(texts.filter((k) => !(k in EN)), []);
});

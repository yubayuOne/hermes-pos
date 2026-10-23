import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkExpenseItemsSchema } from '../src/lib/schemas.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const line = (n: number, over: Record<string, unknown> = {}) => ({ expenseItemId: id(100 + n), ingredientId: id(200 + n), packs: 2, ...over });
const link = (lines: unknown) => linkExpenseItemsSchema.safeParse({ outletId, lines });

test('link expense items: one valid line passes, bad ones are refused with the stock messages', () => {
  assert.ok(link([line(1)]).success);
  assert.ok(link([line(1, { packs: 0.5 }), line(2, { packs: 999999 })]).success);
  assert.equal(first(link([])), 'Isi minimal satu bahan.');
  assert.equal(first(link([line(1, { ingredientId: '' })])), 'Data tidak valid.');
  assert.equal(first(link([line(1, { packs: 0 })])), 'Jumlah harus lebih dari 0.');
  assert.equal(first(link([line(1, { packs: 1.2345 })])), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(link([line(1, { packs: 1_000_000 })])), 'Jumlah terlalu besar.');
  assert.equal(first(link([line(1), line(1, { ingredientId: id(299) })])), 'Satu barang hanya boleh sekali.');
  assert.equal(first(link([line(1), line(2, { ingredientId: id(201) })])), 'Satu bahan hanya boleh sekali.');
  assert.equal(first(link(Array.from({ length: 51 }, (_, n) => line(n)))), 'Maksimal 50 bahan.');
});

test('the texts of the stock link are translated', async () => {
  const { EN } = await import('../src/dict.ts');
  const texts = ['Masuk stok', 'Sudah masuk stok', 'Satu barang hanya boleh sekali.', 'Maksimal 50 bahan.', 'Belanja masuk stok.'];
  assert.deepEqual(texts.filter((k) => !(k in EN)), []);
});

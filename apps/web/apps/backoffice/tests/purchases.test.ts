import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSchema, ingredientSchema, purchaseCancelSchema, purchaseListSchema, purchaseSchema } from '../src/lib/schemas.ts';
import { stockText } from '../src/lib/units.ts';
import { pairFromTotal, pairFromUnit, parseRupiah } from '../src/lib/purchase.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const i1 = '00000000-0000-4000-8000-000000000002';
const i2 = '00000000-0000-4000-8000-000000000003';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const buy = (lines: unknown, over: Record<string, unknown> = {}) => purchaseSchema.safeParse({ outletId, boughtOn: '2026-10-23', lines, ...over });
const bl = (ingredientId: string, packs: number, total: number) => ({ ingredientId, packs, total });
const count = (lines: unknown) => countSchema.safeParse({ outletId, lines });
const cl = (ingredientId: string, qty: number, unit = 'g') => ({ ingredientId, qty, unit });
const ids = (n: number) => Array.from({ length: n }, (_, k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`);

test('purchase: a valid note, SKM 2 packs for 36000', () => {
  assert.ok(buy([bl(i1, 2, 36000)]).success);
  assert.ok(buy([bl(i1, 0.5, 0), bl(i2, 999999.999, 1_000_000_000)]).success);
  assert.ok(buy(ids(50).map((id) => bl(id, 1, 1000))).success);
});

test('purchase: lines, packs, total, duplicates and date are checked like the database', () => {
  assert.equal(first(buy([])), 'Isi minimal satu bahan.');
  assert.equal(first(buy(ids(51).map((id) => bl(id, 1, 1000)))), 'Belanja maksimal 50 bahan.');
  assert.equal(first(buy([bl(i1, 0, 1000)])), 'Jumlah harus lebih dari 0.');
  assert.equal(first(buy([bl(i1, 1.2345, 1000)])), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(buy([bl(i1, 1_000_000, 1000)])), 'Jumlah terlalu besar.');
  assert.equal(first(buy([bl(i1, Number.NaN, 1000)])), 'Jumlah harus angka.');
  assert.equal(first(buy([bl(i1, 1, -1)])), 'Total bayar harus angka, boleh Rp0.');
  assert.equal(first(buy([bl(i1, 1, Number.NaN)])), 'Total bayar harus angka, boleh Rp0.');
  assert.equal(first(buy([bl(i1, 1, 1_000_000_001)])), 'Total bayar harus angka, boleh Rp0.');
  assert.equal(first(buy([bl(i1, 1, 1000), bl(i1, 2, 2000)])), 'Satu bahan hanya boleh sekali.');
  assert.equal(first(buy([bl(i1, 1, 1000)], { boughtOn: '23-10-2026' })), 'Pilih tanggal.');
  assert.equal(first(buy([bl('x', 1, 1000)])), 'Data tidak valid.');
});

test('purchase cancel and list', () => {
  assert.ok(purchaseCancelSchema.safeParse({ id: i1, reason: 'Salah catat' }).success);
  assert.equal(first(purchaseCancelSchema.safeParse({ id: i1, reason: 'ab' })), 'Tulis alasan, minimal 3 huruf.');
  assert.equal(first(purchaseCancelSchema.safeParse({ id: i1, reason: 'x'.repeat(201) })), 'Maksimal 200 karakter.');
  assert.ok(purchaseListSchema.safeParse({ outletId, page: 1 }).success);
  assert.ok(!purchaseListSchema.safeParse({ outletId, page: 0 }).success);
});

test('count: 0 is a valid count, negatives, 4 decimals and a bad unit are not', () => {
  assert.ok(count([cl(i1, 0), cl(i2, 1.5, 'kg')]).success);
  assert.equal(first(count([])), 'Isi minimal satu bahan.');
  assert.equal(first(count([cl(i1, -1)])), 'Hasil hitung tidak boleh minus.');
  assert.equal(first(count([cl(i1, 1.2345)])), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(count([cl(i1, 1, 'sdm')])), 'Pilih satuan.');
  assert.equal(first(count([cl(i1, 1_000_000)])), 'Jumlah terlalu besar.');
  assert.equal(first(count([cl(i1, 1), cl(i1, 2)])), 'Satu bahan hanya boleh sekali.');
  assert.equal(first(count(ids(201).map((id) => cl(id, 1)))), 'Hitung stok maksimal 200 bahan.');
});

test('ingredient: pack label is optional and at most 20 characters', () => {
  const ing = (packLabel: unknown) => ingredientSchema.safeParse({ outletId, name: 'SKM', price: 18000, packQty: 1, packUnit: 'kg', packLabel });
  assert.ok(ing('').success);
  assert.ok(ing('kaleng').success);
  assert.equal(first(ing('x'.repeat(21))), 'Maksimal 20 karakter.');
});

const NEW_TEXTS = [
  'Isi minimal satu bahan.', 'Belanja maksimal 50 bahan.', 'Hitung stok maksimal 200 bahan.', 'Total bayar harus angka, boleh Rp0.',
  'Satu bahan hanya boleh sekali.', 'Maksimal 20 karakter.', 'Jumlah harus angka.', 'Jumlah maksimal 3 angka di belakang koma.',
  'Jumlah terlalu besar.', 'Jumlah harus lebih dari 0.', 'Hasil hitung tidak boleh minus.', 'Pilih satuan.', 'Pilih tanggal.',
  'Tulis alasan, minimal 3 huruf.', 'Maksimal 200 karakter.', 'Data tidak valid.',
];
test('every message the new schemas can show is translated', async () => {
  const { EN } = await import('../src/dict.ts');
  assert.deepEqual(NEW_TEXTS.filter((k) => !(k in EN)), []);
});

const TASK5_TEXTS = [
  'Hitung stok', 'Stok', 'Harga rata-rata', 'Terakhir dihitung', 'belum pernah', 'Belum dihitung', 'kemasan', 'Nama kemasan (opsional)',
  'Contoh: kaleng, dus, botol.', 'Mengikuti catatan belanja. Catat belanja untuk mengubahnya.',
  'Hitung bahan di rak lalu isi jumlahnya. Kosongkan bahan yang tidak dihitung.', 'Stok sistem {n}',
  'Belum dihitung: ini jadi stok awal', 'Jumlah hitung', 'Satuan hitung', 'Simpan hitungan', 'Hasil hitung stok', 'Selesai',
  'stok awal {n}', 'kurang {n}, {v}', 'lebih {n}, {v}', 'sama dengan stok sistem', '{name} dihitung.',
  'Belum ada bahan untuk dihitung.', 'Isi jumlah minimal satu bahan.',
];
test('every Task 5 text is translated', async () => {
  const { EN } = await import('../src/dict.ts');
  assert.deepEqual(TASK5_TEXTS.filter((k) => !(k in EN)), []);
});

test('stockText: readable stock with the base unit', () => {
  assert.equal(stockText(12000, 'ml'), '12 l');
  assert.equal(stockText(740, 'g'), '740 g');
  assert.equal(stockText(-300, 'ml'), '-300 ml');
  assert.equal(stockText(2.5, 'pcs'), '2,5 pcs');
  assert.equal(stockText(1500, 'g'), '1,5 kg');
  assert.equal(stockText(-2500, 'g'), '-2,5 kg');
  assert.equal(stockText(999, 'g'), '999 g');
  assert.equal(stockText(0, 'ml'), '0 ml');
  assert.equal(stockText(3000, 'pcs'), '3.000 pcs');
  assert.equal(stockText(1500, 'g', 'en'), '1.5 kg');
});

test('purchase: total and price per pack compute each other', () => {
  assert.deepEqual(pairFromTotal(36000, 2), { total: 36000, unit: 18000 });
  assert.deepEqual(pairFromUnit(18000, 2), { total: 36000, unit: 18000 });
  assert.deepEqual(pairFromTotal(100, 3), { total: 100, unit: 33.33 });
  assert.deepEqual(pairFromUnit(33.33, 3), { total: 100, unit: 33.33 });
  assert.deepEqual(pairFromTotal(0, 2), { total: 0, unit: 0 });
  assert.equal(pairFromTotal(100, 0), null);
  assert.equal(pairFromUnit(100, 0), null);
  assert.equal(pairFromTotal(100, Number.NaN), null);
  assert.equal(pairFromTotal(Number.NaN, 2), null);
});

const TASK6_TEXTS = [
  'Catat belanja', 'Tanggal belanja', 'dibatalkan', 'Belum ada belanja.', 'Rincian belanja', 'Harga sebelum', 'Harga sesudah',
  'Total belanja', 'Total bayar (Rp)', 'Harga per {pack} (Rp)', '+ Bahan baru', 'Hapus baris', 'Alasan pembatalan', 'Batalkan belanja',
  'Belanja dicatat.', 'Belanja dibatalkan.', 'Sudah ada belanja setelahnya; batalkan yang terbaru dulu.',
  'Tanggal tidak boleh lebih dari hari ini.', 'Tanggal paling lama 90 hari ke belakang.', 'Jumlah {pack}', 'Pilih bahan',
  'Isi {n} {u} per {pack}', 'Isi tanggal belanja.', 'Membatalkan...', 'Isi bahan di setiap baris.', 'Tutup', 'Belanja', 'Tanggal', 'Lihat',
];
test('every Task 6 text is translated', async () => {
  const { EN } = await import('../src/dict.ts');
  const { UI_EN: UI } = await import('../../../packages/ui/src/dict.ts');
  assert.deepEqual(TASK6_TEXTS.filter((k) => !(k in EN) && !(k in UI)), []);
});

test('parseRupiah: whole rupiah with dots as thousands, decimals only for the unit price', () => {
  assert.equal(parseRupiah('18.000'), 18000);
  assert.equal(parseRupiah('18000'), 18000);
  assert.equal(parseRupiah('1.250.000'), 1250000);
  assert.equal(parseRupiah(''), null);
  assert.equal(parseRupiah('1,5'), null);
  assert.equal(parseRupiah('18,5'), null);
  assert.equal(parseRupiah('12,50', true), 12.5);
  assert.equal(parseRupiah('12.50', true), 12.5);
  assert.equal(parseRupiah('18.000', true), 18000);
  assert.equal(parseRupiah('1.234,5', true), 1234.5);
  assert.equal(parseRupiah('abc', true), null);
});

test('parseRupiah: a dot in whole rupiah must be a real thousands separator', () => {
  for (const bad of ['1.5', '18.5', '1.50', '1000.000', '.5', '1.']) assert.equal(parseRupiah(bad), null, bad);
  assert.equal(parseRupiah('1.000'), 1000);
  assert.equal(parseRupiah('18.000'), 18000);
  assert.equal(parseRupiah('1.000.000'), 1000000);
  assert.equal(parseRupiah('18000'), 18000);
});

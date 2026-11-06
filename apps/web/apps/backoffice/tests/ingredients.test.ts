import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barangSchema, recipeSaveSchema } from '../src/lib/schemas.ts';
import { sameFamilyUnits } from '../src/lib/units.ts';
import { describeError } from '../src/lib/errors.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const i1 = '00000000-0000-4000-8000-000000000002';
const i2 = '00000000-0000-4000-8000-000000000003';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const barang = (over: Record<string, unknown> = {}) => barangSchema.safeParse({ outletId, name: 'Minyak goreng', unit: 'ml', counted: true, ...over });
const recipe = (lines: unknown) => recipeSaveSchema.safeParse({ productId: i1, lines });
const line = (ingredientId: string, qty: number, unit = 'g') => ({ ingredientId, qty, unit });

test('barang: a name, a base unit of g, ml or pcs, and whether its stock is counted; no price is typed', () => {
  assert.ok(barang().success);
  assert.ok(barang({ unit: 'pcs', counted: false, name: 'Listrik' }).success);
  assert.equal(first(barang({ name: '   ' })), 'Nama barang wajib diisi.');
  assert.equal(first(barang({ unit: 'kg' })), 'Pilih satuan: g, ml, atau pcs.');
  assert.equal(first(barang({ counted: undefined })), 'Pilih apakah barang ini dihitung stoknya.');
  assert.equal(first(barang({ name: 'x'.repeat(61) })), 'Maksimal 60 karakter.');
});

test('recipe save: lines are checked like the database does, [] removes the recipe', () => {
  assert.ok(recipe([]).success);
  assert.ok(recipe([line(i1, 18), line(i2, 150, 'ml')]).success);
  assert.equal(first(recipe([line(i1, 0)])), 'Jumlah harus lebih dari 0.');
  assert.equal(first(recipe([line(i1, 1.2345)])), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(recipe([line(i1, 1_000_000)])), 'Jumlah terlalu besar.');
  assert.equal(first(recipe([line(i1, 1, 'sdm')])), 'Pilih satuan.');
  assert.equal(first(recipe([line(i1, 1), line(i1, 2)])), 'Satu bahan hanya boleh sekali di resep.');
  const many = Array.from({ length: 41 }, (_, n) => line(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, 1));
  assert.equal(first(recipe(many)), 'Resep maksimal 40 bahan.');
  assert.equal(first(recipeSaveSchema.safeParse({ productId: 'x', lines: [] })), 'Data tidak valid.');
});

test('units offered for a recipe line stay in the ingredient pack family', () => {
  assert.deepEqual(sameFamilyUnits('kg'), ['g', 'kg']);
  assert.deepEqual(sameFamilyUnits('g'), ['g', 'kg']);
  assert.deepEqual(sameFamilyUnits('l'), ['ml', 'l']);
  assert.deepEqual(sameFamilyUnits('pcs'), ['pcs']);
});

// Every Indonesian text the Bahan page and its dialog show or validate must have an English line (DESIGN.md A8).
const BAHAN_TEXTS = [
  'Barang|menu', 'Barang', 'Tambah barang', 'Ubah barang', 'Simpan barang', 'Hapus barang', 'Hapus {name}?', '{name} dihapus.', 'Menghapus...',
  'Ubah', 'Nama barang', 'Satuan', 'Gram (g)', 'Mililiter (ml)', 'Buah (pcs)', 'Dihitung stoknya?', 'Ya, ada stok dan harga rata-rata',
  'Tidak, hanya dicatat sebagai pengeluaran', 'Tidak bisa diubah setelah barang punya stok.', 'Stok dihitung dalam satuan ini.',
  'Dipakai di', 'belum dipakai', '{n} menu', 'Belum ada barang.', 'tidak dihitung stoknya', 'Hitung stok',
  'Barang bisa berupa bahan, atau biaya seperti listrik dan iuran. Hanya barang yang dihitung stoknya masuk stok dan bisa dipakai di resep.',
  'Nama barang wajib diisi.', 'Pilih satuan: g, ml, atau pcs.', 'Pilih apakah barang ini dihitung stoknya.',
  'Satuan dasar harus g, ml, atau pcs', 'Nama barang sudah dipakai', 'Barang ini dipakai di resep. Hapus dari resep dulu.',
  'Satuan dan penanda stok tidak bisa diubah setelah barang punya catatan stok.', 'Sesi kasir tidak valid',
];
test('the Bahan page texts are translated', async () => {
  const { EN } = await import('../src/dict.ts');
  const missing = BAHAN_TEXTS.filter((k) => !(k in EN));
  assert.deepEqual(missing, []);
});

const RESEP_TEXTS = [
  'HPP (modal per porsi)', 'HPP = harga pokok penjualan, modal untuk satu porsi. Dipakai untuk menghitung laba.', 'dari resep', 'perkiraan',
  'Berubah sendiri kalau harga bahan diubah.', 'Resep per porsi', 'Pilih bahan', '+ Bahan baru', 'Tambah bahan ke resep', 'Jumlah', 'Hapus baris {n}',
  'Untung per porsi', 'Modal {pct}% dari harga jual', 'Menghitung...', 'Bahan {n}', 'Jumlah bahan {n}', 'Satuan bahan {n}',
  'Modal lebih besar dari harga jual. Cek jumlah atau harga bahan.', 'Ada bahan berharga Rp0, angka ini perkiraan.',
  'Resep belum diisi. Tambah minimal satu bahan, atau hapus resep.',
  'Satuan tidak cocok dengan bahan. Pilih satuan dari jenis yang sama: berat, volume, atau pcs.', 'Jumlah bahan tidak valid', 'Resep maksimal 40 bahan', 'Satu bahan hanya boleh sekali di resep', 'Bahan tidak ditemukan di outlet ini',
  // The Resep tab and the recipe page
  'Bagian bahan dan resep', 'Resep', 'Menu', '+ Barang baru', 'Resep|menu', 'Harga jual', 'Belum ada resep', 'Atur resep', 'Buat resep', 'Belum ada menu.',
  'Tambah menu di halaman Produk, lalu atur resepnya di sini.', 'Kembali ke daftar resep', 'Resep {name}', 'Simpan resep', 'Hapus resep',
  'Resep {name} disimpan.', 'Resep {name} dihapus.', 'Hapus resep {name}?', 'HPP terakhir tetap dipakai sebagai HPP ketikan. Ubah di halaman Produk.',
  'Menu tidak ditemukan.', 'HPP dari resep. Ubah lewat tab Resep.', 'Produk tidak ditemukan',
];
test('the recipe editor texts are translated', async () => {
  const { EN } = await import('../src/dict.ts');
  assert.deepEqual(RESEP_TEXTS.filter((k) => !(k in EN)), []);
});

test('database errors with a name inside become fixed sentences, so the English dictionary can translate them', async () => {
  const { EN } = await import('../src/dict.ts');
  const unit = describeError(new Error('Satuan tidak cocok dengan bahan Susu cair'));
  const used = describeError(new Error('Dipakai di resep: Es kopi susu, Es latte. Hapus dari resep itu dulu.'));
  assert.equal(unit, 'Satuan tidak cocok dengan bahan. Pilih satuan dari jenis yang sama: berat, volume, atau pcs.');
  assert.equal(used, 'Bahan ini dipakai di resep. Hapus dari resep itu dulu.');
  assert.ok(unit in EN && used in EN);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientSchema, recipeSaveSchema } from '../src/lib/schemas.ts';
import { sameFamilyUnits } from '../src/lib/units.ts';
import { describeError } from '../src/lib/errors.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const i1 = '00000000-0000-4000-8000-000000000002';
const i2 = '00000000-0000-4000-8000-000000000003';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const ing = (over: Record<string, unknown> = {}) => ingredientSchema.safeParse({ outletId, name: 'Susu cair', price: 18000, packQty: 1, packUnit: 'l', ...over });
const recipe = (lines: unknown) => recipeSaveSchema.safeParse({ productId: i1, lines });
const line = (ingredientId: string, qty: number, unit = 'g') => ({ ingredientId, qty, unit });

test('ingredient: a name, a price that may be Rp 0, a pack size above 0 with up to 3 decimals, one of five units', () => {
  assert.ok(ing().success);
  assert.ok(ing({ price: 0 }).success);
  assert.ok(ing({ packQty: 0.5, packUnit: 'kg' }).success);
  assert.equal(first(ing({ name: '   ' })), 'Nama bahan wajib diisi.');
  assert.equal(first(ing({ price: -1 })), 'Harga beli harus angka, boleh Rp0.');
  assert.equal(first(ing({ price: 1.5 })), 'Harga beli harus angka, boleh Rp0.');
  assert.equal(first(ing({ packQty: 0 })), 'Isi kemasan harus lebih dari 0.');
  assert.equal(first(ing({ packQty: 1.2345 })), 'Isi kemasan maksimal 3 angka di belakang koma.');
  assert.equal(first(ing({ packQty: Number.NaN })), 'Isi kemasan harus angka.');
  assert.equal(first(ing({ packUnit: 'sdm' })), 'Pilih satuan.');
  assert.equal(first(ing({ name: 'x'.repeat(61) })), 'Maksimal 60 karakter.');
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
  'Bahan & Resep|menu', 'Bahan', 'Tambah bahan', 'Ubah bahan', 'Simpan bahan', 'Simpan perubahan', 'Hapus bahan', 'Hapus {name}?', '{name} dihapus.', 'Menghapus...',
  'Ubah', 'Nama bahan', 'Harga beli', 'Harga beli (Rp)', 'Isi kemasan', 'Harga per satuan', 'Dipakai di', 'belum dipakai', '{n} menu',
  'Belum ada bahan.', 'Tambah bahan pertama di sini, atau buat langsung dari resep sebuah menu di tab Resep.',
  'Bahan yang sudah dipakai di resep tidak bisa dihapus.', 'Contoh: susu 1 liter seharga Rp18.000.',
  'Harga satu kemasan, seperti yang Anda bayar ke pemasok.', 'Harga bahan ini dipakai di resep. Cek dulu HPP menu yang ikut berubah.',
  'Menu yang ikut berubah', 'HPP dari {old} menjadi {now}',
  'Nama bahan wajib diisi.', 'Harga beli harus angka, boleh Rp0.', 'Isi kemasan harus angka.', 'Isi kemasan maksimal 3 angka di belakang koma.',
  'Isi kemasan harus lebih dari 0.', 'Isi kemasan terlalu besar.', 'Pilih satuan.', 'Jumlah harus lebih dari 0.',
  'Resep maksimal 40 bahan.', 'Satu bahan hanya boleh sekali di resep.',
  'Nama bahan sudah dipakai', 'Bahan tidak ditemukan', 'Satuan tidak valid', 'Satuan kemasan tidak bisa berganti jenis selama bahan dipakai resep',
  'Isi kemasan harus lebih dari 0', 'Harga tidak boleh negatif',
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
  'Bagian bahan dan resep', 'Resep', 'Menu', 'Harga jual', 'Belum ada resep', 'Atur resep', 'Buat resep', 'Belum ada menu.',
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

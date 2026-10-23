import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientSchema, productSchema } from '../src/lib/schemas.ts';
import { sameFamilyUnits } from '../src/lib/units.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const i1 = '00000000-0000-4000-8000-000000000002';
const i2 = '00000000-0000-4000-8000-000000000003';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const ing = (over: Record<string, unknown> = {}) => ingredientSchema.safeParse({ outletId, name: 'Susu cair', price: 18000, packQty: 1, packUnit: 'l', ...over });
const product = (recipe: unknown) =>
  productSchema.safeParse({ outletId, categoryId: null, name: 'Es kopi susu', price: 22000, hpp: 0, trackStock: false, stock: 0, station: 'bar', recipe });
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

test('recipe on the product form: null leaves it, [] removes it, lines are checked like the database does', () => {
  assert.ok(product(null).success);
  assert.ok(product([]).success);
  assert.ok(product([line(i1, 18), line(i2, 150, 'ml')]).success);
  assert.equal(first(product([line(i1, 0)])), 'Jumlah harus lebih dari 0.');
  assert.equal(first(product([line(i1, 1.2345)])), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(product([line(i1, 1_000_000)])), 'Jumlah terlalu besar.');
  assert.equal(first(product([line(i1, 1, 'sdm')])), 'Pilih satuan.');
  assert.equal(first(product([line(i1, 1), line(i1, 2)])), 'Satu bahan hanya boleh sekali di resep.');
  const many = Array.from({ length: 41 }, (_, n) => line(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, 1));
  assert.equal(first(product(many)), 'Resep maksimal 40 bahan.');
});

test('units offered for a recipe line stay in the ingredient pack family', () => {
  assert.deepEqual(sameFamilyUnits('kg'), ['g', 'kg']);
  assert.deepEqual(sameFamilyUnits('g'), ['g', 'kg']);
  assert.deepEqual(sameFamilyUnits('l'), ['ml', 'l']);
  assert.deepEqual(sameFamilyUnits('pcs'), ['pcs']);
});

// Every Indonesian text the Bahan page and its dialog show or validate must have an English line (DESIGN.md A8).
const BAHAN_TEXTS = [
  'Bahan|menu', 'Bahan', 'Tambah bahan', 'Ubah bahan', 'Simpan bahan', 'Simpan perubahan', 'Hapus bahan', 'Hapus {name}?', '{name} dihapus.', 'Menghapus...',
  'Ubah', 'Nama bahan', 'Harga beli', 'Harga beli (Rp)', 'Isi kemasan', 'Harga per satuan', 'Dipakai di', 'belum dipakai', '{n} menu',
  'Belum ada bahan.', 'Tambah bahan pertama di sini, atau buat langsung dari resep sebuah menu di halaman Produk.',
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
  'Berubah sendiri kalau harga bahan diubah.', 'Hitung dari resep', 'Hapus resep, isi manual', 'Resep per porsi', 'Pilih bahan', '+ Bahan baru',
  'Tambah bahan ke resep', 'Jumlah', 'Hapus baris {n}', 'Untung per porsi', 'Modal {pct}% dari harga jual', 'Menghitung...', 'Memuat resep...',
  'Modal lebih besar dari harga jual. Cek jumlah atau harga bahan.', 'Ada bahan berharga Rp0, angka ini perkiraan.',
  'Resep belum diisi. Tambah minimal satu bahan, atau hapus resep.', 'Bahan {n}', 'Jumlah bahan {n}', 'Satuan bahan {n}',
  'Satuan tidak cocok dengan bahan', 'Jumlah bahan tidak valid', 'Resep maksimal 40 bahan', 'Satu bahan hanya boleh sekali di resep', 'Bahan tidak ditemukan di outlet ini',
];
test('the recipe editor texts are translated', async () => {
  const { EN } = await import('../src/dict.ts');
  assert.deepEqual(RESEP_TEXTS.filter((k) => !(k in EN)), []);
});

test('a product without a recipe key (the onboarding form) is valid and leaves the recipe alone', () => {
  const r = productSchema.safeParse({ outletId, categoryId: null, name: 'Roti', price: 15000, hpp: 5000, trackStock: false, stock: 0, station: 'kitchen' });
  assert.ok(r.success);
  assert.equal(r.success && r.data.recipe, null);
});

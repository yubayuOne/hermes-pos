import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockDocumentSchema, stockSheetSchema } from '../src/lib/schemas.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const p1 = '00000000-0000-4000-8000-000000000002';
const p2 = '00000000-0000-4000-8000-000000000003';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const doc = (kind: string, lines: { productId: string; qty: number }[], reason = '') => stockDocumentSchema.safeParse({ outletId, kind, reason, lines });

test('stock in: more than 0, up to 3 decimals, each product once (migration 074)', () => {
  assert.ok(doc('stock_in', [{ productId: p1, qty: 12.5 }]).success);
  assert.equal(first(doc('stock_in', [{ productId: p1, qty: 0 }])), 'Jumlah stok masuk harus lebih dari 0.');
  assert.equal(first(doc('stock_in', [{ productId: p1, qty: 1.2345 }])), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(doc('stock_in', [{ productId: p1, qty: 1_000_000 }])), 'Jumlah terlalu besar.');
  assert.equal(first(doc('stock_in', [{ productId: p1, qty: Number.NaN }])), 'Jumlah harus angka.');
  assert.equal(
    first(
      doc('stock_in', [
        { productId: p1, qty: 1 },
        { productId: p1, qty: 2 },
      ]),
    ),
    'Satu produk hanya boleh sekali.',
  );
  assert.equal(first(doc('stock_in', [])), 'Isi jumlah minimal satu produk.');
});

test('adjustment: signed, not 0, with a reason', () => {
  assert.ok(
    doc(
      'adjustment',
      [
        { productId: p1, qty: -3 },
        { productId: p2, qty: 1 },
      ],
      'Roti basi',
    ).success,
  );
  assert.equal(first(doc('adjustment', [{ productId: p1, qty: -3 }], ' x ')), 'Tulis alasan, minimal 3 huruf.');
  assert.equal(first(doc('adjustment', [{ productId: p1, qty: 0 }], 'Roti basi')), 'Jumlah penyesuaian tidak boleh 0.');
});

test('stock in and adjustment only: a count goes through the sheet (096)', () => {
  assert.ok(!stockDocumentSchema.safeParse({ outletId, kind: 'opname', reason: '', lines: [{ productId: p1, qty: 0 }] }).success);
  assert.ok(!stockDocumentSchema.safeParse({ outletId, kind: 'opening', reason: '', lines: [{ productId: p1, qty: 1 }] }).success);
});

const sheetLine = (productId: string, over: Record<string, unknown> = {}) => ({
  productId, opening: null, received: null, issued: null, counted: null, note: '', ...over,
});
const sheet = (lines: unknown[], date: string | null = '2026-11-04') => stockSheetSchema.safeParse({ outletId, date, lines });

test('count sheet: blank cells are fine, at least one count, no minus, notes up to 200 (096)', () => {
  assert.ok(sheet([sheetLine(p1, { counted: 75, opening: 70, received: 30, issued: 3, note: 'Hitung sore' }), sheetLine(p2)]).success);
  assert.ok(sheet([sheetLine(p1, { counted: 0 })], null).success);
  assert.equal(first(sheet([sheetLine(p1), sheetLine(p2)])), 'Isi hasil hitung minimal satu produk.');
  assert.equal(first(sheet([sheetLine(p1, { counted: -1 })])), 'Jumlah tidak boleh minus.');
  assert.equal(first(sheet([sheetLine(p1, { counted: 1, received: -2 })])), 'Jumlah tidak boleh minus.');
  assert.equal(first(sheet([sheetLine(p1, { counted: 1, note: 'x'.repeat(201) })])), 'Catatan maksimal 200 karakter.');
  assert.equal(first(sheet([sheetLine(p1, { counted: 1 }), sheetLine(p1, { counted: 2 })])), 'Satu produk hanya boleh sekali.');
  assert.equal(first(sheet([sheetLine(p1, { counted: 1.2345 })])), 'Jumlah maksimal 3 angka di belakang koma.');
  assert.equal(first(sheet([sheetLine(p1, { counted: 1 })], '4 Nov')), 'Pilih tanggal.');
});

test('every text on the Stok page has an English translation, including the count sheet (096)', async () => {
  const { readFileSync } = await import('node:fs');
  const { EN } = await import('../src/dict.ts');
  const src = readFileSync(new URL('../src/routes/_app/stock.tsx', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  assert.deepEqual(
    keys.filter((k) => !(k in EN)),
    [],
  );
});

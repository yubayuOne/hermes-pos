import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockDocumentSchema } from '../src/lib/schemas.ts';

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

test('count: 0 or more, no reason needed', () => {
  assert.ok(doc('opname', [{ productId: p1, qty: 0 }]).success);
  assert.equal(first(doc('opname', [{ productId: p1, qty: -1 }])), 'Hasil hitung tidak boleh minus.');
  assert.ok(!stockDocumentSchema.safeParse({ outletId, kind: 'opening', reason: '', lines: [{ productId: p1, qty: 1 }] }).success);
});

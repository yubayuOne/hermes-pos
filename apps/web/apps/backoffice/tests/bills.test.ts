import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustmentSchema, billListSchema, billVoidSchema } from '../src/lib/schemas.ts';

const id = '00000000-0000-4000-8000-000000000001';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

test('void needs a reason of 3 to 200 characters', () => {
  assert.equal(first(billVoidSchema.safeParse({ id, reason: '  ab ' })), 'Tulis alasan pembatalan, minimal 3 huruf.');
  assert.equal(first(billVoidSchema.safeParse({ id, reason: 'x'.repeat(201) })), 'Maksimal 200 karakter.');
  assert.ok(billVoidSchema.safeParse({ id, reason: 'Pesanan dobel' }).success);
});

test('list: only known statuses, a sane page, at most 366 days', () => {
  const base = { outletId: null, from: '2026-10-01', to: '2026-10-18', tz: 'Asia/Jakarta', status: 'completed', q: '', page: 1 };
  assert.ok(billListSchema.safeParse(base).success);
  assert.ok(!billListSchema.safeParse({ ...base, status: 'held' }).success);
  assert.ok(!billListSchema.safeParse({ ...base, page: 0 }).success);
  assert.equal(first(billListSchema.safeParse({ ...base, from: '2024-01-01' })), 'Rentang maksimal 366 hari.');
});

test('adjustment: signed whole rupiah, not zero, at most a billion (migration 071)', () => {
  const base = { shiftId: id, kind: 'cash', amount: -10000, category: null, reason: ' Diambil untuk kembalian ' };
  const r = adjustmentSchema.safeParse(base);
  assert.ok(r.success);
  assert.equal(r.data.reason, 'Diambil untuk kembalian');
  assert.equal(first(adjustmentSchema.safeParse({ ...base, amount: 0 })), 'Nominal tidak boleh nol.');
  assert.equal(first(adjustmentSchema.safeParse({ ...base, amount: 1000.5 })), 'Nominal tanpa koma.');
  assert.equal(first(adjustmentSchema.safeParse({ ...base, amount: -1_000_000_001 })), 'Nominal maksimal Rp1.000.000.000.');
  assert.equal(first(adjustmentSchema.safeParse({ ...base, amount: Number.NaN })), 'Isi nominal.');
  assert.equal(first(adjustmentSchema.safeParse({ ...base, reason: 'ok' })), 'Tulis alasan, minimal 3 huruf.');
  assert.ok(!adjustmentSchema.safeParse({ ...base, kind: 'stock' }).success);
});

test('adjustment: a category for an expense and only for an expense', () => {
  const base = { shiftId: id, amount: 5000, reason: 'Nota salah' };
  assert.ok(adjustmentSchema.safeParse({ ...base, kind: 'expense', category: 'belanja' }).success);
  assert.equal(first(adjustmentSchema.safeParse({ ...base, kind: 'expense', category: null })), 'Pilih kategori pengeluaran.');
  assert.equal(first(adjustmentSchema.safeParse({ ...base, kind: 'sales', category: 'belanja' })), 'Pilih kategori pengeluaran.');
});

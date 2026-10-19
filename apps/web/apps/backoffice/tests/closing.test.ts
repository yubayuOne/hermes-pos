import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLockSchema, dayReopenSchema } from '../src/lib/schemas.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

test('closing a day: bank QRIS empty, 0, or a whole positive amount (migration 075)', () => {
  assert.ok(dayLockSchema.safeParse({ outletId, date: '2026-10-18', qrisSettled: null, note: '' }).success);
  assert.ok(dayLockSchema.safeParse({ outletId, date: '2026-10-18', qrisSettled: 0, note: ' Setoran ' }).success);
  assert.equal(first(dayLockSchema.safeParse({ outletId, date: '2026-10-18', qrisSettled: -1, note: '' })), 'Nominal tidak boleh minus.');
  assert.equal(first(dayLockSchema.safeParse({ outletId, date: '2026-10-18', qrisSettled: 10.5, note: '' })), 'Nominal tanpa koma.');
  assert.equal(first(dayLockSchema.safeParse({ outletId, date: '2026-10-18', qrisSettled: null, note: 'x'.repeat(201) })), 'Maksimal 200 karakter.');
  assert.ok(!dayLockSchema.safeParse({ outletId, date: '18-10-2026', qrisSettled: null, note: '' }).success);
});

test('reopening a day needs a reason', () => {
  assert.ok(dayReopenSchema.safeParse({ outletId, date: '2026-10-18', reason: 'Salah hitung QRIS' }).success);
  assert.equal(first(dayReopenSchema.safeParse({ outletId, date: '2026-10-18', reason: ' x ' })), 'Tulis alasan, minimal 3 huruf.');
});

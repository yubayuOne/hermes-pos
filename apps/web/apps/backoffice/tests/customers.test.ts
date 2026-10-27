import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerListSchema } from '../src/lib/schemas.ts';

const base = { outletId: null, tz: 'Asia/Jakarta', q: '', page: 1 };

test('customers: no dates is the whole history, one range is checked', () => {
  assert.ok(customerListSchema.safeParse({ ...base, from: null, to: null }).success);
  assert.ok(customerListSchema.safeParse({ ...base, from: '2026-10-01', to: '2026-10-31' }).success);
  assert.equal(customerListSchema.safeParse({ ...base, from: '2025-01-01', to: '2026-10-31' }).success, false);
});

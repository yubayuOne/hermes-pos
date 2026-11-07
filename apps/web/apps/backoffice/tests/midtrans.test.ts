import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { notificationIsAuthentic } from '../src/server/midtrans.ts';
import { paymentStartSchema } from '../src/lib/schemas.ts';

const KEY = 'SB-Mid-server-test-key';
process.env.MIDTRANS_SERVER_KEY = KEY;
const sign = (order: string, status: string, gross: string, key = KEY) =>
  createHash('sha512').update(`${order}${status}${gross}${key}`).digest('hex');
const notice = (over: Record<string, unknown> = {}) => {
  const base = { order_id: 'INV-20261107-00001', status_code: '200', gross_amount: '147000.00' };
  return { ...base, signature_key: sign(base.order_id, base.status_code, base.gross_amount), ...over };
};

test('a notification signed with the server key is authentic', () => {
  assert.equal(notificationIsAuthentic(notice()), true);
});

test('a changed amount, order, or status code breaks the signature', () => {
  assert.equal(notificationIsAuthentic(notice({ gross_amount: '1.00' })), false);
  assert.equal(notificationIsAuthentic(notice({ order_id: 'INV-20261107-00002' })), false);
  assert.equal(notificationIsAuthentic(notice({ status_code: '201' })), false);
});

test('a missing, short, or wrong signature is refused', () => {
  assert.equal(notificationIsAuthentic({ order_id: 'x', status_code: '200', gross_amount: '1' }), false);
  assert.equal(notificationIsAuthentic(notice({ signature_key: 'abc' })), false);
  assert.equal(notificationIsAuthentic(notice({ signature_key: sign('INV-20261107-00001', '200', '147000.00', 'other') })), false);
});

test('a signature made with another server key is refused', () => {
  const forged = notice({ signature_key: sign('INV-20261107-00001', '200', '147000.00', 'attacker') });
  assert.equal(notificationIsAuthentic(forged), false);
});

test('a payment can start only for a paid plan with 0 to 50 extra outlets', () => {
  assert.ok(paymentStartSchema.safeParse({ plan: 'monthly', extraOutlets: 0 }).success);
  assert.ok(paymentStartSchema.safeParse({ plan: 'daily', extraOutlets: 50 }).success);
  assert.ok(!paymentStartSchema.safeParse({ plan: 'trial', extraOutlets: 0 }).success);
  assert.ok(!paymentStartSchema.safeParse({ plan: 'semiannual', extraOutlets: 0 }).success);
  assert.ok(!paymentStartSchema.safeParse({ plan: 'monthly', extraOutlets: 51 }).success);
  assert.ok(!paymentStartSchema.safeParse({ plan: 'monthly', extraOutlets: -1 }).success);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voucherSchema } from '../src/lib/schemas.ts';

const base = {
  id: null,
  code: 'HEMAT10',
  scope: 'bill',
  discountType: 'percent',
  value: 10,
  minSpend: 0,
  quota: null,
  expiresOn: '2026-12-31',
  productIds: [],
};
const first = (patch: object) => voucherSchema.safeParse({ ...base, ...patch }).error?.issues[0]?.message;

test('percent vouchers: 1 to 100, decimals allowed', () => {
  assert.equal(first({ value: 12.5 }), undefined);
  assert.equal(first({ value: 100 }), undefined);
  assert.equal(first({ value: 0 }), 'Potongan persen harus 1 sampai 100.');
  assert.equal(first({ value: 100.01 }), 'Potongan persen harus 1 sampai 100.');
});

test('amount vouchers: at least Rp1.000 and whole rupiah, like the till discounts', () => {
  assert.equal(first({ discountType: 'amount', value: 1000 }), undefined);
  assert.equal(first({ discountType: 'amount', value: 999 }), 'Potongan nominal minimal Rp1.000.');
  assert.equal(first({ discountType: 'amount', value: 1500.5 }), 'Potongan nominal tanpa koma.');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, saving } from '../src/content.ts';

test('the landing shows the owner prices: Harian, Mingguan, Bulanan, Tahunan, and a 14-day trial', () => {
  assert.deepEqual(
    PLANS.map((p) => [p.code, p.price, p.list]),
    [
      ['trial', 0, 0],
      ['daily', 7_000, 15_000],
      ['weekly', 47_000, 100_000],
      ['monthly', 147_000, 500_000],
      ['annual', 697_000, 1_500_000],
    ],
  );
  assert.equal(PLANS[0].duration, '14 hari');
});

test('saving is the struck list price minus the price paid', () => {
  assert.equal(saving(15_000, 7_000), 8_000);
  assert.equal(saving(100_000, 47_000), 53_000);
  assert.equal(saving(500_000, 147_000), 353_000);
  assert.equal(saving(1_500_000, 697_000), 803_000);
});

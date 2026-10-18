import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONTHLY, PLANS, perMonth, saving } from '../src/content.ts';

test('perMonth rounds to whole rupiah', () => {
  assert.equal(perMonth(149_000, 1), 149_000);
  assert.equal(perMonth(699_000, 6), 116_500);
  assert.equal(perMonth(1_399_000, 12), 116_583); // 116.583,33
});

test('saving is the monthly price times months minus the plan price', () => {
  assert.equal(saving(149_000, 1), 0);
  assert.equal(saving(699_000, 6), 195_000);
  assert.equal(saving(1_399_000, 12), 389_000);
  assert.equal(saving(0, 0), 0);
});

test('plan prices match the backoffice and plan_quote (149.000, 699.000, 1.399.000)', () => {
  assert.deepEqual(
    PLANS.map((p) => [p.code, p.months, p.price]),
    [
      ['trial', 0, 0],
      ['monthly', 1, 149_000],
      ['semiannual', 6, 699_000],
      ['annual', 12, 1_399_000],
    ],
  );
  assert.equal(PLANS[1].price, MONTHLY);
});

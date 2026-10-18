import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, perMonth, planByCode, quote, saving } from '../src/lib/plans.ts';

const monthly = planByCode('monthly');
const semiannual = planByCode('semiannual');
const annual = planByCode('annual');

test('quote matches plan_quote: plan price plus Rp99.000 per extra outlet per plan month', () => {
  assert.equal(quote(monthly, 0), 149_000);
  assert.equal(quote(monthly, 1), 248_000);
  assert.equal(quote(semiannual, 3), 699_000 + 3 * 99_000 * 6);
  assert.equal(quote(annual, 2), 3_775_000);
});

test('perMonth rounds to whole rupiah; saving compares with paying monthly', () => {
  assert.equal(perMonth(monthly), 149_000);
  assert.equal(perMonth(semiannual), 116_500);
  assert.equal(perMonth(annual), 116_583); // 1.399.000 / 12 = 116.583,33
  assert.equal(saving(monthly), 0);
  assert.equal(saving(semiannual), 195_000);
  assert.equal(saving(annual), 389_000);
});

test('planByCode falls back to monthly for unknown or trial codes', () => {
  assert.equal(planByCode('trial'), monthly);
  assert.equal(planByCode(''), monthly);
});

test('addMonths: plain dates and year rollover', () => {
  assert.equal(addMonths('2026-01-15', 1), '2026-02-15');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-12-31', 12), '2027-12-31');
  assert.equal(addMonths('2026-10-15', 0), '2026-10-15');
});

test('addMonths clamps to the last day of the month, like Postgres make_interval(months => n)', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2026-11-30', 1), '2026-12-30');
});

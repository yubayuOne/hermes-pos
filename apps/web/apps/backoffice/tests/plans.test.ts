import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, addPeriod, planByCode, quote, saving } from '../src/lib/plans.ts';

const daily = planByCode('daily');
const weekly = planByCode('weekly');
const monthly = planByCode('monthly');
const annual = planByCode('annual');

test('the four plans sell at the owner prices, struck list price above', () => {
  assert.deepEqual([daily.price, weekly.price, monthly.price, annual.price], [7_000, 47_000, 147_000, 697_000]);
  assert.deepEqual([daily.list, weekly.list, monthly.list, annual.list], [15_000, 100_000, 500_000, 1_500_000]);
});

test('quote matches plan_quote: plan price plus the extra outlet price of the plan', () => {
  assert.equal(quote(daily, 2), 7_000 + 2 * 3_000);
  assert.equal(quote(monthly, 0), 147_000);
  assert.equal(quote(monthly, 1), 246_000);
  assert.equal(quote(annual, 2), 697_000 + 2 * 1_188_000);
});

test('saving is the struck list price minus what the buyer pays', () => {
  assert.equal(saving(daily), 8_000);
  assert.equal(saving(weekly), 53_000);
  assert.equal(saving(monthly), 353_000);
  assert.equal(saving(annual), 803_000);
});

test('planByCode falls back to monthly for unknown, trial, or retired codes', () => {
  assert.equal(planByCode('trial'), monthly);
  assert.equal(planByCode('semiannual'), monthly);
  assert.equal(planByCode(''), monthly);
});

test('addPeriod: days for Harian and Mingguan, months for Bulanan and Tahunan', () => {
  assert.equal(addPeriod('2026-11-07', daily), '2026-11-08');
  assert.equal(addPeriod('2026-11-07', weekly), '2026-11-14');
  assert.equal(addPeriod('2026-12-28', weekly), '2027-01-04');
  assert.equal(addPeriod('2026-11-07', monthly), '2026-12-07');
  assert.equal(addPeriod('2026-11-07', annual), '2027-11-07');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
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

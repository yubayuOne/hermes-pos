import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDay, parsePeriod, periodRange } from '../src/lib/period.ts';
import { rangeCheck, summarySchema } from '../src/lib/schemas.ts';

test('today is the default', () => {
  assert.deepEqual(periodRange({}, '2026-10-18'), { from: '2026-10-18', to: '2026-10-18' });
});

test('this month runs from the 1st to today', () => {
  assert.deepEqual(periodRange({ period: 'month' }, '2026-10-18'), { from: '2026-10-01', to: '2026-10-18' });
  assert.deepEqual(periodRange({ period: 'month' }, '2026-10-01'), { from: '2026-10-01', to: '2026-10-01' });
});

test('last month is the whole previous month, across years and leap days', () => {
  assert.deepEqual(periodRange({ period: 'last-month' }, '2026-10-18'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(periodRange({ period: 'last-month' }, '2027-01-05'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(periodRange({ period: 'last-month' }, '2028-03-31'), { from: '2028-02-01', to: '2028-02-29' });
});

test('custom needs both dates, otherwise today', () => {
  assert.deepEqual(periodRange({ period: 'custom', from: '2026-10-01', to: '2026-10-05' }, '2026-10-18'), { from: '2026-10-01', to: '2026-10-05' });
  assert.deepEqual(periodRange({ period: 'custom', from: '2026-10-01' }, '2026-10-18'), { from: '2026-10-18', to: '2026-10-18' });
});

test('old or broken URL values fall back to today', () => {
  assert.deepEqual(parsePeriod({ period: '7d', from: '<script>', to: 5 }), { period: undefined, from: undefined, to: undefined });
  assert.deepEqual(parsePeriod({ period: 'last-month' }), { period: 'last-month', from: undefined, to: undefined });
});

test('impossible dates are not days', () => {
  for (const v of ['2026-02-30', '2027-02-29', '2026-99-99', '2026-13-01', '2026-00-10', '2026-1-01', '']) assert.equal(isDay(v), false, v);
  for (const v of ['2028-02-29', '2026-12-31', '2026-01-01']) assert.equal(isDay(v), true, v);
  assert.equal(parsePeriod({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }).from, undefined);
});

test('the server refuses reversed or over-long ranges', () => {
  const ok = (from: string, to: string) => summarySchema.refine(...rangeCheck).safeParse({ from, to, outletId: null }).success;
  assert.equal(ok('2026-01-01', '2026-12-31'), true);
  assert.equal(ok('2028-01-01', '2028-12-31'), true); // 366 days, leap year
  assert.equal(ok('2026-01-01', '2027-01-01'), true); // 366 days
  assert.equal(ok('2026-01-01', '2027-01-02'), false);
  assert.equal(ok('2026-10-05', '2026-10-01'), false);
  assert.equal(ok('1900-01-01', '2026-10-18'), false);
});

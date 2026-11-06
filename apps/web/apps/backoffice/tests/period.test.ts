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

test('a custom range is checked when Selesai is pressed (prompt 3)', async () => {
  const { periodError, changedOnly } = await import('../src/lib/period.ts');
  const today = '2026-11-06';
  assert.equal(periodError({ period: 'today' }, today), null);
  assert.equal(periodError({ period: 'custom', from: undefined, to: '2026-11-01' }, today), 'Pilih tanggal mulai.');
  assert.equal(periodError({ period: 'custom', from: '2026-11-01', to: undefined }, today), 'Pilih tanggal akhir.');
  assert.equal(periodError({ period: 'custom', from: '2026-11-01', to: '2026-11-07' }, today), 'Tanggal akhir tidak boleh setelah hari ini.');
  assert.equal(periodError({ period: 'custom', from: '2026-11-05', to: '2026-11-04' }, today), 'Tanggal akhir tidak boleh sebelum tanggal mulai.');
  // 366 days inclusive is the limit; 367 is refused.
  assert.equal(periodError({ period: 'custom', from: '2025-11-06', to: '2026-11-06' }, today), null);
  assert.equal(periodError({ period: 'custom', from: '2025-11-05', to: '2026-11-06' }, today), 'Rentang maksimal 366 hari.');
  assert.equal(periodError({ period: 'custom', from: '2026-02-28', to: '2026-03-01' }, today), null);
});

test('Selesai applies only the fields that changed (prompt 3)', async () => {
  const { changedOnly } = await import('../src/lib/period.ts');
  const current = { period: 'month' as const, from: undefined, to: undefined, q: 'kopi' };
  assert.deepEqual(changedOnly({ period: 'month' as const }, current), {});
  assert.deepEqual(changedOnly({ period: 'custom' as const, from: '2026-11-01', to: '2026-11-03' }, current), { period: 'custom', from: '2026-11-01', to: '2026-11-03' });
  assert.deepEqual(changedOnly({ period: 'today' as const, from: undefined }, current), { period: 'today' });
});

test('the custom range messages have English translations (prompt 3)', async () => {
  const { EN } = await import('../src/dict.ts');
  for (const m of ['Pilih tanggal mulai.', 'Pilih tanggal akhir.', 'Tanggal akhir tidak boleh setelah hari ini.', 'Tanggal akhir tidak boleh sebelum tanggal mulai.', 'Rentang maksimal 366 hari.', 'Dari', 'Sampai', 'Selesai', 'Periode']) {
    assert.ok(m in EN, m);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every text of the Laporan has an English translation (prompt 5): the t('...') calls and the insight sentences.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('every t(...) text of the Laporan is translated', async () => {
  const { EN } = await import('../src/dict.ts');
  const files = ['../src/components/ReportDocument.tsx', '../src/components/ReportCharts.tsx'];
  const keys = files.flatMap((f) => [...read(f).matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]));
  assert.ok(keys.length > 80);
  assert.deepEqual([...new Set(keys.filter((k) => !(k in EN)))], []);
});

test('every insight sentence of the Laporan is translated, for rising and falling periods (reportBook.ts)', async () => {
  const { EN } = await import('../src/dict.ts');
  const { insightsOf, daysBetween, weeksOf, monthsOf } = await import('../src/lib/reportBook.ts');
  const days = daysBetween('2026-11-01', '2026-11-28');
  const mk = (rise: boolean) => ({
    bills: days.flatMap((d, i) => [
      { day: d, hour: 9 + (i % 4), total: rise ? 50000 + i * 4000 : 130000 - i * 4000, method: i % 3 === 0 ? 'qris' : 'cash', customer: 'Ani', subtotal: 50000 },
      { day: d, hour: 19, total: 0, method: 'cash', customer: 'Tamu', subtotal: 20000 },
    ]),
    items: days.flatMap((d, i) => [
      { day: d, name: 'Kopi', qty: rise ? 1 + (i >= 14 ? 3 : 0) : 4 - (i >= 14 ? 3 : 0), value: 22000 },
      { day: d, name: 'Teh', qty: rise ? 4 - (i >= 14 ? 3 : 0) : 1 + (i >= 14 ? 3 : 0), value: 10000 },
    ]),
    expenses: [{ day: '2026-11-05', category: 'belanja', name: 'Susu', quantity: 2, unit: 'L', amount: 30000, paidFrom: 'other' }],
    days,
    weeks: weeksOf('2026-11-01', '2026-11-28'),
    months: monthsOf('2026-11-01', '2026-11-28'),
  });
  const sentences = [...insightsOf(mk(true)), ...insightsOf(mk(false))].map((i) => i.key);
  assert.ok(new Set(sentences).size >= 10, 'enough distinct sentences for the test');
  assert.deepEqual([...new Set(sentences.filter((k) => !(k in EN)))], []);
});

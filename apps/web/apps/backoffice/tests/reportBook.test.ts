import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billsIn, dailyOmzet, daysBetween, expenseStats, insightsOf, isNamedCustomer, menuMovers, menuRanking, monthsOf, salesStats, toDetail, topCustomers, weeksOf, heatmapOf, weekStats, fullWeeks } from '../src/lib/reportBook.ts';

const bill = (day: string, hour: number, total: number, method = 'cash', customer = '', subtotal = total) => ({ day, hour, total, method, customer, subtotal });
const item = (day: string, name: string, qty: number, value = qty * 1000) => ({ day, name, qty, value });

test('toDetail keeps only the rows that fit their shape (098)', () => {
  const d = toDetail({
    bills: [['2026-11-03T10:15', 44000, 'cash', 'Budi', 44000], ['bad', 1, 'cash', '', 1], ['2026-11-03T11:00', -5, 'cash', '', 0]],
    items: [['2026-11-03', 'Kopi', 2, 44000], ['2026-11-03', 'Kopi']],
    expenses: [['2026-11-03', 'operasional', 'Es', 2, 'kg', 15000, 'drawer']],
  });
  assert.equal(d.bills.length, 1);
  assert.equal(d.bills[0].hour, 10);
  assert.equal(d.items.length, 1);
  assert.equal(d.expenses[0].paidFrom, 'drawer');
  assert.deepEqual(toDetail(null), { bills: [], items: [], expenses: [] });
});

test('a week that crosses two months is cut by each month, and is partial there (1.8 / 1.5)', () => {
  const weeks = weeksOf('2026-10-28', '2026-11-10');
  assert.equal(weeks.length, 3); // Mon 26 Oct, Mon 2 Nov, Mon 9 Nov
  assert.equal(weeks[0].start, '2026-10-26');
  assert.equal(weeks[0].partial, true);
  assert.deepEqual(weeks[0].days, daysBetween('2026-10-28', '2026-11-01'));
  const oct = monthsOf('2026-10-28', '2026-11-10');
  assert.equal(oct[0].partial, true);
  assert.equal(oct[0].days.length, 4);
  const novWeek = weeksOf('2026-11-01', '2026-11-30').find((w) => w.start === '2026-10-26');
  assert.deepEqual(novWeek?.days, ['2026-11-01']); // a Sunday: the week of 26 Oct is partial here
  assert.equal(novWeek?.partial, true);
});

test('a one-day period has one partial week and no week comparison', () => {
  const weeks = weeksOf('2026-11-03', '2026-11-03');
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].partial, true);
  assert.equal(fullWeeks(weekStats([bill('2026-11-03', 9, 1000)], [], weeks)).length, 0);
  const ins = insightsOf({ bills: [bill('2026-11-03', 9, 1000)], items: [], expenses: [], days: ['2026-11-03'], weeks, months: monthsOf('2026-11-03', '2026-11-03') });
  assert.ok(!ins.some((i) => i.source === 'BAB 1.5'));
});

test('a free bill counts as a bill and adds 0 to sales; its menu value is its subtotal', () => {
  const days = daysBetween('2026-11-03', '2026-11-03');
  const s = salesStats([bill('2026-11-03', 10, 44000), bill('2026-11-03', 11, 0, 'cash', 'Tamu', 22000)], [item('2026-11-03', 'Kopi', 3)], days);
  assert.equal(s.count, 2);
  assert.equal(s.sales, 44000);
  assert.equal(s.freeCount, 1);
  assert.equal(s.freeSubtotal, 22000);
});

test('the same menu name from two outlets is one menu', () => {
  const r = menuRanking([item('2026-11-03', 'Kopi susu', 2), item('2026-11-03', 'kopi susu ', 3), item('2026-11-04', 'Teh', 1)]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].qty, 5);
  assert.equal(r.qty, 6);
});

test('anonymous names are skipped; the same name in other case is one customer', () => {
  assert.equal(isNamedCustomer('  '), false);
  assert.equal(isNamedCustomer('Umum'), false);
  assert.equal(isNamedCustomer('tamu'), false);
  assert.equal(isNamedCustomer('12'), false);
  assert.equal(isNamedCustomer('Sari'), true);
  const c = topCustomers([bill('2026-11-03', 9, 10000, 'cash', 'Budi'), bill('2026-11-03', 9, 5000, 'cash', 'budi '), bill('2026-11-03', 9, 99000, 'cash', 'Tamu'), bill('2026-11-03', 9, 99000, 'cash', '3')]);
  assert.deepEqual(c, [{ name: 'Budi', count: 2, total: 15000 }]);
});

test('empty data: zeros, no NaN, no insight', () => {
  const days = daysBetween('2026-11-01', '2026-11-30');
  const s = salesStats([], [], days);
  assert.equal(s.avgPerDay, 0);
  assert.equal(s.avgPerBill, 0);
  assert.equal(expenseStats([], days).avgPerDay, 0);
  const ins = insightsOf({ bills: [], items: [], expenses: [], days, weeks: weeksOf('2026-11-01', '2026-11-30'), months: monthsOf('2026-11-01', '2026-11-30') });
  assert.deepEqual(ins, []);
  assert.ok(heatmapOf([], weeksOf('2026-11-01', '2026-11-30')).flat().every((v) => v === null || v === 0));
});

test('menu moves up and down only past 50% and only at 1 portion a day in one half (1.7)', () => {
  const days = daysBetween('2026-11-01', '2026-11-04'); // halves: 1-2 and 3-4
  // Kopi: 2 a day then 4 a day (up). Teh: 4 a day then 2 a day (down). Roti: 1 a day then 1.2 a day (not 50%, no move).
  const items = [
    item('2026-11-01', 'Kopi', 2), item('2026-11-02', 'Kopi', 2), item('2026-11-03', 'Kopi', 4), item('2026-11-04', 'Kopi', 4),
    item('2026-11-01', 'Teh', 4), item('2026-11-02', 'Teh', 4), item('2026-11-03', 'Teh', 2), item('2026-11-04', 'Teh', 2),
    item('2026-11-01', 'Roti', 2), item('2026-11-02', 'Roti', 0.0001), item('2026-11-03', 'Roti', 2), item('2026-11-04', 'Roti', 2.4),
  ];
  const m = menuMovers(items, days);
  assert.equal(m.up?.name, 'Kopi');
  assert.equal(m.down?.name, 'Teh');
  // A menu under 1 portion a day in both halves never moves.
  const quiet = menuMovers([item('2026-11-01', 'Garam', 0.2), item('2026-11-04', 'Garam', 0.9)], days);
  assert.equal(quiet.up, null);
  assert.equal(menuMovers([item('2026-11-01', 'X', 5)], ['2026-11-01']).up, null);
});

test('insights name their chapter and need their data; full weeks compare the first and last', () => {
  const days = daysBetween('2026-11-02', '2026-11-15');
  const weeks = weeksOf('2026-11-02', '2026-11-15');
  const bills = days.flatMap((d, i) => [bill(d, 9 + (i % 3), 100000 + i * 1000, i % 4 === 0 ? 'qris' : 'cash', 'Ani')]);
  const items = days.map((d) => item(d, 'Kopi', 3, 66000));
  const ins = insightsOf({ bills, items, expenses: [], days, weeks, months: monthsOf('2026-11-02', '2026-11-15') });
  assert.ok(ins.some((i) => i.key.startsWith('Minggu penuh terbaik')));
  assert.ok(ins.some((i) => i.key.startsWith('Menu terlaris')));
  assert.ok(ins.every((i) => /^BAB \d\.\d$/.test(i.source)));
  assert.ok(!ins.some((i) => i.key.includes('pengeluaran')));
  const daily = dailyOmzet(billsIn(bills, days), days);
  assert.equal(daily.length, days.length);
});

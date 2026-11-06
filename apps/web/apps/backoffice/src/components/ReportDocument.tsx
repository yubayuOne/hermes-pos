import type { ReactNode } from 'react';
import { BRAND_UPPER, amount, dateLong, dateRange, dateShort, dayDiff, decimal, money, time, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import {
  type Bill,
  type ExpenseRow,
  type InsightParam,
  type ItemRow,
  type Month,
  type Week,
  addDay,
  billsIn,
  daysBetween,
  dailyExpenses,
  dailyOmzet,
  expenseRanking,
  expenseStats,
  expensesIn,
  fullWeeks,
  heatmapOf,
  hoursOf,
  insightsOf,
  itemsIn,
  menuByWeek,
  menuRanking,
  monthsOf,
  salesStats,
  topCustomers,
  topPerWeek,
  trendPerActiveDay,
  weekStats,
  weekdaysOf,
  weeksOf,
} from '../lib/reportBook';
import type { Pnl } from '../lib/types';
import type { ReportData } from '../server/report';
import { BLOCK, ColumnBars, HBars, Heatmap, LineChart, StackedBars, chunk } from './ReportCharts';

export type ReportKind = 'week' | 'month' | 'period';

/**
 * Laporan kinerja (DESIGN.md D5, prompt 5): four parts printed as A4 sheets: 1 Penjualan, 2 Pengeluaran, 3 Ringkasan,
 * 4 Insight. Pratinjau dan cetak memakai komponen yang sama. Angka dihitung di lib/reportBook.ts dari baris
 * owner_report_detail (098); angka laba rugi dan kas tetap dari owner_report_page (063, 071).
 */
export function ReportDocument({
  data,
  range,
  kind,
  outletId,
}: {
  data: ReportData;
  range: { from: string; to: string };
  kind: ReportKind;
  outletId: string | null;
}) {
  const { t, lang } = useI18n();
  const app = useApp();
  const tz = app.business.timezone;
  const { report: r, sales: s, detail } = data;
  const business = app.business.name || '[NAMA BISNIS]';
  const outlet = outletId ? app.outlets.find((o) => o.id === outletId) : undefined;
  const title = kind === 'week' ? t('Laporan Kinerja Mingguan') : kind === 'month' ? t('Laporan Kinerja Bulanan') : t('Laporan Kinerja');
  const period = dateRange(range.from, range.to, lang);
  const span = dayDiff(range.from, range.to) + 1;
  const number = `LAP-${range.from.replaceAll('-', '')}-${range.to.replaceAll('-', '')}`;
  const now = new Date();
  const created = `${dateLong(now, lang, tz)} ${time(now, tz)}`;
  const footer = `${business} · ${title} · ${period}`;
  const PARTS = 4;

  const pct = (a: number, b: number) => (b ? `${decimal((a / b) * 100, lang)}%` : '-');
  const chartM = (v: number) => decimal(v / 1_000_000, lang, 1);
  const dayLabel = (d: string) => dateShort(d, lang, 'UTC');

  const B: Bill[] = detail.bills;
  const I: ItemRow[] = detail.items;
  const E: ExpenseRow[] = detail.expenses;
  const days = daysBetween(range.from, range.to);
  const weeks = weeksOf(range.from, range.to);
  const months = monthsOf(range.from, range.to);
  const sales = salesStats(B, I, days);
  const menu = menuRanking(I);
  const wstats = weekStats(B, I, weeks);
  const full = fullWeeks(wstats);
  const bestWeek = full.length ? full.reduce((b, w) => (w.sales > b.sales ? w : b)) : null;
  const lowWeek = full.length ? full.reduce((b, w) => (w.sales < b.sales ? w : b)) : null;
  const ex = expenseStats(E, days);
  const exDaily = dailyExpenses(E, days);
  const exRank = expenseRanking(E);
  const cur = r.pnl;
  const insights = insightsOf({ bills: B, items: I, expenses: E, days, weeks, months });
  const shortWeek = (w: Week) => dateRange(w.days[0], w.days[w.days.length - 1], lang);
  const weekHead = (w: Week) => `${w.partial ? '*' : ''}${shortWeek(w)}`;
  const monthName = (key: string) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T12:00:00Z`));
  const monthHead = (m: Month) => `${monthName(m.key)}${m.partial ? ' *' : ''}`;
  const weekdayName = (i: number) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${addDay('2024-01-01', i)}T12:00:00Z`));
  const weekdayShort = (i: number) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${addDay('2024-01-01', i)}T12:00:00Z`)).replace('.', '');
  const money0 = (n: number) => money(n);
  // Figures the retained parts use: previous period, the shifts with a difference, the product margin floor.
  const prev = r.previousPnl;
  const closedWithDiff = r.shifts.filter((x) => !x.open && x.variance !== null && x.variance !== 0);
  const avgMargin = r.productTotals.sales ? ((r.productTotals.sales - r.productTotals.hpp) / r.productTotals.sales) * 100 : 0;
  const redBelow = avgMargin - 5;

  const fmt = (p: InsightParam): string => {
    switch (p.kind) {
      case 'money':
        return money(Number(p.value));
      case 'pct':
        return `${decimal(Number(p.value), lang)}%`;
      case 'day':
        return dayLabel(String(p.value));
      case 'month':
        return monthName(String(p.value));
      case 'hour':
        return `${String(p.value).padStart(2, '0')}.00`;
      case 'weekday':
        return weekdayName(Number(p.value));
      case 'num':
        return decimal(Number(p.value), lang);
      default:
        return String(p.value);
    }
  };

  // @page footer: printed on every physical page, with the page number from the browser.
  const pageCss = `@media print { @page { @bottom-left { content: ${JSON.stringify(footer)}; font: 8.5pt sans-serif; color: dimgray; } @bottom-right { content: ${JSON.stringify(t('Halaman'))} " " counter(page) " " ${JSON.stringify(t('dari'))} " " counter(pages); font: 8.5pt sans-serif; color: dimgray; } } }`;
  const sheet = { head: { business, meta: `No. ${number} · ${period}` }, footer, pages: PARTS };

  return (
    // minmax(0,1fr): a sheet never grows past the screen; wide tables scroll inside it (Scroll).
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 print:block">
      <style>{pageCss}</style>

      <Sheet n={1} {...sheet}>
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-5">
          <div>
            {outlet?.logoUrl ? (
              <img src={outlet.logoUrl} alt={t('Logo {name}', { name: outlet.name })} className="h-12 w-24 object-contain object-left" />
            ) : (
              <span className="grid h-12 w-24 place-items-center border border-dashed border-mute font-mono text-caption text-mute">[LOGO]</span>
            )}
            <p className="mt-3 font-display text-title font-extrabold tracking-[-0.02em]">{business}</p>
            <p className="text-[12.5px] text-mute">{outlet ? outlet.name : t('Semua outlet: {list}', { list: r.outlets.join(', ') })}</p>
          </div>
          <div className="text-right font-mono text-caption leading-[1.7] text-mute">
            <p>No. {number}</p>
            <p>{t('Periode {range}', { range: period })}</p>
            <p>{t('Dibuat {date}', { date: created })}</p>
            <p>{t('Mata uang: Rupiah')}</p>
          </div>
        </header>
        <h2 className="mt-7 font-display text-[clamp(28px,5vw,38px)] font-extrabold leading-[1.02] tracking-[-0.035em]">{title}</h2>
        <p className="mt-2 text-[13.5px] text-mute">
          {t('Untuk pemilik dan manajer. Empat bagian: penjualan, pengeluaran, ringkasan, dan insight. Periode {n} hari.', { n: span })}
        </p>
        <nav className="mt-4 grid gap-1 text-[12.5px]" aria-label={t('Isi laporan')}>
          <p>{t('BAB 1 Penjualan')}</p>
          <p>{t('BAB 2 Pengeluaran')}</p>
          <p>{t('BAB 3 Ringkasan')}</p>
          <p>{t('BAB 4 Insight')}</p>
        </nav>

        <Part n="1" title={t('Penjualan')} />
        <Section n="1.1" title={t('Angka utama')}>
          <dl className="rp-keep grid grid-cols-2 gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-4 print:grid-cols-4">
            <Kpi label={t('Total omzet')} value={big(sales.sales, lang)} sub={sales.bestDay ? t('hari terbaik {day}: {amount}', { day: dayLabel(sales.bestDay.day), amount: money0(sales.bestDay.total) }) : ''} />
            <Kpi label={t('Jumlah nota')} value={String(sales.count)} sub="" />
            <Kpi label={t('Porsi terjual')} value={String(sales.portions)} sub={t('{n} menu berbeda', { n: sales.menus })} />
            <Kpi label={t('Hari berjualan')} value={String(sales.activeDays)} sub={t('dari {n} hari', { n: span })} />
            <Kpi label={t('Rata-rata per nota')} value={big(sales.avgPerBill, lang)} sub="" />
            <Kpi label={t('Rata-rata per hari')} value={big(sales.avgPerDay, lang)} sub={t('hari berjualan')} />
            <Kpi label={t('Porsi per nota')} value={decimal(sales.portionsPerBill, lang)} sub="" />
            <Kpi label={t('Laba bersih')} value={big(cur.operatingProfit, lang)} sub={t('margin {pct}', { pct: pct(cur.operatingProfit, cur.netSales) })} />
          </dl>
        </Section>

        <Section n="1.2" title={t('Perbandingan per bulan')} sub={t('Bulan yang belum penuh ditandai *. Rata-rata per hari dihitung dari hari berjualan.')}>
          <Scroll>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Bulan')}</th>
                  <th scope="col" className="n">{t('Hari')}</th>
                  <th scope="col" className="n">{t('Nota')}</th>
                  <th scope="col" className="n">{t('Porsi')}</th>
                  <th scope="col" className="n">{t('Omzet')}</th>
                  <th scope="col" className="n">{t('Rata-rata/hari')}</th>
                  <th scope="col" className="n">{t('Rata-rata/nota')}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const st = salesStats(billsIn(B, m.days), itemsIn(I, m.days), m.days);
                  return (
                    <tr key={m.key}>
                      <td>{monthHead(m)}</td>
                      <td className="n">{st.activeDays}</td>
                      <td className="n">{st.count}</td>
                      <td className="n">{st.portions}</td>
                      <td className="n">{amount(st.sales)}</td>
                      <td className="n">{amount(st.avgPerDay)}</td>
                      <td className="n">{amount(st.avgPerBill)}</td>
                    </tr>
                  );
                })}
                <tr className="tot">
                  <td>{t('Total')}</td>
                  <td className="n">{sales.activeDays}</td>
                  <td className="n">{sales.count}</td>
                  <td className="n">{sales.portions}</td>
                  <td className="n">{amount(sales.sales)}</td>
                  <td className="n">{amount(sales.avgPerDay)}</td>
                  <td className="n">{amount(sales.avgPerBill)}</td>
                </tr>
              </tbody>
            </table>
          </Scroll>
          {months.some((m) => m.partial) && <p className="mt-2 text-caption text-mute">{t('* Bulan tidak penuh: hanya hari dalam periode yang dihitung.')}</p>}
          <figure className="mt-5">
            <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Omzet harian (juta rupiah)')}</figcaption>
            <ColumnBars bars={dailyOmzet(B, days).map((d) => ({ label: d.day.slice(8, 10), value: d.total }))} format={chartM} caption={t('Omzet harian (juta rupiah)')} />
          </figure>
          <figure className="mt-5">
            <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Omzet per bulan (juta rupiah)')}</figcaption>
            <ColumnBars
              bars={months.map((m) => ({ label: m.key.slice(5), value: salesStats(billsIn(B, m.days), [], m.days).sales, tone: m.partial ? 'bg-pine/40' : undefined }))}
              format={chartM}
              caption={t('Omzet per bulan (juta rupiah)')}
            />
          </figure>
          <figure className="mt-5">
            <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Rata-rata omzet per hari per bulan (juta rupiah)')}</figcaption>
            <ColumnBars
              bars={months.map((m) => ({ label: m.key.slice(5), value: salesStats(billsIn(B, m.days), [], m.days).avgPerDay, tone: m.partial ? 'bg-pine/40' : undefined }))}
              format={chartM}
              caption={t('Rata-rata omzet per hari per bulan (juta rupiah)')}
            />
          </figure>
        </Section>

        <Section n="1.3" title={t('Metode pembayaran')}>
          <Scroll>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Metode')}</th>
                  <th scope="col" className="n">{t('Nota')}</th>
                  <th scope="col" className="n">%</th>
                  <th scope="col" className="n">{t('Omzet')}</th>
                  <th scope="col" className="n">%</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t('Tunai')}</td>
                  <td className="n">{sales.cashCount}</td>
                  <td className="n">{pct(sales.cashCount, sales.count)}</td>
                  <td className="n">{amount(sales.cash)}</td>
                  <td className="n">{pct(sales.cash, sales.sales)}</td>
                </tr>
                <tr>
                  <td>QRIS</td>
                  <td className="n">{sales.qrisCount}</td>
                  <td className="n">{pct(sales.qrisCount, sales.count)}</td>
                  <td className="n">{amount(sales.qris)}</td>
                  <td className="n">{pct(sales.qris, sales.sales)}</td>
                </tr>
              </tbody>
            </table>
          </Scroll>
          {sales.freeCount > 0 && (
            <p className="mt-2 text-caption text-mute">
              {t('Nota gratis (total 0): {n} nota, nilai harga menu {value}.', { n: sales.freeCount, value: money0(sales.freeSubtotal) })}
            </p>
          )}
        </Section>

        <Section n="1.4" title={t('Menu terlaris')} sub={t('Sepuluh menu teratas dan ranking semua menu. Nilai harga menu = porsi kali harga jual, sebelum diskon.')}>
          {menu.rows.length === 0 ? (
            <p className="text-mute">{t('Belum ada penjualan di periode ini.')}</p>
          ) : (
            <>
              <HBars
                rows={menu.rows.slice(0, 10).map((m) => ({ label: m.name, value: m.qty, share: m.share }))}
                format={(v) => decimal(v, lang)}
                caption={t('Menu terlaris, porsi')}
              />
              <Scroll>
                <table className="rp-tbl mt-4">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">{t('Menu')}</th>
                      <th scope="col" className="n">{t('Porsi')}</th>
                      <th scope="col" className="n">%</th>
                      <th scope="col" className="n">{t('Nilai harga menu')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menu.rows.map((m, i) => (
                      <tr key={m.name}>
                        <td>{i + 1}</td>
                        <td>{m.name}</td>
                        <td className="n">{decimal(m.qty, lang)}</td>
                        <td className="n">{`${decimal(m.share, lang)}%`}</td>
                        <td className="n">{amount(menu.rows.length ? menuValue(I, m.name) : 0)}</td>
                      </tr>
                    ))}
                    <tr className="tot">
                      <td colSpan={2}>{t('Total')}</td>
                      <td className="n">{decimal(menu.qty, lang)}</td>
                      <td className="n">{menu.qty ? '100%' : '-'}</td>
                      <td className="n">{amount(menu.value)}</td>
                    </tr>
                  </tbody>
                </table>
              </Scroll>
            </>
          )}
        </Section>

        <Section n="1.5" title={t('Mingguan')} sub={t('Minggu Senin sampai Minggu. * = minggu yang dipotong batas periode; tidak dibandingkan sebagai minggu penuh.')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rp-keep border-[1.5px] border-ink p-3">
              <p className="text-caption text-mute">{t('Minggu penuh terbaik')}</p>
              <p className="font-display text-heading font-extrabold">{bestWeek ? money0(bestWeek.sales) : '-'}</p>
              <p className="font-mono text-caption text-mute">{bestWeek ? shortWeek(bestWeek.week) : t('Belum ada minggu penuh.')}</p>
            </div>
            <div className="rp-keep border-[1.5px] border-ink p-3">
              <p className="text-caption text-mute">{t('Minggu penuh terendah')}</p>
              <p className="font-display text-heading font-extrabold">{lowWeek ? money0(lowWeek.sales) : '-'}</p>
              <p className="font-mono text-caption text-mute">{lowWeek ? shortWeek(lowWeek.week) : t('Belum ada minggu penuh.')}</p>
            </div>
          </div>
          {chunk(wstats, BLOCK).map((block, bi) => (
            <Scroll key={bi}>
              <table className="rp-tbl mt-4 rp-keep">
                <thead>
                  <tr>
                    <th scope="col">{t('Minggu')}</th>
                    <th scope="col" className="n">{t('Hari')}</th>
                    <th scope="col" className="n">{t('Nota')}</th>
                    <th scope="col" className="n">{t('Porsi')}</th>
                    <th scope="col" className="n">{t('Omzet')}</th>
                    <th scope="col" className="n">{t('Rata-rata/hari')}</th>
                    <th scope="col" className="n">{t('vs mgg lalu')}</th>
                    <th scope="col" className="n">{t('Nota tunai')}</th>
                    <th scope="col" className="n">{t('Nota QRIS')}</th>
                  </tr>
                </thead>
                <tbody>
                  {block.map((w) => (
                    <tr key={w.week.start}>
                      <td>{weekHead(w.week)}</td>
                      <td className="n">{w.activeDays}</td>
                      <td className="n">{w.count}</td>
                      <td className="n">{w.portions}</td>
                      <td className="n">{amount(w.sales)}</td>
                      <td className="n">{amount(w.perDay)}</td>
                      <td className="n">{w.vsPrev === null ? '-' : signedPct(w.vsPrev, lang)}</td>
                      <td className="n">{w.cashCount}</td>
                      <td className="n">{w.qrisCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          ))}
          <figure className="mt-5">
            <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Omzet per minggu (juta rupiah)')}</figcaption>
            <ColumnBars bars={wstats.map((w) => ({ label: w.week.start.slice(5), value: w.sales, tone: w.week.partial ? 'bg-pine/40' : undefined }))} format={chartM} caption={t('Omzet per minggu (juta rupiah)')} />
          </figure>
          <figure className="mt-5">
            <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Rata-rata omzet per hari berjualan (ribu rupiah)')}</figcaption>
            <LineChart
              labels={wstats.map((w) => w.week.start.slice(5))}
              series={[{ name: t('Rata-rata per hari'), values: wstats.map((w) => w.perDay) }]}
              format={(v) => decimal(v / 1000, lang)}
              caption={t('Rata-rata omzet per hari berjualan (ribu rupiah)')}
            />
          </figure>
        </Section>

        <Section n="1.6" title={t('Pola mingguan')}>
          <figure>
            <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Nota per minggu, tunai dan QRIS')}</figcaption>
            <StackedBars
              cols={wstats.map((w) => ({ label: w.week.start.slice(5), a: w.cashCount, b: w.qrisCount }))}
              aLabel={t('Tunai')}
              bLabel="QRIS"
              caption={t('Nota per minggu, tunai dan QRIS')}
            />
          </figure>
          <p className="mt-5 text-[12.5px] font-semibold">{t('Peta omzet harian (ribu rupiah). Abu-abu = di luar periode.')}</p>
          {chunk(weeks, BLOCK).map((wk, bi) => (
            <div key={bi} className="mt-2">
              <Heatmap
                rows={[0, 1, 2, 3, 4, 5, 6].map((i) => weekdayShort(i))}
                cols={wk.map((w) => w.start.slice(5))}
                cells={heatmapOf(B, wk)}
                format={(v) => decimal(v / 1000, lang)}
                caption={t('Peta omzet harian (ribu rupiah). Abu-abu = di luar periode.')}
              />
            </div>
          ))}
          <figure className="mt-5">
            <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Tren 5 menu terlaris, porsi per hari berjualan')}</figcaption>
            <LineChart
              labels={weeks.map((w) => w.start.slice(5))}
              series={menu.rows.slice(0, 5).map((m, i) => ({ name: m.name, values: trendPerActiveDay(B, I, weeks, [m.name])[0], tone: i === 0 ? 'fire' : undefined }))}
              format={(v) => decimal(v, lang)}
              caption={t('Tren 5 menu terlaris, porsi per hari berjualan')}
            />
          </figure>
        </Section>

        <Section n="1.7" title={t('Menu per minggu')} sub={t('Dua belas menu terlaris, porsi per minggu, dan lima menu teratas tiap minggu.')}>
          {weeks.length > 0 && menu.rows.length > 0 && (
            <>
              <MenuWeeks names={menu.rows.slice(0, 12).map((m) => m.name)} weeks={weeks} items={I} />
              <table className="rp-tbl mt-4">
                <thead>
                  <tr>
                    <th scope="col">{t('Minggu')}</th>
                    <th scope="col">{t('5 menu teratas')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topPerWeek(I, weeks, 5).map((x) => (
                    <tr key={x.week.start}>
                      <td>{weekHead(x.week)}</td>
                      <td>{x.menus.map((m) => `${m.name} (${decimal(m.qty, lang)})`).join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>

        <Section n="1.8" title={t('Laporan tiap bulan')} sub={t('Satu bagian per bulan di periode. Bulan yang belum penuh ditandai *.')}>
          {months.map((m, i) => (
            <div key={m.key} className={i > 0 ? 'print:break-before-page' : undefined}>
              <SalesMonth month={m} bills={B} items={I} lang={lang} />
            </div>
          ))}
        </Section>

        <Section n="1.9" title={t('Pola waktu dan pelanggan')}>
          <p className="text-[12.5px] font-semibold">{t('Hari dalam seminggu')}</p>
          <Scroll>
            <table className="rp-tbl mt-1">
              <thead>
                <tr>
                  <th scope="col">{t('Hari')}</th>
                  <th scope="col" className="n">{t('Hari kalender')}</th>
                  <th scope="col" className="n">{t('Nota')}</th>
                  <th scope="col" className="n">{t('Omzet')}</th>
                  <th scope="col" className="n">{t('Rata-rata per hari')}</th>
                </tr>
              </thead>
              <tbody>
                {weekdaysOf(B, days).map((w) => (
                  <tr key={w.index}>
                    <td>{weekdayName(w.index)}</td>
                    <td className="n">{w.calendarDays}</td>
                    <td className="n">{w.count}</td>
                    <td className="n">{amount(w.total)}</td>
                    <td className="n">{amount(w.avgPerDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          <p className="mt-4 text-[12.5px] font-semibold">{t('Jam transaksi')}</p>
          <Scroll>
            <table className="rp-tbl mt-1">
              <thead>
                <tr>
                  <th scope="col">{t('Jam')}</th>
                  <th scope="col" className="n">{t('Nota')}</th>
                  <th scope="col" className="n">%</th>
                  <th scope="col" className="n">{t('Omzet')}</th>
                </tr>
              </thead>
              <tbody>
                {hoursOf(B).filter((h) => h.count > 0).map((h) => (
                  <tr key={h.hour}>
                    <td>{`${String(h.hour).padStart(2, '0')}.00`}</td>
                    <td className="n">{h.count}</td>
                    <td className="n">{`${decimal(h.share, lang)}%`}</td>
                    <td className="n">{amount(h.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          <p className="mt-4 text-[12.5px] font-semibold">{t('Sepuluh pelanggan dengan belanja tertinggi')}</p>
          <p className="text-caption text-mute">{t('Nama dari bill. Nama kosong, Umum, Tamu, dan nomor meja tidak dihitung.')}</p>
          {topCustomers(B, 10).length === 0 ? (
            <p className="mt-2 text-mute">{t('Belum ada pelanggan bernama di periode ini.')}</p>
          ) : (
            <Scroll>
              <table className="rp-tbl mt-1">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t('Pelanggan')}</th>
                    <th scope="col" className="n">{t('Nota')}</th>
                    <th scope="col" className="n">{t('Belanja')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers(B, 10).map((c, i) => (
                    <tr key={c.name}>
                      <td>{i + 1}</td>
                      <td>{c.name}</td>
                      <td className="n">{c.count}</td>
                      <td className="n">{amount(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          )}
        </Section>
      </Sheet>

      <Sheet n={2} {...sheet}>
        <Part n="2" title={t('Pengeluaran')} />
        <Section n="2.1" title={t('Angka utama')}>
          <dl className="rp-keep grid grid-cols-2 gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-4 print:grid-cols-4">
            <Kpi label={t('Total pengeluaran')} value={big(ex.total, lang)} sub="" />
            <Kpi label={t('Jumlah item')} value={String(ex.entries)} sub="" />
            <Kpi label={t('Hari ada pengeluaran')} value={String(ex.dayCount)} sub={t('dari {n} hari', { n: span })} />
            <Kpi label={t('Rata-rata per hari')} value={big(ex.avgPerDay, lang)} sub={t('per hari kalender')} />
            <Kpi label={t('Belanja bahan')} value={big(ex.belanja, lang)} sub={pct(ex.belanja, ex.total)} />
            <Kpi label={t('Operasional')} value={big(ex.operasional, lang)} sub={pct(ex.operasional, ex.total)} />
            <Kpi label={t('Dari laci')} value={big(ex.drawer, lang)} sub={pct(ex.drawer, ex.total)} />
            <Kpi label={t('Bukan dari laci')} value={big(ex.other, lang)} sub={pct(ex.other, ex.total)} />
          </dl>
        </Section>
        {ex.entries === 0 ? (
          <p className="mt-6 text-mute">{t('Belum ada pengeluaran di periode ini.')}</p>
        ) : (
          <>
            <Section n="2.2" title={t('Per bulan')}>
              <Scroll>
                <table className="rp-tbl">
                  <thead>
                    <tr>
                      <th scope="col">{t('Bulan')}</th>
                      <th scope="col" className="n">{t('Hari')}</th>
                      <th scope="col" className="n">{t('Item')}</th>
                      <th scope="col" className="n">{t('Belanja')}</th>
                      <th scope="col" className="n">{t('Operasional')}</th>
                      <th scope="col" className="n">{t('Total')}</th>
                      <th scope="col" className="n">{t('Rata-rata/hari')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => {
                      const xs = expensesIn(E, m.days);
                      const st = expenseStats(xs, m.days);
                      return (
                        <tr key={m.key}>
                          <td>{monthHead(m)}</td>
                          <td className="n">{st.dayCount}</td>
                          <td className="n">{st.entries}</td>
                          <td className="n">{amount(st.belanja)}</td>
                          <td className="n">{amount(st.operasional)}</td>
                          <td className="n">{amount(st.total)}</td>
                          <td className="n">{amount(st.avgPerDay)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Scroll>
              <figure className="mt-5">
                <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Pengeluaran harian (juta rupiah)')}</figcaption>
                <ColumnBars bars={exDaily.map((d) => ({ label: d.day.slice(8, 10), value: d.total }))} format={chartM} caption={t('Pengeluaran harian (juta rupiah)')} />
              </figure>
              <figure className="mt-5">
                <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Pengeluaran per bulan (juta rupiah)')}</figcaption>
                <ColumnBars bars={months.map((m) => ({ label: m.key.slice(5), value: expenseStats(expensesIn(E, m.days), m.days).total }))} format={chartM} caption={t('Pengeluaran per bulan (juta rupiah)')} />
              </figure>
            </Section>

            <Section n="2.3" title={t('Per kategori dan sumber dana')}>
              <Scroll>
                <table className="rp-tbl">
                  <thead>
                    <tr>
                      <th scope="col">{t('Kategori')}</th>
                      <th scope="col" className="n">{t('Jumlah')}</th>
                      <th scope="col" className="n">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>{t('Belanja bahan')}</td><td className="n">{amount(ex.belanja)}</td><td className="n">{pct(ex.belanja, ex.total)}</td></tr>
                    <tr><td>{t('Operasional')}</td><td className="n">{amount(ex.operasional)}</td><td className="n">{pct(ex.operasional, ex.total)}</td></tr>
                    <tr><td>{t('Dari laci')}</td><td className="n">{amount(ex.drawer)}</td><td className="n">{pct(ex.drawer, ex.total)}</td></tr>
                    <tr><td>{t('Bukan dari laci')}</td><td className="n">{amount(ex.other)}</td><td className="n">{pct(ex.other, ex.total)}</td></tr>
                    <tr className="tot"><td>{t('Total')}</td><td className="n">{amount(ex.total)}</td><td className="n">{ex.total ? '100%' : '-'}</td></tr>
                  </tbody>
                </table>
              </Scroll>
            </Section>

            <Section n="2.4" title={t('Item terbesar')}>
              <HBars rows={exRank.rows.slice(0, 10).map((x) => ({ label: x.name, value: x.total, share: x.share }))} format={amountText(lang)} caption={t('Item pengeluaran terbesar')} />
              <Scroll>
                <table className="rp-tbl mt-4">
                  <thead>
                    <tr>
                      <th scope="col">{t('Item')}</th>
                      <th scope="col" className="n">{t('Kali')}</th>
                      <th scope="col" className="n">{t('Total')}</th>
                      <th scope="col" className="n">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exRank.rows.map((x) => (
                      <tr key={x.name}>
                        <td>{x.name}</td>
                        <td className="n">{x.count}</td>
                        <td className="n">{amount(x.total)}</td>
                        <td className="n">{`${decimal(x.share, lang)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </Section>

            <Section n="2.5" title={t('Mingguan')} sub={t('* = minggu yang dipotong batas periode.')}>
              {(() => {
                const xs = weeks.map((w) => ({ w, total: expenseStats(expensesIn(E, w.days), w.days).total, st: expenseStats(expensesIn(E, w.days), w.days) }));
                const fullW = xs.filter((x) => !x.w.partial && x.total > 0);
                const hi = fullW.reduce<(typeof fullW)[number] | null>((b, x) => (!b || x.total > b.total ? x : b), null);
                const lo = fullW.reduce<(typeof fullW)[number] | null>((b, x) => (!b || x.total < b.total ? x : b), null);
                return (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rp-keep border-[1.5px] border-ink p-3">
                        <p className="text-caption text-mute">{t('Minggu penuh tertinggi')}</p>
                        <p className="font-display text-heading font-extrabold">{hi ? money0(hi.total) : '-'}</p>
                        <p className="font-mono text-caption text-mute">{hi ? shortWeek(hi.w) : t('Belum ada minggu penuh.')}</p>
                      </div>
                      <div className="rp-keep border-[1.5px] border-ink p-3">
                        <p className="text-caption text-mute">{t('Minggu penuh terendah')}</p>
                        <p className="font-display text-heading font-extrabold">{lo ? money0(lo.total) : '-'}</p>
                        <p className="font-mono text-caption text-mute">{lo ? shortWeek(lo.w) : t('Belum ada minggu penuh.')}</p>
                      </div>
                    </div>
                    {chunk(xs, BLOCK).map((block, bi) => (
                      <Scroll key={bi}>
                        <table className="rp-tbl mt-4 rp-keep">
                          <thead>
                            <tr>
                              <th scope="col">{t('Minggu')}</th>
                              <th scope="col" className="n">{t('Hari')}</th>
                              <th scope="col" className="n">{t('Item')}</th>
                              <th scope="col" className="n">{t('Belanja')}</th>
                              <th scope="col" className="n">{t('Operasional')}</th>
                              <th scope="col" className="n">{t('Total')}</th>
                              <th scope="col" className="n">{t('vs mgg lalu')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {block.map((x, i) => {
                              const idx = bi * BLOCK + i;
                              const prev = idx > 0 ? xs[idx - 1].total : 0;
                              return (
                                <tr key={x.w.start}>
                                  <td>{weekHead(x.w)}</td>
                                  <td className="n">{x.st.dayCount}</td>
                                  <td className="n">{x.st.entries}</td>
                                  <td className="n">{amount(x.st.belanja)}</td>
                                  <td className="n">{amount(x.st.operasional)}</td>
                                  <td className="n">{amount(x.total)}</td>
                                  <td className="n">{idx === 0 || !prev ? '-' : signedPct(((x.total - prev) / prev) * 100, lang)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </Scroll>
                    ))}
                    <figure className="mt-5">
                      <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Pengeluaran per minggu (juta rupiah)')}</figcaption>
                      <ColumnBars bars={xs.map((x) => ({ label: x.w.start.slice(5), value: x.total, tone: x.w.partial ? 'bg-pine/40' : undefined }))} format={chartM} caption={t('Pengeluaran per minggu (juta rupiah)')} />
                    </figure>
                  </>
                );
              })()}
            </Section>
          </>
        )}
      </Sheet>

      {months.length > 0 && ex.entries > 0 && (
        <Sheet n={2} {...sheet} continued>
          <Section n="2.6" title={t('Tiap bulan')}>
            {months.map((m, i) => (
              <div key={m.key} className={i > 0 ? 'print:break-before-page' : undefined}>
                <ExpenseMonth month={m} expenses={E} lang={lang} />
              </div>
            ))}
          </Section>
        </Sheet>
      )}

      <Sheet n={3} {...sheet}>
        <Part n="3" title={t('Ringkasan')} />
        <dl className="rp-keep grid grid-cols-2 gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-4 print:grid-cols-4">
          <Kpi label={t('Penjualan bersih')} value={big(cur.netSales, lang)} sub={t('margin {pct}', { pct: pct(cur.grossProfit, cur.netSales) })} />
          <Kpi label={t('Laba kotor')} value={big(cur.grossProfit, lang)} sub={t('margin {pct}', { pct: pct(cur.grossProfit, cur.netSales) })} />
          <Kpi label={t('Laba operasional')} value={big(cur.operatingProfit, lang)} sub={t('margin {pct}', { pct: pct(cur.operatingProfit, cur.netSales) })} />
          <Kpi label={t('Pengeluaran')} value={big(ex.total, lang)} sub={t('{pct} dari omzet', { pct: pct(ex.total, sales.sales) })} />
        </dl>
        <Section n="3.1" title={t('Penjualan dibanding pengeluaran per bulan')}>
          <Scroll>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Bulan')}</th>
                  <th scope="col" className="n">{t('Omzet')}</th>
                  <th scope="col" className="n">{t('Pengeluaran')}</th>
                  <th scope="col" className="n">{t('Selisih')}</th>
                  <th scope="col" className="n">{t('Pengeluaran dari omzet')}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const omzet = salesStats(billsIn(B, m.days), [], m.days).sales;
                  const exp = expenseStats(expensesIn(E, m.days), m.days).total;
                  return (
                    <tr key={m.key}>
                      <td>{monthHead(m)}</td>
                      <td className="n">{amount(omzet)}</td>
                      <td className="n">{amount(exp)}</td>
                      <td className="n">{acct(omzet - exp)}</td>
                      <td className="n">{pct(exp, omzet)}</td>
                    </tr>
                  );
                })}
                <tr className="tot">
                  <td>{t('Total')}</td>
                  <td className="n">{amount(sales.sales)}</td>
                  <td className="n">{amount(ex.total)}</td>
                  <td className="n">{acct(sales.sales - ex.total)}</td>
                  <td className="n">{pct(ex.total, sales.sales)}</td>
                </tr>
              </tbody>
            </table>
          </Scroll>
        </Section>
                <Section n="3.2" title={t('Laba rugi sederhana')} sub={t('Basis akrual sederhana. HPP dari harga pokok per produk yang dicatat di backoffice.')}>
          <Scroll>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Pos')}</th>
                  <th scope="col" className="n">
                    {t('Periode ini')}
                  </th>
                  <th scope="col" className="n">
                    {t('Sebelumnya')}
                  </th>
                  <th scope="col" className="n">
                    {t('Selisih')}
                  </th>
                  <th scope="col" className="n">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                <PnlRow label={t('Penjualan kotor')} k="grossSales" sign={1} cur={cur} prev={prev} lang={lang} />
                <PnlRow label={t('Diskon dan voucher')} k="discounts" sign={-1} cur={cur} prev={prev} lang={lang} indent />
                <PnlRow label={t('Refund')} k="refunds" sign={-1} cur={cur} prev={prev} lang={lang} indent />
                {(cur.adjustments !== 0 || prev.adjustments !== 0) && (
                  <PnlRow label={t('Koreksi omzet lama')} k="adjustments" sign={1} cur={cur} prev={prev} lang={lang} indent />
                )}
                <PnlRow label={t('Penjualan bersih')} k="netSales" sign={1} cur={cur} prev={prev} lang={lang} kind="sub" />
                <PnlRow label={t('Harga pokok penjualan (HPP)')} k="hpp" sign={-1} cur={cur} prev={prev} lang={lang} indent />
                <PnlRow label={t('Laba kotor')} k="grossProfit" sign={1} cur={cur} prev={prev} lang={lang} kind="sub" />
                <tr className="note">
                  <td>{t('Margin laba kotor')}</td>
                  <td className="n">{pct(cur.grossProfit, cur.netSales)}</td>
                  <td className="n">{pct(prev.grossProfit, prev.netSales)}</td>
                  <td />
                  <td />
                </tr>
                <PnlRow label={t('Pengeluaran operasional')} k="operatingExpenses" sign={-1} cur={cur} prev={prev} lang={lang} indent />
                {(cur.stockAdjustments !== 0 || prev.stockAdjustments !== 0) && (
                  <PnlRow label={t('Stok hilang, rusak, dan selisih hitung')} k="stockAdjustments" sign={-1} cur={cur} prev={prev} lang={lang} indent />
                )}
                {(cur.cashDifference !== 0 || prev.cashDifference !== 0) && (
                  <PnlRow label={t('Selisih kas laci')} k="cashDifference" sign={1} cur={cur} prev={prev} lang={lang} indent />
                )}
                {(cur.qrisDifference !== 0 || prev.qrisDifference !== 0) && (
                  <PnlRow label={t('Selisih QRIS')} k="qrisDifference" sign={1} cur={cur} prev={prev} lang={lang} indent />
                )}
                <PnlRow label={t('Laba operasional')} k="operatingProfit" sign={1} cur={cur} prev={prev} lang={lang} kind="tot" />
                <tr className="note">
                  <td>{t('Margin operasional')}</td>
                  <td className="n">{pct(cur.operatingProfit, cur.netSales)}</td>
                  <td className="n">{pct(prev.operatingProfit, prev.netSales)}</td>
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>
          </Scroll>
          <p className="mt-3 text-caption text-mute">
            {t(
              'Angka dalam kurung adalah pengurang. Pembelian bahan ({amount}) tidak masuk laba rugi karena sudah ada di HPP.',
              { amount: money(cur.inventoryPurchases) },
            )}
          </p>
        </Section>
      
      </Sheet>

      <Sheet n={3} {...sheet} continued>
                <Section
          n="3.3"
          title={t('Rekonsiliasi kas laci')}
          sub={
            t('{n} shift yang sudah ditutup, dari buku kas.', { n: r.cash.closed }) +
            (r.cash.open ? ` ${t('{n} shift masih buka, belum dihitung.', { n: r.cash.open })}` : '')
          }
        >
          <div className="grid items-start gap-6 md:grid-cols-2 print:grid-cols-2">
            <table className="rp-tbl">
              <tbody>
                <tr>
                  <td>{t('Kas awal')}</td>
                  <td className="n">{amount(r.drawer.opening)}</td>
                </tr>
                <tr>
                  <td>{t('Penjualan tunai')}</td>
                  <td className="n">{amount(r.drawer.cashSales)}</td>
                </tr>
                <tr>
                  <td>{t('Refund tunai')}</td>
                  <td className="n">{acct(-r.drawer.refunds)}</td>
                </tr>
                {r.drawer.expenses !== 0 && (
                  <tr>
                    <td>{t('Pengeluaran dari laci')}</td>
                    <td className="n">{acct(-r.drawer.expenses)}</td>
                  </tr>
                )}
                {r.drawer.other !== 0 && (
                  <tr>
                    <td>{t('Lainnya')}</td>
                    <td className="n">{acct(r.drawer.other)}</td>
                  </tr>
                )}
                <tr className="sub">
                  <td>{t('Kas seharusnya')}</td>
                  <td className="n">{amount(r.drawer.expected)}</td>
                </tr>
                <tr>
                  <td>{t('Hitungan kasir')}</td>
                  <td className="n">{amount(r.drawer.counted)}</td>
                </tr>
                <tr className="tot">
                  <td>{t('Selisih')}</td>
                  <td className={`n ${r.cash.variance < 0 ? 'text-error' : ''}`}>{acct(r.cash.variance)}</td>
                </tr>
              </tbody>
            </table>
            <div>
              <table className="rp-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t('Shift dengan selisih')}</th>
                    <th scope="col" className="n">
                      {t('Jumlah')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {closedWithDiff.slice(0, 12).map((x) => (
                    <tr key={x.id}>
                      <td>
                        {dateLong(x.businessDate.slice(0, 10), lang, 'UTC')} · {x.outletName}
                        <span className="block text-mute">{t('Kasir {name}, shift {n}', { name: x.cashierName, n: x.shiftNumber })}</span>
                      </td>
                      <td className={`n ${x.variance! < 0 ? 'text-error' : ''}`}>{acct(x.variance!)}</td>
                    </tr>
                  ))}
                  {closedWithDiff.length === 0 && (
                    <tr className="note">
                      <td colSpan={2}>{t('Tidak ada shift dengan selisih.')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="mt-3 text-caption text-mute">
                {/* Counted on the server: the shift list stops at 500 rows. */}
                {r.cash.shortCount + r.cash.overCount > 12 &&
                  `${t('Dan {n} shift lainnya dengan selisih.', { n: r.cash.shortCount + r.cash.overCount - 12 })} `}
                {t('{n} shift lainnya sesuai, selisih Rp0.', { n: r.cash.matched })}
              </p>
            </div>
          </div>
        </Section>
        <Section n="3.4" title={t('Arus kas')}>
          <div className="grid items-start gap-6 md:grid-cols-2 print:grid-cols-2">
            <div>
              <table className="rp-tbl">
                <tbody>
                  <tr>
                    <td>{t('Penjualan tunai, setelah refund')}</td>
                    <td className="n">{acct(s.cash)}</td>
                  </tr>
                  <tr>
                    <td>{t('Penjualan QRIS, setelah refund')}</td>
                    <td className="n">{acct(s.qris)}</td>
                  </tr>
                  <tr className="sub">
                    <td>{t('Uang masuk')}</td>
                    <td className="n">{acct(s.cash + s.qris)}</td>
                  </tr>
                  <tr>
                    <td>{t('Pengeluaran operasional')}</td>
                    <td className="n">{acct(-r.expenses.operasional)}</td>
                  </tr>
                  <tr>
                    <td>{t('Pembelian bahan')}</td>
                    <td className="n">{acct(-r.expenses.belanja)}</td>
                  </tr>
                  <tr className="sub">
                    <td>{t('Uang keluar')}</td>
                    <td className="n">{acct(-r.expenses.total)}</td>
                  </tr>
                  <tr className="tot">
                    <td>{t('Arus kas bersih')}</td>
                    <td className={`n ${s.cash + s.qris - r.expenses.total < 0 ? 'text-error' : 'text-pine'}`}>{acct(s.cash + s.qris - r.expenses.total)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-caption text-mute">{t('QRIS masuk ke rekening outlet, bukan ke laci.')}</p>
            </div>
            <div>
              <table className="rp-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t('Dibayar dari')}</th>
                    <th scope="col" className="n">
                      {t('Jumlah')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{t('Kas laci outlet')}</td>
                    <td className="n">{amount(r.expenses.drawer)}</td>
                  </tr>
                  <tr>
                    <td>{t('Bukan dari laci')}</td>
                    <td className="n">{amount(r.expenses.other)}</td>
                  </tr>
                  <tr className="tot">
                    <td>{t('Total')}</td>
                    <td className="n">{amount(r.expenses.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Section>
                <div className="grid items-start gap-x-6 md:grid-cols-2 print:grid-cols-2">
          <Section n="3.5" title={t('Per outlet')}>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Outlet')}</th>
                  <th scope="col" className="n">
                    {t('Penjualan')}
                  </th>
                  <th scope="col" className="n">
                    {t('Porsi')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...s.byOutlet]
                  .sort((a, b) => b.sales - a.sales)
                  .map((o) => (
                    <tr key={o.outletId}>
                      <td>{o.name}</td>
                      <td className="n">{acct(o.sales)}</td>
                      <td className="n">{pct(o.sales, s.sales)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Section>
          <Section n="3.6" title={t('Per kasir')}>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Kasir')}</th>
                  <th scope="col" className="n">
                    {t('Bill')}
                  </th>
                  <th scope="col" className="n">
                    {t('Penjualan')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.byCashier.map((c) => (
                  <tr key={c.cashierId}>
                    <td>
                      {c.name}
                      {!outlet && r.cashierOutlets[c.cashierId] ? ` · ${r.cashierOutlets[c.cashierId]}` : ''}
                    </td>
                    <td className="n">{c.count}</td>
                    <td className="n">{acct(c.sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
                <Section n="3.7" title={t('Kinerja produk')} sub={t('Urut dari penjualan terbesar. Margin adalah laba kotor dibagi penjualan.')}>
          <Scroll>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Produk')}</th>
                  <th scope="col" className="n">
                    {t('Terjual')}
                  </th>
                  <th scope="col" className="n">
                    {t('Penjualan')}
                  </th>
                  <th scope="col" className="n">
                    {t('Modal (HPP)')}
                  </th>
                  <th scope="col" className="n">
                    {t('Laba kotor')}
                  </th>
                  <th scope="col" className="n">
                    {t('Margin')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.products.map((p) => {
                  const m = p.sales ? (p.profit / p.sales) * 100 : 0;
                  return (
                    <tr key={p.name}>
                      <td>
                        {p.name}
                        <span className="block text-caption text-mute">{p.category || t('Tanpa kategori')}</span>
                      </td>
                      <td className="n">{qty(p.qty)}</td>
                      <td className="n">{amount(p.sales)}</td>
                      <td className="n">{amount(p.hpp)}</td>
                      <td className="n">{acct(p.profit)}</td>
                      <td className={`n ${p.sales && m < redBelow ? 'text-error' : ''}`}>{p.sales ? `${decimal(m, lang)}%` : '-'}</td>
                    </tr>
                  );
                })}
                <tr className="tot">
                  <td>{t('Total')}</td>
                  <td className="n">{qty(r.productTotals.qty)}</td>
                  <td className="n">{amount(r.productTotals.sales)}</td>
                  <td className="n">{amount(r.productTotals.hpp)}</td>
                  <td className="n">{acct(r.productTotals.sales - r.productTotals.hpp)}</td>
                  <td className="n">{pct(r.productTotals.sales - r.productTotals.hpp, r.productTotals.sales)}</td>
                </tr>
              </tbody>
            </table>
          </Scroll>
          <p className="mt-2 text-caption text-mute">
            {t('Setelah semua diskon, sebelum refund. Margin di bawah {x}% ditandai merah.', {
              x: decimal(redBelow, lang),
            })}
            {r.productCount > r.products.length
              ? ` ${t('Menampilkan {n} dari {m} menu dengan penjualan terbesar; total mencakup semuanya.', { n: r.products.length, m: r.productCount })}`
              : ''}
          </p>
          {r.byCategory.length > 1 && (
            <div className="mt-5">
              <h3 className="font-semibold">{t('Per kategori')}</h3>
              <Scroll>
                <table className="rp-tbl mt-1">
                  <thead>
                    <tr>
                      <th scope="col">{t('Kategori')}</th>
                      <th scope="col" className="n">
                        {t('Terjual')}
                      </th>
                      <th scope="col" className="n">
                        {t('Penjualan')}
                      </th>
                      <th scope="col" className="n">
                        {t('Laba kotor')}
                      </th>
                      <th scope="col" className="n">
                        {t('Margin')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byCategory.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name || t('Tanpa kategori')}</td>
                        <td className="n">{qty(c.qty)}</td>
                        <td className="n">{amount(c.sales)}</td>
                        <td className="n">{acct(c.sales - c.hpp)}</td>
                        <td className="n">{pct(c.sales - c.hpp, c.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </div>
          )}
        </Section>
                <Section n="3.8" title={t('Void dan diskon')}>
          <div className="grid items-start gap-6 md:grid-cols-2 print:grid-cols-2">
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Void per kasir')}</th>
                  <th scope="col" className="n">
                    {t('Bill')}
                  </th>
                  <th scope="col" className="n">
                    {t('Nilai')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.voidsByCashier.map((v) => (
                  <tr key={v.name}>
                    <td>{v.name}</td>
                    <td className="n">{v.count}</td>
                    <td className="n">{amount(v.total)}</td>
                  </tr>
                ))}
                {r.voidsByCashier.length === 0 && (
                  <tr className="note">
                    <td colSpan={3}>{t('Tidak ada void.')}</td>
                  </tr>
                )}
                <tr className="tot">
                  <td>{t('Total, {pct} dari penjualan', { pct: pct(s.voidedTotal, cur.grossSales) })}</td>
                  <td className="n">{s.voidedCount}</td>
                  <td className="n">{amount(s.voidedTotal)}</td>
                </tr>
              </tbody>
            </table>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Diskon')}</th>
                  <th scope="col" className="n">
                    {t('Dipakai')}
                  </th>
                  <th scope="col" className="n">
                    {t('Nilai')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.discounts.map((d) => (
                  <tr key={d.voucher ?? '-'}>
                    <td>{d.voucher ? t('Voucher {code}', { code: d.voucher }) : t('Diskon manual kasir')}</td>
                    <td className="n">{d.count}</td>
                    <td className="n">{amount(d.amount)}</td>
                  </tr>
                ))}
                {r.discounts.length === 0 && (
                  <tr className="note">
                    <td colSpan={3}>{t('Tidak ada diskon.')}</td>
                  </tr>
                )}
                <tr className="tot">
                  <td>{t('Total')}</td>
                  <td className="n">{r.discounts.reduce((n, d) => n + d.count, 0)}</td>
                  <td className="n">{amount(cur.discounts)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      </Sheet>

      <Sheet n={4} {...sheet} last>
        <Part n="4" title={t('Insight')} />
        <Section n="4.1" title={t('Insight')} sub={t('Kalimat dari angka periode ini. Setiap kalimat menyebut bagian sumbernya. Kalimat hanya muncul kalau datanya ada.')}>
          {insights.length === 0 ? (
            <p className="text-mute">{t('Belum ada insight: data periode ini belum cukup.')}</p>
          ) : (
            <ul className="list-disc space-y-1.5 pl-5 text-[13.5px]">
              {insights.map((ins) => {
                const vars = Object.fromEntries(Object.entries(ins.params).map(([k, p]) => [k, fmt(p)]));
                return (
                  <li key={ins.key + JSON.stringify(vars)}>
                    {t(ins.key, vars)} <span className="text-mute">({ins.source.replace('BAB', t('BAB'))})</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section n="4.2" title={t('Catatan dan definisi')}>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-mute">
            <li>{t('Omzet: jumlah total bill berstatus selesai, menurut waktu bill di zona waktu bisnis. Refund dan void tidak dikurangi di BAB 1; keduanya ada di BAB 3.')}</li>
            <li>{t('Nilai harga menu: porsi kali harga jual, sebelum diskon. Porsi: jumlah kuantitas item bill selesai.')}</li>
            <li>{t('Minggu: Senin sampai Minggu, dipotong batas periode dan batas bulan. Hari berjualan: hari dengan minimal satu bill selesai.')}</li>
            <li>{t('Pengeluaran: item pengeluaran yang tidak dibatalkan, menurut tanggal bisnis shiftnya. Dibayar dari laci atau dari luar.')}</li>
            <li>{t('Pelanggan: nama di bill. Nama kosong, Umum, Tamu, dan nama berupa angka (nomor meja) tidak dihitung. Nama yang hanya beda huruf besar kecil digabung.')}</li>
            <li>{t('Penjualan bersih: penjualan kotor dikurangi diskon, voucher, dan refund. PPN belum dicatat.')}</li>
            <li>{t('HPP memakai harga pokok produk saat bill dibuat. Harga pokok kosong dihitung Rp0.')}</li>
            <li>{t('Bill offline masuk setelah tersinkron. Bill yang masih antre di perangkat belum masuk.')}</li>
            <li>{t('Sumber data: aplikasi kasir {brand} dan menu Pengeluaran di backoffice.', { brand: BRAND_UPPER })}</li>
          </ul>
        </Section>
        <div className="rp-keep mt-12 grid gap-6 sm:grid-cols-3 print:grid-cols-3">
          <Sign title={t('Disusun otomatis')} text={`${BRAND_UPPER}, ${created}`} />
          <Sign title={t('Diperiksa oleh')} text={t('Nama, tanggal, paraf')} />
          <Sign title={t('Disetujui oleh')} text={t('Nama, tanggal, paraf')} />
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

/** Accountant style: reductions in brackets. */
const acct = (n: number) => (n < 0 ? `(${amount(-n)})` : amount(n));
const signedPct = (v: number, lang: 'id' | 'en') => `${v > 0 ? '+' : ''}${decimal(v, lang)}%`;
const big = (n: number, lang: 'id' | 'en') => `${n < 0 ? '-' : ''}Rp${decimal(Math.abs(n) / 1_000_000, lang, 2)}${lang === 'en' ? 'M' : 'jt'}`;
const amountText = (lang: 'id' | 'en') => (v: number) => decimal(v / 1000, lang) + ' rb';
const qty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
/** Menu value (porsi x harga jual) of one menu over all its rows. */
const menuValue = (I: ItemRow[], name: string) => {
  const k = name.trim().toLowerCase();
  return I.filter((i) => i.name.trim().toLowerCase() === k).reduce((n, i) => n + i.value, 0);
};

function Part({ n, title }: { n: string; title: string }) {
  return (
    <div className="mt-8 border-b-[3px] border-ink pb-1">
      <p className="font-mono text-caption text-mute">BAB {n}</p>
      <h2 className="font-display text-[clamp(22px,4vw,30px)] font-extrabold tracking-[-0.03em]">{title}</h2>
    </div>
  );
}

/** One month of the sales part (1.8). */
function SalesMonth({ month, bills, items, lang }: { month: Month; bills: Bill[]; items: ItemRow[]; lang: 'id' | 'en' }) {
  const { t } = useI18n();
  const B = billsIn(bills, month.days);
  const I = itemsIn(items, month.days);
  const st = salesStats(B, I, month.days);
  const weeks = weeksOf(month.from, month.to);
  const ws = weekStats(B, I, weeks);
  const hrs = hoursOf(B).filter((h) => h.count > 0).sort((a, z) => z.count - a.count || a.hour - z.hour).slice(0, 2);
  const wd = weekdaysOf(B, month.days).filter((w) => w.total > 0);
  const busiest = wd.length ? wd.reduce((b, w) => (w.avgPerDay > b.avgPerDay ? w : b)) : null;
  const menu = menuRanking(I);
  const top8 = menu.rows.slice(0, 8).map((m) => m.name);
  const chartM = (v: number) => decimal(v / 1_000_000, lang, 1);
  const weekdayName = (i: number) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${addDay('2024-01-01', i)}T12:00:00Z`));
  return (
    <div className="mt-6">
      <h3 className="font-display text-[20px] font-extrabold tracking-[-0.02em]">
        {new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.key}-01T12:00:00Z`))}
        {month.partial ? ' *' : ''}
      </h3>
      <dl className="rp-keep mt-3 grid grid-cols-2 gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-4 print:grid-cols-4">
        <Kpi label={t('Total omzet')} value={big(st.sales, lang)} sub={st.bestDay ? t('hari terbaik {day}: {amount}', { day: dateShort(st.bestDay.day, lang, 'UTC'), amount: money(st.bestDay.total) }) : ''} />
        <Kpi label={t('Jumlah nota')} value={String(st.count)} sub="" />
        <Kpi label={t('Porsi terjual')} value={String(st.portions)} sub="" />
        <Kpi label={t('Hari berjualan')} value={String(st.activeDays)} sub={t('dari {n} hari', { n: month.days.length })} />
        <Kpi label={t('Rata-rata per hari')} value={big(st.avgPerDay, lang)} sub="" />
        <Kpi label={t('Rata-rata per nota')} value={big(st.avgPerBill, lang)} sub="" />
        <Kpi label={t('Jam ramai')} value={hrs.length ? hrs.map((h) => `${String(h.hour).padStart(2, '0')}.00`).join(', ') : '-'} sub={hrs.length ? t('dua jam dengan nota terbanyak') : ''} />
        <Kpi label={t('Hari ramai')} value={busiest ? weekdayName(busiest.index) : '-'} sub={busiest ? t('rata-rata {amount} per hari', { amount: money(busiest.avgPerDay) }) : ''} />
      </dl>
      <figure className="mt-4">
        <figcaption className="mb-1 text-[12.5px] font-semibold">{t('Omzet harian (juta rupiah)')}</figcaption>
        <ColumnBars bars={dailyOmzet(B, month.days).map((d) => ({ label: d.day.slice(8, 10), value: d.total }))} format={chartM} caption={t('Omzet harian (juta rupiah)')} />
      </figure>
      <p className="mt-3 text-[12.5px] font-semibold">{t('Metode pembayaran')}</p>
      <Scroll>
        <table className="rp-tbl mt-1">
          <tbody>
            <tr><td>{t('Tunai')}</td><td className="n">{st.cashCount}</td><td className="n">{amount(st.cash)}</td></tr>
            <tr><td>QRIS</td><td className="n">{st.qrisCount}</td><td className="n">{amount(st.qris)}</td></tr>
          </tbody>
        </table>
      </Scroll>
      <p className="mt-3 text-[12.5px] font-semibold">{t('Mingguan bulan ini')}</p>
      {ws.length > 0 && (
        <>
          <figure className="mt-1">
            <ColumnBars bars={ws.map((w) => ({ label: w.week.start.slice(5), value: w.sales, tone: w.week.partial ? 'bg-pine/40' : undefined }))} format={chartM} caption={t('Omzet per minggu bulan ini (juta rupiah)')} />
          </figure>
          <Scroll>
            <table className="rp-tbl mt-2">
              <thead>
                <tr>
                  <th scope="col">{t('Minggu')}</th>
                  <th scope="col" className="n">{t('Hari')}</th>
                  <th scope="col" className="n">{t('Nota')}</th>
                  <th scope="col" className="n">{t('Porsi')}</th>
                  <th scope="col" className="n">{t('Omzet')}</th>
                  <th scope="col" className="n">{t('Rata-rata/hari')}</th>
                </tr>
              </thead>
              <tbody>
                {ws.map((w) => (
                  <tr key={w.week.start}>
                    <td>{`${w.week.partial ? '*' : ''}${dateRange(w.week.days[0], w.week.days[w.week.days.length - 1], lang)}`}</td>
                    <td className="n">{w.activeDays}</td>
                    <td className="n">{w.count}</td>
                    <td className="n">{w.portions}</td>
                    <td className="n">{amount(w.sales)}</td>
                    <td className="n">{amount(w.perDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          {top8.length > 0 && (
            <>
              <p className="mt-3 text-[12.5px] font-semibold">{t('8 menu teratas per minggu, porsi')}</p>
              <MenuWeeks names={top8} weeks={weeks} items={I} />
            </>
          )}
        </>
      )}
      <p className="mt-3 text-[12.5px] font-semibold">{t('Ranking menu bulan ini')}</p>
      {menu.rows.length === 0 ? (
        <p className="text-mute">{t('Belum ada penjualan di bulan ini.')}</p>
      ) : (
        <Scroll>
          <table className="rp-tbl mt-1">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('Menu')}</th>
                <th scope="col" className="n">{t('Porsi')}</th>
                <th scope="col" className="n">%</th>
                <th scope="col" className="n">{t('Nilai harga menu')}</th>
              </tr>
            </thead>
            <tbody>
              {menu.rows.slice(0, 10).map((m, i) => (
                <tr key={m.name}>
                  <td>{i + 1}</td>
                  <td>{m.name}</td>
                  <td className="n">{decimal(m.qty, lang)}</td>
                  <td className="n">{`${decimal(m.share, lang)}%`}</td>
                  <td className="n">{amount(menuValue(I, m.name))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
    </div>
  );
}

/** One month of the expenses part (2.6). */
function ExpenseMonth({ month, expenses, lang }: { month: Month; expenses: ExpenseRow[]; lang: 'id' | 'en' }) {
  const { t } = useI18n();
  const xs = expensesIn(expenses, month.days);
  const st = expenseStats(xs, month.days);
  const weeks = weeksOf(month.from, month.to);
  const ranking = expenseRanking(xs).rows.slice(0, 10);
  const chartM = (v: number) => decimal(v / 1_000_000, lang, 1);
  if (st.entries === 0) return <p className="mt-6 text-mute">{t('Belum ada pengeluaran di bulan ini.')}</p>;
  return (
    <div className="mt-6">
      <h3 className="font-display text-[20px] font-extrabold tracking-[-0.02em]">
        {new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.key}-01T12:00:00Z`))}
        {month.partial ? ' *' : ''}
      </h3>
      <dl className="rp-keep mt-3 grid grid-cols-2 gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-4 print:grid-cols-4">
        <Kpi label={t('Total pengeluaran')} value={big(st.total, lang)} sub="" />
        <Kpi label={t('Jumlah item')} value={String(st.entries)} sub="" />
        <Kpi label={t('Hari ada pengeluaran')} value={String(st.dayCount)} sub={t('dari {n} hari', { n: month.days.length })} />
        <Kpi label={t('Rata-rata per hari')} value={big(st.avgPerDay, lang)} sub="" />
      </dl>
      <figure className="mt-4">
        <ColumnBars bars={dailyExpenses(xs, month.days).map((d) => ({ label: d.day.slice(8, 10), value: d.total }))} format={chartM} caption={t('Pengeluaran harian bulan ini (juta rupiah)')} />
      </figure>
      <Scroll>
        <table className="rp-tbl mt-2">
          <thead>
            <tr>
              <th scope="col">{t('Minggu')}</th>
              <th scope="col" className="n">{t('Hari')}</th>
              <th scope="col" className="n">{t('Item')}</th>
              <th scope="col" className="n">{t('Belanja')}</th>
              <th scope="col" className="n">{t('Operasional')}</th>
              <th scope="col" className="n">{t('Total')}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const wx = expenseStats(expensesIn(xs, w.days), w.days);
              return (
                <tr key={w.start}>
                  <td>{`${w.partial ? '*' : ''}${dateRange(w.days[0], w.days[w.days.length - 1], lang)}`}</td>
                  <td className="n">{wx.dayCount}</td>
                  <td className="n">{wx.entries}</td>
                  <td className="n">{amount(wx.belanja)}</td>
                  <td className="n">{amount(wx.operasional)}</td>
                  <td className="n">{amount(wx.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroll>
      <p className="mt-3 text-[12.5px] font-semibold">{t('Ranking item bulan ini')}</p>
      <Scroll>
        <table className="rp-tbl mt-1">
          <thead>
            <tr>
              <th scope="col">{t('Item')}</th>
              <th scope="col" className="n">{t('Kali')}</th>
              <th scope="col" className="n">{t('Total')}</th>
              <th scope="col" className="n">%</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((x) => (
              <tr key={x.name}>
                <td>{x.name}</td>
                <td className="n">{x.count}</td>
                <td className="n">{amount(x.total)}</td>
                <td className="n">{`${decimal(x.share, lang)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </div>
  );
}

/** Menu by week as a grid of portions; weeks in blocks of BLOCK so each block fits a sheet. */
function MenuWeeks({ names, weeks, items }: { names: string[]; weeks: Week[]; items: ItemRow[] }) {
  const { t, lang } = useI18n();
  const matrix = menuByWeek(items, weeks, names);
  return (
    <>
      {chunk(weeks.map((w, i) => ({ w, i })), BLOCK).map((block, bi) => (
        <Scroll key={bi}>
          <table className="rp-tbl mt-2">
            <thead>
              <tr>
                <th scope="col">{t('Menu')}</th>
                {block.map(({ w }) => (
                  <th key={w.start} scope="col" className="n">
                    {`${w.partial ? '*' : ''}${w.start.slice(5)}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((name, ri) => (
                <tr key={name}>
                  <td>{name}</td>
                  {block.map(({ i }) => (
                    <td key={i} className="n">
                      {matrix[ri][i] ? decimal(matrix[ri][i], lang) : '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      ))}
    </>
  );
}

function Section({ n, title, sub, children }: { n: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-7" aria-labelledby={`rp-${n}`}>
      <div className="rp-keep flex items-center gap-2.5">
        <span aria-hidden className="grid h-6 min-w-6 place-items-center rounded-[3px] border-[1.5px] border-pine-line px-1 font-mono text-caption text-pine">
          {n}
        </span>
        <h2 id={`rp-${n}`} className="font-display text-title font-extrabold tracking-[-0.02em]">
          {title}
        </h2>
      </div>
      {sub && <p className="mt-1 text-[12.5px] text-mute">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 bg-slip p-3.5">
      <dt className="text-caption text-mute">{label}</dt>
      <dd className="mt-1 break-words font-display text-heading font-extrabold tracking-[-0.03em]">{value}</dd>
      <dd className="mt-1 font-mono text-caption text-pine">{sub}</dd>
    </div>
  );
}

function PnlRow({
  label,
  k,
  sign,
  cur,
  prev,
  lang,
  indent,
  kind,
}: {
  label: string;
  k: keyof Pnl;
  sign: 1 | -1;
  cur: Pnl;
  prev: Pnl;
  lang: 'id' | 'en';
  indent?: boolean;
  kind?: 'sub' | 'tot';
}) {
  // A cost that grows lowers profit, so the difference is shown as its effect on profit.
  const effect = sign * (cur[k] - prev[k]);
  return (
    <tr className={kind}>
      <td className={indent ? 'in' : undefined}>{label}</td>
      <td className="n">{acct(sign * cur[k])}</td>
      <td className="n">{acct(sign * prev[k])}</td>
      <td className="n">
        {effect > 0 ? '+' : ''}
        {amount(effect)}
      </td>
      <td className="n">{prev[k] ? signedPct((effect / Math.abs(prev[k])) * 100, lang) : '-'}</td>
    </tr>
  );
}

function Sheet({
  n,
  pages,
  head,
  footer,
  last,
  continued,
  children,
}: {
  n: number;
  pages: number;
  head: { business: string; meta: string };
  footer: string;
  last?: boolean;
  continued?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <article className="rp-sheet flex flex-col" aria-label={t('BAB {n} dari {m}', { n, m: pages })}>
      {(n > 1 || continued) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b-2 border-ink pb-3">
          <p className="font-display text-title font-extrabold tracking-[-0.02em]">{head.business}</p>
          <p className="font-mono text-caption text-mute">{head.meta}</p>
        </div>
      )}
      <div className="flex-1">{children}</div>
      <p className="mt-8 flex flex-wrap justify-between gap-2 border-t border-rule pt-3 text-caption text-mute print:hidden">
        <span>
          {footer}
          {last ? ` · ${t('Rahasia, untuk internal')}` : ''}
        </span>
        <span>{t('BAB {n} dari {m}', { n, m: pages })}</span>
      </p>
    </article>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto print:overflow-visible">{children}</div>;
}

function Sign({ title, text }: { title: string; text: string }) {
  return (
    <div className="border-t-[1.5px] border-ink pt-2">
      <p className="text-small font-semibold">{title}</p>
      <p className="text-caption text-mute">{text}</p>
    </div>
  );
}

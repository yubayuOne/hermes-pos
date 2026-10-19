import type { ReactNode } from 'react';
import { BRAND_UPPER, Tag, addDays, amount, dateLong, dateRange, dateShort, dayDiff, decimal, money, time, useI18n, weekday } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import type { Pnl } from '../lib/types';
import type { ReportData } from '../server/report';

export type ReportKind = 'week' | 'month' | 'period';

/**
 * Laporan kinerja (DESIGN.md F, board "Contoh laporan ekspor"): six A4 sheets of typed text, printed by the browser.
 * Every amount comes from owner_report_page (063); the page only formats, sums shares, and compares.
 * Insight, decisions, and the action plan keep their place but say "segera hadir".
 */
export function ReportDocument({
  data: { report: r, sales: s },
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
  const business = app.business.name || '[NAMA BISNIS]';
  const outlet = outletId ? app.outlets.find((o) => o.id === outletId) : undefined;
  const title = kind === 'week' ? t('Laporan Kinerja Mingguan') : kind === 'month' ? t('Laporan Kinerja Bulanan') : t('Laporan Kinerja');
  const period = dateRange(range.from, range.to, lang);
  const span = dayDiff(range.from, range.to) + 1;
  const prevRange = dateRange(addDays(range.from, -span), addDays(range.from, -1), lang);
  const number = `LAP-${range.from.replaceAll('-', '')}-${range.to.replaceAll('-', '')}`;
  const now = new Date();
  const created = `${dateLong(now, lang, tz)} ${time(now, tz)}`;
  const footer = `${business} · ${title} · ${period}`;
  const pages = 6;

  const pct = (a: number, b: number) => (b ? `${decimal((a / b) * 100, lang)}%` : '-');
  const change = (cur: number, prev: number) => (prev ? signedPct(((cur - prev) / Math.abs(prev)) * 100, lang) : '-');
  const day = (d: string) => dateShort(d.slice(0, 10), lang, 'UTC');
  const days = Array.from({ length: span }, (_, i) => addDays(range.from, i));
  const daily = days.map((d) => s.daily.find((x) => x.date.slice(0, 10) === d) ?? { date: d, count: 0, total: 0 });
  const cur = r.pnl;
  const prev = r.previousPnl;
  const closedWithDiff = r.shifts.filter((x) => !x.open && x.variance !== null && x.variance !== 0);
  const avgMargin = r.productTotals.sales ? ((r.productTotals.sales - r.productTotals.hpp) / r.productTotals.sales) * 100 : 0;
  const redBelow = avgMargin - 5;

  const summary = [
    prev.netSales
      ? t('Penjualan bersih {dir} {pct} menjadi {amount} dibanding {prev}.', {
          dir: cur.netSales >= prev.netSales ? t('naik') : t('turun'),
          pct: `${decimal(Math.abs((cur.netSales - prev.netSales) / prev.netSales) * 100, lang)}%`,
          amount: money(cur.netSales),
          prev: prevRange,
        })
      : t('Penjualan bersih {amount} dari {n} bill.', { amount: money(cur.netSales), n: cur.count }),
    t('Laba operasional {amount}, margin {pct}.', { amount: money(cur.operatingProfit), pct: pct(cur.operatingProfit, cur.netSales) }),
    r.cash.closed === 0
      ? t('Belum ada shift yang ditutup di periode ini.')
      : r.cash.matched === r.cash.closed
        ? t('Kas sesuai di semua {n} shift yang ditutup.', { n: r.cash.closed })
        : t('Kas sesuai di {m} dari {n} shift yang ditutup. Selisih total {amount}.', { m: r.cash.matched, n: r.cash.closed, amount: money(r.cash.variance) }),
    t('Void {n} bill senilai {a}. Refund {m} kali senilai {b}.', { n: s.voidedCount, a: money(s.voidedTotal), m: s.refundCount, b: money(s.refundTotal) }),
  ];

  // @page footer: printed on every physical page, with the page number from the browser.
  const pageCss = `@media print { @page { @bottom-left { content: ${JSON.stringify(footer)}; font: 8.5pt sans-serif; color: dimgray; } @bottom-right { content: ${JSON.stringify(t('Halaman'))} " " counter(page) " " ${JSON.stringify(t('dari'))} " " counter(pages); font: 8.5pt sans-serif; color: dimgray; } } }`;
  const sheet = { head: { business, meta: `No. ${number} · ${period}` }, footer, pages };

  return (
    <div className="grid gap-8 print:block">
      <style>{pageCss}</style>

      <Sheet n={1} {...sheet}>
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-5">
          <div>
            {outlet?.logoUrl ? (
              <img src={outlet.logoUrl} alt={t('Logo {name}', { name: outlet.name })} className="h-12 w-24 object-contain object-left" />
            ) : (
              <span className="grid h-12 w-24 place-items-center border border-dashed border-mute font-mono text-[12px] text-mute">[LOGO]</span>
            )}
            <p className="mt-3 font-display text-[17px] font-extrabold tracking-[-0.02em]">{business}</p>
            <p className="text-[12.5px] text-mute">{outlet ? outlet.name : t('Semua outlet: {list}', { list: r.outlets.join(', ') })}</p>
          </div>
          <div className="text-right font-mono text-[12px] leading-[1.7] text-mute">
            <p>No. {number}</p>
            <p>{t('Periode {range}', { range: period })}</p>
            <p>{t('Dibuat {date}', { date: created })}</p>
            <p>{t('Mata uang: Rupiah')}</p>
          </div>
        </header>
        <h2 className="mt-7 font-display text-[clamp(28px,5vw,38px)] font-extrabold leading-[1.02] tracking-[-0.035em]">{title}</h2>
        <p className="mt-2 text-[13.5px] text-mute">
          {t('Untuk pemilik dan manajer. Dibandingkan dengan {n} hari sebelumnya, {range}.', { n: span, range: prevRange })}
        </p>
        {/* gap-px over an ink background draws the cell lines */}
        <dl className="rp-keep mt-5 grid grid-cols-2 gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-4 print:grid-cols-4">
          <Kpi label={t('Penjualan bersih')} value={big(cur.netSales, lang)} sub={t('{pct} vs sebelumnya', { pct: change(cur.netSales, prev.netSales) })} />
          <Kpi label={t('Laba kotor')} value={big(cur.grossProfit, lang)} sub={t('margin {pct}', { pct: pct(cur.grossProfit, cur.netSales) })} />
          <Kpi
            label={t('Laba operasional')}
            value={big(cur.operatingProfit, lang)}
            sub={t('{pct} vs sebelumnya', { pct: change(cur.operatingProfit, prev.operatingProfit) })}
          />
          <Kpi
            label={t('Bill')}
            value={String(cur.count)}
            sub={t('{pct} · rata-rata {amount}', { pct: change(cur.count, prev.count), amount: money(cur.count ? cur.netSales / cur.count : 0) })}
          />
        </dl>

        <Section n={1} title={t('Ringkasan eksekutif')}>
          <ul className="list-disc space-y-1.5 pl-5 text-[13.5px]">
            {summary.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>

        <Section n={2} title={t('Penjualan bersih per hari')} sub={t('Dalam juta rupiah. Batang oranye adalah hari tertinggi.')}>
          <DayBars days={daily.map((d) => ({ date: d.date.slice(0, 10), total: d.total }))} />
        </Section>
        <div className="rp-keep mt-6 border-[1.5px] border-ink px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {t('Keputusan yang perlu diambil')} <Tag tone="fire">{t('segera hadir')}</Tag>
          </p>
          <p className="mt-1 text-[12.5px] text-mute">{t('Ditulis pemilik di backoffice dan ikut tercetak di sini.')}</p>
        </div>
      </Sheet>

      <Sheet n={2} {...sheet}>
        <Section n={3} title={t('Laba rugi sederhana')} sub={t('Basis akrual sederhana. HPP dari harga pokok per produk yang dicatat di backoffice.')}>
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
                  <PnlRow label={t('Penyesuaian (balancing)')} k="adjustments" sign={1} cur={cur} prev={prev} lang={lang} indent />
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
          <p className="mt-3 text-[12px] text-mute">
            {t(
              'Angka dalam kurung adalah pengurang. Selisih positif menambah laba, negatif menguranginya. Pembelian bahan ({amount}) tidak masuk laba rugi karena biayanya sudah ada di HPP. Laba operasional dihitung sebelum penyusutan, bunga, dan pajak penghasilan.',
              { amount: money(cur.inventoryPurchases) },
            )}
          </p>
        </Section>

        <Section
          n={4}
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
                <tr>
                  <td>{t('Pengeluaran dari laci')}</td>
                  <td className="n">{acct(-r.drawer.expenses)}</td>
                </tr>
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
              <p className="mt-3 text-[12px] text-mute">
                {/* Counted on the server: the shift list stops at 500 rows. */}
                {r.cash.shortCount + r.cash.overCount > 12 &&
                  `${t('Dan {n} shift lainnya dengan selisih.', { n: r.cash.shortCount + r.cash.overCount - 12 })} `}
                {t('{n} shift lainnya sesuai, selisih Rp0.', { n: r.cash.matched })}
              </p>
            </div>
          </div>
        </Section>
      </Sheet>

      <Sheet n={3} {...sheet}>
        <Section
          n={5}
          title={t('Pengeluaran per kategori')}
          sub={t(
            'Dicatat kasir di aplikasi dan bisa diubah pemilik di menu Pengeluaran, menurut tanggal shift. Belanja bahan tidak masuk laba rugi karena biayanya sudah ada di HPP.',
          )}
        >
          <Scroll>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Kategori')}</th>
                  <th scope="col">{t('Jenis')}</th>
                  <th scope="col" className="n">
                    {t('Entri')}
                  </th>
                  <th scope="col" className="n">
                    {t('Jumlah')}
                  </th>
                  <th scope="col" className="n">
                    {t('Porsi')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t('Operasional')}</td>
                  <td>{t('Biaya operasional')}</td>
                  <td className="n">{r.expenses.operasionalCount}</td>
                  <td className="n">{amount(r.expenses.operasional)}</td>
                  <td className="n">{pct(r.expenses.operasional, r.expenses.total)}</td>
                </tr>
                <tr>
                  <td>{t('Belanja')}</td>
                  <td>{t('Persediaan')}</td>
                  <td className="n">{r.expenses.belanjaCount}</td>
                  <td className="n">{amount(r.expenses.belanja)}</td>
                  <td className="n">{pct(r.expenses.belanja, r.expenses.total)}</td>
                </tr>
                <tr className="tot">
                  <td colSpan={3}>{t('Total pengeluaran')}</td>
                  <td className="n">{amount(r.expenses.total)}</td>
                  <td className="n">{r.expenses.total ? '100%' : '-'}</td>
                </tr>
              </tbody>
            </table>
          </Scroll>
        </Section>

        <Section n={6} title={t('Arus kas')}>
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
              <p className="mt-2 text-[12px] text-mute">{t('QRIS masuk ke rekening outlet, bukan ke laci.')}</p>
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
              <p className="mt-2 text-[12px] text-mute">
                {t('Bukan dari laci artinya dibayar pemilik atau lewat transfer, sehingga uang laci tidak berubah.')}
              </p>
            </div>
          </div>
        </Section>

        <Section n={7} title={t('Pengeluaran terbesar')}>
          {r.expenses.top.length === 0 ? (
            <p className="text-mute">{t('Belum ada pengeluaran di periode ini.')}</p>
          ) : (
            <Scroll>
              <table className="rp-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t('Tanggal')}</th>
                    <th scope="col">{t('Keterangan')}</th>
                    <th scope="col">{t('Kategori')}</th>
                    <th scope="col" className="n">
                      {t('Jumlah')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.expenses.top.map((x, i) => (
                    <tr key={i}>
                      <td className="n !text-left">{day(x.businessDate)}</td>
                      <td>
                        {x.name}, {qty(x.quantity)} {x.unit}
                        {outlet ? '' : ` · ${x.outletName}`}
                      </td>
                      <td>{x.category === 'belanja' ? t('Belanja') : t('Operasional')}</td>
                      <td className="n">{amount(x.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          )}
          <p className="mt-2 text-[12px] text-mute">{t('Rincian lengkap ada di menu Pengeluaran.')}</p>
        </Section>
      </Sheet>

      <Sheet n={4} {...sheet}>
        <Section n={8} title={t('Penjualan per hari')}>
          <Scroll>
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th scope="col">{t('Hari')}</th>
                  <th scope="col" className="n">
                    {t('Bill')}
                  </th>
                  <th scope="col" className="n">
                    {t('Penjualan bersih')}
                  </th>
                  <th scope="col" className="n">
                    {t('Rata-rata per bill')}
                  </th>
                  <th scope="col" className="n">
                    {t('Porsi')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date}>
                    <td>{longDay(d.date.slice(0, 10), lang)}</td>
                    <td className="n">{d.count}</td>
                    <td className="n">{acct(d.total)}</td>
                    <td className="n">{d.count ? amount(d.total / d.count) : '-'}</td>
                    <td className="n">{pct(d.total, s.sales)}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td>{t('Total')}</td>
                  <td className="n">{s.count}</td>
                  <td className="n">{acct(s.sales)}</td>
                  <td className="n">{s.count ? amount(s.sales / s.count) : '-'}</td>
                  <td className="n">{s.sales ? '100%' : '-'}</td>
                </tr>
              </tbody>
            </table>
          </Scroll>
          <p className="mt-2 text-[12px] text-mute">{t('Penjualan bersih setelah refund, pada tanggal refund.')}</p>
        </Section>

        <div className="grid items-start gap-x-6 md:grid-cols-2 print:grid-cols-2">
          <Section n={9} title={t('Per outlet')}>
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
          <Section n={10} title={t('Per kasir')}>
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

        <Section n={11} title={t('Kinerja produk')} sub={t('Urut dari penjualan terbesar. Margin adalah laba kotor dibagi penjualan.')}>
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
                    HPP
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
                        <span className="block text-[12px] text-mute">{p.category || t('Tanpa kategori')}</span>
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
          <p className="mt-2 text-[12px] text-mute">
            {t('Penjualan produk setelah diskon item, sebelum refund dan diskon bill. Margin di bawah {x}% (5 poin di bawah rata-rata) ditandai merah.', {
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
      </Sheet>

      <Sheet n={5} {...sheet}>
        <Section n={12} title={t('Void dan diskon')}>
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
        <Coming n={13} title={t('Insight')} text={t('Catatan dari angka periode ini, masing-masing menyebut sumbernya di laporan.')} />
        <Coming n={14} title={t('Keputusan')} text={t('Ditulis pemilik di backoffice sebelum laporan dicetak.')} />
      </Sheet>

      <Sheet n={6} last {...sheet}>
        <Coming n={15} title={t('Rencana tindakan')} text={t('Tindakan, penanggung jawab, tenggat, ukuran berhasil, dan status.')} />
        <Section n={16} title={t('Catatan dan definisi')}>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-mute">
            <li>{t('Penjualan bersih adalah penjualan kotor dikurangi diskon, voucher, dan refund. Aplikasi belum mencatat pajak (PPN).')}</li>
            <li>{t('HPP memakai harga pokok per produk saat bill dibuat. Harga pokok kosong dihitung Rp0, jadi isi di menu Produk supaya margin akurat.')}</li>
            <li>{t('Refund dihitung pada tanggal refund. Barang refund yang kembali ke stok dikeluarkan dari HPP.')}</li>
            <li>{t('Bill offline masuk setelah tersinkron. Bill yang masih antre di perangkat belum masuk.')}</li>
            <li>{t('Pengeluaran dihitung menurut tanggal shift, langsung saat dicatat kasir.')}</li>
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

/** Accountant style: reductions in brackets. */
const acct = (n: number) => (n < 0 ? `(${amount(-n)})` : amount(n));
const signedPct = (v: number, lang: 'id' | 'en') => `${v > 0 ? '+' : ''}${decimal(v, lang)}%`;
const qty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const big = (n: number, lang: 'id' | 'en') => `${n < 0 ? '-' : ''}Rp${decimal(Math.abs(n) / 1_000_000, lang, 2)}${lang === 'en' ? 'M' : 'jt'}`;
const longDay = (d: string, lang: 'id' | 'en') =>
  new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${d}T12:00:00Z`))
    .replace('.', '');

function Section({ n, title, sub, children }: { n: number; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-7" aria-labelledby={`rp-${n}`}>
      <div className="rp-keep flex items-center gap-2.5">
        <span aria-hidden className="grid h-6 min-w-6 place-items-center rounded-[3px] border-[1.5px] border-pine-line px-1 font-mono text-[12px] text-pine">
          {n}
        </span>
        <h2 id={`rp-${n}`} className="font-display text-[19px] font-extrabold tracking-[-0.02em]">
          {title}
        </h2>
      </div>
      {sub && <p className="mt-1 text-[12.5px] text-mute">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Coming({ n, title, text }: { n: number; title: string; text: string }) {
  const { t } = useI18n();
  return (
    <Section n={n} title={title}>
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-mute">
        <Tag tone="fire">{t('segera hadir')}</Tag>
        {text}
      </p>
    </Section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 bg-slip p-3.5">
      <dt className="text-[12px] text-mute">{label}</dt>
      <dd className="mt-1 break-words font-display text-[22px] font-extrabold tracking-[-0.03em]">{value}</dd>
      <dd className="mt-1 font-mono text-[12px] text-pine">{sub}</dd>
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
  children,
}: {
  n: number;
  pages: number;
  head: { business: string; meta: string };
  footer: string;
  last?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <article className="rp-sheet flex flex-col" aria-label={t('Halaman {n} dari {m}', { n, m: pages })}>
      {n > 1 && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b-2 border-ink pb-3">
          <p className="font-display text-[17px] font-extrabold tracking-[-0.02em]">{head.business}</p>
          <p className="font-mono text-[12px] text-mute">{head.meta}</p>
        </div>
      )}
      <div className="flex-1">{children}</div>
      <p className="mt-8 flex flex-wrap justify-between gap-2 border-t border-rule pt-3 text-[12px] text-mute print:hidden">
        <span>
          {footer}
          {last ? ` · ${t('Rahasia, untuk internal')}` : ''}
        </span>
        <span>{t('Halaman {n} dari {m}', { n, m: pages })}</span>
      </p>
    </article>
  );
}

/** Net sales per day as bars of typed numbers (divs, so the PDF keeps them as text and shapes). */
function DayBars({ days }: { days: { date: string; total: number }[] }) {
  const { t, lang } = useI18n();
  const max = Math.max(1, ...days.map((d) => d.total));
  const top = days.some((d) => d.total > 0) ? days.findIndex((d) => d.total === max) : -1;
  const few = days.length <= 14;
  return (
    <figure className="rp-keep">
      <div className="flex h-[170px] items-end gap-[3px] border-b-[1.5px] border-ink" role="img" aria-label={t('Penjualan bersih per hari')}>
        {days.map((d, i) => (
          <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {few && <span className="mb-1 text-center font-mono text-[12px]">{decimal(d.total / 1_000_000, lang)}</span>}
            <div className={i === top ? 'bg-fire' : 'bg-pine'} style={{ height: `${Math.max(0, d.total / max) * (few ? 82 : 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]" aria-hidden>
        {days.map((d, i) => (
          <span key={d.date} className="min-w-0 flex-1 truncate text-center font-mono text-[12px] text-mute">
            {few ? weekday(d.date, lang, 'UTC') : i % Math.ceil(days.length / 10) === 0 ? d.date.slice(8, 10) : ''}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{days.map((d) => `${d.date} ${money(d.total)}`).join(', ')}</figcaption>
    </figure>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto print:overflow-visible">{children}</div>;
}

function Sign({ title, text }: { title: string; text: string }) {
  return (
    <div className="border-t-[1.5px] border-ink pt-2">
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="text-[12px] text-mute">{text}</p>
    </div>
  );
}

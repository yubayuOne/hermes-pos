import { row } from '../services/printer/escpos';
import { SalesReport } from '../services/report/report';
import { Expense, Refund } from '../types/domain';
import { fmtDay, fmtTime, money, num, t } from '../i18n';

/** Everything one shift report shows. All amounts come from the server; nothing is computed here except sums for display. */
export type ShiftReportData = {
  shiftNumber: number;
  cashierName: string;
  outletName: string;
  openedAt: string;
  closedAt?: string | null;
  report: SalesReport;
  refunds: Refund[];
  expense: Expense | null;
};

const hours = (d: ShiftReportData) => `${fmtTime(d.openedAt)} - ${d.closedAt ? fmtTime(d.closedAt) : t('berjalan')}`;
const qty = (n: number) => String(n).replace('.', ',');
const method = (m: Refund['method']) => (m === 'qris' ? t('QRIS') : t('Tunai'));
/** Refund totals per method, only the ones that happened. */
const refundByMethod = (r: SalesReport) =>
  [
    [t('Refund tunai'), r.refundCash],
    [t('Refund QRIS'), r.refundQris],
  ].filter(([, v]) => Number(v) > 0) as Array<[string, number]>;

/** Plain text for the report printer (ESC/POS, 32 or 48 columns). */
export function reportText(d: ShiftReportData, w = 32) {
  const r = d.report;
  const rule = '-'.repeat(w);
  const lines = [
    t('LAPORAN SHIFT {n}', { n: d.shiftNumber }),
    d.outletName,
    fmtDay(d.openedAt),
    ...row(t('Kasir'), d.cashierName, w),
    ...row(t('Jam'), hours(d), w),
    rule,
    ...row(t('Total omset'), money(r.totalRevenue), w),
    ...row(t('Cash'), money(r.cashRevenue), w),
    ...row(t('QRIS'), money(r.qrisRevenue), w),
    ...row(t('Jumlah bill'), String(r.totalTransactions), w),
    ...(r.discountTotal > 0 ? row(t('Diskon'), `-${money(r.discountTotal)}`, w) : []),
    ...(r.voidedCount > 0 ? row(t('Void ({n})', { n: r.voidedCount }), `-${money(r.voidedTotal)}`, w) : []),
    ...(r.refundCount > 0 ? row(t('Refund ({n})', { n: r.refundCount }), `-${money(r.refundTotal)}`, w) : []),
    ...refundByMethod(r).flatMap(([l, v]) => row(l, `-${money(v)}`, w)),
    rule,
  ];
  if (d.refunds.length) {
    lines.push(t('REFUND'));
    for (const x of d.refunds) {
      lines.push(...row(`${fmtTime(x.createdAt)} ${x.number}`, `-${num(x.amount)}`, w));
      // row() trims leading spaces, so the indent goes on after it, within the same width.
      for (const i of x.items)
        lines.push(...row(`${qty(i.quantity)}x ${i.productName}`, i.amount != null ? `-${num(i.amount)}` : '', w - 2).map((l) => `  ${l}`));
      lines.push(`  ${t('Metode')}: ${method(x.method)}`, `  ${t('Alasan')}: ${x.reason}`);
    }
    lines.push(rule);
  }
  if (d.expense?.items.length) {
    lines.push(t('PENGELUARAN'));
    for (const i of d.expense.items)
      lines.push(...row(`${i.name} ${qty(i.quantity)} ${i.unit}${i.paidFrom === 'other' ? ` (${t('bukan laci')})` : ''}`, num(i.amount), w));
    lines.push(...row(t('Total pengeluaran'), money(d.expense.total), w), rule);
  }
  lines.push(...row(t('Kas awal'), money(r.pettyCash), w), ...row(t('Kas seharusnya'), money(r.expectedCash), w));
  if (r.actualCash != null) lines.push(...row(t('Hitungan kasir'), money(r.actualCash), w), ...row(t('Selisih'), money(r.variance ?? 0), w));
  lines.push(rule);
  for (const c of r.categories) {
    lines.push(c.name.toUpperCase());
    for (const p of c.products) lines.push(...row(`${p.qty}x ${p.name}`, num(p.total), w));
  }
  lines.push(rule, '', '');
  return lines.join('\n');
}

/** Message for WhatsApp: *bold* section titles, one fact per line, short enough to read on a phone. */
export function waText(d: ShiftReportData) {
  const r = d.report;
  const out = [
    `*${t('LAPORAN SHIFT {n}', { n: d.shiftNumber })}*`,
    `${d.outletName} · ${d.cashierName}`,
    `${fmtDay(d.openedAt)} · ${hours(d)}`,
    '',
    `*${t('Ringkasan penjualan')}*`,
    `${t('Total omset')}: ${money(r.totalRevenue)}`,
    `${t('Jumlah bill')}: ${r.totalTransactions}`,
    ...(r.discountTotal > 0 ? [`${t('Diskon')}: -${money(r.discountTotal)}`] : []),
    ...(r.voidedCount > 0 ? [`${t('Void ({n})', { n: r.voidedCount })}: -${money(r.voidedTotal)}`] : []),
    '',
    `*${t('Metode pembayaran')}*`,
    `${t('Tunai')}: ${money(r.cashRevenue)}`,
    `${t('QRIS')}: ${money(r.qrisRevenue)}`,
    ...refundByMethod(r).map(([l, v]) => `${l}: -${money(v)}`),
    '',
    `*${t('Menu terjual ({n} item)', { n: qty(r.totalItems) })}*`,
  ];
  if (!r.categories.length) out.push(t('Belum ada menu terjual.'));
  for (const c of r.categories) out.push(c.name, ...c.products.map((p) => `- ${qty(p.qty)}x ${p.name}: ${money(p.total)}`));
  out.push('', `*${t('Refund ({n})', { n: d.refunds.length })}*`);
  if (!d.refunds.length) out.push(t('Tidak ada refund.'));
  d.refunds.forEach((x, k) => {
    out.push(`${k + 1}. ${x.number}, -${money(x.amount)} (${method(x.method)})`);
    x.items.forEach((i) => out.push(`   ${qty(i.quantity)}x ${i.productName}${i.amount != null ? `: -${money(i.amount)}` : ''}`));
    out.push(`   ${t('Alasan')}: ${x.reason}`);
  });
  out.push('', `*${t('Pengeluaran')}*`);
  const items = d.expense?.items ?? [];
  if (!items.length) out.push(t('Tidak ada pengeluaran.'));
  items.forEach((i, k) =>
    out.push(`${k + 1}. ${i.name} ${qty(i.quantity)} ${i.unit}: ${money(i.amount)}${i.paidFrom === 'other' ? ` (${t('bukan dari laci')})` : ''}`),
  );
  if (items.length) out.push(`${t('Total pengeluaran')}: ${money(d.expense?.total ?? 0)}`);
  out.push('', `*${t('Kas')}*`, `${t('Kas awal')}: ${money(r.pettyCash)}`, `${t('Kas seharusnya')}: ${money(r.expectedCash)}`);
  if (r.actualCash != null) out.push(`${t('Hitungan kasir')}: ${money(r.actualCash)}`, `${t('Selisih')}: ${money(r.variance ?? 0)}`);
  return out.join('\n');
}

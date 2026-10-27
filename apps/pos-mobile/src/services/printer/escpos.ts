import { ReceiptData, ReceiptLine } from './types';
import { t } from '../../i18n';

/*
 * ESC/POS text receipts for any Bluetooth thermal printer (PRD D2, D3). 58 mm paper has 32 characters per line,
 * 80 mm has 48. Every row is built for the printer's width, so long names wrap instead of pushing the amount
 * off the paper.
 */
export const charsFor = (paperWidth?: number) => (paperWidth === 80 ? 48 : 32);

const fmt = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const rule = (w: number, ch = '-') => ch.repeat(w);

/** Wraps text to the width, breaking at spaces where possible. */
function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > w) {
      if (line) {
        out.push(line);
        line = '';
      }
      for (let i = 0; i < word.length; i += w) out.push(word.slice(i, i + w));
      continue;
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= w) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** Left text and right-aligned amount on one line; the left part wraps when needed. */
export function row(left: string, right: string, w: number): string[] {
  const room = w - right.length - 1;
  const lines = wrap(left, Math.max(8, room));
  const last = lines[lines.length - 1];
  if (last.length <= room) {
    lines[lines.length - 1] = last + ' '.repeat(w - last.length - right.length) + right;
    return lines;
  }
  return [...lines, ' '.repeat(Math.max(0, w - right.length)) + right];
}

/** Centers each line the owner typed (Enter starts a new line, an empty line stays empty); only long lines wrap. */
const center = (s: string, w: number) =>
  s.split(/\r?\n/).flatMap((line) => wrap(line, w).map((l) => ' '.repeat(Math.max(0, Math.floor((w - l.length) / 2))) + l));

function itemLines(items: ReceiptLine[], w: number, withDiscount: boolean) {
  return items.flatMap((item) => [
    ...row(`${item.quantity}x ${item.name}`, fmt(item.total), w),
    ...(withDiscount && item.discount && item.discount > 0 ? row(`  ${t('Diskon')}`, `-${fmt(item.discount)}`, w) : []),
    ...(item.note?.trim() ? wrap(`* ${item.note.trim()}`, w - 2).map((l) => `  ${l}`) : []),
  ]);
}

export function buildReceiptText(r: ReceiptData, width = 32) {
  const w = width;
  const kind = r.printKind ?? 'customer';
  const title = kind === 'kitchen' ? t('TIKET DAPUR') : kind === 'bar' ? t('TIKET BAR') : kind === 'refund' ? t('STRUK REFUND') : '';
  const out: string[] = [];
  out.push(...center(r.outlet.toUpperCase(), w));
  if (r.outletAddress) out.push(...center(r.outletAddress, w));
  if (r.outletPhone) out.push(...center(r.outletPhone, w));
  (r.customHeader ?? []).forEach((h) => out.push(...center(h, w)));
  out.push(rule(w));
  if (title) out.push(...center(title, w), rule(w));
  out.push(...row(r.number, '', w).map((l) => l.trimEnd()));
  out.push(...row(t('Waktu'), r.date, w));
  if (r.cashier) out.push(...row(t('Kasir'), r.cashier, w));
  if (r.customer.table) out.push(...row(t('Meja'), r.customer.table, w));
  if (kind !== 'refund' && r.customer.name) out.push(...row(t('Pelanggan'), r.customer.name, w));
  out.push(rule(w));
  if (kind === 'refund' && r.refund) {
    // Per-item amounts are not printed: only the server total is authoritative.
    r.items.forEach((item) => out.push(...row(`${item.quantity}x ${item.name}`, '', w).map((l) => l.trimEnd())));
    out.push(rule(w), ...row(t('TOTAL REFUND'), `Rp${fmt(r.refund.amount)}`, w));
    out.push(...row(t('Dikembalikan'), r.refund.method === 'qris' ? t('QRIS/transfer') : t('Tunai'), w));
    out.push(...wrap(`${t('Alasan')}: ${r.refund.reason}`, w), rule(w), '', '');
    return out.join('\n');
  }
  if (kind === 'customer') {
    // Keep customer bill items grouped in preparation order, with one dashed divider
    // between Kitchen and Bar. Station-specific tickets continue using r.items as-is.
    const kitchenItems = r.items.filter((item) => item.station === 'kitchen');
    const barItems = r.items.filter((item) => item.station === 'bar');
    out.push(...itemLines(kitchenItems, w, true));
    if (kitchenItems.length > 0 && barItems.length > 0) out.push(rule(w));
    out.push(...itemLines(barItems, w, true));
  } else {
    out.push(...itemLines(r.items, w, false));
  }
  out.push(rule(w));
  if (kind === 'customer') {
    if ((r.discount ?? 0) > 0) {
      out.push(...row(t('Subtotal'), fmt(r.subtotal), w));
      out.push(...row(t('Diskon dan voucher'), `-${fmt(r.discount ?? 0)}`, w));
    }
    out.push(...row('TOTAL', `Rp${fmt(r.total)}`, w));
    if (r.isPaid === false) out.push(...row(t('Status'), t('BELUM DIBAYAR'), w));
    else {
      out.push(...row(r.paymentMethod === 'qris' ? t('QRIS') : t('Tunai'), `Rp${fmt(r.paid)}`, w));
      if (r.paymentMethod === 'cash') out.push(...row(t('Kembalian'), `Rp${fmt(r.change)}`, w));
    }
    if (r.refunds?.length) {
      out.push(rule(w));
      for (const x of r.refunds) out.push(...row(t('Refund'), `-Rp${fmt(x.amount)}`, w), ...wrap(`${t('Alasan')}: ${x.reason}`, w));
      out.push(...row(t('Bersih'), `Rp${fmt(r.total - r.refunds.reduce((n, x) => n + x.amount, 0))}`, w));
    }
    if (r.provisional) out.push(rule(w), ...wrap(t('Nomor sementara. Nomor resmi terbit setelah sinkron.'), w));
    out.push(rule(w));
    (r.customFooter?.length ? r.customFooter : [t('Terima kasih')]).forEach((f) => out.push(...center(f, w)));
  }
  out.push('', '');
  return out.join('\n');
}

const ASCII: Record<string, string> = {
  '·': '-',
  '•': '*',
  '×': 'x',
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '€': 'EUR',
  '°': ' ',
  ' ': ' ',
};

/**
 * Only ASCII goes to the printer. Cheap thermal printers use different code pages, many default to Chinese
 * (GB18030), so UTF-8 bytes such as the "·" separator print as Chinese characters. Accents are dropped (é -> e),
 * known symbols get an ASCII look-alike, anything else becomes "?".
 */
export function asciiBytes(value: string) {
  const out: number[] = [];
  const text = typeof value.normalize === 'function' ? value.normalize('NFKD') : value;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || (cp >= 0x20 && cp < 0x7f)) out.push(cp);
    else if (cp >= 0x300 && cp <= 0x36f)
      continue; // combining accent left by NFKD
    else if (ASCII[ch]) for (const c of ASCII[ch]) out.push(c.charCodeAt(0));
    else out.push(0x3f);
  }
  return out;
}

/**
 * Centered logo raster above the text (migration 037), then back to left alignment. Customer receipts and refund
 * slips only; kitchen and bar tickets stay short.
 */
function logoBytes(r: ReceiptData): number[] {
  if (!r.logoRaster?.length || r.printKind === 'kitchen' || r.printKind === 'bar') return [];
  const out = [0x1b, 0x61, 0x01];
  for (const b of r.logoRaster) out.push(b);
  out.push(0x0a, 0x1b, 0x61, 0x00);
  return out;
}

export function buildEscPosReceipt(r: ReceiptData, paperWidth?: number) {
  return new Uint8Array([
    0x1b,
    0x40,
    ...logoBytes(r),
    0x1b,
    0x61,
    0x00,
    ...asciiBytes(buildReceiptText(r, charsFor(paperWidth))),
    0x0a,
    0x0a,
    0x0a,
    0x1d,
    0x56,
    0x00,
  ]);
}

export function buildEscPosTest(paperWidth?: number) {
  const w = charsFor(paperWidth);
  const text = [
    'HERMES POS',
    t('CETAK UJI'),
    rule(w),
    ...row(t('Lebar kertas'), `${paperWidth ?? 58} mm`, w),
    ...row('ESC/POS', 'OK', w),
    rule(w),
    '1234567890'.repeat(5).slice(0, w),
    '',
    '',
  ].join('\n');
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x00, ...asciiBytes(text), 0x1d, 0x56, 0x00]);
}

export function buildEscPosText(text: string) {
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x00, ...asciiBytes(text), 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]);
}

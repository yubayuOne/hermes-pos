/**
 * Reads a typed amount. Whole rupiah (default): dots must be real thousands separators (1.000), a comma is rejected ("1,5" is not Rp1).
 * With `decimals` (price per pack): a dot followed by exactly three digits is a thousands separator, "," or "." is the decimal mark.
 * Empty or unreadable input gives null.
 */
export function parseRupiah(s: string, decimals = false): number | null {
  const v = s.trim();
  if (!decimals) return /^(\d+|\d{1,3}(\.\d{3})+)$/.test(v) ? Number(v.replace(/\./g, '')) : null;
  const n = v.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(n) ? Number(n) : null;
}

/** Reads a counted amount like a price per pack ("1.500" is 1500, "1,5" and "2.5" are 1.5 and 2.5), with at most 3 decimals. Otherwise null. */
export function parseCount(s: string): number | null {
  const n = parseRupiah(s, true);
  return n !== null && Math.round(n * 1000) / 1000 === n ? n : null;
}

/** Whole rupiah as typed, grouped with dots while typing: "18000" -> "18.000". Digits only; decimals are never typed here. */
export function groupRupiah(s: string): string {
  const d = s.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

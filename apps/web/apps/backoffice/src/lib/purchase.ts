const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total paid and price per pack for a line; `null` until the pack count is above 0. Total stays whole rupiah (the server takes whole rupiah). */
type Pair = { total: number; unit: number } | null;
const valid = (n: number, packs: number) => Number.isFinite(n) && Number.isFinite(packs) && packs > 0;

export const pairFromTotal = (total: number, packs: number): Pair => (valid(total, packs) ? { total, unit: round2(total / packs) } : null);
export const pairFromUnit = (unit: number, packs: number): Pair => (valid(unit, packs) ? { total: Math.round(unit * packs), unit } : null);

/**
 * Reads a typed amount. Whole rupiah (default): dots are thousands separators, a comma is rejected ("1,5" is not Rp1).
 * With `decimals` (price per pack): a dot followed by exactly three digits is a thousands separator, "," or "." is the decimal mark.
 * Empty or unreadable input gives null.
 */
export function parseRupiah(s: string, decimals = false): number | null {
  const v = s.trim();
  if (!decimals) return /^\d[\d.]*$/.test(v) ? Number(v.replace(/\./g, '')) : null;
  const n = v.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(n) ? Number(n) : null;
}

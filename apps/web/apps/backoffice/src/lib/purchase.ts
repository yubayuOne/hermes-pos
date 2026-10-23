const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total paid and price per pack for a line; `null` until the pack count is above 0. Total stays whole rupiah (the server takes whole rupiah). */
type Pair = { total: number; unit: number } | null;
const valid = (n: number, packs: number) => Number.isFinite(n) && Number.isFinite(packs) && packs > 0;

export const pairFromTotal = (total: number, packs: number): Pair => (valid(total, packs) ? { total, unit: round2(total / packs) } : null);
export const pairFromUnit = (unit: number, packs: number): Pair => (valid(unit, packs) ? { total: Math.round(unit * packs), unit } : null);

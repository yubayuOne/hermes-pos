/** Text in a count-sheet cell to a number. Blank is null (not 0): the server then decides. */
export function sheetAmount(text: string): number | null {
  const t = text.trim();
  return t === '' ? null : Number(t.replace(',', '.'));
}

/** Selisih of one count row (096): counted - (opening + received - issued), 3 decimals, never -0. */
export function sheetVariance(row: { opening: number; received: number; issued: number; counted: number }): number {
  const v = Math.round((row.counted - (row.opening + row.received - row.issued)) * 1000) / 1000;
  return v === 0 ? 0 : v;
}

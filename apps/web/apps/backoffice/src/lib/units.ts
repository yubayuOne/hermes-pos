export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';
export const UNITS: readonly Unit[] = ['g', 'kg', 'ml', 'l', 'pcs'];
const FAMILIES: readonly (readonly Unit[])[] = [['g', 'kg'], ['ml', 'l'], ['pcs']];

/** Units a recipe line may use for an ingredient sold in `pack`. Only fills the picker: the database decides (084). */
export const sameFamilyUnits = (pack: Unit): Unit[] => [...(FAMILIES.find((f) => f.includes(pack)) ?? [])];

export const UNIT_LABEL: Record<Unit, string> = { g: 'gram (g)', kg: 'kilogram (kg)', ml: 'mililiter (ml)', l: 'liter (l)', pcs: 'pcs' };

/** Stock in its base unit, easy to read: 1000 g and up shows as kg, 1000 ml and up as l; negative stays plain ("-300 ml"). */
export function stockText(base: number, baseUnit: Unit, lang: 'id' | 'en' = 'id'): string {
  const big = Math.abs(base) >= 1000 && (baseUnit === 'g' || baseUnit === 'ml');
  const unit = big ? (baseUnit === 'g' ? 'kg' : 'l') : baseUnit;
  const n = new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: 3 }).format(big ? base / 1000 : base);
  return `${n} ${unit}`;
}

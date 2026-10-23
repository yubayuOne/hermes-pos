export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';
export const UNITS: readonly Unit[] = ['g', 'kg', 'ml', 'l', 'pcs'];
const FAMILIES: readonly (readonly Unit[])[] = [['g', 'kg'], ['ml', 'l'], ['pcs']];

/** Units a recipe line may use for an ingredient sold in `pack`. Only fills the picker: the database decides (084). */
export const sameFamilyUnits = (pack: Unit): Unit[] => [...(FAMILIES.find((f) => f.includes(pack)) ?? [])];

export const UNIT_LABEL: Record<Unit, string> = { g: 'gram (g)', kg: 'kilogram (kg)', ml: 'mililiter (ml)', l: 'liter (l)', pcs: 'pcs' };

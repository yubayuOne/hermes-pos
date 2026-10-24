import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, decimal, money, useI18n } from '@hermes-pos/ui';
import { describeError } from '../lib/errors';
import type { Ingredient, RecipeCost, RecipeLineInput } from '../lib/types';
import { UNIT_LABEL, sameFamilyUnits } from '../lib/units';
import { listIngredients, previewRecipe } from '../server/ingredients';
import { IngredientDialog } from './IngredientDialog';

type Row = { key: number; ingredientId: string; qty: string; unit: RecipeLineInput['unit'] };
const NEW = '__new';
const toNumber = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));

/**
 * The recipe of one product: ingredient, amount, unit per row. The cost, profit and warnings come from the database
 * (owner_preview_recipe) as the rows change, so the numbers here are the ones that will be saved.
 * onChange gets every row that has an ingredient (an amount that is not a number shows up as a field error on save)
 * and the latest cost.
 */
export function RecipeEditor({
  outletId,
  price,
  initial,
  onChange,
}: {
  outletId: string;
  price: number;
  initial: RecipeLineInput[];
  onChange: (lines: RecipeLineInput[], cost: RecipeCost | null) => void;
}) {
  const { t, lang } = useI18n();
  const nextKey = useRef(initial.length + 1);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.length ? initial.map((l, i) => ({ key: i + 1, ingredientId: l.ingredientId, qty: String(l.qty), unit: l.unit })) : [{ key: 0, ingredientId: '', qty: '', unit: 'g' }],
  );
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [cost, setCost] = useState<RecipeCost | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  useEffect(() => {
    listIngredients({ data: { outletId } }).then(setIngredients, (err) => setError(describeError(err)));
  }, [outletId]);

  const lines: RecipeLineInput[] = rows.filter((r) => r.ingredientId).map((r) => ({ ingredientId: r.ingredientId, qty: toNumber(r.qty), unit: r.unit }));
  const costable = lines.filter((l) => l.qty > 0 && l.qty < 1_000_000);
  const costKey = JSON.stringify(costable);

  // Live cost: asks the database 300 ms after the last change; an older answer never replaces a newer one.
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    if (!costable.length) {
      setCost(null);
      setPending(false);
      return;
    }
    setPending(true);
    const timer = setTimeout(async () => {
      try {
        const res = await previewRecipe({ data: { outletId, lines: costable } });
        if (mine !== seq.current) return;
        setError(res.ok ? '' : res.error);
        setCost(res.ok ? (res.data ?? null) : null);
      } catch (err) {
        if (mine === seq.current) setError(describeError(err));
      } finally {
        if (mine === seq.current) setPending(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- costKey stands for costable
  }, [costKey, outletId]);

  useEffect(() => {
    onChangeRef.current(lines, cost);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows and cost are the inputs
  }, [rows, cost]);

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  function pick(key: number, id: string) {
    if (id === NEW) return setCreatingFor(key);
    const ing = byId.get(id);
    patch(key, { ingredientId: id, ...(ing ? { unit: ing.baseUnit } : {}) });
  }
  const used = new Set(rows.map((r) => r.ingredientId));
  const profit = cost && price > 0 ? price - cost.hpp : null;

  return (
    <section aria-label={t('Resep per porsi')} className="grid gap-3 rounded border border-rule p-3">
      <h3 className="font-semibold">{t('Resep per porsi')}</h3>
      {rows.map((r, n) => {
        const ing = byId.get(r.ingredientId);
        const line = cost?.lines.find((l) => l.ingredientId === r.ingredientId);
        return (
          <div key={r.key} className="grid gap-2 rounded border border-rule bg-slip p-2">
            <Select aria-label={t('Bahan {n}', { n: n + 1 })} value={r.ingredientId} onChange={(e) => pick(r.key, e.target.value)}>
              <option value="">{t('Pilih bahan')}</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id} disabled={used.has(i.id) && i.id !== r.ingredientId}>
                  {i.name}
                </option>
              ))}
              <option value={NEW}>{t('+ Bahan baru')}</option>
            </Select>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t('Jumlah bahan {n}', { n: n + 1 })}
                inputMode="decimal"
                className="w-[110px] text-right font-mono"
                value={r.qty}
                onChange={(e) => patch(r.key, { qty: e.target.value.replace(/[^\d.,]/g, '').slice(0, 10) })}
              />
              <Select aria-label={t('Satuan bahan {n}', { n: n + 1 })} className="w-[160px]" value={r.unit} onChange={(e) => patch(r.key, { unit: e.target.value as Row['unit'] })}>
                {(ing ? sameFamilyUnits(ing.packUnit) : sameFamilyUnits(r.unit)).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </option>
                ))}
              </Select>
              {line && (
                <span className="ml-auto font-mono text-small">
                  {money(line.cost)}
                  {line.incomplete && <span className="ml-1 font-sans text-mute">{t('perkiraan')}</span>}
                </span>
              )}
              <Button sm aria-label={t('Hapus baris {n}', { n: n + 1 })} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ ...r, ingredientId: '', qty: '' }]))}>
                {t('Hapus')}
              </Button>
            </div>
          </div>
        );
      })}
      <div>
        <Button sm onClick={() => setRows((rs) => [...rs, { key: nextKey.current++ + 1000, ingredientId: '', qty: '', unit: 'g' }])}>
          {t('Tambah bahan ke resep')}
        </Button>
      </div>
      <div aria-live="polite" className="grid gap-1 border-t border-rule pt-3">
        {pending && <p className="text-small text-mute">{t('Menghitung...')}</p>}
        {cost && (
          <>
            <p className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span>{t('HPP (modal per porsi)')}</span>
              <span className="font-mono font-semibold">
                {money(cost.hpp)}
                {cost.incomplete && <span className="ml-1 font-sans text-small font-normal text-mute">{t('perkiraan')}</span>}
              </span>
            </p>
            {profit !== null && (
              <>
                <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span>{t('Untung per porsi')}</span>
                  <span className="font-mono font-semibold">
                    {money(profit)} <span className="font-sans text-small font-normal text-mute">({decimal((profit / price) * 100, lang, 0)}%)</span>
                  </span>
                </p>
                <p className="text-small text-mute">{t('Modal {pct}% dari harga jual', { pct: decimal((cost.hpp / price) * 100, lang, 0) })}</p>
              </>
            )}
            {price > 0 && cost.hpp > price && (
              <p role="status" className="text-body font-semibold text-error">
                {t('Modal lebih besar dari harga jual. Cek jumlah atau harga bahan.')}
              </p>
            )}
            {cost.incomplete && (
              <p role="status" className="text-body">
                {t('Ada bahan berharga Rp0, angka ini perkiraan.')}
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-body text-error">
            {t(error)}
          </p>
        )}
      </div>
      {creatingFor !== null && (
        <IngredientDialog
          outletId={outletId}
          ingredient={null}
          onClose={() => setCreatingFor(null)}
          onSaved={async (id) => {
            const list = await listIngredients({ data: { outletId } });
            setIngredients(list);
            const ing = list.find((i) => i.id === id);
            patch(creatingFor, { ingredientId: id, ...(ing ? { unit: ing.baseUnit } : {}) });
          }}
        />
      )}
    </section>
  );
}


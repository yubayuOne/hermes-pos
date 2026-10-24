import { useState } from 'react';
import { Button, Dialog, FormAlert, Input, Select, money, useI18n } from '@hermes-pos/ui';
import { parseCount } from '../lib/purchase';
import { countSchema } from '../lib/schemas';
import type { CountResultLine, Ingredient } from '../lib/types';
import { UNIT_LABEL, type Unit, sameFamilyUnits, stockText } from '../lib/units';
import { useAction } from '../lib/useAction';
import { countIngredients } from '../server/ingredients';

/**
 * Count the stock on the shelf (088). Only the rows that were filled are saved; an ingredient never counted before
 * gets its first count as opening stock. After saving, the dialog lists the difference of each ingredient.
 */
export function CountDialog({ outletId, items, onClose }: { outletId: string; items: Ingredient[]; onClose: () => void }) {
  const { t, lang } = useI18n();
  const act = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, Unit>>({});
  const [result, setResult] = useState<CountResultLine[] | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lines = items
      .filter((i) => (values[i.id] ?? '').trim() !== '')
      .map((i) => ({ ingredientId: i.id, qty: parseCount(values[i.id]) ?? Number.NaN, unit: units[i.id] ?? i.baseUnit }));
    if (lines.length === 0) return act.setError('Isi jumlah minimal satu bahan.');
    const check = countSchema.safeParse({ outletId, lines });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => countIngredients({ data: check.data }), { success: t('{name} dihitung.', { name: t('Stok') }) });
    if (res) setResult(res.data ?? []);
  }

  const unitOf = (id: string): Unit => items.find((i) => i.id === id)?.baseUnit ?? 'g';
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={result ? t('Hasil hitung stok') : t('Hitung stok')}
      description={result ? undefined : t('Hitung bahan di rak lalu isi jumlahnya. Kosongkan bahan yang tidak dihitung.')}
      footer={
        result ? (
          <Button variant="fire" onClick={onClose}>
            {t('Selesai')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={act.busy}>
              {t('Batal')}
            </Button>
            <Button type="submit" form="count" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
              {t('Simpan hitungan')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ul className="grid gap-2">
          {result.map((r) => {
            const base = unitOf(r.ingredientId);
            const n = stockText(Math.abs(r.diff), base, lang);
            const v = money(Math.abs(r.value));
            return (
              <li key={r.ingredientId} className="flex flex-wrap justify-between gap-x-4 rounded border border-rule bg-slip px-3 py-2">
                <span className="font-semibold">{r.name}</span>
                <span className={`font-mono text-body ${r.kind === 'count' && r.diff < 0 ? 'text-error' : ''}`}>
                  {r.kind === 'opening'
                    ? t('stok awal {n}', { n: stockText(r.after, base, lang) })
                    : r.diff === 0
                      ? t('sama dengan stok sistem')
                      : r.diff < 0
                        ? t('kurang {n}, {v}', { n, v })
                        : t('lebih {n}, {v}', { n, v })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <form id="count" noValidate onSubmit={save} className="grid gap-4">
          {items.length === 0 ? (
            <p className="text-mute">{t('Belum ada bahan untuk dihitung.')}</p>
          ) : (
            <div className="grid max-h-[50vh] gap-2 overflow-y-auto pr-1">
              {items.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 rounded border border-rule bg-slip px-3 py-2">
                  <div className="min-w-0 flex-1 basis-[160px]">
                    <span className="block truncate font-semibold">{i.name}</span>
                    <span className="block font-mono text-small text-mute">
                      {i.stockStarted ? t('Stok sistem {n}', { n: stockText(i.stock, i.baseUnit, lang) }) : t('Belum dihitung: ini jadi stok awal')}
                    </span>
                  </div>
                  <Input
                    aria-label={`${t('Jumlah hitung')} ${i.name}`}
                    inputMode="decimal"
                    className="w-[110px] text-right font-mono"
                    value={values[i.id] ?? ''}
                    onChange={(e) => {
                      act.setError('');
                      setValues((v) => ({ ...v, [i.id]: e.target.value.replace(/[^\d.,]/g, '').slice(0, 12) }));
                    }}
                  />
                  <Select
                    aria-label={`${t('Satuan hitung')} ${i.name}`}
                    className="w-[150px]"
                    value={units[i.id] ?? i.baseUnit}
                    onChange={(e) => setUnits((u) => ({ ...u, [i.id]: e.target.value as Unit }))}
                  >
                    {sameFamilyUnits(i.packUnit).map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABEL[u]}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </form>
      )}
    </Dialog>
  );
}

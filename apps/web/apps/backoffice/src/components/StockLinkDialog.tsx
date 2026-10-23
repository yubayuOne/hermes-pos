import { useEffect, useState } from 'react';
import { Button, Dialog, Field, FormAlert, Input, Loading, Select, money, useI18n } from '@hermes-pos/ui';
import { describeError } from '../lib/errors';
import { linkExpenseItemsSchema } from '../lib/schemas';
import type { ExpenseItem, Ingredient } from '../lib/types';
import { useAction } from '../lib/useAction';
import { linkExpenseItems } from '../server/expenses';
import { listIngredients } from '../server/ingredients';

const toNumber = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.trim().replace(',', '.')));
const digits = (s: string) => s.replace(/[^\d.,]/g, '').slice(0, 10);

type Row = { ingredientId: string; packs: string };

/**
 * Puts belanja items of one expense record into stock as one purchase (089). Each item is one row: pick the ingredient and
 * the packs; blank rows are skipped. The price per pack is the item's total / packs, shown only as a preview. No cash moves.
 */
export function StockLinkDialog({ outletId, items, onClose }: { outletId: string; items: ExpenseItem[]; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [ingredients, setIngredients] = useState<Ingredient[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<Record<string, Row>>({});

  useEffect(() => {
    listIngredients({ data: { outletId } }).then(setIngredients, (err) => setLoadError(describeError(err)));
  }, [outletId]);

  const row = (id: string): Row => rows[id] ?? { ingredientId: '', packs: '' };
  const patch = (id: string, p: Partial<Row>) => {
    act.setError('');
    setRows((rs) => ({ ...rs, [id]: { ...row(id), ...p } }));
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const filled = items.filter((i) => row(i.id).ingredientId || row(i.id).packs.trim());
    if (filled.length === 0) return act.setError('Isi minimal satu baris.');
    if (filled.some((i) => !row(i.id).ingredientId || row(i.id).packs.trim() === '')) return act.setError('Isi bahan dan jumlah kemasan, atau kosongkan keduanya.');
    const check = linkExpenseItemsSchema.safeParse({
      outletId,
      lines: filled.map((i) => ({ expenseItemId: i.id, ingredientId: row(i.id).ingredientId, packs: toNumber(row(i.id).packs) })),
    });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => linkExpenseItems({ data: check.data }), { success: t('Belanja masuk stok.') });
    if (res) onClose();
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Barang belanja masuk stok')}
      description={t('Pilih bahan dan isi jumlah kemasan untuk barang yang masuk stok. Baris yang dikosongkan dilewati. Ini hanya mencatat stok; kas dan total pengeluaran tidak berubah.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="stock-link" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')} disabled={!ingredients}>
            {t('Simpan')}
          </Button>
        </>
      }
    >
      {loadError ? (
        <FormAlert>{t(loadError)}</FormAlert>
      ) : !ingredients ? (
        <Loading />
      ) : (
        <form id="stock-link" noValidate onSubmit={save} className="grid gap-4">
          <div className="grid gap-3">
            {items.map((i) => {
              const r = row(i.id);
              const packs = toNumber(r.packs);
              return (
                <div key={i.id} className="grid gap-2 rounded border border-rule bg-slip p-3">
                  <p className="font-semibold">
                    {i.name} <span className="font-mono text-[14px] font-normal text-mute">{t('Harga total {amount}', { amount: money(i.amount) })}</span>
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label={`${t('Bahan')}: ${i.name}`}>
                      <Select value={r.ingredientId} onChange={(e) => patch(i.id, { ingredientId: e.target.value })}>
                        <option value="">{t('Pilih bahan')}</option>
                        {ingredients.map((g) => (
                          <option key={g.id} value={g.id} disabled={items.some((o) => o.id !== i.id && row(o.id).ingredientId === g.id)}>
                            {g.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={`${t('Jumlah kemasan')}: ${i.name}`}>
                      <Input inputMode="decimal" className="font-mono" value={r.packs} onChange={(e) => patch(i.id, { packs: digits(e.target.value) })} />
                    </Field>
                  </div>
                  {packs > 0 && Number.isFinite(packs) && (
                    <p className="text-[14px] text-mute">{t('Harga per kemasan sekitar {amount}', { amount: money(Math.round(i.amount / packs)) })}</p>
                  )}
                </div>
              );
            })}
          </div>
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </form>
      )}
    </Dialog>
  );
}

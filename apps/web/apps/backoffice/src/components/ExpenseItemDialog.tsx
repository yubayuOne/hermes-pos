import { useEffect, useState } from 'react';
import { Button, Dialog, Field, FormAlert, Input, Select, useI18n } from '@hermes-pos/ui';
import { EXPENSE_UNITS, expenseEditSchema } from '../lib/schemas';
import type { ExpenseCategory, ExpenseItem, Ingredient } from '../lib/types';
import { useAction } from '../lib/useAction';
import { deleteExpenseItem, listExpenseCategories, updateExpenseItem } from '../server/expenses';
import { listIngredients } from '../server/ingredients';
import { BarangPicker, LAIN } from './BarangPicker';

/**
 * Changes or deletes one item of a shift's expenses (102). A barang sets the name, category, and unit; "Barang lain"
 * types them. Delete is at the left, away from Simpan, and asks once more.
 */
export function ExpenseItemDialog({
  item,
  shiftNumber,
  outletId,
  onClose,
}: {
  item: ExpenseItem;
  shiftNumber: number;
  outletId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const act = useAction();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [ingredientId, setIngredientId] = useState(item.ingredientId ?? LAIN);
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? '');
  const [unit, setUnit] = useState(item.unit);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [amount, setAmount] = useState(String(item.amount));
  const [confirming, setConfirming] = useState(false);
  const [barang, setBarang] = useState<Ingredient[]>([]);

  useEffect(() => {
    let live = true;
    listExpenseCategories().then((c) => live && setCategories(c.filter((x) => x.active)), () => undefined);
    listIngredients({ data: { outletId } }).then((l) => live && setBarang(l), () => undefined);
    return () => {
      live = false;
    };
  }, [outletId]);

  const picked = ingredientId === LAIN ? null : (barang.find((b) => b.id === ingredientId) ?? null);
  const unitText = picked?.baseUnit ?? unit;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const check = expenseEditSchema.safeParse({
      itemId: item.id,
      name: picked ? '' : name.trim(),
      category: picked ? '' : category,
      unit: picked ? '' : unit,
      quantity: Number(quantity.trim().replace(',', '.')),
      amount: Number(amount.replace(/\./g, '')),
      ingredientId: picked ? picked.id : null,
    });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    if (!picked && !check.data.name) return act.setError('Tulis nama barang atau biaya.');
    if (!picked && !(EXPENSE_UNITS as readonly string[]).includes(check.data.unit)) return act.setError('Pilih satuan.');
    const res = await act.run(() => updateExpenseItem({ data: check.data }), { success: t('{name} disimpan.', { name: picked?.name ?? check.data.name }) });
    if (res) onClose();
  }

  async function remove() {
    const res = await act.run(() => deleteExpenseItem({ data: { itemId: item.id } }), { success: t('{name} dihapus.', { name: item.ingredientName ?? item.name }) });
    if (res) onClose();
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={confirming ? t('Hapus {name}?', { name: item.ingredientName ?? item.name }) : t('Ubah pengeluaran')}
      description={confirming ? t('Stok dan kas kembali seperti sebelum dicatat. Catatannya tidak disimpan.') : t('Shift {n}', { n: shiftNumber })}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} disabled={act.busy}>
              {t('Batal')}
            </Button>
            <Button className="border-error bg-error text-paper" onClick={remove} busy={act.busy} busyLabel={t('Menghapus...')}>
              {t('Hapus')}
            </Button>
          </>
        ) : (
          <>
            <Button className="mr-auto text-error" onClick={() => setConfirming(true)} disabled={act.busy}>
              {t('Hapus')}
            </Button>
            <Button onClick={onClose} disabled={act.busy}>
              {t('Batal')}
            </Button>
            <Button type="submit" form="expense-item" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
              {t('Simpan')}
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      ) : (
        <form id="expense-item" noValidate onSubmit={save} className="grid gap-4">
          <Field label={t('Barang')}>
            <BarangPicker items={barang} value={ingredientId} onChange={setIngredientId} allowFree />
          </Field>
          {!picked && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Nama')}>
                <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('Kategori')} optional>
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">{t('Tanpa kategori')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`${t('Jumlah')} (${unitText || '-'})`}>
              <Input inputMode="decimal" className="font-mono" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.,]/g, ''))} />
            </Field>
            {!picked && (
              <Field label={t('Satuan')}>
                <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {EXPENSE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('Harga total')}>
              <Input
                inputMode="numeric"
                className="font-mono"
                value={amount && Number(amount).toLocaleString('id-ID')}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </form>
      )}
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { Button, Dialog, Field, FormAlert, Input, useI18n } from '@hermes-pos/ui';
import { expenseEditSchema } from '../lib/schemas';
import type { ExpenseItem, Ingredient } from '../lib/types';
import { useAction } from '../lib/useAction';
import { deleteExpenseItem, updateExpenseItem } from '../server/expenses';
import { listIngredients } from '../server/ingredients';
import { BarangPicker } from './BarangPicker';

/**
 * Changes or deletes one item of a shift's expenses (102). The cashier's note (name and unit) is read-only above the form.
 * The owner picks the barang it belongs to, or leaves it empty to keep the note as it is. Then quantity and price.
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
  const [barang, setBarang] = useState<Ingredient[]>([]);
  const [ingredientId, setIngredientId] = useState(item.ingredientId ?? '');
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [amount, setAmount] = useState(String(item.amount));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    listIngredients({ data: { outletId } }).then((l) => live && setBarang(l), () => undefined);
    return () => {
      live = false;
    };
  }, [outletId]);

  const picked = barang.find((b) => b.id === ingredientId) ?? null;
  const unitText = picked?.baseUnit ?? item.unit;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // With no barang picked the cashier's note stays as it is: its name and unit are sent unchanged.
    const check = expenseEditSchema.safeParse({
      itemId: item.id,
      name: picked ? '' : item.name,
      category: '',
      unit: picked ? '' : item.unit,
      quantity: Number(quantity.trim().replace(',', '.')),
      amount: Number(amount.replace(/\./g, '')),
      ingredientId: picked ? picked.id : null,
    });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => updateExpenseItem({ data: check.data }), { success: t('{name} disimpan.', { name: picked?.name ?? item.name }) });
    if (res) onClose();
  }

  async function remove() {
    const res = await act.run(() => deleteExpenseItem({ data: { itemId: item.id } }), { success: t('{name} dihapus.', { name: item.ingredientName ?? item.name }) });
    if (res) onClose();
  }

  return (
    <Dialog
      open
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
          <div className="rounded border border-rule bg-slip px-3 py-2">
            <p className="text-small text-mute">{t('Catatan kasir')}</p>
            <p className="font-semibold">
              {item.name} · {item.unit}
            </p>
          </div>
          <Field label={t('Barang')} optional>
            <BarangPicker items={barang} value={ingredientId} onChange={setIngredientId} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${t('Jumlah')} (${unitText || '-'})`}>
              <Input inputMode="decimal" className="font-mono" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.,]/g, ''))} />
            </Field>
            <Field label={t('Harga total')}>
              <Input inputMode="numeric" className="font-mono" value={amount && Number(amount).toLocaleString('id-ID')} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </form>
      )}
    </Dialog>
  );
}

import { Button, Dialog, Field, FormAlert, Input, Select, useI18n } from '@hermes-pos/ui';
import { barangSchema } from '../lib/schemas';
import type { Ingredient } from '../lib/types';
import { useAction } from '../lib/useAction';
import { useForm } from '../lib/useForm';
import { saveIngredient } from '../server/ingredients';

/**
 * Add or change a barang: its name, its base unit (g, ml or pcs), and whether its stock is counted. Its price is not
 * typed here: it is the average of the expenses that bring it into stock (099).
 */
export function IngredientDialog({
  outletId,
  ingredient,
  onClose,
  onSaved,
}: {
  outletId: string;
  ingredient: Ingredient | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { t } = useI18n();
  const act = useAction();
  const f = useForm({
    name: ingredient?.name ?? '',
    unit: (ingredient && ingredient.baseUnit) || 'g',
    counted: ingredient ? (ingredient.counted ? 'yes' : 'no') : 'yes',
  });
  // Once a barang has stock or a count, its unit and whether it is counted are kept (the database refuses changes too).
  const locked = ingredient?.stockStarted === true;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = f.values;
    const data = f.check(barangSchema, {
      id: ingredient?.id ?? null,
      outletId,
      name: v.name,
      unit: v.unit,
      counted: v.counted === 'yes',
    });
    if (!data) return;
    const res = await act.run(() => saveIngredient({ data }), {
      success: ingredient ? t('{name} disimpan.', { name: data.name }) : t('{name} ditambahkan.', { name: data.name }),
    });
    if (res) {
      onSaved?.(res.data ?? '');
      onClose();
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={ingredient ? t('Ubah barang') : t('Tambah barang')}
      description={t('Barang bisa berupa bahan, atau biaya seperti listrik dan iuran. Hanya barang yang dihitung stoknya masuk stok dan bisa dipakai di resep.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="ingredient" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan barang')}
          </Button>
        </>
      }
    >
      <form id="ingredient" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Nama barang')} error={f.errors.name && t(f.errors.name)}>
          <Input autoFocus value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Satuan')} error={f.errors.unit && t(f.errors.unit)} help={locked ? t('Tidak bisa diubah setelah barang punya stok.') : t('Stok dihitung dalam satuan ini.')}>
            <Select value={f.values.unit} disabled={locked} onChange={(e) => f.set('unit', e.target.value as 'g' | 'ml' | 'pcs')}>
              <option value="g">{t('Gram (g)')}</option>
              <option value="ml">{t('Mililiter (ml)')}</option>
              <option value="pcs">{t('Buah (pcs)')}</option>
            </Select>
          </Field>
          <Field label={t('Dihitung stoknya?')} error={f.errors.counted && t(f.errors.counted)} help={locked ? t('Tidak bisa diubah setelah barang punya stok.') : undefined}>
            <Select value={f.values.counted} disabled={locked} onChange={(e) => f.set('counted', e.target.value)}>
              <option value="yes">{t('Ya, ada stok dan harga rata-rata')}</option>
              <option value="no">{t('Tidak, hanya dicatat sebagai pengeluaran')}</option>
            </Select>
          </Field>
        </div>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

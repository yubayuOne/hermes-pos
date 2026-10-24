import { useState } from 'react';
import { Button, Dialog, Field, FormAlert, Input, Select, money, useI18n } from '@hermes-pos/ui';
import { describeError } from '../lib/errors';
import { groupRupiah } from '../lib/purchase';
import { ingredientSchema } from '../lib/schemas';
import type { Ingredient, IngredientImpact } from '../lib/types';
import { UNITS, UNIT_LABEL, type Unit, packSentence, sameFamilyUnits } from '../lib/units';
import { useAction } from '../lib/useAction';
import { useForm } from '../lib/useForm';
import { previewIngredient, saveIngredient } from '../server/ingredients';

const toNumber = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));

/**
 * Add or change an ingredient. Changing the price or pack of an ingredient that recipes use first shows which products'
 * HPP would move, and saves only after the owner confirms.
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
  const [impact, setImpact] = useState<IngredientImpact[] | null>(null);
  const [checking, setChecking] = useState(false);
  const f = useForm({
    name: ingredient?.name ?? '',
    price: ingredient ? String(ingredient.price) : '',
    packQty: ingredient ? String(ingredient.packQty) : '',
    packUnit: (ingredient?.packUnit ?? 'g') as Unit,
    packLabel: ingredient?.packLabel ?? '',
  });
  const priceLocked = ingredient?.stockStarted === true;
  // A used ingredient keeps its unit family: the recipes that use it are written in that family.
  const units = ingredient && ingredient.usedBy > 0 ? sameFamilyUnits(ingredient.packUnit) : [...UNITS];

  const packText = packSentence(toNumber(f.values.packQty), f.values.packUnit as Unit, t('Satu kemasan'));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = f.values;
    const data = f.check(ingredientSchema, {
      id: ingredient?.id ?? null,
      outletId,
      name: v.name,
      price: priceLocked ? ingredient.price : v.price === '' ? Number.NaN : Number(v.price.replace(/\./g, '')),
      packQty: toNumber(v.packQty),
      packUnit: v.packUnit,
      packLabel: v.packLabel,
    });
    if (!data) return;
    const changed = ingredient && (data.price !== ingredient.price || data.packQty !== ingredient.packQty || data.packUnit !== ingredient.packUnit);
    if (ingredient && ingredient.usedBy > 0 && changed && impact === null) {
      setChecking(true);
      act.setError('');
      try {
        const res = await previewIngredient({ data: { id: ingredient.id, price: data.price, packQty: data.packQty, packUnit: data.packUnit } });
        if (!res.ok) return act.setError(res.error);
        if (res.data?.length) return setImpact(res.data);
      } catch (err) {
        return act.setError(describeError(err));
      } finally {
        setChecking(false);
      }
    }
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
      wide
      onOpenChange={(o) => !o && onClose()}
      title={ingredient ? t('Ubah bahan') : t('Tambah bahan')}
      description={impact ? t('Harga bahan ini dipakai di resep. Cek dulu HPP menu yang ikut berubah.') : t('Contoh: susu 1 liter seharga Rp18.000.')}
      footer={
        <>
          <Button onClick={impact ? () => setImpact(null) : onClose} disabled={act.busy}>
            {impact ? t('Kembali') : t('Batal')}
          </Button>
          <Button type="submit" form="ingredient" variant="fire" busy={act.busy || checking} busyLabel={t('Menyimpan...')}>
            {impact ? t('Simpan perubahan') : t('Simpan bahan')}
          </Button>
        </>
      }
    >
      <form id="ingredient" noValidate onSubmit={save} className="grid gap-4">
        {impact ? (
          <section aria-label={t('Menu yang ikut berubah')}>
            <h3 className="font-semibold">{t('Menu yang ikut berubah')}</h3>
            <ul className="mt-2 grid gap-2">
              {impact.map((p) => (
                <li key={p.productId} className="flex flex-wrap justify-between gap-x-4 rounded border border-rule bg-slip px-3 py-2">
                  <span className="font-semibold">{p.name}</span>
                  <span className="font-mono text-[15px]">{t('HPP dari {old} menjadi {now}', { old: money(p.oldHpp), now: money(p.newHpp) })}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            <Field label={t('Nama bahan')} error={f.errors.name && t(f.errors.name)}>
              <Input autoFocus value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
            </Field>
            <Field
              label={t('Harga beli (Rp)')}
              error={f.errors.price && t(f.errors.price)}
              help={priceLocked ? t('Mengikuti catatan belanja. Catat belanja untuk mengubahnya.') : t('Harga satu kemasan, seperti yang Anda bayar ke pemasok.')}
            >
              <Input
                inputMode="numeric"
                className="font-mono"
                readOnly={priceLocked}
                value={f.values.price}
                onChange={(e) => f.set('price', groupRupiah(e.target.value))}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Isi kemasan')} error={f.errors.packQty && t(f.errors.packQty)}>
                <Input
                  inputMode="decimal"
                  className="font-mono"
                  value={f.values.packQty}
                  onChange={(e) => f.set('packQty', e.target.value.replace(/[^\d.,]/g, '').slice(0, 10))}
                />
              </Field>
              <Field label={t('Satuan')} error={f.errors.packUnit && t(f.errors.packUnit)}>
                <Select value={f.values.packUnit} onChange={(e) => f.set('packUnit', e.target.value as Unit)}>
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="-mt-2 text-[15px] text-mute">{t('Isi satu kemasan, dalam satuan di sebelahnya. Contoh: 1 kaleng = 370 g, isi 370, satuan g.')}</p>
            {packText && <p className="-mt-2 font-semibold">{packText}</p>}
            <Field label={t('Nama kemasan (opsional)')} error={f.errors.packLabel && t(f.errors.packLabel)} help={t('Contoh: kaleng, dus, botol.')}>
              <Input value={f.values.packLabel} maxLength={20} onChange={(e) => f.set('packLabel', e.target.value)} />
            </Field>
          </>
        )}
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

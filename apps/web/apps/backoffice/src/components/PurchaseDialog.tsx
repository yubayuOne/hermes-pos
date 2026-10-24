import { useState } from 'react';
import { Button, Dialog, Field, FormAlert, Input, Select, isoDay, money, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import { groupRupiah, pairFromTotal, pairFromUnit, parseRupiah } from '../lib/purchase';
import { purchaseSchema } from '../lib/schemas';
import type { Ingredient } from '../lib/types';
import { useAction } from '../lib/useAction';
import { savePurchase } from '../server/ingredients';
import { IngredientDialog } from './IngredientDialog';

const toNumber = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.trim().replace(',', '.')));
const digits = (s: string, max: number) => s.replace(/[^\d.,]/g, '').slice(0, max);
const nan = (n: number | null) => n ?? Number.NaN;

type Row = { key: number; ingredientId: string; packs: string; total: string; unit: string; src: 'total' | 'unit' };
let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, ingredientId: '', packs: '', total: '', unit: '', src: 'total' });

/** Record a purchase: date, then one row per ingredient. Total paid and price per pack fill each other. */
export function PurchaseDialog({ outletId, ingredients, onClose }: { outletId: string; ingredients: Ingredient[]; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const app = useApp();
  const today = isoDay(new Date(), app.business.timezone);
  const oldest = new Date(Date.parse(today) - 90 * 86_400_000).toISOString().slice(0, 10);
  const [boughtOn, setBoughtOn] = useState(today);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [adding, setAdding] = useState<number | null>(null);

  const patch = (key: number, p: Partial<Row>) => {
    act.setError('');
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };
  /** The edited field wins; the other one is computed from it (rounded to 2 decimals, the total to whole rupiah). */
  const edit = (r: Row, change: Partial<Row>) => {
    const n = { ...r, ...change };
    const packs = toNumber(n.packs);
    const pair = n.src === 'total' ? pairFromTotal(nan(parseRupiah(n.total)), packs) : pairFromUnit(nan(parseRupiah(n.unit, true)), packs);
    if (n.src === 'total') n.unit = pair ? String(pair.unit) : '';
    else n.total = pair ? String(pair.total) : '';
    patch(r.key, n);
  };
  const sum = rows.reduce((s, r) => s + (parseRupiah(r.total) ?? 0), 0);
  const packName = (id: string) => ingredients.find((i) => i.id === id)?.packLabel || t('kemasan');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!boughtOn) return act.setError('Isi tanggal belanja.');
    if (boughtOn > today) return act.setError('Tanggal tidak boleh lebih dari hari ini.');
    if (boughtOn < oldest) return act.setError('Tanggal paling lama 90 hari ke belakang.');
    if (rows.some((r) => !r.ingredientId)) return act.setError('Isi bahan di setiap baris.');
    const check = purchaseSchema.safeParse({
      outletId,
      boughtOn,
      lines: rows.map((r) => ({ ingredientId: r.ingredientId, packs: toNumber(r.packs), total: nan(parseRupiah(r.total)) })),
    });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => savePurchase({ data: check.data }), { success: t('Belanja dicatat.') });
    if (res) onClose();
  }

  return (
    <>
      <Dialog
        open
        wide
        onOpenChange={(o) => !o && onClose()}
        title={t('Catat belanja')}
        description={t('Jumlah dalam nama kemasan bahan. Isi total bayar atau harga per kemasan, yang lain terhitung sendiri.')}
        footer={
          <>
            <Button onClick={onClose} disabled={act.busy}>
              {t('Batal')}
            </Button>
            <Button type="submit" form="purchase" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
              {t('Simpan')}
            </Button>
          </>
        }
      >
        <form id="purchase" noValidate onSubmit={save} className="grid gap-4">
          <Field label={t('Tanggal belanja')}>
            <Input type="date" value={boughtOn} min={oldest} max={today} onChange={(e) => setBoughtOn(e.target.value)} />
          </Field>
          <div className="grid gap-3">
            {rows.map((r) => {
              const ing = ingredients.find((i) => i.id === r.ingredientId);
              const pack = packName(r.ingredientId);
              return (
                <div key={r.key} className="grid gap-2 rounded border border-rule bg-slip p-3">
                  <Field label={t('Bahan')}>
                    <Select
                      value={r.ingredientId}
                      onChange={(e) => (e.target.value === '+new' ? setAdding(r.key) : patch(r.key, { ingredientId: e.target.value }))}
                    >
                      <option value="">{t('Pilih bahan')}</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id} disabled={rows.some((o) => o.key !== r.key && o.ingredientId === i.id)}>
                          {i.name}
                        </option>
                      ))}
                      <option value="+new">{t('+ Bahan baru')}</option>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Field label={t('Jumlah {pack}', { pack })}>
                      <Input inputMode="decimal" className="font-mono" value={r.packs} onChange={(e) => edit(r, { packs: digits(e.target.value, 10) })} />
                    </Field>
                    <Field label={t('Total bayar (Rp)')}>
                      <Input inputMode="numeric" className="font-mono" value={r.total} onChange={(e) => edit(r, { total: groupRupiah(e.target.value).slice(0, 13), src: 'total' })} />
                    </Field>
                    <Field label={t('Harga per {pack} (Rp)', { pack })}>
                      <Input inputMode="decimal" className="font-mono" value={r.unit} onChange={(e) => edit(r, { unit: digits(e.target.value, 13), src: 'unit' })} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[14px] text-mute">{ing ? t('Isi {n} {u} per {pack}', { n: ing.packQty, u: ing.packUnit, pack }) : ''}</span>
                    {rows.length > 1 && (
                      <Button sm onClick={() => setRows((rs) => rs.filter((o) => o.key !== r.key))} aria-label={`${t('Hapus baris')} ${ing?.name ?? ''}`.trim()}>
                        {t('Hapus baris')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button onClick={() => setRows((rs) => [...rs, blank()])} disabled={rows.length >= 50}>
              {t('Tambah bahan')}
            </Button>
            <p className="font-mono text-[16px] font-semibold">
              {t('Total belanja')}: {money(sum)}
            </p>
          </div>
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </form>
      </Dialog>
      {adding !== null && (
        <IngredientDialog
          outletId={outletId}
          ingredient={null}
          onClose={() => setAdding(null)}
          onSaved={(id) => {
            patch(adding, { ingredientId: id });
            setAdding(null);
          }}
        />
      )}
    </>
  );
}

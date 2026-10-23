import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Empty, FormAlert, decimal, money, useI18n } from '@hermes-pos/ui';
import { IngredientDialog } from '../../components/IngredientDialog';
import { OutletField } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { useLock } from '../../lib/app';
import type { Ingredient } from '../../lib/types';
import { UNIT_LABEL } from '../../lib/units';
import { useAction } from '../../lib/useAction';
import { deleteIngredient, listIngredients } from '../../server/ingredients';
import { pageHead } from '../../lang';

type Search = { outlet?: string };

export const Route = createFileRoute('/_app/ingredients')({
  validateSearch: (s: Record<string, unknown>): Search => ({ outlet: typeof s.outlet === 'string' ? s.outlet : undefined }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    return { outletId, items: outletId ? await listIngredients({ data: { outletId } }) : ([] as Ingredient[]) };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Bahan|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Bahan|menu'),
  component: Ingredients,
});

/** Price per base unit: small prices keep their decimals (Rp 0,12 per g), larger ones are whole rupiah. */
function unitCostText(i: Ingredient, lang: 'id' | 'en') {
  const digits = i.unitCost >= 10 ? 0 : i.unitCost >= 1 ? 1 : 3;
  return `Rp${decimal(i.unitCost, lang, digits)} / ${i.baseUnit}`;
}

/** Ingredients and their pack prices. Recipes on the Produk page use them to compute each product's HPP (084). */
function Ingredients() {
  const { t, lang } = useI18n();
  const lock = useLock();
  const { outletId, items } = Route.useLoaderData();
  const navigate = useNavigate({ from: '/ingredients' });
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [removing, setRemoving] = useState<Ingredient | null>(null);
  return (
    <Page title={t('Bahan|menu')}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1 sm:max-w-[280px]">
          <OutletField all={false} value={outletId} onChange={(id) => navigate({ search: { outlet: id ?? undefined }, replace: true })} />
        </div>
        {outletId && (
          <Button variant="fire" onClick={() => setEditing('new')} {...lock.props}>
            {lock.label(t('Tambah bahan'))}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada bahan.')}>
          {t('Tambah bahan pertama di sini, atau buat langsung dari resep sebuah menu di halaman Produk.')}
        </Empty>
      ) : (
        <div className="tbl-wrap mt-5">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Bahan')}</th>
                <th scope="col" className="num">
                  {t('Harga beli')}
                </th>
                <th scope="col">{t('Isi kemasan')}</th>
                <th scope="col" className="num">
                  {t('Harga per satuan')}
                </th>
                <th scope="col" className="num">
                  {t('Dipakai di')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('Aksi')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td data-l={t('Bahan')} className="font-semibold">
                    {i.name}
                  </td>
                  <td data-l={t('Harga beli')} className="num">
                    {money(i.price)}
                  </td>
                  <td data-l={t('Isi kemasan')}>
                    {decimal(i.packQty, lang, i.packQty % 1 === 0 ? 0 : 3)} {UNIT_LABEL[i.packUnit]}
                  </td>
                  <td data-l={t('Harga per satuan')} className="num">
                    {unitCostText(i, lang)}
                  </td>
                  <td data-l={t('Dipakai di')} className="num">
                    {i.usedBy === 0 ? <span className="text-mute">{t('belum dipakai')}</span> : t('{n} menu', { n: i.usedBy })}
                  </td>
                  <td data-l={t('Aksi')}>
                    <div className="flex flex-wrap gap-2">
                      <Button sm onClick={() => setEditing(i)} aria-label={`${t('Ubah')} ${i.name}`} {...lock.props}>
                        {t('Ubah')}
                      </Button>
                      <Button sm onClick={() => setRemoving(i)} aria-label={`${t('Hapus')} ${i.name}`} {...lock.props}>
                        {t('Hapus')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && outletId && <IngredientDialog outletId={outletId} ingredient={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && <RemoveDialog ingredient={removing} onClose={() => setRemoving(null)} />}
    </Page>
  );
}

function RemoveDialog({ ingredient, onClose }: { ingredient: Ingredient; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  async function remove() {
    const res = await act.run(() => deleteIngredient({ data: { id: ingredient.id } }), { success: t('{name} dihapus.', { name: ingredient.name }) });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Hapus {name}?', { name: ingredient.name })}
      description={t('Bahan yang sudah dipakai di resep tidak bisa dihapus.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button variant="fire" onClick={remove} busy={act.busy} busyLabel={t('Menghapus...')}>
            {t('Hapus bahan')}
          </Button>
        </>
      }
    >
      <FormAlert>{act.error && t(act.error)}</FormAlert>
    </Dialog>
  );
}

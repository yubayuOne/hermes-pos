import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Empty, FormAlert, Tag, dateShort, decimal, money, useI18n } from '@hermes-pos/ui';
import { CountDialog } from '../../components/CountDialog';
import { FilterBar } from '../../components/Filters';
import { IngredientDialog } from '../../components/IngredientDialog';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { useLock } from '../../lib/app';
import type { Ingredient } from '../../lib/types';
import { stockText } from '../../lib/units';
import { useAction } from '../../lib/useAction';
import { deleteIngredient, listIngredients } from '../../server/ingredients';
import { pageHead } from '../../lang';

type Search = { outlet?: string };

/** Barang: what the outlet buys and pays for. Counted barang keep stock and an average price (099). */
export const Route = createFileRoute('/_app/ingredients')({
  validateSearch: (s: Record<string, unknown>): Search => ({ outlet: typeof s.outlet === 'string' ? s.outlet : undefined }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    return { outletId, items: outletId ? await listIngredients({ data: { outletId } }) : ([] as Ingredient[]) };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Barang|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Barang|menu'),
  component: BarangPage,
});

function BarangPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/ingredients' });
  return (
    <Page title={t('Barang|menu')}>
      <details className="mt-4">
        <summary className="cursor-pointer font-semibold">{t('Cara pakai')}</summary>
        <ol className="mt-2 list-decimal pl-6">
          <li>{t('Barang bisa berupa bahan, atau biaya seperti listrik dan iuran. Yang dihitung stoknya dipakai di resep.')}</li>
          <li>{t('Catat pengeluaran dengan barangnya. Untuk barang yang dihitung stoknya, isi jumlah yang masuk stok.')}</li>
          <li>{t('Hitung stok kapan saja. Harga rata-rata ikut berubah dari pengeluaran.')}</li>
        </ol>
      </details>
      <div className="mt-5">
        <FilterBar
          outlet={<OutletFilter all={false} value={data.outletId} onChange={(id) => navigate({ search: (s: Search) => ({ ...s, outlet: id ?? undefined }), replace: true })} />}
        />
      </div>
      <IngredientList outletId={data.outletId} items={data.items} />
    </Page>
  );
}

/** Harga rata-rata per satuan dasar: harga kecil tetap punya desimal (Rp 0,12 per g). */
function unitCostText(i: Ingredient, lang: 'id' | 'en') {
  const digits = i.unitCost >= 10 ? 0 : i.unitCost >= 1 ? 1 : 3;
  return `Rp${decimal(i.unitCost, lang, digits)} / ${i.baseUnit}`;
}

function IngredientList({ outletId, items }: { outletId: string | null; items: Ingredient[] }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [removing, setRemoving] = useState<Ingredient | null>(null);
  const [counting, setCounting] = useState(false);
  const counted = items.filter((i) => i.counted);
  return (
    <>
      {outletId && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="fire" onClick={() => setEditing('new')} {...lock.props}>
            {lock.label(t('Tambah barang'))}
          </Button>
          {counted.length > 0 && (
            <Button onClick={() => setCounting(true)} {...lock.props}>
              {t('Hitung stok')}
            </Button>
          )}
        </div>
      )}
      {counted.some((i) => !i.stockStarted) && <p className="mt-4">{t('Stok mulai dihitung saat ada pengeluaran dengan jumlah masuk stok, atau saat hitung stok pertama.')}</p>}
      {items.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada barang.')}>
          <Button variant="fire" onClick={() => setEditing('new')}>
            {t('Tambah barang')}
          </Button>
        </Empty>
      ) : (
        <div className="tbl-wrap mt-5">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Barang')}</th>
                <th scope="col" className="num">
                  {t('Stok')}
                </th>
                <th scope="col" className="num">
                  {t('Harga rata-rata')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('Aksi')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td data-l={t('Barang')}>
                    <span className="font-semibold">{i.name}</span>
                    {!i.counted && <span className="ml-2 align-middle">
                      <Tag tone="mute">{t('tidak dihitung stoknya')}</Tag>
                    </span>}
                    <details className="text-small text-mute">
                      <summary className="cursor-pointer">{t('Lihat detail')}</summary>
                      <p>
                        {t('Satuan')}: {i.baseUnit}
                      </p>
                      {i.counted && (
                        <p>
                          {t('Terakhir dihitung')}: {i.lastCountedAt ? dateShort(i.lastCountedAt, lang) : t('belum pernah')}
                        </p>
                      )}
                      <p>
                        {t('Dipakai di')}: {i.usedBy === 0 ? t('belum dipakai') : t('{n} menu', { n: i.usedBy })}
                      </p>
                    </details>
                  </td>
                  <td data-l={t('Stok')} className="num">
                    {!i.counted ? (
                      <span className="text-mute">—</span>
                    ) : i.stockStarted ? (
                      <span className={i.stock < 0 ? 'font-semibold text-error' : undefined}>{stockText(i.stock, i.baseUnit, lang)}</span>
                    ) : (
                      <span className="text-mute">{t('Belum ada stok')}</span>
                    )}
                  </td>
                  <td data-l={t('Harga rata-rata')} className="num">
                    {!i.counted ? (
                      <span className="text-mute">—</span>
                    ) : (
                      <>
                        {money(i.unitCost)} / {i.baseUnit}
                        <span className="block text-small text-mute">{unitCostText(i, lang)}</span>
                      </>
                    )}
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
      {counting && outletId && <CountDialog outletId={outletId} items={counted} onClose={() => setCounting(false)} />}
      {removing && <RemoveIngredientDialog ingredient={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

function RemoveIngredientDialog({ ingredient, onClose }: { ingredient: Ingredient; onClose: () => void }) {
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
      description={t('Barang yang sudah dipakai di resep tidak bisa dihapus.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button variant="ink" onClick={remove} busy={act.busy} busyLabel={t('Menghapus...')}>
            {t('Hapus barang')}
          </Button>
        </>
      }
    >
      <FormAlert>{act.error && t(act.error)}</FormAlert>
    </Dialog>
  );
}

/** Every menu item with its HPP and profit (an inactive one keeps its recipe, so it stays editable); the recipe opens on its own page. */

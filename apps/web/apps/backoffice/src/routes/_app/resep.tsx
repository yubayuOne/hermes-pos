import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Dialog, Empty, FormAlert, Tag, decimal, money, useI18n } from '@hermes-pos/ui';
import { FilterBar, SearchBox } from '../../components/Filters';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { RecipeEditor } from '../../components/RecipeEditor';
import { useLock } from '../../lib/app';
import { recipeSaveSchema } from '../../lib/schemas';
import type { Product, RecipeCost, RecipeLineInput } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { getRecipe, saveRecipe } from '../../server/ingredients';
import { listCatalog } from '../../server/manage';
import { pageHead } from '../../lang';

type Search = { outlet?: string; product?: string };

/** Resep: the recipe of each menu item, written with barang that are counted. Recipes price the products' HPP (085). */
export const Route = createFileRoute('/_app/resep')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    product: typeof s.product === 'string' ? s.product : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    if (!outletId) return { outletId, menus: [] as Product[], product: null as Product | null, recipe: null as RecipeCost | null };
    const { products } = await listCatalog({ data: { outletId } });
    const product = deps.product ? (products.find((p) => p.id === deps.product) ?? null) : null;
    return { outletId, menus: products, product, recipe: product ? await getRecipe({ data: { productId: product.id } }) : null };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Resep|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Resep|menu'),
  component: RecipesPage,
});

function RecipesPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/resep' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  return (
    <Page title={t('Resep|menu')}>
      {search.product ? (
        data.product && data.outletId ? (
          <RecipePage key={data.product.id} outletId={data.outletId} product={data.product} recipe={data.recipe} onBack={() => set({ product: undefined })} />
        ) : (
          <Empty className="mt-6" title={t('Menu tidak ditemukan.')}>
            <Button onClick={() => set({ product: undefined })}>{t('Kembali')}</Button>
          </Empty>
        )
      ) : (
        <>
          <div className="mt-5">
            <FilterBar
              search={<SearchBox label={t('Cari menu')} placeholder={t('Cari nama')} value={q} onChange={setQ} />}
              outlet={<OutletFilter all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, product: undefined })} />}
            />
          </div>
          <RecipeList menus={data.menus.filter((p) => !needle || p.name.toLowerCase().includes(needle))} searching={needle !== ''} onOpen={(id) => set({ product: id })} />
        </>
      )}
    </Page>
  );
}

function RecipeList({ menus, searching, onOpen }: { menus: Product[]; searching: boolean; onOpen: (id: string) => void }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  if (menus.length === 0 && searching) return <Empty className="mt-6" title={t('Tidak ada yang cocok.')} />;
  if (menus.length === 0)
    return (
      <Empty className="mt-6" title={t('Belum ada menu.')}>
        <Link to="/products" className="btn btn-ink btn-sm">
          {t('Buka Produk')}
        </Link>
      </Empty>
    );
  return (
    <div className="tbl-wrap mt-5">
      <table className="tbl tbl-card">
        <thead>
          <tr>
            <th scope="col">{t('Menu')}</th>
            <th scope="col" className="num">
              {t('Harga jual')}
            </th>
            <th scope="col" className="num">
              {t('Modal (HPP)')}
            </th>
            <th scope="col" className="num">
              {t('Untung per porsi')}
            </th>
            <th scope="col">{t('Resep')}</th>
            <th scope="col">
              <span className="sr-only">{t('Aksi')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {menus.map((p) => {
            const has = p.hppSource === 'recipe';
            const profit = p.price - p.hpp;
            return (
              <tr key={p.id}>
                <td data-l={t('Menu')}>
                  <span className="font-semibold">{p.name}</span>
                  {!p.isActive && <span className="block text-small text-mute">{t('nonaktif')}</span>}
                </td>
                <td data-l={t('Harga jual')} className="num">
                  {money(p.price)}
                </td>
                <td data-l={t('Modal (HPP)')} className="num">
                  {money(p.hpp)}
                </td>
                <td data-l={t('Untung per porsi')} className="num">
                  {p.hpp > 0 && p.price > 0 ? (
                    <>
                      {money(profit)} <span className="font-sans text-small text-mute">({decimal((profit / p.price) * 100, lang, 0)}%)</span>
                    </>
                  ) : (
                    <span className="text-mute">-</span>
                  )}
                </td>
                <td data-l={t('Resep')}>{has ? <Tag tone="pine">{t('dari resep')}</Tag> : <span className="text-mute">{t('Belum ada resep')}</span>}</td>
                <td data-l={t('Aksi')}>
                  <Button sm onClick={() => onOpen(p.id)} aria-label={`${has ? t('Atur resep') : t('Buat resep')} ${p.name}`} {...lock.props}>
                    {has ? t('Atur resep') : t('Buat resep')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One menu item's recipe on a page of its own: the editor with its live cost, then save or remove. */
function RecipePage({ outletId, product, recipe, onBack }: { outletId: string; product: Product; recipe: RecipeCost | null; onBack: () => void }) {
  const { t } = useI18n();
  const lock = useLock();
  const act = useAction();
  const [lines, setLines] = useState<RecipeLineInput[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const initial: RecipeLineInput[] = (recipe?.lines ?? []).map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, unit: l.unit }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return act.setError('Resep belum diisi. Tambah minimal satu bahan, atau hapus resep.');
    const check = recipeSaveSchema.safeParse({ productId: product.id, lines });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => saveRecipe({ data: check.data }), { success: t('Resep {name} disimpan.', { name: product.name }) });
    if (res) onBack();
  }
  async function remove() {
    const res = await act.run(() => saveRecipe({ data: { productId: product.id, lines: [] } }), { success: t('Resep {name} dihapus.', { name: product.name }) });
    if (res) onBack();
  }
  return (
    <form noValidate onSubmit={save} className="mt-5 grid max-w-[640px] gap-4">
      <div>
        <Button sm onClick={onBack}>
          {t('Kembali')}
        </Button>
      </div>
      <h2 className="text-heading font-semibold">{t('Resep {name}', { name: product.name })}</h2>
      <RecipeEditor outletId={outletId} price={product.price} initial={initial} onChange={(ls) => setLines(ls)} />
      <FormAlert>{act.error && t(act.error)}</FormAlert>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')} {...lock.props}>
          {lock.label(t('Simpan'))}
        </Button>
        {recipe?.source === 'recipe' && (
          <Button onClick={() => setConfirmRemove(true)} disabled={act.busy} {...lock.props}>
            {t('Hapus resep')}
          </Button>
        )}
      </div>
      {confirmRemove && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirmRemove(false)}
          title={t('Hapus resep {name}?', { name: product.name })}
          description={t('HPP tetap dipakai. Ubah di halaman Produk.')}
          footer={
            <>
              <Button onClick={() => setConfirmRemove(false)} disabled={act.busy}>
                {t('Batal')}
              </Button>
              <Button variant="ink" onClick={remove} busy={act.busy} busyLabel={t('Menghapus...')}>
                {t('Hapus resep')}
              </Button>
            </>
          }
        />
      )}
    </form>
  );
}


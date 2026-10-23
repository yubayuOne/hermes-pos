import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Chip, Dialog, Empty, FormAlert, Tag, dateShort, decimal, money, useI18n } from '@hermes-pos/ui';
import { CountDialog } from '../../components/CountDialog';
import { IngredientDialog } from '../../components/IngredientDialog';
import { OutletField } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { RecipeEditor } from '../../components/RecipeEditor';
import { useLock } from '../../lib/app';
import { recipeSaveSchema } from '../../lib/schemas';
import type { Ingredient, Product, RecipeCost, RecipeLineInput } from '../../lib/types';
import { stockText } from '../../lib/units';
import { useAction } from '../../lib/useAction';
import { deleteIngredient, getRecipe, listIngredients, saveRecipe } from '../../server/ingredients';
import { listCatalog } from '../../server/manage';
import { pageHead } from '../../lang';

type Search = { outlet?: string; tab?: 'resep'; product?: string };

export const Route = createFileRoute('/_app/ingredients')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    tab: s.tab === 'resep' ? 'resep' : undefined,
    product: s.tab === 'resep' && typeof s.product === 'string' ? s.product : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    const none = { outletId, items: [] as Ingredient[], menus: [] as Product[], product: null as Product | null, recipe: null as RecipeCost | null };
    if (!outletId) return none;
    if (deps.tab !== 'resep') return { ...none, items: await listIngredients({ data: { outletId } }) };
    const { products } = await listCatalog({ data: { outletId } });
    const product = deps.product ? (products.find((p) => p.id === deps.product) ?? null) : null;
    return { ...none, menus: products, product, recipe: product ? await getRecipe({ data: { productId: product.id } }) : null };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Bahan & Resep|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Bahan & Resep|menu'),
  component: IngredientsAndRecipes,
});

/** Ingredients with their pack prices, and the recipe of each menu item. Recipes price the products' HPP (084, 085). */
function IngredientsAndRecipes() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/ingredients' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  return (
    <Page title={t('Bahan & Resep|menu')}>
      <nav aria-label={t('Bagian bahan dan resep')} className="flex flex-wrap gap-2">
        <Chip aria-current={search.tab ? undefined : 'page'} onClick={() => set({ tab: undefined, product: undefined })}>
          {t('Bahan')}
        </Chip>
        <Chip aria-current={search.tab === 'resep' ? 'page' : undefined} onClick={() => set({ tab: 'resep', product: undefined })}>
          {t('Resep')}
        </Chip>
      </nav>
      {search.product ? (
        data.product && data.outletId ? (
          <RecipePage key={data.product.id} outletId={data.outletId} product={data.product} recipe={data.recipe} onBack={() => set({ product: undefined })} />
        ) : (
          <Empty className="mt-6" title={t('Menu tidak ditemukan.')}>
            <Button onClick={() => set({ product: undefined })}>{t('Kembali ke daftar resep')}</Button>
          </Empty>
        )
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div className="min-w-[200px] flex-1 sm:max-w-[280px]">
              <OutletField all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, product: undefined })} />
            </div>
          </div>
          {search.tab === 'resep' ? <RecipeList menus={data.menus} onOpen={(id) => set({ product: id })} /> : <IngredientList outletId={data.outletId} items={data.items} />}
        </>
      )}
    </Page>
  );
}

/** Price per base unit: small prices keep their decimals (Rp 0,12 per g), larger ones are whole rupiah. */
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
  return (
    <>
      {outletId && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="fire" onClick={() => setEditing('new')} {...lock.props}>
            {lock.label(t('Tambah bahan'))}
          </Button>
          {items.length > 0 && (
            <Button onClick={() => setCounting(true)} {...lock.props}>
              {t('Hitung stok')}
            </Button>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada bahan.')}>
          {t('Tambah bahan pertama di sini, atau buat langsung dari resep sebuah menu di tab Resep.')}
        </Empty>
      ) : (
        <div className="tbl-wrap mt-5">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Bahan')}</th>
                <th scope="col" className="num">
                  {t('Stok')}
                </th>
                <th scope="col" className="num">
                  {t('Harga rata-rata')}
                </th>
                <th scope="col">{t('Terakhir dihitung')}</th>
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
                  <td data-l={t('Stok')} className="num">
                    {i.stockStarted ? (
                      <span className={i.stock < 0 ? 'font-semibold text-error' : undefined}>{stockText(i.stock, i.baseUnit, lang)}</span>
                    ) : (
                      <span className="text-mute">{t('Belum dihitung')}</span>
                    )}
                  </td>
                  <td data-l={t('Harga rata-rata')} className="num">
                    {money(i.price)} / {i.packLabel || t('kemasan')}
                    <span className="block text-[14px] text-mute">{unitCostText(i, lang)}</span>
                  </td>
                  <td data-l={t('Terakhir dihitung')}>
                    {i.lastCountedAt ? dateShort(i.lastCountedAt, lang) : <span className="text-mute">{t('belum pernah')}</span>}
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
      {counting && outletId && <CountDialog outletId={outletId} items={items} onClose={() => setCounting(false)} />}
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

/** Every menu item with its HPP and profit (an inactive one keeps its recipe, so it stays editable); the recipe opens on its own page. */
function RecipeList({ menus, onOpen }: { menus: Product[]; onOpen: (id: string) => void }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  if (menus.length === 0)
    return (
      <Empty className="mt-6" title={t('Belum ada menu.')}>
        {t('Tambah menu di halaman Produk, lalu atur resepnya di sini.')}
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
              HPP
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
                  {!p.isActive && <span className="block text-[14px] text-mute">{t('nonaktif')}</span>}
                </td>
                <td data-l={t('Harga jual')} className="num">
                  {money(p.price)}
                </td>
                <td data-l="HPP" className="num">
                  {money(p.hpp)}
                </td>
                <td data-l={t('Untung per porsi')} className="num">
                  {p.hpp > 0 && p.price > 0 ? (
                    <>
                      {money(profit)} <span className="font-sans text-[14px] text-mute">({decimal((profit / p.price) * 100, lang, 0)}%)</span>
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
          {t('Kembali ke daftar resep')}
        </Button>
      </div>
      <h2 className="text-[20px] font-semibold">{t('Resep {name}', { name: product.name })}</h2>
      <RecipeEditor outletId={outletId} price={product.price} initial={initial} onChange={(ls) => setLines(ls)} />
      <FormAlert>{act.error && t(act.error)}</FormAlert>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')} {...lock.props}>
          {lock.label(t('Simpan resep'))}
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
          description={t('HPP terakhir tetap dipakai sebagai HPP ketikan. Ubah di halaman Produk.')}
          footer={
            <>
              <Button onClick={() => setConfirmRemove(false)} disabled={act.busy}>
                {t('Batal')}
              </Button>
              <Button variant="fire" onClick={remove} busy={act.busy} busyLabel={t('Menghapus...')}>
                {t('Hapus resep')}
              </Button>
            </>
          }
        />
      )}
    </form>
  );
}

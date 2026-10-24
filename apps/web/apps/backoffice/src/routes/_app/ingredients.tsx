import { useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Chip, Dialog, Empty, Field, FormAlert, Input, Tag, dateShort, decimal, money, useI18n } from '@hermes-pos/ui';
import { CountDialog } from '../../components/CountDialog';
import { IngredientDialog } from '../../components/IngredientDialog';
import { OutletField } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination } from '../../components/Pagination';
import { PurchaseDialog } from '../../components/PurchaseDialog';
import { RecipeEditor } from '../../components/RecipeEditor';
import { useLock } from '../../lib/app';
import { purchaseCancelSchema, recipeSaveSchema } from '../../lib/schemas';
import type { Ingredient, Product, Purchase, RecipeCost, RecipeLineInput } from '../../lib/types';
import { stockText } from '../../lib/units';
import { useAction } from '../../lib/useAction';
import { cancelPurchase, deleteIngredient, getRecipe, listIngredients, listPurchases, saveRecipe } from '../../server/ingredients';
import { listCatalog } from '../../server/manage';
import { pageHead } from '../../lang';
import { ReasonChips } from '../../components/ReasonChips';

type Search = { outlet?: string; tab?: 'resep' | 'belanja'; product?: string; page?: number };
/** Purchases per page, as the server sends them (owner_list_purchases). */
const PURCHASE_PAGE = 50;

export const Route = createFileRoute('/_app/ingredients')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    tab: s.tab === 'resep' || s.tab === 'belanja' ? s.tab : undefined,
    page: s.tab === 'belanja' && Number.isInteger(s.page) && (s.page as number) > 1 ? (s.page as number) : undefined,
    product: s.tab === 'resep' && typeof s.product === 'string' ? s.product : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    const none = { outletId, items: [] as Ingredient[], menus: [] as Product[], product: null as Product | null, recipe: null as RecipeCost | null, purchases: { rows: [] as Purchase[], total: 0 } };
    if (!outletId) return none;
    if (deps.tab === 'belanja') {
      const [items, purchases] = await Promise.all([listIngredients({ data: { outletId } }), listPurchases({ data: { outletId, page: deps.page ?? 1 } })]);
      return { ...none, items, purchases };
    }
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
        <Chip aria-current={search.tab ? undefined : 'page'} onClick={() => set({ tab: undefined, product: undefined, page: undefined })}>
          {t('Bahan')}
        </Chip>
        <Chip aria-current={search.tab === 'resep' ? 'page' : undefined} onClick={() => set({ tab: 'resep', product: undefined, page: undefined })}>
          {t('Resep')}
        </Chip>
        <Chip aria-current={search.tab === 'belanja' ? 'page' : undefined} onClick={() => set({ tab: 'belanja', product: undefined, page: undefined })}>
          {t('Belanja')}
        </Chip>
      </nav>
      {!search.product && (
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">{t('Cara pakai')}</summary>
          <ol className="mt-2 list-decimal pl-6">
            <li>{t('Catat belanja di tab Belanja saat belanja dengan uang di luar laci.')}</li>
            <li>{t('Hitung stok sekali di tab Bahan untuk memulai stok, lalu hitung lagi kapan saja.')}</li>
            <li>{t('Harga bahan naik? Catat belanja barunya, jangan diketik langsung.')}</li>
          </ol>
        </details>
      )}
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
              <OutletField all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, product: undefined, page: undefined })} />
            </div>
          </div>
          {search.tab === 'resep' ? (
            <RecipeList menus={data.menus} onOpen={(id) => set({ product: id })} />
          ) : search.tab === 'belanja' ? (
            <PurchaseList outletId={data.outletId} items={data.items} purchases={data.purchases} page={search.page ?? 1} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
          ) : (
            <IngredientList outletId={data.outletId} items={data.items} />
          )}
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
      {items.some((i) => !i.stockStarted) && <p className="mt-4">{t('Hitung stok sekali untuk memulai stok bahan.')}</p>}
      {items.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada bahan.')}>
          <Button variant="fire" onClick={() => setEditing('new')}>
            {t('Tambah bahan')}
          </Button>
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
                <th scope="col">
                  <span className="sr-only">{t('Aksi')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td data-l={t('Bahan')}>
                    <span className="font-semibold">{i.name}</span>
                    <details className="text-[14px] text-mute">
                      <summary className="cursor-pointer">{t('Lihat detail')}</summary>
                      <p>
                        {t('Terakhir dihitung')}: {i.lastCountedAt ? dateShort(i.lastCountedAt, lang) : t('belum pernah')}
                      </p>
                      <p>
                        {t('Dipakai di')}: {i.usedBy === 0 ? t('belum dipakai') : t('{n} menu', { n: i.usedBy })}
                      </p>
                    </details>
                  </td>
                  <td data-l={t('Stok')} className="num">
                    {i.stockStarted ? (
                      <span className={i.stock < 0 ? 'font-semibold text-error' : undefined}>{stockText(i.stock, i.baseUnit, lang)}</span>
                    ) : (
                      <span className="text-mute">{t('Belum ada stok')}</span>
                    )}
                  </td>
                  <td data-l={t('Harga rata-rata')} className="num">
                    {money(i.price)} / {i.packLabel || t('kemasan')}
                    <span className="block text-[14px] text-mute">{unitCostText(i, lang)}</span>
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
          <Button variant="ink" onClick={remove} busy={act.busy} busyLabel={t('Menghapus...')}>
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
                  {!p.isActive && <span className="block text-[14px] text-mute">{t('nonaktif')}</span>}
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

/** "Susu 12 kemasan, SKM 2 kaleng, +2": the first two ingredients, then how many more. */
function purchaseSummary(p: Purchase, pack: string, lang: 'id' | 'en') {
  const head = p.lines.slice(0, 2).map((l) => `${l.name} ${decimal(l.packs, lang, 3)} ${l.packLabel || pack}`);
  return p.lines.length > 2 ? [...head, `+${p.lines.length - 2}`].join(', ') : head.join(', ');
}

function PurchaseList({
  outletId,
  items,
  purchases,
  page,
  onPage,
}: {
  outletId: string | null;
  items: Ingredient[];
  purchases: { rows: Purchase[]; total: number };
  page: number;
  onPage: (page: number) => void;
}) {
  const { t, lang } = useI18n();
  const lock = useLock();
  const [recording, setRecording] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  return (
    <>
      <p className="mt-4">{t('Belanja dengan uang di luar laci. Uang laci dicatat kasir di Pengeluaran.')}</p>
      {outletId && (
        <div className="mt-4">
          <Button variant="fire" onClick={() => setRecording(true)} {...lock.props}>
            {lock.label(t('Catat belanja'))}
          </Button>
        </div>
      )}
      {purchases.rows.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada belanja.')}>
          <Button variant="fire" onClick={() => setRecording(true)} {...lock.props}>
            {lock.label(t('Catat belanja'))}
          </Button>
        </Empty>
      ) : (
        <div className="tbl-wrap mt-5">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Tanggal')}</th>
                <th scope="col">{t('Bahan')}</th>
                <th scope="col" className="num">
                  {t('Total')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('Aksi')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {purchases.rows.map((p) => {
                const cancelled = p.cancelledAt !== null;
                return (
                  <tr key={p.id}>
                    <td data-l={t('Tanggal')} className={cancelled ? 'line-through' : undefined}>
                      {dateShort(p.boughtOn, lang)}
                      {cancelled && <span className="block text-[14px] text-mute no-underline">{t('dibatalkan')}</span>}
                    </td>
                    <td data-l={t('Bahan')} className={cancelled ? 'text-mute line-through' : undefined}>
                      {purchaseSummary(p, t('kemasan'), lang)}
                    </td>
                    <td data-l={t('Total')} className={`num ${cancelled ? 'text-mute line-through' : ''}`}>
                      {money(p.total)}
                    </td>
                    <td data-l={t('Aksi')}>
                      <Button sm onClick={() => setViewing(p)} aria-label={`${t('Lihat')} ${dateShort(p.boughtOn, lang)}`}>
                        {t('Lihat')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(purchases.total / PURCHASE_PAGE))} onPage={onPage} />
      {recording && outletId && <PurchaseDialog outletId={outletId} ingredients={items} onClose={() => setRecording(false)} />}
      {viewing && <PurchaseDetail purchase={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** One purchase with each line's price before and after; the cancel form opens inside it. */
function PurchaseDetail({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  const act = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    const check = purchaseCancelSchema.safeParse({ id: purchase.id, reason });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => cancelPurchase({ data: check.data }), { success: t('Belanja dibatalkan.') });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('Rincian belanja')}
      description={`${dateShort(purchase.boughtOn, lang)}${purchase.cancelledAt ? `, ${t('dibatalkan')}` : ''}`}
      footer={
        cancelling ? (
          <>
            <Button onClick={() => setCancelling(false)} disabled={act.busy}>
              {t('Batal')}
            </Button>
            <Button type="submit" form="purchase-cancel" variant="ink" busy={act.busy} busyLabel={t('Membatalkan...')}>
              {t('Batalkan belanja')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('Tutup')}</Button>
            {!purchase.cancelledAt && (
              <Button variant="fire" onClick={() => setCancelling(true)} {...lock.props}>
                {lock.label(t('Batalkan belanja'))}
              </Button>
            )}
          </>
        )
      }
    >
      <ul className="grid gap-2">
        {purchase.lines.map((l) => (
          <li key={l.ingredientId} className="rounded border border-rule bg-slip px-3 py-2">
            <div className="flex flex-wrap justify-between gap-x-4">
              <span className="font-semibold">
                {l.name}
                {l.expenseItemId && <span className="ml-2 text-[14px] font-normal text-mute">({t('dari pengeluaran')})</span>}
              </span>
              <span className="font-mono text-[15px]">
                {decimal(l.packs, lang, 3)} {l.packLabel || t('kemasan')}, {money(l.total)}
              </span>
            </div>
            <p className="font-mono text-[14px] text-mute">
              {t('Harga sebelum')} {money(l.priceBefore)}, {t('Harga sesudah')} {money(l.priceAfter)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-right font-mono text-[16px] font-semibold">
        {t('Total belanja')}: {money(purchase.total)}
      </p>
      {cancelling && (
        <form id="purchase-cancel" noValidate onSubmit={cancel} className="mt-4 grid gap-3">
          <ReasonChips options={['Salah catat', 'Dibatalkan pemasok', 'Harga salah']} onPick={setReason} />
          <Field label={t('Alasan pembatalan')}>
            <Input
              autoFocus
              value={reason}
              onChange={(e) => {
                act.setError('');
                setReason(e.target.value);
              }}
            />
          </Field>
        </form>
      )}
      <FormAlert>{act.error && t(act.error)}</FormAlert>
    </Dialog>
  );
}

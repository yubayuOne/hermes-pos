import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, ChipGroup, Dialog, Empty, Field, FormAlert, Input, Select, Switch, amount, isoDay, money, useI18n, PencilIcon } from '@hermes-pos/ui';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';
import { listProductSales } from '../../server/summary';
import { FilterBar, OutletField, SearchBox } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination, pageOf } from '../../components/Pagination';
import { useApp, useLock } from '../../lib/app';
import { categorySchema, productSchema } from '../../lib/schemas';
import type { Category, Product, ProductSale } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { useForm } from '../../lib/useForm';
import { createCategory, listCatalog, saveProduct, setProductActive } from '../../server/manage';
import { pageHead } from '../../lang';

type Search = PeriodSearch & { outlet?: string; cat?: string; q?: string; page?: number };

export const Route = createFileRoute('/_app/products')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    cat: typeof s.cat === 'string' ? s.cat : undefined,
    q: typeof s.q === 'string' ? s.q : undefined,
    page: Number.isInteger(s.page) && (s.page as number) > 1 ? (s.page as number) : undefined,
  }),
  loaderDeps: ({ search }) => ({ outlet: search.outlet, period: search.period, from: search.from, to: search.to }),
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    const outletId = deps.outlet ?? context.app.outlets[0]?.id;
    if (!outletId) return { outletId: null, categories: [], products: [], sold: {} as Record<string, ProductSale>, range, today };
    const [catalog, sold] = await Promise.all([listCatalog({ data: { outletId } }), listProductSales({ data: { outletId, ...range, tz } })]);
    return { outletId, ...catalog, sold, range, today };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Produk|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Produk|menu'),
  component: Products,
});

/** D8. Filter by outlet, search, category chips, usage against the per-outlet limit, and an Active switch. */
function Products() {
  const { t } = useI18n();
  const app = useApp();
  const lock = useLock();
  const search = Route.useSearch();
  const { outletId, categories, products, sold, range, today } = Route.useLoaderData();
  const periodLabel = usePeriodLabel(search, range);
  const navigate = useNavigate({ from: '/products' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const toggle = useAction();
  const [q, setQ] = useState(search.q ?? '');

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const active = products.filter((p) => p.isActive).length;
  const limit = app.subscription.limits.products;
  const matches = products.filter((p) => (!search.cat || p.categoryId === search.cat) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
  const view = pageOf(matches, search.page ?? 1);
  const shown = view.rows;

  function setActive(p: Product, on: boolean) {
    toggle.run(() => setProductActive({ data: { id: p.id, active: on } }), {
      toastError: true,
      success: on ? t('{name} aktif lagi.', { name: p.name }) : t('{name} dinonaktifkan.', { name: p.name }),
      undo: () => setProductActive({ data: { id: p.id, active: !on } }),
    });
  }

  return (
    <Page title={t('Produk|menu')}>
      {/* Search, one Filter button (outlet, period of the Terjual column, category), and the main action. A new category
          is made from the product dialog. */}
      <FilterBar
        search={
          <SearchBox
            label={t('Cari produk')}
            placeholder={t('Cari nama produk')}
            value={q}
            onChange={(v) => {
              setQ(v);
              if (search.page) set({ page: undefined });
            }}
            onSubmit={() => set({ q: q.trim() || undefined })}
          />
        }
        active={(search.outlet && search.outlet !== app.outlets[0]?.id ? 1 : 0) + (search.period ? 1 : 0) + (search.cat ? 1 : 0)}
        summary={[
          app.outlets.find((o) => o.id === outletId)?.name,
          t('Terjual {period}', { period: periodLabel }),
          (search.cat && catName.get(search.cat)) || t('Semua kategori'),
          t('{n} / {max} produk aktif', { n: active, max: limit }),
        ]
          .filter(Boolean)
          .join(' · ')}
        onReset={() => set({ outlet: undefined, period: undefined, from: undefined, to: undefined, cat: undefined, page: undefined })}
        action={
          products.length > 0 && (
            <Button variant="fire" className="w-full sm:w-auto" onClick={() => setEditing('new')} {...lock.props}>
              {lock.label(t('Tambah produk'))}
            </Button>
          )
        }
      >
        <OutletField all={false} value={outletId} onChange={(id) => set({ outlet: id ?? undefined, cat: undefined, page: undefined })} />
        <PeriodFilter value={search} range={range} today={today} onChange={(patch) => set({ ...patch, page: undefined })} />
        <p className="-mt-2 text-[14px] text-mute">{t('Periode untuk kolom Terjual, dari bill selesai.')}</p>
        {/* A dropdown, not a row of chips: an outlet can have many categories (owner's request, 17 Oct 2026). */}
        <Field label={t('Kategori')}>
          <Select value={search.cat ?? ''} onChange={(e) => set({ cat: e.target.value || undefined, page: undefined })}>
            <option value="">{t('Semua kategori')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      {sold === null && (
        <p role="status" className="mt-3 text-[14px] font-semibold text-error">
          {t('Jumlah terjual belum bisa dimuat. Muat ulang halaman sebentar lagi.')}
        </p>
      )}

      {products.length === 0 ? (
        <Empty
          className="mt-6"
          title={t('Belum ada produk.')}
          action={
            <Button variant="fire" onClick={() => setEditing('new')} {...lock.props}>
              {lock.label(t('Tambah produk'))}
            </Button>
          }
        >
          {t('Produk yang dibuat di sini langsung muncul di aplikasi kasir outlet ini.')}
        </Empty>
      ) : shown.length === 0 ? (
        <p className="slipc mt-6 text-mute">{t('Tidak ada produk yang cocok. Ubah pencarian atau kategori.')}</p>
      ) : (
        <div className="tbl-wrap mt-6">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Produk')}</th>
                <th scope="col" className="num">
                  {t('Harga')}
                </th>
                <th scope="col" className="num">
                  HPP
                </th>
                <th scope="col" className="num">
                  {t('Stok')}
                </th>
                <th scope="col" className="num">
                  {t('Terjual')}
                </th>
                <th scope="col">{t('Aktif')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => (
                <tr key={p.id} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                  <td data-l={t('Produk')}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-left font-semibold underline-offset-4 hover:underline disabled:no-underline"
                      onClick={() => setEditing(p)}
                      disabled={lock.locked}
                      aria-label={t('Ubah produk {name}', { name: p.name })}
                    >
                      {p.name}
                      <PencilIcon />
                    </button>
                    <span className="block text-[14px] text-mute">{(p.categoryId && catName.get(p.categoryId)) || t('Tanpa kategori')}</span>
                  </td>
                  <td data-l={t('Harga')} className="num">
                    {money(p.price)}
                  </td>
                  <td data-l="HPP" className="num">
                    {money(p.hpp)}
                  </td>
                  <td data-l={t('Stok')} className="num">
                    {p.trackStock ? amount(p.stock) : <span className="font-sans text-mute">{t('tanpa stok')}</span>}
                  </td>
                  <td data-l={t('Terjual')} className="num">
                    {sold ? amount(sold[p.id]?.qty ?? 0) : '-'}
                  </td>
                  <td data-l={t('Aktif')}>
                    <Switch
                      checked={p.isActive}
                      label={t('Produk {name} aktif', { name: p.name })}
                      disabled={lock.locked || toggle.busy}
                      onChange={(v) => setActive(p, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={view.page} pages={view.pages} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
      {editing && outletId && (
        <ProductDialog
          outletId={outletId}
          product={editing === 'new' ? null : editing}
          categories={categories}
          defaultCategory={search.cat}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}

function ProductDialog({
  outletId,
  product,
  categories,
  defaultCategory,
  onClose,
}: {
  outletId: string;
  product: Product | null;
  categories: Category[];
  defaultCategory?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const act = useAction();
  const [newCat, setNewCat] = useState(false);
  const f = useForm({
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? defaultCategory ?? '',
    price: product ? String(product.price) : '',
    hpp: product ? String(product.hpp) : '',
    trackStock: product?.trackStock ?? false,
    stock: product ? String(product.stock) : '0',
    station: product?.station ?? ('kitchen' as 'kitchen' | 'bar'),
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = f.values;
    const data = f.check(productSchema, {
      id: product?.id ?? null,
      outletId,
      categoryId: v.categoryId || null,
      name: v.name,
      price: v.price === '' ? NaN : Number(v.price),
      hpp: Number(v.hpp || 0),
      trackStock: v.trackStock,
      stock: Number(v.stock || 0),
      station: v.station,
    });
    if (!data) return;
    const res = await act.run(() => saveProduct({ data }), {
      success: product ? t('{name} disimpan.', { name: data.name }) : t('{name} ditambahkan.', { name: data.name }),
      refreshAppContext: !product,
    });
    if (res) onClose();
  }
  return (
    <>
      <Dialog
        open
        wide
        onOpenChange={(o) => !o && !newCat && onClose()}
        title={product ? t('Ubah produk') : t('Tambah produk')}
        footer={
          <>
            <Button onClick={onClose}>{t('Batal')}</Button>
            <Button type="submit" form="product" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
              {t('Simpan produk')}
            </Button>
          </>
        }
      >
        <form id="product" noValidate onSubmit={save} className="grid gap-4">
          <Field label={t('Nama produk')} error={f.errors.name && t(f.errors.name)}>
            <Input autoFocus value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
          </Field>
          <Field
            label={t('Kategori')}
            optional
            help={
              <button type="button" className="lnk lnk-inline text-[13px] text-ink" onClick={() => setNewCat(true)}>
                {t('Kategori belum ada? Buat baru')}
              </button>
            }
          >
            <Select value={f.values.categoryId} onChange={(e) => f.set('categoryId', e.target.value)}>
              <option value="">{t('Tanpa kategori')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Harga jual (Rp)')} error={f.errors.price && t(f.errors.price)}>
              <Input inputMode="numeric" className="font-mono" value={f.values.price} onChange={(e) => f.set('price', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label={t('HPP (Rp)')} error={f.errors.hpp && t(f.errors.hpp)} help={t('Modal per porsi, untuk menghitung laba.')}>
              <Input inputMode="numeric" className="font-mono" value={f.values.hpp} onChange={(e) => f.set('hpp', e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <div className="fld">
            <span className="fld-l">{t('Stok')}</span>
            <ChipGroup
              label={t('Stok')}
              value={f.values.trackStock ? 'track' : 'none'}
              onChange={(v) => f.set('trackStock', v === 'track')}
              options={[
                { value: 'track', label: t('Lacak stok') },
                { value: 'none', label: t('Tanpa stok') },
              ]}
            />
            <p className="help">
              {f.values.trackStock ? t('Stok berkurang saat terjual dan produk tidak bisa dijual saat habis.') : t('Selalu bisa dijual, stok tidak dihitung.')}
            </p>
          </div>
          {f.values.trackStock && (
            <Field label={product ? t('Stok') : t('Stok awal')} error={f.errors.stock && t(f.errors.stock)}>
              <Input inputMode="numeric" className="font-mono" value={f.values.stock} onChange={(e) => f.set('stock', e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          <div className="fld">
            <span className="fld-l">{t('Tiket dicetak ke')}</span>
            <ChipGroup
              label={t('Tiket dicetak ke')}
              value={f.values.station}
              onChange={(v) => f.set('station', v)}
              options={[
                { value: 'kitchen', label: t('Dapur') },
                { value: 'bar', label: 'Bar' },
              ]}
            />
          </div>
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </form>
      </Dialog>
      {newCat && (
        <CategoryDialog
          outletId={outletId}
          onClose={(id) => {
            setNewCat(false);
            if (id) f.set('categoryId', id);
          }}
        />
      )}
    </>
  );
}

function CategoryDialog({ outletId, onClose }: { outletId: string; onClose: (createdId?: string) => void }) {
  const { t } = useI18n();
  const act = useAction();
  const f = useForm({ name: '' });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(categorySchema, { outletId, name: f.values.name });
    if (!data) return;
    const res = await act.run(() => createCategory({ data }), { success: t('Kategori {name} dibuat.', { name: data.name }) });
    if (res) onClose(res.data);
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Kategori baru')}
      description={t('Kategori berlaku untuk outlet yang sedang dipilih.')}
      footer={
        <>
          <Button onClick={() => onClose()}>{t('Batal')}</Button>
          <Button type="submit" form="category" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan kategori')}
          </Button>
        </>
      }
    >
      <form id="category" noValidate onSubmit={save}>
        <Field label={t('Nama kategori')} error={f.errors.name && t(f.errors.name)} help={t('Maksimal 20 huruf.')}>
          <Input autoFocus maxLength={20} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <div className="mt-4">
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </div>
      </form>
    </Dialog>
  );
}

import { createServerFn } from '@tanstack/react-start';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LOGO_MAX_UPLOAD, LOGO_TYPES, matchesImageType } from '../lib/logo';
import { productImageError } from '../lib/productImage';
import {
  cashierActiveSchema,
  cashierCreateSchema,
  cashierPinSchema,
  categorySchema,
  outletRefSchema,
  productImageRefSchema,
  outletUpdateSchema,
  parser,
  productActiveSchema,
  productSchema,
  receiptTextSchema,
} from '../lib/schemas';
import type { ActionResult, Cashier, Category, Product } from '../lib/types';

const result = (res: { ok: true } | { ok: false; error: string }): ActionResult => (res.ok ? { ok: true } : res);

// ---------- Outlets ----------
export const updateOutlet = createServerFn({ method: 'POST' })
  .validator(parser(outletUpdateSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    return result(
      await callRpc('owner_update_outlet', {
        p_outlet_id: data.outletId,
        p_name: data.name,
        p_address: data.address,
        p_phone: data.phone,
        p_is_active: data.isActive,
        p_receipt_header: data.header,
        p_receipt_footer: data.footer,
      }),
    );
  });

/** Same header and footer on every outlet of the business. */
export const applyReceiptText = createServerFn({ method: 'POST' })
  .validator(parser(receiptTextSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    return result(await callRpc('owner_apply_receipt_text', { p_header: data.header, p_footer: data.footer }));
  });

// ---------- Cashiers ----------
export const listCashiers = createServerFn({ method: 'GET' }).handler(async (): Promise<Cashier[]> => {
  const { readRpc } = await import('./supabase.server');
  const rows = await readRpc<Record<string, unknown>[]>('owner_list_cashiers');
  return (rows ?? []).map((r) => ({
    cashierId: r.cashier_id as string,
    name: r.cashier_name as string,
    outletId: r.outlet_id as string,
    outletName: r.outlet_name as string,
    isActive: r.is_active as boolean,
    lockedUntil: (r.locked_until as string | null) ?? null,
  }));
});

export const createCashier = createServerFn({ method: 'POST' })
  .validator(parser(cashierCreateSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    return result(await callRpc('owner_create_cashier', { p_outlet_id: data.outletId, p_name: data.name, p_pin: data.pin, p_terminal: 'POS 1' }));
  });

export const setCashierPin = createServerFn({ method: 'POST' })
  .validator(parser(cashierPinSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    return result(await callRpc('owner_set_cashier_pin', { p_cashier_id: data.cashierId, p_pin: data.pin }));
  });

export const setCashierActive = createServerFn({ method: 'POST' })
  .validator(parser(cashierActiveSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    return result(await callRpc('owner_set_cashier_active', { p_cashier_id: data.cashierId, p_active: data.active }));
  });

// ---------- Catalog (categories are per outlet in the database, PRD open question 12) ----------
export const listCatalog = createServerFn({ method: 'GET' })
  .validator(parser(outletRefSchema))
  .handler(async ({ data }): Promise<{ categories: Category[]; products: Product[] }> => {
    const { supabaseServer } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    // RLS on categories/products and the authenticated JWT protect these reads.
    // Avoid a serial getClaims() request before the two parallel data queries.
    const supabase = supabaseServer();
    const [cats, prods] = await Promise.all([
      supabase.from('categories').select('id,name').eq('outlet_id', data.outletId).eq('is_active', true).order('sort_order').order('name'),
      supabase
        .from('products')
        .select('id,category_id,name,hpp,hpp_source,selling_price,stock,track_stock,station,is_active,image_url')
        .eq('outlet_id', data.outletId)
        .eq('is_temporary', false)
        .order('name'),
    ]);
    if (cats.error) throw new Error(describeError(cats.error));
    if (prods.error) throw new Error(describeError(prods.error));
    return {
      categories: (cats.data ?? []).map((c) => ({ id: c.id, name: c.name })),
      products: (prods.data ?? []).map((r) => ({
        id: r.id,
        categoryId: r.category_id,
        name: r.name,
        hpp: Number(r.hpp),
        price: Number(r.selling_price),
        stock: Number(r.stock),
        trackStock: r.track_stock !== false,
        station: (r.station ?? 'kitchen') as 'kitchen' | 'bar',
        isActive: r.is_active,
        imageUrl: r.image_url ?? null,
        hppSource: r.hpp_source === 'recipe' ? ('recipe' as const) : ('manual' as const),
      })),
    };
  });

export const createCategory = createServerFn({ method: 'POST' })
  .validator(parser(categorySchema))
  .handler(async ({ data }): Promise<ActionResult<string>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<unknown>('create_category', { p_outlet_id: data.outletId, p_name: data.name, p_sort_order: 0 });
    if (!res.ok) return res;
    const id = typeof res.data === 'string' ? res.data : ((res.data as { id?: string } | null)?.id ?? '');
    return { ok: true, data: id };
  });

const productArgs = (p: ReturnType<typeof productSchema.parse>) => ({
  p_product_id: p.id ?? null,
  p_recipe: null, // recipes are saved on their own page (owner_save_recipe)
  p_outlet_id: p.outletId,
  p_category_id: p.categoryId,
  p_name: p.name,
  p_hpp: p.hpp,
  p_selling_price: p.price,
  p_stock: p.trackStock ? p.stock : 0,
  p_station: p.station,
  p_track_stock: p.trackStock,
});

export const saveProduct = createServerFn({ method: 'POST' })
  .validator(parser(productSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    return result(await callRpc('owner_save_product', productArgs(data)));
  });

/** Active switch. Switching on counts against the per-outlet product limit (migration 031). */
export const setProductActive = createServerFn({ method: 'POST' })
  .validator(parser(productActiveSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    return result(await callRpc('owner_set_product_active', { p_product_id: data.id, p_active: data.active }));
  });

// ---------- Outlet logo (migrations 034 to 037) ----------
// Uploads run here with the user's cookie session (no browser Supabase client); storage policies only accept
// {business_id}/{outlet_id}/{file} in bucket outlet-logos. Each upload is logo-{ms}.webp plus logo-{ms}.bin, the
// ESC/POS print version.
type Bucket = ReturnType<SupabaseClient['storage']['from']>;
const PRINT_MAX = 16 * 1024;

/**
 * Remove files in the outlet's folder that are older than `stem` (all files when there is none). Names carry the
 * upload time, so a slower parallel upload never deletes a newer logo. Best effort: errors are ignored.
 */
async function clearLogos(bucket: Bucket, folder: string, stem?: string) {
  const { data } = await bucket.list(folder);
  const old = (data ?? []).map((f) => `${folder}/${f.name}`).filter((p) => !stem || p < stem);
  if (old.length) await bucket.remove(old);
}

async function logoFolder(supabase: SupabaseClient, outletId: string): Promise<string> {
  const { data, error } = await supabase.rpc('my_business_id');
  if (error) throw error;
  if (!data) throw new Error('Sesi berakhir. Silakan masuk lagi.');
  return `${data}/${outletId}`;
}

export const uploadOutletLogo = createServerFn({ method: 'POST' })
  .validator((form: FormData) => {
    if (!(form instanceof FormData)) throw new Error('Data tidak valid.');
    const { outletId } = outletRefSchema.parse({ outletId: form.get('outletId') });
    const file = form.get('file');
    if (!(file instanceof File) || !LOGO_TYPES.includes(file.type)) throw new Error('Pilih file PNG, JPEG, atau WebP.');
    if (file.size > LOGO_MAX_UPLOAD) throw new Error('Logo maksimal 256 KB.');
    const print = form.get('print');
    if (!(print instanceof File) || print.size < 8 || print.size > PRINT_MAX) throw new Error('Versi cetak logo tidak valid. Pilih ulang gambarnya.');
    return { outletId, file, print };
  })
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    try {
      // The POS sends this file to the printer as is, so it must start with a GS v 0 raster command.
      const head = new Uint8Array(await data.print.slice(0, 4).arrayBuffer());
      if (head[0] !== 0x1d || head[1] !== 0x76 || head[2] !== 0x30) return { ok: false, error: 'Versi cetak logo tidak valid. Pilih ulang gambarnya.' };
      const image = new Uint8Array(await data.file.slice(0, 12).arrayBuffer());
      if (!matchesImageType(image, data.file.type)) return { ok: false, error: 'Pilih file PNG, JPEG, atau WebP.' };
      const supabase = supabaseServer();
      const folder = await logoFolder(supabase, data.outletId);
      const ext = data.file.type === 'image/png' ? 'png' : data.file.type === 'image/jpeg' ? 'jpg' : 'webp';
      // A new name per upload avoids stale CDN and device caches.
      const stem = `${folder}/logo-${Date.now()}`;
      const path = `${stem}.${ext}`;
      const printPath = `${stem}.bin`;
      const bucket = supabase.storage.from('outlet-logos');
      const up = await bucket.upload(path, data.file, { contentType: data.file.type, upsert: false });
      if (up.error) return { ok: false, error: describeError(up.error) };
      const upPrint = await bucket.upload(printPath, data.print, { contentType: 'application/octet-stream', upsert: false });
      if (upPrint.error) {
        await bucket.remove([path]);
        return { ok: false, error: describeError(upPrint.error) };
      }
      const { error } = await supabase.rpc('owner_set_outlet_logo', {
        p_outlet_id: data.outletId,
        p_logo_url: bucket.getPublicUrl(path).data.publicUrl,
        p_print_url: bucket.getPublicUrl(printPath).data.publicUrl,
      });
      if (error) {
        await bucket.remove([path, printPath]);
        return { ok: false, error: describeError(error) };
      }
      // A failed cleanup must not undo the new logo.
      await clearLogos(bucket, folder, stem).catch(() => {});
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  });

export const removeOutletLogo = createServerFn({ method: 'POST' })
  .validator(parser(outletRefSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    try {
      const supabase = supabaseServer();
      const { error } = await supabase.rpc('owner_set_outlet_logo', { p_outlet_id: data.outletId, p_logo_url: '' });
      if (error) return { ok: false, error: describeError(error) };
      await logoFolder(supabase, data.outletId)
        .then((folder) => clearLogos(supabase.storage.from('outlet-logos'), folder))
        .catch(() => {});
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  });

// ---------- Product photo (migration 080) ----------
// Same route as the outlet logo: the user's cookie session uploads to {business_id}/{outlet_id}/ in bucket
// product-images, and owner_set_product_image stores the public URL. Each upload is {product_id}-{ms}.webp.

/** Remove the product's photo files older than `keep` (all of them without it). Best effort. */
async function clearProductImages(bucket: Bucket, folder: string, productId: string, keep?: string) {
  const { data } = await bucket.list(folder, { search: productId });
  const old = (data ?? [])
    .filter((f) => f.name.startsWith(`${productId}-`))
    .map((f) => `${folder}/${f.name}`)
    .filter((p) => !keep || p < keep);
  if (old.length) await bucket.remove(old);
}

export const uploadProductImage = createServerFn({ method: 'POST' })
  .validator((form: FormData) => {
    if (!(form instanceof FormData)) throw new Error('Data tidak valid.');
    const ref = productImageRefSchema.parse({ outletId: form.get('outletId'), productId: form.get('productId') });
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Pilih foto dulu.');
    const error = productImageError(file.type, file.size);
    if (error) throw new Error(error);
    return { ...ref, file };
  })
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    try {
      const head = new Uint8Array(await data.file.slice(0, 12).arrayBuffer());
      if (!matchesImageType(head, data.file.type)) return { ok: false, error: 'Foto harus WebP atau JPEG.' };
      const supabase = supabaseServer();
      const folder = await logoFolder(supabase, data.outletId);
      const path = `${folder}/${data.productId}-${Date.now()}.${data.file.type === 'image/jpeg' ? 'jpg' : 'webp'}`;
      const bucket = supabase.storage.from('product-images');
      const up = await bucket.upload(path, data.file, { contentType: data.file.type, upsert: false });
      if (up.error) return { ok: false, error: describeError(up.error) };
      const { error } = await supabase.rpc('owner_set_product_image', { p_product_id: data.productId, p_image_url: bucket.getPublicUrl(path).data.publicUrl });
      if (error) {
        await bucket.remove([path]);
        return { ok: false, error: describeError(error) };
      }
      // A failed cleanup must not undo the new photo.
      await clearProductImages(bucket, folder, data.productId, path).catch(() => {});
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  });

export const removeProductImage = createServerFn({ method: 'POST' })
  .validator(parser(productImageRefSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { supabaseServer } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    try {
      const supabase = supabaseServer();
      const { error } = await supabase.rpc('owner_set_product_image', { p_product_id: data.productId, p_image_url: '' });
      if (error) return { ok: false, error: describeError(error) };
      await logoFolder(supabase, data.outletId)
        .then((folder) => clearProductImages(supabase.storage.from('product-images'), folder, data.productId))
        .catch(() => {});
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  });

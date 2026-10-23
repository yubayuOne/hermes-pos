import { createServerFn } from '@tanstack/react-start';
import { countSchema, ingredientPreviewSchema, ingredientRefSchema, ingredientSchema, outletRefSchema, parser, productRefSchema, purchaseCancelSchema, purchaseListSchema, purchaseSchema, recipePreviewSchema, recipeSaveSchema } from '../lib/schemas';
import type { ActionResult, CountResultLine, Ingredient, IngredientImpact, PurchaseList, RecipeCost } from '../lib/types';
import { toCountLine, toImpact, toIngredient, toPurchaseList, toRecipeCost } from './normalize';

type Row = Record<string, unknown>;

/** Ingredients of one outlet with their price per base unit and how many products use them (084). */
export const listIngredients = createServerFn({ method: 'GET' })
  .validator(parser(outletRefSchema))
  .handler(async ({ data }): Promise<Ingredient[]> => {
    const { readRpc } = await import('./supabase.server');
    return ((await readRpc<Row[] | null>('owner_list_ingredients', { p_outlet_id: data.outletId })) ?? []).map(toIngredient);
  });

/** Creates (no id) or changes an ingredient; the database recalculates every recipe that uses it. Returns the id. */
export const saveIngredient = createServerFn({ method: 'POST' })
  .validator(parser(ingredientSchema))
  .handler(async ({ data }): Promise<ActionResult<string>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<string>('owner_save_ingredient', {
      p_outlet_id: data.outletId,
      p_id: data.id ?? null,
      p_name: data.name,
      p_price: data.price,
      p_pack_qty: data.packQty,
      p_pack_unit: data.packUnit,
      p_pack_label: data.packLabel,
    });
    return res.ok ? { ok: true, data: res.data } : res;
  });

/** The products a price or pack change would move, with their HPP before and after. Writes nothing. */
export const previewIngredient = createServerFn({ method: 'POST' })
  .validator(parser(ingredientPreviewSchema))
  .handler(async ({ data }): Promise<ActionResult<IngredientImpact[]>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<Row[] | null>('owner_preview_ingredient', { p_id: data.id, p_price: data.price, p_pack_qty: data.packQty, p_pack_unit: data.packUnit });
    return res.ok ? { ok: true, data: (res.data ?? []).map(toImpact) } : res;
  });

export const deleteIngredient = createServerFn({ method: 'POST' })
  .validator(parser(ingredientRefSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_delete_ingredient', { p_id: data.id });
    return res.ok ? { ok: true } : res;
  });

/** Cost of the lines being typed, for the live result in the recipe editor. */
export const previewRecipe = createServerFn({ method: 'POST' })
  .validator(parser(recipePreviewSchema))
  .handler(async ({ data }): Promise<ActionResult<RecipeCost>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<Row | null>('owner_preview_recipe', { p_outlet_id: data.outletId, p_lines: data.lines });
    return res.ok ? { ok: true, data: toRecipeCost(res.data) } : res;
  });

/** The stored recipe of a product with its cost. */
export const getRecipe = createServerFn({ method: 'GET' })
  .validator(parser(productRefSchema))
  .handler(async ({ data }): Promise<RecipeCost> => {
    const { readRpc } = await import('./supabase.server');
    return toRecipeCost(await readRpc<Row | null>('owner_get_recipe', { p_product_id: data.productId }));
  });

/** Replaces a product's recipe; [] removes it and the product keeps its last HPP (085). */
export const saveRecipe = createServerFn({ method: 'POST' })
  .validator(parser(recipeSaveSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_save_recipe', { p_product_id: data.productId, p_lines: data.lines });
    return res.ok ? { ok: true } : res;
  });

/** Ingredient purchases, newest first, 50 a page (088). */
export const listPurchases = createServerFn({ method: 'GET' })
  .validator(parser(purchaseListSchema))
  .handler(async ({ data }): Promise<PurchaseList> => {
    const { readRpc } = await import('./supabase.server');
    return toPurchaseList(await readRpc('owner_list_purchases', { p_outlet_id: data.outletId, p_page: data.page }));
  });

/** Records a purchase: stock goes up and the moving average price follows. */
export const savePurchase = createServerFn({ method: 'POST' })
  .validator(parser(purchaseSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_save_purchase', { p_outlet_id: data.outletId, p_bought_on: data.boughtOn, p_lines: data.lines });
    return res.ok ? { ok: true } : res;
  });

/** Cancels the newest purchase of its ingredients; stock and price go back. */
export const cancelPurchase = createServerFn({ method: 'POST' })
  .validator(parser(purchaseCancelSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_cancel_purchase', { p_purchase_id: data.id, p_reason: data.reason });
    return res.ok ? { ok: true } : res;
  });

/** Sets the counted stock of ingredients; the first count of an ingredient starts its stock. */
export const countIngredients = createServerFn({ method: 'POST' })
  .validator(parser(countSchema))
  .handler(async ({ data }): Promise<ActionResult<CountResultLine[]>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<{ lines?: Row[] } | null>('owner_count_ingredients', { p_outlet_id: data.outletId, p_lines: data.lines });
    return res.ok ? { ok: true, data: (res.data?.lines ?? []).map(toCountLine) } : res;
  });

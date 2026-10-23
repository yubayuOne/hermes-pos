import { createServerFn } from '@tanstack/react-start';
import { ingredientPreviewSchema, ingredientRefSchema, ingredientSchema, outletRefSchema, parser, productRefSchema, recipePreviewSchema } from '../lib/schemas';
import type { ActionResult, Ingredient, IngredientImpact, RecipeCost } from '../lib/types';
import { toImpact, toIngredient, toRecipeCost } from './normalize';

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

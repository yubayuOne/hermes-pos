import { createServerFn } from '@tanstack/react-start';
import { countSchema, ingredientRefSchema, outletRefSchema, parser, productRefSchema, recipePreviewSchema, recipeSaveSchema, barangSchema } from '../lib/schemas';
import type { ActionResult, CountResultLine, Ingredient, RecipeCost } from '../lib/types';
import { toCountLine, toIngredient, toRecipeCost } from './normalize';

type Row = Record<string, unknown>;

/** Ingredients of one outlet with their price per base unit and how many products use them (084). */
export const listIngredients = createServerFn({ method: 'GET' })
  .validator(parser(outletRefSchema))
  .handler(async ({ data }): Promise<Ingredient[]> => {
    const { readRpc } = await import('./supabase.server');
    return ((await readRpc<Row[] | null>('owner_list_ingredients', { p_outlet_id: data.outletId })) ?? []).map(toIngredient);
  });

/** Creates (no id) or changes a barang: name, base unit and whether it is counted. Its price is not set here: the expenses
 *  bring it. The unit and the counted flag are fixed once the barang has any record (099). */
export const saveIngredient = createServerFn({ method: 'POST' })
  .validator(parser(barangSchema))
  .handler(async ({ data }): Promise<ActionResult<string>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<string>('owner_save_barang', {
      p_outlet_id: data.outletId,
      p_id: data.id ?? null,
      p_name: data.name,
      p_unit: data.unit,
      p_counted: data.counted,
    });
    return res.ok ? { ok: true, data: res.data } : res;
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

/** Sets the counted stock of counted barang; the first count of a barang starts its stock. */
export const countIngredients = createServerFn({ method: 'POST' })
  .validator(parser(countSchema))
  .handler(async ({ data }): Promise<ActionResult<CountResultLine[]>> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc<{ lines?: Row[] } | null>('owner_count_ingredients', { p_outlet_id: data.outletId, p_lines: data.lines });
    return res.ok ? { ok: true, data: (res.data?.lines ?? []).map(toCountLine) } : res;
  });

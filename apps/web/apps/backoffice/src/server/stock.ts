import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { outletRefSchema, parser, stockDocumentListSchema, stockDocumentSchema, stockOpeningsSchema, stockSheetSchema } from '../lib/schemas';
import type { ActionResult, StockDocumentList, StockItem, StockOpening } from '../lib/types';
import { toStockDocumentList, toStockItem, toStockOpenings } from './normalize';
import { startOf } from './summary';

/** Tracked products of one outlet with their stock, value, and last count (074). */
export const listStock = createServerFn({ method: 'GET' })
  .validator(parser(outletRefSchema))
  .handler(async ({ data }): Promise<StockItem[]> => {
    const { readRpc } = await import('./supabase.server');
    return ((await readRpc<Record<string, unknown>[]>('owner_list_stock', { p_outlet_id: data.outletId })) ?? []).map(toStockItem);
  });

/** Stock documents of the period (business days), newest first, 50 a page. */
export const listStockDocuments = createServerFn({ method: 'GET' })
  .validator(parser(stockDocumentListSchema))
  .handler(async ({ data }): Promise<StockDocumentList> => {
    const { readRpc } = await import('./supabase.server');
    return toStockDocumentList(
      await readRpc('owner_list_stock_documents', {
        p_outlet_id: data.outletId,
        p_from: startOf(data.from, data.tz),
        p_to: startOf(addDays(data.to, 1), data.tz),
        p_page: data.page,
      }),
    );
  });

/** Stock in or adjustment. The database changes the stock and keeps the document. */
export const saveStockDocument = createServerFn({ method: 'POST' })
  .validator(parser(stockDocumentSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_stock_document', { p_outlet_id: data.outletId, p_kind: data.kind, p_reason: data.reason, p_lines: data.lines });
    return res.ok ? { ok: true } : res;
  });

/** Opening (Awal) per product for a day: the last count before it, or null when never counted (096). */
export const listStockOpenings = createServerFn({ method: 'GET' })
  .validator(parser(stockOpeningsSchema))
  .handler(async ({ data }): Promise<StockOpening[]> => {
    const { readRpc } = await import('./supabase.server');
    return toStockOpenings(await readRpc('owner_stock_openings', { p_outlet_id: data.outletId, p_date: data.date }));
  });

/** One count sheet for a day (null = today). The database books the difference and keeps the document (096). */
export const saveStockSheet = createServerFn({ method: 'POST' })
  .validator(parser(stockSheetSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_stock_opname_sheet', { p_outlet_id: data.outletId, p_lines: data.lines, p_date: data.date });
    return res.ok ? { ok: true } : res;
  });

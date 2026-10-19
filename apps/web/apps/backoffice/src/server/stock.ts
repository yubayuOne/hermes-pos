import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { outletRefSchema, parser, stockDocumentListSchema, stockDocumentSchema } from '../lib/schemas';
import type { ActionResult, StockDocumentList, StockItem } from '../lib/types';
import { toStockDocumentList, toStockItem } from './normalize';
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

/** Stock in, adjustment, or count. The database changes the stock and keeps the document. */
export const saveStockDocument = createServerFn({ method: 'POST' })
  .validator(parser(stockDocumentSchema))
  .handler(async ({ data }): Promise<ActionResult> => {
    const { callRpc } = await import('./supabase.server');
    const res = await callRpc('owner_stock_document', { p_outlet_id: data.outletId, p_kind: data.kind, p_reason: data.reason, p_lines: data.lines });
    return res.ok ? { ok: true } : res;
  });

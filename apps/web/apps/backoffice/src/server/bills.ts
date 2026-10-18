import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { billDetailsSchema, billItemsSchema, billListSchema, billPaymentSchema, billRefSchema, billVoidSchema, parser } from '../lib/schemas';
import type { ActionResult, BillEdit, BillItem, BillList, BillRefund } from '../lib/types';
import { toBillEdit, toBillItem, toBillList, toBillRefund } from './normalize';
import { startOf } from './summary';

/** Bills per page on the Transaksi page. */
export const BILL_PAGE = 50;

/** Bills of the period (business days), newest first (owner_list_bills, migration 028). */
export const listBills = createServerFn({ method: 'GET' })
  .validator(parser(billListSchema))
  .handler(async ({ data }): Promise<BillList> => {
    const { readRpc } = await import('./supabase.server');
    return toBillList(
      await readRpc('owner_list_bills', {
        p_outlet_id: data.outletId,
        p_from: startOf(data.from, data.tz),
        p_to: startOf(addDays(data.to, 1), data.tz),
        p_status: data.status,
        p_search: data.q || null,
        p_limit: BILL_PAGE,
        p_offset: (data.page - 1) * BILL_PAGE,
      }),
    );
  });

/** Items, refunds, and owner edits of one bill (migrations 034, 067). */
export const getBill = createServerFn({ method: 'GET' })
  .validator(parser(billRefSchema))
  .handler(async ({ data }): Promise<{ items: BillItem[]; refunds: BillRefund[]; edits: BillEdit[] }> => {
    const { readRpc } = await import('./supabase.server');
    const [items, refunds, edits] = await Promise.all([
      readRpc<Record<string, unknown>[]>('owner_get_bill_items', { p_transaction_id: data.id }),
      readRpc<Record<string, unknown>[]>('owner_list_bill_refunds', { p_transaction_id: data.id }),
      readRpc<Record<string, unknown>[]>('owner_list_bill_edits', { p_transaction_id: data.id }),
    ]);
    return { items: (items ?? []).map(toBillItem), refunds: (refunds ?? []).map(toBillRefund), edits: (edits ?? []).map(toBillEdit) };
  });

// Edits (migrations 066, 067; each one is logged). Stock, totals, the cash book, and a closed shift's expected cash are recomputed in the database.
const done = (res: { ok: true; data: unknown } | { ok: false; error: string }): ActionResult<number> =>
  res.ok ? { ok: true, data: Number((res.data as { total?: unknown } | null)?.total ?? 0) } : res;

export const voidBill = createServerFn({ method: 'POST' })
  .validator(parser(billVoidSchema))
  .handler(async ({ data }) => {
    const { callRpc } = await import('./supabase.server');
    return done(await callRpc('owner_void_bill', { p_transaction_id: data.id, p_reason: data.reason }));
  });

export const setBillPayment = createServerFn({ method: 'POST' })
  .validator(parser(billPaymentSchema))
  .handler(async ({ data }) => {
    const { callRpc } = await import('./supabase.server');
    return done(await callRpc('owner_set_bill_payment', { p_transaction_id: data.id, p_method: data.method, p_reason: data.reason }));
  });

export const updateBillDetails = createServerFn({ method: 'POST' })
  .validator(parser(billDetailsSchema))
  .handler(async ({ data }) => {
    const { callRpc } = await import('./supabase.server');
    return done(
      await callRpc('owner_update_bill_details', {
        p_transaction_id: data.id,
        p_customer_name: data.customerName,
        p_table_number: data.tableNumber,
        p_notes: data.notes,
      }),
    );
  });

export const updateBillItems = createServerFn({ method: 'POST' })
  .validator(parser(billItemsSchema))
  .handler(async ({ data }) => {
    const { callRpc } = await import('./supabase.server');
    return done(await callRpc('owner_update_bill_items', { p_transaction_id: data.id, p_items: data.items, p_reason: data.reason }));
  });

import { createServerFn } from '@tanstack/react-start';
import { addDays } from '@hermes-pos/ui';
import { customerListSchema, parser } from '../lib/schemas';
import type { CustomerList } from '../lib/types';
import { startOf } from './summary';

export const CUSTOMER_PAGE = 50;

/** Customers by name (081): one page of 50, biggest spender first, for business days `from` to `to`. */
export const listCustomers = createServerFn({ method: 'GET' })
  .validator(parser(customerListSchema))
  .handler(async ({ data }): Promise<CustomerList> => {
    const { readRpc } = await import('./supabase.server');
    const raw = (await readRpc('owner_customers', {
      p_outlet_id: data.outletId,
      p_from: startOf(data.from, data.tz),
      p_to: startOf(addDays(data.to, 1), data.tz),
      p_search: data.q || null,
      p_page: data.page,
    })) as { total?: unknown; rows?: unknown };
    const rows = Array.isArray(raw?.rows) ? (raw.rows as Record<string, unknown>[]) : [];
    return {
      total: Number(raw?.total ?? 0),
      rows: rows.map((r) => ({ name: String(r.name ?? ''), bills: Number(r.bills ?? 0), total: Number(r.total ?? 0), lastAt: String(r.lastAt ?? '') })),
    };
  });

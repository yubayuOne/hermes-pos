import { createServerFn } from '@tanstack/react-start';
import { addDays, dayDiff } from '@hermes-pos/ui';
import { z } from 'zod';
import { parser, productSalesSchema, rangeCheck, summarySchema, timezones } from '../lib/schemas';
import type { SalesSummary } from '../lib/types';

const OFFSET: Record<string, number> = { 'Asia/Jakarta': 7, 'Asia/Makassar': 8, 'Asia/Jayapura': 9 };
/** Start of a calendar day in the business time zone, as an ISO UTC timestamp (no DST in Indonesia). */
export const startOf = (day: string, tz: string) => new Date(Date.parse(`${day}T00:00:00Z`) - (OFFSET[tz] ?? 7) * 3_600_000).toISOString();

/**
 * Quantity sold per product id for the Produk page (migration 061). null when the query fails, so the
 * catalog still opens (for example before 061 is applied); the page then says the column could not load.
 */
export const listProductSales = createServerFn({ method: 'GET' })
  .validator(parser(productSalesSchema))
  .handler(async ({ data }): Promise<Record<string, number> | null> => {
    const { supabaseServer } = await import('./supabase.server');
    const { data: res, error } = await supabaseServer().rpc('owner_product_sales', {
      p_outlet_id: data.outletId,
      p_from: startOf(data.from, data.tz),
      p_to: startOf(addDays(data.to, 1), data.tz),
    });
    if (error) return null;
    return Object.fromEntries(Object.entries((res ?? {}) as Record<string, unknown>).map(([id, qty]) => [id, Number(qty) || 0]));
  });

export function toSummary(raw: unknown): SalesSummary {
  const r = (raw ?? {}) as Partial<SalesSummary>;
  return {
    count: Number(r.count ?? 0),
    sales: Number(r.sales ?? 0),
    profit: Number(r.profit ?? 0),
    cash: Number(r.cash ?? 0),
    voidedCount: Number(r.voidedCount ?? 0),
    voidedTotal: Number(r.voidedTotal ?? 0),
    refundCount: Number(r.refundCount ?? 0),
    refundTotal: Number(r.refundTotal ?? 0),
    daily: r.daily ?? [],
    hourly: r.hourly ?? [],
    byOutlet: r.byOutlet ?? [],
    byCashier: r.byCashier ?? [],
    top: r.top ?? [],
    discountTotal: Number(r.discountTotal ?? 0),
    qris: Number(r.qris ?? 0),
    previousSales: Number(r.previousSales ?? 0),
    previousCount: Number(r.previousCount ?? 0),
    totalItems: Number(r.totalItems ?? 0),
    expenses: {
      total: Number(r.expenses?.total ?? 0),
      operasional: Number(r.expenses?.operasional ?? 0),
      belanja: Number(r.expenses?.belanja ?? 0),
      drawer: Number(r.expenses?.drawer ?? 0),
      other: Number(r.expenses?.other ?? 0),
    },
    salesAfterExpenses: Number(r.salesAfterExpenses ?? r.sales ?? 0),
  };
}

export type SummaryData = {
  period: SalesSummary;
  /** Only count, sales and daily are filled. */
  week: SalesSummary;
  /** Only hourly is filled. */
  today: SalesSummary;
  /** null = no closed shift yet. */
  lastVariance: { amount: number; closedAt: string } | null;
};

/**
 * Summary page data in one call (migration 062). The period follows the chips; the charts always show the last 7 days
 * and today's hours (board note: "Grafik selalu 7 hari terakhir dan jam hari ini").
 */
export const getSummary = createServerFn({ method: 'GET' })
  .validator(parser(summarySchema.extend({ today: summarySchema.shape.from, tz: z.enum(timezones) }).refine(...rangeCheck)))
  .handler(async ({ data }): Promise<SummaryData> => {
    const { supabaseServer } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    const { tz, from, to, today } = data;
    const span = dayDiff(from, to) + 1;
    const { data: res, error } = await supabaseServer().rpc('owner_dashboard', {
      p_outlet_id: data.outletId,
      p_from: startOf(from, tz),
      p_to: startOf(addDays(to, 1), tz),
      p_prev_from: startOf(addDays(from, -span), tz),
      p_prev_to: startOf(from, tz),
      p_week_from: startOf(addDays(today, -6), tz),
      p_today_from: startOf(today, tz),
      p_today_to: startOf(addDays(today, 1), tz),
    });
    if (error) throw new Error(describeError(error));
    const r = (res ?? {}) as { period?: unknown; week?: unknown; today?: unknown; lastVariance?: { amount?: unknown; closedAt?: unknown } | null };
    const last = r.lastVariance;
    return {
      period: toSummary(r.period),
      week: toSummary(r.week),
      today: toSummary(r.today),
      lastVariance: last ? { amount: Number(last.amount), closedAt: String(last.closedAt) } : null,
    };
  });

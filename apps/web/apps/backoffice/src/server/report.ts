import { createServerFn } from '@tanstack/react-start';
import { addDays, dayDiff } from '@hermes-pos/ui';
import { z } from 'zod';
import { parser, rangeCheck, summarySchema, timezones } from '../lib/schemas';
import type { Report, SalesSummary } from '../lib/types';
import { toReport } from './normalize';
import { startOf, toSummary } from './summary';

export type ReportData = { report: Report; sales: SalesSummary };

/** Laporan in one call (migration 063: owner_report plus the sales figures it shows). The comparison is the same number of days just before. */
export const getReport = createServerFn({ method: 'GET' })
  .validator(parser(summarySchema.extend({ tz: z.enum(timezones) }).refine(...rangeCheck)))
  .handler(async ({ data }): Promise<ReportData> => {
    const { supabaseServer } = await import('./supabase.server');
    const { describeError } = await import('../lib/errors');
    const supabase = supabaseServer();
    const span = dayDiff(data.from, data.to) + 1;
    const args = {
      p_outlet_id: data.outletId,
      p_from: startOf(data.from, data.tz),
      p_to: startOf(addDays(data.to, 1), data.tz),
      p_prev_from: startOf(addDays(data.from, -span), data.tz),
      p_prev_to: startOf(data.from, data.tz),
    };
    const { data: res, error } = await supabase.rpc('owner_report_page', args);
    if (error) throw new Error(describeError(error));
    return { report: toReport(res), sales: toSummary((res as { sales?: unknown } | null)?.sales) };
  });

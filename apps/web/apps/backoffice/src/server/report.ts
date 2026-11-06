import { createServerFn } from '@tanstack/react-start';
import { addDays, dayDiff } from '@hermes-pos/ui';
import { z } from 'zod';
import { parser, rangeCheck, summarySchema, timezones } from '../lib/schemas';
import type { ReportDetail } from '../lib/reportBook';
import { toDetail } from '../lib/reportBook';
import type { Report, SalesSummary } from '../lib/types';
import { toReport } from './normalize';
import { startOf, toSummary } from './summary';

export type ReportData = { report: Report; sales: SalesSummary; detail: ReportDetail };

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
    // The page figures (063, 071) and the rows of the four-part report (098), in one round trip.
    const [page, detail] = await Promise.all([
      supabase.rpc('owner_report_page', args),
      supabase.rpc('owner_report_detail', { p_outlet_id: data.outletId, p_from: args.p_from, p_to: args.p_to }),
    ]);
    if (page.error) throw new Error(describeError(page.error));
    if (detail.error) throw new Error(describeError(detail.error));
    return {
      report: toReport(page.data),
      sales: toSummary((page.data as { sales?: unknown } | null)?.sales),
      detail: toDetail(detail.data),
    };
  });

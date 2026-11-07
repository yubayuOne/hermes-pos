import type { AdminPaymentList } from '../lib/types';

type Row = Record<string, unknown>;
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v === null || v === undefined ? d : String(v));
const num = (v: unknown) => Number(v) || 0;

export function toAdminPaymentList(raw: unknown): AdminPaymentList {
  const r = (raw ?? {}) as Row;
  return {
    total: num(r.total),
    rows: ((r.rows as Row[]) ?? []).map((x) => ({
      id: str(x.id),
      invoiceNumber: str(x.invoice),
      provider: str(x.provider, 'manual') as AdminPaymentList['rows'][number]['provider'],
      business: str(x.business),
      planCode: str(x.plan, 'monthly') as AdminPaymentList['rows'][number]['planCode'],
      extraOutlets: num(x.extraOutlets),
      amountDue: num(x.amountDue),
      amountPaid: num(x.amountPaid),
      status: str(x.status, 'submitted') as AdminPaymentList['rows'][number]['status'],
      rejectReason: (x.rejectReason as string | null) ?? null,
      senderName: str(x.senderName),
      bankName: str(x.bank),
      createdAt: str(x.createdAt),
    })),
  };
}

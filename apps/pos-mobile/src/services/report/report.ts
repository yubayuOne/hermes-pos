export type ReportProduct = { productId: string; name: string; qty: number; total: number };
export type ReportCategory = { categoryId: string; name: string; qty: number; total: number; products: ReportProduct[] };
export type SalesReport = {
  totalRevenue: number;
  cashRevenue: number;
  qrisRevenue: number;
  pettyCash: number;
  expectedCash: number;
  actualCash: number | null;
  variance: number | null;
  totalItems: number;
  totalTransactions: number;
  grossSales: number;
  discountTotal: number;
  voidedCount: number;
  voidedTotal: number;
  refundCount: number;
  refundTotal: number;
  refundCash: number;
  refundQris: number;
  categories: ReportCategory[];
};

/** get_shift_report's answer, inside pos_shift_snapshot (055). The server computes expectedCash from the cash ledger. */
export function toSalesReport(data: unknown): SalesReport {
  const d: any = data ?? {};
  return {
    totalRevenue: Number(d.totalRevenue ?? 0),
    cashRevenue: Number(d.cashRevenue ?? 0),
    qrisRevenue: Number(d.qrisRevenue ?? 0),
    pettyCash: Number(d.openingCash ?? 0),
    expectedCash: Number(d.expectedCash ?? 0),
    actualCash: d.closingCash == null ? null : Number(d.closingCash),
    variance: d.variance == null ? null : Number(d.variance),
    totalItems: Number(d.totalItems ?? 0),
    totalTransactions: Number(d.totalTransactions ?? 0),
    grossSales: Number(d.grossSales ?? d.totalRevenue ?? 0),
    discountTotal: Number(d.discountTotal ?? 0),
    voidedCount: Number(d.voidedCount ?? 0),
    voidedTotal: Number(d.voidedTotal ?? 0),
    refundCount: Number(d.refundCount ?? 0),
    refundTotal: Number(d.refundTotal ?? 0),
    refundCash: Number(d.refundCash ?? 0),
    refundQris: Number(d.refundQris ?? 0),
    categories: (d.categories ?? []).map((c: any) => ({
      categoryId: String(c.categoryId),
      name: c.name,
      qty: Number(c.qty ?? 0),
      total: Number(c.total ?? 0),
      products: (c.products ?? []).map((p: any) => ({ productId: p.productId, name: p.name, qty: Number(p.qty ?? 0), total: Number(p.total ?? 0) })),
    })),
  };
}

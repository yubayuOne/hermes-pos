import { AppSession, CartItem, CustomerInfo, PaymentMethod, TransactionItemSummary, TransactionSummary } from '../types/domain';
import { ReceiptData } from '../services/printer/types';
import type { ReceiptSettings } from '../services/printer/settings';
import { lineDiscount, lineGross } from './discount';
import { fmtShort } from '../i18n';

/** Address, header, and footer a receipt shows: the outlet's own text (migrations 047, 048), if the owner's switch is on. */
export function receiptTexts(
  r: Pick<ReceiptSettings, 'showAddress' | 'showHeader' | 'showFooter'>,
  data: Pick<ReceiptData, 'outletAddress' | 'outletHeader' | 'outletFooter'>,
) {
  const address = r.showAddress ? data.outletAddress?.trim() : '';
  const header = data.outletHeader?.trim();
  const footer = data.outletFooter?.trim();
  return { address: address || null, header: r.showHeader && header ? [header] : [], footer: r.showFooter && footer ? [footer] : [] };
}

/** Receipt data for a bill that was just paid (or stored offline with a TUNDA number). */
export function receiptFromCart(args: {
  number: string;
  session: AppSession | null;
  items: CartItem[];
  customer: CustomerInfo;
  gross: number;
  discount: number;
  total: number;
  paymentMethod?: PaymentMethod;
  paid: number;
  change: number;
  provisional?: boolean;
}): ReceiptData {
  const lines = args.items.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    total: lineGross(i),
    discount: lineDiscount(i),
    note: i.note,
    station: i.station,
  }));
  return {
    number: args.number,
    date: fmtShort(new Date()),
    cashier: args.session?.cashierName ?? '',
    outlet: args.session?.outletName ?? '',
    outletPhone: args.session?.outletPhone,
    outletAddress: args.session?.outletAddress,
    outletHeader: args.session?.outletReceiptHeader,
    outletFooter: args.session?.outletReceiptFooter,
    logoUrl: args.session?.outletLogoUrl,
    logoPrintUrl: args.session?.outletLogoPrintUrl,
    customer: { name: args.customer.name, phone: args.customer.phone, table: args.customer.table },
    items: lines,
    kitchenItems: lines.filter((l) => l.station === 'kitchen'),
    barItems: lines.filter((l) => l.station === 'bar'),
    subtotal: args.gross,
    discount: args.discount,
    total: args.total,
    paymentMethod: args.paymentMethod ?? 'cash',
    paid: args.paid,
    change: args.change,
    provisional: args.provisional,
  };
}

/** Refund slip: the original bill header, the refunded quantities, and the server's refund amount. */
export function receiptForRefund(
  bill: TransactionSummary,
  refunded: TransactionItemSummary[],
  refund: NonNullable<ReceiptData['refund']>,
  session: AppSession | null,
): ReceiptData {
  return { ...receiptFromBill(bill, refunded, session), date: fmtShort(new Date()), printKind: 'refund', refund };
}

/** Puts the server's bill items on a receipt; subtotal and discount follow from them so subtotal - discount = total. */
export function withServerLines(receipt: ReceiptData, items: TransactionItemSummary[]): ReceiptData {
  const lines = items.map((r) => ({ name: r.productName, quantity: r.quantity, total: r.subtotal, discount: r.discount, note: r.note, station: r.station }));
  const gross = items.reduce((n, r) => n + r.subtotal, 0);
  const discount = Math.max(0, gross - receipt.total);
  return {
    ...receipt,
    items: lines,
    kitchenItems: lines.filter((l) => l.station === 'kitchen'),
    barItems: lines.filter((l) => l.station === 'bar'),
    subtotal: discount > 0 ? gross : receipt.total,
    discount,
  };
}

/** Receipt data for a bill from the shift history (reprint). */
export function receiptFromBill(bill: TransactionSummary, items: TransactionItemSummary[], session: AppSession | null): ReceiptData {
  return withServerLines(
    {
      number: bill.number,
      date: fmtShort(bill.createdAt),
      cashier: session?.cashierName ?? '',
      outlet: session?.outletName ?? '',
      outletPhone: session?.outletPhone,
      outletAddress: session?.outletAddress,
      outletHeader: session?.outletReceiptHeader,
      outletFooter: session?.outletReceiptFooter,
      logoUrl: session?.outletLogoUrl,
      logoPrintUrl: session?.outletLogoPrintUrl,
      customer: { name: bill.customerName ?? '', phone: bill.customerPhone ?? '', table: bill.table ?? '' },
      items: [],
      kitchenItems: [],
      barItems: [],
      subtotal: bill.total,
      total: bill.total,
      paymentMethod: bill.paymentMethod ?? 'cash',
      paid: bill.status === 'completed' ? bill.total : 0,
      change: 0,
      isPaid: bill.status === 'completed',
    },
    items,
  );
}

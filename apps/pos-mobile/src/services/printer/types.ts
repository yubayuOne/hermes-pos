import { ProductStation, PaymentMethod } from '../../types/domain';

export type PrinterConnectionType = 'bluetooth' | 'usb' | 'network';
export type PrinterProtocol = 'escpos' | 'generic';
export type PrinterBrand = 'xprinter' | 'epson' | 'rongta' | 'gprinter' | 'sunmi' | 'zkteco' | 'posiflex' | 'iware' | 'taffware' | 'nyk' | 'odi' | 'generic';
export type PrinterRole = 'receipt' | 'kitchen' | 'bar' | 'reprint' | 'report';
export type PrinterStatus = 'connected' | 'disconnected' | 'error';

export interface ReceiptLine {
  name: string;
  quantity: number;
  total: number;
  /** Discount on this line (Rp). `total` stays the gross line price. */
  discount?: number;
  /** Item note (printed on the customer, kitchen, and bar slips). */
  note?: string | null;
  station: ProductStation;
}

export interface ReceiptCustomer {
  name?: string;
  phone?: string;
  table?: string;
}

export interface ReceiptData {
  number: string;
  date: string;
  cashier: string;
  outlet: string;
  outletPhone?: string | null;
  outletAddress?: string | null;
  /** The outlet's own header and footer text; empty prints none (the footer then reads "Terima kasih"). */
  outletHeader?: string | null;
  outletFooter?: string | null;
  logoUrl?: string | null;
  /** ESC/POS raster file made by the backoffice (migration 037). */
  logoPrintUrl?: string | null;
  /** The downloaded raster, set right before printing when the owner shows the logo. */
  logoRaster?: Uint8Array | null;
  customer: ReceiptCustomer;
  items: ReceiptLine[];
  kitchenItems: ReceiptLine[];
  barItems: ReceiptLine[];
  /** Gross subtotal (before discounts). */
  subtotal: number;
  /** Sum of all discounts (item + bill), Rp. */
  discount?: number;
  total: number;
  paymentMethod: PaymentMethod;
  paid: number;
  change: number;
  isPaid?: boolean;
  customHeader?: string[];
  customFooter?: string[];
  printKind?: 'customer' | 'kitchen' | 'bar' | 'refund';
  /** Refund slip (migration 033): `items` are the refunded quantities, the amount comes from the server. */
  refund?: { amount: number; method: 'cash' | 'qris'; reason: string };
  /** Reprint of a refunded bill: each refund with its reason, as stored by the server. */
  refunds?: Array<{ amount: number; reason: string }>;
  /** Offline receipt with a TUNDA number. */
  provisional?: boolean;
}

export interface PrinterDevice {
  id: string;
  name: string;
  brand?: PrinterBrand;
  model?: string;
  protocol: PrinterProtocol;
  address?: string;
  connectionType: PrinterConnectionType;
  paperWidth: 58 | 80;
  roles: PrinterRole[];
  enabled: boolean;
  autoPrint: boolean;
  status: PrinterStatus;
  lastError?: string | null;
  capabilities?: { cut: boolean; cashDrawer: boolean; image: boolean };
}

export interface PrinterAdapter {
  name: string;
  connect?(printer: PrinterDevice): Promise<void>;
  disconnect?(printer: PrinterDevice): Promise<void>;
  printReceipt(receipt: ReceiptData, printer?: PrinterDevice): Promise<void>;
  testPrint(printer?: PrinterDevice): Promise<void>;
}

export interface PrintResult {
  printerId: string;
  printerName: string;
  ok: boolean;
  error?: string;
}

import { PrinterAdapter, PrinterDevice, PrinterRole, PrintResult, ReceiptData } from './types';
import { buildEscPosReceipt, buildEscPosTest, buildEscPosText } from './escpos';
import { loadReceiptSettings } from './settings';
import { loadLogoRaster } from './logo';
import { loadPrinters, updatePrinter } from './registry';
import { writeBluetooth } from './bluetooth';
import { receiptTexts } from '../../utils/receipt';
import { t } from '../../i18n';

function normalizeBrand(name: string) {
  const n = name.toLowerCase();
  if (n.includes('xprinter') || n.includes('x-printer')) return 'xprinter' as const;
  if (n.includes('epson')) return 'epson' as const;
  if (n.includes('rongta')) return 'rongta' as const;
  if (n.includes('gprinter')) return 'gprinter' as const;
  if (n.includes('sunmi')) return 'sunmi' as const;
  if (n.includes('zkteco') || n.includes('zktec')) return 'zkteco' as const;
  if (n.includes('posiflex')) return 'posiflex' as const;
  if (n.includes('iware')) return 'iware' as const;
  if (n.includes('taffware')) return 'taffware' as const;
  if (n.includes('nyk')) return 'nyk' as const;
  if (n.includes('odi')) return 'odi' as const;
  return 'generic' as const;
}

export const detectPrinterProfile = (name: string) => ({
  brand: normalizeBrand(name),
  protocol: 'escpos' as const,
});

function adapterFor(printer: PrinterDevice): PrinterAdapter {
  if (printer.connectionType === 'bluetooth' && (printer.protocol === 'escpos' || printer.protocol === 'generic')) {
    return {
      name: printer.name,
      async printReceipt(receipt) {
        await writeBluetooth(printer, buildEscPosReceipt(receipt, printer.paperWidth));
      },
      async testPrint() {
        await writeBluetooth(printer, buildEscPosTest(printer.paperWidth));
      },
    };
  }
  throw new Error(t('Sambungan {type} belum didukung. Pakai printer Bluetooth.', { type: printer.connectionType }));
}

async function printersForRole(role: PrinterRole, automatic = false) {
  const printers = await loadPrinters();
  return printers.filter((p) => p.enabled && p.roles.includes(role) && (!automatic || p.autoPrint));
}

async function printToPrinters(printers: PrinterDevice[], action: (adapter: PrinterAdapter, printer: PrinterDevice) => Promise<void>) {
  const results: PrintResult[] = [];
  for (const printer of printers) {
    try {
      await action(adapterFor(printer), printer);
      await updatePrinter(printer.id, { status: 'connected', lastError: null });
      results.push({ printerId: printer.id, printerName: printer.name, ok: true });
    } catch (e: any) {
      const error = e?.message || t('Printer gagal menerima perintah.');
      await updatePrinter(printer.id, { status: 'error', lastError: error });
      results.push({ printerId: printer.id, printerName: printer.name, ok: false, error });
    }
  }
  return results;
}

/** Applies the owner's receipt settings from the backoffice: logo, address, header, footer, phone, cashier, notes. */
export async function withCustomPrintText(data: ReceiptData): Promise<ReceiptData> {
  const r = await loadReceiptSettings();
  const text = receiptTexts(r, data);
  return {
    ...data,
    outletAddress: text.address,
    logoRaster: r.showLogo ? await loadLogoRaster(data.logoPrintUrl) : null,
    // Brand and outlet on their own lines (the receipt centers each line).
    outlet: r.businessName ? `${r.businessName}\n${data.outlet}` : data.outlet,
    outletPhone: r.showPhone ? data.outletPhone : null,
    cashier: r.showCashier ? data.cashier : '',
    items: r.showNotes ? data.items : data.items.map((i) => ({ ...i, note: null })),
    customHeader: text.header,
    customFooter: text.footer,
  };
}

export const printerService = {
  async printReceipt(data: ReceiptData, automatic = true) {
    const printers = await printersForRole('receipt', automatic);
    if (!printers.length) return [];
    const prepared = await withCustomPrintText(data);
    return printToPrinters(printers, (adapter, printer) => adapter.printReceipt(prepared, printer));
  },
  async printKitchen(data: ReceiptData, automatic = true) {
    const printers = await printersForRole('kitchen', automatic);
    const prepared = await withCustomPrintText(data);
    return printToPrinters(printers, (adapter, printer) =>
      adapter.printReceipt({ ...prepared, items: data.kitchenItems, kitchenItems: [], barItems: [], printKind: 'kitchen' }, printer),
    );
  },
  async printBar(data: ReceiptData, automatic = true) {
    const printers = await printersForRole('bar', automatic);
    const prepared = await withCustomPrintText(data);
    return printToPrinters(printers, (adapter, printer) =>
      adapter.printReceipt({ ...prepared, items: data.barItems, kitchenItems: [], barItems: [], printKind: 'bar' }, printer),
    );
  },
  /** Reprint goes to printers with the Cetak ulang role, or to the receipt printers when none has it. */
  async reprint(data: ReceiptData) {
    const prepared = await withCustomPrintText(data);
    let printers = await printersForRole('reprint', false);
    if (!printers.length) printers = await printersForRole('receipt', false);
    return printToPrinters(printers, (adapter, printer) => adapter.printReceipt(prepared, printer));
  },
  async printReportText(text: string) {
    const printers = await printersForRole('report', false);
    const bytes = buildEscPosText(text);
    return printToPrinters(printers, (_adapter, printer) => writeBluetooth(printer, bytes));
  },
  async testPrint(printer: PrinterDevice) {
    return printToPrinters([printer], (adapter, device) => adapter.testPrint(device));
  },
  getAdapter() {
    return null;
  },
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PrinterDevice } from './types';

const KEY = '@hermes-pos/printers/v1';

export const DEFAULT_PRINTERS: PrinterDevice[] = [];

export async function loadPrinters(): Promise<PrinterDevice[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PRINTERS;
    const parsed = JSON.parse(raw) as PrinterDevice[];
    if (!Array.isArray(parsed)) return DEFAULT_PRINTERS;
    // Remove simulator entries from older HERMES POS versions.
    const cleaned = parsed.filter((printer) => (printer.connectionType as string) !== 'simulator');
    // Migrate printers saved by older HERMES POS builds to the universal printer profile.
    return cleaned.map((printer) => ({
      ...printer,
      brand: printer.brand ?? 'generic',
      model: printer.model ?? printer.name,
      protocol: printer.protocol ?? 'escpos',
      capabilities: printer.capabilities ?? { cut: true, cashDrawer: true, image: false },
    }));
  } catch {
    return DEFAULT_PRINTERS;
  }
}

export async function savePrinters(printers: PrinterDevice[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(printers));
}

export async function upsertPrinter(printer: PrinterDevice) {
  const printers = await loadPrinters();
  const next = printers.some((p) => p.id === printer.id) ? printers.map((p) => (p.id === printer.id ? printer : p)) : [...printers, printer];
  await savePrinters(next);
  return next;
}

export async function removePrinter(id: string) {
  const printers = (await loadPrinters()).filter((p) => p.id !== id);
  await savePrinters(printers);
  return printers;
}

export async function updatePrinter(id: string, patch: Partial<PrinterDevice>) {
  const printers = await loadPrinters();
  const next = printers.map((p) => (p.id === id ? { ...p, ...patch } : p));
  await savePrinters(next);
  return next;
}

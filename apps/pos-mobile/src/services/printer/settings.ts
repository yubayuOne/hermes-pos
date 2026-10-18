import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase/client';

/*
 * Which parts of the receipt show is set by the owner in the backoffice (Pengaturan, Bisnis dan struk; migration 031).
 * The texts themselves (address, header, footer) belong to each outlet and come with the cashier list (migrations 047, 048).
 * The POS reads it with the owner's session and keeps a copy so offline receipts look the same.
 */
export interface ReceiptSettings {
  businessName: string;
  showHeader: boolean;
  showFooter: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showCashier: boolean;
  showNotes: boolean;
  showLogo: boolean;
}

const KEY = '@hermes-pos/receipt-settings:v1';
export const DEFAULT_RECEIPT: ReceiptSettings = {
  businessName: '',
  showHeader: true,
  showFooter: true,
  showAddress: true,
  showPhone: true,
  showCashier: true,
  showNotes: true,
  showLogo: true,
};
let memory: ReceiptSettings | null = null;

export async function loadReceiptSettings(): Promise<ReceiptSettings> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) memory = { ...DEFAULT_RECEIPT, ...JSON.parse(raw) };
  } catch {
    /* keep defaults */
  }
  return memory ?? DEFAULT_RECEIPT;
}

export async function refreshReceiptSettings(): Promise<ReceiptSettings> {
  const { data, error } = await supabase.rpc('owner_get_business');
  if (error) throw error;
  const d: any = data ?? {};
  const r: any = d.receipt ?? {};
  memory = {
    businessName: String(d.name ?? ''),
    showHeader: r.show_header !== false,
    showFooter: r.show_footer !== false,
    showAddress: r.show_address !== false,
    showPhone: r.show_phone !== false,
    showCashier: r.show_cashier !== false,
    showNotes: r.show_notes !== false,
    showLogo: r.show_logo !== false,
  };
  void AsyncStorage.setItem(KEY, JSON.stringify(memory)).catch(() => undefined);
  return memory;
}

export async function clearReceiptSettings() {
  memory = null;
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}

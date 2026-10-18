import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * Printed outlet logo (migration 037). The backoffice uploads ready ESC/POS raster commands (GS v 0, black and white,
 * at most 256 dots wide), so the POS needs no image decoder: it downloads the file, checks it, and keeps a copy on the
 * device so offline receipts still print the logo. One copy is kept: a device prints for one outlet at a time.
 */
const KEY = '@hermes-pos/logo-raster:v1';
const MAX_BYTES = 16 * 1024;
/** 48 bytes = 384 dots, the printable width of 58 mm paper. */
const MAX_ROW_BYTES = 48;
let memory: { url: string; bytes: Uint8Array } | null = null;

/** True only for complete GS v 0 commands that fit 58 mm paper, so nothing else ever reaches the printer. */
export function isLogoRaster(b: Uint8Array): boolean {
  if (!b.length || b.length > MAX_BYTES) return false;
  let i = 0;
  while (i < b.length) {
    if (i + 8 > b.length || b[i] !== 0x1d || b[i + 1] !== 0x76 || b[i + 2] !== 0x30 || b[i + 3] > 3) return false;
    const rowBytes = b[i + 4] | (b[i + 5] << 8);
    const rows = b[i + 6] | (b[i + 7] << 8);
    if (!rowBytes || rowBytes > MAX_ROW_BYTES || !rows) return false;
    i += 8 + rowBytes * rows;
  }
  return i === b.length;
}

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Raster for `url`: from memory, then the device copy, then a download (3 s limit). Null when there is no logo or the
 * file is missing or invalid; the receipt then prints without it rather than failing.
 */
export async function loadLogoRaster(url?: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  if (memory?.url === url) return memory.bytes;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.url === url) {
      const bytes = fromBase64(String(saved.data));
      if (isLogoRaster(bytes)) return (memory = { url, bytes }).bytes;
    }
  } catch {
    /* fall through to download */
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!isLogoRaster(bytes)) return null;
    memory = { url, bytes };
    void AsyncStorage.setItem(KEY, JSON.stringify({ url, data: toBase64(bytes) })).catch(() => undefined);
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

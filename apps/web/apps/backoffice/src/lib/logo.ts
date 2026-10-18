/**
 * Outlet logo compression in the browser (owner requirement: as small as possible; the original never leaves the
 * browser). The POS shows the logo at most 88 px, so 256 px is plenty. Storage (migration 035) accepts 256 KB of
 * PNG/JPEG/WebP.
 */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX_INPUT = 10 * 1024 * 1024;
export const LOGO_MAX_UPLOAD = 256 * 1024;

/** True when the first bytes really are the image type the browser claimed (the declared type alone is not proof). */
export function matchesImageType(head: Uint8Array, type: string): boolean {
  const at = (i: number, s: string) => [...s].every((c, k) => head[i + k] === c.charCodeAt(0));
  if (type === 'image/png') return head[0] === 0x89 && at(1, 'PNG');
  if (type === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (type === 'image/webp') return at(0, 'RIFF') && at(8, 'WEBP');
  return false;
}
const BOX = 256;
const TARGET = 40 * 1024;

/** Fit w × h inside a square box, keeping the aspect ratio and never upscaling. */
export function fitInside(w: number, h: number, box = BOX): { width: number; height: number } {
  const k = Math.min(1, box / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * Print version (migration 037): ESC/POS raster commands (GS v 0), black and white, sent to the printer as is, so the
 * POS needs no image decoder. Transparent pixels print white; gray is Floyd-Steinberg dithered. Bands of 64 rows keep
 * each command small for cheap printers.
 */
export function toEscPosRaster(rgba: ArrayLike<number>, width: number, height: number): Uint8Array<ArrayBuffer> {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    lum[i] = 255 - a * (255 - (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]));
  }
  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = lum[i] < 128;
      if (black) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      const err = lum[i] - (black ? 0 : 255);
      if (x + 1 < width) lum[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) lum[i + width - 1] += (err * 3) / 16;
        lum[i + width] += (err * 5) / 16;
        if (x + 1 < width) lum[i + width + 1] += err / 16;
      }
    }
  }
  const out: number[] = [];
  for (let y = 0; y < height; y += 64) {
    const rows = Math.min(64, height - y);
    out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    for (const b of bits.subarray(y * bytesPerRow, (y + rows) * bytesPerRow)) out.push(b);
  }
  return new Uint8Array(out);
}

/**
 * Resize and re-encode as WebP (PNG when the browser has no WebP encoder). Colors are not touched. Also returns the
 * print version built from the same resized pixels.
 */
export async function compressLogo(file: File): Promise<{ blob: Blob; print: Uint8Array<ArrayBuffer> }> {
  if (!LOGO_TYPES.includes(file.type)) throw new Error('Pilih file PNG, JPEG, atau WebP.');
  if (file.size > LOGO_MAX_INPUT) throw new Error('File terlalu besar. Maksimal 10 MB.');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Gambar tidak bisa dibaca. Coba file lain.');
  }
  const { width, height } = fitInside(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Gambar tidak bisa diproses. Coba file lain.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();

  const encode = (type: string, q?: number) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, q));
  let blob: Blob | null = null;
  for (const q of [0.8, 0.7, 0.6, 0.5]) {
    blob = await encode('image/webp', q);
    if (blob?.type !== 'image/webp') {
      blob = await encode('image/png');
      break;
    }
    if (blob.size < TARGET) break;
  }
  if (!blob) throw new Error('Gambar tidak bisa diproses. Coba file lain.');
  if (blob.size > LOGO_MAX_UPLOAD) throw new Error('Logo masih lebih dari 256 KB setelah dikompres. Coba gambar yang lebih sederhana.');
  return { blob, print: toEscPosRaster(ctx.getImageData(0, 0, width, height).data, width, height) };
}

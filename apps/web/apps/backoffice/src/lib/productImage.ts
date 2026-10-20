/**
 * Product photo compression in the browser (owner's decision, 21 Oct 2026: small and cheap to store). The photo is cut
 * to a square from its center and shrunk to 400 px, the size of a menu tile on a tablet. Storage (migration 080) refuses
 * anything over 100 KB, so an original never gets through.
 */
export const PRODUCT_IMAGE_INPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const PRODUCT_IMAGE_UPLOAD_TYPES = ['image/webp', 'image/jpeg'];
export const PRODUCT_IMAGE_MAX_INPUT = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_UPLOAD = 100 * 1024;
const SIDE = 400;
const TARGET = 60 * 1024;

/** The server's check of an upload (the browser step can be skipped): null when it may be stored. */
export function productImageError(type: string, size: number): string | null {
  if (!PRODUCT_IMAGE_UPLOAD_TYPES.includes(type)) return 'Foto harus WebP atau JPEG.';
  if (size <= 0 || size > PRODUCT_IMAGE_MAX_UPLOAD) return 'Foto maksimal 100 KB.';
  return null;
}

/** The centered square of a w × h image, and the side it is drawn at (never upscaled). */
export function squareCrop(w: number, h: number, side = SIDE): { sx: number; sy: number; size: number; out: number } {
  const size = Math.min(w, h);
  return { sx: Math.floor((w - size) / 2), sy: Math.floor((h - size) / 2), size, out: Math.max(1, Math.min(side, size)) };
}

/** Crop, shrink, and encode as WebP (JPEG when the browser has no WebP encoder). */
export async function compressProductImage(file: File): Promise<Blob> {
  if (!PRODUCT_IMAGE_INPUT_TYPES.includes(file.type)) throw new Error('Pilih file JPG, PNG, atau WebP.');
  if (file.size > PRODUCT_IMAGE_MAX_INPUT) throw new Error('Foto maksimal 5 MB.');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Foto tidak bisa dibaca. Coba file lain.');
  }
  const c = squareCrop(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = c.out;
  canvas.height = c.out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Foto tidak bisa diproses. Coba file lain.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, c.sx, c.sy, c.size, c.size, 0, 0, c.out, c.out);
  bmp.close();

  const encode = (type: string, q: number) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, q));
  let blob: Blob | null = null;
  for (const q of [0.8, 0.7, 0.6, 0.5]) {
    blob = await encode('image/webp', q);
    if (blob?.type !== 'image/webp') blob = await encode('image/jpeg', q);
    if (blob && blob.size < TARGET) break;
  }
  if (!blob) throw new Error('Foto tidak bisa diproses. Coba file lain.');
  if (blob.size > PRODUCT_IMAGE_MAX_UPLOAD) throw new Error('Foto masih lebih dari 100 KB. Coba foto lain.');
  return blob;
}

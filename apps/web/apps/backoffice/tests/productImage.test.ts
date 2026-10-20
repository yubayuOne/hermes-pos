import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productImageError, squareCrop } from '../src/lib/productImage.ts';

test('squareCrop: the centered square, shrunk to 400 px, never upscaled', () => {
  assert.deepEqual(squareCrop(1600, 1200), { sx: 200, sy: 0, size: 1200, out: 400 });
  assert.deepEqual(squareCrop(900, 1600), { sx: 0, sy: 350, size: 900, out: 400 });
  assert.deepEqual(squareCrop(300, 200), { sx: 50, sy: 0, size: 200, out: 200 });
});

test('productImageError: only small WebP or JPEG reaches storage', () => {
  assert.equal(productImageError('image/webp', 30 * 1024), null);
  assert.equal(productImageError('image/jpeg', 100 * 1024), null);
  assert.equal(productImageError('image/webp', 100 * 1024 + 1), 'Foto maksimal 100 KB.');
  assert.equal(productImageError('image/webp', 0), 'Foto maksimal 100 KB.');
  assert.equal(productImageError('image/png', 1000), 'Foto harus WebP atau JPEG.');
  assert.equal(productImageError('image/svg+xml', 1000), 'Foto harus WebP atau JPEG.');
});

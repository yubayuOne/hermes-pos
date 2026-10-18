import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitInside, matchesImageType, toEscPosRaster } from '../src/lib/logo.ts';

test('matchesImageType: the bytes must match the declared type (not HTML or a script in disguise)', () => {
  const bytes = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  assert.ok(matchesImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), 'image/png'));
  assert.ok(matchesImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'));
  assert.ok(matchesImageType(bytes('RIFF1234WEBPVP8 '), 'image/webp'));
  assert.ok(!matchesImageType(bytes('<script>alert(1)</script>'), 'image/png'));
  assert.ok(!matchesImageType(bytes('<!DOCTYPE html><html>'), 'image/webp'));
  assert.ok(!matchesImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'image/jpeg'));
  assert.ok(!matchesImageType(new Uint8Array(0), 'image/png'));
  assert.ok(!matchesImageType(bytes('RIFF1234WEBP'), 'image/svg+xml'));
});

const px = (n: number, rgba: number[]) => Array.from({ length: n }, () => rgba).flat();

test('toEscPosRaster: black, white, transparent, and row padding', () => {
  // 8 black pixels: one GS v 0 band, 1 byte per row, 1 row.
  assert.deepEqual([...toEscPosRaster(px(8, [0, 0, 0, 255]), 8, 1)], [0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0xff]);
  // White and fully transparent print nothing.
  assert.deepEqual([...toEscPosRaster(px(8, [255, 255, 255, 255]), 8, 1)].slice(8), [0]);
  assert.deepEqual([...toEscPosRaster(px(8, [0, 0, 0, 0]), 8, 1)].slice(8), [0]);
  // Width 9 pads each row to 2 bytes; the 9th pixel is the top bit of the second byte.
  assert.deepEqual([...toEscPosRaster(px(9, [0, 0, 0, 255]), 9, 1)].slice(4), [2, 0, 1, 0, 0xff, 0x80]);
});

test('toEscPosRaster splits tall images into bands of 64 rows', () => {
  const out = toEscPosRaster(px(8 * 100, [0, 0, 0, 255]), 8, 100);
  assert.equal(out.length, 8 + 64 + 8 + 36);
  assert.deepEqual([...out.subarray(72, 80)], [0x1d, 0x76, 0x30, 0, 1, 0, 36, 0]);
});

test('toEscPosRaster dithers 50% gray to about half black', () => {
  const out = toEscPosRaster(px(64 * 64, [128, 128, 128, 255]), 64, 64);
  let black = 0;
  for (const b of out.subarray(8)) for (let i = 0; i < 8; i++) black += (b >> i) & 1;
  assert.ok(Math.abs(black / 4096 - 0.5) < 0.05, `black ratio ${black / 4096}`);
});

test('fitInside keeps the aspect ratio inside 256 × 256', () => {
  assert.deepEqual(fitInside(1024, 1024), { width: 256, height: 256 });
  assert.deepEqual(fitInside(2000, 500), { width: 256, height: 64 });
  assert.deepEqual(fitInside(300, 1200), { width: 64, height: 256 });
});

test('fitInside never upscales and never returns 0', () => {
  assert.deepEqual(fitInside(120, 80), { width: 120, height: 80 });
  assert.deepEqual(fitInside(256, 100), { width: 256, height: 100 });
  assert.deepEqual(fitInside(5000, 1), { width: 256, height: 1 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opnameSaveSchema } from '../src/lib/schemas.ts';

const outletId = '11111111-1111-4111-8111-111111111111';
const barang = '22222222-2222-4222-8222-222222222222';
const row = (over: Record<string, unknown> = {}) => ({ ingredientId: barang, opening: null, in: 0, out: 0, closing: 5, note: '', ...over });
const save = (rows: unknown[]) => opnameSaveSchema.safeParse({ outletId, date: '2026-11-06', rows });

test('a counted row saves', () => {
  assert.ok(save([row()]).success);
  assert.ok(save([row({ opening: 10, out: 2, closing: 7, note: 'tumpah' })]).success);
});

test('a negative count is refused', () => {
  assert.ok(!save([row({ closing: -1 })]).success);
  assert.ok(!save([row({ out: -2 })]).success);
});

test('a day needs at least one row, and a note is at most 200 letters', () => {
  assert.ok(!save([]).success);
  assert.ok(!save([row({ note: 'x'.repeat(201) })]).success);
});

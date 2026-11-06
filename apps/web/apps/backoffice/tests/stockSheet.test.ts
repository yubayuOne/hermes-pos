import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetAmount, sheetVariance } from '../src/lib/stockSheet.ts';

test('selisih = counted - (opening + received - issued), 3 decimals, never -0 (096)', () => {
  assert.equal(sheetVariance({ opening: 70, received: 30, issued: 3, counted: 75 }), -22);
  assert.equal(sheetVariance({ opening: 10, received: 0, issued: 0, counted: 10 }), 0);
  assert.ok(!Object.is(sheetVariance({ opening: 1, received: 0, issued: 0, counted: 1 }), -0));
  assert.equal(sheetVariance({ opening: 0.1, received: 0.2, issued: 0, counted: 0.3 }), 0);
  assert.equal(sheetVariance({ opening: 1, received: 0, issued: 0, counted: 0.0004 }), -1);
});

test('text in a cell: blank is null, comma is a decimal point, spaces are trimmed (096)', () => {
  assert.equal(sheetAmount(''), null);
  assert.equal(sheetAmount('   '), null);
  assert.equal(sheetAmount('2,5'), 2.5);
  assert.equal(sheetAmount(' 12 '), 12);
  assert.ok(Number.isNaN(sheetAmount(',')));
});

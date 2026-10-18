import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outletUpdateSchema, receiptTextSchema } from '../src/lib/schemas.ts';

const ok = { outletId: '00000000-0000-4000-8000-000000000001', isActive: true, name: 'Cabang', address: '', phone: '', header: '', footer: '' };
const first = (patch: object) => outletUpdateSchema.safeParse({ ...ok, ...patch }).error?.issues[0]?.message;

test('empty address, phone, and receipt text are allowed (they clear the value)', () => {
  assert.ok(outletUpdateSchema.safeParse(ok).success);
});

test('text is trimmed', () => {
  const r = outletUpdateSchema.safeParse({ ...ok, name: '  Cabang  ', header: '  Halo ' });
  assert.ok(r.success);
  assert.equal(r.data.name, 'Cabang');
  assert.equal(r.data.header, 'Halo');
});

test('"all outlets" text: trimmed, empty allowed, 120 at most (migration 048)', () => {
  const r = receiptTextSchema.safeParse({ header: ' Halo ', footer: '' });
  assert.ok(r.success);
  assert.equal(r.data.header, 'Halo');
  assert.equal(receiptTextSchema.safeParse({ header: '', footer: 'x'.repeat(121) }).error?.issues[0]?.message, 'Maksimal 120 karakter.');
});

test('limits match migrations 027 and 047', () => {
  assert.equal(first({ name: ' ' }), 'Isi nama outlet.');
  assert.equal(first({ name: 'x'.repeat(61) }), 'Maksimal 60 karakter.');
  assert.equal(first({ address: 'x'.repeat(201) }), 'Maksimal 200 karakter.');
  assert.equal(first({ phone: '022-abc' }), 'Nomor telepon hanya angka, spasi, atau +.');
  assert.equal(first({ header: 'x'.repeat(121) }), 'Maksimal 120 karakter.');
  assert.equal(first({ footer: 'x'.repeat(121) }), 'Maksimal 120 karakter.');
  assert.ok(outletUpdateSchema.safeParse({ ...ok, footer: 'x'.repeat(120) }).success);
});

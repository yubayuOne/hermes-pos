import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableSchema } from '../src/lib/schemas.ts';

const outletId = '00000000-0000-4000-8000-000000000001';
const first = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
const table = (over: Record<string, unknown> = {}) => tableSchema.safeParse({ outletId, id: null, name: 'Teras', ...over });

test('table name: a short name passes, empty, too long and a bad outlet are refused', () => {
  assert.ok(table().success);
  assert.ok(table({ id: '00000000-0000-4000-8000-000000000002', name: '12' }).success);
  assert.equal(first(table({ name: '   ' })), 'Isi nama meja.');
  assert.equal(first(table({ name: 'x'.repeat(21) })), 'Nama meja maksimal 20 huruf.');
  assert.equal(first(table({ outletId: 'bukan-uuid' })), 'Data tidak valid.');
});

test('the texts of the tables page are translated', async () => {
  const { EN } = await import('../src/dict.ts');
  const texts = ['Meja|menu', 'Tambah meja', 'Belum ada meja.', 'Terisi sejak {time}', 'Nama meja', 'Meja masih terisi. Ganti nama setelah bill-nya selesai.', 'Meja tidak ditemukan'];
  assert.deepEqual(texts.filter((k) => !(k in EN)), []);
});

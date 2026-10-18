// Tests src/services/supabase/offlinePin.ts (the PIN check of the cashier on shift) and src/utils/resume.ts (24-hour rule).
// Run from apps/pos-mobile: node tests/offline_pin_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  bcrypt = require('bcryptjs');
const root = path.join(__dirname, '..');
const compile = (rel, req) => {
  const out = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), {
    compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out)(mod, mod.exports, req);
  return mod.exports;
};
// --- fakes ---
const store = new Map();
let failWrite = false;
const SecureStore = {
  getItemAsync: async (k) => (store.has(k) ? store.get(k) : null),
  setItemAsync: async (k, v) => {
    if (failWrite) throw new Error('keystore busy');
    store.set(k, v);
  },
  deleteItemAsync: async (k) => store.delete(k),
};
const expoCrypto = { getRandomBytes: (n) => new Uint8Array(crypto.randomBytes(n)) };
const P = compile('src/services/supabase/offlinePin.ts', (id) =>
  id === 'expo-secure-store' ? SecureStore : id === 'bcryptjs' ? bcrypt : id === 'expo-crypto' ? expoCrypto : {},
);
const R = compile('src/utils/resume.ts', () => ({}));
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
(async () => {
  ok((await P.checkActivePin('c1', '123456')).reason === 'server', 'P1 nothing remembered: the server must check the PIN');

  await P.rememberPin('c1', '123456');
  ok(![...store.values()].some((v) => String(v).includes('123456')), 'P2 only a hash is kept, never the PIN');
  ok(JSON.parse(store.get('activepin.hash')).hash.startsWith('$2a$10$'), 'P3 bcrypt cost 10');
  ok((await P.checkActivePin('c1', '123456')).ok === true, 'P4 the right PIN of the cashier on shift is accepted on the phone');
  ok((await P.checkActivePin('c2', '123456')).reason === 'server', 'P5 another cashier is never checked on the phone');

  let r;
  for (let i = 1; i <= 4; i++) r = await P.checkActivePin('c1', '000000');
  ok(r.reason === 'wrong' && r.attemptsLeft === 1, 'P6 four wrong PINs: one attempt left');
  r = await P.checkActivePin('c1', '000000');
  ok(r.reason === 'server', 'P7 the fifth wrong PIN hands the check to the server');
  ok((await P.checkActivePin('c1', '123456')).reason === 'server', 'P8 even the right PIN needs the server while locked');

  await P.rememberPin('c1', '123456'); // the server accepted it again
  ok((await P.checkActivePin('c1', '123456')).ok === true, 'P9 a PIN accepted by the server again clears the lock');
  ok((await P.checkActivePin('c1', '12345')).reason === 'wrong', 'P10 not six digits: counted as wrong, never accepted');

  const firstKey = store.get('activepin.key');
  const firstHash = JSON.parse(store.get('activepin.hash')).hash;
  await P.rememberPin('c1', '123456');
  ok(store.get('activepin.key') !== firstKey, 'P11 every sign-in makes a new random key for this phone');
  ok(!(await bcrypt.compare(`${store.get('activepin.key')}:123456`, firstHash)), 'P12 the old hash does not match the new key');

  failWrite = true;
  ok((await P.checkActivePin('c1', '000000')).reason === 'server', 'P13 the count cannot be saved: the server checks, no free attempts');
  failWrite = false;

  await P.forgetPin();
  ok((await P.checkActivePin('c1', '123456')).reason === 'server' && store.size === 0, 'P14 ganti kasir, tutup shift, keluar akun: the check is gone');

  store.set('pinhash.c1', '$2a$06$old');
  store.set('pinlock.c1', '{}');
  await P.dropOldPinHashes(['c1']);
  ok(store.size === 0, 'P15 PIN hashes kept by older versions are dropped');

  const now = Date.parse('2026-10-18T10:00:00Z');
  ok(R.canResumeOffline('2026-10-17T11:00:00Z', now), 'P16 shift opened 23 hours ago: goes on offline');
  ok(!R.canResumeOffline('2026-10-17T09:00:00Z', now), 'P17 shift opened 25 hours ago: needs internet');
  ok(R.canResumeOffline('2026-10-18T10:05:00Z', now), 'P18 phone clock a little behind the opening: goes on');
  ok(!R.canResumeOffline('not a date', now), 'P19 an unreadable time counts as too old');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

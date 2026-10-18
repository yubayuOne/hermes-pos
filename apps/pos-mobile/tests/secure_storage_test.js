// Tests src/services/supabase/secureStorage.ts: the session is cut into pieces for the keystore, read back whole,
// shrinks without leftovers, is removed completely, and an older AsyncStorage session moves over once.
// Run from apps/pos-mobile: node tests/secure_storage_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const secure = new Map(),
  plain = new Map();
const SecureStore = {
  getItemAsync: async (k) => secure.get(k) ?? null,
  setItemAsync: async (k, v) => {
    if (!/^[\w.-]+$/.test(k)) throw new Error(`bad SecureStore key: ${k}`);
    if (v.length > 2000) throw new Error('value too large for SecureStore');
    secure.set(k, v);
  },
  deleteItemAsync: async (k) => void secure.delete(k),
};
const AsyncStorage = {
  getItem: async (k) => plain.get(k) ?? null,
  setItem: async (k, v) => void plain.set(k, v),
  removeItem: async (k) => void plain.delete(k),
};
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'supabase', 'secureStorage.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true } }).outputText)(
  mod,
  mod.exports,
  (id) => (id.includes('async-storage') ? { __esModule: true, default: AsyncStorage } : SecureStore),
);
const { getItem, setItem, removeItem } = mod.exports;
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};

(async () => {
  const key = 'sb-abc123-auth-token';
  const big = JSON.stringify({ access_token: 'a'.repeat(1500), refresh_token: 'r'.repeat(300), user: { id: 'u', note: 'é🙂'.repeat(900) } });
  await setItem(key, big);
  ok((await getItem(key)) === big && secure.size > 2, 'S1 a session over 2000 characters is stored in pieces and read back whole');
  ok(![...secure.values()].some((v) => v.length > 2000), 'S2 no piece is larger than the keystore accepts');

  await setItem(key, 'short');
  ok((await getItem(key)) === 'short' && secure.size === 2, 'S3 a shorter value leaves no old pieces behind');

  await removeItem(key);
  ok((await getItem(key)) === null && secure.size === 0, 'S4 removing a session removes every piece');

  await setItem('weird key/with:chars', 'x');
  ok((await getItem('weird key/with:chars')) === 'x', 'S5 keys with characters the keystore refuses are made safe');

  secure.clear();
  plain.set(key, 'old-session');
  ok((await getItem(key)) === 'old-session' && !plain.has(key) && secure.size === 2, 'S6 an older session moves from AsyncStorage to the keystore on first read');

  await setItem(key, 'abcdef');
  secure.delete(`${key}.0`);
  ok((await getItem(key)) === null, 'S7 a missing piece reads as signed out, never half a token');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

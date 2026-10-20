// Tests the catalog look per phone (src/services/prefs/catalogView.ts). Run from apps/pos-mobile: node tests/catalog_view_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/prefs/catalogView.ts'), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
const m = { exports: {} };
const storage = { getItem: async () => null, setItem: async () => undefined };
new Function('module', 'exports', 'require', out)(m, m.exports, (id) => (id.includes('async-storage') ? { default: storage } : {}));
const V = m.exports;
let pass = 0,
  fail = 0;
const ok = (c, msg) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', msg);
};
ok(V.resolveCatalogView(null, false) === 'compact', 'no choice, no photos: Ringkas');
ok(V.resolveCatalogView(null, true) === 'photo', 'no choice, a product has a photo: Foto');
ok(V.resolveCatalogView('compact', true) === 'compact', "the cashier's choice wins over photos");
ok(V.resolveCatalogView('photo', false) === 'photo', 'Foto chosen without photos stays Foto');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

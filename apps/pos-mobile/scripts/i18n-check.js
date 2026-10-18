// Lists dictionary keys used in the code that have no English entry, and English entries no longer used.
// Run: node scripts/i18n-check.js   (exit code 1 when something is missing)
const fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|js)$/.test(f)) files.push(p);
  }
})(path.join(root, 'src'));
files.push(path.join(root, 'App.tsx'));
const keys = new Set();
const re = /\bt\(\s*(['`])((?:\\.|(?!\1).)*)\1/g;
for (const f of files) {
  if (f.endsWith(path.join('i18n', 'en.ts'))) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) if (!m[2].includes('${')) keys.add(m[2].replace(/\\'/g, "'"));
}
// Labels passed through t(variable) in arrays.
for (const k of ['Jual', 'Bill', 'Shift', 'Lainnya', 'Struk pelanggan', 'Dapur', 'Bar', 'Cetak ulang', 'Laporan', 'bulan', '6 bulan', 'tahun', 'Salah pesan', 'Item rusak', 'Pelanggan batal', 'Pesanan terlalu lama']) keys.add(k);
const src = fs.readFileSync(path.join(root, 'src/i18n/en.ts'), 'utf8');
const ts = require('typescript');
const out = ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', out)(m, m.exports);
const EN = m.exports.EN;
const missing = [...keys].filter((k) => !(k in EN) && !((k.includes('|') ? k.slice(0, k.indexOf('|')) : k) in EN)).sort();
const unused = Object.keys(EN).filter((k) => !keys.has(k));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(missing, null, 1));
  process.exit(0);
}
console.log(`${keys.size} keys, ${missing.length} missing, ${unused.length} unused`);
missing.forEach((k) => console.log('missing:', k));
unused.forEach((k) => console.log('unused:', k));
process.exit(missing.length ? 1 : 0);

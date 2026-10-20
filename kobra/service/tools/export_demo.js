// Выгружает демо-данные из src/data.js в CSV для сервера: node service/tools/export_demo.js
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const root = path.join(__dirname, '..', '..');
eval(fs.readFileSync(path.join(root, 'src', 'data.js'), 'utf8') + ';global.G={BUILTIN_DATASETS}');
const out = path.join(root, 'service', 'backend', 'app', 'demo');
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const q = v => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
for (const b of G.BUILTIN_DATASETS) {
  const rows = b.generate();
  const lines = [b.columns.map(c => c.key).join(',')];
  for (const r of rows) lines.push(b.columns.map(c => q(c.type === 'date' ? iso(r[c.key]) : r[c.key])).join(','));
  fs.writeFileSync(path.join(out, b.id + '.csv.gz'), zlib.gzipSync(lines.join('\n')));
  const { id, name, description, mainDttm, columns, metrics } = b;
  fs.writeFileSync(path.join(out, b.id + '.json'), JSON.stringify({ id, name, description, mainDttm, columns, metrics }, null, 1));
  console.log(b.id, rows.length);
}

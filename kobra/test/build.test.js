/* Сборка: синтаксис всех файлов и свежесть build/
   Две грабли, описанные в CLAUDE.md как «не забудь», теперь падают тестом,
   а не всплывают через неделю: файл не добавлен в ORDER и build/ не
   пересобран после правки src/. */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
/* Переводы строк в рабочей копии могут быть CRLF (так настроен git на
   Windows), а в src/ — LF: сравниваем тексты, а не байты. */
const read = f => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
const SRC = path.join(ROOT, 'src');
const srcFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
const order = (() => {
  const py = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
  const m = py.match(/ORDER\s*=\s*\[([^\]]*)\]/);
  return (m[1].match(/'([^']+)'/g) || []).map(x => x.slice(1, -1));
})();

test('каждый файл src/ перечислен в ORDER', () => {
  const missing = srcFiles.filter(f => !order.includes(f));
  assert.deepEqual(missing, [], 'не попадут в сборку: ' + missing.join(', '));
});

test('в ORDER нет файлов, которых больше нет', () => {
  const extra = order.filter(f => !srcFiles.includes(f));
  assert.deepEqual(extra, [], 'сборка упадёт на: ' + extra.join(', '));
});

test('все файлы src/ синтаксически целы', () => {
  const bad = [];
  srcFiles.forEach(f => {
    try { execFileSync(process.execPath, ['--check', path.join(SRC, f)], { stdio: 'pipe' }); }
    catch (e) { bad.push(f + ': ' + String(e.stderr || e).split('\n').slice(0, 2).join(' ')); }
  });
  assert.deepEqual(bad, []);
});

/* build/ закоммичен, поэтому рассинхрон с src/ — это не теория: его видно
   только у того, кто открыл собранный файл, а не исходники. */
test('build/index.html собран из нынешних исходников', () => {
  const html = read(path.join(ROOT, 'build', 'index.html'));
  const stale = order.filter(f => !html.includes(read(path.join(SRC, f)).trim()));
  assert.deepEqual(stale, [], 'пересоберите (py build.py): устарело — ' + stale.join(', '));
});

test('build/index.html собран из нынешних стилей', () => {
  const html = read(path.join(ROOT, 'build', 'index.html'));
  assert.ok(html.includes(read(path.join(SRC, 'styles.css')).trim()),
    'пересоберите (py build.py): стили устарели');
});

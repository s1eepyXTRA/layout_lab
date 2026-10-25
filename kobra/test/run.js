/* Прогон всех тестов: node test/run.js (зависимостей нет) */

const fs = require('node:fs');
const path = require('node:path');

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();

let ok = 0, failed = 0;
const fails = [];

/* Регистратор: тест — это имя и функция, падение ловим и идём дальше,
   иначе первая же ошибка прячет остальные. */
global.test = (name, fn) => {
  try { fn(); ok++; }
  catch (e) { failed++; fails.push({ name, e }); process.stdout.write('F'); return; }
  process.stdout.write('.');
};

const started = Date.now();
files.forEach(f => {
  const p = path.join(__dirname, path.basename(f));
  process.stdout.write('\n' + path.basename(f) + ' ');
  require(p);
});

process.stdout.write('\n\n');
fails.forEach(({ name, e }) => {
  console.log('ПРОВАЛ: ' + name);
  console.log('  ' + (e && e.message ? e.message : e));
  if (e && e.stack) console.log(e.stack.split('\n').slice(1, 3).join('\n'));
  console.log('');
});
console.log(`${ok} прошло, ${failed} упало, ${Date.now() - started} мс`);
process.exit(failed ? 1 : 0);

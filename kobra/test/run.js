/* Прогон всех тестов: node test/run.js (зависимостей нет) */

const fs = require('node:fs');
const path = require('node:path');

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();

let ok = 0, failed = 0;
const fails = [];

/* Регистратор: тест — это имя и функция, падение ловим и идём дальше,
   иначе первая же ошибка прячет остальные.

   Функция может вернуть промис: за сервисом расчёт асинхронный, и проверять
   его синхронно нельзя — упавшее ожидание тихо считалось бы пройденным.

   Тесты идут друг за другом, а не вперемешку: они делят глобальное состояние
   (STATE, DS, очередь расчётов), и запущенные одновременно мешали бы друг
   другу — асинхронный тест, не дождавшийся своего, ломал бы следующий. */
let chain = Promise.resolve();
const pass = () => { ok++; process.stdout.write('.'); };
const fail = (name, e) => { failed++; fails.push({ name, e }); process.stdout.write('F'); };
global.test = (name, fn) => {
  chain = chain.then(() => {
    let r;
    try { r = fn(); }
    catch (e) { fail(name, e); return undefined; }
    if (r && typeof r.then === 'function') return r.then(pass, e => fail(name, e));
    pass();
    return undefined;
  });
};

const started = Date.now();
files.forEach(f => {
  const p = path.join(__dirname, path.basename(f));
  process.stdout.write('\n' + path.basename(f) + ' ');
  require(p);
});

/* Итог печатаем, когда дождались асинхронных тестов: иначе отчёт уходит
   раньше их падений, а процесс завершается с нулём. */
chain.then(() => {
  process.stdout.write('\n\n');
  fails.forEach(({ name, e }) => {
    console.log('ПРОВАЛ: ' + name);
    console.log('  ' + (e && e.message ? e.message : e));
    if (e && e.stack) console.log(e.stack.split('\n').slice(1, 3).join('\n'));
    console.log('');
  });
  console.log(`${ok} прошло, ${failed} упало, ${Date.now() - started} мс`);
  process.exit(failed ? 1 : 0);
});

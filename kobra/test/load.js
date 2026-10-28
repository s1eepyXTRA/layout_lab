/* =============================================================
   Кобра · загрузка ядра в node
   Тестов у проекта не было, потому что src/*.js — не модули: это
   обычные скрипты с глобальными функциями, которые build.py склеивает
   в один <script>. Здесь делается то же самое, только в контексте vm
   и без браузера: ядро (data, engine, auth, schema) DOM не трогает,
   поэтому проверяется обычным node, без зависимостей и сборки.
   ============================================================= */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
/* Порядок тот же, что в build.py: он и есть система зависимостей.
   ui.js нужен ради clone/uid/lsGet — на них опирается и движок, и права. */
const CORE = ['data.js', 'engine.js', 'ui.js', 'storage.js', 'auth.js', 'schema.js', 'datasets.js'];

/* `const` и `let` верхнего уровня живут в лексической области скрипта и не
   становятся свойствами глобального объекта — изнутри Кобры они видны, а
   снаружи, из теста, нет. Поэтому нужные имена прокидываем геттерами:
   значение остаётся одно, и переприсваивание из кода видно тесту. */
const BRIDGE = [
  'canView', 'canEdit', 'canShare', 'AUTH', 'STATE', 'DS',
  'clone', 'uid', 'LS_KEY', 'AUTH_ROLES', 'AUTH_ROLE_ORDER', 'AUTH_SYSTEM', 'AUTH_TEAM_ALL',
  'AGGS', 'FILTER_OPS', 'TIME_PRESETS', 'TIME_GRAINS', 'NUMBER_FORMATS', 'COLOR_SCHEMES',
  'BUILTIN_DATASETS', 'visibleDatasets', 'MAX_UPLOAD_ROWS',
];

/* Заглушки браузера: ядро их не зовёт, но файлы лежат в одном скрипте
   с интерфейсом, и при загрузке имена должны существовать. */
function browserStubs() {
  const store = new Map();
  const el = () => ({
    style: {}, classList: { add() { }, remove() { }, toggle() { } }, dataset: {},
    setAttribute() { }, removeAttribute() { }, getAttribute: () => null,
    appendChild() { }, removeChild() { }, remove() { }, addEventListener() { },
    querySelector: () => null, querySelectorAll: () => [], focus() { }, click() { },
    firstChild: null, children: [], textContent: '',
  });
  return {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
    },
    document: Object.assign(el(), {
      documentElement: el(), head: el(), body: el(),
      createElement: el, createTextNode: () => el(), getElementById: () => null,
    }),
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    location: { hash: '', pathname: '/', href: '/' },
    history: { replaceState() { }, pushState() { } },
    requestAnimationFrame: fn => setTimeout(fn, 0),
    indexedDB: undefined,
  };
}

/* Отдаёт контекст со всеми глобальными функциями Кобры */
function loadKobra(files = CORE) {
  const ctx = Object.assign({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Math, Date, JSON, Intl, Map, Set, Array, Object, String, Number, Boolean,
    RegExp, Error, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  }, browserStubs());
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  /* Мостим только лексические имена. Объявления function уже лежат
     свойствами globalThis — если переопределить их геттером, геттер начнёт
     звать сам себя. А имён из незагруженных файлов просто нет. */
  const bridge = BRIDGE.map(n => `try {
    if (!Object.prototype.hasOwnProperty.call(globalThis, '${n}') && typeof ${n} !== 'undefined') {
      Object.defineProperty(globalThis, '${n}', { get: () => ${n}, set: v => { ${n} = v; }, configurable: true });
    }
  } catch (e) { }`).join('\n');
  vm.runInContext(bridge, ctx, { filename: 'bridge' });
  // Сообщения интерфейса в тестах не нужны, а document у нас игрушечный
  ctx.toast = () => { };
  return ctx;
}

module.exports = { loadKobra, CORE };

/* Разбор ответа модели: он обязан пережить всё, что присылают слабые модели */

const assert = require('node:assert');
const { loadKobra, CORE } = require('./load');

const K = loadKobra([...CORE, 'aidraft.js']);
const P = t => K.aiParseTemplate(t);

const GOOD = JSON.stringify({
  ответ: 'Собрал сводку.',
  название: 'Заявки',
  колонки: [
    { подпись: 'Дата заявки', тип: 'date' },
    { подпись: 'Статус', тип: 'string', значения: ['Новая', 'Закрыта'] },
    { подпись: 'Сумма, ₽', тип: 'number', от: 100, до: 5000 },
  ],
  блоки: [
    { вкладка: 'Сводка', вид: 'big_number_trend', название: 'Заявок за месяц', показатель: 'количество строк', разрез: 'Дата заявки', размер: 'треть' },
    { вкладка: 'Сводка', вид: 'bar', название: 'Заявки по статусам', показатель: 'сумма: Сумма, ₽', разрез: 'Статус', размер: 'половина' },
  ],
});

test('чистый ответ разбирается полностью', () => {
  const r = P(GOOD);
  assert.strictEqual(r.plain, false);
  assert.strictEqual(r.название, 'Заявки');
  assert.strictEqual(r.колонки.length, 3);
  assert.strictEqual(r.блоки.length, 2);
  assert.strictEqual(r.блоки[0].виз, 'big_number_trend');
  assert.strictEqual(r.блоки[1].виз, 'bar');
  assert.strictEqual(r.блоки[1].ширина, 6);
});

test('ответ в обёртке и с текстом вокруг', () => {
  const r = P('Конечно! Вот шаблон:\n```json\n' + GOOD + '\n```\nГотово.');
  assert.strictEqual(r.блоки.length, 2);
  assert.strictEqual(r.название, 'Заявки');
});

test('английские ключи', () => {
  const r = P(JSON.stringify({
    answer: 'ok', title: 'Sales',
    columns: [{ label: 'Order date', type: 'date' }, { name: 'City', type: 'string' }],
    blocks: [{ tab: 'Summary', type: 'bar', name: 'Sales by city', metric: 'sum: Revenue', by: 'City', size: 'half' }],
  }));
  assert.strictEqual(r.название, 'Sales');
  assert.strictEqual(r.колонки.length, 2);
  assert.strictEqual(r.блоки.length, 1);
  assert.strictEqual(r.блоки[0].виз, 'bar');
  assert.strictEqual(r.блоки[0].разрез, 'City');
});

test('вложенные вкладки разворачиваются в плоский список', () => {
  const r = P(JSON.stringify({
    вкладки: [
      { название: 'Сводка', блоки: [{ вид: 'line', название: 'Динамика' }] },
      { название: 'Разбор', блоки: [{ вид: 'pie', название: 'Доли' }, { вид: 'table', название: 'Строки' }] },
    ],
  }));
  assert.strictEqual(r.блоки.length, 3);
  assert.strictEqual(r.блоки[0].вкладка, 'Сводка');
  assert.strictEqual(r.блоки[2].вкладка, 'Разбор');
});

test('синонимы видов графиков', () => {
  const r = P(JSON.stringify({ блоки: [
    { вид: 'столбчатая диаграмма' }, { вид: 'круговая' }, { вид: 'большое число' },
    { вид: 'Линейный график' }, { вид: 'сводная таблица' }, { вид: 'воронка' },
  ] }));
  assert.deepEqual(r.блоки.map(b => b.виз), ['bar', 'pie', 'big_number_trend', 'line', 'pivot', 'funnel']);
});

test('неизвестный вид графика выбрасывается, остальное остаётся', () => {
  const r = P(JSON.stringify({ блоки: [{ вид: 'bar' }, { вид: 'сетка сансей' }, { вид: 'pie' }] }));
  assert.deepEqual(r.блоки.map(b => b.виз), ['bar', 'pie']);
  assert.strictEqual(r.пропущено, 1);
});

test('числа строками и показатель объектом', () => {
  const r = P(JSON.stringify({
    колонки: [{ подпись: 'Сумма', тип: 'number', от: '10', до: '90' }],
    блоки: [{ вид: 'bar', показатель: { агрегация: 'среднее', колонка: 'Сумма' } }],
  }));
  assert.strictEqual(r.колонки[0].от, 10);
  assert.strictEqual(r.колонки[0].до, 90);
  assert.ok(/среднее/i.test(r.блоки[0].показатель));
});

test('шаг времени и размер словами', () => {
  const r = P(JSON.stringify({ блоки: [{ вид: 'line', шаг: 'по неделям', размер: 'во всю строку' }] }));
  assert.strictEqual(r.блоки[0].шаг, 'week');
  assert.strictEqual(r.блоки[0].ширина, 12);
});

test('совсем не JSON — это просто ответ человеку', () => {
  const r = P('Извините, я не могу собрать такой дашборд.');
  assert.strictEqual(r.plain, true);
  assert.ok(/не могу/.test(r.ответ));
  assert.deepEqual(r.блоки, []);
});

test('обрезанный JSON не роняет разбор', () => {
  const r = P('{"название": "Заявки", "блоки": [{"вид": "bar", "название": "Статусы"');
  assert.strictEqual(r.plain, true);
  assert.deepEqual(r.блоки, []);
});

test('пустой ответ не роняет разбор', () => {
  const r = P('');
  assert.strictEqual(r.plain, true);
  assert.deepEqual(r.блоки, []);
});

/* Колонки: модель могла их не прислать — собираем из упоминаний в блоках */
test('колонки собираются из блоков, когда их не прислали', () => {
  const r = P(JSON.stringify({ блоки: [
    { вид: 'bar', показатель: 'сумма: Выручка, ₽', разрез: 'Филиал' },
    { вид: 'line', разрез: 'Дата продажи' },
  ] }));
  const cols = K.aiColumnsFor(r);
  const labels = cols.map(c => c.label);
  assert.ok(labels.includes('Филиал') && labels.includes('Выручка, ₽') && labels.includes('Дата продажи'));
  assert.ok(cols.every(c => /^[a-z0-9_]+$/.test(c.key)), 'ключи должны быть латиницей: ' + cols.map(c => c.key));
  assert.strictEqual(new Set(cols.map(c => c.key)).size, cols.length, 'ключи не должны повторяться');
});

test('без даты, числа и категории шаблон собрать не из чего — дописываем', () => {
  const cols = K.aiColumnsFor(P(JSON.stringify({ блоки: [{ вид: 'table' }] })));
  const types = cols.map(c => c.type);
  assert.ok(types.includes('date') && types.includes('number') && types.includes('string'));
});

test('типы колонок угадываются по названию', () => {
  const cols = K.aiColumnsFor(P(JSON.stringify({ блоки: [{ вид: 'bar', показатель: 'сумма: Выручка', разрез: 'Город' }] })));
  const by = l => cols.find(c => c.label === l);
  assert.strictEqual(by('Выручка').type, 'number');
  assert.strictEqual(by('Город').type, 'string');
});

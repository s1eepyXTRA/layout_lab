/* Наборы-схемы: придуманные строки должны быть одинаковыми всегда и везде */

const assert = require('node:assert');
const { loadKobra } = require('./load');

const K = loadKobra();

const schema = () => K.normalizeSchema({
  seed: 42, rowCount: 300, dateFrom: '2026-01-01', dateTo: '2026-03-31',
  columns: [
    { key: 'd', label: 'Дата', type: 'date' },
    { key: 'city', label: 'Город', type: 'string', values: ['Москва', 'Казань', 'Пермь'] },
    { key: 'sum', label: 'Сумма, ₽', type: 'number', min: 100, max: 10000 },
  ],
});

/* Главное обещание макета: цифры не меняются ни при перезагрузке, ни на
   другой машине — иначе согласованный с заказчиком макет поедет. */
test('один seed — одни и те же строки', () => {
  const a = K.generateSchemaRows(schema());
  const b = K.generateSchemaRows(schema());
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

test('другой seed — другие строки', () => {
  const s = schema(); s.seed = 43;
  assert.notStrictEqual(JSON.stringify(K.generateSchemaRows(schema())), JSON.stringify(K.generateSchemaRows(s)));
});

test('число строк и набор колонок — из схемы', () => {
  const rows = K.generateSchemaRows(schema());
  assert.strictEqual(rows.length, 300);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['city', 'd', 'sum']);
});

test('даты не выходят за период схемы', () => {
  const rows = K.generateSchemaRows(schema());
  const from = Date.UTC(2026, 0, 1), to = Date.UTC(2026, 2, 31) + 86400000;
  rows.forEach(r => assert.ok(r.d >= from && r.d < to, 'дата ' + new Date(r.d).toISOString() + ' вне периода'));
});

test('категории берутся только из заданных значений', () => {
  const rows = K.generateSchemaRows(schema());
  const seen = new Set(rows.map(r => r.city));
  assert.deepEqual([...seen].sort(), ['Казань', 'Москва', 'Пермь']);
});

test('числа не выходят за границы', () => {
  const rows = K.generateSchemaRows(schema());
  rows.forEach(r => assert.ok(r.sum >= 0 && r.sum <= 10000, 'число вне границ: ' + r.sum));
});

/* Генератор намеренно даёт длинный хвост: если бы значения были
   равномерными, график выглядел бы как расчёска и макет не убеждал. */
test('распределение с длинным хвостом: медиана ниже середины диапазона', () => {
  const rows = K.generateSchemaRows(schema()).map(r => r.sum).sort((a, b) => a - b);
  const median = rows[Math.floor(rows.length / 2)];
  assert.ok(median < 5000, 'медиана ' + median + ' должна быть заметно ниже середины');
});

test('тип колонки угадывается по названию', () => {
  assert.strictEqual(K.guessSchemaCol('Дата заказа').type, 'date');
  assert.strictEqual(K.guessSchemaCol('Выручка, ₽').type, 'number');
  assert.strictEqual(K.guessSchemaCol('Филиал').type, 'string');
});

/* «, ₽» в конце названия — единица измерения, а не вторая колонка */
test('единица в названии не превращается в отдельную колонку', () => {
  const cols = K.parseColumnNames('Дата, Филиал, Выручка, ₽, Количество, шт.', true);
  assert.deepEqual(cols, ['Дата', 'Филиал', 'Выручка, ₽', 'Количество, шт.']);
});

test('slugKey даёт латинские ключи и не повторяется', () => {
  const used = new Set();
  const a = K.slugKey('Выручка, ₽', 0, used);
  const b = K.slugKey('Выручка, ₽', 1, used);
  assert.ok(/^[a-z0-9_]+$/.test(a), 'ключ должен быть латиницей: ' + a);
  assert.notStrictEqual(a, b);
});

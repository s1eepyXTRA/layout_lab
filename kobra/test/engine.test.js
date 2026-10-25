/* Движок: группировка, агрегации, отношения, фильтры, формат чисел */

const assert = require('node:assert');
const { loadKobra } = require('./load');

const K = loadKobra();

/* Маленький набор руками: так видно, какие числа должны получиться */
const DS = {
  id: 'ds_t', name: 'Тест',
  columns: [
    { key: 'd', label: 'Дата', type: 'date' },
    { key: 'city', label: 'Город', type: 'string' },
    { key: 'ord', label: 'Заказ', type: 'string' },
    { key: 'rev', label: 'Выручка', type: 'number' },
    { key: 'marg', label: 'Маржа', type: 'number' },
  ],
  metrics: [
    { key: 'rev', label: 'Выручка', expr: { type: 'simple', agg: 'SUM', col: 'rev' }, format: 'int' },
    { key: 'mpct', label: 'Маржинальность', expr: { type: 'ratio', num: { agg: 'SUM', col: 'marg' }, den: { agg: 'SUM', col: 'rev' } }, format: 'pct' },
    { key: 'check', label: 'Средний чек', expr: { type: 'ratio', num: { agg: 'SUM', col: 'rev' }, den: { agg: 'COUNT_DISTINCT', col: 'ord' } }, format: 'int' },
  ],
  mainDttm: 'd',
  rows: [
    { d: Date.UTC(2026, 0, 10), city: 'Москва', ord: 'A', rev: 100, marg: 50 },
    { d: Date.UTC(2026, 0, 20), city: 'Москва', ord: 'A', rev: 300, marg: 30 },
    { d: Date.UTC(2026, 1, 5), city: 'Москва', ord: 'B', rev: 200, marg: 20 },
    { d: Date.UTC(2026, 1, 7), city: 'Казань', ord: 'C', rev: 400, marg: 40 },
  ],
};
const simple = (agg, col) => ({ kind: 'simple', agg, col });
const saved = key => ({ kind: 'saved', key });
const byKey = (res, dimVal) => res.rows.find(r => Object.values(r).includes(dimVal));

test('runQuery без группировки считает по всем строкам', () => {
  const res = K.runQuery(DS, { metrics: [simple('SUM', 'rev')] });
  assert.strictEqual(res.rows.length, 1);
  assert.strictEqual(res.rows[0][res.mets[0].key], 1000);
});

test('группировка по текстовой колонке', () => {
  const res = K.runQuery(DS, { groupby: [{ col: 'city' }], metrics: [simple('SUM', 'rev')] });
  const m = res.mets[0].key;
  assert.strictEqual(res.rows.length, 2);
  assert.strictEqual(byKey(res, 'Москва')[m], 600);
  assert.strictEqual(byKey(res, 'Казань')[m], 400);
});

test('группировка по дате с шагом «месяц» режет по UTC', () => {
  const res = K.runQuery(DS, { groupby: [{ col: 'd', grain: 'month' }], metrics: [simple('SUM', 'rev')] });
  assert.strictEqual(res.rows.length, 2);
  assert.strictEqual(res.dims[0].key, 'd__month');
  const jan = res.rows.find(r => r['d__month'] === Date.UTC(2026, 0, 1));
  assert.ok(jan, 'январь должен начинаться 1 января по UTC');
  assert.strictEqual(jan[res.mets[0].key], 400);
});

test('COUNT_DISTINCT не считает повторы', () => {
  const res = K.runQuery(DS, { metrics: [simple('COUNT_DISTINCT', 'ord')] });
  assert.strictEqual(res.rows[0][res.mets[0].key], 3);
});

test('COUNT(*) считает строки', () => {
  const res = K.runQuery(DS, { metrics: [simple('COUNT', '*')] });
  assert.strictEqual(res.rows[0][res.mets[0].key], 4);
});

test('MIN, MAX и AVG', () => {
  const res = K.runQuery(DS, { metrics: [simple('MIN', 'rev'), simple('MAX', 'rev'), simple('AVG', 'rev')] });
  const r = res.rows[0];
  assert.strictEqual(r[res.mets[0].key], 100);
  assert.strictEqual(r[res.mets[1].key], 400);
  assert.strictEqual(r[res.mets[2].key], 250);
});

/* Главное свойство отношений: их нельзя считать делением готовых агрегатов,
   иначе «Маржинальность» по всем городам не сойдётся с суммой по строкам. */
test('отношение верно на любом уровне группировки', () => {
  const all = K.runQuery(DS, { metrics: [saved('mpct')] });
  assert.strictEqual(all.rows[0][all.mets[0].key], 140 / 1000);

  const byCity = K.runQuery(DS, { groupby: [{ col: 'city' }], metrics: [saved('mpct')] });
  const m = byCity.mets[0].key;
  assert.strictEqual(byKey(byCity, 'Москва')[m], 100 / 600);
  assert.strictEqual(byKey(byCity, 'Казань')[m], 40 / 400);
});

test('средний чек делит на число заказов, а не на число строк', () => {
  const res = K.runQuery(DS, { groupby: [{ col: 'city' }], metrics: [saved('check')] });
  const m = res.mets[0].key;
  assert.strictEqual(byKey(res, 'Москва')[m], 600 / 2);  // два заказа, три строки
  assert.strictEqual(byKey(res, 'Казань')[m], 400 / 1);
});

test('фильтр по значению', () => {
  const res = K.runQuery(DS, { filters: [{ col: 'city', op: 'in', val: ['Казань'] }], metrics: [simple('SUM', 'rev')] });
  assert.strictEqual(res.rows[0][res.mets[0].key], 400);
  assert.strictEqual(res.filteredCount, 1);
});

test('числовой фильтр «больше»', () => {
  const res = K.runQuery(DS, { filters: [{ col: 'rev', op: 'gt', val: 150 }], metrics: [simple('COUNT', '*')] });
  assert.strictEqual(res.rows[0][res.mets[0].key], 3);
});

test('resolveTimeRange отсчитывает период от переданной опорной даты', () => {
  const anchor = Date.UTC(2026, 1, 7);
  const [from, to] = K.resolveTimeRange({ preset: 'last_7d' }, anchor);
  assert.strictEqual(to, anchor + 86400000, 'верхняя граница — конец опорного дня');
  assert.strictEqual(from, to - 7 * 86400000);
  const none = K.resolveTimeRange({ preset: 'all' }, anchor);   // массив из контекста vm: сверяем по элементам
  assert.strictEqual(none[0], null);
  assert.strictEqual(none[1], null);
});

/* Относительные периоды считаются от последней даты в данных, а не от
   «сегодня»: иначе демо-данные из будущего давали бы пустые графики. */
test('относительный период в запросе берёт опору из данных, а не из «сегодня»', () => {
  const res = K.runQuery(DS, { filters: [{ col: 'd', op: 'time_range', val: { preset: 'last_7d' } }], metrics: [simple('COUNT', '*')] });
  assert.strictEqual(res.rows[0][res.mets[0].key], 2, 'за неделю от 7 февраля — только две февральские строки');
  const all = K.runQuery(DS, { filters: [{ col: 'd', op: 'time_range', val: { preset: 'last_30d' } }], metrics: [simple('COUNT', '*')] });
  assert.strictEqual(all.rows[0][all.mets[0].key], 4, 'за 30 дней от 7 февраля попадают и январские');
  assert.strictEqual(K.dsMaxDate(DS, 'd'), Date.UTC(2026, 1, 7));
});

test('limit и сортировка', () => {
  const res = K.runQuery(DS, {
    groupby: [{ col: 'city' }], metrics: [simple('SUM', 'rev')],
    orderby: [{ key: 'Выручка', desc: true }], limit: 1,
  });
  assert.strictEqual(res.rows.length, 1);
  assert.strictEqual(Object.values(res.rows[0])[0], 'Москва');
});

test('неизвестная колонка даёт понятную ошибку', () => {
  assert.throws(() => K.runQuery(DS, { groupby: [{ col: 'нет' }], metrics: [simple('COUNT', '*')] }),
    /не найдена/);
});

/* Единица измерения живёт в формате числа, иначе её пришлось бы
   прокидывать в тринадцать типов графиков по отдельности. */
test('суффикс единицы печатается и не сокращается', () => {
  assert.strictEqual(K.fmtNum(1200000, 'suffix:шт.'), K.fmtNum(1200000, 'int') + ' шт.');
  assert.ok(!/млн/.test(K.fmtNum(1200000, 'suffix:шт.')));
});

test('проценты и рубли', () => {
  assert.ok(/%$/.test(K.fmtNum(0.154, 'pct')));
  assert.ok(/₽/.test(K.fmtNum(1234, 'rub')));
});

test('truncTime режет по UTC, а не по местной зоне', () => {
  const t = Date.UTC(2026, 0, 31, 23, 30);
  assert.strictEqual(K.truncTime(t, 'month'), Date.UTC(2026, 0, 1));
  assert.strictEqual(K.truncTime(t, 'day'), Date.UTC(2026, 0, 31));
  assert.strictEqual(K.truncTime(t, 'year'), Date.UTC(2026, 0, 1));
});

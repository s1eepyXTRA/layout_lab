/* Снимок отката.

   Снимок — это клон всего STATE, и держится он маленьким только потому, что
   тел незагруженных объектов в STATE нет: список приезжает краткой формой.
   Правило неписаное, и отвалится оно тихо — если кто-нибудь вернёт загрузку
   тел при старте, снимок станет клоном всей видимой человеку работы, а
   снимков в стопке до UNDO_MAX. Поэтому здесь проверка, а не комментарий. */

const assert = require('node:assert');
const { loadKobra, CORE } = require('./load');

const K = loadKobra([...CORE, 'store.js']);

/** Краткая форма: имя, владелец, сводка — и признак «тело не приезжало». */
const brief = (id, name) => ({
  id, name, viz: 'bar', datasetId: 'ds_1', ownerLogin: 'e.kuznecova', team: 'Продажи',
  shared: [], version: 3, updated: 1, summary: { spec: 0 }, brief: true,
});
/** Своё, с телом: параметры и ТЗ на руках. */
const full = (id, name) => ({
  id, name, viz: 'bar', datasetId: 'ds_1', ownerLogin: 'd.orlov', team: 'Продажи', shared: [],
  version: 1, updated: 2,
  params: { x_col: 'date', x_grain: 'month', metric: { kind: 'saved', key: 'revenue' } },
  spec: { question: 'Как меняется выручка?' },
});

function setup() {
  K.STATE = { v: 2, charts: {}, dashboards: {}, datasets: {}, dsMetrics: {} };
  K.STATE.charts.c_my = full('c_my', 'Моя выручка');
  K.STATE.charts.c_alien = brief('c_alien', 'Чужая выручка');
  K.STATE.dashboards.d_alien = {
    id: 'd_alien', title: 'Чужой шаблон', ownerLogin: 'e.kuznecova', team: 'Продажи', shared: [],
    version: 7, updated: 3, brief: true,
    summary: { tabs: 2, charts: 1, chartIds: ['c_alien'], thumb: [{ x: 0, y: 0, w: 6, h: 8 }] },
  };
  K.STATE.dashboards.d_my = {
    id: 'd_my', title: 'Мой шаблон', ownerLogin: 'd.orlov', team: 'Продажи', shared: [], version: 1,
    tabs: [{ id: 't1', title: 'Сводка', items: [{ i: 'i1', type: 'chart', chartId: 'c_my', x: 0, y: 0, w: 6, h: 8 }] }],
    filters: [],
  };
}

test('в снимке нет тел объектов, которые не приезжали', () => {
  setup();
  const snap = K.snapState('Проверка');
  const s = snap.state;
  // Своё — целиком: откат обязан вернуть именно его
  assert.deepEqual(s.charts.c_my.params, K.STATE.charts.c_my.params);
  assert.equal(s.dashboards.d_my.tabs[0].items[0].chartId, 'c_my');
  // Чужое, не открывавшееся, — краткой формой, как и в состоянии
  assert.equal(s.charts.c_alien.brief, true);
  assert.ok(!('params' in s.charts.c_alien), 'в снимке оказались параметры чужого графика');
  assert.ok(!('spec' in s.charts.c_alien), 'в снимке оказалось ТЗ чужого графика');
  assert.equal(s.dashboards.d_alien.brief, true);
  assert.ok(!('tabs' in s.dashboards.d_alien), 'в снимке оказались вкладки чужого шаблона');
  assert.ok(!('filters' in s.dashboards.d_alien), 'в снимке оказались фильтры чужого шаблона');
});

test('снимок — клон: правка после него в снимок не попадает', () => {
  setup();
  const snap = K.snapState('Проверка');
  K.STATE.charts.c_my.params.x_grain = 'day';
  K.STATE.charts.c_alien.name = 'Переименовали';
  assert.equal(snap.state.charts.c_my.params.x_grain, 'month');
  assert.equal(snap.state.charts.c_alien.name, 'Чужая выручка');
});

test('сто чужих объектов не приносят в снимок ни одного тела', () => {
  setup();
  /* Сто чужих объектов в списке — обычное дело за сервисом. Их тела в снимок
     попадать не должны вовсе: снимков в стопке до UNDO_MAX, и каждый был бы
     клоном всей видимой человеку работы. Считаем не байты, а упоминания полей
     тела: порог в байтах пришлось бы подгонять под размер выдуманных данных. */
  for (let i = 0; i < 100; i++) K.STATE.charts['c_x' + i] = brief('c_x' + i, 'Чужой график ' + i);
  const тел = txt => (txt.match(/x_grain/g) || []).length;
  const краткий = JSON.stringify(K.snapState('Краткий').state);
  assert.equal(тел(краткий), 1, 'в снимке тело только своего графика');

  Object.keys(K.STATE.charts).forEach(id => {
    if (!K.STATE.charts[id].brief) return;
    // То же состояние, но с телами: так было до краткой формы
    delete K.STATE.charts[id].brief;
    K.STATE.charts[id].params = K.clone(K.STATE.charts.c_my.params);
  });
  const сТелами = JSON.stringify(K.snapState('С телами').state);
  // Сто подставных плюс чужой из setup плюс свой
  assert.equal(тел(сТелами), 102);
  assert.ok(сТелами.length > краткий.length, 'тела утяжеляют снимок, и заметно');
});

test('стопка снимков не растёт дальше предела', () => {
  setup();
  const snaps = [];
  for (let i = 0; i < K.UNDO_MAX + 5; i++) snaps.push(K.snapState('Правка ' + i));
  // Самые старые выпали, последний на месте: иначе память течёт
  assert.ok(!K.canUndo(snaps[0]));
  assert.ok(K.canUndo(snaps[snaps.length - 1]));
  assert.ok(K.canUndo(snaps[snaps.length - K.UNDO_MAX]));
});

test('canUndo(null) — это нет', () => {
  setup();
  K.snapState('Правка');
  /* Когда-то он отвечал «да, стопка не пуста», и снимок не снимался вовсе, а
     «Отменить» молча ничего не делал. */
  assert.equal(K.canUndo(null), false);
  assert.equal(K.hasUndo(), true);
});

/* Очередь расчётов.

   Дашборд рисует блоки сразу все, и за сервисом каждый блок — это запрос к
   базе. На демо-дашборде их 23 при пуле на 30 соединений: один человек почти
   исчерпывает его. Очередь стоит в адаптере, единственной точке расчёта. */
const assert = require('node:assert');
const { loadKobra } = require('./load');

const K = loadKobra();

/** Заявка, которую можно завершить руками. */
function deferred() {
  let done;
  const p = new Promise(r => { done = r; });
  return { promise: p, done };
}

test('одновременно идёт не больше предела, остальные ждут', async () => {
  let active = 0, peak = 0;
  const parts = Array.from({ length: 12 }, () => deferred());
  const runs = parts.map(d => K.queryQueued(() => {
    active++; peak = Math.max(peak, active);
    return d.promise.then(() => { active--; return 'ок'; });
  }));
  // Пока ни одна заявка не завершилась, в полёте ровно предел
  assert.equal(active, K.QUERY_PARALLEL);
  parts.forEach(d => d.done());
  const res = await Promise.all(runs);
  assert.equal(res.length, 12);
  assert.equal(peak, K.QUERY_PARALLEL);
  assert.equal(active, 0);
});

test('порядок завершения — порядок постановки', async () => {
  const order = [];
  const runs = Array.from({ length: 8 }, (_, i) =>
    K.queryQueued(() => Promise.resolve().then(() => { order.push(i); return i; })));
  await Promise.all(runs);
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('уход со страницы отменяет ожидающие, а начатые доводит', async () => {
  const parts = Array.from({ length: 10 }, () => deferred());
  let started = 0;
  const runs = parts.map(d => K.queryQueued(() => { started++; return d.promise; }).catch(e => e.kind));
  assert.equal(started, K.QUERY_PARALLEL);
  assert.equal(K.queryDropWaiting(), 10 - K.QUERY_PARALLEL);
  parts.forEach(d => d.done('ок'));
  const res = await Promise.all(runs);
  // Начатые дошли до конца, ожидающие получили отмену — и больше не стартовали
  assert.equal(started, K.QUERY_PARALLEL);
  assert.equal(res.filter(r => r === 'ок').length, K.QUERY_PARALLEL);
  assert.equal(res.filter(r => r === 'cancelled').length, 10 - K.QUERY_PARALLEL);
});

test('отказ одной заявки не держит очередь', async () => {
  const seen = [];
  const runs = [
    ...Array.from({ length: 4 }, (_, i) => K.queryQueued(() => Promise.reject(new Error('сбой ' + i))).catch(e => e.message)),
    ...Array.from({ length: 3 }, (_, i) => K.queryQueued(() => Promise.resolve('поздняя ' + i))),
  ];
  (await Promise.all(runs)).forEach(r => seen.push(r));
  assert.equal(seen.filter(r => String(r).startsWith('сбой')).length, 4);
  assert.equal(seen.filter(r => String(r).startsWith('поздняя')).length, 3);
});

/* ---------- Страница списка ----------
   Отбор за сервисом считает сервер, но без сервиса тот же отбор идёт здесь —
   второй путь нужен, чтобы страницы не знали о режиме. Проверяем именно его:
   он единственный, который можно проверить без сети. */

/** Состояние и вошедший сотрудник: списки отбираются по правам. */
function setup(dashboards) {
  K.authInit();
  assert.ok(K.authSignIn('d.orlov'));           // Продажи, Gamma
  K.STATE = { v: 2, charts: {}, dashboards: {}, datasets: {}, dsMetrics: {} };
  dashboards.forEach(d => { K.STATE.dashboards[d.id] = d; });
  return K.authUser();
}
const dash = (id, title, owner, updated, extra) => Object.assign(
  { id, title, ownerLogin: owner, team: 'Продажи', shared: [], updated }, extra || {});

test('поиск по названию без учёта регистра и порядок по свежести', async () => {
  setup([
    dash('d1', 'Выручка по филиалам', 'd.orlov', 100),
    dash('d2', 'ВЫРУЧКА и план', 'e.kuznecova', 300),
    dash('d3', 'Заявки в поддержку', 'd.orlov', 200),
  ]);
  const res = await K.storageList('dashboards', { q: 'выручка' });
  assert.deepEqual(res.items.map(d => d.id), ['d2', 'd1']);
  assert.equal(res.found, 2);
  assert.equal(res.total, 3);
});

test('«только мои» — это владелец, а не выданный доступ', async () => {
  const me = setup([
    dash('d_my', 'Моё', 'd.orlov', 100),
    dash('d_shared', 'Выданное', 'e.kuznecova', 200, { shared: ['d.orlov'] }),
    dash('d_team', 'Командное', 'e.kuznecova', 300),
  ]);
  assert.equal(me.login, 'd.orlov');
  const res = await K.storageList('dashboards', { mine: true });
  assert.deepEqual(res.items.map(d => d.id), ['d_my']);
  // Оба числа: иначе человек решит, что выданное ему пропало
  assert.equal(res.found, 1);
  assert.equal(res.total, 3);
});

test('чужое, которого не видно, не попадает ни в список, ни в счёт', async () => {
  setup([
    dash('d_my', 'Моё', 'd.orlov', 100),
    Object.assign(dash('d_alien', 'Чужое', 'e.kuznecova', 200), { team: 'Поддержка' }),
  ]);
  const res = await K.storageList('dashboards', {});
  assert.deepEqual(res.items.map(d => d.id), ['d_my']);
  assert.equal(res.total, 1);
});

test('список идёт страницами, предпросмотр в него не попадает', async () => {
  setup([
    ...Array.from({ length: 5 }, (_, i) => dash('d' + i, 'Шаблон ' + i, 'd.orlov', 100 + i)),
    dash('d_prev', 'Пример', 'd.orlov', 999, { preview: true }),
  ]);
  const first = await K.storageList('dashboards', { limit: 2 });
  const second = await K.storageList('dashboards', { limit: 2, offset: 2 });
  assert.equal(first.found, 5);
  assert.deepEqual(first.items.map(d => d.id), ['d4', 'd3']);
  assert.deepEqual(second.items.map(d => d.id), ['d2', 'd1']);
});

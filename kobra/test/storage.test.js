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

/* Доступ к модели: тот же экран, два разных пути.

   Без сервиса Кобра ходит к модели сама, адрес и токен лежат в браузере. За
   сервисом к модели ходит сервис: клиент посылает задачу, колонки и версию
   формата, а промпт собирает сервер — прислать свой запрос нельзя намеренно,
   иначе служебный ключ компании становится общим доступом к модели.

   Проверяется именно ветвление и то, что отказы сервиса доезжают до человека
   различимыми: от вида отказа зависит, предлагать ли перенос вручную. */

const assert = require('node:assert');
const { loadKobra, CORE } = require('./load');

const K = loadKobra([...CORE, 'assistant.js']);

/** Ответ сервиса: столько, сколько читает `api()` в storage.js. */
function ответ(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  };
}
/** Подменить сеть: запросы собираем, отвечаем заготовленным. */
function сеть(...ответы) {
  const запросы = [];
  let i = 0;
  K.fetch = (url, opts) => {
    запросы.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null, method: (opts || {}).method });
    const r = ответы[Math.min(i++, ответы.length - 1)];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return запросы;
}
const локально = () => { K.storageMode = K.STORAGE_LOCAL; K.storageInfo = {}; };
const засервисом = (info = { ai: true }) => { K.storageMode = K.STORAGE_SERVER; K.storageInfo = info; };

test('без сервиса модель готова, только если настроена в браузере', () => {
  локально();
  K.localStorage.clear();
  assert.equal(K.aiReady(), false);
  K.aiSaveCfg({ url: 'https://шлюз/v1', model: 'gpt-4o', token: 'личный' });
  assert.equal(K.aiReady(), true);
  assert.equal(K.aiMaxChars(), 4000);
});

test('за сервисом «можно ли мне» зависит от команды, а не от браузера', () => {
  /* Ключ выдаётся на команду, поэтому признак приезжает с сессией. Проба
     отвечает до входа и знает только, есть ли доступ в сервисе вообще — иначе
     человек из команды без ключа видел бы кнопку «Собрать» и узнавал о
     правилах доступа методом проб. */
  K.localStorage.clear();
  засервисом({ ai: true, aiMaxChars: 1500 });
  // Свои настройки в браузере за сервисом ничего не решают: ключи там командные
  K.aiSaveCfg({ url: 'https://шлюз/v1', model: 'gpt-4o', token: 'личный' });
  K.AUTH = { cfg: {}, users: [], user: { login: 'd.orlov', team: 'Поддержка', role: 'Gamma', ai: false } };
  assert.equal(K.aiReady(), false, 'команде ключ не выдан');
  assert.equal(K.aiAnywhere(), true, 'но в сервисе доступ есть — значит просить есть у кого');
  assert.equal(K.aiMaxChars(), 1500);

  K.AUTH.user.ai = true;
  assert.equal(K.aiReady(), true);

  засервисом({ ai: false });
  assert.equal(K.aiAnywhere(), false, 'модели в сервисе нет вовсе');
  локально();
});

test('в сервис уезжает задача и версия формата, а не готовый запрос', async () => {
  засервисом();
  const запросы = сеть(ответ(200, { ответ: '{"блоки":[]}', id: 7 }));
  const r = await K.aiAskService('заявки по этапам', {
    draft: { название: 'Заявки', колонки: [], блоки: [] },
    errors: [{ название: 'Воронка', ошибка: 'нет этапа' }],
  });
  assert.equal(r.text, '{"блоки":[]}');
  assert.equal(r.logId, 7);
  assert.equal(запросы.length, 1);
  assert.equal(запросы[0].url, '/api/ai/draft');
  assert.equal(запросы[0].body.формат, K.AI_FORMAT);
  assert.equal(запросы[0].body.задача, 'заявки по этапам');
  assert.equal(запросы[0].body.черновик.название, 'Заявки');
  assert.equal(запросы[0].body.ошибки[0].ошибка, 'нет этапа');
  // Своего промпта в запросе нет вовсе — его собирает сервер
  assert.ok(!('messages' in запросы[0].body));
  локально();
});

test('отказы сервиса различимы: от вида зависит, что сказать человеку', async () => {
  засервисом();
  const виды = { 403: 'no_access', 429: 'limit', 413: 'too_big', 504: 'timeout', 503: 'service' };
  for (const [status, kind] of Object.entries(виды)) {
    сеть(ответ(+status, { detail: 'так вышло' }));
    const e = await K.aiAskService('что-нибудь').then(() => null, err => err);
    assert.ok(e, 'отказ ' + status + ' должен бросать');
    assert.equal(e.kind, kind, `${status} → ${kind}`);
    assert.equal(e.message, 'так вышло');
  }
  локально();
});

test('итог сборки уезжает в журнал, а неудачный отчёт сборку не ломает', async () => {
  засервисом();
  const запросы = сеть(ответ(200, { ok: true }));
  assert.equal(await K.aiReportOutcome(12, true, 2), true);
  assert.equal(запросы[0].url, '/api/ai/draft/12/outcome');
  assert.deepEqual(запросы[0].body, { собрался: true, пропущено: 2 });

  // Сеть отвалилась — отчёт молча не доехал: ломать из-за него сборку нельзя
  сеть(new Error('сети нет'));
  assert.equal(await K.aiReportOutcome(12, true, 0), false);
  // Без номера записи и без сервиса отчитываться некому
  assert.equal(await K.aiReportOutcome(null, true, 0), false);
  локально();
  assert.equal(await K.aiReportOutcome(12, true, 0), false);
});

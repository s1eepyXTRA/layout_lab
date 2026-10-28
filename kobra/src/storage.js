/* ============================================================
   Кобра · хранилище
   Одно место, через которое состояние уходит из приложения и приходит
   обратно. Режима два: локальный — localStorage и IndexedDB, как было
   с первого дня; серверный — API сервиса.

   Зачем адаптер, а не fetch по местам, где пишут состояние: таких мест
   со временем станет больше, и каждое придётся помнить. Здесь же их два
   на весь продукт — `storageLoad` и `storageSave`.

   Офлайн-сборку открывают двойным щелчком, без всякого сервера, поэтому
   локальный режим не «запасной»: он остаётся штатным.
   ============================================================ */

const STORAGE_LOCAL = 'local';
const STORAGE_SERVER = 'server';
const STORAGE_PING = '/api/ping';
const LS_TOKEN = 'kobra.auth.token';
const SAVE_DELAY = 800;        // копим правки: перетаскивание блока — это десятки вызовов
const RETRY_DELAY = 5000;      // сеть пропала — пробуем снова, не теряя правок

let storageMode = STORAGE_LOCAL;
/** Что сервис рассказал о себе: способ входа и прочее. */
let storageInfo = {};
/** @type {'saved'|'pending'|'error'|'conflict'} */
let storageState = 'saved';
let storageNote = '';
const storageWatchers = [];

const storageIsServer = () => storageMode === STORAGE_SERVER;

/* Состояние отправки видно человеку: «не сохранено» — это то, ради чего
   адаптер вообще существует. Молчаливая потеря правок недопустима. */
function onStorageState(cb) {
  storageWatchers.push(cb);
  return () => { const i = storageWatchers.indexOf(cb); if (i >= 0) storageWatchers.splice(i, 1); };
}
function setStorageState(state, note = '') {
  if (state === storageState && note === storageNote) return;
  storageState = state; storageNote = note;
  storageWatchers.forEach(cb => { try { cb(state, note); } catch (e) { console.error(e); } });
}
const storageStateNow = () => ({ state: storageState, note: storageNote });

/* Режим определяется один раз при запуске: есть ли за страницей сервис.
   С file:// в сеть не ходим вовсе — это офлайн-сборка. */
async function storageDetect() {
  if (location.protocol === 'file:') { storageMode = STORAGE_LOCAL; return storageMode; }
  try {
    const r = await fetch(STORAGE_PING, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && j.kobra) { storageMode = STORAGE_SERVER; storageInfo = j; return storageMode; }
    }
  } catch (e) { /* сервиса за страницей нет — обычный случай для сборки из файла */ }
  storageMode = STORAGE_LOCAL;
  return storageMode;
}

/* ---------- Обращение к API ---------- */
const storageToken = () => lsGet(LS_TOKEN) || '';
function storageSetToken(t) { if (t) lsSet(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN); }

/** Запрос к сервису. Ошибки разделены по видам: сеть чинят повтором, отказ — нет. */
async function api(path, opts = {}) {
  const token = storageToken();
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        opts.body ? { 'Content-Type': 'application/json' } : {},
        token ? { Authorization: 'Bearer ' + token } : {},
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  } catch (e) {
    throw Object.assign(new Error('сеть недоступна'), { kind: 'network' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (res.ok) return data;
  const detail = data && data.detail;
  const err = Object.assign(new Error(typeof detail === 'string' ? detail : 'сервис ответил ' + res.status), {
    kind: res.status === 401 ? 'auth' : res.status === 403 ? 'denied' : res.status === 409 ? 'conflict' : 'http',
    status: res.status,
    detail,
  });
  throw err;
}

/* ---------- Состояние ---------- */
/* Виды объектов, из которых состоит состояние. Скрытые наборы макетов тянем
   тоже: без них у шаблона нет данных. */
const SERVER_KINDS = [
  { key: 'dashboards', path: '/api/dashboards' },
  { key: 'charts', path: '/api/charts' },
  { key: 'datasets', path: '/api/datasets?owned_by_dashboard=true' },
];
/** Что сервер подтвердил: ключ «вид:id» → версия и снимок тела. */
const serverSeen = new Map();
/* Поля, которые ставит сервер: при сравнении их не учитываем, иначе каждый
   ответ выглядел бы как новая правка. */
const SERVER_FIELDS = ['version', 'updated', 'updatedBy', 'ownerLogin', 'team', 'shared'];
function canonical(obj) {
  const copy = {};
  Object.keys(obj).sort().forEach(k => { if (!SERVER_FIELDS.includes(k)) copy[k] = obj[k]; });
  return JSON.stringify(copy);
}

/** Прочитать состояние целиком. null — хранилище пустое, дальше seedState(). */
async function storageLoad() {
  if (!storageIsServer()) return lsGet(LS_KEY);
  const state = { v: 2, charts: {}, dashboards: {}, datasets: {}, dsMetrics: {} };
  serverSeen.clear();
  for (const kind of SERVER_KINDS) {
    const list = await api(kind.path);
    (list || []).forEach(o => {
      state[kind.key][o.id] = o;
      serverSeen.set(kind.key + ':' + o.id, { version: o.version, body: canonical(o) });
    });
  }
  state.dsMetrics = (await api('/api/settings/dsMetrics')) || {};
  return state;
}

/** Сохранить состояние. В локальном режиме — синхронно, как было. */
function storageSave(state) {
  if (!storageIsServer()) return lsSet(LS_KEY, state);
  serverQueueSave(state);
  return true;
}

/* ---------- Отправка на сервер ----------
   `saveState()` зовут отовсюду, в том числе из перетаскивания блока, поэтому
   отправка идёт очередью с задержкой: копим правки и шлём разницу. */
let pendingState = null;
let saveTimer = null;
let saving = false;

function serverQueueSave(state) {
  pendingState = state;
  setStorageState('pending');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(serverPush, SAVE_DELAY);
}

async function serverPush() {
  if (saving || !pendingState) return;
  saving = true;
  const state = pendingState;
  pendingState = null;
  try {
    await serverSend(state);
    setStorageState(pendingState ? 'pending' : 'saved');
  } catch (e) {
    if (e.kind === 'conflict') {
      // Чужую правку не затираем: решение за человеком
      setStorageState('conflict', (e.detail && e.detail.message) || 'Объект изменился в другом месте');
    } else if (e.kind === 'auth') {
      setStorageState('error', 'Сессия закончилась: войдите заново');
    } else {
      // Сеть или сервис — пробуем снова, правки остаются в очереди
      pendingState = state;
      setStorageState('error', e.message);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(serverPush, RETRY_DELAY);
    }
  } finally {
    saving = false;
  }
  if (pendingState && storageState === 'pending') serverQueueSave(pendingState);
}

/** Разница между состоянием и тем, что подтвердил сервер. */
async function serverSend(state) {
  for (const kind of SERVER_KINDS) {
    const path = kind.path.split('?')[0];
    const now = state[kind.key] || {};
    for (const id of Object.keys(now)) {
      const obj = now[id];
      if (obj.preview) continue;              // черновик нигде не сохраняется
      const seen = serverSeen.get(kind.key + ':' + id);
      const body = canonical(obj);
      if (seen && seen.body === body) continue;
      const sent = seen
        ? await api(`${path}/${id}`, { method: 'PUT', body: Object.assign({}, obj, { version: seen.version }) })
        : await api(path, { method: 'POST', body: obj });
      // Сервер вернул объект со своими полями — кладём их обратно в состояние
      Object.assign(obj, { version: sent.version, updated: sent.updated, updatedBy: sent.updatedBy,
        ownerLogin: sent.ownerLogin, team: sent.team, shared: sent.shared });
      serverSeen.set(kind.key + ':' + id, { version: sent.version, body: canonical(sent) });
    }
    // Удалённое: было подтверждено сервером, а в состоянии больше нет
    for (const key of [...serverSeen.keys()]) {
      if (!key.startsWith(kind.key + ':')) continue;
      const id = key.slice(kind.key.length + 1);
      if (now[id]) continue;
      await api(`${path}/${id}`, { method: 'DELETE' });
      serverSeen.delete(key);
    }
  }
  await api('/api/settings/dsMetrics', { method: 'PUT', body: { value: state.dsMetrics || {} } });
}

/** Отправить всё, что скопилось, прямо сейчас: уход со страницы, выход. */
async function storageFlush() {
  if (!storageIsServer() || !pendingState) return;
  if (saveTimer) clearTimeout(saveTimer);
  await serverPush();
}

/** Перечитать состояние с сервера — после отказа по версии. */
async function storageReload() {
  pendingState = null;
  if (saveTimer) clearTimeout(saveTimer);
  const fresh = await storageLoad();
  setStorageState('saved');
  return fresh;
}

/* ---------- Строки наборов ----------
   Пока строки живут в браузере в обоих режимах: перенос их в базу — отдельный
   шаг плана (загруженные данные и фоновый разбор). Шов здесь, чтобы тот шаг
   менял одно место. */
async function storageLoadRows(dsId) { return idb.get('rows:' + dsId); }
async function storageSaveRows(dsId, rows) { return idb.set('rows:' + dsId, rows); }
async function storageDropRows(dsId) { return idb.del('rows:' + dsId); }

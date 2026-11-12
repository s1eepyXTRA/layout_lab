/* ============================================================
   Кобра · доступ к модели
   Транспорт и настройки для единственного места, где Кобра обращается
   к модели, — «Шаблон по описанию» (aidraft.js). Панель AI-ассистента
   на дашборде была и снята: разговор поверх готового шаблона не прижился,
   а сборка по описанию — прижилась.
   ============================================================ */
const AI_LS_CFG = 'kobra.ai.cfg';          // адрес, токен и модель — только в этом браузере
/* Версия формата ответа: сервис собирает промпт сам и должен знать, что
   разбирать его будет именно этот клиент. Страница живёт в браузере из кэша
   неделями — иначе старый разбор молча встретил бы новый промпт. */
const AI_FORMAT = 1;

/* ---------- Доступ к модели ---------- */
/* Транспорт назван по протоколу, а не по имени шлюза: один и тот же код
   работает с личным эндпоинтом и с LiteLLM компании — меняется настройка.

   За сервисом настроек у человека нет вовсе: адрес, модель и токен живут в
   сервисе, а сюда приезжает только «настроена или нет» (`/api/ping`). */
function aiCfg() {
  const c = lsGet(AI_LS_CFG) || {};
  return { url: c.url || '', token: c.token || '', model: c.model || '' };
}
function aiSaveCfg(cfg) { lsSet(AI_LS_CFG, { url: cfg.url || '', token: cfg.token || '', model: cfg.model || '' }); }
/** Можно ли обратиться к модели.

   За сервисом это знает сервис, и ответ зависит от **команды**: ключ выдаётся
   на команду, поэтому признак приезжает с сессией (`/api/auth/me`), а не с
   пробы — проба отвечает до входа и не знает, кто спрашивает. */
function aiReady() {
  if (storageIsServer()) return !!(authUser() && authUser().ai);
  const c = aiCfg();
  return !!(c.url && c.model);
}
/** Есть ли доступ к модели в сервисе вообще — хоть у одной команды. */
const aiAnywhere = () => (storageIsServer() ? !!storageInfo.ai : aiReady());
/** Предел длины описания: за сервисом его называет сервис. */
const aiMaxChars = () => (storageIsServer() && storageInfo.aiMaxChars) || 4000;

/* Обращение к модели **через сервис**: задача, колонки и версия формата, а
   текст запроса собирает сервер. Прислать свой запрос нельзя намеренно — иначе
   служебный ключ компании становится общим доступом к модели (см. app/ai.py).

   Возвращает тот же текст ответа модели, что и прямой путь, плюс номер записи
   в журнале: по нему клиент потом скажет, чем дело кончилось у человека. */
async function aiAskService(task, opts = {}) {
  try {
    const r = await api('/api/ai/draft', { method: 'POST', body: {
      формат: AI_FORMAT, задача: task, черновик: opts.draft || null, ошибки: opts.errors || [],
    } });
    return { text: String((r && r.ответ) || ''), logId: (r && r.id) || null };
  } catch (e) {
    /* Отказы сервиса уже написаны для человека: «проверьте токен» ему
       советовать нечего — токена у него нет. Виды нужны экрану: 503 и 504
       оставляют смысл предложить перенос вручную. */
    throw Object.assign(new Error(e.message), {
      kind: e.status === 403 ? 'no_access' : e.status === 429 ? 'limit'
        : e.status === 413 ? 'too_big' : e.status === 504 ? 'timeout'
          : e.status === 503 ? 'service' : e.kind || 'http',
      status: e.status,
    });
  }
}

/* Обращение к OpenAI-совместимому эндпоинту. Ошибки разделяем по видам:
   человеку нужно знать, чинить доступ, ждать лимита или смотреть сеть. */
/** @param {{model?: string, temperature?: number}} [opts] */
async function aiAsk(messages, opts = {}) {
  const c = aiCfg();
  const model = opts.model || c.model;
  if (!c.url || !model) throw Object.assign(new Error('доступ к модели не настроен'), { kind: 'no_access' });
  const url = c.url.replace(/\/+$/, '') + (/\/chat\/completions$/.test(c.url) ? '' : '/chat/completions');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, c.token ? { Authorization: 'Bearer ' + c.token } : {}),
      body: JSON.stringify({ model, messages, temperature: opts.temperature != null ? opts.temperature : 0.2 }),
    });
  } catch (e) {
    // Сюда же приходит запрет по CORS: браузер не отличает его от обрыва сети
    throw Object.assign(new Error('сеть недоступна или шлюз не разрешает запрос из браузера'), { kind: 'network' });
  }
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('доступ отклонён: проверьте токен'), { kind: 'no_access' });
  if (res.status === 429) throw Object.assign(new Error('превышен лимит обращений'), { kind: 'limit' });
  if (!res.ok) throw Object.assign(new Error(`шлюз ответил ${res.status}`), { kind: 'http' });
  const data = await res.json().catch(() => null);
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw Object.assign(new Error('ответ не разобрать'), { kind: 'parse' });
  return String(text);
}

/* Чем обращение кончилось у человека: собрался шаблон или нет и сколько блоков
   пропущено. Сервер этого знать не может — ответ разбирает клиент, а «HTTP 200,
   1400 токенов» ничего не говорит о пользе. Не доехало — не беда: сборку из-за
   отчёта ломать нельзя. */
async function aiReportOutcome(logId, built, skipped) {
  if (!logId || !storageIsServer()) return false;
  try {
    await api(`/api/ai/draft/${encodeURIComponent(logId)}/outcome`,
      { method: 'POST', body: { собрался: !!built, пропущено: skipped || 0 } });
    return true;
  } catch (e) { return false; }
}

/* Показ длинного текста: запрос для внешнего чата и ответ модели как есть */
function showTextModal(title, text) {
  const area = h('textarea', { class: 'textarea', rows: 18, readonly: true, 'aria-label': title });
  area.value = text;
  openModal({ title, wide: true, body: area, foot: close => [h('button', { class: 'btn primary', onclick: close }, 'Закрыть')] });
}

/* ---------- Ключи команд (только администратор) ----------
   Ключ к модели выдаётся на команду: один ключ на всех не делится — команда,
   собравшая двести черновиков, тратит деньги остальных, а отобрать ключ значит
   отобрать его у всех.

   Экран перечисляет **команды**, а не записи в таблице: администратор думает
   «выдали ли мы доступ Продажам». Самих ключей здесь нет и быть не может —
   сервис их не отдаёт никому, включая того, кто вставил: показать ключ значит
   дать его скопировать. */
async function openAiKeysDialog() {
  if (!authIsAdmin()) { toast('Ключи к модели выдаёт администратор', true); return; }
  const body = h('div');
  let data = null;
  const load = async () => {
    clear(body).appendChild(h('div', { class: 'empty' }, h('b', null, 'Загружаю…')));
    try { data = await api('/api/ai/keys'); paint(); }
    catch (e) {
      clear(body).appendChild(h('div', { class: 'empty' }, h('b', null, 'Не удалось получить список'), e.message));
    }
  };
  const save = async (team, token, model) => {
    try {
      await api('/api/ai/keys/' + encodeURIComponent(team), { method: 'PUT', body: { ключ: token, модель: model } });
      toast('Ключ для команды «' + team + '» сохранён');
      await load();
    } catch (e) { toast('Не удалось сохранить: ' + e.message, true); }
  };
  const drop = async (team, people) => {
    const сколько = people ? ' (' + people + ' ' + plural(people, 'сотрудник', 'сотрудника', 'сотрудников') + ')' : '';
    if (!(await confirmDialog('Отозвать ключ',
      'Команда «' + team + '»' + сколько + ' больше не сможет собирать шаблоны по описанию. '
      + 'Перенос запроса вручную у неё останется.', 'Отозвать'))) return;
    try {
      await api('/api/ai/keys/' + encodeURIComponent(team), { method: 'DELETE' });
      toast('Ключ отозван');
      await load();
    } catch (e) { toast('Не удалось отозвать: ' + e.message, true); }
  };
  /* Ввод ключа — отдельным окном, где названа команда и сколько в ней людей:
     вставить ключ не той команде легко, а стоит это чужих денег. */
  const ask = (team, people, model) => {
    const inp = h('input', { class: 'input', type: 'password', placeholder: 'sk-…', 'aria-label': 'Ключ команды' });
    const mod = h('input', { class: 'input', value: model || '', placeholder: 'как в сервисе', 'aria-label': 'Алиас модели' });
    openModal({
      title: 'Ключ для команды «' + team + '»',
      body: h('div', null,
        h('p', { class: 'muted', style: { margin: '0 0 10px', fontSize: '13px' } },
          'В команде ' + people + ' ' + plural(people, 'сотрудник', 'сотрудника', 'сотрудников')
          + '. Ключ возьмите у администраторов шлюза — он уйдёт в сервис и обратно не показывается.'),
        field('Ключ', inp),
        field('Алиас модели', mod, 'Пусто — модель сервиса. Задайте, если этому ключу разрешена другая.')),
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => {
          const t = inp.value.trim();
          if (!t) { toast('Вставьте ключ', true); return; }
          close();
          save(team, t, mod.value.trim());
        } }, 'Сохранить ключ')],
    });
  };
  const paint = () => {
    clear(body);
    body.appendChild(h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
      'Ключ выдаётся на команду: расход команды виден отдельно и ограничен её бюджетом в шлюзе.'));
    const tb = h('tbody');
    (data.команды || []).forEach(c => {
      const свой = c.ключ;
      tb.appendChild(h('tr', null,
        h('td', null, h('b', { style: { fontWeight: 500 } }, c.команда),
          h('div', { class: 'muted', style: { fontSize: '12px' } },
            c.сотрудников + ' ' + plural(c.сотрудников, 'сотрудник', 'сотрудника', 'сотрудников'))),
        h('td', null, свой
          ? h('span', { class: 'pill pri', title: c.кто ? 'Задал ' + authName(c.кто) : '' }, 'Свой ключ')
          : data.ключПоУмолчанию
            ? h('span', { class: 'pill' }, 'На ключе сервиса')
            : h('span', { class: 'pill acc' }, 'Нет доступа')),
        h('td', { class: 'muted' }, (свой ? c.модель : '') || data.модельПоУмолчанию || '—'),
        h('td', { class: 'muted' }, свой && c.когда ? authName(c.кто) + ', ' + fmtAgo(c.когда) : '—'),
        h('td', { class: 'act' },
          h('button', { class: 'btn sm', onclick: () => ask(c.команда, c.сотрудников, c.модель) },
            свой ? 'Заменить' : 'Вставить ключ'),
          свой ? h('button', { class: 'btn sm', style: { marginLeft: '6px' }, onclick: () => drop(c.команда, c.сотрудников) }, 'Отозвать') : null)));
    });
    body.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Команда'), h('th', null, 'Доступ'), h('th', null, 'Модель'), h('th', null, 'Кто выдал'), h('th'))),
      tb)));
    /* Команда без сотрудников в списке не появится, а ключ для неё задать надо:
       договорённость о доступе случается раньше, чем люди заходят в Кобру. */
    const other = h('input', { class: 'input', placeholder: 'Название команды', 'aria-label': 'Другая команда', style: { maxWidth: '260px' } });
    body.appendChild(h('div', { class: 'toolbar', style: { marginTop: '14px', marginBottom: 0 } },
      other,
      h('button', { class: 'btn', onclick: () => {
        const t = other.value.trim();
        if (!t) { toast('Назовите команду', true); return; }
        ask(t, 0, '');
      } }, 'Выдать другой команде')));
    body.appendChild(h('div', { class: 'ai-note', style: { marginTop: '12px' } },
      data.ключПоУмолчанию
        ? 'У сервиса есть ключ по умолчанию: команды без своего ключа работают на нём. Уберите его из развёртывания, когда выдадите ключи всем.'
        : 'Ключа по умолчанию в сервисе нет: команда без своего ключа модель не получит.'));
  };
  openModal({ title: 'Ключи к модели по командам', wide: true, body, foot: close => [h('button', { class: 'btn primary', onclick: close }, 'Готово')] });
  await load();
}

/* ---------- Настройки доступа ---------- */
function openAiSettings(done) {
  const c = aiCfg();
  let url = c.url, token = c.token, model = c.model;
  const body = h('div', null,
    field('Адрес эндпоинта', h('input', { class: 'input', value: url, placeholder: 'https://шлюз/v1', oninput: e => { url = e.target.value; } }),
      'OpenAI-совместимый: Кобра добавит /chat/completions сама. Сегодня ваш, завтра — шлюз компании.'),
    field('Модель', h('input', { class: 'input', value: model, placeholder: 'gpt-4o, claude-sonnet, свой алиас', oninput: e => { model = e.target.value; } })),
    field('Токен', h('input', { class: 'input', type: 'password', value: token, placeholder: 'Bearer-токен', oninput: e => { token = e.target.value; } }),
      'Хранится в этом браузере: берите токен, который не жалко отозвать.'),
    h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 0' } },
      'Если шлюз не пускает запросы из браузера, остаётся перенос вручную.'));
  openModal({
    title: 'Доступ к модели', wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => { aiSaveCfg({ url, token, model }); close(); toast('Настройки доступа сохранены'); done && done(); } }, 'Сохранить')],
  });
}

/* ============================================================
   Кобра · доступ к модели
   Транспорт и настройки для единственного места, где Кобра обращается
   к модели, — «Шаблон по описанию» (aidraft.js). Панель AI-ассистента
   на дашборде была и снята: разговор поверх готового шаблона не прижился,
   а сборка по описанию — прижилась.
   ============================================================ */
const AI_LS_CFG = 'kobra.ai.cfg';          // адрес, токен и модель — только в этом браузере

/* ---------- Доступ к модели ---------- */
/* Транспорт назван по протоколу, а не по имени шлюза: один и тот же код
   работает с личным эндпоинтом и с LiteLLM компании — меняется настройка. */
function aiCfg() {
  const c = lsGet(AI_LS_CFG) || {};
  return { url: c.url || '', token: c.token || '', model: c.model || '' };
}
function aiSaveCfg(cfg) { lsSet(AI_LS_CFG, { url: cfg.url || '', token: cfg.token || '', model: cfg.model || '' }); }
const aiReady = () => { const c = aiCfg(); return !!(c.url && c.model); };

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

/* Показ длинного текста: запрос для внешнего чата и ответ модели как есть */
function showTextModal(title, text) {
  const area = h('textarea', { class: 'textarea', rows: 18, readonly: true, 'aria-label': title });
  area.value = text;
  openModal({ title, wide: true, body: area, foot: close => [h('button', { class: 'btn primary', onclick: close }, 'Закрыть')] });
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

/* ============================================================
   Кобра · AI-ассистент на дашборде
   Человек описывает задачу словами — AI-ассистент предлагает состав
   дашборда или описание данных. Ничего не применяется без
   подтверждения, наружу уходит описание, а не строки данных.
   ============================================================ */
const AI_LS_CFG = 'kobra.ai.cfg';          // адрес, токен и модель — только в этом браузере
const AI_MAX_MSGS = 40;                     // предел хранимой переписки
const AI_SAMPLE_ROWS = 20;                  // сколько строк уходит при согласии
const AI_CSV_MAX = 50000;

/* ---------- Доступ к модели ---------- */
/* Транспорт назван по протоколу, а не по имени шлюза: один и тот же код
   работает с личным эндпоинтом и с LiteLLM компании — меняется настройка. */
function aiCfg() {
  const c = lsGet(AI_LS_CFG) || {};
  return { url: c.url || '', token: c.token || '', model: c.model || '', sendSamples: false };
}
function aiSaveCfg(cfg) { lsSet(AI_LS_CFG, { url: cfg.url || '', token: cfg.token || '', model: cfg.model || '' }); }
const aiReady = () => { const c = aiCfg(); return !!(c.url && c.model); };

/* Обращение к OpenAI-совместимому эндпоинту. Ошибки разделяем по видам:
   человеку нужно знать, чинить доступ, ждать лимита или смотреть сеть. */
async function aiAsk(messages) {
  const c = aiCfg();
  if (!c.url || !c.model) throw Object.assign(new Error('доступ к модели не настроен'), { kind: 'no_access' });
  const url = c.url.replace(/\/+$/, '') + (/\/chat\/completions$/.test(c.url) ? '' : '/chat/completions');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, c.token ? { Authorization: 'Bearer ' + c.token } : {}),
      body: JSON.stringify({ model: c.model, messages, temperature: 0.2 }),
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

/* ---------- Бриф: первый диалог ----------
   Четыре вопроса, которые заказчик и так держит в голове, плюс уточнения.
   Форма необязательная — её закрывают, если макет уже начат и от AI-ассистента
   нужно только дополнение. Ответы хранятся в дашборде и уходят с каждым
   запросом отдельным разделом: модель перестаёт угадывать название,
   показатели и разрезы. `tag` — короткая подпись для запроса: в форме вопрос
   звучит по-человечески, а в промпте нужна одна строка без вопросительного знака. */
const AI_BRIEF_FIELDS = [
  { key: 'title', tag: 'Название шаблона', label: 'Название шаблона', ph: 'Продажи филиалов' },
  { key: 'problem', tag: 'Какие проблемы решает', label: 'Какие проблемы поможет решить шаблон?', ph: 'Не видно, где падает выручка и из-за чего', area: true },
  { key: 'metrics', tag: 'Показатели, за которыми следят', label: 'За какими показателями необходимо следить?', ph: 'Выручка, средний чек, доля возвратов' },
  { key: 'docs', tag: 'Проваливаться до документов', label: 'Необходимо ли проваливаться до документов?', pick: ['да', 'нет'],
    hint: 'Нижний уровень — таблица исходных строк: заказы, заявки, чеки' },
  { key: 'dims', tag: 'Разрезы', label: 'В каких разрезах смотрите?', ph: 'Филиалы, категории, менеджеры', more: true },
  { key: 'period', tag: 'Период и шаг', label: 'Период и шаг', ph: 'Последний год по месяцам', more: true },
  { key: 'compare', tag: 'С чем сравнивать', label: 'С чем сравнивать', ph: 'План, прошлый год, норматив', more: true },
  { key: 'who', tag: 'Кто смотрит и как часто', label: 'Кто смотрит и как часто', ph: 'Директор раз в неделю', more: true },
];
const aiBrief = D => (D && D.chatBrief) || null;
const aiBriefFilled = b => !!b && AI_BRIEF_FIELDS.some(f => String(b[f.key] || '').trim());
/* В запрос идёт только отвеченное: пустые пункты модель принимает за задачу
   и начинает выспрашивать их вместо того, чтобы собирать дашборд. */
function aiBriefLines(b) {
  if (!b) return [];
  return AI_BRIEF_FIELDS.map(f => {
    const v = String(b[f.key] || '').trim();
    return v ? f.tag + ': ' + v : null;
  }).filter(Boolean);
}

/* ---------- Что уходит наружу ----------
   Единственное место сборки отправляемого: его целиком можно показать
   человеку и службе безопасности. Строк здесь нет, пока не разрешили. */
/** @param {{samples?: boolean}} [opts] строки прикладываются только по согласию */
function aiContext(D, ds, opts = {}) {
  const { samples } = opts;
  const out = { бриф: null, набор: null, дашборд: null };
  if (aiBriefFilled(aiBrief(D))) out.бриф = aiBriefLines(aiBrief(D));
  if (ds) {
    out.набор = {
      название: ds.name,
      придуманные_данные: !!isMockupDs(ds) || !!isSchemaDs(ds),
      колонки: ds.columns.map(c => ({ поле: c.key, подпись: c.label || c.key, тип: c.type })),
      показатели: (ds.metrics || []).map(m => ({ подпись: m.label, формула: exprText(ds, m.expr) })),
      строк: ds.rows.length,
    };
    if (samples) out.набор.примеры_строк = ds.rows.slice(0, AI_SAMPLE_ROWS);
  }
  if (D) {
    out.дашборд = {
      название: D.title,
      вкладки: D.tabs.map(t => ({
        название: t.title,
        блоки: t.items.filter(i => i.chartId && STATE.charts[i.chartId]).map(i => {
          const c = STATE.charts[i.chartId];
          return { название: c.name, вид: (VIZ[c.viz] || {}).label || c.viz };
        }),
      })),
      фильтры: (D.filters || []).map(f => ({ название: f.name, поле: f.col })),
    };
  }
  return out;
}

/* Текст запроса: бриф и контекст разделены явными границами. Без них модель
   путает ответы заказчика с описанием набора и отвечает на бриф, а не на
   задачу. Собирается из того же `aiContext`, второго источника нет. */
function aiPrompt(q, ctx) {
  const rest = Object.assign({}, ctx);
  const brief = rest.бриф;
  delete rest.бриф;
  const parts = ['Задача: ' + (String(q || '').trim() || '(опишите задачу)')];
  if (brief && brief.length) parts.push('=== БРИФ (ответы заказчика) ===\n' + brief.join('\n') + '\n=== КОНЕЦ БРИФА ===');
  parts.push('=== КОНТЕКСТ (набор и шаблон) ===\n' + JSON.stringify(rest, null, 1) + '\n=== КОНЕЦ КОНТЕКСТА ===');
  return parts.join('\n\n');
}

/* ---------- Что AI-ассистент умеет вернуть ---------- */
const AI_SYSTEM = [
  'Ты помогаешь собрать шаблон в конструкторе «Кобра». Отвечай по-русски и только JSON, без пояснений вокруг.',
  'Формат ответа: {"ответ": "<текст человеку>", "блоки": [...], "набор": {...}}. Поля «блоки» и «набор» необязательны.',
  'Блок: {"вид": "line|bar|pie|area|table|treemap|heatmap|funnel|pivot|big_number_trend", "название": "...", "зачем": "на какой вопрос отвечает"}.',
  'Набор (только если человек просит придумать данные): {"колонки": [{"подпись": "Дата заявки", "тип": "date|string|number", "значения": ["..."], "от": 1, "до": 1000}], "строк": 2000}.',
  'Строки данных не придумывай и не присылай: их сгенерирует Кобра по описанию колонок.',
  'Раздел БРИФ — требования заказчика, а не задача: выполняй то, что в «Задача», опираясь на бриф.',
  'Из брифа бери название и подписи блоков под его показатели, категории — под его разрезы. «Проваливаться до документов: да» значит, что нужен блок с таблицей исходных строк.',
  'Если запрос не про шаблон и не про данные, верни только «ответ».',
].join('\n');

function aiParse(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let j;
  try { j = JSON.parse(raw); } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ответ: raw, blocks: [], schema: null, plain: true };
    try { j = JSON.parse(m[0]); } catch (e2) { return { ответ: raw, blocks: [], schema: null, plain: true }; }
  }
  const blocks = (Array.isArray(j.блоки) ? j.блоки : []).map(b => ({
    viz: String(b.вид || '').trim(), name: String(b.название || '').trim(), why: String(b.зачем || '').trim(),
  })).filter(b => VIZ[b.viz] && MOCKUP_BLOCKS.some(x => x.viz === b.viz));   // неизвестный вид отбрасываем
  const sc = j.набор && Array.isArray(j.набор.колонки) ? j.набор : null;
  const schema = sc ? aiSchemaFrom(sc) : null;
  return { ответ: String(j.ответ || '').trim(), blocks, schema, plain: false };
}
/* Описание колонок от модели → схема набора Кобры. Непонятное отбрасываем:
   лучше собрать меньше, чем построить набор на выдуманных типах. */
function aiSchemaFrom(sc) {
  const used = new Set();
  const columns = sc.колонки.map((c, i) => {
    const label = String(c.подпись || '').trim();
    if (!label) return null;
    const type = ['date', 'string', 'number'].includes(c.тип) ? c.тип : guessSchemaCol(label).type;
    const col = Object.assign({ key: slugKey(label, i, used), label, type }, guessSchemaCol(label), { type });
    if (type === 'string' && Array.isArray(c.значения) && c.значения.length) col.values = c.значения.map(String).slice(0, 12);
    if (type === 'number') { if (c.от != null) col.min = +c.от; if (c.до != null) col.max = +c.до; }
    return col;
  }).filter(Boolean);
  if (!columns.length) return null;
  return Object.assign({ seed: (Date.now() % 100000) + 1, rowCount: Math.min(Math.max(+sc.строк || 2000, 100), SCHEMA_ROWS_MAX), columns }, defaultSchemaPeriod());
}

/* Показ длинного текста: состав отправляемого и запрос для внешнего чата */
function showTextModal(title, text) {
  const area = h('textarea', { class: 'textarea', rows: 18, readonly: true, 'aria-label': title });
  area.value = text;
  openModal({ title, wide: true, body: area, foot: close => [h('button', { class: 'btn primary', onclick: close }, 'Закрыть')] });
}

/* ---------- Переписка ---------- */
function aiLog(D) { return (D.chat = D.chat || []); }
function aiPush(D, role, text, extra) {
  const log = aiLog(D);
  log.push(Object.assign({ role, text, at: Date.now() }, extra || {}));
  if (log.length > AI_MAX_MSGS) { D.chatTrimmed = true; log.splice(0, log.length - AI_MAX_MSGS); }
  saveSoon();
  return log[log.length - 1];
}

/* ---------- Выгрузка придуманных строк ---------- */
function aiRowsToCsv(ds) {
  const cols = ds.columns;
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.map(c => esc(c.label || c.key)).join(',')];
  ds.rows.slice(0, AI_CSV_MAX).forEach(r => lines.push(cols.map(c => {
    const v = r[c.key];
    return esc(c.type === 'date' && typeof v === 'number' ? isoDate(v) : v);
  }).join(',')));
  return lines.join('\n');
}
async function aiExportCsv(ds) {
  const n = Math.min(ds.rows.length, AI_CSV_MAX);
  const cut = ds.rows.length > AI_CSV_MAX ? ` Это первые ${fmtNum(AI_CSV_MAX, 'int')} из ${fmtNum(ds.rows.length, 'int')}.` : '';
  if (!(await confirmDialog('Выгрузить пример данных',
    `Будет выгружено ${fmtNum(n, 'int')} ${plural(n, 'строка', 'строки', 'строк')} и ${ds.columns.length} ${plural(ds.columns.length, 'колонка', 'колонки', 'колонок')}.${cut} `
    + 'Строки придуманы Коброй: файл показывает, какие колонки нужны под этот шаблон, а не настоящие цифры.',
    'Выгрузить', false))) return;
  const name = `kobra-vymyshlennye-dannye-${slugKey(ds.name, 0, new Set())}-${isoDate(Date.now())}.csv`;
  if (downloadFile(name, '﻿' + aiRowsToCsv(ds), 'text/csv')) toast('Файл сохранён');
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
      'Хранится в этом браузере и виден любому, у кого есть к нему доступ. Берите персональный токен с лимитом, который не жалко отозвать.'),
    h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 0' } },
      'Если шлюз не разрешает запросы из браузера, обращение не уйдёт — тогда остаётся перенос вручную, он работает всегда.'));
  openModal({
    title: 'Доступ к модели', wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => { aiSaveCfg({ url, token, model }); close(); toast('Настройки доступа сохранены'); done && done(); } }, 'Сохранить')],
  });
}

/* ---------- Панель AI-ассистента ---------- */
const aiOpenState = () => lsGet('kobra.ai.open') || {};
const aiIsOpen = id => !!aiOpenState()[id];
function aiSetOpen(id, v) { const s = aiOpenState(); if (v) s[id] = 1; else delete s[id]; lsSet('kobra.ai.open', s); }

/* api: { ds, applyBlocks, applySchema, rollback, canRollback } — всё, что AI-ассистент
   умеет сделать с дашбордом, живёт в dashboard.js и приходит сюда функциями. */
function renderAssistant(D, host, api) {
  let pending = null;      // последнее предложение, которого ещё не применили
  let samples = false;     // согласие приложить примеры строк — на один запрос
  let busy = false;
  // Бриф показываем первым, пока на него не ответили и не закрыли
  let briefOpen = !aiBriefFilled(aiBrief(D)) && !D.chatBriefSkipped && !aiLog(D).length;
  let draftQ = '';         // набранный вопрос: панель перерисовывается часто
  const ds = () => api.ds();
  /* Отправку собирает paint() — она замкнута на поле ввода, которое там же и
     создаётся. Форме брифа нужна та же отправка, но из своей области видимости
     её не видно, поэтому держим ссылку. */
  let sendNow = async (/** @type {string} */ q) => { };

  /* Форма брифа. Живёт в переписке и закрывается крестиком: человек, который
     уже собрал половину макета, не должен отвечать на восемь вопросов, чтобы
     попросить добавить один блок. */
  const briefForm = () => {
    const draft = Object.assign({ title: D.title || '' }, aiBrief(D) || {});
    const box = h('div', { class: 'ai-form' });
    box.appendChild(h('div', { class: 'ai-form-head' }, h('b', null, 'Коротко о шаблоне'), h('div', { class: 'grow' }),
      iconBtn('x', 'Закрыть форму', () => { briefOpen = false; D.chatBriefSkipped = true; saveSoon(); paint(); }, 'sm')));
    box.appendChild(h('div', { class: 'ai-note' },
      'Ответы уходят с каждым запросом отдельным разделом — AI-ассистент меньше придумывает от себя. Можно заполнить частью или закрыть.'));
    const add = (to, f) => {
      let ctl;
      if (f.pick) ctl = selectEl([['', 'Не указано']].concat(f.pick.map(v => [v, v[0].toUpperCase() + v.slice(1)])),
        draft[f.key] || '', v => { draft[f.key] = v; }, { 'aria-label': f.label });
      else {
        ctl = h(f.area ? 'textarea' : 'input', Object.assign({ class: f.area ? 'textarea' : 'input', placeholder: f.ph || '',
          oninput: e => { draft[f.key] = e.target.value; } }, f.area ? { rows: 2 } : { type: 'text' }));
        ctl.value = draft[f.key] || '';
      }
      to.appendChild(field(f.label, ctl, f.hint));
    };
    AI_BRIEF_FIELDS.filter(f => !f.more).forEach(f => add(box, f));
    const more = h('details', null, h('summary', null, 'Уточнить ещё: разрезы, период, сравнение'));
    AI_BRIEF_FIELDS.filter(f => f.more).forEach(f => add(more, f));
    box.appendChild(more);

    const keep = async fire => {
      const b = {};
      AI_BRIEF_FIELDS.forEach(f => { const v = String(draft[f.key] || '').trim(); if (v) b[f.key] = v; });
      if (!aiBriefFilled(b)) { toast('Форма пустая: ответьте хотя бы на один вопрос или закройте её', true); return; }
      D.chatBrief = b;
      delete D.chatBriefSkipped;
      if (b.title && b.title !== D.title && api.renameDash) api.renameDash(b.title);
      saveState();
      aiPush(D, 'system', 'Бриф сохранён:\n' + aiBriefLines(b).join('\n'));
      briefOpen = false;
      if (fire) { paint(); await sendNow('Собери шаблон по брифу: уровни детализации по вкладкам и блоки под показатели.'); return; }
      toast('Бриф сохранён — он уходит с каждым запросом');
      paint();
    };
    box.appendChild(h('div', { class: 'ai-row' },
      h('button', { class: 'btn sm primary', onclick: () => keep(true) }, 'Собрать по брифу'),
      h('button', { class: 'btn sm', title: 'Запомнить ответы, запрос отправлю сам', onclick: () => keep(false) }, 'Сохранить'),
      h('button', { class: 'btn sm', onclick: () => { briefOpen = false; D.chatBriefSkipped = true; saveSoon(); paint(); } }, 'Пропустить')));
    return box;
  };

  const paint = () => {
    clear(host);
    const mock = isMockupDs(ds());
    host.appendChild(h('div', { class: 'ai-head' }, h('b', null, 'AI-ассистент'),
      h('div', { class: 'grow' }),
      iconBtn('settings', 'Доступ к модели', () => openAiSettings(paint), 'sm'),
      iconBtn('x', 'Закрыть AI-ассистента', () => { aiSetOpen(D.id, false); api.close(); }, 'sm')));

    const log = h('div', { class: 'ai-log' });
    if (D.chatTrimmed) log.appendChild(h('div', { class: 'ai-note' }, 'Часть старых сообщений отброшена: переписка хранится не целиком.'));
    if (briefOpen) log.appendChild(briefForm());
    else if (!aiLog(D).length) log.appendChild(h('div', { class: 'ai-note' },
      mock ? 'Опишите свой процесс словами — AI-ассистент придумает под него данные и предложит блоки. Например: «заявки на кредит: приходят в отделения, проходят скоринг, часть одобряем».'
        : 'Опишите, что хотите увидеть в шаблоне. AI-ассистент предложит блоки, а применять их или нет — решаете вы.'));
    aiLog(D).forEach(m => {
      const el = h('div', { class: 'ai-msg ' + m.role });
      el.appendChild(h('div', { class: 'ai-text' }, m.text));
      if (m.blocks && m.blocks.length) el.appendChild(h('ul', { class: 'ai-blocks' },
        m.blocks.map(b => h('li', null, h('b', null, b.name || (VIZ[b.viz] || {}).label || b.viz), b.why ? ' — ' + b.why : ''))));
      if (m.schemaCols) el.appendChild(h('ul', { class: 'ai-blocks' },
        m.schemaCols.map(c => h('li', null, h('b', null, c.label), ' — ' + c.note))));
      log.appendChild(el);
    });
    host.appendChild(log);
    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);

    // Предложение: применяем только по подтверждению
    if (pending) {
      const what = [];
      if (pending.blocks.length) what.push(`${pending.blocks.length} ${plural(pending.blocks.length, 'блок', 'блока', 'блоков')}`);
      if (pending.schema) what.push('новые придуманные данные');
      host.appendChild(h('div', { class: 'ai-offer' },
        h('div', null, 'Применить предложенное: ' + what.join(' и ') + '?'),
        h('div', { class: 'ai-row' },
          h('button', { class: 'btn sm primary', onclick: () => {
            if (pending.schema) api.applySchema(pending.schema);
            if (pending.blocks.length) api.applyBlocks(pending.blocks);
            aiPush(D, 'system', 'Применено. Если не то — откатите одним действием.');
            pending = null; paint();
          } }, ic('check'), 'Применить'),
          h('button', { class: 'btn sm', onclick: () => { pending = null; paint(); } }, 'Не надо'))));
    } else if (api.canRollback()) {
      host.appendChild(h('div', { class: 'ai-offer' },
        h('div', null, 'Последнее применение можно отменить.'),
        h('div', { class: 'ai-row' }, h('button', { class: 'btn sm', onclick: () => api.rollback() }, ic('reset'), 'Откатить'))));
    }

    // Ввод
    const ta = h('textarea', { class: 'textarea ai-input', rows: 3, placeholder: 'Что показать в шаблоне?', 'aria-label': 'Запрос AI-ассистенту',
      oninput: e => { draftQ = e.target.value; } });
    ta.value = draftQ;
    const send = async (/** @type {string} */ forced) => {
      const q = String(forced || ta.value).trim();
      if (!q || busy) return;
      draftQ = '';
      if (!aiReady()) { toast('Доступ к модели не настроен — воспользуйтесь переносом вручную', true); return; }
      busy = true; paint();
      aiPush(D, 'user', q);
      try {
        const text = await aiAsk([{ role: 'system', content: AI_SYSTEM },
          { role: 'user', content: aiPrompt(q, aiContext(D, ds(), { samples })) }]);
        takeAnswer(text);
      } catch (e) {
        aiPush(D, 'system', 'Не получилось: ' + e.message + (e.kind === 'no_access' ? ' Проверьте настройки доступа.' : e.kind === 'network' ? ' Можно перенести запрос вручную.' : ''));
        if (!forced) ta.value = q;   // введённое не теряем
      }
      samples = false; busy = false; paint();
      if (ta.isConnected) ta.focus();
    };
    sendNow = send;
    const takeAnswer = text => {
      const r = aiParse(text);
      const extra = {};
      if (r.blocks.length) extra.blocks = r.blocks;
      if (r.schema) extra.schemaCols = r.schema.columns.map(c => ({
        label: c.label, note: c.type === 'date' ? 'даты' : c.type === 'number' ? `числа ${c.min ?? '?'}–${c.max ?? '?'}` : (c.values ? c.values.join(', ') : 'категории'),
      }));
      // Подменять настоящие данные придуманными нельзя — предложение режем на входе
      const schema = isMockupDs(ds()) ? r.schema : null;
      if (r.schema && !schema) delete extra.schemaCols;
      aiPush(D, 'assistant', r.ответ || (r.blocks.length || schema ? 'Вот что предлагаю.' : 'Не понял запрос.'), extra);
      if (r.schema && !schema) aiPush(D, 'system', 'Придуманные данные не подставляю: этот шаблон построен на настоящем наборе.');
      pending = (r.blocks.length || schema) ? { blocks: r.blocks, schema } : null;
    };

    host.appendChild(ta);
    const real = ds() && !isMockupDs(ds()) && !isSchemaDs(ds());
    const row = h('div', { class: 'ai-row' },
      h('button', { class: 'btn sm primary', disabled: busy, onclick: send }, busy ? 'Спрашиваю…' : 'Отправить'),
      h('button', { class: 'btn sm', onclick: () => showTextModal('Что уходит наружу', aiPrompt(ta.value, aiContext(D, ds(), { samples }))) }, 'Что уйдёт'),
      h('button', { class: 'btn sm', title: 'Скопировать готовый запрос для внешнего чата', onclick: async () => {
        const txt = AI_SYSTEM + '\n\n' + aiPrompt(ta.value, aiContext(D, ds(), { samples }));
        try { await navigator.clipboard.writeText(txt); toast('Запрос скопирован: вставьте во внешний чат'); }
        catch (e) { showTextModal('Запрос для внешнего чата', txt); }
      } }, 'Скопировать запрос'),
      h('button', { class: 'btn sm', title: 'Вставить ответ, полученный во внешнем чате', onclick: () => {
        const area = h('textarea', { class: 'textarea', rows: 10, placeholder: 'Вставьте сюда ответ внешнего чата' });
        openModal({ title: 'Ответ из внешнего чата', wide: true, body: area,
          foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'),
            h('button', { class: 'btn primary', onclick: () => { close(); takeAnswer(area.value); paint(); } }, 'Разобрать')] });
      } }, 'Вставить ответ'));
    if (!briefOpen) row.appendChild(h('button', { class: 'btn sm', title: 'Ответы о шаблоне, которые уходят с каждым запросом',
      onclick: () => { briefOpen = true; paint(); } }, ic('edit'), aiBriefFilled(aiBrief(D)) ? 'Бриф' : 'Заполнить бриф'));
    host.appendChild(row);
    if (real) host.appendChild(checkbox('Приложить к запросу ' + AI_SAMPLE_ROWS + ' строк данных (на один раз)', samples, v => { samples = v; }));
    else host.appendChild(h('div', { class: 'ai-note' }, 'Данные придуманы, поэтому наружу уходят только названия полей и состав шаблона.'));
    /* Выгрузка придуманных строк нужна, когда блоки уже есть: это пример
       таблицы, по которому аналитик поймёт, какие колонки нужны. На пустом
       шаблоне выгружать нечего, а кнопка пугает: «какие данные, я же ничего
       ещё не сделал». */
    const hasBlocks = (D.tabs || []).some(t => (t.items || []).some(i => i.chartId));
    if (isMockupDs(ds()) && hasBlocks) host.appendChild(h('button', {
      class: 'btn sm', style: { marginTop: '8px' },
      title: 'Придуманная таблица, на которой стоят блоки: пример того, какие колонки нужны аналитику',
      onclick: () => aiExportCsv(ds()),
    }, ic('download'), 'Выгрузить пример данных'));
    if (!aiReady()) host.appendChild(h('div', { class: 'ai-note' },
      'Доступ к модели не настроен: укажите адрес и модель в шестерёнке — или работайте переносом вручную, он не требует ни ключей, ни сети.'));
  };
  paint();
  return { repaint: paint };
}

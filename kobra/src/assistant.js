/* ============================================================
   Кобра · помощник на дашборде
   Человек описывает задачу словами — помощник предлагает состав
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

/* ---------- Что уходит наружу ----------
   Единственное место сборки отправляемого: его целиком можно показать
   человеку и службе безопасности. Строк здесь нет, пока не разрешили. */
function aiContext(D, ds, { samples } = {}) {
  const out = { вопрос: null, набор: null, дашборд: null };
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

/* ---------- Что помощник умеет вернуть ---------- */
const AI_SYSTEM = [
  'Ты помогаешь собрать дашборд в конструкторе «Кобра». Отвечай по-русски и только JSON, без пояснений вокруг.',
  'Формат ответа: {"ответ": "<текст человеку>", "блоки": [...], "набор": {...}}. Поля «блоки» и «набор» необязательны.',
  'Блок: {"вид": "line|bar|pie|area|table|treemap|heatmap|funnel|pivot|big_number_trend", "название": "...", "зачем": "на какой вопрос отвечает"}.',
  'Набор (только если человек просит придумать данные): {"колонки": [{"подпись": "Дата заявки", "тип": "date|string|number", "значения": ["..."], "от": 1, "до": 1000}], "строк": 2000}.',
  'Строки данных не придумывай и не присылай: их сгенерирует Кобра по описанию колонок.',
  'Если запрос не про дашборд и не про данные, верни только «ответ».',
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
  if (!(await confirmDialog('Выгрузить данные в CSV',
    `Будет выгружено ${fmtNum(n, 'int')} ${plural(n, 'строка', 'строки', 'строк')} и ${ds.columns.length} ${plural(ds.columns.length, 'колонка', 'колонки', 'колонок')}.${cut} Данные придуманные.`,
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

/* ---------- Панель помощника ---------- */
const aiOpenState = () => lsGet('kobra.ai.open') || {};
const aiIsOpen = id => !!aiOpenState()[id];
function aiSetOpen(id, v) { const s = aiOpenState(); if (v) s[id] = 1; else delete s[id]; lsSet('kobra.ai.open', s); }

/* api: { ds, applyBlocks, applySchema, rollback, canRollback } — всё, что помощник
   умеет сделать с дашбордом, живёт в dashboard.js и приходит сюда функциями. */
function renderAssistant(D, host, api) {
  let pending = null;      // последнее предложение, которого ещё не применили
  let samples = false;     // согласие приложить примеры строк — на один запрос
  let busy = false;
  const ds = () => api.ds();

  const paint = () => {
    clear(host);
    const mock = isMockupDs(ds());
    host.appendChild(h('div', { class: 'ai-head' }, ic('cobra'), h('b', null, 'Помощник'),
      h('div', { class: 'grow' }),
      iconBtn('settings', 'Доступ к модели', () => openAiSettings(paint), 'sm'),
      iconBtn('x', 'Закрыть помощника', () => { aiSetOpen(D.id, false); api.close(); }, 'sm')));

    const log = h('div', { class: 'ai-log' });
    if (D.chatTrimmed) log.appendChild(h('div', { class: 'ai-note' }, 'Часть старых сообщений отброшена: переписка хранится не целиком.'));
    if (!aiLog(D).length) log.appendChild(h('div', { class: 'ai-note' },
      mock ? 'Опишите свой процесс словами — помощник придумает под него данные и предложит блоки. Например: «заявки на кредит: приходят в отделения, проходят скоринг, часть одобряем».'
        : 'Опишите, что хотите увидеть на дашборде. Помощник предложит блоки, а применять их или нет — решаете вы.'));
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
        h('div', { class: 'ai-row' }, h('button', { class: 'btn sm', onclick: () => { api.rollback(); aiPush(D, 'system', 'Откатано.'); paint(); } }, ic('reset'), 'Откатить'))));
    }

    // Ввод
    const ta = h('textarea', { class: 'textarea ai-input', rows: 3, placeholder: 'Что показать на дашборде?', 'aria-label': 'Запрос помощнику' });
    const send = async () => {
      const q = ta.value.trim();
      if (!q || busy) return;
      if (!aiReady()) { toast('Доступ к модели не настроен — воспользуйтесь переносом вручную', true); return; }
      busy = true; paint();
      aiPush(D, 'user', q);
      try {
        const ctx = aiContext(D, ds(), { samples });
        const text = await aiAsk([{ role: 'system', content: AI_SYSTEM }, { role: 'user', content: q + '\n\nКонтекст:\n' + JSON.stringify(ctx, null, 1) }]);
        takeAnswer(text);
      } catch (e) {
        aiPush(D, 'system', 'Не получилось: ' + e.message + (e.kind === 'no_access' ? ' Проверьте настройки доступа.' : e.kind === 'network' ? ' Можно перенести запрос вручную.' : ''));
        ta.value = q;   // введённое не теряем
      }
      samples = false; busy = false; paint();
      if (ta.isConnected) ta.focus();
    };
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
      if (r.schema && !schema) aiPush(D, 'system', 'Придуманные данные не подставляю: этот дашборд построен на настоящем наборе.');
      pending = (r.blocks.length || schema) ? { blocks: r.blocks, schema } : null;
    };

    host.appendChild(ta);
    const real = ds() && !isMockupDs(ds()) && !isSchemaDs(ds());
    const row = h('div', { class: 'ai-row' },
      h('button', { class: 'btn sm primary', disabled: busy, onclick: send }, busy ? 'Спрашиваю…' : 'Отправить'),
      h('button', { class: 'btn sm', onclick: () => showTextModal('Что уходит наружу', JSON.stringify(aiContext(D, ds(), { samples }), null, 1)) }, 'Что уйдёт'),
      h('button', { class: 'btn sm', title: 'Скопировать готовый запрос для внешнего чата', onclick: async () => {
        const q = ta.value.trim() || '(опишите задачу)';
        const txt = AI_SYSTEM + '\n\nЗадача: ' + q + '\n\nКонтекст:\n' + JSON.stringify(aiContext(D, ds(), { samples }), null, 1);
        try { await navigator.clipboard.writeText(txt); toast('Запрос скопирован: вставьте во внешний чат'); }
        catch (e) { showTextModal('Запрос для внешнего чата', txt); }
      } }, 'Скопировать запрос'),
      h('button', { class: 'btn sm', title: 'Вставить ответ, полученный во внешнем чате', onclick: () => {
        const area = h('textarea', { class: 'textarea', rows: 10, placeholder: 'Вставьте сюда ответ внешнего чата' });
        openModal({ title: 'Ответ из внешнего чата', wide: true, body: area,
          foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'),
            h('button', { class: 'btn primary', onclick: () => { close(); takeAnswer(area.value); paint(); } }, 'Разобрать')] });
      } }, 'Вставить ответ'));
    host.appendChild(row);
    if (real) host.appendChild(checkbox('Приложить к запросу ' + AI_SAMPLE_ROWS + ' строк данных (на один раз)', samples, v => { samples = v; }));
    else host.appendChild(h('div', { class: 'ai-note' }, 'Данные придуманы, поэтому наружу уходят только названия полей и состав дашборда.'));
    if (isMockupDs(ds())) host.appendChild(h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: () => aiExportCsv(ds()) }, ic('download'), 'Выгрузить данные в CSV'));
    if (!aiReady()) host.appendChild(h('div', { class: 'ai-note' },
      'Доступ к модели не настроен: укажите адрес и модель в шестерёнке — или работайте переносом вручную, он не требует ни ключей, ни сети.'));
  };
  paint();
  return { repaint: paint };
}

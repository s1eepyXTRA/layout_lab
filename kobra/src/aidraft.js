/* =============================================================
   Кобра · шаблон по описанию словами
   Человек пишет, что хочет увидеть, — модель отвечает одним JSON,
   Кобра собирает из него **черновик**: обычный шаблон с пометкой
   preview, который нигде не сохранён. Дальше «Сохранить», «Доработать»
   или «Отменить».

   Главное правило разбора: от модели требуется минимум. Чего она не
   прислала или прислала криво — Кобра дорисовывает сама (типы колонок по
   названию, разрезы и раскладку по умолчанию). Поэтому слабая модель даёт
   скелет, сильная — готовый шаблон, и ни одна не ломает экран.
   ============================================================= */

/* Один короткий пример в запросе поднимает долю верного формата у
   маленьких моделей сильнее, чем десяток правил. Формат нарочно плоский:
   на вложенных структурах они путаются. */
const AI_TPL_SYSTEM = [
  'Ты собираешь шаблон дашборда в конструкторе «Кобра». Отвечай только JSON, без пояснений вокруг.',
  'Формат: {"ответ": "...", "название": "...", "колонки": [...], "блоки": [...]}.',
  'Колонка: {"подпись": "Дата заявки", "тип": "date|string|number", "значения": ["..."], "от": 1, "до": 100}.',
  'Блок: {"вкладка": "Сводка", "вид": "line|bar|pie|area|table|treemap|heatmap|funnel|pivot|big_number_trend",'
    + ' "название": "...", "показатель": "сумма: Сумма, ₽", "разрез": "Статус", "шаг": "месяц", "размер": "треть", "зачем": "..."}.',
  'Показатель пиши как «агрегация: подпись колонки» либо «количество строк». Разрез — подпись колонки из «колонки».',
  'Строки данных не придумывай: их сгенерирует Кобра по описанию колонок.',
  'Пример ответа: {"ответ":"Собрал сводку по заявкам.","название":"Заявки",'
    + '"колонки":[{"подпись":"Дата заявки","тип":"date"},{"подпись":"Статус","тип":"string","значения":["Новая","В работе","Закрыта"]}],'
    + '"блоки":[{"вкладка":"Сводка","вид":"big_number_trend","название":"Заявок за месяц","показатель":"количество строк","разрез":"Дата заявки","размер":"треть"},'
    + '{"вкладка":"Сводка","вид":"bar","название":"Заявки по статусам","показатель":"количество строк","разрез":"Статус","размер":"половина"}]}',
].join('\n');

/* ---------- Словари ---------- */
const AI_VIZ_WORDS = {
  line: ['line', 'линия', 'линейный', 'линейный график', 'график', 'динамика', 'тренд'],
  bar: ['bar', 'column', 'columns', 'столбцы', 'столбчатая', 'столбчатая диаграмма', 'гистограмма', 'бар'],
  pie: ['pie', 'donut', 'круговая', 'круговая диаграмма', 'пирог', 'доли', 'кольцо'],
  area: ['area', 'области', 'площадь', 'с накоплением', 'стек'],
  table: ['table', 'таблица', 'список', 'строки', 'детализация'],
  treemap: ['treemap', 'дерево', 'древовидная', 'древовидная карта'],
  heatmap: ['heatmap', 'тепловая', 'тепловая карта', 'матрица'],
  funnel: ['funnel', 'воронка', 'этапы'],
  pivot: ['pivot', 'сводная', 'сводная таблица', 'перекрестная', 'кросс-таблица'],
  big_number_trend: ['big_number_trend', 'big_number', 'kpi', 'большое число', 'число', 'показатель', 'метрика', 'счетчик', 'карточка'],
};
const AI_AGG_WORDS = {
  SUM: ['сумма', 'сумму', 'суммарно', 'итого', 'sum', 'total'],
  AVG: ['среднее', 'средний', 'средняя', 'в среднем', 'avg', 'average', 'mean'],
  COUNT: ['количество', 'количество строк', 'число', 'счетчик', 'строк', 'count', 'rows'],
  COUNT_DISTINCT: ['уникальных', 'уникальные', 'разных', 'count_distinct', 'distinct', 'nunique'],
  MIN: ['минимум', 'минимальный', 'min'],
  MAX: ['максимум', 'максимальный', 'max'],
  MEDIAN: ['медиана', 'median'],
};
const AI_SIZE_WORDS = {
  3: ['четверть', 'узкий', 'маленький', 'small'],
  4: ['треть', 'третья', 'third'],
  6: ['половина', 'пол строки', 'половину', 'средний', 'half', 'medium'],
  8: ['две трети'],
  12: ['вся строка', 'во всю строку', 'полная', 'широкий', 'большой', 'full', 'wide', 'large'],
};
const AI_GRAIN_WORDS = {
  day: ['день', 'дням', 'дневной', 'сутки', 'day', 'daily'],
  week: ['неделя', 'неделям', 'недельный', 'week', 'weekly'],
  month: ['месяц', 'месяцам', 'месячный', 'month', 'monthly'],
  quarter: ['квартал', 'кварталам', 'quarter'],
  year: ['год', 'годам', 'годовой', 'year'],
};

/* Сравнение «на глаз»: регистр, ё и лишние знаки значения не имеют */
const aiNorm = s => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`.,;:()]/g, ' ').replace(/\s+/g, ' ').trim();
function aiWordTable(dict) {
  const out = {};
  Object.entries(dict).forEach(([key, words]) => words.forEach(w => { out[aiNorm(w)] = key; }));
  return out;
}
const AI_VIZ_TABLE = aiWordTable(AI_VIZ_WORDS);
const AI_AGG_TABLE = aiWordTable(AI_AGG_WORDS);
const AI_SIZE_TABLE = aiWordTable(AI_SIZE_WORDS);
const AI_GRAIN_TABLE = aiWordTable(AI_GRAIN_WORDS);

/* Ищем по точному совпадению, потом по вхождению: «столбчатая диаграмма
   по филиалам» всё ещё означает столбцы. */
function aiLookup(table, text) {
  const t = aiNorm(text);
  if (!t) return null;
  if (table[t]) return table[t];
  let best = null;
  Object.keys(table).forEach(w => { if (t.includes(w) && (!best || w.length > best.length)) best = w; });
  return best ? table[best] : null;
}
/* Первое непустое поле из списка имён: модель может ответить по-русски и по-английски */
function aiPick(obj, names) {
  for (const n of names) {
    if (obj && obj[n] != null && obj[n] !== '') return obj[n];
  }
  return null;
}

/* ---------- Разбор ответа ---------- */
/* Терпимость — не роскошь: маленькие модели оборачивают JSON в ```,
   пишут текст вокруг, путают русские и английские ключи и кладут числа
   строками. Всё это надо понять, а что не понято — тихо выбросить. */
function aiParseTemplate(text) {
  const raw = String(text || '').trim();
  const body = raw.replace(/^[\s\S]*?```(?:json)?/i, '').replace(/```[\s\S]*$/, '').trim() || raw;
  let j = null;
  for (const candidate of [body, raw]) {
    try { j = JSON.parse(candidate); break; } catch (e) { /* пробуем дальше */ }
    const m = candidate.match(/\{[\s\S]*\}/);
    if (m) { try { j = JSON.parse(m[0]); break; } catch (e) { /* и так бывает */ } }
  }
  if (!j || typeof j !== 'object') return { plain: true, ответ: raw, колонки: [], блоки: [] };

  const columns = (aiPick(j, ['колонки', 'columns', 'набор', 'dataset']) || []);
  const cols = (Array.isArray(columns) ? columns : columns.колонки || columns.columns || [])
    .map(c => {
      if (typeof c === 'string') return { подпись: c };
      const label = String(aiPick(c, ['подпись', 'название', 'label', 'name', 'title']) || '').trim();
      if (!label) return null;
      const type = aiNorm(aiPick(c, ['тип', 'type']) || '');
      const out = { подпись: label };
      if (/date|дата|время/.test(type)) out.тип = 'date';
      else if (/number|число|numeric|int|float/.test(type)) out.тип = 'number';
      else if (/string|строка|text|категор/.test(type)) out.тип = 'string';
      const vals = aiPick(c, ['значения', 'values', 'примеры']);
      if (Array.isArray(vals) && vals.length) out.значения = vals.map(String);
      const from = aiPick(c, ['от', 'min', 'минимум']), to = aiPick(c, ['до', 'max', 'максимум']);
      if (from != null && isFinite(+from)) out.от = +from;
      if (to != null && isFinite(+to)) out.до = +to;
      return out;
    }).filter(Boolean);

  const rawBlocks = aiPick(j, ['блоки', 'blocks', 'charts', 'графики']) || [];
  const tabsIn = aiPick(j, ['вкладки', 'tabs', 'уровни']) || null;
  const list = [];
  // Модель могла ответить и вложенно — разворачиваем в плоский список
  if (Array.isArray(tabsIn)) {
    tabsIn.forEach(t => {
      const tab = String(aiPick(t, ['название', 'name', 'title', 'вкладка']) || '').trim();
      (aiPick(t, ['блоки', 'blocks', 'charts']) || []).forEach(b => list.push(Object.assign({ вкладка: tab }, b)));
    });
  }
  (Array.isArray(rawBlocks) ? rawBlocks : []).forEach(b => list.push(b));

  const blocks = list.map(b => {
    if (!b || typeof b !== 'object') return null;
    const viz = aiLookup(AI_VIZ_TABLE, aiPick(b, ['вид', 'тип', 'type', 'viz', 'chart', 'kind']));
    if (!viz) return null;            // чужой вид графика выбрасываем молча
    const out = { виз: viz };
    const name = aiPick(b, ['название', 'заголовок', 'name', 'title', 'label']);
    if (name) out.название = String(name).trim();
    const tab = aiPick(b, ['вкладка', 'tab', 'раздел', 'уровень']);
    if (tab) out.вкладка = String(tab).trim();
    const why = aiPick(b, ['зачем', 'вопрос', 'why', 'question', 'описание']);
    if (why) out.зачем = String(why).trim();
    const met = aiPick(b, ['показатель', 'метрика', 'metric', 'measure', 'value']);
    if (met) out.показатель = typeof met === 'object'
      ? `${aiPick(met, ['агрегация', 'agg', 'aggregation']) || ''}: ${aiPick(met, ['колонка', 'поле', 'column', 'field', 'подпись']) || ''}`
      : String(met);
    const dim = aiPick(b, ['разрез', 'измерение', 'группировка', 'dimension', 'by', 'groupby', 'x']);
    if (dim) out.разрез = String(Array.isArray(dim) ? dim[0] : dim);
    const dim2 = aiPick(b, ['второй_разрез', 'второй разрез', 'серии', 'series', 'dimension2', 'y']);
    if (dim2) out.разрез2 = String(Array.isArray(dim2) ? dim2[0] : dim2);
    const grain = aiLookup(AI_GRAIN_TABLE, aiPick(b, ['шаг', 'гранулярность', 'grain', 'period', 'granularity']));
    if (grain) out.шаг = grain;
    const size = aiLookup(AI_SIZE_TABLE, aiPick(b, ['размер', 'ширина', 'size', 'width']));
    if (size) out.ширина = +size;
    return out;
  }).filter(Boolean);

  return {
    plain: false,
    ответ: String(aiPick(j, ['ответ', 'answer', 'комментарий', 'text']) || '').trim(),
    название: String(aiPick(j, ['название', 'title', 'name']) || '').trim(),
    колонки: cols,
    блоки: blocks,
    пропущено: list.length - blocks.length,
  };
}

/* ---------- Колонки ---------- */
/* Набор модель может и не прислать — тогда собираем его из того, что она
   упомянула в блоках: подписи разрезов и показателей, а тип Кобра
   угадывает по названию сама. */
function aiColumnsFor(parsed) {
  const seen = new Map();
  const add = label => {
    const l = String(label || '').trim();
    if (!l || seen.has(aiNorm(l))) return;
    seen.set(aiNorm(l), { подпись: l });
  };
  (parsed.колонки || []).forEach(c => { if (!seen.has(aiNorm(c.подпись))) seen.set(aiNorm(c.подпись), c); });
  (parsed.блоки || []).forEach(b => {
    add(b.разрез); add(b.разрез2);
    if (b.показатель && b.показатель.includes(':')) add(b.показатель.split(':').slice(1).join(':'));
  });
  const cols = [...seen.values()];
  const typed = cols.map((c, i) => {
    const label = c.подпись;
    const guess = guessSchemaCol(label);
    const type = c.тип || guess.type;
    const col = Object.assign({ key: '', label }, guess, { type });
    if (type === 'string' && Array.isArray(c.значения) && c.значения.length) col.values = c.значения.map(String).slice(0, 12);
    if (type === 'number') { if (c.от != null) col.min = +c.от; if (c.до != null) col.max = +c.до; }
    return col;
  });
  // Без даты и без числа шаблон собрать не из чего — дописываем сами
  if (!typed.some(c => c.type === 'date')) typed.unshift(Object.assign({ key: '', label: 'Дата' }, guessSchemaCol('Дата'), { type: 'date' }));
  if (!typed.some(c => c.type === 'number')) typed.push(Object.assign({ key: '', label: 'Показатель' }, guessSchemaCol('Показатель'), { type: 'number' }));
  if (!typed.some(c => c.type === 'string')) typed.push(Object.assign({ key: '', label: 'Категория' }, guessSchemaCol('Категория'), { type: 'string' }));
  const used = new Set();
  typed.forEach((c, i) => { c.key = slugKey(c.label, i, used); });
  return typed;
}

/* ---------- Сборка черновика ---------- */
/* Подпись колонки → ключ. Модель пишет подписи как придумала, поэтому
   сравниваем мягко и прощаем регистр, ё и знаки. */
function aiColKey(ds, label) {
  if (!label) return null;
  const t = aiNorm(label);
  if (!t) return null;
  const exact = ds.columns.find(c => aiNorm(c.label) === t || aiNorm(c.key) === t);
  if (exact) return exact.key;
  const part = ds.columns.find(c => aiNorm(c.label).includes(t) || t.includes(aiNorm(c.label)));
  return part ? part.key : null;
}
/* «сумма: Выручка, ₽» → метрика движка. Непонятное отдаём как null:
   тогда у блока останется показатель по умолчанию. */
function aiMetric(ds, text) {
  if (!text) return null;
  const s = String(text);
  const i = s.indexOf(':');
  const aggWord = i >= 0 ? s.slice(0, i) : s;
  const colWord = i >= 0 ? s.slice(i + 1) : '';
  const agg = aiLookup(AI_AGG_TABLE, aggWord) || 'SUM';
  const col = aiColKey(ds, colWord);
  if (!col) {
    // «количество строк» и всё, где колонку не назвали
    if (agg === 'COUNT' || !colWord.trim()) return { kind: 'simple', agg: 'COUNT', col: '*' };
    return null;
  }
  const c = dsCol(ds, col);
  if (c && c.type !== 'number' && agg !== 'COUNT_DISTINCT' && agg !== 'COUNT') return { kind: 'simple', agg: 'COUNT_DISTINCT', col };
  return { kind: 'simple', agg, col };
}
/* Показатель лежит в разных параметрах у разных видов графика */
function aiSetMetric(chart, met) {
  if (!met) return;
  const p = chart.params;
  if (Array.isArray(p.metrics)) p.metrics = [met];
  else if ('metric' in p) p.metric = met;
  else p.metrics = [met];
}
/* Разрез ставим теми же слотами, что знает простая правка (guided.js):
   там уже описано, где у какого вида графика живёт разрез. */
function aiSetDims(ds, chart, labels, grain) {
  const slots = GUIDED_DIMS[chart.viz] || [];
  labels.filter(Boolean).slice(0, slots.length).forEach((label, i) => {
    const key = aiColKey(ds, label);
    if (!key) return;
    const col = dsCol(ds, key);
    if (col && col.type === 'date') {
      const g = GUIDED_GRAIN[chart.viz];
      if (g) chart.params[g] = grain || chart.params[g] || 'month';
    }
    guidedParamSet(chart, slots[i].spec, key);
  });
  if (grain && GUIDED_GRAIN[chart.viz]) chart.params[GUIDED_GRAIN[chart.viz]] = grain;
}

/* Черновик: дашборд и набор с пометкой preview — в localStorage не пишем */
function aiBuildDraft(parsed, { prompt, answer }) {
  const title = (parsed.название || 'Шаблон по описанию').trim();
  const dashId = uid('d_');
  const columns = aiColumnsFor(parsed);
  const schema = Object.assign({ seed: (Date.now() % 100000) + 1, rowCount: 2000, columns }, defaultSchemaPeriod());
  const cols = columns.map(c => ({ key: c.key, label: c.label, type: c.type }));
  const dsId = uid('ds_');
  DS[dsId] = {
    id: dsId, name: `Данные черновика «${title}»`, kind: 'schema', preview: true, owner: dashId,
    schema, columns: cols, metrics: schemaMetrics(cols, null),
    mainDttm: (cols.find(c => c.type === 'date') || {}).key || null,
    description: SCHEMA_NOTE, rows: generateSchemaRows(schema),
  };
  const ds = DS[dsId];

  // Блоки раскладываем по вкладкам в порядке появления
  const tabs = [];
  const tabOf = name => {
    const t = (name || 'Сводка').trim() || 'Сводка';
    let found = tabs.find(x => aiNorm(x.title) === aiNorm(t));
    if (!found) { found = { id: uid('t'), title: t, items: [], x: 0, y: 0, rowH: 0, row: [], rowKpi: null }; tabs.push(found); }
    return found;
  };
  const isKpi = v => /^big_number/.test(v);
  /* Ряд больших чисел делит ширину поровну — как в готовых шаблонах. Иначе
     «треть + треть + воронка на треть» оставляет дыру под числами. */
  const flushRow = t => {
    const row = t.row;
    if (row.length) {
      if (t.rowKpi) {                      // большие числа — поровну
        const w = Math.floor(G_COLS / row.length);
        row.forEach((it, i) => { it.w = i === row.length - 1 ? G_COLS - w * (row.length - 1) : w; });
      }
      // Остаток ширины раздаём с конца: одинокий блок занимает строку целиком,
      // «половина + треть» превращается в половину и половину. Дыр не остаётся.
      let left = G_COLS - row.reduce((a, it) => a + it.w, 0);
      for (let k = row.length - 1; left > 0; k = (k - 1 + row.length) % row.length) { row[k].w++; left--; }
      let x = 0;
      row.forEach(it => { it.x = x; x += it.w; });
    }
    t.row = []; t.rowKpi = null;
  };
  let made = 0;
  (parsed.блоки || []).forEach(b => {
    const cid = createMockupChart(ds, b.виз);
    if (!cid) return;                       // такой блок на этих данных не построить
    const chart = STATE.charts[cid];
    chart.preview = true;
    if (b.название) { chart.name = b.название; chart.autoName = false; }
    if (b.зачем) chart.spec = normalizeSpec({ question: b.зачем }) || undefined;
    aiSetMetric(chart, aiMetric(ds, b.показатель));
    aiSetDims(ds, chart, [b.разрез, b.разрез2], b.шаг);
    const t = tabOf(b.вкладка);
    const sz = itemDefaultSize('chart', chart);
    const w = Math.max(3, Math.min(12, b.ширина || sz.w));
    const kpi = isKpi(chart.viz);
    // Новый ряд, если не помещается или если ряд «про другое»
    if (t.row.length && (t.x + w > G_COLS || t.rowKpi !== kpi)) { flushRow(t); t.y += t.rowH; t.x = 0; t.rowH = 0; }
    const item = { i: uid('i'), type: 'chart', chartId: cid, x: t.x, y: t.y, w, h: sz.h };
    t.items.push(item); t.row.push(item); t.rowKpi = kpi;
    t.x += w; t.rowH = Math.max(t.rowH, sz.h);
    made++;
  });
  if (!made) { delete DS[dsId]; return null; }
  tabs.forEach(t => { flushRow(t); compactLayout(t.items); ['x', 'y', 'rowH', 'row', 'rowKpi'].forEach(k => delete t[k]); });

  STATE.dashboards[dashId] = {
    id: dashId, title, updated: Date.now(), crossFilter: true, scheme: null,
    tabs, filters: [], preview: true,
    aiDraft: { prompt: prompt || '', answer: answer || '', rounds: 1 },
    fromTemplate: { tplId: null, datasetId: dsId, levels: [], roles: tplRoleMap(pickRoles(ds)) },
  };
  return dashId;
}

/* ---------- Сохранить и отменить ---------- */
function aiDraftSave(id) {
  const D = STATE.dashboards[id];
  if (!D || !D.aiDraft) return;
  const dsId = (D.fromTemplate || {}).datasetId;
  const ds = DS[dsId];
  if (ds) {
    delete ds.preview;
    const { rows, ...meta } = ds;      // строки порождаются по схеме, в состоянии им не место
    STATE.datasets[dsId] = meta;
  }
  D.tabs.forEach(t => t.items.forEach(i => { const c = STATE.charts[i.chartId]; if (c) delete c.preview; }));
  delete D.preview;
  delete D.aiDraft;
  D.updated = Date.now();
  saveState();                          // владельца проставит authStampAll
  toast('Шаблон сохранён');
  go('#/d/' + id);
}
function aiDraftDrop(id) {
  const D = STATE.dashboards[id];
  if (!D) return;
  D.tabs.forEach(t => t.items.forEach(i => { if (i.chartId) delete STATE.charts[i.chartId]; }));
  const dsId = (D.fromTemplate || {}).datasetId;
  delete STATE.dashboards[id];
  if (dsId) delete DS[dsId];
  go('#/dashboards');
}

/* ---------- Запрос ---------- */
/* При доработке модель должна знать три вещи: что она уже собрала, что
   человеку не нравится и что сломалось. Ошибки блоков Кобра видит сама —
   человеку не нужно их описывать словами. */
function aiDraftState(D) {
  if (!D) return null;
  const ds = dsGet((D.fromTemplate || {}).datasetId);
  return {
    название: D.title,
    колонки: ds ? ds.columns.map(c => ({ подпись: c.label, тип: c.type })) : [],
    блоки: D.tabs.flatMap(t => t.items.filter(i => i.chartId && STATE.charts[i.chartId]).map(i => {
      const c = STATE.charts[i.chartId];
      return { вкладка: t.title, вид: c.viz, название: c.name };
    })),
  };
}
/** @param {{draft?: any, errors?: {name: string, error: string}[]}} [opts] */
function aiTplPrompt(task, opts = {}) {
  const { draft, errors } = opts;
  const parts = [`Задача: ${String(task || '').trim()}`];
  if (draft) parts.push('=== ЧТО УЖЕ СОБРАНО ===\n' + JSON.stringify(draft, null, 1) + '\n=== КОНЕЦ ===');
  if (errors && errors.length) {
    parts.push('=== ЧТО НЕ ПОСТРОИЛОСЬ ===\n' + errors.map(e => `- ${e.name}: ${e.error}`).join('\n')
      + '\nИсправь эти блоки: смени вид, показатель или разрез.\n=== КОНЕЦ ===');
  }
  return parts.join('\n\n');
}

/* ---------- Экран «Описать словами» ---------- */
/* Примеры — главный способ объяснить, что сюда писать: пустое поле
   останавливает человека, который «не умеет строить дашборды». */
const AI_EXAMPLES = [
  { chip: 'Заявки', text: 'Заявки на кредит: сколько приходит, как проходят этапы, где отваливаются' },
  { chip: 'Продажи', text: 'Продажи филиалов: выручка по месяцам, топ товаров, средний чек' },
  { chip: 'Поддержка', text: 'Обращения в поддержку: по статусам и ответственным, среднее время ответа' },
  { chip: 'План и факт', text: 'План и факт по отделам за год, с процентом выполнения' },
];

/* Что не построилось в черновике — прикладываем к доработке сами */
function aiDraftErrors(D) {
  if (!D) return [];
  return D.tabs.flatMap(t => t.items.filter(i => i.chartId && chartErrors[i.chartId]).map(i => ({
    name: (STATE.charts[i.chartId] || {}).name || 'Блок',
    error: chartErrors[i.chartId],
  })));
}

function openAiComposer(opts = {}) {
  const draftId = opts.draftId || null;
  const D = draftId ? STATE.dashboards[draftId] : null;
  const refine = !!(D && D.aiDraft);
  const errors = refine ? aiDraftErrors(D) : [];
  let busy = false;
  const body = h('div');
  const ta = h('textarea', {
    class: 'textarea', rows: 4,
    placeholder: refine ? 'Например: убери круговую, добавь просрочку по филиалам, переименуй «Сумма» в «Выручка»'
      : 'Например: дашборд по заявкам на кредит — сколько пришло, как проходят этапы, где отваливаются',
    'aria-label': refine ? 'Что поправить' : 'Что показать на дашборде',
  });
  const prompt = () => aiTplPrompt(ta.value, {
    draft: refine ? aiDraftState(D) : null,
    errors,
  });

  const paint = () => {
    clear(body);
    body.appendChild(h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 12px' } }, refine
      ? 'Напишите, что поправить. Кобра приложит к запросу состав черновика, так что описывать его заново не нужно.'
      : 'Опишите процесс своими словами: что происходит, за чем следите, в каких разрезах смотрите. AI-ассистент соберёт шаблон целиком — вкладки, блоки и придуманные данные под них.'));
    body.appendChild(ta);
    if (!refine) {
      const ex = h('div', { class: 'ai-ex' }, h('span', { class: 'muted' }, 'Например:'));
      AI_EXAMPLES.forEach(e => ex.appendChild(h('button', {
        class: 'btn sm', type: 'button', title: e.text, onclick: () => { ta.value = e.text; ta.focus(); },
      }, e.chip)));
      body.appendChild(ex);
    }
    if (errors.length) body.appendChild(h('div', { class: 'ai-note', style: { marginTop: '10px' } },
      h('b', null, `Не построилось блоков: ${errors.length}.`),
      ' Кобра приложит их к запросу — описывать словами не нужно: ',
      errors.map(e => e.name).join(', ') + '.'));
    body.appendChild(h('div', { class: 'ai-note', style: { marginTop: '10px' } },
      'Наружу уходит только текст запроса и описание колонок. Черновик нигде не сохраняется, пока вы не нажмёте «Сохранить шаблон».'));
    if (!aiReady()) body.appendChild(h('div', { class: 'ai-note' },
      'Доступ к модели не настроен: скопируйте запрос, задайте его во внешнем чате и вставьте ответ сюда — так работает и офлайн-сборка.'));
  };
  paint();

  const m = openModal({
    title: refine ? 'Доработать шаблон' : 'Шаблон по описанию', wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn', title: 'Для внешнего чата: промпт целиком', onclick: async () => {
        const txt = AI_TPL_SYSTEM + '\n\n' + prompt();
        try { await navigator.clipboard.writeText(txt); toast('Запрос скопирован'); }
        catch (e) { showTextModal('Запрос для внешнего чата', txt); }
      } }, 'Скопировать запрос'),
      h('button', { class: 'btn', title: 'Вставить ответ внешнего чата', onclick: () => {
        const area = h('textarea', { class: 'textarea', rows: 10, placeholder: 'Вставьте сюда ответ внешнего чата' });
        openModal({
          title: 'Ответ из внешнего чата', wide: true, body: area,
          foot: c2 => [h('button', { class: 'btn', onclick: c2 }, 'Отмена'),
            h('button', { class: 'btn primary', onclick: () => { c2(); close(); aiApplyAnswer(area.value, { prompt: ta.value, draftId }); } }, 'Собрать')],
        });
      } }, 'Вставить ответ'),
      h('button', { class: 'btn ai', onclick: async () => {
        const q = ta.value.trim();
        if (!q) { toast('Напишите, что нужно', true); return; }
        if (!aiReady()) { toast('Доступ к модели не настроен — скопируйте запрос и вставьте ответ', true); return; }
        if (busy) return;
        busy = true; toast('Собираю…');
        try {
          const text = await aiAsk([{ role: 'system', content: AI_TPL_SYSTEM }, { role: 'user', content: prompt() }]);
          close();
          aiApplyAnswer(text, { prompt: q, draftId });
        } catch (e) {
          toast('Не получилось: ' + e.message + (e.kind === 'network' ? ' Можно перенести запрос вручную.' : ''), true);
        }
        busy = false;
      } }, ic('wand'), refine ? 'Пересобрать' : 'Собрать'),
    ],
  });
  setTimeout(() => ta.focus(), 30);
  return m;
}

/* Ответ модели → черновик. Старый черновик убирать не нужно: он помечен
   preview, и purgePreviews уберёт его при переходе на новый. */
function aiApplyAnswer(text, opts = {}) {
  const r = aiParseTemplate(text);
  if (!r.блоки.length) {
    toast(r.plain ? 'В ответе нет шаблона — показываю текст как есть' : 'Не удалось собрать ни одного блока', true);
    showTextModal('Что ответила модель', r.ответ || String(text || ''));
    return null;
  }
  const prev = opts.draftId ? (STATE.dashboards[opts.draftId] || {}).aiDraft : null;
  const id = aiBuildDraft(r, { prompt: opts.prompt, answer: r.ответ });
  if (!id) { toast('Не удалось собрать черновик', true); return null; }
  if (prev) STATE.dashboards[id].aiDraft.rounds = (prev.rounds || 1) + 1;
  go('#/d/' + id);
  const skipped = r.пропущено ? ` Пропущено непонятных блоков: ${r.пропущено}.` : '';
  toast((r.ответ ? r.ответ.slice(0, 90) : 'Черновик собран') + skipped);
  return id;
}

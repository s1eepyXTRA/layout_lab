/* ============================================================
   Кобра · простая правка
   Режим для тех, кому нужно поменять подписи и разрезы, а не строить
   график заново: ни «метрик», ни «агрегаций», ни конструктора.
   Своего формата не вводит — правит обычные графики дашборда.
   ============================================================ */

/* Разрезы, которые правятся в простом режиме, по одному слоту на параметр
   вида визуализации. Их бывает два: «по дате и по городу» — обычная просьба,
   и у линии, таблицы, сводной и тепловой карты второй разрез есть в самом
   графике. Нет записи — разрез у этого типа не меняется (большое число
   разреза не имеет, у комбинированного по оси X всегда время).
   `optional: true` — слот, который человек включает и убирает сам. */
const GUIDED_DIMS = {
  line: [{ spec: 'x_col' }, { spec: 'series_col', label: 'Серии', add: 'Разбить на серии', optional: true }],
  area: [{ spec: 'x_col' }, { spec: 'series_col', label: 'Серии', add: 'Разбить на серии', optional: true }],
  bar: [{ spec: 'x_col' }, { spec: 'series_col', label: 'Серии', add: 'Разбить на серии', optional: true }],
  mixed: [{ spec: 'x_col' }],
  pie: [{ spec: 'dim' }],
  funnel: [{ spec: 'dim' }],
  bullet: [{ spec: 'dim', add: 'Разбить по разрезу', optional: true }],
  big_number_trend: [{ spec: 'time_col' }],
  heatmap: [{ spec: 'y_col' }, { spec: 'x_col', label: 'Второй разрез' }],
  table: [{ spec: 'groupby[0]' }, { spec: 'groupby[1]', label: 'Второй разрез', optional: true }],
  treemap: [{ spec: 'groupby[0]' }, { spec: 'groupby[1]', label: 'Второй разрез', optional: true }],
  pivot: [{ spec: 'rows[0]' }, { spec: 'cols[0]', label: 'Столбцы', add: 'Добавить столбцы', optional: true }],
};
const GUIDED_ARR = /^(\w+)\[(\d+)\]$/;

/* Путь к параметру: `series_col` или `groupby[1]` */
function guidedParamGet(chart, spec) {
  const p = chart.params || {};
  const m = GUIDED_ARR.exec(spec);
  return m ? ((p[m[1]] || [])[+m[2]] || null) : (p[spec] || null);
}
function guidedParamSet(chart, spec, key) {
  const p = chart.params || (chart.params = {});
  const m = GUIDED_ARR.exec(spec);
  if (!m) { if (key) p[spec] = key; else delete p[spec]; return; }
  const arr = [...(p[m[1]] || [])];
  if (key) arr[+m[2]] = key; else arr.splice(+m[2], 1);
  p[m[1]] = arr.filter(Boolean);
}
/* Разрезы блока: заполненные и те, которые можно включить. У таблицы в режиме
   исходных строк группировок нет вовсе — там печатаются сами строки. */
function guidedDimSlots(ds, chart) {
  if (!chart || !GUIDED_DIMS[chart.viz]) return [];
  if (chart.viz === 'table' && (chart.params || {}).mode === 'raw') return [];
  return GUIDED_DIMS[chart.viz].map((s, nth) => {
    const key = guidedParamGet(chart, s.spec);
    const col = key ? dsCol(ds, key) : null;
    return Object.assign({ label: 'Разрез' }, s,
      { nth, key: col ? key : null, col, time: !!(col && col.type === 'date') });
  }).filter(s => s.key || s.optional);
}
/* Первый разрез — он же тот, по которому собирается заголовок */
function guidedDimKey(chart) {
  const list = chart && GUIDED_DIMS[chart.viz];
  if (!list || (chart.viz === 'table' && (chart.params || {}).mode === 'raw')) return null;
  return guidedParamGet(chart, list[0].spec);
}
/* Поля, по которым этот разрез построится: тот же тип, что и сейчас (у пустого
   слота — текстовые), без идентификаторов (по номеру документа разрез
   бессмыслен) и без того, что уже занято другим разрезом этого же блока */
function guidedDimOptions(ds, chart, slot) {
  const type = slot && slot.col ? slot.col.type : 'string';
  const busy = guidedDimSlots(ds, chart).filter(s => !slot || s.spec !== slot.spec).map(s => s.key);
  return ds.columns
    .filter(c => c.type === type && !AUTO_ID_RE.test(c.key + ' ' + (c.label || '')) && !busy.includes(c.key))
    .map(c => ({ key: c.key, label: colLabel(ds, c.key) }));
}
function guidedMainMetric(chart) {
  const p = chart.params || {};
  return p.metric || (Array.isArray(p.metrics) && p.metrics[0]) || null;
}
const GUIDED_BY = { day: 'по дням', week: 'по неделям', month: 'по месяцам', quarter: 'по кварталам', year: 'по годам' };
const GUIDED_FOR = { day: 'за день', week: 'за неделю', month: 'за месяц', quarter: 'за квартал', year: 'за год' };
/* Заголовок пересобираем только у тех графиков, которым его придумала Кобра */
function guidedRetitle(ds, chart) {
  if (!chart.autoName) return;
  const met = guidedMainMetric(chart);
  const dim = guidedDimKey(chart);
  if (!met) return;
  const t = autoMetricTitle(ds, met);
  const col = dim && dsCol(ds, dim);
  if (col && col.type === 'date') {
    // «Выручка по месяцам» у графика и «Выручка за месяц» у большого числа
    const words = chart.viz === 'big_number_trend' ? GUIDED_FOR : GUIDED_BY;
    chart.name = `${t} ${words[guidedGrainOf(chart)] || words.month}`;
    return;
  }
  if (!dim) { chart.name = t; return; }
  const label = colLabel(ds, dim);
  if (chart.viz === 'table') { const d = autoDative(label); chart.name = d ? `Показатели по ${d}` : `Показатели: ${label}`; return; }
  chart.name = autoTitleBy(t, label);
}
function guidedRename(chart, name) {
  const v = String(name || '').trim();
  if (!v) return false;
  chart.name = v;
  chart.autoName = false;   // дальше заголовок наш не трогает
  return true;
}
/* ---------- Правка придуманных данных ----------
   Работает только на макете: у настоящего набора подписи и значения трогать
   нельзя, там правятся лишь названия блоков. */
const isMockupDs = d => !!(d && d.owner && isSchemaDs(d));

/* Сохранённая метрика блока в наборе: её подпись и формат и есть «показатель» */
function guidedMetricOf(ds, chart) {
  const m = guidedMainMetric(chart);
  if (!m || m.kind !== 'saved') return null;
  return (ds.metrics || []).find(x => x.key === m.key) || null;
}
function guidedSetMetricLabel(ds, chart, text) {
  const met = guidedMetricOf(ds, chart);
  const v = String(text || '').trim();
  if (!met || !v) return false;
  met.label = v;
  persistDs(ds);
  return true;
}
function guidedSuffixOf(ds, chart) {
  const met = guidedMetricOf(ds, chart);
  if (!met) return null;
  const s = fmtSuffix(met.format);
  return s === null ? '' : s;
}
function guidedSetSuffix(ds, chart, text) {
  const met = guidedMetricOf(ds, chart);
  if (!met) return false;
  const v = String(text || '').trim();
  met.format = v ? withSuffix(v) : 'smart';
  persistDs(ds);
  return true;
}

/* Колонка схемы, по которой построен разрез. Дальше всё считается по колонке,
   а не по графику: разрезов у блока бывает два, и правятся они по отдельности. */
function guidedSchemaCol(ds, key) {
  if (!key || !isMockupDs(ds)) return null;
  const col = (ds.schema.columns || []).find(c => c.key === key);
  return col && col.type === 'string' ? col : null;
}
function guidedCats(ds, key) {
  const col = guidedSchemaCol(ds, key);
  if (!col) return null;
  const values = (col.values && col.values.length) ? col.values : schemaFallbackValues(col.label);
  return { col, values, count: values.length };
}
/* Новые названия категорий: чего человек не назвал — дополняем в его же стиле.
   Если он писал «Категория А, Категория Б», продолжаем буквами, а не цифрами:
   иначе в легенде оказывается «Категория Б» вперемешку с «Категория 3». */
const CAT_LETTERS = 'АБВГДЕЖЗИКЛМН';
function guidedCatValues(col, count, names) {
  const given = names.map(x => String(x || '').trim()).filter(Boolean);
  const n = Math.max(2, Math.min(+count || 0, 12));
  const letterStyle = given.length ? /^(.*?) ([А-Я])$/.exec(given[given.length - 1]) : null;
  const base = schemaFallbackValues(col.label);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (given[i]) { out.push(given[i]); continue; }
    if (letterStyle) { out.push(`${letterStyle[1]} ${CAT_LETTERS[i % CAT_LETTERS.length]}`); continue; }
    out.push(base[i % base.length].replace(/\s\d+$/, ' ' + (i + 1)));
  }
  return out;
}
/* Меняет категории в скрытом наборе и пересчитывает строки тем же seed.
   Возвращает старый и новый списки: по ним потом чинятся фильтры дашборда. */
function guidedSetCats(ds, key, count, names) {
  const cur = guidedCats(ds, key);
  if (!cur) return null;
  const next = guidedCatValues(cur.col, count, names);
  if (JSON.stringify(next) === JSON.stringify(cur.values)) return null;
  cur.col.values = next;
  ds.rows = generateSchemaRows(ds.schema);
  delete ds._maxCache;
  persistDs(ds);
  return { col: cur.col.key, old: cur.values, next };
}

/* Второй разрез на макете: берём свободную текстовую колонку схемы, а если
   все заняты — дописываем новую и пересчитываем строки. Данные всё равно
   придуманные, зато «по департаменту и по городу» собирается без конструктора. */
function guidedAddMockDim(ds, chart) {
  const cols = ds.schema.columns || [];
  const busy = guidedDimSlots(ds, chart).map(s => s.key).filter(Boolean);
  const free = cols.find(c => c.type === 'string' && !busy.includes(c.key));
  if (free) return free;
  const label = 'Разрез ' + (cols.filter(c => c.type === 'string').length + 1);
  const col = { key: slugKey(label, cols.length, new Set(cols.map(c => c.key))), label, type: 'string',
    values: guidedCatValues({ label }, 4, ['Категория А']) };
  cols.push(col);
  ds.columns.push({ key: col.key, label, type: 'string' });
  ds.rows = generateSchemaRows(ds.schema);
  delete ds._maxCache;
  persistDs(ds);
  return col;
}

/* У блоков со временем разрез — это сама дата, выбирать тут нечего.
   Зато полезно менять шаг: день, неделя, месяц, квартал, год. */
const GUIDED_GRAIN = { line: 'x_grain', area: 'x_grain', bar: 'x_grain', mixed: 'x_grain', heatmap: 'x_grain',
  table: 'time_grain', big_number_trend: 'x_grain', pivot: 'time_grain' };
function guidedGrainOf(chart) {
  const p = chart.params || {};
  return p[GUIDED_GRAIN[chart.viz]] || 'month';
}
function guidedSetGrain(chart, grain) {
  const key = GUIDED_GRAIN[chart.viz];
  if (!key) return false;
  chart.params[key] = grain;
  return true;
}

/* Разрез в макете — это подпись колонки: человеку всё равно, как она
   называется внутри, ему важно, что написано на экране */
function guidedDimLabel(ds, key) {
  const col = guidedSchemaCol(ds, key);
  return col ? col.label : null;
}
function guidedRenameDim(ds, key, text) {
  const col = guidedSchemaCol(ds, key);
  const v = String(text || '').trim();
  if (!col || !v || col.label === v) return false;
  col.label = v;
  const c = (ds.columns || []).find(x => x.key === col.key);
  if (c) c.label = v;
  persistDs(ds);
  return true;
}
/* Другая форма распределения: подписи те же, пропорции другие */
function guidedCycleSpread(ds, key) {
  const col = guidedSchemaCol(ds, key);
  if (!col) return false;
  col.spread = ((col.spread || 0) + 1) % SCHEMA_SPREADS;
  ds.rows = generateSchemaRows(ds.schema);
  delete ds._maxCache;
  persistDs(ds);
  return true;
}

/* Что человек меняет в этом блоке: словами задачи, без терминов движка */
function guidedWhat(ds, chart) {
  const met = guidedMainMetric(chart);
  return met ? autoMetricTitle(ds, met) : 'строки набора';
}

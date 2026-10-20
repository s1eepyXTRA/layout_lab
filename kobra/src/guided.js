/* ============================================================
   Кобра · простая правка
   Режим для тех, кому нужно поменять подписи и разрезы, а не строить
   график заново: ни «метрик», ни «агрегаций», ни конструктора.
   Своего формата не вводит — правит обычные графики дашборда.
   ============================================================ */

/* Параметр, который у каждого типа визуализации отвечает за разрез.
   Нет строки — значит, в простом режиме разрез у этого типа не меняется
   (большие числа разреза не имеют, у комбинированного он всегда время). */
const GUIDED_DIM = {
  line: 'x_col', area: 'x_col', bar: 'x_col',
  pie: 'dim', funnel: 'dim', bullet: 'dim',
  heatmap: 'y_col',
  table: 'groupby[0]', treemap: 'groupby[0]', pivot: 'rows[0]',
};
const GUIDED_ARR = /^(\w+)\[0\]$/;

function guidedDimSpec(chart) {
  if (!chart || !GUIDED_DIM[chart.viz]) return null;
  if (chart.viz === 'table' && (chart.params || {}).mode === 'raw') return null; // исходные строки не группируются
  return GUIDED_DIM[chart.viz];
}
function guidedDimKey(chart) {
  const spec = guidedDimSpec(chart);
  if (!spec) return null;
  const p = chart.params || {};
  const m = GUIDED_ARR.exec(spec);
  return m ? ((p[m[1]] || [])[0] || null) : (p[spec] || null);
}
function guidedSetDimParam(chart, key) {
  const spec = guidedDimSpec(chart);
  if (!spec) return;
  const m = GUIDED_ARR.exec(spec);
  if (m) { const arr = [...(chart.params[m[1]] || [])]; arr[0] = key; chart.params[m[1]] = arr; }
  else chart.params[spec] = key;
}
/* Поля, по которым этот график построится: тот же тип, что и сейчас,
   без идентификаторов — по номеру документа разрез бессмыслен */
function guidedDimOptions(ds, chart) {
  const cur = guidedDimKey(chart);
  if (!guidedDimSpec(chart)) return [];
  const curCol = cur && dsCol(ds, cur);
  const type = curCol ? curCol.type : 'string';
  return ds.columns
    .filter(c => c.type === type && !AUTO_ID_RE.test(c.key + ' ' + (c.label || '')))
    .map(c => ({ key: c.key, label: colLabel(ds, c.key) }));
}
function guidedMainMetric(chart) {
  const p = chart.params || {};
  return p.metric || (Array.isArray(p.metrics) && p.metrics[0]) || null;
}
/* Заголовок пересобираем только у тех графиков, которым его придумала Кобра */
function guidedRetitle(ds, chart) {
  if (!chart.autoName) return;
  const met = guidedMainMetric(chart);
  const dim = guidedDimKey(chart);
  if (!met) return;
  const t = autoMetricTitle(ds, met);
  const col = dim && dsCol(ds, dim);
  if (col && col.type === 'date') { chart.name = `${t} по месяцам`; return; }
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

/* Колонка схемы, по которой построен разрез блока */
function guidedSchemaCol(ds, chart) {
  const key = guidedDimKey(chart);
  if (!key || !isMockupDs(ds)) return null;
  const col = (ds.schema.columns || []).find(c => c.key === key);
  return col && col.type === 'string' ? col : null;
}
function guidedCats(ds, chart) {
  const col = guidedSchemaCol(ds, chart);
  if (!col) return null;
  const values = (col.values && col.values.length) ? col.values : schemaFallbackValues(col.label);
  return { col, values, count: values.length };
}
/* Новые названия категорий: чего человек не назвал — остаётся нейтральным */
function guidedCatValues(col, count, names) {
  const base = schemaFallbackValues(col.label);
  const n = Math.max(2, Math.min(+count || 0, 12));
  const out = [];
  for (let i = 0; i < n; i++) out.push((names[i] && String(names[i]).trim()) || base[i % base.length].replace(/\s\d+$/, ' ' + (i + 1)));
  return out;
}
/* Меняет категории в скрытом наборе и пересчитывает строки тем же seed.
   Возвращает старый и новый списки: по ним потом чинятся фильтры дашборда. */
function guidedSetCats(ds, chart, count, names) {
  const cur = guidedCats(ds, chart);
  if (!cur) return null;
  const next = guidedCatValues(cur.col, count, names);
  if (JSON.stringify(next) === JSON.stringify(cur.values)) return null;
  cur.col.values = next;
  ds.rows = generateSchemaRows(ds.schema);
  delete ds._maxCache;
  persistDs(ds);
  return { col: cur.col.key, old: cur.values, next };
}

/* Разрез в макете — это подпись колонки: человеку всё равно, как она
   называется внутри, ему важно, что написано на экране */
function guidedDimLabel(ds, chart) {
  const col = guidedSchemaCol(ds, chart);
  return col ? col.label : null;
}
function guidedRenameDim(ds, chart, text) {
  const col = guidedSchemaCol(ds, chart);
  const v = String(text || '').trim();
  if (!col || !v || col.label === v) return false;
  col.label = v;
  const c = (ds.columns || []).find(x => x.key === col.key);
  if (c) c.label = v;
  persistDs(ds);
  return true;
}
/* Другая форма распределения: подписи те же, пропорции другие */
function guidedCycleSpread(ds, chart) {
  const col = guidedSchemaCol(ds, chart);
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

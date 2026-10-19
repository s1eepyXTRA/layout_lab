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
/* Что человек меняет в этом блоке: словами задачи, без терминов движка */
function guidedWhat(ds, chart) {
  const met = guidedMainMetric(chart);
  return met ? autoMetricTitle(ds, met) : 'строки набора';
}

/* ============================================================
   Кобра · визуализации
   ============================================================ */
const COLOR_SCHEMES = {
  kobra: { label: 'Кобра', colors: ['#0E7457', '#D39A1E', '#3F6FB0', '#B8543C', '#7B5AA6', '#2A9DA0', '#8C9A3A', '#C77A9A', '#5B6B66', '#E0B98A'] },
  superset: { label: 'Как в Superset', colors: ['#1FA8C9', '#454E7C', '#5AC189', '#FF7F44', '#666666', '#E04355', '#FCC700', '#A868B7', '#3CCCCB', '#A38F79'] },
  warm: { label: 'Тёплая', colors: ['#9C2F1E', '#D25A2B', '#E88F3A', '#F2BE5C', '#B7864A', '#7A4A2A', '#E0635F', '#C73E61', '#8E5B3E', '#F0A58A'] },
  cold: { label: 'Холодная', colors: ['#0B3C5D', '#1D6A96', '#3E92CC', '#72B8D8', '#2A7F62', '#5FB49C', '#8AA1B1', '#4B5D8C', '#9BC4E2', '#305F72'] },
  jade: { label: 'Оттенки нефрита', colors: ['#0B5F47', '#0E7457', '#2E9474', '#56AE91', '#84C7AF', '#B3DDCD', '#1E4A3D', '#6C9C8B', '#3F7F6A', '#A2C8BA'] },
  orange: { label: 'Оранжевая', colors: ['#FC8507', '#333333', '#8A8A8A', '#FFB45C', '#5A5A5A', '#C96A00', '#BDBDBD', '#FFD3A1', '#1F1F1F', '#E07A10'] },
};
const SEQ_SCHEMES = {
  jade: { label: 'Нефрит', colors: ['#EAF4EF', '#9FD2BD', '#3E9C7A', '#0B5F47'] },
  amber: { label: 'Янтарь', colors: ['#FBF3E0', '#F2CF7E', '#D39A1E', '#8A5A06'] },
  blue: { label: 'Синяя', colors: ['#EAF1FA', '#A7C4E8', '#4C80C4', '#1D3F73'] },
  rdylgn: { label: 'Красный — зелёный', colors: ['#C0412F', '#EFA36B', '#F2E6C9', '#7FC29B', '#1B8456'] },
  mono: { label: 'Серая', colors: ['#F1F3F2', '#B9C2BE', '#6E7C76', '#26312D'] },
};

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  if (!m) return `rgba(128,128,128,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
function cssv(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function themeColors() {
  return {
    ink: cssv('--ink'), ink2: cssv('--ink-2'), ink3: cssv('--ink-3'), line: cssv('--line'), line2: cssv('--line-2'),
    surface: cssv('--surface'), surface2: cssv('--surface-2'), primary: cssv('--primary'), up: cssv('--up'), down: cssv('--down'),
    accent: cssv('--accent'), font: 'Onest, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  };
}
function ecTooltip(t, extra) {
  return Object.assign({
    backgroundColor: t.surface, borderColor: t.line2, borderWidth: 1, padding: [8, 12],
    textStyle: { color: t.ink, fontFamily: t.font, fontSize: 12.5 }, extraCssText: 'box-shadow:0 8px 24px -8px rgba(0,0,0,.25);border-radius:7px;',
    confine: true,
  }, extra || {});
}
function ecAxis(t, extra) {
  return Object.assign({
    axisLine: { lineStyle: { color: t.line2 } }, axisTick: { show: false },
    axisLabel: { color: t.ink3, fontFamily: t.font, fontSize: 11.5, hideOverlap: true },
    splitLine: { lineStyle: { color: t.line, type: [3, 3] } }, nameTextStyle: { color: t.ink3, fontFamily: t.font },
  }, extra || {});
}
function ecLegend(t, p) {
  if (p.show_legend === false) return { show: false };
  const pos = p.legend_pos || 'top';
  const base = { type: 'scroll', textStyle: { color: t.ink2, fontFamily: t.font, fontSize: 12 }, pageTextStyle: { color: t.ink3 }, itemWidth: 12, itemHeight: 10, icon: 'roundRect', pageIconColor: t.primary, pageIconInactiveColor: t.line2 };
  if (pos === 'right') return Object.assign(base, { orient: 'vertical', right: 0, top: 'middle' });
  if (pos === 'bottom') return Object.assign(base, { bottom: 0, left: 'center' });
  return Object.assign(base, { top: 0, left: 0 });
}
function ecGrid(p, hasLegend) {
  const pos = p.legend_pos || 'top';
  return {
    left: 4, right: hasLegend && pos === 'right' ? 150 : 12, top: hasLegend && pos === 'top' ? 34 : 14,
    bottom: (hasLegend && pos === 'bottom' ? 30 : 4) + (p.zoom ? 36 : 0), containLabel: true,
  };
}

/* ---------- Экземпляры ECharts ---------- */
function ecInit(root) {
  if (root._ec) { root._ec.dispose(); root._ec = null; }
  clear(root);
  const el = h('div', { style: { position: 'absolute', inset: '0' } });
  root.appendChild(el);
  const inst = echarts.init(el, null, { renderer: 'canvas' });
  root._ec = inst;
  return inst;
}
function disposeViz(root) {
  if (root && root._ec) { root._ec.dispose(); root._ec = null; }
}
function vizMsg(root, text, isErr) {
  disposeViz(root); clear(root);
  root.appendChild(h('div', { class: 'viz-msg' + (isErr ? ' err' : '') }, text));
}

/* ---------- Общие настройки ---------- */
const C_TIME = { key: 'time_range', type: 'timerange', label: 'Период' };
const C_FILTERS = { key: 'adhoc_filters', type: 'filters', label: 'Фильтры графика' };
const C_LIMIT = (def = 50, label = 'Лимит строк') => ({ key: 'row_limit', type: 'number', label, min: 1, max: 100000, def });
const C_SCHEME = { key: 'color_scheme', type: 'scheme', label: 'Цветовая схема' };
const C_FORMAT = (label = 'Формат чисел') => ({ key: 'y_format', type: 'format', label });
const C_LEGEND = [
  { key: 'show_legend', type: 'check', label: 'Показывать легенду', def: true },
  { key: 'legend_pos', type: 'select', label: 'Положение легенды', options: [['top', 'Сверху'], ['bottom', 'Снизу'], ['right', 'Справа']], showIf: p => p.show_legend !== false },
];
const isDateCol = (ds, key) => { const c = dsCol(ds, key); return !!(c && c.type === 'date'); };
const firstStringCol = (ds, skip = []) => (ds.columns.find(c => c.type === 'string' && !skip.includes(c.key) && !/id$|номер/i.test(c.key + c.label)) || ds.columns.find(c => c.type === 'string') || ds.columns[0] || {}).key;
const firstMetric = ds => ds.metrics[0] ? { kind: 'saved', key: ds.metrics[0].key } : { kind: 'simple', agg: 'COUNT', col: '*' };
const fmtFor = (p, res, i = 0) => (p.y_format && p.y_format !== 'auto') ? p.y_format : (res.mets[i] ? res.mets[i].format : 'smart');

/* XY-запрос: категории по оси X, серии по метрикам и/или измерению */
function queryXY(ds, filters, { xCol, grain, metrics, seriesCol, seriesLimit, sort, catLimit }) {
  const xDate = isDateCol(ds, xCol);
  const gb = [{ col: xCol, grain: xDate ? (grain || 'month') : null }];
  if (seriesCol) gb.push({ col: seriesCol, grain: isDateCol(ds, seriesCol) ? 'year' : null });
  const res = runQuery(ds, { filters, groupby: gb, metrics });
  const xd = res.dims[0], sd = res.dims[1];
  // Категории
  const catTotals = new Map();
  res.rows.forEach(r => catTotals.set(r[xd.key], (catTotals.get(r[xd.key]) || 0) + (+r[res.mets[0].key] || 0)));
  let cats = [...catTotals.keys()];
  if (xDate) cats.sort((a, b) => a - b);
  else if (sort === 'value_asc') cats.sort((a, b) => catTotals.get(a) - catTotals.get(b));
  else if (sort === 'name_asc') cats.sort(cmpVals);
  else cats.sort((a, b) => catTotals.get(b) - catTotals.get(a));
  if (catLimit && cats.length > catLimit) {
    if (xDate) cats = cats.slice(-catLimit); else cats = cats.slice(0, catLimit);
  }
  const catIdx = new Map(cats.map((c, i) => [c, i]));
  const series = [];
  if (sd) {
    const sTot = new Map();
    res.rows.forEach(r => sTot.set(r[sd.key], (sTot.get(r[sd.key]) || 0) + (+r[res.mets[0].key] || 0)));
    let svals = [...sTot.keys()].sort((a, b) => sd.type === 'date' ? a - b : sTot.get(b) - sTot.get(a));
    if (seriesLimit && svals.length > seriesLimit) svals = svals.slice(0, seriesLimit);
    const sIdx = new Map(svals.map((v, i) => [v, i]));
    res.mets.forEach((m, mi) => svals.forEach(sv => series.push({ name: (res.mets.length > 1 ? m.label + ', ' : '') + fmtDimValue(sv, sd), metric: m, mi, sval: sv, data: new Array(cats.length).fill(null) })));
    res.rows.forEach(r => {
      const ci = catIdx.get(r[xd.key]), si = sIdx.get(r[sd.key]);
      if (ci == null || si == null) return;
      res.mets.forEach((m, mi) => { series[mi * svals.length + si].data[ci] = r[m.key]; });
    });
  } else {
    res.mets.forEach((m, mi) => series.push({ name: m.label, metric: m, mi, data: new Array(cats.length).fill(null) }));
    res.rows.forEach(r => { const ci = catIdx.get(r[xd.key]); if (ci == null) return; res.mets.forEach((m, mi) => { series[mi].data[ci] = r[m.key]; }); });
  }
  return { res, cats, labels: cats.map(c => fmtDimValue(c, xd)), series, xd, sd, xDate };
}
function applyAdvanced(series, p) {
  series.forEach(s => {
    if (p.rolling > 1) {
      const n = +p.rolling, src = s.data.slice();
      s.data = src.map((_, i) => { if (i < n - 1) return null; let sum = 0, c = 0; for (let k = i - n + 1; k <= i; k++) if (src[k] != null) { sum += src[k]; c++; } return c ? sum / c : null; });
    }
    if (p.cumulative) { let acc = 0; s.data = s.data.map(v => (acc += (v || 0))); }
  });
}
function crossFromXY(q, idx, sIdx, series) {
  const out = [];
  const v = q.cats[idx];
  if (q.xDate) {
    const g = q.xd.grain;
    out.push({ col: q.xd.col, op: 'between', val: [v, shiftTime(v, g, 1) - 1], label: `${q.xd.label}: ${fmtDimValue(v, q.xd)}` });
  } else out.push({ col: q.xd.col, op: 'in', val: [v], label: `${q.xd.label}: ${fmtDimValue(v, q.xd)}` });
  if (q.sd && series && series[sIdx] && series[sIdx].sval != null && q.sd.type !== 'date') {
    out.push({ col: q.sd.col, op: 'in', val: [series[sIdx].sval], label: `${q.sd.label}: ${fmtDimValue(series[sIdx].sval, q.sd)}` });
  }
  return out;
}
function xyTooltip(t, fmts) {
  return ecTooltip(t, {
    trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(120,140,130,.08)' }, lineStyle: { color: t.line2 } },
    formatter: ps => {
      if (!ps.length) return '';
      let s = `<div style="font-weight:600;margin-bottom:4px">${esc(ps[0].axisValueLabel)}</div>`;
      const sorted = ps.length > 6 ? [...ps].sort((a, b) => (b.value || 0) - (a.value || 0)) : ps;
      sorted.slice(0, 14).forEach(p => {
        const f = fmts[p.seriesIndex] || 'smart';
        s += `<div style="display:flex;gap:14px;justify-content:space-between"><span>${p.marker}${esc(p.seriesName)}</span><b>${fmtNum(p.value, f)}</b></div>`;
      });
      if (sorted.length > 14) s += `<div style="color:${t.ink3}">…и ещё ${sorted.length - 14}</div>`;
      return s;
    },
  });
}

/* Приглушаем невыбранные элементы графика-источника кросс-фильтра */
function crossSet(ctx, col) {
  const f = (ctx.crossActive || []).find(x => x.col === col && x.op === 'in');
  return f ? new Set(f.val.map(String)) : null;
}
function dimInactive(ctx, col, data) {
  const s = crossSet(ctx, col);
  if (!s) return;
  data.forEach(x => { if (!s.has(String(x.raw))) x.itemStyle = Object.assign({}, x.itemStyle, { opacity: 0.28 }); });
}

/* ---------- Реестр ---------- */
const VIZ = {};

// ===== Линейный график и Area =====
function xyControls(kind) {
  const q = [
    { key: 'x_col', type: 'column', label: 'Ось X', any: true },
    { key: 'x_grain', type: 'grain', label: 'Гранулярность времени', showIf: (p, ds) => isDateCol(ds, p.x_col) },
    { key: 'metrics', type: 'metrics', label: 'Метрики' },
    { key: 'series_col', type: 'column', label: 'Разбить на серии по', optional: true, any: true },
    { key: 'series_limit', type: 'number', label: 'Максимум серий', min: 1, max: 50, def: 8, showIf: p => !!p.series_col },
    C_TIME, C_FILTERS,
    { key: 'row_limit', type: 'number', label: 'Максимум точек по оси X', min: 1, max: 5000, def: kind === 'bar' ? 30 : 1000 },
  ];
  if (kind === 'bar') q.splice(5, 0, { key: 'sort', type: 'select', label: 'Сортировка категорий', options: [['value_desc', 'По значению, по убыванию'], ['value_asc', 'По значению, по возрастанию'], ['name_asc', 'По названию']], showIf: (p, ds) => !isDateCol(ds, p.x_col) });
  const view = [C_SCHEME, C_FORMAT('Формат оси Y'), ...C_LEGEND,
    { key: 'show_labels', type: 'check', label: 'Подписи значений' },
    { key: 'x_rotate', type: 'select', label: 'Поворот подписей X', options: [['0', 'Без поворота'], ['30', '30°'], ['45', '45°'], ['90', '90°']] },
    { key: 'zoom', type: 'check', label: 'Масштабирование по оси X' },
    { key: 'y_min_zero', type: 'check', label: 'Ось Y начинается с нуля', def: true },
  ];
  if (kind === 'line' || kind === 'area') view.push({ key: 'smooth', type: 'check', label: 'Сглаживание линий', def: kind === 'area' });
  if (kind === 'line') view.push({ key: 'markers', type: 'check', label: 'Точки на линиях' });
  if (kind === 'area') view.push({ key: 'stacked', type: 'check', label: 'Накопление серий', def: true }, { key: 'expand', type: 'check', label: 'Нормировать до 100 %', showIf: p => p.stacked !== false }, { key: 'opacity', type: 'number', label: 'Прозрачность заливки, %', min: 5, max: 100, def: 35 });
  if (kind === 'bar') view.push({ key: 'horizontal', type: 'check', label: 'Горизонтальные столбцы' }, { key: 'stacked', type: 'check', label: 'Накопление серий' });
  const adv = [];
  if (kind !== 'bar') adv.push({ key: 'cumulative', type: 'check', label: 'Нарастающий итог' }, { key: 'rolling', type: 'number', label: 'Скользящее среднее, окно', min: 0, max: 365, def: 0, hint: '0 — выключено' });
  const secs = [{ title: 'Запрос', tab: 'data', controls: q }, { title: 'Оформление', tab: 'view', controls: view }];
  if (adv.length) secs.splice(1, 0, { title: 'Расширенная аналитика', tab: 'data', controls: adv });
  return secs;
}
function renderXY(root, ctx, kind) {
  const { ds, params: p } = ctx;
  if (!p.x_col) return vizMsg(root, 'Выберите колонку для оси X');
  if (!p.metrics || !p.metrics.length) return vizMsg(root, 'Добавьте хотя бы одну метрику');
  const q = queryXY(ds, ctx.filters, { xCol: p.x_col, grain: p.x_grain, metrics: p.metrics, seriesCol: p.series_col, seriesLimit: p.series_limit || 8, sort: p.sort, catLimit: p.row_limit });
  ctx.setData(q.res);
  if (!q.cats.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
  applyAdvanced(q.series, p);
  const t = themeColors();
  const fmts = q.series.map(s => fmtFor(p, q.res, s.mi));
  const f0 = fmts[0];
  const hor = kind === 'bar' && p.horizontal;
  const expand = kind === 'area' && p.expand && p.stacked !== false;
  if (expand) {
    for (let i = 0; i < q.cats.length; i++) {
      let sum = 0; q.series.forEach(s => sum += (s.data[i] || 0));
      q.series.forEach(s => { s.data[i] = sum ? (s.data[i] || 0) / sum : 0; });
    }
    fmts.fill('pct');
  }
  const stack = (kind === 'area' && p.stacked !== false) || (kind === 'bar' && p.stacked) ? 'total' : undefined;
  const hasLegend = p.show_legend !== false && q.series.length > 1;
  const inst = ecInit(root);
  const catAxis = ecAxis(t, { type: 'category', data: q.labels, boundaryGap: kind === 'bar', axisLabel: { color: t.ink3, fontSize: 11.5, rotate: +(p.x_rotate || 0), hideOverlap: true, fontFamily: t.font }, splitLine: { show: false } });
  const valAxis = ecAxis(t, { type: 'value', scale: p.y_min_zero === false, max: expand ? 1 : null, axisLabel: { color: t.ink3, fontSize: 11.5, fontFamily: t.font, formatter: v => fmtNum(v, expand ? 'pct' : f0) } });
  const xs = !q.xDate && kind === 'bar' ? crossSet(ctx, q.xd.col) : null;
  const series = q.series.map((s, i) => ({
    name: s.name, type: kind === 'bar' ? 'bar' : 'line', data: xs ? s.data.map((v, j) => xs.has(String(q.cats[j])) ? v : { value: v, itemStyle: { opacity: 0.28 } }) : s.data, stack,
    smooth: kind !== 'bar' && !!p.smooth, showSymbol: kind === 'line' ? !!p.markers : false, symbolSize: 6,
    connectNulls: true, lineStyle: { width: kind === 'area' ? 1.5 : 2.2 },
    areaStyle: kind === 'area' ? { opacity: (p.opacity || 35) / 100 } : undefined,
    barMaxWidth: 46, itemStyle: kind === 'bar' ? { borderRadius: stack ? 0 : (hor ? [0, 3, 3, 0] : [3, 3, 0, 0]) } : undefined,
    emphasis: { focus: q.series.length > 1 ? 'series' : 'none' },
    label: p.show_labels ? { show: true, position: kind === 'bar' ? (stack ? 'inside' : (hor ? 'right' : 'top')) : 'top', color: t.ink2, fontSize: 11, formatter: o => fmtNum(o.value, fmts[i]) } : undefined,
  }));
  inst.setOption({
    color: ctx.colors, textStyle: { fontFamily: t.font }, animationDuration: 350,
    legend: hasLegend ? ecLegend(t, p) : { show: false },
    grid: ecGrid(p, hasLegend), tooltip: xyTooltip(t, fmts),
    xAxis: hor ? valAxis : catAxis, yAxis: hor ? Object.assign(catAxis, { inverse: true }) : valAxis,
    dataZoom: p.zoom ? [{ type: 'slider', [hor ? 'yAxisIndex' : 'xAxisIndex']: 0, height: 20, bottom: 6, borderColor: t.line, fillerColor: 'rgba(14,116,87,.12)', textStyle: { color: t.ink3 } }, { type: 'inside' }] : [],
    series,
  });
  inst.on('click', e => ctx.cross && e.componentType === 'series' && ctx.cross(crossFromXY(q, e.dataIndex, e.seriesIndex, q.series)));
}
function xyDefaults(ds, kind) {
  const dt = ds.mainDttm && isDateCol(ds, ds.mainDttm) ? ds.mainDttm : null;
  return {
    x_col: kind === 'bar' ? firstStringCol(ds) : (dt || firstStringCol(ds)), x_grain: 'month',
    metrics: [firstMetric(ds)], series_col: null, series_limit: 8, row_limit: kind === 'bar' ? 30 : 1000,
    time_range: { preset: 'all' }, adhoc_filters: [], color_scheme: 'kobra', y_format: 'auto',
    show_legend: true, legend_pos: 'top', y_min_zero: true, smooth: kind === 'area', stacked: kind === 'area', opacity: 35, sort: 'value_desc', x_rotate: '0',
  };
}
VIZ.line = { label: 'Линейный график', en: 'Line Chart', icon: 'v_line', desc: 'Динамика показателя во времени, сравнение серий.', controls: xyControls('line'), defaults: ds => xyDefaults(ds, 'line'), render: (r, c) => renderXY(r, c, 'line') };
VIZ.area = { label: 'Диаграмма с областями', en: 'Area Chart', icon: 'v_area', desc: 'Объём и структура во времени, накопление серий.', controls: xyControls('area'), defaults: ds => xyDefaults(ds, 'area'), render: (r, c) => renderXY(r, c, 'area') };
VIZ.bar = { label: 'Столбчатая диаграмма', en: 'Bar Chart', icon: 'v_bar', desc: 'Сравнение значений по категориям.', controls: xyControls('bar'), defaults: ds => xyDefaults(ds, 'bar'), render: (r, c) => renderXY(r, c, 'bar') };

// ===== Смешанный график =====
VIZ.mixed = {
  label: 'Смешанный график', en: 'Mixed Chart', icon: 'v_mixed', desc: 'Два запроса на одной оси: столбцы и линии, вторая ось Y.',
  controls: [
    { title: 'Общая ось', tab: 'data', controls: [
      { key: 'x_col', type: 'column', label: 'Ось X', any: true },
      { key: 'x_grain', type: 'grain', label: 'Гранулярность времени', showIf: (p, ds) => isDateCol(ds, p.x_col) },
      C_TIME, C_FILTERS,
      { key: 'row_limit', type: 'number', label: 'Максимум точек по оси X', min: 1, max: 5000, def: 1000 },
    ] },
    { title: 'Запрос A', tab: 'data', controls: [
      { key: 'metrics', type: 'metrics', label: 'Метрики A' },
      { key: 'type_a', type: 'select', label: 'Тип серий A', options: [['bar', 'Столбцы'], ['line', 'Линия'], ['area', 'Область'], ['scatter', 'Точки']] },
      { key: 'stack_a', type: 'check', label: 'Накопление серий A' },
    ] },
    { title: 'Запрос B', tab: 'data', controls: [
      { key: 'metrics_b', type: 'metrics', label: 'Метрики B' },
      { key: 'type_b', type: 'select', label: 'Тип серий B', options: [['line', 'Линия'], ['bar', 'Столбцы'], ['area', 'Область'], ['scatter', 'Точки']] },
      { key: 'axis_b', type: 'select', label: 'Ось Y для B', options: [['right', 'Правая (вторая ось)'], ['left', 'Левая']] },
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      C_SCHEME, { key: 'y_format', type: 'format', label: 'Формат левой оси' }, { key: 'y_format_b', type: 'format', label: 'Формат правой оси' },
      ...C_LEGEND, { key: 'show_labels', type: 'check', label: 'Подписи значений' }, { key: 'smooth', type: 'check', label: 'Сглаживание линий' },
      { key: 'x_rotate', type: 'select', label: 'Поворот подписей X', options: [['0', 'Без поворота'], ['30', '30°'], ['45', '45°'], ['90', '90°']] },
      { key: 'zoom', type: 'check', label: 'Масштабирование по оси X' },
    ] },
  ],
  defaults: ds => {
    const ms = ds.metrics;
    return Object.assign(xyDefaults(ds, 'line'), {
      metrics: [firstMetric(ds)], metrics_b: ms[2] ? [{ kind: 'saved', key: ms[2].key }] : [firstMetric(ds)],
      type_a: 'bar', type_b: 'line', axis_b: 'right', y_format_b: 'auto',
    });
  },
  render(root, ctx) {
    const { ds, params: p } = ctx;
    if (!p.x_col) return vizMsg(root, 'Выберите колонку для оси X');
    const ma = p.metrics || [], mb = p.metrics_b || [];
    if (!ma.length && !mb.length) return vizMsg(root, 'Добавьте метрики в запрос A или B');
    const all = [...ma, ...mb];
    const q = queryXY(ds, ctx.filters, { xCol: p.x_col, grain: p.x_grain, metrics: all, sort: 'value_desc', catLimit: p.row_limit });
    ctx.setData(q.res);
    if (!q.cats.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const t = themeColors();
    const fA = (p.y_format && p.y_format !== 'auto') ? p.y_format : (q.res.mets[0] || {}).format;
    const fB = (p.y_format_b && p.y_format_b !== 'auto') ? p.y_format_b : (q.res.mets[ma.length] || {}).format;
    const useRight = mb.length && p.axis_b !== 'left';
    const fmts = q.series.map((s, i) => i < ma.length ? fA : (useRight ? fB : fA));
    const mk = (s, i) => {
      const isB = i >= ma.length, ty = isB ? p.type_b : p.type_a;
      return {
        name: s.name, type: ty === 'area' ? 'line' : ty, data: s.data, yAxisIndex: isB && useRight ? 1 : 0,
        stack: !isB && p.stack_a ? 'a' : undefined, smooth: !!p.smooth, showSymbol: ty === 'scatter', symbolSize: 8,
        areaStyle: ty === 'area' ? { opacity: .3 } : undefined, barMaxWidth: 42, itemStyle: ty === 'bar' ? { borderRadius: p.stack_a ? 0 : [3, 3, 0, 0] } : undefined,
        lineStyle: { width: 2.2 }, connectNulls: true,
        label: p.show_labels ? { show: true, position: 'top', color: t.ink2, fontSize: 11, formatter: o => fmtNum(o.value, fmts[i]) } : undefined,
      };
    };
    const inst = ecInit(root);
    const yA = ecAxis(t, { type: 'value', axisLabel: { color: t.ink3, fontSize: 11.5, formatter: v => fmtNum(v, fA) } });
    const yB = ecAxis(t, { type: 'value', splitLine: { show: false }, axisLabel: { color: t.ink3, fontSize: 11.5, formatter: v => fmtNum(v, fB) } });
    inst.setOption({
      color: ctx.colors, textStyle: { fontFamily: t.font }, animationDuration: 350,
      legend: p.show_legend !== false ? ecLegend(t, p) : { show: false }, grid: ecGrid(p, p.show_legend !== false),
      tooltip: xyTooltip(t, fmts),
      xAxis: ecAxis(t, { type: 'category', data: q.labels, axisLabel: { color: t.ink3, fontSize: 11.5, rotate: +(p.x_rotate || 0), hideOverlap: true }, splitLine: { show: false } }),
      yAxis: useRight ? [yA, yB] : [yA],
      dataZoom: p.zoom ? [{ type: 'slider', xAxisIndex: 0, height: 20, bottom: 6, borderColor: t.line }, { type: 'inside' }] : [],
      series: q.series.map(mk),
    });
    inst.on('click', e => ctx.cross && e.componentType === 'series' && ctx.cross(crossFromXY(q, e.dataIndex)));
  },
};

// ===== Таблица =====
VIZ.table = {
  label: 'Таблица', en: 'Table', icon: 'v_table', desc: 'Сгруппированные или исходные строки с сортировкой и поиском.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'mode', type: 'segment', label: 'Режим', options: [['agg', 'Агрегация'], ['raw', 'Исходные строки']] },
      { key: 'groupby', type: 'columns', label: 'Измерения', showIf: p => p.mode !== 'raw' },
      { key: 'time_grain', type: 'grain', label: 'Гранулярность дат', showIf: (p, ds) => p.mode !== 'raw' && (p.groupby || []).some(k => isDateCol(ds, k)) },
      { key: 'metrics', type: 'metrics', label: 'Метрики', showIf: p => p.mode !== 'raw' },
      { key: 'columns', type: 'columns', label: 'Колонки', showIf: p => p.mode === 'raw' },
      { key: 'order_col', type: 'column', label: 'Сортировать по', optional: true, any: true, showIf: p => p.mode === 'raw' },
      { key: 'order_desc', type: 'check', label: 'По убыванию', def: true, showIf: p => p.mode === 'raw' },
      C_TIME, C_FILTERS, C_LIMIT(100, 'Лимит строк'),
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      { key: 'page_size', type: 'select', label: 'Строк на странице', options: [['10', '10'], ['25', '25'], ['50', '50'], ['100', '100'], ['0', 'Все']] },
      { key: 'search', type: 'check', label: 'Поиск по таблице' },
      { key: 'cell_bars', type: 'check', label: 'Полосы в ячейках метрик', def: true },
      { key: 'totals', type: 'check', label: 'Строка «Итого»', showIf: p => p.mode !== 'raw' },
      C_FORMAT('Формат чисел'),
    ] },
  ],
  defaults: ds => ({
    mode: 'agg', groupby: [firstStringCol(ds)], metrics: [firstMetric(ds)], columns: ds.columns.slice(0, 6).map(c => c.key),
    time_grain: 'month', row_limit: 100, page_size: '25', search: true, cell_bars: true, totals: true,
    time_range: { preset: 'all' }, adhoc_filters: [], y_format: 'auto', order_desc: true,
  }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    let cols, rows, totals = null;
    if (p.mode === 'raw') {
      const keys = (p.columns || []).filter(k => dsCol(ds, k));
      if (!keys.length) return vizMsg(root, 'Выберите колонки');
      let rs = applyFilters(ds, ctx.filters);
      if (p.order_col) { const k = p.order_col, d = p.order_desc !== false ? -1 : 1; rs = rs.slice().sort((a, b) => d * cmpVals(a[k], b[k])); }
      rows = rs.slice(0, p.row_limit || 100);
      cols = keys.map(k => { const c = dsCol(ds, k); return { key: k, label: c.label || k, isNum: c.type === 'number', dim: { type: c.type, col: k, label: c.label }, fmt: c.type === 'number' ? (p.y_format !== 'auto' && p.y_format ? p.y_format : (/₽/.test(c.label) ? 'rub' : 'smart')) : null }; });
      ctx.setData({ rows, dims: cols.filter(c => !c.isNum).map(c => ({ key: c.key, label: c.label, type: c.dim.type })), mets: cols.filter(c => c.isNum).map(c => ({ key: c.key, label: c.label, format: c.fmt })) });
    } else {
      const gb = (p.groupby || []).filter(k => dsCol(ds, k)).map(k => ({ col: k, grain: isDateCol(ds, k) ? (p.time_grain || 'month') : null }));
      const ms = p.metrics || [];
      if (!gb.length && !ms.length) return vizMsg(root, 'Добавьте измерения или метрики');
      const res = runQuery(ds, { filters: ctx.filters, groupby: gb, metrics: ms, orderby: res0Order(ms, ds), limit: p.row_limit || 100 });
      ctx.setData(res);
      rows = res.rows;
      cols = [...res.dims.map(d => ({ key: d.key, label: d.label, isNum: false, dim: d })), ...res.mets.map(m => ({ key: m.key, label: m.label, isNum: true, fmt: p.y_format && p.y_format !== 'auto' ? p.y_format : m.format }))];
      if (p.totals && ms.length && gb.length) totals = runQuery(ds, { filters: ctx.filters, metrics: ms }).rows[0];
    }
    renderTableUI(root, ctx, cols, rows, totals);
  },
};
function res0Order(ms, ds) { return ms.length ? [{ key: metricLabel(ds, ms[0]), desc: true }] : []; }
function renderTableUI(root, ctx, cols, rows, totals) {
  disposeViz(root); clear(root);
  const p = ctx.params;
  const st = root._tstate || (root._tstate = { sort: null, desc: true, page: 0, q: '' });
  const wrap = h('div', { class: 'vtable' });
  root.appendChild(wrap);
  const maxAbs = {};
  cols.filter(c => c.isNum).forEach(c => { let m = 0; rows.forEach(r => { const v = Math.abs(+r[c.key] || 0); if (v > m) m = v; }); maxAbs[c.key] = m; });
  const pageSize = +(p.page_size ?? 25);
  const tools = h('div', { class: 'vt-tools' });
  const scroll = h('div', { class: 'vt-scroll' });
  const pager = h('div', { class: 'vt-pager' });
  if (p.search) {
    const inp = h('input', { class: 'input', type: 'search', placeholder: 'Поиск', value: st.q, 'aria-label': 'Поиск по таблице' });
    inp.addEventListener('input', debounce(() => { st.q = inp.value; st.page = 0; paint(); }, 200));
    tools.appendChild(inp);
    tools.appendChild(h('span', { class: 'muted', style: { fontSize: '12.5px' } }, ''));
    wrap.appendChild(tools);
  }
  wrap.appendChild(scroll); wrap.appendChild(pager);
  const cellText = (c, v) => c.isNum ? fmtNum(v, c.fmt) : fmtDimValue(v, c.dim);
  function paint() {
    let rs = rows;
    if (st.q) { const q = st.q.toLowerCase(); rs = rs.filter(r => cols.some(c => cellText(c, r[c.key]).toLowerCase().includes(q))); }
    if (st.sort) { const k = st.sort, d = st.desc ? -1 : 1; rs = rs.slice().sort((a, b) => d * cmpVals(a[k], b[k])); }
    const pages = pageSize ? Math.max(1, Math.ceil(rs.length / pageSize)) : 1;
    if (st.page >= pages) st.page = pages - 1;
    const view = pageSize ? rs.slice(st.page * pageSize, (st.page + 1) * pageSize) : rs;
    const tbl = h('table', null,
      h('thead', null, h('tr', null, cols.map(c => h('th', { class: c.isNum ? 'num' : '', onclick: () => { if (st.sort === c.key) st.desc = !st.desc; else { st.sort = c.key; st.desc = c.isNum; } paint(); } },
        c.label, st.sort === c.key ? h('span', { class: 'sa' }, st.desc ? '↓' : '↑') : null)))),
      h('tbody', null, view.map(r => {
        const sel = ctx.crossActive && cols.some(c => !c.isNum && ctx.crossActive.some(f => f.col === (c.dim && c.dim.col) && f.op === 'in' && String(f.val[0]) === String(r[c.key])));
        return h('tr', { class: sel ? 'xsel' : '' }, cols.map(c => {
          const v = r[c.key];
          const td = h('td', { class: c.isNum ? 'num' : '', title: c.isNum ? null : cellText(c, v) });
          if (c.isNum && p.cell_bars !== false && maxAbs[c.key]) {
            const w = Math.abs(+v || 0) / maxAbs[c.key] * 100;
            td.appendChild(h('div', { class: 'cbar' + (v < 0 ? ' neg' : ''), style: { width: w.toFixed(1) + '%' } }));
          }
          td.appendChild(h('span', { class: 'cv' }, cellText(c, v)));
          if (!c.isNum && ctx.cross && c.dim && c.dim.col) {
            td.style.cursor = 'pointer';
            td.addEventListener('click', () => {
              const d = c.dim;
              if (d.type === 'date' && d.grain) ctx.cross([{ col: d.col, op: 'between', val: [v, shiftTime(v, d.grain, 1) - 1], label: `${d.label}: ${fmtDimValue(v, d)}` }]);
              else ctx.cross([{ col: d.col, op: 'in', val: [v], label: `${d.label}: ${fmtDimValue(v, d)}` }]);
            });
          }
          return td;
        }));
      })),
      totals ? h('tfoot', null, h('tr', null, cols.map((c, i) => h('td', { class: c.isNum ? 'num' : '' }, c.isNum ? fmtNum(totals[c.key], c.fmt) : (i === 0 ? 'Итого' : ''))))) : null);
    clear(scroll).appendChild(tbl);
    clear(pager);
    pager.appendChild(h('span', null, `${fmtNum(rs.length, 'int')} ${plural(rs.length, 'строка', 'строки', 'строк')}`));
    if (pageSize && pages > 1) {
      pager.appendChild(iconBtn('chevL', 'Назад', () => { if (st.page > 0) { st.page--; paint(); } }, 'sm'));
      pager.appendChild(h('span', null, `${st.page + 1} из ${pages}`));
      pager.appendChild(iconBtn('chevR', 'Вперёд', () => { if (st.page < pages - 1) { st.page++; paint(); } }, 'sm'));
    }
  }
  paint();
}

// ===== Сводная таблица =====
VIZ.pivot = {
  label: 'Сводная таблица', en: 'Pivot Table', icon: 'v_pivot', desc: 'Строки × столбцы с итогами и тепловой раскраской.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'rows', type: 'columns', label: 'Строки' },
      { key: 'cols', type: 'columns', label: 'Столбцы' },
      { key: 'time_grain', type: 'grain', label: 'Гранулярность дат', showIf: (p, ds) => [...(p.rows || []), ...(p.cols || [])].some(k => isDateCol(ds, k)) },
      { key: 'metrics', type: 'metrics', label: 'Метрики' },
      C_TIME, C_FILTERS,
      { key: 'row_limit', type: 'number', label: 'Максимум строк', min: 1, max: 2000, def: 200 },
      { key: 'col_limit', type: 'number', label: 'Максимум столбцов', min: 1, max: 100, def: 30 },
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      { key: 'row_totals', type: 'check', label: 'Итоги по строкам', def: true },
      { key: 'col_totals', type: 'check', label: 'Итоги по столбцам', def: true },
      { key: 'heat', type: 'check', label: 'Тепловая раскраска ячеек', def: true },
      { key: 'row_sort', type: 'select', label: 'Порядок строк', options: [['name', 'По названию'], ['value_desc', 'По значению, по убыванию']] },
      { key: 'col_sort', type: 'select', label: 'Порядок столбцов', options: [['name', 'По названию'], ['value_desc', 'По значению, по убыванию']] },
      C_FORMAT('Формат чисел'),
    ] },
  ],
  defaults: ds => ({
    rows: [firstStringCol(ds)], cols: ds.mainDttm ? [ds.mainDttm] : [], time_grain: 'year', metrics: [firstMetric(ds)],
    row_limit: 200, col_limit: 30, row_totals: true, col_totals: true, heat: true, row_sort: 'value_desc', col_sort: 'name',
    time_range: { preset: 'all' }, adhoc_filters: [], y_format: 'auto',
  }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    const mk = k => ({ col: k, grain: isDateCol(ds, k) ? (p.time_grain || 'month') : null });
    const R = (p.rows || []).filter(k => dsCol(ds, k)).map(mk), C = (p.cols || []).filter(k => dsCol(ds, k)).map(mk);
    const M = p.metrics || [];
    if (!M.length) return vizMsg(root, 'Добавьте хотя бы одну метрику');
    if (!R.length && !C.length) return vizMsg(root, 'Выберите колонки для строк или столбцов');
    const base = runQuery(ds, { filters: ctx.filters, groupby: [...R, ...C], metrics: M });
    ctx.setData(base);
    if (!base.rows.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const rd = base.dims.slice(0, R.length), cd = base.dims.slice(R.length);
    const rk = r => rd.map(d => r[d.key]).join('\u0001'), ck = r => cd.map(d => r[d.key]).join('\u0001');
    const m0 = base.mets[0].key;
    const rTot = new Map(), cTot = new Map(), rVals = new Map(), cVals = new Map(), cells = new Map();
    base.rows.forEach(r => {
      const a = rk(r), b = ck(r);
      rVals.set(a, rd.map(d => r[d.key])); cVals.set(b, cd.map(d => r[d.key]));
      rTot.set(a, (rTot.get(a) || 0) + (+r[m0] || 0)); cTot.set(b, (cTot.get(b) || 0) + (+r[m0] || 0));
      cells.set(a + '\u0002' + b, r);
    });
    const order = (map, vals, how) => {
      const keys = [...map.keys()];
      if (how === 'value_desc') keys.sort((x, y) => map.get(y) - map.get(x));
      else keys.sort((x, y) => { const a = vals.get(x), b = vals.get(y); for (let i = 0; i < a.length; i++) { const c = cmpVals(a[i], b[i]); if (c) return c; } return 0; });
      return keys;
    };
    let rowKeys = order(rTot, rVals, p.row_sort), colKeys = order(cTot, cVals, p.col_sort);
    const truncated = rowKeys.length > (p.row_limit || 200) || colKeys.length > (p.col_limit || 30);
    rowKeys = rowKeys.slice(0, p.row_limit || 200); colKeys = colKeys.slice(0, p.col_limit || 30);
    const mets = base.mets;
    const fm = i => p.y_format && p.y_format !== 'auto' ? p.y_format : mets[i].format;
    // Итоги (честно пересчитанные, а не суммы)
    const byKey = (dims, gb) => { const m = new Map(); if (!gb.length) return m; runQuery(ds, { filters: ctx.filters, groupby: gb, metrics: M }).rows.forEach(r => m.set(dims.map(d => r[d.key]).join('\u0001'), r)); return m; };
    const rowT = p.row_totals !== false && C.length ? byKey(rd, R) : null;
    const colT = p.col_totals !== false && R.length ? byKey(cd, C) : null;
    const grand = (p.row_totals !== false || p.col_totals !== false) && R.length && C.length ? runQuery(ds, { filters: ctx.filters, metrics: M }).rows[0] : null;
    // Диапазоны для раскраски
    const rng = mets.map(m => { let lo = Infinity, hi = -Infinity; cells.forEach(r => { const v = r[m.key]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); return [lo, hi]; });
    const heat = (v, i) => {
      if (!p.heat || v == null) return null;
      const [lo, hi] = rng[i]; const k = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      return `color-mix(in srgb, var(--primary) ${Math.round(6 + k * 44)}%, transparent)`;
    };
    disposeViz(root); clear(root);
    const nm = mets.length;
    const headRows = [];
    // Заголовок: значения столбцов
    const top = h('tr', null, rd.length ? rd.map((d, i) => h('th', { class: 'rh', rowspan: nm > 1 ? 2 : 1, style: i ? { left: 'auto', position: 'static' } : null }, d.label)) : h('th', { class: 'rh', rowspan: nm > 1 ? 2 : 1 }, ''));
    colKeys.forEach(c => top.appendChild(h('th', { colspan: nm }, cVals.get(c).map((v, i) => fmtDimValue(v, cd[i])).join(' · ') || mets.map(m => m.label).join(', '))));
    if (rowT) top.appendChild(h('th', { colspan: nm, class: 'tot' }, 'Итого'));
    headRows.push(top);
    if (nm > 1) {
      const sub = h('tr');
      [...colKeys, ...(rowT ? ['__t'] : [])].forEach(() => mets.forEach(m => sub.appendChild(h('th', { class: 'num' }, m.label))));
      headRows.push(sub);
    }
    const body = rowKeys.map((rkey, ri) => {
      const rv = rVals.get(rkey);
      const prev = ri ? rVals.get(rowKeys[ri - 1]) : null;
      const tr = h('tr');
      if (rd.length) rd.forEach((d, i) => {
        const same = p.row_sort !== 'value_desc' && prev && rv.slice(0, i + 1).every((v, j) => v === prev[j]) && i < rd.length - 1;
        tr.appendChild(h('td', { class: 'rh', style: i ? { position: 'static' } : null }, same ? '' : fmtDimValue(rv[i], d)));
      });
      else tr.appendChild(h('td', { class: 'rh' }, 'Значение'));
      colKeys.forEach(c => {
        const cell = cells.get(rkey + '\u0002' + c);
        mets.forEach((m, i) => { const v = cell ? cell[m.key] : null; tr.appendChild(h('td', { class: 'num', style: { background: heat(v, i) } }, v == null ? '' : fmtNum(v, fm(i)))); });
      });
      if (rowT) { const t = rowT.get(rkey); mets.forEach((m, i) => tr.appendChild(h('td', { class: 'num tot' }, t ? fmtNum(t[m.key], fm(i)) : ''))); }
      if (ctx.cross && rd.length === 1 && rd[0].type !== 'date') { tr.firstChild.style.cursor = 'pointer'; tr.firstChild.addEventListener('click', () => ctx.cross([{ col: rd[0].col, op: 'in', val: [rv[0]], label: `${rd[0].label}: ${fmtDimValue(rv[0], rd[0])}` }])); }
      return tr;
    });
    let foot = null;
    if (colT) {
      const tr = h('tr', null, h('td', { class: 'rh tot', colspan: Math.max(1, rd.length) }, 'Итого'));
      colKeys.forEach(c => { const t = colT.get(c); mets.forEach((m, i) => tr.appendChild(h('td', { class: 'num tot' }, t ? fmtNum(t[m.key], fm(i)) : ''))); });
      if (rowT) mets.forEach((m, i) => tr.appendChild(h('td', { class: 'num tot' }, grand ? fmtNum(grand[m.key], fm(i)) : '')));
      foot = h('tfoot', null, tr);
    }
    const wrap = h('div', { class: 'vtable pivot' },
      h('div', { class: 'vt-scroll' }, h('table', null, h('thead', null, headRows), h('tbody', null, body), foot)),
      truncated ? h('div', { class: 'vt-pager' }, 'Показана часть строк или столбцов — увеличьте лимиты в настройках') : null);
    root.appendChild(wrap);
  },
};

// ===== Большое число =====
function effectiveTimeWindow(ds, filters) {
  const col = ds.mainDttm;
  let a = null, b = null, found = false;
  (filters || []).forEach(f => {
    if (f.col !== col) return;
    let lo = null, hi = null;
    if (f.op === 'time_range') { [lo, hi] = resolveTimeRange(f.val, dsMaxDate(ds, col)); }
    else if (f.op === 'between') { lo = f.val[0] ?? null; hi = f.val[1] != null ? f.val[1] + 1 : null; }
    else return;
    if (lo == null && hi == null) return;
    found = true;
    if (lo != null) a = a == null ? lo : Math.max(a, lo);
    if (hi != null) b = b == null ? hi : Math.min(b, hi);
  });
  if (!found) return null;
  if (a == null) a = dsMinDate(ds, col);
  if (b == null) b = truncTime(dsMaxDate(ds, col), 'day') + DAY;
  return [a, b];
}
function bigNumDelta(cur, prev, invert, label, fmt) {
  if (cur == null || prev == null || !prev) return null;
  const isPct = fmt === 'pct';
  const d = isPct ? (cur - prev) : (cur - prev) / Math.abs(prev);
  const shown = isPct ? nf(1, 1).format(d * 100) : nf(1, 1).format(d * 100);
  const neutral = Math.abs(d) < 0.0005;
  const good = invert ? d < 0 : d > 0;
  return h('div', { class: 'delta ' + (neutral ? '' : good ? 'up' : 'down') },
    neutral ? null : ic(d >= 0 ? 'up' : 'down'), `${d > 0 && !neutral ? '+' : ''}${neutral ? '0,0' : shown}${isPct ? ' п. п.' : ' %'}`, h('small', null, label));
}
VIZ.big_number = {
  label: 'Большое число', en: 'Big Number', icon: 'v_bignum', desc: 'Один ключевой показатель со сравнением.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'metric', type: 'metric', label: 'Метрика' }, C_TIME, C_FILTERS,
      { key: 'compare', type: 'select', label: 'Сравнение', options: [['none', 'Без сравнения'], ['prev_period', 'С предыдущим периодом такой же длины'], ['prev_year', 'С тем же периодом год назад']], hint: 'Нужен фильтр периода на графике или дашборде' },
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      { key: 'subheader', type: 'text', label: 'Подпись под числом' }, C_FORMAT('Формат числа'),
      { key: 'invert', type: 'check', label: 'Снижение — это хорошо (зелёный цвет)' },
    ] },
  ],
  defaults: ds => ({ metric: firstMetric(ds), compare: 'prev_period', subheader: '', y_format: 'auto', time_range: { preset: 'all' }, adhoc_filters: [] }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    if (!p.metric) return vizMsg(root, 'Выберите метрику');
    const res = runQuery(ds, { filters: ctx.filters, metrics: [p.metric] });
    ctx.setData(res);
    const m = res.mets[0], v = res.rows[0] ? res.rows[0][m.key] : null;
    const f = p.y_format && p.y_format !== 'auto' ? p.y_format : m.format;
    disposeViz(root); clear(root);
    const box = h('div', { class: 'bn center' }, h('div', { class: 'num', title: fmtNum(v, 'dec2') }, fmtNum(v, f)));
    if (p.compare && p.compare !== 'none') {
      const win = effectiveTimeWindow(ds, ctx.filters);
      if (win) {
        const [a, b] = win;
        const pa = p.compare === 'prev_year' ? shiftTime(a, 'year', -1) : a - (b - a);
        const pb = p.compare === 'prev_year' ? shiftTime(b, 'year', -1) : a;
        const col = ds.mainDttm;
        const pf = ctx.filters.filter(x => !(x.col === col && (x.op === 'time_range' || x.op === 'between'))).concat([{ col, op: 'between', val: [pa, pb - 1] }]);
        const pr = runQuery(ds, { filters: pf, metrics: [p.metric] }).rows[0];
        const pv = pr ? pr[m.key] : null;
        const dl = bigNumDelta(v, pv, p.invert, p.compare === 'prev_year' ? ' к прошлому году' : ' к прошлому периоду', f);
        if (dl) box.appendChild(dl);
        else box.appendChild(h('div', { class: 'sub' }, 'Нет данных для сравнения'));
      } else box.appendChild(h('div', { class: 'sub' }, 'Для сравнения задайте период'));
    }
    box.appendChild(h('div', { class: 'sub' }, p.subheader || m.label));
    root.appendChild(box);
  },
};

// ===== Большое число с трендом =====
VIZ.big_number_trend = {
  label: 'Большое число с трендом', en: 'Big Number with Trendline', icon: 'v_bignum_trend', desc: 'Последнее значение, изменение и линия тренда.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'metric', type: 'metric', label: 'Метрика' },
      { key: 'time_col', type: 'column', label: 'Колонка времени', types: ['date'] },
      { key: 'x_grain', type: 'grain', label: 'Гранулярность' },
      C_TIME, C_FILTERS,
      { key: 'value_mode', type: 'select', label: 'Главное число', options: [['last', 'Последний период'], ['total', 'Итог за весь период']] },
      { key: 'compare_lag', type: 'number', label: 'Сравнить с периодом N назад', min: 0, max: 60, def: 1, hint: '0 — без сравнения' },
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      { key: 'subheader', type: 'text', label: 'Подпись' }, C_FORMAT('Формат числа'),
      { key: 'show_trend', type: 'check', label: 'Показывать линию тренда', def: true },
      { key: 'trend_zero', type: 'check', label: 'Шкала тренда от нуля' },
      { key: 'invert', type: 'check', label: 'Снижение — это хорошо (зелёный цвет)' },
      { key: 'skip_partial', type: 'check', label: 'Не учитывать неполный последний период', def: true },
    ] },
  ],
  // skip_partial по умолчанию включён: данные почти всегда обрываются на середине
  // текущего месяца, и тогда KPI сравнивает незакрытый месяц с полным предыдущим и
  // показывает ложный обвал («−49,5 % к сен»). Отброшенный период не прячется —
  // подпись под числом всегда называет месяц, за который взято число. Демо-дашборд
  // это не меняет: демо-наборы заканчиваются 31.08.2026, последний месяц у них полный,
  // а единственный недельный KPI («Оплаченные заказы онлайн») и так ставил галочку сам.
  defaults: ds => ({ metric: firstMetric(ds), time_col: ds.mainDttm, x_grain: 'month', value_mode: 'last', compare_lag: 1, show_trend: true, skip_partial: true, y_format: 'auto', time_range: { preset: 'all' }, adhoc_filters: [], subheader: '' }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    if (!p.metric) return vizMsg(root, 'Выберите метрику');
    const tc = p.time_col || ds.mainDttm;
    if (!isDateCol(ds, tc)) return vizMsg(root, 'Выберите колонку времени');
    const res = runQuery(ds, { filters: ctx.filters, groupby: [{ col: tc, grain: p.x_grain || 'month' }], metrics: [p.metric], orderby: [{ key: tc + '__' + (p.x_grain || 'month'), desc: false }] });
    ctx.setData(res);
    let pts = res.rows.map(r => [r[res.dims[0].key], r[res.mets[0].key]]);
    if (p.skip_partial && pts.length > 1) {
      const last = pts[pts.length - 1][0], end = shiftTime(last, p.x_grain || 'month', 1);
      if (dsMaxDate(ds, tc) < end - DAY) pts = pts.slice(0, -1);
    }
    if (!pts.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const m = res.mets[0];
    const f = p.y_format && p.y_format !== 'auto' ? p.y_format : m.format;
    let v, dl = null;
    if (p.value_mode === 'total') v = runQuery(ds, { filters: ctx.filters, metrics: [p.metric] }).rows[0][m.key];
    else v = pts[pts.length - 1][1];
    const lag = +(p.compare_lag ?? 1);
    if (p.value_mode !== 'total' && lag > 0 && pts.length > lag) dl = bigNumDelta(v, pts[pts.length - 1 - lag][1], p.invert, ` к ${fmtDate(pts[pts.length - 1 - lag][0], p.x_grain)}`, f);
    disposeViz(root); clear(root);
    const box = h('div', { class: 'bn' },
      h('div', { class: 'num', title: fmtNum(v, 'dec2') }, fmtNum(v, f)),
      dl, h('div', { class: 'sub' }, (p.subheader || m.label) + (p.value_mode === 'total' ? '' : ` · ${fmtDate(pts[pts.length - 1][0], p.x_grain)}`)));
    root.appendChild(box);
    if (p.show_trend !== false && pts.length > 1) {
      const tr = h('div', { class: 'trend' });
      box.appendChild(tr);
      const t = themeColors();
      const c = ctx.colors[0];
      const inst = echarts.init(tr);
      root._ec = inst;
      inst.setOption({
        grid: { left: 0, right: 0, top: 6, bottom: 0 }, animationDuration: 350,
        xAxis: { type: 'category', show: false, data: pts.map(x => fmtDate(x[0], p.x_grain)), boundaryGap: false },
        yAxis: { type: 'value', show: false, scale: !p.trend_zero },
        tooltip: ecTooltip(t, { trigger: 'axis', formatter: ps => `${esc(ps[0].axisValueLabel)}<br><b>${fmtNum(ps[0].value, f)}</b>` }),
        series: [{ type: 'line', data: pts.map(x => x[1]), smooth: true, showSymbol: false, lineStyle: { color: c, width: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c + '55' }, { offset: 1, color: c + '00' }]) } }],
      });
    }
  },
};

// ===== Воронка =====
VIZ.funnel = {
  label: 'Воронка', en: 'Funnel Chart', icon: 'v_funnel', desc: 'Конверсия между последовательными этапами.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'dim', type: 'column', label: 'Этапы (измерение)' },
      { key: 'metric', type: 'metric', label: 'Метрика' },
      { key: 'order_by', type: 'column', label: 'Порядок этапов по колонке', optional: true, any: true, hint: 'Пусто — по значению метрики' },
      C_TIME, C_FILTERS, C_LIMIT(10, 'Максимум этапов'),
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      C_SCHEME, C_FORMAT('Формат чисел'),
      { key: 'label_type', type: 'select', label: 'Подписи этапов', options: [['name_value', 'Название и значение'], ['pct_first', 'Название и % от первого этапа'], ['pct_prev', 'Название и % от предыдущего'], ['name', 'Только название']] },
      { key: 'label_pos', type: 'select', label: 'Положение подписей', options: [['right', 'Справа от воронки'], ['inside', 'Внутри этапов']] },
      ...C_LEGEND, { key: 'min_size', type: 'number', label: 'Минимальная ширина, %', min: 0, max: 80, def: 10 },
    ] },
  ],
  defaults: ds => ({ dim: firstStringCol(ds), metric: firstMetric(ds), order_by: null, row_limit: 10, label_type: 'pct_first', label_pos: 'right', show_legend: false, legend_pos: 'top', min_size: 10, color_scheme: 'kobra', y_format: 'auto', time_range: { preset: 'all' }, adhoc_filters: [] }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    if (!p.dim || !p.metric) return vizMsg(root, 'Выберите измерение и метрику');
    const gb = [{ col: p.dim }];
    if (p.order_by && p.order_by !== p.dim) gb.push({ col: p.order_by });
    const res = runQuery(ds, { filters: ctx.filters, groupby: gb, metrics: [p.metric] });
    ctx.setData(res);
    const d = res.dims[0], mk = res.mets[0].key;
    let rows = res.rows.slice();
    if (p.order_by) { const ok = p.order_by === p.dim ? d.key : res.dims[1].key; rows.sort((a, b) => cmpVals(a[ok], b[ok])); }
    else rows.sort((a, b) => (b[mk] || 0) - (a[mk] || 0));
    rows = rows.slice(0, p.row_limit || 10);
    if (!rows.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const t = themeColors();
    const f = fmtFor(p, res);
    const first = rows[0][mk] || 0;
    const data = rows.map((r, i) => ({ name: fmtDimValue(r[d.key], d), value: r[mk], raw: r[d.key], prev: i ? rows[i - 1][mk] : null }));
    dimInactive(ctx, d.col, data);
    const lab = o => {
      const x = data[o.dataIndex];
      if (p.label_type === 'name') return x.name;
      if (p.label_type === 'pct_first') return `${x.name}\n${first ? nf(1, 1).format(x.value / first * 100) + ' %' : ''}`;
      if (p.label_type === 'pct_prev') return `${x.name}\n${x.prev ? nf(1, 1).format(x.value / x.prev * 100) + ' %' : '100 %'}`;
      return `${x.name}\n${fmtNum(x.value, f)}`;
    };
    const inst = ecInit(root);
    inst.setOption({
      color: ctx.colors, textStyle: { fontFamily: t.font }, animationDuration: 350,
      legend: p.show_legend ? ecLegend(t, p) : { show: false },
      tooltip: ecTooltip(t, { trigger: 'item', formatter: o => { const x = data[o.dataIndex]; return `<b>${esc(x.name)}</b><br>${fmtNum(x.value, f)}<br><span style="color:${t.ink3}">${first ? nf(1, 1).format(x.value / first * 100) : '—'} % от первого этапа${x.prev ? ` · ${nf(1, 1).format(x.value / x.prev * 100)} % от предыдущего` : ''}</span>`; } }),
      series: [{ type: 'funnel', sort: p.order_by ? 'none' : 'descending', left: '2%', width: p.label_pos === 'inside' ? '96%' : '60%', top: p.show_legend ? 36 : 8, bottom: 8, minSize: (p.min_size ?? 10) + '%', gap: 3,
        label: p.label_pos === 'inside' ? { show: true, position: 'inside', color: '#fff', fontFamily: t.font, fontSize: 12, lineHeight: 16, formatter: lab } : { show: true, position: 'right', color: t.ink2, fontFamily: t.font, fontSize: 12, lineHeight: 16, formatter: o => lab(o).replace('\n', ' · ') },
        labelLine: { lineStyle: { color: t.line2 }, length: 12 },
        itemStyle: { borderWidth: 0 }, emphasis: { label: { fontWeight: 600 } }, data }],
    });
    inst.on('click', e => ctx.cross && ctx.cross([{ col: d.col, op: 'in', val: [data[e.dataIndex].raw], label: `${d.label}: ${data[e.dataIndex].name}` }]));
  },
};

// ===== Буллет-диаграмма =====
function parseNums(s) {
  s = String(s || '').trim();
  if (!s) return [];
  const parts = s.includes(';') ? s.split(';') : s.split(/[,\s]+/);
  return parts.map(x => x.trim().replace(/\s/g, '').replace(',', '.')).filter(x => x !== '' && !isNaN(+x)).map(Number);
}
VIZ.bullet = {
  label: 'Буллет-диаграмма', en: 'Bullet Chart', icon: 'v_bullet', desc: 'Факт против цели на фоне качественных диапазонов.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'metric', type: 'metric', label: 'Метрика' },
      { key: 'dim', type: 'column', label: 'Разбить по (необязательно)', optional: true },
      C_TIME, C_FILTERS, C_LIMIT(10, 'Максимум строк'),
    ] },
    { title: 'Цель и диапазоны', tab: 'data', controls: [
      { key: 'target_mode', type: 'select', label: 'Цель', options: [['number', 'Число'], ['avg', 'Среднее по строкам'], ['none', 'Без цели']] },
      { key: 'target', type: 'text', label: 'Значение цели', showIf: p => p.target_mode === 'number', hint: 'Для процентов вводите долю: 0,15 = 15 %' },
      { key: 'ranges', type: 'text', label: 'Границы диапазонов', hint: 'Через запятую по возрастанию, например 0,1; 0,13; 0,16. Пусто — автоматически' },
      { key: 'range_labels', type: 'text', label: 'Названия диапазонов', hint: 'Через запятую: Плохо, Норма, Хорошо' },
      { key: 'markers', type: 'text', label: 'Дополнительные отметки', hint: 'Значения через запятую' },
    ] },
    { title: 'Оформление', tab: 'view', controls: [C_FORMAT('Формат чисел'), { key: 'show_labels', type: 'check', label: 'Подпись значения', def: true }] },
  ],
  defaults: ds => ({ metric: firstMetric(ds), dim: null, row_limit: 10, target_mode: 'avg', target: '', ranges: '', range_labels: 'Низко, Норма, Высоко', markers: '', y_format: 'auto', show_labels: true, time_range: { preset: 'all' }, adhoc_filters: [] }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    if (!p.metric) return vizMsg(root, 'Выберите метрику');
    const res = runQuery(ds, { filters: ctx.filters, groupby: p.dim ? [{ col: p.dim, grain: isDateCol(ds, p.dim) ? 'month' : null }] : [], metrics: [p.metric], orderby: [{ key: metricLabel(ds, p.metric), desc: true }], limit: p.row_limit || 10 });
    ctx.setData(res);
    const mk = res.mets[0].key, d = res.dims[0];
    const rows = res.rows.filter(r => r[mk] != null);
    if (!rows.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const f = fmtFor(p, res);
    const vals = rows.map(r => r[mk]);
    const cats = rows.map(r => d ? fmtDimValue(r[d.key], d) : res.mets[0].label);
    let target = null;
    if (p.target_mode === 'number' && String(p.target).trim() !== '') target = +String(p.target).replace(',', '.').replace(/\s/g, '');
    if (p.target_mode === 'avg') target = vals.reduce((a, b) => a + b, 0) / vals.length;
    const maxV = Math.max(...vals, target || 0);
    let ranges = parseNums(p.ranges);
    if (!ranges.length) ranges = [maxV * 0.55, maxV * 0.85, maxV * 1.12];
    ranges.sort((a, b) => a - b);
    const top = Math.max(ranges[ranges.length - 1], maxV * 1.05);
    ranges[ranges.length - 1] = top;
    const rl = String(p.range_labels || '').split(',').map(s => s.trim()).filter(Boolean);
    const markers = parseNums(p.markers);
    const t = themeColors();
    const inst = ecInit(root);
    const shade = i => hexToRgba(t.ink3, 0.12 + (ranges.length - 1 - i) * 0.12);
    const rangeSeries = ranges.map((r, i) => ({ name: rl[i] || `Диапазон ${i + 1}`, type: 'bar', data: rows.map(() => r), barGap: '-100%', barWidth: '64%', itemStyle: { color: shade(i) }, silent: true, z: 1 })).reverse();
    inst.setOption({
      textStyle: { fontFamily: t.font }, animationDuration: 350,
      grid: { left: 4, right: 24, top: 8, bottom: 4, containLabel: true },
      tooltip: ecTooltip(t, { trigger: 'axis', axisPointer: { type: 'none' }, formatter: ps => { const i = ps[0].dataIndex; return `<b>${esc(cats[i])}</b><br>Факт: <b>${fmtNum(vals[i], f)}</b>${target != null ? `<br>Цель: ${fmtNum(target, f)}<br>Выполнение: ${nf(1, 1).format(vals[i] / target * 100)} %` : ''}`; } }),
      xAxis: ecAxis(t, { type: 'value', max: top, axisLabel: { color: t.ink3, fontSize: 11, formatter: v => fmtNum(v, f) } }),
      yAxis: [ecAxis(t, { type: 'category', data: cats, inverse: true, axisLabel: { color: t.ink2, fontSize: 12 }, splitLine: { show: false } }),
        { type: 'category', data: cats, inverse: true, show: false }],
      series: [...rangeSeries,
        { name: 'Факт', type: 'bar', yAxisIndex: 1, data: vals, barWidth: rows.length > 6 ? '22%' : '26%', z: 3, itemStyle: { color: ctx.colors[0], borderRadius: 2 },
          label: p.show_labels !== false ? { show: true, position: 'right', distance: 8, color: t.ink, fontWeight: 600, fontSize: 12, backgroundColor: t.surface, padding: [1, 4], borderRadius: 3, formatter: o => fmtNum(o.value, f) } : undefined },
        target != null ? { name: 'Цель', type: 'scatter', data: rows.map((_, i) => [target, i]), symbol: 'rect', symbolSize: [3, rows.length > 6 ? 20 : 28], itemStyle: { color: t.ink }, z: 4 } : null,
        markers.length ? { name: 'Отметки', type: 'scatter', data: rows.flatMap((_, i) => markers.map(mv => [mv, i])), symbol: 'triangle', symbolSize: 9, symbolRotate: 180, symbolOffset: [0, -14], itemStyle: { color: ctx.colors[1] || t.accent }, z: 5 } : null,
      ].filter(Boolean),
    });
    inst.on('click', e => { if (ctx.cross && d && d.type !== 'date' && e.dataIndex != null && rows[e.dataIndex]) ctx.cross([{ col: d.col, op: 'in', val: [rows[e.dataIndex][d.key]], label: `${d.label}: ${cats[e.dataIndex]}` }]); });
  },
};

// ===== Тепловая карта =====
VIZ.heatmap = {
  label: 'Тепловая карта', en: 'Heatmap', icon: 'v_heatmap', desc: 'Интенсивность метрики на пересечении двух измерений.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'x_col', type: 'column', label: 'Ось X', any: true },
      { key: 'y_col', type: 'column', label: 'Ось Y', any: true },
      { key: 'x_grain', type: 'grain', label: 'Гранулярность дат', showIf: (p, ds) => isDateCol(ds, p.x_col) || isDateCol(ds, p.y_col) },
      { key: 'metric', type: 'metric', label: 'Метрика' },
      C_TIME, C_FILTERS,
      { key: 'x_limit', type: 'number', label: 'Максимум значений по X', min: 1, max: 200, def: 40 },
      { key: 'y_limit', type: 'number', label: 'Максимум значений по Y', min: 1, max: 200, def: 25 },
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      { key: 'seq_scheme', type: 'seqscheme', label: 'Цветовая шкала' },
      { key: 'normalize', type: 'select', label: 'Нормализация цвета', options: [['all', 'По всей карте'], ['x', 'Внутри каждого столбца'], ['y', 'Внутри каждой строки']] },
      { key: 'sort_y', type: 'select', label: 'Порядок строк', options: [['value_desc', 'По сумме, по убыванию'], ['name', 'По названию']] },
      { key: 'show_values', type: 'check', label: 'Значения в ячейках' }, C_FORMAT('Формат чисел'),
      { key: 'show_scale', type: 'check', label: 'Показывать шкалу', def: true },
    ] },
  ],
  defaults: ds => ({ x_col: ds.mainDttm || firstStringCol(ds), y_col: firstStringCol(ds), x_grain: 'month', metric: firstMetric(ds), x_limit: 40, y_limit: 25, seq_scheme: 'jade', normalize: 'all', sort_y: 'value_desc', show_values: false, show_scale: true, y_format: 'auto', time_range: { preset: 'all' }, adhoc_filters: [] }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    if (!p.x_col || !p.y_col || !p.metric) return vizMsg(root, 'Выберите оси X, Y и метрику');
    const g = k => ({ col: k, grain: isDateCol(ds, k) ? (p.x_grain || 'month') : null });
    const res = runQuery(ds, { filters: ctx.filters, groupby: [g(p.x_col), g(p.y_col)], metrics: [p.metric] });
    ctx.setData(res);
    if (!res.rows.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const [xd, yd] = res.dims, mk = res.mets[0].key;
    const tot = (d) => { const m = new Map(); res.rows.forEach(r => m.set(r[d.key], (m.get(r[d.key]) || 0) + (+r[mk] || 0))); return m; };
    const xt = tot(xd), yt = tot(yd);
    let xs = [...xt.keys()], ys = [...yt.keys()];
    xs.sort(xd.type === 'date' ? (a, b) => a - b : (a, b) => xt.get(b) - xt.get(a));
    if (xd.type === 'date') xs = xs.slice(-(p.x_limit || 40)); else xs = xs.slice(0, p.x_limit || 40);
    ys.sort(yd.type === 'date' || p.sort_y === 'name' ? cmpVals : (a, b) => yt.get(b) - yt.get(a));
    ys = ys.slice(0, p.y_limit || 25);
    const xi = new Map(xs.map((v, i) => [v, i])), yi = new Map(ys.map((v, i) => [v, i]));
    const cellsArr = [];
    res.rows.forEach(r => { const a = xi.get(r[xd.key]), b = yi.get(r[yd.key]); if (a != null && b != null && r[mk] != null) cellsArr.push([a, b, r[mk]]); });
    if (p.normalize === 'x' || p.normalize === 'y') {
      const idx = p.normalize === 'x' ? 0 : 1, mx = new Map(), mn = new Map();
      cellsArr.forEach(c => { mx.set(c[idx], Math.max(mx.get(c[idx]) ?? -Infinity, c[2])); mn.set(c[idx], Math.min(mn.get(c[idx]) ?? Infinity, c[2])); });
      cellsArr.forEach(c => { const lo = mn.get(c[idx]), hi = mx.get(c[idx]); c[3] = c[2]; c[2] = hi > lo ? (c[2] - lo) / (hi - lo) : 1; });
    } else cellsArr.forEach(c => { c[3] = c[2]; });
    const vs = cellsArr.map(c => c[2]);
    const f = fmtFor(p, res);
    const t = themeColors();
    const sch = (SEQ_SCHEMES[p.seq_scheme] || SEQ_SCHEMES.jade).colors;
    const inst = ecInit(root);
    const norm = p.normalize === 'x' || p.normalize === 'y';
    const xl = xs.map(v => fmtDimValue(v, xd)), yl = ys.map(v => fmtDimValue(v, yd));
    inst.setOption({
      textStyle: { fontFamily: t.font }, animationDuration: 300,
      grid: { left: 4, right: p.show_scale !== false ? 70 : 8, top: 8, bottom: 4, containLabel: true },
      tooltip: ecTooltip(t, { trigger: 'item', formatter: o => `${esc(yl[o.value[1]])} · ${esc(xl[o.value[0]])}<br><b>${fmtNum(o.value[3], f)}</b>` }),
      xAxis: ecAxis(t, { type: 'category', data: xl, splitArea: { show: false }, axisLabel: { color: t.ink3, fontSize: 11, hideOverlap: true, rotate: xs.length > 14 && xd.type !== 'date' ? 35 : 0 }, splitLine: { show: false } }),
      yAxis: ecAxis(t, { type: 'category', data: yl, inverse: true, axisLabel: { color: t.ink2, fontSize: 11.5 }, splitLine: { show: false } }),
      visualMap: { type: 'continuous', min: Math.min(...vs), max: Math.max(...vs), dimension: 2, calculable: false, show: p.show_scale !== false, orient: 'vertical', right: 0, top: 'middle', itemHeight: 140, itemWidth: 10,
        inRange: { color: sch }, textStyle: { color: t.ink3, fontSize: 11 }, formatter: v => norm ? nf(0, 0).format(v * 100) + ' %' : fmtNum(v, f) },
      series: [{ type: 'heatmap', data: cellsArr, label: { show: !!p.show_values, fontSize: 10.5, color: t.ink, formatter: o => fmtNum(o.value[3], f) }, itemStyle: { borderColor: t.surface, borderWidth: 1.5, borderRadius: 2 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } } }],
    });
    inst.on('click', e => {
      if (!ctx.cross) return;
      const out = [];
      [[xd, xs[e.value[0]]], [yd, ys[e.value[1]]]].forEach(([d, v]) => {
        if (d.type === 'date') out.push({ col: d.col, op: 'between', val: [v, shiftTime(v, d.grain, 1) - 1], label: `${d.label}: ${fmtDimValue(v, d)}` });
        else out.push({ col: d.col, op: 'in', val: [v], label: `${d.label}: ${fmtDimValue(v, d)}` });
      });
      ctx.cross(out);
    });
  },
};

// ===== Круговая =====
VIZ.pie = {
  label: 'Круговая диаграмма', en: 'Pie Chart', icon: 'v_pie', desc: 'Доли частей в целом.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'dim', type: 'column', label: 'Измерение' }, { key: 'metric', type: 'metric', label: 'Метрика' }, C_TIME, C_FILTERS,
      C_LIMIT(8, 'Максимум секторов'), { key: 'other', type: 'check', label: 'Объединять остальное в «Прочее»', def: true },
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      C_SCHEME, C_FORMAT('Формат чисел'),
      { key: 'donut', type: 'check', label: 'Кольцевая диаграмма', def: true },
      { key: 'rose', type: 'check', label: 'Роза Найтингейл (радиус по значению)' },
      { key: 'label_type', type: 'select', label: 'Подписи', options: [['name_pct', 'Название и доля'], ['pct', 'Только доля'], ['name_value', 'Название и значение'], ['value', 'Только значение'], ['name', 'Только название'], ['none', 'Без подписей']] },
      { key: 'total_center', type: 'check', label: 'Итог в центре кольца', def: true, showIf: p => p.donut !== false },
      ...C_LEGEND,
    ] },
  ],
  defaults: ds => ({ dim: firstStringCol(ds), metric: firstMetric(ds), row_limit: 8, other: true, donut: true, rose: false, label_type: 'name_pct', total_center: true, show_legend: false, legend_pos: 'right', color_scheme: 'kobra', y_format: 'auto', time_range: { preset: 'all' }, adhoc_filters: [] }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    if (!p.dim || !p.metric) return vizMsg(root, 'Выберите измерение и метрику');
    const res = runQuery(ds, { filters: ctx.filters, groupby: [{ col: p.dim, grain: isDateCol(ds, p.dim) ? 'year' : null }], metrics: [p.metric], orderby: [{ key: metricLabel(ds, p.metric), desc: true }] });
    ctx.setData(res);
    const d = res.dims[0], mk = res.mets[0].key;
    let rows = res.rows.filter(r => r[mk] > 0);
    if (!rows.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const lim = p.row_limit || 8;
    const data = rows.slice(0, lim).map(r => ({ name: fmtDimValue(r[d.key], d), value: r[mk], raw: r[d.key] }));
    if (rows.length > lim && p.other !== false) data.push({ name: 'Прочее', value: rows.slice(lim).reduce((a, r) => a + r[mk], 0), other: true, itemStyle: { color: themeColors().line2 } });
    const total = data.reduce((a, x) => a + x.value, 0);
    dimInactive(ctx, d.col, data);
    const f = fmtFor(p, res);
    const t = themeColors();
    const pct = v => nf(1, 1).format(v / total * 100) + ' %';
    const lt = p.label_type || 'name_pct';
    const lab = o => lt === 'pct' ? pct(o.value) : lt === 'name_value' ? `${o.name}\n${fmtNum(o.value, f)}` : lt === 'value' ? fmtNum(o.value, f) : lt === 'name' ? o.name : `${o.name}\n${pct(o.value)}`;
    const leg = p.show_legend;
    const legRight = leg && (p.legend_pos || 'right') === 'right';
    const cx = legRight ? '30%' : '50%';
    const cy = leg && p.legend_pos === 'top' ? '56%' : leg && p.legend_pos === 'bottom' ? '45%' : '50%';
    const rOut = legRight ? 58 : lt !== 'none' ? 62 : 74;
    const inst = ecInit(root);
    inst.setOption({
      color: ctx.colors, textStyle: { fontFamily: t.font }, animationDuration: 350,
      legend: leg ? Object.assign(ecLegend(t, p), legRight ? { left: '62%', right: 0 } : {}, { formatter: n => n.length > 24 ? n.slice(0, 23) + '…' : n }) : { show: false },
      tooltip: ecTooltip(t, { trigger: 'item', formatter: o => `<b>${esc(o.name)}</b><br>${fmtNum(o.value, f)} · ${pct(o.value)}` }),
      title: p.donut !== false && p.total_center !== false ? { text: fmtNum(total, f), subtext: 'Итого', left: cx, top: cy, textAlign: 'center', textVerticalAlign: 'middle', itemGap: 4,
        textStyle: { color: t.ink, fontSize: 17, fontWeight: 600, fontFamily: t.font }, subtextStyle: { color: t.ink3, fontSize: 11.5 } } : undefined,
      series: [{ type: 'pie', center: [cx, cy], radius: p.donut !== false ? [Math.round(rOut * 0.64) + '%', rOut + '%'] : [0, rOut + '%'], roseType: p.rose ? 'radius' : false,
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: p.donut !== false ? 4 : 0 }, avoidLabelOverlap: true,
        label: lt === 'none' ? { show: false } : (legRight || lt === 'pct') && p.donut !== false ? { show: true, position: 'inside', color: '#fff', fontSize: 11, fontWeight: 600, formatter: o => o.percent >= 4 ? lab(o) : '' } : { show: true, color: t.ink2, fontSize: 11.5, formatter: lab, lineHeight: 15, alignTo: 'edge', edgeDistance: 4, minMargin: 4 }, labelLine: { lineStyle: { color: t.line2 }, length: 10, length2: 0, maxSurfaceAngle: 80 }, labelLayout: { hideOverlap: true },
        data }],
    });
    inst.on('click', e => { const x = data[e.dataIndex]; if (ctx.cross && x && !x.other) ctx.cross([{ col: d.col, op: 'in', val: [x.raw], label: `${d.label}: ${x.name}` }]); });
  },
};

// ===== Древовидная карта =====
VIZ.treemap = {
  label: 'Древовидная карта', en: 'Treemap', icon: 'v_treemap', desc: 'Иерархия долей: категории внутри категорий.',
  controls: [
    { title: 'Запрос', tab: 'data', controls: [
      { key: 'groupby', type: 'columns', label: 'Уровни иерархии', max: 3 }, { key: 'metric', type: 'metric', label: 'Метрика' }, C_TIME, C_FILTERS,
      C_LIMIT(200, 'Максимум листьев'),
    ] },
    { title: 'Оформление', tab: 'view', controls: [
      C_SCHEME, C_FORMAT('Формат чисел'),
      { key: 'show_values', type: 'check', label: 'Значения в подписях', def: true },
      { key: 'show_pct', type: 'check', label: 'Доля в подписях' },
      { key: 'drill', type: 'check', label: 'Приближение по клику', def: true, hint: 'Когда включена кросс-фильтрация, клик фильтрует дашборд' },
    ] },
  ],
  defaults: ds => ({ groupby: [firstStringCol(ds)], metric: firstMetric(ds), row_limit: 200, show_values: true, show_pct: false, drill: true, color_scheme: 'kobra', y_format: 'auto', time_range: { preset: 'all' }, adhoc_filters: [] }),
  render(root, ctx) {
    const { ds, params: p } = ctx;
    const gb = (p.groupby || []).filter(k => dsCol(ds, k)).slice(0, 3);
    if (!gb.length || !p.metric) return vizMsg(root, 'Выберите уровни иерархии и метрику');
    const res = runQuery(ds, { filters: ctx.filters, groupby: gb.map(k => ({ col: k, grain: isDateCol(ds, k) ? 'year' : null })), metrics: [p.metric], orderby: [{ key: metricLabel(ds, p.metric), desc: true }], limit: p.row_limit || 200 });
    ctx.setData(res);
    const mk = res.mets[0].key;
    const rows = res.rows.filter(r => r[mk] > 0);
    if (!rows.length) return vizMsg(root, 'Нет данных для выбранных фильтров');
    const rootNode = { children: [], map: new Map() };
    let total = 0;
    rows.forEach(r => {
      let node = rootNode; total += r[mk];
      res.dims.forEach((d, i) => {
        const raw = r[d.key], name = fmtDimValue(raw, d);
        let ch = node.map.get(name);
        if (!ch) { ch = { name, raw, dim: d, value: 0, children: [], map: new Map() }; node.map.set(name, ch); node.children.push(ch); }
        ch.value += r[mk];
        node = ch;
      });
    });
    const strip = n => { const o = { name: n.name, value: n.value, raw: n.raw, dimKey: n.dim.col }; if (n.children.length) o.children = n.children.map(strip); return o; };
    const data = rootNode.children.map(strip);
    const f = fmtFor(p, res);
    const t = themeColors();
    const lab = o => { let s = o.name; if (p.show_values !== false) s += `\n${fmtNum(o.value, f)}`; if (p.show_pct) s += `\n${nf(1, 1).format(o.value / total * 100)} %`; return s; };
    const inst = ecInit(root);
    inst.setOption({
      color: ctx.colors, textStyle: { fontFamily: t.font }, animationDuration: 350,
      tooltip: ecTooltip(t, { formatter: o => { const path = (o.treePathInfo || []).slice(1).map(x => esc(x.name)).join(' › '); return `<b>${path}</b><br>${fmtNum(o.value, f)} · ${nf(1, 1).format(o.value / total * 100)} %`; } }),
      series: [{
        type: 'treemap', data, top: 4, left: 0, right: 0, bottom: gb.length > 1 ? 30 : 0, roam: false,
        nodeClick: ctx.cross ? false : (p.drill !== false ? 'zoomToNode' : false),
        breadcrumb: { show: gb.length > 1, bottom: 2, height: 20, itemStyle: { color: t.surface2, borderColor: t.line, textStyle: { color: t.ink2 } } },
        label: { show: true, formatter: lab, fontSize: 12, lineHeight: 15, color: '#fff', overflow: 'truncate' },
        upperLabel: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 1, gapWidth: 1 },
        levels: gb.length > 1 ? [{ itemStyle: { borderWidth: 2, gapWidth: 2, borderColor: t.surface } }, { colorAlpha: [0.5, 1], itemStyle: { gapWidth: 1, borderWidth: 0 } }, { colorAlpha: [0.45, 0.9], itemStyle: { gapWidth: 1 } }] : [],
      }],
    });
    inst.on('click', e => {
      if (!ctx.cross || !e.treePathInfo) return;
      const path = e.treePathInfo.slice(1);
      const out = [];
      let node = { children: data };
      path.forEach(pt => { node = (node.children || []).find(c => c.name === pt.name); if (node) { const dm = res.dims.find(d => d.col === node.dimKey); if (dm && dm.type !== 'date') out.push({ col: node.dimKey, op: 'in', val: [node.raw], label: `${dm.label}: ${node.name}` }); } });
      if (out.length) ctx.cross(out);
    });
  },
};

const VIZ_ORDER = ['line', 'mixed', 'bar', 'area', 'table', 'pivot', 'big_number', 'big_number_trend', 'funnel', 'bullet', 'heatmap', 'pie', 'treemap'];

/* Отрисовка графика с перехватом ошибок */
function renderChart(root, chart, opts = {}) {
  const ds = dsGet(chart.datasetId);
  const viz = VIZ[chart.viz];
  root._lastData = null;
  if (!ds) return vizMsg(root, 'Набор данных не найден. Возможно, его удалили.', true);
  if (!viz) return vizMsg(root, 'Неизвестный тип графика', true);
  const scheme = COLOR_SCHEMES[opts.scheme || chart.params.color_scheme] || COLOR_SCHEMES.kobra;
  const params = Object.assign({}, viz.defaults(ds), chart.params);
  const ctx = {
    ds, params, colors: scheme.colors,
    filters: buildChartFilters(ds, params, opts.extraFilters || []),
    setData: r => { root._lastData = r; },
    cross: opts.onCross || null, crossActive: opts.crossActive || null,
  };
  try { viz.render(root, ctx); }
  catch (e) { console.error(e); vizMsg(root, 'Ошибка построения: ' + e.message, true); }
}
function buildChartFilters(ds, params, extra) {
  const out = [];
  (params.adhoc_filters || []).forEach(f => { if (f && f.col) out.push(f); });
  if (params.time_range && params.time_range.preset && params.time_range.preset !== 'all' && ds.mainDttm) out.push({ col: ds.mainDttm, op: 'time_range', val: params.time_range });
  extra.forEach(f => { if (f && dsCol(ds, f.col)) out.push(f); });
  return out;
}

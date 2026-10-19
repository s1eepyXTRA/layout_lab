/* ============================================================
   Кобра · конструктор графика
   ============================================================ */
const TYPE_BADGE = { string: 'Т', number: '#', date: 'Д' };
const TYPE_GROUP = { string: 'Текст', date: 'Даты', number: 'Числа' };

function convertParams(oldP, newViz, ds) {
  const p = VIZ[newViz].defaults(ds);
  ['adhoc_filters', 'time_range', 'color_scheme', 'y_format', 'row_limit_keep'].forEach(k => { if (oldP[k] !== undefined) p[k] = clone(oldP[k]); });
  const ms = oldP.metrics && oldP.metrics.length ? oldP.metrics : (oldP.metric ? [oldP.metric] : null);
  if (ms) { if ('metrics' in p) p.metrics = clone(ms); if ('metric' in p) p.metric = clone(ms[0]); }
  const dimsOld = [oldP.x_col, oldP.dim, ...(oldP.groupby || []), ...(oldP.rows || [])].filter(Boolean);
  const nonDate = dimsOld.find(k => !isDateCol(ds, k));
  const anyDim = dimsOld[0];
  if ('x_col' in p && anyDim) p.x_col = newViz === 'bar' ? (nonDate || anyDim) : anyDim;
  if ('x_grain' in p && oldP.x_grain) p.x_grain = oldP.x_grain;
  if ('dim' in p && nonDate) p.dim = nonDate;
  if ('groupby' in p && dimsOld.length) p.groupby = [...new Set(dimsOld)].slice(0, newViz === 'treemap' ? 3 : 4).filter(k => newViz !== 'treemap' || !isDateCol(ds, k));
  if ('rows' in p && nonDate) p.rows = [nonDate];
  if ('series_col' in p && oldP.series_col) p.series_col = oldP.series_col;
  if ('y_col' in p && nonDate) p.y_col = nonDate;
  return p;
}

function metricChipText(ds, m) {
  if (!m) return '';
  const lbl = metricLabel(ds, m);
  return lbl;
}
function filterChipText(ds, f) {
  const c = colLabel(ds, f.col);
  switch (f.op) {
    case 'in': case 'not_in': { const v = f.val || []; return `${c} ${f.op === 'in' ? '=' : '≠'} ${v.slice(0, 3).join(', ')}${v.length > 3 ? ` и ещё ${v.length - 3}` : ''}`; }
    case 'time_range': return `${c}: ${describeTimeRange(f.val, ds, f.col).replace(/ \(.*\)$/, '')}`;
    case 'between': return `${c}: ${f.val?.[0] ?? '…'} — ${f.val?.[1] ?? '…'}`;
    case 'is_null': case 'not_null': return `${c} ${FILTER_OPS[f.op]}`;
    default: return `${c} ${FILTER_OPS[f.op]} ${f.val ?? ''}`;
  }
}

function openMetricEditor(ds, metric, onSave) {
  const m = metric ? clone(metric) : { kind: ds.metrics.length ? 'saved' : 'simple', key: (ds.metrics[0] || {}).key, agg: 'SUM', col: (ds.columns.find(c => c.type === 'number') || {}).key || '*' };
  if (m.kind === 'saved' && !m.key) m.key = (ds.metrics[0] || {}).key;
  if (m.kind === 'simple' && !m.agg) m.agg = 'SUM';
  const body = h('div');
  const paint = () => {
    clear(body);
    body.appendChild(h('div', { class: 'seg', style: { marginBottom: '16px' } },
      h('button', { class: m.kind === 'saved' ? 'on' : '', disabled: !ds.metrics.length, onclick: () => { m.kind = 'saved'; m.key = m.key || ds.metrics[0].key; paint(); } }, 'Сохранённая'),
      h('button', { class: m.kind === 'simple' ? 'on' : '', onclick: () => { m.kind = 'simple'; m.agg = m.agg || 'SUM'; m.col = m.col || (ds.columns.find(c => c.type === 'number') || {}).key || '*'; paint(); } }, 'Простая')));
    if (m.kind === 'saved') {
      body.appendChild(field('Метрика набора', selectEl(ds.metrics.map(x => [x.key, x.label]), m.key, v => { m.key = v; paint(); })));
      const s = ds.metrics.find(x => x.key === m.key);
      if (s) body.appendChild(h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '-6px' } }, 'Формула: ', exprText(ds, s.expr)));
    } else {
      const col = dsCol(ds, m.col);
      const numeric = !col || col.type === 'number';
      const aggs = Object.entries(AGGS).filter(([k]) => m.col === '*' ? k === 'COUNT' : (numeric || ['COUNT', 'COUNT_DISTINCT', 'MIN', 'MAX'].includes(k)));
      if (!aggs.some(([k]) => k === m.agg)) m.agg = aggs[0][0];
      body.appendChild(h('div', { class: 'row2' },
        field('Колонка', selectEl([['*', 'Все строки (*)'], ...ds.columns.map(c => ({ value: c.key, label: c.label || c.key, group: TYPE_GROUP[c.type] }))], m.col, v => { m.col = v; paint(); })),
        field('Агрегация', selectEl(aggs, m.agg, v => { m.agg = v; paint(); }))));
    }
    body.appendChild(field('Подпись', h('input', { class: 'input', value: m.label || '', placeholder: metricLabel(ds, Object.assign({}, m, { label: null })), oninput: e => { m.label = e.target.value || undefined; } }), 'Пусто — подпись по умолчанию'));
  };
  paint();
  openModal({
    title: metric ? 'Изменить метрику' : 'Добавить метрику', body,
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
      const out = m.kind === 'saved' ? { kind: 'saved', key: m.key } : { kind: 'simple', agg: m.agg, col: m.col };
      if (m.label && m.label.trim()) out.label = m.label.trim();
      close(); onSave(out);
    } }, 'Сохранить')],
  });
}
function exprText(ds, e) {
  const part = x => x.agg === 'COUNT' && (x.col === '*' || !x.col) ? 'COUNT(*)' : `${x.agg}(${colLabel(ds, x.col)})`;
  if (e.type !== 'ratio') return part(e);
  return `${part(e.num)} / ${part(e.den)}` + (e.mult && e.mult !== 1 ? ` × ${e.mult}` : '');
}

function openFilterEditorAdhoc(ds, filter, onSave) {
  const f = filter ? clone(filter) : { col: firstStringCol(ds), op: 'in', val: [] };
  const body = h('div');
  const opsFor = type => type === 'date' ? ['time_range', 'is_null', 'not_null'] : type === 'number' ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'is_null', 'not_null'] : ['in', 'not_in', 'eq', 'neq', 'contains', 'is_null', 'not_null'];
  const paint = () => {
    clear(body);
    const col = dsCol(ds, f.col) || ds.columns[0];
    const ops = opsFor(col.type);
    if (!ops.includes(f.op)) { f.op = ops[0]; f.val = f.op === 'time_range' ? { preset: 'last_12m' } : f.op === 'in' ? [] : ''; }
    body.appendChild(field('Колонка', selectEl(ds.columns.map(c => ({ value: c.key, label: c.label || c.key, group: TYPE_GROUP[c.type] })), f.col, v => { f.col = v; f.op = null; paint(); })));
    body.appendChild(field('Условие', selectEl(ops.map(o => [o, FILTER_OPS[o]]), f.op, v => {
      f.op = v; f.val = v === 'time_range' ? { preset: 'last_12m' } : (v === 'in' || v === 'not_in') ? [] : v === 'between' ? ['', ''] : ''; paint();
    })));
    if (f.op === 'in' || f.op === 'not_in') {
      body.appendChild(field('Значения', multiSelect({ multi: true, value: f.val || [], options: () => distinctValues(ds, f.col, []).map(x => ({ value: x.value, label: String(x.value), count: x.count })), onChange: v => { f.val = v; } })));
    } else if (f.op === 'time_range') {
      body.appendChild(timeRangeControl(ds, f.col, f.val, v => { f.val = v; }));
    } else if (f.op === 'between') {
      body.appendChild(h('div', { class: 'row2' },
        field('От', h('input', { class: 'input', type: 'number', value: f.val?.[0] ?? '', oninput: e => { f.val = [e.target.value, f.val?.[1] ?? '']; } })),
        field('До', h('input', { class: 'input', type: 'number', value: f.val?.[1] ?? '', oninput: e => { f.val = [f.val?.[0] ?? '', e.target.value]; } }))));
    } else if (f.op !== 'is_null' && f.op !== 'not_null') {
      body.appendChild(field('Значение', h('input', { class: 'input', type: col.type === 'number' ? 'number' : 'text', value: f.val ?? '', oninput: e => { f.val = e.target.value; } })));
    }
  };
  paint();
  openModal({
    title: filter ? 'Изменить фильтр' : 'Добавить фильтр', body,
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => { close(); onSave(f); } }, 'Сохранить')],
  });
}
function timeRangeControl(ds, col, val, onChange) {
  val = val || { preset: 'all' };
  const wrap = h('div');
  const paint = () => {
    clear(wrap);
    wrap.appendChild(selectEl(Object.entries(TIME_PRESETS), val.preset || 'all', v => {
      val = v === 'custom' ? { preset: 'custom', from: isoDate(truncTime(dsMaxDate(ds, col) || Date.now(), 'year')), to: isoDate(dsMaxDate(ds, col) || Date.now()) } : { preset: v };
      onChange(val); paint();
    }));
    if (val.preset === 'custom') {
      wrap.appendChild(h('div', { class: 'row2', style: { marginTop: '6px' } },
        h('input', { class: 'input', type: 'date', value: val.from || '', 'aria-label': 'С даты', onchange: e => { val = Object.assign({}, val, { from: e.target.value }); onChange(val); } }),
        h('input', { class: 'input', type: 'date', value: val.to || '', 'aria-label': 'По дату', onchange: e => { val = Object.assign({}, val, { to: e.target.value }); onChange(val); } })));
    } else if (val.preset !== 'all' && col) {
      wrap.appendChild(h('div', { class: 'hint', style: { fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' } }, describeTimeRange(val, ds, col).replace(/^.*\(|\)$/g, '')));
    }
  };
  paint();
  return wrap;
}

function renderExplore(main, parts, q) {
  let chart;
  if (parts[1] === 'new') {
    const ds0 = DS[q.ds] || Object.values(DS)[0];
    const viz = VIZ[q.viz] ? q.viz : 'bar';
    chart = { id: null, name: 'Новый график: ' + VIZ[viz].label.toLowerCase(), viz, datasetId: ds0.id, params: VIZ[viz].defaults(ds0) };
  } else {
    const c = STATE.charts[parts[1]];
    if (!c) { main.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('b', null, 'График не найден'), h('a', { class: 'btn', href: '#/charts' }, 'Ко всем графикам')))); return () => { }; }
    chart = clone(c);
  }
  const back = q.back && STATE.dashboards[q.back] ? q.back : null;
  const originalJson = JSON.stringify(chart);
  let tab = 'data';
  const wrap = h('div', { class: 'explore' });
  main.appendChild(wrap);
  const colDs = h('div', { class: 'x-col' });
  const colCtrl = h('div', { class: 'x-col' });
  const colMain = h('div', { class: 'x-main' });
  wrap.append(colDs, colCtrl, colMain);
  const ds = () => DS[chart.datasetId];

  /* ---- Колонка набора данных ---- */
  function paintDs() {
    clear(colDs);
    const d = ds();
    const box = h('div', { class: 'x-ds' });
    box.appendChild(field('Набор данных', selectEl(Object.values(DS).map(x => [x.id, x.name]), chart.datasetId, async v => {
      if (!(await confirmDialog('Сменить набор данных', 'Настройки графика будут сброшены к значениям по умолчанию для нового набора.', 'Сменить', false))) { paintDs(); return; }
      chart.datasetId = v; chart.params = VIZ[chart.viz].defaults(DS[v]); paintAll();
    })));
    if (!d) { colDs.appendChild(box); return; }
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Найти колонку или метрику', 'aria-label': 'Поиск по набору' });
    const lists = h('div');
    const paintLists = () => {
      clear(lists);
      const qq = search.value.trim().toLowerCase();
      const ms = d.metrics.filter(m => !qq || m.label.toLowerCase().includes(qq));
      const cs = d.columns.filter(c => !qq || (c.label || c.key).toLowerCase().includes(qq) || c.key.toLowerCase().includes(qq));
      lists.appendChild(h('h3', null, `Метрики · ${ms.length}`));
      ms.forEach(m => lists.appendChild(h('div', { class: 'x-item', title: exprText(d, m.expr) }, h('span', { class: 'ty m' }, 'ƒ'), h('span', null, m.label))));
      lists.appendChild(h('h3', null, `Колонки · ${cs.length}`));
      cs.forEach(c => lists.appendChild(h('div', { class: 'x-item', title: c.key }, h('span', { class: 'ty' }, TYPE_BADGE[c.type]), h('span', null, c.label || c.key))));
    };
    search.addEventListener('input', paintLists);
    paintLists();
    box.append(search, lists, h('a', { href: '#/data/' + d.id, style: { display: 'inline-block', marginTop: '14px', fontSize: '13px' } }, 'Открыть набор данных'));
    colDs.appendChild(box);
  }

  /* ---- Контролы ---- */
  function paintCtrl() {
    const st = colCtrl.scrollTop;
    clear(colCtrl);
    const d = ds(); const viz = VIZ[chart.viz];
    const box = h('div', { class: 'x-ctrl' });
    box.appendChild(h('h3', null, 'Визуализация'));
    box.appendChild(h('button', { class: 'vizbtn', onclick: pickViz }, ic(viz.icon), h('b', null, viz.label), h('small', null, 'Сменить')));
    box.appendChild(h('div', { class: 'seg', role: 'tablist' },
      h('button', { class: tab === 'data' ? 'on' : '', onclick: () => { tab = 'data'; paintCtrl(); } }, 'Данные'),
      h('button', { class: tab === 'view' ? 'on' : '', onclick: () => { tab = 'view'; paintCtrl(); } }, 'Оформление')));
    if (!d) { box.appendChild(h('p', { class: 'muted' }, 'Набор данных не найден.')); colCtrl.appendChild(box); return; }
    const p = Object.assign({}, viz.defaults(d), chart.params);
    chart.params = p;
    viz.controls.filter(s => s.tab === tab).forEach(sec => {
      const secEl = h('div', { class: 'csec' }, h('h4', null, sec.title));
      sec.controls.forEach(c => { if (c.showIf && !c.showIf(p, d)) return; const el = buildControl(c, p, d); if (el) secEl.appendChild(el); });
      box.appendChild(secEl);
    });
    colCtrl.appendChild(box);
    colCtrl.scrollTop = st;
  }
  function set(key, val, repaint = true) {
    chart.params[key] = val;
    if (repaint) paintCtrl();
    schedulePreview();
  }
  function buildControl(c, p, d) {
    const v = p[c.key] !== undefined ? p[c.key] : c.def;
    const colOpts = (types, optional) => {
      const cols = d.columns.filter(x => !types || types.includes(x.type));
      return [...(optional ? [['', '— не выбрано —']] : []), ...cols.map(x => ({ value: x.key, label: x.label || x.key, group: TYPE_GROUP[x.type] }))];
    };
    switch (c.type) {
      case 'column':
        return field(c.label, selectEl(colOpts(c.types, c.optional), v || '', val => set(c.key, val || null)), c.hint);
      case 'grain':
        return field(c.label, selectEl(Object.entries(TIME_GRAINS), v || 'month', val => set(c.key, val, false)));
      case 'metrics': case 'metric': {
        const list = c.type === 'metric' ? (v ? [v] : []) : (v || []);
        const chips = h('div', { class: 'chips' });
        list.forEach((m, i) => chips.appendChild(h('div', { class: 'chip m', role: 'button', tabindex: 0, title: 'Изменить метрику',
          onclick: () => openMetricEditor(d, m, nm => { if (c.type === 'metric') set(c.key, nm); else { const a = [...list]; a[i] = nm; set(c.key, a); } }) },
          h('span', { class: 'ct' }, metricChipText(d, m)),
          c.type === 'metrics' ? iconBtn('x', 'Убрать метрику', () => set(c.key, list.filter((_, j) => j !== i)), 'sm') : null)));
        if (c.type === 'metrics' || !list.length) chips.appendChild(h('button', { class: 'addchip', type: 'button', onclick: () => openMetricEditor(d, null, nm => set(c.key, c.type === 'metric' ? nm : [...list, nm])) }, ic('plus'), 'Добавить метрику'));
        return h('div', { class: 'field' }, h('div', { class: 'lbl' }, c.label), chips);
      }
      case 'columns': {
        const list = (v || []).filter(k => dsCol(d, k));
        const chips = h('div', { class: 'chips' });
        list.forEach((k, i) => chips.appendChild(h('div', { class: 'chip d' }, h('span', { class: 'ct' }, colLabel(d, k)),
          i > 0 ? iconBtn('up', 'Выше', () => { const a = [...list]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set(c.key, a); }, 'sm') : null,
          iconBtn('x', 'Убрать', () => set(c.key, list.filter(x => x !== k)), 'sm'))));
        if (!c.max || list.length < c.max) {
          const rest = d.columns.filter(x => !list.includes(x.key));
          const add = selectEl([['', '+ Добавить колонку'], ...rest.map(x => ({ value: x.key, label: x.label || x.key, group: TYPE_GROUP[x.type] }))], '', val => { if (val) set(c.key, [...list, val]); }, { 'aria-label': 'Добавить колонку' });
          chips.appendChild(add);
        }
        return h('div', { class: 'field' }, h('div', { class: 'lbl' }, c.label), chips);
      }
      case 'filters': {
        const list = v || [];
        const chips = h('div', { class: 'chips' });
        list.forEach((f, i) => chips.appendChild(h('div', { class: 'chip f', role: 'button', tabindex: 0, onclick: () => openFilterEditorAdhoc(d, f, nf2 => { const a = [...list]; a[i] = nf2; set(c.key, a); }) },
          h('span', { class: 'ct', title: filterChipText(d, f) }, filterChipText(d, f)), iconBtn('x', 'Убрать фильтр', () => set(c.key, list.filter((_, j) => j !== i)), 'sm'))));
        chips.appendChild(h('button', { class: 'addchip', type: 'button', onclick: () => openFilterEditorAdhoc(d, null, nf2 => set(c.key, [...list, nf2])) }, ic('plus'), 'Добавить фильтр'));
        return h('div', { class: 'field' }, h('div', { class: 'lbl' }, c.label), chips);
      }
      case 'timerange':
        if (!d.mainDttm) return null;
        return h('div', { class: 'field' }, h('div', { class: 'lbl' }, `${c.label} (${colLabel(d, d.mainDttm)})`), timeRangeControl(d, d.mainDttm, v, val => set(c.key, val, false)));
      case 'select':
        return field(c.label, selectEl(c.options, v ?? c.options[0][0], val => set(c.key, val)), c.hint);
      case 'segment':
        return h('div', { class: 'field' }, h('div', { class: 'lbl' }, c.label), h('div', { class: 'seg' }, c.options.map(([k, l]) => h('button', { class: (v || c.options[0][0]) === k ? 'on' : '', onclick: () => set(c.key, k) }, l))));
      case 'check':
        return checkbox(c.label, v ?? c.def ?? false, val => set(c.key, val));
      case 'number': {
        const inp = h('input', { class: 'input', type: 'number', min: c.min, max: c.max, value: v ?? c.def ?? '' });
        inp.addEventListener('change', () => { let n = inp.value === '' ? c.def : +inp.value; if (c.min != null) n = Math.max(c.min, n); if (c.max != null) n = Math.min(c.max, n); set(c.key, n, false); });
        return field(c.label, inp, c.hint);
      }
      case 'text': {
        const inp = h('input', { class: 'input', value: v ?? '' });
        inp.addEventListener('input', debounce(() => set(c.key, inp.value, false), 400));
        return field(c.label, inp, c.hint);
      }
      case 'format':
        return field(c.label, selectEl(
          fmtSuffix(v) !== null ? [[v, formatLabel(v)], ...Object.entries(NUMBER_FORMATS)] : Object.entries(NUMBER_FORMATS),
          v || 'auto', val => set(c.key, val, false)));
      case 'scheme':
        return field(c.label, selectEl(Object.entries(COLOR_SCHEMES).map(([k, s]) => [k, s.label]), v || 'kobra', val => set(c.key, val, false)));
      case 'seqscheme':
        return field(c.label, selectEl(Object.entries(SEQ_SCHEMES).map(([k, s]) => [k, s.label]), v || 'jade', val => set(c.key, val, false)));
    }
    return null;
  }
  function pickViz() {
    const gal = h('div', { class: 'viz-gallery' });
    let md;
    VIZ_ORDER.forEach(k => gal.appendChild(h('button', { class: 'viz-opt' + (k === chart.viz ? ' on' : ''), onclick: () => {
      md.close();
      if (k === chart.viz) return;
      chart.params = convertParams(chart.params, k, ds());
      if (chart.name.startsWith('Новый график')) chart.name = 'Новый график: ' + VIZ[k].label.toLowerCase();
      chart.viz = k;
      paintAll();
    } }, ic(VIZ[k].icon), h('b', null, VIZ[k].label), h('span', null, VIZ[k].desc))));
    md = openModal({ title: 'Тип визуализации', wide: true, body: gal });
  }

  /* ---- Превью ---- */
  let previewRoot = null, resultsBody = null, showResults = false, previewRO = null;
  function paintMain() {
    clear(colMain);
    previewRO && previewRO.disconnect();
    const name = h('input', { class: 'name', value: chart.name, 'aria-label': 'Название графика',
      oninput: e => { chart.name = e.target.value; chart.autoName = false; } });
    const headBtns = [];
    if (back) headBtns.push(h('button', { class: 'btn ghost', onclick: () => leave('#/d/' + back) }, ic('back'), 'К дашборду'));
    const nSpec = specFilledCount(chart);
    headBtns.push(h('button', { class: 'btn', title: 'Бизнес-вопрос, источник данных, периодичность — попадут в выгрузку ТЗ', onclick: () => openSpecEditor(chart, spec => {
      if (spec) chart.spec = spec; else delete chart.spec;
      paintMain(); drawPreview();
    }) }, ic('text'), 'ТЗ', nSpec ? h('span', { class: 'pill pri', style: { marginLeft: '2px' } }, nSpec + '/' + SPEC_FIELDS.length) : null));
    headBtns.push(h('button', { class: 'btn primary', onclick: openSave }, ic('check'), 'Сохранить'));
    colMain.appendChild(h('div', { class: 'x-head' }, name, ...headBtns));
    previewRoot = h('div', { class: 'viz-root' });
    const body = h('div', { class: 'card-body' }, previewRoot);
    const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', { class: 't' }, 'Предпросмотр'),
      iconBtn('refresh', 'Перестроить', () => drawPreview()), iconBtn('table', showResults ? 'Скрыть данные' : 'Показать данные запроса', () => { showResults = !showResults; paintMain(); drawPreview(); })), body);
    const prev = h('div', { class: 'x-preview' }, card);
    if (showResults) {
      resultsBody = h('div', { class: 'rb' });
      prev.appendChild(h('div', { class: 'x-results' }, h('div', { class: 'rh' }, ic('table'), 'Результат запроса', h('span', { class: 'muted', style: { fontWeight: 400 } }, '')), resultsBody));
    } else resultsBody = null;
    colMain.appendChild(prev);
    previewRO = new ResizeObserver(debounce(() => { previewRoot && previewRoot._ec && previewRoot._ec.resize(); }, 60));
    previewRO.observe(body);
  }
  function drawPreview() {
    if (!previewRoot) return;
    const t0 = performance.now();
    renderChart(previewRoot, chart, {});
    const ms = Math.round(performance.now() - t0);
    if (resultsBody) {
      clear(resultsBody);
      const data = previewRoot._lastData;
      const hdr = resultsBody.parentNode.querySelector('.rh .muted');
      if (data && data.rows) {
        if (hdr) hdr.textContent = `· ${fmtNum(data.rows.length, 'int')} ${plural(data.rows.length, 'строка', 'строки', 'строк')} · ${ms} мс`;
        const cols = [...(data.dims || []).map(d => ({ key: d.key, label: d.label, dim: d })), ...(data.mets || []).map(m => ({ key: m.key, label: m.label, fmt: m.format }))];
        resultsBody.appendChild(h('div', { class: 'prev-tbl', style: { border: 0, maxHeight: 'none' } }, h('table', null,
          h('thead', null, h('tr', null, cols.map(c => h('th', null, c.label)))),
          h('tbody', null, data.rows.slice(0, 300).map(r => h('tr', null, cols.map(c => h('td', null, c.dim ? fmtDimValue(r[c.key], c.dim) : fmtNum(r[c.key], c.fmt)))))))));
      } else if (hdr) hdr.textContent = '';
    }
  }
  const schedulePreview = debounce(drawPreview, 220);

  /* ---- Сохранение ---- */
  function openSave() {
    let name = chart.name.trim() || 'Без названия';
    let mode = chart.id ? 'overwrite' : 'new';
    let dashId = back || '';
    const dashes = Object.values(STATE.dashboards);
    const body = h('div');
    const paint = () => {
      clear(body);
      if (chart.id) body.appendChild(h('div', { class: 'field' }, h('div', { class: 'seg', style: { alignSelf: 'flex-start' } },
        h('button', { class: mode === 'overwrite' ? 'on' : '', onclick: () => { mode = 'overwrite'; paint(); } }, 'Сохранить изменения'),
        h('button', { class: mode === 'new' ? 'on' : '', onclick: () => { mode = 'new'; paint(); } }, 'Сохранить как новый'))));
      body.appendChild(field('Название графика', h('input', { class: 'input', value: name, oninput: e => { name = e.target.value; } })));
      const already = chart.id && mode === 'overwrite' ? chartUsage(chart.id).map(d => d.id) : [];
      body.appendChild(field('Добавить на дашборд', selectEl([['', '— не добавлять —'], ...dashes.map(d => [d.id, d.title + (already.includes(d.id) ? ' (уже есть)' : '')]), ['__new', '+ Новый дашборд']], dashId, v => { dashId = v; }),
        'График появится внизу открытой вкладки выбранного дашборда.'));
    };
    paint();
    openModal({
      title: 'Сохранить график', body,
      foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => { close(); doSave(name.trim() || 'Без названия', mode, dashId); } }, 'Сохранить')],
    });
  }
  function doSave(name, mode, dashId) {
    chart.name = name;
    if (mode === 'new' || !chart.id) chart.id = uid('c_');
    chart.updated = Date.now();
    STATE.charts[chart.id] = clone(chart);
    let target = null;
    if (dashId === '__new') {
      const nid = uid('d_');
      STATE.dashboards[nid] = { id: nid, title: 'Новый дашборд', updated: Date.now(), crossFilter: true, scheme: null, tabs: [{ id: uid('t'), title: 'Вкладка 1', items: [] }], filters: [] };
      target = STATE.dashboards[nid];
    } else if (dashId) target = STATE.dashboards[dashId];
    if (target && !target.tabs.some(t => t.items.some(i => i.chartId === chart.id))) {
      const tab = target.tabs.find(t => t.id === tabMemory[target.id]) || target.tabs[0];
      const sz = itemDefaultSize('chart', chart);
      const bottom = tab.items.reduce((m, x) => Math.max(m, x.y + x.h), 0);
      tab.items.push({ i: uid('i'), type: 'chart', chartId: chart.id, x: 0, y: bottom, w: sz.w, h: sz.h });
      target.updated = Date.now();
    }
    saveState();
    savedJson = JSON.stringify(chart);
    toast(target ? `График сохранён и добавлен на «${target.title}»` : 'График сохранён');
    if (target) go('#/d/' + target.id + (target.id === back && q.edit ? '?edit=1' : ''));
    else if (parts[1] !== chart.id) { try { history.replaceState(null, '', '#/explore/' + chart.id + (back ? '?back=' + back : '')); } catch (e) { } parts[1] = chart.id; paintMain(); drawPreview(); }
  }
  let savedJson = originalJson;
  async function leave(hash) {
    if (JSON.stringify(chart) !== savedJson && !(await confirmDialog('Уйти без сохранения', 'Изменения графика не сохранены и пропадут.', 'Уйти'))) return;
    savedJson = JSON.stringify(chart);
    go(hash);
  }

  function paintAll() { paintDs(); paintCtrl(); paintMain(); requestAnimationFrame(drawPreview); }
  paintAll();
  savedJson = JSON.stringify(chart);
  return () => { previewRO && previewRO.disconnect(); previewRoot && disposeViz(previewRoot); };
}

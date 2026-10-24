/* ============================================================
   Кобра · ТЗ графика и выгрузка спецификации в Markdown
   Согласованный макет уже содержит все определения структурно:
   формулы метрик, разрезы с гранулярностью, фильтры, лимиты.
   Движок умеет печатать их по-русски (exprText, metricLabel,
   colLabel, describeTimeRange), поэтому спецификация собирается
   из того же, что человек видит в интерфейсе, и расходиться с
   дашбордом ей негде. Руками остаётся дописать только то, чего в
   параметрах нет: зачем график, откуда данные, как часто обновлять.
   ============================================================ */
const SPEC_PRIORITIES = { high: 'Высокий', mid: 'Средний', low: 'Низкий' };
const SPEC_FIELDS = [
  { key: 'question', label: 'Бизнес-вопрос', area: true, placeholder: 'Например: как меняется выручка по месяцам и где просадка',
    hint: 'На какой вопрос отвечает график. Главное поле: по нему аналитик поймёт, что считать.' },
  { key: 'source', label: 'Источник данных', placeholder: 'Например: витрина dm_sales в ClickHouse',
    hint: 'Откуда берутся строки в настоящей системе.' },
  { key: 'refresh', label: 'Периодичность обновления', placeholder: 'Например: раз в сутки к 8:00' },
  { key: 'priority', label: 'Приоритет', select: true },
  { key: 'comment', label: 'Комментарий', area: true, placeholder: 'Оговорки, спорные места, что ещё уточнить' },
];
const LS_SPEC_AUTHOR = 'kobra.author'; // тот же автор, что и в экспорте файлов

function specPriorityLabel(v) { return SPEC_PRIORITIES[v] || v || ''; }
function specValue(chart, key) {
  const v = ((chart || {}).spec || {})[key];
  return v == null ? '' : String(v).trim();
}
function specFilledCount(chart) { return SPEC_FIELDS.filter(f => specValue(chart, f.key)).length; }
/* Пустые поля не храним: иначе у каждого графика появится бесполезный spec */
function normalizeSpec(spec) {
  const out = {};
  SPEC_FIELDS.forEach(f => { const v = spec && spec[f.key] != null ? String(spec[f.key]).trim() : ''; if (v) out[f.key] = v; });
  return Object.keys(out).length ? out : null;
}

/* ---------- Редактор полей ТЗ ---------- */
function openSpecEditor(chart, onSave) {
  const draft = Object.assign({}, chart.spec || {});
  const body = h('div');
  body.appendChild(h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 14px' } },
    'Поля ТЗ на расчёты не влияют: они нужны, чтобы согласованный макет стал заданием. Попадают в «Выгрузить ТЗ в Markdown» и в файл .kobra.json.'));
  SPEC_FIELDS.forEach(f => {
    if (f.select) {
      body.appendChild(field(f.label, selectEl([['', '— не задан —'], ...Object.entries(SPEC_PRIORITIES)], draft[f.key] || '', v => { draft[f.key] = v; }), f.hint));
      return;
    }
    const el = f.area
      ? h('textarea', { class: 'textarea', rows: 3, placeholder: f.placeholder || '' })
      : h('input', { class: 'input', placeholder: f.placeholder || '' });
    el.value = draft[f.key] || '';
    const take = () => { draft[f.key] = el.value; };
    el.addEventListener('input', take);
    el.addEventListener('change', take); // вставка и автозаполнение не всегда дают input
    body.appendChild(field(f.label, el, f.hint));
  });
  openModal({
    title: 'ТЗ графика', wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => { close(); onSave(normalizeSpec(draft)); } }, ic('check'), 'Сохранить'),
    ],
  });
}

/* ---------- Печать значений ---------- */
function mdEsc(s) { return String(s == null ? '' : s).replace(/\r?\n+/g, ' ').replace(/([*_`\[\]|])/g, '\\$1').trim(); }
function mdCell(s) { return mdEsc(s) || '—'; }

function specMetricText(ds, m) {
  if (!m) return '—';
  const label = metricLabel(ds, m);
  let formula;
  if (m.kind === 'saved') {
    const s = ds && ds.metrics.find(x => x.key === m.key);
    formula = s ? exprText(ds, s.expr) : `метрика «${m.key}» в наборе не найдена`;
  } else formula = exprText(ds, { type: 'simple', agg: m.agg, col: m.col });
  const fmt = formatLabel(metricFormat(ds, m));
  return `**${mdEsc(label)}** — \`${formula}\`` + (fmt ? `, формат: ${fmt}` : '');
}
function specFilterText(ds, f) {
  const c = colLabel(ds, f.col);
  switch (f.op) {
    case 'time_range': return `${c}: ${describeTimeRange(f.val, ds, f.col)}`;
    case 'in': case 'not_in': {
      const v = (f.val || []).map(x => String(x));
      return `${c} ${FILTER_OPS[f.op]}: ${v.length ? v.join(', ') : '(значения не выбраны)'}`;
    }
    case 'between': return `${c}: от ${f.val && f.val[0] !== '' && f.val[0] != null ? f.val[0] : '…'} до ${f.val && f.val[1] !== '' && f.val[1] != null ? f.val[1] : '…'}`;
    case 'is_null': case 'not_null': return `${c} — ${FILTER_OPS[f.op]}`;
    default: return `${c} ${FILTER_OPS[f.op]} ${f.val == null ? '' : f.val}`;
  }
}
function specColumnsText(ds, keys) {
  const list = (keys || []).filter(Boolean);
  return list.length ? list.map(k => mdEsc(colLabel(ds, k))).join(', ') : '';
}
function optionLabel(c, v) {
  const hit = (c.options || []).find(o => String(Array.isArray(o) ? o[0] : o.value) === String(v));
  return hit ? (Array.isArray(hit) ? hit[1] : hit.label) : (v == null ? '' : String(v));
}

/* Одна строка спецификации на контрол: берём декларативную схему
   VIZ[type].controls, поэтому новый тип графика печатается сам. */
function specControlLine(c, p, ds, showFalse) {
  const v = p[c.key] !== undefined ? p[c.key] : c.def;
  const L = mdEsc(c.label);
  switch (c.type) {
    case 'metric': return v ? `${L}: ${specMetricText(ds, v)}` : null;
    case 'metrics': {
      const list = (v || []).filter(Boolean);
      return list.length ? `${L}: ${list.map(m => specMetricText(ds, m)).join('; ')}` : null;
    }
    case 'column': return v ? `${L}: ${mdEsc(colLabel(ds, v))}` : null;
    case 'columns': { const t = specColumnsText(ds, v); return t ? `${L}: ${t}` : null; }
    case 'grain': return `${L}: ${TIME_GRAINS[v] || v || '—'}`;
    case 'timerange': {
      if (!ds || !ds.mainDttm) return null;
      return `${L} (${mdEsc(colLabel(ds, ds.mainDttm))}): ${describeTimeRange(v, ds, ds.mainDttm)}`;
    }
    case 'filters': {
      const list = (v || []).filter(f => f && f.col);
      return list.length ? `${L}: ${list.map(f => specFilterText(ds, f)).join('; ')}` : null;
    }
    case 'select': case 'segment': {
      const lbl = optionLabel(c, v != null && v !== '' ? v : (c.options && c.options[0] ? (Array.isArray(c.options[0]) ? c.options[0][0] : c.options[0].value) : ''));
      return lbl ? `${L}: ${mdEsc(lbl)}` : null;
    }
    // «Нет» печатаем только там, где это отличие от обычного поведения графика
    case 'check': return v ? `${L}: да` : (showFalse ? `${L}: нет` : null);
    case 'number': {
      if (v == null || v === '') return null;
      if (+v === 0 && +c.def === 0) return null; // 0 здесь значит «выключено»
      return `${L}: ${fmtNum(+v, 'int')}`;
    }
    case 'text': return v ? `${L}: ${mdEsc(v)}` : null;
    case 'format': return v && v !== 'auto' ? `${L}: ${formatLabel(v)}` : null;
    case 'scheme': return v && COLOR_SCHEMES[v] ? `${L}: ${COLOR_SCHEMES[v].label}` : null;
    case 'seqscheme': return v && SEQ_SCHEMES[v] ? `${L}: ${SEQ_SCHEMES[v].label}` : null;
  }
  return null;
}

/* ---------- Блок одного графика ---------- */
function specChartBlock(chart, num) {
  const out = [];
  const viz = VIZ[chart.viz];
  const ds = DS[chart.datasetId];
  out.push(`### ${num}. ${mdEsc(chart.name)}`, '');
  out.push(`**Тип визуализации:** ${viz ? mdEsc(viz.label) : mdEsc(chart.viz)} · **Набор данных:** `
    + (ds ? mdEsc(ds.name) + (isSchemaDs(ds) ? ' (схема, данные вымышленные)' : '') : `не найден (${mdEsc(chart.datasetId)})`), '');
  if (specFilledCount(chart)) {
    out.push('**ТЗ**', '');
    SPEC_FIELDS.forEach(f => {
      const v = specValue(chart, f.key);
      if (!v) return;
      out.push(`- ${f.label}: ${f.key === 'priority' ? mdEsc(specPriorityLabel(v)) : mdEsc(v)}`);
    });
    out.push('');
  } else out.push('**ТЗ:** _не заполнено_', '');
  if (!viz) { out.push('_Неизвестный тип визуализации, параметры показать не удалось._', ''); return out; }

  const def = ds ? viz.defaults(ds) : {};
  const p = Object.assign({}, def, chart.params);
  const groups = [];
  viz.controls.forEach(sec => {
    if (sec.tab !== 'data') return;
    const items = [];
    sec.controls.forEach(c => {
      if (c.showIf && !c.showIf(p, ds)) return;
      const line = specControlLine(c, p, ds);
      if (line) items.push(line);
    });
    if (items.length) groups.push({ title: sec.title, items });
  });
  out.push('**Запрос**', '');
  if (groups.length === 1) groups[0].items.forEach(i => out.push('- ' + i));
  else groups.forEach(g => { out.push(`- **${mdEsc(g.title)}**`); g.items.forEach(i => out.push('  - ' + i)); });
  out.push('');
  /* Из оформления в ТЗ попадает только то, что человек менял руками:
     перечислять настройки по умолчанию незачем, а формат чисел,
     горизонтальные столбцы или накопление серий — это уже требование. */
  const look = [];
  viz.controls.forEach(sec => {
    if (sec.tab !== 'view') return;
    sec.controls.forEach(c => {
      if (c.showIf && !c.showIf(p, ds)) return;
      const d = def[c.key] !== undefined ? def[c.key] : c.def;
      const v = p[c.key] !== undefined ? p[c.key] : c.def;
      const same = c.type === 'check' ? !!v === !!d : JSON.stringify(v ?? null) === JSON.stringify(d ?? null);
      if (same) return;
      const line = specControlLine(c, p, ds, true);
      if (line) look.push(line);
    });
  });
  if (look.length) { out.push('**Оформление**', ''); look.forEach(i => out.push('- ' + i)); out.push(''); }
  return out;
}

/* ---------- Нативные фильтры дашборда ---------- */
const SPEC_FILTER_TYPES = { time: 'Период', select: 'Выбор значений', range: 'Диапазон чисел' };
function specFilterRow(D, f) {
  const ds = dsGet(f.datasetId);
  const def = f.def !== undefined ? f.def : f.value;
  let defText;
  if (f.type === 'time') defText = describeTimeRange(def, ds, f.col);
  else if (f.type === 'range') defText = Array.isArray(def) && (def[0] !== '' && def[0] != null || def[1] !== '' && def[1] != null) ? `от ${def[0] === '' || def[0] == null ? '…' : def[0]} до ${def[1] === '' || def[1] == null ? '…' : def[1]}` : 'не задано';
  else defText = Array.isArray(def) && def.length ? def.map(String).join(', ') : 'все значения';
  let scope = 'Все графики';
  if (Array.isArray(f.scope)) {
    const names = f.scope.map(cid => (STATE.charts[cid] || {}).name).filter(Boolean);
    scope = names.length ? names.map(mdEsc).join(', ') : 'ни один график';
  }
  const notes = [];
  if (f.type === 'select') notes.push(f.multi === false ? 'одно значение' : 'несколько значений');
  if (f.dependent) notes.push('значения зависят от остальных фильтров');
  return `| ${mdCell(f.name)} | ${SPEC_FILTER_TYPES[f.type] || mdCell(f.type)} | ${ds ? mdCell(ds.name) : 'набор не найден'} | `
    + `${mdCell(ds ? colLabel(ds, f.col) : f.col)} | ${mdCell(defText)} | ${mdCell(scope)} | ${notes.length ? mdEsc(notes.join(', ')) : '—'} |`;
}

/* ---------- Сборка документа ---------- */
function dashSpecDatasets(D) {
  const ids = new Set();
  D.tabs.forEach(t => t.items.forEach(i => { if (i.chartId && STATE.charts[i.chartId]) ids.add(STATE.charts[i.chartId].datasetId); }));
  (D.filters || []).forEach(f => { if (f.datasetId) ids.add(f.datasetId); });
  return [...ids];
}
/* dash — дашборд или его идентификатор: в режиме правки печатаем черновик,
   чтобы ТЗ совпадало с тем, что человек видит на экране. */
function buildSpecMd(dash, opts = {}) {
  const D = typeof dash === 'string' ? STATE.dashboards[dash] : dash;
  if (!D) throw new Error('Шаблон не найден');
  const L = [];
  const dsIds = dashSpecDatasets(D);
  const nCharts = D.tabs.reduce((a, t) => a + t.items.filter(i => i.type === 'chart').length, 0);
  const fake = dsIds.map(x => DS[x]).filter(isSchemaDs);

  L.push(`# ТЗ дашборда «${mdEsc(D.title)}»`, '');
  const head = [`Собрано в Кобре ${fmtDate(Date.now(), 'day')}`];
  if (opts.author) head.push(`автор — ${mdEsc(opts.author)}`);
  L.push(head.join(', ') + '.', '');
  if (opts.note) L.push('> ' + mdEsc(opts.note), '');
  if (fake.length) {
    L.push(`> **Это макет, данные вымышленные.** ${plural(fake.length, 'Набор', 'Наборы', 'Наборы')} `
      + fake.map(d => '«' + mdEsc(d.name) + '»').join(', ')
      + ` ${plural(fake.length, 'создан', 'созданы', 'созданы')} по описанию колонок, цифры на графиках придуманы и для отчётности не годятся.`, '');
  }
  L.push(`- Вкладок: ${D.tabs.length}, графиков: ${nCharts}, фильтров дашборда: ${(D.filters || []).length}`);
  L.push(`- Наборы данных: ${dsIds.map(x => DS[x] ? mdEsc(DS[x].name) : `не найден (${mdEsc(x)})`).join(', ') || '—'}`);
  L.push(`- Кросс-фильтрация (клик по графику фильтрует остальные): ${D.crossFilter ? 'включена' : 'выключена'}`);
  if (D.scheme && COLOR_SCHEMES[D.scheme]) L.push(`- Цветовая схема дашборда: ${COLOR_SCHEMES[D.scheme].label}`);
  L.push('', 'Метрики записаны так, как их считает Кобра: `АГРЕГАЦИЯ(Колонка)`, отношения — `числитель / знаменатель`. '
    + 'Отношения считаются на уровне группировки графика, а не делением готовых итогов. '
    + 'Относительные периоды («последние 12 месяцев») отсчитываются от последней даты в данных.', '');

  // Бриф — это и есть «зачем» дашборда, аналитику он нужнее состава блоков
  const brief = aiBriefLines(aiBrief(D));
  if (brief.length) {
    L.push('## Зачем этот дашборд', '');
    brief.forEach(line => L.push('- ' + mdEsc(line)));
    L.push('');
  }

  if ((D.filters || []).length) {
    L.push('## Фильтры дашборда', '');
    L.push('| Фильтр | Тип | Набор данных | Колонка | Значение по умолчанию | Область действия | Примечание |');
    L.push('|---|---|---|---|---|---|---|');
    D.filters.forEach(f => L.push(specFilterRow(D, f)));
    L.push('');
  }

  const noQuestion = [];
  D.tabs.forEach((t, ti) => {
    L.push(`## Вкладка ${ti + 1}. «${mdEsc(t.title)}»`, '');
    const items = [...t.items].sort((a, b) => a.y - b.y || a.x - b.x);
    if (!items.length) L.push('_Вкладка пустая._', '');
    let n = 0;
    items.forEach(it => {
      if (it.type === 'chart') {
        const chart = STATE.charts[it.chartId];
        n++;
        if (!chart) { L.push(`### ${ti + 1}.${n}. График не найден (${mdEsc(it.chartId)})`, ''); return; }
        if (!specValue(chart, 'question')) noQuestion.push(chart.name);
        specChartBlock(chart, `${ti + 1}.${n}`).forEach(x => L.push(x));
      } else if (it.type === 'header') {
        L.push(`### ${mdEsc(it.text || '')}`, '');
      } else if (it.type === 'markdown') {
        L.push('> ' + String(it.text || '').replace(/\r?\n/g, '\n> '), '');
      }
    });
  });

  if (noQuestion.length) {
    L.push('## Что осталось заполнить', '');
    L.push(`Без бизнес-вопроса ${noQuestion.length} ${plural(noQuestion.length, 'график', 'графика', 'графиков')}:`, '');
    noQuestion.forEach(nm => L.push(`- [ ] ${mdEsc(nm)}`));
    L.push('');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function specFileName(D) {
  return `kobra-tz-${slugKey(D.title, 0, new Set())}-${isoDate(Date.now())}.md`;
}

/* ---------- Диалог выгрузки ---------- */
function openSpecDialog(dash) {
  const D = typeof dash === 'string' ? STATE.dashboards[dash] : dash;
  if (!D) { toast('Шаблон не найден', true); return; }
  let author = lsGet(LS_SPEC_AUTHOR) || '';
  let note = '';
  const nCharts = D.tabs.reduce((a, t) => a + t.items.filter(i => i.type === 'chart').length, 0);
  const charts = D.tabs.flatMap(t => t.items.map(i => STATE.charts[i.chartId]).filter(Boolean));
  const filled = charts.filter(c => specValue(c, 'question')).length;
  const body = h('div');
  body.appendChild(h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 14px' } },
    'Кобра соберёт из шаблона готовое задание: по каждому графику — тип, набор данных, метрики с формулами, разрезы, фильтры и лимиты, плюс поля ТЗ. '
    + 'Цифры и подписи в файле те же, что на экране.'));
  body.appendChild(h('div', { class: 'row2' },
    field('Автор', h('input', { class: 'input', value: author, placeholder: 'Кто составил ТЗ', oninput: e => { author = e.target.value; } })),
    field('Комментарий', h('input', { class: 'input', value: note, placeholder: 'Например: на согласование с дирекцией', oninput: e => { note = e.target.value; } }))));
  body.appendChild(h('p', { class: 'muted', style: { fontSize: '12.5px', margin: 0 } },
    `В файле: ${D.tabs.length} ${plural(D.tabs.length, 'вкладка', 'вкладки', 'вкладок')}, ${nCharts} ${plural(nCharts, 'график', 'графика', 'графиков')}, `
    + `${(D.filters || []).length} ${plural((D.filters || []).length, 'фильтр', 'фильтра', 'фильтров')} шаблона. `
    + (nCharts ? `Бизнес-вопрос заполнен у ${filled} из ${nCharts}.` : '')));

  const make = () => buildSpecMd(D, { author: author.trim(), note: note.trim() });
  openModal({
    title: 'Выгрузить ТЗ в Markdown', wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn', onclick: async () => {
        try {
          await navigator.clipboard.writeText(make());
          toast('ТЗ скопировано в буфер обмена');
        } catch (e) { toast('Браузер не дал доступ к буферу обмена, скачайте файл', true); }
      } }, ic('copy'), 'Скопировать'),
      h('button', { class: 'btn primary', onclick: () => {
        try {
          const md = make();
          if (author.trim()) lsSet(LS_SPEC_AUTHOR, author.trim());
          if (downloadFile(specFileName(D), md, 'text/markdown')) { close(); toast('ТЗ сохранено в файл'); }
        } catch (e) { console.error(e); toast('Не удалось собрать ТЗ: ' + e.message, true); }
      } }, ic('download'), 'Скачать .md'),
    ],
  });
}

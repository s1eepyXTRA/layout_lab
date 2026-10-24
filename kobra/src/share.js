/* ============================================================
   Кобра · обмен файлами
   Прототип живёт в одном браузере, поэтому шаблон, дашборд и данные
   передаются файлом .kobra.json: «шаблон» — только структура,
   «проект» — вместе со строками данных.
   ============================================================ */
const KOBRA_FILE_V = 1;
const LS_AUTHOR = 'kobra.author';

/* ---------- Сборка файла ---------- */
function collectRefs(dashIds, includeLoose) {
  const dashboards = {}, charts = {}, dsIds = new Set();
  dashIds.forEach(id => {
    const d = STATE.dashboards[id];
    if (!d) return;
    dashboards[id] = clone(d);
    delete dashboards[id].chat;          // переписка с AI-ассистентом — личное, в файл не уходит
    delete dashboards[id].chatTrimmed;
    d.tabs.forEach(t => t.items.forEach(i => { if (i.chartId && STATE.charts[i.chartId]) charts[i.chartId] = clone(STATE.charts[i.chartId]); }));
    (d.filters || []).forEach(f => { if (f.datasetId) dsIds.add(f.datasetId); });
  });
  if (includeLoose) {
    const used = new Set();
    Object.values(STATE.dashboards).forEach(d => d.tabs.forEach(t => t.items.forEach(i => i.chartId && used.add(i.chartId))));
    Object.values(STATE.charts).forEach(c => { if (!used.has(c.id)) charts[c.id] = clone(c); });
  }
  Object.values(charts).forEach(c => dsIds.add(c.datasetId));
  return { dashboards, charts, dsIds: [...dsIds] };
}

/* Схема по колонкам готового набора: типы берём настоящие, значения и
   диапазоны придумываем по названиям — из реальных данных не подглядываем. */
function schemaFromColumns(columns, rowCount) {
  return Object.assign({ seed: 7, rowCount: rowCount || SCHEMA_ROWS_DEF, columns: columns.map(c => {
    const g = guessSchemaCol(c.label || c.key);
    const col = { key: c.key, label: c.label || c.key, type: c.type };
    if (c.type === 'number') { col.min = g.min != null ? g.min : 1; col.max = g.max != null ? g.max : 1000; col.decimals = g.decimals || 0; }
    if (c.type === 'string') { col.values = g.values || null; if (g.ids) col.ids = true; }
    return col;
  }) }, defaultSchemaPeriod());
}

function datasetForExport(d, withData, fakeData) {
  if (d.builtin) return { id: d.id, name: d.name, builtin: true };
  if (isSchemaDs(d)) return { id: d.id, name: d.name, kind: 'schema', schema: d.schema, columns: clone(d.columns), metrics: clone(d.metrics), mainDttm: d.mainDttm, description: d.description || '' };
  const base = { id: d.id, name: d.name, kind: 'upload', fileName: d.fileName || '', columns: clone(d.columns), metrics: clone(d.metrics), mainDttm: d.mainDttm, description: d.description || '' };
  if (withData) return Object.assign(base, { rows: d.rows });
  if (fakeData) return Object.assign(base, { kind: 'schema', fromUpload: true, schema: schemaFromColumns(d.columns, Math.min(d.rows.length || SCHEMA_ROWS_DEF, SCHEMA_ROWS_MAX)), description: SCHEMA_NOTE });
  return Object.assign(base, { noRows: true });
}

function buildExport({ dashIds, includeLoose, withData, fakeData, author, note }) {
  const { dashboards, charts, dsIds } = collectRefs(dashIds, includeLoose);
  const datasets = [], dsMetrics = {};
  dsIds.forEach(id => {
    const d = DS[id];
    if (!d) return;
    datasets.push(datasetForExport(d, withData, fakeData));
    if (d.builtin && (STATE.dsMetrics[id] || []).length) dsMetrics[id] = clone(STATE.dsMetrics[id]);
  });
  return {
    kobra: KOBRA_FILE_V, app: 'Кобра', kind: withData ? 'project' : 'template',
    exportedAt: new Date().toISOString(), author: author || '', note: note || '',
    dashboards, charts, datasets, dsMetrics,
  };
}

function exportFileName(dashIds, withData) {
  const first = dashIds.length === 1 ? STATE.dashboards[dashIds[0]] : null;
  const slug = first ? slugKey(first.title, 0, new Set()) : (withData ? 'proekt' : 'shablon');
  return `kobra-${slug}-${isoDate(Date.now())}.kobra.json`;
}

/* ---------- Диалог экспорта ---------- */
function openExportDialog(presetDashId) {
  const all = Object.values(STATE.dashboards).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const picked = new Set(presetDashId && STATE.dashboards[presetDashId] ? [presetDashId] : all.map(d => d.id));
  let withData = false, fakeData = true, includeLoose = false;
  let author = lsGet(LS_AUTHOR) || '';
  let note = '';
  const body = h('div');
  const size = h('div', { class: 'muted', style: { fontSize: '12.5px' } });

  const recount = () => {
    if (!picked.size && !includeLoose) { size.textContent = 'Не выбрано ни одного шаблона.'; return; }
    try {
      const json = JSON.stringify(buildExport({ dashIds: [...picked], includeLoose, withData, fakeData, author, note }));
      const kb = new Blob([json]).size / 1024;
      const { charts, dsIds } = collectRefs([...picked], includeLoose);
      size.textContent = `В файле: ${picked.size} ${plural(picked.size, 'шаблон', 'шаблона', 'шаблонов')}, `
        + `${Object.keys(charts).length} ${plural(Object.keys(charts).length, 'график', 'графика', 'графиков')}, `
        + `${dsIds.length} ${plural(dsIds.length, 'набор', 'набора', 'наборов')} данных. Размер — `
        + (kb > 1024 ? (kb / 1024).toFixed(1) + ' МБ' : Math.max(1, Math.round(kb)) + ' КБ') + '.';
    } catch (e) { size.textContent = 'Не удалось оценить размер: ' + e.message; }
  };

  const paint = () => {
    clear(body);
    body.appendChild(h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Что вкладываем'),
      h('div', { class: 'seg' },
        h('button', { class: withData ? '' : 'on', onclick: () => { withData = false; paint(); } }, 'Без данных — только структура'),
        h('button', { class: withData ? 'on' : '', onclick: () => { withData = true; paint(); } }, 'Со строками данных')),
      h('div', { class: 'hint' }, withData
        ? 'Строки загруженных наборов попадут в файл. Не отправляйте его по открытым каналам, если данные чувствительные.'
        : 'Только структура: шаблоны, графики, метрики и описания наборов. Строки загруженных файлов не вкладываются.')));
    if (!withData) body.appendChild(checkbox('Подставить вымышленные данные, чтобы графики не были пустыми', fakeData, v => { fakeData = v; recount(); }));

    const list = h('div', { style: { display: 'grid', gap: '4px', marginTop: '4px' } });
    all.forEach(d => list.appendChild(checkbox(d.title, picked.has(d.id), v => { v ? picked.add(d.id) : picked.delete(d.id); recount(); })));
    body.appendChild(h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Шаблоны'),
      all.length ? list : h('p', { class: 'muted', style: { fontSize: '13px', margin: 0 } }, 'Шаблонов пока нет.')));
    body.appendChild(checkbox('Добавить графики, которых нет ни в одном шаблоне', includeLoose, v => { includeLoose = v; recount(); }));

    body.appendChild(h('div', { class: 'row2', style: { marginTop: '12px' } },
      field('Автор', h('input', { class: 'input', value: author, placeholder: 'Кто отправляет', oninput: e => { author = e.target.value; } })),
      field('Комментарий', h('input', { class: 'input', value: note, placeholder: 'Например: макет на согласование', oninput: e => { note = e.target.value; } }))));
    body.appendChild(size);
    recount();
  };
  paint();

  openModal({
    title: 'Экспорт в файл', wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', {
        class: 'btn primary', onclick: () => {
          const dashIds = [...picked];
          if (!dashIds.length && !includeLoose) { toast('Выберите хотя бы один шаблон', true); return; }
          const payload = buildExport({ dashIds, includeLoose, withData, fakeData, author, note });
          if (author.trim()) lsSet(LS_AUTHOR, author.trim());
          if (downloadFile(exportFileName(dashIds, withData), JSON.stringify(payload, null, 1))) {
            close();
            toast(withData ? 'Файл со строками данных сохранён' : 'Файл без данных сохранён');
          }
        },
      }, ic('download'), 'Скачать файл')],
  });
}

/* ---------- Импорт ---------- */
function validatePayload(p) {
  if (!p || typeof p !== 'object') throw new Error('это не файл Кобры');
  if (p.kobra !== KOBRA_FILE_V) throw new Error(p.kobra ? `версия файла ${p.kobra} не поддерживается` : 'в файле нет пометки Кобры');
  if (!p.dashboards || !p.charts) throw new Error('в файле нет шаблонов и графиков');
  return p;
}

async function importPayload(p, mode) {
  const dsMap = {}, chMap = {};
  // Наборы данных
  for (const d of p.datasets || []) {
    if (d.builtin) {
      dsMap[d.id] = d.id;
      const extra = (p.dsMetrics || {})[d.id] || [];
      if (extra.length && DS[d.id]) {
        const have = new Set((STATE.dsMetrics[d.id] || []).map(m => m.key));
        STATE.dsMetrics[d.id] = [...(STATE.dsMetrics[d.id] || []), ...extra.filter(m => !have.has(m.key))];
      }
      continue;
    }
    const collide = !!STATE.datasets[d.id];
    const id = (mode === 'copy' && collide) ? uid('ds_') : d.id;
    dsMap[d.id] = id;
    const meta = {
      id, name: d.name, kind: d.kind === 'schema' ? 'schema' : 'upload', fileName: d.fileName || '',
      columns: clone(d.columns || []), metrics: clone(d.metrics || []), mainDttm: d.mainDttm || null,
      description: d.description || '', created: Date.now(),
    };
    if (d.kind === 'schema') {
      meta.schema = normalizeSchema(d.schema);
      STATE.datasets[id] = meta;
      DS[id] = Object.assign({}, meta, { rows: generateSchemaRows(meta.schema) });
    } else if (Array.isArray(d.rows)) {
      await idb.set('rows:' + id, d.rows);
      STATE.datasets[id] = meta;
      DS[id] = Object.assign({}, meta, { rows: d.rows });
    } else {
      meta.fromTemplate = true;
      STATE.datasets[id] = meta;
      DS[id] = Object.assign({}, meta, { rows: [], missingRows: true });
    }
  }
  // Графики
  Object.values(p.charts).forEach(c => {
    const collide = !!STATE.charts[c.id];
    const id = (mode === 'copy' && collide) ? uid('c_') : c.id;
    chMap[c.id] = id;
    STATE.charts[id] = Object.assign(clone(c), { id, datasetId: dsMap[c.datasetId] || c.datasetId, updated: Date.now() });
  });
  // Дашборды
  const newDashIds = [];
  Object.values(p.dashboards).forEach(d => {
    const collide = !!STATE.dashboards[d.id];
    const id = (mode === 'copy' && collide) ? uid('d_') : d.id;
    const nd = clone(d);
    nd.id = id;
    nd.updated = Date.now();
    if (mode === 'copy' && collide) nd.title = d.title + ' (импорт)';
    nd.tabs.forEach(t => t.items.forEach(i => { if (i.chartId) i.chartId = chMap[i.chartId] || i.chartId; }));
    nd.filters = (nd.filters || []).map(f => Object.assign({}, f, { datasetId: dsMap[f.datasetId] || f.datasetId }));
    STATE.dashboards[id] = nd;
    newDashIds.push(id);
  });
  saveState();
  return newDashIds;
}

function openImportDialog() {
  const input = h('input', { type: 'file', accept: '.json,.kobra.json,application/json', style: { display: 'none' } });
  const status = h('div', { class: 'muted', style: { marginTop: '12px', fontSize: '13px' } });
  const drop = h('div', {
    class: 'upload-drop', tabindex: 0, role: 'button', onclick: () => input.click(),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') input.click(); },
  }, ic('upload'), h('b', null, 'Перетащите файл .kobra.json или нажмите, чтобы выбрать'),
    h('span', null, 'Файл, который Кобра сохранила через «Экспорт в файл».'));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) handle(input.files[0]); });
  const md = openModal({ title: 'Импорт из файла', body: h('div', null, drop, input, status) });

  async function handle(file) {
    status.textContent = `Читаю «${file.name}»…`;
    try {
      const p = validatePayload(JSON.parse(await readTextFile(file)));
      md.close();
      openImportPreview(file, p);
    } catch (e) {
      status.textContent = '';
      toast('Не удалось прочитать файл: ' + e.message, true);
    }
  }
}

function openImportPreview(file, p) {
  const dashes = Object.values(p.dashboards), charts = Object.values(p.charts), dsList = p.datasets || [];
  const collisions = dashes.filter(d => STATE.dashboards[d.id]).length + charts.filter(c => STATE.charts[c.id]).length;
  let mode = 'copy';
  const withRows = dsList.filter(d => Array.isArray(d.rows)).length;
  const fake = dsList.filter(d => d.kind === 'schema').length;
  const noRows = dsList.filter(d => d.noRows).length;
  const body = h('div');
  const paint = () => {
    clear(body);
    body.appendChild(h('table', { class: 'list' }, h('tbody', null, [
      ['Файл', file.name],
      ['Вид', p.kind === 'project' ? 'Со строками данных' : 'Без данных, только структура'],
      ['Сохранён', p.exportedAt ? fmtDate(Date.parse(p.exportedAt)) : '—'],
      p.author ? ['Автор', p.author] : null,
      p.note ? ['Комментарий', p.note] : null,
      ['Шаблоны', dashes.map(d => d.title).join(', ') || '—'],
      ['Графики', String(charts.length)],
      ['Наборы данных', `${dsList.length}` + (withRows ? `, со строками — ${withRows}` : '') + (fake ? `, по схеме — ${fake}` : '') + (noRows ? `, без строк — ${noRows}` : '')],
    ].filter(Boolean).map(([k, v]) => h('tr', null, h('td', { class: 'muted', style: { width: '150px' } }, k), h('td', null, v))))));
    if (noRows) body.appendChild(h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Для наборов без строк графики будут пустыми, пока вы не загрузите файл с такими же колонками.'));
    if (collisions) {
      body.appendChild(h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Совпадения с тем, что уже есть'),
        h('div', { class: 'hint', style: { marginBottom: '6px' } }, `Совпали по идентификатору: ${collisions}. Выберите, что делать.`),
        h('div', { class: 'seg' },
          h('button', { class: mode === 'copy' ? 'on' : '', onclick: () => { mode = 'copy'; paint(); } }, 'Добавить копией'),
          h('button', { class: mode === 'replace' ? 'on' : '', onclick: () => { mode = 'replace'; paint(); } }, 'Заменить мои версии')),
        h('div', { class: 'hint' }, mode === 'copy'
          ? 'Ничего не потеряется: совпавшее приедет рядом, с пометкой «импорт».'
          : 'Мои шаблоны и графики с теми же идентификаторами будут перезаписаны версией из файла.')));
    }
  };
  paint();

  openModal({
    title: 'Что в файле', wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', {
        class: 'btn primary', onclick: async e => {
          e.target.disabled = true;
          try {
            const ids = await importPayload(p, mode);
            close();
            toast('Импортировано');
            if (ids.length) go('#/d/' + ids[0]); else go('#/charts');
          } catch (err) {
            console.error(err);
            toast('Не удалось импортировать: ' + err.message, true);
            e.target.disabled = false;
          }
        },
      }, 'Импортировать')],
  });
}

/* ============================================================
   Кобра · наборы данных и загрузка файлов
   ============================================================ */
const CDN_XLSX = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const CDN_PAPA = 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js';
const MAX_UPLOAD_ROWS = 300000;

function renderDatasetList(main) {
  const page = h('div', { class: 'page' });
  main.appendChild(page);
  page.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', null, 'Данные'), h('p', null, 'Встроенные демо-наборы и ваши файлы. Загруженные данные хранятся только в этом браузере.')),
    h('button', { class: 'btn', onclick: () => openSchemaDialog() }, ic('schema'), 'Описать набор'),
    h('button', { class: 'btn primary', onclick: openUpload }, ic('upload'), 'Загрузить CSV или Excel')));
  const list = visibleDatasets().sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0) || a.name.localeCompare(b.name, 'ru'));
  const usage = id => Object.values(STATE.charts).filter(c => c.datasetId === id).length;
  page.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'list' },
    h('thead', null, h('tr', null, h('th', null, 'Набор данных'), h('th', null, 'Источник'), h('th', null, 'Строк'), h('th', null, 'Колонок'), h('th', null, 'Графиков'), h('th'))),
    h('tbody', null, list.map(d => h('tr', { class: 'click', onclick: () => go('#/data/' + d.id) },
      h('td', null, h('span', { class: 'vt' }, ic('db'), h('b', { style: { fontWeight: 500 } }, d.name))),
      h('td', null, d.builtin ? h('span', { class: 'pill pri' }, 'Демо')
        : isSchemaDs(d) ? h('span', { class: 'pill acc' }, 'Схема, данные вымышленные')
          : h('span', { class: 'pill' }, d.fileName || 'Файл')),
      h('td', null, fmtNum(d.rows.length, 'int')),
      h('td', null, d.columns.length),
      h('td', null, usage(d.id) || h('span', { class: 'muted' }, '—')),
      h('td', { class: 'act' }, h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); newChartDialog({ datasetId: d.id }); } }, ic('plus'), 'График'))))))));
}

function renderDatasetPage(main, id) {
  const d = DS[id];
  const page = h('div', { class: 'page' });
  main.appendChild(page);
  if (!d) { page.appendChild(h('div', { class: 'empty' }, h('b', null, 'Набор данных не найден'), h('a', { class: 'btn', href: '#/data' }, 'Ко всем наборам'))); return; }
  const editable = !d.builtin && canEdit(d);
  const nameEl = editable ? h('input', { class: 'input', value: d.name, style: { font: '600 22px/1.2 var(--font-display)', height: '44px', maxWidth: '520px' }, 'aria-label': 'Название набора', onchange: e => { d.name = e.target.value.trim() || d.name; persistDs(d); toast('Название сохранено'); } }) : h('h1', null, d.name);
  page.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('a', { href: '#/data', style: { fontSize: '13px', textDecoration: 'none' } }, '← Все наборы'), h('div', { style: { marginTop: '8px' } }, nameEl),
      h('p', null, d.description || `Загружен из файла ${d.fileName || ''}. ${fmtNum(d.rows.length, 'int')} ${plural(d.rows.length, 'строка', 'строки', 'строк')}.`)),
    isSchemaDs(d) ? h('button', { class: 'btn', onclick: () => openSchemaDialog(d.id) }, ic('schema'), 'Изменить схему') : null,
    h('button', { class: 'btn', onclick: () => newChartDialog({ datasetId: d.id }) }, ic('plus'), 'Создать график'),
    h('button', { class: 'btn primary', onclick: () => openAutoDashDialog(d.id) }, ic('wand'), 'Собрать черновик шаблона'),
    canShare(d) ? h('button', { class: 'btn', onclick: () => openShareDialog(d, 'набору данных', () => { persistDs(d); route(); }) }, ic('link'), 'Поделиться') : null,
    editable ? h('button', { class: 'btn danger', onclick: () => deleteDataset(d) }, ic('trash'), 'Удалить набор') : null));
  if (!d.builtin && !canEdit(d)) page.appendChild(h('div', { class: 'edit-banner', style: { borderRadius: '8px', marginBottom: '16px' } },
    ic('eye'), `Набор принадлежит ${authName(authOwner(d))}: вы можете строить по нему графики, но не менять его.`));
  if (d.missingRows) page.appendChild(h('div', { class: 'edit-banner', style: { borderRadius: '8px', marginBottom: '16px' } },
    d.fromTemplate ? 'Набор приехал из шаблона без данных. Загрузите файл с такими же колонками — графики оживут сами.'
      : 'Строки этого набора не найдены в хранилище браузера. Загрузите файл заново.'));
  if (isSchemaDs(d)) page.appendChild(h('div', { class: 'edit-banner fake-banner', style: { borderRadius: '8px', marginBottom: '16px' } }, ic('schema'),
    `${fmtNum(d.rows.length, 'int')} ${plural(d.rows.length, 'строка', 'строки', 'строк')} придумано по схеме: цифры правдоподобные, но ненастоящие. Период — ${fmtDate(parseIsoDate(d.schema.dateFrom))} — ${fmtDate(parseIsoDate(d.schema.dateTo))}.`));

  // Колонки
  const colsWrap = h('div', { class: 'tbl-wrap', style: { marginBottom: '28px' } });
  page.appendChild(h('h2', { style: { fontSize: '17px', margin: '8px 0 10px' } }, 'Колонки'));
  page.appendChild(colsWrap);
  const paintCols = () => {
    clear(colsWrap);
    colsWrap.appendChild(h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Ключ'), h('th', null, 'Подпись'), h('th', null, 'Тип'), h('th', null, 'Основная дата'), h('th', null, 'Пример'))),
      h('tbody', null, d.columns.map(c => {
        const sample = d.rows.find(r => r[c.key] != null && r[c.key] !== '');
        const sv = sample ? sample[c.key] : null;
        return h('tr', null,
          h('td', { class: 'muted' }, c.key),
          h('td', null, editable ? h('input', { class: 'input', value: c.label || '', style: { height: '30px' }, onchange: e => { c.label = e.target.value.trim() || c.key; persistDs(d); } }) : (c.label || c.key)),
          // У набора-схемы тип можно поправить на месте: угадывание по названию иногда врёт
          h('td', null, isSchemaDs(d)
            ? selectEl(SCHEMA_COL_TYPES, c.type, v => changeSchemaColType(d.id, c.key, v), { style: { height: '30px' }, 'aria-label': `Тип колонки «${c.label || c.key}»` })
            : h('span', { class: 'pill' }, TYPE_GROUP[c.type])),
          h('td', null, c.type === 'date' ? (editable ? h('input', { type: 'radio', name: 'maindt', checked: d.mainDttm === c.key, 'aria-label': 'Основная дата', onchange: () => { d.mainDttm = c.key; persistDs(d); toast('Основная дата изменена'); } }) : (d.mainDttm === c.key ? '✓' : '')) : ''),
          h('td', { class: 'muted' }, sv == null ? '—' : c.type === 'date' ? fmtDate(sv) : c.type === 'number' ? fmtNum(sv, 'dec2').replace(/,00$/, '') : String(sv).slice(0, 60)));
      }))));
  };
  paintCols();

  // Метрики
  const mHead = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', margin: '8px 0 10px' } }, h('h2', { style: { fontSize: '17px', margin: 0, flex: 1 } }, 'Сохранённые метрики'),
    h('button', { class: 'btn sm', onclick: () => editSavedMetric(d, null, paintMetrics) }, ic('plus'), 'Добавить метрику'));
  const mWrap = h('div', { class: 'tbl-wrap', style: { marginBottom: '28px' } });
  page.append(mHead, mWrap);
  const builtinKeys = d.builtin ? new Set(BUILTIN_DATASETS.find(b => b.id === d.id).metrics.map(m => m.key)) : new Set();
  function paintMetrics() {
    clear(mWrap);
    mWrap.appendChild(h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Метрика'), h('th', null, 'Формула'), h('th', null, 'Формат'), h('th'))),
      h('tbody', null, d.metrics.map(m => h('tr', null, h('td', null, m.label), h('td', { class: 'muted' }, exprText(d, m.expr)), h('td', { class: 'muted' }, formatLabel(m.format)),
        h('td', { class: 'act' }, builtinKeys.has(m.key) ? h('span', { class: 'muted', style: { fontSize: '12px' } }, 'встроенная') : [
          iconBtn('edit', 'Изменить', () => editSavedMetric(d, m, paintMetrics), 'sm'),
          iconBtn('trash', 'Удалить', async () => {
            const used = Object.values(STATE.charts).filter(c => c.datasetId === d.id && JSON.stringify(c.params).includes(`"key":"${m.key}"`));
            if (!(await confirmDialog('Удалить метрику', used.length ? `Метрика используется в ${used.length} ${plural(used.length, 'графике', 'графиках', 'графиках')}. Они покажут ошибку, пока вы не выберете другую метрику.` : `Метрика «${m.label}» будет удалена.`))) return;
            d.metrics = d.metrics.filter(x => x !== m); persistDs(d); paintMetrics();
          }, 'sm')]))))));
  }
  paintMetrics();

  // Превью
  page.appendChild(h('h2', { style: { fontSize: '17px', margin: '8px 0 10px' } }, 'Первые 100 строк'));
  const cols = d.columns;
  page.appendChild(h('div', { class: 'prev-tbl', style: { maxHeight: '420px', background: 'var(--surface)' } }, h('table', null,
    h('thead', null, h('tr', null, cols.map(c => h('th', null, c.label || c.key)))),
    h('tbody', null, d.rows.slice(0, 100).map(r => h('tr', null, cols.map(c => {
      const v = r[c.key];
      return h('td', { style: c.type === 'number' ? { textAlign: 'right' } : null }, v == null || v === '' ? '' : c.type === 'date' ? fmtDate(v) : c.type === 'number' ? fmtNum(v, 'dec2').replace(/,00$/, '') : String(v));
    })))))));
}

function persistDs(d) {
  if (d.builtin) {
    const base = new Set(BUILTIN_DATASETS.find(b => b.id === d.id).metrics.map(m => m.key));
    STATE.dsMetrics[d.id] = d.metrics.filter(m => !base.has(m.key));
  } else {
    const meta = Object.assign({}, d); delete meta.rows; delete meta._maxCache; delete meta.missingRows;
    STATE.datasets[d.id] = meta;
  }
  saveState();
}

function editSavedMetric(d, m, done) {
  const x = m ? clone(m) : { key: uid('m_'), label: '', expr: { type: 'simple', agg: 'SUM', col: (d.columns.find(c => c.type === 'number') || {}).key || '*' }, format: 'smart' };
  const body = h('div');
  const part = (obj, title) => {
    const col = dsCol(d, obj.col);
    const numeric = !col || col.type === 'number';
    const aggs = Object.entries(AGGS).filter(([k]) => obj.col === '*' ? k === 'COUNT' : (numeric || ['COUNT', 'COUNT_DISTINCT', 'MIN', 'MAX'].includes(k)));
    if (!aggs.some(([k]) => k === obj.agg)) obj.agg = aggs[0][0];
    return h('div', { class: 'row2' },
      field(title + ': колонка', selectEl([['*', 'Все строки (*)'], ...d.columns.map(c => ({ value: c.key, label: c.label || c.key, group: TYPE_GROUP[c.type] }))], obj.col, v => { obj.col = v; paint(); })),
      field('Агрегация', selectEl(aggs, obj.agg, v => { obj.agg = v; paint(); })));
  };
  const paint = () => {
    clear(body);
    body.appendChild(field('Название', h('input', { class: 'input', value: x.label, placeholder: 'Например, «Выручка на заказ»', oninput: e => { x.label = e.target.value; } })));
    body.appendChild(h('div', { class: 'field' }, h('div', { class: 'seg', style: { alignSelf: 'flex-start' } },
      h('button', { class: x.expr.type === 'simple' ? 'on' : '', onclick: () => { x.expr = { type: 'simple', agg: 'SUM', col: x.expr.col || x.expr.num?.col || '*' }; paint(); } }, 'Агрегат'),
      h('button', { class: x.expr.type === 'ratio' ? 'on' : '', onclick: () => { const a = x.expr.type === 'simple' ? { agg: x.expr.agg, col: x.expr.col } : x.expr.num; x.expr = { type: 'ratio', num: a, den: { agg: 'COUNT', col: '*' } }; paint(); } }, 'Отношение двух агрегатов'))));
    if (x.expr.type === 'simple') body.appendChild(part(x.expr, 'Значение'));
    else { body.appendChild(part(x.expr.num, 'Числитель')); body.appendChild(part(x.expr.den, 'Знаменатель')); }
    body.appendChild(field('Формат', selectEl(Object.entries(NUMBER_FORMATS).filter(([k]) => k !== 'auto'), x.format, v => { x.format = v; })));
    body.appendChild(h('p', { class: 'muted', style: { fontSize: '12.5px', margin: 0 } }, 'Формула: ', exprText(d, x.expr)));
  };
  paint();
  openModal({
    title: m ? 'Изменить метрику' : 'Новая метрика', body,
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
      if (!x.label.trim()) { toast('Введите название метрики', true); return; }
      x.label = x.label.trim();
      if (m) Object.assign(m, x); else d.metrics.push(x);
      persistDs(d); close(); done(); toast('Метрика сохранена');
    } }, 'Сохранить')],
  });
}

async function deleteDataset(d) {
  if (!canEdit(d)) { toast('Набор принадлежит другому сотруднику: попросите доступ', true); return; }
  const charts = Object.values(STATE.charts).filter(c => c.datasetId === d.id);
  const txt = charts.length ? `Вместе с набором «${d.name}» удалятся ${charts.length} ${plural(charts.length, 'график', 'графика', 'графиков')}, построенных на нём.` : `Набор «${d.name}» будет удалён из браузера.`;
  if (!(await confirmDialog('Удалить набор данных', txt))) return;
  charts.forEach(c => {
    delete STATE.charts[c.id];
    Object.values(STATE.dashboards).forEach(db => db.tabs.forEach(t => { t.items = t.items.filter(i => i.chartId !== c.id); }));
  });
  Object.values(STATE.dashboards).forEach(db => { db.filters = db.filters.filter(f => f.datasetId !== d.id); });
  delete STATE.datasets[d.id]; delete DS[d.id];
  await idb.del('rows:' + d.id);
  saveState();
  toast('Набор данных удалён');
  go('#/data');
}

/* ---------- Загрузка файла ---------- */
function openUpload() {
  const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods', style: { display: 'none' } });
  const status = h('div', { class: 'muted', style: { marginTop: '12px', fontSize: '13px' } });
  const drop = h('div', { class: 'upload-drop', tabindex: 0, role: 'button', onclick: () => input.click(), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') input.click(); } },
    ic('upload'), h('b', null, 'Перетащите файл сюда или нажмите, чтобы выбрать'),
    h('span', null, 'CSV (разделители запятая, точка с запятой, табуляция) или Excel: .xlsx, .xls. Первая строка — заголовки.'));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) handle(input.files[0]); });
  const md = openModal({ title: 'Загрузка данных', body: h('div', null, drop, input, status) });
  async function handle(file) {
    status.textContent = `Читаю «${file.name}»…`;
    try {
      const parsed = await parseFile(file, status);
      md.close();
      openUploadPreview(file, parsed);
    } catch (e) {
      console.error(e);
      status.textContent = '';
      toast('Не удалось прочитать файл: ' + e.message, true);
    }
  }
}
async function parseFile(file, status) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    status.textContent = 'Загружаю модуль чтения Excel…';
    await loadScript(CDN_XLSX);
    const buf = await file.arrayBuffer();
    status.textContent = 'Разбираю книгу…';
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheets = {};
    wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }); });
    return { kind: 'excel', sheets, sheetNames: wb.SheetNames };
  }
  status.textContent = 'Загружаю модуль чтения CSV…';
  await loadScript(CDN_PAPA);
  let text = await file.text();
  if (/\uFFFD/.test(text.slice(0, 5000))) {
    // Похоже на Windows-1251
    try { text = new TextDecoder('windows-1251').decode(await file.arrayBuffer()); } catch (e) { }
  }
  const res = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] });
  if (!res.data.length) throw new Error('файл пуст');
  return { kind: 'csv', sheets: { CSV: res.data }, sheetNames: ['CSV'], delimiter: res.meta.delimiter };
}

/* Типизация */
function parseNumberLoose(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim().replace(/[\u00A0\u202F\s]/g, '').replace(/[₽$€%]|руб\.?/gi, '');
  if (s === '') return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)?$/.test(s)) s = s.replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  return +s;
}
function parseDateLoose(v) {
  if (v instanceof Date) return isNaN(v) ? null : Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds());
  if (v == null) return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = /^(\d{4})[./](\d{1,2})$/.exec(s); // 2024.03
  if (m) return Date.UTC(+m[1], +m[2] - 1, 1);
  return null;
}
function guessType(values) {
  const sample = values.filter(v => v != null && String(v).trim() !== '').slice(0, 300);
  if (!sample.length) return 'string';
  if (sample.every(v => v instanceof Date || (typeof v === 'string' && parseDateLoose(v) != null && /[-./]/.test(v)))) return 'date';
  if (sample.every(v => parseNumberLoose(v) != null)) {
    // Номера с ведущими нулями — это текст (коды, артикулы)
    if (sample.some(v => typeof v === 'string' && /^0\d+/.test(v.trim()))) return 'string';
    return 'number';
  }
  return 'string';
}
function slugKey(s, i, used) {
  const tr = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  let k = String(s || '').toLowerCase().split('').map(ch => tr[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'col_' + (i + 1);
  if (/^\d/.test(k)) k = 'c_' + k;
  let base = k, n = 2;
  while (used.has(k)) k = base + '_' + (n++);
  used.add(k);
  return k;
}

function openUploadPreview(file, parsed) {
  let sheet = parsed.sheetNames.find(n => (parsed.sheets[n] || []).length > 1) || parsed.sheetNames[0];
  let name = file.name.replace(/\.[^.]+$/, '');
  let headerRow = 0;
  let cols = [];
  const body = h('div');
  const build = () => {
    const grid = parsed.sheets[sheet] || [];
    const header = grid[headerRow] || [];
    const data = grid.slice(headerRow + 1);
    const width = Math.max(header.length, ...data.slice(0, 200).map(r => r.length));
    const used = new Set();
    cols = Array.from({ length: width }, (_, i) => {
      const label = header[i] != null && String(header[i]).trim() !== '' ? String(header[i]).trim() : `Колонка ${i + 1}`;
      return { idx: i, key: slugKey(label, i, used), label, type: guessType(data.map(r => r[i])), include: true };
    });
    // Пустые колонки выключаем
    cols.forEach(c => { if (!data.slice(0, 500).some(r => r[c.idx] != null && String(r[c.idx]).trim() !== '')) c.include = false; });
    return data;
  };
  let data = build();
  const paint = () => {
    clear(body);
    body.appendChild(h('div', { class: 'row2' },
      field('Название набора', h('input', { class: 'input', value: name, oninput: e => { name = e.target.value; } })),
      parsed.sheetNames.length > 1 ? field('Лист', selectEl(parsed.sheetNames.map(n => [n, `${n} (${(parsed.sheets[n] || []).length} стр.)`]), sheet, v => { sheet = v; headerRow = 0; data = build(); paint(); }))
        : field('Строка заголовков', selectEl([0, 1, 2, 3, 4].map(i => [i, i === 0 ? 'Первая строка' : `Строка ${i + 1}`]), headerRow, v => { headerRow = +v; data = build(); paint(); }))));
    if (parsed.sheetNames.length > 1) body.appendChild(field('Строка заголовков', selectEl([0, 1, 2, 3, 4].map(i => [i, i === 0 ? 'Первая строка' : `Строка ${i + 1}`]), headerRow, v => { headerRow = +v; data = build(); paint(); })));
    body.appendChild(h('p', { class: 'muted', style: { margin: '0 0 10px', fontSize: '13px' } },
      `${fmtNum(data.length, 'int')} ${plural(data.length, 'строка', 'строки', 'строк')}` + (parsed.delimiter ? `, разделитель «${parsed.delimiter === '\t' ? 'табуляция' : parsed.delimiter}»` : '') +
      '. Проверьте типы колонок: от них зависит, что можно суммировать и где строить ось времени.' + (data.length > MAX_UPLOAD_ROWS ? ` Будут загружены первые ${fmtNum(MAX_UPLOAD_ROWS, 'int')} строк.` : '')));
    const tbl = h('table', null,
      h('thead', null, h('tr', null, cols.map(c => h('th', { style: c.include ? null : { opacity: .45 } },
        h('label', { class: 'check', style: { margin: 0 } }, h('input', { type: 'checkbox', checked: c.include, onchange: e => { c.include = e.target.checked; paint(); } }), 'Загружать'),
        h('input', { class: 'input', value: c.label, 'aria-label': 'Подпись колонки', oninput: e => { c.label = e.target.value; } }),
        selectEl([['string', 'Текст'], ['number', 'Число'], ['date', 'Дата']], c.type, v => { c.type = v; paint(); }, { 'aria-label': 'Тип колонки' }))))),
      h('tbody', null, data.slice(0, 30).map(r => h('tr', null, cols.map(c => {
        const raw = r[c.idx];
        let shown = raw == null ? '' : raw instanceof Date ? fmtDate(parseDateLoose(raw)) : String(raw);
        let bad = false;
        if (c.type === 'number' && raw != null && String(raw).trim() !== '') { const n = parseNumberLoose(raw); bad = n == null; if (!bad) shown = fmtNum(n, 'dec2').replace(/,00$/, ''); }
        if (c.type === 'date' && raw != null && String(raw).trim() !== '') { const d = parseDateLoose(raw); bad = d == null; if (!bad) shown = fmtDate(d); }
        return h('td', { style: { opacity: c.include ? 1 : .45, color: bad ? 'var(--danger)' : null } }, shown);
      })))));
    body.appendChild(h('div', { class: 'prev-tbl', style: { maxHeight: '48vh' } }, tbl));
  };
  paint();
  openModal({
    title: 'Проверьте данные перед загрузкой', wide: 'x', body,
    foot: close => [h('span', { class: 'grow muted', style: { fontSize: '12.5px' } }, 'Значения, которые не удалось распознать, станут пустыми.'),
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: async e => {
        e.target.disabled = true;
        try { const id = await saveUploaded(name.trim() || file.name, file.name, cols.filter(c => c.include), data.slice(0, MAX_UPLOAD_ROWS)); close(); toast('Набор данных загружен'); go('#/data/' + id); }
        catch (err) { console.error(err); toast('Не удалось сохранить набор: ' + err.message, true); e.target.disabled = false; }
      } }, 'Загрузить набор')],
  });
}
async function saveUploaded(name, fileName, cols, data) {
  if (!cols.length) throw new Error('не выбрано ни одной колонки');
  const rows = data.map(r => {
    const o = {};
    cols.forEach(c => {
      const raw = r[c.idx];
      if (raw == null || String(raw).trim() === '') { o[c.key] = null; return; }
      o[c.key] = c.type === 'number' ? parseNumberLoose(raw) : c.type === 'date' ? parseDateLoose(raw) : (raw instanceof Date ? fmtDate(parseDateLoose(raw)) : String(raw).trim());
    });
    return o;
  });
  const id = uid('ds_');
  const columns = cols.map(c => ({ key: c.key, label: c.label || c.key, type: c.type }));
  const metrics = [{ key: 'count', label: 'Количество строк', expr: { type: 'simple', agg: 'COUNT', col: '*' }, format: 'int' }];
  columns.filter(c => c.type === 'number').forEach(c => metrics.push({ key: 'sum_' + c.key, label: 'Сумма: ' + c.label, expr: { type: 'simple', agg: 'SUM', col: c.key }, format: 'smart' }));
  const mainDttm = (columns.find(c => c.type === 'date') || {}).key || null;
  const meta = { id, name, fileName, columns, metrics, mainDttm, created: Date.now(), description: '' };
  const ok = await idb.set('rows:' + id, rows);
  if (!ok) toast('Хранилище браузера недоступно: набор будет работать до перезагрузки страницы', true);
  STATE.datasets[id] = meta;
  DS[id] = Object.assign({}, meta, { rows });
  saveState();
  return id;
}

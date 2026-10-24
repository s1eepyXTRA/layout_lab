/* ============================================================
   Кобра · состояние, демо, роутер
   ============================================================ */
let STATE = null;
function saveState() { STATE.savedAt = Date.now(); return lsSet(LS_KEY, STATE); }
const saveSoon = debounce(saveState, 300);

/* ---------- Демо-наполнение ---------- */
function seedState() {
  const S = { v: 2, charts: {}, dashboards: {}, datasets: {}, dsMetrics: {}, theme: null };
  const mk = (id, name, viz, ds, params) => { S.charts[id] = { id, name, viz, datasetId: ds, params: Object.assign(VIZ[viz].defaults(DS[ds]), params), updated: Date.now() }; return id; };
  const M = key => ({ kind: 'saved', key });
  const noTime = { time_range: { preset: 'all' } };
  // Обзор
  mk('c_rev', 'Выручка за месяц', 'big_number_trend', 'demo_sales', { metric: M('revenue'), x_grain: 'month', compare_lag: 1, subheader: 'Выручка', ...noTime });
  mk('c_orders', 'Заказы за месяц', 'big_number_trend', 'demo_sales', { metric: M('orders'), x_grain: 'month', compare_lag: 12, subheader: 'Заказы', color_scheme: 'cold' });
  mk('c_check', 'Средний чек', 'big_number', 'demo_sales', { metric: M('avg_check'), compare: 'prev_period', subheader: 'Средний чек за период' });
  mk('c_marg', 'Маржинальность', 'big_number', 'demo_sales', { metric: M('margin_pct'), compare: 'prev_year', subheader: 'Маржинальность за период' });
  mk('c_mixed', 'Выручка и средний чек по месяцам', 'mixed', 'demo_sales', { x_col: 'date', x_grain: 'month', metrics: [M('revenue')], metrics_b: [M('avg_check')], type_a: 'bar', type_b: 'line', axis_b: 'right', smooth: true });
  mk('c_channel', 'Каналы продаж', 'pie', 'demo_sales', { dim: 'channel', metric: M('revenue'), label_type: 'name_pct', show_legend: false });
  mk('c_cat_bar', 'Выручка по направлениям', 'bar', 'demo_sales', { x_col: 'direction', metrics: [M('revenue'), M('margin')], horizontal: true, show_labels: false, show_legend: true });
  mk('c_cat_area', 'Структура выручки по направлениям', 'area', 'demo_sales', { x_col: 'date', x_grain: 'month', metrics: [M('revenue')], series_col: 'direction', stacked: true, expand: true, smooth: true, opacity: 70 });
  mk('c_daily', 'Выручка по дням, скользящее среднее 7 дней', 'line', 'demo_sales', { x_col: 'date', x_grain: 'day', metrics: [M('revenue')], series_col: 'channel', rolling: 7, zoom: true, smooth: true, y_min_zero: true });
  // Товары
  mk('c_tree', 'Выручка: направления и группы товаров', 'treemap', 'demo_sales', { groupby: ['direction', 'group'], metric: M('revenue'), show_pct: true });
  mk('c_top', 'Топ товаров', 'table', 'demo_sales', { mode: 'agg', groupby: ['product'], metrics: [M('revenue'), M('qty'), M('margin_pct')], row_limit: 50, page_size: '10', cell_bars: true, totals: true });
  mk('c_pivot', 'Выручка: направление × канал продаж', 'pivot', 'demo_sales', { rows: ['direction', 'group'], cols: ['channel'], metrics: [M('revenue')], row_sort: 'name', heat: true });
  mk('c_bullet', 'Маржинальность направлений против средней', 'bullet', 'demo_sales', { metric: M('margin_pct'), dim: 'direction', target_mode: 'avg', ranges: '0,1; 0,18; 0,5', range_labels: 'Низкая, Нормальная, Высокая' });
  mk('c_brands', 'Группы товаров по линейкам', 'bar', 'demo_sales', { x_col: 'group', metrics: [M('revenue')], series_col: 'line', stacked: true, row_limit: 15, x_rotate: '45', series_limit: 3 });
  // Регионы
  mk('c_heat', 'Выручка городов по месяцам', 'heatmap', 'demo_sales', { x_col: 'date', y_col: 'city', x_grain: 'month', metric: M('revenue'), normalize: 'y', seq_scheme: 'jade', y_limit: 25 });
  mk('c_district', 'Регионы и каналы', 'bar', 'demo_sales', { x_col: 'region', metrics: [M('revenue')], series_col: 'channel', stacked: true, x_rotate: '30' });
  mk('c_stores', 'Точки продаж', 'table', 'demo_sales', { mode: 'agg', groupby: ['city', 'store'], metrics: [M('revenue'), M('orders'), M('avg_check')], row_limit: 100, page_size: '25', totals: true });
  // Интернет-магазин
  mk('c_funnel', 'Воронка интернет-магазина', 'funnel', 'demo_funnel', { dim: 'stage', metric: M('users'), order_by: 'stage_order', label_type: 'pct_first' });
  mk('c_funnel_pf', 'Воронка по платформам', 'bar', 'demo_funnel', { x_col: 'stage', metrics: [M('users')], series_col: 'platform', sort: 'value_desc', horizontal: true, show_labels: true });
  mk('c_visits', 'Посещения по платформам', 'line', 'demo_funnel', { x_col: 'date', x_grain: 'month', markers: true, metrics: [M('users')], series_col: 'platform', adhoc_filters: [{ col: 'stage', op: 'in', val: ['Посещение'] }], smooth: true });
  mk('c_sources', 'Источники трафика', 'pie', 'demo_funnel', { dim: 'source', metric: M('users'), adhoc_filters: [{ col: 'stage', op: 'in', val: ['Посещение'] }], label_type: 'pct', show_legend: true, legend_pos: 'right' });
  mk('c_paid', 'Оплаченные заказы онлайн', 'big_number_trend', 'demo_funnel', { metric: M('users'), x_grain: 'week', adhoc_filters: [{ col: 'stage', op: 'in', val: ['Оплата'] }], subheader: 'Оплаты за неделю', skip_partial: true });

  const ch = (chartId, x, y, w, hh) => ({ i: uid('i'), type: 'chart', chartId, x, y, w, h: hh });
  S.dashboards.d_demo = {
    id: 'd_demo', title: 'Продажи розничной сети', updated: Date.now(), crossFilter: true, scheme: null,
    tabs: [
      { id: 't1', title: 'Обзор', items: [
        { i: uid('i'), type: 'markdown', x: 0, y: 0, w: 12, h: 3, text: '**Прототип дашборда продаж.** Данные вымышленные: розничная сеть, январь 2024 — август 2026. Кликните по столбцу, сектору или строке — остальные графики отфильтруются.' },
        ch('c_rev', 0, 3, 3, 7), ch('c_orders', 3, 3, 3, 7), ch('c_check', 6, 3, 3, 7), ch('c_marg', 9, 3, 3, 7),
        ch('c_mixed', 0, 10, 8, 13), ch('c_channel', 8, 10, 4, 13),
        ch('c_cat_bar', 0, 23, 6, 13), ch('c_cat_area', 6, 23, 6, 13),
        ch('c_daily', 0, 36, 12, 12),
      ] },
      { id: 't2', title: 'Товары', items: [
        ch('c_tree', 0, 0, 7, 15), ch('c_top', 7, 0, 5, 15),
        { i: uid('i'), type: 'header', x: 0, y: 15, w: 12, h: 2, text: 'Маржа и бренды', size: 'm', bg: false },
        ch('c_bullet', 0, 17, 6, 12), ch('c_brands', 6, 17, 6, 12),
        ch('c_pivot', 0, 29, 12, 15),
      ] },
      { id: 't3', title: 'Регионы', items: [
        ch('c_heat', 0, 0, 12, 17), ch('c_district', 0, 17, 6, 14), ch('c_stores', 6, 17, 6, 14),
      ] },
      { id: 't4', title: 'Интернет-магазин', items: [
        ch('c_funnel', 0, 0, 5, 14), ch('c_funnel_pf', 5, 0, 7, 14),
        { i: uid('i'), type: 'divider', x: 0, y: 14, w: 12, h: 1 },
        ch('c_paid', 0, 15, 3, 12), ch('c_visits', 3, 15, 5, 12), ch('c_sources', 8, 15, 4, 12),
      ] },
    ],
    filters: [
      { id: 'f_time', name: 'Период', type: 'time', datasetId: 'demo_sales', col: 'date', value: { preset: 'last_12m' }, def: { preset: 'last_12m' }, scope: 'all' },
      { id: 'f_district', name: 'Регион', type: 'select', datasetId: 'demo_sales', col: 'region', multi: true, value: [], def: [], scope: 'all', dependent: true },
      { id: 'f_city', name: 'Город', type: 'select', datasetId: 'demo_sales', col: 'city', multi: true, value: [], def: [], scope: 'all', dependent: true },
      { id: 'f_cat', name: 'Направление', type: 'select', datasetId: 'demo_sales', col: 'direction', multi: true, value: [], def: [], scope: 'all', dependent: true },
      { id: 'f_channel', name: 'Канал продаж', type: 'select', datasetId: 'demo_sales', col: 'channel', multi: true, value: [], def: [], scope: 'all', dependent: false },
      { id: 'f_platform', name: 'Платформа', type: 'select', datasetId: 'demo_funnel', col: 'platform', multi: true, value: [], def: [], scope: 'all', dependent: false },
    ],
  };
  return S;
}

/* ---------- Наборы данных ---------- */
function registerBuiltins() {
  BUILTIN_DATASETS.forEach(b => {
    DS[b.id] = { id: b.id, name: b.name, builtin: true, description: b.description, mainDttm: b.mainDttm, columns: clone(b.columns), metrics: clone(b.metrics), rows: b.generate() };
  });
}
function applyDsOverrides() {
  // Пользовательские метрики для встроенных наборов
  Object.entries(STATE.dsMetrics || {}).forEach(([id, list]) => {
    const ds = DS[id]; if (!ds || !ds.builtin) return;
    const base = BUILTIN_DATASETS.find(b => b.id === id);
    ds.metrics = [...clone(base.metrics), ...list];
  });
}
/* Скрытый набор принадлежит дашборду: без дашборда он мусор в хранилище */
function dropOwnedDatasets() {
  let n = 0;
  Object.values(STATE.datasets || {}).forEach(meta => {
    if (!meta.owner || STATE.dashboards[meta.owner]) return;
    delete STATE.datasets[meta.id];
    delete DS[meta.id];
    n++;
  });
  return n;
}
/* Наборы, видимые человеку: скрытые макетные и временные примеры не в счёт */
const visibleDatasets = () => Object.values(DS).filter(d => !d.owner && !d.preview);

async function loadUploaded() {
  const ids = Object.keys(STATE.datasets || {});
  for (const id of ids) {
    const meta = STATE.datasets[id];
    if (meta.kind === 'schema') { DS[id] = Object.assign({}, meta, { rows: generateSchemaRows(meta.schema) }); continue; }
    const rows = await idb.get('rows:' + id);
    DS[id] = Object.assign({}, meta, { rows: rows || [], missingRows: !rows });
  }
}

/* ---------- Роутер ---------- */
let pageCleanup = null;
function go(hash) {
  if (location.hash === hash) { route(); return; }
  try { history.pushState(null, '', hash); route(); }
  catch (e) { location.hash = hash; }
}
function parseRoute() {
  const raw = (location.hash || '#/dashboards').slice(1);
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = {};
  (qs || '').split('&').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); q[k] = decodeURIComponent(v || ''); });
  return { parts, q };
}
function route() {
  closePop();
  if (pageCleanup) { try { pageCleanup(); } catch (e) { console.error(e); } pageCleanup = null; }
  const { parts, q } = parseRoute();
  const main = document.querySelector('.main');
  clear(main);
  main.scrollTop = 0;
  const sec = parts[0] || 'dashboards';
  // Примеры шаблонов живут только пока на них смотрят
  if (typeof purgePreviews === 'function') purgePreviews(sec === 'd' ? parts[1] : null);
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.sec === (sec === 'd' ? 'dashboards' : sec === 'explore' ? 'charts' : sec)));
  try {
    if (sec === 'd' && parts[1]) pageCleanup = renderDashboard(main, parts[1], q);
    else if (sec === 'templates') pageCleanup = renderTemplateList(main, q);
    else if (sec === 'charts') pageCleanup = renderChartList(main);
    else if (sec === 'explore') pageCleanup = renderExplore(main, parts, q);
    else if (sec === 'data' && parts[1]) pageCleanup = renderDatasetPage(main, parts[1]);
    else if (sec === 'data') pageCleanup = renderDatasetList(main);
    else pageCleanup = renderDashboardList(main);
  } catch (e) {
    console.error(e);
    main.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('b', null, 'Не удалось открыть страницу'), e.message, h('br'), h('a', { class: 'btn', href: '#/dashboards' }, 'К дашбордам'))));
  }
  document.title = 'Кобра — ' + ({ d: (STATE.dashboards[parts[1]] || {}).title || 'Дашборд', charts: 'Графики', explore: 'Конструктор графика', data: 'Данные', templates: 'Готовые дашборды' }[sec] || 'Дашборды');
}

/* ---------- Каркас ---------- */
function renderShell() {
  const app = document.getElementById('app');
  clear(app);
  const themeBtn = h('button', { class: 'iconbtn-bar', title: 'Сменить тему', 'aria-label': 'Сменить тему', onclick: toggleTheme });
  const paintTheme = () => { clear(themeBtn).appendChild(ic(isDark() ? 'sun' : 'moon')); };
  paintTheme();
  themeBtn._paint = paintTheme;
  const settingsBtn = h('button', { class: 'iconbtn-bar', title: 'Настройки', 'aria-label': 'Настройки' }, ic('settings'));
  settingsBtn.addEventListener('click', () => openMenu(settingsBtn, [
    { label: 'Экспорт в файл…', icon: 'download', onClick: () => openExportDialog() },
    { label: 'Импорт из файла…', icon: 'upload', onClick: openImportDialog },
    '-',
    { label: 'Вернуть демо-дашборд', icon: 'reset', onClick: restoreDemo },
    { label: 'Сбросить всё к начальному состоянию', icon: 'trash', danger: true, onClick: resetAll },
  ]));
  app.appendChild(h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/dashboards', 'aria-label': 'Кобра — на главную' }, ic('cobra'), h('b', null, 'Кобра')),
    h('nav', { class: 'nav' },
      h('a', { href: '#/dashboards', 'data-sec': 'dashboards' }, 'Дашборды'),
      h('a', { href: '#/charts', 'data-sec': 'charts' }, 'Графики'),
      h('a', { href: '#/data', 'data-sec': 'data' }, 'Данные')),
    h('div', { class: 'spacer' }), themeBtn, settingsBtn));
  app.appendChild(h('main', { class: 'main' }));
  window._themeBtn = themeBtn;
}
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('kobra.theme', next); } catch (e) { }
  window._themeBtn && window._themeBtn._paint();
  route();
}
async function restoreDemo() {
  const seed = seedState();
  let n = 0;
  Object.values(seed.charts).forEach(c => { if (!STATE.charts[c.id]) { STATE.charts[c.id] = c; n++; } });
  if (STATE.dashboards.d_demo && !(await confirmDialog('Вернуть демо-дашборд', 'Демо-дашборд «Продажи розничной сети» уже есть. Заменить его исходной версией? Ваши изменения в нём пропадут.', 'Заменить', false))) return;
  STATE.dashboards.d_demo = seed.dashboards.d_demo;
  Object.values(seed.charts).forEach(c => { STATE.charts[c.id] = c; });
  saveState();
  toast('Демо-дашборд восстановлен');
  go('#/d/d_demo');
}
async function resetAll() {
  if (!(await confirmDialog('Сбросить всё', 'Удалятся все ваши дашборды, графики и загруженные наборы данных. Останется только демо. Действие нельзя отменить.', 'Сбросить всё'))) return;
  for (const id of Object.keys(STATE.datasets || {})) { await idb.del('rows:' + id); delete DS[id]; }
  STATE = seedState();
  applyDsOverrides();
  saveState();
  toast('Кобра сброшена к начальному состоянию');
  go('#/dashboards');
}

/* ---------- Список дашбордов ---------- */
function dashThumb(d) {
  const th = h('div', { class: 'dash-thumb', 'aria-hidden': 'true' });
  const tab = d.tabs[0];
  if (!tab) return th;
  const maxY = Math.max(12, ...tab.items.map(i => i.y + i.h));
  tab.items.slice(0, 14).forEach(it => {
    const chart = it.type === 'chart' ? STATE.charts[it.chartId] : null;
    th.appendChild(h('i', { class: chart && chart.viz.startsWith('big_number') ? 'k' : '', style: {
      left: `calc(${(it.x / 12 * 100).toFixed(2)}% + 6px)`, width: `calc(${(it.w / 12 * 100).toFixed(2)}% - 8px)`,
      top: `calc(${(it.y / maxY * 100).toFixed(2)}% + 6px)`, height: `calc(${(it.h / maxY * 100).toFixed(2)}% - 6px)`,
      opacity: it.type === 'divider' ? .3 : 1,
    } }));
  });
  return th;
}
function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? `сегодня в ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}
/* Три пути: взять готовое, строить самому, принести свои данные. Описаны
   одним списком, потому что показываются в двух местах — на стартовом экране
   и в диалоге «Новый дашборд», и расходиться им нельзя. В диалоге путей два:
   «мои данные» — это не создание дашборда, а загрузка файла. */
const START_WAYS = [
  { id: 'tpl', icon: 'schema', rec: true, title: 'Готовый шаблон',
    desc: 'Заготовленные отчёты: выбираете подходящий, а дальше при необходимости дорабатываете. Кобра соберёт его на придуманных данных и разложит по уровням — общая картина, разбор, исходные строки.',
    note: 'Зачастую подходит именно это: состав и оформление сделаны по стандартам визуализации, а названия блоков, показателей и категорий правятся прямо на дашборде.',
    act: () => go('#/templates') },
  { id: 'blank', icon: 'plus', title: 'Начать с нуля',
    desc: 'Пустой дашборд, в котором вы сами накидаете блоки, графики и вкладки. Данные под них Кобра придумает — выбирать набор не нужно.',
    act: () => createBlankDashboard() },
  { id: 'own', icon: 'upload', title: 'Мои данные', btn: 'Загрузить файл',
    desc: 'Загружаете CSV или Excel и строите по своим цифрам: то же самое, но на настоящих данных вашей выгрузки.',
    act: () => go('#/data') },
];
function startCard(w, onPick) {
  return h('div', { class: 'start-card' + (w.rec ? ' rec' : '') },
    h('div', { class: 'start-ic' }, ic(w.icon)),
    h('b', null, w.title), h('p', null, w.desc),
    w.note ? h('p', { class: 'start-note' }, w.note) : null,
    h('button', { class: 'btn ' + (w.rec ? 'primary' : ''), onclick: () => { onPick && onPick(); w.act(); } }, w.btn || 'Выбрать'));
}
function startChoice(ids) {
  const ways = START_WAYS.filter(w => !ids || ids.includes(w.id));
  return h('div', { class: 'start-choice' }, ways.map(w => startCard(w)));
}
function renderDashboardList(main) {
  const page = h('div', { class: 'page' });
  main.appendChild(page);
  const list = Object.values(STATE.dashboards).filter(d => !d.preview).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  // Свой дашборд — любой, кроме демо: пока их нет, показываем выбор пути
  const own = list.filter(d => d.id !== 'd_demo');
  if (!own.length) {
    page.appendChild(h('div', { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', null, 'С чего начнём'),
        h('p', null, 'Кобра собирает дашборды по вашим данным. Выберите, как удобнее начать — потом всё можно поправить.')),
      h('button', { class: 'btn', onclick: openImportDialog }, ic('upload'), 'Импорт из файла')));
    page.appendChild(startChoice());
    if (list.length) {
      page.appendChild(h('h2', { style: { fontSize: '17px', margin: '28px 0 10px' } }, 'Демо-дашборд'));
      page.appendChild(dashGrid(list));
    }
    return;
  }
  page.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', null, 'Дашборды'), h('p', null, 'Собирайте прототипы из графиков, вкладок, текста и фильтров. Всё сохраняется в этом браузере.')),
    h('button', { class: 'btn', onclick: openImportDialog }, ic('upload'), 'Импорт из файла'),
    h('button', { class: 'btn', onclick: () => go('#/templates') }, ic('schema'), 'Готовые дашборды'),
    h('button', { class: 'btn primary', onclick: createDashboard }, ic('plus'), 'Новый дашборд')));
  page.appendChild(dashGrid(list));
}
function dashGrid(list) {
  const grid = h('div', { class: 'dash-grid' });
  list.forEach(d => {
    const nCharts = d.tabs.reduce((a, t) => a + t.items.filter(i => i.type === 'chart').length, 0);
    const more = h('button', { class: 'iconbtn', title: 'Действия', 'aria-label': 'Действия с дашбордом' }, ic('dots'));
    more.addEventListener('click', e => {
      e.stopPropagation();
      openMenu(more, [
        { label: 'Открыть', icon: 'eye', onClick: () => go('#/d/' + d.id) },
        { label: 'Дублировать', icon: 'copy', onClick: () => duplicateDashboard(d.id) },
        { label: 'Экспортировать в файл…', icon: 'download', onClick: () => openExportDialog(d.id) },
        '-',
        { label: 'Удалить', icon: 'trash', danger: true, onClick: () => deleteDashboard(d.id) },
      ]);
    });
    grid.appendChild(h('div', { class: 'dash-card', tabindex: 0, role: 'link', onclick: () => go('#/d/' + d.id), onkeydown: e => { if (e.key === 'Enter') go('#/d/' + d.id); } },
      dashThumb(d),
      h('div', { class: 'meta' }, h('div', { class: 'grow' }, h('b', null, d.title),
        h('span', null, `${nCharts} ${plural(nCharts, 'график', 'графика', 'графиков')}, ${d.tabs.length} ${plural(d.tabs.length, 'вкладка', 'вкладки', 'вкладок')} · изменён ${fmtWhen(d.updated)}`)), more)));
  });
  grid.appendChild(h('button', { class: 'dash-card new-card', onclick: createDashboard }, ic('plus'), 'Новый дашборд'));
  return grid;
}
// Пустые дашборды, созданные кнопкой «Новый дашборд»: если с такого ушли,
// ничего не добавив, запись убирается, чтобы в списке не оставался мусор.
// Набор не сохраняется — после перезагрузки дашборд просто остаётся как раньше.
const freshDashboards = new Set();
/* Кнопка «Новый дашборд» сначала спрашивает, с чего начать: готовых шаблонов
   у человека может не быть в голове, а начинать с пустого экрана тяжелее. */
function createDashboard() {
  const host = h('div', { class: 'start-choice tight' });
  const m = openModal({
    title: 'Новый дашборд', wide: true,
    body: h('div', null,
      h('p', { class: 'muted', style: { margin: '0 0 14px', fontSize: '13.5px' } },
        'Оба пути ведут к одному: дашборд потом правится как угодно.'), host),
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена')],
  });
  START_WAYS.filter(w => w.id !== 'own').forEach(w => host.appendChild(startCard(w, m.close)));
}
function createBlankDashboard() {
  // Пустой дашборд — тоже макет: под блоки нужны данные, и Кобра их придумает
  const mid = createMockup(null, { title: 'Новый макет' });
  if (mid) { freshDashboards.add(mid); go('#/d/' + mid + '?edit=1'); return; }
  const id = uid('d_');
  freshDashboards.add(id);
  STATE.dashboards[id] = { id, title: 'Новый дашборд', updated: Date.now(), crossFilter: true, scheme: null, tabs: [{ id: uid('t'), title: 'Вкладка 1', items: [] }], filters: [] };
  saveState();
  go('#/d/' + id + '?edit=1');
}
function duplicateDashboard(id) {
  const src = STATE.dashboards[id];
  const nid = uid('d_');
  const copy = clone(src);
  copy.id = nid; copy.title = src.title + ' (копия)'; copy.updated = Date.now();
  STATE.dashboards[nid] = copy;
  saveState();
  toast('Дашборд скопирован');
  route();
}
async function deleteDashboard(id) {
  const d = STATE.dashboards[id];
  if (!(await confirmDialog('Удалить дашборд', `Дашборд «${d.title}» будет удалён. Графики останутся в разделе «Графики».`))) return;
  delete STATE.dashboards[id];
  dropOwnedDatasets();
  saveState();
  toast('Дашборд удалён');
  go('#/dashboards');
}

/* ---------- Список графиков ---------- */
function chartUsage(chartId) {
  return Object.values(STATE.dashboards).filter(d => d.tabs.some(t => t.items.some(i => i.chartId === chartId)));
}
function renderChartList(main) {
  const page = h('div', { class: 'page' });
  main.appendChild(page);
  page.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', null, 'Графики'), h('p', null, 'Каждый график можно добавить на один или несколько дашбордов.')),
    h('button', { class: 'btn primary', onclick: () => newChartDialog() }, ic('plus'), 'Новый график')));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Найти график', 'aria-label': 'Поиск графиков' });
  const vizF = selectEl([['', 'Все типы'], ...VIZ_ORDER.map(k => [k, VIZ[k].label])], '', () => paint(), { style: { maxWidth: '240px' }, 'aria-label': 'Тип графика' });
  page.appendChild(h('div', { class: 'toolbar' }, search, vizF));
  const wrap = h('div', { class: 'tbl-wrap' });
  page.appendChild(wrap);
  search.addEventListener('input', debounce(() => paint(), 150));
  function paint() {
    const q = search.value.trim().toLowerCase();
    const list = Object.values(STATE.charts).filter(c => (!q || c.name.toLowerCase().includes(q)) && (!vizF.value || c.viz === vizF.value)).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    clear(wrap);
    if (!list.length) { wrap.appendChild(h('div', { class: 'empty' }, h('b', null, Object.keys(STATE.charts).length ? 'Ничего не найдено' : 'Графиков пока нет'), 'Создайте первый график из набора данных.', h('br'), h('button', { class: 'btn primary', onclick: () => newChartDialog() }, ic('plus'), 'Новый график'))); return; }
    wrap.appendChild(h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Название'), h('th', null, 'Тип'), h('th', null, 'Набор данных'), h('th', null, 'ТЗ'), h('th', null, 'На дашбордах'), h('th', null, 'Изменён'), h('th'))),
      h('tbody', null, list.map(c => {
        const used = chartUsage(c.id);
        const more = h('button', { class: 'iconbtn', title: 'Действия', 'aria-label': 'Действия с графиком' }, ic('dots'));
        more.addEventListener('click', e => { e.stopPropagation(); openMenu(more, [
          { label: 'Редактировать', icon: 'edit', onClick: () => go('#/explore/' + c.id) },
          { label: 'Дублировать', icon: 'copy', onClick: () => { const n = clone(c); n.id = uid('c_'); n.name += ' (копия)'; n.updated = Date.now(); STATE.charts[n.id] = n; saveState(); paint(); } },
          '-', { label: 'Удалить', icon: 'trash', danger: true, onClick: () => deleteChart(c.id).then(ok => ok && paint()) },
        ]); });
        const nSpec = specFilledCount(c);
        const question = specValue(c, 'question');
        return h('tr', { class: 'click', onclick: () => go('#/explore/' + c.id) },
          h('td', null, h('b', { style: { fontWeight: 500 } }, c.name),
            question ? h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '2px' } }, question) : null),
          h('td', null, h('span', { class: 'vt' }, ic(VIZ[c.viz].icon), VIZ[c.viz].label)),
          h('td', null, (DS[c.datasetId] || {}).name || h('span', { class: 'pill acc' }, 'нет данных')),
          h('td', null, nSpec
            ? h('span', { class: 'pill pri', title: SPEC_FIELDS.filter(f => specValue(c, f.key)).map(f => f.label + ': ' + (f.key === 'priority' ? specPriorityLabel(specValue(c, f.key)) : specValue(c, f.key))).join('\n') }, nSpec + '/' + SPEC_FIELDS.length)
            : h('span', { class: 'muted' }, '—')),
          h('td', null, used.length ? used.map(d => h('a', { href: '#/d/' + d.id, onclick: e => e.stopPropagation(), style: { marginRight: '8px' } }, d.title)) : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'muted' }, fmtWhen(c.updated)),
          h('td', { class: 'act' }, more));
      }))));
  }
  paint();
}
async function deleteChart(id) {
  const c = STATE.charts[id];
  const used = chartUsage(id);
  const txt = used.length ? `График «${c.name}» будет удалён и исчезнет с ${used.length} ${plural(used.length, 'дашборда', 'дашбордов', 'дашбордов')}: ${used.map(d => d.title).join(', ')}.` : `График «${c.name}» будет удалён.`;
  if (!(await confirmDialog('Удалить график', txt))) return false;
  delete STATE.charts[id];
  used.forEach(d => d.tabs.forEach(t => { t.items = t.items.filter(i => i.chartId !== id); }));
  saveState();
  toast('График удалён');
  return true;
}
function newChartDialog(opts = {}) {
  const dsList = visibleDatasets();
  let dsId = opts.datasetId || (dsList[0] || {}).id;
  let viz = opts.viz || 'bar';
  const gal = h('div', { class: 'viz-gallery' });
  const paintGal = () => {
    clear(gal);
    VIZ_ORDER.forEach(k => gal.appendChild(h('button', { class: 'viz-opt' + (k === viz ? ' on' : ''), type: 'button', 'aria-pressed': k === viz ? 'true' : 'false', onclick: () => { viz = k; paintGal(); }, ondblclick: () => { viz = k; create(); } },
      ic(VIZ[k].icon), h('b', null, VIZ[k].label), h('span', null, VIZ[k].desc))));
  };
  paintGal();
  let md;
  const create = () => {
    md.close();
    go(`#/explore/new?ds=${encodeURIComponent(dsId)}&viz=${viz}` + (opts.back ? `&back=${encodeURIComponent(opts.back)}` : ''));
  };
  md = openModal({
    title: 'Новый график', wide: true,
    body: h('div', null,
      field('Набор данных', selectEl(dsList.map(d => [d.id, d.name]), dsId, v => { dsId = v; })),
      h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Тип визуализации'), gal)),
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: create }, 'Создать график')],
  });
}

/* ---------- Запуск ---------- */
async function boot() {
  const theme = (() => { try { return localStorage.getItem('kobra.theme'); } catch (e) { return null; } })();
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  await new Promise(r => setTimeout(r, 30));
  if (typeof echarts === 'undefined') {
    document.querySelector('.loading div span').textContent = 'Не загрузилась библиотека графиков. Проверьте подключение к интернету и обновите страницу.';
    return;
  }
  registerBuiltins();
  STATE = lsGet(LS_KEY);
  if (!STATE || STATE.v !== 2 || !STATE.charts) { STATE = seedState(); saveState(); }
  STATE.datasets = STATE.datasets || {}; STATE.dsMetrics = STATE.dsMetrics || {};
  applyDsOverrides();
  await loadUploaded();
  if (dropOwnedDatasets()) saveState();
  renderShell();
  let lastNav = { h: null, t: 0 };
  const onNav = () => { if (lastNav.h === location.hash && Date.now() - lastNav.t < 150) return; lastNav = { h: location.hash, t: Date.now() }; route(); };
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);
  // Внутренние ссылки обрабатываем сами: во встроенном окне просмотра переход по href может увести фрейм на чужой адрес
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) { e.preventDefault(); go(href); return; }
    if (/^https?:/i.test(href)) { e.preventDefault(); window.open(href, '_blank', 'noopener'); }
  }, true);
  let lastW = window.innerWidth;
  window.addEventListener('resize', debounce(() => { if (Math.abs(window.innerWidth - lastW) > 40 && (lastW < 760) !== (window.innerWidth < 760)) route(); lastW = window.innerWidth; }, 200));
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.getAttribute('data-theme')) { window._themeBtn && window._themeBtn._paint(); route(); } });
  if (!location.hash) { try { history.replaceState(null, '', '#/d/d_demo'); } catch (e) { } }
  route();
  const ld = document.querySelector('.loading');
  ld && ld.remove();
}

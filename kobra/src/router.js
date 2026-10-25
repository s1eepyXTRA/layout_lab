/* =============================================================
   Кобра · маршруты
   Роутер на хэше: #/dashboards, #/d/<id>?edit=1&tune=1, #/charts,
   #/explore/<id|new>, #/data[/<id>], #/templates. Каждая страница-рендерер
   возвращает функцию очистки — её зовут при следующем переходе, там снимают
   ResizeObserver и dispose() у ECharts. Без этого графики утекают.
   ============================================================= */

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
    main.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('b', null, 'Не удалось открыть страницу'), e.message, h('br'), h('a', { class: 'btn', href: '#/dashboards' }, 'К шаблонам'))));
  }
  document.title = 'Кобра — ' + ({ d: (STATE.dashboards[parts[1]] || {}).title || 'Шаблон', charts: 'Графики', explore: 'Конструктор графика', data: 'Данные', templates: 'Готовые шаблоны' }[sec] || 'Шаблоны');
}

/* ============================================================
   Кобра · черновик дашборда по набору данных
   Одна кнопка на странице набора: Кобра сама подбирает метрики
   и разрезы, собирает графики и дашборд и открывает его в правке.
   Дальше человек только правит готовое, а не строит с нуля.
   Параметры графиков всегда кладутся поверх VIZ[type].defaults(ds),
   поэтому новый тип графика и изменившиеся дефолты не разъезжаются
   с генератором.
   ============================================================ */
const AUTO_DIMS_MAX = 3;        // сколько текстовых разрезов берём в работу
const AUTO_DIM_CARD_MAX = 60;   // колонка с большим числом значений — не разрез, а идентификатор
const AUTO_KPI_MAX = 3;
const AUTO_MONEY_RE = /₽|руб/i;
const AUTO_PCT_RE = /процент|доля|конверси|маржинальност|%/i;
const AUTO_ID_RE = /id$|номер|код|артикул|guid|uuid/i;
// Хвост-единица в подписи метрики: в названии графика он лишний
const AUTO_UNIT_TAIL = /,\s*(₽|руб\.?|р\.|%|шт\.?|ед\.?|чел\.?|кг|т|л|м2|м²|мин|сек|дн\.?|тыс\.?|млн|млрд|\$|€)\s*$/i;
const AUTO_AGG_PREFIX = /^(сумма|среднее|количество|уникальных|минимум|максимум|медиана)\s*:\s*/i;

/* ---------- Падежи для человеческих названий ---------- */
/* Названия графиков читает человек: «Выручка по филиалам» понятнее,
   чем «Выручка — Филиал». На расчёты падежи не влияют, поэтому хватает
   простых правил; чего не узнали — показываем через двоеточие. */
function autoNounDative(word) {
  const s = String(word || '').toLowerCase();
  if (!/^[а-яё][а-яё-]{2,}$/.test(s)) return null;
  if (/[иы]я$/.test(s)) return s.slice(0, -1) + 'ям';   // категория → категориям
  if (/[иы]е$/.test(s)) return s.slice(0, -1) + 'ям';   // направление → направлениям
  if (/я$/.test(s)) return s.slice(0, -1) + 'ям';       // статья → статьям
  if (/[ьй]$/.test(s)) return s.slice(0, -1) + 'ям';    // область → областям
  if (/[аоеу]$/.test(s)) return s.slice(0, -1) + 'ам';  // платформа → платформам
  return s + 'ам';                                      // филиал → филиалам
}
function autoAdjDative(word) {
  const s = String(word || '').toLowerCase();
  if (!/(ый|ой|ая|яя|ое|ее|ний|кий|ший|щий|жий|чий)$/.test(s) || s.length < 6) return null;
  const soft = /(яя|ее|ний|ший|щий|жий|чий)$/.test(s);
  return s.slice(0, -2) + (soft ? 'им' : 'ым');
}
function autoDative(label) {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 2) return null;
  const noun = autoNounDative(words[words.length - 1]);
  if (!noun) return null;
  if (words.length === 1) return noun;
  const adj = autoAdjDative(words[0]);
  if (adj) return adj + ' ' + noun;                     // федеральный округ → федеральным округам
  const first = autoNounDative(words[0]);               // канал продаж → каналам продаж
  return first ? first + ' ' + words[1].toLowerCase() : null;
}
/* «Выручка» + «Филиал» → «Выручка по филиалам», иначе «Выручка: Филиал» */
function autoTitleBy(metricTitle, dimLabel) {
  const d = autoDative(dimLabel);
  return d ? `${metricTitle} по ${d}` : `${metricTitle}: ${dimLabel}`;
}

/* ---------- Подбор метрик ---------- */
function autoIsRowCount(ds, m) {
  if (m.kind !== 'saved') return m.agg === 'COUNT' && (!m.col || m.col === '*');
  const s = (ds.metrics || []).find(x => x.key === m.key);
  return !!(s && s.expr && s.expr.type === 'simple' && s.expr.agg === 'COUNT' && (!s.expr.col || s.expr.col === '*'));
}
/* Чем меньше, тем охотнее метрика становится главной:
   деньги → прочие числа → проценты → количество строк. */
function autoMetricRank(ds, m) {
  if (autoIsRowCount(ds, m)) return 4;
  const fmt = metricFormat(ds, m), label = metricLabel(ds, m);
  if (/^rub/.test(fmt) || AUTO_MONEY_RE.test(label)) return 0;
  if (fmt === 'pct' || AUTO_PCT_RE.test(label)) return 3;
  return 1;
}
/* Метрики набора в порядке осмысленности. Нет сохранённых — считаем суммы сами. */
function autoMetrics(ds) {
  let list = (ds.metrics || []).map(m => ({ kind: 'saved', key: m.key }));
  if (!list.length) {
    list = ds.columns.filter(c => c.type === 'number').slice(0, 4).map(c => ({ kind: 'simple', agg: 'SUM', col: c.key }));
    list.push({ kind: 'simple', agg: 'COUNT', col: '*' });
  }
  return list
    .map((m, i) => ({ m, i, rank: autoMetricRank(ds, m) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.m);
}
/* «Сумма: Выручка, ₽» → «Выручка»: в заголовке графика агрегат и единица лишние */
function autoMetricTitle(ds, m) {
  const full = metricLabel(ds, m);
  const short = full.replace(AUTO_AGG_PREFIX, '').replace(AUTO_UNIT_TAIL, '').trim();
  return short || full;
}

/* ---------- Подбор разрезов ---------- */
function autoDims(ds, max = AUTO_DIMS_MAX) {
  const out = [];
  for (const c of ds.columns) {
    if (c.type !== 'string') continue;
    if (AUTO_ID_RE.test(c.key + ' ' + (c.label || ''))) continue;
    const card = distinctValues(ds, c.key, [], AUTO_DIM_CARD_MAX + 1).length;
    if (card < 2 || card > AUTO_DIM_CARD_MAX) continue;
    out.push({ key: c.key, label: colLabel(ds, c.key), card });
    if (out.length >= max) break;
  }
  return out;
}
function autoDateCol(ds) {
  const key = ds.mainDttm || (ds.columns.find(c => c.type === 'date') || {}).key;
  const c = key && dsCol(ds, key);
  return c && c.type === 'date' ? key : null;
}
/* Номер документа — то, что autoDims отбрасывает как идентификатор.
   Нужен, чтобы отличить средний чек от средней строки заказа. */
function autoDocIdCol(ds) {
  for (const c of ds.columns) {
    if (c.type !== 'string' && c.type !== 'number') continue;
    if (!AUTO_ID_RE.test(c.key + ' ' + (c.label || ''))) continue;
    return c.key;
  }
  return null;
}

/* Этап воронки и план — роли, которые нужны не всем шаблонам, но угадываются так же */
const AUTO_STAGE_RE = /этап|стади|шаг|воронк|stage|статус|состояни/i;
const AUTO_STAGE_ORDER_RE = /порядок|очерёдн|очередн|номер этапа|order|seq/i;
const AUTO_PLAN_RE = /план|цель|норма|целев|target|plan|quota/i;
function autoStageCol(ds, dims) {
  const hit = (dims || autoDims(ds, 20)).find(d => AUTO_STAGE_RE.test(d.label + ' ' + d.key));
  return hit ? hit.key : null;
}
function autoStageOrderCol(ds) {
  const c = ds.columns.find(x => x.type === 'number' && AUTO_STAGE_ORDER_RE.test(x.key + ' ' + (x.label || '')));
  return c ? c.key : null;
}
/* План — числовая колонка, названная планом; метрикой делаем сумму по ней */
function autoPlanMetric(ds) {
  const saved = (ds.metrics || []).find(m => AUTO_PLAN_RE.test(m.label));
  if (saved) return { kind: 'saved', key: saved.key };
  const c = ds.columns.find(x => x.type === 'number' && AUTO_PLAN_RE.test(x.key + ' ' + (x.label || '')));
  return c ? { kind: 'simple', agg: 'SUM', col: c.key } : null;
}

/* ---------- Роли полей ----------
   Единственная точка подбора: ею пользуются и черновик по набору, и шаблоны.
   Не хватает правила — дописывать сюда, тогда оба пути поумнеют разом. */
function pickRoles(ds) {
  const metrics = autoMetrics(ds);
  const rank = m => autoMetricRank(ds, m);
  const money = metrics.find(m => rank(m) === 0) || null;
  const count = metrics.find(m => rank(m) === 1) || null;
  const rows = metrics.find(m => autoIsRowCount(ds, m)) || { kind: 'simple', agg: 'COUNT', col: '*' };
  // Смотрим шире трёх разрезов: среди дальних колонок может прятаться этап воронки.
  // Каждый разрез — проход по строкам, поэтому предел держим скромным.
  const dims = autoDims(ds, 12);
  const stage = autoStageCol(ds, dims);
  // Этап — не обычный разрез: в разрезы он попадать не должен, иначе задвоится
  const plain = dims.filter(d => d.key !== stage).slice(0, AUTO_DIMS_MAX);
  const plan = autoPlanMetric(ds);
  return {
    date: autoDateCol(ds),
    docId: autoDocIdCol(ds),
    money: money && plan && sameMetric(money, plan) ? null : money,  // план фактом не считаем
    count, rows, plan,
    stage, stageOrder: stage ? autoStageOrderCol(ds) : null,
    main: money || count || rows,   // главный показатель дашборда
    dim1: plain[0] || null,
    dim2: plain[1] || null,
    dim3: plain[2] || null,
    dims: plain, metrics,
  };
}
const sameMetric = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/* ---------- Сборка ---------- */
/* Что получится: {charts:[{name,viz,params,size}], filters:[...]} — сначала план,
   потом раскладка, чтобы пустые блоки не оставляли дырок в сетке. */
function buildAutoDash(ds, opts = {}) {
  const roles = opts.roles || pickRoles(ds);
  const dt = roles.date;
  const mets = roles.metrics;
  const dims = roles.dims;
  const main = mets[0];
  const mainTitle = autoMetricTitle(ds, main);
  const kpi = (mets.filter(m => !autoIsRowCount(ds, m)).length ? mets.filter(m => !autoIsRowCount(ds, m)) : mets).slice(0, AUTO_KPI_MAX);
  const dBar = dims[0] || null;
  const dTable = dims[1] || dims[0] || null;
  const dPie = dims[2] || null;
  const charts = [];
  const add = (name, viz, params, size) => charts.push({ name, viz, params, size });

  if (opts.kpi !== false) kpi.forEach(m => {
    const title = autoMetricTitle(ds, m);
    if (dt) add(`${title} за месяц`, 'big_number_trend', { metric: m, time_col: dt, x_grain: 'month', value_mode: 'last', compare_lag: 1, skip_partial: true, subheader: title }, { w: kpi.length === 2 ? 6 : 4, h: 7 });
    else add(title, 'big_number', { metric: m, compare: 'none', subheader: `${title} за период` }, { w: kpi.length === 2 ? 6 : 4, h: 7 });
  });

  if (opts.trend !== false && dt) add(`${mainTitle} по месяцам`, 'line',
    { x_col: dt, x_grain: 'month', metrics: [main], smooth: true, markers: true, y_min_zero: true, show_legend: false },
    { w: 12, h: 12 });

  const hasBreak = opts.breakdown !== false && dBar;
  if (hasBreak) {
    add(autoTitleBy(mainTitle, dBar.label), 'bar',
      { x_col: dBar.key, metrics: [main], horizontal: dBar.card > 6, row_limit: 15, sort: 'value_desc', show_labels: !dPie && dBar.card <= 10, show_legend: false },
      { w: dPie ? 6 : 12, h: 12 });
    if (dPie) add(autoTitleBy(mainTitle, dPie.label), 'pie',
      { dim: dPie.key, metric: main, row_limit: 8, donut: true, label_type: 'pct', show_legend: true, legend_pos: 'right' },
      { w: 6, h: 12 });
  }

  if (opts.table !== false && dTable) {
    const tm = mets.slice(0, 3);
    const d = autoDative(dTable.label);
    add(d ? `Показатели по ${d}` : `Показатели: ${dTable.label}`, 'table',
      { mode: 'agg', groupby: [dTable.key], metrics: tm, row_limit: 100, page_size: '10', cell_bars: true, totals: true },
      { w: 12, h: 14 });
  }

  const filters = [];
  if (dt) filters.push({ id: uid('f_'), name: 'Период', type: 'time', datasetId: ds.id, col: dt, value: { preset: 'last_12m' }, def: { preset: 'last_12m' }, scope: 'all' });
  dims.slice(0, 2).forEach(d => filters.push({ id: uid('f_'), name: d.label, type: 'select', datasetId: ds.id, col: d.key, multi: true, value: [], def: [], scope: 'all', dependent: true }));

  return { charts, filters, hasBreak, dt, dims, mainTitle };
}

/* Собирает графики и дашборд, пишет их в STATE и открывает в режиме правки */
function createAutoDash(ds, title, opts = {}) {
  const plan = buildAutoDash(ds, opts);
  if (!plan.charts.length) { toast('По этому набору нечего собрать: нужна хотя бы одна числовая или текстовая колонка', true); return null; }
  const items = [];
  let y = 0;
  const note = `**Черновик**, собранный Коброй по набору «${ds.name}». `
    + (isSchemaDs(ds) ? SCHEMA_NOTE : 'Правьте графики, фильтры и раскладку: это отправная точка, а не готовый отчёт.');
  items.push({ i: uid('i'), type: 'markdown', x: 0, y, w: 12, h: 3, text: note });
  y += 3;
  // Раскладка по той же сетке 12 колонок: кладём слева направо, не влезло — новый ряд
  let x = 0, rowH = 0;
  const place = (w, hh) => {
    if (x + w > G_COLS) { y += rowH; x = 0; rowH = 0; }
    const pos = { x, y, w, h: hh };
    x += w; rowH = Math.max(rowH, hh);
    return pos;
  };
  const newRow = () => { if (x) { y += rowH; x = 0; rowH = 0; } };
  plan.charts.forEach(c => {
    const id = uid('c_');
    STATE.charts[id] = { id, name: c.name, viz: c.viz, datasetId: ds.id, params: Object.assign(VIZ[c.viz].defaults(ds), c.params), updated: Date.now() };
    const sz = c.size || itemDefaultSize('chart', STATE.charts[id]);
    // Заголовок-раздел перед разрезами: отделяет «что происходит» от «за счёт чего»
    if (c.viz === 'bar' && plan.hasBreak) { newRow(); items.push(Object.assign({ i: uid('i'), type: 'header', text: 'Разрезы', size: 'm', bg: false }, place(12, 2))); newRow(); }
    items.push(Object.assign({ i: uid('i'), type: 'chart', chartId: id }, place(sz.w, sz.h)));
  });
  compactLayout(items);

  const id = uid('d_');
  STATE.dashboards[id] = {
    id, title, updated: Date.now(), crossFilter: true, scheme: null,
    tabs: [{ id: uid('t'), title: 'Обзор', items }],
    filters: plan.filters,
  };
  saveState();
  return id;
}

/* ---------- Диалог ---------- */
function openAutoDashDialog(dsId) {
  const ds = DS[dsId];
  if (!ds) return;
  if (!ds.rows.length) { toast('В наборе нет строк: собирать дашборд не из чего', true); return; }
  let title = ds.name;
  const opts = { kpi: true, trend: true, breakdown: true, table: true };
  const plan = buildAutoDash(ds, opts);
  const dt = plan.dt;
  const dimsTxt = plan.dims.length ? plan.dims.map(d => d.label).join(', ') : 'не нашлись';
  const body = h('div', null,
    field('Название дашборда', h('input', { class: 'input', value: title, oninput: e => { title = e.target.value; } })),
    h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Что собрать'),
      checkbox('Плитки с главными числами', opts.kpi, v => { opts.kpi = v; }),
      checkbox('Динамику по месяцам', opts.trend, v => { opts.trend = v; }),
      checkbox('Разрезы: столбцы и круговую', opts.breakdown, v => { opts.breakdown = v; }),
      checkbox('Таблицу с показателями', opts.table, v => { opts.table = v; })),
    h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '4px 0 0' } },
      `Главный показатель — «${plan.mainTitle}». Разрезы: ${dimsTxt}. `
      + (dt ? `Ось времени — «${colLabel(ds, dt)}», фильтр периода встанет на последние 12 месяцев.` : 'Колонки с датой нет: динамику построить не из чего.')),
    h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 0' } },
      'Это черновик: графики, фильтры и раскладку можно править как обычно, а лишнее — удалить.'));
  openModal({
    title: 'Собрать черновик дашборда', body,
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => {
        if (!opts.kpi && !opts.trend && !opts.breakdown && !opts.table) { toast('Отметьте хотя бы один блок', true); return; }
        const id = createAutoDash(ds, title.trim() || ds.name, opts);
        if (!id) return;
        close();
        toast('Черновик собран: правьте и сохраняйте');
        go('#/d/' + id + '?edit=1');
      } }, ic('wand'), 'Собрать')],
  });
}

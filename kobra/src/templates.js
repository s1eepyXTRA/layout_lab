/* ============================================================
   Кобра · готовые шаблоны
   Шаблон — это скелет из уровней детализации: сводка (что происходит),
   разбор (за счёт чего), документы (исходные строки). Блоки ссылаются
   на роли полей, а не на колонки, поэтому один шаблон ложится на любой
   набор, где роли удаётся заполнить. Вид процесса меняет наполнение
   уровней, но не сам скелет.
   Подбор колонок под роли живёт в autodash.js (pickRoles) — здесь своих
   эвристик нет намеренно, иначе они разъедутся.
   ============================================================ */

/* ---------- Роли: как они называются для человека ---------- */
const TPL_ROLES = {
  date: { label: 'Дата', hint: 'по какой колонке считать время', type: 'date' },
  money: { label: 'Деньги', hint: 'что считаем деньгами', type: 'metric' },
  count: { label: 'Количество', hint: 'что считаем штуками', type: 'metric' },
  plan: { label: 'План', hint: 'с чем сравниваем факт', type: 'metric' },
  docId: { label: 'Номер документа', hint: 'что отличает один документ от другого', type: 'string' },
  stage: { label: 'Этап', hint: 'какой шаг процесса прошёл клиент', type: 'string' },
  dim1: { label: 'Главный разрез', hint: 'в разрезе чего смотрим в первую очередь', type: 'string' },
  dim2: { label: 'Второй разрез', hint: 'чем дополняем картину', type: 'string' },
  dim3: { label: 'Третий разрез', hint: 'что ещё полезно увидеть', type: 'string' },
};
const TPL_LEVELS = {
  sum: { title: 'Сводка', q: 'что происходит' },
  detail: { title: 'Разбор', q: 'за счёт чего' },
  docs: { title: 'Документы', q: 'какие именно строки' },
};

/* ---------- Производные показатели ----------
   Шаблон просит «деньги на документ», а не готовую метрику: если такой
   в наборе нет, Кобра её туда допишет (движок умеет отношения). */
const TPL_DERIVED = {
  avg_check: {
    label: 'Средний чек', format: 'rub', need: ['money', 'docId'],
    expr: r => ratioExpr(metricAggOf(r.ds, r.roles.money), { agg: 'COUNT_DISTINCT', col: r.roles.docId }),
  },
  plan_done: {
    label: 'Выполнение плана', format: 'pct', need: ['plan'],
    expr: r => ratioExpr(metricAggOf(r.ds, r.roles.money || r.roles.count || r.roles.rows), metricAggOf(r.ds, r.roles.plan)),
  },
};
/* Части отношения — это пары {agg, col} без поля type: именно так их хранит движок */
function metricAggOf(ds, m) {
  const e = metricExprOf(ds, m);
  if (!e || e.type === 'ratio') return null;   // отношение в отношение не вкладывается
  return { agg: e.agg, col: e.col };
}
const ratioExpr = (num, den) => (num && den ? { type: 'ratio', num, den } : null);
/* Метрика графика → выражение, пригодное для сохранённой метрики набора */
function metricExprOf(ds, m) {
  if (!m) return null;
  if (m.kind === 'saved') {
    const s = (ds.metrics || []).find(x => x.key === m.key);
    return s ? clone(s.expr) : null;
  }
  return { type: 'simple', agg: m.agg, col: m.col };
}
/* Ключ формулы: порядок полей не должен влиять на сравнение, иначе
   «такой показатель уже есть» не срабатывает и метрики задваиваются */
function exprKey(e) {
  if (e == null || typeof e !== 'object') return JSON.stringify(e);
  if (Array.isArray(e)) return '[' + e.map(exprKey).join(',') + ']';
  return '{' + Object.keys(e).sort().map(k => JSON.stringify(k) + ':' + exprKey(e[k])).join(',') + '}';
}

/* Ищем показатель в наборе по формуле, а не по названию: названия у всех разные */
function findMetricByExpr(ds, expr) {
  if (!expr) return null;
  const k = exprKey(expr);
  const hit = (ds.metrics || []).find(m => exprKey(m.expr) === k);
  return hit ? { kind: 'saved', key: hit.key } : null;
}
/* Что шаблон допишет в набор: считаем заранее, чтобы показать человеку до создания */
function plannedDerived(tpl, ds, roles) {
  const out = [];
  (tpl.derived || []).forEach(id => {
    const d = TPL_DERIVED[id];
    if (!d || d.need.some(r => !roles[r])) return;
    const expr = d.expr({ ds, roles });
    if (!expr || !expr.num || !expr.den) return;
    out.push({ id, label: d.label, format: d.format, expr, existing: findMetricByExpr(ds, expr) });
  });
  return out;
}
/* Создаёт недостающие показатели в наборе и отдаёт карту id → метрика графика */
function ensureDerived(tpl, ds, roles) {
  const map = {};
  plannedDerived(tpl, ds, roles).forEach(d => {
    if (d.existing) { map[d.id] = d.existing; return; }
    const key = uid('m_');
    ds.metrics = [...(ds.metrics || []), { key, label: d.label, expr: d.expr, format: d.format }];
    persistDs(ds);
    map[d.id] = { kind: 'saved', key };
  });
  return map;
}

/* Для примера на вымышленных данных набор в состояние не пишем */
function ensureDerivedInMemory(tpl, ds, roles) {
  const map = {};
  plannedDerived(tpl, ds, roles).forEach(d => {
    if (d.existing) { map[d.id] = d.existing; return; }
    const key = uid('m_');
    ds.metrics = [...(ds.metrics || []), { key, label: d.label, expr: d.expr, format: d.format }];
    map[d.id] = { kind: 'saved', key };
  });
  return map;
}

/* ---------- Пригодность шаблона ---------- */
function templateFits(tpl, ds, roles) {
  roles = roles || pickRoles(ds);
  const missing = (tpl.need || []).filter(r => !roles[r]);
  return { ok: !missing.length, missing, missingLabels: missing.map(r => (TPL_ROLES[r] || {}).label || r) };
}
/* Уровень документов бессмысленен там, где строка — уже агрегат */
const TPL_PREAGG_RE = /количество|кол-во|число|счётчик|счетчик|сумма строк|итого|qty|count|total/i;
function docsLevelFits(ds, roles) {
  if (!ds.columns.length) return { ok: false, why: 'в наборе нет колонок' };
  if (roles.docId) return { ok: true };
  const agg = ds.columns.find(c => c.type === 'number' && TPL_PREAGG_RE.test(c.label || c.key));
  if (agg) return { ok: false, why: `строка набора похожа на агрегат: в нём есть «${colLabel(ds, agg.key)}»` };
  return { ok: true };
}

/* ---------- Каталог ---------- */
/* Блок: {viz, by (роль разреза), metric (роль показателя), need, params, size}.
   Параметры всегда кладутся поверх VIZ[viz].defaults(ds) при сборке.
   `name` — название приёма: шаблон это скелет, и называть его как готовый отчёт
   («Продажи и выручка») нельзя — человек решит, что выбирает чужой дашборд.
   Отчётное название лежит отдельно в `dash` и подставляется собранному
   дашборду. `examples` — для чего это бывает полезно, живыми словами. */
/* Приём, а не отрасль: человек приходит с вопросом «как показать динамику»
   или «сравнить план с фактом», а не с названием шаблона. Чипы над каталогом
   переводят выбор на этот язык. */
const TPL_TAGS = {
  dynamics: 'Динамика во времени',
  parts: 'Состав и доли',
  stages: 'Этапы и переходы',
  plan: 'План против факта',
};
const TEMPLATES = [
  {
    id: 'overview',
    tags: ['dynamics', 'parts'],
    name: 'Показатель во времени и в разрезах',
    dash: 'Сводка процесса',
    desc: 'Самый универсальный скелет: один главный показатель — как он менялся, из чего складывается и какие строки за ним стоят. С него стоит начинать, если не уверены, что выбрать.',
    examples: ['выручка по филиалам и месяцам', 'количество заявок по категориям', 'объём выпуска по цехам', 'затраты по статьям'],
    need: ['date', 'dim1'],
    demo: ['Дата', 'Подразделение', 'Категория', 'Статус', 'Сумма, ₽', 'Количество, шт.'],
    derived: [],
    levels: [
      { id: 'sum', blocks: [
        { kind: 'kpi', metric: 'main', need: ['date'] },
        { kind: 'kpi', metric: 'rows', need: ['date'] },
        { viz: 'line', metric: 'main', by: 'date', need: ['date'], size: { w: 12, h: 12 } },
        { viz: 'bar', metric: 'main', by: 'dim1', need: ['dim1'], size: { w: 6, h: 12 } },
        { viz: 'pie', metric: 'main', by: 'dim2', need: ['dim2'], size: { w: 6, h: 12 } },
      ] },
      { id: 'detail', blocks: [
        { viz: 'area', metric: 'main', by: 'date', series: 'dim1', need: ['date', 'dim1'], size: { w: 12, h: 12 } },
        { viz: 'heatmap', metric: 'main', by: 'date', y: 'dim1', need: ['date', 'dim1'], size: { w: 12, h: 14 } },
        { viz: 'table', metric: 'main', by: 'dim1', need: ['dim1'], size: { w: 12, h: 14 } },
      ] },
      { id: 'docs', blocks: [{ kind: 'docs' }] },
    ],
  },
  {
    id: 'sales',
    tags: ['parts', 'dynamics'],
    name: 'Сумма денег и из чего она складывается',
    dash: 'Продажи и выручка',
    desc: 'Скелет для любой суммы в рублях: динамика, разрезы по товарам и каналам, средний чек и документы, из которых сумма набежала.',
    examples: ['выручка по категориям товаров', 'продажи по каналам и городам', 'поступления по договорам', 'закупки по поставщикам'],
    need: ['date', 'money', 'dim1'],
    demo: ['Дата заказа', 'Категория', 'Канал продаж', 'Город', 'Номер заказа', 'Выручка, ₽', 'Количество, шт.'],
    derived: ['avg_check'],
    levels: [
      { id: 'sum', blocks: [
        { kind: 'kpi', metric: 'money', need: ['date', 'money'] },
        { kind: 'kpi', metric: 'count', need: ['date', 'count'] },
        { kind: 'kpi', metric: 'avg_check', derived: true, need: ['avg_check'] },
        { viz: 'line', metric: 'money', by: 'date', need: ['date', 'money'], size: { w: 12, h: 12 } },
        { viz: 'bar', metric: 'money', by: 'dim1', need: ['dim1'], size: { w: 6, h: 12 }, params: { horizontal: true, row_limit: 15 } },
        { viz: 'pie', metric: 'money', by: 'dim2', need: ['dim2'], size: { w: 6, h: 12 } },
      ] },
      { id: 'detail', blocks: [
        { viz: 'area', metric: 'money', by: 'date', series: 'dim1', need: ['date', 'dim1'], size: { w: 12, h: 12 }, params: { stacked: true } },
        { viz: 'treemap', metric: 'money', by: 'dim1', by2: 'dim2', need: ['dim1'], size: { w: 6, h: 14 } },
        { viz: 'heatmap', metric: 'money', by: 'date', y: 'dim2', need: ['date', 'dim2'], size: { w: 6, h: 14 } },
        { viz: 'table', metric: 'money', by: 'dim1', extra: ['count', 'avg_check'], need: ['dim1'], size: { w: 12, h: 14 } },
      ] },
      { id: 'docs', blocks: [{ kind: 'docs' }] },
    ],
  },
  {
    id: 'funnel',
    tags: ['stages'],
    name: 'Этапы и потери между ними',
    dash: 'Воронка и конверсия',
    desc: 'Скелет для процесса, который проходят по шагам: сколько дошло до каждого этапа, где отваливаются и чем различаются источники.',
    examples: ['путь от корзины до оплаты', 'подбор: от отклика до оффера', 'согласование заявки по стадиям', 'сделки по стадиям переговоров'],
    need: ['stage'],
    demo: ['Дата', { label: 'Этап', values: ['Посещение', 'Карточка товара', 'Корзина', 'Оформление', 'Оплата'] }, 'Источник трафика', 'Платформа', 'Пользователи, шт.'],
    derived: [],
    levels: [
      { id: 'sum', blocks: [
        { viz: 'funnel', metric: 'main', by: 'stage', need: ['stage'], size: { w: 5, h: 14 } },
        { viz: 'bar', metric: 'main', by: 'stage', series: 'dim1', need: ['stage'], size: { w: 7, h: 14 }, params: { horizontal: true, stacked: true } },
        { viz: 'line', metric: 'main', by: 'date', series: 'stage', need: ['date', 'stage'], size: { w: 12, h: 12 } },
      ] },
      { id: 'detail', blocks: [
        { viz: 'pie', metric: 'main', by: 'dim1', need: ['dim1'], size: { w: 6, h: 12 } },
        { viz: 'heatmap', metric: 'main', by: 'date', y: 'stage', need: ['date', 'stage'], size: { w: 6, h: 12 } },
        { viz: 'pivot', metric: 'main', by: 'stage', cols: 'dim1', need: ['stage', 'dim1'], size: { w: 12, h: 14 } },
      ] },
      { id: 'docs', blocks: [{ kind: 'docs' }] },
    ],
  },
  {
    id: 'flow',
    tags: ['dynamics', 'parts'],
    name: 'Поступление и состояния',
    dash: 'Поток обращений',
    desc: 'Скелет там, где строка — это заявка или обращение: сколько пришло по неделям, в каких состояниях лежит и у кого.',
    examples: ['обращения в поддержку по статусам', 'заявки на закупку по ответственным', 'инциденты по типам', 'рекламации по подразделениям'],
    need: ['date', 'dim1'],
    demo: ['Дата заявки', 'Статус', 'Ответственный', 'Категория', 'Номер заявки', 'Время обработки, мин'],
    derived: [],
    levels: [
      { id: 'sum', blocks: [
        { kind: 'kpi', metric: 'rows', need: ['date'] },
        { kind: 'kpi', metric: 'count', need: ['date', 'count'] },
        { viz: 'line', metric: 'rows', by: 'date', need: ['date'], size: { w: 12, h: 12 }, params: { x_grain: 'week', rolling: 4 } },
        { viz: 'bar', metric: 'rows', by: 'dim1', need: ['dim1'], size: { w: 6, h: 12 } },
        { viz: 'bar', metric: 'rows', by: 'dim2', need: ['dim2'], size: { w: 6, h: 12 }, params: { horizontal: true, row_limit: 15 } },
      ] },
      { id: 'detail', blocks: [
        { viz: 'heatmap', metric: 'rows', by: 'date', y: 'dim1', need: ['date', 'dim1'], size: { w: 12, h: 14 }, params: { normalize: 'y' } },
        { viz: 'area', metric: 'rows', by: 'date', series: 'dim1', need: ['date', 'dim1'], size: { w: 12, h: 12 }, params: { stacked: true, expand: true } },
        { viz: 'table', metric: 'rows', by: 'dim2', extra: ['count'], need: ['dim2'], size: { w: 12, h: 14 } },
      ] },
      { id: 'docs', blocks: [{ kind: 'docs' }] },
    ],
  },
  {
    id: 'planfact',
    tags: ['plan'],
    name: 'Факт против плана',
    dash: 'План и факт',
    desc: 'Скелет для случая, когда рядом с фактом лежит цель: выполнение по времени и по разрезам, процент и отставание. План должен быть в тех же данных, что и факт.',
    examples: ['план продаж по филиалам', 'бюджет: план и расход по статьям', 'производственный план по цехам', 'цели отдела за квартал'],
    need: ['plan', 'dim1'],
    demo: ['Дата', 'Подразделение', 'Категория', 'Факт, ₽', 'План, ₽'],
    derived: ['plan_done'],
    levels: [
      { id: 'sum', blocks: [
        { kind: 'kpi', metric: 'main', need: ['date'] },
        { kind: 'kpi', metric: 'plan', need: ['date', 'plan'] },
        { kind: 'kpi', metric: 'plan_done', derived: true, need: ['plan_done'] },
        { viz: 'mixed', metric: 'main', metricB: 'plan', by: 'date', need: ['date', 'plan'], size: { w: 12, h: 13 } },
        { viz: 'bar', metric: 'main', extra: ['plan'], by: 'dim1', need: ['dim1', 'plan'], size: { w: 12, h: 12 } },
      ] },
      { id: 'detail', blocks: [
        { viz: 'bar', metric: 'plan_done', by: 'dim1', derivedMetric: true, need: ['dim1', 'plan_done'], size: { w: 6, h: 12 }, params: { sort: 'value_asc' } },
        { viz: 'heatmap', metric: 'plan_done', by: 'date', y: 'dim1', derivedMetric: true, need: ['date', 'dim1', 'plan_done'], size: { w: 6, h: 12 }, params: { seq_scheme: 'rdylgn', normalize: 'none' } },
        { viz: 'table', metric: 'main', extra: ['plan', 'plan_done'], by: 'dim1', need: ['dim1', 'plan'], size: { w: 12, h: 14 } },
      ] },
      { id: 'docs', blocks: [{ kind: 'docs' }] },
    ],
  },
];
const tplById = id => TEMPLATES.find(t => t.id === id) || null;
/* Название для собранного дашборда: отчётное, а не название приёма */
const tplDashName = tpl => (tpl && (tpl.dash || tpl.name)) || 'Шаблон';

/* ---------- Сборка дашборда из шаблона ---------- */
/* Роль показателя → метрика графика. Производные уже созданы в наборе. */
function tplMetric(name, roles, derived) {
  if (!name) return null;
  if (derived && derived[name]) return derived[name];
  if (name === 'main') return roles.main;
  if (name === 'rows') return roles.rows;
  return roles[name] || null;
}
/* Роль разреза → ключ колонки */
function tplDimKey(name, roles) {
  if (!name) return null;
  if (name === 'date') return roles.date;
  if (name === 'stage') return roles.stage;
  if (name === 'docId') return roles.docId;
  const d = roles[name];
  return d && d.key ? d.key : null;
}
function tplHas(name, roles, derived) {
  if (!name) return false;
  if (derived && derived[name]) return true;
  const r = TPL_ROLES[name];
  if (r && (r.type === 'string' || r.type === 'date')) return !!tplDimKey(name, roles);
  return !!tplMetric(name, roles, derived);
}
/* Колонка, по которой считается метрика: нужна таблице исходных строк */
function metricCol(ds, m) {
  const e = metricExprOf(ds, m);
  if (!e) return null;
  if (e.type === 'ratio') return (e.num || {}).col || null;
  return e.col === '*' ? null : e.col;
}
function tplTitle(ds, metric, dimLabel, dateBy) {
  const t = autoMetricTitle(ds, metric);
  if (dateBy) return `${t} по месяцам`;
  return dimLabel ? autoTitleBy(t, dimLabel) : t;
}
const tplDimLabel = (ds, key) => key ? colLabel(ds, key) : '';

/* Блок шаблона → график {name, viz, params, size} либо null, если нечем строить */
function tplBlockChart(b, ds, roles, derived) {
  const met = tplMetric(b.metric, roles, derived);
  const dim = tplDimKey(b.by, roles);
  const dimL = tplDimLabel(ds, dim);
  const extra = (b.extra || []).map(n => tplMetric(n, roles, derived)).filter(Boolean);
  const size = b.size || null;
  const p = o => Object.assign(o, b.params || {});

  if (b.kind === 'kpi') {
    if (!met) return null;
    const title = autoMetricTitle(ds, met);
    if (roles.date) return { name: `${title} за месяц`, viz: 'big_number_trend', size: size || { w: 4, h: 7 },
      params: p({ metric: met, time_col: roles.date, x_grain: 'month', value_mode: 'last', compare_lag: 1, skip_partial: true, subheader: title }) };
    return { name: title, viz: 'big_number', size: size || { w: 4, h: 7 }, params: p({ metric: met, compare: 'none', subheader: `${title} за период` }) };
  }
  if (b.kind === 'docs') {
    const cols = [];
    const push = k => { if (k && !cols.includes(k) && dsCol(ds, k)) cols.push(k); };
    push(roles.date); push(roles.docId); push(roles.stage);
    roles.dims.forEach(d => push(d.key));
    push(metricCol(ds, roles.money)); push(metricCol(ds, roles.count)); push(metricCol(ds, roles.plan));
    ds.columns.forEach(c => { if (cols.length < 8) push(c.key); });
    return { name: 'Исходные строки', viz: 'table', size: size || { w: 12, h: 18 },
      params: p({ mode: 'raw', columns: cols.slice(0, 8), order_col: roles.date || null, order_desc: true, search: true, page_size: '25', row_limit: 500 }) };
  }
  if (!met) return null;

  switch (b.viz) {
    case 'line': {
      const series = tplDimKey(b.series, roles);
      if (!roles.date) return null;
      return { name: tplTitle(ds, met, null, true), viz: 'line', size,
        params: p({ x_col: roles.date, x_grain: 'month', metrics: [met], series_col: series || null, smooth: true, markers: !series, y_min_zero: true, show_legend: !!series }) };
    }
    case 'area': {
      const series = tplDimKey(b.series, roles);
      if (!roles.date) return null;
      return { name: series ? `${autoMetricTitle(ds, met)} по месяцам: ${tplDimLabel(ds, series)}` : tplTitle(ds, met, null, true), viz: 'area', size,
        params: p({ x_col: roles.date, x_grain: 'month', metrics: [met], series_col: series || null, stacked: true, smooth: true, show_legend: !!series }) };
    }
    case 'bar': {
      if (!dim) return null;
      const series = tplDimKey(b.series, roles);
      return { name: tplTitle(ds, met, dimL), viz: 'bar', size,
        params: p({ x_col: dim, metrics: [met, ...extra], series_col: series || null, sort: 'value_desc', row_limit: 15, show_legend: !!(series || extra.length) }) };
    }
    case 'pie':
      if (!dim) return null;
      return { name: tplTitle(ds, met, dimL), viz: 'pie', size,
        params: p({ dim, metric: met, row_limit: 8, donut: true, label_type: 'pct', show_legend: true, legend_pos: 'right' }) };
    case 'funnel':
      if (!dim) return null;
      return { name: 'Воронка по этапам', viz: 'funnel', size,
        params: p({ dim, metric: met, order_by: roles.stageOrder || null, row_limit: 12, label_type: 'pct_first' }) };
    case 'treemap': {
      const d2 = tplDimKey(b.by2, roles);
      const gb = [dim, d2].filter(Boolean);
      if (!gb.length) return null;
      // Заголовок отличаем от столбчатой по тому же разрезу: иначе на дашборде два одинаковых
      const nm = d2 ? `${autoMetricTitle(ds, met)}: ${dimL} и ${tplDimLabel(ds, d2)}` : `Структура: ${tplTitle(ds, met, dimL)}`;
      return { name: nm, viz: 'treemap', size, params: p({ groupby: gb, metric: met, show_pct: true }) };
    }
    case 'heatmap': {
      const y = tplDimKey(b.y, roles);
      if (!roles.date || !y) return null;
      return { name: `${autoMetricTitle(ds, met)}: ${tplDimLabel(ds, y)} по месяцам`, viz: 'heatmap', size,
        params: p({ x_col: roles.date, y_col: y, x_grain: 'month', metric: met, seq_scheme: 'jade', normalize: 'all', y_limit: 20 }) };
    }
    case 'pivot': {
      const cols = tplDimKey(b.cols, roles);
      if (!dim || !cols) return null;
      return { name: `${autoMetricTitle(ds, met)}: ${dimL} × ${tplDimLabel(ds, cols)}`, viz: 'pivot', size,
        params: p({ rows: [dim], cols: [cols], metrics: [met], heat: true }) };
    }
    case 'mixed': {
      const mb = tplMetric(b.metricB, roles, derived);
      if (!roles.date || !mb) return null;
      return { name: `${autoMetricTitle(ds, met)} и ${autoMetricTitle(ds, mb)} по месяцам`, viz: 'mixed', size,
        params: p({ x_col: roles.date, x_grain: 'month', metrics: [met], metrics_b: [mb], type_a: 'bar', type_b: 'line', axis_b: 'left', smooth: true }) };
    }
    case 'table': {
      if (!dim) return null;
      const d = autoDative(dimL);
      return { name: d ? `Показатели по ${d}` : `Показатели: ${dimL}`, viz: 'table', size,
        params: p({ mode: 'agg', groupby: [dim], metrics: [met, ...extra], row_limit: 100, page_size: '10', cell_bars: true, totals: true }) };
    }
  }
  return null;
}

/* План дашборда: {levels:[{id,title,charts[]}], filters[], skipped[]} — сначала план,
   потом раскладка, чтобы пропущенные блоки не оставляли дырок в сетке. */
function buildFromTemplate(tpl, ds, roles, levelIds, derived) {
  const want = levelIds && levelIds.length ? levelIds : tpl.levels.map(l => l.id);
  const skipped = [];
  const levels = [];
  tpl.levels.forEach(lv => {
    if (!want.includes(lv.id)) return;
    const charts = [];
    lv.blocks.forEach(b => {
      const miss = (b.need || []).filter(n => !tplHas(n, roles, derived));
      if (miss.length) { skipped.push({ level: lv.id, need: miss }); return; }
      const c = tplBlockChart(b, ds, roles, derived);
      if (c) charts.push(c); else skipped.push({ level: lv.id, need: [b.metric || b.by || b.viz] });
    });
    if (charts.length) levels.push({ id: lv.id, title: TPL_LEVELS[lv.id].title, charts });
  });
  const filters = [];
  if (roles.date) filters.push({ id: uid('f_'), name: 'Период', type: 'time', datasetId: ds.id, col: roles.date, value: { preset: 'last_12m' }, def: { preset: 'last_12m' }, scope: 'all' });
  roles.dims.slice(0, 2).forEach(d => filters.push({ id: uid('f_'), name: d.label, type: 'select', datasetId: ds.id, col: d.key, multi: true, value: [], def: [], scope: 'all', dependent: true }));
  if (roles.stage) filters.push({ id: uid('f_'), name: colLabel(ds, roles.stage), type: 'select', datasetId: ds.id, col: roles.stage, multi: true, value: [], def: [], scope: 'all', dependent: false });
  return { levels, filters, skipped };
}

/* Раскладка блоков уровня по сетке 12 колонок, слева направо */
function tplLayout(charts, ds, intro, preview) {
  const items = [];
  let x = 0, y = 0, rowH = 0;
  if (intro) { items.push({ i: uid('i'), type: 'markdown', x: 0, y: 0, w: 12, h: 3, text: intro }); y = 3; }
  const place = (w, hh) => {
    if (x + w > G_COLS) { y += rowH; x = 0; rowH = 0; }
    const pos = { x, y, w, h: hh };
    x += w; rowH = Math.max(rowH, hh);
    return pos;
  };
  charts.forEach(c => {
    const id = uid('c_');
    STATE.charts[id] = { id, name: c.name, viz: c.viz, datasetId: ds.id, autoName: true, preview: preview || undefined, params: Object.assign(VIZ[c.viz].defaults(ds), c.params), updated: Date.now() };
    const sz = c.size || itemDefaultSize('chart', STATE.charts[id]);
    items.push(Object.assign({ i: uid('i'), type: 'chart', chartId: id }, place(sz.w, sz.h)));
  });
  compactLayout(items);
  return items;
}

/* Макет: данных нет, набор порождается под дашборд и прячется за ним */
/** @param {{title?: string, levels?: string[]}} [opts] */
function createMockup(tpl, opts = {}) {
  const { title, levels } = opts;
  const name = (title || (tpl ? tplDashName(tpl) : 'Шаблон')).trim() || 'Шаблон';
  const dashId = uid('d_');
  const dsId = saveSchemaDataset({ name: `Данные макета «${name}»`, schema: mockupSchema(tpl), owner: dashId });
  if (!tpl) { emptyMockup(dashId, dsId, name); return dashId; }
  const id = createFromTemplate(tpl, DS[dsId], { title: name, levels, dashId });
  if (!id) { delete STATE.datasets[dsId]; delete DS[dsId]; saveState(); return null; }
  return id;
}
/* Пустой макет: блоков нет, но данные под них уже готовы */
function emptyMockup(dashId, dsId, name) {
  STATE.dashboards[dashId] = {
    id: dashId, title: name, updated: Date.now(), crossFilter: true, scheme: null,
    tabs: [{ id: uid('t'), title: TPL_LEVELS.sum.title, level: 'sum', items: [] }],
    filters: [],
    fromTemplate: { tplId: null, datasetId: dsId, levels: ['sum'], roles: tplRoleMap(pickRoles(DS[dsId])) },
  };
  saveState();
}

/* Создаёт дашборд из шаблона, пишет его в STATE и возвращает id */
/** @param {{title?: string, roles?: any, levels?: string[], preview?: boolean, dashId?: string}} [opts] */
function createFromTemplate(tpl, ds, opts = {}) {
  let { title, roles, levels, preview, dashId } = opts;
  roles = roles || pickRoles(ds);
  const derived = preview ? ensureDerivedInMemory(tpl, ds, roles) : ensureDerived(tpl, ds, roles);
  const plan = buildFromTemplate(tpl, ds, roles, levels, derived);
  if (!plan.levels.length) { toast('По этому набору шаблон собрать нечем', true); return null; }
  // Подсказка словами, а не кнопкой: переход между уровнями делается теми же
  // средствами, что есть в обычной BI — кликом по графику и переключением вкладки
  const deeper = plan.levels[1]
    ? ` Чтобы углубиться, кликните по столбцу или сектору — остальные блоки отфильтруются — и перейдите на вкладку «${plan.levels[1].title}».`
    : '';
  const intro = `**${tplDashName(tpl)}.** ${TPL_LEVELS[plan.levels[0].id].q[0].toUpperCase() + TPL_LEVELS[plan.levels[0].id].q.slice(1)}.`
    + deeper + ' '
    + (isSchemaDs(ds) ? SCHEMA_NOTE : 'Собрано по готовому шаблону: правьте названия, разрезы и состав как обычно.');
  const tabs = plan.levels.map((lv, i) => ({
    id: uid('t'), title: lv.title, level: lv.id,
    items: tplLayout(lv.charts, ds, i === 0 ? intro : null, preview),
  }));
  const id = dashId || uid('d_');
  STATE.dashboards[id] = {
    id, title: title || tplDashName(tpl), updated: Date.now(), crossFilter: true, scheme: null, tabs, filters: plan.filters,
    preview: preview || undefined,
    fromTemplate: { tplId: tpl.id, datasetId: ds.id, levels: plan.levels.map(l => l.id), roles: tplRoleMap(roles) },
  };
  if (!preview) saveState();
  return id;
}
/* Карта ролей для хранения: только то, что нужно простой правке и провалу */
function tplRoleMap(roles) {
  return {
    date: roles.date || null, docId: roles.docId || null, stage: roles.stage || null,
    dim1: roles.dim1 ? roles.dim1.key : null, dim2: roles.dim2 ? roles.dim2.key : null, dim3: roles.dim3 ? roles.dim3.key : null,
  };
}

/* ---------- Выбор колонок под роли ---------- */
/* Варианты для роли: колонки подходящего типа либо показатели набора */
function roleOptions(ds, name) {
  const r = TPL_ROLES[name] || {};
  if (r.type === 'metric') {
    const out = (ds.metrics || []).map(m => ({ metric: { kind: 'saved', key: m.key }, label: m.label }));
    ds.columns.filter(c => c.type === 'number').forEach(c =>
      out.push({ metric: { kind: 'simple', agg: 'SUM', col: c.key }, label: 'Сумма: ' + colLabel(ds, c.key) }));
    return out;
  }
  const type = r.type === 'date' ? 'date' : 'string';
  const cols = ds.columns.filter(c => c.type === type || (name === 'docId' && c.type === 'number'));
  return cols.map(c => ({ key: c.key, label: colLabel(ds, c.key) }));
}
/* Текущее значение роли как подпись */
function roleValueLabel(ds, roles, name) {
  const r = TPL_ROLES[name] || {};
  if (r.type === 'metric') { const m = tplMetric(name, roles, null); return m ? metricLabel(ds, m) : null; }
  const k = tplDimKey(name, roles);
  return k ? colLabel(ds, k) : null;
}
function setRole(ds, roles, name, opt) {
  const r = TPL_ROLES[name] || {};
  if (r.type === 'metric') { roles[name] = opt ? opt.metric : null; roles.main = roles.money || roles.count || roles.rows; return; }
  if (name === 'dim1' || name === 'dim2' || name === 'dim3') {
    roles[name] = opt ? { key: opt.key, label: opt.label, card: 0 } : null;
    roles.dims = ['dim1', 'dim2', 'dim3'].map(k => roles[k]).filter(Boolean);
    return;
  }
  roles[name] = opt ? opt.key : null;
}
/* Роли, которые шаблон вообще использует: спрашивать про лишние незачем */
function tplUsedRoles(tpl) {
  const used = new Set(tpl.need || []);
  // Роли, от которых зависят производные показатели: без них человек не сможет
  // поправить подбор, а средний чек молча посчитается не по тому полю
  (tpl.derived || []).forEach(id => ((TPL_DERIVED[id] || {}).need || []).forEach(n => { if (TPL_ROLES[n]) used.add(n); }));
  tpl.levels.forEach(l => l.blocks.forEach(b => {
    (b.need || []).forEach(n => { if (TPL_ROLES[n]) used.add(n); });
    [b.metric, b.metricB, b.by, b.by2, b.y, b.series, b.cols, ...(b.extra || [])].forEach(n => { if (n && TPL_ROLES[n]) used.add(n); });
  }));
  return [...used];
}

/* ---------- Окно создания из шаблона ---------- */
function openTemplateDialog(tpl, dsId, opts = {}) {
  // Без набора — путь макета: данные Кобра придумает сама, роли спрашивать не о чем
  const mockup = !dsId;
  let title = tplDashName(tpl);
  const ds = mockup ? mockupDatasetDraft(tpl, title) : DS[dsId];
  if (!ds) { toast('Набор данных не найден', true); return; }
  const roles = pickRoles(ds);
  const docsFit = docsLevelFits(ds, roles);
  const levels = { sum: true, detail: true, docs: docsFit.ok };
  const body = h('div');
  const used = mockup ? [] : tplUsedRoles(tpl).filter(n => TPL_ROLES[n]);

  const paint = () => {
    clear(body);
    body.appendChild(field('Название шаблона', h('input', { class: 'input', value: title, oninput: e => { title = e.target.value; } })));

    if (mockup) body.appendChild(h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 12px' } },
      'Данные Кобра придумает сама. Названия блоков, показателей и категорий поменяете прямо в шаблоне.'));
    // Роли
    const rolesBox = h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Какие поля во что идут'),
      h('div', { class: 'hint', style: { marginBottom: '6px' } }, 'Кобра подобрала их сама — поменяйте, если взяла не то.'));
    used.forEach(name => {
      const r = TPL_ROLES[name];
      const options = roleOptions(ds, name);
      const cur = roleValueLabel(ds, roles, name);
      const required = (tpl.need || []).includes(name);
      const sel = selectEl(
        [['', required ? '— не выбрано —' : '— не нужно —'], ...options.map((o, i) => [String(i), o.label])],
        String(options.findIndex(o => o.label === cur)),
        v => { setRole(ds, roles, name, v === '' || +v < 0 ? null : options[+v]); paint(); },
        { 'aria-label': r.label });
      rolesBox.appendChild(h('div', { class: 'row2', style: { marginBottom: '6px', alignItems: 'center' } },
        h('div', null, h('b', { style: { fontSize: '13px' } }, r.label + (required ? '' : ' (если есть)')),
          h('div', { class: 'hint' }, r.hint)), sel));
    });
    if (!mockup) body.appendChild(rolesBox);

    // Уровни
    const lvBox = h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Уровни детализации'));
    tpl.levels.forEach(l => {
      const meta = TPL_LEVELS[l.id];
      const off = l.id === 'docs' && !docsFit.ok;
      lvBox.appendChild(h('div', null,
        checkbox(`${meta.title} — ${meta.q}`, levels[l.id] && !off, v => { levels[l.id] = v; paint(); }),
        off ? h('div', { class: 'hint', style: { marginLeft: '24px' } }, `Недоступен: ${docsFit.why}`) : null));
    });
    body.appendChild(lvBox);

    // Что получится
    const derivedPlan = plannedDerived(tpl, ds, roles);
    const willAdd = derivedPlan.filter(d => !d.existing);
    // У показателя, которого в наборе ещё нет, метки взять неоткуда — поэтому
    // подставляем имя из плана: иначе в составе печаталось «~ за месяц»
    const plan = buildFromTemplate(tpl, ds, roles, Object.keys(levels).filter(k => levels[k]),
      Object.fromEntries(derivedPlan.map(d => [d.id, d.existing || { kind: 'saved', key: '~', label: d.label }])));
    const nCharts = plan.levels.reduce((a, l) => a + l.charts.length, 0);
    const info = h('div', { class: 'tpl-plan' });
    info.appendChild(h('p', null, h('b', null, `Получится ${nCharts} ${plural(nCharts, 'блок', 'блока', 'блоков')} на ${plan.levels.length} ${plural(plan.levels.length, 'вкладке', 'вкладках', 'вкладках')}`)));
    plan.levels.forEach(l => info.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px' } },
      `${l.title}: ${l.charts.map(c => c.name).join('; ')}`)));
    if (willAdd.length && !mockup) info.appendChild(h('p', { style: { marginBottom: 0 } },
      'В набор «' + ds.name + '» будет добавлен показатель: ',
      willAdd.map(d => h('b', null, `${d.label} = ${exprText(ds, d.expr)}`))));
    const miss = [...new Set(plan.skipped.flatMap(s => s.need))].map(n => (TPL_ROLES[n] || {}).label || n);
    if (miss.length) info.appendChild(h('p', { class: 'muted', style: { fontSize: '12.5px', marginBottom: 0 } },
      `Часть блоков пропущена — не хватает: ${miss.join(', ')}.`));
    body.appendChild(info);
  };
  paint();

  openModal({
    title: `Готовый шаблон: ${tpl.name}`, wide: true, body,
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => {
        const lv = Object.keys(levels).filter(k => levels[k]);
        if (!lv.length) { toast('Отметьте хотя бы один уровень', true); return; }
        let id;
        if (mockup) {
          id = createMockup(tpl, { title, levels: lv });
        } else {
          const fit = templateFits(tpl, ds, roles);
          if (!fit.ok) { toast('Не заполнено: ' + fit.missingLabels.join(', '), true); return; }
          id = createFromTemplate(tpl, ds, { title: title.trim() || tplDashName(tpl), roles, levels: lv });
        }
        if (!id) return;
        close();
        toast('Шаблон собран' + (mockup ? ': правьте названия прямо на блоках' : ''));
        go('#/d/' + id);
      } }, ic('check'), 'Создать шаблон')],
  });
}

/* ---------- Скрытый набор макета ----------
   У макета нет и не должно быть настоящих данных: колонки берутся из описания
   шаблона, а если шаблона нет — нейтральные, чтобы блоки не называли чужих
   сущностей. Набор принадлежит дашборду и человеку не показывается. */
const MOCKUP_NEUTRAL_COLS = ['Период', 'Категория', 'Группа', 'Показатель', 'Количество, шт.'];

function mockupSchema(tpl) {
  const used = new Set();
  const src = (tpl && tpl.demo && tpl.demo.length) ? tpl.demo : MOCKUP_NEUTRAL_COLS;
  const columns = src.map((d, i) => {
    const label = typeof d === 'string' ? d : d.label;
    const col = Object.assign({ key: slugKey(label, i, used), label }, guessSchemaCol(label));
    if (typeof d === 'object') Object.assign(col, d, { label, key: col.key });
    return col;
  });
  return Object.assign({ seed: (Date.now() % 100000) + 1, rowCount: 2000, columns }, defaultSchemaPeriod());
}
/* Набор-объект без записи в состояние: нужен, чтобы показать состав будущего дашборда */
function mockupDatasetDraft(tpl, title) {
  const schema = normalizeSchema(mockupSchema(tpl));
  const columns = schema.columns.map(c => ({ key: c.key, label: c.label, type: c.type }));
  return {
    id: 'mockup_draft', name: `Данные макета «${title}»`, kind: 'schema', schema, columns,
    metrics: schemaMetrics(columns, null), mainDttm: (columns.find(c => c.type === 'date') || {}).key || null,
    description: SCHEMA_NOTE, rows: generateSchemaRows(schema),
  };
}

/* Блок в макете добавляется видом визуализации, а не метрикой и разрезом:
   показатель и разрез Кобра берёт из скрытого набора молча. */
const MOCKUP_BLOCKS = [
  { viz: 'line', name: 'Линейный график', by: 'date' },
  { viz: 'bar', name: 'Столбцы', by: 'dim1' },
  { viz: 'pie', name: 'Круговая', by: 'dim1' },
  { viz: 'area', name: 'Области', by: 'date', series: 'dim1' },
  { viz: 'big_number_trend', name: 'Большое число', kind: 'kpi' },
  { viz: 'table', name: 'Таблица', by: 'dim1' },
  { viz: 'treemap', name: 'Дерево', by: 'dim1', by2: 'dim2' },
  { viz: 'heatmap', name: 'Тепловая карта', by: 'date', y: 'dim1' },
  { viz: 'funnel', name: 'Воронка', by: 'stage' },
  { viz: 'pivot', name: 'Сводная таблица', by: 'dim1', cols: 'dim2' },
];
/* Какие виды блоков вообще построятся на этом наборе: воронке нужен этап,
   тепловой карте — дата. Предлагать то, что не соберётся, нельзя. */
function mockupBlockOptions(ds) {
  const roles = pickRoles(ds);
  return MOCKUP_BLOCKS.filter(b => !!tplBlockChart(Object.assign({ metric: 'main' }, b), ds, roles, null));
}
/* Создаёт блок выбранного вида на наборе дашборда и возвращает id графика */
function createMockupChart(ds, vizId) {
  const b = MOCKUP_BLOCKS.find(x => x.viz === vizId);
  if (!b) return null;
  const roles = pickRoles(ds);
  const plan = tplBlockChart(Object.assign({ metric: 'main' }, b), ds, roles, null);
  if (!plan) return null;
  const id = uid('c_');
  STATE.charts[id] = {
    id, name: b.name, viz: plan.viz, datasetId: ds.id, autoName: true,
    params: Object.assign(VIZ[plan.viz].defaults(ds), plan.params), updated: Date.now(),
  };
  return id;
}

/* ---------- Предпросмотр на вымышленных данных ---------- */
/* Временный набор и дашборд живут только в памяти: в localStorage не пишем */
function templatePreview(tpl, backDsId) {
  const used = new Set();
  const cols = (tpl.demo || []).map((d, i) => {
    const label = typeof d === 'string' ? d : d.label;
    const col = Object.assign({ key: slugKey(label, i, used), label }, guessSchemaCol(label));
    if (typeof d === 'object') Object.assign(col, d, { label, key: col.key });
    return col;
  });
  const schema = Object.assign({ seed: 11, rowCount: 1200, columns: cols }, defaultSchemaPeriod());
  const dsId = 'tpl_preview';
  const columns = cols.map(c => ({ key: c.key, label: c.label, type: c.type }));
  DS[dsId] = {
    id: dsId, name: `Пример: ${tplDashName(tpl)}`, kind: 'schema', preview: true, schema, columns,
    metrics: schemaMetrics(columns, null), mainDttm: (columns.find(c => c.type === 'date') || {}).key || null,
    description: SCHEMA_NOTE, rows: generateSchemaRows(schema),
  };
  const id = createFromTemplate(tpl, DS[dsId], { title: `Пример: ${tplDashName(tpl)}`, preview: true });
  if (!id) { delete DS[dsId]; return null; }
  // Откуда человек пришёл: иначе из примера некуда вернуться, кроме кнопки браузера
  STATE.dashboards[id].previewDs = backDsId || null;
  STATE.dashboards[id].previewBack = '#/templates' + (backDsId ? '?ds=' + encodeURIComponent(backDsId) : '');
  return id;
}
/* Убираем примеры, когда человек ушёл с них: иначе они осядут в состоянии */
function purgePreviews(keepId) {
  let had = false;
  Object.values(STATE.dashboards).forEach(d => {
    if (!d.preview || d.id === keepId) return;
    d.tabs.forEach(t => t.items.forEach(i => { if (i.chartId) delete STATE.charts[i.chartId]; }));
    delete STATE.dashboards[d.id];
    had = true;
  });
  if (had) Object.keys(DS).forEach(k => { if (DS[k].preview && !Object.values(STATE.dashboards).some(d => d.fromTemplate && d.fromTemplate.datasetId === k)) delete DS[k]; });
  return had;
}

/* ---------- Каталог ---------- */
function renderTemplateList(main, q) {
  const page = h('div', { class: 'page' });
  main.appendChild(page);
  const dsList = visibleDatasets();
  // Набор приходит только из пути «мои данные»; обычный путь — макет без данных
  const ownData = q.ds && DS[q.ds] ? q.ds : null;
  let dsId = ownData;

  page.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', null, 'Готовые шаблоны'),
      h('p', null, ownData
        ? `Выберите шаблон и приложите к набору «${DS[ownData].name}». Каждый собран по стандартам визуализации: сверху общая картина, ниже разбор, в конце — исходные строки.`
        : 'Выберите готовый шаблон: Кобра соберёт его на придуманных данных, а вы переименуете блоки и категории под свой процесс. Каждый собран по стандартам визуализации: сверху общая картина, ниже разбор, в конце — исходные строки.')),
    h('a', { class: 'btn', href: '#/dashboards' }, 'Ко всем шаблонам')));

  let tag = '';   // выбранный приём
  const tagBar = h('div', { class: 'tpl-tags' });
  const paintTags = () => {
    clear(tagBar);
    tagBar.appendChild(h('span', { class: 'muted', style: { fontSize: '13px', marginRight: '4px' } }, 'Что хотите показать:'));
    [['', 'Всё'], ...Object.entries(TPL_TAGS)].forEach(([k, label]) => {
      tagBar.appendChild(h('button', { class: 'btn sm' + (tag === k ? ' on' : ''), onclick: () => { tag = k; paintTags(); paint(); } }, label));
    });
  };
  paintTags();
  page.appendChild(tagBar);

  const grid = h('div', { class: 'tpl-grid' });
  const paint = () => {
    clear(grid);
    const ds = dsId ? DS[dsId] : null;
    if (dsId && !ds) { grid.appendChild(h('div', { class: 'empty' }, h('b', null, 'Набор данных не найден'), h('a', { class: 'btn', href: '#/data' }, 'К данным'))); return; }
    const roles = ds ? pickRoles(ds) : null;
    TEMPLATES.filter(tpl => !tag || (tpl.tags || []).includes(tag)).forEach(tpl => {
      const fit = ds ? templateFits(tpl, ds, roles) : { ok: true, missingLabels: [] };
      const card = h('div', { class: 'tpl-card' + (fit.ok ? '' : ' off') });
      card.appendChild(h('div', { class: 'tpl-head' }, h('b', null, tpl.name),
        fit.ok ? null : h('span', { class: 'pill' }, 'не подходит набору')));
      card.appendChild(h('p', null, tpl.desc));
      card.appendChild(h('p', { class: 'muted' }, 'Например: ' + (tpl.examples || []).join(' · ')));
      const lvls = h('ul', { class: 'tpl-levels' });
      tpl.levels.forEach(l => lvls.appendChild(h('li', null, h('b', null, TPL_LEVELS[l.id].title), ' — ' + TPL_LEVELS[l.id].q)));
      card.appendChild(lvls);
      if (ds) card.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px' } },
        'Нужны поля: ' + (tpl.need || []).map(n => (TPL_ROLES[n] || {}).label || n).join(', ')));
      if (!fit.ok) card.appendChild(h('div', { class: 'tpl-miss' }, 'В наборе «' + ds.name + '» не нашлось: ' + fit.missingLabels.join(', ')));
      card.appendChild(h('div', { class: 'tpl-act' },
        tpl.demo && tpl.demo.length ? h('button', { class: 'btn sm', onclick: () => {
          const id = templatePreview(tpl, dsId);
          if (id) go('#/d/' + id);
        } }, ic('eye'), 'Посмотреть пример') : null,
        h('button', { class: 'btn sm primary', disabled: !fit.ok, onclick: () => openTemplateDialog(tpl, dsId) }, ds ? 'Взять этот' : 'Сделать шаблон')));
      grid.appendChild(card);
    });
    // Запасной путь: ни один скелет не подошёл
    const own = h('div', { class: 'tpl-card' });
    if (ds) {
      own.appendChild(h('div', { class: 'tpl-head' }, h('b', null, 'Собрать по моим данным')));
      own.appendChild(h('p', null, 'Ни один готовый не подошёл? Кобра посмотрит на колонки набора и соберёт черновик одной вкладкой.'));
      own.appendChild(h('div', { class: 'tpl-act' }, h('button', { class: 'btn sm', onclick: () => openAutoDashDialog(dsId) }, ic('wand'), 'Собрать черновик')));
    } else {
      own.appendChild(h('div', { class: 'tpl-head' }, h('b', null, 'Пустой шаблон')));
      own.appendChild(h('p', null, 'Ни один готовый не подошёл? Начните с чистого листа и добавляйте блоки сами — данные Кобра тоже придумает.'));
      own.appendChild(h('div', { class: 'tpl-act' }, h('button', { class: 'btn sm', onclick: () => {
        const id = createMockup(null, { title: 'Новый шаблон', levels: ['sum'] });
        // Помечаем как только что созданный: брошенную пустышку уберут при уходе
        if (id) { freshDashboards.add(id); go('#/d/' + id + '?edit=1'); }
      } }, ic('plus'), 'Пустой шаблон')));
    }
    grid.appendChild(own);
  };

  if (ownData) page.appendChild(field('Набор данных', selectEl(dsList.map(d => [d.id, d.name]), dsId, v => { dsId = v; paint(); })));
  page.appendChild(grid);
  paint();
}

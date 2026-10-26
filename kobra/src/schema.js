/* ============================================================
   Кобра · наборы-схемы
   Набор, у которого есть только описание колонок: строки Кобра
   придумывает сама и каждый раз одни и те же (детерминированный seed).
   Нужны для шаблонов и ТЗ, когда данных ещё нет на руках.
   ============================================================ */
const SCHEMA_ROWS_DEF = 3000;
const SCHEMA_ROWS_MAX = 50000;
const SCHEMA_SEASON = [.86, .82, .92, .88, .9, .92, .9, 1, 1.02, 1.05, 1.2, 1.5];
const SCHEMA_NOTE = 'Вымышленные данные: набор создан по описанию колонок, чтобы показать макет. Для отчётности не годится.';

/* Подсказки по названию колонки: тип и правдоподобные значения.
   Порядок важен: внутри одного прохода побеждает первая совпавшая подсказка
   (см. guessSchemaCol — сначала по первому слову названия, потом по названию целиком). */
const SCHEMA_HINTS = [
  { re: /(^|[^а-я])дата|дате|день|сутки|месяц|период|^date|_date|time/i, type: 'date' },
  // Длительность — число, а не отметка времени: без этой подсказки «Время
  // обработки, мин» уезжало в текст, и показатель по нему было не построить
  { re: /длительност|продолжительн|время (обработки|ответа|реакции|доставки|выполнения|ожидания|простоя)|простой|задержк/i, type: 'number', min: 1, max: 480 },
  { re: /процент|доля|конверсия|маржинальность|%/i, type: 'number', min: 0, max: 100, decimals: 1 },
  { re: /выручка|сумма|оборот|продаж|revenue|amount|стоимость|бюджет|расход|затрат|маржа|прибыль|cost|price|цена|чек|руб|₽|\$|€/i, type: 'number', min: 500, max: 250000 },
  { re: /количество|кол-во|qty|штук|^шт|заказ|сдел|звонк|заявк|визит|клик|показ|пользовател|посещен|срок|count|число/i, type: 'number', min: 1, max: 60 },
  { re: /город|city/i, type: 'string', values: ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Краснодар', 'Воронеж'] },
  { re: /регион|округ|област|край|филиал|подразделен|region|территор/i, type: 'string', values: ['Центральный', 'Северо-Западный', 'Приволжский', 'Сибирский', 'Уральский', 'Южный'] },
  { re: /категор|группа товар|направлен|продукт|товар|услуг|category|product/i, type: 'string', values: ['Категория А', 'Категория Б', 'Категория В', 'Категория Г', 'Категория Д'] },
  { re: /канал|источник|трафик|channel|source|utm/i, type: 'string', values: ['Онлайн', 'Розница', 'Партнёры', 'Телефон', 'Рассылка'] },
  { re: /статус|этап|стади|состояни|status|stage/i, type: 'string', values: ['Новый', 'В работе', 'Согласован', 'Завершён', 'Отменён'] },
  { re: /менеджер|сотрудник|ответственн|продавец|оператор|manager|owner/i, type: 'string', values: ['Иванов И.', 'Петрова А.', 'Сидоров П.', 'Кузнецова М.', 'Новиков Д.', 'Морозова Е.'] },
  { re: /клиент|контрагент|заказчик|компани|customer|client|account/i, type: 'string', values: ['ООО «Вектор»', 'ООО «Аметист»', 'АО «Прогресс»', 'ИП Семёнов', 'ООО «Горизонт»', 'АО «Квант»'] },
  { re: /сегмент|тип|вид|формат|segment|kind/i, type: 'string', values: ['Крупный', 'Средний', 'Малый'] },
  { re: /платформ|устройств|platform|device|os/i, type: 'string', values: ['Сайт', 'Приложение iOS', 'Приложение Android'] },
  { re: /магазин|точк|склад|офис|store|shop/i, type: 'string', values: ['Точка №1', 'Точка №2', 'Точка №3', 'Точка №4', 'Точка №5'] },
  { re: /id$|номер|код|артикул|guid|uuid/i, type: 'string', ids: true },
];

/* Первое слово названия: «Статус сделки» → «статус», «Выручка, ₽» → «выручка».
   Хвост после запятой — единицы и уточнения, смысл колонки задаёт первое слово. */
function schemaHeadWord(label) {
  const head = String(label || '').split(',')[0].trim().split(/\s+/)[0] || '';
  return head.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, '');
}

/* Подсказку ищем сначала по первому слову названия и только потом по названию
   целиком: иначе широкое правило обгоняет точное — «Статус сделки» попадал бы
   в количества по «сделк», а «Номер заказа» — по «заказ», и у набора появлялась
   бессмысленная метрика «Сумма: Статус сделки». */
function guessSchemaCol(label) {
  const full = String(label || '');
  const head = schemaHeadWord(full);
  const hit = (head && SCHEMA_HINTS.find(hr => hr.re.test(head))) || SCHEMA_HINTS.find(hr => hr.re.test(full));
  if (!hit) return { type: 'string', values: null };
  const out = { type: hit.type };
  if (hit.min != null) { out.min = hit.min; out.max = hit.max; out.decimals = hit.decimals || 0; }
  if (hit.values) out.values = hit.values.slice();
  if (hit.ids) out.ids = true;
  return out;
}

/* Значения по умолчанию для строковой колонки без подсказки: «Подпись 1…5» */
function schemaFallbackValues(label) {
  const base = String(label || 'Значение').trim().replace(/\s+/g, ' ').slice(0, 24) || 'Значение';
  return [1, 2, 3, 4, 5].map(i => `${base} ${i}`);
}

function hashUnit(s) {
  let hv = 2166136261;
  for (let i = 0; i < s.length; i++) { hv ^= s.charCodeAt(i); hv = Math.imul(hv, 16777619); }
  return ((hv >>> 0) % 10000) / 10000;
}

function normalizeSchema(sc) {
  const s = clone(sc || {});
  s.seed = s.seed || 1;
  s.rowCount = Math.max(1, Math.min(+s.rowCount || SCHEMA_ROWS_DEF, SCHEMA_ROWS_MAX));
  s.columns = (s.columns || []).filter(c => c && c.key);
  if (!parseIsoDate(s.dateFrom) || !parseIsoDate(s.dateTo) || parseIsoDate(s.dateFrom) >= parseIsoDate(s.dateTo)) {
    Object.assign(s, defaultSchemaPeriod());
  }
  return s;
}

/* Период по умолчанию для нового набора: 24 полных месяца, последний из них —
   прошлый, а не текущий. Если данные обрываются на середине месяца, последняя
   точка на любом графике по месяцам выглядит обвалом, а KPI с трендом честно
   пишет «−49 % к прошлому месяцу» — макет читается как отчёт о катастрофе.
   Даты фиксируются в схеме при создании — иначе строки менялись бы каждый день. */
function defaultSchemaPeriod() {
  const to = truncTime(Date.now(), 'month') - DAY; // последний день прошлого месяца
  return { dateFrom: isoDate(truncTime(shiftTime(to, 'month', -23), 'month')), dateTo: isoDate(to) };
}

/* Четыре формы распределения по кругу: длинный хвост, ровное, обратное и
   «один лидер». Больше вариантов человеку не нужно — он просто жмёт кнопку. */
const SCHEMA_SPREADS = 4;
function schemaWeight(i, n, spread) {
  switch (((spread % SCHEMA_SPREADS) + SCHEMA_SPREADS) % SCHEMA_SPREADS) {
    case 1: return 1 / Math.pow(i + 1, 0.25);              // почти поровну
    case 2: return 1 / Math.pow(n - i, 0.75);              // растёт к концу списка
    case 3: return i === 0 ? n * 1.4 : 1 / (i + 1);        // один явный лидер
    default: return 1 / Math.pow(i + 1, 0.75);             // длинный хвост
  }
}
function generateSchemaRows(schema) {
  const s = normalizeSchema(schema);
  const rnd = mulberry32(s.seed);
  const from = parseIsoDate(s.dateFrom), to = parseIsoDate(s.dateTo);
  const span = Math.max(to - from, DAY);
  const dateCols = s.columns.filter(c => c.type === 'date');
  const strCols = s.columns.filter(c => c.type === 'string');
  const numCols = s.columns.filter(c => c.type === 'number');
  // Первые значения в списке популярнее остальных — так столбики и секторы выглядят живее.
  // Форма распределения переключается (spread): иногда заказчику нужно, чтобы
  // картинка была похожа на его реальную, а данные всё равно придуманные.
  const pools = {};
  strCols.forEach(c => {
    const vals = (c.values && c.values.length ? c.values : schemaFallbackValues(c.label));
    pools[c.key] = vals.map((v, i) => ({ v, w: schemaWeight(i, vals.length, c.spread || 0) }));
  });
  const rows = new Array(s.rowCount);
  for (let i = 0; i < s.rowCount; i++) {
    const r = {};
    // Сдвигаем даты к концу периода: свежих записей чуть больше
    let ms = truncTime(from + Math.pow(rnd(), 0.85) * span, 'day');
    // Первые две строки ставим ровно на границы периода: набор должен покрывать
    // тот период, который написан на его странице. Иначе данные обрываются за день-два
    // до конца последнего месяца, и графики считают этот месяц незакрытым.
    if (i === 0) ms = from;
    else if (i === 1) ms = truncTime(to, 'day');
    dateCols.forEach(c => { r[c.key] = ms; });
    let catMul = 1;
    strCols.forEach((c, ci) => {
      if (c.ids) { r[c.key] = String(100000 + Math.floor(rnd() * 899999)); return; }
      const v = pickWeighted(rnd, pools[c.key]).v;
      r[c.key] = v;
      if (ci === 0) catMul = 0.55 + 1.5 * hashUnit(String(v)); // у каждой категории свой масштаб
    });
    const growth = 1 + 0.35 * ((ms - from) / span);
    const season = SCHEMA_SEASON[new Date(ms).getUTCMonth()];
    numCols.forEach(c => {
      const lo = c.min != null ? +c.min : 1, hi = c.max != null ? +c.max : 1000;
      const pct = lo >= 0 && hi <= 100 && (c.decimals || 0) > 0; // проценты не растим и не сезоним
      // Длинный хвост: большинство значений у нижней границы, в максимум упирается около 1 % строк
      const mul = pct ? 1 : (catMul * growth * season) / 2.2;
      const u = Math.min(1, Math.pow(rnd(), 1.8) * mul);
      const v = lo + (hi - lo) * u;
      r[c.key] = c.decimals ? +v.toFixed(c.decimals) : Math.round(v);
    });
    rows[i] = r;
  }
  return rows;
}

/* Метрики: количество строк плюс сумма по каждому числу. Свои метрики сохраняем. */
function schemaMetrics(columns, prev) {
  const keep = (prev || []).filter(m => {
    if (m.key === 'count' || m.key.startsWith('sum_') || m.key.startsWith('avg_')) return false;
    const used = JSON.stringify(m.expr).match(/"col":"([^"]+)"/g) || [];
    return used.every(u => u.slice(7, -1) === '*' || columns.some(c => c.key === u.slice(7, -1)));
  });
  const out = [{ key: 'count', label: 'Количество строк', expr: { type: 'simple', agg: 'COUNT', col: '*' }, format: 'int' }];
  columns.filter(c => c.type === 'number').forEach(c => {
    // Проценты складывать бессмысленно — для них среднее; деньги показываем рублями
    const isPct = /процент|доля|конверсия|%/i.test(c.label);
    const agg = isPct ? 'AVG' : 'SUM';
    const format = isPct ? 'dec1' : /₽|руб/i.test(c.label) ? 'rub_smart' : 'smart';
    out.push({
      key: (isPct ? 'avg_' : 'sum_') + c.key, label: (isPct ? 'Среднее: ' : 'Сумма: ') + c.label,
      expr: { type: 'simple', agg, col: c.key }, format,
    });
  });
  return out.concat(keep);
}

/** @param {{id?: string, name: string, schema: SchemaDef, owner?: string}} opts */
function saveSchemaDataset({ id, name, schema, owner }) {
  const sc = normalizeSchema(schema);
  const columns = sc.columns.map(c => ({ key: c.key, label: c.label || c.key, type: c.type }));
  const prev = id && DS[id] ? DS[id].metrics : null;
  const mainDttm = (columns.find(c => c.type === 'date') || {}).key || null;
  const dsId = id || uid('ds_');
  const meta = {
    id: dsId, name: name || 'Набор по схеме', kind: 'schema', schema: sc, columns,
    metrics: schemaMetrics(columns, prev), mainDttm, description: SCHEMA_NOTE,
    created: (STATE.datasets[dsId] || {}).created || Date.now(),
  };
  // Владелец — дашборд-макет: такой набор человеку не показывается и живёт вместе с ним
  const own = owner !== undefined ? owner : (STATE.datasets[dsId] || {}).owner;
  if (own) meta.owner = own;
  STATE.datasets[dsId] = meta;
  DS[dsId] = Object.assign({}, meta, { rows: generateSchemaRows(sc) });
  saveState();
  return dsId;
}

const isSchemaDs = d => !!(d && d.kind === 'schema');

const SCHEMA_COL_TYPES = [['string', 'Текст'], ['number', 'Число'], ['date', 'Дата']];

/* Смена типа колонки прямо на странице набора. Тип угадан по названию и иногда
   угадан неверно («Статус сделки» легко принять за количество), а чинить это
   через «Изменить схему» догадается не каждый. Для набора-схемы это недорого:
   строки и метрики всё равно пересчитываются генератором при каждом сохранении. */
function changeSchemaColType(dsId, key, type) {
  const d = DS[dsId];
  if (!d || !isSchemaDs(d)) return;
  const sc = normalizeSchema(d.schema);
  const col = sc.columns.find(c => c.key === key);
  if (!col || col.type === type) return;
  const g = guessSchemaCol(col.label || col.key);
  const same = g.type === type; // подсказка по названию подходит только для того же типа
  col.type = type;
  delete col.values; delete col.ids; delete col.min; delete col.max; delete col.decimals;
  if (type === 'number') {
    col.min = same && g.min != null ? g.min : 1;
    col.max = same && g.max != null ? g.max : 1000;
    col.decimals = same ? (g.decimals || 0) : 0;
  }
  if (type === 'string' && same) { if (g.values) col.values = g.values; if (g.ids) col.ids = true; }
  saveSchemaDataset({ id: d.id, name: d.name, schema: sc });
  toast(`Колонка «${col.label || col.key}» теперь «${TYPE_GROUP[type]}», строки и метрики пересчитаны`);
  go('#/data/' + d.id);
}

/* ---------- Диалог описания набора ---------- */
// Хвост вроде «, ₽» или «, шт.» — это часть названия колонки, а не отдельная колонка
const UNIT_TAIL = /^(₽|руб\.?|р\.|%|шт\.?|ед\.?|чел\.?|кг|т|л|м2|м²|мин|сек|дн\.?|тыс\.?|млн|млрд|\$|€|usd|eur)$/i;
function parseColumnNames(text, mergeUnits) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  let parts;
  if (lines.length > 1) parts = lines;                  // по одной колонке в строке
  else if (/\t/.test(raw)) parts = raw.split('\t');     // шапка, вставленная из Excel
  else if (/;/.test(raw)) parts = raw.split(';');
  else parts = raw.split(/[,|]/);
  parts = parts.map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (mergeUnits) {
    const merged = [];
    parts.forEach(p => {
      if (merged.length && UNIT_TAIL.test(p)) merged[merged.length - 1] += ', ' + p;
      else merged.push(p);
    });
    parts = merged;
  }
  return parts.slice(0, 40);
}

function openSchemaDialog(existingId) {
  const existing = existingId ? DS[existingId] : null;
  let name = existing ? existing.name : '';
  let cols = existing ? clone(normalizeSchema(existing.schema).columns) : [];
  let rowCount = existing ? normalizeSchema(existing.schema).rowCount : SCHEMA_ROWS_DEF;
  const per = existing ? normalizeSchema(existing.schema) : defaultSchemaPeriod();
  let dateFrom = per.dateFrom, dateTo = per.dateTo;
  const keysUsed = new Set(cols.map(c => c.key));

  const addColumns = labels => {
    labels.forEach(label => {
      const g = guessSchemaCol(label);
      cols.push(Object.assign({ key: slugKey(label, cols.length, keysUsed), label }, g));
    });
  };

  const body = h('div');
  const paste = h('textarea', {
    class: 'textarea', rows: 2, placeholder: 'Дата заказа, Филиал, Категория, Выручка, Количество',
    'aria-label': 'Названия колонок',
  });
  const paint = () => {
    clear(body);
    body.appendChild(field('Название набора', h('input', {
      class: 'input', value: name, placeholder: 'Например: Продажи филиалов (макет)',
      oninput: e => { name = e.target.value; },
    })));
    body.appendChild(h('div', { class: 'field' },
      h('div', { class: 'lbl' }, 'Колонки'),
      h('div', { class: 'hint', style: { marginBottom: '6px' } }, 'Вставьте шапку из Excel или перечислите названия через запятую — тип Кобра угадает по названию.'),
      paste,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
        h('button', {
          class: 'btn sm', type: 'button', onclick: () => {
            const names = parseColumnNames(paste.value, true);
            if (!names.length) { toast('Не нашёл названий колонок', true); return; }
            addColumns(names);
            paste.value = '';
            paint();
          },
        }, ic('plus'), 'Добавить колонки'),
        cols.length ? h('button', { class: 'btn sm', type: 'button', onclick: () => { cols = []; keysUsed.clear(); paint(); } }, ic('trash'), 'Очистить') : null)));

    if (cols.length) {
      const tbl = h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Подпись'), h('th', null, 'Тип'), h('th', null, 'Значения или диапазон'), h('th'))),
        h('tbody', null, cols.map((c, i) => h('tr', null,
          h('td', null, h('input', {
            class: 'input', value: c.label, style: { height: '30px', minWidth: '140px' },
            'aria-label': 'Подпись колонки', oninput: e => { c.label = e.target.value; },
          })),
          h('td', null, selectEl(SCHEMA_COL_TYPES, c.type, v => {
            c.type = v;
            if (v === 'number' && c.min == null) { c.min = 1; c.max = 1000; c.decimals = 0; }
            if (v === 'string' && !c.values) c.values = null;
            paint();
          }, { 'aria-label': 'Тип колонки' })),
          h('td', null,
            c.type === 'string' ? h('input', {
              class: 'input', style: { height: '30px', minWidth: '240px' },
              value: (c.values || []).join(', '), placeholder: schemaFallbackValues(c.label).join(', '),
              'aria-label': 'Значения через запятую',
              oninput: e => { const v = parseColumnNames(e.target.value); c.values = v.length ? v : null; },
            })
              : c.type === 'number' ? h('div', { class: 'row2' },
                h('input', { class: 'input', type: 'number', style: { height: '30px' }, value: c.min ?? 1, 'aria-label': 'Минимум', oninput: e => { c.min = e.target.value === '' ? 0 : +e.target.value; } }),
                h('input', { class: 'input', type: 'number', style: { height: '30px' }, value: c.max ?? 1000, 'aria-label': 'Максимум', oninput: e => { c.max = e.target.value === '' ? 1 : +e.target.value; } }))
                : h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Период задаётся ниже')),
          h('td', { class: 'act' }, iconBtn('trash', 'Убрать колонку', () => { cols.splice(i, 1); paint(); }, 'sm'))))));
      body.appendChild(h('div', { class: 'tbl-wrap', style: { marginBottom: '14px' } }, tbl));
    } else {
      body.appendChild(h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Пока ни одной колонки. Для шаблона обычно хватает одной даты, одного-двух текстовых разрезов и одного числа.'));
    }

    body.appendChild(h('div', { class: 'row2' },
      field('Строк', h('input', {
        class: 'input', type: 'number', min: 1, max: SCHEMA_ROWS_MAX, value: rowCount,
        oninput: e => { rowCount = +e.target.value || SCHEMA_ROWS_DEF; },
      }), `Не больше ${fmtNum(SCHEMA_ROWS_MAX, 'int')}`),
      h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Период для дат'),
        h('div', { class: 'row2' },
          h('input', { class: 'input', type: 'date', value: dateFrom, 'aria-label': 'Начало периода', onchange: e => { dateFrom = e.target.value; } }),
          h('input', { class: 'input', type: 'date', value: dateTo, 'aria-label': 'Конец периода', onchange: e => { dateTo = e.target.value; } })))));
    body.appendChild(h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '4px 0 0' } }, SCHEMA_NOTE));
  };
  paint();

  openModal({
    title: existing ? 'Изменить схему набора' : 'Описать набор данных', wide: 'x', body,
    foot: close => [
      h('span', { class: 'grow muted', style: { fontSize: '12.5px' } }, 'Цифры придумываются по описанию и не меняются при перезагрузке.'),
      h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', {
        class: 'btn primary', onclick: () => {
          if (!cols.length) { toast('Добавьте хотя бы одну колонку', true); return; }
          if (!cols.some(c => c.type === 'number')) toast('В наборе нет числовых колонок — графики смогут считать только количество строк');
          const schema = { seed: existing ? normalizeSchema(existing.schema).seed : (Date.now() % 100000) + 1, rowCount, dateFrom, dateTo, columns: cols };
          const id = saveSchemaDataset({ id: existingId || null, name: name.trim(), schema });
          close();
          toast(existing ? 'Схема обновлена, строки пересчитаны' : 'Набор по схеме создан');
          go('#/data/' + id);
        },
      }, existing ? 'Сохранить схему' : 'Создать набор')],
  });
}

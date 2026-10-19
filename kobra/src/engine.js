/* ============================================================
   Кобра · движок запросов
   ============================================================ */
const AGGS = {
  SUM: 'Сумма', AVG: 'Среднее', COUNT: 'Количество', COUNT_DISTINCT: 'Уникальных',
  MIN: 'Минимум', MAX: 'Максимум', MEDIAN: 'Медиана',
};
const TIME_GRAINS = { day: 'День', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function truncTime(ms, grain) {
  if (ms == null || isNaN(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (grain) {
    case 'year': return Date.UTC(y, 0, 1);
    case 'quarter': return Date.UTC(y, m - (m % 3), 1);
    case 'month': return Date.UTC(y, m, 1);
    case 'week': {
      const day = Date.UTC(y, m, d.getUTCDate());
      const wd = (d.getUTCDay() + 6) % 7;
      return day - wd * DAY;
    }
    case 'day': return Date.UTC(y, m, d.getUTCDate());
    default: return ms;
  }
}
function shiftTime(ms, grain, n) {
  const d = new Date(ms);
  switch (grain) {
    case 'year': return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate());
    case 'quarter': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * n, d.getUTCDate());
    case 'month': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
    case 'week': return ms + 7 * n * DAY;
    default: return ms + n * DAY;
  }
}
const pad2 = n => String(n).padStart(2, '0');
function fmtDate(ms, grain) {
  if (ms == null || ms === '') return '—';
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
  switch (grain) {
    case 'year': return String(y);
    case 'quarter': return `${Math.floor(m / 3) + 1} кв. ${y}`;
    case 'month': return `${MONTHS_SHORT[m]} ${y}`;
    case 'week': return `нед. с ${pad2(dd)}.${pad2(m + 1)}.${String(y).slice(2)}`;
    default: {
      const hh = d.getUTCHours(), mi = d.getUTCMinutes();
      const base = `${pad2(dd)}.${pad2(m + 1)}.${y}`;
      return (hh || mi) && !grain ? `${base} ${pad2(hh)}:${pad2(mi)}` : base;
    }
  }
}
function isoDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

/* ---------- Форматы чисел ---------- */
const NUMBER_FORMATS = {
  auto: 'Как у метрики', smart: 'Сокращённо (1,2 млн)', int: 'Целое (1 234 567)', dec1: 'Один знак (1 234,5)',
  dec2: 'Два знака (1 234,56)', pct: 'Проценты (12,3 %)', rub: 'Рубли (1 234 ₽)', rub_smart: 'Рубли сокращённо (1,2 млн ₽)',
};
/* Единица измерения прячется в самом формате: 'suffix:шт.' — чтобы она доехала
   до осей, легенд, подсказок и ячеек, не меняя подпись fmtNum по всему движку */
const SUFFIX_RE = /^suffix:(.*)$/;
const fmtSuffix = f => { const m = SUFFIX_RE.exec(f || ''); return m ? m[1] : null; };
const withSuffix = s => 'suffix:' + String(s || '').trim();
function formatLabel(f) {
  const s = fmtSuffix(f);
  if (s !== null) return s ? `Единица «${s}»` : 'Без единиц';
  return NUMBER_FORMATS[f] || f;
}
const nfCache = {};
function nf(min, max) {
  const k = min + ':' + max;
  return nfCache[k] || (nfCache[k] = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: min, maximumFractionDigits: max }));
}
function smartNum(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return nf(0, 2).format(v / 1e9) + ' млрд';
  if (a >= 1e6) return nf(0, 2).format(v / 1e6) + ' млн';
  if (a >= 1e4) return nf(0, 1).format(v / 1e3) + ' тыс.';
  if (a >= 100) return nf(0, 0).format(v);
  return nf(0, 2).format(v);
}
function fmtNum(v, f) {
  if (v == null || (typeof v === 'number' && isNaN(v))) return '—';
  if (typeof v !== 'number') return String(v);
  if (!isFinite(v)) return '∞';
  // С единицей число не сокращаем: иначе «млн ₽» в единице даёт «1,2 млн млн ₽»
  const suf = fmtSuffix(f);
  if (suf !== null) return nf(0, 0).format(v) + (suf ? ' ' + suf : '');
  switch (f) {
    case 'int': return nf(0, 0).format(v);
    case 'dec1': return nf(1, 1).format(v);
    case 'dec2': return nf(2, 2).format(v);
    case 'pct': return nf(1, 1).format(v * 100) + ' %';
    case 'rub': return nf(0, 0).format(v) + ' ₽';
    case 'rub_smart': return smartNum(v) + ' ₽';
    case 'raw': return String(v);
    default: return smartNum(v);
  }
}

/* ---------- Реестр наборов данных ---------- */
const DS = {}; // id -> dataset {id,name,columns,metrics,rows,mainDttm,...}
function dsGet(id) { return DS[id]; }
function dsCol(ds, key) { return ds && ds.columns.find(c => c.key === key); }
function colLabel(ds, key) {
  if (key === '*') return 'Все строки';
  const c = dsCol(ds, key); return c ? (c.label || c.key) : key;
}
function dsMaxDate(ds, col) {
  col = col || ds.mainDttm;
  if (!col) return null;
  ds._maxCache = ds._maxCache || {};
  if (ds._maxCache[col] != null) return ds._maxCache[col];
  let mx = -Infinity;
  for (const r of ds.rows) { const v = r[col]; if (v != null && v > mx) mx = v; }
  return (ds._maxCache[col] = isFinite(mx) ? mx : null);
}
function dsMinDate(ds, col) {
  col = col || ds.mainDttm;
  let mn = Infinity;
  for (const r of ds.rows) { const v = r[col]; if (v != null && v < mn) mn = v; }
  return isFinite(mn) ? mn : null;
}

/* ---------- Метрики ---------- */
// Метрика в параметрах графика: {kind:'saved', key} | {kind:'simple', agg, col, label?}
function metricLabel(ds, m) {
  if (!m) return '';
  if (m.label) return m.label;
  if (m.kind === 'saved') { const s = ds && ds.metrics.find(x => x.key === m.key); return s ? s.label : m.key; }
  if (m.agg === 'COUNT' && (m.col === '*' || !m.col)) return 'Количество строк';
  return `${AGGS[m.agg] || m.agg}: ${colLabel(ds, m.col)}`;
}
function metricFormat(ds, m) {
  if (m.kind === 'saved') { const s = ds && ds.metrics.find(x => x.key === m.key); return (s && s.format) || 'smart'; }
  if (m.agg === 'COUNT' || m.agg === 'COUNT_DISTINCT') return 'int';
  const c = dsCol(ds, m.col);
  if (c && /₽|руб/i.test(c.label || '')) return m.agg === 'AVG' ? 'rub' : 'rub_smart';
  return 'smart';
}
function makeAcc(agg, col) {
  const get = col === '*' || !col ? null : col;
  switch (agg) {
    case 'SUM': return { init: () => [0], add: (s, r) => { const v = r[get]; if (v != null && !isNaN(v)) s[0] += v; }, fin: s => s[0] };
    case 'COUNT': return get ? { init: () => [0], add: (s, r) => { if (r[get] != null && r[get] !== '') s[0]++; }, fin: s => s[0] }
      : { init: () => [0], add: s => { s[0]++; }, fin: s => s[0] };
    case 'AVG': return { init: () => [0, 0], add: (s, r) => { const v = r[get]; if (v != null && !isNaN(v)) { s[0] += v; s[1]++; } }, fin: s => s[1] ? s[0] / s[1] : null };
    case 'MIN': return { init: () => [Infinity], add: (s, r) => { const v = r[get]; if (v != null && v < s[0]) s[0] = v; }, fin: s => isFinite(s[0]) ? s[0] : null };
    case 'MAX': return { init: () => [-Infinity], add: (s, r) => { const v = r[get]; if (v != null && v > s[0]) s[0] = v; }, fin: s => isFinite(s[0]) ? s[0] : null };
    case 'COUNT_DISTINCT': return { init: () => [new Set()], add: (s, r) => { const v = r[get]; if (v != null && v !== '') s[0].add(v); }, fin: s => s[0].size };
    case 'MEDIAN': return {
      init: () => [[]], add: (s, r) => { const v = r[get]; if (v != null && !isNaN(v)) s[0].push(v); },
      fin: s => { const a = s[0].sort((x, y) => x - y); if (!a.length) return null; const h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; },
    };
  }
  throw new Error('Неизвестная агрегация ' + agg);
}
function compileMetric(ds, m) {
  let expr;
  if (m.kind === 'saved') {
    const s = ds.metrics.find(x => x.key === m.key);
    if (!s) throw new Error(`Метрика «${m.key}» не найдена в наборе «${ds.name}»`);
    expr = s.expr;
  } else expr = { type: 'simple', agg: m.agg, col: m.col };
  if (expr.type === 'ratio') {
    const a = makeAcc(expr.num.agg, expr.num.col), b = makeAcc(expr.den.agg, expr.den.col);
    return {
      init: () => [a.init(), b.init()],
      add: (s, r) => { a.add(s[0], r); b.add(s[1], r); },
      fin: s => { const d = b.fin(s[1]); return d ? a.fin(s[0]) / d * (expr.mult || 1) : null; },
    };
  }
  const acc = makeAcc(expr.agg, expr.col);
  return { init: () => [acc.init()], add: (s, r) => acc.add(s[0], r), fin: s => acc.fin(s[0]) };
}

/* ---------- Фильтры ---------- */
const TIME_PRESETS = {
  all: 'Всё время', last_7d: 'Последние 7 дней', last_30d: 'Последние 30 дней', last_90d: 'Последние 90 дней',
  this_month: 'Последний месяц в данных', last_12m: 'Последние 12 месяцев', this_year: 'Текущий год', last_year: 'Прошлый год',
  custom: 'Свой период',
};
// Возвращает [from, to) в мс; «текущий» = относительно последней даты в наборе
function resolveTimeRange(val, anchorMs) {
  if (!val || val.preset === 'all' || !val.preset) return [null, null];
  const end = anchorMs != null ? truncTime(anchorMs, 'day') + DAY : null;
  const d = new Date(end - DAY);
  const y = d.getUTCFullYear();
  switch (val.preset) {
    case 'last_7d': return [end - 7 * DAY, end];
    case 'last_30d': return [end - 30 * DAY, end];
    case 'last_90d': return [end - 90 * DAY, end];
    case 'this_month': return [Date.UTC(y, d.getUTCMonth(), 1), end];
    case 'last_12m': return [Date.UTC(y, d.getUTCMonth() - 11, 1), end];
    case 'this_year': return [Date.UTC(y, 0, 1), end];
    case 'last_year': return [Date.UTC(y - 1, 0, 1), Date.UTC(y, 0, 1)];
    case 'custom': {
      const f = parseIsoDate(val.from), t = parseIsoDate(val.to);
      return [f, t != null ? t + DAY : null];
    }
  }
  return [null, null];
}
function describeTimeRange(val, ds, col) {
  if (!val || !val.preset || val.preset === 'all') return 'Всё время';
  const [f, t] = resolveTimeRange(val, ds ? dsMaxDate(ds, col) : null);
  const txt = `${f != null ? fmtDate(f) : '…'} — ${t != null ? fmtDate(t - DAY) : '…'}`;
  return val.preset === 'custom' ? txt : `${TIME_PRESETS[val.preset]} (${txt})`;
}
const FILTER_OPS = {
  in: 'равно одному из', not_in: 'не равно', eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
  contains: 'содержит', time_range: 'период', between: 'между', is_null: 'пусто', not_null: 'не пусто',
};
function compileFilter(ds, f) {
  const c = f.col;
  if (!dsCol(ds, c)) return null; // колонки нет в наборе — фильтр к нему не относится
  const v = f.val;
  switch (f.op) {
    case 'in': { if (!Array.isArray(v) || !v.length) return null; const s = new Set(v.map(String)); return r => s.has(String(r[c])); }
    case 'not_in': { if (!Array.isArray(v) || !v.length) return null; const s = new Set(v.map(String)); return r => !s.has(String(r[c])); }
    case 'eq': return r => String(r[c]) === String(v);
    case 'neq': return r => String(r[c]) !== String(v);
    case 'gt': return r => r[c] > +v;
    case 'gte': return r => r[c] >= +v;
    case 'lt': return r => r[c] < +v;
    case 'lte': return r => r[c] <= +v;
    case 'contains': { const q = String(v || '').toLowerCase(); if (!q) return null; return r => String(r[c] ?? '').toLowerCase().includes(q); }
    case 'is_null': return r => r[c] == null || r[c] === '';
    case 'not_null': return r => r[c] != null && r[c] !== '';
    case 'between': {
      const [a, b] = v || [];
      const lo = a === '' || a == null ? null : +a, hi = b === '' || b == null ? null : +b;
      if (lo == null && hi == null) return null;
      return r => { const x = r[c]; return x != null && (lo == null || x >= lo) && (hi == null || x <= hi); };
    }
    case 'time_range': {
      const [a, b] = resolveTimeRange(v, dsMaxDate(ds, c));
      if (a == null && b == null) return null;
      return r => { const x = r[c]; return x != null && (a == null || x >= a) && (b == null || x < b); };
    }
  }
  return null;
}
function applyFilters(ds, filters) {
  const fns = (filters || []).map(f => compileFilter(ds, f)).filter(Boolean);
  if (!fns.length) return ds.rows;
  const out = [];
  const rows = ds.rows, n = fns.length;
  outer: for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let j = 0; j < n; j++) if (!fns[j](r)) continue outer;
    out.push(r);
  }
  return out;
}

/* ---------- Запрос ----------
   spec: {filters, groupby:[{col, grain}], metrics:[metric], orderby:[{key, desc}], limit}
   Ответ: {rows:[{...}], dims:[{key,col,grain,label,type}], mets:[{key,label,format}]} */
function runQuery(ds, spec) {
  if (!ds) throw new Error('Набор данных не найден');
  const rows = spec._rows || applyFilters(ds, spec.filters);
  const dims = (spec.groupby || []).filter(g => g && g.col).map((g, i) => {
    const c = dsCol(ds, g.col);
    if (!c) throw new Error(`Колонка «${g.col}» не найдена`);
    const grain = c.type === 'date' ? (g.grain || null) : null;
    return { key: g.col + (grain ? '__' + grain : '') , col: g.col, grain, label: c.label || c.key, type: c.type, alias: g.alias };
  });
  // Уникальные ключи для измерений (одна колонка может встречаться дважды)
  const seen = {};
  dims.forEach(d => { if (seen[d.key]) d.key += '_' + (seen[d.key]++); else seen[d.key] = 1; });
  const mets = (spec.metrics || []).filter(Boolean).map(m => ({ label: metricLabel(ds, m), format: metricFormat(ds, m), acc: compileMetric(ds, m) }));
  const mseen = {};
  mets.forEach(m => { let k = m.label; if (mseen[k]) k = k + ' (' + (++mseen[m.label]) + ')'; else mseen[k] = 1; m.key = k; });

  const groups = new Map();
  const nd = dims.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let key = '';
    const vals = new Array(nd);
    for (let j = 0; j < nd; j++) {
      const d = dims[j];
      let v = r[d.col];
      if (d.grain) v = truncTime(v, d.grain);
      vals[j] = v;
      key += (j ? '\u0001' : '') + v;
    }
    let g = groups.get(key);
    if (!g) { g = { vals, st: mets.map(m => m.acc.init()) }; groups.set(key, g); }
    for (let k = 0; k < mets.length; k++) mets[k].acc.add(g.st[k], r);
  }
  if (!groups.size && !nd && mets.length) groups.set('', { vals: [], st: mets.map(m => m.acc.init()) });
  let out = [];
  for (const g of groups.values()) {
    const o = {};
    dims.forEach((d, j) => { o[d.key] = g.vals[j]; });
    mets.forEach((m, k) => { o[m.key] = m.acc.fin(g.st[k]); });
    out.push(o);
  }
  const ob = spec.orderby && spec.orderby.length ? spec.orderby : null;
  if (ob) {
    out.sort((a, b) => {
      for (const o of ob) {
        const va = a[o.key], vb = b[o.key];
        const c = cmpVals(va, vb);
        if (c) return o.desc ? -c : c;
      }
      return 0;
    });
  }
  if (spec.limit && out.length > spec.limit) out = out.slice(0, spec.limit);
  return { rows: out, dims, mets: mets.map(m => ({ key: m.key, label: m.label, format: m.format })), filteredCount: rows.length };
}
function cmpVals(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ru', { numeric: true });
}
function distinctValues(ds, col, filters, limit = 2000) {
  const rows = applyFilters(ds, filters);
  const m = new Map();
  for (const r of rows) { const v = r[col]; if (v == null || v === '') continue; m.set(v, (m.get(v) || 0) + 1); }
  return [...m.entries()].sort((a, b) => cmpVals(a[0], b[0])).slice(0, limit).map(([value, count]) => ({ value, count }));
}
function numRange(ds, col) {
  let lo = Infinity, hi = -Infinity;
  for (const r of ds.rows) { const v = r[col]; if (typeof v === 'number') { if (v < lo) lo = v; if (v > hi) hi = v; } }
  return isFinite(lo) ? [lo, hi] : [0, 0];
}
function fmtDimValue(v, dim) {
  if (v == null || v === '') return '(пусто)';
  if (dim && dim.type === 'date') return fmtDate(v, dim.grain);
  if (typeof v === 'number') return nf(0, 2).format(v);
  return String(v);
}

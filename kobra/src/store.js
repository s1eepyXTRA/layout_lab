/* =============================================================
   Кобра · состояние и откат
   Откат был написан трижды и по-разному: снимок предложения у
   AI-ассистента, снимок затронутых графиков и набора в простой правке,
   клон дашборда в конструкторе. Каждый чинил одну и ту же задачу «верни
   как было» и каждый приходилось чинить отдельно, когда появлялся новый
   путь правки. Здесь он один: снимок всего STATE, возврат снимка, и
   наборы, пересобранные под восстановленные метаданные.

   Снимок — это клон STATE целиком. Он маленький: строки загруженных
   наборов живут в IndexedDB, строки макетов порождаются по схеме, так что
   в STATE лежат только дашборды, графики и описания наборов.
   ============================================================= */

const UNDO_MAX = 12;
let undoStack = [];

/* Снять снимок перед изменением. Возвращает его же, чтобы вызывающий мог
   откатиться именно к своей точке, а не к последней по времени. */
function snapState(label) {
  const snap = { label: label || 'Изменение', at: Date.now(), state: clone(STATE) };
  undoStack.push(snap);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  return snap;
}
/* Строго про конкретный снимок: «есть ли вообще что откатывать» —
   другой вопрос, и путать их нельзя, иначе снимок не будет снят вовсе */
const canUndo = snap => !!snap && undoStack.includes(snap);
const hasUndo = () => undoStack.length > 0;

/* Вернуть состояние к снимку. Всё, что было после него, пропадает —
   включая графики, созданные помощником: они тоже лежат в STATE.

   Возвращаем **в те же объекты**, а не подменяем STATE целиком: открытая
   страница держит ссылки на свой дашборд и его графики, и если подменить
   объект, она станет рисовать то, чего в состоянии уже нет. Заодно
   остаётся верной точка отсчёта у «Отменить». */
function restoreMap(live, snap) {
  snap = snap || {};
  Object.keys(live).forEach(k => { if (!snap[k]) delete live[k]; });
  Object.entries(snap).forEach(([k, v]) => {
    if (live[k] && typeof live[k] === 'object' && typeof v === 'object') {
      Object.keys(live[k]).forEach(f => { if (!(f in v)) delete live[k][f]; });
      Object.assign(live[k], clone(v));
    } else live[k] = clone(v);
  });
}
function undoState(snap) {
  const s = snap || undoStack[undoStack.length - 1];
  if (!s) return false;
  const i = undoStack.indexOf(s);
  if (i >= 0) undoStack.length = i;      // снимки поверх этого больше не нужны
  const from = s.state;
  ['dashboards', 'charts', 'datasets'].forEach(k => restoreMap(STATE[k], from[k]));
  Object.keys(from).forEach(k => { if (!['dashboards', 'charts', 'datasets'].includes(k)) STATE[k] = clone(from[k]); });
  syncDatasetsFromState();
  saveState();
  return true;
}
function dropUndo(snap) {
  const i = undoStack.indexOf(snap);
  if (i >= 0) undoStack.splice(i, 1);
}

/* Реестр DS — это STATE.datasets плюс строки. После отката метаданные
   другие, поэтому строки схем порождаем заново (тот же seed — те же
   цифры), у загруженных наборов строки остаются из памяти. */
function syncDatasetsFromState() {
  Object.keys(DS).forEach(id => {
    if (DS[id].builtin || DS[id].preview) return;
    if (!STATE.datasets[id]) delete DS[id];
  });
  Object.values(STATE.datasets || {}).forEach(meta => {
    const cur = DS[meta.id];
    if (meta.kind === 'schema') {
      DS[meta.id] = Object.assign({}, meta, { rows: generateSchemaRows(meta.schema) });
    } else {
      DS[meta.id] = Object.assign({}, meta, {
        rows: (cur && cur.rows) || [],
        missingRows: cur ? cur.missingRows : true,
      });
    }
  });
  applyDsOverrides();
}

/* Изменение с возможностью отката: снимок, правка, запись.
   Пишущий код не обязан помнить про saveState и снимки. */
function mutate(label, fn) {
  const snap = snapState(label);
  let r;
  try { r = fn(); }
  catch (e) { undoState(snap); throw e; }
  saveState();
  return r;
}

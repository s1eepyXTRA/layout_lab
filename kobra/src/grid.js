/* =============================================================
   Кобра · сетка дашборда
   Своя сетка в 12 колонок с абсолютным позиционированием: размеры
   блоков и уплотнение раскладки. Этим же пользуются генераторы —
   черновик по набору и сборка из шаблона, — поэтому код лежит
   отдельно от страницы дашборда.
   ============================================================= */

const G_COLS = 12, G_ROWH = 20, G_GAP = 12;

function collides(a, b) { return a !== b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function compactLayout(items, fixed) {
  const sorted = [...items].sort((a, b) => (a === fixed ? -1 : b === fixed ? 1 : 0) || a.y - b.y || a.x - b.x);
  const placed = [];
  sorted.forEach(it => {
    if (it !== fixed) {
      while (placed.some(p => collides(it, p))) it.y++;
    }
    placed.push(it);
  });
  // Поднимаем вверх всё, что можно
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const done = [];
  order.forEach(it => {
    while (it.y > 0 && !done.some(p => collides(Object.assign({}, it, { y: it.y - 1 }), p))) it.y--;
    while (done.some(p => collides(it, p))) it.y++;
    done.push(it);
  });
  return items;
}
function itemDefaultSize(type, chart) {
  if (type === 'header') return { w: 12, h: 2 };
  if (type === 'divider') return { w: 12, h: 1 };
  if (type === 'markdown') return { w: 6, h: 6 };
  if (chart && chart.viz.startsWith('big_number')) return { w: 3, h: 7 };
  if (chart && (chart.viz === 'table' || chart.viz === 'pivot' || chart.viz === 'heatmap')) return { w: 12, h: 14 };
  return { w: 6, h: 12 };
}

/* ============================================================
   Кобра · дашборд
   ============================================================ */
const tabMemory = {};
/* Что не построилось: chartId → текст ошибки. Нужен AI-ассистенту при
   доработке — он чинит то, что реально сломалось. */
const chartErrors = {};
const crossMemory = {};
let fbarOpen = !(window.innerWidth < 760);

function renderDashboard(main, id, q) {
  const saved = STATE.dashboards[id];
  if (!saved) {
    main.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('b', null, 'Шаблон не найден'), 'Возможно, его удалили.', h('br'), h('a', { class: 'btn', href: '#/dashboards' }, 'Ко всем шаблонам'))));
    return () => { };
  }
  // Без права правки режимы правки не открываются даже по прямой ссылке
  const mayEdit = canEdit(saved);
  if (!mayEdit && (q.edit === '1' || q.tune === '1')) toast(whyReadOnly(saved), true);
  const editing = q.edit === '1' && mayEdit;
  const tuning = !editing && q.tune === '1' && mayEdit;   // простая правка: только подписи и разрезы
  // Правка идёт по живому состоянию, а «Отменить» возвращает снимок: так
  // откат один на все режимы и на помощника, а не свой в каждом (store.js)
  const editSnap = (editing || tuning) ? snapState(editing ? 'Редактирование' : 'Названия и разрезы') : null;
  let touched = false;                          // что-то правили — есть что откатывать
  const tuneTouch = () => { touched = true; };
  const tuneTouchDs = () => { touched = true; };
  const D = saved;
  const original = JSON.stringify(saved);
  let draftHandled = false; // судьбу правки решили сами: «Сохранить» или «Отменить»
  const dirty = () => touched || JSON.stringify(D) !== original;
  if (!D.tabs.length) D.tabs.push({ id: uid('t'), title: 'Вкладка 1', items: [] });
  let tabId = tabMemory[id] && D.tabs.some(t => t.id === tabMemory[id]) ? tabMemory[id] : D.tabs[0].id;
  let cross = crossMemory[id] || (crossMemory[id] = []);
  let pending = {}; // id фильтра -> значение
  D.filters.forEach(f => { pending[f.id] = clone(f.value ?? f.def ?? null); });
  let panelTab = '';      // вкладка палитры: blank | charts | els (выбирается при первой отрисовке)
  let editingMd = null;
  const cells = new Map(); // item.i -> {el, root, ro}
  const narrow = () => window.innerWidth < 760;

  const dash = h('div', { class: 'dash' });
  main.appendChild(dash);
  const fbar = h('aside', { class: 'fbar' + (fbarOpen ? '' : ' closed'), 'aria-label': 'Фильтры шаблона' });
  const dmain = h('div', { class: 'dash-main' });
  const panel = editing ? h('aside', { class: 'edit-panel', 'aria-label': 'Добавление элементов' }) : null;
  dash.append(fbar, dmain);
  if (panel) dash.appendChild(panel);

  const curTab = () => D.tabs.find(t => t.id === tabId) || D.tabs[0];
  const markDirty = () => { /* черновик сравнивается при выходе */ };
  const persistView = () => { if (!editing) { saved.updated = saved.updated || Date.now(); saveSoon(); } };

  /* ---------- Фильтры ---------- */
  function filterToQuery(f, val) {
    if (f.type === 'time') return val && val.preset && val.preset !== 'all' ? { col: f.col, op: 'time_range', val } : null;
    if (f.type === 'range') return val && (val[0] !== '' && val[0] != null || val[1] !== '' && val[1] != null) ? { col: f.col, op: 'between', val } : null;
    return Array.isArray(val) && val.length ? { col: f.col, op: 'in', val } : null;
  }
  function inScope(f, chartId) { return f.scope === 'all' || !f.scope || (Array.isArray(f.scope) && f.scope.includes(chartId)); }
  function extraFiltersFor(chartId) {
    const out = [];
    D.filters.forEach(f => { if (inScope(f, chartId)) { const qf = filterToQuery(f, f.value); if (qf) out.push(qf); } });
    cross.forEach(c => { if (c.source !== chartId) c.filters.forEach(x => out.push(x)); });
    return out;
  }
  function paintFilterBar() {
    clear(fbar);
    fbar.className = 'fbar' + (fbarOpen ? '' : ' closed');
    const toggle = iconBtn(fbarOpen ? 'chevL' : 'filter', fbarOpen ? 'Свернуть панель фильтров' : 'Открыть панель фильтров', () => { fbarOpen = !fbarOpen; paintFilterBar(); setTimeout(layoutGrid, 200); });
    const nApplied = D.filters.filter(f => filterToQuery(f, f.value)).length + cross.length;
    fbar.appendChild(h('div', { class: 'fbar-head' }, fbarOpen ? ic('filter') : null, h('b', null, 'Фильтры', nApplied ? h('span', { class: 'pill acc', style: { marginLeft: '8px' } }, nApplied) : null),
      fbarOpen ? iconBtn('settings', 'Настроить фильтры', openFilterEditor) : null, toggle));
    if (!fbarOpen) {
      if (nApplied) fbar.appendChild(h('div', { style: { textAlign: 'center', marginTop: '6px' } }, h('span', { class: 'pill acc' }, nApplied)));
      return;
    }
    const body = h('div', { class: 'fbar-body' });
    if (!D.filters.length) body.appendChild(h('div', { class: 'muted', style: { fontSize: '13px' } }, 'В шаблоне пока нет фильтров.', h('br'), h('button', { class: 'btn sm', style: { marginTop: '10px' }, onclick: openFilterEditor }, ic('plus'), 'Добавить фильтр')));
    D.filters.forEach(f => {
      const ds = dsGet(f.datasetId);
      const applied = !!filterToQuery(f, f.value);
      const wrap = h('div', { class: 'fitem' }, h('div', { class: 'lbl' }, applied ? h('span', { class: 'dot', title: 'Фильтр применён' }) : null, f.name));
      if (!ds) { wrap.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Набор данных не найден')); body.appendChild(wrap); return; }
      if (f.type === 'time') {
        const val = pending[f.id] || { preset: 'all' };
        const sel = selectEl(Object.entries(TIME_PRESETS).map(([k, v]) => [k, v]), val.preset, v => {
          pending[f.id] = v === 'custom' ? { preset: 'custom', from: isoDate(truncTime(dsMaxDate(ds, f.col), 'month')), to: isoDate(dsMaxDate(ds, f.col)) } : { preset: v };
          paintFilterBar();
        }, { 'aria-label': f.name });
        wrap.appendChild(sel);
        if (val.preset === 'custom') {
          const a = h('input', { class: 'input', type: 'date', value: val.from || '', 'aria-label': 'С даты', onchange: e => { pending[f.id] = Object.assign({}, pending[f.id], { from: e.target.value }); updateFoot(); } });
          const b = h('input', { class: 'input', type: 'date', value: val.to || '', 'aria-label': 'По дату', onchange: e => { pending[f.id] = Object.assign({}, pending[f.id], { to: e.target.value }); updateFoot(); } });
          wrap.appendChild(h('div', { class: 'row2', style: { marginTop: '6px' } }, a, b));
        } else if (val.preset !== 'all') wrap.appendChild(h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, describeTimeRange(val, ds, f.col).replace(/^.*\(|\)$/g, '')));
      } else if (f.type === 'range') {
        const val = pending[f.id] || ['', ''];
        const [lo, hi] = numRange(ds, f.col);
        const a = h('input', { class: 'input', type: 'number', placeholder: 'от ' + fmtNum(lo, 'smart'), value: val[0] ?? '', 'aria-label': f.name + ' от', oninput: e => { pending[f.id] = [e.target.value, (pending[f.id] || [])[1] ?? '']; updateFoot(); } });
        const b = h('input', { class: 'input', type: 'number', placeholder: 'до ' + fmtNum(hi, 'smart'), value: val[1] ?? '', 'aria-label': f.name + ' до', oninput: e => { pending[f.id] = [(pending[f.id] || [])[0] ?? '', e.target.value]; updateFoot(); } });
        wrap.appendChild(h('div', { class: 'row2' }, a, b));
      } else {
        const ms = multiSelect({
          multi: f.multi !== false, value: pending[f.id] || [], placeholder: 'Все значения',
          options: () => {
            const dep = f.dependent ? D.filters.filter(o => o.id !== f.id && o.datasetId === f.datasetId).map(o => filterToQuery(o, pending[o.id])).filter(Boolean) : [];
            return distinctValues(ds, f.col, dep).map(x => ({ value: x.value, label: typeof x.value === 'number' && dsCol(ds, f.col).type === 'date' ? fmtDate(x.value) : String(x.value), count: x.count }));
          },
          onChange: v => { pending[f.id] = f.multi === false ? (v == null ? [] : [v]) : v; updateFoot(); },
        });
        wrap.appendChild(ms);
      }
      body.appendChild(wrap);
    });
    if (cross.length) {
      body.appendChild(h('div', { class: 'sec' }, 'Кросс-фильтры'));
      cross.forEach(c => {
        const src = STATE.charts[c.source];
        body.appendChild(h('div', { class: 'xf-chip' }, h('span', null, c.filters.map(x => x.label).join('; '), h('small', null, 'из «' + (src ? src.name : 'графика') + '»')),
          iconBtn('x', 'Убрать кросс-фильтр', () => { cross = crossMemory[id] = cross.filter(x => x !== c); paintFilterBar(); refreshCharts(); }, 'sm')));
      });
    }
    fbar.appendChild(body);
    const applyBtn = h('button', { class: 'btn primary', onclick: applyFilters }, 'Применить');
    const clearBtn = h('button', { class: 'btn', onclick: clearFilters }, 'Очистить всё');
    fbar.appendChild(h('div', { class: 'fbar-foot' }, clearBtn, applyBtn));
    fbar._apply = applyBtn;
    updateFoot();
  }
  function updateFoot() {
    if (!fbar._apply) return;
    const changed = D.filters.some(f => JSON.stringify(pending[f.id] ?? null) !== JSON.stringify(f.value ?? null));
    fbar._apply.disabled = !changed;
  }
  function applyFilters() {
    D.filters.forEach(f => { f.value = clone(pending[f.id] ?? null); });
    if (editing) { const s = STATE.dashboards[id]; s.filters.forEach(sf => { const df = D.filters.find(x => x.id === sf.id); if (df) sf.value = clone(df.value); }); }
    saveSoon();
    paintFilterBar(); refreshCharts();
  }
  function clearFilters() {
    D.filters.forEach(f => { pending[f.id] = f.type === 'time' ? { preset: 'all' } : f.type === 'range' ? ['', ''] : []; });
    cross = crossMemory[id] = [];
    applyFilters();
  }
  function onCross(chartId) {
    if (!D.crossFilter) return null;
    return filters => {
      const ex = cross.find(c => c.source === chartId);
      const same = ex && JSON.stringify(ex.filters.map(f => [f.col, f.val])) === JSON.stringify(filters.map(f => [f.col, f.val]));
      cross = crossMemory[id] = cross.filter(c => c.source !== chartId);
      if (!same) cross.push({ source: chartId, filters });
      paintFilterBar();
      refreshCharts();
    };
  }

  /* ---------- Шапка ---------- */
  function paintHead() {
    const head = h('div', { class: 'dash-head' + (D.preview ? ' ex' : '') });
    /* Черновик по описанию: ничего ещё не сохранено, поэтому в шапке —
       «Сохранить», «Доработать» и «Отменить», а не обычные кнопки правки. */
    if (D.aiDraft) {
      head.append(
        h('button', { class: 'btn', title: 'Выбросить черновик', onclick: () => aiDraftDrop(id) }, 'Отменить'),
        h('h1', null, D.title, h('span', { class: 'pill acc', style: { marginLeft: '10px', verticalAlign: 'middle' }, title: 'Пока не сохранён: уйдёте со страницы — пропадёт' }, 'Черновик')),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn ai', title: 'Сказать, что поправить, и пересобрать', onclick: () => openAiComposer({ draftId: id }) }, 'Доработать'),
        h('button', { class: 'btn primary', onclick: () => aiDraftSave(id) }, ic('check'), 'Сохранить шаблон'));
      return head;
    }
    // Пример шаблона живёт только в памяти и пропадает при уходе со страницы:
    // править его бессмысленно, поэтому в шапке — возврат в каталог и выбор
    // шаблона. Шапка прилипает, иначе на длинном примере возврат уезжает вверх.
    if (D.preview) {
      head.append(
        h('button', { class: 'btn primary back-ex', onclick: () => go(D.previewBack || '#/templates') }, ic('chevL'), 'Вернуться к шаблонам'),
        h('h1', null, D.title),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => {
          const tpl = tplById((D.fromTemplate || {}).tplId);
          if (tpl) openTemplateDialog(tpl, D.previewDs || null); else go('#/templates');
        } }, ic('check'), 'Выбрать этот шаблон'));
      return head;
    }
    if (editing) {
      const inp = h('input', { class: 'title-input', value: D.title, 'aria-label': 'Название шаблона', oninput: e => { D.title = e.target.value; } });
      head.appendChild(inp);
    } else head.appendChild(h('h1', null, D.title,
      isMockupDs(dsGet((D.fromTemplate || {}).datasetId))
        ? h('span', { class: 'pill acc', style: { marginLeft: '10px', verticalAlign: 'middle' }, title: 'Цифры придуманы: это макет, а не отчёт' }, 'Макет')
        : null,
      mayEdit ? null
        : h('span', { class: 'pill', style: { marginLeft: '10px', verticalAlign: 'middle' }, title: whyReadOnly(saved) }, 'Только просмотр')));
    head.appendChild(h('div', { class: 'grow' }));
    const more = h('button', { class: 'btn', title: 'Ещё', 'aria-label': 'Ещё действия' }, ic('dots'));
    more.addEventListener('click', () => openMenu(more, [
      mayEdit ? { label: 'Настроить фильтры', icon: 'filter', onClick: openFilterEditor } : null,
      mayEdit ? { label: (D.crossFilter ? 'Выключить' : 'Включить') + ' кросс-фильтрацию', icon: 'link', onClick: () => { D.crossFilter = !D.crossFilter; if (!editing) saveState(); if (!D.crossFilter) { cross = crossMemory[id] = []; } paintFilterBar(); refreshCharts(); toast(D.crossFilter ? 'Кросс-фильтрация включена: кликните по элементу графика' : 'Кросс-фильтрация выключена'); } } : null,
      mayEdit ? { label: 'Свойства шаблона', icon: 'settings', onClick: openProps } : null,
      { label: 'Экспортировать в файл…', icon: 'download', onClick: () => openExportDialog(id) },
      mayEdit ? { label: 'Заполнить ТЗ по блокам…', icon: 'edit', onClick: () => openSpecTable(D) } : null,
      { label: 'Выгрузить ТЗ для аналитиков…', icon: 'text', onClick: () => openSpecDialog(D) },
      canShare(saved) ? { label: 'Поделиться…', icon: 'link', onClick: () => openShareDialog(saved, 'шаблону', () => { saveState(); paintHeadOnly(); }) } : null,
      !editing ? '-' : null,
      !editing ? { label: 'Дублировать', icon: 'copy', onClick: () => duplicateDashboard(id) } : null,
      !editing && mayEdit ? { label: 'Удалить шаблон', icon: 'trash', danger: true, onClick: () => deleteDashboard(id) } : null,
    ]));
    if (tuning) {
      head.append(
        h('button', { class: 'btn', onclick: tuneCancel }, 'Отменить'),
        h('button', { class: 'btn', title: 'Полное редактирование', onclick: () => leaveTo('#/d/' + id + '?edit=1') }, ic('edit'), 'Больше настроек'),
        h('button', { class: 'btn primary', onclick: tuneDone }, ic('check'), 'Готово'), more);
    } else if (editing) {
      head.append(
        h('button', { class: 'btn', onclick: cancelEdit }, 'Отменить'),
        h('button', { class: 'btn primary', onclick: saveEdit }, ic('check'), 'Сохранить'), more);
    } else if (!mayEdit) {
      // Тупик «нельзя править» бесполезен: копия — это то, что человеку нужно
      head.append(
        h('button', { class: 'btn', title: 'Обновить все графики', 'aria-label': 'Обновить все графики', onclick: () => refreshCharts() }, ic('refresh')),
        h('button', { class: 'btn', title: whyReadOnly(saved), onclick: () => toast(whyReadOnly(saved)) }, ic('eye'), 'Почему только просмотр'),
        h('button', { class: 'btn primary', title: 'Сделать свою копию: её можно править как угодно', onclick: () => duplicateDashboard(id) }, ic('copy'), 'Сделать копию'), more);
    } else {
      /* На макете главный инструмент — простая правка, а конструктор нужен
         аналитику. Раньше зелёной была «Редактировать», и человек, который
         пришёл поменять подписи, попадал в палитру блоков. */
      const mock = isMockupDs(dsGet((D.fromTemplate || {}).datasetId));
      head.append(
        h('button', { class: 'btn' + (mock ? ' primary' : ''), title: 'Поменять названия, показатели и разрезы прямо на блоках', onclick: () => go('#/d/' + id + '?tune=1') }, ic('edit'), 'Названия и разрезы'),
        h('button', { class: 'btn', title: 'Обновить все графики', 'aria-label': 'Обновить все графики', onclick: () => refreshCharts() }, ic('refresh')),
        h('button', { class: 'btn', title: 'Задание аналитикам данных: состав, формулы, разрезы', onclick: () => openSpecDialog(D) }, ic('text'), 'ТЗ'),
        h('button', { class: 'btn' + (mock ? '' : ' primary'), title: 'Конструктор: блоки, вкладки, фильтры', onclick: () => go('#/d/' + id + '?edit=1') }, ic('edit'), 'Редактировать'), more);
    }
    return head;
  }
  function tuneDone() {
    draftHandled = true;
    const changed = dirty();
    saved.updated = Date.now();
    saveState();
    if (!changed) dropUndo(editSnap);   // нечего откатывать — незачем и держать
    toast(changed ? 'Изменения сохранены' : 'Изменений не было');
    go('#/d/' + id);
  }
  async function tuneCancel() {
    if (dirty() && !(await confirmDialog('Отменить изменения', 'Названия и разрезы вернутся к тому, что было.', 'Отменить изменения'))) return;
    draftHandled = true;
    undoState(editSnap);
    go('#/d/' + id);
  }
  function saveEdit() {
    draftHandled = true;
    freshDashboards.delete(id);
    D.updated = Date.now();
    D.title = (D.title || '').trim() || 'Без названия';
    saveState();
    toast('Шаблон сохранён');
    go('#/d/' + id);
  }
  async function cancelEdit() {
    if (dirty() && !(await confirmDialog('Отменить изменения', 'Несохранённые изменения шаблона пропадут.', 'Отменить изменения'))) return;
    draftHandled = true;
    // Снимок возвращает всё разом: и состав шаблона, и графики, и придуманные
    // данные. Раньше это были три разных набора резервных копий.
    undoState(editSnap);
    go('#/d/' + id);
  }
  function openProps() {
    let title = D.title, scheme = D.scheme || '', crossF = D.crossFilter;
    openModal({
      title: 'Свойства шаблона',
      body: h('div', null,
        field('Название', h('input', { class: 'input', value: title, oninput: e => { title = e.target.value; } })),
        field('Цветовая схема', selectEl([['', 'Как в настройках графиков'], ...Object.entries(COLOR_SCHEMES).map(([k, v]) => [k, v.label])], scheme, v => { scheme = v; }), 'Схема шаблона заменяет схемы отдельных графиков.'),
        checkbox('Кросс-фильтрация: клик по графику фильтрует остальные', crossF, v => { crossF = v; })),
      foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
        D.title = title.trim() || D.title; D.scheme = scheme || null; D.crossFilter = crossF;
        if (!crossF) cross = crossMemory[id] = [];
        if (!editing) { D.updated = Date.now(); saveState(); }
        close(); paintAll();
      } }, 'Сохранить')],
    });
  }

  /* ---------- Вкладки ---------- */
  function paintTabs() {
    if (!editing && D.tabs.length < 2) return null;
    const bar = h('div', { class: 'tabs', role: 'tablist' });
    D.tabs.forEach((t, i) => {
      const on = t.id === tabId;
      const tab = h('div', { class: 'tab' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', tabindex: 0,
        onclick: () => { if (tabId !== t.id) { tabId = tabMemory[id] = t.id; editingMd = null; paintBody(); } },
        onkeydown: e => { if (e.key === 'Enter') tab.click(); } });
      if (editing && on) {
        const inp = h('input', { value: t.title, 'aria-label': 'Название вкладки', onclick: e => e.stopPropagation(), oninput: e => { t.title = e.target.value; } });
        tab.appendChild(inp);
        if (i > 0) tab.appendChild(iconBtn('chevL', 'Переместить влево', () => { D.tabs.splice(i, 1); D.tabs.splice(i - 1, 0, t); paintBody(); }));
        if (i < D.tabs.length - 1) tab.appendChild(iconBtn('chevR', 'Переместить вправо', () => { D.tabs.splice(i, 1); D.tabs.splice(i + 1, 0, t); paintBody(); }));
        if (D.tabs.length > 1) tab.appendChild(iconBtn('x', 'Удалить вкладку', async () => {
          if (t.items.length && !(await confirmDialog('Удалить вкладку', `Вкладка «${t.title}» и все ${t.items.length} ${plural(t.items.length, 'элемент', 'элемента', 'элементов')} на ней будут удалены из шаблона.`))) return;
          D.tabs = D.tabs.filter(x => x !== t); tabId = D.tabs[Math.max(0, i - 1)].id; paintBody();
        }));
      } else tab.appendChild(document.createTextNode(t.title));
      bar.appendChild(tab);
    });
    if (editing) bar.appendChild(h('button', { class: 'tab', title: 'Добавить вкладку', onclick: addTab }, ic('plus'), 'Вкладка'));
    return bar;
  }
  function addTab() {
    const t = { id: uid('t'), title: 'Вкладка ' + (D.tabs.length + 1), items: [] };
    D.tabs.push(t); tabId = t.id; paintBody();
  }

  /* ---------- Сетка ---------- */
  let gridEl = null, phEl = null, gridRO = null;
  function disposeCells() {
    cells.forEach(c => { c.ro && c.ro.disconnect(); c.root && disposeViz(c.root); });
    cells.clear();
    gridRO && gridRO.disconnect(); gridRO = null;
  }
  function geom() {
    const W = gridEl.clientWidth;
    const colW = (W - G_GAP * (G_COLS - 1)) / G_COLS;
    return { W, colW };
  }
  function px(it, g) {
    return { left: it.x * (g.colW + G_GAP), top: it.y * (G_ROWH + G_GAP), width: it.w * g.colW + (it.w - 1) * G_GAP, height: it.h * G_ROWH + (it.h - 1) * G_GAP };
  }
  function place(el, p) { el.style.left = p.left + 'px'; el.style.top = p.top + 'px'; el.style.width = p.width + 'px'; el.style.height = p.height + 'px'; }
  /* В простой правке под каждым блоком живёт полоса с полями. Она должна
     занимать место в сетке, иначе наезжает на график и на соседние блоки. */
  const TUNE_ROWS = 4;                 // пока не измерили
  const tuneRows = new Map();          // i → сколько рядов сетки занимает полоса
  function tuneLayout(items) {
    const copy = items.map(i => Object.assign({}, i, { h: i.h + (i.type === 'chart' ? (tuneRows.get(i.i) || TUNE_ROWS) : 0) }));
    compactLayout(copy);
    return copy;
  }
  /* Полоса переносит поля по ширине плитки, поэтому её высоту не угадать:
     измеряем после раскладки и, если не совпало, раскладываем ещё раз.
     Иначе второй разрез наезжает на график — так и было до измерения. */
  function measureTuneRows() {
    let changed = false;
    cells.forEach((c, key) => {
      const bar = c.el.querySelector('.tune-bar');
      if (!bar || !bar.offsetHeight) return;
      const rows = Math.max(2, Math.ceil((bar.offsetHeight + G_GAP) / (G_ROWH + G_GAP)));
      if (tuneRows.get(key) !== rows) { tuneRows.set(key, rows); changed = true; }
    });
    return changed;
  }
  let tuneMeasuring = false;
  function layoutGrid(items) {
    layoutPass(items);
    if (!tuning || tuneMeasuring) return;
    tuneMeasuring = true;
    if (measureTuneRows()) layoutPass(items);
    tuneMeasuring = false;
  }
  function layoutPass(items) {
    if (!gridEl) return;
    const t = curTab();
    items = items || t.items;
    if (tuning) items = tuneLayout(items);
    if (narrow()) {
      let y = 0;
      [...items].sort((a, b) => a.y - b.y || a.x - b.x).forEach(it => {
        const c = cells.get(it.i); if (!c) return;
        let hpx = it.type === 'divider' ? 24 : Math.max(it.h * G_ROWH + (it.h - 1) * G_GAP, it.type === 'chart' ? 260 : 40);
        if (it.type === 'markdown') { const md = c.el.querySelector('.md'); if (md) { c.el.style.height = 'auto'; hpx = Math.max(hpx, md.scrollHeight + 4); } }
        Object.assign(c.el.style, { left: '0px', width: '100%', top: y + 'px', height: hpx + 'px' });
        y += hpx + G_GAP;
      });
      gridEl.style.height = y + 'px';
      return;
    }
    const g = geom();
    let maxB = 0;
    items.forEach(it => {
      const c = cells.get(it.i); if (!c) return;
      if (!c.el.classList.contains('dragging')) place(c.el, px(it, g));
      maxB = Math.max(maxB, it.y + it.h);
    });
    gridEl.style.height = ((maxB + (editing ? 8 : 0)) * (G_ROWH + G_GAP)) + 'px';
  }
  function paintGrid() {
    disposeCells();
    const t = curTab();
    gridEl = h('div', { class: 'dgrid' + (editing ? ' editing' : '') });
    if (!t.items.length) {
      const empty = h('div', { class: 'empty' }, h('b', null, editing ? 'Пустая вкладка' : 'Здесь пока ничего нет'),
        editing ? 'Добавьте блоки с панели справа.' : 'Откройте режим редактирования и добавьте графики.',
        h('br'),
        editing ? null
          : mayEdit ? h('button', { class: 'btn primary', onclick: () => go('#/d/' + id + '?edit=1') }, ic('edit'), 'Редактировать') : null);
      return h('div', { class: 'grid-wrap' }, empty);
    }
    compactLayout(t.items);
    t.items.forEach(it => gridEl.appendChild(buildItem(it)));
    const wrap = h('div', { class: 'grid-wrap' }, gridEl);
    gridRO = new ResizeObserver(debounce(() => layoutGrid(), 30));
    requestAnimationFrame(() => { if (gridEl && gridEl.isConnected) { gridRO.observe(gridEl); layoutGrid(); renderVisibleCharts(); } });
    return wrap;
  }
  function renderVisibleCharts() {
    cells.forEach(c => { if (c.chartId) drawChart(c); });
  }
  /* Полоса простой правки: название, показатель, единица, разрез и категории —
     всё словами задачи. Придуманные данные правятся, настоящие — нет. */
  function tuneBar(it, chart, cell) {
    const ds = dsGet(chart.datasetId);
    const bar = h('div', { class: 'tune-bar' });
    const nameInp = h('input', { class: 'input', value: chart.name, 'aria-label': 'Название блока',
      oninput: e => { tuneTouch(); guidedRename(chart, e.target.value); cell.titleEl && (cell.titleEl.textContent = chart.name); } });
    bar.appendChild(h('label', { class: 'tune-f' }, h('span', null, 'Название'), nameInp));
    if (!ds) return bar;
    const mock = isMockupDs(ds);

    // Показатель и единица живут в метрике набора, поэтому меняются везде сразу
    if (mock && guidedMetricOf(ds, chart)) {
      const redraw = () => { guidedRetitle(ds, chart); nameInp.value = chart.name; if (cell.titleEl) cell.titleEl.textContent = chart.name; refreshCharts(); };
      bar.appendChild(h('label', { class: 'tune-f' }, h('span', null, 'Показатель'),
        h('input', { class: 'input', value: guidedMetricOf(ds, chart).label, 'aria-label': 'Название показателя',
          onchange: e => { tuneTouchDs(); guidedSetMetricLabel(ds, chart, e.target.value); redraw(); } })));
      bar.appendChild(h('label', { class: 'tune-f', style: { flex: '0 1 150px' } }, h('span', null, 'Единица'),
        h('input', { class: 'input', value: guidedSuffixOf(ds, chart) || '', placeholder: '₽, шт., мин',
          'aria-label': 'Единица измерения',
          onchange: e => { tuneTouchDs(); guidedSetSuffix(ds, chart, e.target.value); refreshCharts(); } })));
    }

    const slots = guidedDimSlots(ds, chart);
    if (!slots.length) {
      bar.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px' } },
        `Показывает ${guidedWhat(ds, chart)} — разрез не меняется`));
      return bar;
    }
    slots.forEach(slot => bar.appendChild(tuneDim(it, chart, cell, ds, slot, nameInp)));
    return bar;
  }
  /* Один разрез блока, своей строкой. На макете правятся название разреза и
     сами категории — сколько их, как называются и какая форма распределения;
     у настоящего набора разрез выбирается из колонок, а у времени — шаг. */
  function tuneDim(it, chart, cell, ds, slot, nameInp) {
    const row = h('div', { class: 'tune-dim' });
    const mock = isMockupDs(ds);
    const lab = (text, el, flex) => h('label', { class: 'tune-f', style: flex ? { flex } : null }, h('span', null, text), el);
    const retitle = () => { guidedRetitle(ds, chart); nameInp.value = chart.name; if (cell.titleEl) cell.titleEl.textContent = chart.name; };
    const relayout = () => { repaintItem(it); layoutGrid(); };

    // Слот пустой: второй разрез человек включает сам
    if (!slot.key) {
      row.appendChild(h('button', { class: 'btn sm', onclick: () => {
        tuneTouch();
        if (mock) { tuneTouchDs(); guidedParamSet(chart, slot.spec, guidedAddMockDim(ds, chart).key); }
        else {
          const opts = guidedDimOptions(ds, chart, slot);
          if (!opts.length) { toast('Больше нет колонок, по которым можно разбить', true); return; }
          guidedParamSet(chart, slot.spec, opts[0].key);
        }
        relayout();
      } }, ic('plus'), slot.add || 'Добавить второй разрез'));
      return row;
    }
    // Время: колонка там одна, менять имеет смысл шаг
    if (slot.time) {
      if (GUIDED_GRAIN[chart.viz]) row.appendChild(lab('Период', selectEl(Object.entries(TIME_GRAINS), guidedGrainOf(chart), v => {
        tuneTouch(); guidedSetGrain(chart, v); retitle(); drawChart(cell);
      }, { 'aria-label': 'Шаг по времени' })));
      else row.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Разрез по дате'));
      return row;
    }
    const cats = mock ? guidedCats(ds, slot.key) : null;
    if (cats) {
      // В макете разрез — это просто его название: какая колонка под ним, человеку незачем
      row.appendChild(lab(slot.label, h('input', { class: 'input', value: guidedDimLabel(ds, slot.key) || '',
        placeholder: 'Филиалы, продукты, статусы', 'aria-label': 'Название разреза',
        onchange: e => { tuneTouchDs(); if (guidedRenameDim(ds, slot.key, e.target.value)) { retitle(); refreshCharts(); } } })));
      // Категории разреза: их число и названия — это значения в придуманных данных
      const namesInp = h('input', { class: 'input', value: cats.values.join(', '), placeholder: 'Названия через запятую',
        'aria-label': 'Названия категорий' });
      const cntInp = h('input', { class: 'input', type: 'number', min: 2, max: 12, value: cats.count,
        'aria-label': 'Сколько категорий', style: { width: '64px' } });
      const applyCats = () => {
        tuneTouchDs();
        const res = guidedSetCats(ds, slot.key, cntInp.value, namesInp.value.split(',').map(x => x.trim()).filter(Boolean));
        if (!res) return;
        migrateFilterValues(res.col, res.old, res.next);
        namesInp.value = res.next.join(', ');
        cntInp.value = res.next.length;
        paintFilterBar();
        refreshCharts();
      };
      cntInp.addEventListener('change', applyCats);
      namesInp.addEventListener('change', applyCats);
      row.appendChild(lab('Категорий', cntInp, '0 1 120px'));
      row.appendChild(lab('Названия', namesInp, '2 1 240px'));
      row.appendChild(h('button', { class: 'btn sm', title: 'Другая форма распределения: подписи те же, пропорции другие',
        onclick: () => { tuneTouchDs(); if (guidedCycleSpread(ds, slot.key)) refreshCharts(); } }, ic('refresh'), 'Распределение'));
    } else {
      // Настоящий набор: разрез выбирается из его же колонок
      const opts = guidedDimOptions(ds, chart, slot);
      row.appendChild(lab(slot.nth ? slot.label : 'В разрезе',
        selectEl(opts.map(o => [o.key, o.label]), slot.key, v => {
          tuneTouch(); guidedParamSet(chart, slot.spec, v); retitle(); repaintItem(it);
        }, { 'aria-label': 'В разрезе чего' })));
    }
    if (slot.optional) row.appendChild(iconBtn('x', 'Убрать этот разрез', () => {
      tuneTouch(); guidedParamSet(chart, slot.spec, null); retitle(); relayout();
    }, 'sm'));
    return row;
  }
  /* Переименовали категории — переносим выбранное в фильтрах по месту, пропавшее убираем */
  function migrateFilterValues(col, oldVals, newVals) {
    D.filters.forEach(f => {
      if (f.col !== col || !Array.isArray(f.value)) return;
      const map = v => { const i = oldVals.indexOf(v); return i >= 0 ? newVals[i] : null; };
      f.value = f.value.map(map).filter(v => v != null);
      pending[f.id] = clone(f.value);
    });
  }
  function drawChart(c) {
    // Отложенная отрисовка может добраться до плитки, которую уже сняли с экрана
    // (например, данные макета успели смениться) — рисовать её незачем и нечем
    if (!c.el || !c.el.isConnected) return;
    const chart = STATE.charts[c.chartId];
    if (!chart) return vizMsg(c.root, 'График удалён', true);
    const ex = extraFiltersFor(c.chartId);
    const ds = dsGet(chart.datasetId);
    // Расчёт может идти в базе, поэтому ошибку узнаём по завершении
    renderChart(c.root, chart, { scheme: D.scheme, extraFilters: ex, onCross: onCross(c.chartId), crossActive: (cross.find(x => x.source === c.chartId) || {}).filters })
      .then(err => { if (err) chartErrors[c.chartId] = err; else delete chartErrors[c.chartId]; });
    if (c.badge) {
      const n = ds ? ex.filter(f => dsCol(ds, f.col)).length : 0;
      clear(c.badge);
      c.badge.style.display = n ? '' : 'none';
      if (n) { c.badge.appendChild(ic('filter')); c.badge.appendChild(document.createTextNode(String(n))); c.badge.title = `Применено фильтров шаблона: ${n}`; }
    }
  }
  function refreshCharts() { cells.forEach(c => { if (c.chartId) drawChart(c); }); }

  function buildItem(it) {
    const el = h('div', { class: 'gitem', 'data-i': it.i });
    const cell = { el, it };
    cells.set(it.i, cell);
    const tools = editing ? h('div', { class: 'item-tools' }) : null;
    const dragBtn = () => { const b = h('button', { class: 'iconbtn sm drag-h', title: 'Перетащить', 'aria-label': 'Перетащить' }, ic('drag')); b.addEventListener('pointerdown', e => startDrag(e, it)); return b; };
    const delBtn = () => iconBtn('trash', 'Убрать из шаблона', () => removeItem(it), 'sm');
    const cfgBtn = () => iconBtn('settings', 'Настроить блок: метрики, разрезы, фильтры', () => leaveTo('#/explore/' + it.chartId + '?back=' + id), 'sm');
    const moveBtn = () => D.tabs.length > 1 ? iconBtn('chevR', 'Перенести на другую вкладку', e => openMenu(e.currentTarget, D.tabs.filter(t => t.id !== tabId).map(t => ({ label: 'На вкладку «' + t.title + '»', onClick: () => moveItemToTab(it, t) }))), 'sm') : null;
    if (it.type === 'chart') {
      const chart = STATE.charts[it.chartId];
      const root = h('div', { class: 'viz-root' });
      const badge = h('span', { class: 'fcount', style: { display: 'none' } });
      const menuBtn = h('button', { class: 'iconbtn sm', title: 'Действия', 'aria-label': 'Действия с графиком' }, ic('dots'));
      menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        openMenu(menuBtn, [
          { label: 'Обновить', icon: 'refresh', onClick: () => drawChart(cell) },
          chart ? { label: 'Редактировать график', icon: 'edit', onClick: () => leaveTo('#/explore/' + it.chartId + '?back=' + encodeURIComponent(id)) } : null,
          { label: 'Посмотреть данные', icon: 'table', onClick: () => showDataModal(chart ? chart.name : 'Данные', root._lastData) },
          chart ? { label: 'На весь экран', icon: 'expand', onClick: () => fullscreenChart(chart) } : null,
          editing ? '-' : null,
          editing ? { label: 'Убрать из шаблона', icon: 'trash', danger: true, onClick: () => removeItem(it) } : null,
        ]);
      });
      const titleEl = h('div', { class: 't', title: chart ? chart.name : '' }, chart ? chart.name : 'График удалён');
      const head = h('div', { class: 'card-head' + (editing ? ' drag-h' : '') }, titleEl, badge, menuBtn);
      cell.titleEl = titleEl;
      if (editing) head.addEventListener('pointerdown', e => { if (!e.target.closest('button')) startDrag(e, it); });
      const body = h('div', { class: 'card-body' }, root);
      const card = h('div', { class: 'card' }, head, body);
      if (tuning && chart) card.appendChild(tuneBar(it, chart, cell));
      el.appendChild(card);
      Object.assign(cell, { root, badge, chartId: it.chartId });
      cell.ro = new ResizeObserver(debounce(() => { if (root._ec) root._ec.resize(); }, 60));
      cell.ro.observe(body);
      // Кнопка настройки на виду: «три точки» читались как «удалить»,
      // и путь к метрикам и фильтрам блока никто не находил
      if (editing) { tools.append(cfgBtn(), moveBtn() || '', delBtn()); }
    } else if (it.type === 'markdown') {
      const isEd = editing && editingMd === it.i;
      const card = h('div', { class: 'card' });
      if (isEd) {
        const ta = h('textarea', { class: 'md-edit', 'aria-label': 'Текст в формате Markdown', oninput: e => { it.text = e.target.value; } });
        ta.value = it.text || '';
        card.appendChild(ta);
        setTimeout(() => ta.focus(), 20);
      } else {
        const md = h('div', { class: 'md' });
        md.innerHTML = renderMarkdown(it.text || (editing ? '*Пустой текст — нажмите «Изменить текст»*' : ''));
        card.appendChild(md);
        if (editing) md.addEventListener('dblclick', () => { editingMd = it.i; repaintItem(it); });
      }
      el.appendChild(card);
      if (editing) tools.append(dragBtn(), iconBtn(isEd ? 'eye' : 'edit', isEd ? 'Показать результат' : 'Изменить текст', () => { editingMd = isEd ? null : it.i; repaintItem(it); }, 'sm'), moveBtn() || '', delBtn());
    } else if (it.type === 'header') {
      el.appendChild(h('div', { class: `hdr-block h-${it.size || 'l'}${it.bg ? ' bg' : ''}` }, h('h2', null, it.text || 'Заголовок')));
      if (editing) {
        el.querySelector('h2').addEventListener('dblclick', () => editHeader(it));
        tools.append(dragBtn(), iconBtn('edit', 'Изменить заголовок', () => editHeader(it), 'sm'),
          iconBtn('heading', 'Размер и фон', e => openMenu(e.currentTarget, [
            { label: 'Крупный', onClick: () => { it.size = 'l'; repaintItem(it); } }, { label: 'Средний', onClick: () => { it.size = 'm'; repaintItem(it); } },
            { label: 'Мелкий', onClick: () => { it.size = 's'; repaintItem(it); } }, '-',
            { label: it.bg ? 'Убрать фон' : 'Добавить фон', onClick: () => { it.bg = !it.bg; repaintItem(it); } }]), 'sm'),
          moveBtn() || '', delBtn());
      }
    } else if (it.type === 'divider') {
      el.appendChild(h('div', { class: 'divider-block' }, h('hr')));
      if (editing) tools.append(dragBtn(), delBtn());
    }
    if (editing) {
      el.appendChild(tools);
      const rs = h('div', { class: 'rs-h', title: 'Изменить размер', 'aria-hidden': 'true' });
      rs.addEventListener('pointerdown', e => startResize(e, it));
      el.appendChild(rs);
    }
    return el;
  }
  function repaintItem(it) {
    const old = cells.get(it.i);
    if (!old) return;
    const oldEl = old.el;
    old.ro && old.ro.disconnect(); old.root && disposeViz(old.root);
    cells.delete(it.i);
    const nel = buildItem(it);
    nel.style.cssText = oldEl.style.cssText;
    oldEl.replaceWith(nel);
    const c = cells.get(it.i);
    if (c.chartId) drawChart(c);
  }
  async function editHeader(it) {
    const v = await promptDialog('Заголовок', 'Текст заголовка', it.text || '');
    if (v != null) { it.text = v || 'Заголовок'; repaintItem(it); }
  }
  function removeItem(it) {
    const t = curTab();
    t.items = t.items.filter(x => x !== it);
    const c = cells.get(it.i);
    if (c) { c.ro && c.ro.disconnect(); c.root && disposeViz(c.root); c.el.remove(); cells.delete(it.i); }
    compactLayout(t.items); layoutGrid();
    if (!t.items.length) paintBody();
    paintPanel();
  }
  function moveItemToTab(it, t) {
    curTab().items = curTab().items.filter(x => x !== it);
    it.y = t.items.reduce((m, x) => Math.max(m, x.y + x.h), 0);
    t.items.push(it);
    toast(`Перенесено на вкладку «${t.title}»`);
    paintBody();
  }
  function addItem(item) {
    const t = curTab();
    item.i = uid('i');
    const sz = itemDefaultSize(item.type, item.chartId ? STATE.charts[item.chartId] : null);
    item.w = item.w || sz.w; item.h = item.h || sz.h;
    // ищем место в последнем ряду справа, иначе новая строка
    const bottom = t.items.reduce((m, x) => Math.max(m, x.y + x.h), 0);
    let placed = false;
    for (let y = Math.max(0, bottom - 16); y <= bottom && !placed; y++) {
      for (let x = 0; x + item.w <= G_COLS; x++) {
        const cand = Object.assign({}, item, { x, y });
        if (!t.items.some(o => collides(cand, o)) && !t.items.some(o => o.y >= y + 1 && o.x < x + item.w && o.x + o.w > x)) { item.x = x; item.y = y; placed = true; break; }
      }
    }
    if (!placed) { item.x = 0; item.y = bottom; }
    t.items.push(item);
    if (item.type === 'markdown') editingMd = item.i;
    paintBody();
    requestAnimationFrame(() => { const c = cells.get(item.i); c && c.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  }

  /* ---------- Перетаскивание и изменение размера ---------- */
  function startDrag(e, it) {
    if (!editing || narrow() || e.button > 0) return;
    e.preventDefault();
    const c = cells.get(it.i), g = geom();
    const start = px(it, g), sx = e.clientX, sy = e.clientY;
    const items = curTab().items;
    let preview = null;
    c.el.classList.add('dragging');
    phEl = h('div', { class: 'gph' }); gridEl.appendChild(phEl); place(phEl, start);
    const move = ev => {
      const left = start.left + ev.clientX - sx, top = start.top + ev.clientY - sy;
      c.el.style.left = left + 'px'; c.el.style.top = top + 'px';
      const nx = Math.max(0, Math.min(G_COLS - it.w, Math.round(left / (g.colW + G_GAP))));
      const ny = Math.max(0, Math.round(top / (G_ROWH + G_GAP)));
      const copy = items.map(x => Object.assign({}, x));
      const me = copy.find(x => x.i === it.i); me.x = nx; me.y = ny;
      compactLayout(copy, me);
      preview = copy;
      layoutGrid(copy);
      place(phEl, px(me, g));
      autoScroll(ev);
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      c.el.classList.remove('dragging'); phEl && phEl.remove(); phEl = null;
      if (preview) preview.forEach(p => { const o = items.find(x => x.i === p.i); o.x = p.x; o.y = p.y; });
      layoutGrid();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function startResize(e, it) {
    if (!editing || narrow()) return;
    e.preventDefault(); e.stopPropagation();
    const c = cells.get(it.i), g = geom();
    const start = px(it, g), sx = e.clientX, sy = e.clientY;
    const items = curTab().items;
    let preview = null;
    c.el.classList.add('dragging');
    phEl = h('div', { class: 'gph' }); gridEl.appendChild(phEl); place(phEl, start);
    const minH = it.type === 'divider' ? 1 : it.type === 'header' ? 1 : 3;
    const move = ev => {
      const wpx = Math.max(40, start.width + ev.clientX - sx), hpx = Math.max(20, start.height + ev.clientY - sy);
      c.el.style.width = wpx + 'px'; c.el.style.height = hpx + 'px';
      const nw = Math.max(1, Math.min(G_COLS - it.x, Math.round((wpx + G_GAP) / (g.colW + G_GAP))));
      const nh = Math.max(minH, Math.round((hpx + G_GAP) / (G_ROWH + G_GAP)));
      const copy = items.map(x => Object.assign({}, x));
      const me = copy.find(x => x.i === it.i); me.w = nw; me.h = nh;
      compactLayout(copy, me);
      preview = copy;
      layoutGrid(copy);
      place(phEl, px(me, g));
      autoScroll(ev);
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      c.el.classList.remove('dragging'); phEl && phEl.remove(); phEl = null;
      if (preview) preview.forEach(p => { const o = items.find(x => x.i === p.i); Object.assign(o, { x: p.x, y: p.y, w: p.w, h: p.h }); });
      layoutGrid();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function autoScroll(ev) {
    const r = dmain.getBoundingClientRect();
    if (ev.clientY > r.bottom - 50) dmain.scrollTop += 14;
    else if (ev.clientY < r.top + 50) dmain.scrollTop -= 14;
  }

  /* ---------- Панель добавления ---------- */
  function paintPanel() {
    if (!panel) return;
    clear(panel);
    const mockupDs = D.fromTemplate ? dsGet(D.fromTemplate.datasetId) : null;
    // Заготовки есть только у макета: под них нужен придуманный набор
    const blanks = isMockupDs(mockupDs);
    if (!panelTab || (panelTab === 'blank' && !blanks)) panelTab = blanks ? 'blank' : 'charts';
    const tab = (k, label) => h('button', { class: panelTab === k ? 'on' : '', onclick: () => { panelTab = k; paintPanel(); } }, label);
    const seg = h('div', { class: 'seg', role: 'tablist' },
      blanks ? tab('blank', 'Заготовки') : null, tab('charts', 'Графики'), tab('els', 'Элементы'));
    panel.appendChild(seg);
    const body = h('div', { class: 'edit-panel-body' });
    panel.appendChild(body);
    if (panelTab === 'blank') {
      // В макете блок выбирается видом: данные под него уже есть
      body.appendChild(h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '0 0 10px' } },
        'Данные под блок уже есть — выберите вид.'));
      mockupBlockOptions(mockupDs).forEach(b => body.appendChild(h('button', { class: 'comp', onclick: () => {
        const cid = createMockupChart(mockupDs, b.viz);
        if (!cid) { toast('Такой блок на этих данных не построить', true); return; }
        addItem({ type: 'chart', chartId: cid });
      } }, ic(VIZ[b.viz].icon), h('div', { class: 'grow' }, h('b', null, b.name), h('span', null, VIZ[b.viz].desc)), ic('plus'))));
    } else if (panelTab === 'charts') {
      const onDash = new Set(D.tabs.flatMap(t => t.items.filter(i => i.type === 'chart').map(i => i.chartId)));
      const search = h('input', { class: 'input', type: 'search', placeholder: 'Найти график', style: { marginBottom: '10px' }, 'aria-label': 'Поиск графиков' });
      const list = h('div');
      const paintList = () => {
        clear(list);
        const qq = search.value.trim().toLowerCase();
        const charts = Object.values(STATE.charts).filter(c => !qq || c.name.toLowerCase().includes(qq)).sort((a, b) => (Number(onDash.has(a.id)) - Number(onDash.has(b.id))) || (b.updated || 0) - (a.updated || 0));
        if (!charts.length) list.appendChild(h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Графиков не найдено'));
        charts.forEach(c => list.appendChild(h('button', { class: 'comp' + (onDash.has(c.id) ? ' used' : ''), title: 'Добавить на текущую вкладку', onclick: () => addItem({ type: 'chart', chartId: c.id }) },
          ic(VIZ[c.viz].icon), h('div', { class: 'grow' }, h('b', null, c.name), h('span', null, VIZ[c.viz].label + (onDash.has(c.id) ? ' · уже в шаблоне' : ''))), ic('plus'))));
      };
      search.addEventListener('input', paintList);
      body.append(
        h('button', { class: 'btn primary', style: { width: '100%', marginBottom: '12px' }, onclick: () => newChartDialog({ back: id }) }, ic('plus'), 'Новый график'),
        search, list);
      paintList();
    } else {
      const comp = (icon, title, sub, fn) => h('button', { class: 'comp', onclick: fn }, ic(icon), h('div', { class: 'grow' }, h('b', null, title), h('span', null, sub)), ic('plus'));
      body.append(
        comp('heading', 'Заголовок', 'Подпись раздела', () => addItem({ type: 'header', text: 'Новый раздел', size: 'l' })),
        comp('text', 'Текст', 'Markdown: пояснения, списки, ссылки', () => addItem({ type: 'markdown', text: '### Заголовок\nТекст с **выделением** и списком:\n- первый пункт\n- второй пункт' })),
        comp('divider', 'Разделитель', 'Горизонтальная линия', () => addItem({ type: 'divider' })),
        comp('dash', 'Вкладка', 'Новая вкладка шаблона', addTab),
        h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '14px' } }, 'Перетаскивайте элементы за заголовок или значок ', h('span', { class: 'kbd' }, '⋮⋮'), ', размер меняйте за правый нижний угол. Текст редактируется двойным щелчком.'));
    }
  }
  // Черновик в STATE: зовётся из функции очистки, когда со страницы уходят
  function stash() {
    if (!editing) return;
    D.updated = Date.now(); saveState();
  }
  // Переходы внутрь приложения ничем не отличаются от ссылок в шапке:
  // черновик сохранит функция очистки, её зовёт route() при любом переходе.
  function leaveTo(hash) { go(hash); }

  /* ---------- Модалки ---------- */
  function fullscreenChart(chart) {
    const root = h('div', { class: 'viz-root' });
    const md = openModal({ title: chart.name, wide: 'x', body: h('div', { class: 'card', style: { height: '68vh', border: 0 } }, h('div', { class: 'card-body' }, root)), onClose: () => disposeViz(root) });
    requestAnimationFrame(() => renderChart(root, chart, { scheme: D.scheme, extraFilters: extraFiltersFor(chart.id) }));
  }
  function openFilterEditor() {
    openFilterEditorModal(D, list => {
      const oldById = Object.fromEntries(D.filters.map(f => [f.id, f]));
      list.forEach(f => {
        const o = oldById[f.id];
        if (!o || o.col !== f.col || o.type !== f.type || o.datasetId !== f.datasetId || JSON.stringify(o.def) !== JSON.stringify(f.def)) f.value = clone(f.def);
        else f.value = o.value;
      });
      D.filters = list;
      if (editing) STATE.dashboards[id].filters = clone(list);
      else { D.updated = Date.now(); }
      saveState();
      pending = {}; D.filters.forEach(f => { pending[f.id] = clone(f.value); });
      paintFilterBar(); refreshCharts();
      toast('Фильтры сохранены');
    });
  }

  function paintHeadOnly() { paintBody(); }

  /* ---------- Сборка ---------- */
  function paintBody() {
    disposeCells();
    clear(dmain);
    if (editing) dmain.appendChild(h('div', { class: 'edit-banner' }, ic('edit'), 'Режим редактирования. Изменения появятся у всех после нажатия «Сохранить».'));
    if (tuning) dmain.appendChild(h('div', { class: 'edit-banner' }, ic('edit'),
      isMockupDs(dsGet((D.fromTemplate || {}).datasetId))
        ? 'Названия и категории правятся прямо на блоках — и сразу во всех.'
        : 'Правятся только подписи блоков, данные не трогаются.'));
    const fakeNames = [...new Set(D.tabs.flatMap(t => t.items.map(i => i.chartId && (STATE.charts[i.chartId] || {}).datasetId))
      .filter(x => isSchemaDs(DS[x])).map(x => DS[x].name))];
    // У макета пометка маленькая, рядом с названием: большая полоса занимает
    // пол-экрана и мозолит глаза, а сказать нужно всего одно слово
    const ownDs = D.fromTemplate ? dsGet(D.fromTemplate.datasetId) : null;
    if (!isMockupDs(ownDs) && fakeNames.length) dmain.appendChild(h('div', { class: 'edit-banner fake-banner' }, ic('schema'),
      `Это макет: ${fakeNames.length > 1 ? 'наборы' : 'набор'} ${fakeNames.map(n => '«' + n + '»').join(', ')} ${plural(fakeNames.length, 'содержит', 'содержат', 'содержат')} вымышленные данные.`));
    dmain.appendChild(paintHead());
    const tabs = paintTabs();
    if (tabs) dmain.appendChild(tabs);
    dmain.appendChild(paintGrid());
    paintPanel();
  }
  function paintAll() { paintFilterBar(); paintBody(); }
  paintAll();

  return () => {
    disposeCells();
    if (!editing) return;
    // Единственное место, где черновик успевает уцелеть: ссылки в шапке, логотип
    // и кнопка «назад» идут прямо в route(), а та зовёт только эту функцию.
    // Спрашивать здесь уже поздно — переход состоялся, — поэтому сохраняем молча
    // и говорим тостом, как это делал уход в конструктор графика.
    // «Отменить» и «Сохранить» ставят draftHandled сами, так что откат работает.
    if (!draftHandled && dirty()) { stash(); toast('Изменения шаблона сохранены'); }
    // Пустой «Новый дашборд», с которого ушли, не оставляем в списке. Проверяем
    // именно запись в STATE: если человек успел дать название или завести фильтр,
    // работа уже есть — такой дашборд остаётся.
    const cur = STATE.dashboards[id];
    if (freshDashboards.has(id) && cur && /^Новый (дашборд|макет)$/.test(cur.title) && !cur.filters.length && !cur.tabs.some(t => t.items.length)) {
      freshDashboards.delete(id); delete STATE.dashboards[id];
      dropOwnedDatasets();   // придуманные данные брошенного макета тоже не нужны
      saveState();
    }
  };
}

/* ---------- Markdown ---------- */
function renderMarkdown(src) {
  try {
    const html = window.marked ? marked.parse(src, { breaks: true, gfm: true }) : esc(src).replace(/\n/g, '<br>');
    return window.DOMPurify ? DOMPurify.sanitize(html) : html;
  } catch (e) { return esc(src); }
}

/* ---------- Просмотр данных ---------- */
function showDataModal(title, data) {
  if (!data || !data.rows) { toast('Данных пока нет — дождитесь построения графика'); return; }
  const cols = [...(data.dims || []).map(d => ({ key: d.key, label: d.label, dim: d })), ...(data.mets || []).map(m => ({ key: m.key, label: m.label, fmt: m.format }))];
  const rows = data.rows.slice(0, 2000);
  const tbl = h('table', null,
    h('thead', null, h('tr', null, cols.map(c => h('th', null, c.label)))),
    h('tbody', null, rows.map(r => h('tr', null, cols.map(c => h('td', { style: c.dim ? null : { textAlign: 'right' } }, c.dim ? fmtDimValue(r[c.key], c.dim) : fmtNum(r[c.key], c.fmt === 'pct' ? 'pct' : 'dec2')))))));
  openModal({
    title: 'Данные: ' + title, wide: true,
    body: h('div', null, h('p', { class: 'muted', style: { marginTop: 0 } }, `${fmtNum(data.rows.length, 'int')} ${plural(data.rows.length, 'строка', 'строки', 'строк')} результата запроса` + (data.rows.length > 2000 ? ', показаны первые 2000' : '')),
      h('div', { class: 'prev-tbl', style: { maxHeight: '60vh' } }, tbl)),
  });
}

/* ---------- Редактор нативных фильтров ---------- */
function openFilterEditorModal(D, onSave) {
  const list = clone(D.filters);
  let sel = list[0] ? list[0].id : null;
  const listEl = h('div', { class: 'fedit-list' });
  const form = h('div', { class: 'fedit-form' });
  const chartsOnDash = D.tabs.map(t => ({ tab: t, charts: t.items.filter(i => i.type === 'chart' && STATE.charts[i.chartId]).map(i => STATE.charts[i.chartId]) }));
  const dsIds = Object.keys(DS);
  function paintList() {
    clear(listEl);
    list.forEach(f => listEl.appendChild(h('div', { class: 'fl' + (f.id === sel ? ' on' : ''), tabindex: 0, onclick: () => { sel = f.id; paintList(); paintForm(); }, onkeydown: e => { if (e.key === 'Enter') { sel = f.id; paintList(); paintForm(); } } },
      ic(f.type === 'time' ? 'refresh' : f.type === 'range' ? 'divider' : 'filter'), h('span', null, f.name || 'Без названия'))));
    listEl.appendChild(h('button', { class: 'addchip', style: { marginTop: '8px' }, onclick: () => {
      const ds = DS[dsIds[0]];
      const f = { id: uid('f_'), name: 'Новый фильтр', type: 'select', datasetId: ds.id, col: firstStringCol(ds), multi: true, value: [], def: [], scope: 'all', dependent: true };
      list.push(f); sel = f.id; paintList(); paintForm();
    } }, ic('plus'), 'Добавить фильтр'));
  }
  function paintForm() {
    clear(form);
    const f = list.find(x => x.id === sel);
    if (!f) { form.appendChild(h('div', { class: 'empty' }, h('b', null, 'Фильтров нет'), 'Добавьте фильтр по значению, периоду или числовому диапазону.')); return; }
    const ds = DS[f.datasetId];
    const colsFor = () => (ds ? ds.columns : []).filter(c => f.type === 'time' ? c.type === 'date' : f.type === 'range' ? c.type === 'number' : c.type !== 'date' || true);
    const resetCol = () => { const cs = colsFor(); if (!cs.some(c => c.key === f.col)) f.col = (cs[0] || {}).key; f.def = f.type === 'time' ? { preset: 'all' } : f.type === 'range' ? ['', ''] : []; };
    form.append(
      field('Название', h('input', { class: 'input', value: f.name, oninput: e => { f.name = e.target.value; paintList(); } })),
      h('div', { class: 'row2' },
        field('Тип фильтра', selectEl([['select', 'Значение'], ['time', 'Период'], ['range', 'Числовой диапазон']], f.type, v => { f.type = v; resetCol(); paintForm(); })),
        field('Набор данных', selectEl(dsIds.map(k => [k, DS[k].name]), f.datasetId, v => { f.datasetId = v; resetCol(); paintForm(); }))),
      field('Колонка', selectEl(colsFor().map(c => [c.key, c.label || c.key]), f.col, v => { f.col = v; f.def = f.type === 'time' ? { preset: 'all' } : f.type === 'range' ? ['', ''] : []; paintForm(); }),
        'Действует на блоки, где есть колонка с таким же ключом.'));
    if (f.type === 'select') {
      form.append(checkbox('Можно выбрать несколько значений', f.multi !== false, v => { f.multi = v; }),
        checkbox('Показывать только значения, подходящие под другие фильтры', !!f.dependent, v => { f.dependent = v; }),
        field('Значение по умолчанию', ds ? multiSelect({ multi: true, value: f.def || [], placeholder: 'Все значения', options: () => distinctValues(ds, f.col, []).map(x => ({ value: x.value, label: String(x.value), count: x.count })), onChange: v => { f.def = v; } }) : h('span')));
    } else if (f.type === 'time') {
      form.append(field('Период по умолчанию', selectEl(Object.entries(TIME_PRESETS).filter(([k]) => k !== 'custom'), (f.def || {}).preset || 'all', v => { f.def = { preset: v }; }),
        'Относительные периоды отсчитываются от последней даты в данных.'));
    } else {
      form.append(h('div', { class: 'row2' },
        field('По умолчанию от', h('input', { class: 'input', type: 'number', value: (f.def || [])[0] ?? '', oninput: e => { f.def = [e.target.value, (f.def || [])[1] ?? '']; } })),
        field('По умолчанию до', h('input', { class: 'input', type: 'number', value: (f.def || [])[1] ?? '', oninput: e => { f.def = [(f.def || [])[0] ?? '', e.target.value]; } }))));
    }
    // Область действия
    const scopeAll = f.scope === 'all' || !f.scope;
    const scopeBox = h('div', { class: 'scope-list' });
    const paintScope = () => {
      clear(scopeBox);
      if (f.scope === 'all' || !f.scope) { scopeBox.appendChild(h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Фильтр действует на все графики шаблона.')); return; }
      chartsOnDash.forEach(g => {
        if (!g.charts.length) return;
        scopeBox.appendChild(h('div', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--ink-3)', margin: '4px 0 6px' } }, g.tab.title));
        g.charts.forEach(c => {
          const has = DS[c.datasetId] && dsCol(DS[c.datasetId], f.col);
          scopeBox.appendChild(h('label', { class: 'check', style: has ? null : { opacity: .55 } }, h('input', { type: 'checkbox', checked: f.scope.includes(c.id), onchange: e => { f.scope = e.target.checked ? [...new Set([...f.scope, c.id])] : f.scope.filter(x => x !== c.id); } }),
            c.name, has ? null : h('span', { class: 'muted', style: { fontSize: '12px' } }, ' — нет такой колонки')));
        });
      });
    };
    form.append(h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Область действия'),
      h('div', { class: 'seg', style: { marginBottom: '8px', alignSelf: 'flex-start' } },
        h('button', { class: scopeAll ? 'on' : '', onclick: () => { f.scope = 'all'; paintForm(); } }, 'Все графики'),
        h('button', { class: !scopeAll ? 'on' : '', onclick: () => { f.scope = chartsOnDash.flatMap(g => g.charts.filter(c => DS[c.datasetId] && dsCol(DS[c.datasetId], f.col)).map(c => c.id)); paintForm(); } }, 'Выбранные')),
      scopeBox));
    paintScope();
    form.append(h('button', { class: 'btn danger', onclick: () => { const i = list.indexOf(f); list.splice(i, 1); sel = list[Math.max(0, i - 1)] ? list[Math.max(0, i - 1)].id : null; paintList(); paintForm(); } }, ic('trash'), 'Удалить фильтр'));
  }
  paintList(); paintForm();
  openModal({
    title: 'Фильтры шаблона', wide: true,
    body: h('div', { class: 'fedit', style: { margin: '-18px -20px' } }, listEl, form),
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
      if (list.some(f => !f.col)) { toast('У каждого фильтра должна быть колонка', true); return; }
      list.forEach(f => { f.name = (f.name || '').trim() || colLabel(DS[f.datasetId], f.col); });
      close(); onSave(list);
    } }, 'Сохранить фильтры')],
  });
}

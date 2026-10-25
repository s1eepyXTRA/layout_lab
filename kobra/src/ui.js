/* ============================================================
   Кобра · UI-хелперы
   ============================================================ */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'selected') el.selected = !!v;
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendKids(el, kids);
  return el;
}
function appendKids(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const clone = o => JSON.parse(JSON.stringify(o));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* ---------- Иконки ---------- */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  filter: '<path d="M4 5h16l-6 8v5l-4 2v-7z"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M11 5l-7 7 7 7M4 12h16"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  drag: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  text: '<path d="M5 6h14M5 12h10M5 18h12"/>',
  heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  divider: '<path d="M3 12h18"/><path d="M7 7h10M7 17h10" opacity=".35"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  dash: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  download: '<path d="M12 4v10.5M8 11l4 4 4-4"/><path d="M4 18.5h16"/>',
  schema: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5V19.5"/><path d="M12.5 13h5" stroke-dasharray="2 2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5"/>',
  wand: '<path d="M4 20L13.5 10.5"/><path d="M17 3l.9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9zM7.5 4l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6L5.2 6.3l1.6-.7zM19 14.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  cobra: '<path d="M12 2.5c-3.3 0-6 2.6-6 6.3 0 2.4 1.2 4 2.6 5.2.8.7 1.1 1.4 1.1 2.4V21h4.6v-4.6c0-1 .3-1.7 1.1-2.4 1.4-1.2 2.6-2.8 2.6-5.2 0-3.7-2.7-6.3-6-6.3z" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".9" fill="var(--bar)" stroke="none"/><circle cx="14" cy="8" r=".9" fill="var(--bar)" stroke="none"/><path d="M12 12.2v1.4m-.9.8l.9-.8.9.8" stroke="var(--bar)" stroke-width="1"/>',
  // Иконки визуализаций
  v_line: '<path d="M3 20h18"/><path d="M4 16l5-6 4 3 7-8"/>',
  v_mixed: '<path d="M3 20h18"/><rect x="5" y="12" width="3" height="8" rx=".5"/><rect x="11" y="9" width="3" height="11" rx=".5"/><rect x="17" y="13" width="3" height="7" rx=".5"/><path d="M4 9l6-4 5 3 6-4"/>',
  v_bar: '<path d="M3 20h18"/><rect x="5" y="11" width="3.5" height="9" rx=".5"/><rect x="10.3" y="5" width="3.5" height="15" rx=".5"/><rect x="15.6" y="8" width="3.5" height="12" rx=".5"/>',
  v_table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M10 9v11"/>',
  v_pivot: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M3 14.5h18M15 9v11"/><rect x="3" y="4" width="6" height="5" fill="currentColor" opacity=".25" stroke="none"/>',
  v_area: '<path d="M3 20h18"/><path d="M3 18l5-7 4 3 5-7 4 4v9H3z" fill="currentColor" opacity=".25"/><path d="M3 18l5-7 4 3 5-7 4 4"/>',
  v_bignum: '<path d="M4 17V7l-2 2M8.5 9a2.5 2.5 0 1 1 5 0c0 3-5 5-5 8h5M16 7h5l-3 4a3 3 0 1 1-3 3.5"/>',
  v_bignum_trend: '<path d="M5 11V4l-2 2M9 5.5a2 2 0 1 1 4 0c0 2.2-4 3.3-4 5.5h4"/><path d="M3 20l5-4 4 2 4-5 5 2" /><path d="M3 20l5-4 4 2 4-5 5 2v5H3z" fill="currentColor" opacity=".2" stroke="none"/>',
  v_funnel: '<path d="M3 5h18l-2.5 4h-13zM6.5 11h11l-2 4h-7zM9.5 17h5l-1 3h-3z"/>',
  v_bullet: '<rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor" opacity=".15"/><rect x="3" y="8" width="12" height="8" rx="1" fill="currentColor" opacity=".2" stroke="none"/><path d="M3 12h11" stroke-width="3"/><path d="M17 6v12"/>',
  v_heatmap: '<rect x="3" y="3" width="5.3" height="5.3" fill="currentColor" opacity=".9" stroke="none"/><rect x="9.3" y="3" width="5.3" height="5.3" fill="currentColor" opacity=".4" stroke="none"/><rect x="15.7" y="3" width="5.3" height="5.3" fill="currentColor" opacity=".15" stroke="none"/><rect x="3" y="9.3" width="5.3" height="5.3" fill="currentColor" opacity=".3" stroke="none"/><rect x="9.3" y="9.3" width="5.3" height="5.3" fill="currentColor" opacity=".7" stroke="none"/><rect x="15.7" y="9.3" width="5.3" height="5.3" fill="currentColor" opacity=".5" stroke="none"/><rect x="3" y="15.7" width="5.3" height="5.3" fill="currentColor" opacity=".6" stroke="none"/><rect x="9.3" y="15.7" width="5.3" height="5.3" fill="currentColor" opacity=".2" stroke="none"/><rect x="15.7" y="15.7" width="5.3" height="5.3" fill="currentColor" opacity=".95" stroke="none"/>',
  v_pie: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6" /><path d="M12 3.5A8.5 8.5 0 0 1 18 18L12 12z" fill="currentColor" opacity=".25" stroke="none"/>',
  v_treemap: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M12 3v18M12 11h9M3 14h9M16.5 11v10"/><rect x="3" y="3" width="9" height="11" fill="currentColor" opacity=".25" stroke="none"/>',
};
function ic(name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('width', '16'); s.setAttribute('height', '16');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}
function iconBtn(name, title, onClick, cls = '') {
  return h('button', { class: 'iconbtn ' + cls, title, 'aria-label': title, type: 'button', onclick: e => { e.stopPropagation(); onClick(e); } }, ic(name));
}

/* ---------- Тосты ---------- */
function toast(msg, isErr) {
  let w = document.querySelector('.toast-wrap');
  if (!w) { w = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(w); }
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  w.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 5000 : 2600);
}

/* ---------- Модальные окна ---------- */
/**
 * Модальное окно.
 * @param {{title: string, body: any, foot?: any, wide?: boolean|'x', onClose?: () => void}} opts
 * @returns {{close: () => void, el: HTMLElement}}
 */
function openModal({ title, body, foot, wide, onClose }) {
  const prevFocus = /** @type {HTMLElement} */ (document.activeElement);
  const ov = h('div', { class: 'overlay' });
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); prevFocus && prevFocus.focus && prevFocus.focus(); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.pop')) close(); };
  document.addEventListener('keydown', onKey);
  const m = h('div', { class: 'modal' + (wide === 'x' ? ' xwide' : wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', null, title), iconBtn('x', 'Закрыть', close)),
    h('div', { class: 'modal-body' }, body),
    foot ? h('div', { class: 'modal-foot' }, typeof foot === 'function' ? foot(close) : foot) : null);
  ov.appendChild(m);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  setTimeout(() => { const f = m.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-foot .btn.primary'); f && f.focus(); }, 20);
  return { close, el: m };
}
function confirmDialog(title, text, okText = 'Удалить', danger = true) {
  return new Promise(res => {
    let done = false;
    const md = openModal({
      title, body: h('p', { style: { margin: 0, maxWidth: '60ch' } }, text),
      foot: close => [
        h('button', { class: 'btn', onclick: () => { done = true; close(); res(false); } }, 'Отмена'),
        h('button', { class: 'btn ' + (danger ? 'primary' : 'primary'), style: danger ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' } : null, onclick: () => { done = true; close(); res(true); } }, okText),
      ],
      onClose: () => { if (!done) res(false); },
    });
  });
}
function promptDialog(title, label, value = '', okText = 'Сохранить') {
  return new Promise(res => {
    let done = false;
    const inp = h('input', { class: 'input', value });
    const ok = close => { done = true; close(); res(inp.value.trim()); };
    let md;
    md = openModal({
      title, body: h('div', { class: 'field' }, h('label', null, label), inp),
      foot: close => [h('button', { class: 'btn', onclick: () => { done = true; close(); res(null); } }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => ok(close) }, okText)],
      onClose: () => { if (!done) res(null); },
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(md.close); });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

/* ---------- Поповеры и меню ---------- */
let activePop = null;
function closePop() { if (activePop) { activePop.remove(); activePop.cleanup && activePop.cleanup(); activePop = null; } }
function openPop(anchor, content, opts = {}) {
  closePop();
  const p = h('div', { class: 'pop ' + (opts.cls || '') }, content);
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight;
  let left = opts.alignRight ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  let top = r.bottom + 4;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
  p.style.left = left + 'px'; p.style.top = top + 'px';
  const onDown = e => { if (!p.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const onKey = e => { if (e.key === 'Escape') closePop(); };
  setTimeout(() => { document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey); }, 0);
  p.cleanup = () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); opts.onClose && opts.onClose(); };
  activePop = p;
  return p;
}
function openMenu(anchor, items, alignRight = true) {
  const menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map(it => it === '-' ? h('hr') :
    h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', onclick: () => { closePop(); it.onClick(); } }, it.icon ? ic(it.icon) : null, it.label)));
  openPop(anchor, menu, { alignRight });
  const f = menu.querySelector('button'); f && f.focus();
}

/* ---------- Мультиселект ---------- */
// opts: {options:[{value,label,count}] | ()=>options, value:[], multi, placeholder, onChange}
function multiSelect(opts) {
  let value = Array.isArray(opts.value) ? [...opts.value] : (opts.value != null && opts.value !== '' ? [opts.value] : []);
  const btn = h('button', { class: 'ms-btn', type: 'button' });
  const labelOf = v => {
    const list = typeof opts.options === 'function' ? null : opts.options;
    const o = list && list.find(x => String(x.value) === String(v));
    return o ? o.label : String(v);
  };
  const paint = () => {
    clear(btn);
    if (!value.length) btn.appendChild(h('span', { class: 'ph' }, opts.placeholder || 'Все значения'));
    else if (value.length <= 3) value.forEach(v => btn.appendChild(h('span', { class: 'tag' }, labelOf(v))));
    else { value.slice(0, 2).forEach(v => btn.appendChild(h('span', { class: 'tag' }, labelOf(v)))); btn.appendChild(h('span', { class: 'tag' }, '+' + (value.length - 2))); }
  };
  paint();
  btn.addEventListener('click', () => {
    const all = typeof opts.options === 'function' ? opts.options() : opts.options;
    const search = h('input', { class: 'input', placeholder: 'Поиск', type: 'search' });
    const list = h('div', { class: 'ms-list', role: 'listbox' });
    const renderList = () => {
      clear(list);
      const q = search.value.trim().toLowerCase();
      const shown = all.filter(o => !q || String(o.label).toLowerCase().includes(q)).slice(0, 400);
      if (!shown.length) list.appendChild(h('div', { class: 'muted', style: { padding: '8px' } }, 'Ничего не найдено'));
      shown.forEach(o => {
        const on = value.some(v => String(v) === String(o.value));
        list.appendChild(h('label', { class: 'ms-opt' },
          h('input', { type: opts.multi === false ? 'radio' : 'checkbox', name: 'ms', checked: on, onchange: () => {
            if (opts.multi === false) { value = on ? [] : [o.value]; commit(); closePop(); return; }
            value = on ? value.filter(v => String(v) !== String(o.value)) : [...value, o.value];
            commit(); renderList();
          } }),
          h('span', { title: o.label }, o.label), o.count != null ? h('small', null, fmtNum(o.count, 'smart')) : null));
      });
    };
    const commit = () => { paint(); opts.onChange && opts.onChange(opts.multi === false ? (value[0] ?? null) : [...value]); };
    search.addEventListener('input', renderList);
    renderList();
    const pop = h('div', { class: 'ms-pop' }, search, list,
      h('div', { class: 'ms-actions' },
        opts.multi !== false ? h('button', { class: 'btn sm', type: 'button', onclick: () => { const q = search.value.trim().toLowerCase(); value = [...new Set([...value, ...all.filter(o => !q || String(o.label).toLowerCase().includes(q)).map(o => o.value)])]; commit(); renderList(); } }, 'Выбрать все') : null,
        h('button', { class: 'btn sm', type: 'button', onclick: () => { value = []; commit(); renderList(); } }, 'Очистить')));
    openPop(btn, pop, { cls: '' });
    setTimeout(() => search.focus(), 10);
  });
  btn.setValue = v => { value = Array.isArray(v) ? [...v] : (v != null ? [v] : []); paint(); };
  return btn;
}
function selectEl(options, value, onChange, attrs = {}) {
  // options: [{value,label,group?}] или [[value,label]]
  const s = h('select', Object.assign({ class: 'select' }, attrs));
  const groups = {};
  options.forEach(o => {
    const [v, l, g] = Array.isArray(o) ? o : [o.value, o.label, o.group];
    const opt = h('option', { value: v }, l);
    if (String(v) === String(value)) opt.selected = true;
    if (g) { if (!groups[g]) { groups[g] = h('optgroup', { label: g }); s.appendChild(groups[g]); } groups[g].appendChild(opt); }
    else s.appendChild(opt);
  });
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}
function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', null, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}
function checkbox(label, checked, onChange) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }), label);
}

/* ---------- Хранилище ---------- */
const LS_KEY = 'kobra.state.v1';
function lsGet(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { toast('Не удалось сохранить в браузере: хранилище переполнено или отключено.', true); return false; }
}
/* Скачивание файла: единственный способ вынести что-то из браузера */
function downloadFile(name, text, mime = 'application/json') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (e) {
    console.error(e);
    toast('Не удалось сохранить файл: ' + e.message, true);
    return false;
  }
}
function readTextFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error('файл не читается'));
    fr.readAsText(file, 'utf-8');
  });
}

// IndexedDB для загруженных наборов данных (они могут быть большими)
const idb = (() => {
  let dbp = null;
  const mem = new Map();
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const rq = indexedDB.open('kobra', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('datasets');
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    if (!db) return null;
    return new Promise(res => {
      try {
        const t = db.transaction('datasets', mode);
        const st = t.objectStore('datasets');
        const rq = fn(st);
        t.oncomplete = () => res(rq ? rq.result : true);
        t.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  return {
    async set(k, v) { mem.set(k, v); const r = await tx('readwrite', st => st.put(v, k)); return r != null; },
    async get(k) { const r = await tx('readonly', st => st.get(k)); return r != null ? r : mem.get(k); },
    async del(k) { mem.delete(k); await tx('readwrite', st => st.delete(k)); },
    async keys() { const r = await tx('readonly', st => st.getAllKeys()); return r || [...mem.keys()]; },
  };
})();

/* Подгрузка скриптов по требованию (Excel/CSV-парсеры) */
const scriptCache = {};
function loadScript(src) {
  if (!scriptCache[src]) scriptCache[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
  return scriptCache[src];
}

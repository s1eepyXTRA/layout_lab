/* =============================================================
   Кобра · вход и права
   Модель взята у Superset, чтобы макет обещал тот порядок доступа,
   который компания получит в целевой системе: способ входа выбирается
   настройкой (AUTH_TYPE), права даёт роль (Admin / Alpha / Gamma), группы
   LDAP сопоставляются ролям, а у объекта есть владельцы.

   Граница прототипа, о которой врать нельзя: сервера здесь нет. Состояние
   лежит в localStorage, и его правит любой, кто открыл инструменты
   разработчика. Эти правила ограничивают интерфейс, а не доступ к данным;
   настоящая проверка возможна только в service/ на каждом запросе.
   ============================================================= */

const LS_AUTH_CFG = 'kobra.auth.cfg';
const LS_AUTH_USERS = 'kobra.auth.users';
const LS_AUTH_SESSION = 'kobra.auth.session';

/* Роли Superset. Admin — всё; Alpha — видит чужие команды на просмотр;
   Gamma — только своё, своей команды и то, чем поделились. */
const AUTH_ROLES = {
  Admin: { label: 'Admin', desc: 'Доступ ко всему, управление сотрудниками и входом' },
  Alpha: { label: 'Alpha', desc: 'Видит шаблоны всех команд, правит свои и те, которыми поделились' },
  Gamma: { label: 'Gamma', desc: 'Видит свою команду и то, чем поделились; правит свои' },
};
const AUTH_ROLE_ORDER = ['Admin', 'Alpha', 'Gamma'];

/* Ключи повторяют superset_config.py: настройки переедут туда один в один */
const AUTH_CFG_DEF = {
  type: 'ldap',                       // AUTH_TYPE: 'db' | 'ldap'
  defaultRole: 'Gamma',               // AUTH_USER_REGISTRATION_ROLE
  ldap: {
    server: 'ldap://ldap.company.local',   // AUTH_LDAP_SERVER
    search: 'ou=people,dc=company,dc=local', // AUTH_LDAP_SEARCH
    uidField: 'sAMAccountName',            // AUTH_LDAP_UID_FIELD
    emailField: 'mail',                    // AUTH_LDAP_EMAIL_FIELD
    teamField: 'department',               // подразделение = команда
    groupField: 'memberOf',                // AUTH_LDAP_GROUP_FIELD
  },
  rolesMapping: {                     // AUTH_ROLES_MAPPING: группа → роль
    'cn=kobra-admins,ou=groups,dc=company,dc=local': 'Admin',
    'cn=kobra-analysts,ou=groups,dc=company,dc=local': 'Alpha',
  },
};

/* Вымышленный справочник: в целевой системе его отдаёт LDAP. Пароли здесь
   не живут намеренно — хранить их рядом с данными в localStorage незачем. */
const AUTH_USERS_SEED = [
  { login: 'i.petrov', name: 'Игорь Петров', email: 'i.petrov@company.ru', team: 'Отдел данных',
    groups: ['cn=kobra-admins,ou=groups,dc=company,dc=local'], role: null },
  { login: 'a.smirnova', name: 'Анна Смирнова', email: 'a.smirnova@company.ru', team: 'Продажи',
    groups: ['cn=kobra-analysts,ou=groups,dc=company,dc=local'], role: null },
  { login: 'd.orlov', name: 'Дмитрий Орлов', email: 'd.orlov@company.ru', team: 'Продажи', groups: [], role: null },
  { login: 'e.kuznecova', name: 'Елена Кузнецова', email: 'e.kuznecova@company.ru', team: 'Поддержка', groups: [], role: null },
  { login: 's.volkov', name: 'Сергей Волков', email: 's.volkov@company.ru', team: 'Поддержка', groups: [], role: null },
];
/* Владелец встроенного: демо видно всем, правит админ */
const AUTH_SYSTEM = 'kobra';
const AUTH_TEAM_ALL = '*';

let AUTH = null;   // { user, users, cfg } — заполняется authInit()

function authCfg() { return (AUTH && AUTH.cfg) || AUTH_CFG_DEF; }
function authUsers() { return (AUTH && AUTH.users) || []; }
function authUser() { return AUTH && AUTH.user; }
function authIs(role) { const u = authUser(); return !!u && u.role === role; }
function authIsAdmin() { return authIs('Admin'); }

function authSaveCfg(cfg) { AUTH.cfg = cfg; lsSet(LS_AUTH_CFG, cfg); }
function authSaveUsers() { lsSet(LS_AUTH_USERS, AUTH.users); }

/* Роль сотрудника: выданная руками важнее, иначе — по группам LDAP, иначе
   роль по умолчанию. Так же, как AUTH_ROLES_SYNC_AT_LOGIN в Superset. */
function authRoleOf(u, cfg) {
  if (!u) return null;
  if (u.role && AUTH_ROLES[u.role]) return u.role;
  const map = (cfg || authCfg()).rolesMapping || {};
  const byGroup = (u.groups || []).map(g => map[g]).filter(r => AUTH_ROLES[r]);
  if (byGroup.length) return AUTH_ROLE_ORDER.find(r => byGroup.includes(r));
  return (cfg || authCfg()).defaultRole || 'Gamma';
}
function authFind(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return null;
  return authUsers().find(u => u.login.toLowerCase() === q || (u.email || '').toLowerCase() === q) || null;
}
function authName(login) {
  if (login === AUTH_SYSTEM) return 'Кобра';
  const u = authUsers().find(x => x.login === login);
  return u ? u.name : login;
}
function authLabel(u) { return `${u.name} (${u.login}${u.team ? ', ' + u.team : ''})`; }

/* ---------- Сессия ---------- */
function authInit() {
  AUTH = {
    cfg: lsGet(LS_AUTH_CFG) || clone(AUTH_CFG_DEF),
    users: lsGet(LS_AUTH_USERS) || clone(AUTH_USERS_SEED),
    user: null,
  };
  const login = lsGet(LS_AUTH_SESSION);
  if (login) authSignIn(login, { silent: true });
  return !!AUTH.user;
}
/** @param {{silent?: boolean}} [opts] */
function authSignIn(login, opts = {}) {
  const { silent } = opts;
  const u = authUsers().find(x => x.login === String(login || '').trim().toLowerCase())
    || authFind(login);
  if (!u) { if (!silent) toast('Такого сотрудника нет в каталоге', true); return false; }
  AUTH.user = Object.assign({}, u, { role: authRoleOf(u) });
  lsSet(LS_AUTH_SESSION, u.login);
  return true;
}
function authSignOut() {
  AUTH.user = null;
  try { localStorage.removeItem(LS_AUTH_SESSION); } catch (e) { }
  location.hash = '';
  location.reload();
}

/* ---------- Правила ---------- */
/* Единственное место, где решается «можно ли». Экраны спрашивают только эти
   три функции: иначе правило разъедется по файлам и не переедет на сервер. */
/* Владелец-человек — ownerLogin: поле owner у набора уже занято ссылкой на
   дашборд, которому набор принадлежит (см. «Макет без данных» в CLAUDE.md). */
function authOwner(obj) { return (obj && obj.ownerLogin) || null; }
function authShared(obj) { return (obj && obj.shared) || []; }
function authIsOwn(obj) { const u = authUser(); return !!u && authOwner(obj) === u.login; }
function authIsPublic(obj) { return !!obj && obj.team === AUTH_TEAM_ALL; }

function canView(obj) {
  const u = authUser();
  if (!u || !obj) return false;
  if (u.role === 'Admin' || authIsPublic(obj)) return true;
  if (authOwner(obj) === u.login || authShared(obj).includes(u.login)) return true;
  if (u.role === 'Alpha') return true;
  return !!obj.team && obj.team === u.team;
}
function canEdit(obj) {
  const u = authUser();
  if (!u || !obj) return false;
  if (u.role === 'Admin') return true;
  return authOwner(obj) === u.login || authShared(obj).includes(u.login);
}
const canShare = obj => canEdit(obj);
/* Почему нельзя — одной фразой, чтобы интерфейс не молчал */
function whyReadOnly(obj) {
  const own = authOwner(obj);
  return own && own !== AUTH_SYSTEM
    ? `Шаблон принадлежит ${authName(own)}. Попросите выдать доступ — тогда можно будет править.`
    : 'Это общий объект: править его может администратор.';
}

/* Печать владельца объекта в новом объекте */
function authStamp(obj) {
  const u = authUser();
  if (!u || !obj) return obj;
  obj.ownerLogin = u.login;
  obj.team = u.team;
  obj.shared = [];
  return obj;
}
/* Доступ выдан — объект виден и правится наравне с владельцем */
function authShareWith(obj, login) {
  if (!obj) return false;
  obj.shared = authShared(obj).filter(l => l !== login);
  if (login !== authOwner(obj)) obj.shared.push(login);
  return true;
}
function authUnshare(obj, login) { obj.shared = authShared(obj).filter(l => l !== login); }

/* ---------- Владельцы у старых объектов ---------- */
/* Поднимать v нельзя: человек потеряет собранные шаблоны ради одного поля.
   Поэтому объекты без владельца достаются первому вошедшему, а демо и
   встроенные наборы — системе: их видно всем, правит администратор. */
/* Зовётся из saveState(), поэтому владелец проставляется сам в любом пути
   создания — шаблон, график, черновик, макет, импорт, — и новый путь не
   придётся вспоминать. Демо и встроенные наборы достаются системе. */
function authStampAll() {
  const u = authUser();
  if (!u || !STATE) return false;
  let n = 0;
  const stamp = (o, system) => {
    if (!o || o.ownerLogin) return;
    o.ownerLogin = system ? AUTH_SYSTEM : u.login;
    o.team = system ? AUTH_TEAM_ALL : u.team;
    o.shared = o.shared || [];
    n++;
  };
  const demo = STATE.dashboards && STATE.dashboards.d_demo;
  const demoCharts = new Set(demo ? demo.tabs.flatMap(t => t.items.map(i => i.chartId)).filter(Boolean) : []);
  Object.values(STATE.dashboards || {}).forEach(d => stamp(d, d.id === 'd_demo'));
  Object.values(STATE.charts || {}).forEach(c => stamp(c, demoCharts.has(c.id)));
  Object.values(STATE.datasets || {}).forEach(d => stamp(d, false));
  return n > 0;
}

/* ---------- Передача доступа ---------- */
/* Логин вводится руками, и ошибка здесь тихая: a.ivanov и an.ivanov похожи,
   а человек будет думать, что поделился. Поэтому сначала показываем, кого
   нашли, и только по подтверждению выдаём доступ. */
function openShareDialog(obj, what, onChange) {
  if (!canShare(obj)) { toast('Делиться может владелец или тот, кому он дал доступ', true); return; }
  const body = h('div');
  const inp = h('input', { class: 'input', placeholder: 'Логин или почта, например a.smirnova' });
  const save = () => { onChange && onChange(); paint(); };

  const add = async () => {
    const txt = inp.value.trim();
    if (!txt) { toast('Введите логин или почту', true); return; }
    const u = authFind(txt);
    if (!u) { toast(`Сотрудник «${txt}» не найден в каталоге`, true); return; }
    if (u.login === authOwner(obj)) { toast('Это владелец: доступ у него и так есть', true); return; }
    if (authShared(obj).includes(u.login)) { toast('Доступ уже выдан', true); return; }
    const ok = await confirmDialog('Выдать доступ',
      `${u.name} (${u.login}, ${u.email}, ${u.team}) получит полный доступ к ${what} «${obj.title || obj.name}»: сможет править, удалять и делиться дальше. Выдать доступ?`,
      'Выдать доступ', false);
    if (!ok) return;
    authShareWith(obj, u.login);
    inp.value = '';
    toast(`Доступ выдан: ${u.name}`);
    save();
  };

  function paint() {
    clear(body);
    const own = authOwner(obj);
    body.appendChild(h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
      `Владелец — ${authName(own)}. Команда ${obj.team === AUTH_TEAM_ALL ? 'любая: объект общий' : '«' + (obj.team || '—') + '» видит это на просмотр'}.`));
    const list = h('div', { class: 'share-list' });
    const shared = authShared(obj);
    if (!shared.length) list.appendChild(h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Пока никому не выдан доступ.'));
    shared.forEach(login => {
      const u = authUsers().find(x => x.login === login) || { login, name: login, team: '', email: '' };
      list.appendChild(h('div', { class: 'share-row' },
        h('div', { class: 'grow' }, h('b', null, u.name), h('span', null, ` ${u.login}${u.team ? ' · ' + u.team : ''}`)),
        h('span', { class: 'pill' }, 'может править'),
        iconBtn('x', 'Отозвать доступ', async () => {
          if (!(await confirmDialog('Отозвать доступ', `${u.name} потеряет доступ к ${what} «${obj.title || obj.name}».`, 'Отозвать'))) return;
          authUnshare(obj, login); toast('Доступ отозван'); save();
        }, 'sm')));
    });
    body.appendChild(list);
    body.appendChild(field('Кому выдать доступ', h('div', { class: 'row-inline' }, inp,
      h('button', { class: 'btn', type: 'button', onclick: add }, ic('plus'), 'Выдать')),
      'Сотрудник получит те же права, что у вас: править, удалять и делиться дальше.'));
  }
  paint();
  openModal({ title: `Доступ к ${what}`, body, foot: close => [h('button', { class: 'btn primary', onclick: close }, 'Готово')] });
}

/* ---------- Экраны администратора ---------- */
function openUsersDialog() {
  if (!authIsAdmin()) { toast('Экран доступен роли Admin', true); return; }
  const body = h('div');
  const paint = () => {
    clear(body);
    body.appendChild(h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
      'Список приходит из каталога LDAP. Роль по умолчанию даёт сопоставление групп (экран «Доступ»); здесь её можно переопределить вручную — как в Security → List Users.'));
    const tbl = h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Сотрудник'), h('th', null, 'Логин'), h('th', null, 'Команда'), h('th', null, 'Роль'))));
    const tb = h('tbody');
    authUsers().forEach(u => {
      const cur = authRoleOf(u);
      tb.appendChild(h('tr', null,
        h('td', null, u.name, h('div', { class: 'muted', style: { fontSize: '12px' } }, u.email)),
        h('td', null, u.login),
        h('td', null, u.team),
        h('td', null, selectEl([['', 'По группам: ' + cur], ...AUTH_ROLE_ORDER.map(r => [r, r])], u.role || '', v => {
          u.role = v || null;
          authSaveUsers();
          if (authUser() && authUser().login === u.login) { AUTH.user.role = authRoleOf(u); toast('Ваша роль теперь ' + AUTH.user.role); route(); }
          paint();
        }, { 'aria-label': 'Роль ' + u.login }))));
    });
    tbl.appendChild(tb);
    body.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
    body.appendChild(h('div', { class: 'ai-note', style: { marginTop: '12px' } },
      Object.entries(AUTH_ROLES).map(([k, r]) => h('div', null, h('b', null, k), ' — ' + r.desc))));
  };
  paint();
  openModal({ title: 'Сотрудники', wide: true, body, foot: close => [h('button', { class: 'btn primary', onclick: close }, 'Готово')] });
}

function openAuthCfgDialog() {
  if (!authIsAdmin()) { toast('Экран доступен роли Admin', true); return; }
  const cfg = clone(authCfg());
  const body = h('div');
  const paint = () => {
    clear(body);
    body.appendChild(h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
      'Те же настройки, что в superset_config.py: способ входа, подключение к каталогу и сопоставление групп ролям.'));
    body.appendChild(field('Способ входа (AUTH_TYPE)', selectEl(
      [['db', 'По логину и паролю (AUTH_DB)'], ['ldap', 'По LDAP (AUTH_LDAP)']], cfg.type, v => { cfg.type = v; paint(); }),
      cfg.type === 'ldap' ? 'Вход проверяется bind-ом в каталоге. В прототипе каталог вымышленный.' : 'Пароль хранится в базе приложения. В прототипе он не проверяется.'));
    if (cfg.type === 'ldap') {
      const row = (label, key, hint) => body.appendChild(field(label,
        h('input', { class: 'input', value: cfg.ldap[key] || '', oninput: e => { cfg.ldap[key] = e.target.value; } }), hint));
      row('AUTH_LDAP_SERVER', 'server');
      row('AUTH_LDAP_SEARCH', 'search', 'Ветка, в которой ищем сотрудников');
      row('AUTH_LDAP_UID_FIELD', 'uidField', 'Поле с логином: sAMAccountName в Active Directory, uid в OpenLDAP');
      row('AUTH_LDAP_EMAIL_FIELD', 'emailField');
      row('Поле с командой', 'teamField', 'Подразделение сотрудника — по нему команда видит работу друг друга');
      row('AUTH_LDAP_GROUP_FIELD', 'groupField', 'Поле с группами, по которым выдаются роли');
    }
    const mapBox = h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'AUTH_ROLES_MAPPING: группа → роль'),
      h('div', { class: 'hint', style: { marginBottom: '6px' } }, 'Так и назначаются администраторы: отдельного списка логинов в коде нет — админ это роль.'));
    Object.entries(cfg.rolesMapping).forEach(([group, role]) => {
      mapBox.appendChild(h('div', { class: 'share-row' },
        h('code', { class: 'grow', style: { fontSize: '12px', wordBreak: 'break-all' } }, group),
        selectEl(AUTH_ROLE_ORDER.map(r => [r, r]), role, v => { cfg.rolesMapping[group] = v; }, { 'aria-label': 'Роль для ' + group }),
        iconBtn('x', 'Убрать сопоставление', () => { delete cfg.rolesMapping[group]; paint(); }, 'sm')));
    });
    const gInp = h('input', { class: 'input', placeholder: 'cn=kobra-admins,ou=groups,dc=company,dc=local' });
    let newRole = 'Admin';
    mapBox.appendChild(h('div', { class: 'row-inline', style: { marginTop: '6px' } }, gInp,
      selectEl(AUTH_ROLE_ORDER.map(r => [r, r]), newRole, v => { newRole = v; }, { 'aria-label': 'Роль новой группы' }),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const g = gInp.value.trim();
        if (!g) { toast('Введите группу', true); return; }
        cfg.rolesMapping[g] = newRole; paint();
      } }, ic('plus'), 'Добавить')));
    body.appendChild(mapBox);
    body.appendChild(field('Роль по умолчанию (AUTH_USER_REGISTRATION_ROLE)',
      selectEl(AUTH_ROLE_ORDER.map(r => [r, r]), cfg.defaultRole, v => { cfg.defaultRole = v; }),
      'Её получает сотрудник, не попавший ни в одну сопоставленную группу.'));
  };
  paint();
  openModal({
    title: 'Доступ', wide: true, body,
    foot: close => [h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => {
        authSaveCfg(cfg);
        const u = authUsers().find(x => x.login === authUser().login);
        if (u) AUTH.user.role = authRoleOf(u, cfg);
        close(); toast('Настройки входа сохранены'); route();
      } }, ic('check'), 'Сохранить')],
  });
}

/* ---------- Экран входа ---------- */
/* Пока человек не вошёл, приложение не строится вовсе: ни шаблонов, ни
   графиков, ни данных на экране нет. */
function renderSignIn(onDone) {
  const cfg = authCfg();
  const app = document.getElementById('app') || document.body;
  clear(app);
  const ldap = cfg.type === 'ldap';
  const loginInp = h('input', { class: 'input', placeholder: ldap ? 'Логин в домене' : 'Логин', autocomplete: 'username' });
  const passInp = h('input', { class: 'input', type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
  const err = h('div', { class: 'signin-err', hidden: true });
  const submit = () => {
    const login = loginInp.value.trim();
    if (!login) { err.hidden = false; err.textContent = 'Введите логин'; loginInp.focus(); return; }
    if (!passInp.value) { err.hidden = false; err.textContent = 'Введите пароль'; passInp.focus(); return; }
    const u = authFind(login) || authUsers().find(x => x.login === login.toLowerCase());
    if (!u) {
      err.hidden = false;
      err.textContent = ldap ? 'Каталог не знает такого пользователя' : 'Неверный логин или пароль';
      return;
    }
    authSignIn(u.login);
    onDone();
  };
  const form = h('form', { class: 'signin-card', onsubmit: e => { e.preventDefault(); submit(); } },
    h('div', { class: 'signin-brand' }, brandMark(28), h('b', null, 'Кобра')),
    h('p', { class: 'signin-lead' }, 'Конструктор шаблонов дашбордов. Войдите, чтобы увидеть свои шаблоны и шаблоны своей команды.'),
    h('div', { class: 'signin-way' }, ldap ? 'Вход по LDAP · ' + cfg.ldap.server : 'Вход по логину и паролю'),
    field('Логин', loginInp),
    field('Пароль', passInp),
    err,
    h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'Войти'),
    h('div', { class: 'signin-note' },
      h('b', null, 'Это прототип: пароль не проверяется.'),
      ' Права здесь показывают порядок доступа, а не защищают данные — всё состояние лежит в этом браузере. Настоящая проверка появится вместе с сервером.'),
    h('details', { class: 'signin-demo' }, h('summary', null, 'Кого можно попробовать'),
      h('ul', null, authUsers().map(u => h('li', null,
        h('b', null, u.login), ` — ${u.name}, ${u.team}, роль ${authRoleOf(u)}`)))));
  app.appendChild(h('div', { class: 'signin' }, form));
  setTimeout(() => loginInp.focus(), 30);
}

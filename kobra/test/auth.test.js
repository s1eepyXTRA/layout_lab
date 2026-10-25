/* Права: одна таблица «кто что может» — её и проверяем */

const assert = require('node:assert');
const { loadKobra } = require('./load');

const K = loadKobra();
K.authInit();

const as = login => { assert.ok(K.authSignIn(login), 'не удалось войти: ' + login); };
const obj = (owner, team, shared) => ({ title: 'X', ownerLogin: owner, team, shared: shared || [] });

const ADMIN = 'i.petrov';      // Отдел данных, Admin по группе
const ALPHA = 'a.smirnova';    // Продажи, Alpha по группе
const GAMMA = 'd.orlov';       // Продажи, Gamma по умолчанию
const OTHER = 'e.kuznecova';   // Поддержка, Gamma

test('роль приходит из сопоставления групп LDAP', () => {
  as(ADMIN); assert.strictEqual(K.authUser().role, 'Admin');
  as(ALPHA); assert.strictEqual(K.authUser().role, 'Alpha');
  as(GAMMA); assert.strictEqual(K.authUser().role, 'Gamma');
});

test('выданная руками роль важнее группы', () => {
  const u = K.authUsers().find(x => x.login === GAMMA);
  u.role = 'Admin';
  as(GAMMA);
  assert.strictEqual(K.authUser().role, 'Admin');
  u.role = null;
  as(GAMMA);
  assert.strictEqual(K.authUser().role, 'Gamma');
});

test('сотрудник ищется по логину и по почте, чужого не находит', () => {
  assert.strictEqual(K.authFind('a.smirnova').login, ALPHA);
  assert.strictEqual(K.authFind('a.smirnova@company.ru').login, ALPHA);
  assert.strictEqual(K.authFind('нет.такого'), null);
});

test('владелец правит своё', () => {
  as(GAMMA);
  const o = obj(GAMMA, 'Продажи');
  assert.ok(K.canView(o) && K.canEdit(o) && K.canShare(o));
});

/* Команда видит работу коллег, но не правит её: иначе чужой шаблон
   можно испортить случайно, не спросив владельца. */
test('своя команда видит, но не правит', () => {
  as(GAMMA);
  const o = obj(ALPHA, 'Продажи');
  assert.ok(K.canView(o), 'коллега из своей команды должен видеть');
  assert.ok(!K.canEdit(o), 'править чужое нельзя');
  assert.ok(!K.canShare(o), 'и делиться чужим нельзя');
});

test('чужая команда не видит ничего', () => {
  as(OTHER);
  const o = obj(ALPHA, 'Продажи');
  assert.ok(!K.canView(o));
  assert.ok(!K.canEdit(o));
});

test('тот, с кем поделились, правит наравне с владельцем', () => {
  as(OTHER);
  const o = obj(ALPHA, 'Продажи', [OTHER]);
  assert.ok(K.canView(o) && K.canEdit(o) && K.canShare(o));
});

test('Alpha видит чужие команды, но правит только своё и выданное', () => {
  as(ALPHA);
  const foreign = obj(OTHER, 'Поддержка');
  assert.ok(K.canView(foreign), 'Alpha видит все команды');
  assert.ok(!K.canEdit(foreign), 'но без доступа не правит');
});

test('Admin может всё', () => {
  as(ADMIN);
  const foreign = obj(OTHER, 'Поддержка');
  assert.ok(K.canView(foreign) && K.canEdit(foreign) && K.canShare(foreign));
});

test('общий объект виден всем, а правит его админ', () => {
  const common = obj('kobra', '*');
  as(OTHER);
  assert.ok(K.canView(common), 'общее видно всем');
  assert.ok(!K.canEdit(common), 'но правит не каждый');
  as(ADMIN);
  assert.ok(K.canEdit(common));
});

test('выдача и отзыв доступа', () => {
  as(ALPHA);
  const o = obj(ALPHA, 'Продажи');
  K.authShareWith(o, OTHER);
  assert.deepEqual(o.shared, [OTHER]);
  K.authShareWith(o, OTHER);
  assert.strictEqual(o.shared.length, 1, 'повторная выдача не задваивает');
  K.authUnshare(o, OTHER);
  assert.deepEqual(o.shared, []);
});

test('владельцу доступ не выдаётся повторно', () => {
  as(ALPHA);
  const o = obj(ALPHA, 'Продажи');
  K.authShareWith(o, ALPHA);
  assert.deepEqual(o.shared, []);
});

/* Старые объекты достаются вошедшему, демо — системе: иначе человек
   открыл бы Кобру после обновления и не увидел собственной работы. */
test('объекты без владельца достаются вошедшему, а демо — системе', () => {
  as(GAMMA);
  K.STATE = {
    dashboards: {
      d_demo: { id: 'd_demo', tabs: [{ items: [{ chartId: 'c_demo' }] }] },
      d_mine: { id: 'd_mine', tabs: [{ items: [{ chartId: 'c_mine' }] }] },
    },
    charts: { c_demo: { id: 'c_demo' }, c_mine: { id: 'c_mine' } },
    datasets: { ds_1: { id: 'ds_1' } },
  };
  assert.ok(K.authStampAll(), 'первый проход должен что-то проставить');
  assert.strictEqual(K.STATE.dashboards.d_demo.ownerLogin, 'kobra');
  assert.strictEqual(K.STATE.dashboards.d_demo.team, '*');
  assert.strictEqual(K.STATE.charts.c_demo.ownerLogin, 'kobra');
  assert.strictEqual(K.STATE.dashboards.d_mine.ownerLogin, GAMMA);
  assert.strictEqual(K.STATE.charts.c_mine.ownerLogin, GAMMA);
  assert.strictEqual(K.STATE.datasets.ds_1.ownerLogin, GAMMA);
  assert.ok(!K.authStampAll(), 'второй проход ничего не меняет');
});

test('без входа не видно ничего', () => {
  K.AUTH.user = null;
  assert.ok(!K.canView(obj('kobra', '*')), 'даже общее закрыто до входа');
  assert.ok(!K.canEdit(obj(ADMIN, '*')));
  as(ADMIN);
});

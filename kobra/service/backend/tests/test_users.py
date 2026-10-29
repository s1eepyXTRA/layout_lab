"""Экран «Сотрудники»: список, роль вручную, отключение. Только для админа."""


def admin_headers(client, make_user, login, auth):
    make_user("i.petrov", role="Admin", team="Отдел данных")
    return auth(login("i.petrov"))


def test_spisok_tolko_dlya_admina(client, make_user, login, auth):
    make_user("a.smirnova")
    r = client.get("/api/users", headers=auth(login("a.smirnova")))
    assert r.status_code == 403


def test_admin_vidit_spisok(client, make_user, login, auth):
    h = admin_headers(client, make_user, login, auth)
    make_user("a.smirnova", team="Продажи")
    r = client.get("/api/users", headers=h)
    assert r.status_code == 200
    logins = [u["login"] for u in r.json()]
    assert "a.smirnova" in logins and "i.petrov" in logins


def test_rol_naznachaetsya_rukami_i_perezhivaet_povtornyi_vhod(client, make_user, login, auth):
    h = admin_headers(client, make_user, login, auth)
    make_user("a.smirnova", role="Gamma")
    r = client.patch("/api/users/a.smirnova", json={"role": "Alpha"}, headers=h)
    assert r.status_code == 200
    assert r.json()["role"] == "Alpha"
    assert r.json()["role_manual"] is True
    # Повторный вход сотрудника: роль осталась назначенной
    me = client.get("/api/auth/me", headers=auth(login("a.smirnova")))
    assert me.json()["role"] == "Alpha"


def test_nevernaya_rol_otklonena(client, make_user, login, auth):
    h = admin_headers(client, make_user, login, auth)
    make_user("a.smirnova")
    r = client.patch("/api/users/a.smirnova", json={"role": "Бухгалтер"}, headers=h)
    assert r.status_code == 422


def test_otklyuchenie_sotrudnika(client, make_user, login, auth):
    h = admin_headers(client, make_user, login, auth)
    make_user("e.kuznecova")
    token = login("e.kuznecova")
    assert client.patch("/api/users/e.kuznecova", json={"active": False}, headers=h).status_code == 200
    # Выданный раньше токен перестаёт работать на следующем же запросе: сперва
    # срабатывает отзыв сессий (401), и только потом проверка признака (403)
    assert client.get("/api/auth/me", headers=auth(token)).status_code in (401, 403)
    # И войти заново нельзя
    assert client.post("/api/auth/login", json={"username": "e.kuznecova", "password": "secret"}).status_code == 403


def test_admin_ne_otklyuchaet_sam_sebya(client, make_user, login, auth):
    h = admin_headers(client, make_user, login, auth)
    r = client.patch("/api/users/i.petrov", json={"active": False}, headers=h)
    assert r.status_code == 422


def test_neizvestnyi_sotrudnik(client, make_user, login, auth):
    h = admin_headers(client, make_user, login, auth)
    assert client.patch("/api/users/net-takogo", json={"role": "Alpha"}, headers=h).status_code == 404


def test_spravochnik_viden_vsem_voshedshim(client, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    make_user("d.orlov", team="Поддержка")
    r = client.get("/api/users/directory", headers=auth(login("a.smirnova")))
    assert r.status_code == 200
    by_login = {u["login"]: u for u in r.json()}
    assert set(by_login) == {"a.smirnova", "d.orlov"}
    # Это адресная книга: ролей и признака отключения в ней нет
    assert set(by_login["d.orlov"]) == {"login", "name", "email", "team"}


def test_otklyuchennye_v_spravochnik_ne_popadayut(client, make_user, login, auth):
    make_user("a.smirnova")
    make_user("uvolen", active=False)
    r = client.get("/api/users/directory", headers=auth(login("a.smirnova")))
    assert [u["login"] for u in r.json()] == ["a.smirnova"]

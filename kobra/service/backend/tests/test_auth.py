"""Вход: верный пароль, неверный пароль, истёкшая сессия, отключённый сотрудник."""
from app.auth import make_expired_token


def test_verniy_parol_daet_sessiyu(client, make_user):
    make_user("a.smirnova", team="Продажи")
    r = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "secret"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"]
    assert body["user"]["login"] == "a.smirnova"
    assert body["user"]["role"] == "Gamma"
    assert "password" not in str(body["user"])


def test_nevernyi_parol_otklonen(client, make_user):
    make_user("a.smirnova")
    r = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "не тот"})
    assert r.status_code == 401
    # Отказ не говорит, что именно не совпало: по разным ответам подбирают логины
    assert r.json()["detail"] == "Неверный логин или пароль"


def test_nesushchestvuyushchiy_login_otvechaet_tak_zhe(client, make_user):
    make_user("a.smirnova")
    r = client.post("/api/auth/login", json={"username": "нет-такого", "password": "secret"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Неверный логин или пароль"


def test_me_vozvrashchaet_voshedshego(client, make_user, login, auth):
    make_user("d.orlov", team="Поддержка")
    r = client.get("/api/auth/me", headers=auth(login("d.orlov")))
    assert r.status_code == 200
    assert r.json()["login"] == "d.orlov"
    assert r.json()["team"] == "Поддержка"


def test_bez_tokena_ne_pustyat(client):
    assert client.get("/api/auth/me").status_code == 401


def test_prosrochennaya_sessiya_ne_rabotaet(client, make_user, auth):
    u = make_user("a.smirnova")
    r = client.get("/api/auth/me", headers=auth(make_expired_token(u)))
    assert r.status_code == 401
    assert r.json()["detail"] == "Сессия истекла"


def test_isporchennyi_token_ne_rabotaet(client, auth):
    r = client.get("/api/auth/me", headers=auth("eyJ-ne-token"))
    assert r.status_code == 401


def test_otklyuchennyi_sotrudnik_ne_vhodit(client, make_user):
    make_user("e.kuznecova", active=False)
    r = client.post("/api/auth/login", json={"username": "e.kuznecova", "password": "secret"})
    assert r.status_code == 403


def test_otklyuchenie_deystvuet_srazu(client, make_user, login, auth, db):
    u = make_user("e.kuznecova")
    token = login("e.kuznecova")
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 200
    u.active = False
    db.commit()
    # Токен ещё не истёк, но сотрудник отключён — запрос не проходит
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 403


def test_pervyi_admin_sozdaetsya_v_pustoy_baze(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "Admin"

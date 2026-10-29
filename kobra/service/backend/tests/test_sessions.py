"""Отзыв сессий и ограничение частоты.

JWT не отзывается сам: он подписан и живёт до срока. Поэтому отозванные держим
списком в Redis — и проверяем, что отозванная сессия перестаёт приниматься
сразу, а не когда-нибудь.
"""
import pytest

from app import sessions


@pytest.fixture
def user_h(client, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    token = login("a.smirnova")
    return token, auth(token)


def test_vyhod_zavershaet_sessiyu_srazu(client, user_h):
    token, h = user_h
    assert client.get("/api/auth/me", headers=h).status_code == 200
    r = client.post("/api/auth/logout", headers=h)
    assert r.status_code == 200 and r.json()["revoked"] is True
    # Тот же токен больше не принимают
    again = client.get("/api/auth/me", headers=h)
    assert again.status_code == 401
    assert again.json()["detail"] == "Сессия завершена"


def test_drugaya_sessiya_ne_stradaet(client, make_user, login, auth):
    make_user("a.smirnova")
    first = auth(login("a.smirnova"))
    second = auth(login("a.smirnova"))
    client.post("/api/auth/logout", headers=first)
    # Вышли из одной вкладки — вторая продолжает работать
    assert client.get("/api/auth/me", headers=second).status_code == 200


def test_otklyuchenie_otzyvaet_vydannye_tokeny(client, make_user, login, auth):
    make_user("i.petrov", role="Admin", team="Отдел данных")
    admin = auth(login("i.petrov"))
    make_user("e.kuznecova")
    victim = auth(login("e.kuznecova"))
    assert client.get("/api/auth/me", headers=victim).status_code == 200
    client.patch("/api/users/e.kuznecova", json={"active": False}, headers=admin)
    assert client.get("/api/auth/me", headers=victim).status_code in (401, 403)


def test_bez_redis_vyhod_govorit_pravdu(client, user_h, monkeypatch):
    """Отозвать нечем — говорим об этом, а не делаем вид, что вышли."""
    token, h = user_h
    monkeypatch.setattr(sessions, "redis_conn", lambda: (_ for _ in ()).throw(RuntimeError("нет")))
    r = client.post("/api/auth/logout", headers=h)
    assert r.status_code == 200
    assert r.json()["revoked"] is False
    assert "истечёт сама" in r.json()["note"]
    # И сессия продолжает работать: иначе лежащий Redis выбросил бы всех разом
    assert client.get("/api/auth/me", headers=h).status_code == 200


def test_podbor_parolya_upiraetsya_v_predel(client, make_user, monkeypatch):
    make_user("a.smirnova")
    monkeypatch.setattr(sessions, "RATE_LOGIN_LIMIT", 5)
    codes = [client.post("/api/auth/login", json={"username": "a.smirnova", "password": "ne-tot"}).status_code
             for _ in range(8)]
    assert codes[:5] == [401] * 5
    assert codes[-1] == 429


def test_predel_ne_meshaet_posle_okna(client, make_user, monkeypatch):
    """Предел считается окном: он не запирает вход навсегда."""
    make_user("a.smirnova")
    monkeypatch.setattr(sessions, "RATE_LOGIN_LIMIT", 2)
    monkeypatch.setattr(sessions, "RATE_LOGIN_WINDOW", 1)
    for _ in range(3):
        client.post("/api/auth/login", json={"username": "a.smirnova", "password": "ne-tot"})
    import time
    time.sleep(1.2)
    r = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "secret"})
    assert r.status_code == 200


def test_bez_redis_vhod_ne_zapiraetsya(client, make_user, monkeypatch):
    """Ограничение без Redis не считается — но и вход не закрывается: иначе
    недоступный кэш запирает людей снаружи надёжнее любого злоумышленника."""
    make_user("a.smirnova")
    monkeypatch.setattr(sessions, "redis_conn", lambda: (_ for _ in ()).throw(RuntimeError("нет")))
    for _ in range(20):
        client.post("/api/auth/login", json={"username": "a.smirnova", "password": "ne-tot"})
    assert client.post("/api/auth/login",
                       json={"username": "a.smirnova", "password": "secret"}).status_code == 200

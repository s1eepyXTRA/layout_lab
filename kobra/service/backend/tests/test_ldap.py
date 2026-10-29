"""Вход через каталог LDAP.

Тесты идут против настоящего slapd из compose (`docker compose --profile ldap up
-d ldap`). Поднимать каталог-заглушку внутри процесса бессмысленно: проверять
надо именно то, как ведёт себя ldap3 с живым сервером — там и таймауты, и
нечитаемые атрибуты, и разница между «нет такого» и «пароль не тот».

Каталога нет — тесты пропускаются с понятной причиной, а не падают.
"""
import socket

import pytest

from app import auth as auth_mod
from app import ldap_auth

LDAP_URL = "ldap://localhost:1389"
BASE = "ou=users,dc=company,dc=local"
ADMIN_GROUP = "cn=kobra-admins,ou=groups,dc=company,dc=local"
ANALYST_GROUP = "cn=kobra-analysts,ou=groups,dc=company,dc=local"


def _ldap_alive() -> bool:
    try:
        with socket.create_connection(("localhost", 1389), timeout=1):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _ldap_alive(),
    reason="Каталог не поднят: docker compose --profile ldap up -d ldap",
)


@pytest.fixture
def ldap_mode(monkeypatch):
    """Переключаем сервис на каталог так же, как это делают переменные окружения."""
    monkeypatch.setattr(auth_mod, "AUTH_TYPE", "ldap")
    monkeypatch.setattr(ldap_auth, "LDAP_SERVER", LDAP_URL)
    monkeypatch.setattr(ldap_auth, "LDAP_SEARCH", BASE)
    monkeypatch.setattr(ldap_auth, "LDAP_BIND_USER", "cn=admin,dc=company,dc=local")
    monkeypatch.setattr(ldap_auth, "LDAP_BIND_PASSWORD", "adminpassword")
    monkeypatch.setenv("KOBRA_AUTH_ROLES_MAPPING",
                       '{"%s": "Admin", "%s": "Alpha"}' % (ADMIN_GROUP, ANALYST_GROUP))


def test_vhod_cherez_katalog(client, ldap_mode):
    r = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "secret"})
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["login"] == "a.smirnova"
    assert u["name"] == "Анна Смирнова"
    assert u["email"] == "a.smirnova@company.ru"
    assert u["team"] == "Продажи"


def test_rol_iz_gruppy(client, ldap_mode):
    admin = client.post("/api/auth/login", json={"username": "i.petrov", "password": "secret"}).json()
    assert admin["user"]["role"] == "Admin"
    analyst = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "secret"}).json()
    assert analyst["user"]["role"] == "Alpha"
    # Человек без групп получает роль по умолчанию, а не доступ ко всему
    plain = client.post("/api/auth/login", json={"username": "d.orlov", "password": "secret"}).json()
    assert plain["user"]["role"] == "Gamma"


def test_rol_naznachennaya_rukami_vazhnee_gruppy(client, ldap_mode, db, make_user):
    client.post("/api/auth/login", json={"username": "a.smirnova", "password": "secret"})
    from app.core import User
    u = db.query(User).filter(User.username == "a.smirnova").one()
    u.role, u.role_manual = "Gamma", True
    db.commit()
    again = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "secret"}).json()
    assert again["user"]["role"] == "Gamma"


def test_nevernyi_parol(client, ldap_mode):
    r = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "ne-tot"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Неверный логин или пароль"


def test_net_takogo_v_kataloge(client, ldap_mode):
    r = client.post("/api/auth/login", json={"username": "net-takogo", "password": "secret"})
    assert r.status_code == 401


def test_pustoy_parol_ne_puskaet(client, ldap_mode):
    """Анонимный bind с пустым паролем каталог считает успешным — пустил бы кого угодно."""
    r = client.post("/api/auth/login", json={"username": "a.smirnova", "password": ""})
    assert r.status_code in (401, 422)


def test_katalog_nedostupen_eto_ne_nevernyi_parol(client, ldap_mode, monkeypatch):
    monkeypatch.setattr(ldap_auth, "LDAP_SERVER", "ldap://localhost:1")   # никто не слушает
    r = client.post("/api/auth/login", json={"username": "a.smirnova", "password": "secret"})
    assert r.status_code == 503
    assert "Каталог недоступен" in r.json()["detail"]


def test_sotrudnik_zavoditsya_pri_pervom_vhode(client, ldap_mode, db):
    from app.core import User
    assert db.query(User).filter(User.username == "d.orlov").count() == 0
    client.post("/api/auth/login", json={"username": "d.orlov", "password": "secret"})
    db.expire_all()
    u = db.query(User).filter(User.username == "d.orlov").one()
    # Пароль каталога у нас не хранится: проверяет его каталог
    assert u.password_hash == ""
    assert u.team == "Поддержка"


def test_logiin_so_zvezdochkoy_ne_menyaet_zapros(client, ldap_mode):
    """Фильтр LDAP — тоже место для инъекции, просто не в SQL."""
    r = client.post("/api/auth/login", json={"username": "*", "password": "secret"})
    assert r.status_code == 401

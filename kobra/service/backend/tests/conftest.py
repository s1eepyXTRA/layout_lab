"""Общая подготовка тестов.

Тесты идут против настоящего Postgres, а не против SQLite: схема у нас
постгресовая (JSON-колонки, отдельная схема под загруженные строки), и проверять
её на другом движке — значит проверять не то, что поедет в продакшен. База
отдельная (`KOBRA_TEST_DATABASE_URL`) и пересоздаётся на каждый прогон.

Адрес базы читает `app.core` при импорте, поэтому окружение задаётся здесь — до
того, как приложение импортировано.
"""
import os

TEST_DB_URL = os.environ.get(
    "KOBRA_TEST_DATABASE_URL", "postgresql+psycopg://kobra:kobra@localhost:5433/kobra_test"
)
os.environ["KOBRA_DATABASE_URL"] = TEST_DB_URL
os.environ.setdefault("KOBRA_SECRET_KEY", "test-secret-key-dlinnee-32-baytov-rovno")
os.environ.setdefault("KOBRA_ADMIN_USER", "admin")
os.environ.setdefault("KOBRA_ADMIN_PASSWORD", "admin")

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from sqlalchemy import text  # noqa: E402

from app.core import UPLOAD_SCHEMA, Base, SessionLocal, User, engine, hash_password  # noqa: E402
from app.main import app  # noqa: E402


def _ensure_database() -> None:
    """Создать тестовую базу, если её нет: подключаемся к служебной `postgres`."""
    name = TEST_DB_URL.rsplit("/", 1)[-1]
    admin_url = TEST_DB_URL.rsplit("/", 1)[0] + "/postgres"
    dsn = admin_url.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn, autocommit=True) as conn:
        exists = conn.execute("select 1 from pg_database where datname = %s", (name,)).fetchone()
        if not exists:
            conn.execute(f'create database "{name}"')


@pytest.fixture(scope="session", autouse=True)
def schema():
    _ensure_database()
    with engine.begin() as conn:
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {UPLOAD_SCHEMA}"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def clean_tables(schema):
    """Каждый тест начинает с пустых таблиц: общая база, но не общее состояние."""
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            # Имя со схемой: строки наборов лежат не в public
            full = f'"{table.schema}"."{table.name}"' if table.schema else f'"{table.name}"'
            conn.exec_driver_sql(f'truncate table {full} restart identity cascade')
    yield


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def make_user(db):
    """Сотрудник в базе. Пароль по умолчанию один на всех — это тесты."""
    def _make(login, role="Gamma", team="Продажи", password="secret", active=True, **kw):
        u = User(
            username=login, password_hash=hash_password(password), full_name=login,
            email=f"{login}@company.ru", team=team, role=role, groups=kw.get("groups", []),
            active=active,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        return u
    return _make


@pytest.fixture
def login(client):
    """Токен сотрудника: ходим тем же путём, что и браузер."""
    def _login(username, password="secret"):
        r = client.post("/api/auth/login", json={"username": username, "password": password})
        assert r.status_code == 200, r.text
        return r.json()["token"]
    return _login


@pytest.fixture
def auth():
    """Заголовок с токеном."""
    return lambda token: {"Authorization": f"Bearer {token}"}

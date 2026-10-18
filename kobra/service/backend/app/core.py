"""Кобра: настройки, база метаданных, пароли, сессии и шифрование секретов."""
import base64
import datetime as dt
import hashlib
import os
import secrets

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# ---------- Настройки ----------
DATABASE_URL = os.environ.get("KOBRA_DATABASE_URL", "postgresql+psycopg2://kobra:kobra@localhost:5432/kobra")
SECRET_KEY = os.environ.get("KOBRA_SECRET_KEY") or ""
if not SECRET_KEY:
    SECRET_KEY = "dev-" + hashlib.sha256(DATABASE_URL.encode()).hexdigest()
    print("ВНИМАНИЕ: KOBRA_SECRET_KEY не задан, используется ключ для разработки. Задайте его в продакшене.")
ADMIN_USER = os.environ.get("KOBRA_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("KOBRA_ADMIN_PASSWORD", "admin")
COOKIE_SECURE = os.environ.get("KOBRA_COOKIE_SECURE", "0") == "1"
MAX_RESULT_ROWS = int(os.environ.get("KOBRA_MAX_RESULT_ROWS", "50000"))
QUERY_TIMEOUT_SEC = int(os.environ.get("KOBRA_QUERY_TIMEOUT_SEC", "120"))
SESSION_DAYS = int(os.environ.get("KOBRA_SESSION_DAYS", "14"))
LOAD_DEMO = os.environ.get("KOBRA_LOAD_DEMO", "1") == "1"
FRONTEND_DIR = os.environ.get("KOBRA_FRONTEND_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))

UPLOAD_SCHEMA = "kobra_uploads"
DEMO_SCHEMA = "kobra_demo"
INTERNAL_CONN = "__internal__"
ROLES = ("viewer", "editor", "admin")

# ---------- База метаданных ----------
engine = create_engine(
    DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20,
    connect_args={"options": f"-c statement_timeout={QUERY_TIMEOUT_SEC * 1000}"} if DATABASE_URL.startswith("postgresql") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
Base = declarative_base()


def now():
    return dt.datetime.now(dt.timezone.utc)


class User(Base):
    __tablename__ = "kobra_users"
    id = Column(Integer, primary_key=True)
    username = Column(String(120), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    role = Column(String(20), nullable=False, default="viewer")
    created_at = Column(DateTime(timezone=True), default=now)


class Connection(Base):
    __tablename__ = "kobra_connections"
    id = Column(String(64), primary_key=True)
    name = Column(String(200), nullable=False)
    kind = Column(String(30), nullable=False)
    url_enc = Column(Text, nullable=False)
    info = Column(JSON, default=dict)  # host, port, database, user — без пароля
    created_at = Column(DateTime(timezone=True), default=now)


class Dataset(Base):
    __tablename__ = "kobra_datasets"
    id = Column(String(64), primary_key=True)
    name = Column(String(300), nullable=False)
    connection_id = Column(String(64), nullable=False, default=INTERNAL_CONN)
    kind = Column(String(20), nullable=False)  # table | sql | upload | demo
    schema_name = Column(String(200))
    table_name = Column(String(300))
    sql = Column(Text)
    columns = Column(JSON, default=list)
    metrics = Column(JSON, default=list)
    main_dttm = Column(String(200))
    time_anchor = Column(String(10), default="now")  # now | data
    stats = Column(JSON, default=dict)
    description = Column(Text, default="")
    file_name = Column(String(300))
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)


class Chart(Base):
    __tablename__ = "kobra_charts"
    id = Column(String(64), primary_key=True)
    name = Column(String(300), nullable=False)
    viz = Column(String(40), nullable=False)
    dataset_id = Column(String(64), nullable=False)
    params = Column(JSON, default=dict)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
    updated_by = Column(String(120))


class Dashboard(Base):
    __tablename__ = "kobra_dashboards"
    id = Column(String(64), primary_key=True)
    title = Column(String(300), nullable=False)
    body = Column(JSON, default=dict)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
    updated_by = Column(String(120))


class Setting(Base):
    __tablename__ = "kobra_settings"
    key = Column(String(100), primary_key=True)
    value = Column(JSON)


# ---------- Пароли и сессии ----------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def check_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def make_token(user: User) -> str:
    payload = {"sub": str(user.id), "exp": now() + dt.timedelta(days=SESSION_DAYS), "n": secrets.token_hex(4)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def read_token(token: str):
    try:
        return int(jwt.decode(token, SECRET_KEY, algorithms=["HS256"])["sub"])
    except Exception:
        return None


# ---------- Шифрование строк подключения ----------
_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(("kobra-conn:" + SECRET_KEY).encode()).digest()))


def encrypt(s: str) -> str:
    return _fernet.encrypt(s.encode()).decode()


def decrypt(s: str) -> str:
    try:
        return _fernet.decrypt(s.encode()).decode()
    except InvalidToken:
        raise RuntimeError("Не удалось расшифровать строку подключения: сменился KOBRA_SECRET_KEY?")

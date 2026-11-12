"""Кобра: настройки, база метаданных, пароли, сессии и шифрование секретов."""
import base64
import datetime as dt
import hashlib
import os
import secrets

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, LargeBinary, String, Text, create_engine
# shared ищут запросом («покажи, что мне выдали»), а JSON такого не умеет —
# для этой колонки нужен JSONB с оператором включения
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, sessionmaker

# ---------- Настройки ----------
DATABASE_URL = os.environ.get("KOBRA_DATABASE_URL", "postgresql+psycopg://kobra:kobra@localhost:5432/kobra")
SECRET_KEY = os.environ.get("KOBRA_SECRET_KEY") or ""
if not SECRET_KEY:
    SECRET_KEY = "dev-" + hashlib.sha256(DATABASE_URL.encode()).hexdigest()
    print("ВНИМАНИЕ: KOBRA_SECRET_KEY не задан, используется ключ для разработки. Задайте его в продакшене.")
ADMIN_USER = os.environ.get("KOBRA_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("KOBRA_ADMIN_PASSWORD", "admin")
COOKIE_SECURE = os.environ.get("KOBRA_COOKIE_SECURE", "0") == "1"
MAX_RESULT_ROWS = int(os.environ.get("KOBRA_MAX_RESULT_ROWS", "50000"))
# Сколько строк принимаем в один набор: тот же предел, что у клиента
MAX_UPLOAD_ROWS = int(os.environ.get("KOBRA_MAX_UPLOAD_ROWS", "50000"))
QUERY_TIMEOUT_SEC = int(os.environ.get("KOBRA_QUERY_TIMEOUT_SEC", "120"))
SESSION_DAYS = int(os.environ.get("KOBRA_SESSION_DAYS", "14"))
# Без таймаута подключения проба готовности не отвечает «не готов», а висит:
# недоступная база выглядит как зависший сервис, и трафик с него не снимают
CONNECT_TIMEOUT_SEC = int(os.environ.get("KOBRA_CONNECT_TIMEOUT_SEC", "3"))
LOAD_DEMO = os.environ.get("KOBRA_LOAD_DEMO", "1") == "1"
# Пул соединений и пул потоков. Их нельзя задавать независимо: синхронные
# маршруты живут в пуле потоков, и каждый занятый поток хочет соединение.
# Потоков больше, чем соединений, — значит часть потоков ждёт не базу, а
# очередь к пулу, и выглядит это как «база медленная».
DB_POOL = int(os.environ.get("KOBRA_DB_POOL", "10"))
DB_POOL_OVERFLOW = int(os.environ.get("KOBRA_DB_POOL_OVERFLOW", "20"))


def threadpool_size(requested: int, pool: int, overflow: int) -> int:
    """Сколько потоков отдать синхронным маршрутам: не больше, чем соединений."""
    return max(1, min(requested, pool + overflow))


THREADPOOL = threadpool_size(int(os.environ.get("KOBRA_THREADPOOL", "30")),
                             DB_POOL, DB_POOL_OVERFLOW)
# ---------- Доступ к модели ----------
# Адрес шлюза, модель и токен живут **только здесь**: в браузер токен не уходит
# ни в одном ответе. `KOBRA_AI_MODEL` — алиас в шлюзе (LiteLLM), а не
# идентификатор вендора: смена модели не требует нового образа.
AI_URL = os.environ.get("KOBRA_AI_URL", "").strip()
AI_MODEL = os.environ.get("KOBRA_AI_MODEL", "").strip()
# Ключ **по умолчанию**: им идут обращения команд, которым администратор не выдал
# свой. Пока ключей по командам нет, это ровно нынешнее поведение; пустой —
# значит «только по командным ключам».
AI_TOKEN = os.environ.get("KOBRA_AI_TOKEN", "").strip()
# Таймаут нашего запроса к шлюзу. Цепочка сверху вниз: обратный прокси (120) >
# AI_TIMEOUT_SEC (60) > клиент ждёт 70. Нарушишь порядок — человек получит обрыв
# соединения вместо внятного «модель не ответила», а токен будет уже потрачен.
AI_TIMEOUT_SEC = int(os.environ.get("KOBRA_AI_TIMEOUT_SEC", "60"))
# Кому разрешено тратить служебный ключ. Пусто — всем вошедшим, как было до
# изменения: поведение меняется только когда администратор сузит доступ сам.
AI_ROLES = tuple(r.strip() for r in os.environ.get("KOBRA_AI_ROLES", "").split(",") if r.strip())
# Размер запроса. Проверяется и в клиенте (чтобы сказать человеку сразу), и
# здесь — клиенту верить нельзя
AI_MAX_CHARS = int(os.environ.get("KOBRA_AI_MAX_CHARS", "4000"))
AI_MAX_COLS = int(os.environ.get("KOBRA_AI_MAX_COLS", "40"))
# Пределы частоты — местная защита от цикла, а не бюджет: потолок расхода
# ставится виртуальным ключом в самом LiteLLM, там, где деньги
AI_LIMIT_USER = int(os.environ.get("KOBRA_AI_LIMIT_USER", "20"))
AI_LIMIT_ALL = int(os.environ.get("KOBRA_AI_LIMIT_ALL", "200"))
AI_LOG_DAYS = int(os.environ.get("KOBRA_AI_LOG_DAYS", "90"))
# Шлюз обычно пишет запросы сам, и тогда чужие тексты не нужны в двух местах.
# Расход и итог пишутся всегда: без них журнал не отвечает ни на «сколько», ни
# на «работает ли»
AI_LOG_TEXT = os.environ.get("KOBRA_AI_LOG_TEXT", "1") != "0"


def ai_configured() -> bool:
    """Есть ли у сервиса куда обращаться: адрес шлюза и модель по умолчанию.

    Это **не** ответ на вопрос «можно ли мне»: ключ выдаётся на команду, и
    ответ зависит от того, кто спрашивает. `/api/ping` отвечает без сессии и
    поэтому говорит только про сервис; «можно ли мне» живёт в `/api/auth/me`.
    """
    return bool(AI_URL and AI_MODEL)


# Собранный интерфейс: тот же build/, который открывают двойным щелчком.
FRONTEND_DIR = os.environ.get(
    "KOBRA_FRONTEND_DIR",
    os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "build")),
)

UPLOAD_SCHEMA = "kobra_uploads"
DEMO_SCHEMA = "kobra_demo"
INTERNAL_CONN = "__internal__"
# Роли как в Superset и в клиенте: Admin — всё, Alpha — видит чужое, Gamma — своё
ROLES = ("Admin", "Alpha", "Gamma")

# ---------- База метаданных ----------
engine = create_engine(
    DATABASE_URL, pool_pre_ping=True, pool_size=DB_POOL, max_overflow=DB_POOL_OVERFLOW,
    connect_args={"options": f"-c statement_timeout={QUERY_TIMEOUT_SEC * 1000}",
                  "connect_timeout": CONNECT_TIMEOUT_SEC} if DATABASE_URL.startswith("postgresql") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
Base = declarative_base()


def now():
    return dt.datetime.now(dt.timezone.utc)


class User(Base):
    """Сотрудник. При AUTH_TYPE=ldap пароль не хранится (bind в каталоге),
    команда и группы приходят из LDAP, роль — из AUTH_ROLES_MAPPING."""

    __tablename__ = "kobra_users"
    id = Column(Integer, primary_key=True)
    username = Column(String(120), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False, default="")
    email = Column(String(200), default="")
    full_name = Column(String(200), default="")
    team = Column(String(200), default="")  # подразделение: команда видит работу друг друга
    role = Column(String(20), nullable=False, default="Gamma")  # Admin | Alpha | Gamma
    # Роль назначена руками: при входе через каталог она не перетирается группами
    role_manual = Column(Boolean, nullable=False, default=False, server_default="false")
    groups = Column(JSON, default=list)  # группы LDAP, по которым выдана роль
    # Отключённый сотрудник перестаёт работать сразу: признак смотрят на каждом
    # запросе, а не только при входе
    active = Column(Boolean, nullable=False, default=True, server_default="true")
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
    owner_login = Column(String(120))  # владелец: тот, кто создал
    team = Column(String(200), default="")  # команда владельца на момент создания
    shared = Column(JSONB, default=list)  # логины соправителей (owners в Superset)
    main_dttm = Column(String(200))
    time_anchor = Column(String(10), default="now")  # now | data
    stats = Column(JSON, default=dict)
    description = Column(Text, default="")
    file_name = Column(String(300))
    # Клиентский объект как есть: описание схемы, подписи, единицы. Колонки выше
    # остаются под будущий путь «набор поверх таблицы в базе».
    body = Column(JSON, default=dict)
    # Скрытый набор макета принадлежит шаблону: такой не показывают в списке данных
    owner_dashboard_id = Column(String(64))
    version = Column(Integer, nullable=False, default=1, server_default="1")
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
    updated_by = Column(String(120))


class Chart(Base):
    __tablename__ = "kobra_charts"
    id = Column(String(64), primary_key=True)
    name = Column(String(300), nullable=False)
    viz = Column(String(40), nullable=False)
    dataset_id = Column(String(64), nullable=False)
    params = Column(JSON, default=dict)
    body = Column(JSON, default=dict)  # клиентский объект целиком: spec, autoName и прочее
    # Сводка для карточки в списке: считается при записи, чтобы список не читал
    # тела. Список со телами — это и есть то, из-за чего запуск приложения
    # зависел от объёма чужой работы в сервисе.
    summary = Column(JSONB, default=dict)   # сводка для карточки: что нужно списку, без тела
    owner_login = Column(String(120))  # владелец: тот, кто создал
    team = Column(String(200), default="")  # команда владельца на момент создания
    shared = Column(JSONB, default=list)  # логины соправителей (owners в Superset)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
    updated_by = Column(String(120))


class Dashboard(Base):
    __tablename__ = "kobra_dashboards"
    id = Column(String(64), primary_key=True)
    title = Column(String(300), nullable=False)
    body = Column(JSON, default=dict)  # вкладки, фильтры, fromTemplate — клиентский объект
    summary = Column(JSONB, default=dict)  # сводка для карточки: см. Chart.summary
    owner_login = Column(String(120))  # владелец: тот, кто создал
    team = Column(String(200), default="")  # команда владельца на момент создания
    shared = Column(JSONB, default=list)  # логины соправителей (owners в Superset)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
    updated_by = Column(String(120))


class UploadChunk(Base):
    """Кусок загруженного файла по дороге к разбору.

    Файл лежит в базе, а не на диске, потому что принимает его веб-сервис, а
    разбирает воркер — это разные процессы и в кластере разные поды. Общий диск
    между ними потребовал бы хранилища с ReadWriteMany, которого во многих
    контурах просто нет; база есть всегда.
    """

    __tablename__ = "files"
    __table_args__ = {"schema": UPLOAD_SCHEMA}
    task_id = Column(String(64), primary_key=True)
    idx = Column(Integer, primary_key=True)
    data = Column(LargeBinary, nullable=False)


class AiKey(Base):
    """Ключ к модели на команду.

    Один ключ на всех не делится: команда, собравшая двести черновиков, тратит
    деньги остальных, а отобрать ключ значит отобрать его у всех. В самом шлюзе
    (LiteLLM) виртуальные ключи с бюджетом так и выдают — по командам, поэтому
    Кобра принимает их на том же уровне.

    Ключ лежит зашифрованным (Fernet от `KOBRA_SECRET_KEY`, как строки
    подключения) и **наружу не отдаётся никогда и никому**, включая того
    администратора, который его вставил: показать ключ значит дать его
    скопировать, а скопированный ключ живёт в чужих заметках дольше, чем здесь.
    """

    __tablename__ = "kobra_ai_keys"
    team = Column(String(200), primary_key=True)
    token_enc = Column(Text, nullable=False)
    # Необязательный алиас: в шлюзе разным ключам разрешены разные модели
    model = Column(String(200), default="")
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
    updated_by = Column(String(120))


class AiLog(Base):
    """Обращение к модели: кто, когда, какая модель, сколько токенов и чем
    кончилось — и чем кончилось **для человека**.

    Последнее сервер знать не может: ответ разбирает клиент, а «HTTP 200,
    1400 токенов» ничего не говорит о том, не выбросил ли человек результат
    сразу. Поэтому клиент дописывает итог сборки в уже существующую запись.
    Без этого журнал отвечает про деньги и молчит про пользу.
    """

    __tablename__ = "kobra_ai_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    login = Column(String(120), index=True)
    # Команда на момент обращения, а не «сейчас»: человек переходит между
    # командами, а потраченное остаётся за той, чьим ключом обращались
    team = Column(String(200), index=True)
    # Чьим ключом шли: 'team' — своим, 'default' — ключом по умолчанию. Без
    # этого «расход команды» не сходится с тем, что показывает шлюз
    key_kind = Column(String(20), default="")
    created_at = Column(DateTime(timezone=True), default=now, index=True)
    model = Column(String(200), default="")
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    # Итог обращения к шлюзу: ok, denied, limit, timeout, parse, gateway
    outcome = Column(String(40), default="")
    # Итог сборки у человека: built, empty — или пусто, пока клиент не сказал
    built = Column(String(20), default="")
    skipped = Column(Integer, default=0)
    # Тексты хранятся, только если KOBRA_AI_LOG_TEXT включён
    task = Column(Text)
    answer = Column(Text)


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
    # jti и iat нужны для отзыва: по первому выбрасывают одну сессию, по второму —
    # все сессии сотрудника, выданные до отметки
    payload = {
        "sub": str(user.id), "exp": now() + dt.timedelta(days=SESSION_DAYS),
        "iat": now(), "jti": secrets.token_hex(8),
    }
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

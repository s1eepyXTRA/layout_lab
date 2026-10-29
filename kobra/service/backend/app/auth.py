"""Вход и сессия.

Способ входа — настройка `AUTH_TYPE` (как в Superset): `db` проверяет пароль по
своей базе, `ldap` будет делать bind в каталог (этап 3). Сессия — JWT: токен
подписан ключом сервиса и живёт `KOBRA_SESSION_DAYS` дней.

Пароль проверяет только сервер. Клиент не считает человека вошедшим, пока не
получит ответ отсюда.
"""
import datetime as dt
import os

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import ADMIN_PASSWORD, ADMIN_USER, SECRET_KEY, User, check_password, hash_password, make_token
from app.db import get_db
from app.ldap_auth import LdapDenied, LdapUnavailable, ldap_login
from app.sessions import is_revoked, rate_hit, revoke, user_revoked_at

AUTH_TYPE = os.environ.get("KOBRA_AUTH_TYPE", "db")

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


def user_out(u: User) -> dict:
    """Что знает о себе клиент. Пароля здесь нет и быть не может."""
    return {
        "login": u.username,
        "name": u.full_name or u.username,
        "email": u.email or "",
        "team": u.team or "",
        "role": u.role,
        "groups": list(u.groups or []),
        "active": bool(u.active),
    }


def ensure_admin(db: Session) -> None:
    """Первый админ: без него в пустую базу некому войти. Логин и пароль — из
    `KOBRA_ADMIN_USER`/`KOBRA_ADMIN_PASSWORD`, и пароль по умолчанию годится
    только для разработки."""
    if db.query(User).count():
        return
    db.add(User(
        username=ADMIN_USER, password_hash=hash_password(ADMIN_PASSWORD),
        full_name="Администратор", role="Admin", team="", groups=[],
    ))
    db.commit()


def authenticate(db: Session, username: str, password: str) -> User:
    """Проверка пароля. Отказ намеренно одинаков для «нет такого логина» и
    «пароль не подошёл»: по разным ответам подбирают логины."""
    login = username.strip()
    if AUTH_TYPE == "ldap":
        u = _authenticate_ldap(db, login, password)
    else:
        u = db.query(User).filter(User.username == login).one_or_none()
        if u is None or not u.password_hash or not check_password(password, u.password_hash):
            raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    if not u.active:
        raise HTTPException(status_code=403, detail="Доступ прекращён")
    return u


def _authenticate_ldap(db: Session, login: str, password: str) -> User:
    """Вход через каталог. Сотрудник заводится при первом входе — как
    AUTH_USER_REGISTRATION в Superset: держать второй справочник руками никто
    не станет."""
    try:
        info = ldap_login(login, password)
    except LdapDenied:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    except LdapUnavailable as e:
        # Это неисправность, а не неверный пароль: иначе человек будет в десятый
        # раз перенабирать верный пароль
        raise HTTPException(status_code=503, detail=f"Каталог недоступен: {e}")

    u = db.query(User).filter(User.username == login).one_or_none()
    if u is None:
        u = User(username=login, password_hash="", role=info.get("role") or "Gamma")
        db.add(u)
    u.full_name = info.get("name") or login
    u.email = info.get("email") or ""
    u.team = info.get("team") or u.team or ""
    u.groups = info.get("groups") or []
    # Роль, назначенная админом руками, важнее групп каталога — иначе назначение
    # затрётся следующим же входом сотрудника
    if not u.role_manual and info.get("role"):
        u.role = info["role"]
    db.commit()
    db.refresh(u)
    return u


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    # Подбор пароля ограничиваем по адресу: счёт общий для всех экземпляров
    wait = rate_hit("login", request.client.host if request.client else "-")
    if wait is not None:
        raise HTTPException(status_code=429, detail=f"Слишком много попыток входа, повторите через {wait} с")
    ensure_admin(db)
    u = authenticate(db, body.username, body.password)
    return {"token": make_token(u), "user": user_out(u)}



def _payload(request: Request) -> dict:
    header = request.headers.get("Authorization") or ""
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Нужен вход")
    try:
        return jwt.decode(header[7:].strip(), SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Сессия истекла")
    except Exception:
        raise HTTPException(status_code=401, detail="Сессия недействительна")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Сотрудник по токену. Отключённый сотрудник перестаёт работать сразу:
    признак проверяется при каждом запросе, а не только при входе."""
    payload = _payload(request)
    if is_revoked(payload.get("jti")):
        raise HTTPException(status_code=401, detail="Сессия завершена")
    cutoff = user_revoked_at(int(payload.get("sub", 0) or 0))
    if cutoff is not None and int(payload.get("iat", 0) or 0) <= cutoff:
        raise HTTPException(status_code=401, detail="Сессия завершена")
    u = db.get(User, int(payload.get("sub", 0) or 0))
    if u is None:
        raise HTTPException(status_code=401, detail="Сессия недействительна")
    if not u.active:
        raise HTTPException(status_code=403, detail="Доступ прекращён")
    return u


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "Admin":
        raise HTTPException(status_code=403, detail="Только для администратора")
    return user


@router.post("/logout")
def logout(request: Request, _user: User = Depends(current_user)):
    """Выход отзывает именно эту сессию: токен перестаёт приниматься сразу, а не
    по истечении срока."""
    payload = _payload(request)
    ttl = int(payload.get("exp", 0)) - int(dt.datetime.now(dt.timezone.utc).timestamp())
    ok = revoke(payload.get("jti"), ttl)
    return {"ok": True, "revoked": ok,
            "note": None if ok else "Сессия истечёт сама: хранилище отозванных недоступно"}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


def make_expired_token(user: User) -> str:
    """Просроченный токен — нужен тестам, чтобы проверить истёкшую сессию."""
    payload = {"sub": str(user.id), "exp": dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

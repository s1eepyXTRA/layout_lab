"""Сотрудники: список, роль вручную, отключение.

Экран админа. Роль, назначенная руками, помечается `role_manual` и переживает
повторный вход: при входе через каталог роль выводится из групп
(`AUTH_ROLES_MAPPING`), и без этой пометки назначение админа затёрлось бы
следующим же входом сотрудника.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import current_user, require_admin, user_out
from app.core import ROLES, SESSION_DAYS, User
from app.sessions import revoke_user
from app.db import get_db

router = APIRouter(prefix="/api/users", tags=["users"])


class UserPatch(BaseModel):
    role: Optional[str] = None
    active: Optional[bool] = None


@router.get("")
def list_users(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    users = db.query(User).order_by(User.username).all()
    return [dict(user_out(u), role_manual=bool(u.role_manual)) for u in users]


@router.get("/directory")
def directory(db: Session = Depends(get_db), _user: User = Depends(current_user)):
    """Справочник для выдачи доступа: видят все вошедшие. Без него нельзя
    поделиться шаблоном — человек не найдёт коллегу по логину или почте.
    Ролей и признаков отключения здесь нет: это адресная книга."""
    users = db.query(User).filter(User.active.is_(True)).order_by(User.username).all()
    return [{"login": u.username, "name": u.full_name or u.username,
             "email": u.email or "", "team": u.team or ""} for u in users]


@router.patch("/{login}")
def patch_user(login: str, body: UserPatch, db: Session = Depends(get_db),
               admin: User = Depends(require_admin)):
    u = db.query(User).filter(User.username == login).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(status_code=422, detail=f"Роль должна быть одной из: {', '.join(ROLES)}")
        u.role = body.role
        u.role_manual = True          # назначенное руками важнее того, что придёт из каталога
    if body.active is not None:
        # Себя отключить нельзя: админ запрёт сам себя, и чинить будет некому
        if not body.active and u.id == admin.id:
            raise HTTPException(status_code=422, detail="Нельзя отключить самого себя")
        u.active = body.active
        if not body.active:
            # Признак смотрят на каждом запросе, но отозвать надо и те токены,
            # что уже в пути: пусть перестанут приниматься сразу
            revoke_user(u.id, SESSION_DAYS * 86400)
    db.commit()
    db.refresh(u)
    return dict(user_out(u), role_manual=bool(u.role_manual))

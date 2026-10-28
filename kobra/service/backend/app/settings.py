"""Личные настройки сотрудника.

Небольшие куски состояния, которым не нужна своя таблица: например,
`dsMetrics` — метрики, которые человек добавил к встроенным наборам. Ключ в
таблице составной, «имя:логин»: настройка личная, и чужую не видно.
"""
from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.auth import current_user
from app.core import Setting, User
from app.db import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _key(name: str, user: User) -> str:
    return f"{name}:{user.username}"


@router.get("/{name}")
def read_setting(name: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.get(Setting, _key(name, user))
    return row.value if row is not None else None


@router.put("/{name}")
def write_setting(name: str, value=Body(..., embed=True), db: Session = Depends(get_db),
                  user: User = Depends(current_user)):
    key = _key(name, user)
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value
    db.commit()
    return {"ok": True}

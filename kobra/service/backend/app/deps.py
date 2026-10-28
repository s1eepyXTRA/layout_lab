"""Зависимости FastAPI, через которые проходит доступ к объектам.

Маршрут данных не достаёт объект сам: он просит зависимость, а та проверяет
права. Так правило стоит на пути к объекту, а не повторяется в каждом
обработчике — иначе однажды его забудут написать, и маршрут отдаст чужое.

Отказ в доступе — 403, а не 404: Кобра показывает человеку, почему объект не
открылся, и у кого попросить доступ. Прятать сам факт существования шаблона
внутри компании смысла нет, а молчаливое «не найдено» заставляет гадать.
"""
from typing import Callable, Type

from fastapi import Depends, HTTPException, Path
from sqlalchemy.orm import Session

from app.access import can_edit, can_share, can_view, why_read_only
from app.auth import current_user
from app.core import User
from app.db import get_db


def _load(db: Session, model: Type, obj_id: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Объект не найден")
    return obj


def object_for_read(model: Type) -> Callable:
    """Объект, который человеку можно показывать."""
    def dep(obj_id: str = Path(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
        obj = _load(db, model, obj_id)
        if not can_view(user, obj):
            raise HTTPException(status_code=403, detail="Нет доступа к объекту")
        return obj
    return dep


def object_for_write(model: Type) -> Callable:
    """Объект, который человеку можно править. Причину отказа говорим словами:
    «нет доступа» без объяснения заставляет человека писать в поддержку."""
    def dep(obj_id: str = Path(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
        obj = _load(db, model, obj_id)
        if not can_edit(user, obj):
            raise HTTPException(status_code=403, detail=why_read_only(obj))
        return obj
    return dep


def object_for_share(model: Type) -> Callable:
    """Объект, доступ к которому человек может передавать дальше."""
    def dep(obj_id: str = Path(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
        obj = _load(db, model, obj_id)
        if not can_share(user, obj):
            raise HTTPException(status_code=403, detail=why_read_only(obj))
        return obj
    return dep

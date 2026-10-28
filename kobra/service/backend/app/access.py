"""Права: кто что видит и правит.

Правила переписаны один в один с клиентских `canView`/`canEdit`/`canShare`
(`kobra/src/auth.js`) и живут здесь в трёх функциях — по той же причине, по
которой в клиенте их три: правило, размазанное по маршрутам, разъезжается.

Решение принимает сервер. Клиентские функции остаются, но только чтобы прятать
кнопки: проверка в браузере — подсказка, а не защита.
"""
from typing import Any, Optional

# Владелец встроенных объектов и команда «видно всем» — те же значения, что в клиенте
AUTH_SYSTEM = "kobra"
TEAM_ALL = "*"

ROLE_ADMIN = "Admin"
ROLE_ALPHA = "Alpha"
ROLE_GAMMA = "Gamma"


def _owner(obj: Any) -> Optional[str]:
    return getattr(obj, "owner_login", None) or None


def _team(obj: Any) -> str:
    return getattr(obj, "team", "") or ""


def _shared(obj: Any) -> list:
    return list(getattr(obj, "shared", None) or [])


def is_public(obj: Any) -> bool:
    """Общий объект: демо-шаблон и встроенные наборы. Видны всем, правит админ."""
    return _team(obj) == TEAM_ALL


def can_view(user: Any, obj: Any) -> bool:
    if user is None or obj is None:
        return False
    if user.role == ROLE_ADMIN or is_public(obj):
        return True
    if _owner(obj) == user.username or user.username in _shared(obj):
        return True
    if user.role == ROLE_ALPHA:
        return True
    return bool(_team(obj)) and _team(obj) == (user.team or "")


def can_edit(user: Any, obj: Any) -> bool:
    if user is None or obj is None:
        return False
    if user.role == ROLE_ADMIN:
        return True
    return _owner(obj) == user.username or user.username in _shared(obj)


def can_share(user: Any, obj: Any) -> bool:
    """Совпадает с правом на правку: соправитель добавляет соправителя, как в Superset."""
    return can_edit(user, obj)


def why_read_only(obj: Any) -> str:
    """Почему нельзя — одной фразой, чтобы интерфейс не молчал."""
    own = _owner(obj)
    if own and own != AUTH_SYSTEM:
        return f"Объект принадлежит {own}. Попросите выдать доступ — тогда можно будет править."
    return "Это общий объект: править его может администратор."

"""Шаблоны, графики и наборы: хранение и выдача.

Сервер здесь — хранилище, а не вычислитель. Клиентский объект уезжает в колонку
`body` как есть, а в отдельные колонки вынесено только то, что сервер правда
запрашивает: владелец, команда, список доступа, версия, название и время правки.
Отсюда главное правило: **сервер не придумывает полей клиентскому объекту и не
теряет чужих**.

Три вида объектов отличаются только названием поля с именем и парой зеркальных
колонок, поэтому маршруты собираются одной фабрикой: три почти одинаковых
роутера разъехались бы на первой же правке правил.
"""
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.access import TEAM_ALL, can_edit, can_share, can_view, why_read_only
from app.auth import AUTH_TYPE, current_user
from app.core import Chart, Dashboard, Dataset, User, now
from app.db import get_db
from app.ingest import drop_dataset_table
from app.ldap_auth import ldap_lookup
from app.queue import cache_drop

# Поля, которыми распоряжается сервер: в `body` они не попадают
SERVER_FIELDS = {"id", "ownerLogin", "team", "shared", "version", "updated", "updatedBy"}


def _out(obj: Any, name_field: str) -> dict:
    """Объект для клиента: его собственное тело плюс серверные поля."""
    body = dict(obj.body or {})
    body.update({
        "id": obj.id,
        name_field: getattr(obj, "title" if name_field == "title" else "name"),
        "ownerLogin": obj.owner_login,
        "team": obj.team or "",
        "shared": list(obj.shared or []),
        "version": obj.version,
        "updated": int(obj.updated_at.timestamp() * 1000) if obj.updated_at else None,
        "updatedBy": obj.updated_by,
    })
    return body


def _split(payload: dict, name_field: str) -> tuple[str, dict]:
    """Делим пришедшее на имя и тело. Чужих полей не трогаем — вернём как есть."""
    name = str(payload.get(name_field) or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail=f"Поле «{name_field}» обязательно")
    body = {k: v for k, v in payload.items() if k not in SERVER_FIELDS and k != name_field}
    return name, body


def make_router(model, prefix: str, name_field: str, tag: str) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    is_dataset = model is Dataset

    def set_name(obj, name: str) -> None:
        if name_field == "title":
            obj.title = name
        else:
            obj.name = name

    def visible(db: Session, user: User):
        """Что человеку видно. Правило то же, что в can_view, но выраженное
        запросом: тянуть всё в память и фильтровать в Python нельзя — объектов
        у команды со временем станет много."""
        q = db.query(model)
        if user.role == "Admin" or user.role == "Alpha":
            return q
        return q.filter(or_(
            model.team == TEAM_ALL,
            model.owner_login == user.username,
            model.shared.contains([user.username]),
            model.team == (user.team or "\x00"),   # пустая команда не совпадает ни с чем
        ))

    @router.get("")
    def list_objects(db: Session = Depends(get_db), user: User = Depends(current_user),
                     owned_by_dashboard: bool = False):
        q = visible(db, user)
        if is_dataset and not owned_by_dashboard:
            # Скрытый набор макета принадлежит шаблону и в списке данных не нужен
            q = q.filter(model.owner_dashboard_id.is_(None))
        return [_out(o, name_field) for o in q.all()]

    @router.post("", status_code=201)
    def create_object(payload: dict = Body(...), db: Session = Depends(get_db),
                      user: User = Depends(current_user)):
        obj_id = str(payload.get("id") or "").strip()
        if not obj_id:
            raise HTTPException(status_code=422, detail="Поле «id» обязательно: идентификаторы выдаёт клиент")
        if db.get(model, obj_id) is not None:
            raise HTTPException(status_code=409, detail="Объект с таким идентификатором уже есть")
        name, body = _split(payload, name_field)
        obj = model(id=obj_id, body=body, owner_login=user.username, team=user.team or "",
                    shared=[], version=1, updated_by=user.username)
        set_name(obj, name)
        _mirror(obj, body, model)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return _out(obj, name_field)

    @router.get("/{obj_id}")
    def read_object(obj_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
        obj = _get(db, model, obj_id)
        if not can_view(user, obj):
            raise HTTPException(status_code=403, detail="Нет доступа к объекту")
        return _out(obj, name_field)

    @router.put("/{obj_id}")
    def update_object(obj_id: str, response: Response, payload: dict = Body(...),
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
        obj = _get(db, model, obj_id)
        if not can_edit(user, obj):
            raise HTTPException(status_code=403, detail=why_read_only(obj))
        _check_version(obj, payload, name_field)
        name, body = _split(payload, name_field)
        set_name(obj, name)
        obj.body = body
        _mirror(obj, body, model)
        obj.version = obj.version + 1
        obj.updated_by = user.username
        obj.updated_at = now()
        db.commit()
        db.refresh(obj)
        return _out(obj, name_field)

    @router.delete("/{obj_id}", status_code=204)
    def delete_object(obj_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
        obj = _get(db, model, obj_id)
        if not can_edit(user, obj):
            raise HTTPException(status_code=403, detail=why_read_only(obj))
        if is_dataset:
            # Таблица набора создаётся в рантайме и миграциями не управляется —
            # убрать её можно только здесь
            drop_dataset_table(obj.id)
            cache_drop(f"q:{obj.id}:")
        db.delete(obj)
        db.commit()
        return Response(status_code=204)

    @router.post("/{obj_id}/share")
    def share_object(obj_id: str, login: str = Body(..., embed=True),
                     remove: bool = Body(False, embed=True),
                     db: Session = Depends(get_db), user: User = Depends(current_user)):
        """Выдача и отзыв доступа. Соправитель может добавить соправителя — как в
        Superset; поэтому право то же, что на правку."""
        obj = _get(db, model, obj_id)
        if not can_share(user, obj):
            raise HTTPException(status_code=403, detail=why_read_only(obj))
        target = db.query(User).filter(User.username == login).one_or_none()
        if target is None and not remove:
            # Коллега может ещё ни разу не входить: тогда его ищут в каталоге
            target = _from_directory(db, login)
            if target is None:
                raise HTTPException(status_code=404, detail="Такого сотрудника нет")
        shared = list(obj.shared or [])
        if remove:
            # Отзыв не требует живой учётки: иначе доступ, выданный уволенному,
            # уже не снять
            shared = [x for x in shared if x != login]
        elif login == obj.owner_login:
            raise HTTPException(status_code=422, detail="Это владелец: доступ у него и так есть")
        elif login not in shared:
            shared.append(login)
        obj.shared = shared
        obj.updated_at = now()
        db.commit()
        db.refresh(obj)
        return _out(obj, name_field)

    return router


def _from_directory(db: Session, login: str):
    """Коллега, которого ещё нет в базе, но есть в каталоге. Без этого
    поделиться можно только с теми, кто уже входил, — а им и так видно."""
    if AUTH_TYPE != "ldap":
        return None
    info = ldap_lookup(login)
    if not info:
        return None
    u = User(username=login, password_hash="", full_name=info["name"], email=info["email"],
             team=info["team"], groups=info["groups"], role=info.get("role") or "Gamma")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _get(db: Session, model, obj_id: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Объект не найден")
    return obj


def _check_version(obj, payload: dict, name_field: str) -> None:
    """Запись принимается, только если клиент видел текущую версию. Иначе чужая
    правка пропала бы оттого, что кто-то сохранил свою позже."""
    seen: Optional[int] = payload.get("version")
    if seen is None:
        raise HTTPException(status_code=422, detail="Нужна версия объекта: без неё запись затрёт чужую правку")
    if int(seen) != int(obj.version):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "version_conflict",
                "message": "Объект изменился с тех пор, как вы его открыли",
                "current": _out(obj, name_field),
            },
        )


def _mirror(obj, body: dict, model) -> None:
    """Поля, по которым сервер ищет, дублируются в колонки. Источник правды —
    всё равно `body`: расходиться они не могут, потому что пишутся отсюда."""
    if model is Chart:
        obj.viz = str(body.get("viz") or "")
        obj.dataset_id = str(body.get("datasetId") or "")
        obj.params = body.get("params") or {}
    elif model is Dataset:
        obj.kind = str(body.get("kind") or "schema")
        obj.columns = body.get("columns") or []
        obj.metrics = body.get("metrics") or []
        obj.main_dttm = body.get("mainDttm")
        # В клиенте это поле зовётся owner и держит id шаблона-хозяина
        obj.owner_dashboard_id = body.get("owner") or None


dashboards_router = make_router(Dashboard, "/api/dashboards", "title", "dashboards")
charts_router = make_router(Chart, "/api/charts", "name", "charts")
datasets_router = make_router(Dataset, "/api/datasets", "name", "datasets")

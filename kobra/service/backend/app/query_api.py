"""Маршрут расчёта: `POST /api/datasets/{id}/query`.

Ответ той же формы, что отдаёт движок в браузере — `{rows, dims, mets,
filteredCount}`: клиент не должен знать, где считали.
"""
import hashlib
import json
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import can_view
from app.auth import current_user
from app.core import Dataset, User, engine
from app.db import get_db
from app.ingest import UPLOAD_SCHEMA, table_name
from app.query import QueryError, build_query, build_raw_query
from app.queue import cache_get, cache_set

router = APIRouter(prefix="/api/datasets", tags=["query"])


def _anchor_ms(ds_id: str, main_dttm: Optional[str]) -> Optional[int]:
    """Последняя дата в данных: от неё считаются относительные периоды."""
    if not main_dttm:
        return None
    with engine.connect() as conn:
        row = conn.execute(text(
            f'select extract(epoch from max("{main_dttm}")) * 1000 '
            f'from {UPLOAD_SCHEMA}.{table_name(ds_id)}'
        )).one_or_none()
    return int(row[0]) if row and row[0] is not None else None


@router.post("/{ds_id}/query")
def run_query(ds_id: str, spec: dict = Body(...), db: Session = Depends(get_db),
              user: User = Depends(current_user)):
    ds = db.get(Dataset, ds_id)
    if ds is None:
        raise HTTPException(status_code=404, detail="Набор не найден")
    if not can_view(user, ds):
        raise HTTPException(status_code=403, detail="Нет доступа к набору")
    body = ds.body or {}
    if (body.get("kind") or ds.kind) != "upload":
        # Наборы-схемы считаются в браузере: их строк в базе нет
        raise HTTPException(status_code=400, detail="Этот набор считается в браузере")
    if body.get("state") != "ready":
        raise HTTPException(status_code=409, detail="Набор ещё готовится")

    # Ключ кэша включает версию набора: загрузили новые строки — версия выросла,
    # и старый ответ сам перестаёт находиться. Отдельная чистка не нужна.
    key = f"q:{ds_id}:{ds.version}:{hashlib.sha1(json.dumps(spec, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}"
    hit = cache_get(key)
    if hit is not None:
        return dict(hit, cached=True)

    columns = body.get("columns") or ds.columns or []
    metrics = body.get("metrics") or []
    anchor = _anchor_ms(ds_id, ds.main_dttm)
    raw_mode = bool(spec.get("raw"))
    try:
        if raw_mode:
            query, keys = build_raw_query(ds_id, columns, spec, anchor)
            dims, mets = [], []
        else:
            query, dims, mets = build_query(ds_id, columns, metrics, spec, anchor)
    except QueryError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Читающую транзакцию закрываем сразу: открытая держит блокировку на таблице
    # набора, и следующая загрузка файла в неё встанет насмерть на DROP TABLE
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(query)
        fetched = cur.fetchall()
        raw.rollback()
    finally:
        raw.close()

    rows = []
    count = 0
    if raw_mode:
        for r in fetched:
            rows.append({k: r[i] for i, k in enumerate(keys)})
            count = r[-1]
        out = {"rows": rows, "dims": [], "mets": [], "filteredCount": int(count or 0)}
        cache_set(key, out)
        return out
    for r in fetched:
        o = {}
        for i, d in enumerate(dims):
            o[d["key"]] = r[i]
        for j, m in enumerate(mets):
            v = r[len(dims) + j]
            o[m["key"]] = float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v
        count = r[-1]
        rows.append(o)
    out = {"rows": rows, "dims": dims, "mets": mets, "filteredCount": int(count or 0)}
    cache_set(key, out)
    return out

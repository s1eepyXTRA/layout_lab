"""Маршрут расчёта: `POST /api/datasets/{id}/query`.

Ответ той же формы, что отдаёт движок в браузере — `{rows, dims, mets,
filteredCount}`: клиент не должен знать, где считали.
"""
import hashlib
import json
import logging
import os
import time
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import can_view
from app.auth import current_user
from app.core import Dataset, User, engine
from app.db import get_db
from app.ingest import UPLOAD_SCHEMA, table_exists, table_name
from app.query import QueryError, build_query, build_raw_query
from app.queue import cache_get, cache_set
from app import metrics
from app.limits import check_rate

router = APIRouter(prefix="/api/datasets", tags=["query"])
log = logging.getLogger("kobra.query")
# Порог «медленного» запроса. В секундах, а не в миллисекундах по умолчанию:
# иначе в лог попадёт каждый обычный расчёт и в нём нельзя будет ничего найти
SLOW_QUERY_MS = int(os.environ.get("KOBRA_SLOW_QUERY_MS", "2000"))


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
    # Предел на человека: базу занимает человек, а не набор. Он заметно выше
    # одновременности клиента — дашборд из двадцати блоков это нормальная работа
    check_rate("query", user.username)
    started = time.perf_counter()
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
    if not table_exists(ds_id):
        # Описание набора есть, строк нет. Это не «ещё готовится» (409):
        # возвращать нечего и ждать нечего — файл нужно загрузить заново
        raise HTTPException(status_code=404, detail="Строки набора не найдены")

    # Ключ кэша включает версию набора: загрузили новые строки — версия выросла,
    # и старый ответ сам перестаёт находиться. Отдельная чистка не нужна.
    key = f"q:{ds_id}:{ds.version}:{hashlib.sha1(json.dumps(spec, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}"
    hit = cache_get(key)
    if hit is not None:
        metrics.inc("kobra_queries_total", mode="cache")
        return dict(hit, cached=True)

    columns = body.get("columns") or ds.columns or []
    # Не `metrics`: так зовётся модуль счётчиков, и он здесь нужен
    ds_metrics = body.get("metrics") or []
    anchor = _anchor_ms(ds_id, ds.main_dttm)
    raw_mode = bool(spec.get("raw"))
    try:
        if raw_mode:
            query, keys = build_raw_query(ds_id, columns, spec, anchor)
            dims, mets = [], []
        else:
            query, dims, mets = build_query(ds_id, columns, ds_metrics, spec, anchor)
    except QueryError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Читающую транзакцию закрываем сразу: открытая держит блокировку на таблице
    # набора, и следующая загрузка файла в неё встанет насмерть на DROP TABLE
    raw = engine.raw_connection()
    query_started = time.perf_counter()
    try:
        cur = raw.cursor()
        cur.execute(query)
        fetched = cur.fetchall()
        raw.rollback()
    finally:
        raw.close()
    spent = time.perf_counter() - query_started
    metrics.inc("kobra_queries_total", mode="raw" if raw_mode else "agg")
    metrics.inc("kobra_query_seconds_total", spent)
    if spent * 1000 >= SLOW_QUERY_MS:
        # Текст запроса — да, значения фильтров — нет: они уже подставлены в
        # запрос движком, и человеку в лог они не нужны
        metrics.inc("kobra_slow_queries_total")
        log.warning("Медленный расчёт: %.1f с, набор %s, запрос: %s",
                    spent, ds_id, " ".join(str(query).split())[:2000])

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

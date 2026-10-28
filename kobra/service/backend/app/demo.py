"""Демо-наполнение: чтобы пустой сервис было на что смотреть.

Те же наборы, что встроены в браузерную Кобру, только на сервере: описание
колонок и метрик лежит в `app/demo/*.json`, строки — рядом в `*.csv.gz`.
Генерировать их на сервере нельзя: генератор живёт в `src/data.js`, и второй
его реализации быть не должно — цифры обязаны совпадать до копейки.

Наборы общие (`team = "*"`, владелец `kobra`): их видят все, правит админ.
Выключается `KOBRA_LOAD_DEMO=0` — в рабочем контуре демо обычно не нужно.
"""
import csv
import glob
import gzip
import io
import json
import os

from sqlalchemy import text

from app.core import LOAD_DEMO, Dataset, engine
from app.ingest import UPLOAD_SCHEMA, SQL_TYPE, convert, quoted, table_name

DEMO_DIR = os.path.join(os.path.dirname(__file__), "demo")
DEMO_OWNER = "kobra"
DEMO_TEAM = "*"


def load_demo(db) -> int:
    """Положить демо-наборы, если их ещё нет. Возвращает, сколько добавил."""
    if not LOAD_DEMO:
        return 0
    added = 0
    for meta_path in sorted(glob.glob(os.path.join(DEMO_DIR, "*.json"))):
        meta = json.load(io.open(meta_path, encoding="utf-8"))
        ds_id = meta.get("id")
        rows_path = meta_path[:-5] + ".csv.gz"
        if not ds_id or not os.path.exists(rows_path):
            continue
        if db.get(Dataset, ds_id) is not None:
            continue
        total = _copy_rows(ds_id, meta["columns"], rows_path)
        body = dict(meta, kind="upload", state="ready", rowCount=total)
        db.add(Dataset(
            id=ds_id, name=meta.get("name") or ds_id, kind="upload",
            columns=meta["columns"], metrics=meta.get("metrics") or [],
            main_dttm=meta.get("mainDttm"), description=meta.get("description") or "",
            body=body, owner_login=DEMO_OWNER, team=DEMO_TEAM, shared=[],
            stats={"rows": total}, version=1, updated_by=DEMO_OWNER,
        ))
        db.commit()
        added += 1
    return added


def _copy_rows(ds_id: str, columns: list, path: str) -> int:
    """Строки демо-набора в его таблицу. Читаем потоком: демо тоже бывает
    на десятки тысяч строк, и держать их в памяти незачем."""
    keys = [c["key"] for c in columns]
    kinds = {c["key"]: c["type"] for c in columns}
    table = table_name(ds_id)
    cols = ", ".join(f'{quoted(k)} {SQL_TYPE[kinds[k]]}' for k in keys)
    with engine.begin() as conn:
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {UPLOAD_SCHEMA}"))
        conn.execute(text(f"DROP TABLE IF EXISTS {UPLOAD_SCHEMA}.{table}"))
        conn.execute(text(f"CREATE TABLE {UPLOAD_SCHEMA}.{table} ({cols})"))

    total = 0
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
            reader = csv.reader(fh)
            header = next(reader)
            idx = [header.index(k) if k in header else None for k in keys]
            copy_sql = f'COPY {UPLOAD_SCHEMA}.{table} ({", ".join(quoted(k) for k in keys)}) FROM STDIN'
            with cur.copy(copy_sql) as copy:
                for row in reader:
                    copy.write_row([
                        convert(row[i] if i is not None and i < len(row) else None, kinds[k])
                        for k, i in zip(keys, idx)
                    ])
                    total += 1
        raw.commit()
    finally:
        raw.close()
    return total

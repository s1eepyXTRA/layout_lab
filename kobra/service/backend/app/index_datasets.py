"""Индексы по времени для наборов, залитых до появления этого шага.

Почему отдельной командой, а не миграцией Alembic: таблицы наборов создаются в
рантайме и намеренно спрятаны от автогенерации (`alembic/env.py`,
`include_object`) — миграция о них знать не должна, иначе однажды предложит их
удалить. Это уже случалось.

Шаг идемпотентен (`CREATE INDEX IF NOT EXISTS`): его можно запускать сколько
угодно раз, в том числе на работающем сервисе. Без `CONCURRENTLY`: индекс
блокирует запись в таблицу набора, а не чтение, и для набора, который в этот
момент не грузят, это незаметно.

    python -m app.index_datasets
"""
from app.core import SessionLocal, Dataset
from app.ingest import ensure_time_index, table_exists, table_name


def main() -> int:
    """Пройти по загруженным наборам и создать индекс там, где его нет."""
    db = SessionLocal()
    done = 0
    try:
        for ds in db.query(Dataset).filter(Dataset.kind == "upload").all():
            key = ds.main_dttm or (ds.body or {}).get("mainDttm")
            if not key or not table_exists(ds.id):
                continue
            ensure_time_index(table_name(ds.id), key)
            done += 1
            print(f"{ds.id}: индекс по «{key}» на месте")
    finally:
        db.close()
    print(f"Готово: наборов обработано — {done}")
    return done


if __name__ == "__main__":
    main()

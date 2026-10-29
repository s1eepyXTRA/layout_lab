"""Разбор загруженного файла и укладка строк в базу.

Как это устроено и почему именно так.

Файл приходит на сервер потоком и ложится во временный каталог: держать сотни
мегабайт в памяти процесса нельзя, а разбирать его в браузере — тем более.

Разбор идёт в воркере Celery. Строки не копятся в памяти: CSV читается
построчно, Excel — в режиме `read_only`, а в базу они уходят пачками через
`COPY`, самый быстрый способ залить миллион строк в Postgres.

У каждого набора **своя типизированная таблица** `kobra_uploads.ds_<id>`
(text / double precision / timestamptz). Это и есть разница между «прототип» и
«сервис»: по типизированной таблице база умеет считать агрегаты, а по мешку
JSONB — нет.
"""
import csv
import datetime as dt
import io
import os
import re
from typing import Iterator, Optional

from sqlalchemy import text

from app.core import SessionLocal, Dataset, engine
from app.guess import guess_type, parse_date_loose, parse_number_loose
from app.queue import celery_app, task_set

SAMPLE_ROWS = 300          # столько строк смотрим, чтобы угадать типы
COPY_BATCH = 10000         # пачка для COPY: больше памяти не даёт выигрыша
PROGRESS_EVERY = 25000     # как часто обновляем «сколько уже загружено»
UPLOAD_SCHEMA = "kobra_uploads"
SQL_TYPE = {"number": "double precision", "date": "timestamptz", "string": "text"}


def table_name(ds_id: str) -> str:
    """Имя таблицы набора. Идентификатор чистим: он приходит от клиента."""
    safe = re.sub(r"[^a-zA-Z0-9_]", "", ds_id)[:60]
    if not safe:
        raise ValueError("Пустой идентификатор набора")
    return f"ds_{safe}"


def col_name(key: str, i: int) -> str:
    safe = re.sub(r"_+", "_", re.sub(r"[^a-zA-Z0-9_]", "_", key or "")).strip("_").lower()[:58]
    return safe or f"c{i}"


# ---------- Чтение файла потоком ----------
def read_rows(path: str, file_name: str) -> Iterator[list]:
    """Строки файла как списки значений. Первая строка — заголовки."""
    if file_name.lower().endswith((".xlsx", ".xlsm", ".xls")):
        yield from _read_excel(path)
    else:
        yield from _read_csv(path)


def _read_csv(path: str) -> Iterator[list]:
    with open(path, "rb") as fh:
        head = fh.read(64 * 1024)
    encoding = _encoding(head)
    sample = head.decode(encoding, errors="replace")
    delimiter = _delimiter(sample)
    with io.open(path, "r", encoding=encoding, errors="replace", newline="") as fh:
        for row in csv.reader(fh, delimiter=delimiter):
            yield row


def _encoding(head: bytes) -> str:
    """UTF-8 или windows-1251 (так приходят выгрузки из 1С и Excel).

    Тонкость, на которой это уже ломалось: голова файла обрезана по размеру, и
    обрыв приходится на середину многобайтового символа. Сам по себе он не
    значит, что файл не UTF-8, — иначе большой русский CSV читается как cp1251,
    и все подписи превращаются в «Р¤РёР»РёР°Р»».
    """
    try:
        head.decode("utf-8-sig")
        return "utf-8-sig"
    except UnicodeDecodeError as e:
        if e.start >= len(head) - 4:      # оборвалось на последнем символе — это обрезка
            return "utf-8-sig"
        return "cp1251"


def _delimiter(sample: str) -> str:
    """Разделитель — тот, при котором число полей одинаково во всех строках.

    Считать запятые и точки с запятой бесполезно: «Выручка, ₽» в заголовке и
    «1000,50» в данных перевешивают настоящий разделитель. Устойчивость числа
    полей таких ошибок не делает.
    """
    lines = [l for l in sample.splitlines()[:20] if l.strip()][:10]
    if not lines:
        return ","
    best, best_score = ",", (0, 0)
    for cand in (";", ",", "\t", "|"):
        counts = [len(next(csv.reader([l], delimiter=cand))) for l in lines]
        fields = counts[0]
        stable = all(c == fields for c in counts)
        score = (fields if stable and fields > 1 else 0, fields)
        if score > best_score:
            best, best_score = cand, score
    return best


def _read_excel(path: str) -> Iterator[list]:
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb[wb.sheetnames[0]]
        for row in ws.iter_rows(values_only=True):
            yield list(row)
    finally:
        wb.close()


# ---------- Приведение значений ----------
def convert(value, kind: str):
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    if kind == "number":
        return parse_number_loose(value)
    if kind == "date":
        ms = parse_date_loose(value)
        return None if ms is None else dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    return str(value).strip()


# ---------- Задача ----------
@celery_app.task(name="kobra.ingest_file")
def ingest_file(task_id: str, ds_id: str, file_name: str, login: str,
                chosen: Optional[list] = None) -> dict:
    """Разобрать файл и залить строки. Состояние пишем по ходу: человек должен
    видеть, сколько уже готово, а не только «идёт работа»."""
    task_set(task_id, state="running", rows=0, dataset=ds_id, file=file_name)
    path = None
    try:
        # Получение файла — тоже часть задачи: если куски не доехали, человек
        # должен увидеть ошибку, а не задачу, навсегда застрявшую в «running»
        path = _fetch_file(task_id, file_name)
        result = _ingest(task_id, ds_id, path, file_name, login, chosen)
        task_set(task_id, state="done", **result)
        return result
    except Exception as e:                      # noqa: BLE001 — причину показываем человеку
        _drop_table(ds_id)
        task_set(task_id, state="error", error=str(e)[:500])
        raise
    finally:
        _forget_file(task_id)
        if path:
            try:
                os.remove(path)
            except OSError:
                pass


def _ingest(task_id: str, ds_id: str, path: str, file_name: str, login: str,
            chosen: Optional[list] = None) -> dict:
    """chosen — колонки, которые человек оставил в предпросмотре: [{idx, label, type}].
    Его выбор важнее угадывания: он видел данные и мог поправить тип."""
    rows = read_rows(path, file_name)
    try:
        header = next(rows)
    except StopIteration:
        raise ValueError("Файл пустой: не нашлось даже строки заголовков")
    labels = [str(h).strip() if h is not None else "" for h in header]
    labels = [l or f"Колонка {i + 1}" for i, l in enumerate(labels)]

    # Типы угадываем по образцу, образец потом грузим вместе с остальными
    sample: list[list] = []
    for row in rows:
        sample.append(row)
        if len(sample) >= SAMPLE_ROWS:
            break
    if not sample:
        raise ValueError("В файле нет ни одной строки данных")
    if chosen:
        picked = [c for c in chosen if 0 <= int(c.get("idx", -1)) < len(labels)]
        if not picked:
            raise ValueError("Не выбрано ни одной колонки из файла")
        order = [int(c["idx"]) for c in picked]
        labels = [str(c.get("label") or labels[int(c["idx"])]) for c in picked]
        kinds = [c.get("type") if c.get("type") in SQL_TYPE else
                 guess_type([r[int(c["idx"])] if int(c["idx"]) < len(r) else None for r in sample])
                 for c in picked]
    else:
        order = list(range(len(labels)))
        kinds = [guess_type([r[i] if i < len(r) else None for r in sample]) for i in order]
    keys = []
    used = set()
    for i, label in enumerate(labels):
        name = col_name(_translit(label), i)
        while name in used:
            name = f"{name}_{i}"
        used.add(name)
        keys.append(name)

    table = table_name(ds_id)
    _create_table(table, keys, kinds)

    total = 0
    with engine.raw_connection() as raw:
        cur = raw.cursor()
        copy_sql = f'COPY {UPLOAD_SCHEMA}.{table} ({", ".join(quoted(k) for k in keys)}) FROM STDIN'
        with cur.copy(copy_sql) as copy:
            for row in _chain(sample, rows):
                values = [convert(row[src] if src < len(row) else None, kinds[i])
                          for i, src in enumerate(order)]
                copy.write_row(values)
                total += 1
                if total % PROGRESS_EVERY == 0:
                    task_set(task_id, state="running", rows=total)
        raw.commit()

    columns = [{"key": keys[i], "label": labels[i], "type": kinds[i]} for i in range(len(keys))]
    _finish_dataset(ds_id, columns, total, file_name, login)
    return {"rows": total, "columns": columns, "dataset": ds_id}


def _fetch_file(task_id: str, file_name: str) -> str:
    """Куски файла из базы — во временный файл воркера: разборщикам (csv,
    openpyxl) нужен файл, а не поток, и это его собственный диск."""
    import tempfile
    suffix = os.path.splitext(file_name)[1] or ".csv"
    fd, path = tempfile.mkstemp(prefix="kobra_", suffix=suffix)
    got = False
    with os.fdopen(fd, "wb") as out:
        with engine.connect() as conn:
            for (chunk,) in conn.execute(text(
                f"select data from {UPLOAD_SCHEMA}.files where task_id = :t order by idx"
            ), {"t": task_id}):
                out.write(chunk)
                got = True
    if not got:
        os.remove(path)
        raise ValueError("Файл не найден: возможно, загрузка не завершилась")
    return path


def _forget_file(task_id: str) -> None:
    """Куски больше не нужны: держать копию файла в базе после разбора незачем."""
    try:
        with engine.begin() as conn:
            conn.execute(text(f"delete from {UPLOAD_SCHEMA}.files where task_id = :t"), {"t": task_id})
    except Exception:
        pass


def _chain(first, rest):
    yield from first
    yield from rest


def _translit(s: str) -> str:
    """Имя колонки в базе — латиницей: кириллические идентификаторы в SQL
    работают, но делают запросы нечитаемыми в логах и в psql."""
    table = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
        "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
        "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
        "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
        "я": "ya",
    }
    return "".join(table.get(ch, table.get(ch.lower(), ch)) if ch.lower() in table else ch
                   for ch in s.lower())


def quoted(name: str) -> str:
    """Имя колонки в кавычках. Без этого набор с колонкой `group`, `order` или
    `user` не загрузится: это зарезервированные слова SQL, а они в выгрузках
    встречаются постоянно."""
    return '"' + name.replace('"', '""') + '"'


def _create_table(table: str, keys: list, kinds: list) -> None:
    cols = ", ".join(f"{quoted(k)} {SQL_TYPE[kind]}" for k, kind in zip(keys, kinds))
    with engine.begin() as conn:
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {UPLOAD_SCHEMA}"))
        conn.execute(text(f"DROP TABLE IF EXISTS {UPLOAD_SCHEMA}.{table}"))
        conn.execute(text(f"CREATE TABLE {UPLOAD_SCHEMA}.{table} ({cols})"))


def table_exists(ds_id: str) -> bool:
    """Есть ли таблица со строками набора.

    Метаданные набора и его таблица живут по отдельности: таблица создаётся в
    рантайме и миграциями не управляется. Значит, они могут разойтись — скажем,
    базу восстановили из выгрузки без схемы загрузок. Расчёт должен сказать об
    этом понятно, а не упасть пятисоткой.
    """
    with engine.connect() as conn:
        found = conn.execute(text("select to_regclass(:name)"),
                             {"name": f"{UPLOAD_SCHEMA}.{table_name(ds_id)}"}).scalar()
    return found is not None


def drop_dataset_table(ds_id: str) -> None:
    """Набор удалили — его таблица не нужна: иначе база копит мусор, который
    никто уже не найдёт."""
    _drop_table(ds_id)


def _drop_table(ds_id: str) -> None:
    """Набор не остаётся в полуготовом виде: половина строк хуже, чем ничего."""
    try:
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {UPLOAD_SCHEMA}.{table_name(ds_id)}"))
    except Exception:
        pass


def _finish_dataset(ds_id: str, columns: list, total: int, file_name: str, login: str) -> None:
    """Набор становится готовым: колонки, счётчик строк и метрики по числовым."""
    db = SessionLocal()
    try:
        ds = db.get(Dataset, ds_id)
        if ds is None:
            return
        body = dict(ds.body or {})
        body.update({
            "kind": "upload", "columns": columns, "fileName": file_name,
            "rowCount": total, "state": "ready",
            "mainDttm": next((c["key"] for c in columns if c["type"] == "date"), None),
            "metrics": _metrics(columns),
        })
        ds.body = body
        ds.columns = columns
        ds.kind = "upload"
        ds.file_name = file_name
        ds.main_dttm = body["mainDttm"]
        ds.stats = {"rows": total}
        ds.updated_by = login
        ds.version = (ds.version or 1) + 1
        db.commit()
    finally:
        db.close()


def _metrics(columns: list) -> list:
    """Те же метрики по умолчанию, что делает клиент при загрузке файла."""
    out = [{"key": "count", "label": "Количество строк",
            "expr": {"type": "simple", "agg": "COUNT", "col": "*"}, "format": "int"}]
    for c in columns:
        if c["type"] == "number":
            out.append({"key": "sum_" + c["key"], "label": "Сумма: " + c["label"],
                        "expr": {"type": "simple", "agg": "SUM", "col": c["key"]}, "format": "smart"})
    return out

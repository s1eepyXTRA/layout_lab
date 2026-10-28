"""Расчёт по загруженному набору: тот же `QuerySpec`, но в базе.

Клиентский движок (`kobra/src/engine.js`) считает в памяти по массиву строк.
Для миллиона строк это невозможно — их туда не довезти. Поэтому для загруженных
наборов тот же самый запрос переводится в SQL и считается базой, а в браузер
едет результат: десятки строк вместо миллиона.

Повторяется **семантика**, а не код: те же агрегации, те же операции фильтров,
тот же шаг времени, те же подписи метрик и тот же вид ответа
`{rows, dims, mets, filteredCount}`. Если здесь и там разойдутся — цифры на
экране будут зависеть от того, где лежит набор, а это худший вид ошибки:
незаметный.

Наборы-схемы (макеты) сюда не попадают: их строк в базе нет вовсе, они
порождаются по `seed` в браузере и там же считаются.
"""
import datetime as dt
from typing import Any, Optional

from psycopg import sql

from app.ingest import UPLOAD_SCHEMA, table_name

# Подписи агрегаций — те же, что в движке: они попадают в заголовки колонок
AGGS = {
    "SUM": "Сумма", "AVG": "Среднее", "COUNT": "Количество", "COUNT_DISTINCT": "Уникальных",
    "MIN": "Минимум", "MAX": "Максимум", "MEDIAN": "Медиана",
}
GRAINS = {"day": "day", "week": "week", "month": "month", "quarter": "quarter", "year": "year"}
DAY_MS = 86400000


class QueryError(ValueError):
    """Запрос нельзя выполнить: нет колонки, незнакомая агрегация и подобное."""


# ---------- Вспомогательное ----------
def _col(columns: list, key: str) -> Optional[dict]:
    return next((c for c in columns if c.get("key") == key), None)


def _col_label(columns: list, key: str) -> str:
    if key == "*":
        return "Все строки"
    c = _col(columns, key)
    return (c.get("label") or c.get("key")) if c else key


def _ident(key: str) -> sql.Identifier:
    return sql.Identifier(key)


def _ms(expr: sql.Composable) -> sql.Composable:
    """Дата → UTC-миллисекунды: движок хранит время именно так."""
    return sql.SQL("(extract(epoch from ({} at time zone 'UTC')) * 1000)::bigint").format(expr)


def _trunc(key: str, grain: str) -> sql.Composable:
    """Шаг времени считаем в UTC, иначе результат зависит от часового пояса
    сервера — и те же данные дадут разные месяцы на разных машинах."""
    return sql.SQL("date_trunc({}, {} at time zone 'UTC')").format(sql.Literal(GRAINS[grain]), _ident(key))


# ---------- Метрики ----------
def metric_label(ds_metrics: list, columns: list, m: dict) -> str:
    if m.get("label"):
        return m["label"]
    if m.get("kind") == "saved":
        s = next((x for x in ds_metrics if x.get("key") == m.get("key")), None)
        return s.get("label") if s else m.get("key", "")
    if m.get("agg") == "COUNT" and m.get("col") in (None, "*"):
        return "Количество строк"
    return f'{AGGS.get(m.get("agg"), m.get("agg"))}: {_col_label(columns, m.get("col"))}'


def metric_format(ds_metrics: list, columns: list, m: dict) -> str:
    if m.get("kind") == "saved":
        s = next((x for x in ds_metrics if x.get("key") == m.get("key")), None)
        return (s or {}).get("format") or "smart"
    if m.get("agg") in ("COUNT", "COUNT_DISTINCT"):
        return "int"
    c = _col(columns, m.get("col"))
    label = (c or {}).get("label") or ""
    if "₽" in label or "руб" in label.lower():
        return "rub" if m.get("agg") == "AVG" else "rub_smart"
    return "smart"


def _agg_sql(agg: str, col: Optional[str], columns: list) -> sql.Composable:
    """Агрегация с теми же правилами, что в `makeAcc`: пустые значения не
    считаются, SUM без строк даёт 0, остальные — null."""
    if agg == "COUNT" and col in (None, "*"):
        return sql.SQL("count(*)")
    c = _col(columns, col)
    if c is None:
        raise QueryError(f"Колонка «{col}» не найдена")
    ident = _ident(col)
    is_text = c.get("type") == "string"
    not_empty = sql.SQL("{} is not null").format(ident) if not is_text else \
        sql.SQL("{0} is not null and {0} <> ''").format(ident)
    if agg == "SUM":
        return sql.SQL("coalesce(sum({}), 0)").format(ident)
    if agg == "AVG":
        return sql.SQL("avg({})").format(ident)
    if agg == "MIN":
        return sql.SQL("min({})").format(ident)
    if agg == "MAX":
        return sql.SQL("max({})").format(ident)
    if agg == "COUNT":
        return sql.SQL("count(*) filter (where {})").format(not_empty)
    if agg == "COUNT_DISTINCT":
        return sql.SQL("count(distinct {}) filter (where {})").format(ident, not_empty)
    if agg == "MEDIAN":
        return sql.SQL("percentile_cont(0.5) within group (order by {})").format(ident)
    raise QueryError(f"Неизвестная агрегация {agg}")


def _metric_sql(m: dict, ds_metrics: list, columns: list) -> sql.Composable:
    expr = None
    if m.get("kind") == "saved":
        s = next((x for x in ds_metrics if x.get("key") == m.get("key")), None)
        if not s:
            raise QueryError(f'Метрика «{m.get("key")}» не найдена в наборе')
        expr = s.get("expr") or {}
    else:
        expr = {"type": "simple", "agg": m.get("agg"), "col": m.get("col")}
    if expr.get("type") == "ratio":
        # Отношение — два аккумулятора в одном запросе, а не деление готовых
        # итогов: иначе «Маржинальность» врёт на любом уровне группировки
        num = _agg_sql(expr["num"]["agg"], expr["num"].get("col"), columns)
        den = _agg_sql(expr["den"]["agg"], expr["den"].get("col"), columns)
        mult = float(expr.get("mult") or 1)
        return sql.SQL("({} / nullif({}, 0) * {})").format(num, den, sql.Literal(mult))
    return _agg_sql(expr.get("agg"), expr.get("col"), columns)


# ---------- Период ----------
def _trunc_day_ms(ms: int) -> int:
    d = dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc)
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp() * 1000)


def resolve_time_range(val: dict, anchor_ms: Optional[int]):
    """[from, to) в миллисекундах. «Текущий» считается от последней даты в
    данных, а не от «сегодня», — как в движке: иначе демо-набор, который
    кончился в прошлом месяце, выглядит пустым."""
    preset = (val or {}).get("preset") or "all"
    if preset == "all":
        return None, None
    if preset == "custom":
        f = _iso_ms(val.get("from"))
        t = _iso_ms(val.get("to"))
        return f, (t + DAY_MS if t is not None else None)
    if anchor_ms is None:
        return None, None
    end = _trunc_day_ms(anchor_ms) + DAY_MS
    d = dt.datetime.fromtimestamp((end - DAY_MS) / 1000, tz=dt.timezone.utc)
    y, mo = d.year, d.month
    if preset == "last_7d":
        return end - 7 * DAY_MS, end
    if preset == "last_30d":
        return end - 30 * DAY_MS, end
    if preset == "last_90d":
        return end - 90 * DAY_MS, end
    if preset == "this_month":
        return _utc_ms(y, mo, 1), end
    if preset == "last_12m":
        m0 = mo - 11
        y0 = y + (m0 - 1) // 12
        m0 = (m0 - 1) % 12 + 1
        return _utc_ms(y0, m0, 1), end
    if preset == "this_year":
        return _utc_ms(y, 1, 1), end
    if preset == "last_year":
        return _utc_ms(y - 1, 1, 1), _utc_ms(y, 1, 1)
    return None, None


def _utc_ms(y: int, mo: int, d: int) -> int:
    return int(dt.datetime(y, mo, d, tzinfo=dt.timezone.utc).timestamp() * 1000)


def _iso_ms(s) -> Optional[int]:
    if not s:
        return None
    try:
        d = dt.date.fromisoformat(str(s)[:10])
    except ValueError:
        return None
    return _utc_ms(d.year, d.month, d.day)


def _ts(ms: int) -> sql.Composable:
    return sql.SQL("to_timestamp({})").format(sql.Literal(ms / 1000.0))


# ---------- Фильтры ----------
def _filter_sql(f: dict, columns: list, anchor_ms: Optional[int]) -> Optional[sql.Composable]:
    col = f.get("col")
    c = _col(columns, col)
    if c is None:
        return None          # колонки нет в наборе — фильтр к нему не относится
    ident = _ident(col)
    op = f.get("op")
    v = f.get("val")
    as_text = sql.SQL("{}::text").format(ident)

    if op in ("in", "not_in"):
        if not isinstance(v, list) or not v:
            return None
        vals = sql.Literal([str(x) for x in v])
        cmp = sql.SQL("{} = any({})").format(as_text, vals)
        return cmp if op == "in" else sql.SQL("(not ({}) or {} is null)").format(cmp, ident)
    if op in ("eq", "neq"):
        cmp = sql.SQL("{} = {}").format(as_text, sql.Literal(str(v)))
        return cmp if op == "eq" else sql.SQL("(not ({}) or {} is null)").format(cmp, ident)
    if op in ("gt", "gte", "lt", "lte"):
        sign = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
        return sql.SQL("{} {} {}").format(ident, sql.SQL(sign), sql.Literal(_num(v)))
    if op == "contains":
        q = str(v or "")
        if not q:
            return None
        return sql.SQL("{} ilike {}").format(as_text, sql.Literal(f"%{q}%"))
    if op == "is_null":
        return sql.SQL("({0} is null or {0}::text = '')").format(ident)
    if op == "not_null":
        return sql.SQL("({0} is not null and {0}::text <> '')").format(ident)
    if op == "between":
        lo, hi = (v or [None, None])[:2]
        parts = []
        if lo not in (None, ""):
            parts.append(sql.SQL("{} >= {}").format(ident, sql.Literal(_num(lo))))
        if hi not in (None, ""):
            parts.append(sql.SQL("{} <= {}").format(ident, sql.Literal(_num(hi))))
        return sql.SQL(" and ").join(parts) if parts else None
    if op == "time_range":
        lo, hi = resolve_time_range(v or {}, anchor_ms)
        parts = []
        if lo is not None:
            parts.append(sql.SQL("{} >= {}").format(ident, _ts(lo)))
        if hi is not None:
            parts.append(sql.SQL("{} < {}").format(ident, _ts(hi)))
        return sql.SQL(" and ").join(parts) if parts else None
    raise QueryError(f"Неизвестная операция фильтра {op}")


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# ---------- Сборка запроса ----------
def build_query(ds_id: str, columns: list, ds_metrics: list, spec: dict, anchor_ms: Optional[int]):
    """Возвращает (SQL, dims, mets) — описания нужны клиенту так же, как от движка."""
    table = sql.SQL("{}.{}").format(sql.Identifier(UPLOAD_SCHEMA), sql.Identifier(table_name(ds_id)))

    dims, dim_sql = [], []
    seen = {}
    for g in spec.get("groupby") or []:
        if not g or not g.get("col"):
            continue
        c = _col(columns, g["col"])
        if c is None:
            raise QueryError(f'Колонка «{g["col"]}» не найдена')
        grain = g.get("grain") if c.get("type") == "date" else None
        if grain and grain not in GRAINS:
            grain = None
        key = g["col"] + ("__" + grain if grain else "")
        if key in seen:
            seen[key] += 1
            key = f"{key}_{seen[key] - 1}"
        else:
            seen[key] = 1
        dims.append({"key": key, "col": g["col"], "grain": grain,
                     "label": c.get("label") or c.get("key"), "type": c.get("type")})
        if grain:
            dim_sql.append(_ms(_trunc(g["col"], grain)))
        elif c.get("type") == "date":
            dim_sql.append(_ms(_ident(g["col"])))
        else:
            dim_sql.append(_ident(g["col"]))

    mets, met_sql = [], []
    mseen = {}
    for m in spec.get("metrics") or []:
        if not m:
            continue
        label = metric_label(ds_metrics, columns, m)
        key = label
        if key in mseen:
            mseen[label] += 1
            key = f"{label} ({mseen[label]})"
        else:
            mseen[key] = 1
        mets.append({"key": key, "label": label, "format": metric_format(ds_metrics, columns, m)})
        met_sql.append(_metric_sql(m, ds_metrics, columns))

    where = [p for p in (_filter_sql(f, columns, anchor_ms) for f in (spec.get("filters") or [])) if p is not None]
    where_sql = sql.SQL(" where ") + sql.SQL(" and ").join(where) if where else sql.SQL("")

    selects = [sql.SQL("{} as {}").format(e, sql.Identifier(f"d{i}")) for i, e in enumerate(dim_sql)]
    selects += [sql.SQL("{} as {}").format(e, sql.Identifier(f"m{i}")) for i, e in enumerate(met_sql)]
    if not selects:
        selects = [sql.SQL("count(*) as m0")]

    group_sql = sql.SQL(" group by ") + sql.SQL(", ").join(
        sql.SQL(str(i + 1)) for i in range(len(dim_sql))) if dim_sql else sql.SQL("")

    order = []
    for o in spec.get("orderby") or []:
        alias = _alias_for(o.get("key"), dims, mets)
        if alias is None:
            continue
        order.append(sql.SQL("{} {}").format(sql.Identifier(alias),
                                             sql.SQL("desc nulls last" if o.get("desc") else "asc nulls last")))
    order_sql = sql.SQL(" order by ") + sql.SQL(", ").join(order) if order else sql.SQL("")

    limit = int(spec.get("limit") or 0)
    limit_sql = sql.SQL(" limit {}").format(sql.Literal(limit)) if limit > 0 else sql.SQL("")

    query = sql.SQL("with f as (select * from {t}{w}) select {s}, (select count(*) from f) as _cnt from f{g}{o}{l}").format(
        t=table, w=where_sql, s=sql.SQL(", ").join(selects), g=group_sql, o=order_sql, l=limit_sql)
    return query, dims, mets


def build_raw_query(ds_id: str, columns: list, spec: dict, anchor_ms: Optional[int]):
    """Исходные строки: таблица умеет показывать их как есть, без группировки.
    Колонки выбираются явно — «select *» на миллионе строк с полусотней колонок
    не нужен никому."""
    table = sql.SQL("{}.{}").format(sql.Identifier(UPLOAD_SCHEMA), sql.Identifier(table_name(ds_id)))
    keys = [k for k in (spec.get("columns") or []) if _col(columns, k)]
    if not keys:
        raise QueryError("Не выбрано ни одной колонки")
    selects = []
    for k in keys:
        c = _col(columns, k)
        expr = _ms(_ident(k)) if c.get("type") == "date" else _ident(k)
        selects.append(sql.SQL("{} as {}").format(expr, _ident(k)))
    where = [p for p in (_filter_sql(f, columns, anchor_ms) for f in (spec.get("filters") or [])) if p is not None]
    where_sql = sql.SQL(" where ") + sql.SQL(" and ").join(where) if where else sql.SQL("")
    order = spec.get("orderby") or []
    order_sql = sql.SQL("")
    if order and _col(columns, order[0].get("key")):
        order_sql = sql.SQL(" order by {} {}").format(
            _ident(order[0]["key"]),
            sql.SQL("desc nulls last" if order[0].get("desc") else "asc nulls last"))
    limit = int(spec.get("limit") or 100)
    query = sql.SQL("with f as (select * from {t}{w}) select {s}, (select count(*) from f) as _cnt from f{o} limit {l}").format(
        t=table, w=where_sql, s=sql.SQL(", ").join(selects), o=order_sql, l=sql.Literal(limit))
    return query, keys


def _alias_for(key: Any, dims: list, mets: list) -> Optional[str]:
    for i, d in enumerate(dims):
        if d["key"] == key:
            return f"d{i}"
    for i, m in enumerate(mets):
        if m["key"] == key:
            return f"m{i}"
    return None

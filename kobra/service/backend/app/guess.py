"""Угадывание типов колонок.

Перенос `parseNumberLoose` / `parseDateLoose` / `guessType` из `kobra/src/datasets.js`
один в один. Дублирование сознательное и названо в design.md: офлайн-сборка
разбирает файл в браузере и без JS-версии жить не может, а файл на сотни тысяч
строк в браузере не разобрать — значит нужна и серверная.

Правило против расхождения: правка здесь или там обязана повторяться в обоих
местах, и на это есть тест с одинаковыми значениями (`tests/test_guess.py`).
"""
import datetime as dt
import re
from typing import Any, Optional

_SPACES = re.compile(r"[  \s]")
_CURRENCY = re.compile(r"[₽$€%]|руб\.?", re.IGNORECASE)
_DOT_THOUSANDS = re.compile(r"^-?\d{1,3}(\.\d{3})+(,\d+)?$")
_COMMA_DECIMAL = re.compile(r"^-?\d+(,\d+)?$")
_COMMA_THOUSANDS = re.compile(r"^-?\d{1,3}(,\d{3})+(\.\d+)?$")
_NUMBER = re.compile(r"^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$", re.IGNORECASE)

_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?")
_DMY = re.compile(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$")
_YM = re.compile(r"^(\d{4})[./](\d{1,2})$")
_LOOKS_DATE = re.compile(r"[-./]")
_LEADING_ZERO = re.compile(r"^0\d+")

EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)


def parse_number_loose(v: Any) -> Optional[float]:
    """«1 234,50 ₽» → 1234.5. Разделители бывают разные, валюта мешает."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if v is None:
        return None
    s = _CURRENCY.sub("", _SPACES.sub("", str(v).strip()))
    if s == "":
        return None
    if _DOT_THOUSANDS.match(s):
        s = s.replace(".", "").replace(",", ".")
    elif _COMMA_DECIMAL.match(s):
        s = s.replace(",", ".")
    elif _COMMA_THOUSANDS.match(s):
        s = s.replace(",", "")
    if not _NUMBER.match(s):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_date_loose(v: Any) -> Optional[int]:
    """Дата в UTC-миллисекундах — так же, как хранит движок в браузере."""
    if isinstance(v, dt.datetime):
        return int(v.replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
    if isinstance(v, dt.date):
        return int(dt.datetime(v.year, v.month, v.day, tzinfo=dt.timezone.utc).timestamp() * 1000)
    if v is None:
        return None
    s = str(v).strip()
    m = _ISO.match(s)
    if m:
        return _utc(int(m[1]), int(m[2]), int(m[3]), m[4], m[5], m[6])
    m = _DMY.match(s)
    if m:
        return _utc(int(m[3]), int(m[2]), int(m[1]), m[4], m[5], m[6])
    m = _YM.match(s)
    if m:
        return _utc(int(m[1]), int(m[2]), 1, None, None, None)
    return None


def _utc(y: int, mo: int, d: int, hh, mm, ss) -> Optional[int]:
    try:
        moment = dt.datetime(y, mo, d, int(hh or 0), int(mm or 0), int(ss or 0), tzinfo=dt.timezone.utc)
    except ValueError:
        return None
    return int(moment.timestamp() * 1000)


def guess_type(values) -> str:
    """Тип колонки по образцу значений: 'date' | 'number' | 'string'."""
    sample = [v for v in values if v is not None and str(v).strip() != ""][:300]
    if not sample:
        return "string"
    if all(isinstance(v, (dt.date, dt.datetime))
           or (isinstance(v, str) and parse_date_loose(v) is not None and _LOOKS_DATE.search(v))
           for v in sample):
        return "date"
    if all(parse_number_loose(v) is not None for v in sample):
        # Номера с ведущими нулями — это текст (коды, артикулы)
        if any(isinstance(v, str) and _LEADING_ZERO.match(v.strip()) for v in sample):
            return "string"
        return "number"
    return "string"

"""Угадывание типов на сервере обязано совпадать с клиентским.

Значения те же, что разбирает `parseNumberLoose`/`parseDateLoose` в
`kobra/src/datasets.js`: если правила разойдутся, один и тот же файл даст разные
типы колонок в зависимости от режима, и «Выручка» станет текстом.
"""
import datetime as dt

from app.guess import guess_type, parse_date_loose, parse_number_loose


def test_chisla_s_raznymi_razdelitelyami():
    assert parse_number_loose("1 234,50") == 1234.5
    assert parse_number_loose("1.234,50") == 1234.5
    assert parse_number_loose("1,234.50") == 1234.5
    assert parse_number_loose("1234.5") == 1234.5
    assert parse_number_loose("-42") == -42
    assert parse_number_loose("12 345 ₽") == 12345
    assert parse_number_loose("7,5 %") == 7.5


def test_ne_chisla():
    assert parse_number_loose("Москва") is None
    assert parse_number_loose("") is None
    assert parse_number_loose(None) is None
    assert parse_number_loose("12-34") is None


def test_daty():
    assert parse_date_loose("2026-01-01") == 1767225600000
    assert parse_date_loose("01.01.2026") == 1767225600000
    assert parse_date_loose("2026-01-01T12:30") == 1767225600000 + 12 * 3600000 + 30 * 60000
    assert parse_date_loose("2026.03") == int(dt.datetime(2026, 3, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    assert parse_date_loose("не дата") is None
    assert parse_date_loose("32.13.2026") is None


def test_tip_kolonki():
    assert guess_type(["2026-01-01", "2026-02-01"]) == "date"
    assert guess_type(["1 000", "2 000,5"]) == "number"
    assert guess_type(["Москва", "Казань"]) == "string"
    assert guess_type([]) == "string"
    # Коды с ведущим нулём — текст, а не число: артикул 007 не равен 7
    assert guess_type(["007", "012"]) == "string"
    # Числа без разделителей датами не считаем
    assert guess_type(["20260101", "20260201"]) == "number"

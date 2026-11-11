"""Счётчики о себе и их выдача в формате Prometheus.

Зачем своим кодом, а не `prometheus_client`. Нужны счётчик и датчик — десяток
имён, две строки на каждое. Библиотека дала бы ещё гистограммы, но это ещё одна
зависимость, а в закрытом контуре каждая зависимость — отдельный разговор с
внутренним зеркалом pip. Формат текстовый и простой, и его разбирает кто угодно.

Счётчики живут в памяти процесса и теряются при перезапуске пода. Так и
задумано: систему наблюдения интересует скорость, а не всё время жизни, а сумму
по нескольким подам она складывает сама — в этом формате так и положено.

Персональных данных здесь нет вовсе: ни логинов, ни имён наборов, ни названий
шаблонов. Иначе метрики, которые отдаются без входа, стали бы выгрузкой
справочника.
"""
import threading
from typing import Callable, Dict, Optional, Tuple

_lock = threading.Lock()
# имя → {метки: значение}
_counters: Dict[str, Dict[Tuple[Tuple[str, str], ...], float]] = {}
# имя → функция, которая отдаёт значение в момент сбора
_gauges: Dict[str, Callable[[], Optional[float]]] = {}

HELP = {
    "kobra_requests_total": ("counter", "Запросы к сервису"),
    "kobra_request_seconds_total": ("counter", "Суммарное время ответа, секунды"),
    "kobra_queries_total": ("counter", "Расчёты по наборам"),
    "kobra_query_seconds_total": ("counter", "Суммарное время расчётов, секунды"),
    "kobra_slow_queries_total": ("counter", "Расчёты дольше порога"),
    "kobra_uploads_total": ("counter", "Файлы, принятые на разбор"),
    "kobra_upload_done_total": ("counter", "Файлы, разобранные успешно"),
    "kobra_upload_error_total": ("counter", "Файлы, на которых разбор упал"),
    "kobra_upload_rows_total": ("counter", "Загружено строк"),
    "kobra_rate_limited_total": ("counter", "Отказы по частоте"),
    "kobra_session_revoke_failed_total": ("counter", "Неудавшиеся отзывы сессий"),
    "kobra_db_pool_in_use": ("gauge", "Занятых соединений в пуле"),
    "kobra_db_pool_overflow": ("gauge", "Соединений взято сверх основного пула"),
    "kobra_ingest_queue": ("gauge", "Файлов в очереди разбора"),
}


def inc(name: str, value: float = 1.0, **labels) -> None:
    """Прибавить счётчику. Метки — только из своего кода, не из данных человека."""
    key = tuple(sorted((k, str(v)) for k, v in labels.items() if v is not None))
    with _lock:
        _counters.setdefault(name, {})
        _counters[name][key] = _counters[name].get(key, 0.0) + value


def gauge(name: str, fn: Callable[[], Optional[float]]) -> None:
    """Датчик считается в момент сбора: длина очереди и занятость пула живут
    не у нас, спрашивать их заранее незачем."""
    with _lock:
        _gauges[name] = fn


def reset() -> None:
    """Только для тестов: между проверками счётчики не должны протекать."""
    with _lock:
        _counters.clear()


def snapshot() -> Dict[str, Dict[Tuple[Tuple[str, str], ...], float]]:
    with _lock:
        return {n: dict(v) for n, v in _counters.items()}


def render() -> str:
    """Текст для системы наблюдения."""
    lines = []
    for name, series in sorted(snapshot().items()):
        kind, help_text = HELP.get(name, ("counter", name))
        lines.append(f"# HELP {name} {help_text}")
        lines.append(f"# TYPE {name} {kind}")
        for key, value in sorted(series.items()):
            labels = ",".join(f'{k}="{_escape(v)}"' for k, v in key)
            lines.append(f"{name}{{{labels}}} {_num(value)}" if labels else f"{name} {_num(value)}")
    with _lock:
        gauges = dict(_gauges)
    for name, fn in sorted(gauges.items()):
        try:
            value = fn()
        except Exception:                       # noqa: BLE001 — метрики не роняют сервис
            value = None
        if value is None:
            continue
        kind, help_text = HELP.get(name, ("gauge", name))
        lines.append(f"# HELP {name} {help_text}")
        lines.append(f"# TYPE {name} {kind}")
        lines.append(f"{name} {_num(value)}")
    return "\n".join(lines) + "\n"


def _num(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.6f}"


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")

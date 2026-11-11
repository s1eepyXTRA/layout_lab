"""Пределы частоты на тяжёлых маршрутах.

До этого предел стоял только на входе: расчёт, запись объектов и загрузка файлов
не были ограничены ничем, и один человек в цикле занимал базу всем. Считаем тем
же `rate_hit`, что и подбор пароля, — счётчик в Redis, общий для всех
экземпляров сервиса.

Правило «без Redis не запираемся» сохраняется и здесь: недоступный кэш не должен
останавливать работу. Отсутствие предела — это риск, остановленная работа —
гарантированный убыток.

Пределы заданы щедро. Дашборд из двадцати блоков — это двадцать расчётов за
несколько секунд, и это нормальная работа, а не злоупотребление: предел на
расчёт обязан быть заметно выше одновременности клиента (`QUERY_PARALLEL`).
"""
import os

from fastapi import HTTPException

from app import metrics
from app.sessions import rate_hit

# Область → (предел, окно в секундах)
LIMITS = {
    "query": (int(os.environ.get("KOBRA_RATE_QUERY", "600")), 60),
    "write": (int(os.environ.get("KOBRA_RATE_WRITE", "300")), 60),
    "upload": (int(os.environ.get("KOBRA_RATE_UPLOAD", "20")), 300),
}
WHAT = {
    "query": "расчётов",
    "write": "сохранений",
    "upload": "загрузок файлов",
}


def check_rate(scope: str, who: str) -> None:
    """Отказать, если человек превысил предел. Иначе ничего не делать."""
    limit, window = LIMITS.get(scope, (0, 60))
    if not limit or not who:
        return
    wait = rate_hit(scope, who, limit, window)
    if wait is None:
        return
    metrics.inc("kobra_rate_limited_total", scope=scope)
    raise HTTPException(
        status_code=429,
        detail=f"Слишком много {WHAT.get(scope, 'запросов')} подряд, повторите через {wait} с",
    )

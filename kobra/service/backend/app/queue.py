"""Очередь задач и состояние их выполнения.

Celery с брокером Redis. В очередь уходит то, что не укладывается в запрос:
разбор файла на сотни тысяч строк — минуты, и держать на нём HTTP-соединение
нельзя, иначе человек не может ни уйти со страницы, ни закрыть вкладку.

Состояние задачи мы ведём сами, в Redis, а не читаем из Celery: нам нужно не
«успешно/нет», а «сколько строк уже загружено» и понятная причина отказа.
Сервис обязан подниматься при недоступном Redis — тогда очередь честно
отвечает, что фоновая работа сейчас недоступна, а всё остальное работает.
"""
import json
import os
import time
from typing import Optional

from celery import Celery
import redis as redis_lib

REDIS_URL = os.environ.get("KOBRA_REDIS_URL", "redis://localhost:6379/0")
TASK_TTL_SEC = int(os.environ.get("KOBRA_TASK_TTL_SEC", str(24 * 3600)))

celery_app = Celery("kobra", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(
    task_serializer="json", result_serializer="json", accept_content=["json"],
    timezone="UTC", enable_utc=True,
    # Задача берётся из очереди по одной: разбор файла упирается в диск и базу,
    # десяток параллельных разборов только мешают друг другу
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)

_redis: Optional[redis_lib.Redis] = None


def redis_conn() -> redis_lib.Redis:
    global _redis
    if _redis is None:
        _redis = redis_lib.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=5,
                                    decode_responses=True)
    return _redis


def redis_ok() -> bool:
    """Доступен ли Redis прямо сейчас. Готовность сервиса от этого не зависит."""
    try:
        return bool(redis_conn().ping())
    except Exception:
        return False


class QueueUnavailable(RuntimeError):
    """Фоновая работа невозможна: Redis недоступен."""


# ---------- Кэш ----------
CACHE_TTL_SEC = int(os.environ.get("KOBRA_CACHE_TTL_SEC", "300"))


def cache_get(key: str):
    """Из кэша или None. Недоступный Redis — это промах, а не отказ: сервис
    обязан работать и без него, просто медленнее."""
    try:
        raw = redis_conn().get("kobra:cache:" + key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def cache_set(key: str, value) -> None:
    try:
        redis_conn().set("kobra:cache:" + key, json.dumps(value, ensure_ascii=False, default=str),
                         ex=CACHE_TTL_SEC)
    except Exception:
        pass


def cache_drop(prefix: str) -> None:
    """Выбросить всё по набору. Версия набора в ключе спасает от устаревших
    ответов при правке, но не при удалении: набор можно создать заново с тем же
    идентификатором (так делает импорт файла), и версия снова станет первой."""
    try:
        r = redis_conn()
        for key in r.scan_iter(match="kobra:cache:" + prefix + "*", count=500):
            r.delete(key)
    except Exception:
        pass


# ---------- Состояние задачи ----------
def _key(task_id: str) -> str:
    return f"kobra:task:{task_id}"


def task_set(task_id: str, **fields) -> None:
    """Состояние задачи пишем целиком: его читают и воркер, и API, и человек."""
    try:
        r = redis_conn()
        cur = task_get(task_id) or {}
        cur.update(fields)
        cur["at"] = int(time.time())
        r.set(_key(task_id), json.dumps(cur, ensure_ascii=False), ex=TASK_TTL_SEC)
    except Exception:
        # Состояние — не данные: его потеря не должна ронять разбор
        pass


def task_get(task_id: str) -> Optional[dict]:
    try:
        raw = redis_conn().get(_key(task_id))
        return json.loads(raw) if raw else None
    except Exception:
        return None

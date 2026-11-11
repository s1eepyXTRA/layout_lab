"""Отзыв сессий и ограничение частоты.

JWT сам по себе не отзывается: он подписан и живёт до срока. Но отзыв нам нужен
— человек вышел, сотрудника отключили, — поэтому срок делаем коротким, а
отозванные держим списком в Redis до их истечения.

Про Redis здесь одно правило: **без него сервис работает**. Отзыв становится
невозможен (о чём говорим честно), ограничение частоты перестаёт считаться. Если
бы они падали вместе с Redis, он стал бы точкой отказа надёжнее базы.
"""
import logging
import os
import time
from typing import Optional

from app import metrics
from app.queue import redis_conn

log = logging.getLogger("kobra.sessions")

RATE_LOGIN_LIMIT = int(os.environ.get("KOBRA_RATE_LIMIT_LOGIN", "10"))
RATE_LOGIN_WINDOW = int(os.environ.get("KOBRA_RATE_LIMIT_WINDOW_SEC", "60"))


# ---------- Отозванные сессии ----------
def revoke(jti: str, ttl_sec: int) -> bool:
    """Отозвать сессию. Храним до её же истечения: дальше токен не примут и так."""
    if not jti:
        return False
    try:
        redis_conn().set("kobra:revoked:" + jti, "1", ex=max(ttl_sec, 1))
        return True
    except Exception as e:                      # noqa: BLE001
        _revoke_failed("сессию", e)
        return False


def is_revoked(jti: str) -> bool:
    if not jti:
        return False
    try:
        return bool(redis_conn().exists("kobra:revoked:" + jti))
    except Exception:
        # Redis лежит — проверить нечем. Пускаем: иначе недоступный кэш
        # выбрасывает из приложения всех разом
        return False


def revoke_user(user_id: int, ttl_sec: int) -> bool:
    """Отозвать все сессии сотрудника: токены, выданные раньше этой отметки,
    перестают приниматься. Нужно, когда человека отключают."""
    try:
        redis_conn().set(f"kobra:revoked-user:{user_id}", str(int(time.time())), ex=max(ttl_sec, 1))
        return True
    except Exception as e:                      # noqa: BLE001
        _revoke_failed("все сессии сотрудника", e)
        return False


def _revoke_failed(what: str, e: Exception) -> None:
    """Неудавшийся отзыв не должен быть молчаливым.

    Вызывающему мы и так отвечаем «не удалось», но это видит один человек в
    одном окне. А означает это, что отозванная сессия продолжает работать —
    то есть вопрос доступа, а не удобства. Поэтому ещё и предупреждение в лог,
    и метрика, по которой это заметят без жалобы.
    """
    metrics.inc("kobra_session_revoke_failed_total")
    log.warning("Не удалось отозвать %s: %s. Отозванная сессия продолжает работать", what, e)


def user_revoked_at(user_id: int) -> Optional[int]:
    try:
        v = redis_conn().get(f"kobra:revoked-user:{user_id}")
        return int(v) if v else None
    except Exception:
        return None


# ---------- Частота ----------
def rate_hit(scope: str, who: str, limit: Optional[int] = None,
             window: Optional[int] = None) -> Optional[int]:
    """Счётчик обращений. Возвращает, через сколько секунд можно повторить, если
    предел превышен, иначе None. Счёт общий для всех экземпляров сервиса —
    считать в памяти процесса при двух подах бессмысленно.

    Пределы читаются внутри, а не стоят умолчаниями параметров: умолчание
    вычисляется один раз при объявлении, и настройка перестаёт действовать."""
    limit = RATE_LOGIN_LIMIT if limit is None else limit
    window = RATE_LOGIN_WINDOW if window is None else window
    key = f"kobra:rate:{scope}:{who}"
    try:
        r = redis_conn()
        n = r.incr(key)
        if n == 1:
            r.expire(key, window)
        if n > limit:
            return max(r.ttl(key), 1)
        return None
    except Exception:
        # Без Redis не ограничиваем: иначе его недоступность запирает вход всем
        return None

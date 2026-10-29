"""Отзыв сессий и ограничение частоты.

JWT сам по себе не отзывается: он подписан и живёт до срока. Но отзыв нам нужен
— человек вышел, сотрудника отключили, — поэтому срок делаем коротким, а
отозванные держим списком в Redis до их истечения.

Про Redis здесь одно правило: **без него сервис работает**. Отзыв становится
невозможен (о чём говорим честно), ограничение частоты перестаёт считаться. Если
бы они падали вместе с Redis, он стал бы точкой отказа надёжнее базы.
"""
import os
import time
from typing import Optional

from app.queue import redis_conn

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
    except Exception:
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
    except Exception:
        return False


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

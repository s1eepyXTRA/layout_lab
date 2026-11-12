"""Индекс по названию объектов: поиск считает сервер

Роль, видящая чужую работу, ищет свой шаблон среди всех. Поиск идёт подстрокой
в нижнем регистре, и обычный btree такому запросу не помогает — помогает
триграммный GIN из `pg_trgm`.

Расширение ставится только суперпользователем, а в закрытом контуре учётка
сервиса им обычно не является. Поэтому миграция пробует поставить расширение в
точке сохранения: получилось — триграммный индекс, не получилось — btree по
`lower(название)`. Второй вариант ускоряет сортировку и поиск по началу
названия, а подстрока пойдёт перебором: на тысячах объектов это терпимо, и это
лучше, чем миграция, которая не катится.

Revision ID: b7c1d2e3f4a5
Revises: a1b2c3d4e5f6
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c1d2e3f4a5"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

# Таблица и колонка с названием: у шаблона это title, у остальных name
TABLES = (
    ("kobra_dashboards", "title"),
    ("kobra_charts", "name"),
    ("kobra_datasets", "name"),
)


def _have_trgm(conn) -> bool:
    """Поставить pg_trgm, если дают. Пробуем в точке сохранения: без неё
    отказ оборвал бы всю транзакцию миграции."""
    try:
        with conn.begin_nested():
            conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        return True
    except Exception as e:                      # нет прав или нет расширения
        log.warning("pg_trgm недоступен (%s): поиск по подстроке пойдёт без индекса", e)
        return False


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    trgm = _have_trgm(conn)
    for table, col in TABLES:
        if trgm:
            op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_{col}_trgm "
                       f"ON {table} USING gin (lower({col}) gin_trgm_ops)")
        else:
            op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_{col}_lower "
                       f"ON {table} (lower({col}))")


def downgrade() -> None:
    """Downgrade schema."""
    # Какой из двух создался, зависело от прав на расширение — убираем оба
    for table, col in TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_{col}_trgm")
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_{col}_lower")

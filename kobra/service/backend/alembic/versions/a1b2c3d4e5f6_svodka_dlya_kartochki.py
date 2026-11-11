"""Сводка содержимого для карточки в списке

Список объектов отдавал тела целиком, и человек при входе скачивал всю видимую
ему работу. Карточке нужна сводка: сколько вкладок и блоков, раскладка первого
уровня для миниатюры, заполненность ТЗ у графика. Считается при записи —
считать при каждом чтении списка значит снова читать тела.

Существующие объекты пересчитываются здесь же, одним проходом: без этого
карточки остались бы без миниатюр до первой правки.

Revision ID: a1b2c3d4e5f6
Revises: 769c36f0b143
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "769c36f0b143"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

THUMB_TILES = 14


def upgrade() -> None:
    """Upgrade schema."""
    for table in ("kobra_dashboards", "kobra_charts"):
        op.add_column(table, sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()),
                                       nullable=True))
    _backfill()


def downgrade() -> None:
    """Downgrade schema."""
    for table in ("kobra_dashboards", "kobra_charts"):
        op.drop_column(table, "summary")


def _backfill() -> None:
    """Пересчёт сводки по уже лежащим телам.

    Считаем здесь, а не вызовом кода приложения: миграция должна работать на
    любой версии кода, в том числе через год, когда правила сводки изменятся.
    Устаревшая сводка перепишется при первой правке объекта.
    """
    conn = op.get_bind()
    for dash_id, body in conn.execute(sa.text("select id, body from kobra_dashboards")):
        tabs = (body or {}).get("tabs") or []
        items = (tabs[0].get("items") if tabs and isinstance(tabs[0], dict) else []) or []
        charts = sum(1 for t in tabs if isinstance(t, dict)
                     for i in (t.get("items") or []) if (i or {}).get("type") == "chart")
        summary = {
            "tabs": len(tabs),
            "charts": charts,
            "chartIds": sorted({i["chartId"] for t in tabs if isinstance(t, dict)
                                for i in (t.get("items") or [])
                                if isinstance(i, dict) and i.get("chartId")}),
            "thumb": [{"x": i.get("x", 0), "y": i.get("y", 0), "w": i.get("w", 1),
                       "h": i.get("h", 1), "type": i.get("type"), "chartId": i.get("chartId")}
                      for i in items[:THUMB_TILES] if isinstance(i, dict)],
        }
        conn.execute(sa.text("update kobra_dashboards set summary = cast(:s as jsonb) where id = :i"),
                     {"s": json.dumps(summary), "i": dash_id})
    for chart_id, body in conn.execute(sa.text("select id, body from kobra_charts")):
        spec = (body or {}).get("spec") or {}
        summary = {"spec": sum(1 for v in spec.values() if v),
                   "question": str(spec.get("question") or "")[:300] or None}
        conn.execute(sa.text("update kobra_charts set summary = cast(:s as jsonb) where id = :i"),
                     {"s": json.dumps(summary), "i": chart_id})

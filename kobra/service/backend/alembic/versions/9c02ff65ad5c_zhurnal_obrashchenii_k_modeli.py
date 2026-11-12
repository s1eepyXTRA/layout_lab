"""Журнал обращений к модели

Обращение к модели идёт через сервис, а не из браузера, и каждое обращение
остаётся в журнале: кто, когда, какая модель, сколько токенов и чем кончилось —
и чем кончилось **для человека** (собрался шаблон или нет, сколько блоков
пропущено). Последнее дописывает клиент: сервер этого знать не может, а
«HTTP 200, 1400 токенов» ничего не говорит о пользе.

Тексты запроса и ответа хранятся, только если включён `KOBRA_AI_LOG_TEXT`:
шлюз обычно пишет их сам, и чужие тексты не нужны в двух местах. Расход и итог
пишутся всегда.

Индексы по человеку и времени: журнал читают разбивкой по людям, а записи
старше `KOBRA_AI_LOG_DAYS` удаляются тем же запросом, который пишет новую.

Revision ID: 9c02ff65ad5c
Revises: b7c1d2e3f4a5
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c02ff65ad5c'
down_revision: Union[str, Sequence[str], None] = 'b7c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('kobra_ai_log',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('login', sa.String(length=120), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('model', sa.String(length=200), nullable=True),
    sa.Column('tokens_in', sa.Integer(), nullable=True),
    sa.Column('tokens_out', sa.Integer(), nullable=True),
    sa.Column('outcome', sa.String(length=40), nullable=True),
    sa.Column('built', sa.String(length=20), nullable=True),
    sa.Column('skipped', sa.Integer(), nullable=True),
    sa.Column('task', sa.Text(), nullable=True),
    sa.Column('answer', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_kobra_ai_log_created_at'), 'kobra_ai_log', ['created_at'], unique=False)
    op.create_index(op.f('ix_kobra_ai_log_login'), 'kobra_ai_log', ['login'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_kobra_ai_log_login'), table_name='kobra_ai_log')
    op.drop_index(op.f('ix_kobra_ai_log_created_at'), table_name='kobra_ai_log')
    op.drop_table('kobra_ai_log')

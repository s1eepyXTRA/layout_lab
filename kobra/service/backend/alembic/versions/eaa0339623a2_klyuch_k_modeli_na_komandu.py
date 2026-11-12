"""Ключ к модели на команду

Один служебный ключ на сервис не делится между командами: команда, собравшая
двести черновиков, тратит деньги остальных, а отобрать ключ значит отобрать его
у всех. В самом шлюзе виртуальные ключи с бюджетом выдают по командам — Кобра
принимает их на том же уровне.

Ключ лежит зашифрованным (Fernet от KOBRA_SECRET_KEY, как строки подключения) и
наружу не отдаётся никому. Пока ключей по командам нет, всё работает на
KOBRA_AI_TOKEN, как до изменения.

В журнал добавляются команда и вид ключа: без них «расход команды» не сходится с
тем, что показывает шлюз, а отсутствие своего ключа у команды незаметно.

Revision ID: eaa0339623a2
Revises: 9c02ff65ad5c
Create Date: 2026-11-12 15:40:35.570775

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eaa0339623a2'
down_revision: Union[str, Sequence[str], None] = '9c02ff65ad5c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('kobra_ai_keys',
    sa.Column('team', sa.String(length=200), nullable=False),
    sa.Column('token_enc', sa.Text(), nullable=False),
    sa.Column('model', sa.String(length=200), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_by', sa.String(length=120), nullable=True),
    sa.PrimaryKeyConstraint('team')
    )
    op.add_column('kobra_ai_log', sa.Column('team', sa.String(length=200), nullable=True))
    op.add_column('kobra_ai_log', sa.Column('key_kind', sa.String(length=20), nullable=True))
    op.create_index(op.f('ix_kobra_ai_log_team'), 'kobra_ai_log', ['team'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_kobra_ai_log_team'), table_name='kobra_ai_log')
    op.drop_column('kobra_ai_log', 'key_kind')
    op.drop_column('kobra_ai_log', 'team')
    op.drop_table('kobra_ai_keys')

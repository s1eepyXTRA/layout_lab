"""Сессия базы как зависимость FastAPI."""
from app.core import SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

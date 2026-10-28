"""Кобра: точка входа веб-сервиса.

Запуск для разработки:

    uvicorn app.main:app --reload --port 8000

Две пробы, и они отвечают на разные вопросы. `/healthz` — процесс жив, его не
надо перезапускать. `/readyz` — сервис готов принимать запросы: без базы он
работать не может, поэтому проверяет её. Путать их нельзя: если проба жизни
начнёт ходить в базу, то короткая недоступность базы превратится в перезапуск
всех экземпляров сервиса, а это ровно то, что не нужно.
"""
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.auth import router as auth_router
from app.users import router as users_router
from app.core import engine

app = FastAPI(title="Кобра", docs_url="/api/docs", openapi_url="/api/openapi.json")


app.include_router(auth_router)
app.include_router(users_router)


@app.get("/healthz")
def healthz():
    """Процесс жив. Намеренно ничего не проверяет."""
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    """Готовность принимать запросы: проверяем базу."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        # Текст ошибки нужен человеку, который смотрит в под: без него
        # «не готов» означает только «что-то не так»
        return JSONResponse({"status": "not_ready", "database": str(e)[:300]}, status_code=503)
    return {"status": "ready", "database": "ok"}

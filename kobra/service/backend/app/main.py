"""Кобра: точка входа веб-сервиса.

Запуск для разработки:

    uvicorn app.main:app --reload --port 8000

Две пробы, и они отвечают на разные вопросы. `/healthz` — процесс жив, его не
надо перезапускать. `/readyz` — сервис готов принимать запросы: без базы он
работать не может, поэтому проверяет её. Путать их нельзя: если проба жизни
начнёт ходить в базу, то короткая недоступность базы превратится в перезапуск
всех экземпляров сервиса, а это ровно то, что не нужно.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.auth import AUTH_TYPE, ensure_admin
from app.demo import load_demo
from app.auth import router as auth_router
from app.objects import charts_router, dashboards_router, datasets_router
from app.query_api import router as query_router
from app.users import router as users_router
from app.core import FRONTEND_DIR, SessionLocal, engine
from app.settings import router as settings_router
from app.upload import router as upload_router

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Старт сервиса: первый админ и демо-наполнение. Оба шага идемпотентны —
    при перезапуске и при нескольких экземплярах ничего не задвоится."""
    db = SessionLocal()
    try:
        ensure_admin(db)
        n = load_demo(db)
        if n:
            print(f"Демо-наборы загружены: {n}")
    except Exception as e:                      # noqa: BLE001
        # Без базы сервис всё равно поднимется и честно скажет об этом в /readyz
        print(f"ВНИМАНИЕ: подготовка при старте не удалась: {e}")
    finally:
        db.close()
    yield


app = FastAPI(title="Кобра", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(dashboards_router)
app.include_router(charts_router)
app.include_router(query_router)
app.include_router(datasets_router)
app.include_router(settings_router)
app.include_router(upload_router)


@app.get("/api/ping")
def ping():
    """По этому ответу клиент понимает, что за страницей стоит сервис, и
    переключается на серверное хранилище. Без входа: отвечать «кто ты» ещё
    некому, а решение о режиме нужно до экрана входа."""
    return {"kobra": 1, "mode": "server", "auth": AUTH_TYPE}


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


# Интерфейс отдаёт тот же процесс, что и API: отдельный веб-сервер под один
# файл — лишняя единица развёртывания и вечный вопрос, совпали ли версии.
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

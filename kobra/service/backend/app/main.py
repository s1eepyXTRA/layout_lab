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
import time
from contextlib import asynccontextmanager

import anyio.to_thread

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.auth import AUTH_TYPE, ensure_admin
from app.demo import load_demo
from app.ai import router as ai_router
from app.auth import router as auth_router
from app.objects import charts_router, dashboards_router, datasets_router
from app.query_api import router as query_router
from app.users import router as users_router
from app import metrics
from app.queue import metrics_read, queue_len
from app.core import (AI_MAX_CHARS, FRONTEND_DIR, MAX_UPLOAD_ROWS, THREADPOOL, SessionLocal,
                      ai_configured, engine)
from app.settings import router as settings_router
from app.upload import MAX_FILE_MB, router as upload_router

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Старт сервиса: первый админ и демо-наполнение. Оба шага идемпотентны —
    при перезапуске и при нескольких экземплярах ничего не задвоится."""
    # Пул потоков под синхронные маршруты: по умолчанию его 40, а соединений к
    # базе 30 — десять потоков ждали бы очередь к пулу, а не базу. Менять его
    # можно только внутри цикла событий, то есть здесь.
    anyio.to_thread.current_default_thread_limiter().total_tokens = THREADPOOL
    # Датчики спрашиваются в момент сбора: занятость пула и длина очереди живут
    # не у нас, и заранее их знать незачем
    pool = engine.pool
    metrics.gauge("kobra_db_pool_in_use", pool.checkedout)
    # overflow() — сколько соединений взято сверх pool_size: по нему видно, что
    # пул на пределе, задолго до того, как запросы начнут ждать. Ниже pool_size
    # он отрицательный (внутренний счётчик начинается с -pool_size), и «минус
    # восемь ожидающих» в метрике сбивало бы с толку
    metrics.gauge("kobra_db_pool_overflow", lambda: max(0, pool.overflow()))
    metrics.gauge("kobra_ingest_queue", queue_len)
    # Эти три растит воркер — другой процесс, и его память нам не видна:
    # он кладёт их в Redis, мы читаем в момент сбора
    metrics.gauge("kobra_upload_done_total", lambda: metrics_read("uploads_done"))
    metrics.gauge("kobra_upload_error_total", lambda: metrics_read("uploads_error"))
    metrics.gauge("kobra_upload_rows_total", lambda: metrics_read("upload_rows"))
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


@app.middleware("http")
async def measure(request: Request, call_next):
    """Сколько запросов и сколько времени — по маршрутам.

    Считаем шаблон маршрута (`/api/charts/{obj_id}`), а не путь: иначе каждый
    идентификатор стал бы отдельной метрикой, а в их именах оказались бы чужие
    данные. Сам маршрут известен только после обработки — до неё его ещё не
    сопоставили.
    """
    started = time.perf_counter()
    response = await call_next(request)
    route = request.scope.get("route")
    path = getattr(route, "path", None) or "прочее"
    metrics.inc("kobra_requests_total", route=path, method=request.method,
                status=response.status_code // 100 * 100)
    metrics.inc("kobra_request_seconds_total", time.perf_counter() - started, route=path)
    return response


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(dashboards_router)
app.include_router(charts_router)
app.include_router(query_router)
app.include_router(datasets_router)
app.include_router(settings_router)
app.include_router(upload_router)
app.include_router(ai_router)


@app.get("/api/ping")
def ping():
    """По этому ответу клиент понимает, что за страницей стоит сервис, и
    переключается на серверное хранилище. Без входа: отвечать «кто ты» ещё
    некому, а решение о режиме нужно до экрана входа.

    Пределы загрузки здесь же: их применяет сервис, значит он и должен их
    называть — иначе клиент предупреждает человека своими числами, которые к
    серверу отношения не имеют.

    Про модель сказано только «настроена или нет»: ни адреса шлюза, ни названия
    модели. Экрану входа они не нужны, а светить внутреннюю инфраструктуру без
    сессии незачем."""
    return {"kobra": 1, "mode": "server", "auth": AUTH_TYPE,
            "maxRows": MAX_UPLOAD_ROWS, "maxFileMb": MAX_FILE_MB,
            "ai": ai_configured(), "aiMaxChars": AI_MAX_CHARS}


@app.get("/metrics", response_class=PlainTextResponse)
def prometheus_metrics():
    """Метрики для системы наблюдения.

    Без входа: система наблюдения не ходит с человеческой сессией. Поэтому
    здесь нет ни логинов, ни названий шаблонов и наборов — только числа и
    шаблоны маршрутов. Пределы доступа к этому адресу ставит сеть кластера, как
    и для `/healthz`.
    """
    return metrics.render()


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

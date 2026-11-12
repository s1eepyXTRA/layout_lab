"""Обращение к модели: сборка черновика шаблона по описанию.

До этого к модели ходил сам браузер: адрес шлюза, модель и токен лежали в
`localStorage` у каждого человека. Для прототипа это нормально, для сервиса на
несколько команд — нет: токен добывает каждый сам, корпоративный шлюз запрос со
страницы обычно не пропустит (и человек увидит неотличимую «сетевую ошибку»), а
расход никто не считает.

**Маршрут нарочно узкий.** `POST /api/ai/draft` принимает задачу, колонки и
версию формата; текст запроса к модели собирает сам. Принимать готовый массив
`messages` было бы дешевле (промпт в одном месте), но тогда сервис становится
универсальным прокси к модели: любой, у кого есть сессия, тратит служебный ключ
компании на что угодно. Узкий маршрут держит потолок злоупотребления на уровне
«кто-то жжёт квоту, рисуя ненужные шаблоны» — и ровно поэтому единый служебный
ключ тут уместен. Ослабишь маршрут — придётся менять и способ оплаты.

**Промпт продублирован** в `src/aidraft.js`: офлайн-сборке обращаться больше
некуда, и копий всё равно две при любом решении. Поэтому — прямое дублирование с
тестом на совпадение, как `app/guess.py` против `datasets.js`.

**Маршрут асинхронный, а запись в журнал — через пул потоков.** uvicorn запущен
одним процессом, сессия SQLAlchemy синхронная, и обычный `commit` внутри
`async def` встал бы прямо в цикле событий: на время запроса к базе ждали бы все
остальные запросы, включая чужие расчёты. Синхронные маршруты защищены пулом
автоматически, асинхронный — нет.
"""
import datetime as dt
import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import case, delete, func, select

from app import metrics
from app.auth import current_user
from app.core import (
    AI_LIMIT_ALL, AI_LIMIT_USER, AI_LOG_DAYS, AI_LOG_TEXT, AI_MAX_CHARS, AI_MAX_COLS,
    AI_MODEL, AI_ROLES, AI_TIMEOUT_SEC, AI_TOKEN, AI_URL, AiLog, SessionLocal, User,
    ai_configured, now,
)
from app.sessions import rate_hit

router = APIRouter(prefix="/api/ai", tags=["ai"])
log = logging.getLogger("kobra.ai")

# Версия формата ответа. Клиент живёт в чужом браузере из кэша неделями, и
# старый разбор не должен молча встретить новый промпт: неизвестная версия —
# внятный отказ «обновите страницу», а не мусор в разборе.
AI_FORMAT = 1

# Системный промпт. Копия в `src/aidraft.js` (AI_TPL_SYSTEM) — совпадение
# проверяет tests/test_ai_prompt.py.
AI_SYSTEM = "\n".join([
    "Ты собираешь шаблон дашборда в конструкторе «Кобра». Отвечай только JSON, без пояснений вокруг.",
    'Формат: {"ответ": "...", "название": "...", "колонки": [...], "блоки": [...]}.',
    'Колонка: {"подпись": "Дата заявки", "тип": "date|string|number", "значения": ["..."], "от": 1, "до": 100}.',
    'Блок: {"вкладка": "Сводка", "вид": "line|bar|pie|area|table|treemap|heatmap|funnel|pivot|big_number_trend",'
    ' "название": "...", "показатель": "сумма: Сумма, ₽", "разрез": "Статус", "шаг": "месяц", "размер": "треть", "зачем": "..."}.',
    "Показатель пиши как «агрегация: подпись колонки» либо «количество строк». Разрез — подпись колонки из «колонки».",
    "Строки данных не придумывай: их сгенерирует Кобра по описанию колонок.",
    'Пример ответа: {"ответ":"Собрал сводку по заявкам.","название":"Заявки",'
    '"колонки":[{"подпись":"Дата заявки","тип":"date"},{"подпись":"Статус","тип":"string","значения":["Новая","В работе","Закрыта"]}],'
    '"блоки":[{"вкладка":"Сводка","вид":"big_number_trend","название":"Заявок за месяц","показатель":"количество строк","разрез":"Дата заявки","размер":"треть"},'
    '{"вкладка":"Сводка","вид":"bar","название":"Заявки по статусам","показатель":"количество строк","разрез":"Статус","размер":"половина"}]}',
])

# Поля, которых в запросе быть не должно: это попытка прислать готовый текст для
# модели вместо описания задачи, то есть обойти узость маршрута
RAW_FIELDS = ("messages", "prompt", "system", "промпт", "системный", "сообщения")


def build_user_message(task: str, draft: Optional[dict] = None,
                       errors: Optional[list] = None) -> str:
    """Запрос к модели из частей. Повторяет `aiTplPrompt` в `src/aidraft.js`:
    текст собирает сервер, потому что клиент не должен уметь прислать свой."""
    parts = [f"Задача: {str(task or '').strip()}"]
    if draft:
        import json
        parts.append("=== ЧТО УЖЕ СОБРАНО ===\n"
                     + json.dumps(draft, ensure_ascii=False, indent=1) + "\n=== КОНЕЦ ===")
    if errors:
        beda = "\n".join(f"- {e.get('название') or e.get('name') or 'Блок'}: "
                         f"{e.get('ошибка') or e.get('error') or ''}" for e in errors)
        parts.append("=== ЧТО НЕ ПОСТРОИЛОСЬ ===\n" + beda
                     + "\nИсправь эти блоки: смени вид, показатель или разрез.\n=== КОНЕЦ ===")
    return "\n\n".join(parts)


def _allowed(user: User) -> bool:
    """Роли, которым разрешено тратить служебный ключ. Пусто — всем вошедшим:
    поведение меняется только когда администратор сузит доступ сам."""
    return not AI_ROLES or user.role in AI_ROLES


def _check_limits(login: str) -> None:
    """Предел на человека и на сервис целиком. Это защита от цикла, а не
    бюджет: потолок расхода ставится виртуальным ключом в самом шлюзе, там, где
    деньги. Без Redis не ограничиваем — как и на входе."""
    wait = rate_hit("ai", login, AI_LIMIT_USER, 3600)
    if wait is not None:
        metrics.inc("kobra_ai_requests_total", outcome="limit_user")
        raise HTTPException(status_code=429, detail=f"Вы просили сборку слишком часто, повторите через {wait // 60 + 1} мин")
    wait = rate_hit("ai_all", "*", AI_LIMIT_ALL, 3600)
    if wait is not None:
        metrics.inc("kobra_ai_requests_total", outcome="limit_all")
        raise HTTPException(status_code=429, detail=f"Сервис исчерпал предел обращений к модели, повторите через {wait // 60 + 1} мин")


def _write_log(login: str, outcome: str, task: str, answer: str,
               tokens: tuple = (0, 0)) -> Optional[int]:
    """Запись в журнал и чистка старых — одним заходом в базу.

    Срок хранения соблюдается тем же запросом, что пишет новую запись:
    планировщика (Celery beat) в проекте нет, и ради одного `DELETE` заводить
    компонент в compose и в чарте значит отвечать на вопрос «а он живой».
    Удаление при записи не точно по времени, зато не может перестать работать
    незаметно.
    """
    s = SessionLocal()
    try:
        row = AiLog(
            login=login, model=AI_MODEL, outcome=outcome,
            tokens_in=tokens[0] or 0, tokens_out=tokens[1] or 0,
            # Расход и итог пишем всегда, тексты — по настройке: шлюз обычно
            # пишет их сам, и чужие тексты не нужны в двух местах
            task=(task if AI_LOG_TEXT else None),
            answer=(answer if AI_LOG_TEXT else None),
        )
        s.add(row)
        if AI_LOG_DAYS > 0:
            s.execute(delete(AiLog).where(AiLog.created_at < now() - dt.timedelta(days=AI_LOG_DAYS)))
        s.commit()
        return row.id
    except Exception as e:                      # журнал не должен ронять сборку
        log.warning("Не удалось записать обращение к модели в журнал: %s", e)
        return None
    finally:
        s.close()


def _tokens(data: Any) -> tuple:
    u = (data or {}).get("usage") or {}
    return (int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0))


@router.post("/draft")
async def draft(payload: dict = Body(...), user: User = Depends(current_user)):
    """Собрать черновик шаблона: сервис сам обращается к модели.

    Возвращает `{ответ, id}` — текст модели как есть (разбирает его клиент, там
    же, где и в офлайн-сборке) и номер записи в журнале, чтобы клиент потом
    дописал, чем дело кончилось у человека.
    """
    if int(payload.get("формат") or payload.get("format") or 0) != AI_FORMAT:
        raise HTTPException(status_code=400, detail="Обновите страницу: сервис ждёт другой формат ответа модели")
    for f in RAW_FIELDS:
        if f in payload:
            raise HTTPException(status_code=400, detail="Через сервис можно попросить только черновик шаблона")
    if not ai_configured():
        raise HTTPException(status_code=503, detail="Доступ к модели в сервисе не настроен — перенесите запрос вручную")
    if not _allowed(user):
        raise HTTPException(status_code=403, detail="Сборка по описанию вам не разрешена — перенесите запрос вручную")

    task = str(payload.get("задача") or payload.get("task") or "").strip()
    if not task:
        raise HTTPException(status_code=400, detail="Опишите, что нужно показать")
    if len(task) > AI_MAX_CHARS:
        raise HTTPException(status_code=413,
                            detail=f"Описание длиннее {AI_MAX_CHARS} символов: сократите на {len(task) - AI_MAX_CHARS}")
    draft_state = payload.get("черновик") or payload.get("draft") or None
    cols = ((draft_state or {}).get("колонки") or []) if isinstance(draft_state, dict) else []
    if len(cols) > AI_MAX_COLS:
        raise HTTPException(status_code=413, detail=f"Колонок больше {AI_MAX_COLS}: столько в запрос не поместится")
    errors = payload.get("ошибки") or payload.get("errors") or []

    _check_limits(user.username)
    message = build_user_message(task, draft_state, errors)
    body = {
        "model": AI_MODEL,
        "messages": [{"role": "system", "content": AI_SYSTEM}, {"role": "user", "content": message}],
        "temperature": 0.2,
        # Логин человека — чтобы шлюз сам раскладывал расход по людям: иначе
        # наш журнал остаётся единственным источником правды про деньги
        "user": user.username,
    }
    url = AI_URL.rstrip("/")
    if not url.endswith("/chat/completions"):
        url += "/chat/completions"

    outcome, answer, tokens, fail = "ok", "", (0, 0), None
    try:
        async with httpx.AsyncClient(timeout=AI_TIMEOUT_SEC) as client:
            res = await client.post(url, json=body, headers={"Authorization": "Bearer " + AI_TOKEN})
        data = res.json() if res.headers.get("content-type", "").startswith("application/json") else None
        tokens = _tokens(data)
        if res.status_code in (401, 403):
            outcome, fail = "denied", (503, "Сервис не может обратиться к модели: скажите администратору")
        elif res.status_code == 429:
            outcome, fail = "limit", (429, "Шлюз модели исчерпал предел обращений, попробуйте позже")
        elif not res.is_success:
            outcome, fail = "gateway", (502, f"Шлюз модели ответил {res.status_code}")
        else:
            answer = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            if not answer:
                outcome, fail = "parse", (502, "Ответ модели не разобрать")
    except httpx.TimeoutException:
        outcome, fail = "timeout", (504, f"Модель не ответила за {AI_TIMEOUT_SEC} с — ваш текст сохранён, попробуйте ещё раз")
    except httpx.HTTPError as e:
        log.warning("Шлюз модели недоступен: %s", e)
        outcome, fail = "network", (503, "Сервис не смог связаться со шлюзом модели: скажите администратору")

    metrics.inc("kobra_ai_requests_total", outcome=outcome)
    metrics.inc("kobra_ai_tokens_total", tokens[0] + tokens[1])
    # Записываем и отказы: журнал «только про удачные» не отвечает на «почему у
    # него не работает». Через пул потоков — см. шапку файла
    log_id = await run_in_threadpool(_write_log, user.username, outcome, task, answer, tokens)
    if fail:
        raise HTTPException(status_code=fail[0], detail=fail[1])
    return {"ответ": answer, "id": log_id}


@router.post("/draft/{log_id}/outcome")
def draft_outcome(log_id: int, payload: dict = Body(...), user: User = Depends(current_user)):
    """Чем обращение кончилось **у человека**: собрался шаблон или нет и сколько
    блоков пропущено. Сервер этого знать не может — ответ разбирает клиент, а
    «HTTP 200, 1400 токенов» ничего не говорит о пользе."""
    s = SessionLocal()
    try:
        row = s.get(AiLog, log_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Записи журнала нет")
        # Свою запись, а не чужую: иначе один человек правит итоги другого
        if row.login != user.username:
            raise HTTPException(status_code=403, detail="Это обращение другого сотрудника")
        row.built = "built" if payload.get("собрался") or payload.get("built") else "empty"
        row.skipped = int(payload.get("пропущено") or payload.get("skipped") or 0)
        s.commit()
        return {"ok": True}
    finally:
        s.close()


@router.get("/log")
def read_log(user: User = Depends(current_user), limit: int = 200):
    """Журнал обращений. Только администратору: там чужие тексты запросов."""
    if user.role != "Admin":
        raise HTTPException(status_code=403, detail="Журнал обращений к модели доступен администратору")
    s = SessionLocal()
    try:
        rows = s.execute(select(AiLog).order_by(AiLog.created_at.desc()).limit(max(1, min(limit, 1000)))).scalars().all()
        # Разбивка по людям: расход рядом с долей удачных сборок — вопрос «сколько
        # потратили» без «с какой пользой» на сервисе для нескольких команд не задают
        by = s.execute(
            select(AiLog.login, func.count(AiLog.id),
                   func.coalesce(func.sum(AiLog.tokens_in + AiLog.tokens_out), 0),
                   func.sum(case((AiLog.built == "built", 1), else_=0)))
            .group_by(AiLog.login)
        ).all()
        return {
            "записи": [{
                "id": r.id, "логин": r.login,
                "когда": int(r.created_at.timestamp() * 1000) if r.created_at else None,
                "модель": r.model, "токенов": (r.tokens_in or 0) + (r.tokens_out or 0),
                "итог": r.outcome, "собрался": r.built, "пропущено": r.skipped,
                "задача": r.task, "ответ": r.answer,
            } for r in rows],
            "по_людям": [{"логин": l, "обращений": n, "токенов": int(t), "собралось": int(b or 0)}
                         for l, n, t, b in by],
            "хранить_дней": AI_LOG_DAYS,
            "тексты": AI_LOG_TEXT,
        }
    finally:
        s.close()

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

**Ключ выдаётся на команду.** Один служебный ключ на сервис не делится: команда,
собравшая двести черновиков, тратит деньги остальных, а отобрать ключ значит
отобрать его у всех. Поэтому ключи лежат в `kobra_ai_keys` по командам, их
вставляет администратор в интерфейсе, и порядок выбора такой: ключ команды →
`KOBRA_AI_TOKEN` → отказ «администратор не выдал вашей команде доступ». Ключ
наружу не отдаётся никогда и никому, включая того, кто его вставил.

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
from fastapi import APIRouter, Body, Depends, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import case, delete, func, select

from app import metrics
from app.auth import current_user
from app.core import (
    AI_LIMIT_ALL, AI_LIMIT_USER, AI_LOG_DAYS, AI_LOG_TEXT, AI_MAX_CHARS, AI_MAX_COLS,
    AI_MODEL, AI_ROLES, AI_TIMEOUT_SEC, AI_TOKEN, AI_URL, AiKey, AiLog, SessionLocal, User,
    ai_configured, decrypt, encrypt, now,
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


class НетКлюча(Exception):
    """Команде нечем обращаться к модели. Отдельный вид отказа: человеку нужно
    знать, что идти надо к администратору Кобры, а не к администратору шлюза."""

    def __init__(self, текст: str, outcome: str = "no_key"):
        super().__init__(текст)
        self.outcome = outcome


def team_key(team: str) -> tuple:
    """Чем обращаться от имени этой команды: `(токен, модель, вид)`.

    Порядок: ключ команды → ключ по умолчанию из окружения → отказ. Так
    нынешние развёртывания (одна команда, ключ в переменных) продолжают
    работать без правок, а там, где ключи разделили, окружение остаётся
    запасным для команд, которым свой ключ не нужен.
    """
    s = SessionLocal()
    try:
        row = s.get(AiKey, team or "")
    finally:
        s.close()
    if row is not None:
        try:
            return decrypt(row.token_enc), (row.model or AI_MODEL), "team"
        except Exception:
            # Сменился KOBRA_SECRET_KEY: ключ остался, прочитать его нельзя.
            # Это не поломка сервиса, а работа для администратора
            raise НетКлюча("Ключ модели для вашей команды не читается: скажите администратору",
                           "key_unreadable")
    if AI_TOKEN:
        return AI_TOKEN, AI_MODEL, "default"
    raise НетКлюча("Администратор не выдал вашей команде доступ к модели — перенесите запрос вручную")


def ai_available(team: str) -> bool:
    """Доступна ли модель этой команде. Отвечает `/api/auth/me`: `/api/ping` без
    сессии не знает, кто спрашивает, а ответ зависит от команды. Иначе человек
    из команды без ключа видел бы кнопку «Собрать» и узнавал о правилах доступа
    методом проб."""
    if not ai_configured():
        return False
    try:
        team_key(team)
        return True
    except НетКлюча:
        return False


def ai_anywhere() -> bool:
    """Есть ли доступ к модели в сервисе вообще — хоть у одной команды. Это и
    отвечает `/api/ping`: экрану входа большего знать незачем."""
    if not ai_configured():
        return False
    if AI_TOKEN:
        return True
    s = SessionLocal()
    try:
        return s.query(AiKey).first() is not None
    finally:
        s.close()


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
               tokens: tuple = (0, 0), team: str = "", key_kind: str = "",
               model: str = "") -> Optional[int]:
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
            login=login, team=team or "", key_kind=key_kind, model=model or AI_MODEL, outcome=outcome,
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
    # Чем обращаться — решает команда человека. Отказ «ключа нет» приходит до
    # запроса: тратить время на сеть, когда нечем идти, незачем
    try:
        token, model, key_kind = team_key(user.team or "")
    except НетКлюча as e:
        await run_in_threadpool(_write_log, user.username, e.outcome, task, "", (0, 0),
                                user.team or "", "")
        metrics.inc("kobra_ai_requests_total", outcome=e.outcome)
        raise HTTPException(status_code=503, detail=str(e))
    message = build_user_message(task, draft_state, errors)
    body = {
        "model": model,
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
            res = await client.post(url, json=body, headers={"Authorization": "Bearer " + token})
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
    log_id = await run_in_threadpool(_write_log, user.username, outcome, task, answer, tokens,
                                     user.team or "", key_kind, model)
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


# ---------- Ключи команд: только администратор ----------

def _only_admin(user: User) -> None:
    if user.role != "Admin":
        raise HTTPException(status_code=403, detail="Ключи к модели выдаёт администратор")


@router.get("/keys")
def list_keys(user: User = Depends(current_user)):
    """Кому выдан доступ. Администратор думает про команды («выдали ли мы
    Продажам»), а не про записи в таблице, поэтому список — по командам
    сотрудников плюс те команды, у которых ключ есть, а людей ещё нет.

    Самих ключей в ответе нет ни в каком виде — ни целиком, ни хвостом: показать
    ключ значит дать его скопировать.
    """
    _only_admin(user)
    s = SessionLocal()
    try:
        люди = dict(s.execute(
            select(User.team, func.count(User.id)).where(User.active.is_(True)).group_by(User.team)
        ).all())
        ключи = {k.team: k for k in s.query(AiKey).all()}
        команды = sorted(set(t for t in люди if t) | set(ключи))
        return {
            "команды": [{
                "команда": t,
                "сотрудников": int(люди.get(t, 0)),
                "ключ": t in ключи,
                "модель": (ключи[t].model or "") if t in ключи else "",
                "кто": ключи[t].updated_by if t in ключи else None,
                "когда": int(ключи[t].updated_at.timestamp() * 1000) if t in ключи and ключи[t].updated_at else None,
            } for t in команды],
            # Чтобы на экране было видно: команда без своего ключа не без доступа,
            # она работает на ключе по умолчанию — и это другое состояние
            "ключПоУмолчанию": bool(AI_TOKEN),
            "модельПоУмолчанию": AI_MODEL,
        }
    finally:
        s.close()


@router.put("/keys/{team}")
def set_key(team: str, payload: dict = Body(...), user: User = Depends(current_user)):
    """Вставить или заменить ключ команды. Значение уходит в базу зашифрованным
    и обратно не отдаётся."""
    _only_admin(user)
    token = str(payload.get("ключ") or payload.get("token") or "").strip()
    if not token:
        raise HTTPException(status_code=422, detail="Нужен ключ: пустое значение ничего не даёт")
    if not team.strip():
        raise HTTPException(status_code=422, detail="Нужна команда, которой выдаётся ключ")
    s = SessionLocal()
    try:
        row = s.get(AiKey, team) or AiKey(team=team)
        row.token_enc = encrypt(token)
        row.model = str(payload.get("модель") or payload.get("model") or "").strip()
        row.updated_by = user.username
        row.updated_at = now()
        s.add(row)
        s.commit()
        log.info("Ключ модели для команды %s задан: %s", team, user.username)
        return {"команда": team, "ключ": True, "модель": row.model}
    finally:
        s.close()


@router.delete("/keys/{team}", status_code=204)
def drop_key(team: str, user: User = Depends(current_user)):
    """Отозвать ключ команды. Живого ключа для этого не требуется: иначе
    выданное уволенной команде право нельзя было бы снять."""
    _only_admin(user)
    s = SessionLocal()
    try:
        row = s.get(AiKey, team)
        if row is not None:
            s.delete(row)
            s.commit()
            log.info("Ключ модели для команды %s отозван: %s", team, user.username)
        return Response(status_code=204)
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
        по_командам = s.execute(
            select(AiLog.team, AiLog.key_kind, func.count(AiLog.id),
                   func.coalesce(func.sum(AiLog.tokens_in + AiLog.tokens_out), 0),
                   func.sum(case((AiLog.built == "built", 1), else_=0)))
            .group_by(AiLog.team, AiLog.key_kind)
        ).all()
        return {
            "записи": [{
                "id": r.id, "логин": r.login, "команда": r.team, "ключ": r.key_kind,
                "когда": int(r.created_at.timestamp() * 1000) if r.created_at else None,
                "модель": r.model, "токенов": (r.tokens_in or 0) + (r.tokens_out or 0),
                "итог": r.outcome, "собрался": r.built, "пропущено": r.skipped,
                "задача": r.task, "ответ": r.answer,
            } for r in rows],
            "по_людям": [{"логин": l, "обращений": n, "токенов": int(t), "собралось": int(b or 0)}
                         for l, n, t, b in by],
            # Расход по командам — главный вопрос, ради которого ключи и разделяют
            "по_командам": [{"команда": t or "", "ключ": k or "", "обращений": n,
                             "токенов": int(tok), "собралось": int(b or 0)}
                            for t, k, n, tok, b in по_командам],
            "хранить_дней": AI_LOG_DAYS,
            "тексты": AI_LOG_TEXT,
        }
    finally:
        s.close()

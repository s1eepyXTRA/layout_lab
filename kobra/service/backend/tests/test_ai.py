"""Обращение к модели через сервис.

Главное, что здесь проверяется: маршрут **узкий**. Через него нельзя задать
модели свой вопрос, потому что служебный ключ компании иначе становится общим
доступом к модели для всех, у кого есть сессия. Остальное — чтобы отказы были
различимы, журнал не молчал и токен не ушёл в браузер.

Шлюз подменён: тесты не ходят в сеть и не тратят деньги.
"""
import json

import httpx
import pytest

from app import ai, metrics
from app.core import AiLog, SessionLocal, now


@pytest.fixture
def orlov(make_user, login, auth):
    make_user("d.orlov", team="Продажи")
    return auth(login("d.orlov"))


@pytest.fixture
def admin_h(make_user, login, auth):
    make_user("i.petrov", role="Admin", team="Отдел данных")
    return auth(login("i.petrov"))


class Шлюз:
    """Подменный шлюз: помнит запросы и отвечает тем, что велели."""

    def __init__(self, monkeypatch):
        self.запросы = []
        self.ответ = httpx.Response(200, json={
            "choices": [{"message": {"content": '{"ответ":"ок","блоки":[]}'}}],
            "usage": {"prompt_tokens": 120, "completion_tokens": 80},
        })
        self.бросить = None
        монитор = self

        def handler(request: httpx.Request) -> httpx.Response:
            монитор.запросы.append(json.loads(request.content))
            монитор.заголовки = dict(request.headers)
            if монитор.бросить:
                raise монитор.бросить
            return монитор.ответ

        transport = httpx.MockTransport(handler)
        настоящий = httpx.AsyncClient
        monkeypatch.setattr(ai.httpx, "AsyncClient",
                            lambda **kw: настоящий(transport=transport, **kw))
        monkeypatch.setattr(ai, "AI_URL", "https://litellm.company.local/v1")
        monkeypatch.setattr(ai, "AI_MODEL", "kobra-draft")
        monkeypatch.setattr(ai, "AI_TOKEN", "sk-sluzhebnyi")
        monkeypatch.setattr(ai, "ai_configured", lambda: True)


@pytest.fixture
def шлюз(monkeypatch):
    metrics.reset()
    yield Шлюз(monkeypatch)
    metrics.reset()


ЗАПРОС = {"формат": 1, "задача": "заявки по этапам и срокам"}


def записи():
    s = SessionLocal()
    try:
        return s.query(AiLog).order_by(AiLog.id).all()
    finally:
        s.close()


def test_sobiraet_chernovik_i_peredaet_login(client, orlov, шлюз):
    """Промпт собирает сервер, а логин уезжает в шлюз: расход должен
    раскладываться по людям там, где деньги."""
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 200, r.text
    assert r.json()["ответ"] == '{"ответ":"ок","блоки":[]}'
    отправлено = шлюз.запросы[0]
    assert отправлено["model"] == "kobra-draft"
    assert отправлено["user"] == "d.orlov"
    assert отправлено["messages"][0]["role"] == "system"
    assert "конструкторе «Кобра»" in отправлено["messages"][0]["content"]
    assert отправлено["messages"][1]["content"].startswith("Задача: заявки по этапам")
    # Токен уехал в заголовке и остался на сервере
    assert шлюз.заголовки["authorization"] == "Bearer sk-sluzhebnyi"
    assert "sk-sluzhebnyi" not in r.text


def test_token_ne_popadaet_v_otvet_i_v_ping(client, orlov, шлюз):
    """Про модель клиенту сказано только «настроена»: ни адреса, ни названия."""
    ping = client.get("/api/ping").json()
    assert set(ping) >= {"ai", "aiMaxChars"}
    assert "litellm" not in json.dumps(ping, ensure_ascii=False)
    assert "kobra-draft" not in json.dumps(ping, ensure_ascii=False)


def test_ping_bez_nastroek_govorit_net(client):
    assert client.get("/api/ping").json()["ai"] is False


def test_gotovyi_tekst_dlya_modeli_otklonen(client, orlov, шлюз):
    """Попытка прислать свой запрос вместо описания задачи: иначе сервис —
    универсальный прокси к модели, и единый токен пришлось бы отменять."""
    for поле in ("messages", "prompt", "system", "промпт"):
        r = client.post("/api/ai/draft", json=dict(ЗАПРОС, **{поле: "сделай мне стихи"}), headers=orlov)
        assert r.status_code == 400, поле
        assert "только черновик" in r.json()["detail"]
    assert шлюз.запросы == []


def test_neizvestnyi_format_otklonen(client, orlov, шлюз):
    """Клиент живёт в чужом браузере из кэша неделями: старый разбор не должен
    молча встретить новый промпт."""
    r = client.post("/api/ai/draft", json={"формат": 99, "задача": "что-нибудь"}, headers=orlov)
    assert r.status_code == 400
    assert "Обновите страницу" in r.json()["detail"]
    assert client.post("/api/ai/draft", json={"задача": "без формата"}, headers=orlov).status_code == 400
    assert шлюз.запросы == []


def test_rol_bez_razresheniya(client, orlov, шлюз, monkeypatch):
    monkeypatch.setattr(ai, "AI_ROLES", ("Admin",))
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 403
    assert "вручную" in r.json()["detail"]
    assert шлюз.запросы == []


def test_bez_perechislennyh_rolei_mozhet_lyuboi(client, orlov, шлюз):
    """Пока администратор не сузил доступ, поведение то же, что до изменения."""
    assert ai.AI_ROLES == ()
    assert client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).status_code == 200


def test_dostup_k_modeli_ne_nastroen(client, orlov):
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 503
    assert "вручную" in r.json()["detail"]


def test_dlinnoe_opisanie_otklonyaetsya_do_modeli(client, orlov, шлюз, monkeypatch):
    """Отказ приходит до обращения: иначе предел ничего не экономит."""
    monkeypatch.setattr(ai, "AI_MAX_CHARS", 50)
    r = client.post("/api/ai/draft", json={"формат": 1, "задача": "я" * 60}, headers=orlov)
    assert r.status_code == 413
    assert "50" in r.json()["detail"] and "10" in r.json()["detail"]
    assert шлюз.запросы == []


def test_slishkom_mnogo_kolonok(client, orlov, шлюз, monkeypatch):
    monkeypatch.setattr(ai, "AI_MAX_COLS", 3)
    черновик = {"название": "X", "колонки": [{"подпись": f"К{i}"} for i in range(5)], "блоки": []}
    r = client.post("/api/ai/draft", json=dict(ЗАПРОС, черновик=черновик), headers=orlov)
    assert r.status_code == 413
    assert шлюз.запросы == []


def test_chernovik_i_oshibki_edut_v_zapros(client, orlov, шлюз):
    """Доработка: что собрано и что не построилось сервис приклеивает сам."""
    r = client.post("/api/ai/draft", json=dict(
        ЗАПРОС, задача="убери круговую",
        черновик={"название": "Заявки", "колонки": [{"подпись": "Статус"}], "блоки": []},
        ошибки=[{"название": "Воронка", "ошибка": "нет колонки этапа"}],
    ), headers=orlov)
    assert r.status_code == 200
    текст = шлюз.запросы[0]["messages"][1]["content"]
    assert "ЧТО УЖЕ СОБРАНО" in текст and "Статус" in текст
    assert "ЧТО НЕ ПОСТРОИЛОСЬ" in текст and "нет колонки этапа" in текст


# ---------- Отказы шлюза различимы ----------

def test_shlyuz_ne_prinyal_sluzhebnyi_token(client, orlov, шлюз):
    """Совет «проверьте токен» человеку без токена бессмысленен."""
    шлюз.ответ = httpx.Response(401, json={"error": "invalid key"})
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 503
    assert "администратору" in r.json()["detail"]
    assert "токен" not in r.json()["detail"].lower()
    assert записи()[0].outcome == "denied"


def test_predel_shlyuza(client, orlov, шлюз):
    шлюз.ответ = httpx.Response(429, json={"error": "rate limited"})
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 429
    assert записи()[0].outcome == "limit"


def test_model_ne_otvetila_za_otvedennoe_vremya(client, orlov, шлюз):
    шлюз.бросить = httpx.ReadTimeout("слишком долго")
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 504
    assert "сохранён" in r.json()["detail"]
    assert записи()[0].outcome == "timeout"


def test_otvet_ne_razobrat(client, orlov, шлюз):
    шлюз.ответ = httpx.Response(200, json={"choices": [{"message": {"content": ""}}]})
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 502
    assert записи()[0].outcome == "parse"


def test_shlyuz_otvetil_pyatisotkoi(client, orlov, шлюз):
    шлюз.ответ = httpx.Response(500, json={"error": "boom"})
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 502
    assert записи()[0].outcome == "gateway"


# ---------- Пределы частоты ----------

def test_lichnyi_predel(client, orlov, шлюз, monkeypatch):
    monkeypatch.setattr(ai, "AI_LIMIT_USER", 1)
    assert client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).status_code == 200
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert r.status_code == 429
    assert "повторите через" in r.json()["detail"]
    assert len(шлюз.запросы) == 1


def test_predel_servisa(client, orlov, шлюз, monkeypatch, make_user, login, auth):
    """Один человек не должен сжечь общую квоту, но и предел сервиса виден."""
    monkeypatch.setattr(ai, "AI_LIMIT_ALL", 1)
    make_user("e.kuznecova", team="Поддержка")
    другой = auth(login("e.kuznecova"))
    assert client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).status_code == 200
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=другой)
    assert r.status_code == 429
    assert "Сервис исчерпал" in r.json()["detail"]


def test_bez_redis_predel_ne_zapiraet(client, orlov, шлюз, monkeypatch):
    """Правило то же, что у входа: недоступный кэш не останавливает работу."""
    import app.sessions as sessions
    monkeypatch.setattr(sessions, "redis_conn", lambda: (_ for _ in ()).throw(RuntimeError("нет Redis")))
    monkeypatch.setattr(ai, "AI_LIMIT_USER", 1)
    for _ in range(3):
        assert client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).status_code == 200


# ---------- Журнал ----------

def test_zhurnal_pishet_rashod_i_itog(client, orlov, шлюз):
    client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    r = записи()[0]
    assert (r.login, r.model, r.outcome) == ("d.orlov", "kobra-draft", "ok")
    assert (r.tokens_in, r.tokens_out) == (120, 80)
    assert r.task.startswith("заявки по этапам")
    assert r.answer == '{"ответ":"ок","блоки":[]}'
    assert "kobra_ai_tokens_total 200" in client.get("/metrics").text


def test_bez_hraneniya_tekstov_rashod_vse_ravno_est(client, orlov, шлюз, monkeypatch):
    """Шлюз обычно пишет запросы сам, и чужие тексты не нужны в двух местах."""
    monkeypatch.setattr(ai, "AI_LOG_TEXT", False)
    client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    r = записи()[0]
    assert r.task is None and r.answer is None
    assert (r.tokens_in, r.outcome) == (120, "ok")


def test_itog_cheloveka_dopisyvaetsya(client, orlov, шлюз):
    """Сервер знает «HTTP 200, 200 токенов» — и ничего не знает о пользе."""
    номер = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).json()["id"]
    assert номер
    r = client.post(f"/api/ai/draft/{номер}/outcome", json={"собрался": True, "пропущено": 2}, headers=orlov)
    assert r.status_code == 200
    запись = записи()[0]
    assert (запись.built, запись.skipped) == ("built", 2)


def test_itog_ne_sobralos(client, orlov, шлюз):
    номер = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).json()["id"]
    client.post(f"/api/ai/draft/{номер}/outcome", json={"собрался": False}, headers=orlov)
    assert записи()[0].built == "empty"


def test_chuzhuyu_zapis_pravit_nelzya(client, orlov, шлюз, make_user, login, auth):
    номер = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).json()["id"]
    make_user("e.kuznecova", team="Поддержка")
    r = client.post(f"/api/ai/draft/{номер}/outcome", json={"собрался": True},
                    headers=auth(login("e.kuznecova")))
    assert r.status_code == 403
    assert client.post("/api/ai/draft/99999/outcome", json={"собрался": True}, headers=orlov).status_code == 404


def test_zhurnal_chitaet_tolko_admin(client, orlov, admin_h, шлюз):
    client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    assert client.get("/api/ai/log", headers=orlov).status_code == 403
    j = client.get("/api/ai/log", headers=admin_h).json()
    assert j["записи"][0]["логин"] == "d.orlov"
    assert j["записи"][0]["токенов"] == 200
    assert j["по_людям"] == [{"логин": "d.orlov", "обращений": 1, "токенов": 200, "собралось": 0}]


def test_dolya_udachnyh_sborok_v_razbivke(client, orlov, admin_h, шлюз):
    номер = client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov).json()["id"]
    client.post(f"/api/ai/draft/{номер}/outcome", json={"собрался": True}, headers=orlov)
    client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    по_людям = client.get("/api/ai/log", headers=admin_h).json()["по_людям"][0]
    assert (по_людям["обращений"], по_людям["собралось"]) == (2, 1)


def test_starye_zapisi_udalyayutsya(client, orlov, шлюз, monkeypatch, db):
    """Срок хранения соблюдается тем же запросом, что пишет новую запись:
    планировщика в проекте нет, а удаление при записи не может перестать
    работать незаметно."""
    import datetime as dt
    monkeypatch.setattr(ai, "AI_LOG_DAYS", 30)
    db.add(AiLog(login="d.orlov", outcome="ok", created_at=now() - dt.timedelta(days=100)))
    db.commit()
    assert len(записи()) == 1
    client.post("/api/ai/draft", json=ЗАПРОС, headers=orlov)
    осталось = записи()
    assert len(осталось) == 1
    assert осталось[0].outcome == "ok" and осталось[0].tokens_in == 120

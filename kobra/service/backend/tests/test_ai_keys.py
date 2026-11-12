"""Ключ к модели выдаётся на команду.

Один служебный ключ на сервис не делится: команда, собравшая двести черновиков,
тратит деньги остальных, а отобрать ключ значит отобрать его у всех. Здесь
проверяется порядок выбора ключа (команда → умолчание → отказ), что ключ не
возвращается наружу никому, и что расход одной команды не путается с расходом
другой.
"""
import json

import httpx
import pytest

from app import ai, metrics
from app.core import AiKey, AiLog, SessionLocal, encrypt
from tests.test_ai import Шлюз, ЗАПРОС, записи


@pytest.fixture
def шлюз(monkeypatch):
    """Тот же подменный шлюз, но без ключа по умолчанию: его задаёт каждый тест
    сам — именно в нём тут вся соль."""
    metrics.reset()
    g = Шлюз(monkeypatch)
    monkeypatch.setattr(ai, "AI_TOKEN", "")
    yield g
    metrics.reset()


@pytest.fixture
def prodazhi(make_user, login, auth):
    make_user("d.orlov", team="Продажи")
    return auth(login("d.orlov"))


@pytest.fixture
def podderzhka(make_user, login, auth):
    make_user("e.kuznecova", team="Поддержка")
    return auth(login("e.kuznecova"))


@pytest.fixture
def admin_h(make_user, login, auth):
    make_user("i.petrov", role="Admin", team="Отдел данных")
    return auth(login("i.petrov"))


def дать_ключ(team, token, model=""):
    s = SessionLocal()
    try:
        s.add(AiKey(team=team, token_enc=encrypt(token), model=model, updated_by="i.petrov"))
        s.commit()
    finally:
        s.close()


def test_obrashchenie_idet_klyuchom_komandy(client, prodazhi, шлюз):
    дать_ключ("Продажи", "sk-prodazhi")
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert r.status_code == 200, r.text
    assert шлюз.заголовки["authorization"] == "Bearer sk-prodazhi"
    запись = записи()[0]
    assert (запись.team, запись.key_kind) == ("Продажи", "team")


def test_u_komandy_svoi_alias_modeli(client, prodazhi, шлюз):
    """В шлюзе разным ключам разрешены разные модели."""
    дать_ключ("Продажи", "sk-prodazhi", model="prodazhi-draft")
    client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert шлюз.запросы[0]["model"] == "prodazhi-draft"
    # Без своего алиаса — модель сервиса
    дать_ключ("Поддержка", "sk-podderzhka")
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert r.status_code == 200


def test_bez_klyucha_komandy_idet_klyuch_po_umolchaniyu(client, prodazhi, шлюз, monkeypatch):
    """Развёртывание на одну команду продолжает работать без правок."""
    monkeypatch.setattr(ai, "AI_TOKEN", "sk-sluzhebnyi")
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert r.status_code == 200
    assert шлюз.заголовки["authorization"] == "Bearer sk-sluzhebnyi"
    # В журнале видно, что команда работает не на своём ключе: иначе отсутствие
    # своего ключа незаметно
    assert записи()[0].key_kind == "default"


def test_net_ni_odnogo_klyucha(client, prodazhi, шлюз):
    """Отказ называет того, к кому идти: это администратор Кобры, а не шлюза."""
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert r.status_code == 503
    assert "не выдал вашей команде" in r.json()["detail"]
    assert "вручную" in r.json()["detail"]
    assert шлюз.запросы == []
    # Отказ тоже попадает в журнал: иначе «почему у него не работает» нечем
    # ответить
    assert записи()[0].outcome == "no_key"


def test_klyuch_ne_chitaetsya(client, prodazhi, шлюз):
    """Сменился KOBRA_SECRET_KEY: ключ остался, прочитать его нельзя. Это
    работа для администратора, а не пятисотка."""
    s = SessionLocal()
    try:
        s.add(AiKey(team="Продажи", token_enc="не-фернет-вообще", updated_by="i.petrov"))
        s.commit()
    finally:
        s.close()
    r = client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert r.status_code == 503
    assert "не читается" in r.json()["detail"]
    assert шлюз.запросы == []
    assert записи()[0].outcome == "key_unreadable"


def test_klyuchi_komand_ne_putayutsya(client, prodazhi, podderzhka, шлюз):
    дать_ключ("Продажи", "sk-prodazhi")
    дать_ключ("Поддержка", "sk-podderzhka")
    client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    первый = шлюз.заголовки["authorization"]
    client.post("/api/ai/draft", json=ЗАПРОС, headers=podderzhka)
    assert первый == "Bearer sk-prodazhi"
    assert шлюз.заголовки["authorization"] == "Bearer sk-podderzhka"
    assert {z.team for z in записи()} == {"Продажи", "Поддержка"}


# ---------- Администрирование ----------

def test_spisok_klyuchei_bez_samih_klyuchei(client, admin_h, prodazhi, шлюз):
    дать_ключ("Продажи", "sk-prodazhi-ochen-sekretnyi", model="prodazhi-draft")
    r = client.get("/api/ai/keys", headers=admin_h)
    assert r.status_code == 200
    # Ключа нет в ответе ни целиком, ни хвостом
    assert "sk-prodazhi" not in r.text
    assert "ochen-sekretnyi" not in r.text
    команды = {c["команда"]: c for c in r.json()["команды"]}
    assert команды["Продажи"]["ключ"] is True
    assert команды["Продажи"]["модель"] == "prodazhi-draft"
    assert команды["Продажи"]["кто"] == "i.petrov"
    assert команды["Продажи"]["сотрудников"] == 1
    # Команда админа есть в списке, но без ключа
    assert команды["Отдел данных"]["ключ"] is False
    assert r.json()["ключПоУмолчанию"] is False


def test_klyuchi_tolko_adminu(client, prodazhi, admin_h):
    assert client.get("/api/ai/keys", headers=prodazhi).status_code == 403
    assert client.put("/api/ai/keys/Продажи", json={"ключ": "sk-x"}, headers=prodazhi).status_code == 403
    assert client.delete("/api/ai/keys/Продажи", headers=prodazhi).status_code == 403
    assert client.get("/api/ai/keys", headers=admin_h).status_code == 200


def test_admin_vydaet_zamenyaet_i_otzyvaet(client, admin_h, prodazhi, шлюз):
    assert client.put("/api/ai/keys/Продажи", json={"ключ": "sk-pervyi"}, headers=admin_h).status_code == 200
    client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert шлюз.заголовки["authorization"] == "Bearer sk-pervyi"

    assert client.put("/api/ai/keys/Продажи", json={"ключ": "sk-vtoroi"}, headers=admin_h).status_code == 200
    client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert шлюз.заголовки["authorization"] == "Bearer sk-vtoroi"

    # Отзыв: обращения прекращаются, перенос вручную остаётся
    assert client.delete("/api/ai/keys/Продажи", headers=admin_h).status_code == 204
    отказ = client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    assert отказ.status_code == 503
    assert "не выдал вашей команде" in отказ.json()["detail"]


def test_pustoi_klyuch_ne_prinimaetsya(client, admin_h):
    r = client.put("/api/ai/keys/Продажи", json={"ключ": "   "}, headers=admin_h)
    assert r.status_code == 422


def test_otzyv_nesushchestvuyushchego_ne_oshibka(client, admin_h):
    """Выданное уволенной команде право нужно снимать без живого ключа."""
    assert client.delete("/api/ai/keys/Нет такой", headers=admin_h).status_code == 204


# ---------- Признак доступа ----------

def test_mozhno_li_mne_zavisit_ot_komandy(client, prodazhi, podderzhka, шлюз):
    дать_ключ("Продажи", "sk-prodazhi")
    assert client.get("/api/auth/me", headers=prodazhi).json()["ai"] is True
    assert client.get("/api/auth/me", headers=podderzhka).json()["ai"] is False
    # Проба без сессии отвечает про сервис: доступ в нём есть, хоть у одной команды
    assert client.get("/api/ping").json()["ai"] is True


def test_bez_klyuchei_vovse_proba_govorit_net(client, prodazhi, шлюз):
    assert client.get("/api/ping").json()["ai"] is False
    assert client.get("/api/auth/me", headers=prodazhi).json()["ai"] is False


def test_klyuch_po_umolchaniyu_daet_dostup_vsem(client, prodazhi, шлюз, monkeypatch):
    monkeypatch.setattr(ai, "AI_TOKEN", "sk-sluzhebnyi")
    assert client.get("/api/ping").json()["ai"] is True
    assert client.get("/api/auth/me", headers=prodazhi).json()["ai"] is True


def test_v_spiske_klyuchei_vidno_klyuch_po_umolchaniyu(client, admin_h, шлюз, monkeypatch):
    """Команда без своего ключа не без доступа — она на служебном, и это другое
    состояние."""
    monkeypatch.setattr(ai, "AI_TOKEN", "sk-sluzhebnyi")
    assert client.get("/api/ai/keys", headers=admin_h).json()["ключПоУмолчанию"] is True


# ---------- Расход по командам ----------

def test_razbivka_rashoda_po_komandam(client, admin_h, prodazhi, podderzhka, шлюз):
    дать_ключ("Продажи", "sk-prodazhi")
    дать_ключ("Поддержка", "sk-podderzhka")
    номер = client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi).json()["id"]
    client.post(f"/api/ai/draft/{номер}/outcome", json={"собрался": True}, headers=prodazhi)
    client.post("/api/ai/draft", json=ЗАПРОС, headers=podderzhka)
    по_командам = {c["команда"]: c for c in client.get("/api/ai/log", headers=admin_h).json()["по_командам"]}
    assert по_командам["Продажи"]["токенов"] == 200
    assert по_командам["Продажи"]["собралось"] == 1
    assert по_командам["Поддержка"]["токенов"] == 200
    assert по_командам["Поддержка"]["собралось"] == 0
    assert по_командам["Продажи"]["ключ"] == "team"


def test_chelovek_pereshel_v_druguyu_komandu(client, admin_h, prodazhi, шлюз, db):
    """Потраченное остаётся за той командой, чьим ключом обращались."""
    from app.core import User
    дать_ключ("Продажи", "sk-prodazhi")
    client.post("/api/ai/draft", json=ЗАПРОС, headers=prodazhi)
    u = db.query(User).filter(User.username == "d.orlov").one()
    u.team = "Логистика"
    db.commit()
    assert записи()[0].team == "Продажи"

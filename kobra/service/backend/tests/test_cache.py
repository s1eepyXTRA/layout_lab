"""Кэш ускоряет повторный запрос, но не показывает устаревшие цифры.

И отдельно: сервис обязан работать при недоступном Redis. Кэш — это ускорение,
а не условие работы; если он становится точкой отказа, он хуже, чем его
отсутствие.
"""
import io

import pytest

from app import queue as q
from app.ingest import ingest_file

SPEC = {"groupby": [{"col": "gorod"}], "metrics": [{"kind": "simple", "agg": "SUM", "col": "vyruchka"}]}


def write_csv(path, rows):
    with io.open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write("Город;Выручка, ₽\n")
        for city, value in rows:
            fh.write(f"{city};{value}\n")
    return str(path)


@pytest.fixture
def ds(client, make_user, login, auth, tmp_path):
    make_user("a.smirnova", team="Продажи")
    h = auth(login("a.smirnova"))
    client.post("/api/datasets", json={"id": "ds_c", "name": "Продажи", "kind": "upload"}, headers=h)
    ingest_file("tc", "ds_c", write_csv(tmp_path / "a.csv", [("Москва", 100), ("Казань", 50)]),
                "a.csv", "a.smirnova")
    return h


def ask(client, h):
    r = client.post("/api/datasets/ds_c/query", json=SPEC, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_povtornyi_zapros_iz_kesha(client, ds):
    first = ask(client, ds)
    assert not first.get("cached")
    second = ask(client, ds)
    assert second.get("cached") is True
    assert second["rows"] == first["rows"]


def test_posle_novyh_strok_otvet_peresschitan(client, ds, tmp_path):
    before = ask(client, ds)
    assert sum(r["Сумма: Выручка, ₽"] for r in before["rows"]) == 150
    # Загрузили файл заново — версия набора выросла, старый ответ больше не найдётся
    ingest_file("tc2", "ds_c", write_csv(tmp_path / "b.csv", [("Москва", 300)]), "b.csv", "a.smirnova")
    after = ask(client, ds)
    assert not after.get("cached")
    assert sum(r["Сумма: Выручка, ₽"] for r in after["rows"]) == 300


def test_servis_rabotaet_bez_redis(client, ds, monkeypatch):
    """Redis выключен: кэш промахивается, но расчёт идёт, объекты читаются."""
    def no_redis():
        raise RuntimeError("Redis недоступен")
    monkeypatch.setattr(q, "redis_conn", no_redis)

    res = ask(client, ds)
    assert not res.get("cached")
    assert sum(r["Сумма: Выручка, ₽"] for r in res["rows"]) == 150
    # И второй раз тоже считается, а не падает
    assert not ask(client, ds).get("cached")
    # Обычная работа с объектами не задета
    assert client.get("/api/datasets/ds_c", headers=ds).status_code == 200
    assert client.get("/api/dashboards", headers=ds).status_code == 200


def test_gotovnost_ne_zavisit_ot_redis(client, monkeypatch):
    monkeypatch.setattr(q, "redis_conn", lambda: (_ for _ in ()).throw(RuntimeError("нет")))
    assert client.get("/readyz").status_code == 200
    assert client.get("/healthz").status_code == 200


def test_zagruzka_fayla_bez_redis_otvechaet_yavno(client, ds, tmp_path, monkeypatch):
    """Фоновая работа без очереди невозможна — говорим об этом прямо, а не
    принимаем файл, чтобы молча ничего с ним не сделать."""
    monkeypatch.setattr("app.upload.redis_ok", lambda: False)
    path = write_csv(tmp_path / "c.csv", [("Пермь", 10)])
    with open(path, "rb") as fh:
        r = client.post("/api/datasets/ds_c/file", files={"file": ("c.csv", fh, "text/csv")}, headers=ds)
    assert r.status_code == 503
    assert "недоступна" in r.json()["detail"]

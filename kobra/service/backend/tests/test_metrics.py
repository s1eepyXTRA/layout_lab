"""Метрики, медленные запросы и пределы на тяжёлых маршрутах.

Главное, что здесь проверяется: метрики отдаются без входа, и в них нет ничего
персонального. Этот адрес открыт системе наблюдения, и если в него просочатся
логины или названия наборов, он станет выгрузкой справочника.
"""
import io
import logging

import pytest

from app import metrics
from app.ingest import ingest_file


@pytest.fixture(autouse=True)
def chisto():
    """Счётчики между проверками не протекают."""
    metrics.reset()
    yield
    metrics.reset()


@pytest.fixture
def smirnova(client, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    return auth(login("a.smirnova"))


@pytest.fixture
def ds_gotov(client, smirnova, tmp_path, stage_file):
    """Готовый загруженный набор: расчёт по нему идёт в базе."""
    client.post("/api/datasets", json={"id": "ds_m", "name": "Продажи", "kind": "upload"},
                headers=smirnova)
    p = tmp_path / "prodazhi.csv"
    with io.open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write("Город;Выручка, ₽;Дата заказа\n")
        for i in range(20):
            fh.write(f"Москва;{100 + i};2026-01-{(i % 28) + 1:02d}\n")
    ingest_file(stage_file("tm", str(p)), "ds_m", "prodazhi.csv", "a.smirnova")
    return "ds_m"


def test_metriki_otdayutsya_bez_vhoda(client):
    r = client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")


def test_zapros_popadaet_v_schetchik(client, smirnova):
    client.get("/api/charts", headers=smirnova)
    body = client.get("/metrics").text
    # Считается шаблон маршрута, а не путь с идентификатором
    assert 'kobra_requests_total{method="GET",route="/api/charts",status="200"}' in body
    assert "kobra_request_seconds_total" in body


def test_v_metrikah_net_lichnogo(client, smirnova):
    client.post("/api/dashboards", json={"id": "d_secret", "title": "Зарплаты дирекции",
                                         "tabs": [], "filters": []}, headers=smirnova)
    client.get("/api/dashboards/d_secret", headers=smirnova)
    body = client.get("/metrics").text
    assert "a.smirnova" not in body
    assert "Зарплаты" not in body
    assert "d_secret" not in body
    # Идентификатор объекта остаётся шаблоном маршрута
    assert "{obj_id}" in body


def test_pul_soedineniy_ne_otricatelnyi(client):
    """`overflow()` ниже `pool_size` отрицателен — «минус восемь» в метрике
    сбивало бы с толку того, кто смотрит в график."""
    body = client.get("/metrics").text
    for line in body.splitlines():
        if line.startswith("kobra_db_pool"):
            assert float(line.rsplit(" ", 1)[1]) >= 0, line


def test_vyvod_razbiraetsya_postrochno(client, smirnova):
    client.get("/api/charts", headers=smirnova)
    for line in client.get("/metrics").text.strip().splitlines():
        if line.startswith("#"):
            assert line.split()[1] in ("HELP", "TYPE")
            continue
        name, _, value = line.rpartition(" ")
        assert name and float(value) >= 0


def test_medlennyi_raschet_popadaet_v_log(client, smirnova, ds_gotov, caplog, monkeypatch):
    """Порог в секундах, а не в миллисекундах: иначе в логе окажется каждый
    обычный расчёт, и найти в нём настоящую проблему будет нельзя."""
    import app.query_api as qa
    monkeypatch.setattr(qa, "SLOW_QUERY_MS", 0)
    with caplog.at_level(logging.WARNING, logger="kobra.query"):
        client.post(f"/api/datasets/{ds_gotov}/query",
                    json={"metrics": [{"kind": "simple", "agg": "COUNT", "col": "*"}]},
                    headers=smirnova)
    записи = [r.getMessage() for r in caplog.records if "Медленный расчёт" in r.getMessage()]
    assert записи, caplog.text
    assert ds_gotov in записи[0]
    assert "select" in записи[0].lower()
    assert "kobra_slow_queries_total" in client.get("/metrics").text


def test_obychnyi_raschet_v_log_ne_popadaet(client, smirnova, ds_gotov, caplog):
    with caplog.at_level(logging.WARNING, logger="kobra.query"):
        client.post(f"/api/datasets/{ds_gotov}/query",
                    json={"metrics": [{"kind": "simple", "agg": "COUNT", "col": "*"}]},
                    headers=smirnova)
    assert not [r for r in caplog.records if "Медленный расчёт" in r.getMessage()]


def test_predel_na_raschet(client, smirnova, ds_gotov, monkeypatch):
    """Один человек в цикле не должен занимать базу всем."""
    import app.limits as limits
    monkeypatch.setitem(limits.LIMITS, "query", (2, 60))
    spec = {"metrics": [{"kind": "simple", "agg": "COUNT", "col": "*"}]}
    codes = [client.post(f"/api/datasets/{ds_gotov}/query", json=dict(spec, limit=i + 1),
                         headers=smirnova).status_code for i in range(4)]
    assert codes[:2] == [200, 200]
    assert 429 in codes
    отказ = client.post(f"/api/datasets/{ds_gotov}/query", json=spec, headers=smirnova)
    assert "повторите через" in отказ.json()["detail"]
    assert 'kobra_rate_limited_total{scope="query"}' in client.get("/metrics").text


def test_predel_na_zapis(client, smirnova, monkeypatch):
    import app.limits as limits
    monkeypatch.setitem(limits.LIMITS, "write", (1, 60))
    first = client.post("/api/charts", json={"id": "c_a", "name": "А", "viz": "bar",
                                             "datasetId": "ds_1", "params": {}}, headers=smirnova)
    second = client.post("/api/charts", json={"id": "c_b", "name": "Б", "viz": "bar",
                                              "datasetId": "ds_1", "params": {}}, headers=smirnova)
    assert first.status_code == 201
    assert second.status_code == 429


def test_bez_redis_predel_ne_zapiraet(client, smirnova, ds_gotov, monkeypatch):
    """Правило то же, что у входа: недоступный кэш не останавливает работу."""
    import app.sessions as sessions
    monkeypatch.setattr(sessions, "redis_conn", lambda: (_ for _ in ()).throw(RuntimeError("нет Redis")))
    import app.limits as limits
    monkeypatch.setitem(limits.LIMITS, "query", (1, 60))
    spec = {"metrics": [{"kind": "simple", "agg": "COUNT", "col": "*"}]}
    codes = [client.post(f"/api/datasets/{ds_gotov}/query", json=dict(spec, limit=i + 1),
                         headers=smirnova).status_code for i in range(3)]
    assert codes == [200, 200, 200]


def test_neudavshiysya_otzyv_sessii_viden(caplog, monkeypatch):
    """Отозванная сессия продолжает работать — это вопрос доступа, и молчать о
    нём нельзя: один человек увидел отказ в своём окне, а знать должны все."""
    import app.sessions as sessions
    monkeypatch.setattr(sessions, "redis_conn", lambda: (_ for _ in ()).throw(RuntimeError("нет Redis")))
    with caplog.at_level(logging.WARNING, logger="kobra.sessions"):
        assert sessions.revoke("jti-1", 60) is False
        assert sessions.revoke_user(7, 60) is False
    сказано = " ".join(r.getMessage() for r in caplog.records)
    assert "Не удалось отозвать" in сказано
    assert "продолжает работать" in сказано
    assert metrics.snapshot()["kobra_session_revoke_failed_total"][()] == 2

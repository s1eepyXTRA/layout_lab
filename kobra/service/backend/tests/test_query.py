"""Расчёт в базе обязан совпадать с расчётом в браузере.

Проверяется то же, что умеет движок: агрегации, операции фильтров, шаг времени,
отношения, сортировка с лимитом. Расхождение здесь — худший вид ошибки: цифры
на экране начинают зависеть от того, где лежит набор.
"""
import io

import pytest

from app.ingest import ingest_file

ROWS = [
    # город, товар, выручка, себестоимость, дата
    ("Москва", "Ноутбук", "1000", "600", "2026-01-05"),
    ("Москва", "Мышь", "200", "150", "2026-01-20"),
    ("Казань", "Ноутбук", "800", "500", "2026-02-10"),
    ("Казань", "Мышь", "", "90", "2026-02-15"),
    ("Пермь", "Ноутбук", "400", "300", "2026-03-01"),
]


@pytest.fixture
def ds(client, make_user, login, auth, tmp_path, stage_file):
    make_user("a.smirnova", team="Продажи")
    h = auth(login("a.smirnova"))
    client.post("/api/datasets", json={"id": "ds_q", "name": "Продажи", "kind": "upload"}, headers=h)
    p = tmp_path / "prodazhi.csv"
    with io.open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write("Город;Товар;Выручка, ₽;Себестоимость, ₽;Дата заказа\n")
        for r in ROWS:
            fh.write(";".join(r) + "\n")
    ingest_file(stage_file("tq", str(p)), "ds_q", "prodazhi.csv", "a.smirnova")
    # Метрика-отношение: такие в движке считаются двумя аккумуляторами
    body = client.get("/api/datasets/ds_q", headers=h).json()
    body["metrics"] = body["metrics"] + [{
        "key": "marzha", "label": "Маржинальность", "format": "pct",
        "expr": {"type": "ratio", "mult": 100,
                 "num": {"agg": "SUM", "col": "vyruchka"},
                 "den": {"agg": "SUM", "col": "sebestoimost"}},
    }]
    client.put("/api/datasets/ds_q", json=body, headers=h)
    return h


def q(client, h, spec):
    r = client.post("/api/datasets/ds_q/query", json=spec, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_summa_po_razrezu(client, ds):
    res = q(client, ds, {"groupby": [{"col": "gorod"}],
                         "metrics": [{"kind": "simple", "agg": "SUM", "col": "vyruchka"}],
                         "orderby": [{"key": "Сумма: Выручка, ₽", "desc": True}]})
    assert [r["gorod"] for r in res["rows"]] == ["Москва", "Казань", "Пермь"]
    assert res["rows"][0]["Сумма: Выручка, ₽"] == 1200
    assert res["filteredCount"] == 5
    assert res["dims"][0]["label"] == "Город"
    assert res["mets"][0]["format"] == "rub_smart"


def test_vse_agregatsii(client, ds):
    res = q(client, ds, {"metrics": [
        {"kind": "simple", "agg": "SUM", "col": "vyruchka"},
        {"kind": "simple", "agg": "AVG", "col": "vyruchka"},
        {"kind": "simple", "agg": "MIN", "col": "vyruchka"},
        {"kind": "simple", "agg": "MAX", "col": "vyruchka"},
        {"kind": "simple", "agg": "MEDIAN", "col": "vyruchka"},
        {"kind": "simple", "agg": "COUNT", "col": "vyruchka"},
        {"kind": "simple", "agg": "COUNT_DISTINCT", "col": "gorod"},
        {"kind": "simple", "agg": "COUNT", "col": "*"},
    ]})
    row = res["rows"][0]
    assert row["Сумма: Выручка, ₽"] == 2400
    assert row["Среднее: Выручка, ₽"] == 600            # пустая ячейка не в счёт
    assert row["Минимум: Выручка, ₽"] == 200
    assert row["Максимум: Выручка, ₽"] == 1000
    assert row["Медиана: Выручка, ₽"] == 600
    assert row["Количество: Выручка, ₽"] == 4           # пустая ячейка не считается
    assert row["Уникальных: Город"] == 3
    assert row["Количество строк"] == 5


def test_shag_vremeni(client, ds):
    res = q(client, ds, {"groupby": [{"col": "data_zakaza", "grain": "month"}],
                         "metrics": [{"kind": "simple", "agg": "SUM", "col": "vyruchka"}],
                         "orderby": [{"key": "data_zakaza__month"}]})
    # Даты приходят UTC-миллисекундами, как в движке
    assert [r["data_zakaza__month"] for r in res["rows"]] == [1767225600000, 1769904000000, 1772323200000]
    assert [r["Сумма: Выручка, ₽"] for r in res["rows"]] == [1200, 800, 400]


def test_otnoshenie_schitaetsya_dvumya_akkumulyatorami(client, ds):
    res = q(client, ds, {"groupby": [{"col": "gorod"}],
                         "metrics": [{"kind": "saved", "key": "marzha"}],
                         "orderby": [{"key": "gorod"}]})
    by = {r["gorod"]: r["Маржинальность"] for r in res["rows"]}
    # Казань: 800 / (500 + 90) — знаменатель берёт и строку с пустой выручкой,
    # ровно как аккумулятор в браузере
    assert by["Казань"] == pytest.approx(800 / 590 * 100)
    assert by["Москва"] == pytest.approx(1200 / 750 * 100)


def test_filtry(client, ds):
    def one(f):
        res = q(client, ds, {"filters": [f],
                             "metrics": [{"kind": "simple", "agg": "COUNT", "col": "*"}]})
        return res["rows"][0]["Количество строк"]
    assert one({"col": "gorod", "op": "in", "val": ["Москва", "Пермь"]}) == 3
    assert one({"col": "gorod", "op": "not_in", "val": ["Москва"]}) == 3
    assert one({"col": "gorod", "op": "eq", "val": "Казань"}) == 2
    assert one({"col": "gorod", "op": "neq", "val": "Казань"}) == 3
    assert one({"col": "vyruchka", "op": "gt", "val": 400}) == 2
    assert one({"col": "vyruchka", "op": "gte", "val": 400}) == 3
    assert one({"col": "vyruchka", "op": "lt", "val": 400}) == 1
    assert one({"col": "vyruchka", "op": "lte", "val": 400}) == 2
    assert one({"col": "tovar", "op": "contains", "val": "ноут"}) == 3
    assert one({"col": "vyruchka", "op": "is_null"}) == 1
    assert one({"col": "vyruchka", "op": "not_null"}) == 4
    assert one({"col": "vyruchka", "op": "between", "val": [200, 800]}) == 3


def test_period_schitaetsya_ot_posledney_daty(client, ds):
    res = q(client, ds, {"filters": [{"col": "data_zakaza", "op": "time_range",
                                      "val": {"preset": "this_month"}}],
                         "metrics": [{"kind": "simple", "agg": "COUNT", "col": "*"}]})
    # Последняя дата в данных — 1 марта 2026, значит «последний месяц» это март
    assert res["rows"][0]["Количество строк"] == 1


def test_svoy_period(client, ds):
    res = q(client, ds, {"filters": [{"col": "data_zakaza", "op": "time_range",
                                      "val": {"preset": "custom", "from": "2026-01-01", "to": "2026-02-10"}}],
                         "metrics": [{"kind": "simple", "agg": "COUNT", "col": "*"}]})
    assert res["rows"][0]["Количество строк"] == 3


def test_limit_i_sortirovka(client, ds):
    res = q(client, ds, {"groupby": [{"col": "gorod"}],
                         "metrics": [{"kind": "simple", "agg": "SUM", "col": "vyruchka"}],
                         "orderby": [{"key": "Сумма: Выручка, ₽", "desc": True}], "limit": 2})
    assert [r["gorod"] for r in res["rows"]] == ["Москва", "Казань"]


def test_schema_nabor_ne_schitaetsya_na_servere(client, ds):
    client.post("/api/datasets", json={"id": "ds_mock", "name": "Макет", "kind": "schema"}, headers=ds)
    r = client.post("/api/datasets/ds_mock/query", json={"metrics": []}, headers=ds)
    assert r.status_code == 400


def test_chuzhoy_nabor_ne_schitaetsya(client, ds, make_user, login, auth):
    make_user("e.kuznecova", team="Поддержка")
    r = client.post("/api/datasets/ds_q/query", json={"metrics": []}, headers=auth(login("e.kuznecova")))
    assert r.status_code == 403


def test_ishodnye_stroki(client, ds):
    res = q(client, ds, {"raw": True, "columns": ["gorod", "vyruchka", "data_zakaza"],
                         "orderby": [{"key": "vyruchka", "desc": True}], "limit": 2})
    assert [r["gorod"] for r in res["rows"]] == ["Москва", "Казань"]
    assert res["rows"][0]["vyruchka"] == 1000
    # Дата приходит миллисекундами, как и в агрегатах
    assert res["rows"][0]["data_zakaza"] == 1767571200000
    assert res["filteredCount"] == 5


def test_ishodnye_stroki_s_filtrom(client, ds):
    res = q(client, ds, {"raw": True, "columns": ["gorod"],
                         "filters": [{"col": "gorod", "op": "eq", "val": "Казань"}], "limit": 100})
    assert len(res["rows"]) == 2


def test_nabor_bez_tablitsy_otvechaet_ponyatno(client, ds):
    """Описание набора и его таблица живут по отдельности и могут разойтись:
    таблица создаётся в рантайме и миграциями не управляется. Расчёт должен
    сказать, что строк нет, а не упасть пятисоткой."""
    from app.ingest import drop_dataset_table

    drop_dataset_table("ds_q")
    r = client.post("/api/datasets/ds_q/query",
                    json={"raw": True, "columns": ["gorod"], "limit": 10}, headers=ds)
    assert r.status_code == 404
    assert r.json()["detail"] == "Строки набора не найдены"

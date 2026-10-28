"""Разбор файла: типы, строки, состояние задачи и отказ без полуготового набора."""
import io
import os

import pytest
from sqlalchemy import text

from app.core import engine
from app.ingest import ingest_file, table_name
from app.queue import task_get

ROWS = 5000


@pytest.fixture
def ds(client, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    h = auth(login("a.smirnova"))
    client.post("/api/datasets", json={"id": "ds_file", "name": "Выгрузка", "kind": "upload"}, headers=h)
    return h


def write_csv(tmp_path, rows=ROWS, sep=";"):
    p = tmp_path / "vygruzka.csv"
    with io.open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write(sep.join(["Город", "Выручка, ₽", "Дата заказа"]) + "\n")
        for i in range(rows):
            fh.write(sep.join([["Москва", "Казань", "Пермь"][i % 3],
                               f"{1000 + i},50",
                               f"2026-01-{(i % 28) + 1:02d}"]) + "\n")
    return str(p)


def test_fayl_razbiraetsya_i_tipy_ugadany(client, ds, tmp_path, db):
    path = write_csv(tmp_path)
    res = ingest_file("t1", "ds_file", path, "vygruzka.csv", "a.smirnova")
    assert res["rows"] == ROWS
    kinds = {c["label"]: c["type"] for c in res["columns"]}
    assert kinds == {"Город": "string", "Выручка, ₽": "number", "Дата заказа": "date"}
    # Строки лежат в типизированной таблице и считаются базой, а не браузером
    with engine.connect() as conn:
        total, summa = conn.execute(text(
            f"select count(*), sum(vyruchka) from kobra_uploads.{table_name('ds_file')}"
        )).one()
    assert total == ROWS
    assert summa == pytest.approx(sum(1000 + i + 0.5 for i in range(ROWS)))
    # Временный файл за собой убрали
    assert not os.path.exists(path)


def test_sostoyanie_zadachi_dohodit_do_done(client, ds, tmp_path):
    ingest_file("t2", "ds_file", write_csv(tmp_path, rows=10), "vygruzka.csv", "a.smirnova")
    state = task_get("t2")
    assert state["state"] == "done"
    assert state["rows"] == 10


def test_nabor_stanovitsya_gotovym(client, ds, tmp_path):
    ingest_file("t3", "ds_file", write_csv(tmp_path, rows=10), "vygruzka.csv", "a.smirnova")
    got = client.get("/api/datasets/ds_file", headers=ds).json()
    assert got["state"] == "ready"
    assert got["rowCount"] == 10
    assert got["mainDttm"] == "data_zakaza"
    assert any(m["label"].startswith("Сумма") for m in got["metrics"])


def test_bityy_fayl_ne_ostavlyaet_poluготового_nabora(client, ds, tmp_path):
    p = tmp_path / "pustoy.csv"
    io.open(p, "w", encoding="utf-8").write("")
    with pytest.raises(ValueError):
        ingest_file("t4", "ds_file", str(p), "pustoy.csv", "a.smirnova")
    assert task_get("t4")["state"] == "error"
    with engine.connect() as conn:
        exists = conn.execute(text(
            "select to_regclass('kobra_uploads." + table_name("ds_file") + "')"
        )).scalar()
    assert exists is None


def test_excel_razbiraetsya(client, ds, tmp_path):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["Город", "Выручка"])
    for i in range(50):
        ws.append([["Москва", "Казань"][i % 2], 100 + i])
    p = tmp_path / "vygruzka.xlsx"
    wb.save(p)
    res = ingest_file("t5", "ds_file", str(p), "vygruzka.xlsx", "a.smirnova")
    assert res["rows"] == 50
    assert {c["type"] for c in res["columns"]} == {"string", "number"}


def test_zagruzka_cherez_api_stavit_zadachu(client, ds, tmp_path):
    path = write_csv(tmp_path, rows=20)
    with open(path, "rb") as fh:
        r = client.post("/api/datasets/ds_file/file", files={"file": ("vygruzka.csv", fh, "text/csv")}, headers=ds)
    assert r.status_code == 200, r.text
    task = r.json()["task"]
    assert client.get(f"/api/tasks/{task}", headers=ds).json()["state"] == "done"


def test_chuzhoy_nabor_fayl_ne_prinimaet(client, ds, tmp_path, make_user, login, auth):
    make_user("e.kuznecova", team="Поддержка")
    path = write_csv(tmp_path, rows=5)
    with open(path, "rb") as fh:
        r = client.post("/api/datasets/ds_file/file", files={"file": ("v.csv", fh, "text/csv")},
                        headers=auth(login("e.kuznecova")))
    assert r.status_code == 403

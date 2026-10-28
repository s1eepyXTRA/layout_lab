"""Строки загруженных наборов: хранятся на сервере и видны с другой машины."""
import pytest

from app.core import MAX_UPLOAD_ROWS

DATASET = {"id": "ds_csv", "name": "Выгрузка из 1С", "kind": "upload",
           "columns": [{"key": "city", "label": "Город", "type": "string"},
                       {"key": "revenue", "label": "Выручка", "type": "number"}]}
ROWS = [{"city": "Москва", "revenue": 120.5}, {"city": "Казань", "revenue": 80}]


@pytest.fixture
def owner(client, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    h = auth(login("a.smirnova"))
    client.post("/api/datasets", json=DATASET, headers=h)
    return h


def test_stroki_vidny_drugoy_sessii(client, owner, make_user, login, auth):
    assert client.put("/api/datasets/ds_csv/rows", json={"rows": ROWS}, headers=owner).json()["count"] == 2
    # Коллега по команде открывает набор у себя: строки те же и в том же порядке
    make_user("d.orlov", team="Продажи")
    r = client.get("/api/datasets/ds_csv/rows", headers=auth(login("d.orlov")))
    assert r.status_code == 200
    assert r.json()["rows"] == ROWS


def test_zapis_zamenyaet_prezhnie_stroki(client, owner):
    client.put("/api/datasets/ds_csv/rows", json={"rows": ROWS}, headers=owner)
    client.put("/api/datasets/ds_csv/rows", json={"rows": [{"city": "Пермь", "revenue": 10}]}, headers=owner)
    assert client.get("/api/datasets/ds_csv/rows", headers=owner).json()["rows"] == [{"city": "Пермь", "revenue": 10}]


def test_chuzhoy_nabor_ne_otdaet_stroki(client, owner, make_user, login, auth):
    client.put("/api/datasets/ds_csv/rows", json={"rows": ROWS}, headers=owner)
    make_user("e.kuznecova", team="Поддержка")
    assert client.get("/api/datasets/ds_csv/rows", headers=auth(login("e.kuznecova"))).status_code == 403


def test_tolko_tot_kto_pravit_pishet_stroki(client, owner, make_user, login, auth):
    make_user("d.orlov", team="Продажи")
    r = client.put("/api/datasets/ds_csv/rows", json={"rows": ROWS}, headers=auth(login("d.orlov")))
    assert r.status_code == 403


def test_predel_strok(client, owner):
    many = [{"city": "x", "revenue": i} for i in range(MAX_UPLOAD_ROWS + 1)]
    r = client.put("/api/datasets/ds_csv/rows", json={"rows": many}, headers=owner)
    assert r.status_code == 413


def test_udalenie_nabora_unosit_stroki(client, owner, db):
    from app.core import UploadRow
    client.put("/api/datasets/ds_csv/rows", json={"rows": ROWS}, headers=owner)
    assert client.delete("/api/datasets/ds_csv", headers=owner).status_code == 204
    assert db.query(UploadRow).filter(UploadRow.dataset_id == "ds_csv").count() == 0

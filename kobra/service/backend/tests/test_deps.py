"""Проверка прав стоит на пути к объекту, а не в обработчике.

Маршруты данных появятся дальше (группа 3); здесь проверяется сама зависимость,
через которую они будут проходить, — на отдельном приложении с двумя ручками.
"""
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core import Dashboard
from app.deps import object_for_read, object_for_write

probe = FastAPI()


@probe.get("/probe/{obj_id}")
def read_one(obj=Depends(object_for_read(Dashboard))):
    return {"id": obj.id, "title": obj.title}


@probe.put("/probe/{obj_id}")
def write_one(obj=Depends(object_for_write(Dashboard))):
    return {"id": obj.id, "ok": True}


@pytest.fixture
def probe_client():
    return TestClient(probe)


@pytest.fixture
def dash(db):
    def _make(owner="a.smirnova", team="Продажи", shared=None):
        d = Dashboard(id="d_test", title="Продажи филиалов", body={},
                      owner_login=owner, team=team, shared=shared or [])
        db.add(d)
        db.commit()
        return d
    return _make


def test_vladelets_chitaet_i_pravit(probe_client, dash, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    dash(owner="a.smirnova")
    h = auth(login("a.smirnova"))
    assert probe_client.get("/probe/d_test", headers=h).status_code == 200
    assert probe_client.put("/probe/d_test", headers=h).status_code == 200


def test_chuzhoy_obyekt_v_obhod_interfeysa_otklonen(probe_client, dash, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    make_user("e.kuznecova", team="Поддержка")
    dash(owner="a.smirnova", team="Продажи")
    h = auth(login("e.kuznecova"))
    r = probe_client.get("/probe/d_test", headers=h)
    assert r.status_code == 403
    assert r.json()["detail"] == "Нет доступа к объекту"


def test_vydannyi_dostup_otkryvaet_obyekt(probe_client, dash, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    make_user("e.kuznecova", team="Поддержка")
    dash(owner="a.smirnova", team="Продажи", shared=["e.kuznecova"])
    h = auth(login("e.kuznecova"))
    assert probe_client.get("/probe/d_test", headers=h).status_code == 200
    assert probe_client.put("/probe/d_test", headers=h).status_code == 200


def test_svoya_komanda_chitaet_no_ne_pravit(probe_client, dash, make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    make_user("d.orlov", team="Продажи")
    dash(owner="a.smirnova", team="Продажи")
    h = auth(login("d.orlov"))
    assert probe_client.get("/probe/d_test", headers=h).status_code == 200
    r = probe_client.put("/probe/d_test", headers=h)
    assert r.status_code == 403
    # Отказ объясняет, что делать: у кого просить доступ
    assert "доступ" in r.json()["detail"]


def test_bez_vhoda_ne_pustyat(probe_client, dash, make_user):
    make_user("a.smirnova")
    dash()
    assert probe_client.get("/probe/d_test").status_code == 401


def test_nesushchestvuyushchiy_obyekt(probe_client, make_user, login, auth):
    make_user("a.smirnova")
    r = probe_client.get("/probe/net-takogo", headers=auth(login("a.smirnova")))
    assert r.status_code == 404

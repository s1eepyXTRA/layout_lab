"""Объекты на сервере: сохранение без потерь, версия, списки по правам, доступ."""
import pytest

# Шаблон в том виде, в каком его отдаёт клиент: вкладки, фильтры и поля,
# о которых сервер ничего не знает и знать не должен
DASH = {
    "id": "d_sales",
    "title": "Продажи филиалов",
    "tabs": [{"id": "t1", "title": "Сводка", "items": [{"i": "i1", "type": "chart", "chartId": "c1",
                                                        "x": 0, "y": 0, "w": 6, "h": 8}]}],
    "filters": [{"id": "f1", "name": "Период", "type": "time", "col": "date"}],
    "scheme": "superset",
    "crossFilter": True,
    "fromTemplate": {"tplId": "money", "datasetId": "ds_1", "levels": ["sum"], "roles": {"dim1": "city"}},
}

CHART = {
    "id": "c1",
    "name": "Выручка по месяцам",
    "viz": "bar",
    "datasetId": "ds_1",
    "params": {"x_col": "date", "x_grain": "month", "metric": {"kind": "simple", "agg": "SUM", "col": "revenue"}},
    "autoName": True,
    "spec": {"question": "Как меняется выручка?", "priority": "высокий"},
}

DATASET = {
    "id": "ds_1",
    "name": "Данные макета",
    "kind": "schema",
    "columns": [{"key": "date", "label": "Дата", "type": "date"}],
    "metrics": [{"key": "revenue", "label": "Выручка, ₽", "expr": {"type": "simple", "agg": "SUM", "col": "revenue"}}],
    "mainDttm": "date",
    "schema": {"seed": 42, "rowCount": 2000, "columns": [{"key": "date", "type": "date"}]},
}


@pytest.fixture
def smirnova(make_user, login, auth):
    make_user("a.smirnova", team="Продажи")
    return auth(login("a.smirnova"))


def test_sohranennyi_obyekt_vozvrashchaetsya_tselikom(client, smirnova):
    r = client.post("/api/dashboards", json=DASH, headers=smirnova)
    assert r.status_code == 201, r.text
    got = client.get("/api/dashboards/d_sales", headers=smirnova).json()
    # Всё, что прислал клиент, вернулось без потерь
    for key, value in DASH.items():
        assert got[key] == value, key
    # Сервер добавил своё и ничего не выдумал сверх этого
    assert got["ownerLogin"] == "a.smirnova"
    assert got["team"] == "Продажи"
    assert got["shared"] == []
    assert got["version"] == 1
    assert set(got) == set(DASH) | {"ownerLogin", "team", "shared", "version", "updated", "updatedBy"}


def test_grafik_i_nabor_tozhe_bez_poter(client, smirnova):
    assert client.post("/api/charts", json=CHART, headers=smirnova).status_code == 201
    assert client.post("/api/datasets", json=DATASET, headers=smirnova).status_code == 201
    chart = client.get("/api/charts/c1", headers=smirnova).json()
    assert chart["spec"] == CHART["spec"] and chart["autoName"] is True
    ds = client.get("/api/datasets/ds_1", headers=smirnova).json()
    assert ds["schema"] == DATASET["schema"] and ds["metrics"] == DATASET["metrics"]


def test_povtornyi_identifikator_otklonen(client, smirnova):
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    assert client.post("/api/dashboards", json=DASH, headers=smirnova).status_code == 409


def test_pravka_podnimaet_versiyu(client, smirnova):
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    body = dict(DASH, title="Продажи филиалов и городов", version=1)
    r = client.put("/api/dashboards/d_sales", json=body, headers=smirnova)
    assert r.status_code == 200
    assert r.json()["version"] == 2
    assert r.json()["title"] == "Продажи филиалов и городов"


def test_ustarevshaya_versiya_otklonyaetsya(client, smirnova):
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    client.put("/api/dashboards/d_sales", json=dict(DASH, version=1), headers=smirnova)
    # Вторая сессия всё ещё думает, что видела первую версию
    r = client.put("/api/dashboards/d_sales", json=dict(DASH, title="Чужая правка", version=1), headers=smirnova)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["error"] == "version_conflict"
    # Текущее состояние приходит вместе с отказом: клиенту есть что показать
    assert detail["current"]["version"] == 2


def test_bez_versii_zapis_ne_prinimaetsya(client, smirnova):
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    assert client.put("/api/dashboards/d_sales", json=DASH, headers=smirnova).status_code == 422


def test_spisok_pokazyvaet_chetyre_sluchaya_vidimosti(client, make_user, login, auth, db):
    from app.core import Dashboard
    make_user("a.smirnova", team="Продажи")
    make_user("d.orlov", team="Продажи")
    make_user("e.kuznecova", team="Поддержка")
    db.add_all([
        Dashboard(id="d_own", title="Своё", body={}, owner_login="d.orlov", team="Продажи", shared=[]),
        Dashboard(id="d_team", title="Командное", body={}, owner_login="a.smirnova", team="Продажи", shared=[]),
        Dashboard(id="d_public", title="Общее", body={}, owner_login="kobra", team="*", shared=[]),
        Dashboard(id="d_shared", title="Выданное", body={}, owner_login="e.kuznecova", team="Поддержка",
                  shared=["d.orlov"]),
        Dashboard(id="d_alien", title="Чужое", body={}, owner_login="e.kuznecova", team="Поддержка", shared=[]),
    ])
    db.commit()
    ids = {d["id"] for d in client.get("/api/dashboards", headers=auth(login("d.orlov"))).json()}
    assert ids == {"d_own", "d_team", "d_public", "d_shared"}


def test_skrytyi_nabor_maketa_ne_popadaet_v_spisok(client, smirnova):
    client.post("/api/datasets", json=DATASET, headers=smirnova)
    client.post("/api/datasets", json=dict(DATASET, id="ds_hidden", name="Данные шаблона",
                                           owner="d_sales"), headers=smirnova)
    ids = {d["id"] for d in client.get("/api/datasets", headers=smirnova).json()}
    assert ids == {"ds_1"}
    # Но по явному запросу он есть: шаблону его данные нужны
    ids_all = {d["id"] for d in client.get("/api/datasets?owned_by_dashboard=true", headers=smirnova).json()}
    assert "ds_hidden" in ids_all


def test_vydacha_dostupa_otkryvaet_obyekt(client, smirnova, make_user, login, auth):
    make_user("e.kuznecova", team="Поддержка")
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    chuzhoy = auth(login("e.kuznecova"))
    assert client.get("/api/dashboards/d_sales", headers=chuzhoy).status_code == 403
    r = client.post("/api/dashboards/d_sales/share", json={"login": "e.kuznecova"}, headers=smirnova)
    assert r.status_code == 200 and r.json()["shared"] == ["e.kuznecova"]
    assert client.get("/api/dashboards/d_sales", headers=chuzhoy).status_code == 200
    # Отзыв возвращает всё как было
    client.post("/api/dashboards/d_sales/share", json={"login": "e.kuznecova", "remove": True}, headers=smirnova)
    assert client.get("/api/dashboards/d_sales", headers=chuzhoy).status_code == 403


def test_dostup_vydaetsya_tolko_tem_kto_pravit(client, smirnova, make_user, login, auth):
    make_user("d.orlov", team="Продажи")
    make_user("e.kuznecova", team="Поддержка")
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    # Коллега по команде видит шаблон, но раздавать доступ не может
    r = client.post("/api/dashboards/d_sales/share", json={"login": "e.kuznecova"},
                    headers=auth(login("d.orlov")))
    assert r.status_code == 403


def test_vladeltsu_dostup_ne_vydaetsya_povtorno(client, smirnova):
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    r = client.post("/api/dashboards/d_sales/share", json={"login": "a.smirnova"}, headers=smirnova)
    assert r.status_code == 422


def test_udalenie_tolko_tem_kto_pravit(client, smirnova, make_user, login, auth):
    make_user("d.orlov", team="Продажи")
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    assert client.delete("/api/dashboards/d_sales", headers=auth(login("d.orlov"))).status_code == 403
    assert client.delete("/api/dashboards/d_sales", headers=smirnova).status_code == 204
    assert client.get("/api/dashboards/d_sales", headers=smirnova).status_code == 404


def test_bez_kataloga_neizvestnyi_login_ne_zavoditsya(client, smirnova, db):
    """Без каталога логин взять негде: придумывать сотрудника нельзя."""
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    r = client.post("/api/dashboards/d_sales/share", json={"login": "n.novikov"}, headers=smirnova)
    assert r.status_code == 404
    from app.core import User
    assert db.query(User).filter(User.username == "n.novikov").count() == 0


# ---------- Краткая форма списка ----------

def test_spisok_prihodit_bez_tel(client, smirnova):
    """Список с телами означал, что человек при входе скачивает всю видимую ему
    работу — у роли, видящей чужое, работу всей компании, и при каждой загрузке
    страницы."""
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    client.post("/api/charts", json=CHART, headers=smirnova)
    d = client.get("/api/dashboards", headers=smirnova).json()[0]
    assert "tabs" not in d and "filters" not in d and "fromTemplate" not in d
    assert d["brief"] is True
    # Карточке хватает того, что осталось
    assert d["title"] == "Продажи филиалов"
    assert d["summary"]["tabs"] == 1
    assert d["summary"]["charts"] == 1
    assert d["summary"]["chartIds"] == ["c1"]
    assert d["summary"]["thumb"][0]["w"] == 6
    c = client.get("/api/charts", headers=smirnova).json()[0]
    assert "params" not in c and "autoName" not in c and "spec" not in c
    # Вид, набор, заполненность ТЗ и бизнес-вопрос нужны самой карточке
    assert (c["viz"], c["datasetId"]) == ("bar", "ds_1")
    assert c["summary"] == {"spec": 2, "question": "Как меняется выручка?"}


def test_telo_priezzhaet_po_identifikatoram(client, smirnova):
    """Страница дашборда берёт тела всех своих блоков одним запросом, а не по
    одному на блок."""
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    client.post("/api/charts", json=CHART, headers=smirnova)
    got = client.get("/api/charts?ids=c1", headers=smirnova).json()
    assert len(got) == 1
    assert got[0]["params"]["x_grain"] == "month"
    assert "brief" not in got[0]
    d = client.get("/api/dashboards?ids=d_sales", headers=smirnova).json()[0]
    assert d["tabs"][0]["items"][0]["chartId"] == "c1"


def test_paket_tel_uvazhaet_prava(client, smirnova, make_user, login, auth):
    """Пакетная выдача не должна стать дырой в обход проверки доступа."""
    client.post("/api/charts", json=CHART, headers=smirnova)
    make_user("p.orlov", team="Логистика")
    other = auth(login("p.orlov"))
    assert client.get("/api/charts?ids=c1", headers=other).json() == []


def test_spisok_otdaetsya_stranicami(client, smirnova):
    for i in range(5):
        client.post("/api/charts", json=dict(CHART, id=f"c{i}", name=f"График {i}"), headers=smirnova)
    first = client.get("/api/charts?limit=2", headers=smirnova).json()
    second = client.get("/api/charts?limit=2&offset=2", headers=smirnova).json()
    assert len(first) == 2 and len(second) == 2
    assert {c["id"] for c in first} & {c["id"] for c in second} == set()


def test_svodka_obnovlyaetsya_pri_pravke(client, smirnova):
    """Сводка считается при записи: иначе список снова читал бы тела."""
    client.post("/api/dashboards", json=DASH, headers=smirnova)
    two_tabs = dict(DASH, version=1, tabs=DASH["tabs"] + [
        {"id": "t2", "title": "Разбор", "items": [{"i": "i2", "type": "chart", "chartId": "c9",
                                                   "x": 0, "y": 0, "w": 12, "h": 8}]}])
    client.put("/api/dashboards/d_sales", json=two_tabs, headers=smirnova)
    d = client.get("/api/dashboards", headers=smirnova).json()[0]
    assert d["summary"]["tabs"] == 2
    assert d["summary"]["chartIds"] == ["c1", "c9"]

"""Права на сервере.

Случаи те же, что в `kobra/test/auth.test.js`: если серверные правила разойдутся
с клиентскими, интерфейс начнёт обещать то, чего сервер не даст.
"""
from app.access import TEAM_ALL, can_edit, can_share, can_view
from app.core import Dashboard, User


def person(login, role="Gamma", team="Продажи"):
    return User(username=login, role=role, team=team, full_name=login, groups=[], active=True)


def obj(owner="a.smirnova", team="Продажи", shared=None):
    return Dashboard(id="d1", title="Шаблон", body={}, owner_login=owner, team=team, shared=shared or [])


def test_vladelets_pravit_svoe():
    u = person("a.smirnova")
    o = obj(owner="a.smirnova")
    assert can_view(u, o) and can_edit(u, o) and can_share(u, o)


def test_svoya_komanda_vidit_no_ne_pravit():
    u = person("d.orlov", team="Продажи")
    o = obj(owner="a.smirnova", team="Продажи")
    assert can_view(u, o)
    assert not can_edit(u, o)


def test_chuzhaya_komanda_ne_vidit():
    u = person("e.kuznecova", team="Поддержка")
    o = obj(owner="a.smirnova", team="Продажи")
    assert not can_view(u, o)
    assert not can_edit(u, o)


def test_tot_s_kem_podelilis_pravit_naravne():
    u = person("e.kuznecova", team="Поддержка")
    o = obj(owner="a.smirnova", team="Продажи", shared=["e.kuznecova"])
    assert can_view(u, o) and can_edit(u, o) and can_share(u, o)


def test_alpha_vidit_chuzhoe_no_pravit_tolko_svoe():
    u = person("i.volkov", role="Alpha", team="Аналитика")
    chuzhoy = obj(owner="a.smirnova", team="Продажи")
    svoy = obj(owner="i.volkov", team="Аналитика")
    assert can_view(u, chuzhoy)
    assert not can_edit(u, chuzhoy)
    assert can_edit(u, svoy)


def test_alpha_pravit_vydannoe():
    u = person("i.volkov", role="Alpha", team="Аналитика")
    o = obj(owner="a.smirnova", team="Продажи", shared=["i.volkov"])
    assert can_edit(u, o)


def test_admin_mozhet_vse():
    u = person("i.petrov", role="Admin", team="Отдел данных")
    o = obj(owner="a.smirnova", team="Продажи")
    assert can_view(u, o) and can_edit(u, o) and can_share(u, o)


def test_obshchiy_obyekt_viden_vsem_a_pravit_admin():
    gamma = person("d.orlov", team="Поддержка")
    admin = person("i.petrov", role="Admin", team="Отдел данных")
    o = obj(owner="kobra", team=TEAM_ALL)
    assert can_view(gamma, o)
    assert not can_edit(gamma, o)
    assert can_edit(admin, o)


def test_bez_vhoda_ne_vidno_nichego():
    o = obj()
    assert not can_view(None, o)
    assert not can_edit(None, o)


def test_obyekt_bez_komandy_chuzhomu_ne_viden():
    u = person("d.orlov", team="Поддержка")
    o = obj(owner="a.smirnova", team="")
    assert not can_view(u, o)

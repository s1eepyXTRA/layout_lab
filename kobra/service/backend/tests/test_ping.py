"""Проба режима: по ней клиент решает, что за страницей сервис.

Отвечает без входа — решение о режиме нужно до экрана входа. Пределы загрузки
тоже здесь: их применяет сервис, значит он и должен их называть. Раньше клиент
предупреждал человека своим числом (300 000), которое к серверу отношения не
имело, а в серверном режиме не предупреждал вовсе.
"""
from app.core import MAX_UPLOAD_ROWS
from app.upload import MAX_FILE_MB


def test_proba_otvechaet_bez_vhoda(client):
    r = client.get("/api/ping")
    assert r.status_code == 200
    assert r.json()["mode"] == "server"


def test_predely_zagruzki_nazvany(client):
    body = client.get("/api/ping").json()
    assert body["maxRows"] == MAX_UPLOAD_ROWS
    assert body["maxFileMb"] == MAX_FILE_MB


def test_v_probe_net_lishnego(client):
    """Проба отвечает без сессии, поэтому в ней не должно быть ничего, кроме
    режима, способа входа и пределов.

    Про модель сказано «настроена или нет» и предел длины описания — ни адреса
    шлюза, ни названия модели: экрану входа они не нужны, а светить внутреннюю
    инфраструктуру без сессии незачем."""
    assert set(client.get("/api/ping").json()) == {
        "kobra", "mode", "auth", "maxRows", "maxFileMb", "ai", "aiMaxChars"}

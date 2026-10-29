"""Вход через каталог LDAP.

Настройки названы именами FAB — теми же, что в клиенте (`kobra/src/auth.js`) и в
`superset_config.py`. Это не косметика: администратор, который настраивал
Superset, настраивает Кобру теми же словами и не ищет соответствий.

Порядок работы обычный для каталога:

1. Если задана служебная учётка (`AUTH_LDAP_BIND_USER`), подключаемся ею и ищем
   человека по `AUTH_LDAP_UID_FIELD`. Иначе собираем DN по шаблону.
2. Подключаемся **его** DN и его паролем — это и есть проверка пароля. Сам
   пароль нигде не сохраняется: в базе у такого человека пустой хеш.
3. Группы берём из атрибута (`memberOf`), а если каталог его не отдаёт — ищем
   группы, где человек состоит участником. Второй путь нужен чаще, чем кажется:
   overlay memberof включён далеко не везде.

Две ошибки, которые нельзя путать: «каталог недоступен» и «неверный пароль».
Первое — техническая неисправность, и человеку надо сказать именно это, иначе он
будет в десятый раз перенабирать верный пароль.
"""
import json
import os
from typing import Optional

AUTH_TYPE = os.environ.get("KOBRA_AUTH_TYPE", "db")
LDAP_SERVER = os.environ.get("KOBRA_AUTH_LDAP_SERVER", "")
LDAP_SEARCH = os.environ.get("KOBRA_AUTH_LDAP_SEARCH", "")
LDAP_UID_FIELD = os.environ.get("KOBRA_AUTH_LDAP_UID_FIELD", "uid")
LDAP_GROUP_FIELD = os.environ.get("KOBRA_AUTH_LDAP_GROUP_FIELD", "memberOf")
LDAP_BIND_USER = os.environ.get("KOBRA_AUTH_LDAP_BIND_USER", "")
LDAP_BIND_PASSWORD = os.environ.get("KOBRA_AUTH_LDAP_BIND_PASSWORD", "")
LDAP_EMAIL_FIELD = os.environ.get("KOBRA_AUTH_LDAP_EMAIL_FIELD", "mail")
LDAP_NAME_FIELD = os.environ.get("KOBRA_AUTH_LDAP_NAME_FIELD", "cn")
LDAP_TEAM_FIELD = os.environ.get("KOBRA_AUTH_LDAP_TEAM_FIELD", "departmentNumber")
LDAP_TIMEOUT = int(os.environ.get("KOBRA_AUTH_LDAP_TIMEOUT_SEC", "5"))


def roles_mapping() -> dict:
    """Группа каталога → роль. Задаётся JSON-ом, как `AUTH_ROLES_MAPPING`."""
    raw = os.environ.get("KOBRA_AUTH_ROLES_MAPPING", "")
    if not raw:
        return {}
    try:
        return {str(k).lower(): v for k, v in json.loads(raw).items()}
    except (ValueError, AttributeError):
        print("ВНИМАНИЕ: KOBRA_AUTH_ROLES_MAPPING не разобрать, роли из групп выдаваться не будут")
        return {}


class LdapUnavailable(RuntimeError):
    """Каталог не отвечает. Это не «неверный пароль»."""


class LdapDenied(RuntimeError):
    """Каталог ответил: такого человека нет или пароль не подошёл."""


def role_for_groups(groups: list) -> Optional[str]:
    """Первая подошедшая группа даёт роль. Порядок — как в сопоставлении."""
    mapping = roles_mapping()
    for dn, role in mapping.items():
        if any(dn == str(g).lower() for g in groups):
            return role
    return None


def ldap_login(username: str, password: str) -> dict:
    """Проверить человека в каталоге. Возвращает его данные для записи в базу."""
    from ldap3 import ALL_ATTRIBUTES, Connection, Server
    from ldap3.core.exceptions import LDAPException, LDAPSocketOpenError

    if not LDAP_SERVER or not LDAP_SEARCH:
        raise LdapUnavailable("Каталог не настроен: нужны AUTH_LDAP_SERVER и AUTH_LDAP_SEARCH")
    if not password:
        # Анонимный bind в LDAP с пустым паролем «успешен» — и пустил бы кого угодно
        raise LdapDenied("Пустой пароль")

    server = Server(LDAP_SERVER, connect_timeout=LDAP_TIMEOUT, get_info=None)
    try:
        entry = _find_user(server, username)
        dn = entry["dn"]
        user_conn = Connection(server, user=dn, password=password, auto_bind=False,
                               receive_timeout=LDAP_TIMEOUT)
        if not user_conn.bind():
            raise LdapDenied("Пароль не подошёл")
        try:
            # Группы уже могли приехать со служебной учёткой; если нет — пробуем
            # его же связью, но это работает не везде: каталоги часто не
            # показывают дерево обычному сотруднику
            groups = entry["groups"] or _groups_of(user_conn, dn, entry["attrs"])
        finally:
            user_conn.unbind()
    except LDAPSocketOpenError as e:
        raise LdapUnavailable(str(e))
    except LDAPException as e:
        # Прочие ошибки протокола — это тоже неисправность, а не неверный пароль
        raise LdapUnavailable(str(e))

    attrs = entry["attrs"]
    return {
        "login": username,
        "name": _one(attrs.get(LDAP_NAME_FIELD)) or username,
        "email": _one(attrs.get(LDAP_EMAIL_FIELD)) or "",
        "team": _one(attrs.get(LDAP_TEAM_FIELD)) or "",
        "groups": groups,
        "role": role_for_groups(groups),
    }


def _find_user(server, username: str) -> dict:
    """DN человека и его атрибуты. Со служебной учёткой — поиском, без неё — по шаблону."""
    from ldap3 import ALL_ATTRIBUTES, Connection
    from ldap3.core.exceptions import LDAPException

    safe = _escape(username)
    if LDAP_BIND_USER:
        conn = Connection(server, user=LDAP_BIND_USER, password=LDAP_BIND_PASSWORD,
                          auto_bind=False, receive_timeout=LDAP_TIMEOUT)
        if not conn.bind():
            raise LdapUnavailable("Служебная учётная запись не подошла каталогу")
        try:
            conn.search(LDAP_SEARCH, f"({LDAP_UID_FIELD}={safe})", attributes=ALL_ATTRIBUTES)
            if not conn.entries:
                raise LdapDenied("Такого логина нет в каталоге")
            e = conn.entries[0]
            attrs = e.entry_attributes_as_dict
            # Группы ищем здесь же, служебной учёткой: у самого сотрудника прав
            # на обход дерева может не быть, и роль тогда молча не выдастся
            return {"dn": e.entry_dn, "attrs": attrs, "groups": _groups_of(conn, e.entry_dn, attrs)}
        finally:
            conn.unbind()
    # Без служебной учётки искать нечем: собираем DN по шаблону и проверяем паролем
    return {"dn": f"{LDAP_UID_FIELD}={safe},{LDAP_SEARCH}", "attrs": {}, "groups": []}


def _groups_of(conn, dn: str, attrs: dict) -> list:
    """Группы человека: из атрибута или поиском по участию."""
    from ldap3 import ALL_ATTRIBUTES

    direct = attrs.get(LDAP_GROUP_FIELD)
    if direct:
        return [str(g) for g in direct]
    try:
        base = LDAP_SEARCH.split(",", 1)[-1] if "," in LDAP_SEARCH else LDAP_SEARCH
        conn.search(base, f"(member={_escape(dn)})", attributes=ALL_ATTRIBUTES)
        return [e.entry_dn for e in conn.entries]
    except Exception:
        return []


def _one(v):
    if isinstance(v, list):
        return str(v[0]) if v else ""
    return str(v) if v is not None else ""


def _escape(v: str) -> str:
    """Экранирование для фильтра LDAP: без него логин со звёздочкой или скобкой
    меняет смысл запроса — это инъекция, просто не в SQL."""
    out = []
    for ch in str(v):
        if ch in "\\*()\0":
            out.append("\\%02x" % ord(ch))
        else:
            out.append(ch)
    return "".join(out)

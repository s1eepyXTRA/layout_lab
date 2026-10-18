# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## О проекте

«Кобра» — браузерный прототип конструктора дашбордов в стиле Superset. Весь код живёт в `kobra/`,
собирается в один HTML-файл. Ни npm, ни бандлера, ни тестов нет: `src/*.js` — это обычные скрипты
с глобальными функциями, которые `build.py` склеивает в `<script>` внутри HTML. Данные и дашборды
хранятся только в браузере (localStorage + IndexedDB). Интерфейс и весь код на русском языке
(комментарии, названия, сообщения об ошибках) — продолжай в том же стиле.

## Команды

```bash
cd kobra
py build.py           # → build/index.html  (библиотеки с CDN jsdelivr, нужен интернет)
py build.py offline   # → build/kobra.html  (всё внутри файла, открывается двойным щелчком)
node service/tools/export_demo.js   # перегенерировать service/backend/app/demo/*.csv.gz из src/data.js
for f in src/*.js; do node --check "$f"; done   # единственная доступная проверка синтаксиса
```

На этой машине работает `py`, а не `python3` (`python`/`python3` — заглушки Microsoft Store и печатают только «Python»); в README команды записаны как `python3`.

Тестов нет, проверка изменений — вручную: пересобрать и открыть `build/index.html` в браузере.
`.claude/launch.json` поднимает `py -m http.server 8777 --directory kobra/build` — приложению нужен http,
потому что оно ходит по `history.pushState`. В скрытом окне браузера `requestAnimationFrame` не срабатывает,
а `paintGrid` отдаёт туда и раскладку, и первую отрисовку графиков — поэтому в свёрнутом окне сетка
остаётся пустой; это не поломка, достаточно показать окно.
Файлы в `build/` закоммичены, поэтому после правок в `src/` **нужно пересобрать оба варианта**,
иначе репозиторий окажется в рассинхроне.

## Сборка и порядок файлов

`build.py` склеивает `src/styles.css` + `src/*.js` в порядке `ORDER`:
`data → engine → ui → viz → app → dashboard → explore → datasets → schema → share`. Порядок важен —
это и есть вся система зависимостей: верхнеуровневые `const` видят только то, что объявлено раньше
(объявления функций поднимаются, поэтому вызывать функцию из более позднего файла можно).
Новый файл в `src/` не подхватится, пока его не добавят в `ORDER`.

ECharts, marked и DOMPurify подключаются в `<head>`; SheetJS и PapaParse (Excel/CSV) грузятся лениво
через `loadScript()` — в офлайн-сборке `build.py` патчит `loadScript`, чтобы он возвращал уже
вшитые библиотеки. Точка входа — `boot()` в `app.js`, вызывается из инлайн-скрипта в HTML.

## Архитектура

### Движок (`engine.js`)

Всё считается в памяти по массиву JS-объектов — SQL нет.

- `DS` — глобальный реестр наборов данных: `{id, name, columns:[{key,label,type}], metrics, rows, mainDttm}`.
  Тип колонки — `'string' | 'number' | 'date'`; даты всюду хранятся как UTC-миллисекунды, форматируются
  через `fmtDate`/`truncTime`/`shiftTime` (все по UTC — так расчёты не зависят от часового пояса).
- `runQuery(ds, spec)` — единственный способ получить данные для графика.
  `spec = {filters, groupby:[{col,grain}], metrics:[metric], orderby:[{key,desc}], limit}`,
  ответ — `{rows, dims, mets, filteredCount}`, где `dims[].key` = `col` или `col__grain`,
  а `mets[].key` = человекочитаемая подпись метрики (по ней же и достаются значения из `rows`).
- Метрика в параметрах графика: `{kind:'saved', key}` (ссылка на `ds.metrics`) либо
  `{kind:'simple', agg, col}`. Сохранённая метрика хранит `expr`: `{type:'simple', agg, col}` или
  `{type:'ratio', num, den, mult}` — отношения считаются как два аккумулятора, а не делением готовых
  агрегатов, поэтому «Маржинальность» правильна на любом уровне группировки.
- Агрегации собираются в `makeAcc`/`compileMetric` как тройки `{init, add, fin}` — это позволяет
  обойти строки один раз на весь запрос. Новая агрегация добавляется в `AGGS` + `makeAcc`.
- Фильтр — `{col, op, val}`, `op` из `FILTER_OPS` плюс особый `time_range`
  (`{preset, from, to}`, см. `TIME_PRESETS`/`resolveTimeRange`). **Относительные периоды считаются
  от последней даты в данных**, а не от «сегодня», — демо-данные заканчиваются 31.08.2026.

### Реестр визуализаций (`viz.js`)

`VIZ[type] = { label, en, icon, desc, controls, defaults(ds), render(root, ctx) }`, порядок в галерее —
`VIZ_ORDER`. 13 типов; `line/area/bar` построены на общих `xyControls`/`xyDefaults`/`renderXY`.

- `controls` — декларативная схема: секции `{title, tab:'data'|'view', controls:[...]}`, где контрол
  это `{key, type, label, def?, showIf?(p, ds), ...}`. Типы контролов рендерит `buildControl` в
  `explore.js` (`column`, `columns`, `metric`, `metrics`, `filters`, `timerange`, `grain`, `select`,
  `segment`, `check`, `number`, `scheme`, `format`, …). Общие контролы — `C_TIME`, `C_FILTERS`,
  `C_SCHEME`, `C_FORMAT`, `C_LEGEND`, `C_LIMIT`.
- `render(root, ctx)` получает `ctx = {ds, params, colors, filters, setData, cross, crossActive}`:
  `params` — это `defaults(ds)` поверх сохранённых, `filters` уже собраны из ad-hoc фильтров графика,
  его периода и фильтров дашборда (`buildChartFilters`). Обязанности рендерера: вызвать `ctx.setData(res)`
  (питает пункт «Посмотреть данные»), отрисовать через `ecInit(root)` или DOM, повесить клик
  на `ctx.cross([...filters])` для кросс-фильтрации и приглушить невыбранное (`crossSet`/`dimInactive`).
  Исключения ловит `renderChart`, так что внутри можно смело бросать понятные ошибки.
- Новый тип графика = запись в `VIZ` + ключ в `VIZ_ORDER` + иконка `v_*` в `ICONS` (`ui.js`).

### Состояние и страницы

- `STATE` (`app.js`) — весь пользовательский мир: `{v:1, charts, dashboards, datasets, dsMetrics, theme}`,
  пишется в localStorage под `kobra.state.v1` через `saveState()`/`saveSoon()`. При смене формы данных
  поднимай `v` — `boot()` при несовпадении пересоздаёт состояние из `seedState()`.
- `seedState()` — демо-дашборд «Продажи DNS» целиком в коде: 23 графика и 4 вкладки заданы вызовами
  `mk(...)`/`ch(...)`. Это и эталонный пример всех параметров графиков, и то, что восстанавливает
  «Вернуть демо-дашборд».
- Роутер — на хэше, `route()` в `app.js`: `#/dashboards`, `#/d/<id>?edit=1`, `#/charts`,
  `#/explore/<id|new>?ds=&viz=&back=`, `#/data[/<id>]`. Каждая страница-рендерер возвращает функцию
  очистки (её зовут при следующем переходе — там снимают `ResizeObserver` и `dispose()` у ECharts).
- `dashboard.js` — своя сетка 12 колонок (`G_COLS/G_ROWH/G_GAP`) с абсолютным позиционированием,
  перетаскиванием, `compactLayout()` и отдельной одноколоночной раскладкой при ширине < 760.
  Режим правки работает на клоне дашборда (черновик), фильтры — через `pending` + кнопку «Применить».
  Кросс-фильтры живут в `crossMemory[dashId]` (не сохраняются), по одному набору на график-источник.
- `datasets.js` — загрузка CSV/Excel: парсинг → угадывание типов (`guessType`, `parseNumberLoose`,
  `parseDateLoose`) → предпросмотр → `saveUploaded()`. Метаданные идут в `STATE.datasets`,
  строки — в IndexedDB (`idb`, ключ `rows:<id>`), лимит `MAX_UPLOAD_ROWS`.
  Пользовательские метрики встроенных наборов хранятся отдельно в `STATE.dsMetrics` и
  накладываются в `applyDsOverrides()`, потому что сами наборы генерируются заново при каждом запуске.
- `data.js` — детерминированная генерация демо-данных (`mulberry32` с фиксированным seed), так что
  цифры одинаковы у всех. Описания наборов — в `BUILTIN_DATASETS`. Изменил генерацию — перезапусти
  `service/tools/export_demo.js` (он читает `src/data.js` через `eval`, то есть файл должен
  оставаться валидным скриптом без `export`).

### Наборы-схемы (`schema.js`)

Набор, у которого есть только описание колонок: строки придумываются по `schema`
(`{seed, rowCount, dateFrom, dateTo, columns:[{key,label,type,values?,min?,max?,decimals?}]}`).
Такой набор помечен `kind: 'schema'` и **не хранится в IndexedDB** — `loadUploaded()` при старте
зовёт `generateSchemaRows(meta.schema)`, поэтому цифры одинаковы при каждом открытии и на любой машине
(один и тот же `seed`). Период дат фиксируется в схеме при создании: иначе строки менялись бы каждый день.
Генератор намеренно даёт длинный хвост (большинство значений у нижней границы, в максимум упирается
около 1 % строк) и разный масштаб по первой текстовой колонке, чтобы макет выглядел как живые данные.
Тип и правдоподобные значения колонки угадываются по её названию (`SCHEMA_HINTS`, `guessSchemaCol`),
а «, ₽» или «, шт.» в конце названия не считаются отдельной колонкой (`parseColumnNames` + `UNIT_TAIL`).
Каждый дашборд с таким набором показывает полосу «Это макет, данные вымышленные» — без неё макет легко
принять за отчёт.

### Обмен файлами (`share.js`)

Единственный способ передать работу другому человеку: `.kobra.json` с `kobra: 1`.
`buildExport()` собирает выбранные дашборды, их графики и описания наборов; `kind` файла — `template`
(без строк) или `project` (со строками загруженных наборов). У шаблона загруженный набор по желанию
подменяется схемой (`schemaFromColumns`) — типы колонок настоящие, а значения и диапазоны берутся
по названиям, в реальные данные генератор не подглядывает. Встроенные демо-наборы уезжают ссылкой
(`{id, name, builtin: true}`), их пользовательские метрики — отдельно в `dsMetrics`.
`importPayload(p, mode)` в режиме `copy` выдаёт новые идентификаторы только при совпадении и чинит все
ссылки (`item.chartId`, `chart.datasetId`, `filter.datasetId`), в режиме `replace` перезаписывает
совпавшее по идентификатору. Загруженный набор, приехавший без строк, помечается `fromTemplate` —
его страница просит загрузить файл с такими же колонками.

### UI-слой (`ui.js`)

Своих фреймворков нет: `h(tag, attrs, ...kids)` строит DOM, перерисовка — через `clear()` + повторный
`paint*()`. Там же `openModal`/`openPop`/`openMenu`/`multiSelect`/`toast`/`confirmDialog`,
обёртки `lsGet/lsSet`, `idb`, `loadScript` и `downloadFile`/`readTextFile` (вся выгрузка в файл идёт
через них). Всё пользовательское в графиках — только через
`h()`/`textContent`; если нужен HTML (Markdown-блоки), он проходит через `marked` + `DOMPurify`
(`renderMarkdown` в `dashboard.js`).

Темы — CSS-переменные в `:root` + `[data-theme="dark"]` + `prefers-color-scheme`; переключатель пишет
`kobra.theme` в localStorage и перерисовывает страницу. Цвета для ECharts берутся из CSS-переменных
через `themeColors()`/`cssv()`, поэтому новые элементы графиков должны брать цвета оттуда, а не
хардкодить. Палитры серий — `COLOR_SCHEMES`, непрерывные шкалы — `SEQ_SCHEMES`.

## `service/` — незаконченный бэкенд

`service/backend/app/core.py` — настройки из переменных окружения `KOBRA_*`, модели метаданных
SQLAlchemy (`kobra_users/connections/datasets/charts/dashboards/settings`), bcrypt-пароли, JWT-сессии
и шифрование строк подключения (Fernet от `KOBRA_SECRET_KEY`). API, фронтенд-адаптера и миграций нет.
Схема `Chart` повторяет форму клиентского графика (`viz` + `params` JSON), `Dashboard.body` — вкладки
и фильтры, так что при правках формата параметров держи эту параллель в голове.

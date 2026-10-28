/* =============================================================
   Кобра · формы данных
   Типы в JSDoc, а не в TypeScript: сборка — это конкатенация скриптов
   в один <script>, и компилятор в неё не вписывается, а редактор типы
   из JSDoc понимает и так (jsconfig.json, checkJs). Разово проверить
   всё целиком: npx -p typescript@5.6.3 tsc -p kobra/jsconfig.json

   Здесь только те формы, которые ездят между файлами, — на них
   держатся договорённости. Локальные объекты не описываем: вывод
   типов справляется сам, а лишние @typedef устаревают молча.
   ============================================================= */

/** @typedef {'string'|'number'|'date'} ColType */

/**
 * Колонка набора данных.
 * @typedef {Object} Column
 * @property {string} key    машинный ключ, латиница
 * @property {string} label  подпись для человека
 * @property {ColType} type
 */

/**
 * Формула показателя. Отношение считается двумя аккумуляторами, а не
 * делением готовых агрегатов, — поэтому у него две части, а не строка.
 * @typedef {{type:'simple', agg:string, col:string}
 *   | {type:'ratio', num:{agg:string,col:string}, den:{agg:string,col:string}, mult?:number}} MetricExpr
 */

/**
 * Показатель, сохранённый в наборе.
 * @typedef {Object} SavedMetric
 * @property {string} key
 * @property {string} label
 * @property {MetricExpr} expr
 * @property {string} [format]  ключ из NUMBER_FORMATS либо 'suffix:шт.'
 */

/**
 * Показатель в параметрах графика: ссылка на сохранённый или разовый.
 * @typedef {{kind:'saved', key:string} | {kind:'simple', agg:string, col:string}} MetricRef
 */

/** @typedef {{preset?:string, from?:string, to?:string}} TimeRangeVal */

/**
 * Фильтр запроса. `op` — ключ из FILTER_OPS; у 'time_range' в `val`
 * лежит TimeRangeVal, у 'in' — массив значений.
 * @typedef {{col:string, op:string, val?:any}} QueryFilter
 */

/**
 * Описание придуманного набора: по нему порождаются строки.
 * @typedef {Object} SchemaDef
 * @property {number} seed
 * @property {number} rowCount
 * @property {string} [dateFrom]
 * @property {string} [dateTo]
 * @property {SchemaColumn[]} columns
 */

/**
 * @typedef {Object} SchemaColumn
 * @property {string} key
 * @property {string} label
 * @property {ColType} type
 * @property {string[]} [values]    категории текстовой колонки
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [decimals]
 * @property {string} [spread]
 */

/**
 * Набор данных в реестре DS. `owner` — это **дашборд**, которому
 * принадлежит скрытый набор макета; владелец-человек — `ownerLogin`.
 * @typedef {Object} Dataset
 * @property {string} id
 * @property {string} name
 * @property {Column[]} columns
 * @property {SavedMetric[]} metrics
 * @property {Record<string, any>[]} rows
 * @property {string|null} [mainDttm]
 * @property {boolean} [builtin]
 * @property {'schema'|'upload'} [kind]
 * @property {SchemaDef} [schema]
 * @property {string} [description]
 * @property {string} [fileName]
 * @property {boolean} [preview]
 * @property {boolean} [missingRows]
 * @property {boolean} [fromTemplate]
 * @property {string} [owner]       id дашборда-хозяина
 * @property {string} [ownerLogin]  логин владельца
 * @property {string} [team]
 * @property {string[]} [shared]
 * @property {Record<string, number>} [_maxCache]
 */

/**
 * Запрос к набору: единственный способ получить данные для графика.
 * @typedef {Object} QuerySpec
 * @property {QueryFilter[]} [filters]
 * @property {{col:string, grain?:string, alias?:string}[]} [groupby]
 * @property {MetricRef[]} [metrics]
 * @property {{key:string, desc?:boolean}[]} [orderby]
 * @property {number} [limit]
 * @property {Record<string, any>[]} [_rows]
 */

/**
 * Ответ движка. `dims[].key` — `col` или `col__grain`, `mets[].key` —
 * подпись показателя: по ней же значения достаются из строк.
 * @typedef {Object} QueryResult
 * @property {Record<string, any>[]} rows
 * @property {{key:string, col:string, grain:string|null, label:string, type:ColType}[]} dims
 * @property {{key:string, label:string, format?:string}[]} mets
 * @property {number} filteredCount
 */

/**
 * График. `params` зависит от типа визуализации — его форму задаёт
 * VIZ[viz].controls, поэтому здесь он намеренно свободный.
 * @typedef {Object} Chart
 * @property {string} id
 * @property {string} name
 * @property {string} viz
 * @property {string} datasetId
 * @property {Record<string, any>} params
 * @property {number} [updated]
 * @property {boolean} [autoName]   заголовок собран Коброй и следует за разрезом
 * @property {boolean} [preview]
 * @property {Record<string, string>} [spec]  поля ТЗ
 * @property {string} [ownerLogin]
 * @property {string} [team]
 * @property {string[]} [shared]
 */

/**
 * Элемент на вкладке дашборда.
 * @typedef {Object} DashItem
 * @property {string} i
 * @property {'chart'|'markdown'|'header'|'divider'} type
 * @property {string} [chartId]
 * @property {string} [text]
 * @property {string} [size]
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/** @typedef {{id:string, title:string, level?:string, items:DashItem[]}} DashTab */

/**
 * Фильтр дашборда (нативный, с панели слева).
 * @typedef {Object} DashFilter
 * @property {string} id
 * @property {string} name
 * @property {'select'|'time'|'range'} type
 * @property {string} datasetId
 * @property {string} col
 * @property {any} [value]
 * @property {any} [def]
 * @property {boolean} [multi]
 * @property {string} [scope]
 * @property {boolean} [dependent]
 */

/**
 * Дашборд — в интерфейсе «шаблон». Переписка с AI-ассистентом живёт
 * здесь же и в файл обмена не уезжает.
 * @typedef {Object} Dashboard
 * @property {string} id
 * @property {string} title
 * @property {DashTab[]} tabs
 * @property {DashFilter[]} filters
 * @property {number} [updated]
 * @property {boolean} [crossFilter]
 * @property {string|null} [scheme]
 * @property {boolean} [preview]
 * @property {string} [previewBack]
 * @property {string|null} [previewDs]
 * @property {{tplId:string|null, datasetId:string, levels:string[], roles:Record<string,any>}} [fromTemplate]
 * @property {string} [ownerLogin]
 * @property {string} [team]
 * @property {string[]} [shared]
 */

/**
 * Весь пользовательский мир. Пишется в localStorage под kobra.state.v1.
 * @typedef {Object} AppState
 * @property {number} v
 * @property {Record<string, Chart>} charts
 * @property {Record<string, Dashboard>} dashboards
 * @property {Record<string, Dataset>} datasets
 * @property {Record<string, SavedMetric[]>} dsMetrics
 * @property {number} [savedAt]
 */

/** @typedef {'Admin'|'Alpha'|'Gamma'} Role */

/**
 * Сотрудник из каталога. В целевой системе его отдаёт LDAP.
 * @typedef {Object} User
 * @property {string} login
 * @property {string} name
 * @property {string} email
 * @property {string} team
 * @property {string[]} groups
 * @property {Role|null} [role]  выданная руками роль важнее групп
 */

/**
 * Объект, у которого есть владелец: шаблон, график или набор.
 * @typedef {{ownerLogin?:string, team?:string, shared?:string[], title?:string, name?:string}} Owned
 */

/**
 * Что получает рендерер графика.
 * @typedef {Object} VizCtx
 * @property {Dataset} ds
 * @property {Record<string, any>} params  defaults(ds) поверх сохранённых
 * @property {string[]} colors
 * @property {QueryFilter[]} filters       свои, периода и дашборда вместе
 * @property {(res: QueryResult) => void} setData  питает «Посмотреть данные»
 * @property {(f: QueryFilter[]) => void} cross    клик ставит кросс-фильтр
 * @property {(col: string, val: any) => boolean} [crossActive]
 */

/**
 * Запись реестра визуализаций. Новый тип графика = запись здесь,
 * ключ в VIZ_ORDER и иконка v_* в ICONS — больше нигде.
 * @typedef {Object} VizDef
 * @property {string} label
 * @property {string} [en]
 * @property {string} icon
 * @property {string} [desc]
 * @property {{title:string, tab:'data'|'view', controls:any[]}[]} controls
 * @property {(ds: Dataset) => Record<string, any>} defaults
 * @property {(root: HTMLElement, ctx: VizCtx) => void} render
 */

/** Снимок состояния для отката (store.js) */
/** @typedef {{label:string, at:number, state:AppState}} StateSnapshot */

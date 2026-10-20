/* ============================================================
   Кобра · синтетические демо-данные
   Вымышленная розничная сеть: ни одной настоящей компании, марки или
   товара. Генерация детерминированная (seed), чтобы у всех были
   одинаковые цифры.
   ============================================================ */
const DAY = 86400000;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickWeighted(rnd, items, wKey = 'w') {
  let total = 0;
  for (const it of items) total += it[wKey];
  let r = rnd() * total;
  for (const it of items) { r -= it[wKey]; if (r <= 0) return it; }
  return items[items.length - 1];
}

/* [регион, город, вес, сколько точек] */
const REGIONS = [
  ['Центр', 'Москва', 0.15, 6], ['Центр', 'Воронеж', 0.03, 2], ['Центр', 'Ярославль', 0.025, 2],
  ['Северо-Запад', 'Санкт-Петербург', 0.09, 4], ['Северо-Запад', 'Калининград', 0.025, 2],
  ['Юг', 'Краснодар', 0.045, 3], ['Юг', 'Ростов-на-Дону', 0.04, 2], ['Юг', 'Волгоград', 0.03, 2],
  ['Поволжье', 'Казань', 0.045, 2], ['Поволжье', 'Самара', 0.035, 2], ['Поволжье', 'Нижний Новгород', 0.035, 2],
  ['Урал', 'Екатеринбург', 0.06, 3], ['Урал', 'Челябинск', 0.035, 2], ['Урал', 'Тюмень', 0.03, 2],
  ['Сибирь', 'Новосибирск', 0.07, 3], ['Сибирь', 'Красноярск', 0.05, 2], ['Сибирь', 'Омск', 0.035, 2],
  ['Дальний Восток', 'Владивосток', 0.05, 2], ['Дальний Восток', 'Хабаровск', 0.04, 2],
];
const STORE_FORMATS = ['Флагман', 'Стандарт', 'Компакт'];

/* [направление, группа товаров, маржа, вес, сезонность(12 мес), товары: [линейка, название, цена]] */
const CATALOG = [
  ['Бытовая техника', 'Крупная техника', 0.12, 12, [.9, .88, .95, 1, 1.05, 1.1, 1.05, 1, 1.05, 1, 1.15, 1.2], [
    ['Базовая', 'Холодильник двухкамерный', 54990], ['Комфорт', 'Холодильник с морозильником', 79990],
    ['Базовая', 'Стиральная машина 7 кг', 32990], ['Комфорт', 'Стиральная машина 9 кг', 46990],
    ['Премиум', 'Посудомоечная машина встраиваемая', 58990], ['Базовая', 'Электрическая плита', 28990]]],
  ['Бытовая техника', 'Мелкая техника', 0.24, 9, [1, 1.05, 1.1, .95, .9, .9, .9, .95, 1.05, 1.05, 1.25, 1.5], [
    ['Комфорт', 'Кофемашина автоматическая', 42990], ['Базовая', 'Кофеварка капельная', 6990],
    ['Базовая', 'Пылесос с контейнером', 11990], ['Премиум', 'Робот-пылесос', 34990],
    ['Базовая', 'Мультиварка 5 л', 7990], ['Комфорт', 'Блендер погружной', 4990]]],
  ['Электроника', 'Компьютеры', 0.10, 11, [.9, .9, .92, .88, .85, .9, 1.05, 1.45, 1.3, 1, 1.1, 1.15], [
    ['Базовая', 'Ноутбук 15,6" офисный', 44990], ['Комфорт', 'Ноутбук 16" для работы', 74990],
    ['Премиум', 'Ноутбук игровой', 129990], ['Базовая', 'Моноблок 24"', 49990],
    ['Комфорт', 'Системный блок офисный', 39990], ['Базовая', 'Монитор 27"', 24990]]],
  ['Электроника', 'Мобильные устройства', 0.11, 14, [1, .92, 1, .95, .95, .95, .95, 1, 1.1, 1, 1.2, 1.35], [
    ['Базовая', 'Смартфон 6,1" 128 ГБ', 24990], ['Комфорт', 'Смартфон 6,7" 256 ГБ', 54990],
    ['Премиум', 'Смартфон флагманский 512 ГБ', 119990], ['Базовая', 'Планшет 10" 64 ГБ', 18990],
    ['Комфорт', 'Смарт-часы спортивные', 16990], ['Базовая', 'Электронная книга 6"', 12990]]],
  ['Электроника', 'Аудио', 0.26, 7, [1, 1.1, 1.1, .9, .9, .95, .95, 1, 1.1, 1, 1.2, 1.5], [
    ['Базовая', 'Наушники накладные', 4990], ['Комфорт', 'Наушники беспроводные', 12990],
    ['Премиум', 'Наушники с шумоподавлением', 27990], ['Базовая', 'Колонка портативная', 5990],
    ['Комфорт', 'Саундбар для телевизора', 23990]]],
  ['Мебель и интерьер', 'Мебель', 0.22, 8, [.95, .95, 1.05, 1.1, 1.1, 1.05, 1, .95, 1.05, 1.05, 1.1, 1.05], [
    ['Базовая', 'Диван прямой', 39990], ['Комфорт', 'Диван угловой', 69990],
    ['Базовая', 'Шкаф-купе 2 двери', 27990], ['Базовая', 'Стол письменный', 9990],
    ['Комфорт', 'Кресло офисное', 14990], ['Премиум', 'Кровать с подъёмным механизмом', 54990]]],
  ['Мебель и интерьер', 'Освещение', 0.30, 4, [1.05, 1, .95, .9, .85, .8, .85, .95, 1.1, 1.2, 1.25, 1.3], [
    ['Базовая', 'Люстра потолочная', 7990], ['Комфорт', 'Светильник подвесной', 5490],
    ['Базовая', 'Торшер напольный', 4990], ['Комфорт', 'Лента светодиодная', 2490]]],
  ['Спорт и отдых', 'Тренажёры', 0.19, 5, [1.4, 1.2, 1.05, .95, .85, .8, .8, .85, 1, 1.1, 1.15, 1.2], [
    ['Комфорт', 'Беговая дорожка', 64990], ['Базовая', 'Велотренажёр', 29990],
    ['Базовая', 'Гантели разборные', 8990], ['Комфорт', 'Эллиптический тренажёр', 49990]]],
  ['Спорт и отдых', 'Туризм', 0.27, 4, [.7, .75, .85, 1.05, 1.3, 1.5, 1.5, 1.35, 1.05, .85, .75, .7], [
    ['Базовая', 'Палатка трёхместная', 12990], ['Базовая', 'Спальный мешок', 5990],
    ['Комфорт', 'Рюкзак туристический 60 л', 8990], ['Базовая', 'Мангал складной', 3490]]],
  ['Товары для дома', 'Текстиль', 0.33, 6, [1, 1.05, 1.05, 1, .95, .95, .95, 1, 1.05, 1.1, 1.2, 1.3], [
    ['Базовая', 'Комплект постельного белья', 4490], ['Комфорт', 'Одеяло всесезонное', 5990],
    ['Базовая', 'Плед флисовый', 2490], ['Базовая', 'Комплект полотенец', 1990]]],
  ['Товары для дома', 'Посуда', 0.31, 5, [1, 1.05, 1.1, 1, .95, .9, .9, .95, 1.05, 1.1, 1.25, 1.45], [
    ['Комфорт', 'Набор кастрюль', 11990], ['Базовая', 'Сковорода антипригарная', 3490],
    ['Премиум', 'Сервиз столовый', 18990], ['Базовая', 'Набор ножей', 4990]]],
];
/* Мелочь к основной покупке: в заказе часто идёт второй строкой */
const ADDON_GROUPS = ['Аудио', 'Освещение', 'Текстиль', 'Посуда'];

const DATA_START = Date.UTC(2024, 0, 1);
const DATA_END = Date.UTC(2026, 7, 31);     // включительно, 31 августа 2026
const MONTH_SEASON = [.86, .82, .92, .86, .86, .9, .9, 1.02, 1.0, 1.0, 1.25, 1.55];

/* Главная распродажа года — последняя пятница ноября */
function autumnSale(year) {
  const d = new Date(Date.UTC(year, 10, 30));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

function generateSales() {
  const rnd = mulberry32(20240101);
  const cities = REGIONS.map(([region, city, w, n]) => {
    const stores = [];
    for (let i = 0; i < n; i++) stores.push({
      name: `${city}, точка №${i + 1}`,
      format: i === 0 && n >= 3 ? STORE_FORMATS[0] : (i % 2 ? STORE_FORMATS[2] : STORE_FORMATS[1]),
      w: i === 0 ? 1.6 : 1,
    });
    return { region, city, w, stores };
  });
  const groups = CATALOG.map(([direction, group, marginRate, w, season, products]) => ({
    direction, group, marginRate, w, season,
    products: products.map(([line, name, price], i) => ({ line, name, price, w: 1 / (1 + i * 0.25) })),
  }));
  const addons = groups.filter(g => ADDON_GROUPS.includes(g.group));
  const payments = [{ v: 'Банковская карта', w: 52 }, { v: 'Быстрые платежи', w: 18 }, { v: 'Наличные', w: 12 }, { v: 'Рассрочка', w: 18 }];
  const segments = [{ v: 'Физлицо', w: 72 }, { v: 'Малый бизнес', w: 20 }, { v: 'Корпоративный клиент', w: 8 }];

  const monthPools = [], addonPools = [];
  for (let mm = 0; mm < 12; mm++) {
    monthPools.push(groups.map(g => ({ g, w: g.w * g.season[mm] })));
    addonPools.push(addons.map(g => ({ g, w: g.w * g.season[mm] })));
  }
  const rows = [];
  let orderSeq = 100000;
  const sales = {};
  for (let t = DATA_START; t <= DATA_END; t += DAY) {
    const d = new Date(t);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate(), wd = d.getUTCDay();
    if (!sales[y]) sales[y] = autumnSale(y);
    const yearsFromStart = (t - DATA_START) / (365 * DAY);
    let mult = MONTH_SEASON[m] * (wd === 0 || wd === 6 ? 1.28 : 1) * (1 + 0.11 * yearsFromStart);
    const saleDelta = Math.round((t - sales[y]) / DAY);
    const isSale = saleDelta >= -2 && saleDelta <= 3;
    if (isSale) mult *= 2.3;
    if (m === 11 && dd >= 18) mult *= 1.6;      // предновогодний спрос
    if (m === 0 && dd <= 7) mult *= 0.62;       // новогодние каникулы
    if (m === 1 && dd >= 18 && dd <= 23) mult *= 1.3;
    if (m === 2 && dd >= 4 && dd <= 7) mult *= 1.3;
    if (m === 7 && dd >= 20) mult *= 1.18;      // подготовка к учебному году
    const nOrders = Math.round(32 * mult * (0.82 + rnd() * 0.36));
    const onlineShare = 0.43 + 0.1 * Math.min(1, yearsFromStart / 2.6);
    const priceIdx = 1 + 0.065 * yearsFromStart;

    for (let o = 0; o < nOrders; o++) {
      const orderId = 'З-' + (orderSeq++);
      const city = pickWeighted(rnd, cities);
      const store = pickWeighted(rnd, city.stores);
      const online = rnd() < onlineShare;
      const channel = online ? (rnd() < 0.38 + 0.12 * Math.min(1, yearsFromStart / 2.6) ? 'Мобильное приложение' : 'Сайт') : 'Розница';
      const delivery = online ? (rnd() < 0.36 ? 'Доставка' : 'Самовывоз') : 'Покупка на точке';
      const segment = pickWeighted(rnd, segments).v;
      const loyalty = rnd() < 0.48 ? 'Да' : 'Нет';
      let payment = pickWeighted(rnd, payments).v;
      if (online && payment === 'Наличные' && rnd() < 0.7) payment = 'Банковская карта';
      if (segment === 'Корпоративный клиент' && rnd() < 0.6) payment = 'Безналичный расчёт';

      const nLines = rnd() < 0.62 ? 1 : rnd() < 0.72 ? 2 : 3;
      for (let li = 0; li < nLines; li++) {
        const pool = li === 0 ? monthPools[m] : (rnd() < 0.75 ? addonPools[m] : monthPools[m]);
        const g = pickWeighted(rnd, pool).g;
        const pr = pickWeighted(rnd, g.products);
        const small = ADDON_GROUPS.includes(g.group);
        const qty = small ? (rnd() < 0.7 ? 1 : rnd() < 0.7 ? 2 : 3) : (rnd() < 0.96 ? 1 : 2);
        const price = Math.round(pr.price * priceIdx * (0.94 + rnd() * 0.12) / 10) * 10;
        let discRate = rnd() < 0.3 ? rnd() * 0.06 : 0;
        if (isSale) discRate = 0.08 + rnd() * 0.17;
        else if (m === 11 && dd >= 15) discRate = Math.max(discRate, 0.04 + rnd() * 0.06);
        if (loyalty === 'Да') discRate += 0.01;
        const gross = price * qty;
        const discount = Math.round(gross * discRate);
        const revenue = gross - discount;
        const mRate = g.marginRate + (pr.line === 'Премиум' ? 0.04 : 0) + (rnd() - 0.5) * 0.03;
        const cost = Math.round(gross * (1 - mRate));
        rows.push({
          date: t, order_id: orderId, region: city.region, city: city.city, store: store.name,
          store_format: online && delivery === 'Доставка' ? 'Склад доставки' : store.format,
          channel, delivery, payment, segment, loyalty,
          direction: g.direction, group: g.group, line: pr.line, product: pr.name,
          qty, price, gross, discount, revenue, cost, margin: revenue - cost,
        });
      }
    }
  }
  return rows;
}

function generateFunnel() {
  const rnd = mulberry32(777);
  const platforms = [{ v: 'Сайт', w: 52, conv: 1 }, { v: 'Приложение iOS', w: 26, conv: 1.18 }, { v: 'Приложение Android', w: 22, conv: 1.1 }];
  const sources = [{ v: 'Поиск', w: 34, conv: 1.05 }, { v: 'Прямые заходы', w: 23, conv: 1.25 },
    { v: 'Реклама', w: 21, conv: .82 }, { v: 'Рассылки', w: 12, conv: 1.3 }, { v: 'Соцсети', w: 10, conv: .78 }];
  const stages = [
    { name: 'Посещение', order: 1, rate: 1 },
    { name: 'Карточка товара', order: 2, rate: 0.58 },
    { name: 'Корзина', order: 3, rate: 0.27 },
    { name: 'Оформление', order: 4, rate: 0.16 },
    { name: 'Оплата', order: 5, rate: 0.115 },
  ];
  const rows = [];
  for (let t = DATA_START; t <= DATA_END; t += DAY) {
    const d = new Date(t);
    const m = d.getUTCMonth(), wd = d.getUTCDay();
    const yearsFromStart = (t - DATA_START) / (365 * DAY);
    const base = 5200 * MONTH_SEASON[m] * (wd === 0 || wd === 6 ? 1.2 : 1) * (1 + 0.14 * yearsFromStart) * (0.88 + rnd() * 0.24);
    platforms.forEach(p => {
      sources.forEach(s => {
        const visits = base * (p.w / 100) * (s.w / 100);
        if (visits < 1) return;
        stages.forEach(st => {
          const k = st.order === 1 ? 1 : Math.pow(p.conv * s.conv, 0.6);
          const users = Math.round(visits * st.rate * k * (0.94 + rnd() * 0.12));
          if (users > 0) rows.push({ date: t, platform: p.v, source: s.v, stage: st.name, stage_order: st.order, users });
        });
      });
    });
  }
  return rows;
}

const BUILTIN_DATASETS = [
  {
    id: 'demo_sales', name: 'Продажи розничной сети', builtin: true,
    description: 'Вымышленные продажи розничной сети: строки заказов с января 2024 по август 2026 года. Компании, марки и товары придуманы.',
    mainDttm: 'date',
    columns: [
      { key: 'date', label: 'Дата заказа', type: 'date' },
      { key: 'order_id', label: 'Номер заказа', type: 'string' },
      { key: 'region', label: 'Регион', type: 'string' },
      { key: 'city', label: 'Город', type: 'string' },
      { key: 'store', label: 'Точка продаж', type: 'string' },
      { key: 'store_format', label: 'Формат точки', type: 'string' },
      { key: 'channel', label: 'Канал продаж', type: 'string' },
      { key: 'delivery', label: 'Способ получения', type: 'string' },
      { key: 'payment', label: 'Способ оплаты', type: 'string' },
      { key: 'segment', label: 'Сегмент клиента', type: 'string' },
      { key: 'loyalty', label: 'Программа лояльности', type: 'string' },
      { key: 'direction', label: 'Направление', type: 'string' },
      { key: 'group', label: 'Группа товаров', type: 'string' },
      { key: 'line', label: 'Линейка', type: 'string' },
      { key: 'product', label: 'Товар', type: 'string' },
      { key: 'qty', label: 'Количество, шт.', type: 'number' },
      { key: 'price', label: 'Цена, ₽', type: 'number' },
      { key: 'gross', label: 'Сумма без скидки, ₽', type: 'number' },
      { key: 'discount', label: 'Скидка, ₽', type: 'number' },
      { key: 'revenue', label: 'Выручка, ₽', type: 'number' },
      { key: 'cost', label: 'Себестоимость, ₽', type: 'number' },
      { key: 'margin', label: 'Маржа, ₽', type: 'number' },
    ],
    metrics: [
      { key: 'revenue', label: 'Выручка', expr: { type: 'simple', agg: 'SUM', col: 'revenue' }, format: 'rub_smart' },
      { key: 'margin', label: 'Маржа', expr: { type: 'simple', agg: 'SUM', col: 'margin' }, format: 'rub_smart' },
      { key: 'margin_pct', label: 'Маржинальность', expr: { type: 'ratio', num: { agg: 'SUM', col: 'margin' }, den: { agg: 'SUM', col: 'revenue' } }, format: 'pct' },
      { key: 'orders', label: 'Заказы', expr: { type: 'simple', agg: 'COUNT_DISTINCT', col: 'order_id' }, format: 'int' },
      { key: 'avg_check', label: 'Средний чек', expr: { type: 'ratio', num: { agg: 'SUM', col: 'revenue' }, den: { agg: 'COUNT_DISTINCT', col: 'order_id' } }, format: 'rub' },
      { key: 'qty', label: 'Продано, шт.', expr: { type: 'simple', agg: 'SUM', col: 'qty' }, format: 'int' },
      { key: 'discount', label: 'Скидки', expr: { type: 'simple', agg: 'SUM', col: 'discount' }, format: 'rub_smart' },
      { key: 'discount_pct', label: 'Доля скидки', expr: { type: 'ratio', num: { agg: 'SUM', col: 'discount' }, den: { agg: 'SUM', col: 'gross' } }, format: 'pct' },
      { key: 'avg_price', label: 'Средняя цена', expr: { type: 'simple', agg: 'AVG', col: 'price' }, format: 'rub' },
      { key: 'lines', label: 'Строк заказов', expr: { type: 'simple', agg: 'COUNT', col: '*' }, format: 'int' },
    ],
    generate: generateSales,
  },
  {
    id: 'demo_funnel', name: 'Воронка интернет-магазина', builtin: true,
    description: 'Вымышленная воронка сайта и приложения по дням, платформам и источникам трафика.',
    mainDttm: 'date',
    columns: [
      { key: 'date', label: 'Дата', type: 'date' },
      { key: 'platform', label: 'Платформа', type: 'string' },
      { key: 'source', label: 'Источник трафика', type: 'string' },
      { key: 'stage', label: 'Этап воронки', type: 'string' },
      { key: 'stage_order', label: 'Порядок этапа', type: 'number' },
      { key: 'users', label: 'Пользователи', type: 'number' },
    ],
    metrics: [
      { key: 'users', label: 'Пользователи', expr: { type: 'simple', agg: 'SUM', col: 'users' }, format: 'smart' },
      { key: 'lines', label: 'Строк', expr: { type: 'simple', agg: 'COUNT', col: '*' }, format: 'int' },
    ],
    generate: generateFunnel,
  },
];

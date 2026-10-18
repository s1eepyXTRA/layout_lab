/* ============================================================
   Кобра · синтетические данные DNS
   Детерминированная генерация (seed), чтобы у всех одинаковые цифры
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

const DNS_CITIES = [
  ['Дальневосточный ФО', 'Владивосток', 0.07, 4], ['Дальневосточный ФО', 'Хабаровск', 0.05, 3],
  ['Сибирский ФО', 'Новосибирск', 0.08, 4], ['Сибирский ФО', 'Красноярск', 0.06, 3],
  ['Сибирский ФО', 'Иркутск', 0.04, 2], ['Сибирский ФО', 'Омск', 0.04, 2],
  ['Сибирский ФО', 'Барнаул', 0.03, 2], ['Сибирский ФО', 'Томск', 0.025, 2],
  ['Уральский ФО', 'Екатеринбург', 0.06, 3], ['Уральский ФО', 'Челябинск', 0.035, 2],
  ['Уральский ФО', 'Тюмень', 0.03, 2], ['Центральный ФО', 'Москва', 0.14, 6],
  ['Центральный ФО', 'Воронеж', 0.03, 2], ['Северо-Западный ФО', 'Санкт-Петербург', 0.08, 4],
  ['Приволжский ФО', 'Казань', 0.04, 2], ['Приволжский ФО', 'Нижний Новгород', 0.035, 2],
  ['Приволжский ФО', 'Самара', 0.03, 2], ['Приволжский ФО', 'Уфа', 0.03, 2],
  ['Приволжский ФО', 'Пермь', 0.03, 2], ['Южный ФО', 'Краснодар', 0.04, 2],
  ['Южный ФО', 'Ростов-на-Дону', 0.035, 2],
];
const STREETS = ['ТРЦ «Галерея»', 'ул. Ленина', 'пр. Мира', 'ТРЦ «Мега»', 'ул. Советская', 'ул. Кирова'];

// [категория, подкатегория, маржа, вес, сезонность(12 мес), товары: [бренд, название, цена]]
const DNS_CATALOG = [
  ['Смартфоны и гаджеты', 'Смартфоны', 0.10, 14, [1, .9, 1, .95, .95, .95, .95, 1, 1.1, 1, 1.2, 1.3], [
    ['Apple', 'Apple iPhone 15 128 ГБ', 79990], ['Apple', 'Apple iPhone 16 Pro 256 ГБ', 139990],
    ['Samsung', 'Samsung Galaxy S24 256 ГБ', 84990], ['Samsung', 'Samsung Galaxy A55 128 ГБ', 36990],
    ['Xiaomi', 'Xiaomi Redmi Note 13 256 ГБ', 21990], ['POCO', 'POCO X6 Pro 256 ГБ', 29990],
    ['realme', 'realme C67 128 ГБ', 14990], ['HONOR', 'HONOR X8b 128 ГБ', 19990],
    ['TECNO', 'TECNO Spark 20 Pro 256 ГБ', 16990], ['Infinix', 'Infinix HOT 40 Pro 256 ГБ', 15990]]],
  ['Смартфоны и гаджеты', 'Умные часы', 0.18, 4, [1, 1.1, 1.1, .9, .9, .9, .9, .9, 1, 1, 1.2, 1.5], [
    ['Apple', 'Apple Watch SE 2023', 29990], ['Samsung', 'Samsung Galaxy Watch6', 24990],
    ['Xiaomi', 'Xiaomi Redmi Watch 4', 8990], ['HUAWEI', 'HUAWEI Watch Fit 3', 13990],
    ['Amazfit', 'Amazfit Bip 5', 7990]]],
  ['Смартфоны и гаджеты', 'Наушники', 0.22, 6, [1, 1.1, 1.1, .9, .9, .9, .9, 1, 1.1, 1, 1.2, 1.5], [
    ['Apple', 'Apple AirPods Pro 2', 22990], ['Samsung', 'Samsung Galaxy Buds FE', 7990],
    ['JBL', 'JBL Tune 520BT', 3990], ['Xiaomi', 'Xiaomi Redmi Buds 5', 3490],
    ['HUAWEI', 'HUAWEI FreeBuds SE 2', 2990]]],
  ['Ноутбуки и компьютеры', 'Ноутбуки', 0.10, 7, [.9, .9, .9, .85, .85, .9, 1, 1.4, 1.3, 1, 1.1, 1.1], [
    ['ASUS', 'ASUS Vivobook 15 X1504', 49990], ['Lenovo', 'Lenovo IdeaPad Slim 3', 54990],
    ['HP', 'HP 255 G10', 42990], ['Acer', 'Acer Aspire 3', 39990], ['MSI', 'MSI Katana 15', 109990],
    ['HUAWEI', 'HUAWEI MateBook D 16', 69990], ['Apple', 'Apple MacBook Air 13 M2', 99990],
    ['DEXP', 'DEXP Aquilon 15', 29990]]],
  ['Ноутбуки и компьютеры', 'Мониторы', 0.13, 4, [1, .95, .95, .9, .9, .9, .95, 1.1, 1.1, 1, 1.2, 1.2], [
    ['Samsung', 'Samsung Odyssey G5 27"', 27990], ['LG', 'LG UltraGear 27GP850', 34990],
    ['AOC', 'AOC 24G2SPU', 14990], ['ASUS', 'ASUS TUF VG249Q1A', 15990], ['DEXP', 'DEXP DF24N1', 9990]]],
  ['Ноутбуки и компьютеры', 'Системные блоки', 0.15, 2, [1, .9, .9, .9, .85, .85, .9, 1.1, 1.1, 1, 1.3, 1.3], [
    ['ZET', 'ZET Gaming WARD H232', 129990], ['DEXP', 'DEXP Mars E335', 49990],
    ['ZET', 'ZET Gaming NEO M058', 89990], ['DEXP', 'DEXP Atlas H388', 69990]]],
  ['Комплектующие', 'Видеокарты', 0.08, 4, [1.1, 1, 1, .9, .85, .85, .9, .95, 1, 1.05, 1.35, 1.3], [
    ['Palit', 'Palit GeForce RTX 4060 Dual', 33990], ['GIGABYTE', 'GIGABYTE GeForce RTX 4070 SUPER', 69990],
    ['MSI', 'MSI GeForce RTX 4060 Ti Ventus', 45990], ['ASUS', 'ASUS Radeon RX 7600', 32990],
    ['KFA2', 'KFA2 GeForce RTX 3050', 22990]]],
  ['Комплектующие', 'Процессоры', 0.08, 3, [1.1, 1, 1, .9, .85, .85, .9, .95, 1, 1.05, 1.3, 1.25], [
    ['AMD', 'AMD Ryzen 5 7500F', 13990], ['AMD', 'AMD Ryzen 7 7800X3D', 42990],
    ['Intel', 'Intel Core i5-12400F', 11990], ['Intel', 'Intel Core i7-14700KF', 39990]]],
  ['Комплектующие', 'SSD', 0.14, 4, [1.05, 1, 1, .95, .9, .9, .95, 1.05, 1.05, 1, 1.25, 1.2], [
    ['Samsung', 'Samsung 990 EVO 1 ТБ', 9990], ['Kingston', 'Kingston NV2 1 ТБ', 6490],
    ['WD', 'WD Blue SN580 1 ТБ', 7490], ['ADATA', 'ADATA Legend 850 2 ТБ', 13990]]],
  ['Комплектующие', 'Оперативная память', 0.14, 3, [1.05, 1, 1, .95, .9, .9, .95, 1.05, 1.05, 1, 1.25, 1.2], [
    ['Kingston', 'Kingston FURY Beast 32 ГБ DDR5', 10990], ['ADATA', 'ADATA XPG Lancer 32 ГБ DDR5', 11490],
    ['G.Skill', 'G.Skill Ripjaws V 16 ГБ DDR4', 3990], ['Patriot', 'Patriot Viper 16 ГБ DDR4', 3490]]],
  ['Бытовая техника', 'Холодильники', 0.16, 4, [.8, .8, .9, 1, 1.2, 1.4, 1.4, 1.2, 1, .9, 1.1, .9], [
    ['Haier', 'Haier C2F637CWRG', 54990], ['ATLANT', 'ATLANT ХМ 4624-101', 36990],
    ['Samsung', 'Samsung RB33A3440SA', 64990], ['DEXP', 'DEXP RF-CD205NHA', 29990],
    ['Бирюса', 'Бирюса M880NF', 44990]]],
  ['Бытовая техника', 'Стиральные машины', 0.17, 4, [.9, .9, 1, 1, 1, 1, 1, 1, 1, 1, 1.2, 1], [
    ['Haier', 'Haier HW60-BP10929B', 29990], ['LG', 'LG F2J3HS2W', 34990],
    ['Samsung', 'Samsung WW60J42E0HW', 32990], ['Candy', 'Candy Smart CS4 1061D1', 23990],
    ['DEXP', 'DEXP WM-F610NTMA', 19990]]],
  ['Бытовая техника', 'Пылесосы', 0.20, 5, [.9, .9, 1.1, 1.1, 1, .9, .9, .9, 1, 1, 1.3, 1.3], [
    ['Dreame', 'Dreame L10s Ultra', 59990], ['Xiaomi', 'Xiaomi Robot Vacuum S10', 19990],
    ['Samsung', 'Samsung VC18M31A0HP', 11990], ['Kitfort', 'Kitfort KT-5174', 8990], ['DEXP', 'DEXP D800A', 3990]]],
  ['Бытовая техника', 'Кондиционеры', 0.20, 3, [.15, .15, .3, .7, 1.8, 3.2, 3.4, 1.8, .5, .2, .2, .15], [
    ['Haier', 'Haier HSU-09HPL03', 32990], ['Midea', 'Midea MSAG-09HRN1', 27990],
    ['Ballu', 'Ballu BSUI-09HN8', 36990], ['DEXP', 'DEXP AC-CH9ONF', 21990]]],
  ['Бытовая техника', 'Микроволновые печи', 0.20, 3, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.1, 1.1], [
    ['Samsung', 'Samsung MS23K3614AW', 10990], ['LG', 'LG MS2042DB', 8990],
    ['DEXP', 'DEXP MC-70', 4990], ['Midea', 'Midea AM820CUK', 6990]]],
  ['ТВ и развлечения', 'Телевизоры', 0.12, 6, [.9, .9, .9, .85, .85, .9, .9, .9, 1, 1.05, 1.35, 1.5], [
    ['Samsung', 'Samsung UE55CU7100', 49990], ['LG', 'LG 50UR78006LK', 42990],
    ['Haier', 'Haier 55 Smart TV S1', 44990], ['Xiaomi', 'Xiaomi TV A Pro 43', 29990],
    ['Hisense', 'Hisense 65U7KQ', 89990], ['TCL', 'TCL 50C647', 39990], ['DEXP', 'DEXP 43UCY1', 22990]]],
  ['ТВ и развлечения', 'Игровые консоли', 0.07, 2, [1, .8, .8, .8, .75, .75, .8, .9, .9, 1, 1.4, 1.9], [
    ['Sony', 'Sony PlayStation 5 Slim', 64990], ['Microsoft', 'Microsoft Xbox Series S', 34990],
    ['Nintendo', 'Nintendo Switch OLED', 36990]]],
  ['ТВ и развлечения', 'Саундбары', 0.18, 2, [.9, .9, .9, .9, .9, .9, .9, .9, 1, 1, 1.3, 1.4], [
    ['Samsung', 'Samsung HW-B550', 19990], ['LG', 'LG S65Q', 24990],
    ['JBL', 'JBL Bar 300', 39990], ['DEXP', 'DEXP SB-80', 5990]]],
  ['Аксессуары', 'Зарядки и кабели', 0.42, 9, [1, 1, 1, 1, 1, 1, 1.05, 1.1, 1.1, 1, 1.15, 1.2], [
    ['Baseus', 'Baseus GaN5 Pro 65W', 3490], ['Ugreen', 'Ugreen кабель USB-C 1 м', 690],
    ['DEXP', 'DEXP кабель Lightning 1 м', 399], ['Anker', 'Anker PowerCore 20000', 3990]]],
  ['Аксессуары', 'Мыши и клавиатуры', 0.30, 7, [1, 1, 1, .95, .9, .9, .95, 1.15, 1.2, 1, 1.2, 1.2], [
    ['Logitech', 'Logitech G102 LIGHTSYNC', 1799], ['ARDOR GAMING', 'ARDOR GAMING Phantom PRO', 2999],
    ['Logitech', 'Logitech MX Keys S', 11990], ['Razer', 'Razer DeathAdder Essential', 2499],
    ['DEXP', 'DEXP KM-100', 999]]],
  ['Аксессуары', 'Чехлы и стёкла', 0.55, 7, [1, 1, 1, 1, 1, 1, 1, 1, 1.1, 1, 1.1, 1.2], [
    ['DEXP', 'DEXP стекло для iPhone 15', 599], ['Red Line', 'Red Line чехол Samsung A55', 899],
    ['DEXP', 'DEXP чехол-книжка универсальный', 499]]],
];
const OWN_BRANDS = new Set(['DEXP', 'ZET', 'ARDOR GAMING']);

const DNS_START = Date.UTC(2024, 0, 1);
const DNS_END = Date.UTC(2026, 7, 31); // включительно, 31 августа 2026
const MONTH_SEASON = [.86, .82, .92, .86, .86, .9, .9, 1.02, 1.0, 1.0, 1.25, 1.55];

function blackFriday(year) { // последняя пятница ноября
  let d = new Date(Date.UTC(year, 10, 30));
  while (d.getUTCDay() !== 5) d = new Date(d.getTime() - DAY);
  return d.getTime();
}

function generateDnsSales() {
  const rnd = mulberry32(20240101);
  const cities = DNS_CITIES.map(([district, city, w, n]) => {
    const stores = [];
    for (let i = 0; i < n; i++) stores.push({
      name: `DNS ${city}, ${STREETS[i % STREETS.length]}`,
      format: i === 0 && n >= 3 ? 'DNS Гипер' : 'DNS',
      w: i === 0 ? 1.6 : 1,
    });
    return { district, city, w, stores };
  });
  const subcats = DNS_CATALOG.map(([category, subcategory, marginRate, w, season, products]) => ({
    category, subcategory, marginRate, w, season,
    products: products.map(([brand, name, price], i) => ({ brand, name, price, w: 1 / (1 + i * 0.25) })),
  }));
  const accessories = subcats.filter(s => s.category === 'Аксессуары');
  const payments = [{ v: 'Банковская карта', w: 52 }, { v: 'СБП', w: 18 }, { v: 'Наличные', w: 12 }, { v: 'Кредит и рассрочка', w: 18 }];
  const ages = [{ v: '18–24', w: 17 }, { v: '25–34', w: 32 }, { v: '35–44', w: 26 }, { v: '45–54', w: 15 }, { v: '55+', w: 10 }];

  const monthPools = [], accPools = [];
  for (let mm = 0; mm < 12; mm++) {
    monthPools.push(subcats.map(s => ({ s, w: s.w * s.season[mm] })));
    accPools.push(accessories.map(s => ({ s, w: s.w * s.season[mm] })));
  }
  const rows = [];
  let orderSeq = 100000;
  const bfs = {};
  for (let t = DNS_START; t <= DNS_END; t += DAY) {
    const d = new Date(t);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate(), wd = d.getUTCDay();
    if (!bfs[y]) bfs[y] = blackFriday(y);
    const yearsFromStart = (t - DNS_START) / (365 * DAY);
    let mult = MONTH_SEASON[m] * (wd === 0 || wd === 6 ? 1.28 : 1) * (1 + 0.11 * yearsFromStart);
    const bfDelta = Math.round((t - bfs[y]) / DAY);
    const isBF = bfDelta >= -2 && bfDelta <= 3;
    if (isBF) mult *= 2.3;
    if (m === 11 && dd >= 18) mult *= 1.6;
    if (m === 0 && dd <= 7) mult *= 0.62;
    if (m === 1 && dd >= 18 && dd <= 23) mult *= 1.3;
    if (m === 2 && dd >= 4 && dd <= 7) mult *= 1.3;
    if (m === 7 && dd >= 20) mult *= 1.18;
    const nOrders = Math.round(32 * mult * (0.82 + rnd() * 0.36));
    const onlineShare = 0.43 + 0.1 * Math.min(1, yearsFromStart / 2.6);
    const priceIdx = 1 + 0.065 * yearsFromStart;

    for (let o = 0; o < nOrders; o++) {
      const orderId = 'Z-' + (orderSeq++);
      const city = pickWeighted(rnd, cities);
      const store = pickWeighted(rnd, city.stores);
      const online = rnd() < onlineShare;
      const channel = online ? (rnd() < 0.38 + 0.12 * Math.min(1, yearsFromStart / 2.6) ? 'Мобильное приложение' : 'Сайт') : 'Магазин';
      const delivery = online ? (rnd() < 0.36 ? 'Доставка' : 'Самовывоз') : 'Покупка в магазине';
      const customer = rnd() < 0.37 ? 'Новый' : 'Постоянный';
      const age = pickWeighted(rnd, ages).v;
      let payment = pickWeighted(rnd, payments).v;
      if (online && payment === 'Наличные' && rnd() < 0.7) payment = 'Банковская карта';

      const nLines = rnd() < 0.62 ? 1 : rnd() < 0.72 ? 2 : 3;
      for (let li = 0; li < nLines; li++) {
        const pool = li === 0 ? monthPools[m] : (rnd() < 0.75 ? accPools[m] : monthPools[m]);
        const sc = pickWeighted(rnd, pool).s;
        const pr = pickWeighted(rnd, sc.products);
        const isAcc = sc.category === 'Аксессуары';
        const qty = isAcc ? (rnd() < 0.7 ? 1 : rnd() < 0.7 ? 2 : 3) : (rnd() < 0.96 ? 1 : 2);
        const price = Math.round(pr.price * priceIdx * (0.94 + rnd() * 0.12) / 10) * 10;
        let discRate = rnd() < 0.3 ? rnd() * 0.06 : 0;
        if (isBF) discRate = 0.08 + rnd() * 0.17;
        else if (m === 11 && dd >= 15) discRate = Math.max(discRate, 0.04 + rnd() * 0.06);
        const gross = price * qty;
        const discount = Math.round(gross * discRate);
        const revenue = gross - discount;
        const mRate = sc.marginRate + (OWN_BRANDS.has(pr.brand) ? 0.06 : 0) + (rnd() - 0.5) * 0.03;
        const cost = Math.round(gross * (1 - mRate));
        rows.push({
          date: t, order_id: orderId, district: city.district, city: city.city, store: store.name,
          store_format: online && delivery === 'Доставка' ? 'Склад доставки' : store.format,
          channel, delivery, payment, customer_type: customer, age_group: age,
          category: sc.category, subcategory: sc.subcategory, brand: pr.brand, product: pr.name,
          own_brand: OWN_BRANDS.has(pr.brand) ? 'Да' : 'Нет',
          qty, price, gross, discount, revenue, cost, margin: revenue - cost,
        });
      }
    }
  }
  return rows;
}

function generateDnsFunnel() {
  const rnd = mulberry32(777);
  const stages = ['Посещение', 'Просмотр товара', 'Добавление в корзину', 'Оформление заказа', 'Оплата', 'Получение заказа'];
  const conv = {
    'Сайт': [1, 0.58, 0.19, 0.52, 0.76, 0.93],
    'Мобильное приложение': [1, 0.71, 0.27, 0.61, 0.84, 0.95],
  };
  const sources = [{ v: 'Поиск', w: 38 }, { v: 'Контекстная реклама', w: 22 }, { v: 'Прямые заходы', w: 24 }, { v: 'Соцсети', w: 9 }, { v: 'Email-рассылки', w: 7 }];
  const rows = [];
  for (let t = DNS_START; t <= DNS_END; t += DAY) {
    const d = new Date(t);
    const m = d.getUTCMonth(), wd = d.getUTCDay();
    const yearsFromStart = (t - DNS_START) / (365 * DAY);
    const base = MONTH_SEASON[m] * (wd === 0 || wd === 6 ? 1.2 : 1) * (1 + 0.14 * yearsFromStart);
    for (const platform of ['Сайт', 'Мобильное приложение']) {
      const pBase = platform === 'Сайт' ? 52000 : 21000 * (1 + 0.35 * yearsFromStart);
      for (const src of sources) {
        let users = pBase * base * (src.w / 100) * (0.9 + rnd() * 0.2);
        const c = conv[platform];
        for (let i = 0; i < stages.length; i++) {
          if (i > 0) users *= c[i] * (0.94 + rnd() * 0.12) * (src.v === 'Email-рассылки' && i === 2 ? 1.3 : 1);
          rows.push({ date: t, platform, source: src.v, stage: stages[i], stage_order: i + 1, users: Math.round(users) });
        }
      }
    }
  }
  return rows;
}

const BUILTIN_DATASETS = [
  {
    id: 'dns_sales', name: 'Продажи DNS', builtin: true,
    description: 'Синтетические продажи сети DNS: строки заказов с января 2024 по август 2026 года.',
    mainDttm: 'date',
    columns: [
      { key: 'date', label: 'Дата заказа', type: 'date' },
      { key: 'order_id', label: 'Номер заказа', type: 'string' },
      { key: 'district', label: 'Федеральный округ', type: 'string' },
      { key: 'city', label: 'Город', type: 'string' },
      { key: 'store', label: 'Магазин', type: 'string' },
      { key: 'store_format', label: 'Формат точки', type: 'string' },
      { key: 'channel', label: 'Канал продаж', type: 'string' },
      { key: 'delivery', label: 'Способ получения', type: 'string' },
      { key: 'payment', label: 'Способ оплаты', type: 'string' },
      { key: 'customer_type', label: 'Тип клиента', type: 'string' },
      { key: 'age_group', label: 'Возраст клиента', type: 'string' },
      { key: 'category', label: 'Категория', type: 'string' },
      { key: 'subcategory', label: 'Подкатегория', type: 'string' },
      { key: 'brand', label: 'Бренд', type: 'string' },
      { key: 'product', label: 'Товар', type: 'string' },
      { key: 'own_brand', label: 'Собственная марка', type: 'string' },
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
    generate: generateDnsSales,
  },
  {
    id: 'dns_funnel', name: 'Воронка интернет-магазина DNS', builtin: true,
    description: 'Синтетическая воронка сайта и приложения DNS по дням, платформам и источникам трафика.',
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
    generate: generateDnsFunnel,
  },
];

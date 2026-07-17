// Данные корзины: каталог товаров, статусы мастера, пороги скидки за объём.
// Только данные — никаких расчётов и никакого DOM.
window.Cart = window.Cart || {};

window.Cart.data = (() => {
  "use strict";

  // Каталог разделён на три бизнес-группы. Тип группы (kind) определяет правила
  // расчёта: обычные товары идут со скидками, уценённые считаются по старой и
  // новой цене, акционные группируются по названию акции.
  //
  // Поля позиции:
  //   unit   — цена мастера за единицу, база для суммы вкладки
  //   retail — розничная цена (обычные товары); от неё считается скидка за объём
  //   old    — цена до уценки (уценённые товары)
  //   list   — цена без акции (акционные товары)
  //   qty    — начальное количество
  //   img    — имя файла в assets/products без расширения
  //
  // Про запас, сейчас ничем не читается:
  //   limited    — пометка ограниченной серии
  //   priceLabel — готовая подпись под ценой; для обычных товаров расчёт всё
  //                равно подставляет свою, так что поле не влияет на вид
  const catalog = [
    {
      id: "regular", name: "Обычные товары", kind: "regular", items: [
        { id: "r1", name: "P-06 Nirvel Pastel ArtX 100 мл Краситель для волос, оттенок - Серебристый", art: "IGRO-5750", brand: "Nirvel", retail: 1500, unit: 1350, qty: 4, img: "nirvel", limited: true, priceLabel: "ПЦ (Лига II)" },
        { id: "r2", name: "Color Краска для бровей и ресниц 15 мл, оттенок натуральный КОРИЧНЕВЫЙ", art: "IGRO-9145", brand: "Lash Color", retail: 800, unit: 720, qty: 1, img: "lashcolor", priceLabel: "ПЦ (Лига II)" },
        { id: "r3", name: "9.75 Крем-краска Светлый карамельн. блонд 100 мл, PROFY Touch Concept", art: "МТ56825", brand: "Concept", retail: 500, unit: 450, qty: 2, img: "concept", priceLabel: "ПЦ (Лига II)" },
        // Единственный товар с акцией по количеству: от 25 шт. цена падает на 25%.
        { id: "r4", name: "Ускоритель загара Soleo Lolli Pop, 150 мл", art: "WBAST0005", brand: "Soleo", retail: 345, unit: 310, qty: 1, img: "soleo", priceLabel: "ПЦ (Лига II)", hasPromoBadge: true, qtyPromoThreshold: 25, qtyPromoPct: 25 },
      ],
    },
    {
      id: "markdown", name: "Уценённые товары", kind: "markdown", items: [
        { id: "m1", name: "Маска для волос восстанавливающая, 500 мл", art: "IGRO-2201", brand: "Kapous", old: 1400, unit: 980, qty: 1, img: "levissime" },
        { id: "m2", name: "Сыворотка для секущихся кончиков, 100 мл", art: "IGRO-2245", brand: "Concept", old: 560, unit: 392, qty: 2, img: "iuver" },
        { id: "m3", name: "Тоник-кондиционер для волос, 250 мл", art: "IGRO-2290", brand: "Levissime", old: 470, unit: 329, qty: 1, img: "lashcolor" },
        { id: "m4", name: "Бальзам-уход после окрашивания, 200 мл", art: "IGRO-2310", brand: "Kapous", old: 710, unit: 497, qty: 1, img: "iuver" },
      ],
    },
    {
      id: "promo", name: "Специальные акции", kind: "promo", items: [
        { id: "p1", name: "Шампунь восстанавливающий 1000 мл", art: "IGRO-5750", brand: "Nirvel", promoGroup: "АКЦИЯ \"СЕБЕ ЛЮБИМОЙ\"", unit: 416.67, list: 500, qty: 1, qtyLocked: true, img: "nirvel" },
        { id: "p2", name: "LeviSsime Крем антиоксидантный д/молодой кожи Young Life Glass Skin 50 мл", art: "4758", brand: "Levissime", promoGroup: "АКЦИЯ \"СЕБЕ ЛЮБИМОЙ\"", unit: 1320, list: 1650, qty: 1, qtyLocked: true, img: "levis-younglife" },
        { id: "p3", name: "LeviSsime Крем увлажняющий ночной для лица / Hydrage be.Essential Night Cream 50 мл", art: "МТ4737145", brand: "Levissime", promoGroup: "АКЦИЯ \"СЕБЕ ЛЮБИМОЙ\"", unit: 1360, list: 1700, qty: 1, qtyLocked: true, img: "levis-hydrage" },
      ],
    },
  ];

  // Пороги накопительной скидки за объём. Считаются только выбранные обычные
  // товары, сумма берётся по розничной цене до всех скидок.
  const discountTiers = [
    { threshold: 5000, label: "5%" },
    { threshold: 7000, label: "7%" },
    { threshold: 10000, label: "10%" },
    { threshold: 20000, label: "15%" },
    { threshold: 100000, label: "25%" },
  ];

  // Статусы мастера.
  //   base       — скидка на обычные бренды, %
  //   brand      — повышенная скидка на бренды из DISCOUNT_BRANDS, %
  //   mult       — множитель базовой цены; у РРЦ розница вдвое выше мастерской
  //   priceRoot  — как называется цена в подписи под ценой
  //   shortRoot  — короткое имя цены для подписи «... со скидкой»
  //   noDiscLabel— подпись, когда скидок нет вовсе
  //   optLabel   — текст в служебном селекторе статуса
  //   badges     — бейджи в плашке статуса; tip — текст всплывающей подсказки
  //   noBand     — про запас, сейчас ничем не читается
  const statuses = [
    { id: "rrc", name: "РРЦ", base: 0, brand: 0, mult: 2, noBand: true, priceRoot: "РРЦ", shortRoot: "РРЦ", noDiscLabel: "Рекомендованная\nРозничная Цена", optLabel: "Не авторизованный (РРЦ)", badges: [] },
    { id: "master", name: "Мастер", base: 0, brand: 0, mult: 1, priceRoot: "Проф. Цена", shortRoot: "ПЦ", noDiscLabel: "Проф. Цена", optLabel: "нет статуса(цена мастера)", badges: [
      { t: "Проф. Цена", tip: "Профессиональная цена (ПЦ) - специальная цена для зарегистрированных специалистов и компаний индустрии красоты." },
    ] },
    { id: "liga2", name: "Лига II", base: 10, brand: 10, optLabel: "Лига II (скидка 10%)", badges: [
      { t: "Скидка 10%" },
    ] },
    { id: "liga1", name: "Лига I", base: 15, brand: 15, optLabel: "Лига I (скидка 15%)", badges: [
      { t: "Скидка 15%" },
    ] },
    { id: "vip", name: "VIP", base: 15, brand: 20, optLabel: "VIP (скидка 15% бренды 20%)", badges: [
      { t: "Бренды 20%", tip: "Скидка на бренды Nirvel, Levissime, Iuver, Depilflax 100, Starpil, Lash Color, RefectoCil, Soleo, Comair и ИГРObeauty." },
      { t: "Скидка 15%", tip: "Скидка на остальные бренды", short: true },
    ] },
    { id: "supervip", name: "Супер VIP", base: 15, brand: 25, optLabel: "Супер VIP (скидка 15% бренды 25%)", badges: [
      { t: "Бренды 25%", tip: "Скидка на бренды Nirvel, Levissime, Iuver, Depilflax 100, Starpil, Lash Color, RefectoCil, Soleo, Comair и ИГРObeauty." },
      { t: "Скидка 15%", tip: "Скидка на остальные бренды", short: true },
    ] },
  ];

  // Бренды, к которым применяется повышенная скидка (поле brand у статуса).
  // Подсказка бейджа перечисляет больше брендов, но в каталоге есть только эти.
  const DISCOUNT_BRANDS = ["Nirvel", "Lash Color", "Soleo"];

  // Границы счётчика количества в строке товара.
  const QMIN = 1;
  const QMAX = 99;

  // Короткие имена вкладок для мобильного, где полные не помещаются.
  const tabShortNames = { regular: "Обычные", markdown: "Уценка", promo: "Спец. Акции" };

  return { catalog, discountTiers, statuses, DISCOUNT_BRANDS, QMIN, QMAX, tabShortNames };
})();

// Регрессия расчётов: замороженные (golden) значения текущего проверенного кода.
// Гоняется в headless Chrome через ../js/data.js + ../js/calc.js (чистые функции,
// без DOM). Смысл — поймать молчаливый развал сумм при будущих правках.
//
// Числа сняты 20.07.2026 с текущего кода (rrc «К оплате» = 20 348 ₽ совпал с NOTES).
// Хранятся в ASCII; при сравнении нормализуем варианты пробела (nbsp/narrow-nbsp)
// и минус, чтобы разница ICU node/Chrome не давала ложных провалов. Сам контракт
// «fmt ставит неразрывный пробел» проверяется отдельным тестом ниже.
(() => {
  "use strict";
  const { compute, fmt, phoneDigits, phoneFormat } = window.Cart.calc;
  const { catalog } = window.Cart.data;

  const results = [];
  const norm = (s) => String(s).replace(/[  ]/g, " ").replace(/−/g, "-").trim();
  function eq(name, actual, expected) {
    const pass = norm(actual) === norm(expected);
    results.push({ name, pass, actual: String(actual), expected: String(expected) });
  }
  function ok(name, cond, detail) {
    results.push({ name, pass: !!cond, actual: detail || "", expected: "истина" });
  }

  // Стартовое состояние как в main.js: всё выбрано, количество из каталога.
  function st(status, over) {
    const qty = {}, checked = {};
    catalog.forEach(g => g.items.forEach(it => { qty[it.id] = it.qty; checked[it.id] = true; }));
    return Object.assign({ qty, checked, removed: {}, activeGroup: "regular", status,
      showMarkdownTab: true, showPromoTab: true }, over || {});
  }
  const rowsOf = (m) => m.rows.filter(r => !r.isHeader);
  const rowById = (m, id) => rowsOf(m).find(r => r.id === id);

  // --- 1. Шесть статусов, стартовая корзина ---
  const golden = {
    rrc:      { total: "20 348 ₽", savings: "3 492 ₽", goods: "16 290 ₽", vol: "10% — применена",
                disc: "Скидка за объём (10%) -1 629 ₽", tabs: "regular=7 330 ₽,markdown=2 590 ₽,promo=3 097 ₽", row0: "10 800 ₽" },
    master:   { total: "13 262 ₽", savings: "2 433 ₽", goods: "8 145 ₽", vol: "7% — применена",
                disc: "Скидка за объём (7%) -570 ₽", tabs: "regular=7 330 ₽,markdown=2 590 ₽,promo=3 097 ₽", row0: "5 580 ₽" },
    liga2:    { total: "13 018 ₽", savings: "2 678 ₽", goods: "8 145 ₽", vol: "не применена",
                disc: "Скидка по статусу (Лига II) -815 ₽", tabs: "regular=7 330 ₽,markdown=2 590 ₽,promo=3 097 ₽", row0: "5 400 ₽" },
    liga1:    { total: "12 610 ₽", savings: "3 085 ₽", goods: "8 145 ₽", vol: "не применена",
                disc: "Скидка по статусу (Лига I) -1 222 ₽", tabs: "regular=7 330 ₽,markdown=2 590 ₽,promo=3 097 ₽", row0: "5 100 ₽" },
    vip:      { total: "12 253 ₽", savings: "3 442 ₽", goods: "8 145 ₽", vol: "не применена",
                disc: "Скидка по статусу (VIP) -1 579 ₽", tabs: "regular=7 330 ₽,markdown=2 590 ₽,promo=3 097 ₽", row0: "4 800 ₽" },
    supervip: { total: "11 896 ₽", savings: "3 799 ₽", goods: "8 145 ₽", vol: "не применена",
                disc: "Скидка по статусу (Супер VIP) -1 936 ₽", tabs: "regular=7 330 ₽,markdown=2 590 ₽,promo=3 097 ₽", row0: "4 500 ₽" },
  };
  Object.keys(golden).forEach(s => {
    const m = compute(st(s));
    const g = golden[s];
    eq(s + ": К оплате", m.sum.total, g.total);
    eq(s + ": экономия", m.sum.savings, g.savings);
    eq(s + ": товары", m.sum.goods, g.goods);
    eq(s + ": шкала объёма", m.volumeStatusText, g.vol);
    eq(s + ": строки скидок", m.regDiscLines.map(d => d.label + " " + d.amount).join("|"), g.disc);
    eq(s + ": суммы вкладок", m.tabs.map(t => t.id + "=" + t.sumText).join(","), g.tabs);
    eq(s + ": первая строка", m.rows[0].lineText, g.row0);
  });

  // --- 2. Акция от 25 шт. перебивает объём и статус (rrc, r4=25) ---
  {
    const m = compute(st("rrc", { qty: Object.assign(st("rrc").qty, { r4: 25 }) }));
    eq("акция25: К оплате", m.sum.total, "31 885 ₽");
    eq("акция25: экономия", m.sum.savings, "8 516 ₽");
    eq("акция25: строки скидок", m.regDiscLines.map(d => d.label + " " + d.amount).join("|"),
       "Скидка за объём (15%) -2 340 ₽|Скидка по акции (от 25 шт.) -4 313 ₽");
    const r4 = rowById(m, "r4");
    eq("акция25: r4 цена", r4.lineText, "12 938 ₽");
    eq("акция25: r4 старая", r4.oldText, "17 250 ₽");
    eq("акция25: r4 подпись", r4.priceTypeText, "Цена по Акции");
    ok("акция25: r4 бейдж акции", r4.isPromoLabel === true, String(r4.isPromoLabel));
  }

  // --- 3. Снятая галочка убирает позицию из итога (rrc, снят r1) ---
  {
    const s = st("rrc"); s.checked = Object.assign({}, s.checked, { r1: false });
    const m = compute(s);
    eq("снят r1: К оплате", m.sum.total, "9 977 ₽");
    eq("снят r1: экономия", m.sum.savings, "1 863 ₽");
    eq("снят r1: товары", m.sum.goods, "4 290 ₽");
    eq("снят r1: шкала объёма", m.volumeStatusText, "не применена");
  }

  // --- 4. Вкладка уценки: цена и зачёркнутая старая (master) ---
  {
    const m = compute(st("master", { activeGroup: "markdown" }));
    const md = { m1: ["980 ₽", "1 400 ₽"], m2: ["784 ₽", "1 120 ₽"], m3: ["329 ₽", "470 ₽"], m4: ["497 ₽", "710 ₽"] };
    Object.keys(md).forEach(id => {
      const r = rowById(m, id);
      eq("уценка: " + id + " цена", r.lineText, md[id][0]);
      eq("уценка: " + id + " старая", r.oldText, md[id][1]);
    });
  }

  // --- 5. Вкладка акций: строки и заголовок группы (rrc) ---
  {
    const m = compute(st("rrc", { activeGroup: "promo" }));
    const pr = { p1: ["417 ₽", "500 ₽"], p2: ["1 320 ₽", "1 650 ₽"], p3: ["1 360 ₽", "1 700 ₽"] };
    Object.keys(pr).forEach(id => {
      const r = rowById(m, id);
      eq("акции: " + id + " цена", r.lineText, pr[id][0]);
      eq("акции: " + id + " старая", r.oldText, pr[id][1]);
    });
    ok("акции: есть заголовок группы", m.rows.some(r => r.isHeader), String(m.rows.filter(r => r.isHeader).length));
  }

  // --- 6. Форматирование денег ---
  eq("fmt: целое", fmt(1350), "1 350 ₽");
  eq("fmt: копейки", fmt(416.67), "416,67 ₽");
  eq("fmt: ноль", fmt(0), "0 ₽");
  eq("fmt: полтинник", fmt(1629.5), "1 629,50 ₽");
  eq("fmt: разделитель тысяч", fmt(100000), "100 000 ₽");
  // Контракт: неразрывный пробел перед рублём (regular space его провалит).
  ok("fmt: пробел перед ₽ неразрывный", /[  ]₽$/.test(fmt(1350)), JSON.stringify(fmt(1350)));

  // --- 7. Маска телефона ---
  const phone = (v) => phoneFormat(phoneDigits(v));
  eq("тел: с восьмёрки", phone("89991234567"), "+7 (999) 123-45-67");
  eq("тел: с +7", phone("+79991234567"), "+7 (999) 123-45-67");
  eq("тел: без кода", phone("9991234567"), "+7 (999) 123-45-67");
  eq("тел: 8 с форматом", phone("8 (999) 123-45-67"), "+7 (999) 123-45-67");
  eq("тел: пробелы", phone("+7 999 123 45 67"), "+7 (999) 123-45-67");
  ok("тел: идемпотентность", phone(phone("89991234567")) === phone("89991234567"));
  // backspace доходит до пустой строки ровно за 10 шагов, не застревая.
  {
    let state = "+7 (999) 123-45-67", steps = 0;
    while (state !== "" && steps <= 20) {
      const cut = state.slice(0, -1);
      let d = phoneDigits(cut);
      if (cut.length < state.length && phoneFormat(d) === state) d = d.slice(0, -1);
      state = phoneFormat(d); steps++;
    }
    ok("тел: backspace до пустой за 10 шагов", state === "" && steps === 10, "шагов: " + steps);
  }

  // --- вывод ---
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const lines = results.map(r => (r.pass ? "PASS  " : "FAIL  ") + r.name +
    (r.pass ? "" : "\n        ждали: [" + r.expected + "]\n        было:  [" + r.actual + "]"));
  const summary = (passed === total ? "PASS" : "FAIL") + " " + passed + "/" + total;
  document.title = "calc " + summary;
  const out = document.getElementById("out");
  if (out) out.textContent = summary + "\n\n" + lines.join("\n");
})();

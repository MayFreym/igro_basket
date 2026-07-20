// Расчёты корзины: цены позиций, скидки, шкала объёма, итоги.
// Чистые функции — ни DOM, ни брейкпоинтов. На вход состояние, на выход модель.
window.Cart = window.Cart || {};

window.Cart.calc = (() => {
  "use strict";

  const { catalog, discountTiers, statuses, DISCOUNT_BRANDS, QMIN, QMAX } = window.Cart.data;

  // 1 350 ₽ — неразрывный пробел перед рублём, копейки только когда они есть.
  // Два форматтера построены один раз: toLocaleString с объектом опций каждый
  // раз конструирует новый Intl.NumberFormat — дорого. Вывод байт-в-байт тот же.
  const fmtWhole = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const fmtKopecks = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (n) => {
    const r = Math.round(n * 100) / 100;
    const frac = Math.round(r * 100) % 100 !== 0;
    return (frac ? fmtKopecks : fmtWhole).format(r) + " ₽";
  };
  // Скидки показываются со знаком минус: −1 629 ₽.
  const neg = (n) => (n > 0 ? "−" : "") + fmt(n);

  const clampQ = (v) => Math.min(QMAX, Math.max(QMIN, v));

  // Валидаторы полей попапа. Регулярка почты намеренно простая: за RFC 5322
  // гоняться смысла нет, живой адрес всё равно проверит только письмо. Телефон —
  // ровно 11 цифр (маска даёт +7 (999) 123-45-67). String() — поля могут быть
  // не заданы в состоянии (например, в юнит-тестах calc).
  const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s));
  const phoneOk = (s) => String(s).replace(/\D/g, "").length === 11;
  // МЁРТВОЕ: кормит только r.imgUrl, который view.js не читает — картинки в
  // разметке статические. См. FIXES.md #11.
  const imgUrl = (name) => "assets/products/" + name + ".png";

  // Главный расчёт. state: { qty, checked, removed, activeGroup, status,
  // showMarkdownTab, showPromoTab }.
  function compute(state) {
    const { qty, checked, removed, activeGroup, showMarkdownTab, showPromoTab } = state;
    const qtyOf = (it) => qty[it.id] ?? it.qty;

    // Служебные тумблеры прототипа включают и выключают вкладки.
    const enabledCatalog = catalog.filter(g =>
      g.id === "regular" || (g.id === "markdown" && showMarkdownTab) || (g.id === "promo" && showPromoTab));

    // Группы для вкладок: удалённые товары исключаются, сумма вкладки считается
    // по цене мастера выбранных позиций.
    const groups = enabledCatalog.map(g => {
      const items = g.items.filter(it => !removed[it.id]);
      const checkedItems = items.filter(it => checked[it.id]);
      // ВОПРОС ВЛАДЕЛЬЦУ, не баг под починку: сумма берёт it.unit без mult и без
      // скидок — единственное число на странице на другой ценовой базе. Поэтому
      // она не сходится со строками под ней НИ ПРИ ОДНОМ статусе и вообще не
      // реагирует на статус: стоит 7 330 ₽ для всех, пока строки идут от 6 209
      // (Супер VIP) до 14 661 (РРЦ, ровно вдвое). Итог и строки между собой
      // согласованы — расходится только это. См. FIXES.md #14.
      const sum = checkedItems.reduce((a, it) => a + Math.round(it.unit * qtyOf(it)), 0);
      return { ...g, items, checkedItems, sum };
    });

    const shownGroup = groups.find(g => g.id === activeGroup) || groups[0];
    // Когда доступна только одна группа, строка вкладок скрывается целиком.
    const showTabsRow = groups.length > 1;
    const regularGroup = groups.find(g => g.id === "regular") || groups[0];
    const markdownGroup = groups.find(g => g.id === "markdown");
    const promoGroup = groups.find(g => g.id === "promo");

    const curStatus = statuses.find(s => s.id === state.status) || statuses[0];
    const isBrandItem = (it) => DISCOUNT_BRANDS.indexOf(it.brand) !== -1;
    const statusPctOf = (it) => (isBrandItem(it) ? curStatus.brand : curStatus.base);

    // --- скидка за объём ---
    // Считается по розничной сумме выбранных обычных товаров до всех скидок.
    // У РРЦ розничная база вдвое выше мастерской (mult).
    // ДУБЛЬ: то же самое ниже как statusMult. См. FIXES.md #11.
    const volMult = curStatus.mult || 1;
    const regRetailSum = regularGroup.items.reduce((acc, it) =>
      acc + (checked[it.id] ? (it.retail != null ? it.retail : it.unit) * volMult * qtyOf(it) : 0), 0);
    const tiers = discountTiers;
    // Активный порог — первый ещё не достигнутый: он подсвечивает текущий сегмент.
    const activeTierIdx = tiers.findIndex(t => regRetailSum < t.threshold);
    // Применяется самый высокий достигнутый порог.
    let activeTierLabel = null;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (regRetailSum >= tiers[i].threshold) { activeTierLabel = tiers[i].label; break; }
    }
    const volumePct = activeTierLabel ? parseInt(activeTierLabel, 10) : 0;

    // Позиция получает большую из двух скидок — объёмную или статусную.
    // При точном равенстве скидка считается объёмной, но только в смешанной
    // корзине, где есть хотя бы один товар со статусной скидкой выше объёмной.
    let nStatusHigher = 0, nCheckedRegular = 0;
    regularGroup.items.forEach(it => {
      if (!checked[it.id]) return;
      nCheckedRegular++;
      if (statusPctOf(it) > volumePct) nStatusHigher++;
    });
    const tieToVolume = nStatusHigher >= 1;
    const sourceIsVolume = (it) => {
      if (volumePct <= 0) return false;
      const s = statusPctOf(it);
      if (volumePct > s) return true;
      if (s > volumePct) return false;
      return tieToVolume; // точное равенство
    };
    let nVolumeSourced = 0;
    regularGroup.items.forEach(it => { if (checked[it.id] && sourceIsVolume(it)) nVolumeSourced++; });
    // Подпись показывает, применилась ли объёмная скидка ко всем, к части или ни к кому.
    let volumeStatusText;
    if (volumePct === 0 || nCheckedRegular === 0) volumeStatusText = "не применена";
    else if (nVolumeSourced === nCheckedRegular) volumeStatusText = volumePct + "% — применена";
    else if (nVolumeSourced >= 1) volumeStatusText = volumePct + "% — частично применена";
    else volumeStatusText = "не применена";

    // Единый расчёт цены обычного товара — им пользуются и строки, и итоги,
    // поэтому суммы не расходятся.
    const statusMult = curStatus.mult || 1; // ДУБЛЬ volMult выше.
    // МЁРТВОЕ: единственный читатель — `curStatus.noDiscLabel || priceRoot` ниже, а эта
    // ветка живёт только при нулевой скидке, то есть у rrc и master — и у обоих
    // noDiscLabel задан. Остальные статусы имеют base >= 10 и до неё не доходят.
    const priceRoot = curStatus.priceRoot || "Проф. Цена";
    const shortRoot = curStatus.shortRoot || "ПЦ";
    const priceInfoOf = (it, nOverride) => {
      const n = nOverride != null ? nOverride : qtyOf(it);
      const base = (it.retail != null ? it.retail : it.unit) * statusMult;
      const statusPct = statusPctOf(it);
      const useVol = sourceIsVolume(it);
      // Акция по количеству перебивает и статусную, и объёмную скидку.
      const qtyPromo = !!(it.qtyPromoThreshold && n >= it.qtyPromoThreshold);
      const appliedPct = qtyPromo ? it.qtyPromoPct : (useVol ? volumePct : statusPct);
      const unitPrice = base * (1 - appliedPct / 100);
      let label;
      if (qtyPromo) label = "Цена по Акции";
      else if (useVol) label = shortRoot + " со скидкой\n" + volumePct + "% за объём";
      else if (statusPct > 0) label = shortRoot + " со скидкой\n" + curStatus.name + " " + statusPct + "%";
      else label = curStatus.noDiscLabel || priceRoot;
      return { base, statusPct, useVol, appliedPct, unitPrice, label, qtyPromo };
    };

    const volumeSegments = tiers.map((t, i) => {
      const prev = i === 0 ? 0 : tiers[i - 1].threshold;
      const achieved = regRetailSum >= t.threshold;
      const isActive = i === activeTierIdx;
      const isLast = i === tiers.length - 1;
      // Последний порог остаётся крупным после достижения; иначе крупный только текущий.
      const isBig = isActive || (isLast && achieved);
      // Применённый порог — самый высокий достигнутый: его процент тёмно-зелёный.
      const isApplied = achieved && (isLast || regRetailSum < tiers[i + 1].threshold);
      // Заполнение активного сегмента — положение суммы между началом и концом порога.
      const fillPct = achieved ? 100
        : (isActive ? Math.max(0, Math.min(100, ((regRetailSum - prev) / (t.threshold - prev)) * 100)) : 0);
      // МЁРТВОЕ: amount и percent никто не читает — суммы порогов и проценты в
      // разметке статические. amount вдобавок дорогой: fmt() это Intl, пять
      // вызовов впустую на каждый пересчёт (~150 мкс). См. FIXES.md #11 и #6.
      return { id: String(t.threshold), amount: fmt(t.threshold), percent: t.label, achieved, isBig, isApplied, fillPct };
    });

    // --- вкладки ---
    const tabs = groups.map(g => {
      const allChecked = g.items.length > 0 && g.items.every(it => checked[it.id]);
      const noneChecked = g.checkedItems.length === 0;
      return {
        id: g.id,
        name: g.name,
        countChecked: g.checkedItems.length,
        sumText: fmt(g.sum),
        checked: allChecked,
        // Чекбокс вкладки трёхсостояночный: всё / часть / ничего.
        triState: allChecked ? "on" : (noneChecked ? "off" : "partial"),
        active: g.id === activeGroup,
      };
    });

    // --- строки товаров ---
    const makeRow = (it, borderTop) => {
      const n = it.qtyLocked ? 1 : qtyOf(it);
      let unitPrice = it.unit;
      let priceLabelText = it.priceLabel || "";
      let qtyPromoActive = false, qtyPromoBase = null;
      if (shownGroup.kind === "regular") {
        const info = priceInfoOf(it, n);
        unitPrice = info.unitPrice;
        priceLabelText = info.label;
        if (info.qtyPromo) { qtyPromoActive = true; qtyPromoBase = info.base; }
      }
      const lineTotal = Math.round(unitPrice * n);
      // Зачёркнутая цена: уценка, цена без акции или база до акции по количеству.
      const hasOld = it.old != null || it.list != null || qtyPromoActive;
      const oldPrice = it.old != null ? it.old : (it.list != null ? it.list : qtyPromoBase);
      const oldTotal = hasOld ? Math.round(oldPrice * n) : 0;
      return {
        id: it.id,
        isHeader: false,
        // МЁРТВОЕ: view.js не рисует ни имени, ни артикула, ни картинки — всё это
        // в разметке статическое. Готовится на каждый пересчёт и выбрасывается.
        // Выкидывать не спешить: в бою их напечатает $arResult. См. FIXES.md #10.
        name: it.name,
        meta: "арт. " + it.art + "  •  бренд " + it.brand,
        imgUrl: imgUrl(it.img),
        borderTop,
        qty: n,
        checked: !!checked[it.id],
        lineText: fmt(lineTotal),
        showOld: hasOld,
        oldText: hasOld ? fmt(oldTotal) : "",
        priceTypeText: priceLabelText,
        isPromoLabel: qtyPromoActive,
        hasPromoBadge: !!it.hasPromoBadge,
        qtyLocked: !!it.qtyLocked,
        atMin: n <= QMIN,
        atMax: n >= QMAX,
        // Цена за единицу показывается только когда штук больше одной.
        perUnitText: n > 1 ? (fmt(Math.round(unitPrice)) + "/ед") : " ",
      };
    };

    let rows;
    if (shownGroup.kind === "promo") {
      // Акционные товары группируются по названию акции — появляются разделители.
      const groupOrder = [];
      const groupMap = {};
      shownGroup.items.forEach(it => {
        const g = it.promoGroup || "Прочее";
        if (!groupMap[g]) { groupOrder.push(g); groupMap[g] = []; }
        groupMap[g].push(it);
      });
      rows = [];
      let isFirst = true;
      groupOrder.forEach(gName => {
        // isHeader живой: по нему view.js решает, показывать ли .promo-header.
        // А title и isFirstHeader — мёртвые, заголовки в разметке статические.
        rows.push({ id: "h-" + gName, isHeader: true, title: gName, isFirstHeader: isFirst });
        isFirst = false;
        groupMap[gName].forEach(it => { rows.push(makeRow(it, true)); });
      });
    } else {
      rows = shownGroup.items.map((it, i) => makeRow(it, i > 0));
    }

    // --- итоги ---
    // Считаются по всему каталогу, а не по активной вкладке: только выбранные и
    // не удалённые позиции включённых групп.
    let regularBase = 0, regularVolDisc = 0, regularStatDisc = 0, regularPromoDisc = 0;
    let markdownGoods = 0, markdownDisc = 0, promoGoods = 0, promoDisc = 0;
    // Итоги идут по enabledCatalog — тому же источнику, что вкладки, строки и
    // шкала объёма. Раньше здесь по всему catalog заново отсекались выключенные
    // вкладки (дубль правила из enabledCatalog выше); свели в один источник, чтобы
    // суммы не могли молча разъехаться. Покрыто ловушкой в tests/calc.scenarios.js.
    enabledCatalog.forEach(g => g.items.forEach(it => {
      if (removed[it.id] || !checked[it.id]) return;
      const n = qtyOf(it);
      if (g.kind === "regular") {
        const info = priceInfoOf(it, n);
        regularBase += info.base * n;
        const d = info.base * (info.appliedPct / 100) * n;
        if (info.qtyPromo) regularPromoDisc += d;
        else if (info.useVol) regularVolDisc += d;
        else regularStatDisc += d;
      } else if (g.kind === "markdown") {
        markdownGoods += (it.old || it.unit) * n;
        markdownDisc += ((it.old || it.unit) - it.unit) * n;
      } else if (g.kind === "promo") {
        promoGoods += (it.list || it.unit) * n;
        // НЕСИММЕТРИЧНО: здесь Math.round, а у markdownDisc выше — нет. Без причины.
        // Сейчас на копейки не влияет (итог всё равно округляется), но это
        // ловушка для того, кто будет менять формулу. См. FIXES.md #11.
        promoDisc += Math.round(((it.list || it.unit) - it.unit) * n);
      }
    }));

    // В итогах показываем только те скидки, которые реально применились.
    const regDiscLines = [];
    if (regularStatDisc > 0) regDiscLines.push({ id: "stat", label: "Скидка по статусу (" + curStatus.name + ")", amount: neg(Math.round(regularStatDisc)) });
    if (regularVolDisc > 0) regDiscLines.push({ id: "vol", label: "Скидка за объём (" + volumePct + "%)", amount: neg(Math.round(regularVolDisc)) });
    if (regularPromoDisc > 0) regDiscLines.push({ id: "promo", label: "Скидка по акции (от 25 шт.)", amount: neg(Math.round(regularPromoDisc)) });

    const total = (regularBase - regularVolDisc - regularStatDisc - regularPromoDisc) + (markdownGoods - markdownDisc) + (promoGoods - promoDisc);
    const savings = regularVolDisc + regularStatDisc + regularPromoDisc + markdownDisc + promoDisc;

    // Блоки уценки и акций в итоге видны, если в группе отмечено хоть что-то.
    const showMarkdownSummary = !!markdownGroup && markdownGroup.items.some(it => checked[it.id]);
    const showPromoSummary = !!promoGroup && promoGroup.items.some(it => checked[it.id]);
    const anyItemChecked = enabledCatalog.some(g => g.items.some(it => !removed[it.id] && checked[it.id]));
    const totalPositions = enabledCatalog.reduce((a, g) => a + g.items.filter(it => !removed[it.id]).length, 0);

    // Гейт кнопки «Подтвердить»: обе галочки согласия + все три поля валидны
    // (в разметке помечены «*»). Правило живёт здесь, в calc, а не в слое
    // отрисовки. type="email" без <form> ничего не проверяет, поэтому проверяем сами.
    const canConfirm = !!(state.agree1 && state.agree2
      && String(state.formName || "").trim().length >= 2
      && emailOk(state.formEmail)
      && phoneOk(state.formPhone));

    return {
      canConfirm,
      // МЁРТВОЕ: status и activeGroupKind ниже — ноль читателей в view.js.
      status: curStatus,
      isMaster: curStatus.id === "master",
      isUnauth: curStatus.id === "rrc",
      statusName: curStatus.id === "master" ? "" : curStatus.name,
      hasStatusName: curStatus.id !== "master",
      badges: curStatus.badges || [],
      tabs,
      showTabsRow,
      activeGroupKind: shownGroup.kind,
      showVolumeBar: shownGroup.id === "regular",
      volumeStatusText,
      volumeSegments,
      rows,
      isEmpty: shownGroup.items.length === 0,
      totalPositions,
      showKeepNotice: totalPositions > 0,
      anyItemChecked,
      showPromoNotice: regularGroup.items.some(it => it.hasPromoBadge),
      regDiscLines,
      showMarkdownSummary,
      showPromoSummary,
      sum: {
        goods: fmt(Math.round(regularBase)),
        markdown: fmt(Math.round(markdownGoods)),
        markdownDisc: neg(Math.round(markdownDisc)),
        promo: fmt(Math.round(promoGoods)),
        promoDisc: neg(Math.round(promoDisc)),
        total: fmt(Math.round(total)),
        savings: fmt(Math.round(savings)),
      },
    };
  }

  // Маска телефона в попапе: +7 (999) 123-45-67. Прогрессивная — не рисует того,
  // чего ещё не ввели, поэтому backspace доходит до пустой строки не застревая.
  function phoneDigits(val) {
    let d = String(val).replace(/\D/g, "");
    if (d[0] === "7" || d[0] === "8") d = d.slice(1);   // код страны либо восьмёрка
    return d.slice(0, 10);
  }
  function phoneFormat(d) {
    if (!d) return "";
    let out = "+7 (" + d.slice(0, 3);
    if (d.length >= 3) out += ")";
    if (d.length > 3) out += " " + d.slice(3, 6);
    if (d.length > 6) out += "-" + d.slice(6, 8);
    if (d.length > 8) out += "-" + d.slice(8, 10);
    return out;
  }

  // fmt и neg снаружи никто не читает — используются только внутри. Убирать из
  // экспорта в последнюю очередь: после переезда на Битрикс форматирование может
  // понадобиться шаблону. См. FIXES.md #11.
  return { compute, fmt, neg, clampQ, phoneDigits, phoneFormat };
})();

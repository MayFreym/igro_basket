// Расчёты корзины: цены позиций, скидки, шкала объёма, итоги.
// Чистые функции — ни DOM, ни брейкпоинтов. На вход состояние, на выход модель.
window.Cart = window.Cart || {};

window.Cart.calc = (() => {
  "use strict";

  const { catalog, discountTiers, statuses, DISCOUNT_BRANDS, QMIN, QMAX } = window.Cart.data;

  // 1 350 ₽ — неразрывный пробел перед рублём, копейки только когда они есть.
  const fmt = (n) => {
    const r = Math.round(n * 100) / 100;
    const frac = Math.round(r * 100) % 100 !== 0;
    return r.toLocaleString("ru-RU", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 }) + " ₽";
  };
  // Скидки показываются со знаком минус: −1 629 ₽.
  const neg = (n) => (n > 0 ? "−" : "") + fmt(n);

  const clampQ = (v) => Math.min(QMAX, Math.max(QMIN, v));
  // МЁРТВОЕ: кормит только r.imgUrl, который view.js не читает — картинки в
  // разметке статические. См. FIXES.md #11.
  const imgUrl = (name) => "assets/products/" + name + ".png";

  // Главный расчёт. state: { qty, checked, removed, activeGroup, status,
  // showMarkdownTab, showPromoTab }.
  function compute(state) {
    const { qty, checked, removed, activeGroup, showMarkdownTab, showPromoTab } = state;
    const q = (it) => qty[it.id] ?? it.qty;

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
      const sum = checkedItems.reduce((a, it) => a + Math.round(it.unit * q(it)), 0);
      return { ...g, items, checkedItems, sum };
    });

    const activeG = groups.find(g => g.id === activeGroup) || groups[0];
    // Когда доступна только одна группа, строка вкладок скрывается целиком.
    const showTabsRow = groups.length > 1;
    const regularG = groups.find(g => g.id === "regular") || groups[0];
    const markdownG = groups.find(g => g.id === "markdown");
    const promoG = groups.find(g => g.id === "promo");

    const cur = statuses.find(s => s.id === state.status) || statuses[0];
    const isBrandItem = (it) => DISCOUNT_BRANDS.indexOf(it.brand) !== -1;
    const statusPctOf = (it) => (isBrandItem(it) ? cur.brand : cur.base);

    // --- скидка за объём ---
    // Считается по розничной сумме выбранных обычных товаров до всех скидок.
    // У РРЦ розничная база вдвое выше мастерской (mult).
    // ДУБЛЬ: то же самое ниже как statusMult. См. FIXES.md #11.
    const volMult = cur.mult || 1;
    const regRetailSum = regularG.items.reduce((acc, it) =>
      acc + (checked[it.id] ? (it.retail != null ? it.retail : it.unit) * volMult * q(it) : 0), 0);
    const tiers = discountTiers;
    // Активный порог — первый ещё не достигнутый: он подсвечивает текущий сегмент.
    const activeIdx = tiers.findIndex(t => regRetailSum < t.threshold);
    // Применяется самый высокий достигнутый порог.
    let activeTierLabel = null;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (regRetailSum >= tiers[i].threshold) { activeTierLabel = tiers[i].label; break; }
    }
    const vPct = activeTierLabel ? parseInt(activeTierLabel, 10) : 0;

    // Позиция получает большую из двух скидок — объёмную или статусную.
    // При точном равенстве скидка считается объёмной, но только в смешанной
    // корзине, где есть хотя бы один товар со статусной скидкой выше объёмной.
    let nStatG = 0, nReg = 0;
    regularG.items.forEach(it => {
      if (!checked[it.id]) return;
      nReg++;
      if (statusPctOf(it) > vPct) nStatG++;
    });
    const tieToVolume = nStatG >= 1;
    const sourceIsVolume = (it) => {
      if (vPct <= 0) return false;
      const s = statusPctOf(it);
      if (vPct > s) return true;
      if (s > vPct) return false;
      return tieToVolume; // точное равенство
    };
    let nVolSrc = 0;
    regularG.items.forEach(it => { if (checked[it.id] && sourceIsVolume(it)) nVolSrc++; });
    // Подпись показывает, применилась ли объёмная скидка ко всем, к части или ни к кому.
    let volumeStatusText;
    if (vPct === 0 || nReg === 0) volumeStatusText = "не применена";
    else if (nVolSrc === nReg) volumeStatusText = vPct + "% — применена";
    else if (nVolSrc >= 1) volumeStatusText = vPct + "% — частично применена";
    else volumeStatusText = "не применена";

    // Единый расчёт цены обычного товара — им пользуются и строки, и итоги,
    // поэтому суммы не расходятся.
    const statusMult = cur.mult || 1; // ДУБЛЬ volMult выше.
    // МЁРТВОЕ: единственный читатель — `cur.noDiscLabel || priceRoot` ниже, а эта
    // ветка живёт только при нулевой скидке, то есть у rrc и master — и у обоих
    // noDiscLabel задан. Остальные статусы имеют base >= 10 и до неё не доходят.
    const priceRoot = cur.priceRoot || "Проф. Цена";
    const shortRoot = cur.shortRoot || "ПЦ";
    const priceInfoOf = (it, nOverride) => {
      const n = nOverride != null ? nOverride : q(it);
      const base = (it.retail != null ? it.retail : it.unit) * statusMult;
      const sPct = statusPctOf(it);
      const useVol = sourceIsVolume(it);
      // Акция по количеству перебивает и статусную, и объёмную скидку.
      const qtyPromo = !!(it.qtyPromoThreshold && n >= it.qtyPromoThreshold);
      const apPct = qtyPromo ? it.qtyPromoPct : (useVol ? vPct : sPct);
      const unitPrice = base * (1 - apPct / 100);
      let label;
      if (qtyPromo) label = "Цена по Акции";
      else if (useVol) label = shortRoot + " со скидкой\n" + vPct + "% за объём";
      else if (sPct > 0) label = shortRoot + " со скидкой\n" + cur.name + " " + sPct + "%";
      else label = cur.noDiscLabel || priceRoot;
      return { base, sPct, useVol, apPct, unitPrice, label, qtyPromo };
    };

    const volumeSegments = tiers.map((t, i) => {
      const prev = i === 0 ? 0 : tiers[i - 1].threshold;
      const achieved = regRetailSum >= t.threshold;
      const isActive = i === activeIdx;
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
      const n = it.qtyLocked ? 1 : q(it);
      let unitPrice = it.unit;
      let priceLabelText = it.priceLabel || "";
      let qtyPromoActive = false, qtyPromoBase = null;
      if (activeG.kind === "regular") {
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
    if (activeG.kind === "promo") {
      // Акционные товары группируются по названию акции — появляются разделители.
      const groupOrder = [];
      const groupMap = {};
      activeG.items.forEach(it => {
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
      rows = activeG.items.map((it, i) => makeRow(it, i > 0));
    }

    // --- итоги ---
    // Считаются по всему каталогу, а не по активной вкладке: только выбранные и
    // не удалённые позиции включённых групп.
    let regBase = 0, regVolDisc = 0, regStatDisc = 0, regPromoDisc = 0;
    let mGoods = 0, mDisc = 0, pGoods = 0, pDisc = 0;
    catalog.forEach(g => g.items.forEach(it => {
      if (removed[it.id] || !checked[it.id]) return;
      // ОСТОРОЖНО, ДУБЛЬ: правило включённых вкладок повторяет enabledCatalog
      // выше. Разойдутся эти два места — суммы разъедутся молча, без ошибки.
      // См. FIXES.md #11: единственный пункт здесь с денежным риском.
      if (g.id === "markdown" && !showMarkdownTab) return;
      if (g.id === "promo" && !showPromoTab) return;
      const n = q(it);
      if (g.kind === "regular") {
        const info = priceInfoOf(it, n);
        regBase += info.base * n;
        const d = info.base * (info.apPct / 100) * n;
        if (info.qtyPromo) regPromoDisc += d;
        else if (info.useVol) regVolDisc += d;
        else regStatDisc += d;
      } else if (g.kind === "markdown") {
        mGoods += (it.old || it.unit) * n;
        mDisc += ((it.old || it.unit) - it.unit) * n;
      } else if (g.kind === "promo") {
        pGoods += (it.list || it.unit) * n;
        // НЕСИММЕТРИЧНО: здесь Math.round, а у mDisc выше — нет. Без причины.
        // Сейчас на копейки не влияет (итог всё равно округляется), но это
        // ловушка для того, кто будет менять формулу. См. FIXES.md #11.
        pDisc += Math.round(((it.list || it.unit) - it.unit) * n);
      }
    }));

    // В итогах показываем только те скидки, которые реально применились.
    const regDiscLines = [];
    if (regStatDisc > 0) regDiscLines.push({ id: "stat", label: "Скидка по статусу (" + cur.name + ")", amount: neg(Math.round(regStatDisc)) });
    if (regVolDisc > 0) regDiscLines.push({ id: "vol", label: "Скидка за объём (" + vPct + "%)", amount: neg(Math.round(regVolDisc)) });
    if (regPromoDisc > 0) regDiscLines.push({ id: "promo", label: "Скидка по акции (от 25 шт.)", amount: neg(Math.round(regPromoDisc)) });

    const total = (regBase - regVolDisc - regStatDisc - regPromoDisc) + (mGoods - mDisc) + (pGoods - pDisc);
    const savings = regVolDisc + regStatDisc + regPromoDisc + mDisc + pDisc;

    // Блоки уценки и акций в итоге видны, если в группе отмечено хоть что-то.
    const showMarkdownSummary = !!markdownG && markdownG.items.some(it => checked[it.id]);
    const showPromoSummary = !!promoG && promoG.items.some(it => checked[it.id]);
    const anyItemChecked = enabledCatalog.some(g => g.items.some(it => !removed[it.id] && checked[it.id]));
    const totalPositions = enabledCatalog.reduce((a, g) => a + g.items.filter(it => !removed[it.id]).length, 0);

    return {
      // МЁРТВОЕ: status и activeGroupKind ниже — ноль читателей в view.js.
      status: cur,
      isMaster: cur.id === "master",
      isUnauth: cur.id === "rrc",
      statusName: cur.id === "master" ? "" : cur.name,
      hasStatusName: cur.id !== "master",
      badges: cur.badges || [],
      tabs,
      showTabsRow,
      activeGroupKind: activeG.kind,
      showVolumeBar: activeG.id === "regular",
      volumeStatusText,
      volumeSegments,
      rows,
      isEmpty: activeG.items.length === 0,
      totalPositions,
      showKeepNotice: totalPositions > 0,
      anyItemChecked,
      showPromoNotice: regularG.items.some(it => it.hasPromoBadge),
      regDiscLines,
      showMarkdownSummary,
      showPromoSummary,
      sum: {
        goods: fmt(Math.round(regBase)),
        markdown: fmt(Math.round(mGoods)),
        markdownDisc: neg(Math.round(mDisc)),
        promo: fmt(Math.round(pGoods)),
        promoDisc: neg(Math.round(pDisc)),
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

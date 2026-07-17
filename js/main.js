// Состояние корзины, обработка событий и запуск.
// События ловятся делегированием на document: обработчики вешаются один раз и
// продолжают работать, даже когда строки прячутся и показываются.
(() => {
  "use strict";

  // МЁРТВОЕ: QMAX здесь не используется — ограничение сверху накладывает clampQ
  // внутри calc.js. См. FIXES.md #13.
  const { catalog, QMIN, QMAX } = window.Cart.data;
  const { clampQ, applyPhoneMask } = window.Cart.calc;
  const { refresh, fillStatusSelect } = window.Cart.view;

  const bpOf = (w) => (w >= 1280 ? "desktop" : w >= 768 ? "tablet" : "mobile");

  const state = (() => {
    const qty = {}, checked = {};
    // На старте выбраны все товары, количество берётся из каталога.
    catalog.forEach(g => g.items.forEach(it => { qty[it.id] = it.qty; checked[it.id] = true; }));
    return {
      qty, checked, removed: {},
      activeGroup: "regular",
      status: "rrc",
      bp: bpOf(window.innerWidth),
      showMarkdownTab: true,
      showPromoTab: true,
      infoHidden: false,
      checkoutModalOpen: false,
      formName: "", formEmail: "", formPhone: "",
      agree1: false, agree2: false,
      // Открытые подсказки: шкала объёма, бейдж статуса, значок акции в строке.
      volTipOpen: false,
      openTip: null,
      promoTipOpen: null,
    };
  })();

  // Одна точка пересчёта: меняем состояние — перерисовываем всё.
  // Для страницы такого размера это дешевле, чем разводить обновления вручную.
  let queued = false;
  function update(patch) {
    Object.assign(state, patch);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; refresh(state); });
  }

  const rowIdOf = (el) => { const r = el.closest("[data-row]"); return r ? r.dataset.row : null; };
  // ЛИШНИЙ ЦИКЛ: state.qty заполняется для всех позиций на старте (строка выше), а
  // update только копирует его через spread — значит state.qty[id] есть всегда,
  // `?? it.qty` не срабатывает никогда, и обход каталога ищет запасное значение,
  // до которого не дойти. Эквивалент: (id) => state.qty[id] ?? QMIN.
  // См. FIXES.md #13.
  const qtyOf = (id) => {
    for (const g of catalog) for (const it of g.items) if (it.id === id) return state.qty[id] ?? it.qty;
    return QMIN;
  };

  // --- клики ---
  document.addEventListener("click", (e) => {
    const t = e.target;

    // Клик внутри подсказки не должен её закрывать.
    if (t.closest(".tip")) { e.stopPropagation(); return; }

    // Переключение вкладки. Клик по чекбоксу вкладки сюда ДОХОДИТ — его отсеивает
    // проверка !t.closest("[data-tab-check]") ниже. Убрать её, решив что «не
    // доходит», — и клик по чекбоксу начнёт заодно переключать вкладку.
    // (Прежний комментарий утверждал обратное. См. FIXES.md #13.)
    const tab = t.closest("[data-tab]");
    if (tab && !t.closest("[data-tab-check]")) { update({ activeGroup: tab.dataset.tab }); return; }

    const dec = t.closest("[data-qty-dec]");
    if (dec) { const id = rowIdOf(dec); update({ qty: { ...state.qty, [id]: clampQ(qtyOf(id) - 1) } }); return; }

    const inc = t.closest("[data-qty-inc]");
    if (inc) { const id = rowIdOf(inc); update({ qty: { ...state.qty, [id]: clampQ(qtyOf(id) + 1) } }); return; }

    const rm = t.closest("[data-remove]");
    if (rm) { update({ removed: { ...state.removed, [rowIdOf(rm)]: true } }); return; }

    if (t.closest("[data-hide-info]")) { update({ infoHidden: true }); return; }

    // Обе кнопки неавторизованного ведут в один попап.
    if (t.closest("[data-btn-noreg]") || t.closest("[data-btn-reg]")) { update({ checkoutModalOpen: true }); return; }
    if (t.closest("[data-modal-close]") || t.closest("[data-modal-confirm]")) { update({ checkoutModalOpen: false }); return; }
    // Клик по затемнению мимо карточки закрывает попап.
    if (t.matches("[data-modal]")) { update({ checkoutModalOpen: false }); return; }

    // Дальше — только подсказки, и только там, где нет наведения: на мыши ими
    // целиком управляет CSS, клик не должен оставлять их открытыми после ухода.
    // МЕЛОЧЬ: matchMedia зовётся на каждый клик, каждый раз новый объект. Поднять
    // наверх один раз — MediaQueryList живой, .matches продолжит отвечать на
    // смену устройства. См. FIXES.md #13.
    if (window.matchMedia("(hover: hover)").matches) return;

    if (t.closest("[data-vol-tip-wrap]")) { update({ volTipOpen: !state.volTipOpen }); return; }

    const badge = t.closest("[data-badge]");
    if (badge && badge.querySelector("[data-badge-tip-text]").textContent) {
      const key = "badge-" + badge.dataset.badge;
      update({ openTip: state.openTip === key ? null : key });
      return;
    }
    if (t.closest("[data-mm-pill]")) { update({ openTip: state.openTip === "mm-pill" ? null : "mm-pill" }); return; }

    const promo = t.closest("[data-promo-badge]");
    if (promo) { const id = rowIdOf(promo); update({ promoTipOpen: state.promoTipOpen === id ? null : id }); return; }
  });

  // Наведения здесь нет: подсказки открывает CSS по :hover. Подсказка лежит
  // внутри своего триггера, поэтому :hover держится и когда курсор в ней самой,
  // а зазор закрывает .tip-bridge — задержка на уход больше не нужна.

  // --- переключатели и поля ---
  document.addEventListener("change", (e) => {
    const t = e.target;

    const check = t.closest("[data-check]");
    if (check) { update({ checked: { ...state.checked, [rowIdOf(check)]: check.checked } }); return; }

    // Чекбокс вкладки выбирает или снимает всю группу и делает её активной.
    const all = t.closest("[data-check-all]");
    if (all) {
      const gid = all.dataset.checkAll;
      const g = catalog.find(x => x.id === gid);
      const next = { ...state.checked };
      g.items.forEach(it => { next[it.id] = all.checked; });
      update({ checked: next, activeGroup: gid });
      return;
    }

    // ЛЕСА ПРОТОТИПА: этот обработчик и data-toggle-tab ниже обслуживают служебную
    // панель, которой в бою нет. В бою статус приходит из авторизации и не
    // меняется. См. FIXES.md #13 и #12.
    if (t.matches("[data-status-select]")) { update({ status: t.value }); return; }

    const toggle = t.closest("[data-toggle-tab]");
    if (toggle) {
      const on = toggle.checked;
      const which = toggle.dataset.toggleTab;
      const patch = which === "markdown" ? { showMarkdownTab: on } : { showPromoTab: on };
      // Если выключили активную вкладку — возвращаемся к обычным товарам.
      if (!on && state.activeGroup === which) patch.activeGroup = "regular";
      update(patch);
      return;
    }

    const agree = t.closest("[data-agree]");
    if (agree) { update(agree.dataset.agree === "1" ? { agree1: agree.checked } : { agree2: agree.checked }); return; }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;

    const qtyInput = t.closest("[data-qty-input]");
    if (qtyInput) {
      const raw = String(qtyInput.value).replace(/[^0-9]/g, "");
      let v = parseInt(raw, 10);
      if (isNaN(v)) v = QMIN;
      update({ qty: { ...state.qty, [rowIdOf(qtyInput)]: clampQ(v) } });
      return;
    }

    if (t.matches("[data-form-name]")) { update({ formName: t.value }); return; }
    if (t.matches("[data-form-email]")) { update({ formEmail: t.value }); return; }
    if (t.matches("[data-form-phone]")) { update({ formPhone: applyPhoneMask(t.value) }); return; }
  });

  // Клик в поле количества выделяет содержимое — удобно набрать новое число.
  // Оборотная сторона, размен осознанный: поставить каретку в середину числа
  // мышью становится нельзя. Не баг, не «чинить». См. FIXES.md #13.
  document.addEventListener("focusin", (e) => {
    if (e.target.matches("[data-qty-input]") && e.target.select) e.target.select();
  });

  // Брейкпоинт нужен только там, где меняется разметка или текст;
  // размеры и отступы живут в медиазапросах CSS.
  window.addEventListener("resize", () => {
    const bp = bpOf(window.innerWidth);
    if (bp !== state.bp) update({ bp });
  });

  fillStatusSelect();
  refresh(state);
})();

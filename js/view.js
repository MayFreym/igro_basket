// Отрисовка: берёт модель из calc и раскладывает её по data-точкам разметки.
// Узлы не создаются и не пересоздаются — меняются только тексты, классы и
// атрибуты. Поэтому фокус в полях, каретка и CSS-переходы остаются целы.
// Отсюда же следует, что утечек памяти в проекте нет: оторванным узлам взяться
// неоткуда.
//
// Файл делает ДВЕ разные работы, и путать их не стоит:
//   А. Вписать вычисленные числа (setText, 26 вызовов) — цены, суммы, итог.
//      CSS так не умеет и не сможет: цена это результат расчёта. Ради этого
//      файл и существует.
//   Б. Показать нужный вариант разметки (setShown, 43 вызова) — какая плашка,
//      какая панель, какой бейдж. Вот здесь наследство React: в оригинале было
//      <sc-if>, и при переносе каждый стал вызовом setShown.
//
// Работу Б соблазнительно отдать CSS, но это переезд вбок, а не победа —
// в отличие от подсказок, где :hover браузер знает сам (см. FIXES.md #5).
// activeGroup и status браузеру неизвестны, класс всё равно ставит JS. Плюс
// половина работы Б умрёт на сервере: в бою статус не меняется, а тумблеры
// вкладок — леса прототипа. Разбор целиком — FIXES.md #12.
window.Cart = window.Cart || {};

window.Cart.view = (() => {
  "use strict";

  const { statuses, tabShortNames } = window.Cart.data;
  const { compute } = window.Cart.calc;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Пишем в DOM только при отличии: лишние записи дёргают перерисовку,
  // а на input сбивают каретку.
  const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  const setShown = (el, shown) => { if (el) el.hidden = !shown; };
  const setClass = (el, cls, on) => { if (el) el.classList.toggle(cls, !!on); };
  const setDisabled = (el, off) => { if (el && el.disabled !== !!off) el.disabled = !!off; };
  const setChecked = (el, on) => { if (el && el.checked !== !!on) el.checked = !!on; };
  const setValue = (el, v) => { const s = String(v); if (el && el.value !== s) el.value = s; };

  // Служебный селектор статуса наполняется один раз.
  function fillStatusSelect() {
    const sel = $("[data-status-select]");
    if (!sel || sel.options.length) return;
    statuses.forEach(s => sel.add(new Option(s.optLabel, s.id)));
  }

  // --- плашка статуса ---
  // ДУБЛЬ: ниже на плашку вешаются классы состояния (is-rrc, is-master и т.д.),
  // а потом каждый потомок ещё и прячется вручную. Одних классов хватило бы —
  // CSS сам разберётся, что показывать при .is-rrc. Пятнадцать setShown делают
  // то, что уже сказано классом. См. FIXES.md #12 — единственное место в этом
  // файле, где чистка окупается без переделки архитектуры.
  //
  // Заодно: в бою статус не меняется (приходит из авторизации), вся эта
  // ветвистость существует ради переключателя в служебной панели. На Битриксе
  // PHP напечатает нужную плашку один раз, и функция почти вся испарится.
  function renderStatusBand(m, state) {
    const M = state.bp === "mobile", T = state.bp === "tablet";
    const masterMobile = M && m.isMaster;
    const rrcMobile = M && m.isUnauth;
    const rrcDesktop = m.isUnauth && !M;
    // Тёмная плашка — всё, что не мобильный «Мастер» и не РРЦ.
    const darkBand = !masterMobile && !m.isUnauth;

    const band = $("[data-status-band]");
    setClass(band, "is-rrc", m.isUnauth);
    setClass(band, "is-master", m.isMaster);
    setClass(band, "is-master-mobile", masterMobile);
    setClass(band, "is-rrc-mobile", rrcMobile);

    setShown($("[data-mm-pill]"), masterMobile);
    setShown($("[data-mm-gift]"), masterMobile);
    setText($("[data-mm-tip-text]"), m.badges[0] ? (m.badges[0].tip || "") : "");
    setClass($("[data-mm-tip]"), "is-open", masterMobile && state.openTip === "mm-pill");

    setShown($("[data-rrc-m-pill]"), rrcMobile);
    setShown($("[data-rrc-m-desc]"), rrcMobile);
    setShown($("[data-rrc-m-gift]"), rrcMobile);

    setShown($("[data-rrc-header]"), rrcDesktop);
    setShown($("[data-rrc-divider]"), rrcDesktop);
    setShown($("[data-rrc-pill]"), rrcDesktop);
    setShown($("[data-rrc-desc]"), rrcDesktop);
    setShown($("[data-rrc-loyalty]"), rrcDesktop);
    // На планшете подписи РРЦ короче — целиком другой текст, не размер шрифта.
    setText($("[data-rrc-pill-text]"), T ? "РРЦ" : "Рекомендованная розничная цена");
    setText($("[data-rrc-desc]"), T ? "Авторизуйтесь для проф. цен" : "Авторизуйтесь как мастер, чтобы получить профессиональные цены");

    setShown($("[data-status-header]"), darkBand && !M);
    setShown($("[data-status-divider]"), darkBand && !M);
    setShown($("[data-status-group]"), darkBand);
    setShown($("[data-loyalty-text]"), darkBand && m.isMaster);
    // Подарок виден и на белой плашке РРЦ, и на тёмной у «Мастера».
    setShown($("[data-loyalty-img]"), rrcDesktop || (darkBand && m.isMaster));

    const nameEl = $("[data-status-name]");
    setShown(nameEl, m.hasStatusName);
    setText(nameEl, m.statusName);

    $$("[data-badge]").forEach(el => {
      const i = Number(el.dataset.badge);
      const b = m.badges[i];
      setShown(el, darkBand && !!b);
      if (!b) return;
      const key = "badge-" + i;
      const open = !!b.tip && state.openTip === key;
      setClass(el, "is-master", m.isMaster);
      setClass(el, "has-tip", !!b.tip);
      setClass(el, "is-open", open);
      setShown($("[data-badge-icon]", el), !!b.tip);
      setText($("[data-badge-text]", el), b.t);
      setText($("[data-badge-tip-text]", el), b.tip || "");
      setClass($("[data-badge-tip]", el), "is-open", open);
    });
  }

  // --- вкладки ---
  function renderTabs(m, state) {
    const M = state.bp === "mobile";
    setShown($("[data-tabs-row]"), m.showTabsRow);
    // Без вкладок подложка скругляется со всех сторон.
    setClass($("[data-tabs-card]"), "is-solo", !m.showTabsRow);

    $$("[data-tab]").forEach(el => {
      const id = el.dataset.tab;
      const t = m.tabs.find(x => x.id === id);
      setShown(el, !!t);
      if (!t) return;
      setClass(el, "is-active", t.active);
      // Первая и последняя из видимых вкладок скругляются по краям.
      // МЕЛОЧЬ: visible пересобирается на каждую вкладку — три одинаковых
      // массива вместо одного. Просится наружу цикла. См. FIXES.md #12.
      const visible = m.tabs.map(x => x.id);
      setClass(el, "is-first", visible[0] === id);
      setClass(el, "is-last", visible[visible.length - 1] === id);
      // На мобильном имя короче, а «шт.» не помещается.
      setText($(".tab-name", el), M ? (tabShortNames[id] || t.name) : t.name);
      setText($(".tab-count", el), M ? String(t.countChecked) : t.countChecked + " шт.");
      setText($(".tab-sum", el), t.sumText);
      setChecked($("[data-check-all]", el), t.checked);
      renderCheckbox($(".cb-box", el), t.triState);
    });
  }

  // Чекбокс: три состояния — всё, часть, ничего. Галочка и минус — разные пути.
  function renderCheckbox(box, state) {
    if (!box) return;
    setClass(box, "is-on", state === "on");
    setClass(box, "is-partial", state === "partial");
    const path = $(".cb-check path", box);
    if (path) {
      const d = state === "partial" ? "M5 12h14" : "M5 13l4 4L19 7";
      if (path.getAttribute("d") !== d) path.setAttribute("d", d);
    }
  }

  // --- шкала скидки за объём ---
  function renderVolume(m, state) {
    setShown($("[data-volume-bar]"), m.showVolumeBar);
    setText($("[data-volume-status]"), m.volumeStatusText);
    // Наведение показывает CSS; класс нужен для клика на тач-экранах.
    setClass($("[data-vol-tip]"), "is-open", state.volTipOpen);
    m.volumeSegments.forEach(seg => {
      const el = $('[data-seg="' + seg.id + '"]');
      if (!el) return;
      setClass(el, "is-big", seg.isBig);
      setClass($(".vol-amount", el), "is-achieved", seg.achieved);
      setClass($(".vol-track", el), "is-big", seg.isBig);
      const fill = $(".vol-fill", el);
      setClass(fill, "is-achieved", seg.achieved);
      // Ширина — единственное, что задаётся стилем: величина плавающая.
      const w = seg.fillPct + "%";
      if (fill && fill.style.width !== w) fill.style.width = w;
      const pct = $(".vol-pct", el);
      setClass(pct, "is-achieved", seg.achieved);
      setClass(pct, "is-applied", seg.isApplied);
    });
  }

  // --- строки товаров ---
  function renderRows(m, state) {
    // Панель активной группы показывается, остальные прячутся.
    $$("[data-panel]").forEach(p => setShown(p, p.dataset.panel === state.activeGroup));

    const byId = {};
    m.rows.forEach(r => { byId[r.id] = r; });

    $$("[data-row]").forEach(el => {
      const r = byId[el.dataset.row];
      // Строки чужих групп и удалённые просто не показываем.
      if (!r) { setShown(el, false); return; }
      setShown(el, true);
      // Верхняя граница — у всех, кроме первой видимой строки группы.
      setClass(el, "has-border", r.borderTop);

      setText($("[data-price]", el), r.lineText);
      const old = $("[data-old-price]", el);
      setShown(old, r.showOld);
      setText(old, r.oldText);

      // Цена по акции показывается бейджем, обычная подпись — текстом.
      // МЕЛОЧЬ: оба узла ищутся дважды — четыре запроса там, где хватит двух.
      // Строкой выше (const old) тот же приём сделан правильно. См. FIXES.md #12.
      setShown($("[data-price-type]", el), !r.isPromoLabel);
      setText($("[data-price-type]", el), r.priceTypeText);
      setShown($("[data-price-badge]", el), r.isPromoLabel);
      setText($("[data-price-badge]", el), r.priceTypeText);

      setText($("[data-per-unit]", el), r.perUnitText);
      setChecked($("[data-check]", el), r.checked);
      renderCheckbox($(".row-check .cb-box", el), r.checked ? "on" : "off");

      setShown($("[data-promo-badge]", el), r.hasPromoBadge);
      setClass($("[data-promo-tip]", el), "is-open", r.hasPromoBadge && state.promoTipOpen === r.id);

      // Счётчик либо плашка «1 максимум» — у акционных товаров количество заперто.
      setShown($("[data-qty-stepper]", el), !r.qtyLocked);
      setShown($("[data-qty-locked]", el), r.qtyLocked);
      if (!r.qtyLocked) {
        setValue($("[data-qty-input]", el), r.qty);
        setDisabled($("[data-qty-dec]", el), r.atMin);
        setDisabled($("[data-qty-inc]", el), r.atMax);
      }
    });

    // Заголовки акций скрываются вместе с опустевшей группой.
    const promoHeaderVisible = m.rows.some(r => r.isHeader);
    $$(".promo-header").forEach(el => setShown(el, promoHeaderVisible));

    setShown($("[data-empty]"), m.isEmpty);
    setShown($("[data-keep-notice]"), m.showKeepNotice);
  }

  // --- итог заказа ---
  function renderSummary(m) {
    setText($("[data-sum-goods]"), m.sum.goods);

    // Три возможные строки скидки: показываем те, что реально применились.
    $$("[data-disc]").forEach(el => {
      const d = m.regDiscLines.find(x => x.id === el.dataset.disc);
      setShown(el, !!d);
      if (!d) return;
      setText($("[data-disc-label]", el), d.label);
      setText($("[data-disc-amount]", el), d.amount);
    });

    setShown($("[data-markdown-sum]"), m.showMarkdownSummary);
    setShown($("[data-markdown-sep]"), m.showMarkdownSummary);
    setText($("[data-sum-markdown]"), m.sum.markdown);
    setText($("[data-sum-markdown-disc]"), m.sum.markdownDisc);

    setShown($("[data-promo-sum]"), m.showPromoSummary);
    setShown($("[data-promo-sep]"), m.showPromoSummary);
    setText($("[data-sum-promo]"), m.sum.promo);
    setText($("[data-sum-promo-disc]"), m.sum.promoDisc);

    setText($("[data-sum-total]"), m.sum.total);
    setText($("[data-sum-savings]"), m.sum.savings);

    // Неавторизованному — две кнопки, остальным — одна.
    setShown($("[data-btn-reg]"), m.isUnauth);
    setShown($("[data-btn-noreg]"), m.isUnauth);
    setShown($("[data-btn-checkout]"), !m.isUnauth);
    setDisabled($("[data-btn-reg]"), !m.anyItemChecked);
    setDisabled($("[data-btn-noreg]"), !m.anyItemChecked);
    setDisabled($("[data-btn-checkout]"), !m.anyItemChecked);

    setShown($("[data-promo-notice]"), m.showPromoNotice);
  }

  // --- попап оформления ---
  // Крутится на каждый refresh, даже когда попап закрыт. Отсюда и лишняя работа,
  // и то, что незащищённое разыменование ниже уронит ВСЮ страницу, а не только
  // попап. См. FIXES.md #7 и #12.
  function renderModal(m, state) {
    setShown($("[data-modal]"), state.checkoutModalOpen);
    setText($("[data-modal-total]"), m.sum.total);
    setValue($("[data-form-name]"), state.formName);
    setValue($("[data-form-email]"), state.formEmail);
    setValue($("[data-form-phone]"), state.formPhone);
    setChecked($('[data-agree="1"]'), state.agree1);
    setChecked($('[data-agree="2"]'), state.agree2);
    renderCheckbox($('[data-agree-box="1"]'), state.agree1 ? "on" : "off");
    renderCheckbox($('[data-agree-box="2"]'), state.agree2 ? "on" : "off");
    // Подтвердить можно только с обоими согласиями.
    setDisabled($("[data-modal-confirm]"), !m.canConfirm);
  }

  // Полный пересчёт и раскладка. Зовётся на любое действие: дешевле, чем
  // разводить обновления по каждому обработчику, и ничего не забывается.
  function refresh(state) {
    const m = compute(state);
    // СМЕСЬ СЛОЁВ: модель приходит из calc, а view дописывает в неё поле. Это
    // правило валидации — бизнес-логика в слое отрисовки. Валидация попапа
    // (FIXES.md #3) расширяет ровно эту строку, так что решить надо раньше:
    // правило едет в calc, где ему место, или остаётся здесь.
    m.canConfirm = state.agree1 && state.agree2;

    setText($("[data-bp-label]"), state.bp === "mobile" ? "Mobile · 320–767"
      : state.bp === "tablet" ? "Tablet · 768–1279" : "Desktop · 1280+");
    setValue($("[data-status-select]"), state.status);
    setText($("[data-total-positions]"), String(m.totalPositions));
    setShown($("[data-info-alert]"), m.showTabsRow && !state.infoHidden);
    $$("[data-toggle-tab]").forEach(el => {
      setChecked(el, el.dataset.toggleTab === "markdown" ? state.showMarkdownTab : state.showPromoTab);
    });

    renderStatusBand(m, state);
    renderTabs(m, state);
    renderVolume(m, state);
    renderRows(m, state);
    renderSummary(m);
    renderModal(m, state);
    return m; // Возврат никто не берёт — оба вызова в main.js его игнорируют.
  }

  return { refresh, fillStatusSelect };
})();

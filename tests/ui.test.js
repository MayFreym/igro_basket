// UI/интеракция: гоняет настоящие события на реальном index.html и читает живой
// DOM. Инъектируется в конец копии index.html (после main.js) — см. run.sh.
// Покрывает то, чего не достаёт calc-suite: клики, ввод, вкладки, попап, фокус.
//
// update() в main.js откладывает refresh на requestAnimationFrame, поэтому после
// каждого действия ждём два кадра, прежде чем читать результат.
(async () => {
  "use strict";
  const results = [];
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail == null ? "" : String(detail) });
  const $ = (s, r) => (r || document).querySelector(s);
  // update() откладывает refresh на requestAnimationFrame; в headless rAF под
  // виртуальным временем не пампится, поэтому run.sh подменяет его на setTimeout,
  // а здесь ждём таймером — этого хватает, чтобы отложенный refresh применился.
  const raf = () => new Promise(res => setTimeout(res, 10));
  const click = async (el) => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); await raf(); };
  const change = async (el, checked) => { if (checked != null) el.checked = checked; el.dispatchEvent(new Event("change", { bubbles: true })); await raf(); };
  const type = async (el, val) => { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); await raf(); };
  const txt = (s) => { const e = $(s); return e ? e.textContent.trim() : "<нет>"; };
  const num = (s) => txt(s).replace(/[^0-9]/g, "");

  try {
    await raf(); // дать стартовому refresh отработать

    // --- старт: rrc ---
    rec("старт: К оплате 20 348", num("[data-sum-total]") === "20348", txt("[data-sum-total]"));

    // --- смена статуса через служебный селектор ---
    const sel = $("[data-status-select]");
    sel.value = "supervip"; await change(sel);
    rec("статус supervip: К оплате 11 896", num("[data-sum-total]") === "11896", txt("[data-sum-total]"));
    sel.value = "rrc"; await change(sel);
    rec("возврат rrc: К оплате 20 348", num("[data-sum-total]") === "20348", txt("[data-sum-total]"));

    // --- счётчик количества ---
    const r1 = $('[data-row="r1"]');
    const before = num("[data-sum-total]");
    await click($('[data-qty-inc]', r1));
    rec("qty +: r1 = 5", $('[data-qty-input]', r1).value === "5", $('[data-qty-input]', r1).value);
    rec("qty +: К оплате выросла", num("[data-sum-total]") !== before, txt("[data-sum-total]"));
    await click($('[data-qty-dec]', r1));
    rec("qty -: r1 вернулось 4", $('[data-qty-input]', r1).value === "4", $('[data-qty-input]', r1).value);
    rec("qty -: К оплате вернулась", num("[data-sum-total]") === "20348", txt("[data-sum-total]"));

    // --- снять/вернуть галочку позиции ---
    const cb = $('[data-check]', r1);
    await change(cb, false);
    rec("снять r1: К оплате 9 977", num("[data-sum-total]") === "9977", txt("[data-sum-total]"));
    await change(cb, true);
    rec("вернуть r1: К оплате 20 348", num("[data-sum-total]") === "20348", txt("[data-sum-total]"));

    // --- переключение вкладок ---
    const mdTab = $('[data-tab="markdown"]');
    await click(mdTab);
    rec("вкладка markdown активна", mdTab.classList.contains("is-active"), mdTab.className);
    rec("панель markdown видна", $('[data-panel="markdown"]').hidden === false, String($('[data-panel="markdown"]').hidden));
    rec("панель regular скрыта", $('[data-panel="regular"]').hidden === true, String($('[data-panel="regular"]').hidden));
    await click($('[data-tab="regular"]'));
    rec("возврат вкладки regular", $('[data-panel="regular"]').hidden === false, String($('[data-panel="regular"]').hidden));

    // --- попап оформления ---
    await click($("[data-btn-noreg]"));
    rec("попап открыт", $("[data-modal]").hidden === false, String($("[data-modal]").hidden));

    // --- маска телефона в живом поле ---
    const phone = $("[data-form-phone]");
    await type(phone, "89991234567");
    rec("маска: 8… → +7 (999) 123-45-67", phone.value === "+7 (999) 123-45-67", phone.value);

    // --- гейт кнопки подтверждения (валидация полей) ---
    rec("подтвердить заблокировано на старте попапа", $("[data-modal-confirm]").disabled === true, String($("[data-modal-confirm]").disabled));
    await change($('[data-agree="1"]'), true);
    await change($('[data-agree="2"]'), true);
    rec("подтвердить всё ещё заблокировано: ФИО/e-mail пусты", $("[data-modal-confirm]").disabled === true, String($("[data-modal-confirm]").disabled));
    await type($("[data-form-name]"), "Иван Иванов");
    await type($("[data-form-email]"), "ivan@example.com");
    rec("подтвердить разблокировано: все поля валидны + галочки", $("[data-modal-confirm]").disabled === false, String($("[data-modal-confirm]").disabled));
    await type($("[data-form-email]"), "ivan@");
    rec("подтвердить заблокировано: e-mail стал невалидным", $("[data-modal-confirm]").disabled === true, String($("[data-modal-confirm]").disabled));
    await type($("[data-form-email]"), "ivan@example.com"); // вернуть валидный
    rec("чекбокс согласия 1 отрисован on", $('[data-agree-box="1"]').classList.contains("is-on"), $('[data-agree-box="1"]').className);

    // --- закрытие попапа ---
    await click($("[data-modal-close]"));
    rec("попап закрыт", $("[data-modal]").hidden === true, String($("[data-modal]").hidden));

    // --- сохранение фокуса в поле количества при вводе ---
    await click($('[data-tab="regular"]'));
    const q = $('[data-qty-input]', $('[data-row="r2"]'));
    q.focus();
    await type(q, "7");
    rec("фокус остаётся в поле количества после ввода", document.activeElement === q, document.activeElement ? document.activeElement.tagName : "null");
  } catch (e) {
    rec("ИСКЛЮЧЕНИЕ: " + e.message, false, e.stack || "");
  }

  const passed = results.filter(r => r.pass).length, total = results.length;
  const summary = (passed === total ? "PASS" : "FAIL") + " " + passed + "/" + total;
  document.title = "ui " + summary;
  const pre = document.createElement("pre");
  pre.id = "ui-out";
  pre.textContent = summary + "\n\n" + results.map(r =>
    (r.pass ? "PASS  " : "FAIL  ") + r.name + (r.pass ? "" : "  [было: " + r.detail + "]")).join("\n");
  document.body.appendChild(pre);
})();

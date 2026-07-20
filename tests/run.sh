#!/usr/bin/env bash
# Прогон тестов корзины в headless Chrome. Ничего ставить не нужно — только Chrome.
#   bash tests/run.sh
# Выход 0 — всё зелёное, 1 — есть провал. Печатает сводку и все FAIL-строки.
#
# Два набора:
#   calc — чистые расчёты (../js/data.js + calc.js), замороженные golden-числа.
#   ui   — настоящие клики/ввод на копии index.html, проверка живого DOM.
#
# Про rAF: update() в main.js откладывает refresh на requestAnimationFrame, а он в
# headless под виртуальным временем не пампится. Поэтому для ui-набора мы генерим
# копию index.html и подменяем в ней rAF на setTimeout (шим в <head>). Прод не
# трогаем — шим живёт только в _ui-test.html, который тут же и удаляется.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
if [ ! -f "$CHROME" ]; then
  echo "Chrome не найден: $CHROME" >&2
  echo "Задай путь: CHROME=/путь/к/chrome.exe bash tests/run.sh" >&2
  exit 2
fi

# file:///C:/... из /c/... (Git Bash)
to_url() { echo "file:///$(cygpath -m "$1" 2>/dev/null || echo "$1")"; }

run_dom() {  # $1 = html-файл; печатает dump-dom в stdout
  "$CHROME" --headless --disable-gpu --no-sandbox --dump-dom \
    --virtual-time-budget=20000 "$(to_url "$1")" 2>/dev/null
}

fails=0

echo "== calc =="
CALC_DOM="$(run_dom "$ROOT/tests/calc.test.html")"
CALC_SUMMARY="$(printf '%s' "$CALC_DOM" | grep -oE '<title>calc [^<]*</title>' | sed -E 's/<\/?title>//g')"
echo "$CALC_SUMMARY"
printf '%s' "$CALC_DOM" | grep -oE 'FAIL  [^<]*' || true
case "$CALC_SUMMARY" in *"FAIL"*|"") fails=1 ;; esac

echo
echo "== ui =="
UITMP="$ROOT/_ui-test.html"
# шим rAF в <head> + инъекция теста перед </body>
sed -e 's#</head>#<script>window.requestAnimationFrame=function(cb){return setTimeout(function(){cb(Date.now());},0);};window.cancelAnimationFrame=function(id){clearTimeout(id);};</script>\n</head>#' \
    -e 's#</body>#<script src="tests/ui.test.js"></script>\n</body>#' \
    "$ROOT/index.html" > "$UITMP"
UI_DOM="$(run_dom "$UITMP")"
rm -f "$UITMP"
UI_SUMMARY="$(printf '%s' "$UI_DOM" | grep -oE '<title>ui [^<]*</title>' | sed -E 's/<\/?title>//g')"
echo "${UI_SUMMARY:-ui НЕ ЗАВЕРШИЛСЯ (пустой заголовок)}"
printf '%s' "$UI_DOM" | grep -oE 'FAIL  [^<]*' || true
case "$UI_SUMMARY" in *"FAIL"*|"") fails=1 ;; esac

echo
if [ "$fails" -eq 0 ]; then echo "ИТОГ: всё зелёное"; else echo "ИТОГ: есть провалы"; fi
exit "$fails"

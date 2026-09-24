# فوانيس · Fawanees

**لعبة ضوء وظل اخترعها ذكاء اصطناعي.**
A two-player game of light and shadow, invented by an AI.

**[العب الآن · Play now](https://ahmed-r-z-adwan.github.io/fawanees/)**

صمّم القواعد ووازنها وبرمج الذكاء الاصطناعي: **Claude** من Anthropic.
الفكرة والنشر: **أحمد عدوان**.

Rules, balancing and AI by **Claude** (Anthropic). Idea and publishing by **Ahmed Adwan**.

> This is not an official Anthropic product and uses none of Anthropic's branding.

---

## اللعبة · The game

لوح سداسي من 91 خانة. لكل لاعب 24 فانوساً. في دورك تضع فانوساً في أي خانة فارغة.

- كل فانوس يضيء خانتين في كل اتجاه من اتجاهاته الستة، وأي فانوس يحجب الضوء.
- الخانة الفارغة لمن يضيئها بعدد فوانيس أكبر.
- إذا رأى ثلاثة من فوانيسك فانوساً للخصم، وكانوا أكثر من فوانيسه التي تراه، انقلب إليك — وقد يطلق ذلك **سلسلة**.
- نقاطك: فوانيسك، مضافاً إليها الخانات التي تضيئها وحدك.

A hexagonal board of 91 cells, 24 lanterns each. Place one lantern a turn. Light reaches two cells
in each of six directions and any lantern blocks it. An empty cell belongs to whoever lights it
more. A lantern seen by three enemy lanterns, outnumbering its defenders, switches sides — which can
set off a **chain**. Your score is your lanterns plus the cells only you light.

الشرح الكامل داخل اللعبة: زر **تعلّم** يعلّمك القواعد بست مراحل تلعبها بنفسك.

## التثبيت على الجوال · Install on a phone

**أندرويد (Chrome):** افتح [الرابط](https://ahmed-r-z-adwan.github.io/fawanees/) ← زر القائمة **⋮** ←
**تثبيت التطبيق** أو **إضافة إلى الشاشة الرئيسية** ← **تثبيت**.

**آيفون (Safari):** افتح [الرابط](https://ahmed-r-z-adwan.github.io/fawanees/) في **Safari** ← زر
المشاركة **⬆️** ← **إضافة إلى الشاشة الرئيسية** ← **إضافة**.

بعد التثبيت تعمل اللعبة بدون إنترنت.

*Android (Chrome): menu ⋮ → Install app. iPhone (Safari): Share ⬆️ → Add to Home Screen. It works
offline once installed.*

## بدون إنترنت أصلاً · Without any internet

`dist/fawanees.html` ملف واحد. نزّله وافتحه بأي متصفح، حتى بدون شبكة. لا يطلب شيئاً من الإنترنت
سوى الخطوط.

`dist/fawanees.html` is a single self-contained file. Download it, open it in any browser, works
from disk. Its only external request is Google Fonts.

---

## For developers

```bash
python build.py                 # dist/fawanees.html and pwa/, from src/
npm test                        # 65 unit tests, 30 browser tests
npm run test:unit               # the fast ones
npm run test:browser            # Chromium, WebKit and Android emulation
```

Browser tests need `npm install` first (Puppeteer and Playwright download their own browsers).

### Layout

`src/engine.js` is the rules and the search, and runs in both Node and the browser.
`src/template.html` is the whole UI; `build.py` inlines the engine, the worker, the tutorial, the
puzzles and the generated data into one file.

Four files under `src/` are **generated and must not be edited by hand** — regenerate them:

| file | produced by |
|---|---|
| `src/opening.js` | `node sim/openingMatrix.js && node sim/makeOpeningPolicy.js` |
| `src/calibration.js` | `node sim/calibrate.js` (`--refit` to refit without replaying) |
| `src/puzzles.js` | `node sim/minePuzzles.js` |
| `pwa/icons/*`, `dist/fawanees.ico` | `node test/tools/makeIcons.js` |

Each carries `measured: true` and the numbers behind it, and a test asserts the page and the study
agree. See [CLAUDE.md](CLAUDE.md) for the working rules.

### The measurements

Every number the game shows a player was measured, and every measurement is written up:

- **[docs/REPORT.md](docs/REPORT.md)** — before-and-after for all eight pieces of work
- **[docs/BALANCE.md](docs/BALANCE.md)** — 16,380 games, every opening against every reply, and why the rules stayed as they are
- **[docs/SPEED.md](docs/SPEED.md)** — answer times on a phone-class core
- **[docs/METHOD.md](docs/METHOD.md)** — how the measurements are set up, and two traps that cost real time
- **[docs/NOTES.md](docs/NOTES.md)** — the original experiment log, with its superseded numbers marked

### A Windows desktop icon

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools\desktop-shortcut.ps1
```

## Licence

No licence has been chosen yet; all rights reserved by Ahmed Adwan.

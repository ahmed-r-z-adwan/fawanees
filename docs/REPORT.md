# Fawanees: prototype to release

What changed, and the measurement behind each claim. Every number here was produced by a script in
this repository; the scripts are named so they can be re-run. How the measurements are set up, and
the two mistakes that had to be fixed before any of them meant anything, is in
[METHOD.md](METHOD.md).

Machine for all timings: an 8-core i7-11800H, 16 logical processors, Windows 11, Node 25, Chromium
154 headless.

---

## 1. The page never freezes, and you can watch the machine think

**Before:** the search ran on the thread that draws the board. The page stopped responding for the
whole of the machine's turn.

**After:** the search runs in a Web Worker, built from a Blob of the engine that is already inlined
in the single file. Where a worker cannot start, the same search runs on the main thread in 10 ms
slices scheduled through a MessageChannel. Every completed depth is streamed back and drawn: the
candidate cells glow by score, and the line the machine expects appears as numbered ghost lanterns.

Measured with the browser's own long-task entries and a frame counter, Master level, five turns,
real canvas clicks (`test/tools/freeze.js`, `docs/measurements/step1-freeze.json`):

| | worst long task | total blocked | frames per turn |
|---|---|---|---|
| before | 1003 ms | 4006 ms | 28 |
| after, worker | **0 ms** | **0 ms** | **132** |
| after, main-thread fallback | **0 ms** | **0 ms** | 67 |
| after, worker at 4x throttling | **0 ms** | **0 ms** | 237 |

The engine change that made this possible is a resumable `SearchRun`: `step(deadline)` runs one
depth and, if the deadline cuts it short, leaves the depth un-advanced so the next slice retries it.
The transposition table makes the repeated part nearly free, so a search too big for one slice still
converges. The engine's behavioural fingerprint is unchanged by the refactor
(`test/tools/signature.js`, `63b7bb0dbd341d8e` before and after).

---

## 2. A tutorial you play rather than read

**Before:** a dialog of six rules in prose.

**After:** six lessons on a real board — light, blocking, owning a cell, capture, protection, and
the chain. The player places the lantern themselves and watches the waves resolve.

The positions live in `src/lessons.js` with no prose and no numbers in them. Every figure the
tutorial prints is read back out of the engine at runtime: cells lit, light on a cell, lanterns that
see a lantern, score before and after, lanterns flipped. Two lessons are the verified examples from
CLAUDE.md, cell for cell — the chain (sight 2/1 and 1/1 before, 3/1 and 2/1 once placed, 3/0 after
wave one, waves `[[(0,0)],[(0,2)]]`) and the 3-against-3 protection. Capture and protection are
deliberately the *same move on the same cell*, so the rule and its exception appear one after the
other.

**Verification:** `test/unit/lessons.test.js` re-plays every lesson through the engine.
`test/browser/tutorial.test.js` clicks through all six on a desktop and a 390x844 phone, checks that
a wrong cell does not advance a lesson, and asserts that **every number printed on screen is one the
engine produced for that position**.

---

## 3. Balance: measured properly, and the swap rule understood

Full write-up in [BALANCE.md](BALANCE.md). The short version:

**Before:** 16 games per ring, ±12 points, reporting the first player at 70%.

**After:** every one of the 91 opening cells, each with every one of the 90 possible replies, both
branches of the swap rule. 16,380 games, no randomness anywhere.

| | before | after |
|---|---|---|
| sample | 16 games a ring | every cell, every reply |
| first player, no swap rule, best opening | — | **61.3%** |
| first player, no swap rule, all openings | 70% (biased harness) | **53.8%** |
| first player, with the swap rule | — | **48.7% ± 1.7** |
| worst opening (the centre) | 31% | **35.6%** |
| last lead change | 37% | **37.4% ± 1.0** |

Two corrections were needed first, and they are the most important thing in this section. The old
harness gave the first player one more unsearched opening move than the second, worth about fifteen
points on its own. And alpha-beta reports exact values only for its best move, so anywhere a
measurement compares moves it now uses `Engine.rootScoresExact`.

**What the study found.** Taking the opening lantern leaves the position that answering it leaves
with the colours exchanged, so across all 91 cells the two branches add to 100% within 2.2 points.
The swap rule is the pie rule: it caps the opener at 50% by construction and hands the choice of
seat to the second player. The first player's advantage is real — 61.3% from the best opening with
no swap — and the rule is what removes it.

**Policy.** `src/opening.js` is generated from the study: open on any of 36 cells within two points
of the best; as responder, take the lantern on the 84 of 91 cells where the opening favours the
opener. Played end to end that is 48.7% ± 1.7 over 3,240 games.

**Targets.** 45–55% for the first player: **met**. Last lead change after 40%: **not met**, at
37.4% ± 1.0.

**Rule change considered and declined.** Three variants were measured, each from its own balanced
openings. K=4 reaches the dynamics target (45.4%) and nearly halves the average margin (44.9 → 24.0)
but more than halves the chains (4.32 → 1.99 a game). K=3 with M=2 is dominated: fewer chains than
K=4 *and* almost no gain on the target. Ahmed chose to keep K=3. The full table, the reasons, and
the untested edge-fortress risk that must be measured before K=4 could ever be adopted — the six
corner cells have only three lines, so under K=4 they can never be captured at all — are in
BALANCE.md.

---

## 4. The win-chance meter now means something

**Before:** `1/(1+exp(-eval/7))`. A plausible shape with a number nobody had ever checked against a
result, and it was shown from the first move whether or not anything had evaluated the position.

**After:** `P(gold wins) = sigmoid(a·value + b)`, with `a` and `b` fitted separately for each sixth
of the game **and for each side to move**, interpolated between bucket centres. Fitted on 3,060
self-play games — 118,168 positions — played at depths 3, 4 and 5, with 10% random moves and a 35%
chance of a swap, so the model sees the kind of positions a real game reaches rather than only the
tidy ones an engine walks into. Fit and test are split by whole game, so no game contributes to
both.

On 35,358 held-out positions:

| | log loss | Brier | worst reliability gap |
|---|---|---|---|
| always say the base rate (53%) | 0.68897 | 0.24448 | — |
| `1/(1+exp(-eval/7))` | 0.50247 | 0.16093 | **17.3 points** |
| **fitted** | **0.44697** | **0.14738** | **3.1 points** |

The reliability gap is the thing that matters to a player: it is the largest distance between what
the meter said and what actually happened. Bucket by bucket, when the new model says 3% it happens
3% of the time, and when it says 97% it happens 97% of the time. The old formula said 3% for
positions that were won 7% of the time, and 85% for positions won 68% of the time.

The fitted coefficients say something about the game, too: a point of lead is worth
`sigmoid(0.02·v)` in the first sixth and `sigmoid(0.21·v)` in the last. An early lead in Fawanees
means roughly a tenth of what a late one does.

**The meter no longer invents numbers.** Until a search has actually evaluated the position it shows
a dash and dims the bar. Every search on the page feeds it — including the one that guesses the
human's next move, and a short one that runs in two-player mode — so it stays current instead of
freezing between the machine's turns.

**One thing that went wrong and is worth recording.** The first fit diverged. Plain Newton-Raphson
took an overlong step, every probability saturated, the Hessian collapsed to nothing, and the fit
was left with `a = 4×10¹⁰` in one bucket. That single bucket made the shipped model *worse* than the
formula it replaced — held-out log loss 1.60 against 0.50 — and it would have passed unnoticed
without the held-out comparison. The fitter now has a ridge penalty, a backtracking line search that
only accepts a step that lowers the loss, and a guard that refuses to write out a fit with absurd
coefficients. The samples are also saved, so a fit can be corrected without replaying half an hour
of games.

**Verification:** `test/unit/calibration.test.js` checks the model is monotone in the lead, that a
lead is worth more later than earlier, that a level position reads level, that it beats both the old
formula and the base rate on held-out data at every search depth, and that the figures the page
quotes are the figures in the study. `test/browser/meter.test.js` checks the dash before anything is
measured, that the two players' percentages add to 100, and that the bar matches the number.

---

## 5. Speed on a phone

Full write-up in [SPEED.md](SPEED.md).

**Before:** no phone measurement existed.

**After:** Master answers in **1.006 s at worst on a phone-class core**, against a 1.5 s
requirement. No level's time budget needed changing.

| level | budget | phone median | phone worst | depth | desktop median | desktop depth |
|---|---|---|---|---|---|---|
| Novice | 120 ms | 5 ms | 8 ms | 1 | 1 ms | 1 |
| Skilled | 350 ms | 9 ms | 32 ms | 2 | 1 ms | 2 |
| **Master** | 1000 ms | **1004 ms** | **1006 ms** | 4 | 1002 ms | 4.3 |
| Oracle | 2600 ms | 2602 ms | 2607 ms | 4 | 2602 ms | 5.1 |

Getting this right needed two corrections. Chrome refuses to apply CPU throttling to a worker
target, so throttling the page while the search runs on a worker measures nothing — an early run
reported 611k nodes/s "at 4x throttling" against 679k unthrottled. The honest phone figure is the
main-thread fallback, where throttling does apply and which is the slower path anyway. And one
search in eight looked twice as slow until the harness let the page's own meter search finish first.

**Engine speed.** The search keeps its light maps incrementally instead of recomputing them at every
node. Identical node counts, same positions and depths (`sim/bench.js`):

| depth | before | after |
|---|---|---|
| 3 | 275k nodes/s | **778k** |
| 4 | 283k | **758k** |
| 5 | 281k | **918k** |
| 6 | 302k | **713k** |
| self-play game at depth 3 | 1.243 s | **0.358 s** |

Correctness: `test/unit/incremental.test.js` fuzzes the incremental maps against a full recompute
over four board and range combinations and several thousand placements, comparing the light maps,
the capture waves and the resulting board every time.

**An optimisation measured and rejected.** Stopping the search when the next ply cannot finish took
Master on a phone from 1004 ms to 611 ms at the same completed depth. But an abandoned ply changes
the chosen move in 12.5% of searches, and head to head at the same budget with sides swapped, 192
games, the engine that stopped early won **39.1% ± 7.1** against **59.9%**. The deadline was already
met, so the page spends its whole budget.

---

## 6. Tests

**Before:** one script that printed a chain example.

**After:**

| suite | what it holds |
|---|---|
| `test/unit/rules.test.js` | light, edge truncation, blocking by either colour, ownership and ties, sight and the six-seer cap, the capture threshold including 3-against-3, only the mover captures, chains resolving as a set, passing, running out of lanterns, the swap rule and undoing it |
| `test/unit/incremental.test.js` | the incremental light maps against a full recompute, fuzzed |
| `test/unit/lessons.test.js` | every tutorial lesson re-played through the engine |
| `test/unit/strength.test.js` | depth 3 beats depth 1 from both seats; the engine is deterministic |
| `test/unit/calibration.test.js` | the win model is monotone, phase-sensitive, and beats the old formula on held-out games |
| `test/unit/puzzles.test.js` | every shipped puzzle re-verified: unique best move, real chain, honest difficulty |
| `test/browser/worker.test.js` | worker and sliced fallback both stream depths and never block |
| `test/browser/tutorial.test.js` | all six lessons on desktop and phone, every printed number checked |
| `test/browser/fullgame.test.js` | a whole game by clicking, 390x844, zero console errors |
| `test/browser/speed.test.js` | Master under 1.5 s throttled; no level overruns its budget |
| `test/browser/meter.test.js` | the meter shows a dash before it knows anything |
| `test/browser/puzzles.test.js` | puzzle mode refuses wrong cells and quotes measured numbers |
| `test/browser/pwa.test.js` | the manifest, and a move played with the network cut off |

---

## 7. An installable, offline copy

**Before:** one HTML file.

**After:** still one HTML file — `dist/fawanees.html`, which asks for no manifest and registers no
service worker — plus `pwa/`, the same page with a manifest, a service worker and rasterised icons,
ready for GitHub Pages. `build.py` emits both from one source.

**Verification:** `test/browser/pwa.test.js` loads the installable copy, waits for the service worker
to take control, cuts the network with the DevTools protocol, reloads, and plays a move. It also
asserts that the single file makes no request to anything but Google Fonts.

---

## 8. The machine's own puzzles

*(filled in below)*

---

## What is ready and what is not

*(filled in below)*

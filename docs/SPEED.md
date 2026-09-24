# Speed

How fast the machine answers, and how that was measured.

## The catch in measuring a phone

CPU throttling through the DevTools protocol is the usual stand-in for a slower device. It does not
work on a worker: Chrome answers `Operation is only supported for pages, not workers`. So with the
search on a worker thread — which is where it runs normally — the throttling slows the page and
leaves the search at full speed. An early run of this measurement reported 611,000 nodes a second
"at 4x throttling", against 679,000 unthrottled, which is how the problem was noticed.

The honest phone measurement is therefore the **main-thread fallback** under throttling, where the
slowdown does apply. That is also the slower of the two paths, so holding it to the deadline is the
conservative choice. Every table below reports nodes a second precisely so it is visible whether the
throttling reached the search.

## Answer times

Headless Chromium, 390x844 viewport, ten searches a level from positions across a real game.

**Phone-class core** — search on the main thread, 4x CPU throttling (151,000 nodes a second, about
a fifth of the same build unthrottled):

| level | budget | median | p90 | max | depth reached | nodes |
|---|---|---|---|---|---|---|
| Novice | 120 ms | 5 ms | 8 ms | 8 ms | 1 | 83 |
| Skilled | 350 ms | 9 ms | 32 ms | 32 ms | 2 | 411 |
| **Master** | 1000 ms | **1004 ms** | **1006 ms** | **1006 ms** | 4 | 151,859 |
| Oracle | 2600 ms | 2602 ms | 2607 ms | 2607 ms | 4 | 387,072 |

**Desktop** — search on a worker, no throttling (681,000 nodes a second):

| level | budget | median | p90 | max | depth reached | nodes |
|---|---|---|---|---|---|---|
| Novice | 120 ms | 1 ms | 3 ms | 3 ms | 1 | 83 |
| Skilled | 350 ms | 1 ms | 1 ms | 1 ms | 2 | 451 |
| Master | 1000 ms | 1002 ms | 1002 ms | 1002 ms | 4.3 | 682,189 |
| Oracle | 2600 ms | 2602 ms | 2603 ms | 2603 ms | 5.1 | 1,717,453 |

**Master answers in 1.006 s at worst on a phone-class core**, against a 1.5 s requirement — a third
of the budget in hand. **No level's time budget needed changing.** Novice and Skilled are capped at
depth 1 and 2, so they return in milliseconds and their budgets never bind at all.

`test/browser/speed.test.js` holds this: it fails if Master's worst answer passes 1.5 s, if any
level overruns its budget by more than 250 ms, or if the throttling stops reaching the search.

## Why the whole budget is spent, and not less

A natural optimisation is to stop when the next ply cannot finish. Each ply costs about **six times**
the one before (`sim/timing.js`), so most of a budget is normally spent on a ply that gets abandoned.
Stopping early works: it took Master on a phone-class core from 1004 ms to 611 ms with the same
completed depth.

It also loses games. An abandoned ply is not wasted — when one of its fully searched moves beats the
previous best, the search takes that move, and that happens in **12.5%** of searches. Head to head at
the same budget with sides swapped, 192 games (`sim/earlyExit.js`):

| | win rate | ms a move | completed depth |
|---|---|---|---|
| stops early when the next ply will not fit | 39.1% ± 7.1 | 114 | 3.96 |
| spends the whole budget | 59.9% | 233 | 3.97 |

Twenty points of strength for four tenths of a second is a bad trade when the deadline is already
met, so the page spends its whole budget. The code is kept and documented, off unless
`earlyExit: true` is passed.

## Engine speed

The search keeps its light maps incrementally rather than recomputing them at every node. Same
positions, same depths, identical node counts (`sim/bench.js`):

| depth | before | after | per position |
|---|---|---|---|
| 3 | 275k nodes/s | 778k nodes/s | 30.5 ms → 10.8 ms |
| 4 | 283k | 758k | 93.3 ms → 34.8 ms |
| 5 | 281k | 918k | 2149.6 ms → 657.8 ms |
| 6 | 302k | 713k | 8769.1 ms → 3719.5 ms |
| a whole self-play game at depth 3 | 1.243 s | 0.358 s | 3.5x |

That is what lets Master reach depth 4 on a phone inside a second, and it is what made the balance
and calibration studies affordable.

## Responsiveness

The search never runs on the thread that draws the board unless it has to, and when it does it runs
in 10 ms slices. Measured with the browser's own long-task entries while the machine takes its turn
(`docs/measurements/step1-freeze.json`, and again at 4x throttling in `speed.test.js`):

| | worst long task | total blocked | frames a turn |
|---|---|---|---|
| before: search on the main thread | 1003 ms | 4006 ms over 4 turns | 28 |
| after: search on a worker | 0 ms | 0 ms | 132 |
| after: main-thread fallback, sliced | 0 ms | 0 ms | 67 |
| after: worker, 4x throttled phone | 0 ms | 0 ms | 237 |

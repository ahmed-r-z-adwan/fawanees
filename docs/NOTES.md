# Experiment log

> **The numbers below are the prototype's, and several of them are now known to be wrong.**
> They were produced by a harness that gave the first player one more unsearched opening move than
> the second, which is worth about fifteen points on its own, and by samples of 16 games a ring.
> They are kept because they are the record of how the rules were arrived at, and because the
> mistake is worth remembering. For the current numbers see **[BALANCE.md](BALANCE.md)**; for why
> the old ones were wrong see **[METHOD.md](METHOD.md)**.
>
> In particular: the "70%" for the current rules is **48.7% ± 1.7** when measured with a fair
> harness and the swap rule in play, and the opening table below is superseded by a study of every
> opening cell against every reply.

All results are from self-play between copies of the engine (depth-3 against depth-3 unless noted), with the first 1 or 2 moves random for variety. "Last lead change" is how far into the game the leader last changed. "Comeback" is how often the eventual loser was ahead at the midpoint.

| Version | First player wins | Notes |
|---|---|---|
| Can't place in enemy-controlled light, radius 4 | 72-86% | one-sided endings, very long filling phase |
| Placement anywhere, capture K=3, radius 4 | 55-63% | chains up to 22 lanterns in one move, but games end in near-total wipeouts |
| Captured lanterns removed instead of switched | n/a | games never end (rejected) |
| 18 lanterns each, radius 4, unlimited light | 60-65% | lead stops changing at 14-23% of the game: decided in the opening |
| Light range 2, radius 4, 18 each | 73% | last lead change 28%, comeback 10% |
| Light range 2, radius 5, 24 each (current) | 70% | last lead change 37%, comeback 30% |

In every version, depth 3 beat depth 1 in 95-100% of games, so search depth matters a lot.

## Opening study (current rules, 16 games per ring, depth 3)

| Ring of first lantern | First player wins |
|---|---|
| 0 (centre) | 31% |
| 1 | 56% |
| 2 | 56% |
| 3 | 63% |
| 4 | 31% |
| 5 (edge) | 50% |
| ring 2, second player gets 2 extra lanterns | 31% |

These samples are small (about +/-12%). They are the reason for the swap rule. The prototype's AI opens on ring 1 or the edge, and as second player it swaps when the opening is on rings 1-3. Both choices need confirming with far more games.

## Open questions — all four now answered

- *Is the first-player advantage fully fixed by the swap rule?* Yes, and the reason is structural:
  taking the opening lantern leaves the position that answering it leaves with the colours
  exchanged, so the rule caps the opener at 50% by construction. Measured at 48.7% ± 1.7 over 3,240
  games playing the derived policy. 16,380 games, every cell against every reply. See BALANCE.md.
- *The win-chance meter is not calibrated.* Now fitted per game phase and per side to move on
  118,168 positions. Held-out log loss 0.50247 → 0.44697; worst reliability gap 17.3 → 3.1 points.
  See REPORT.md section 4.
- *The AI searches on the main thread, so the page freezes.* It now runs on a worker, with a
  time-sliced main-thread fallback. Worst long task 1003 ms → 0 ms. See REPORT.md section 1.
- *No real-phone performance data.* Master answers in 1.006 s at worst on a 4x-throttled core,
  against a 1.5 s target. See SPEED.md — including the trap that Chrome will not throttle a worker
  target, so the obvious way to measure this gives a meaningless answer.

## What was measured afterwards, and where

| study | games | written up in |
|---|---|---|
| every opening cell against every reply, both branches of the swap rule | 16,380 | BALANCE.md |
| the derived policy played end to end | 3,240 | BALANCE.md |
| three rule variants compared, including chains per game | 7,020 | BALANCE.md |
| win-chance calibration | 3,060 | REPORT.md §4 |
| early-exit head to head | 192 | SPEED.md |
| puzzle mine | 700 | REPORT.md §8 |

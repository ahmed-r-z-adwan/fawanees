# Experiment log

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

## Open questions

- Is the first-player advantage fully fixed by the swap rule? Needs thousands of games per opening.
- Win-chance meter uses 1/(1+exp(-eval/7)), which is not calibrated.
- The AI searches on the main thread, so the page freezes while it thinks.
- No real-phone performance data yet.

# How the numbers in this project are produced

Every figure shown to a player, and every figure in these docs, comes from a measurement that was
actually run on this code. This file says how each kind of measurement is made, so the numbers can
be reproduced or argued with.

## Self-play

`sim/pool.js` spreads games across worker threads; each worker builds its engines once and clears
their transposition tables between games, so games stay independent but do not pay to allocate a
megabyte-scale table each time. On the machine these numbers were taken on — an 8-core i7-11800H,
16 logical processors — throughput saturates at about 11 games per second at depth 3 regardless of
thread count, because the search is memory-bound rather than core-bound. Adding threads past 8
gains nothing; that is a property of the machine, not of the pool.

## Keeping the two players comparable

This one caught us out, and it is worth stating plainly.

A self-play study normally starts with a few random moves, so the games are not all identical. If
those random moves are shared out unevenly — one side getting two unsearched moves and the other
one — the side with the extra unsearched move is handicapped, and the measured win rate moves by
something like fifteen points. Two harnesses that both look reasonable can disagree that much
purely on this.

So the opening study does not sample at all. For each opening cell it enumerates **every** possible
reply and plays each one out. Exactly one move per side is unsearched: the opening cell, which is
what the study is about, and the reply, which is enumerated over. Everything after that is searched
by both sides at the same depth. The result is an exact average over the reply set rather than an
estimate of one, and the protocol is identical for the branch where the second player takes the
opening lantern and the branch where they answer it.

`docs/measurements/opening-sampled.json` is kept as the earlier, asymmetric run, because the size
of the discrepancy is itself worth remembering.

## Symmetry

A hexagonal board has twelve symmetries: six rotations and a reflection. Openings that map onto
each other are the same opening and must produce the same number. `sim/symmetry.js` computes the
twelve classes; the study measures all 91 cells separately anyway, and the agreement inside each
class is used as a check that the geometry is right, not assumed.

## Search values

The value an alpha-beta search reports for its best move is exact. The values it reports for the
other moves are only upper bounds, because the window narrows as the search goes. Anywhere a
measurement needs to compare moves with each other — "this move is N points better than any other"
— it uses `Engine.rootScoresExact`, which searches every root move with a full window. It costs
several times more and is never used during play.

## In the browser

`test/tools/freeze.js` drives the published page with real canvas clicks and records the browser's
own long-task entries plus a `requestAnimationFrame` counter, which is how the claim "the page does
not freeze" is checked rather than asserted.

`test/tools/perf.js` does the same under CPU throttling through the Chrome DevTools Protocol, the
usual stand-in for a mid-range phone. Throttling applies to the renderer, and a dedicated worker
lives in the renderer, so the worker is slowed too.

## Files

| file | what it measures |
|---|---|
| `docs/measurements/opening.json` | opener win rate for every opening cell, both branches, every reply |
| `docs/measurements/opening-sampled.json` | the earlier sampled run, kept as a cautionary comparison |
| `docs/measurements/calibration.json` | the win-chance fit, with held-out log loss and reliability |
| `docs/measurements/puzzles.json` | the puzzle mine: what was scanned, what survived verification |
| `docs/measurements/step1-freeze.json` | main-thread blocking before and after the worker |
| `docs/measurements/perf-phone.json` | answer times per level under CPU throttling |
| `docs/measurements/bench-*.json` | engine speed, same positions and depths across builds |

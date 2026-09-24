# Fawanees (فوانيس)

An original two-player strategy game of light and shadow. The rules, the balancing experiments and the AI were designed by Claude (Anthropic's AI) in a chat with Ahmed Adwan, who had the idea and is the publisher. This folder is the prototype handed over for further development.

## Current rules (v0.3)

- Hex board, radius 5 (91 cells), drawn flat-top. Gold moves first. Each player has 24 lanterns.
- On your turn: place a lantern on any empty cell, or pass. The game ends after two passes in a row, or when neither player can place.
- Light: each lantern lights up to 2 cells in each of its 6 directions. Any lantern blocks light.
- Ownership: an empty cell belongs to whoever lights it with more lanterns. Ties belong to nobody.
- Sight: lantern X sees lantern Y if they are on one straight line, 2 cells apart or closer, with no lantern between them. Only the nearest lantern in each direction counts, so a lantern can be seen by at most 6.
- Capture: right after a player places, every opponent lantern that is seen by at least 3 of the mover's lanterns, and by more of the mover's lanterns than its own, switches to the mover. Checks repeat in waves until nothing switches. Only the non-mover's lanterns can switch.
- Score: your lanterns plus the empty cells you own.
- Swap rule: after the very first lantern of the game, the second player may take it as their own. The opener then moves again, as the other colour.

Engine parameters: `rules = { K: 3, restrict: false, supply: 24, range: 2 }`, `RADIUS = 5` (capture margin `M` defaults to 1).

## Layout

- `src/engine.js`: axial hex geometry, `computeLight`, `applyMove` (returns capture waves), `Game` (history, undo, pass, lantern supply), `Engine` (negamax alpha-beta, iterative deepening, Zobrist transposition table, history heuristic, pass as a move, principal-variation extraction). Runs in Node and in the browser.
- `src/template.html`: the whole UI (canvas board, Arabic/English, dialogs). The engine is inlined at `/*ENGINE*/`.
- `python3 build.py` writes `dist/fawanees.html`, one self-contained file. That file is what is currently published.
- `sim/`: self-play experiments in Node (`cd sim && node simT.js ...`). `sim/chain_example.js` checks the chain example below.
- `docs/NOTES.md`: every experiment so far, with numbers.

## Verified examples (use them in the tutorial and in tests)

- Chain, on a radius-3 board with range 2: blue at (0,0) and (0,2); gold at (2,-2), (0,-2) and (1,2). Gold plays (-2,2). Wave 1 switches (0,0); wave 2 switches (0,2). Sight counts: before, (0,0) has gold 2 / blue 1 and (0,2) has gold 1 / blue 1. After the placement, (0,0) has 3/1 and (0,2) has 2/1. After wave 1, (0,2) has 3/0.
- Protection: a lantern seen by 3 enemy lanterns and 3 friendly ones does not switch.

## Rules for working on this project

- Arabic first, with the English toggle. Keep right-to-left layout correct.
- The published output stays a single self-contained HTML file. The only external requests allowed are Google Fonts.
- Every number shown to players (win chance, strength, statistics) must come from a measurement you actually ran, and `docs/` must say how it was measured.
- Keep the credit line: rules, balancing and AI by Claude (Anthropic); idea and publishing by Ahmed Adwan. Do not use Anthropic's logos or present the game as an official Anthropic product.
- Commit in small steps with clear messages.

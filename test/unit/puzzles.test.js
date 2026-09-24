// Every shipped puzzle is re-checked against the engine here: the answer really is the unique
// best move, the chain really does what the puzzle says, and no two puzzles are the same position.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../../src/engine.js');
const { canonical, RULES, RADIUS } = require('../../sim/mineWorker.js');

// src/puzzles.js is written for the browser, so evaluate it against a stand-in window.
function loadPuzzles() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'puzzles.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  return sandbox.window.FawaneesPuzzles;
}

const DATA = loadPuzzles();
// Not mined yet: skip rather than fail. `node sim/minePuzzles.js` produces the set.
const notMined = !DATA.measured || !DATA.list.length;
const it = (name, fn) => test(name, { skip: notMined && 'puzzles not mined yet (run sim/minePuzzles.js)' }, fn);
const geo = F.makeGeometry(RADIUS);
geo.range = RULES.range;
const unpack = (s) => { const b = new Int8Array(geo.N); for (let i = 0; i < geo.N; i++) b[i] = s.charCodeAt(i) - 48; return b; };
const at = (k) => { const i = geo.index.get(k); assert.notStrictEqual(i, undefined, `${k} is not a cell`); return i; };

it('the puzzle set says how it was produced', () => {
  assert.strictEqual(DATA.measured, true, 'run `node sim/minePuzzles.js` before shipping');
  assert.strictEqual(DATA.radius, RADIUS);
  assert.ok(DATA.games > 0 && DATA.positionsScanned > 0, 'it should record how much was searched');
  assert.ok(DATA.list.length > 0, 'and contain puzzles');
});

it('no two puzzles are the same position', () => {
  const keys = DATA.list.map(p => canonical(geo, unpack(p.board), p.side));
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicates survived the symmetry fold');
});

for (const [n, p] of DATA.list.entries()) {
  it(`puzzle ${n + 1}: the answer is the unique best move, and the chain is real`, () => {
    const board = unpack(p.board);
    const answer = at(p.answer);
    assert.strictEqual(board[answer], 0, 'the answer must be an empty cell');
    assert.ok(p.hands[p.side] > 0, 'the player must have a lantern to place');

    // The move really is best, by the margin claimed, at the depth the puzzle claims.
    const e = new F.Engine(geo, RULES, { mob: 0 });
    const scores = e.rootScoresExact(board, p.side, DATA.verifyDepth, { hands: p.hands });
    assert.ok(scores.length >= 2);
    assert.strictEqual(scores[0].move, answer, 'the answer should be the top move at the verification depth');
    assert.ok(scores[0].score - scores[1].score >= 4,
      `margin ${(scores[0].score - scores[1].score).toFixed(1)} is too thin for a puzzle`);

    // And the chain the puzzle promises is what the engine actually produces.
    const after = board.slice();
    const sc = F.makeScratch(geo.N);
    F.computeLight(geo, after, sc);
    const waves = F.applyMoveInc(geo, after, p.side, answer, RULES, sc, true);
    const name = i => geo.cells[i].q + ',' + geo.cells[i].r;
    assert.deepStrictEqual(waves.map(w => w.map(name)), p.waves, 'the recorded waves must match the engine');
    assert.strictEqual(waves.reduce((a, w) => a + w.length, 0), p.flips, 'and so must the number of lanterns flipped');
    assert.ok(p.flips >= 3, 'a puzzle should be worth looking at');

    // The swing it advertises is the real change in score.
    const [a0, b0] = F.score(geo, board, F.makeScratch(geo.N), 0);
    const [a1, b1] = F.score(geo, after, F.makeScratch(geo.N), 0);
    const swing = p.side === 1 ? (a1 - b1) - (a0 - b0) : (b1 - a1) - (b0 - a0);
    assert.strictEqual(swing, p.swing, 'the advertised swing must be the measured one');
  });
}

it('difficulty means what it says: a shallower search does not find the answer', () => {
  for (const [n, p] of DATA.list.entries()) {
    const board = unpack(p.board), answer = at(p.answer);
    assert.ok(p.difficulty >= 2, `puzzle ${n + 1} claims difficulty ${p.difficulty}`);
    const e = new F.Engine(geo, RULES, { mob: 0 });
    for (let d = 1; d < p.difficulty; d++) {
      e.ttDepth.fill(-1); e.ttKey.fill(0);
      const m = e.search(board, p.side, { timeMs: 1e9, maxDepth: d, hands: p.hands }).move;
      assert.notStrictEqual(m, answer, `puzzle ${n + 1} claims depth ${p.difficulty} but depth ${d} already finds it`);
    }
    e.ttDepth.fill(-1); e.ttKey.fill(0);
    assert.strictEqual(e.search(board, p.side, { timeMs: 1e9, maxDepth: p.difficulty, hands: p.hands }).move, answer,
      `puzzle ${n + 1} should be found at its stated depth ${p.difficulty}`);
  }
});

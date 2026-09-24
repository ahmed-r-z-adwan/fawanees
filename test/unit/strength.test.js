// A search that looks further must play better. This is the regression guard for the whole engine:
// ordering, the transposition table and the incremental light can all be subtly wrong without any
// single-position test noticing, but they show up here as lost games.
const test = require('node:test');
const assert = require('node:assert');
const { playOne } = require('../../sim/playWorker.js');

// A spread of openings, one from each ring, so the sample is not all one shape of position.
const OPENINGS = [45, 40, 24, 0];
const REPLIES = [7, 31, 55, 79];

function match(depthGold, depthTurq) {
  let goldWins = 0, games = 0, draws = 0;
  for (const opening of OPENINGS) {
    for (const reply of REPLIES) {
      const r = playOne({ opening, swap: false, reply, depth1: depthGold, depth2: depthTurq });
      games++; goldWins += r.openerWon; draws += r.draw;
    }
  }
  return { games, goldWins, draws, rate: goldWins / games };
}

test('depth 3 beats depth 1 from both sides of the board', (t) => {
  const asGold = match(3, 1);
  const asTurq = match(1, 3);
  t.diagnostic(`depth 3 as gold: ${asGold.goldWins}/${asGold.games}; depth 1 as gold: ${asTurq.goldWins}/${asTurq.games}`);
  assert.ok(asGold.rate >= 0.85, `the deeper search should win as gold, won ${(100 * asGold.rate).toFixed(0)}%`);
  assert.ok(asTurq.rate <= 0.15, `and as turquoise, the shallow side won ${(100 * asTurq.rate).toFixed(0)}% as gold`);
});

test('depth 2 beats depth 1, by less', (t) => {
  const r = match(2, 1);
  t.diagnostic(`depth 2 as gold: ${r.goldWins}/${r.games} (${(100 * r.rate).toFixed(0)}%)`);
  assert.ok(r.rate >= 0.6, `one extra ply should still be worth something, got ${(100 * r.rate).toFixed(0)}%`);
});

test('the engine is deterministic: the same position gives the same move every time', () => {
  const F = require('../../src/engine.js');
  const rules = { K: 3, restrict: false, supply: 24, range: 2 };
  const g = new F.Game(5, rules);
  [45, 44, 30, 61, 12, 70].forEach(c => { if (g.board[c] === 0) g.play(c); });
  const answers = [];
  for (let i = 0; i < 3; i++) {
    const e = new F.Engine(g.geo, rules, { mob: 0 });
    const r = e.search(g.board, g.toMove, { timeMs: 1e9, maxDepth: 4, hands: g.hands });
    answers.push(`${r.move}:${r.value.toFixed(4)}:${r.nodes}`);
  }
  assert.strictEqual(new Set(answers).size, 1, `three identical searches disagreed: ${answers.join(' | ')}`);
});

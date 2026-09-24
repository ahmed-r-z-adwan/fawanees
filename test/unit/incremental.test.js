// The search keeps the light maps up to date incrementally instead of recomputing them at every
// node. That is only safe if the incremental maps are bit-for-bit what a full recompute gives, on
// every position the game can reach. This fuzzes that against the straightforward implementation.
const test = require('node:test');
const assert = require('node:assert');
const F = require('../../src/engine.js');

function rng(s) { return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

const same = (a, b, where) => {
  for (const k of ['l1', 'l2', 's1', 's2']) {
    assert.deepStrictEqual(Array.from(a[k]), Array.from(b[k]), `${where}: ${k} differs`);
  }
};

for (const [radius, range] of [[2, 2], [3, 2], [5, 2], [4, 99]]) {
  test(`incremental light matches a full recompute (radius ${radius}, range ${range})`, () => {
    const rules = { K: 3, restrict: false, range };
    const geo = F.makeGeometry(radius); geo.range = range;
    const rand = rng(1234 + radius * 31 + range);
    const inc = F.makeScratch(geo.N), full = F.makeScratch(geo.N);
    let placements = 0, waves = 0;

    for (let trial = 0; trial < 200; trial++) {
      // build a random reachable-looking position, one legal placement at a time
      const board = new Int8Array(geo.N);
      F.computeLight(geo, board, inc);
      const n = 2 + Math.floor(rand() * Math.min(geo.N - 1, 26));
      for (let k = 0; k < n; k++) {
        const empty = [];
        for (let i = 0; i < geo.N; i++) if (board[i] === 0) empty.push(i);
        if (!empty.length) break;
        const j = empty[Math.floor(rand() * empty.length)];
        const p = (k % 2) + 1;

        // incremental path
        const w = F.applyMoveInc(geo, board, p, j, rules, inc, true);
        placements++; waves += w.length;

        // and what a recompute says about the very same board
        F.computeLight(geo, board, full);
        same(inc, full, `radius ${radius} range ${range}, trial ${trial}, move ${k}`);

        // the waves themselves must match the reference implementation too
        const ref = board.slice();
        // rebuild the pre-move board and replay it with the non-incremental applyMove
        const pre = board.slice();
        for (const wave of w) for (const i of wave) pre[i] = 3 - p;
        pre[j] = 0;
        const sc2 = F.makeScratch(geo.N);
        const w2 = F.applyMove(geo, pre, p, j, rules, sc2, true);
        assert.deepStrictEqual(w2, w, 'capture waves differ from the reference implementation');
        assert.deepStrictEqual(Array.from(pre), Array.from(ref), 'resulting board differs');
      }
    }
    assert.ok(placements > 1000, `expected a decent sample, got ${placements} placements`);
    assert.ok(waves > 0, 'the fuzz should have produced some capture waves');
  });
}

test('placing into a beam cuts what the beam lit beyond it', () => {
  const rules = { K: 3, restrict: false, range: 2 };
  const geo = F.makeGeometry(3); geo.range = 2;
  const idx = (q, r) => geo.index.get(q + ',' + r);
  const board = new Int8Array(geo.N);
  const sc = F.makeScratch(geo.N);
  F.computeLight(geo, board, sc);
  F.applyMoveInc(geo, board, 1, idx(0, 0), rules, sc, false);
  assert.strictEqual(sc.l1[idx(2, 0)], 1, 'gold lights the cell two steps away');
  F.applyMoveInc(geo, board, 2, idx(1, 0), rules, sc, false);
  assert.strictEqual(sc.l1[idx(2, 0)], 0, 'and stops once a lantern stands in the way');
  assert.strictEqual(sc.s1[idx(1, 0)], 1, 'the blocked beam now sees the blocker');
  const full = F.makeScratch(geo.N); F.computeLight(geo, board, full);
  assert.deepStrictEqual(Array.from(sc.l1), Array.from(full.l1));
  assert.deepStrictEqual(Array.from(sc.s1), Array.from(full.s1));
});

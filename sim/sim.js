const F = require('../src/engine.js');
function rng(seed) { return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }; }
function playGame(R, rules, players, rand, opts = {}) {
  const g = new F.Game(R, rules);
  const engines = players.map(pl => pl.type === 'engine' ? new F.Engine(g.geo, rules, pl.w) : null);
  let moves = 0, cascades = 0, maxChain = 0, flipped = 0, passes = 0;
  while (!g.over && g.history.length < (opts.maxTurns ?? 240)) {
    const p = g.toMove, pl = players[p - 1];
    const legal = g.legal();
    let m;
    if (legal.length === 0) m = -1;
    else if (moves < (opts.randomOpening ?? 2)) m = legal[Math.floor(rand() * legal.length)];
    else if (pl.type === 'random') m = legal[Math.floor(rand() * legal.length)];
    else {
      const r = engines[p - 1].search(g.board, p, { timeMs: 1e9, maxDepth: pl.depth, nodeLimit: pl.nodes ?? Infinity, prevPass: g.lastPass, hands: g.hands });
      m = r.move;
    }
    const rec = g.play(m);
    if (m >= 0) moves++; else passes++;
    const f = rec.waves.reduce((a, w) => a + w.length, 0);
    flipped += f;
    if (rec.waves.length >= 2) cascades++;
    maxChain = Math.max(maxChain, f);
  }
  const [a, b] = g.score();
  return { capped: !g.over, turns: g.history.length, winner: a > b ? 1 : b > a ? 2 : 0, margin: a - b, moves, cascades, maxChain, flipped, passes, a, b };
}
function run(label, R, rules, p1, p2, games, seed = 1) {
  const rand = rng(seed * 7919 + 13);
  const agg = { w1: 0, w2: 0, d: 0, moves: 0, casc: 0, maxChain: 0, flipped: 0, passes: 0, margin: 0 };
  const t = Date.now();
  for (let i = 0; i < games; i++) {
    const r = playGame(R, rules, [p1, p2], rand);
    if (r.winner === 1) agg.w1++; else if (r.winner === 2) agg.w2++; else agg.d++;
    agg.moves += r.moves; agg.capped = (agg.capped||0) + (r.capped?1:0); agg.casc += r.cascades; agg.maxChain = Math.max(agg.maxChain, r.maxChain); agg.flipped += r.flipped; agg.passes += r.passes; agg.margin += Math.abs(r.margin);
  }
  console.log(`${label.padEnd(34)} P1 ${(100*agg.w1/games).toFixed(0)}% P2 ${(100*agg.w2/games).toFixed(0)}% D ${(100*agg.d/games).toFixed(0)}% | moves ${(agg.moves/games).toFixed(1)} cascades/g ${(agg.casc/games).toFixed(2)} flips/g ${(agg.flipped/games).toFixed(1)} maxChain ${agg.maxChain} passes/g ${(agg.passes/games).toFixed(2)} |margin| ${(agg.margin/games).toFixed(1)}  (${((Date.now()-t)/1000).toFixed(1)}s) capped ${agg.capped||0}`);
  return agg;
}
module.exports = { run, playGame, rng };
if (require.main === module) {
  const E = d => ({ type: 'engine', depth: d });
  const variants = [[4, 3], [4, 2], [5, 3]];
  for (const [R, K] of variants) {
    console.log(`--- R=${R} K=${K}`);
    run(`d2 vs d2`, R, { K }, E(2), E(2), 200);
    run(`d1 vs d3 (strength check)`, R, { K }, E(1), E(3), 60);
    run(`d3 vs d1 (strength check)`, R, { K }, E(3), E(1), 60);
  }
}

// Deterministic behavioural fingerprint of the engine.
// Plays a fixed set of self-play games with a fixed RNG and hashes every move,
// every capture wave and every final score. Any change in how the engine plays
// changes the digest. Used to prove that refactors are behaviour-preserving.
const crypto = require('crypto');
const F = require('../../src/engine.js');

function rng(s) { return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

function signature({ games = 12, depth = 3, radius = 5, rules = { K: 3, restrict: false, supply: 24, range: 2 } } = {}) {
  const h = crypto.createHash('sha256');
  const rand = rng(20260924);
  for (let gi = 0; gi < games; gi++) {
    const g = new F.Game(radius, rules);
    const eng = [null, new F.Engine(g.geo, rules, { mob: 0 }), new F.Engine(g.geo, rules, { mob: 0 })];
    let t = 0;
    while (!g.over && g.history.length < 200) {
      const p = g.toMove, L = g.legal();
      let m;
      if (!L.length) m = -1;
      else if (t < 2) m = L[Math.floor(rand() * L.length)];
      else m = eng[p].search(g.board, p, { timeMs: 1e9, maxDepth: depth, prevPass: g.lastPass, hands: g.hands }).move;
      const rec = g.play(m); t++;
      h.update(`${p}:${m}:${rec.waves.map(w => w.join('.')).join('|')};`);
    }
    const [a, b] = g.score();
    h.update(`end ${a}-${b}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

module.exports = { signature };
if (require.main === module) {
  const t = Date.now();
  console.log('signature(12 games, depth 3, R=5):', signature());
  console.log('signature(8 games, depth 2, R=4):', signature({ games: 8, depth: 2, radius: 4, rules: { K: 3, restrict: false, supply: 18, range: 2 } }));
  console.log(`(${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

// P1 win rate when the first lantern is placed on a given ring (distance from centre). Used to judge the swap rule.
const F = require('../src/engine.js');
const { rng } = require('./sim.js');
const ring = +process.argv[2], n = +process.argv[3], P2EXTRA = +(process.argv[4] || 0);
const rules = { K: 3, restrict: false, supply: 24, supply2: 24 + P2EXTRA, range: 2 };
const rand = rng(1000 + ring * 17 + P2EXTRA);
const dist = c => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));
let w1 = 0, d = 0, marg = 0, last = 0, cb = 0;
for (let i = 0; i < n; i++) {
  const g = new F.Game(5, rules);
  const eng = [null, new F.Engine(g.geo, rules, { mob: 0 }), new F.Engine(g.geo, rules, { mob: 0 })];
  const cands = g.geo.cells.map((c, k) => [c, k]).filter(([c]) => dist(c) === ring).map(([, k]) => k);
  g.play(cands[Math.floor(rand() * cands.length)]);
  // one random reply for variety
  { const L = g.legal(); g.play(L[Math.floor(rand() * L.length)]); }
  const diffs = [];
  while (!g.over && g.history.length < 200) {
    const p = g.toMove, L = g.legal();
    const m = L.length ? eng[p].search(g.board, p, { timeMs: 1e9, maxDepth: 3, prevPass: g.lastPass, hands: g.hands }).move : -1;
    g.play(m); const [a, b] = g.score(); diffs.push(a - b);
  }
  const [a, b] = g.score(); if (a > b) w1++; else if (a === b) d++; marg += Math.abs(a - b);
  let lastc = 0, ps = 0; diffs.forEach((x, k) => { const s = Math.sign(x); if (s) { if (ps && s !== ps) lastc = k; ps = s; } });
  last += lastc / diffs.length;
  const mid = diffs[Math.floor(diffs.length / 2)]; if (Math.sign(mid) && Math.sign(mid) !== Math.sign(a - b)) cb++;
}
console.log(`ring ${ring} P2extra ${P2EXTRA}: P1 win ${(100 * w1 / n).toFixed(0)}% draw ${(100 * d / n).toFixed(0)}% |margin| ${(marg / n).toFixed(1)} lastLeadChange ${(100 * last / n).toFixed(0)}% comeback ${(100 * cb / n).toFixed(0)}% (n=${n})`);

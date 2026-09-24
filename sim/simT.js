const F = require('../src/engine.js');
const { rng } = require('./sim.js');
function game(rules, d1, d2, rand) {
  const g = new F.Game(RAD, rules);
  const eng = [null, new F.Engine(g.geo, rules, { mob: 0 }), new F.Engine(g.geo, rules, { mob: 0 })];
  const diffs = []; let t = 0;
  while (!g.over && g.history.length < 200) {
    const p = g.toMove, legal = g.legal(); let m;
    if (legal.length === 0) m = -1;
    else if (t < 2) m = legal[Math.floor(rand() * legal.length)];
    else m = eng[p].search(g.board, p, { timeMs: 1e9, maxDepth: p === 1 ? d1 : d2, prevPass: g.lastPass, hands: g.hands }).move;
    g.play(m); t++;
    const [a, b] = g.score(); diffs.push(a - b);
  }
  return diffs;
}
const [S1, S2, K, M, n, range, R] = process.argv.slice(2).map(Number);
const rules = { K, M, restrict: false, supply: S1, supply2: S2, range: range || 99 };
const RAD = R || 4;
const rand = rng(12345);
let w1 = 0, lateSum = 0, comeback = 0, leadChanges = 0, margin = 0, bigSwings = 0;
for (let i = 0; i < n; i++) {
  const d = game(rules, 3, 3, rand);
  const final = d[d.length - 1]; if (final > 0) w1++;
  margin += Math.abs(final);
  let last = 0, prevSign = 0, lc = 0;
  d.forEach((x, k) => { const s = Math.sign(x); if (s !== 0) { if (prevSign !== 0 && s !== prevSign) { lc++; last = k; } prevSign = s; } });
  leadChanges += lc; lateSum += last / d.length;
  const mid = d[Math.floor(d.length / 2)];
  if (Math.sign(mid) !== 0 && Math.sign(mid) !== Math.sign(final)) comeback++;
  for (let k = 1; k < d.length; k++) if (Math.abs(d[k] - d[k - 1]) >= 20) bigSwings++;
}
console.log(`R=${RAD} range=${range} S=${S1}/${S2} K=${K} M=${M}: P1 win ${(100 * w1 / n).toFixed(0)}% | lead changes/g ${(leadChanges / n).toFixed(1)} | last lead change at ${(100 * lateSum / n).toFixed(0)}% of game | loser led at midpoint ${(100 * comeback / n).toFixed(0)}% | swings>=20pts/g ${(bigSwings / n).toFixed(1)} | |margin| ${(margin / n).toFixed(1)}`);

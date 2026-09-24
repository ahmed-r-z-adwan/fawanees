// What each extra ply costs, and whether an unfinished ply ever changes the answer.
//
//   node sim/timing.js
//
// The search stops when the next ply cannot finish inside the budget. That needs a number for
// "how much more does the next ply cost", and it is only worth doing if an unfinished ply rarely
// changes the move. Both are measured here.
const F = require('./../src/engine.js');
const { bench } = require('./bench.js');

const RULES = { K: 3, restrict: false, supply: 24, range: 2 };
const RADIUS = 5;

function rng(s) { return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

function positions(n) {
  const rand = rng(31337);
  const g = new F.Game(RADIUS, RULES);
  const e = new F.Engine(g.geo, RULES, { mob: 0 });
  const out = [];
  let t = 0;
  while (!g.over && out.length < n) {
    if (t >= 4 && t % 2 === 0) out.push({ board: g.board.slice(), side: g.toMove, hands: g.hands.slice() });
    const L = g.legal();
    const m = !L.length ? -1 : t < 4 ? L[Math.floor(rand() * L.length)]
      : e.search(g.board, g.toMove, { timeMs: 1e9, maxDepth: 2, hands: g.hands }).move;
    g.play(m); t++;
  }
  return { geo: g.geo, list: out };
}

const { geo, list } = positions(14);
const e = new F.Engine(geo, RULES, { mob: 0 });

console.log('cost of each extra ply (ms per iteration, and the ratio to the one before)');
console.log('depth      median ms     ratio');
const perDepth = new Map();
for (const p of list) {
  const run = e.startSearch(p.board, p.side, { hands: p.hands, maxDepth: 6 });
  for (let d = 1; d <= 6; d++) {
    if (!run.step(Date.now() + 60000)) break;
    (perDepth.get(d) || perDepth.set(d, []).get(d)).push(run.lastStepMs);
  }
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
let prev = null;
for (const d of [...perDepth.keys()].sort((a, b) => a - b)) {
  const m = med(perDepth.get(d));
  console.log(`  ${d}      ${String(m).padStart(9)}     ${prev ? (m / Math.max(1, prev)).toFixed(1) : '-'}`);
  prev = m;
}

// How often does the unfinished ply change the move?
console.log('\ndoes an unfinished ply change the answer?');
let changed = 0, total = 0;
for (const p of list) {
  for (const budget of [150, 300, 600, 1200]) {
    const run = e.startSearch(p.board, p.side, { hands: p.hands, maxDepth: 64 });
    const deadline = Date.now() + budget;
    let lastCompleted = null;
    while (!run.finished && Date.now() <= deadline) {
      if (!run.step(deadline)) break;
      lastCompleted = run.best.move;
    }
    const final = run.result().move;
    if (lastCompleted !== null) { total++; if (final !== lastCompleted) changed++; }
  }
}
console.log(`  ${changed} of ${total} searches (${(100 * changed / total).toFixed(1)}%) ended on a move the last completed ply had not chosen`);

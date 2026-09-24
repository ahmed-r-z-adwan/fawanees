// Head-to-head between two time-budgeted engines: one that stops when the next ply cannot finish,
// one that spends the whole budget on a ply it will not complete. Same budget, same positions.
const { parentPort } = require('worker_threads');
const F = require('../src/engine.js');

const RULES = { K: 3, restrict: false, supply: 24, range: 2 };
const RADIUS = 5;

const pool = new Map();
function engines(geo) {
  let e = pool.get('e');
  if (!e) { e = [null, new F.Engine(geo, RULES, { mob: 0 }), new F.Engine(geo, RULES, { mob: 0 })]; pool.set('e', e); }
  for (let p = 1; p <= 2; p++) { e[p].ttDepth.fill(-1); e[p].ttKey.fill(0); e[p].history.fill(0); }
  return e;
}

// earlyFor[p] says whether player p stops early. Returns who won and how long each side thought.
function playOne({ opening, reply, budgetMs, earlyFor, branchFactor }) {
  const g = new F.Game(RADIUS, RULES);
  const eng = engines(g.geo);
  const ms = [0, 0, 0], moves = [0, 0, 0], depth = [0, 0, 0];
  g.play(opening);
  if (reply >= 0) g.play(reply);
  while (!g.over && g.history.length < 220) {
    const p = g.toMove, L = g.legal();
    if (!L.length) { g.play(-1); continue; }
    const t = Date.now();
    const r = eng[p].search(g.board, p, {
      timeMs: budgetMs, maxDepth: 64, prevPass: g.lastPass, hands: g.hands,
      earlyExit: !!earlyFor[p], branchFactor,
    });
    ms[p] += Date.now() - t; moves[p]++; depth[p] += r.depth;
    g.play(r.move);
  }
  const [a, b] = g.score();
  return { goldWon: a > b ? 1 : 0, draw: a === b ? 1 : 0, ms, moves, depth };
}

function runJob(job) {
  const agg = { games: 0, goldWins: 0, draws: 0, ms: [0, 0, 0], moves: [0, 0, 0], depth: [0, 0, 0] };
  const probe = new F.Game(RADIUS, RULES);
  probe.play(job.opening);
  const replies = probe.legal();
  for (let i = job.replyFrom; i < Math.min(job.replyTo, replies.length); i++) {
    const r = playOne({ ...job, reply: replies[i] });
    agg.games++; agg.goldWins += r.goldWon; agg.draws += r.draw;
    for (let p = 1; p <= 2; p++) { agg.ms[p] += r.ms[p]; agg.moves[p] += r.moves[p]; agg.depth[p] += r.depth[p]; }
  }
  return { ...job, ...agg };
}

if (parentPort) parentPort.on('message', (m) => {
  if (m.type === 'bye') process.exit(0);
  if (m.type === 'job') parentPort.postMessage({ index: m.index, result: runJob(m.job) });
});

module.exports = { playOne, runJob };

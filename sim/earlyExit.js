// Does stopping early cost strength? Same time budget, same openings, sides swapped.
//   node sim/earlyExit.js [--budget 250] [--branch 6] [--threads 4] [--replies 12]
// Few threads on purpose: a time-budgeted match is only meaningful if the threads are not
// fighting each other for the CPU.
const fs = require('fs');
const path = require('path');
const { runPool } = require('./pool.js');
const F = require('../src/engine.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const BUDGET = +arg('budget', 250);
const BRANCH = +arg('branch', 6);
const THREADS = +arg('threads', 4);
const REPLIES = +arg('replies', 12);
const OUT = arg('out', 'docs/measurements/early-exit.json');

const geo = F.makeGeometry(5);
const OPENINGS = ['-2,0', '-3,0', '-4,2', '-3,1'].map(k => geo.index.get(k));

function jobs(earlyFor) {
  const out = [];
  for (const opening of OPENINGS) {
    for (let from = 0; from < REPLIES; from += 3) {
      out.push({ opening, replyFrom: from, replyTo: Math.min(from + 3, REPLIES), budgetMs: BUDGET, earlyFor, branchFactor: BRANCH });
    }
  }
  return out;
}

const sum = (rs) => {
  const a = { games: 0, goldWins: 0, draws: 0, ms: [0, 0, 0], moves: [0, 0, 0], depth: [0, 0, 0] };
  for (const r of rs) { a.games += r.games; a.goldWins += r.goldWins; a.draws += r.draws;
    for (let p = 1; p <= 2; p++) { a.ms[p] += r.ms[p]; a.moves[p] += r.moves[p]; a.depth[p] += r.depth[p]; } }
  return a;
};

(async () => {
  const w = path.join(__dirname, 'earlyExitWorker.js');
  console.log(`early-exit match: budget ${BUDGET} ms a move, branch factor ${BRANCH}, ${OPENINGS.length} openings x ${REPLIES} replies, ${THREADS} threads`);

  // gold stops early, turquoise does not; then the other way round
  const A = sum(await runPool(w, jobs([0, 1, 0]), { threads: THREADS }));
  const B = sum(await runPool(w, jobs([0, 0, 1]), { threads: THREADS }));

  const earlyWins = A.goldWins + (B.games - B.goldWins - B.draws);
  const games = A.games + B.games;
  const draws = A.draws + B.draws;
  const rate = earlyWins / games;
  const half = 1.96 * Math.sqrt(0.25 / games);

  const stat = (agg, side) => ({
    msPerMove: +(agg.ms[side] / Math.max(1, agg.moves[side])).toFixed(1),
    depthAvg: +(agg.depth[side] / Math.max(1, agg.moves[side])).toFixed(2),
  });
  const early = { A: stat(A, 1), B: stat(B, 2) };
  const full = { A: stat(A, 2), B: stat(B, 1) };
  const avg = (x, y, k) => +((x[k] + y[k]) / 2).toFixed(2);

  const report = {
    what: 'Does stopping the search when the next ply cannot finish cost playing strength?',
    how: `node sim/earlyExit.js --budget ${BUDGET} --branch ${BRANCH} --replies ${REPLIES}`,
    date: new Date().toISOString().slice(0, 10),
    games, draws,
    earlyExitWinRate: rate, halfWidth95: half,
    earlyExit: { msPerMove: avg(early.A, early.B, 'msPerMove'), depthAvg: avg(early.A, early.B, 'depthAvg') },
    fullBudget: { msPerMove: avg(full.A, full.B, 'msPerMove'), depthAvg: avg(full.A, full.B, 'depthAvg') },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));

  console.log(`\n${games} games, ${draws} drawn, sides swapped`);
  console.log(`  stops early   wins ${(100 * rate).toFixed(1)}% +/-${(100 * half).toFixed(1)}   ` +
              `${report.earlyExit.msPerMove} ms a move, depth ${report.earlyExit.depthAvg}`);
  console.log(`  full budget   wins ${(100 * (1 - rate - draws / games)).toFixed(1)}%             ` +
              `${report.fullBudget.msPerMove} ms a move, depth ${report.fullBudget.depthAvg}`);
  console.log(`\nwritten to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });

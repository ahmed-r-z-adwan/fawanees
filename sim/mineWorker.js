// Looks through self-play games for positions worth setting as a puzzle: one move is far better
// than every other, it sets off a chain, and a shallow search walks straight past it.
const { parentPort } = require('worker_threads');
const F = require('../src/engine.js');
const { transforms } = require('./symmetry.js');

const RULES = { K: 3, restrict: false, supply: 24, range: 2 };
const RADIUS = 5;
const DEEP = 4;          // the depth that decides what the answer is
const SHALLOW = [1, 2, 3];

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

const pool = new Map();
function engineFor(geo) {
  let e = pool.get('e');
  if (!e) { e = new F.Engine(geo, RULES, { mob: 0 }); pool.set('e', e); }
  return e;
}
function freshEngine(geo) { const e = engineFor(geo); e.ttDepth.fill(-1); e.ttKey.fill(0); e.history.fill(0); return e; }

// The same position reached by a rotation or a reflection is the same puzzle, and so is the
// position with the colours the other way round. Normalise both before comparing.
let T = null, geoCache = null;
function canonical(geo, board, mover) {
  if (!T) T = transforms();
  const n = geo.N;
  let best = null;
  for (const t of T) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [q, r] = t([geo.cells[i].q, geo.cells[i].r]);
      const j = geo.index.get(q + ',' + r);
      let v = board[i];
      if (mover === 2 && v) v = 3 - v;          // always describe the puzzle with gold to move
      out[j] = v;
    }
    const s = out.join('');
    if (best === null || s < best) best = s;
  }
  return best;
}

// How many lanterns each legal move flips straight away. Cheap enough to run on every position.
function immediateFlips(geo, board, p, sc) {
  const out = [];
  const tmp = new Int8Array(geo.N);
  const tsc = F.makeScratch(geo.N);
  for (let j = 0; j < geo.N; j++) {
    if (board[j] !== 0) continue;
    tmp.set(board);
    F.copyLight(tsc, sc);
    const n = F.applyMoveInc(geo, tmp, p, j, RULES, tsc, false);
    if (n > 0) out.push({ move: j, flips: n });
  }
  out.sort((a, b) => b.flips - a.flips);
  return out;
}

function examine(geo, board, side, hands, prevPass) {
  const sc = F.makeScratch(geo.N);
  F.computeLight(geo, board, sc);
  const flips = immediateFlips(geo, board, side, sc);
  if (!flips.length || flips[0].flips < 3) return null;      // no chain worth looking at

  // Exact values, not the bounds an ordinary search reports, because the whole claim of a puzzle
  // is that one move beats every other by a specific amount.
  const e = freshEngine(geo);
  const scores = e.rootScoresExact(board, side, DEEP, { hands });
  if (scores.length < 2) return null;
  const margin = scores[0].score - scores[1].score;
  const answer = scores[0].move;
  if (!(margin >= 5)) return null;

  const best = flips.find(f => f.move === answer);
  if (!best || best.flips < 3) return null;                  // the winning move must be the chain

  // How far must a machine look before it sees it?
  let difficulty = null;
  for (const d of SHALLOW) {
    const e2 = freshEngine(geo);
    if (e2.search(board, side, { timeMs: 1e9, maxDepth: d, prevPass, hands }).move === answer) { difficulty = d; break; }
  }
  if (difficulty === null) difficulty = DEEP;
  if (difficulty < 2) return null;                           // anything depth 1 spots is not a puzzle

  const sc2 = F.makeScratch(geo.N);
  const after = board.slice();
  F.computeLight(geo, after, sc2);
  const waves = F.applyMoveInc(geo, after, side, answer, RULES, sc2, true);
  const [a0, b0] = F.score(geo, board, F.makeScratch(geo.N), 0);
  const [a1, b1] = F.score(geo, after, F.makeScratch(geo.N), 0);

  return {
    board: Array.from(board), side, hands: hands.slice(), answer, margin,
    secondBest: scores[1].move, secondScore: scores[1].score, bestScore: scores[0].score,
    flips: best.flips, waves: waves.map(w => w.slice()), difficulty,
    swing: (side === 1 ? (a1 - b1) - (a0 - b0) : (b1 - a1) - (b0 - a0)),
    lanterns: board.reduce((n, v) => n + (v ? 1 : 0), 0),
    key: canonical(geo, board, side),
  };
}

function runJob(job) {
  const rand = rng(job.seed);
  const g0 = new F.Game(RADIUS, RULES);
  const geo = g0.geo;
  if (!geoCache) geoCache = geo;
  const found = [];
  let positions = 0, examined = 0;

  for (let i = 0; i < job.games; i++) {
    const g = new F.Game(RADIUS, RULES);
    const eng = [null, freshEngine(geo), freshEngine(geo)];
    let t = 0;
    while (!g.over && g.history.length < 200) {
      const p = g.toMove, L = g.legal();
      if (L.length && g.history.length >= 6 && g.hands[1] > 2 && g.hands[2] > 2) {
        positions++;
        const r = examine(geo, g.board, p, g.hands, !!g.lastPass);
        if (r) { found.push(r); examined++; }
      }
      let m;
      if (!L.length) m = -1;
      else if (t < 2 || rand() < job.randomRate) m = L[Math.floor(rand() * L.length)];
      else m = eng[p].search(g.board, p, { timeMs: 1e9, maxDepth: 3, prevPass: g.lastPass, hands: g.hands }).move;
      g.play(m); t++;
    }
  }
  return { games: job.games, positions, found };
}

if (parentPort) parentPort.on('message', (m) => {
  if (m.type === 'bye') process.exit(0);
  if (m.type === 'job') parentPort.postMessage({ index: m.index, result: runJob(m.job) });
});

module.exports = { runJob, examine, canonical, RULES, RADIUS, DEEP };

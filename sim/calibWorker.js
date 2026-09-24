// Collects the data the win-chance meter is fitted on: for every position of a self-play game,
// the search value the page would show, how far into the game it is, and who eventually won.
const { parentPort } = require('worker_threads');
const F = require('../src/engine.js');

const RULES = { K: 3, restrict: false, supply: 24, range: 2 };
const RADIUS = 5;
const SUPPLY = RULES.supply * 2;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

const pool = new Map();
function enginesFor(geo, radius) {
  let pair = pool.get(radius);
  if (!pair) { pair = [null, new F.Engine(geo, RULES, { mob: 0 }), new F.Engine(geo, RULES, { mob: 0 })]; pool.set(radius, pair); }
  for (let p = 1; p <= 2; p++) { pair[p].ttDepth.fill(-1); pair[p].ttKey.fill(0); pair[p].history.fill(0); }
  return pair;
}

// One game. Records (value from gold's side, phase, depth) at every searched position, then the
// outcome. `randomRate` moves are picked at random, which widens the spread of positions the meter
// has to be honest about -- a human game contains plenty of positions a self-playing engine never
// reaches on its own.
function playAndRecord({ depth, randomRate, openingPlies, swapChance, rand }) {
  const g = new F.Game(RADIUS, RULES);
  const eng = enginesFor(g.geo, RADIUS);
  const samples = [];
  let t = 0;
  while (!g.over && g.history.length < 220) {
    const p = g.toMove, L = g.legal();
    if (t === 1 && rand() < swapChance && g.canSwap()) { g.swapOpening(); t++; continue; }
    let m;
    if (!L.length) m = -1;
    else if (t < openingPlies || rand() < randomRate) m = L[Math.floor(rand() * L.length)];
    else {
      const r = eng[p].search(g.board, p, { timeMs: 1e9, maxDepth: depth, prevPass: g.lastPass, hands: g.hands });
      m = r.move;
      const placed = SUPPLY - g.hands[1] - g.hands[2];
      // value from gold's point of view, the same conversion the page makes
      const v = p === 1 ? r.value : -r.value;
      samples.push({ v, phase: placed / SUPPLY, gold: p === 1 ? 1 : 0, forced: Math.abs(v) >= F.WIN - 500 ? 1 : 0 });
    }
    g.play(m); t++;
  }
  const [a, b] = g.score();
  const y = a > b ? 1 : a < b ? 0 : 0.5;
  return { samples, y, turns: g.history.length, finalMargin: a - b };
}

function runJob(job) {
  const rand = rng(job.seed);
  const v = [], phase = [], y = [], gold = [], forced = [], gameOf = [];
  let games = 0, goldWins = 0, draws = 0;
  for (let i = 0; i < job.games; i++) {
    const g = playAndRecord({ ...job, rand });
    for (const s of g.samples) { v.push(s.v); phase.push(s.phase); y.push(g.y); gold.push(s.gold); forced.push(s.forced); gameOf.push(job.seed * 1000 + i); }
    games++; if (g.y === 1) goldWins++; else if (g.y === 0.5) draws++;
  }
  return { depth: job.depth, games, goldWins, draws, v, phase, y, gold, forced, gameOf };
}

if (parentPort) parentPort.on('message', (m) => {
  if (m.type === 'bye') process.exit(0);
  if (m.type === 'job') parentPort.postMessage({ index: m.index, result: runJob(m.job) });
});

module.exports = { playAndRecord, runJob };

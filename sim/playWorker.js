// Worker side of the self-play pool. One job = a batch of games from one fixed opening,
// either with the second player taking the opening lantern or answering it.
const { parentPort } = require('worker_threads');
const F = require('../src/engine.js');

const RULES = { K: 3, restrict: false, supply: 24, range: 2 };
const RADIUS = 5;
// Shallow self-play never fills a big table, and a cache-sized one is what lets 8 workers
// run at full speed instead of fighting each other for memory bandwidth.
const TT_BITS = +(process.env.FW_TT_BITS || 16);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// One game. `opening` is a cell index, `swap` says whether the second player takes it.
// `randomPlies` moves after the opening are random, to give the sample variety; after that both
// sides search to `depth`. Returns the score curve so lead changes can be measured.
// Each Engine owns a megabyte-scale transposition table and 80 ply buffers. Building two of them
// per game cost more than the games did, so they are built once per worker and reset between
// games -- reset, not reused, so a game still cannot see another game's search results.
const enginePool = new Map();
function enginesFor(geo, rules, radius) {
  const key = radius + '|' + JSON.stringify(rules);
  let pair = enginePool.get(key);
  const w = { mob: 0, ttBits: TT_BITS };
  if (!pair) { pair = [null, new F.Engine(geo, rules, w), new F.Engine(geo, rules, w)]; enginePool.set(key, pair); }
  for (let p = 1; p <= 2; p++) { pair[p].ttDepth.fill(-1); pair[p].ttKey.fill(0); pair[p].history.fill(0); }
  return pair;
}

function playOne({ opening, swap, depth1, depth2, randomPlies, rand, rules = RULES, radius = RADIUS, maxTurns = 220 }) {
  const g = new F.Game(radius, rules);
  const eng = enginesFor(g.geo, rules, radius);
  const depth = [0, depth1, depth2];
  const diffs = [];
  const record = () => { const [a, b] = g.score(); diffs.push(a - b); };

  g.play(opening);
  record();
  if (swap) { g.swapOpening(); record(); }

  let rp = 0;
  while (!g.over && g.history.length < maxTurns) {
    const p = g.toMove, L = g.legal();
    let m;
    if (!L.length) m = -1;
    else if (rp < randomPlies) { m = L[Math.floor(rand() * L.length)]; rp++; }
    else m = eng[p].search(g.board, p, { timeMs: 1e9, maxDepth: depth[p], prevPass: g.lastPass, hands: g.hands }).move;
    g.play(m);
    record();
  }

  const [a, b] = g.score();
  // Gold is always the player who chose the opening cell, whether or not it was taken away.
  let lastChange = 0, prev = 0;
  diffs.forEach((d, k) => { const s = Math.sign(d); if (s) { if (prev && s !== prev) lastChange = k; prev = s; } });
  const mid = diffs[Math.floor(diffs.length / 2)];
  return {
    openerWon: a > b ? 1 : 0, draw: a === b ? 1 : 0, margin: Math.abs(a - b),
    turns: diffs.length,
    lastLeadChangeFrac: diffs.length ? lastChange / diffs.length : 0,
    comeback: (Math.sign(mid) && Math.sign(mid) !== Math.sign(a - b)) ? 1 : 0,
    capped: g.over ? 0 : 1,
  };
}

function runJob(job) {
  const rand = rng(job.seed);
  const agg = { games: 0, openerWins: 0, draws: 0, margin: 0, turns: 0, lastLeadChangeFrac: 0, comebacks: 0, capped: 0 };
  for (let i = 0; i < job.games; i++) {
    const r = playOne({ ...job, rand });
    agg.games++;
    agg.openerWins += r.openerWon; agg.draws += r.draw; agg.margin += r.margin; agg.turns += r.turns;
    agg.lastLeadChangeFrac += r.lastLeadChangeFrac; agg.comebacks += r.comeback; agg.capped += r.capped;
  }
  return { ...job, ...agg };
}

if (parentPort) parentPort.on('message', (m) => {
  if (m.type === 'bye') { process.exit(0); }
  if (m.type === 'job') parentPort.postMessage({ index: m.index, result: runJob(m.job) });
});

module.exports = { playOne, runJob, RULES, RADIUS, rng };

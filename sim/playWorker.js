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

// One game from a fixed opening and a fixed reply.
//
// Exactly one move per side is not searched: the opening cell, which the study is about, and the
// reply, which the caller enumerates over every empty cell. Everything after that is searched by
// both sides at `depth`. Getting that count equal matters more than it sounds: giving one side a
// second unsearched move moves the measured win rate by something like fifteen points.
//
// After a swap the same holds -- the second player's first lantern is the one the opener chose,
// and the opener's first lantern is the reply -- and the first searched move passes to the player
// who took the lantern, which is exactly the tempo the swap rule is meant to transfer.
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

function playOne({ opening, swap, reply, depth1, depth2, rules = RULES, radius = RADIUS, maxTurns = 220 }) {
  const g = new F.Game(radius, rules);
  const eng = enginesFor(g.geo, rules, radius);
  const depth = [0, depth1, depth2];
  const diffs = [];
  const record = () => { const [a, b] = g.score(); diffs.push(a - b); };

  g.play(opening);
  record();
  if (swap) { g.swapOpening(); record(); }

  let capturingMoves = 0, cascades = 0, maxChain = 0, flipped = 0;
  const note = (rec) => {
    if (!rec || !rec.waves.length) return;
    const n = rec.waves.reduce((a, w) => a + w.length, 0);
    capturingMoves++; flipped += n;
    if (rec.waves.length >= 2) cascades++;          // a chain: one switch set off another
    if (n > maxChain) maxChain = n;
  };

  if (reply !== undefined && reply >= 0) { note(g.play(reply)); record(); }

  while (!g.over && g.history.length < maxTurns) {
    const p = g.toMove, L = g.legal();
    const m = L.length ? eng[p].search(g.board, p, { timeMs: 1e9, maxDepth: depth[p], prevPass: g.lastPass, hands: g.hands }).move : -1;
    note(g.play(m));
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
    capturingMoves, cascades, maxChain, flipped,
    lastLeadChangeFrac: diffs.length ? lastChange / diffs.length : 0,
    comeback: (Math.sign(mid) && Math.sign(mid) !== Math.sign(a - b)) ? 1 : 0,
    capped: g.over ? 0 : 1,
  };
}

// A job is one opening, one branch, and a slice of the replies to enumerate. Empty cells are
// listed in board order, so the slice is reproducible.
function runJob(job) {
  const probe = new F.Game(job.radius || RADIUS, job.rules || RULES);
  probe.play(job.opening);
  if (job.swap) probe.swapOpening();
  const replies = probe.legal();

  const agg = { games: 0, openerWins: 0, draws: 0, margin: 0, turns: 0, lastLeadChangeFrac: 0, lastLeadChangeSq: 0,
                comebacks: 0, capped: 0, capturingMoves: 0, cascades: 0, flipped: 0, maxChainSum: 0, maxChainEver: 0, replies: replies.length };
  const to = Math.min(job.replyTo ?? replies.length, replies.length);
  for (let i = job.replyFrom ?? 0; i < to; i++) {
    const r = playOne({ ...job, reply: replies[i] });
    agg.games++;
    agg.openerWins += r.openerWon; agg.draws += r.draw; agg.margin += r.margin; agg.turns += r.turns;
    agg.lastLeadChangeFrac += r.lastLeadChangeFrac; agg.lastLeadChangeSq += r.lastLeadChangeFrac * r.lastLeadChangeFrac;
    agg.comebacks += r.comeback; agg.capped += r.capped;
    agg.capturingMoves += r.capturingMoves; agg.cascades += r.cascades; agg.flipped += r.flipped;
    agg.maxChainSum += r.maxChain; if (r.maxChain > agg.maxChainEver) agg.maxChainEver = r.maxChain;
  }
  return { ...job, ...agg };
}

if (parentPort) parentPort.on('message', (m) => {
  if (m.type === 'bye') { process.exit(0); }
  if (m.type === 'job') parentPort.postMessage({ index: m.index, result: runJob(m.job) });
});

module.exports = { playOne, runJob, RULES, RADIUS, rng };

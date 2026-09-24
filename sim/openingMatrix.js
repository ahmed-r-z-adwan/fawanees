// Measures, for every opening cell, how often the opener wins -- both when the second player
// answers the opening lantern and when they take it under the swap rule.
//
//   node sim/openingMatrix.js [--depth 3] [--threads 12] [--out docs/measurements/opening.json]
//
// There is no sampling here. For each of the 91 opening cells, and for each of the two things the
// second player may do with it, every one of the 90 possible replies is played out. A cell's number
// is therefore the exact fraction of replies the opener goes on to beat, not an estimate of it.
//
// Cells that the hexagon's symmetry maps onto each other are the same opening and must come out
// with the same number. They are measured separately anyway, and pooled afterwards, so the spread
// inside a symmetry class is a check that the geometry really is symmetric.
const fs = require('fs');
const path = require('path');
const { runPool, cores } = require('./pool.js');
const { orbitsOf, ringOf } = require('./symmetry.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; };

const DEPTH = +arg('depth', 3);
const K = +arg('K', 3);
const SUPPLY = +arg('supply', 24);
const RANGE = +arg('range', 2);
// With --reps-only just one cell per symmetry class is measured, which is twelve times cheaper
// and enough to compare a candidate rule change against the current rules.
const REPS_ONLY = process.argv.includes('--reps-only');
// Answering and taking are the same game from opposite seats, so one branch implies the other.
// --one-branch measures only the answering branch and derives the other.
const ONE_BRANCH = process.argv.includes('--one-branch');
const THREADS = +arg('threads', Math.max(1, cores - 1));
const CHUNK = +arg('chunk', 10);
const OUT = arg('out', 'docs/measurements/opening.json');
const RADIUS = 5;

const { geo, canon, members } = orbitsOf(RADIUS);

// Every opening, every branch, every reply. No sampling, so no sampling error: each cell's number
// is the exact fraction of the 90 possible replies that the opener goes on to beat.
const RULES_V = { K, restrict: false, supply: SUPPLY, range: RANGE };
const REPLIES = geo.N - 1;
const CELLS = REPS_ONLY ? [...members.keys()] : Array.from({ length: geo.N }, (_, i) => i);
const BRANCHES = ONE_BRANCH ? [false] : [false, true];
const jobs = [];
for (const cell of CELLS) {
  for (const swap of BRANCHES) {
    for (let from = 0; from < REPLIES; from += CHUNK) {
      jobs.push({ opening: cell, swap, replyFrom: from, replyTo: Math.min(from + CHUNK, REPLIES), depth1: DEPTH, depth2: DEPTH, rules: RULES_V });
    }
  }
}
const totalGames = CELLS.length * BRANCHES.length * REPLIES;

// The enumeration is exhaustive over replies, so this interval describes only the spread across
// replies, not uncertainty about the mean of that population.
const wilson = (k, n) => {
  if (!n) return [0, 0];
  const z = 1.959964, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};

let lastPct = -1;
const bar = (done, total, ms) => {            // one line per 5%, so a long run leaves a readable log
  const pct = Math.floor(100 * done / total / 5) * 5;
  if (pct === lastPct) return;
  lastPct = pct;
  console.log(`  ${String(pct).padStart(3)}%  ${done}/${total} batches  elapsed ${Math.round(ms / 1000)}s  eta ${Math.round((ms / done * (total - done)) / 1000)}s`);
};

(async () => {
  console.log(`opening study: ${CELLS.length} cells x ${BRANCHES.length} branch${BRANCHES.length > 1 ? 'es' : ''} x every one of the ${REPLIES} replies = ${totalGames} games,`);
  console.log(`K=${K} supply=${SUPPLY} range=${RANGE}, depth ${DEPTH} both sides, no randomness anywhere. ${THREADS} threads.`);
  const t0 = Date.now();
  const results = await runPool(path.join(__dirname, 'playWorker.js'), jobs, {
    threads: THREADS,
    onProgress: (d, n, ms) => bar(d, n, ms),
  });
  process.stdout.write('\n');
  const secs = (Date.now() - t0) / 1000;

  // fold the chunks back into one row per (cell, branch)
  const key = (cell, swap) => cell + '|' + (swap ? 1 : 0);
  const rows = new Map();
  for (const r of results) {
    const k = key(r.opening, r.swap);
    const a = rows.get(k) || { cell: r.opening, swap: r.swap, games: 0, openerWins: 0, draws: 0, margin: 0, turns: 0, lastLeadChangeFrac: 0, comebacks: 0, capped: 0 };
    for (const f of ['games', 'openerWins', 'draws', 'margin', 'turns', 'lastLeadChangeFrac', 'comebacks', 'capped']) a[f] += r[f];
    rows.set(k, a);
  }

  const cellRow = (cell, swap) => {
    const r = rows.get(key(cell, swap));
    if (r) return r;
    // the branch we did not measure is the complement of the one we did
    const other = rows.get(key(cell, !swap));
    return { ...other, openerWins: other.games - other.openerWins - other.draws };
  };
  const cells = [];
  for (const cell of CELLS) {
    const no = cellRow(cell, false), sw = cellRow(cell, true);
    cells.push({
      cell, q: geo.cells[cell].q, r: geo.cells[cell].r, ring: ringOf(geo.cells[cell]), orbit: canon[cell],
      noSwap: { games: no.games, openerWinRate: no.openerWins / no.games, draws: no.draws / no.games },
      swap: { games: sw.games, openerWinRate: sw.openerWins / sw.games, draws: sw.draws / sw.games },
    });
  }

  // pooled by symmetry class: this is the number the policy is derived from
  const orbits = [];
  for (const [rep, list] of members) {
    const measured = list.filter(c => CELLS.includes(c));
    if (!measured.length) continue;
    const acc = { noSwap: { g: 0, w: 0 }, swap: { g: 0, w: 0 }, turns: 0, lead: 0, comebacks: 0, margin: 0, capped: 0, all: 0 };
    for (const cell of measured) {
      for (const [branch, swap] of [['noSwap', false], ['swap', true]]) {
        const row = cellRow(cell, swap);
        acc[branch].g += row.games; acc[branch].w += row.openerWins;
        acc.turns += row.turns; acc.lead += row.lastLeadChangeFrac; acc.comebacks += row.comebacks;
        acc.margin += row.margin; acc.capped += row.capped; acc.all += row.games;
      }
    }
    const nsR = acc.noSwap.w / acc.noSwap.g, swR = acc.swap.w / acc.swap.g;
    // The responder picks the branch that is worse for the opener, so this is the opening's real value.
    const bestForResponder = Math.min(nsR, swR);
    orbits.push({
      rep, q: geo.cells[rep].q, r: geo.cells[rep].r, ring: ringOf(geo.cells[rep]), cells: measured.length,
      noSwap: { games: acc.noSwap.g, openerWinRate: nsR, ci: wilson(acc.noSwap.w, acc.noSwap.g) },
      swap: { games: acc.swap.g, openerWinRate: swR, ci: wilson(acc.swap.w, acc.swap.g) },
      responderShouldSwap: swR < nsR,
      openerWinRateUnderSwapRule: bestForResponder,
      turnsAvg: acc.turns / acc.all, lastLeadChangeAvg: acc.lead / acc.all,
      comebackRate: acc.comebacks / acc.all, marginAvg: acc.margin / acc.all, cappedGames: acc.capped,
    });
  }
  orbits.sort((a, b) => b.openerWinRateUnderSwapRule - a.openerWinRateUnderSwapRule);

  const best = orbits[0];
  const out = {
    what: 'Opener win rate for every opening cell, with and without the second player taking the opening lantern.',
    how: `node sim/openingMatrix.js --depth ${DEPTH} --K ${K} --supply ${SUPPLY} --range ${RANGE}${REPS_ONLY ? ' --reps-only' : ''}${ONE_BRANCH ? ' --one-branch' : ''}`,
    rules: { ...RULES_V, radius: RADIUS },
    setup: `Both sides search to depth ${DEPTH}. The opening cell is fixed and the second player either answers it or takes it; then every one of the ${REPLIES} possible replies is played out in turn, and both sides search from there on. Exactly one move per side is unsearched, which is what keeps the two players comparable. "Opener" always means the player who chose the opening cell, even after it is taken from them.`,
    date: new Date().toISOString().slice(0, 10),
    totalGames, seconds: Math.round(secs), threads: THREADS,
    // With an opponent who swaps whenever it helps them, the opener's best opening is this one.
    balance: {
      bestOpening: { q: best.q, r: best.r, ring: best.ring },
      openerWinRate: best.openerWinRateUnderSwapRule,
      ci: wilson(Math.round(best.openerWinRateUnderSwapRule * (best.responderShouldSwap ? best.swap.games : best.noSwap.games)),
                 best.responderShouldSwap ? best.swap.games : best.noSwap.games),
      lastLeadChangeAvg: best.lastLeadChangeAvg,
    },
    orbits, cells,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

  const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
  console.log(`\n${totalGames} games in ${Math.round(secs)}s (${(totalGames / secs).toFixed(1)} games/s on ${THREADS} threads)\n`);
  console.log('opening            cells   answered      taken   responder   opener under swap rule');
  for (const o of orbits) {
    console.log(`  ring ${o.ring} (${String(o.q).padStart(2)},${String(o.r).padStart(2)})   ${String(o.cells).padStart(2)}    ${pct(o.noSwap.openerWinRate)}     ${pct(o.swap.openerWinRate)}      ${o.responderShouldSwap ? 'takes ' : 'answers'}   ${pct(o.openerWinRateUnderSwapRule)}`);
  }
  console.log(`\nbest opening for the opener: ring ${best.ring} (${best.q},${best.r}) -> ${pct(best.openerWinRateUnderSwapRule)} ` +
              `[95% ${pct(out.balance.ci[0])} .. ${pct(out.balance.ci[1])}], last lead change at ${(100 * best.lastLeadChangeAvg).toFixed(0)}% of the game`);
  console.log(`written to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });

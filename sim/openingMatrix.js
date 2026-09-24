// Measures, for every opening cell, how often the opener wins -- both when the second player
// answers the opening lantern and when they take it under the swap rule.
//
//   node sim/openingMatrix.js [--per-orbit 900] [--min-per-cell 60] [--random-plies 2]
//                             [--depth 3] [--threads 15] [--out docs/measurements/opening.json]
//
// Cells that the hexagon's symmetry maps onto each other are the same opening, so their games
// are pooled: that is what buys enough games per opening to say anything at 2% precision.
// Each cell still gets its own games, so the per-cell map is a real measurement too, and the
// spread inside an orbit is a check that the geometry is actually symmetric.
const fs = require('fs');
const path = require('path');
const { runPool, cores } = require('./pool.js');
const { orbitsOf, ringOf } = require('./symmetry.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; };

const PER_ORBIT = +arg('per-orbit', 900);
const MIN_PER_CELL = +arg('min-per-cell', 60);
const RANDOM_PLIES = +arg('random-plies', 2);
const DEPTH = +arg('depth', 3);
const THREADS = +arg('threads', Math.max(1, cores - 1));
const CHUNK = +arg('chunk', 30);
const OUT = arg('out', 'docs/measurements/opening.json');
const RADIUS = 5;

const { geo, canon, members } = orbitsOf(RADIUS);

const gamesForCell = (rep) => Math.max(MIN_PER_CELL, Math.ceil(PER_ORBIT / members.get(rep).length));

const jobs = [];
for (let cell = 0; cell < geo.N; cell++) {
  const total = gamesForCell(canon[cell]);
  for (const swap of [false, true]) {
    let left = total, part = 0;
    while (left > 0) {
      const n = Math.min(CHUNK, left);
      jobs.push({ opening: cell, swap, games: n, depth1: DEPTH, depth2: DEPTH, randomPlies: RANDOM_PLIES,
                  seed: (cell * 7919 + (swap ? 104729 : 0) + part * 31 + 1) >>> 0 });
      left -= n; part++;
    }
  }
}
const totalGames = jobs.reduce((a, j) => a + j.games, 0);

const wilson = (k, n) => {  // 95% interval, so the numbers come with an honest error bar
  if (!n) return [0, 0];
  const z = 1.959964, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};

const bar = (done, total, ms) => {
  const frac = done / total, eta = frac > 0 ? (ms / frac - ms) / 1000 : 0;
  const w = 32, f = Math.round(w * frac);
  process.stdout.write(`\r  [${'#'.repeat(f)}${'.'.repeat(w - f)}] ${(100 * frac).toFixed(1)}%  ${done}/${total} batches  eta ${Math.round(eta)}s   `);
};

(async () => {
  console.log(`opening study: ${geo.N} cells x 2 branches, ${totalGames} games total, depth ${DEPTH} both sides,`);
  console.log(`${RANDOM_PLIES} random plies after the opening, ${members.size} symmetry classes, ${THREADS} threads`);
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

  const cellRow = (cell, swap) => rows.get(key(cell, swap));
  const cells = [];
  for (let cell = 0; cell < geo.N; cell++) {
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
    const acc = { noSwap: { g: 0, w: 0 }, swap: { g: 0, w: 0 }, turns: 0, lead: 0, comebacks: 0, margin: 0, capped: 0, all: 0 };
    for (const cell of list) {
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
      rep, q: geo.cells[rep].q, r: geo.cells[rep].r, ring: ringOf(geo.cells[rep]), cells: list.length,
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
    how: `node sim/openingMatrix.js --per-orbit ${PER_ORBIT} --min-per-cell ${MIN_PER_CELL} --random-plies ${RANDOM_PLIES} --depth ${DEPTH}`,
    rules: { K: 3, restrict: false, supply: 24, range: 2, radius: RADIUS },
    setup: `Both sides search to depth ${DEPTH}. The opening cell is fixed, the second player either answers it or takes it, then ${RANDOM_PLIES} random plies give the sample variety, then both sides play out. "Opener" always means the player who chose the opening cell, even after it is taken from them.`,
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

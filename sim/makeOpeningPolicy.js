// Turns the opening study into the policy the machine plays, and writes src/opening.js.
//
//   node sim/makeOpeningPolicy.js [--in docs/measurements/opening.json] [--out src/opening.js]
//
// Two things come out of the data.
//
// As the responder: take the opening lantern whenever the opening favours the opener. The study
// shows why that is the whole decision -- the position after a swap is the position after an
// answer with the colours exchanged, so the two branches are exact complements of each other, and
// the responder simply picks the better seat.
//
// As the opener: because the responder gets that choice, the opener can never do better than the
// opening whose win rate is closest to 50%. So the machine opens on the cells that sit nearest the
// middle, and it varies between all of them that the data cannot tell apart.
//
// The error bar is the spread between cells of the same symmetry class, not a binomial on the
// games. Cells of one class are the same opening rotated, so they should agree exactly; they do
// not, because the search breaks ties by cell index and mirrored positions therefore diverge. That
// spread is the real uncertainty in an opening's value, and it is wider than the binomial.
const fs = require('fs');
const path = require('path');
const { orbitsOf, ringOf } = require('./symmetry.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const IN = arg('in', 'docs/measurements/opening.json');
const OUT = arg('out', 'src/opening.js');

const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
// If the policy has already been played out end to end, quote that rather than the orbit estimate:
// it is what actually happens, over the whole opening set rather than the single best opening.
const PLAYED = arg('played', 'docs/measurements/dyn-k3.json');
let played = null;
try { played = JSON.parse(fs.readFileSync(PLAYED, 'utf8')).variants[0].played; } catch (e) {}
const { geo, canon, members } = orbitsOf(data.rules.radius);
const key = i => geo.cells[i].q + ',' + geo.cells[i].r;
const cellOf = new Map(data.cells.map(c => [c.cell, c]));

// how far the two branches fail to be exact complements: a check on the swap implementation
let worstComplement = 0;
for (const c of data.cells) worstComplement = Math.max(worstComplement, Math.abs(1 - (c.noSwap.openerWinRate + c.swap.openerWinRate)));

const orbits = [];
for (const [rep, list] of members) {
  const v = list.map(c => cellOf.get(c).noSwap.openerWinRate);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0.10;
  const se = v.length > 1 ? sd / Math.sqrt(v.length) : sd;
  orbits.push({
    rep, q: geo.cells[rep].q, r: geo.cells[rep].r, ring: ringOf(geo.cells[rep]),
    cells: list.length, games: list.length * (geo.N - 1) * 2,
    keepsIt: mean, spreadSd: sd, se,
    // with the responder choosing the better seat, this is what the opening is worth to the opener
    underSwapRule: Math.min(mean, 1 - mean),
    responderTakes: mean > 0.5,
  });
}
orbits.sort((a, b) => b.underSwapRule - a.underSwapRule);

const best = orbits[0];
// Keep the openings within two points of the best. Two points is below what this study can
// resolve, so the machine is choosing among openings it has no reason to prefer between -- which
// is what buys variety without giving anything away.
const MARGIN = 0.02;
const bestSet = orbits.filter(o => best.underSwapRule - o.underSwapRule <= MARGIN);
const openCells = [];
for (const o of bestSet) for (const c of members.get(o.rep)) openCells.push(key(c));
openCells.sort();

const swapCells = [];
for (let i = 0; i < geo.N; i++) {
  const o = orbits.find(x => x.rep === canon[i]);
  if (o.responderTakes) swapCells.push(key(i));
}
swapCells.sort();

const allCells = data.cells.map(c => c.noSwap.openerWinRate);
const avgNoSwap = allCells.reduce((a, b) => a + b, 0) / allCells.length;
const bestNoSwap = orbits.reduce((a, b) => (b.keepsIt > a.keepsIt ? b : a));
const worstNoSwap = orbits.reduce((a, b) => (b.keepsIt < a.keepsIt ? b : a));

const pct = x => (100 * x).toFixed(1) + '%';
console.log(`opening policy from ${data.totalGames} games (${data.cells.length} cells x 2 branches x ${geo.N - 1} replies)`);
console.log(`  answered + taken = 100% to within ${(100 * worstComplement).toFixed(1)} points, so the two branches are the same game from opposite seats`);
console.log(`  best opening for the opener: ring ${best.ring} (${best.q},${best.r}) -> ${pct(best.underSwapRule)} +/- ${(196 * best.se).toFixed(1)}`);
console.log(`  ${bestSet.length} of ${orbits.length} openings are within 2 points of it -> ${openCells.length} cells to choose from`);
console.log(`  the responder takes the lantern on ${swapCells.length} of ${geo.N} opening cells`);
console.log(`  without the swap rule: best ${pct(bestNoSwap.keepsIt)}, average ${pct(avgNoSwap)}, centre ${pct(worstNoSwap.keepsIt)}`);
console.log(`  worst opening: ring ${orbits[orbits.length - 1].ring} (${orbits[orbits.length - 1].q},${orbits[orbits.length - 1].r}) -> ${pct(orbits[orbits.length - 1].underSwapRule)}`);

const js = `// Opening and swap policy, derived from ${data.totalGames} self-play games at equal strength:
// every opening cell, both branches of the swap rule, every one of the ${geo.N - 1} possible replies.
// Generated by sim/makeOpeningPolicy.js on ${new Date().toISOString().slice(0, 10)}; do not edit by hand.
// Full study in docs/measurements/opening.json, discussion in docs/BALANCE.md.
//
// Taking the opening lantern leaves exactly the position that answering it leaves, with the colours
// exchanged, so the two branches are complements: across all ${data.cells.length} cells they add to 100% to
// within ${(100 * worstComplement).toFixed(1)} points. The responder therefore just picks the better seat, and the
// opener's best answer is the opening that sits closest to even: ${pct(best.underSwapRule)}.
window.FawaneesOpening = {
  measured: true,
  source: '${data.totalGames} self-play games at depth 3, every opening cell and every reply',
  games: ${data.totalGames},
  // What the first player gets if nobody may take the opening lantern: the advantage is real,
  // and the swap rule is what removes it.
  noSwapBest: ${bestNoSwap.keepsIt.toFixed(4)},
  noSwapAverage: ${avgNoSwap.toFixed(4)},
  noSwapCentre: ${worstNoSwap.keepsIt.toFixed(4)},
  // What they get once the second player may take it. bestOpeningUnderSwapRule is the single best
  // opening from the study; openerWinRate is the whole policy played out, which is what a player
  // actually meets.
  bestOpeningUnderSwapRule: ${best.underSwapRule.toFixed(4)},
  openerWinRate: ${(played ? played.openerWinRate : best.underSwapRule).toFixed(4)},
  openerWinRateHalfWidthPlayed: ${(played ? played.openerWinRateHalfWidth : 1.96 * best.se).toFixed(4)},
  playedGames: ${played ? played.games : 0},
  openerWinRateHalfWidth: ${(1.96 * best.se).toFixed(4)},
  // Openings within two points of the best, which is finer than the study can resolve.
  open: ${JSON.stringify(openCells)},
  // Opening cells where the second player does better by taking the lantern than by answering it.
  swapCells: ${JSON.stringify(swapCells)},
  pickOpening: function (geo) {
    const pool = this.open.map(k => geo.index.get(k)).filter(i => i !== undefined);
    return pool[Math.floor(Math.random() * pool.length)];
  },
  shouldSwap: function (cell, geo) {
    const c = geo.cells[cell];
    return this.swapCells.indexOf(c.q + ',' + c.r) >= 0;
  },
};
`;
fs.writeFileSync(OUT, js);

fs.writeFileSync(path.join(path.dirname(IN), 'opening-policy.json'), JSON.stringify({
  what: 'The opening and swap policy derived from the study, with the numbers behind it.',
  source: IN,
  complementCheck: { worstDeviationPoints: +(100 * worstComplement).toFixed(2),
    meaning: 'answering and taking should be exact complements; this is how far they miss, and it is the residual from draws and from the search not being colour-symmetric' },
  best: { ring: best.ring, q: best.q, r: best.r, openerUnderSwapRule: best.underSwapRule, halfWidth95: 1.96 * best.se },
  openCells: openCells.length, swapCells: swapCells.length,
  orbits,
}, null, 1));
console.log(`written to ${OUT} and ${path.join(path.dirname(IN), 'opening-policy.json')}`);

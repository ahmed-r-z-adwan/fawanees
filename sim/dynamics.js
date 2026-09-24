// How a game moves, not just who wins it: when the lead stops changing, how often the loser was
// ahead at halfway, how big the swings are.
//
//   node sim/dynamics.js --policy                 measure exactly what the shipped policy does
//   node sim/dynamics.js --variants               compare candidate rule changes
//   node sim/dynamics.js --openings "-3,0;-2,0"   measure a chosen set of openings
//
// With --policy it reads src/opening.js and plays what the machine will actually play: its opening
// cells, and its per-symmetry-class decision about taking the lantern. That decision must come from
// outside the games being measured. Re-deciding it per cell from the very games you are scoring
// picks whichever seat happened to win more in that cell's ninety games, and since mirrored cells
// disagree by about ten points on tie-breaking alone, that is selecting on noise: it moved the
// measured opener win rate down by five points.
const fs = require('fs');
const path = require('path');
const { runPool, cores } = require('./pool.js');
const F = require('../src/engine.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const THREADS = +arg('threads', Math.max(1, cores - 4));
const DEPTH = +arg('depth', 3);
const OUT = arg('out', 'docs/measurements/dynamics.json');

const BASE = { K: +arg('K', 3), restrict: false, supply: +arg('supply', 24), range: +arg('range', 2) };
if (arg('M', null)) BASE.M = +arg('M', 1);
const BASE_RADIUS = 5;

// Openings the policy picks from, as "q,r". Default: the ones the study put at the top.
// --policy reads the shipped policy instead of taking openings on the command line
let POLICY = null;
if (process.argv.includes('--policy')) {
  const w = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'src', 'opening.js'), 'utf8'))(w);
  POLICY = w.FawaneesOpening;
}
const OPENINGS = POLICY ? POLICY.open : arg('openings', '-3,0;-2,0;-4,2').split(';').map(s => s.trim()).filter(Boolean);

// Candidate rule changes, each a departure from the current rules in exactly one respect.
const VARIANTS = [
  { name: 'current rules', radius: BASE_RADIUS, rules: { ...BASE } },
  { name: '30 lanterns each', radius: BASE_RADIUS, rules: { ...BASE, supply: 30 } },
  { name: '36 lanterns each', radius: BASE_RADIUS, rules: { ...BASE, supply: 36 } },
  { name: 'radius 6, 34 lanterns', radius: 6, rules: { ...BASE, supply: 34 } },
  { name: 'capture needs 4 seers', radius: BASE_RADIUS, rules: { ...BASE, K: 4 } },
  { name: 'capture needs 2 more, not 1', radius: BASE_RADIUS, rules: { ...BASE, M: 2 } },
  { name: 'light reaches 3 cells', radius: BASE_RADIUS, rules: { ...BASE, range: 3 } },
];

function jobsFor(variant, openingCells, swapFor) {
  const geo = F.makeGeometry(variant.radius);
  const replies = geo.N - 1;
  const jobs = [];
  for (const cell of openingCells) {
    for (let from = 0; from < replies; from += 10) {
      jobs.push({ opening: cell, swap: swapFor(cell), replyFrom: from, replyTo: Math.min(from + 10, replies),
                  depth1: DEPTH, depth2: DEPTH, radius: variant.radius, rules: variant.rules });
    }
  }
  return jobs;
}

function summarise(results) {
  const a = { games: 0, openerWins: 0, draws: 0, margin: 0, turns: 0, lastLeadChangeFrac: 0, lastLeadChangeSq: 0,
              comebacks: 0, capped: 0, capturingMoves: 0, cascades: 0, flipped: 0, maxChainSum: 0, gamesWithChain: 0 };
  let maxChainEver = 0;
  for (const r of results) { for (const k of Object.keys(a)) a[k] += r[k]; if (r.maxChainEver > maxChainEver) maxChainEver = r.maxChainEver; }
  const mean = a.lastLeadChangeFrac / a.games;
  const variance = Math.max(0, a.lastLeadChangeSq / a.games - mean * mean);
  return {
    games: a.games,
    openerWinRate: a.openerWins / a.games,
    openerWinRateHalfWidth: 1.96 * Math.sqrt(0.25 / a.games),
    drawRate: a.draws / a.games,
    lastLeadChange: mean,
    lastLeadChangeHalfWidth: 1.96 * Math.sqrt(variance / a.games),
    comebackRate: a.comebacks / a.games,
    marginAvg: a.margin / a.games,
    turnsAvg: a.turns / a.games,
    // what the capture rule actually does during a game
    capturingMovesPerGame: a.capturingMoves / a.games,
    chainsPerGame: a.cascades / a.games,
    gamesWithAChain: a.gamesWithChain / a.games,
    lanternsFlippedPerGame: a.flipped / a.games,
    biggestChainPerGame: a.maxChainSum / a.games,
    biggestChainEver: maxChainEver,
    unfinished: a.capped,
  };
}

(async () => {
  const doVariants = process.argv.includes('--variants');
  const list = doVariants ? VARIANTS : [VARIANTS[0]];
  const out = [];

  for (const v of list) {
    const geo = F.makeGeometry(v.radius);
    const cells = OPENINGS.map(k => geo.index.get(k)).filter(i => i !== undefined);
    if (!cells.length) { console.log(`${v.name}: none of the chosen openings exist on radius ${v.radius}, skipped`); continue; }

    let swapFor, decidedBy;
    if (POLICY) {
      // The shipped policy, decided in advance from the pooled study.
      swapFor = (cell) => POLICY.shouldSwap(cell, geo);
      decidedBy = 'src/opening.js, decided per symmetry class from the pooled study';
    } else {
      // No policy given: decide from a first pass over the whole set, one decision for all of it.
      // Deciding per cell here would be selecting on the noise in these same games.
      const probe = summarise(await runPool(path.join(__dirname, 'playWorker.js'), jobsFor(v, cells, () => false), { threads: THREADS }));
      const takes = probe.openerWinRate > 0.5;
      swapFor = () => takes;
      decidedBy = `a first pass over all ${cells.length} openings together: responder ${takes ? 'takes' : 'answers'}`;
    }
    const main = summarise(await runPool(path.join(__dirname, 'playWorker.js'), jobsFor(v, cells, swapFor), { threads: THREADS }));
    const takesOn = cells.filter(swapFor).length;
    const row = { ...v, openings: OPENINGS, swapDecidedBy: decidedBy, responderTakesOn: `${takesOn} of ${cells.length}`, played: main };
    out.push(row);
    const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
    console.log(`${v.name.padEnd(28)} opener ${pct(main.openerWinRate)} +/-${(100 * main.openerWinRateHalfWidth).toFixed(1)}  last lead change ${pct(main.lastLeadChange)} +/-${(100 * main.lastLeadChangeHalfWidth).toFixed(1)}  ` +
                `comeback ${pct(main.comebackRate)}  |margin| ${main.marginAvg.toFixed(1).padStart(5)}  ` +
                `chains/game ${main.chainsPerGame.toFixed(2)}  games with a chain ${pct(main.gamesWithAChain)}  ` +
                `biggest chain avg ${main.biggestChainPerGame.toFixed(1)} max ${main.biggestChainEver}  turns ${main.turnsAvg.toFixed(0)}  ` +
                `(${main.games} games, responder takes on ${takesOn}/${cells.length})`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    what: 'How games move under the current rules, and under candidate rule changes.',
    how: `node sim/dynamics.js${doVariants ? ' --variants' : ''} --depth ${DEPTH}`,
    setup: `Openings ${OPENINGS.join(', ')}; the second player does whatever is better for them; every reply enumerated; both sides search to depth ${DEPTH}.`,
    metric: '"last lead change" is how far into the game the leader changed for the last time, averaged over games. A game decided early has a small number.',
    date: new Date().toISOString().slice(0, 10),
    variants: out,
  }, null, 1));
  console.log(`\nwritten to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });

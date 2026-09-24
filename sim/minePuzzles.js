// Builds the puzzle set from the machine's own games and writes src/puzzles.js.
//
//   node sim/minePuzzles.js [--games 1500] [--keep 16] [--threads 12]
//
// Every puzzle is verified twice: once at the depth that found it, and again one ply deeper on
// this thread, where the answer and the margin must come out the same. Duplicates are removed
// under the board's twelve symmetries and under swapping the colours, so no two puzzles are the
// same position wearing a different hat.
const fs = require('fs');
const path = require('path');
const { runPool, cores } = require('./pool.js');
const F = require('../src/engine.js');
const { canonical, RULES, RADIUS, DEEP } = require('./mineWorker.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const GAMES = +arg('games', 1500);
const KEEP = +arg('keep', 16);
const THREADS = +arg('threads', Math.max(1, cores - 4));
const CHUNK = +arg('chunk', 10);
const VERIFY_DEPTH = +arg('verify-depth', DEEP + 1);   // one ply deeper than the depth that found it
const OUT_JSON = arg('out', 'docs/measurements/puzzles.json');
const OUT_JS = arg('js', 'src/puzzles.js');

(async () => {
  const jobs = [];
  let left = GAMES, part = 0;
  while (left > 0) { const n = Math.min(CHUNK, left); jobs.push({ games: n, randomRate: 0.12, seed: (part * 6367 + 17) >>> 0 }); left -= n; part++; }

  console.log(`mining puzzles from ${GAMES} self-play games on ${THREADS} threads`);
  let last = -1;
  const t0 = Date.now();
  const results = await runPool(path.join(__dirname, 'mineWorker.js'), jobs, {
    threads: THREADS,
    onProgress: (d, n, ms) => {
      const pct = Math.floor(100 * d / n / 10) * 10;
      if (pct === last) return; last = pct;
      console.log(`  ${String(pct).padStart(3)}%  ${d}/${n} batches  elapsed ${Math.round(ms / 1000)}s  eta ${Math.round((ms / d * (n - d)) / 1000)}s`);
    },
  });

  let positions = 0, games = 0;
  const all = [];
  for (const r of results) { positions += r.positions; games += r.games; all.push(...r.found); }
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n${games} games, ${positions} positions looked at, ${all.length} candidates in ${Math.round(secs)}s`);

  // one per distinct position
  const byKey = new Map();
  for (const c of all) {
    const prev = byKey.get(c.key);
    if (!prev || c.margin > prev.margin) byKey.set(c.key, c);
  }
  const unique = [...byKey.values()];
  console.log(`${unique.length} distinct positions after folding away symmetry and colour`);

  // Re-check every survivor a ply deeper, on this thread, with a fresh engine.
  const geo = F.makeGeometry(RADIUS); geo.range = RULES.range;
  const verified = [];
  let disagreed = 0;
  for (const c of unique) {
    const e = new F.Engine(geo, RULES, { mob: 0 });
    const board = Int8Array.from(c.board);
    const sc = e.rootScoresExact(board, c.side, VERIFY_DEPTH, { hands: c.hands });
    if (sc.length < 2 || sc[0].move !== c.answer) { disagreed++; continue; }
    const margin = sc[0].score - sc[1].score;
    if (margin < 4) { disagreed++; continue; }
    verified.push({ ...c, verifyDepth: VERIFY_DEPTH, verifyMargin: margin });
  }
  console.log(`${verified.length} survived a depth-${VERIFY_DEPTH} recheck, ${disagreed} dropped`);

  // Spread the chosen set over the difficulty range rather than taking the N biggest chains.
  verified.sort((a, b) => (b.difficulty - a.difficulty) || (b.flips - a.flips) || (b.margin - a.margin));
  const byDiff = new Map();
  for (const v of verified) { const k = v.difficulty; (byDiff.get(k) || byDiff.set(k, []).get(k)).push(v); }
  const chosen = [];
  const order = [...byDiff.keys()].sort((a, b) => a - b);
  let round = 0;
  while (chosen.length < KEEP && round < 200) {
    let added = false;
    for (const d of order) {
      const list = byDiff.get(d);
      if (list.length > round) { chosen.push(list[round]); added = true; if (chosen.length >= KEEP) break; }
    }
    if (!added) break;
    round++;
  }
  chosen.sort((a, b) => (a.difficulty - b.difficulty) || (a.flips - b.flips));

  const name = i => geo.cells[i].q + ',' + geo.cells[i].r;
  const stat = (arr) => ({ min: Math.min(...arr), median: arr.slice().sort((a, b) => a - b)[arr.length >> 1], max: Math.max(...arr) });

  const report = {
    what: 'Puzzles mined from the machine\'s own self-play, each one a position where a single move is decisive.',
    how: `node sim/minePuzzles.js --games ${GAMES} --keep ${KEEP}`,
    date: new Date().toISOString().slice(0, 10),
    filter: `a move that flips at least 3 lanterns straight away, is at least 5 points better than every other move at depth ${DEEP}, and is not the move a depth-1 search would play`,
    verification: `re-searched at depth ${VERIFY_DEPTH} with a fresh engine: same answer, margin still at least 4`,
    games, positionsScanned: positions, candidates: all.length, distinct: unique.length,
    verified: verified.length, droppedOnRecheck: disagreed, kept: chosen.length,
    seconds: Math.round(secs),
    spread: chosen.length ? {
      margin: stat(chosen.map(c => c.margin)),
      flips: stat(chosen.map(c => c.flips)),
      difficulty: stat(chosen.map(c => c.difficulty)),
      lanterns: stat(chosen.map(c => c.lanterns)),
    } : null,
    puzzles: chosen.map(c => ({
      answer: name(c.answer), side: c.side, flips: c.flips, margin: c.margin, verifyMargin: c.verifyMargin,
      difficulty: c.difficulty, swing: c.swing, lanterns: c.lanterns,
      waves: c.waves.map(w => w.map(name)), secondBest: name(c.secondBest),
    })),
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 1));

  // Compact form for the page: one string of 91 digits per board.
  const pack = b => b.join('');
  const js = `// Puzzles the machine found in its own games. Generated by sim/minePuzzles.js on ${report.date};
// do not edit by hand. Full report in docs/measurements/puzzles.json.
//
// ${games} self-play games, ${positions} positions examined, ${all.length} candidates,
// ${unique.length} distinct after symmetry, ${verified.length} survived a depth-${VERIFY_DEPTH} recheck, ${chosen.length} kept.
// "difficulty" is the shallowest search depth that finds the answer: 2 means a machine looking two
// moves ahead sees it, ${DEEP} means it needs to look ${DEEP}.
window.FawaneesPuzzles = {
  measured: true,
  radius: ${RADIUS},
  games: ${games},
  positionsScanned: ${positions},
  candidates: ${all.length},
  // the depth the margin was measured at, and the deeper one it was re-checked at
  mineDepth: ${DEEP},
  verifyDepth: ${VERIFY_DEPTH},
  list: [
${chosen.map(c => `    { board: '${pack(c.board)}', side: ${c.side}, hands: [0, ${c.hands[1]}, ${c.hands[2]}], answer: '${name(c.answer)}',` +
                  ` flips: ${c.flips}, margin: ${c.margin}, verifyMargin: ${c.verifyMargin}, difficulty: ${c.difficulty}, swing: ${c.swing},` +
                  ` waves: ${JSON.stringify(c.waves.map(w => w.map(name)))} },`).join('\n')}
  ],
};
`;
  fs.writeFileSync(OUT_JS, js);

  console.log(`\nkept ${chosen.length} puzzles`);
  console.log('  #  difficulty  flips  margin  lanterns  answer');
  chosen.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}      depth ${c.difficulty}    ${String(c.flips).padStart(3)}  ${String(c.margin).padStart(6)}  ${String(c.lanterns).padStart(8)}  (${name(c.answer)})`));
  console.log(`\nwritten to ${OUT_JSON} and ${OUT_JS}`);
})().catch(e => { console.error(e); process.exit(1); });

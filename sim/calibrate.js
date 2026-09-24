// Fits the win-chance meter against real outcomes and writes src/calibration.js.
//
//   node sim/calibrate.js [--games 1500] [--buckets 6] [--threads 12]
//
// The page shows a percentage next to each player. Until now that came from 1/(1+exp(-eval/7)),
// a shape nobody had ever checked against a result. This plays thousands of games, records the
// search value at every position together with how far into the game it was, and fits
//
//     P(gold wins) = sigmoid( a(phase, whose turn) * value + b(phase, whose turn) )
//
// with a and b fitted separately for each phase bucket and for each side to move, and interpolated
// between bucket centres. Whose turn it is belongs in the model: the same lead is worth more to the
// player about to place a lantern. Fit and test are split by whole games, so positions from one
// game never land on both sides.
const fs = require('fs');
const path = require('path');
const { runPool, cores } = require('./pool.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const GAMES_PER_DEPTH = { 3: +arg('games3', 1500), 4: +arg('games4', 1500), 5: +arg('games5', 150) };
const BUCKETS = +arg('buckets', 6);
const THREADS = +arg('threads', Math.max(1, cores - 4));
const CHUNK = +arg('chunk', 20);
const OUT_JSON = arg('out', 'docs/measurements/calibration.json');
const OUT_JS = arg('js', 'src/calibration.js');

const sigmoid = z => 1 / (1 + Math.exp(-z));

// Newton-Raphson on the log-loss for P = sigmoid(a*v + b). Two parameters, so this converges fast.
function fitLogistic(v, y, w) {
  let a = 0.15, b = 0;
  for (let it = 0; it < 60; it++) {
    let g0 = 0, g1 = 0, h00 = 1e-6, h01 = 0, h11 = 1e-6;
    for (let i = 0; i < v.length; i++) {
      const wi = w ? w[i] : 1;
      const p = sigmoid(a * v[i] + b), e = (p - y[i]) * wi, q = p * (1 - p) * wi;
      g0 += e * v[i]; g1 += e;
      h00 += q * v[i] * v[i]; h01 += q * v[i]; h11 += q;
    }
    const det = h00 * h11 - h01 * h01;
    if (!isFinite(det) || Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a -= da; b -= db;
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) break;
  }
  return { a, b };
}

const logLoss = (p, y) => { const e = 1e-9; return -(y * Math.log(Math.max(e, p)) + (1 - y) * Math.log(Math.max(e, 1 - p))); };

function metrics(preds, ys) {
  let ll = 0, brier = 0;
  for (let i = 0; i < preds.length; i++) { ll += logLoss(preds[i], ys[i]); brier += (preds[i] - ys[i]) ** 2; }
  return { n: preds.length, logLoss: +(ll / preds.length).toFixed(5), brier: +(brier / preds.length).toFixed(5) };
}

// How often does "we said 70%" actually come out at 70%?
function reliability(preds, ys, bins = 10) {
  const rows = [];
  for (let k = 0; k < bins; k++) {
    const lo = k / bins, hi = (k + 1) / bins;
    let n = 0, sp = 0, sy = 0;
    for (let i = 0; i < preds.length; i++) if (preds[i] >= lo && (preds[i] < hi || (k === bins - 1 && preds[i] <= 1))) { n++; sp += preds[i]; sy += ys[i]; }
    rows.push({ band: `${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%`, n, said: n ? +(sp / n).toFixed(3) : null, actual: n ? +(sy / n).toFixed(3) : null });
  }
  const gap = rows.filter(r => r.n > 30).reduce((m, r) => Math.max(m, Math.abs(r.said - r.actual)), 0);
  return { rows, worstGapOver30: +gap.toFixed(3) };
}

(async () => {
  const jobs = [];
  for (const [depth, games] of Object.entries(GAMES_PER_DEPTH)) {
    let left = games, part = 0;
    while (left > 0) {
      const n = Math.min(CHUNK, left);
      jobs.push({ depth: +depth, games: n, randomRate: 0.10, openingPlies: 2, swapChance: 0.35, seed: (+depth * 7919 + part * 977 + 11) >>> 0 });
      left -= n; part++;
    }
  }
  const totalGames = jobs.reduce((a, j) => a + j.games, 0);
  console.log(`calibration: ${totalGames} self-play games (${Object.entries(GAMES_PER_DEPTH).map(([d, g]) => `${g} at depth ${d}`).join(', ')}),`);
  console.log(`10% random moves and a 35% chance of a swap, so the meter is fitted on the kind of`);
  console.log(`positions a real game reaches, not only on ones a tidy engine walks into. ${THREADS} threads.`);

  let last = -1;
  const t0 = Date.now();
  const results = await runPool(path.join(__dirname, 'calibWorker.js'), jobs, {
    threads: THREADS,
    onProgress: (d, n, ms) => {
      const pct = Math.floor(100 * d / n / 10) * 10;
      if (pct === last) return; last = pct;
      console.log(`  ${String(pct).padStart(3)}%  ${d}/${n} batches  elapsed ${Math.round(ms / 1000)}s  eta ${Math.round((ms / d * (n - d)) / 1000)}s`);
    },
  });

  // flatten, dropping positions where the search already sees a forced result (the page shows
  // 99%/1% for those and does not consult the model)
  const V = [], PH = [], Y = [], D = [], G = [], GOLD = [];
  let gold = 0, drawn = 0, games = 0, forcedDropped = 0;
  for (const r of results) {
    games += r.games; gold += r.goldWins; drawn += r.draws;
    for (let i = 0; i < r.v.length; i++) {
      if (r.forced[i]) { forcedDropped++; continue; }
      V.push(r.v[i]); PH.push(r.phase[i]); Y.push(r.y[i]); D.push(r.depth); G.push(r.gameOf[i]); GOLD.push(r.gold[i]);
    }
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n${games} games, ${V.length} positions kept (${forcedDropped} dropped as already decided) in ${Math.round(secs)}s`);
  console.log(`gold won ${(100 * gold / games).toFixed(1)}% of these games, ${(100 * drawn / games).toFixed(1)}% drawn`);

  // split by game so no game contributes to both fit and test
  const gameIds = [...new Set(G)];
  const testGame = new Set(gameIds.filter((_, i) => i % 10 < 3));   // 30% held out
  const isTest = G.map(g => testGame.has(g));

  const centres = Array.from({ length: BUCKETS }, (_, k) => (k + 0.5) / BUCKETS);
  const bucketOf = ph => Math.min(BUCKETS - 1, Math.floor(ph * BUCKETS));

  // two sets of coefficients: one for positions where gold is to move, one for turquoise
  const fitted = [[], []];
  for (const side of [0, 1]) {
    for (let k = 0; k < BUCKETS; k++) {
      const v = [], y = [];
      for (let i = 0; i < V.length; i++) if (!isTest[i] && GOLD[i] === side && bucketOf(PH[i]) === k) { v.push(V[i]); y.push(Y[i]); }
      const { a, b } = fitLogistic(v, y);
      fitted[side].push({ phaseFrom: k / BUCKETS, phaseTo: (k + 1) / BUCKETS, centre: centres[k], n: v.length, a: +a.toFixed(5), b: +b.toFixed(5) });
      console.log(`  ${side ? 'gold' : 'turq'} to move, phase ${(100 * k / BUCKETS).toFixed(0)}-${(100 * (k + 1) / BUCKETS).toFixed(0)}%: ${String(v.length).padStart(6)} positions   P = sigmoid(${a.toFixed(4)} * value ${b >= 0 ? '+' : '-'} ${Math.abs(b).toFixed(4)})`);
    }
  }

  // the model the page will run: linear interpolation of (a, b) between bucket centres
  const predict = (v, ph, goldToMove) => {
    const f = fitted[goldToMove ? 1 : 0];
    let k = 0;
    while (k < centres.length - 1 && ph > centres[k + 1]) k++;
    const k2 = Math.min(k + 1, centres.length - 1);
    const span = centres[k2] - centres[k];
    const t = span > 0 ? Math.max(0, Math.min(1, (ph - centres[k]) / span)) : 0;
    return sigmoid((f[k].a + (f[k2].a - f[k].a) * t) * v + (f[k].b + (f[k2].b - f[k].b) * t));
  };

  const testIdx = [];
  for (let i = 0; i < V.length; i++) if (isTest[i]) testIdx.push(i);
  const ys = testIdx.map(i => Y[i]);
  const oldP = testIdx.map(i => sigmoid(V[i] / 7));
  const newP = testIdx.map(i => predict(V[i], PH[i], GOLD[i]));
  const flat = testIdx.map(() => gold / games);

  const before = metrics(oldP, ys), after = metrics(newP, ys), base = metrics(flat, ys);
  const relBefore = reliability(oldP, ys), relAfter = reliability(newP, ys);

  const perDepth = {};
  for (const d of [3, 4, 5]) {
    const idx = testIdx.filter(i => D[i] === d);
    if (!idx.length) continue;
    perDepth[d] = {
      before: metrics(idx.map(i => sigmoid(V[i] / 7)), idx.map(i => Y[i])),
      after: metrics(idx.map(i => predict(V[i], PH[i], GOLD[i])), idx.map(i => Y[i])),
      worstGap: reliability(idx.map(i => predict(V[i], PH[i], GOLD[i])), idx.map(i => Y[i])).worstGapOver30,
    };
  }

  console.log(`\nheld-out positions: ${before.n}`);
  console.log(`  always say ${(100 * gold / games).toFixed(0)}%   log loss ${base.logLoss}   Brier ${base.brier}`);
  console.log(`  1/(1+exp(-v/7))    log loss ${before.logLoss}   Brier ${before.brier}   worst reliability gap ${(100 * relBefore.worstGapOver30).toFixed(1)} points`);
  console.log(`  fitted             log loss ${after.logLoss}   Brier ${after.brier}   worst reliability gap ${(100 * relAfter.worstGapOver30).toFixed(1)} points`);
  console.log('\n  said    actual     n        said    actual     n');
  for (let i = 0; i < relBefore.rows.length; i++) {
    const a = relBefore.rows[i], b = relAfter.rows[i];
    console.log(`  ${String(a.said ?? '-').padStart(5)}   ${String(a.actual ?? '-').padStart(6)}  ${String(a.n).padStart(5)}      ${String(b.said ?? '-').padStart(5)}   ${String(b.actual ?? '-').padStart(6)}  ${String(b.n).padStart(5)}`);
  }
  for (const [d, m] of Object.entries(perDepth)) {
    console.log(`  depth ${d}: log loss ${m.before.logLoss} -> ${m.after.logLoss}, worst gap after ${(100 * m.worstGap).toFixed(1)} points (${m.after.n} positions)`);
  }

  const report = {
    what: 'Win-chance meter fitted against self-play outcomes.',
    how: `node sim/calibrate.js  (${games} games, ${Object.entries(GAMES_PER_DEPTH).map(([d, g]) => `${g} at depth ${d}`).join(', ')}, 10% random moves, 35% swap chance)`,
    date: new Date().toISOString().slice(0, 10),
    positions: V.length, heldOut: before.n, gamesGoldWinRate: gold / games, drawRate: drawn / games,
    model: 'P(gold wins) = sigmoid(a * searchValue + b), with a and b fitted per game phase and per side to move, interpolated between bucket centres',
    buckets: { turquoiseToMove: fitted[0], goldToMove: fitted[1] }, centres,
    heldOutMetrics: { alwaysBaseRate: base, oldFormula: before, fitted: after },
    reliability: { oldFormula: relBefore, fitted: relAfter },
    perSearchDepth: perDepth,
    seconds: Math.round(secs),
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 1));

  const js = `// Win-chance model, fitted against ${games} self-play games (${V.length} positions,
// ${before.n} held out for testing). Generated by sim/calibrate.js on ${report.date};
// do not edit by hand. Full report in docs/measurements/calibration.json.
//
// Held out:  1/(1+exp(-v/7))  log loss ${before.logLoss}, Brier ${before.brier}, worst reliability gap ${(100 * relBefore.worstGapOver30).toFixed(1)} points
//            fitted           log loss ${after.logLoss}, Brier ${after.brier}, worst reliability gap ${(100 * relAfter.worstGapOver30).toFixed(1)} points
window.FawaneesCalibration = {
  measured: true,
  source: '${games} self-play games, ${V.length} positions, fitted per game phase',
  games: ${games},
  positions: ${V.length},
  logLossBefore: ${before.logLoss},
  logLossAfter: ${after.logLoss},
  worstGapAfter: ${+(relAfter.worstGapOver30).toFixed(3)},
  centres: ${JSON.stringify(centres.map(c => +c.toFixed(6)))},
  // [turquoise to move, gold to move]
  a: ${JSON.stringify(fitted.map(f => f.map(x => x.a)))},
  b: ${JSON.stringify(fitted.map(f => f.map(x => x.b)))},
  // value: search value in points from gold's side; phase: lanterns placed / total supply
  prob: function (value, phase, goldToMove) {
    const s = goldToMove ? 1 : 0, c = this.centres;
    let k = 0;
    while (k < c.length - 1 && phase > c[k + 1]) k++;
    const k2 = Math.min(k + 1, c.length - 1);
    const span = c[k2] - c[k];
    const t = span > 0 ? Math.max(0, Math.min(1, (phase - c[k]) / span)) : 0;
    const a = this.a[s][k] + (this.a[s][k2] - this.a[s][k]) * t;
    const b = this.b[s][k] + (this.b[s][k2] - this.b[s][k]) * t;
    return 1 / (1 + Math.exp(-(a * value + b)));
  },
};
`;
  fs.writeFileSync(OUT_JS, js);
  console.log(`\nwritten to ${OUT_JSON} and ${OUT_JS}`);
})().catch(e => { console.error(e); process.exit(1); });

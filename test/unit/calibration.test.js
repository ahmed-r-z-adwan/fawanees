// The win-chance meter is the one number on screen that is a claim about the future, so it gets
// checked hardest: that it was fitted at all, that it behaves sensibly, and that on games it never
// saw it is both better than the formula it replaced and honest about itself.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
function load(file) {
  const w = {};
  new Function('window', fs.readFileSync(path.join(root, file), 'utf8'))(w);
  return w;
}
const CALIB = load('src/calibration.js').FawaneesCalibration;
const report = JSON.parse(fs.readFileSync(path.join(root, 'docs/measurements/calibration.json'), 'utf8'));

test('the shipped model says it was measured, and by how much', () => {
  assert.strictEqual(CALIB.measured, true, 'run `node sim/calibrate.js` before shipping');
  assert.ok(CALIB.games >= 1000, `fitted on ${CALIB.games} games`);
  assert.ok(CALIB.positions >= 50000, `fitted on ${CALIB.positions} positions`);
  assert.strictEqual(CALIB.a.length, 2, 'one set of coefficients per side to move');
  assert.strictEqual(CALIB.b.length, 2);
  assert.strictEqual(CALIB.a[0].length, CALIB.centres.length);
});

test('more of a lead always means a better chance', () => {
  for (const gold of [true, false]) {
    for (const phase of [0.02, 0.2, 0.5, 0.8, 0.99]) {
      let prev = -1;
      for (let v = -40; v <= 40; v += 2) {
        const p = CALIB.prob(v, phase, gold);
        assert.ok(p > prev, `not monotone at value ${v}, phase ${phase}, gold to move ${gold}`);
        assert.ok(p > 0 && p < 1, `probability out of range: ${p}`);
        prev = p;
      }
    }
  }
});

test('a lead is worth more the later it appears', () => {
  // Ten points ahead on move three says much less than ten points ahead near the end.
  const early = CALIB.prob(10, 0.1, true);
  const late = CALIB.prob(10, 0.9, true);
  assert.ok(late > early, `ten points should mean more late (${late.toFixed(3)}) than early (${early.toFixed(3)})`);
});

test('a level position reads as close to level', () => {
  for (const phase of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const gold of [true, false]) {
      const p = CALIB.prob(0, phase, gold);
      assert.ok(p > 0.25 && p < 0.75, `an even position at phase ${phase} reads ${(100 * p).toFixed(0)}%`);
    }
  }
});

test('on games it never saw, the fit beats the formula it replaced', () => {
  const before = report.heldOutMetrics.oldFormula;
  const after = report.heldOutMetrics.fitted;
  const base = report.heldOutMetrics.alwaysBaseRate;
  assert.ok(after.n >= 10000, `held out ${after.n} positions`);
  assert.ok(after.logLoss < before.logLoss, `log loss ${after.logLoss} should beat ${before.logLoss}`);
  assert.ok(after.brier < before.brier, `Brier ${after.brier} should beat ${before.brier}`);
  assert.ok(after.logLoss < base.logLoss, 'and should beat always saying the base rate');
});

test('when it says seventy per cent, it happens about seventy per cent of the time', () => {
  const rel = report.reliability.fitted;
  assert.ok(rel.worstGapOver30 <= 0.10,
    `worst reliability gap is ${(100 * rel.worstGapOver30).toFixed(1)} points`);
  // and it should be a real improvement on the old shape
  assert.ok(rel.worstGapOver30 < report.reliability.oldFormula.worstGapOver30,
    'the fitted model should be better calibrated than the old formula');
});

test('it holds up at every search depth the page actually uses', (t) => {
  for (const [depth, m] of Object.entries(report.perSearchDepth)) {
    assert.ok(m.after.logLoss < m.before.logLoss,
      `at depth ${depth} the fit (${m.after.logLoss}) should beat the old formula (${m.before.logLoss})`);
    // The reliability gap needs a decent sample to mean anything: it is the worst of ten bins, and
    // with a few hundred positions the worst bin is mostly noise. Depth 5 games are expensive, so
    // that depth has far fewer, and its gap is reported but not asserted on.
    if (m.after.n >= 3000) {
      assert.ok(m.worstGap <= 0.12, `at depth ${depth} the worst reliability gap is ${(100 * m.worstGap).toFixed(1)} points over ${m.after.n} positions`);
    } else {
      t.diagnostic(`depth ${depth}: only ${m.after.n} held-out positions, gap ${(100 * m.worstGap).toFixed(1)} points, too few to hold to a threshold`);
    }
  }
});

test('the numbers the page quotes are the numbers in the report', () => {
  // The page shows these in "How was it made?", so they must not drift from the study.
  assert.strictEqual(CALIB.logLossBefore, report.heldOutMetrics.oldFormula.logLoss);
  assert.strictEqual(CALIB.logLossAfter, report.heldOutMetrics.fitted.logLoss);
  assert.strictEqual(CALIB.positions, report.positions);
  assert.strictEqual(CALIB.worstGapAfter, report.reliability.fitted.worstGapOver30);
});

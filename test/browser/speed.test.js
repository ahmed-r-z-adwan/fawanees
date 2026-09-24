// The machine has to answer quickly enough on a phone, and the page has to stay responsive while
// it does. Both are checked under CPU throttling.
//
// One caveat the numbers depend on: Chrome will not apply CPU throttling to a worker target
// ("Operation is only supported for pages, not workers"), so with the search on a worker the
// throttling reaches the page but not the search. The honest phone measurement is therefore the
// main-thread fallback, where the throttling does apply -- and that is also the slower of the two
// paths, so it is the right one to hold to a deadline.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { perf } = require('../tools/perf.js');
const { measure } = require('../tools/freeze.js');

// Run these one at a time: `npm run test:browser` passes --test-concurrency=1. Several headless
// Chromium instances sharing the CPU make a timing measurement meaningless, and this file is the
// one that would silently start reporting whatever the machine happened to be doing.
const DIST = path.join(__dirname, '..', '..', 'dist', 'fawanees.html');
const THROTTLE = 4;
const MASTER = 2;

test('Master answers in under 1.5 s on a phone-class core', async (t) => {
  const r = await perf(DIST, { throttle: THROTTLE, moves: 6, levels: [MASTER], local: true });
  const L = r.levels[MASTER];
  t.diagnostic(`${r.mode} mode, ${THROTTLE}x throttled: budget ${L.budgetMs} ms, median ${L.medianMs} ms, ` +
               `p90 ${L.p90Ms} ms, max ${L.maxMs} ms, depth ${L.avgDepth}, ${L.nodesPerSec} nodes/s`);

  // the throttling has to have actually reached the search, or this test is measuring nothing
  assert.ok(L.nodesPerSec < 350000, `expected a slowed core, saw ${L.nodesPerSec} nodes/s -- throttling did not apply`);
  assert.ok(L.maxMs < 1500, `Master must answer in under 1.5 s; worst was ${L.maxMs} ms`);
  assert.ok(L.avgDepth >= 3, `and still search properly; reached depth ${L.avgDepth}`);
  assert.deepStrictEqual(r.errors, []);
});

test('every level keeps to its time budget', async (t) => {
  const r = await perf(DIST, { throttle: 1, moves: 6 });
  for (const k of Object.keys(r.levels)) {
    const L = r.levels[k];
    t.diagnostic(`${L.name}: budget ${L.budgetMs} ms, median ${L.medianMs} ms, max ${L.maxMs} ms, depth ${L.avgDepth}`);
    // The claim is that the engine honours its budget, and the median says that: iterative
    // deepening checks the clock every 1024 nodes, so a few ms of overshoot is inherent.
    assert.ok(L.medianMs <= L.budgetMs + 100,
      `${L.name} typically overran its ${L.budgetMs} ms budget: median ${L.medianMs} ms`);
    // The worst case also includes time the engine does not control -- the browser scheduling the
    // callback back to the page while other things run on the machine. Bounding it proportionally
    // still catches a runaway search without turning a busy laptop into a test failure.
    const ceiling = Math.round(L.budgetMs * 1.2 + 200);
    assert.ok(L.maxMs <= ceiling, `${L.name} overran badly: ${L.maxMs} ms against a ${ceiling} ms ceiling`);
  }
  assert.deepStrictEqual(r.errors, []);
});

test('the page still does not freeze on a throttled phone', async (t) => {
  const r = await measure(DIST, { throttle: THROTTLE, moves: 4, level: MASTER });
  t.diagnostic(`${r.mode} mode, ${THROTTLE}x throttled: worst long task ${r.worstLongTaskMs} ms, ` +
               `${r.totalBlockedMs} ms blocked over ${r.turns} turns, ${r.framesPerTurn} frames/turn`);
  assert.ok(r.worstLongTaskMs < 250, `worst long task ${r.worstLongTaskMs} ms`);
  assert.ok(r.framesPerTurn >= 5, `the page should keep painting, saw ${r.framesPerTurn} frames a turn`);
});

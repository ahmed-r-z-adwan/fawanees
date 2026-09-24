// How long the machine takes to answer, on a phone-class device.
//
//   node test/tools/perf.js [page] [--throttle 4] [--moves 8] [--json]
//
// Headless Chromium with CPU throttling, which is the usual stand-in for a mid-range phone:
// the renderer (and the worker it owns) is slowed by the given factor. Positions are taken from
// a real game played by the page itself, so the measurement covers the opening, the crowded
// middle and the thin endgame rather than one convenient position.
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('./serve.js');

const LEVEL_NAMES = ['Novice', 'Skilled', 'Master', 'Oracle'];

async function perf(file, { throttle = 4, moves = 8, levels = [0, 1, 2, 3], local = false, budgets = null } = {}) {
  const dir = path.dirname(path.resolve(file));
  const server = await serve(dir);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${server.url}/${path.basename(file)}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game', { timeout: 60000 });
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 30000 });
    if (local) await page.evaluate(() => window.__fw.forceLocalAI());
    if (budgets) await page.evaluate(b => b.forEach((ms, i) => { if (ms) window.__fw.setLevelMs(i, ms); }), budgets);

    const client = await page.createCDPSession();
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });

    const out = { page: path.basename(file), throttle, mode: await page.evaluate(() => window.__fw.aiMode), levels: {} };
    for (const lv of levels) {
      const r = await page.evaluate(async ({ lv, moves }) => {
        const fw = window.__fw;
        const { ms, depth } = fw.levels[lv];
        fw.newGame({ mode: 'pvp' });              // no automatic machine turns: we drive the searches
        const g = fw.game;
        const rand = (n) => Math.floor(Math.random() * n);
        const runs = [];
        for (let k = 0; k < moves; k++) {
          const L = g.legal();
          if (!L.length) break;
          const t0 = performance.now();
          const res = await fw.think(g.toMove, ms, depth).promise;
          runs.push({ wall: performance.now() - t0, depth: res.depth, nodes: res.nodes });
          // step the position forward so the next search sees a different board
          g.play(res.move >= 0 ? res.move : L[rand(L.length)]);
          const L2 = g.legal();
          if (L2.length) g.play(L2[rand(L2.length)]);
        }
        return { budgetMs: ms, runs };
      }, { lv, moves });

      const walls = r.runs.map(x => x.wall).sort((a, b) => a - b);
      const pick = q => walls.length ? Math.round(walls[Math.min(walls.length - 1, Math.floor(q * walls.length))]) : 0;
      out.levels[lv] = {
        name: LEVEL_NAMES[lv], budgetMs: r.budgetMs, searches: walls.length,
        medianMs: pick(0.5), p90Ms: pick(0.9), maxMs: Math.round(Math.max(0, ...walls)),
        avgDepth: +(r.runs.reduce((a, x) => a + x.depth, 0) / Math.max(1, r.runs.length)).toFixed(1),
        avgNodes: Math.round(r.runs.reduce((a, x) => a + x.nodes, 0) / Math.max(1, r.runs.length)),
      };
    }
    out.errors = errors;
    return out;
  } finally {
    await browser.close();
    await server.close();
  }
}

module.exports = { perf, LEVEL_NAMES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0] && !args[0].startsWith('--') ? args[0] : 'dist/fawanees.html';
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const budgets = opt('budgets', null);
  perf(file, {
    throttle: +opt('throttle', 4), moves: +opt('moves', 8), local: args.includes('--local'),
    budgets: budgets ? budgets.split(',').map(Number) : null,
  }).then(r => {
    if (args.includes('--json')) { console.log(JSON.stringify(r, null, 1)); return; }
    console.log(`${r.page}, ${r.mode} mode, CPU throttled ${r.throttle}x, ${r.levels[0] ? r.levels[0].searches : 0} searches per level`);
    console.log('level      budget   median     p90      max   depth      nodes');
    for (const k of Object.keys(r.levels)) {
      const L = r.levels[k];
      console.log(`${L.name.padEnd(9)}  ${String(L.budgetMs).padStart(5)}ms  ${String(L.medianMs).padStart(5)}ms  ${String(L.p90Ms).padStart(5)}ms  ${String(L.maxMs).padStart(5)}ms   ${String(L.avgDepth).padStart(5)}  ${String(L.avgNodes).padStart(9)}`);
    }
    if (r.errors.length) console.log('page errors:', r.errors);
  }).catch(e => { console.error(e); process.exit(1); });
}

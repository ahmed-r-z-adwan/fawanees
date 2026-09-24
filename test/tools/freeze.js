// Measures how long the page's main thread is blocked while the machine takes its turn.
//
//   node test/tools/freeze.js <page.html> [--throttle N] [--label name]
//
// It drives the page as a player would (click a cell, let the machine answer) and records
// every long task the browser reports, plus how many animation frames the page managed to
// paint while the machine was thinking. A page that freezes shows one long task the length
// of the whole search and almost no frames.
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('./serve.js');

const INSTRUMENT = `
  window.__longTasks = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longTasks.push(Math.round(e.duration)); })
    .observe({ entryTypes: ['longtask'] }); } catch (e) {}
  window.__frames = 0;
  (function beat() { window.__frames++; requestAnimationFrame(beat); })();
`;

async function measure(file, { throttle = 1, moves = 4, level = 2, local = false } = {}) {
  const dir = path.dirname(path.resolve(file));
  const server = await serve(dir);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(INSTRUMENT);
    const client = await page.createCDPSession();
    if (throttle > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(`${server.url}/${path.basename(file)}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game', { timeout: 30000 });
    if (local) { await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 20000 }); await page.evaluate(() => window.__fw.forceLocalAI()); }
    await page.evaluate(l => { const d = document.querySelector('dialog[open]'); if (d) d.close(); window.__fw.newGame({ mode: 'ai', level: l, human: 1 }); }, level);
    await page.waitForFunction('!window.__fw.busy', { timeout: 60000 });

    // Drive the page the way a player does: click a cell on the canvas, then let the machine answer.
    // Clicking (rather than calling into the app) is what lets the same script measure the old build.
    const box = await (await page.$('#board')).boundingBox();
    const runs = [];
    for (let n = 0; n < moves; n++) {
      const cell = await page.evaluate(() => {
        const L = window.__fw.game.legal();
        return L.length ? L[Math.floor(L.length / 3)] : -1;
      });
      if (cell < 0) break;
      const [cxp, cyp] = await page.evaluate(i => window.__fw.px(i), cell);
      const x = box.x + cxp, y = box.y + cyp;
      const before = await page.evaluate(() => window.__fw.game.history.length);
      await page.evaluate(() => { window.__mark = { frames: window.__frames, tasks: window.__longTasks.length, t: performance.now() }; });
      await page.mouse.move(x, y);
      await page.mouse.click(x, y);
      if (await page.evaluate(b => window.__fw.game.history.length === b, before)) await page.mouse.click(x, y);
      try {
        await page.waitForFunction(
          b => window.__fw.game.over || (!window.__fw.busy && window.__fw.game.history.length >= b + 2),
          { timeout: 90000 }, before);
      } catch (e) { break; }
      const r = await page.evaluate(() => ({
        wall: performance.now() - window.__mark.t,
        frames: window.__frames - window.__mark.frames,
        tasks: window.__longTasks.slice(window.__mark.tasks),
      }));
      runs.push(r);
      if (await page.evaluate(() => window.__fw.game.over)) break;
    }
    const allTasks = runs.flatMap(r => r.tasks);
    return {
      mode: await page.evaluate(() => (window.__fw.aiMode || 'legacy-main-thread')),
      turns: runs.length,
      worstLongTaskMs: allTasks.length ? Math.max(...allTasks) : 0,
      totalBlockedMs: allTasks.reduce((a, b) => a + b, 0),
      longTaskCount: allTasks.length,
      framesPerTurn: runs.length ? Math.round(runs.reduce((a, r) => a + r.frames, 0) / runs.length) : 0,
      msPerTurn: runs.length ? Math.round(runs.reduce((a, r) => a + r.wall, 0) / runs.length) : 0,
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

module.exports = { measure };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0];
  const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
  measure(file, { throttle: +opt('throttle', 1), moves: +opt('moves', 4), level: +opt('level', 2), local: args.includes('--local') })
    .then(r => console.log(JSON.stringify({ label: opt('label', path.basename(file)), throttle: +opt('throttle', 1), ...r })))
    .catch(e => { console.error(e); process.exit(1); });
}

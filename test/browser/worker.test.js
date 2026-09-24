// The AI must never freeze the page, in both of the ways the page can run a search:
// on a worker thread (normal hosting) and on the main thread in slices (single file from disk).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const FILE_URL = 'file://' + path.join(DIST, 'fawanees.html').replace(/\\/g, '/');

// Installs a long-task observer plus a rAF heartbeat, so we can tell whether the page kept
// painting while the machine was thinking.
const INSTRUMENT = `
  window.__longTasks = [];
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longTasks.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) { window.__longTasksUnsupported = true; }
  window.__frames = 0;
  (function beat() { window.__frames++; requestAnimationFrame(beat); })();
`;

async function open(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.evaluateOnNewDocument(INSTRUMENT);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__fw && window.__fw.game');
  await page.evaluate(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); });
  return { page, errors };
}

// Runs one machine search and reports what the page managed to do while it ran.
async function measureSearch(page, ms) {
  return page.evaluate(async (ms) => {
    const fw = window.__fw;
    // a few lanterns down so the search has something to chew on
    const g = fw.game;
    for (const cell of [20, 45, 61, 33, 70, 12]) if (g.board[cell] === 0) g.play(cell);
    const frames0 = window.__frames, tasks0 = window.__longTasks.length;
    const depths = [];
    const t0 = performance.now();
    const res = await fw.think(g.toMove, ms, 64, d => depths.push({ depth: d.depth, cands: d.scores.length, pv: d.pv.length })).promise;
    return {
      wall: performance.now() - t0,
      frames: window.__frames - frames0,
      longTasks: window.__longTasks.slice(tasks0),
      longTasksUnsupported: !!window.__longTasksUnsupported,
      depths, move: res.move, finalDepth: res.depth, nodes: res.nodes,
      mode: fw.aiMode,
    };
  }, ms);
}

test('AI search over http: runs in a worker, streams every depth, keeps the page painting', async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(browser, server.url + '/fawanees.html');
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 10000 });
    assert.strictEqual(await page.evaluate(() => window.__fw.aiMode), 'worker', 'should use a worker when served over http');

    const r = await measureSearch(page, 1200);
    t.diagnostic(`worker: ${r.depths.length} depths streamed (to ${r.finalDepth}), ${r.nodes} nodes, ${r.frames} frames in ${Math.round(r.wall)}ms, long tasks ${JSON.stringify(r.longTasks)}`);

    assert.ok(r.depths.length >= 2, `expected several streamed depths, got ${r.depths.length}`);
    assert.ok(r.depths.every(d => d.cands > 0), 'every streamed depth should carry candidate scores');
    assert.ok(r.depths.some(d => d.pv > 0), 'streamed depths should carry a principal variation');
    assert.ok(r.move >= 0, 'should pick a move');
    // 1.2s of searching on another thread: the page should have painted many frames.
    assert.ok(r.frames >= 20, `page should keep painting while the worker searches, saw ${r.frames} frames`);
    const worst = Math.max(0, ...r.longTasks);
    assert.ok(worst < 250, `main thread should not block; worst long task ${worst}ms`);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('AI search on the main-thread fallback: still streams depths and still never freezes', async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(browser, server.url + '/fawanees.html');
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 10000 });
    await page.evaluate(() => window.__fw.forceLocalAI());
    assert.strictEqual(await page.evaluate(() => window.__fw.aiMode), 'local');

    const r = await measureSearch(page, 1200);
    t.diagnostic(`fallback: ${r.depths.length} depths streamed (to ${r.finalDepth}), ${r.nodes} nodes, ${r.frames} frames in ${Math.round(r.wall)}ms, long tasks ${JSON.stringify(r.longTasks)}`);

    assert.ok(r.depths.length >= 2, `expected several streamed depths, got ${r.depths.length}`);
    assert.ok(r.move >= 0);
    assert.ok(r.frames >= 10, `page should keep painting during the sliced search, saw ${r.frames} frames`);
    const worst = Math.max(0, ...r.longTasks);
    assert.ok(worst < 250, `sliced search should not block the thread; worst long task ${worst}ms`);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('single file opened straight from disk still plays', async (t) => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(browser, FILE_URL);
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 15000 });
    const mode = await page.evaluate(() => window.__fw.aiMode);
    const why = await page.evaluate(() => window.__fw.fallbackReason);
    t.diagnostic(`file:// mode = ${mode}${why ? ' (' + why + ')' : ''}`);
    const r = await measureSearch(page, 800);
    assert.ok(r.move >= 0, 'the machine must still answer from a file:// page');
    assert.ok(r.depths.length >= 1);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});

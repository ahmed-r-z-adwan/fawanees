// Puzzle mode in the browser: a wrong cell is rejected with a real reason, the right cell plays
// the chain, and it all works on a phone-sized screen.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');

const DIST = path.join(__dirname, '..', '..', 'dist');

test('puzzle mode: wrong cells are refused with a measured reason, the answer plays the chain', async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(server.url + '/fawanees.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game');
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });

    const count = await page.evaluate(() => window.__fw.puzzles().count);
    assert.ok(count >= 8, `expected a decent puzzle set, got ${count}`);

    for (const n of [0, 1, Math.floor(count / 2), count - 1]) {
      await page.evaluate(i => window.__fw.puzzles().open(i), n);
      assert.strictEqual(await page.evaluate(() => window.__fw.puzzles().stage), 'task');
      const box = await (await page.$('#puzzleBoard')).boundingBox();
      const [ax, ay] = await page.evaluate(() => window.__fw.puzzles().answerXY());

      // a cell that is not the answer must not solve it
      await page.mouse.click(box.x + Math.max(6, ax - box.width * 0.25), box.y + ay);
      assert.strictEqual(await page.evaluate(() => window.__fw.puzzles().stage), 'task',
        `puzzle ${n + 1}: a wrong cell must not count as solved`);

      await page.mouse.click(box.x + ax, box.y + ay);
      assert.strictEqual(await page.evaluate(() => window.__fw.puzzles().stage), 'result',
        `puzzle ${n + 1}: the answer should solve it`);

      const shown = await page.evaluate(() => document.getElementById('puzzleBody').innerText);
      const pz = await page.evaluate(() => { const p = window.__fw.puzzles().current(); return { flips: p.flips, swing: p.swing, margin: p.margin, difficulty: p.difficulty, waves: p.waves.length }; });
      for (const claim of [pz.flips, pz.swing, pz.margin, pz.difficulty]) {
        assert.ok(new RegExp(`\\b${claim}\\b`).test(shown), `puzzle ${n + 1}: the result should quote the measured ${claim}; got "${shown.replace(/\n/g, ' | ')}"`);
      }
      t.diagnostic(`puzzle ${n + 1}: ${pz.flips} flipped in ${pz.waves} waves, ${pz.swing} points, found at depth ${pz.difficulty}`);
    }
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

test('the hint reveals the answer cell without solving it, and the second press gives it away', async () => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(server.url + '/fawanees.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game');
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
    await page.evaluate(() => window.__fw.puzzles().open(0));
    await page.click('#puzzleHint');
    assert.strictEqual(await page.evaluate(() => window.__fw.puzzles().stage), 'task', 'one hint does not solve it');
    const hinted = await page.evaluate(() => document.getElementById('puzzleBody').innerText);
    const flips = await page.evaluate(() => window.__fw.puzzles().current().flips);
    assert.ok(new RegExp(`\\b${flips}\\b`).test(hinted), 'the hint says how many lanterns the answer flips');
    await page.click('#puzzleHint');
    assert.strictEqual(await page.evaluate(() => window.__fw.puzzles().stage), 'result', 'the second press shows the answer');
  } finally { await browser.close(); await server.close(); }
});

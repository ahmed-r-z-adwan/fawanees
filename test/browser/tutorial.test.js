// Plays the whole tutorial the way a learner does: click the marked cell in every lesson,
// read what the page says afterwards, and check it against what the engine actually did.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');
const LS = require('../../src/lessons.js');

const DIST = path.join(__dirname, '..', '..', 'dist');

async function openPage(browser, url, viewport) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__fw && window.__fw.game');
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
  return { page, errors };
}

// Re-measure before every click. A stale box silently clicks the wrong cell, and the test would
// then be asserting nothing -- which is how a dialog that resized on feedback stayed hidden.
async function boardBox(page) { return (await page.$('#learnBoard')).boundingBox(); }
async function clickTarget(page) {
  const box = await boardBox(page);
  const [x, y] = await page.evaluate(() => window.__fw.tutorial().targetXY());
  await page.mouse.click(box.x + x, box.y + y);
}

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }]]) {
  test(`tutorial plays end to end on ${label}, and every number it shows is the engine's`, async (t) => {
    const server = await serve(DIST);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const { page, errors } = await openPage(browser, server.url + '/fawanees.html', viewport);
      await page.evaluate(() => window.__fw.tutorial().open(0));
      assert.ok(await page.evaluate(() => document.getElementById('dlgLearn').open), 'the tutorial dialog should open');

      for (let i = 0; i < LS.LESSONS.length; i++) {
        const lesson = LS.LESSONS[i];
        const m = LS.verify(lesson);   // engine truth for this lesson

        assert.strictEqual(await page.evaluate(() => window.__fw.tutorial().lessonId), lesson.id);
        assert.strictEqual(await page.evaluate(() => window.__fw.tutorial().stage), 'task');

        // A wrong cell must not advance the lesson.
        const box = await boardBox(page);
        const [tx, ty] = await page.evaluate(() => window.__fw.tutorial().targetXY());
        await page.mouse.click(box.x + Math.max(6, tx - box.width * 0.30), box.y + ty);
        assert.strictEqual(await page.evaluate(() => window.__fw.tutorial().stage), 'task',
          `${lesson.id}: clicking the wrong cell must not finish the lesson`);

        // and showing that feedback must not have moved the board
        const after = await boardBox(page);
        assert.deepStrictEqual([after.x, after.y, after.width, after.height],
          [box.x, box.y, box.width, box.height],
          `${lesson.id}: the board moved when the wrong-cell message appeared`);

        await clickTarget(page);
        assert.strictEqual(await page.evaluate(() => window.__fw.tutorial().stage), 'result',
          `${lesson.id}: clicking the marked cell should finish the lesson`);

        const shown = await page.evaluate(() => document.getElementById('learnBody').innerText);
        // Every number the lesson prints has to be a number the engine produced for this position.
        const allowed = new Set([
          m.flipped, m.before.lit[m.mover], m.before.lit[m.other], m.atPlacement.lit[m.mover],
          m.end.lit[m.mover], m.end.lit[m.other],
          m.before.score[m.mover], m.before.score[m.other], m.end.score[m.mover], m.end.score[m.other],
          m.end.score[m.mover] - m.before.score[m.mover],
        ].map(Number));
        for (const k of (lesson.watch || []).concat(['0,0', '0,2'])) {
          if (!m.geo.index.has(k)) continue;
          for (const snapName of ['before', 'atPlacement', 'midChain', 'end']) {
            m.sightAt(m[snapName], k).forEach(v => allowed.add(v));
            m.lightAt(m[snapName], k).forEach(v => allowed.add(v));
          }
        }
        const printed = (shown.match(/\d+/g) || []).map(Number);
        assert.ok(printed.length > 0, `${lesson.id}: the result should quote measured numbers`);
        for (const n of printed) {
          assert.ok(allowed.has(n), `${lesson.id}: printed "${n}" but the engine never produced it here (allowed: ${[...allowed].sort((a, b) => a - b).join(',')})`);
        }
        t.diagnostic(`${lesson.id}: ${printed.length} measured numbers shown, waves ${JSON.stringify(m.wavesKeys)}`);

        if (i < LS.LESSONS.length - 1) await page.click('#learnNext');
      }

      await page.click('#learnNext');
      assert.ok(!(await page.evaluate(() => document.getElementById('dlgLearn').open)), 'the last lesson should close the tutorial');
      assert.deepStrictEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  });
}

test('the chain lesson is the verified example from CLAUDE.md', () => {
  const chain = LS.LESSONS.find(l => l.id === 'chain');
  const m = LS.verify(chain);
  assert.deepStrictEqual(m.wavesKeys, [['0,0'], ['0,2']]);
  assert.deepStrictEqual(m.sightAt(m.before, '0,0'), [2, 1]);
  assert.deepStrictEqual(m.sightAt(m.before, '0,2'), [1, 1]);
  assert.deepStrictEqual(m.sightAt(m.atPlacement, '0,0'), [3, 1]);
  assert.deepStrictEqual(m.sightAt(m.atPlacement, '0,2'), [2, 1]);
  assert.deepStrictEqual(m.sightAt(m.midChain, '0,2'), [3, 0]);
});

test('the protection lesson is the verified 3-against-3 example', () => {
  const p = LS.verify(LS.LESSONS.find(l => l.id === 'protect'));
  assert.deepStrictEqual(p.sightAt(p.atPlacement, '0,0'), [3, 3], 'three enemy and three friendly lanterns see it');
  assert.deepStrictEqual(p.wavesKeys, [], 'and it does not switch');
  // the same gold move on the same cell, without the guards, does capture
  const c = LS.verify(LS.LESSONS.find(l => l.id === 'capture'));
  assert.strictEqual(c.geo.cells[c.target].q + ',' + c.geo.cells[c.target].r, '-2,2');
  assert.deepStrictEqual(c.wavesKeys, [['0,0']]);
});

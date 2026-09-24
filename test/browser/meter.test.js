// The win-chance meter must not invent a number. Before anything has evaluated the position it
// shows a dash; once a search has run it shows the fitted probability, and the two players' figures
// add to 100.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');
const { noFonts, isPageError } = require('../tools/nofonts.js');

const DIST = path.join(__dirname, '..', '..', 'dist');

async function open(browser) {
  const page = await browser.newPage();
  await noFonts(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (isPageError(m)) errors.push('console: ' + m.text()); });
  return { page, errors };
}

test('the meter shows a dash until something has actually evaluated the position', async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(browser);
    // Freeze the page before its own scripts run, so we can look at the meter's initial state.
    await page.goto(server.url + '/fawanees.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game');
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });

    // A brand new game in two-player mode: nothing has searched anything yet.
    const fresh = await page.evaluate(() => {
      window.__fw.newGame({ mode: 'pvp' });
      return { text: document.getElementById('meter1').textContent, dim: document.querySelector('.meter').classList.contains('unknown') };
    });
    t.diagnostic(`before any evaluation: "${fresh.text}"`);
    assert.match(fresh.text, /—/, 'the meter should show a dash, not a number, before anything is measured');
    assert.ok(fresh.dim, 'and the bar should be dimmed');

    // Once a search has run, it shows a real figure.
    await page.evaluate(async () => {
      const fw = window.__fw;
      fw.game.play(fw.game.legal()[20]);
      await fw.think(fw.game.toMove, 400, 64).promise;
    });
    await page.waitForFunction("!document.getElementById('meter1').textContent.includes('—')", { timeout: 20000 });
    const shown = await page.evaluate(() => ({
      one: document.getElementById('meter1').textContent,
      two: document.getElementById('meter2').textContent,
      width: document.getElementById('meterFill').style.width,
      dim: document.querySelector('.meter').classList.contains('unknown'),
    }));
    t.diagnostic(`after a search: "${shown.one}" / "${shown.two}", bar ${shown.width}`);
    assert.ok(!shown.dim, 'the bar should no longer be dimmed');
    const a = +(shown.one.match(/(\d+)/) || [])[1];
    const b = +(shown.two.match(/(\d+)/) || [])[1];
    assert.ok(Number.isFinite(a) && Number.isFinite(b), 'both sides should show a percentage');
    assert.strictEqual(a + b, 100, `the two figures should add to 100, got ${a} and ${b}`);
    assert.ok(Math.abs(parseFloat(shown.width) - a) < 1.5, 'the bar should match the figure');
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

test('"How was it made?" quotes the calibration it actually shipped', async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(browser);
    await page.goto(server.url + '/fawanees.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game');
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 20000 });
    await page.click('#linkHow');
    const said = await page.evaluate(() => ({
      calib: document.getElementById('howCalib').textContent,
      body: document.getElementById('howBody').innerText,
      model: { games: window.FawaneesCalibration.games, before: window.FawaneesCalibration.logLossBefore, after: window.FawaneesCalibration.logLossAfter },
      opening: { best: window.FawaneesOpening.noSwapBest, avg: window.FawaneesOpening.noSwapAverage, centre: window.FawaneesOpening.noSwapCentre, withSwap: window.FawaneesOpening.openerWinRate },
    }));
    t.diagnostic(said.calib);

    assert.ok(said.calib.length > 0, 'it should say how the meter was calibrated');
    for (const n of [said.model.games, said.model.before, said.model.after]) {
      assert.ok(said.calib.includes(String(n)), `the calibration note should quote ${n}`);
    }
    // the opening figures in the body must be the ones in the shipped policy
    for (const v of Object.values(said.opening)) {
      assert.ok(said.body.includes(String(Math.round(100 * v))), `the text should quote ${Math.round(100 * v)}%`);
    }
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

// A whole game, played by clicking the board on a phone-sized screen, start to finish,
// with no console errors and nothing left inconsistent at the end.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');
const { noFonts, isPageError } = require('../tools/nofonts.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

async function playFullGame(t, { level, local, motion = 'reduce' }) {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await noFonts(page);
    await page.setViewport(PHONE);
    // One variant runs with reduced motion so it is quick; one runs with the default, because that
    // is the path every real player takes and it is where the animation races live.
    if (motion === 'reduce') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e));
    page.on('console', m => { if (isPageError(m)) errors.push('console: ' + m.text()); });
    page.on('requestfailed', r => errors.push('request failed: ' + r.url()));

    await page.goto(server.url + '/fawanees.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game', { timeout: 30000 });
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 20000 });
    if (local) await page.evaluate(() => window.__fw.forceLocalAI());

    // no horizontal scrolling on a phone. Wait for the webfont first: the header wraps differently
    // in the fallback font, and measuring before it settles made this assertion flake.
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `the page should fit a 390px screen, overflows by ${overflow}px`);

    await page.evaluate(l => window.__fw.newGame({ mode: 'ai', level: l, human: 1 }), level);
    await page.waitForFunction('!window.__fw.busy', { timeout: 30000 });

    const box = await (await page.$('#board')).boundingBox();
    let turns = 0, passes = 0;
    while (turns < 120) {
      const state = await page.evaluate(() => ({ over: window.__fw.game.over, mine: window.__fw.game.toMove, legal: window.__fw.game.legal().length }));
      if (state.over) break;
      if (state.mine !== 1) { await page.waitForFunction('!window.__fw.busy || window.__fw.game.over', { timeout: 60000 }); continue; }

      const before = await page.evaluate(() => window.__fw.game.history.length);
      if (state.legal === 0) { await page.click('#btnPass'); passes++; }
      else {
        // legal() can empty between the state read above and here; pick inside one evaluate and
        // say so with an assertion rather than dying on undefined.
        const cell = await page.evaluate(() => { const L = window.__fw.game.legal(); return L.length ? L[Math.floor(L.length / 2)] : -1; });
        if (cell < 0) continue;
        const [cx, cy] = await page.evaluate(i => window.__fw.px(i), cell);
        await page.mouse.move(box.x + cx, box.y + cy);
        await page.mouse.click(box.x + cx, box.y + cy);
        if (await page.evaluate(b => window.__fw.game.history.length === b, before)) await page.mouse.click(box.x + cx, box.y + cy);
      }
      await page.waitForFunction(b => window.__fw.game.over || window.__fw.game.history.length > b, { timeout: 60000 }, before);
      await page.waitForFunction('!window.__fw.busy || window.__fw.game.over', { timeout: 60000 });
      turns++;
    }

    // the page shows the result a beat after the last move settles
    await page.waitForSelector('#dlgOver[open]', { timeout: 20000 });
    const end = await page.evaluate(() => {
      const g = window.__fw.game, [a, b] = g.score();
      return {
        over: g.over, moves: g.history.length, a, b,
        hands: Array.from(g.hands),
        onBoard: Array.from(g.board).filter(v => v).length,
        shown1: document.getElementById('pts1').textContent,
        shown2: document.getElementById('pts2').textContent,
        dialogOpen: !!document.querySelector('#dlgOver[open]'),
        overText: document.getElementById('overBody').innerText,
        meter: document.getElementById('meter1').textContent,
      };
    });
    t.diagnostic(`level ${level}${local ? ' (main-thread fallback)' : ''}: ${end.moves} moves, gold ${end.a} turquoise ${end.b}, hands ${end.hands.slice(1)}, ${passes} passes by the human`);

    assert.strictEqual(end.over, true, 'the game should have ended on its own');
    assert.strictEqual(end.shown1, String(end.a), 'the panel should show the engine score');
    assert.strictEqual(end.shown2, String(end.b));
    assert.ok(end.dialogOpen, 'the game-over dialog should be showing');
    assert.match(end.overText, /\d/, 'and should report the final score');
    assert.ok(end.a + end.b > 0);
    // lanterns are conserved: nobody placed one they did not have
    assert.ok(end.hands[1] >= 0 && end.hands[2] >= 0, `a hand went negative: ${end.hands}`);
    assert.strictEqual(end.hands[1] + end.hands[2] + end.onBoard, 48, 'lanterns are conserved');
    assert.deepStrictEqual(errors, [], 'no console errors anywhere in a full game');
    return end;
  } finally { await browser.close(); await server.close(); }
}

test('a full game against the machine on a 390x844 phone, with a worker', async (t) => {
  await playFullGame(t, { level: 0, local: false });
});

test('a full game on the main-thread fallback, same screen', async (t) => {
  await playFullGame(t, { level: 0, local: true });
});

test('a full game with animations on, which is what a real player sees', async (t) => {
  await playFullGame(t, { level: 0, local: false, motion: 'no-preference' });
});

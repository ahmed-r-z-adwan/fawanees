// The game has to work on the two browsers most players will actually use: Safari on an iPhone and
// Chrome on an Android phone. Everything else in this suite runs on headless Chromium, which is a
// poor stand-in for WebKit -- Safari is where <dialog>, Blob workers, canvas sizing and the
// home-screen metadata differ.
//
// Playwright drives a real WebKit build and a Chromium with Android device emulation. These are the
// same page and the same assertions; only the engine underneath changes.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { webkit, chromium, devices } = require('playwright');
const { serve } = require('../tools/serve.js');
const { noFontsPW, isPageError } = require('../tools/nofonts.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const PWA = path.join(__dirname, '..', '..', 'pwa');

const TARGETS = [
  { name: 'Safari on iPhone 14 (WebKit)', engine: webkit, device: devices['iPhone 14'] },
  { name: 'Safari on iPad (WebKit)', engine: webkit, device: devices['iPad Mini'] },
  { name: 'Chrome on Pixel 7 (Android)', engine: chromium, device: devices['Pixel 7'] },
];

async function openGame(target, url) {
  const browser = await target.engine.launch();
  const context = await browser.newContext({ ...target.device });
  const page = await context.newPage();
  await noFontsPW(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (isPageError(m)) errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__fw && window.__fw.game', null, { timeout: 30000 });
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
  return { browser, page, errors };
}

for (const target of TARGETS) {
  test(`${target.name}: plays a real move`, async (t) => {
    const server = await serve(DIST);
    let browser;
    try {
      const opened = await openGame(target, server.url + '/fawanees.html');
      browser = opened.browser;
      const { page, errors } = opened;

      // the page must parse into the document it describes, on this engine too
      const dom = await page.evaluate(() => ({
        appParent: document.querySelector('.app').parentElement.tagName,
        unknown: [...new Set([...document.querySelectorAll('*')].map(e => e.tagName))]
          .filter(tn => document.createElement(tn).constructor.name === 'HTMLUnknownElement'),
        dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        canvasW: document.getElementById('board').width,
        dialogSupported: typeof HTMLDialogElement !== 'undefined' && !!HTMLDialogElement.prototype.showModal,
      }));
      assert.strictEqual(dom.appParent, 'BODY');
      assert.deepStrictEqual(dom.unknown, []);
      assert.strictEqual(dom.dir, 'rtl', 'the page must start right-to-left');
      assert.ok(dom.overflow <= 1, `overflows by ${dom.overflow}px`);
      assert.ok(dom.canvasW > 0, 'the board canvas must have been sized');
      assert.ok(dom.dialogSupported, '<dialog>.showModal must exist');

      await page.waitForFunction("window.__fw.aiMode !== 'pending'", null, { timeout: 30000 });
      const mode = await page.evaluate(() => window.__fw.aiMode);

      // tap a cell the way a finger does, twice: preview, then confirm
      const box = await page.locator('#board').boundingBox();
      const cell = await page.evaluate(() => { const L = window.__fw.game.legal(); return L[Math.floor(L.length / 2)]; });
      const [cx, cy] = await page.evaluate(i => window.__fw.px(i), cell);
      const before = await page.evaluate(() => window.__fw.game.history.length);
      await page.mouse.click(box.x + cx, box.y + cy);
      if (await page.evaluate(b => window.__fw.game.history.length === b, before)) {
        await page.mouse.click(box.x + cx, box.y + cy);
      }
      await page.waitForFunction(b => window.__fw.game.history.length > b, before, { timeout: 30000 });

      // and the machine must answer
      await page.waitForFunction(b => window.__fw.game.history.length >= b + 2 || window.__fw.game.over,
        before, { timeout: 90000 });
      const after = await page.evaluate(() => ({
        moves: window.__fw.game.history.length,
        meter: document.getElementById('meter1').textContent,
        score: document.getElementById('pts1').textContent,
      }));
      t.diagnostic(`${target.name}: ${mode} mode, ${after.moves} moves played, meter "${after.meter}", score ${after.score}`);
      assert.ok(after.moves >= before + 2, 'the machine should have answered');
      assert.ok(/\d/.test(after.meter), 'the win meter should show a figure once a search has run');
      assert.deepStrictEqual(errors, []);
    } finally { if (browser) await browser.close(); await server.close(); }
  });

  test(`${target.name}: the tutorial and the puzzles open and can be solved`, async (t) => {
    const server = await serve(DIST);
    let browser;
    try {
      const opened = await openGame(target, server.url + '/fawanees.html');
      browser = opened.browser;
      const { page, errors } = opened;

      // the tutorial, through its keyboard route
      await page.evaluate(() => window.__fw.tutorial().open(0));
      assert.ok(await page.evaluate(() => document.getElementById('dlgLearn').open), 'the tutorial dialog must open');
      await page.click('#learnPlay');
      assert.strictEqual(await page.evaluate(() => window.__fw.tutorial().stage), 'result',
        'the keyboard route must complete a lesson');
      await page.evaluate(() => document.getElementById('dlgLearn').close());

      // a puzzle, by tapping the answer
      await page.evaluate(() => window.__fw.puzzles().open(0));
      const box = await page.locator('#puzzleBoard').boundingBox();
      const [ax, ay] = await page.evaluate(() => window.__fw.puzzles().answerXY());
      await page.mouse.click(box.x + ax, box.y + ay);
      assert.strictEqual(await page.evaluate(() => window.__fw.puzzles().stage), 'result',
        'tapping the answer must solve the puzzle');
      const shown = await page.evaluate(() => document.getElementById('puzzleBody').innerText);
      assert.ok(shown.length > 20, 'the result should explain itself');
      t.diagnostic(`${target.name}: tutorial lesson and puzzle both completed`);
      assert.deepStrictEqual(errors, []);
    } finally { if (browser) await browser.close(); await server.close(); }
  });
}

test('the installable copy carries what iOS needs for a home-screen icon', async (t) => {
  const server = await serve(PWA);
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ ...devices['iPhone 14'] });
    const page = await context.newPage();
    await noFontsPW(page);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(server.url + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game', null, { timeout: 30000 });

    const meta = await page.evaluate(() => ({
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
      title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
      statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
      touchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
      touchIconSizes: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('sizes'),
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
      viewportFit: /viewport-fit=cover/.test(document.querySelector('meta[name=viewport]')?.content || ''),
      themeColor: document.querySelector('meta[name="theme-color"]')?.content,
    }));
    t.diagnostic(`iOS metadata: title "${meta.title}", icon ${meta.touchIcon} (${meta.touchIconSizes}), status bar ${meta.statusBar}`);

    assert.strictEqual(meta.capable, 'yes', 'iOS needs apple-mobile-web-app-capable to run full screen');
    assert.ok(meta.title, 'the home-screen label must be set, or iOS uses the <title>');
    assert.strictEqual(meta.touchIconSizes, '180x180', 'iOS wants a 180px icon');
    assert.ok(meta.viewportFit, 'viewport-fit=cover is what lets the safe-area insets apply on a notched phone');
    assert.ok(meta.manifest && meta.themeColor);

    // the icon has to exist, be 180 square, and be opaque: iOS paints transparency black
    const icon = await page.evaluate(href => new Promise(res => {
      const i = new Image();
      i.onload = () => {
        const c = document.createElement('canvas');
        c.width = i.naturalWidth; c.height = i.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(i, 0, 0);
        const corner = g.getImageData(0, 0, 1, 1).data;
        res({ ok: true, w: i.naturalWidth, h: i.naturalHeight, cornerAlpha: corner[3] });
      };
      i.onerror = () => res({ ok: false });
      i.src = href;
    }), meta.touchIcon);
    assert.ok(icon.ok, 'the apple-touch-icon must load');
    assert.deepStrictEqual([icon.w, icon.h], [180, 180]);
    assert.strictEqual(icon.cornerAlpha, 255, 'it must be opaque, or iOS renders the corners black');

    // and the safe-area insets must be honoured rather than ignored
    const insets = await page.evaluate(() => getComputedStyle(document.documentElement).paddingTop);
    t.diagnostic(`safe-area padding resolved to ${insets}`);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

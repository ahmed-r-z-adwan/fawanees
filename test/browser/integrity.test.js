// Two things the rest of the suite could not see.
//
// The page has to actually PARSE the way it is written. A malformed attribute in <head> does not
// throw anything, does not log anything, and does not fail any test that only drives the game: the
// browser quietly relocates the rest of the document and carries on. The only way to catch it is to
// look at the DOM the browser built and compare it with the DOM the source describes.
//
// And the board must not accept a move while the machine's own move is still animating. That window
// used to be open, and one mistimed click handed the player's side to the engine for the rest of
// the game. The full-game tests could not see it because they emulate reduced motion, which removes
// the animation entirely.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');
const { noFonts, isPageError } = require('../tools/nofonts.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const PWA = path.join(__dirname, '..', '..', 'pwa');

for (const [label, dir, file] of [['the single file', DIST, 'fawanees.html'], ['the installable copy', PWA, 'index.html']]) {
  test(`${label} parses into the document it describes`, async (t) => {
    const server = await serve(dir);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await noFonts(page);
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${server.url}/${file}`, { waitUntil: 'load' });
      await page.waitForFunction('window.__fw && window.__fw.game');

      const dom = await page.evaluate(() => {
        const app = document.querySelector('.app');
        const icon = document.querySelector('link[rel="icon"]');
        return {
          // the app must hang off <body> directly, not out of some element a broken tag invented
          appParent: app ? app.parentElement.tagName : null,
          // the stylesheet and the fonts belong in <head>
          styleInHead: !!document.head.querySelector('style'),
          fontsInHead: document.head.querySelectorAll('link[href*="fonts.googleapis"]').length,
          // nothing stray should render before the app
          firstBodyText: (document.body.firstChild && document.body.firstChild.nodeType === 3)
            ? document.body.firstChild.textContent.trim() : '',
          // Every element the browser built should be a real one. HTML elements only: this is
          // looking for elements invented out of broken markup, and createElement cannot
          // reproduce a genuine inline <svg> -- it would make an unknown HTML element of that
          // name and report the drawing as damage.
          unknownTags: [...new Set([...document.querySelectorAll('*')]
            .filter(e => e.namespaceURI === 'http://www.w3.org/1999/xhtml')
            .map(e => e.tagName))]
            .filter(tn => document.createElement(tn).constructor.name === 'HTMLUnknownElement'),
          iconHref: icon ? icon.getAttribute('href') : null,
          iconLoads: null,
        };
      });
      t.diagnostic(`.app sits in <${dom.appParent}>, style in head ${dom.styleInHead}, font links ${dom.fontsInHead}, unknown tags ${JSON.stringify(dom.unknownTags)}`);

      assert.strictEqual(dom.appParent, 'BODY', '.app must be a direct child of <body>');
      assert.ok(dom.styleInHead, 'the stylesheet must stay in <head>');
      assert.strictEqual(dom.fontsInHead, 2, 'both Google Fonts links must stay in <head>');
      assert.strictEqual(dom.firstBodyText, '', `stray text rendered before the app: ${JSON.stringify(dom.firstBodyText)}`);
      assert.deepStrictEqual(dom.unknownTags, [], 'the parser invented elements, so a tag is malformed');

      // and the icon must be a data URI the browser can actually decode
      assert.ok(dom.iconHref && dom.iconHref.startsWith('data:image/svg+xml,'), 'there should be an inline icon');
      assert.ok(!dom.iconHref.includes('"'), 'the icon URI must not contain a raw quote');
      const decoded = await page.evaluate(href => new Promise(res => {
        const img = new Image();
        img.onload = () => res({ ok: true, w: img.naturalWidth });
        img.onerror = () => res({ ok: false });
        img.src = href;
      }), dom.iconHref);
      assert.ok(decoded.ok && decoded.w > 0, 'the icon must decode as an image');
      assert.deepStrictEqual(errors, []);
    } finally { await browser.close(); await server.close(); }
  });
}

test('the board refuses a move while the machine\'s own move is still animating', async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await noFonts(page);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    // Deliberately NOT reduced motion: the animation is the whole point of this test.
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (isPageError(m)) errors.push('console: ' + m.text()); });
    await page.goto(server.url + '/fawanees.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game');
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 20000 });
    await page.evaluate(() => window.__fw.newGame({ mode: 'ai', level: 0, human: 1 }));
    await page.waitForFunction('!window.__fw.busy', { timeout: 30000 });

    const box = await (await page.$('#board')).boundingBox();
    const clickFreeCell = async () => {
      const cell = await page.evaluate(() => { const L = window.__fw.game.legal(); return L.length ? L[Math.floor(L.length / 2)] : -1; });
      if (cell < 0) return false;
      const [cx, cy] = await page.evaluate(i => window.__fw.px(i), cell);
      await page.mouse.move(box.x + cx, box.y + cy);
      await page.mouse.click(box.x + cx, box.y + cy);
      return true;
    };

    let pounced = 0, committedDuringAnim = 0;
    for (let turn = 0; turn < 8; turn++) {
      if (await page.evaluate(() => window.__fw.game.over)) break;
      // the human moves
      const before = await page.evaluate(() => window.__fw.game.history.length);
      if (!(await clickFreeCell())) break;
      if (await page.evaluate(b => window.__fw.game.history.length === b, before)) await clickFreeCell();
      // wait until the machine has placed its lantern, then pounce mid-animation
      await page.waitForFunction(b => window.__fw.game.history.length > b + 1 || window.__fw.game.over,
        { timeout: 60000 }, before);
      const now = await page.evaluate(() => window.__fw.game.history.length);
      const took = await clickFreeCell();
      if (took) {
        pounced++;
        if (await page.evaluate(n => window.__fw.game.history.length > n, now)) committedDuringAnim++;
      }
      await page.waitForFunction('!window.__fw.busy || window.__fw.game.over', { timeout: 60000 });
    }

    // Let the page sit: if two turn-chains were started, the game plays on by itself.
    const settled = await page.evaluate(() => window.__fw.game.history.length);
    await new Promise(r => setTimeout(r, 4000));
    const later = await page.evaluate(() => ({ len: window.__fw.game.history.length, busy: window.__fw.busy, over: window.__fw.game.over }));

    t.diagnostic(`${pounced} clicks during the machine's animation, ${committedDuringAnim} of them committed; ` +
                 `history ${settled} -> ${later.len} after idling, busy ${later.busy}`);

    assert.strictEqual(committedDuringAnim, 0, 'a click during the machine\'s animation must not commit a move');
    if (!later.over) {
      assert.strictEqual(later.len, settled, 'the game must not keep playing itself while nobody touches it');
    }
    assert.deepStrictEqual(errors, [], 'no errors from the animation path');
  } finally { await browser.close(); await server.close(); }
});

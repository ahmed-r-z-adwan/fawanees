// The install offer must appear exactly where installing is possible, and nowhere else: not on the
// standalone single file, which has no manifest and cannot be installed, and not once the game is
// already running from the home screen.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { webkit, chromium, devices } = require('playwright');
const { serve } = require('../tools/serve.js');
const { noFonts, isPageError } = require('../tools/nofonts.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const PWA = path.join(__dirname, '..', '..', 'pwa');

async function open(engine, device, dir, file) {
  const server = await serve(dir);
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  await noFonts(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (isPageError(m)) errors.push('console: ' + m.text()); });
  await page.goto(`${server.url}/${file}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__fw && window.__fw.game', null, { timeout: 30000 });
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
  return { server, browser, page, errors };
}

test('on an iPhone the installable copy offers the steps Safari hides', async (t) => {
  const s = await open(webkit, devices['iPhone 14'], PWA, 'index.html');
  try {
    const shown = await s.page.evaluate(() => ({
      visible: window.__fw.install().shown,
      text: document.getElementById('installText').textContent,
      button: document.getElementById('installGo').textContent,
      canPrompt: window.__fw.install().canPromptNow,
    }));
    t.diagnostic(`iPhone: bar "${shown.text}" / "${shown.button}", real prompt available: ${shown.canPrompt}`);
    assert.ok(shown.visible, 'the offer should appear on an iPhone, where there is no install API');
    assert.ok(shown.text.length > 5 && shown.button.length > 1);
    assert.ok(!shown.canPrompt, 'Safari never gives a programmatic prompt');

    // tapping it must explain the share-sheet route rather than pretending to install
    await s.page.click('#installGo');
    const help = await s.page.evaluate(() => ({
      open: document.getElementById('dlgInstall').open,
      body: document.getElementById('installBody').innerText,
    }));
    assert.ok(help.open, 'it should open the instructions');
    assert.match(help.body, /الشاشة الرئيسية/, 'and name the Add to Home Screen step');

    // and dismissing it must stick
    await s.page.evaluate(() => document.getElementById('dlgInstall').close());
    await s.page.click('#installNo');
    assert.strictEqual(await s.page.evaluate(() => window.__fw.install().shown), false);
    await s.page.reload({ waitUntil: 'load' });
    await s.page.waitForFunction('window.__fw && window.__fw.game', null, { timeout: 30000 });
    assert.strictEqual(await s.page.evaluate(() => window.__fw.install().shown), false,
      'once dismissed it should stay dismissed');
    assert.deepStrictEqual(s.errors, []);
  } finally { await s.browser.close(); await s.server.close(); }
});

test('on Android the offer uses the browser\'s own install prompt', async (t) => {
  const s = await open(chromium, devices['Pixel 7'], PWA, 'index.html');
  try {
    // Headless Chromium does not fire beforeinstallprompt on its own, so raise the event the way
    // the browser would and check the page wires it to a real prompt() call.
    const r = await s.page.evaluate(async () => {
      let prompted = false;
      const e = new Event('beforeinstallprompt');
      e.prompt = () => { prompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
      const before = { visible: window.__fw.install().shown, canPrompt: window.__fw.install().canPromptNow,
                       button: document.getElementById('installGo').textContent };
      document.getElementById('installGo').click();
      await new Promise(r2 => setTimeout(r2, 50));
      return { ...before, prompted, dialogOpened: document.getElementById('dlgInstall').open };
    });
    t.diagnostic(`Android: bar visible ${r.visible}, button "${r.button}", prompt() called: ${r.prompted}`);
    assert.ok(r.visible, 'the offer should appear once the browser says it can install');
    assert.ok(r.canPrompt, 'and it should hold the browser\'s prompt');
    assert.ok(r.prompted, 'tapping it must call the browser\'s own prompt()');
    assert.ok(!r.dialogOpened, 'and must not show the iOS instructions instead');
    assert.deepStrictEqual(s.errors, []);
  } finally { await s.browser.close(); await s.server.close(); }
});

test('the standalone single file never offers to install, because it cannot be', async (t) => {
  for (const [label, engine, device] of [['iPhone', webkit, devices['iPhone 14']], ['Android', chromium, devices['Pixel 7']]]) {
    const s = await open(engine, device, DIST, 'fawanees.html');
    try {
      const shown = await s.page.evaluate(() => window.__fw.install().shown);
      t.diagnostic(`${label}: single file offer shown = ${shown}`);
      assert.strictEqual(shown, false, `${label}: the single file has no manifest, so it must not offer`);
      assert.deepStrictEqual(s.errors, []);
    } finally { await s.browser.close(); await s.server.close(); }
  }
});

test('a game already installed is not asked to install again', async (t) => {
  const server = await serve(PWA);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    await noFonts(page);
    // what the browser reports when the page is running from the home screen
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = q => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
    });
    await page.goto(server.url + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game', null, { timeout: 30000 });
    const shown = await page.evaluate(() => {
      const e = new Event('beforeinstallprompt');
      e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
      return window.__fw.install().shown;
    });
    t.diagnostic(`running standalone: offer shown = ${shown}`);
    assert.strictEqual(shown, false, 'an installed game must not keep asking');
  } finally { await browser.close(); await server.close(); }
});

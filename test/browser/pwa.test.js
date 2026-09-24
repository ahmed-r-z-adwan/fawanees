// The installable copy has to survive being cut off from the network, and the single file has to
// stay a single file -- no manifest, no service worker, nothing to 404 on.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');

const ROOT = path.join(__dirname, '..', '..');
const PWA = path.join(ROOT, 'pwa');

test('the manifest says everything an install prompt needs', () => {
  const m = JSON.parse(fs.readFileSync(path.join(PWA, 'manifest.webmanifest'), 'utf8'));
  assert.ok(m.name && m.short_name, 'a name and a short name');
  assert.strictEqual(m.display, 'standalone');
  assert.ok(m.start_url, 'a start url');
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  assert.strictEqual(m.lang, 'ar');
  assert.strictEqual(m.dir, 'rtl');
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'both required icon sizes');
  assert.ok(m.icons.some(i => i.purpose === 'maskable'), 'a maskable icon, so Android does not box it');
  for (const icon of m.icons) {
    const f = path.join(PWA, icon.src);
    assert.ok(fs.existsSync(f), `${icon.src} exists`);
    // PNG header: width and height are big-endian 32-bit at bytes 16 and 20
    const buf = fs.readFileSync(f);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const want = +icon.sizes.split('x')[0];
    assert.deepStrictEqual([w, h], [want, want], `${icon.src} is really ${want}x${want}`);
  }
});

test('the single file stays standalone: no manifest, no service worker, no extra requests', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'fawanees.html'), 'utf8');
  assert.ok(!/rel=["']manifest/.test(html), 'the single file must not ask for a manifest');
  assert.ok(!/serviceWorker/.test(html), 'and must not register a service worker');

  const server = await serve(path.join(ROOT, 'dist'));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const external = [];
    page.on('request', r => { const u = new URL(r.url()); if (u.origin !== new URL(server.url).origin) external.push(u.hostname); });
    await page.goto(server.url + '/fawanees.html', { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__fw && window.__fw.game');
    const hosts = [...new Set(external)];
    assert.deepStrictEqual(hosts.filter(h => !/^fonts\.(googleapis|gstatic)\.com$/.test(h)), [],
      `the only outside requests allowed are Google Fonts, saw ${hosts.join(', ')}`);
  } finally { await browser.close(); await server.close(); }
});

test('the installable copy plays a move with the network cut off', async (t) => {
  const server = await serve(PWA);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(server.url + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game', { timeout: 30000 });
    // wait for the service worker to take control
    await page.waitForFunction("navigator.serviceWorker && navigator.serviceWorker.controller !== null", { timeout: 30000 })
      .catch(async () => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction("navigator.serviceWorker.controller !== null", { timeout: 30000 }); });
    t.diagnostic('service worker controlling the page');

    // Now pull the plug and reload: everything must come out of the cache.
    const client = await page.createCDPSession();
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });

    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction('window.__fw && window.__fw.game', { timeout: 30000 });
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
    await page.waitForFunction("window.__fw.aiMode !== 'pending'", { timeout: 30000 });

    const r = await page.evaluate(async () => {
      const fw = window.__fw;
      fw.newGame({ mode: 'pvp' });
      const g = fw.game;
      g.play(g.legal()[10]);
      const res = await fw.think(g.toMove, 500, 64).promise;
      return { mode: fw.aiMode, move: res.move, depth: res.depth };
    });
    t.diagnostic(`offline: ${r.mode} mode, answered at depth ${r.depth}`);
    assert.ok(r.move >= 0, 'the machine still answers with no network');
    assert.ok(r.depth >= 1);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

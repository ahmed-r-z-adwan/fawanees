// Rasterises src/icon.svg into the PNG sizes an installable app needs.
//   node test/tools/makeIcons.js
// Run again whenever src/icon.svg changes; the PNGs are committed so the build needs no browser.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = path.join(__dirname, '..', '..');
const svg = fs.readFileSync(path.join(root, 'src', 'icon.svg'), 'utf8');
const outDir = path.join(root, 'pwa', 'icons');

// A maskable icon must survive being cropped to a circle, so the artwork sits in the middle 80%.
const page = (size, pad) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#15112a}
#w{width:${size}px;height:${size}px;display:grid;place-items:center;background:#15112a}
svg{width:${Math.round(size * (1 - 2 * pad))}px;height:${Math.round(size * (1 - 2 * pad))}px}</style>
<div id="w">${svg}</div>`;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 0.12]]) {
      const p = await browser.newPage();
      await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await p.setContent(page(size, pad), { waitUntil: 'load' });
      const buf = await p.screenshot({ type: 'png', omitBackground: false });
      fs.writeFileSync(path.join(outDir, name), buf);
      console.log(`${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
      await p.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

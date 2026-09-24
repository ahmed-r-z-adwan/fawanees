// Rasterises src/icon.svg into the PNG sizes an installable app needs, and packs a Windows .ico
// for a desktop shortcut.
//   node test/tools/makeIcons.js
// Run again whenever src/icon.svg changes; the output is committed so the build needs no browser.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = path.join(__dirname, '..', '..');
const svg = fs.readFileSync(path.join(root, 'src', 'icon.svg'), 'utf8');
const outDir = path.join(root, 'pwa', 'icons');

// A maskable icon must survive being cropped to a circle, so the artwork sits in the middle 80%.
const page = (size, pad, clear) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:${clear ? 'transparent' : '#15112a'}}
#w{width:${size}px;height:${size}px;display:grid;place-items:center;background:${clear ? 'transparent' : '#15112a'}}
svg{width:${Math.round(size * (1 - 2 * pad))}px;height:${Math.round(size * (1 - 2 * pad))}px}</style>
<div id="w">${svg}</div>`;

// A .ico is a tiny header plus the PNGs themselves: Windows has accepted PNG-compressed entries
// since Vista, so no bitmap conversion is needed.
function packIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);              // reserved
  head.writeUInt16LE(1, 2);              // 1 = icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(p.size >= 256 ? 0 : p.size, e);       // 0 means 256
    head.writeUInt8(p.size >= 256 ? 0 : p.size, e + 1);
    head.writeUInt8(0, e + 2);           // palette size
    head.writeUInt8(0, e + 3);           // reserved
    head.writeUInt16LE(1, e + 4);        // colour planes
    head.writeUInt16LE(32, e + 6);       // bits per pixel
    head.writeUInt32LE(p.buf.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += p.buf.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.buf)]);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const shot = async (size, pad, clear) => {
      const p = await browser.newPage();
      await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await p.setContent(page(size, pad, clear), { waitUntil: 'load' });
      const buf = await p.screenshot({ type: 'png', omitBackground: !!clear });
      await p.close();
      return buf;
    };

    for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 0.12],
                                     // iOS rounds the corners itself and paints transparency
                                     // black, so its icon is opaque and square.
                                     ['apple-touch-icon.png', 180, 0]]) {
      const buf = await shot(size, pad);
      fs.writeFileSync(path.join(outDir, name), buf);
      console.log(`${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
    }

    // Windows picks whichever size it needs, so give it the whole range rather than one big square
    // scaled down: small sizes drawn at their own resolution stay legible in the taskbar.
    // Transparent outside the rounded rectangle, so the shortcut sits among Windows' own icons
    // instead of looking like a photograph of one.
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = [];
    for (const size of icoSizes) pngs.push({ size, buf: await shot(size, 0, true) });
    const ico = packIco(pngs);
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'fawanees.ico'), ico);
    console.log(`fawanees.ico  ${icoSizes.join(', ')}  ${(ico.length / 1024).toFixed(1)} KB`);

    // The card a chat app shows when someone pastes the link. Without it the link is a bare box.
    const og = await browser.newPage();
    await og.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await og.setContent(`<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%}
  body{background:radial-gradient(120% 90% at 50% 20%,#251d49 0%,#15112a 55%,#0f0c1f 100%);
       display:flex;align-items:center;justify-content:center;gap:56px;
       font-family:"Segoe UI",system-ui,sans-serif;direction:rtl}
  svg{width:240px;height:240px;filter:drop-shadow(0 0 60px rgba(242,180,71,.45))}
  .t{color:#f6ead0}
  h1{margin:0;font-size:104px;line-height:1;font-weight:700}
  p{margin:18px 0 0;font-size:34px;color:#a39cc4}
  .c{margin:26px 0 0;font-size:22px;color:#7e77a3}
</style>
<div>${svg}</div>
<div class="t"><h1>&#x641;&#x648;&#x627;&#x646;&#x64a;&#x633;</h1>
<p>&#x644;&#x639;&#x628;&#x629; &#x636;&#x648;&#x621; &#x648;&#x638;&#x644; &#x627;&#x62e;&#x62a;&#x631;&#x639;&#x647;&#x627; &#x630;&#x643;&#x627;&#x621; &#x627;&#x635;&#x637;&#x646;&#x627;&#x639;&#x64a;</p>
<p class="c">A game of light and shadow, invented by an AI</p></div>`, { waitUntil: 'load' });
    const ogBuf = await og.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(root, 'pwa', 'og.png'), ogBuf);
    await og.close();
    console.log(`og.png  1200x630  ${(ogBuf.length / 1024).toFixed(1)} KB`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

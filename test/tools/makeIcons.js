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
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

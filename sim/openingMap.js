// Draws the opening study as a hex map: one cell per opening, shaded by how often the opener wins.
//
//   node sim/openingMap.js [--in docs/measurements/opening.json] [--out docs/opening-map.svg]
const fs = require('fs');
const { orbitsOf, ringOf } = require('./symmetry.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const IN = arg('in', 'docs/measurements/opening.json');
const OUT = arg('out', 'docs/opening-map.svg');

const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
const { geo, canon, members } = orbitsOf(data.rules.radius);
// Cells of one symmetry class are the same opening rotated, so pooling them is the signal;
// the difference between the two panels is the search breaking ties by cell index.
const pooled = new Map();
for (const [rep, list] of members) {
  const v = list.map(i => data.cells.find(c => c.cell === i).noSwap.openerWinRate);
  pooled.set(rep, v.reduce((a, b) => a + b, 0) / v.length);
}

const sq3 = Math.sqrt(3);
const panelW = 560, panelH = 600;
// a radius-R board is (3R+2) hex-radii wide and sqrt(3)*(2R+1)+1 tall
const R = 5;
const S = Math.min(panelW / (3 * R + 2.4), panelH / (sq3 * (2 * R + 1) + 1.2));

// gold where the opener does well, turquoise where the responder does, pale in the middle
function shade(p) {
  const t = Math.max(0, Math.min(1, (p - 0.35) / 0.30));   // 35% .. 65%
  const gold = [242, 180, 71], turq = [60, 200, 207], mid = [150, 143, 190];
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const c = t < 0.5 ? mix(turq, mid, t * 2) : mix(mid, gold, (t - 0.5) * 2);
  return `rgb(${c.join(',')})`;
}

function panel(ox, title, value, sub) {
  const cx = ox + panelW / 2, cy = 150 + panelH / 2;
  const pos = i => [cx + S * 1.5 * geo.cells[i].q, cy + S * sq3 * (geo.cells[i].r + geo.cells[i].q / 2)];
  const hex = (x, y, k) => Array.from({ length: 6 }, (_, m) => { const a = Math.PI / 3 * m; return (x + k * Math.cos(a)).toFixed(1) + ',' + (y + k * Math.sin(a)).toFixed(1); }).join(' ');
  let out = `<text x="${cx}" y="110" text-anchor="middle" font-size="21" font-weight="700" fill="#F6EAD0">${title}</text>`;
  out += `<text x="${cx}" y="132" text-anchor="middle" font-size="14" fill="#A39CC4">${sub}</text>`;
  for (const c of data.cells) {
    const [x, y] = pos(c.cell);
    const p = value(c);
    out += `<polygon points="${hex(x, y, S * 0.94)}" fill="${shade(p)}" fill-opacity="0.9" stroke="#15112A" stroke-width="1.4"/>`;
    out += `<text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="#15112A">${Math.round(100 * p)}</text>`;
  }
  return out;
}

const legend = (y) => {
  const mid = panelW + 30, x0 = mid - 150;
  let out = `<text x="${mid}" y="${y}" text-anchor="middle" font-size="14" fill="#A39CC4">how often the opener wins, per cent</text>`;
  for (let k = 0; k < 30; k++) out += `<rect x="${x0 + k * 10}" y="${y + 12}" width="10" height="16" fill="${shade(0.35 + 0.30 * k / 29)}"/>`;
  for (const p of [0.35, 0.5, 0.65]) {
    const x = x0 + 300 * (p - 0.35) / 0.30;
    out += `<text x="${x}" y="${y + 44}" text-anchor="middle" font-size="12" fill="#A39CC4">${Math.round(100 * p)}</text>`;
  }
  return out;
};

const W = 2 * panelW + 60, H = 150 + panelH + 100;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="DejaVu Sans, Segoe UI, sans-serif">
<rect width="${W}" height="${H}" fill="#15112A"/>
<text x="${W / 2}" y="40" text-anchor="middle" font-size="24" font-weight="700" fill="#F6EAD0">Fawanees openings</text>
<text x="${W / 2}" y="60" text-anchor="middle" font-size="14" fill="#A39CC4">${data.totalGames} games: every opening cell, every one of the ${geo.N - 1} replies, depth 3 both sides. How often the opener wins when the second player answers the lantern.</text>
<text x="${W / 2}" y="80" text-anchor="middle" font-size="14" fill="#A39CC4">When the second player takes it instead, the numbers are the exact complement, so that half of the study is not drawn here.</text>
${panel(20, 'each cell on its own', c => c.noSwap.openerWinRate, 'one number per cell, from its own 90 games')}
${panel(40 + panelW, 'pooled by symmetry', c => pooled.get(canon[c.cell]), 'rotations of one opening averaged together: this is the signal')}
${legend(150 + panelH + 36)}
</svg>`;

fs.writeFileSync(OUT, svg);
console.log(`written ${OUT} (${(svg.length / 1024).toFixed(1)} KB)`);

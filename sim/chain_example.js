const F = require('../src/engine.js');
const geo = F.makeGeometry(3); geo.range = 2;
const RULES = { K: 3, restrict: false, range: 2 };
const idx = (q, r) => geo.index.get(q + ',' + r);
// Position: blue A (0,0) and B (0,2) protect each other; gold at (2,0), (0,-2), (1,2). Gold plays (-2,2).
const b0 = new Int8Array(geo.N);
[[0, 0, 2], [0, 2, 2], [2, -2, 1], [0, -2, 1], [1, 2, 1]].forEach(([q, r, p]) => { b0[idx(q, r)] = p; });
const sc = F.makeScratch(geo.N);
const b1 = b0.slice(); const waves = F.applyMove(geo, b1, 1, idx(-2, 2), RULES, sc, true);
const name = i => { const c = geo.cells[i]; return `(${c.q},${c.r})`; };
console.log('waves:', JSON.stringify(waves.map(w => w.map(name))));
// sight counts before/after for A and B
const sight = b => { const s = F.makeScratch(geo.N); F.computeLight(geo, b, s); return i => `gold ${s.s1[i]} / blue ${s.s2[i]}`; };
const A = idx(0, 0), B = idx(0, 2);
const before = sight(b0); console.log('before  A:', before(A), '| B:', before(B));
const placed = b0.slice(); placed[idx(-2, 2)] = 1; const s1 = sight(placed); console.log('placed  A:', s1(A), '| B:', s1(B));
const w1 = placed.slice(); w1[A] = 1; const s2 = sight(w1); console.log('after w1 B:', s2(B));
// ---- render 3 stacked panels
const S = 30, sq3 = Math.sqrt(3);
const AMB = { glow: '#F2B447', core: '#FFE9B8', rgb: '242,180,71' }, TUR = { glow: '#3CC8CF', core: '#C8F7F8', rgb: '60,200,207' };
function panel(oy, title, b, lines, opts = {}) {
  const s = F.makeScratch(geo.N); F.computeLight(geo, b, s);
  const cx = 660, cy = oy + 250;
  const pos = i => { const { q, r } = geo.cells[i]; return [cx + S * 1.5 * q, cy + S * sq3 * (r + q / 2)]; };
  const hex = (x, y, k) => Array.from({ length: 6 }, (_, m) => { const a = Math.PI / 3 * m; return (x + k * Math.cos(a)).toFixed(1) + ',' + (y + k * Math.sin(a)).toFixed(1); }).join(' ');
  let out = `<rect x="6" y="${oy + 6}" width="888" height="468" rx="18" fill="#1E1938" stroke="#3A3363"/>`;
  out += `<text direction="rtl" x="870" y="${oy + 48}" text-anchor="start" font-size="26" font-weight="700" fill="#F6EAD0">${title}</text>`;
  for (let i = 0; i < geo.N; i++) {
    const [x, y] = pos(i); let fill = '#241E44';
    if (!b[i]) { const a = s.l1[i], c = s.l2[i]; if (a > c) fill = `rgba(242,180,71,${0.14 + 0.09 * a})`; else if (c > a) fill = `rgba(60,200,207,${0.14 + 0.09 * c})`; else if (a) fill = 'rgba(214,205,245,0.14)'; }
    out += `<polygon points="${hex(x, y, S * 0.95)}" fill="${fill}" stroke="#3A3363" stroke-width="1.2"/>`;
  }
  for (let i = 0; i < geo.N; i++) if (b[i]) {
    const [x0, y0] = pos(i), col = b[i] === 1 ? AMB : TUR;
    for (let d = 0; d < 6; d++) {
      const k0 = geo.rayStart[i * 6 + d], len = Math.min(geo.rayLen[i * 6 + d], 2); let last = -1;
      for (let k = k0; k < k0 + len; k++) { const j = geo.rayCells[k]; if (b[j]) break; last = j; }
      if (last >= 0) { const [x1, y1] = pos(last); out += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="rgba(${col.rgb},0.45)" stroke-width="2.2" stroke-linecap="round"/>`; }
    }
  }
  if (opts.target !== undefined) { const [x, y] = pos(opts.target); out += `<polygon points="${hex(x, y, S * 0.85)}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-dasharray="7 5"/>`; }
  for (let i = 0; i < geo.N; i++) if (b[i]) {
    const [x, y] = pos(i), c = b[i] === 1 ? AMB : TUR, u = S * 0.47;
    out += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="${S * 1.05}" fill="rgba(${c.rgb},0.25)"/>
      <path d="M0,${-u * 1.55} L${u * 0.42},${-u * 1.12} L${-u * 0.42},${-u * 1.12} Z" fill="${c.glow}"/>
      <path d="M${-u * 0.7},${-u * 1.02} L${u * 0.7},${-u * 1.02} L${u * 0.9},${-u * 0.15} L${u * 0.7},${u * 0.92} L${-u * 0.7},${u * 0.92} L${-u * 0.9},${-u * 0.15} Z" fill="${c.core}" stroke="${c.glow}" stroke-width="2"/>
      <rect x="${-u * 0.8}" y="${u * 0.92}" width="${u * 1.6}" height="${u * 0.28}" fill="${c.glow}"/></g>`;
  }
  (opts.rings || []).forEach(i => { const [x, y] = pos(i); out += `<circle cx="${x}" cy="${y}" r="${S * 0.8}" fill="none" stroke="#FFFFFF" stroke-width="3.5"/>`; });
  (opts.labels || []).forEach(([i, txt]) => { const [x, y] = pos(i); out += `<circle cx="${x + S * 0.72}" cy="${y - S * 0.72}" r="13" fill="#FFFFFF"/><text x="${x + S * 0.72}" y="${y - S * 0.72 + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="#15112A">${txt}</text>`; });
  lines.forEach((ln, k) => { out += `<text direction="rtl" x="${430}" y="${oy + 110 + k * 34}" text-anchor="start" font-size="21" fill="${k === lines.length - 1 && opts.lastBold ? '#FFE2A0' : '#C9C2E6'}" ${k === lines.length - 1 && opts.lastBold ? 'font-weight="700"' : ''}>${ln}</text>`; });
  return out;
}
const tgt = idx(-2, 2);
const labels = [[A, 'أ'], [B, 'ب']];
let body = '';
body += panel(0, '١. قبل الحركة', b0, ['(أ) شايفه ذهبيين، وأزرق واحد هو (ب)', '(ب) شايفه ذهبي واحد، وأزرق واحد هو (أ)', 'الاثنين بأمان، وبيحموا بعض', 'الذهبي رح يحط فانوس بالخانة المعلّمة'], { target: tgt, labels, lastBold: true });
body += panel(480, '٢. الموجة الأولى', placed, ['الفانوس الجديد شايف (أ) و(ب) مع بعض', '(أ): ٣ ذهب مقابل أزرق واحد', '(ب): ٢ ذهب مقابل أزرق واحد، لسا بأمان', '(أ) بينقلب ذهبي'], { rings: [A], labels, lastBold: true });
body += panel(960, '٣. الموجة الثانية', w1, ['لما (أ) انقلب، (ب) خسر الفانوس اللي بيحميه', 'وبنفس اللحظة صار (أ) بيهاجمه', '(ب): ٣ ذهب مقابل صفر أزرق', '(ب) بينقلب كمان: سلسلة من فانوسين'], { rings: [B], labels, lastBold: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1440" width="900" height="1440" font-family="DejaVu Sans, sans-serif"><rect width="900" height="1440" fill="#15112A"/>${body}</svg>`;
require('fs').writeFileSync('chain.svg', svg);

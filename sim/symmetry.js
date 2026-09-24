// The hex board has the full symmetry of a hexagon: six rotations and a reflection, twelve maps
// in all. Opening cells that map onto each other are the same opening, so their games can be
// pooled. That is what makes it affordable to measure every opening cell precisely.
const F = require('../src/engine.js');

// axial (q,r); rotation by 60 degrees is (q,r) -> (-r, q+r), reflection is (q,r) -> (q, -q-r)
const rot = ([q, r]) => [-r, q + r];
const refl = ([q, r]) => [q, -q - r];

function transforms() {
  const out = [];
  for (const mirror of [false, true]) {
    let f = (c) => (mirror ? refl(c) : c);
    for (let k = 0; k < 6; k++) {
      const g = f;
      out.push((c) => g(c));
      f = ((prev) => (c) => rot(prev(c)))(g);
    }
  }
  return out;
}

// orbits[i] = canonical cell index for cell i; members maps canonical -> [cell indices]
function orbitsOf(radius) {
  const geo = F.makeGeometry(radius);
  const T = transforms();
  const canon = new Int32Array(geo.N).fill(-1);
  const members = new Map();
  for (let i = 0; i < geo.N; i++) {
    if (canon[i] >= 0) continue;
    const set = new Set();
    for (const t of T) {
      const [q, r] = t([geo.cells[i].q, geo.cells[i].r]);
      const j = geo.index.get(q + ',' + r);
      if (j === undefined) throw new Error(`symmetry maps (${geo.cells[i].q},${geo.cells[i].r}) off the board`);
      set.add(j);
    }
    const rep = Math.min(...set);
    for (const j of set) canon[j] = rep;
    members.set(rep, [...set].sort((a, b) => a - b));
  }
  return { geo, canon, members };
}

const ringOf = (c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));

module.exports = { transforms, orbitsOf, ringOf };

if (require.main === module) {
  const R = +(process.argv[2] || 5);
  const { geo, members } = orbitsOf(R);
  console.log(`radius ${R}: ${geo.N} cells, ${members.size} distinct openings under the hexagon's symmetry`);
  [...members.entries()]
    .sort((a, b) => ringOf(geo.cells[a[0]]) - ringOf(geo.cells[b[0]]) || a[0] - b[0])
    .forEach(([rep, list]) => {
      const c = geo.cells[rep];
      console.log(`  ring ${ringOf(c)}  (${c.q},${c.r})  ${String(list.length).padStart(2)} cells`);
    });
}

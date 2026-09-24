// Opening and swap policy. Replaced by sim/openingMatrix.js output with per-cell win rates.
// Until then this is the prototype's ring-based rule of thumb from 16-game samples.
window.FawaneesOpening = {
  measured: false,
  source: 'ring study, 16 games per ring (docs/NOTES.md)',
  // ring (0..RADIUS) -> pick the opening from these rings
  openRings: [1, 5],
  // second player takes the opening lantern when it sits on one of these rings
  swapRings: [1, 2, 3],
  pickOpening: function (cellsByRing) {
    const pool = [];
    this.openRings.forEach(r => { (cellsByRing[r] || []).forEach(i => pool.push(i)); });
    return pool[Math.floor(Math.random() * pool.length)];
  },
  shouldSwap: function (ring) { return this.swapRings.indexOf(ring) >= 0; },
};

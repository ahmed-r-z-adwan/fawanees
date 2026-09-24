// Engine speed benchmark. Same positions, same depths, every time, so two builds can be compared.
//
//   node sim/bench.js [--json]
//
// Positions come from a fixed self-play game, sampled across the opening, middle and end, so the
// number is not dominated by one phase.
const F = require('../src/engine.js');

const RULES = { K: 3, restrict: false, supply: 24, range: 2 };
const RADIUS = 5;

function rng(s) { return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

// A fixed set of positions: play a scripted game and keep every 6th position.
function positions() {
  const rand = rng(424242);
  const g = new F.Game(RADIUS, RULES);
  const e = new F.Engine(g.geo, RULES, { mob: 0 });
  const out = [];
  let t = 0;
  while (!g.over && g.history.length < 60) {
    if (t % 6 === 0) out.push({ board: g.board.slice(), side: g.toMove, hands: g.hands.slice(), prevPass: !!g.lastPass });
    const L = g.legal();
    let m;
    if (!L.length) m = -1;
    else if (t < 4) m = L[Math.floor(rand() * L.length)];
    else m = e.search(g.board, g.toMove, { timeMs: 1e9, maxDepth: 2, prevPass: g.lastPass, hands: g.hands }).move;
    g.play(m); t++;
  }
  return { geo: g.geo, list: out };
}

function bench() {
  const { geo, list } = positions();
  const e = new F.Engine(geo, RULES, { mob: 0 });
  const rows = [];
  for (const depth of [3, 4, 5, 6]) {
    let nodes = 0, ms = 0;
    for (const p of list) {
      const t = process.hrtime.bigint();
      const r = e.search(p.board, p.side, { timeMs: 1e9, maxDepth: depth, prevPass: p.prevPass, hands: p.hands });
      ms += Number(process.hrtime.bigint() - t) / 1e6;
      nodes += r.nodes;
    }
    rows.push({ depth, positions: list.length, nodes, ms: Math.round(ms), nps: Math.round(nodes / (ms / 1000)), msPerPosition: +(ms / list.length).toFixed(1) });
  }
  // and a whole game, which is what the self-play studies actually pay for
  const rand = rng(99);
  const t0 = Date.now(); let games = 0, turns = 0;
  const eng = [null, new F.Engine(geo, RULES, { mob: 0 }), new F.Engine(geo, RULES, { mob: 0 })];
  while (Date.now() - t0 < 6000) {
    const g = new F.Game(RADIUS, RULES);
    for (let p = 1; p <= 2; p++) { eng[p].ttDepth.fill(-1); eng[p].ttKey.fill(0); }
    let t = 0;
    while (!g.over && g.history.length < 200) {
      const L = g.legal();
      let m;
      if (!L.length) m = -1;
      else if (t < 2) m = L[Math.floor(rand() * L.length)];
      else m = eng[g.toMove].search(g.board, g.toMove, { timeMs: 1e9, maxDepth: 3, prevPass: g.lastPass, hands: g.hands }).move;
      g.play(m); t++;
    }
    games++; turns += g.history.length;
  }
  const secs = (Date.now() - t0) / 1000;
  return { depths: rows, selfPlay: { games, secsPerGame: +(secs / games).toFixed(3), turnsPerGame: Math.round(turns / games) } };
}

if (require.main === module) {
  const r = bench();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log('depth   positions      nodes      ms    nodes/s   ms/position');
  for (const d of r.depths) {
    console.log(`  ${d.depth}         ${String(d.positions).padStart(2)}   ${String(d.nodes).padStart(9)}  ${String(d.ms).padStart(6)}   ${String(d.nps).padStart(8)}   ${String(d.msPerPosition).padStart(6)}`);
  }
  console.log(`\nself-play at depth 3: ${r.selfPlay.secsPerGame}s per game, ${r.selfPlay.turnsPerGame} turns`);
}

module.exports = { bench };

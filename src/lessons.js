// Tutorial lessons: positions only, no prose and no hard-coded numbers.
//
// Each lesson is a small board, the lanterns already on it, and the one move the player must make.
// Everything the tutorial tells the player -- how many cells a lantern lights, how many switch, how
// many lanterns see a given one -- is produced by measure() below, which runs the real engine on the
// lesson position. test/unit/lessons.test.js re-runs every lesson and checks the outcome against the
// verified examples in CLAUDE.md, so a lesson cannot drift away from the rules.
(function (root, factory) {
  const F = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.Fawanees;
  const api = factory(F);
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FawaneesLessons = api;
})(typeof window !== 'undefined' ? window : globalThis, function (F) {
  'use strict';
  const RULES = { K: 3, restrict: false, range: 2 };

  const LESSONS = [
    {
      id: 'light',
      radius: 3,
      setup: [],
      mover: 1,
      target: '0,0',
      // what the lesson claims, checked in the tests
      claim: { litByMover: 12 },
    },
    {
      id: 'block',
      radius: 3,
      setup: [['0,0', 1]],
      mover: 2,
      target: '1,0',
      watch: ['2,0'],
      claim: { watchedLostMoverOpponentLight: true },
    },
    {
      id: 'own',
      radius: 3,
      setup: [['0,0', 1], ['2,-2', 2]],
      mover: 2,
      target: '1,1',
      watch: ['2,0'],
      claim: { watchedBecomesMovers: true },
    },
    {
      id: 'capture',
      radius: 3,
      setup: [['0,0', 2], ['-2,0', 1], ['0,2', 1]],
      mover: 1,
      target: '-2,2',
      watch: ['0,0'],
      claim: { waves: [['0,0']] },
    },
    {
      id: 'protect',
      // The same gold move as 'capture'. The only difference is three friendly lanterns watching
      // the lantern under attack, and that is enough to save it: 3 against 3 does not switch.
      radius: 3,
      setup: [['0,0', 2], ['-2,0', 1], ['0,2', 1], ['2,0', 2], ['2,-2', 2], ['0,-2', 2]],
      mover: 1,
      target: '-2,2',
      watch: ['0,0'],
      claim: { waves: [] },
    },
    {
      id: 'chain',
      // The verified chain example from CLAUDE.md, cell for cell.
      radius: 3,
      setup: [['0,0', 2], ['0,2', 2], ['2,-2', 1], ['0,-2', 1], ['1,2', 1]],
      mover: 1,
      target: '-2,2',
      watch: ['0,0', '0,2'],
      claim: {
        waves: [['0,0'], ['0,2']],
        sightBefore: { '0,0': [2, 1], '0,2': [1, 1] },
        sightAfterPlace: { '0,0': [3, 1], '0,2': [2, 1] },
        sightAfterWave1: { '0,2': [3, 0] },
      },
    },
  ];

  function build(lesson) {
    const geo = F.makeGeometry(lesson.radius);
    geo.range = RULES.range;
    const board = new Int8Array(geo.N);
    lesson.setup.forEach(([key, p]) => { board[geo.index.get(key)] = p; });
    return { geo, board };
  }

  const snap = (geo, board) => {
    const sc = F.makeScratch(geo.N);
    F.computeLight(geo, board, sc);
    let lit1 = 0, lit2 = 0, own1 = 0, own2 = 0, lan1 = 0, lan2 = 0;
    for (let i = 0; i < geo.N; i++) {
      if (board[i] === 1) { lan1++; continue; }
      if (board[i] === 2) { lan2++; continue; }
      if (sc.l1[i] > 0) lit1++;
      if (sc.l2[i] > 0) lit2++;
      if (sc.l1[i] > sc.l2[i]) own1++; else if (sc.l2[i] > sc.l1[i]) own2++;
    }
    return { sc, lit: [0, lit1, lit2], own: [0, own1, own2], lanterns: [0, lan1, lan2], score: [0, lan1 + own1, lan2 + own2] };
  };

  // Runs the lesson through the engine and returns every number the tutorial is allowed to show.
  function measure(lesson) {
    const { geo, board } = build(lesson);
    const key = i => geo.cells[i].q + ',' + geo.cells[i].r;
    const target = geo.index.get(lesson.target);
    const mover = lesson.mover, other = 3 - mover;

    const before = snap(geo, board);
    // the position the moment the lantern lands, before any capture wave resolves
    const placed = board.slice(); placed[target] = mover;
    const atPlacement = snap(geo, placed);

    const after = board.slice();
    const waves = F.applyMove(geo, after, mover, target, RULES, snap(geo, board).sc, true);
    const end = snap(geo, after);

    // the board between wave 1 and wave 2, used by the chain lesson
    const afterWave1 = placed.slice();
    (waves[0] || []).forEach(i => { afterWave1[i] = mover; });
    const midChain = snap(geo, afterWave1);

    const sightAt = (s, k) => [s.sc.s1[geo.index.get(k)], s.sc.s2[geo.index.get(k)]];
    const lightAt = (s, k) => [s.sc.l1[geo.index.get(k)], s.sc.l2[geo.index.get(k)]];

    return {
      geo, board, target, mover, other, waves,
      boards: { before: board, placed, afterWave1, after },
      flipped: waves.reduce((n, w) => n + w.length, 0),
      wavesKeys: waves.map(w => w.map(key)),
      before, atPlacement, midChain, end,
      sightAt, lightAt,
      // how many cells the moving player lights, and the opponent's light on the watched cells
      litByMover: { before: before.lit[mover], placed: atPlacement.lit[mover], after: end.lit[mover] },
      litByOther: { before: before.lit[other], placed: atPlacement.lit[other], after: end.lit[other] },
      score: { before: before.score, after: end.score },
    };
  }

  // Everything each lesson claims, verified against the engine. Throws on the first mismatch.
  function verify(lesson) {
    const m = measure(lesson);
    const c = lesson.claim || {};
    const fail = (what, got, want) => { throw new Error(`${lesson.id}: ${what} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); };
    if (c.litByMover !== undefined && m.atPlacement.lit[m.mover] !== c.litByMover) fail('cells lit by the new lantern', m.atPlacement.lit[m.mover], c.litByMover);
    if (c.waves !== undefined && JSON.stringify(m.wavesKeys) !== JSON.stringify(c.waves)) fail('capture waves', m.wavesKeys, c.waves);
    if (c.watchedLostMoverOpponentLight) {
      const k = lesson.watch[0];
      const bef = m.lightAt(m.before, k)[m.other - 1], aft = m.lightAt(m.end, k)[m.other - 1];
      if (!(bef > 0 && aft === 0)) fail(`opponent light on ${k}`, [bef, aft], 'positive then zero');
    }
    if (c.watchedBecomesMovers) {
      const k = lesson.watch[0];
      const [b1, b2] = m.lightAt(m.before, k), [a1, a2] = m.lightAt(m.end, k);
      const ownedBefore = b1 > b2 ? 1 : b2 > b1 ? 2 : 0, ownedAfter = a1 > a2 ? 1 : a2 > a1 ? 2 : 0;
      if (!(ownedBefore !== m.mover && ownedAfter === m.mover)) fail(`owner of ${k}`, [ownedBefore, ownedAfter], `not ${m.mover}, then ${m.mover}`);
    }
    for (const [what, table, sn] of [['sightBefore', c.sightBefore, m.before], ['sightAfterPlace', c.sightAfterPlace, m.atPlacement], ['sightAfterWave1', c.sightAfterWave1, m.midChain]]) {
      if (!table) continue;
      for (const k of Object.keys(table)) {
        const got = m.sightAt(sn, k);
        if (got[0] !== table[k][0] || got[1] !== table[k][1]) fail(`${what} at ${k} (gold/turquoise)`, got, table[k]);
      }
    }
    return m;
  }

  return { LESSONS, RULES, build, measure, verify };
});

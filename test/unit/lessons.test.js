// Every tutorial lesson is re-played through the real engine here, so a lesson can never
// teach something the rules do not actually do.
const test = require('node:test');
const assert = require('node:assert');
const LS = require('../../src/lessons.js');

test('the tutorial covers light, blocking, ownership, capture, protection and the chain', () => {
  assert.deepStrictEqual(LS.LESSONS.map(l => l.id), ['light', 'block', 'own', 'capture', 'protect', 'chain']);
});

for (const lesson of LS.LESSONS) {
  test(`lesson "${lesson.id}" does what it claims`, () => {
    const m = LS.verify(lesson);
    assert.strictEqual(m.board[m.target], 0, 'the cell the player is told to take must start empty');
    assert.ok(m.geo.N > 0);
    // the lesson must actually change something, or there is nothing to learn from it
    const changed = m.flipped > 0
      || m.end.score[m.mover] !== m.before.score[m.mover]
      || m.end.score[m.other] !== m.before.score[m.other];
    assert.ok(changed, 'the move should visibly change the position');
  });
}

test('the chain lesson reproduces the verified example in CLAUDE.md exactly', () => {
  const m = LS.verify(LS.LESSONS.find(l => l.id === 'chain'));
  // blue at (0,0) and (0,2); gold at (2,-2), (0,-2) and (1,2); gold plays (-2,2)
  assert.deepStrictEqual(m.wavesKeys, [['0,0'], ['0,2']], 'wave 1 switches (0,0), wave 2 switches (0,2)');
  assert.deepStrictEqual(m.sightAt(m.before, '0,0'), [2, 1]);
  assert.deepStrictEqual(m.sightAt(m.before, '0,2'), [1, 1]);
  assert.deepStrictEqual(m.sightAt(m.atPlacement, '0,0'), [3, 1]);
  assert.deepStrictEqual(m.sightAt(m.atPlacement, '0,2'), [2, 1]);
  assert.deepStrictEqual(m.sightAt(m.midChain, '0,2'), [3, 0]);
});

test('protection: 3 enemy and 3 friendly lanterns does not switch, but 3 against 0 does', () => {
  const guarded = LS.verify(LS.LESSONS.find(l => l.id === 'protect'));
  assert.deepStrictEqual(guarded.sightAt(guarded.atPlacement, '0,0'), [3, 3]);
  assert.deepStrictEqual(guarded.wavesKeys, []);

  const bare = LS.verify(LS.LESSONS.find(l => l.id === 'capture'));
  assert.deepStrictEqual(bare.sightAt(bare.atPlacement, '0,0'), [3, 0]);
  assert.deepStrictEqual(bare.wavesKeys, [['0,0']]);

  // the two lessons differ only by the three guards, and use the same move
  const g = LS.LESSONS.find(l => l.id === 'protect'), b = LS.LESSONS.find(l => l.id === 'capture');
  assert.strictEqual(g.target, b.target);
  assert.deepStrictEqual(g.setup.slice(0, b.setup.length), b.setup);
});

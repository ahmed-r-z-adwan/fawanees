// The rules, checked one at a time: light, blocking, ownership, sight, the capture threshold
// (including the 3-against-3 case), chains, passing, running out of lanterns, and the swap rule.
const test = require('node:test');
const assert = require('node:assert');
const F = require('../../src/engine.js');

const RULES = { K: 3, restrict: false, supply: 24, range: 2 };

function setup(radius, lanterns, rules = RULES) {
  const geo = F.makeGeometry(radius);
  geo.range = rules.range || 99;
  const board = new Int8Array(geo.N);
  const at = (q, r) => { const i = geo.index.get(q + ',' + r); assert.notStrictEqual(i, undefined, `(${q},${r}) is off a radius-${radius} board`); return i; };
  lanterns.forEach(([q, r, p]) => { board[at(q, r)] = p; });
  const sc = F.makeScratch(geo.N);
  F.computeLight(geo, board, sc);
  return { geo, board, sc, at, rules };
}
const relight = (s) => { F.computeLight(s.geo, s.board, s.sc); return s; };

// ---------------------------------------------------------------- light

test('a lantern lights two cells in each of its six directions', () => {
  const s = setup(3, [[0, 0, 1]]);
  let lit = 0;
  for (let i = 0; i < s.geo.N; i++) if (s.sc.l1[i] > 0) lit++;
  assert.strictEqual(lit, 12, 'six directions, two cells each');
  assert.strictEqual(s.sc.l1[s.at(1, 0)], 1);
  assert.strictEqual(s.sc.l1[s.at(2, 0)], 1);
  assert.strictEqual(s.sc.l1[s.at(3, 0)], 0, 'and no further');
});

test('light stops at the edge of the board', () => {
  const s = setup(2, [[2, 0, 1]]);                 // a corner cell
  let lit = 0;
  for (let i = 0; i < s.geo.N; i++) if (s.sc.l1[i] > 0) lit++;
  assert.strictEqual(lit, 6, 'only three of the six directions have cells, two each');
});

test('two lanterns lighting the same cell both count', () => {
  const s = setup(3, [[-2, 0, 1], [2, 0, 1]]);
  assert.strictEqual(s.sc.l1[s.at(0, 0)], 2);
});

// ---------------------------------------------------------------- blocking

const litCells = (s, p) => {
  let n = 0;
  for (let i = 0; i < s.geo.N; i++) if (s.board[i] === 0 && (p === 1 ? s.sc.l1 : s.sc.l2)[i] > 0) n++;
  return n;
};

test('an enemy lantern in the way puts out the light behind it', () => {
  const alone = setup(3, [[0, 0, 1]]);
  const blocked = setup(3, [[0, 0, 1], [1, 0, 2]]);
  assert.strictEqual(alone.sc.l1[alone.at(2, 0)], 1);
  assert.strictEqual(blocked.sc.l1[blocked.at(2, 0)], 0, 'the cell behind the blocker goes dark');
  assert.strictEqual(litCells(alone, 1), 12);
  assert.strictEqual(litCells(blocked, 1), 10, 'gold loses the blocked cell and the one the blocker stands on');
  assert.strictEqual(blocked.sc.l1[blocked.at(-1, 0)], 1, 'the other five directions are untouched');
});

test('a friendly lantern blocks too: the beam ends on it, and the friend carries on from there', () => {
  const friendly = setup(3, [[0, 0, 1], [1, 0, 1]]);
  assert.strictEqual(friendly.sc.s1[friendly.at(1, 0)], 1, 'the beam from (0,0) stops on the friendly lantern and sees it');
  // At range 2 the friend reaches exactly as far as the blocked beam would have, so blocking your
  // own light costs nothing along that line -- the light is handed over, not lost.
  assert.strictEqual(friendly.sc.l1[friendly.at(2, 0)], 1, 'and the cell behind is lit by the friend instead');
  assert.strictEqual(friendly.sc.l1[friendly.at(3, 0)], 1, 'which also reaches one cell further than the original could');
});

test('a blocked beam lights nothing beyond the blocker but does see it', () => {
  const s = setup(3, [[0, 0, 1], [2, 0, 2]]);
  assert.strictEqual(s.sc.l1[s.at(1, 0)], 1, 'the cell before the blocker is still lit');
  assert.strictEqual(s.sc.s1[s.at(2, 0)], 1, 'and the blocker is seen by gold');
});

// ---------------------------------------------------------------- ownership and score

test('an empty cell belongs to whoever lights it more, and a tie belongs to nobody', () => {
  const s = setup(3, [[-2, 0, 1], [2, 0, 2]]);
  const c = s.at(0, 0);
  assert.strictEqual(s.sc.l1[c], 1);
  assert.strictEqual(s.sc.l2[c], 1);
  const [a, b] = F.score(s.geo, s.board, s.sc, 0);
  assert.strictEqual(a, b, 'a perfectly mirrored position scores level');

  const s2 = setup(3, [[-2, 0, 1], [2, 0, 2], [0, -2, 1]]);
  assert.strictEqual(s2.sc.l1[s2.at(0, 0)], 2);
  assert.strictEqual(s2.sc.l2[s2.at(0, 0)], 1);
  const [a2, b2] = F.score(s2.geo, s2.board, s2.sc, 0);
  assert.ok(a2 > b2, 'gold now owns the middle');
});

test('score is your lanterns plus the empty cells you own', () => {
  const s = setup(2, [[0, 0, 1]]);
  const [a, b] = F.score(s.geo, s.board, s.sc, 0);
  assert.strictEqual(a, 13, '1 lantern + 12 cells it alone lights');
  assert.strictEqual(b, 0);
});

// ---------------------------------------------------------------- sight

test('only the nearest lantern in a direction sees, so a lantern has at most six seers', () => {
  // gold at distance 1 and at distance 2 along the same line: only the near one sees the target
  const s = setup(3, [[0, 0, 2], [1, 0, 1], [2, 0, 1]]);
  assert.strictEqual(s.sc.s1[s.at(0, 0)], 1, 'the far gold lantern is blocked by the near one');

  const ring = [[2, 0], [2, -2], [0, -2], [-2, 0], [-2, 2], [0, 2]];
  const s2 = setup(3, [[0, 0, 2], ...ring.map(([q, r]) => [q, r, 1])]);
  assert.strictEqual(s2.sc.s1[s2.at(0, 0)], 6, 'six directions, six seers, no more');
});

// ---------------------------------------------------------------- capture threshold

const captureCase = (goldSeers, turqSeers) => {
  // the six lines through the centre, handed out to gold then to turquoise
  const ring = [[2, 0], [2, -2], [0, -2], [-2, 0], [-2, 2], [0, 2]];
  assert.ok(goldSeers + turqSeers <= 6);
  const lanterns = [[0, 0, 2]];
  for (let i = 0; i < goldSeers - 1; i++) lanterns.push([...ring[i], 1]);          // one gold is the move itself
  for (let i = 0; i < turqSeers; i++) lanterns.push([...ring[5 - i], 2]);
  const s = setup(3, lanterns);
  const move = s.at(...ring[goldSeers - 1]);
  const waves = F.applyMove(s.geo, s.board, 1, move, RULES, s.sc, true);
  return { waves, flipped: waves.reduce((n, w) => n + w.length, 0), s, centre: s.geo.index.get('0,0') };
};

test('capture needs three or more seers', () => {
  assert.strictEqual(captureCase(2, 0).flipped, 0, 'two is not enough');
  assert.strictEqual(captureCase(3, 0).flipped, 1, 'three is');
});

test('capture also needs to outnumber the defenders, so 3 against 3 is safe', () => {
  // A lantern has six lines, so it can be seen by at most six others: 3 against 3 is the only
  // way the two sides can be level, and it is the case the rules single out as protection.
  assert.strictEqual(captureCase(3, 3).flipped, 0, 'three against three does not switch');
  assert.strictEqual(captureCase(3, 2).flipped, 1, 'three against two does');
  assert.strictEqual(captureCase(4, 2).flipped, 1, 'four against two does');
  assert.strictEqual(captureCase(2, 0).flipped, 0, 'and two against nobody still is not enough');
});

test('only the mover captures: the lantern just placed cannot be taken on the same turn', () => {
  // turquoise ring around an empty cell; gold places into the middle of it
  const ring = [[2, 0], [2, -2], [0, -2], [-2, 0]];
  const s = setup(3, ring.map(([q, r]) => [q, r, 2]));
  const waves = F.applyMove(s.geo, s.board, 1, s.at(0, 0), RULES, s.sc, true);
  assert.deepStrictEqual(waves, [], 'gold moved, so nothing of gold can switch this turn');
  assert.strictEqual(s.board[s.at(0, 0)], 1, 'and the new lantern is still gold');
  relight(s);
  assert.strictEqual(s.sc.s2[s.at(0, 0)], 4, 'even though four turquoise lanterns can see it');
});

// ---------------------------------------------------------------- chains

test('a switched lantern immediately attacks, which is what makes a chain', () => {
  // the verified example from CLAUDE.md
  const s = setup(3, [[0, 0, 2], [0, 2, 2], [2, -2, 1], [0, -2, 1], [1, 2, 1]]);
  const waves = F.applyMove(s.geo, s.board, 1, s.at(-2, 2), RULES, s.sc, true);
  const name = i => s.geo.cells[i].q + ',' + s.geo.cells[i].r;
  assert.deepStrictEqual(waves.map(w => w.map(name)), [['0,0'], ['0,2']]);
  assert.strictEqual(s.board[s.at(0, 0)], 1);
  assert.strictEqual(s.board[s.at(0, 2)], 1);
});

test('a wave resolves as a set: everything that qualifies switches together', () => {
  // Two turquoise lanterns, each already seen by two gold. One gold lantern in the middle sees
  // both, takes each of them to three, and both switch in the same wave rather than one by one.
  const s = setup(4, [[2, 0, 2], [0, -2, 2], [4, 0, 1], [2, 2, 1], [0, -4, 1], [-2, 0, 1]]);
  assert.deepStrictEqual([s.sc.s1[s.at(2, 0)], s.sc.s2[s.at(2, 0)]], [2, 0], 'safe at two seers');
  assert.deepStrictEqual([s.sc.s1[s.at(0, -2)], s.sc.s2[s.at(0, -2)]], [2, 0], 'safe at two seers');
  const waves = F.applyMove(s.geo, s.board, 1, s.at(0, 0), RULES, s.sc, true);
  const name = i => s.geo.cells[i].q + ',' + s.geo.cells[i].r;
  assert.deepStrictEqual(waves.map(w => w.map(name).sort()), [['0,-2', '2,0']], 'one wave, both lanterns');
  assert.strictEqual(s.board[s.at(2, 0)], 1);
  assert.strictEqual(s.board[s.at(0, -2)], 1);
});

// ---------------------------------------------------------------- passing and the end

test('two passes in a row end the game, one does not', () => {
  const g = new F.Game(3, RULES);
  g.play(-1);
  assert.strictEqual(g.over, false);
  g.play(g.legal()[0]);
  assert.strictEqual(g.over, false, 'a pass answered by a move does not end anything');
  g.play(-1);
  assert.strictEqual(g.over, false);
  g.play(-1);
  assert.strictEqual(g.over, true, 'two in a row does');
});

test('a player runs out of lanterns, and the game ends when neither can place', () => {
  const rules = { K: 3, restrict: false, supply: 2, range: 2 };
  const g = new F.Game(3, rules);
  assert.deepStrictEqual(g.hands, [0, 2, 2]);
  g.play(g.legal()[0]);
  assert.deepStrictEqual(g.hands, [0, 1, 2]);
  g.play(g.legal()[0]);
  g.play(g.legal()[0]);
  assert.strictEqual(g.canPlace(1), false, 'gold has no lanterns left');
  assert.strictEqual(g.over, false, 'but turquoise still has one');
  g.play(g.legal()[0]);
  assert.strictEqual(g.over, true, 'now neither can place');
});

test('passing does not consume a lantern and can be undone', () => {
  const g = new F.Game(3, RULES);
  const first = g.legal()[0];
  g.play(first);
  g.play(-1);
  assert.deepStrictEqual(g.hands, [0, 23, 24]);
  assert.strictEqual(g.toMove, 1);
  g.undo();
  assert.strictEqual(g.toMove, 2);
  assert.strictEqual(g.lastPass, false);
  g.undo();
  assert.strictEqual(g.board[first], 0);
  assert.deepStrictEqual(g.hands, [0, 24, 24]);
});

// ---------------------------------------------------------------- the swap rule

test('the swap is offered only straight after the opening lantern', () => {
  const g = new F.Game(5, RULES);
  assert.strictEqual(g.canSwap(), false, 'not before anything is played');
  g.play(g.legal()[0]);
  assert.strictEqual(g.canSwap(), true);
  g.play(g.legal()[0]);
  assert.strictEqual(g.canSwap(), false, 'not once the second player has answered');

  const g2 = new F.Game(5, RULES);
  g2.play(-1);
  assert.strictEqual(g2.canSwap(), false, 'an opening pass is not a lantern to take');
});

test('taking the opening lantern hands it over and gives the opener the move again', () => {
  const g = new F.Game(5, RULES);
  const cell = g.geo.index.get('-2,1');
  g.play(cell);
  assert.strictEqual(g.board[cell], 1);
  assert.deepStrictEqual(g.hands, [0, 23, 24]);
  assert.strictEqual(g.toMove, 2);

  g.swapOpening();
  assert.strictEqual(g.board[cell], 2, 'the lantern is now the second player\'s');
  assert.deepStrictEqual(g.hands, [0, 24, 23], 'the opener gets their lantern back');
  assert.strictEqual(g.toMove, 1, 'and has to move again, a lantern behind');
  assert.strictEqual(g.canSwap(), false, 'and it cannot happen twice');
  assert.strictEqual(g.swapOpening(), null);
});

test('a swap can be undone', () => {
  const g = new F.Game(5, RULES);
  const cell = g.geo.index.get('3,-1');
  g.play(cell);
  const before = Array.from(g.board);
  g.swapOpening();
  const rec = g.undo();
  assert.strictEqual(rec.swap, true);
  assert.deepStrictEqual(Array.from(g.board), before);
  assert.deepStrictEqual(g.hands, [0, 23, 24]);
  assert.strictEqual(g.toMove, 2, 'it is the second player\'s decision again');
  assert.strictEqual(g.canSwap(), true);
});

test('the total number of lanterns in play is unchanged by a swap', () => {
  const g = new F.Game(5, RULES);
  g.play(g.geo.index.get('0,4'));
  const total = () => g.hands[1] + g.hands[2] + g.board.reduce((n, v) => n + (v ? 1 : 0), 0);
  const t0 = total();
  g.swapOpening();
  assert.strictEqual(total(), t0);
  assert.strictEqual(t0, 48, 'twenty-four each');
});

// Fawanees engine: hex geometry, rules, and search. Works in the browser (window.Fawanees) and in Node.
(function (root) {
  'use strict';
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  function makeGeometry(R) {
    const cells = [];
    const index = new Map();
    for (let q = -R; q <= R; q++) {
      for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
        index.set(q + ',' + r, cells.length);
        cells.push({ q, r });
      }
    }
    const N = cells.length;
    const rayStart = new Int32Array(N * 6), rayLen = new Int32Array(N * 6);
    const flat = [];
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 6; d++) {
        rayStart[i * 6 + d] = flat.length;
        let q = cells[i].q + DIRS[d][0], r = cells[i].r + DIRS[d][1], len = 0;
        while (index.has(q + ',' + r)) { flat.push(index.get(q + ',' + r)); len++; q += DIRS[d][0]; r += DIRS[d][1]; }
        rayLen[i * 6 + d] = len;
      }
    }
    const neighbors = cells.map(c => DIRS.map(([dq, dr]) => index.get((c.q + dq) + ',' + (c.r + dr))).filter(v => v !== undefined));
    return { R, N, cells, index, rayStart, rayLen, rayCells: Int32Array.from(flat), neighbors };
  }

  // Scratch buffers per geometry. `waves` is how many capture waves the last applyMove(Inc) into
  // this scratch ran: the search extends on chains and needs to know a cascade from a single flip.
  function makeScratch(N) {
    return { l1: new Int8Array(N), l2: new Int8Array(N), s1: new Int8Array(N), s2: new Int8Array(N), waves: 0 };
  }

  // light[p][cell]: beams of player p reaching empty cell; sight[p][lantern]: lanterns of p that see this lantern
  function computeLight(geo, board, sc) {
    const N = geo.N, rs = geo.rayStart, rl = geo.rayLen, rc = geo.rayCells, range = geo.range || 99;
    const l1 = sc.l1, l2 = sc.l2, s1 = sc.s1, s2 = sc.s2;
    l1.fill(0); l2.fill(0); s1.fill(0); s2.fill(0);
    for (let i = 0; i < N; i++) {
      const p = board[i];
      if (p === 0) continue;
      const L = p === 1 ? l1 : l2, S = p === 1 ? s1 : s2;
      for (let d = 0; d < 6; d++) {
        const k0 = rs[i * 6 + d], len = rl[i * 6 + d], k1 = k0 + (len < range ? len : range);
        for (let k = k0; k < k1; k++) {
          const j = rc[k];
          if (board[j] === 0) L[j]++;
          else { S[j]++; break; }
        }
      }
    }
  }

  // restrict: a player may not place inside light the opponent controls
  function legalMoves(geo, board, p, sc, out, restrict) {
    const N = geo.N, mine = p === 1 ? sc.l1 : sc.l2, theirs = p === 1 ? sc.l2 : sc.l1;
    let n = 0;
    if (restrict === false) { for (let j = 0; j < N; j++) if (board[j] === 0) out[n++] = j; return n; }
    for (let j = 0; j < N; j++) if (board[j] === 0 && !(theirs[j] > mine[j])) out[n++] = j;
    return n;
  }

  function countLegal(geo, board, p, sc, restrict) {
    const N = geo.N, mine = p === 1 ? sc.l1 : sc.l2, theirs = p === 1 ? sc.l2 : sc.l1;
    let n = 0;
    if (restrict === false) { for (let j = 0; j < N; j++) if (board[j] === 0) n++; return n; }
    for (let j = 0; j < N; j++) if (board[j] === 0 && !(theirs[j] > mine[j])) n++;
    return n;
  }

  // Place p at j, resolve conversions in waves. Returns array of waves (each an array of cell indices) or null if recordWaves=false (returns count).
  function applyMove(geo, board, p, j, rules, sc, recordWaves) {
    board[j] = p;
    const q = 3 - p, N = geo.N, K = rules.K, M = rules.M || 1;
    const waves = recordWaves ? [] : null;
    let total = 0, nw = 0;
    const flips = [];
    for (;;) {
      computeLight(geo, board, sc);
      const sp = p === 1 ? sc.s1 : sc.s2, sq = p === 1 ? sc.s2 : sc.s1;
      flips.length = 0;
      for (let i = 0; i < N; i++) {
        if (board[i] === q && sp[i] >= K && sp[i] >= sq[i] + M) flips.push(i);
      }
      if (flips.length === 0) break;
      const to = rules.capture === 'remove' ? 0 : p;
      for (const i of flips) board[i] = to;
      total += flips.length; nw++;
      if (waves) waves.push(flips.slice());
    }
    sc.waves = nw;
    // light is now valid for the final board
    return recordWaves ? waves : total;
  }

  // ---------- Incremental light ----------
  // Placing or flipping one lantern changes the light on a handful of cells, not on all of them.
  // Keeping the maps up to date costs about 6*range steps instead of a full N*6*range sweep, which
  // is what the search spent most of its time on. Both functions leave `sc` exactly equal to what
  // computeLight would produce for the new board; test/unit/incremental.test.js checks that on
  // random positions, and the engine's behavioural signature is unchanged.

  // Add a lantern of colour p on the empty cell j.
  function placeIncremental(geo, board, sc, j, p) {
    const range = geo.range || 99, rs = geo.rayStart, rl = geo.rayLen, rc = geo.rayCells;
    // 1. Beams that used to pass through j now stop at j, so drop what they lit beyond it.
    for (let d = 0; d < 6; d++) {
      const k0 = rs[j * 6 + d], len = rl[j * 6 + d] < range ? rl[j * 6 + d] : range;
      let x = -1, kb = 0;
      for (let k = 0; k < len; k++) { const c = rc[k0 + k]; if (board[c] !== 0) { x = c; kb = k + 1; break; } }
      if (x < 0) continue;
      const cx = board[x];
      const L = cx === 1 ? sc.l1 : sc.l2, S = cx === 1 ? sc.s1 : sc.s2;
      const o = (d + 3) % 6, p0 = rs[j * 6 + o], beyond = range - kb;
      const plen = rl[j * 6 + o] < beyond ? rl[j * 6 + o] : beyond;
      for (let k = 0; k < plen; k++) {
        const c = rc[p0 + k];
        if (board[c] === 0) L[c]--; else { S[c]--; break; }
      }
    }
    // 2. Every beam that reached j now sees the lantern standing there.
    sc.s1[j] = sc.l1[j]; sc.s2[j] = sc.l2[j];
    sc.l1[j] = 0; sc.l2[j] = 0;
    board[j] = p;
    // 3. The new lantern's own six beams.
    const L = p === 1 ? sc.l1 : sc.l2, S = p === 1 ? sc.s1 : sc.s2;
    for (let d = 0; d < 6; d++) {
      const k0 = rs[j * 6 + d], len = rl[j * 6 + d] < range ? rl[j * 6 + d] : range;
      for (let k = 0; k < len; k++) {
        const c = rc[k0 + k];
        if (board[c] === 0) L[c]++; else { S[c]++; break; }
      }
    }
  }

  // Change the colour of the lantern on cell i. Its beams keep their shape and only change side,
  // and who sees it does not change at all.
  function flipIncremental(geo, board, sc, i, from, to) {
    const range = geo.range || 99, rs = geo.rayStart, rl = geo.rayLen, rc = geo.rayCells;
    const Lf = from === 1 ? sc.l1 : sc.l2, Sf = from === 1 ? sc.s1 : sc.s2;
    const Lt = to === 1 ? sc.l1 : sc.l2, St = to === 1 ? sc.s1 : sc.s2;
    for (let d = 0; d < 6; d++) {
      const k0 = rs[i * 6 + d], len = rl[i * 6 + d] < range ? rl[i * 6 + d] : range;
      for (let k = 0; k < len; k++) {
        const c = rc[k0 + k];
        if (board[c] === 0) { Lf[c]--; Lt[c]++; } else { Sf[c]--; St[c]++; break; }
      }
    }
    board[i] = to;
  }

  // applyMove, but `sc` must already hold the light for `board` and is kept valid throughout.
  function applyMoveInc(geo, board, p, j, rules, sc, recordWaves) {
    if (rules.capture === 'remove') return applyMove(geo, board, p, j, rules, sc, recordWaves);
    placeIncremental(geo, board, sc, j, p);
    const q = 3 - p, N = geo.N, K = rules.K, M = rules.M || 1;
    const sp = p === 1 ? sc.s1 : sc.s2, sq = p === 1 ? sc.s2 : sc.s1;
    const waves = recordWaves ? [] : null;
    let total = 0, nw = 0;
    const flips = [];
    for (;;) {
      flips.length = 0;
      for (let i = 0; i < N; i++) if (board[i] === q && sp[i] >= K && sp[i] >= sq[i] + M) flips.push(i);
      if (flips.length === 0) break;
      for (let k = 0; k < flips.length; k++) flipIncremental(geo, board, sc, flips[k], q, p);
      total += flips.length; nw++;
      if (waves) waves.push(flips.slice());
    }
    sc.waves = nw;
    return recordWaves ? waves : total;
  }

  const copyLight = (dst, src) => { dst.l1.set(src.l1); dst.l2.set(src.l2); dst.s1.set(src.s1); dst.s2.set(src.s2); };

  function scoreWithLight(geo, board, sc, komi) {
    let a = 0, b = komi || 0;
    for (let j = 0; j < geo.N; j++) {
      const v = board[j];
      if (v === 1) a++; else if (v === 2) b++;
      else if (sc.l1[j] > sc.l2[j]) a++; else if (sc.l2[j] > sc.l1[j]) b++;
    }
    return [a, b];
  }

  function score(geo, board, sc, komi) {
    computeLight(geo, board, sc);
    let a = 0, b = komi || 0;
    for (let j = 0; j < geo.N; j++) {
      const v = board[j];
      if (v === 1) a++; else if (v === 2) b++;
      else if (sc.l1[j] > sc.l2[j]) a++; else if (sc.l2[j] > sc.l1[j]) b++;
    }
    return [a, b];
  }

  // ---------- Game (for UI and simulations) ----------
  class Game {
    constructor(R = 4, rules = { K: 3, komi: 0 }) {
      this.geo = makeGeometry(R);
      this.geo.range = rules.range || 99;
      this.rules = rules;
      this.sc = makeScratch(this.geo.N);
      this.board = new Int8Array(this.geo.N);
      this.hands = [0, rules.supply || this.geo.N, rules.supply2 || rules.supply || this.geo.N]; // index by player
      this.toMove = 1;
      this.over = false;
      this.history = []; // {board, toMove, move, player, waves, pass}
      this.moveBuf = new Int32Array(this.geo.N);
    }
    clone() {
      const g = new Game(this.geo.R, this.rules);
      g.board = this.board.slice(); g.toMove = this.toMove; g.over = this.over; g.lastPass = this.lastPass; g.hands = this.hands.slice();
      g.history = this.history.slice();
      return g;
    }
    legal(p = this.toMove) {
      if (this.hands[p] <= 0) return [];
      computeLight(this.geo, this.board, this.sc);
      const n = legalMoves(this.geo, this.board, p, this.sc, this.moveBuf, this.rules.restrict);
      return Array.from(this.moveBuf.subarray(0, n));
    }
    isLegal(j) { return this.legal().includes(j); }
    // j = -1 means pass. Two passes in a row end the game.
    play(j) {
      const p = this.toMove;
      // A placement with an empty supply used to go through and drive hands negative. isLegal()
      // would have caught it but nothing called it, and the page only checked whose turn it was.
      if (j >= 0 && this.hands[p] <= 0) return null;
      const before = this.board.slice();
      const rec = { before, player: p, move: j, waves: [], passed: j < 0, prevLastPass: !!this.lastPass, handsBefore: this.hands.slice() };
      if (j >= 0) { rec.waves = applyMove(this.geo, this.board, p, j, this.rules, this.sc, true); this.hands[p]--; }
      this.history.push(rec);
      if (j < 0 && this.lastPass) this.over = true;
      this.lastPass = j < 0;
      this.toMove = 3 - p;
      if (!this.over) {
        computeLight(this.geo, this.board, this.sc);
        const a = this.hands[this.toMove] > 0 ? countLegal(this.geo, this.board, this.toMove, this.sc, this.rules.restrict) : 0;
        const b = this.hands[p] > 0 ? countLegal(this.geo, this.board, p, this.sc, this.rules.restrict) : 0;
        if (a === 0 && b === 0) this.over = true;
      }
      rec.over = this.over;
      return rec;
    }
    canPlace(p = this.toMove) { if (this.hands[p] <= 0) return false; computeLight(this.geo, this.board, this.sc); return countLegal(this.geo, this.board, p, this.sc, this.rules.restrict) > 0; }
    // Swap rule: right after the opening lantern, and only then, the second player may take it as
    // their own instead of answering it. The lantern changes colour, the opener gets their lantern
    // back in hand, and the opener moves again -- so the taker is now a move ahead.
    canSwap() { return this.history.length === 1 && this.history[0].move >= 0 && !this.history[0].swap; }
    swapOpening() {
      if (!this.canSwap()) return null;
      const j = this.history[0].move, opener = this.history[0].player, taker = 3 - opener;
      const rec = { before: this.board.slice(), player: taker, move: -2, waves: [], passed: false,
                    prevLastPass: !!this.lastPass, handsBefore: this.hands.slice(), swap: true };
      this.board[j] = taker;
      this.hands[opener]++; this.hands[taker]--;
      this.toMove = opener;
      this.lastPass = false;
      this.history.push(rec);
      return rec;
    }
    undo() {
      const rec = this.history.pop();
      if (!rec) return null;
      this.board = rec.before.slice();
      this.toMove = rec.player;
      this.lastPass = rec.prevLastPass;
      this.hands = rec.handsBefore.slice();
      this.over = false;
      return rec;
    }
    score() { return score(this.geo, this.board, this.sc, this.rules.komi); }
    lightMaps() {
      computeLight(this.geo, this.board, this.sc);
      return { l1: this.sc.l1.slice(), l2: this.sc.l2.slice(), s1: this.sc.s1.slice(), s2: this.sc.s2.slice() };
    }
  }

  // ---------- Search ----------
  const WIN = 100000;

  class Engine {
    constructor(geo, rules, weights) {
      this.geo = geo; this.rules = rules;
      this.w = Object.assign({ mob: 0.35, tempo: 0.5 }, weights || {});
      // Search switches, kept apart from the evaluation weights so each can be measured on and off.
      // All on by default; pass any of them in `weights` to change or disable one.
      //   quiesce      search on with capturing moves instead of returning a static value
      //   qPly         how far a capture sequence may run past the horizon
      //   qWidth       how many capturing moves a quiescence node may look at
      //   extend       a capturing move buys depth inside the main search
      //   extendFlips  how many lanterns a single-wave capture has to flip to earn a ply, 0 = never
      //                (a capture that cascaded asks for two plies, whatever this says)
      //   extendMax    extension plies available per path, and the most any one move can buy
      //   extendMin    the shallowest depth that may still extend; 2 leaves the last ply to
      //                quiescence instead of re-opening all ninety-one moves there
      //   captureFirst order capturing moves ahead of the history heuristic
      const dflt = { quiesce: true, qPly: 4, qWidth: 6, extend: true, extendFlips: 0, extendMax: 1, extendMin: 1, captureFirst: true };
      this.s = {}; for (const k in dflt) this.s[k] = (weights && weights[k] !== undefined) ? weights[k] : dflt[k];
      const N = geo.N;
      this.N = N;
      this.maxPly = 80;
      this.boards = []; this.moves = []; this.scs = [];
      for (let i = 0; i <= this.maxPly + 1; i++) {
        this.boards.push(new Int8Array(N)); this.moves.push(new Int32Array(N + 1)); this.scs.push(makeScratch(N));
      }
      this.orderKeys = []; for (let i = 0; i <= this.maxPly + 1; i++) this.orderKeys.push(new Float64Array(N + 1));
      // markCaptures writes here and the caller reads it before it descends, so one buffer is
      // enough: a child node overwrites it only after its parent is finished with it.
      this.gain = new Int16Array(N); this.pending = 0;
      this.lastFlips = 0; this.lastWaves = 0;             // what the last descend() set off
      this.extLeft = new Int8Array(this.maxPly + 2);      // extension plies still available per path
      // Zobrist (two 32-bit halves)
      let seed = 0x9E3779B9;
      const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
      this.zA = new Uint32Array(N * 3); this.zB = new Uint32Array(N * 3);
      for (let i = 0; i < N * 3; i++) { this.zA[i] = rnd(); this.zB[i] = rnd(); }
      this.zSideA = rnd(); this.zSideB = rnd(); this.zPassA = rnd(); this.zPassB = rnd();
      this.zHA = new Uint32Array(2 * 128); this.zHB = new Uint32Array(2 * 128);
      for (let i = 0; i < 256; i++) { this.zHA[i] = rnd(); this.zHB[i] = rnd(); }
      // A 2^20 table is right for the deep searches the page runs. Self-play at shallow depth
      // needs far less, and a table that fits in cache is what makes many parallel workers scale.
      this.ttBits = this.w.ttBits || 20; this.ttSize = 1 << this.ttBits; this.ttMask = this.ttSize - 1;
      this.ttKey = new Uint32Array(this.ttSize); this.ttDepth = new Int8Array(this.ttSize).fill(-1);
      this.ttVal = new Float32Array(this.ttSize); this.ttFlag = new Int8Array(this.ttSize); this.ttMove = new Int16Array(this.ttSize);
      this.history = new Float64Array(3 * N);
    }
    hash(board, side, prevPass, h1, h2) {
      let a = (side === 1 ? 0 : this.zSideA) ^ (prevPass ? this.zPassA : 0) ^ this.zHA[h1 & 127] ^ this.zHA[128 + (h2 & 127)];
      let b = (side === 1 ? 0 : this.zSideB) ^ (prevPass ? this.zPassB : 0) ^ this.zHB[h1 & 127] ^ this.zHB[128 + (h2 & 127)];
      for (let i = 0; i < this.N; i++) { const v = board[i]; a ^= this.zA[i * 3 + v]; b ^= this.zB[i * 3 + v]; }
      return [a >>> 0, b >>> 0];
    }
    // Static evaluation from the point of view of `p`. Light for `board` must already be computed into sc.
    evalWithLight(board, p, sc) {
      const N = this.N;
      let lan1 = 0, lan2 = 0, c1 = 0, c2 = 0, m1 = 0, m2 = 0;
      for (let j = 0; j < N; j++) {
        const v = board[j];
        if (v === 1) lan1++; else if (v === 2) lan2++;
        else {
          const a = sc.l1[j], b = sc.l2[j];
          if (a > b) { c1++; m1++; } else if (b > a) { c2++; m2++; } else { m1++; m2++; }
        }
      }
      let s = (lan1 + c1) - (lan2 + c2) - (this.rules.komi || 0) + this.w.mob * (m1 - m2);
      return p === 1 ? s : -s;
    }
    // `sc` must already hold the light for `board`.
    terminalValue(board, p, sc) {
      const [a, b] = scoreWithLight(this.geo, board, sc, this.rules.komi);
      const d = p === 1 ? a - b : b - a;
      return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0;
    }
    // Set up the child's board and light from the parent's, then apply the move incrementally.
    // Copying four Int8Arrays is a memcpy; recomputing the light was the search's biggest cost.
    descend(board, sc, ply, side, m) {
      const nb = this.boards[ply + 1], nsc = this.scs[ply + 1];
      nb.set(board);
      copyLight(nsc, sc);
      if (m >= 0) { this.lastFlips = applyMoveInc(this.geo, nb, side, m, this.rules, nsc, false); this.lastWaves = nsc.waves; }
      else { this.lastFlips = 0; this.lastWaves = 0; }
      return nb;
    }
    // Which placements flip something, exactly, without playing them out.
    //
    // A placement changes the sight counts in only two ways: the new lantern is seen by the nearest
    // lantern in each of its six directions (+1 for the mover there), and it blocks the one beam
    // that used to pass through the cell (-1 for that beam's colour, on whatever stood behind it).
    // So an enemy lantern can only be flipped from a cell on one of its own six rays, out to the
    // first lantern -- at most twelve cells. Walking targets instead of moves is what makes this
    // cheap enough to run at every node; `legalMoves` costs about the same.
    //
    // Leaves the first-wave flip count per cell in this.gain, and in this.pending the flips that
    // happen wherever the mover plays: a lantern already over the line before the move is taken by
    // any placement at all, so every move is a capture in that position.
    markCaptures(board, side, sc) {
      const N = this.N, rs = this.geo.rayStart, rl = this.geo.rayLen, rc = this.geo.rayCells;
      const range = this.geo.range || 99, K = this.rules.K, M = this.rules.M || 1, q = 3 - side;
      const sp = side === 1 ? sc.s1 : sc.s2, sq = side === 1 ? sc.s2 : sc.s1;
      const gain = this.gain;
      gain.fill(0);
      let pending = 0, any = 0;
      for (let i = 0; i < N; i++) {
        if (board[i] !== q) continue;
        const a = sp[i], b = sq[i];
        if (a >= K && a >= b + M) { pending++; continue; }
        if (a + 1 < K) continue;                       // one more seer still would not be enough
        for (let d = 0; d < 6; d++) {
          const k0 = rs[i * 6 + d], len = rl[i * 6 + d] < range ? rl[i * 6 + d] : range;
          for (let k = 0; k < len; k++) {
            const c = rc[k0 + k];
            if (board[c] !== 0) break;                 // a lantern here, and it hides what is behind
            let da = 1, db = 0;                        // the placement itself sees i
            const back = range - (k + 1);              // only a beam from this close still reached i
            if (back > 0) {
              const b0 = rs[c * 6 + d], blen = rl[c * 6 + d] < back ? rl[c * 6 + d] : back;
              for (let t = 0; t < blen; t++) {
                const x = rc[b0 + t];
                if (board[x] === 0) continue;
                if (board[x] === side) da--; else db--; // that beam now stops on the new lantern
                break;
              }
            }
            if (a + da >= K && a + da >= b + db + M) { gain[c]++; any++; }
          }
        }
      }
      this.pending = pending;
      return pending > 0 || any > 0;
    }
    // One search, run one iteration at a time. The caller decides when the next iteration
    // may start and how long it may take, which is what lets the same search run inside a
    // worker (stream a result per depth) or on the main thread in short slices (never freeze).
    startSearch(board, side, opts = {}) { return new SearchRun(this, board, side, opts); }
    // Exact value for every root move. The ordinary search narrows its window as it goes, so the
    // scores it reports for the also-rans are upper bounds and cannot be compared with each other;
    // here every move gets a full window, which is what "this move is N points better than any
    // other" needs. Costs a few times more, so it is for analysis, not for play.
    rootScoresExact(board, side, depth, opts = {}) {
      const hands = opts.hands || [0, 999, 999];
      const H1 = Math.min(hands[1], 127), H2 = Math.min(hands[2], 127);
      this.deadline = Date.now() + (opts.timeMs ?? 1e9);
      this.nodes = 0; this.stop = false; this.nodeLimit = opts.nodeLimit ?? Infinity;
      this.history.fill(0);
      const b0 = this.boards[0]; b0.set(board);
      const sc0 = this.scs[0];
      computeLight(this.geo, b0, sc0);
      const n = (side === 1 ? H1 : H2) > 0 ? legalMoves(this.geo, b0, side, sc0, this.moves[0], this.rules.restrict) : 0;
      const list = Array.from(this.moves[0].subarray(0, n));
      const out = [];
      for (const m of list) {
        const b1 = this.descend(b0, sc0, 0, side, m);
        this.extLeft[1] = this.s.extendMax;
        const v = -this.negamax(b1, 3 - side, depth - 1, -Infinity, Infinity, 1, false,
                                side === 1 ? H1 - 1 : H1, side === 2 ? H2 - 1 : H2);
        if (this.stop) break;
        out.push({ move: m, score: v });
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    }
    // Blocking convenience wrapper: iterative deepening until the time or depth budget runs out.
    search(board, side, opts = {}) {
      const run = this.startSearch(board, side, opts);
      const budget = opts.timeMs ?? 1000;
      const deadline = Date.now() + budget;
      const onDepth = opts.onDepth, early = opts.earlyExit === true, branch = opts.branchFactor;
      while (!run.finished && Date.now() <= deadline) {
        if (early && run.shouldStopEarly(budget, branch)) break;
        if (!run.step(deadline)) break;
        if (onDepth) onDepth(run.snapshot());
      }
      return run.result();
    }
    // The caller must leave this.scs[ply] holding the light for `board`.
    negamax(board, side, depth, alpha, beta, ply, prevPass, h1, h2) {
      this.nodes++;
      if ((this.nodes & 1023) === 0 && (Date.now() > this.deadline || this.nodes > this.nodeLimit)) this.stop = true;
      if (this.stop) return 0;
      const sc = this.scs[ply];
      const moves = this.moves[ply];
      const myH = side === 1 ? h1 : h2, opH = side === 1 ? h2 : h1;
      let n = myH > 0 ? legalMoves(this.geo, board, side, sc, moves, this.rules.restrict) : 0;
      if (n === 0 && (prevPass || opH <= 0 || countLegal(this.geo, board, 3 - side, sc, this.rules.restrict) === 0)) return this.terminalValue(board, side, sc);
      // The horizon. Stopping here with a capture on the table is the whole problem: a chain
      // detonates one ply past the end of the search and the static value calls the position
      // healthy. So hand over to quiescence, which carries on with capturing moves only.
      if (depth <= 0 || ply >= this.maxPly) {
        if (this.s.quiesce) return this.quiesce(board, side, alpha, beta, ply, prevPass, h1, h2, this.s.qPly, n);
        return this.evalWithLight(board, side, sc) + this.w.tempo;
      }
      // TT probe
      const [ha, hb] = this.hash(board, side, prevPass, h1, h2);
      const slot = ha & this.ttMask;
      let ttMove = -1;
      if (this.ttKey[slot] === hb && this.ttDepth[slot] >= 0) {
        ttMove = this.ttMove[slot];
        if (this.ttDepth[slot] >= depth) {
          const v = this.ttVal[slot], f = this.ttFlag[slot];
          if (f === 0) return v;
          if (f === 1 && v >= beta) return v;
          if (f === 2 && v <= alpha) return v;
        }
      }
      // ordering: TT move first, then captures biggest first, then history.
      // A capture is the only move that shifts the score by more than a point or two, so trying
      // them before the quiet moves is where the cuts come from -- and the cuts are what pays for
      // quiescence. The capture bonus sits a tier above the history scores, which rise by at most
      // depth*depth per cutoff from zero at the start of every search and never reach 1e9.
      const keys = this.orderKeys[ply];
      const hist = this.history, base = side * this.N;
      let gain = null, pend = 0;
      if (this.s.captureFirst) { this.markCaptures(board, side, sc); gain = this.gain; pend = this.pending; }
      moves[n] = -1; n++; // pass is a move; ordered last unless the TT prefers it
      for (let i = 0; i < n; i++) {
        const m = moves[i];
        let k = m === ttMove ? 1e12 : 0;
        if (m < 0) k -= 1;
        else {
          k += hist[base + m];
          if (gain !== null) { const g = gain[m] + pend; if (g > 0) k += 1e9 + 1e4 * g; }
        }
        keys[i] = k;
      }
      // insertion sort (n <= 91)
      for (let i = 1; i < n; i++) {
        const km = keys[i], mm = moves[i]; let k = i - 1;
        while (k >= 0 && keys[k] < km) { keys[k + 1] = keys[k]; moves[k + 1] = moves[k]; k--; }
        keys[k + 1] = km; moves[k + 1] = mm;
      }
      const alpha0 = alpha;
      const ext = this.s.extend ? this.extLeft[ply] : 0;
      let bestVal = -Infinity, bestMove = moves[0];
      for (let i = 0; i < n; i++) {
        const m = moves[i];
        const nb = this.descend(board, sc, ply, side, m);
        // A capture is not a position to stop looking at: a chain is the whole tactical content of
        // this game, so a capturing move buys a ply, and one that actually cascaded buys two. The
        // budget is spent per path, so the tree stays finite and a deep line of quiet moves cannot
        // be pushed past the end of the search by tactics somewhere else.
        let e = 0;
        if (ext > 0 && this.lastFlips > 0 && depth >= this.s.extendMin) {
          if (this.lastWaves >= 2) e = 2;                           // it cascaded: worth two plies
          else if (this.s.extendFlips > 0 && this.lastFlips >= this.s.extendFlips) e = 1;   // a single wave, if big enough
          if (e > ext) e = ext;
        }
        this.extLeft[ply + 1] = ext - e;
        let v;
        if (m < 0) v = prevPass ? this.terminalValue(nb, side, this.scs[ply + 1]) : -this.negamax(nb, 3 - side, depth - 1, -beta, -alpha, ply + 1, true, h1, h2);
        else v = -this.negamax(nb, 3 - side, depth - 1 + e, -beta, -alpha, ply + 1, false, side === 1 ? h1 - 1 : h1, side === 2 ? h2 - 1 : h2);
        if (this.stop) return 0;
        if (v > bestVal) { bestVal = v; bestMove = m; }
        if (v > alpha) alpha = v;
        if (alpha >= beta) { if (m >= 0) hist[base + m] += depth * depth; break; }
      }
      // TT store
      this.ttKey[slot] = hb; this.ttDepth[slot] = depth; this.ttVal[slot] = bestVal; this.ttMove[slot] = bestMove;
      this.ttFlag[slot] = bestVal <= alpha0 ? 2 : bestVal >= beta ? 1 : 0;
      return bestVal;
    }
    // Quiescence: capturing moves only, until the position is quiet.
    //
    // Standing pat is the floor -- nobody is obliged to capture in this game, so the static value is
    // always an option -- and it is also the fail-high test, so a position with nothing to gain
    // costs exactly what the static value cost before. Captures resolve inside the placement, in
    // waves, so there is no answer to one once it has been played: that is why searching them
    // alone is sound here, and why the side that is about to lose a chain cannot talk its way out
    // with a quiet move.
    //
    // Two caps keep it from running away: `qPly` on how far a sequence may run, and `qWidth` on how
    // many captures a node may try -- needed because a lantern already over the line before the move
    // is taken by *any* placement, which would otherwise put all ninety-one cells in the list.
    //
    // `n` is the number of legal moves already sitting in this.moves[ply], or -1 to generate them.
    // The node the main search hands over has been counted and tested already; a node that
    // generates its own is a new one and counts itself.
    quiesce(board, side, alpha, beta, ply, prevPass, h1, h2, qply, n) {
      const sc = this.scs[ply], moves = this.moves[ply];
      const myH = side === 1 ? h1 : h2, opH = side === 1 ? h2 : h1;
      if (n < 0) {
        this.nodes++;
        if ((this.nodes & 1023) === 0 && (Date.now() > this.deadline || this.nodes > this.nodeLimit)) this.stop = true;
        if (this.stop) return 0;
        n = myH > 0 ? legalMoves(this.geo, board, side, sc, moves, this.rules.restrict) : 0;
        if (n === 0 && (prevPass || opH <= 0 || countLegal(this.geo, board, 3 - side, sc, this.rules.restrict) === 0)) return this.terminalValue(board, side, sc);
      }
      const stand = this.evalWithLight(board, side, sc) + this.w.tempo;
      if (stand >= beta || qply <= 0 || n === 0 || ply >= this.maxPly) return stand;
      if (!this.markCaptures(board, side, sc)) return stand;   // quiet already, and this is the common case
      const gain = this.gain, pend = this.pending, keys = this.orderKeys[ply];
      let nc = 0;   // keep only the capturing moves, in place: nc never runs ahead of i
      for (let i = 0; i < n; i++) { const m = moves[i], g = gain[m] + pend; if (g > 0) { moves[nc] = m; keys[nc] = g; nc++; } }
      if (nc === 0) return stand;
      for (let i = 1; i < nc; i++) {   // biggest first (insertion sort, nc <= 91)
        const km = keys[i], mm = moves[i]; let k = i - 1;
        while (k >= 0 && keys[k] < km) { keys[k + 1] = keys[k]; moves[k + 1] = moves[k]; k--; }
        keys[k + 1] = km; moves[k + 1] = mm;
      }
      const w = nc < this.s.qWidth ? nc : this.s.qWidth;
      let best = stand;
      if (stand > alpha) alpha = stand;
      for (let i = 0; i < w; i++) {
        const m = moves[i];
        const nb = this.descend(board, sc, ply, side, m);
        const v = -this.quiesce(nb, 3 - side, -beta, -alpha, ply + 1, false,
                                side === 1 ? h1 - 1 : h1, side === 2 ? h2 - 1 : h2, qply - 1, -1);
        if (this.stop) return 0;
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }
    extractPV(board, side, depth, prevPass, firstMove, H1, H2) {
      const pv = []; const b = board.slice(); let s = side, pp = !!prevPass; const sc = makeScratch(this.N);
      const hh = [0, H1, H2];
      for (let d = 0; d < depth; d++) {
        computeLight(this.geo, b, sc);
        const buf = new Int32Array(this.N);
        const n = hh[s] > 0 ? legalMoves(this.geo, b, s, sc, buf, this.rules.restrict) : 0;
        let m;
        if (d === 0) m = firstMove;
        else {
          const [ha, hb] = this.hash(b, s, pp, hh[1], hh[2]); const slot = ha & this.ttMask;
          if (this.ttKey[slot] !== hb) break;
          m = this.ttMove[slot];
        }
        if (m >= 0 && !Array.from(buf.subarray(0, n)).includes(m)) break;
        pv.push({ move: m, player: s });
        if (m < 0) { if (pp) break; pp = true; }
        else { applyMove(this.geo, b, s, m, this.rules, sc, false); pp = false; hh[s]--; }
        s = 3 - s;
      }
      return pv;
    }
  }

  // One iterative-deepening search, resumable between depths.
  // step(deadline) runs the next depth and returns true if it finished it. If the deadline cut it
  // short it returns false and leaves the depth un-advanced: calling step again retries the same
  // depth, and the transposition table makes the already-searched part nearly free, so a search
  // too big for one slice still converges over several slices.
  class SearchRun {
    constructor(E, board, side, opts) {
      this.E = E; this.side = side;
      this.prevPass = !!opts.prevPass;
      const hands = opts.hands || [0, 999, 999];
      this.H1 = Math.min(hands[1], 127); this.H2 = Math.min(hands[2], 127);
      E.rootH = [0, this.H1, this.H2];
      this.maxDepth = opts.maxDepth ?? 64;
      this.nodeLimit = opts.nodeLimit ?? Infinity;
      E.nodes = 0; E.history.fill(0);
      const b0 = E.boards[0]; b0.set(board);
      this.b0 = b0;
      const sc = E.scs[0];
      computeLight(E.geo, b0, sc);
      this.rootMoves = [];
      const n = (side === 1 ? this.H1 : this.H2) > 0 ? legalMoves(E.geo, b0, side, sc, E.moves[0], E.rules.restrict) : 0;
      for (let i = 0; i < n; i++) this.rootMoves.push({ move: E.moves[0][i], score: 0 });
      this.rootMoves.push({ move: -1, score: 0 }); // pass is always allowed
      this.depth = 0; this.best = null; this.pv = []; this.scores = null;
      this.finished = false;
      this.t0 = Date.now();
      this.lastStepMs = 0;    // how long the last completed iteration took, for the time manager
      this.stepAccumMs = 0;   // time already spent on the iteration in progress, across retries
    }
    step(deadline) {
      const E = this.E;
      if (this.finished) return false;
      const depth = this.depth + 1;
      if (depth > this.maxDepth) { this.finished = true; return false; }
      E.deadline = deadline; E.stop = false; E.nodeLimit = this.nodeLimit;
      const stepStart = Date.now();
      const side = this.side, b0 = this.b0, rootMoves = this.rootMoves, H1 = this.H1, H2 = this.H2;
      let alpha = -Infinity; const beta = Infinity;
      let bestMove = -1, bestVal = -Infinity;
      const scores = [];
      for (let k = 0; k < rootMoves.length; k++) {
        const m = rootMoves[k].move;
        const b1 = E.descend(b0, E.scs[0], 0, side, m);
        E.extLeft[1] = E.s.extendMax;   // a fresh extension budget down every root move
        let v;
        if (m < 0) v = this.prevPass ? E.terminalValue(b1, side, E.scs[1]) : -E.negamax(b1, 3 - side, depth - 1, -beta, -alpha, 1, true, H1, H2);
        else v = -E.negamax(b1, 3 - side, depth - 1, -beta, -alpha, 1, false, side === 1 ? H1 - 1 : H1, side === 2 ? H2 - 1 : H2);
        if (E.stop) break;
        rootMoves[k].score = v; scores.push(v);
        if (v > bestVal) { bestVal = v; bestMove = m; }
        if (v > alpha) alpha = v;
      }
      if (E.stop) {
        // Aborted iteration: keep the previous depth's answer, unless a move searched in full at this
        // depth beat the previous best move (which is always searched first).
        if (this.best && scores.length > 1 && bestMove !== rootMoves[0].move && bestVal > scores[0]) this.best = { move: bestMove, value: this.best.value, depth: this.best.depth };
        else if (!this.best && scores.length) this.best = { move: bestMove, value: bestVal, depth: 0 };
        // The sliced path retries the same depth, so remember what it has already cost.
        this.stepAccumMs += Date.now() - stepStart;
        return false;
      }
      rootMoves.sort((x, y) => y.score - x.score);
      this.lastStepMs = this.stepAccumMs + (Date.now() - stepStart);
      this.stepAccumMs = 0;
      this.depth = depth;
      this.best = { move: bestMove, value: bestVal, depth };
      this.scores = rootMoves.map(r => ({ move: r.move, score: r.score }));
      this.pv = E.extractPV(b0, side, depth, this.prevPass, bestMove, H1, H2);
      if (Math.abs(bestVal) >= WIN - 200) this.finished = true; // forced result: deeper cannot change it
      if (depth >= this.maxDepth) this.finished = true;
      return true;
    }
    // Time management, measured and then switched off by default. The idea was that there is no
    // point starting a ply that cannot finish: each ply costs about six times the one before
    // (sim/timing.js), so most of a budget goes on a ply that gets abandoned.
    //
    // It does halve the thinking time, and the completed depth is the same. But an unfinished ply
    // is not wasted: when one of its fully searched moves beats the previous best, the search takes
    // it, and that happens in 12.5% of searches. Head to head at the same budget with sides swapped
    // (sim/earlyExit.js), the engine that stopped early lost. So the page spends its whole budget,
    // and responsiveness is handled by choosing the budget instead.
    //
    // Pass earlyExit: true to turn it on.
    shouldStopEarly(budgetMs, branch) {
      if (this.finished || this.depth < 2 || !this.lastStepMs) return false;
      return (Date.now() - this.t0) + this.lastStepMs * (branch || 2.5) > budgetMs;
    }
    snapshot() {
      return { depth: this.depth, move: this.best.move, value: this.best.value, nodes: this.E.nodes,
               ms: Date.now() - this.t0, pv: this.pv.slice(), scores: this.scores, side: this.side };
    }
    result() {
      const b = this.best;
      return { move: b ? b.move : this.rootMoves[0].move, value: b ? b.value : 0, depth: this.depth,
               nodes: this.E.nodes, ms: Date.now() - this.t0, pv: this.pv,
               scores: this.scores || this.rootMoves.map(r => ({ move: r.move, score: 0 })), side: this.side };
    }
  }

  const api = { makeGeometry, makeScratch, computeLight, legalMoves, countLegal, applyMove, applyMoveInc,
                placeIncremental, flipIncremental, copyLight, score, scoreWithLight, Game, Engine, SearchRun, WIN, DIRS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fawanees = api;
})(typeof window !== 'undefined' ? window : globalThis);

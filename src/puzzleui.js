// Puzzle mode. The positions are not designed: they are the machine's own games, searched for
// moments where a single move decides things. Everything shown about a puzzle -- how many lanterns
// it flips, how many points it is worth, how deep a machine has to look to find it -- was measured
// when the puzzle was mined, and the chain is replayed by the real engine when the player solves it.
const Puzzles = (function () {
  const DATA = window.FawaneesPuzzles;
  const dlg = document.getElementById('dlgPuzzle');
  const cv = document.getElementById('puzzleBoard');
  const c2 = cv.getContext('2d');

  let idx = 0, pz = null, geoP = null, board0 = null, stage = 'task', tries = 0, hinted = false;
  let animToken = 0;   // moving to another puzzle must abandon a chain that is still playing
  let anim = null, hover = -1, lay = null, solved = new Set();

  const TX = {
    ar: {
      title: 'ألغاز',
      of: (a, b) => `اللغز ${a} من ${b}`,
      task: p => `${p === 1 ? 'الذهبي' : 'الفيروزي'} يلعب. حركة واحدة تقلب الموقف. جدها.`,
      intro: n => `هذه المواقف ليست مؤلَّفة. الآلة لعبت ${n} مباراة ضد نفسها، ثم بحثت في كل موقف مرّ بها عن اللحظات التي تحسمها حركة واحدة.`,
      depthNote: d => d >= 5 ? `آلة تنظر ${d} حركات للأمام هي أول من يرى هذا الحل.` : `آلة تنظر ${d} حركات للأمام ترى هذا الحل.`,
      wrong: (a, b) => `هذه الحركة تقلب ${a}. هناك حركة تقلب ${b}.`,
      wrongQuiet: b => `هذه الحركة لا تقلب شيئاً. هناك حركة تقلب ${b}.`,
      solvedNoHint: 'وجدتها.', solvedHinted: 'وجدتها، بعد التلميح.',
      result: (flips, waves, swing, margin) => [
        `${flips} فوانيس انقلبت، في ${waves === 1 ? 'موجة واحدة' : waves + ' موجات'}.`,
        `الموقف تحرّك ${swing} نقطة لصالحك في حركة واحدة.`,
        `أقرب حركة أخرى أسوأ بـ${margin} نقطة، بحساب بحث عمق ${DATA.verifyDepth}.`,
      ],
      next: 'اللغز التالي', back: 'السابق', close: 'إغلاق', hint: 'تلميح', giveUp: 'أرني الحل',
      hintText: n => `الحل يقلب ${n} من فوانيس الخصم.`,
      done: 'حللت كل الألغاز.',
      counter: (a, b) => `حللت ${a} من ${b}`,
    },
    en: {
      title: 'Puzzles',
      of: (a, b) => `Puzzle ${a} of ${b}`,
      task: p => `${p === 1 ? 'Gold' : 'Turquoise'} to play. One move decides it. Find it.`,
      intro: n => `These positions were not composed. The machine played itself ${n} times, then searched every position it passed through for the moments a single move settles.`,
      depthNote: d => `A machine looking ${d} moves ahead is the first to see this.`,
      wrong: (a, b) => `That move flips ${a}. There is a move that flips ${b}.`,
      wrongQuiet: b => `That move flips nothing. There is a move that flips ${b}.`,
      solvedNoHint: 'Found it.', solvedHinted: 'Found it, after the hint.',
      result: (flips, waves, swing, margin) => [
        `${flips} lanterns switched, in ${waves === 1 ? 'one wave' : waves + ' waves'}.`,
        `The position moved ${swing} points your way in a single move.`,
        `The next best move is ${margin} points worse, at search depth ${DATA.verifyDepth}.`,
      ],
      next: 'Next puzzle', back: 'Back', close: 'Close', hint: 'Hint', giveUp: 'Show me',
      hintText: n => `The answer flips ${n} enemy lanterns.`,
      done: 'You have solved them all.',
      counter: (a, b) => `${a} of ${b} solved`,
    },
  };
  const tx = () => TX[lang] || TX.ar;

  function unpack(p) {
    if (!geoP) { geoP = F.makeGeometry(DATA.radius); geoP.range = RULES.range; }
    const b = new Int8Array(geoP.N);
    for (let i = 0; i < geoP.N; i++) b[i] = p.board.charCodeAt(i) - 48;
    return b;
  }
  const cellOf = k => geoP.index.get(k);

  function layout() {
    const rect = cv.getBoundingClientRect();
    const d = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(rect.width * d); cv.height = Math.round(rect.height * d);
    const R = DATA.radius;
    const size = Math.min(cv.width / (3 * R + 2.2), cv.height / (Math.sqrt(3) * (2 * R + 1) + 0.4));
    lay = { dpr: d, size, cx: cv.width / 2, cy: cv.height / 2 };
  }
  const pos = i => [lay.cx + lay.size * 1.5 * geoP.cells[i].q, lay.cy + lay.size * Math.sqrt(3) * (geoP.cells[i].r + geoP.cells[i].q / 2)];
  function cellAtXY(x, y) {
    const X = (x - lay.cx) / lay.size, Y = (y - lay.cy) / lay.size;
    let q = (2 / 3) * X, r = (-1 / 3) * X + (Math.sqrt(3) / 3) * Y, s = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    const i = geoP.index.get(rq + ',' + rr);
    return i === undefined ? -1 : i;
  }

  function paint() {
    if (!pz || !lay) return;
    const size = lay.size;
    c2.clearRect(0, 0, cv.width, cv.height);
    let board = anim ? anim.board : board0, light = null, flips = null;
    if (stage === 'task' && hover >= 0 && board0[hover] === 0) {
      const b = board0.slice(), sc = F.makeScratch(geoP.N);
      F.computeLight(geoP, b, sc);
      const w = F.applyMoveInc(geoP, b, pz.side, hover, RULES, sc, true);
      board = b; light = sc; flips = new Set([].concat(...w));
    }
    if (!light) { light = F.makeScratch(geoP.N); F.computeLight(geoP, board, light); }
    paintTiles(c2, geoP, pos, size, board, light);
    paintBeams(c2, geoP, pos, size, board);
    if (hinted && stage === 'task') {
      const [x, y] = pos(cellOf(pz.answer));
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 500));
      c2.save(); c2.setLineDash([size * 0.22, size * 0.16]);
      c2.strokeStyle = `rgba(255,226,160,${(0.35 + 0.5 * pulse).toFixed(2)})`;
      c2.lineWidth = Math.max(2, size * 0.1);
      hexPath(c2, x, y, size * 0.86); c2.stroke(); c2.restore();
    }
    const now = performance.now();
    for (let i = 0; i < geoP.N; i++) {
      const p = board[i]; if (!p) continue;
      const [x, y] = pos(i);
      const fresh = anim && anim.born[i] !== undefined ? Math.min(1, Math.max(0, (now - anim.born[i]) / 320)) : 1;
      drawLantern(c2, x, y, size * 0.95 * (0.62 + 0.38 * fresh), p, hover === i && stage === 'task' ? 0.75 : 1, fresh < 1 ? 1.6 - 0.6 * fresh : 1);
      if (flips && flips.has(i)) { c2.strokeStyle = '#ffffff'; c2.lineWidth = Math.max(1.5, size * 0.08); c2.beginPath(); c2.arc(x, y, size * 0.72, 0, Math.PI * 2); c2.stroke(); }
    }
  }
  function loop() { if (!dlg.open) return; paint(); if (anim || (hinted && stage === 'task')) requestAnimationFrame(loop); }

  function load(i) {
    idx = Math.max(0, Math.min(DATA.list.length - 1, i));
    pz = DATA.list[idx];
    board0 = unpack(pz);
    stage = 'task'; anim = null; animToken++; hover = -1; tries = 0; hinted = false;
    render(); layout(); requestAnimationFrame(loop);
  }

  function render(note) {
    const T = tx();
    document.getElementById('puzzleStep').textContent = T.of(idx + 1, DATA.list.length);
    document.getElementById('puzzleCount').textContent = T.counter(solved.size, DATA.list.length);
    const body = document.getElementById('puzzleBody');
    body.innerHTML = '';
    const add = (text, cls) => { const el = document.createElement('p'); el.textContent = text; if (cls) el.className = cls; body.appendChild(el); };
    if (stage === 'task') {
      add(T.task(pz.side), 'learn-task');
      add(T.intro(DATA.games));
      if (hinted) add(T.hintText(pz.flips));
      if (note) add(note, 'learn-result');
    } else {
      add(hinted ? T.solvedHinted : T.solvedNoHint, 'learn-task');
      T.result(pz.flips, pz.waves.length, pz.swing, pz.margin).forEach(l => add(l, 'learn-result'));
      add(T.depthNote(pz.difficulty));
      if (solved.size === DATA.list.length) add(T.done, 'learn-task');
    }
    document.getElementById('puzzleBack').disabled = idx === 0;
    document.getElementById('puzzleBack').textContent = T.back;
    document.getElementById('puzzleHint').hidden = stage !== 'task';
    document.getElementById('puzzleHint').textContent = hinted ? T.giveUp : T.hint;
    const next = document.getElementById('puzzleNext');
    next.textContent = T.next;
    next.hidden = idx >= DATA.list.length - 1;
    document.getElementById('puzzleClose').textContent = T.close;
  }

  function solve() {
    stage = 'result';
    solved.add(idx);
    try { localStorage.setItem('fw-puzzles-solved', JSON.stringify([...solved])); } catch (e) {}
    const target = cellOf(pz.answer);
    const born = {}; born[target] = performance.now();
    const placed = board0.slice(); placed[target] = pz.side;
    const frames = [placed];
    let b = placed;
    pz.waves.forEach(w => { b = b.slice(); w.forEach(k => { b[cellOf(k)] = pz.side; }); frames.push(b); });
    anim = { board: frames[0], born };
    const token = ++animToken;
    let f = 0;
    const advance = () => {
      if (token !== animToken || !anim) return;     // the player has already moved on
      f++;
      if (f >= frames.length) { anim = null; board0 = frames[frames.length - 1]; paint(); return; }
      (pz.waves[f - 1] || []).forEach(k => { born[cellOf(k)] = performance.now(); });
      anim.board = frames[f];
      setTimeout(advance, reduceMotion ? 0 : 620);
    };
    setTimeout(advance, reduceMotion ? 0 : 420);
    requestAnimationFrame(loop);
    render();
  }

  function tryCell(i) {
    if (stage !== 'task' || i < 0 || board0[i] !== 0) return;
    if (i === cellOf(pz.answer)) return solve();
    tries++;
    const b = board0.slice(), sc = F.makeScratch(geoP.N);
    F.computeLight(geoP, b, sc);
    const n = F.applyMoveInc(geoP, b, pz.side, i, RULES, sc, false);
    hover = i;
    render(n > 0 ? tx().wrong(n, pz.flips) : tx().wrongQuiet(pz.flips));
    paint();
  }

  const pointer = e => { const r = cv.getBoundingClientRect(); return cellAtXY((e.clientX - r.left) * lay.dpr, (e.clientY - r.top) * lay.dpr); };
  cv.addEventListener('click', e => tryCell(pointer(e)));
  cv.addEventListener('mousemove', e => {
    if (stage !== 'task' || matchMedia('(hover: none)').matches) return;
    const i = pointer(e), h = (i >= 0 && board0[i] === 0) ? i : -1;
    if (h !== hover) { hover = h; paint(); }
  });
  cv.addEventListener('mouseleave', () => { if (hover >= 0 && stage === 'task') { hover = -1; paint(); } });
  document.getElementById('puzzleNext').onclick = () => load(idx + 1);
  document.getElementById('puzzleBack').onclick = () => load(idx - 1);
  document.getElementById('puzzleHint').onclick = () => { if (hinted) return solve(); hinted = true; render(); paint(); requestAnimationFrame(loop); };
  window.addEventListener('resize', () => { if (dlg.open) { layout(); paint(); } });

  try { JSON.parse(localStorage.getItem('fw-puzzles-solved') || '[]').forEach(i => solved.add(i)); } catch (e) {}

  return {
    open(at) {
      // start on the first unsolved one
      let start = at;
      if (start === undefined) { start = 0; while (start < DATA.list.length - 1 && solved.has(start)) start++; }
      load(start);
      if (!dlg.open) dlg.showModal();
      layout(); requestAnimationFrame(loop);
    },
    relabel() { if (dlg.open) { render(); paint(); } },
    get index() { return idx; },
    get stage() { return stage; },
    get count() { return DATA.list.length; },
    answerXY() { const [x, y] = pos(cellOf(pz.answer)); return [x / lay.dpr, y / lay.dpr]; },
    cellXY(k) { const [x, y] = pos(cellOf(k)); return [x / lay.dpr, y / lay.dpr]; },
    current() { return pz; },
  };
})();

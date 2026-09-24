// Interactive tutorial. Inlined inside the page's main closure, so it shares the board painters,
// the colours and the language switch with the game itself.
//
// Six lessons: light, blocking, cell ownership, capture, protection (3 against 3), and the chain.
// Every lesson is a real position played by the real engine -- the player makes the move themselves
// and the numbers in the explanation are read back out of the engine, never written by hand.
// The positions live in src/lessons.js and are checked in test/unit/lessons.test.js.
const Tutorial = (function () {
  const LS = window.FawaneesLessons;
  const dlg = document.getElementById('dlgLearn');
  const cv = document.getElementById('learnBoard');
  const c2 = cv.getContext('2d');

  let step = 0, lesson = null, m = null, stage = 'task', anim = null, hoverCell = -1, lay = null;
let animToken = 0;   // moving to another lesson must abandon a chain that is still playing

  const TX = {
    ar: {
      title: 'تعلّم اللعب',
      of: (a, b) => `الدرس ${a} من ${b}`,
      next: 'الدرس التالي', back: 'السابق', close: 'إغلاق', retry: 'أعد المحاولة', finish: 'ابدأ اللعب',
      play: 'ضع الفانوس في الخانة المعلّمة',
      tapTarget: 'اضغط الخانة المعلّمة',
      wrongCell: 'ليست هذه. اضغط الخانة المعلّمة ذات الحلقة المتقطّعة.',
      goldName: 'الذهبي', turqName: 'الفيروزي',
      youPlay: p => `أنت تلعب ${p === 1 ? 'الذهبي' : 'الفيروزي'}`,
      lessons: {
        light: {
          name: 'الضوء',
          task: 'ضع فانوسك في مركز اللوح.',
          intro: 'كل فانوس يضيء خانتين في كل اتجاه من اتجاهاته الستة.',
          done: (m) => [
            `فانوس واحد في المركز أضاء ${m.atPlacement.lit[m.mover]} خانة: خانتان في كل اتجاه من الستة.`,
            `نقاطك الآن ${m.end.score[m.mover]}: الفانوس نفسه، والخانات التي تضيئها وحدك.`,
          ],
        },
        block: {
          name: 'الحجب',
          task: 'ضع فانوسك في الخانة المعلّمة، ملاصقاً للفانوس الذهبي.',
          intro: 'الضوء لا يمرّ عبر الفوانيس. أي فانوس يحجب الضوء، حتى لو كان لك.',
          done: (m, k) => [
            `الخانة التي خلف فانوسك كان يضيئها الذهبي. الآن فانوسك يحجب الشعاع، فلم تعد مضاءة منه.`,
            `خانات الذهبي المضاءة نزلت من ${m.before.lit[m.other]} إلى ${m.end.lit[m.other]}، ونقاطه من ${m.before.score[m.other]} إلى ${m.end.score[m.other]}.`,
            `الحجب سلاح: خانة واحدة في المكان الصحيح تقصّ شعاعاً كاملاً.`,
          ],
        },
        own: {
          name: 'ملكية الخانة',
          task: 'ضع فانوسك بحيث تضيء الخانة المعلّمة بفانوسين مقابل فانوس واحد للذهبي.',
          intro: 'الخانة الفارغة لمن يضيئها بعدد فوانيس أكبر. والتعادل لا يملكه أحد.',
          done: (m, k) => [
            `الخانة المعلّمة كانت ${m.lightAt(m.before, k)[0]} ذهبي مقابل ${m.lightAt(m.before, k)[1]} فيروزي: تعادل، فلا يملكها أحد.`,
            `صارت ${m.lightAt(m.end, k)[0]} مقابل ${m.lightAt(m.end, k)[1]}، فأصبحت لك.`,
            `نقاطك ارتفعت من ${m.before.score[m.mover]} إلى ${m.end.score[m.mover]}.`,
          ],
        },
        capture: {
          name: 'الأسر',
          task: 'ضع فانوسك الثالث بحيث يرى الفانوس الفيروزي.',
          intro: 'فانوس يرى فانوساً آخر إذا كانا على خط مستقيم، على بعد خانتين أو أقل، ولا فانوس بينهما. إذا رأى ثلاثة من فوانيسك فانوساً للخصم، وكانوا أكثر من فوانيسه التي تراه، انقلب إليك.',
          done: (m, k) => [
            `قبل حركتك كان الفيروزي يراه ${m.sightAt(m.before, k)[0]} من فوانيسك فقط: أقل من ثلاثة، فكان بأمان.`,
            `بفانوسك الجديد صاروا ${m.sightAt(m.atPlacement, k)[0]} مقابل ${m.sightAt(m.atPlacement, k)[1]} له، فانقلب إليك.`,
            `نقاطك قفزت من ${m.before.score[m.mover]} إلى ${m.end.score[m.mover]}.`,
          ],
        },
        protect: {
          name: 'الحماية',
          task: 'نفس الحركة تماماً. ضع فانوسك في الخانة المعلّمة.',
          intro: 'الوضع نفسه، لكن للفيروزي ثلاثة فوانيس تحرس فانوسه. جرّب الحركة التي نجحت قبل قليل.',
          done: (m, k) => [
            `فانوسك الثالث وصل: ${m.sightAt(m.atPlacement, k)[0]} من فوانيسك ترى الفانوس الفيروزي.`,
            `لكن ${m.sightAt(m.atPlacement, k)[1]} من فوانيسه تراه أيضاً. ثلاثة مقابل ثلاثة لا تكفي: الأسر يحتاج أكثر، لا مساوياً.`,
            `لم ينقلب شيء. الحراسة المتبادلة هي الدفاع الحقيقي في هذه اللعبة.`,
          ],
        },
        chain: {
          name: 'السلسلة',
          task: 'ضع فانوسك في الخانة المعلّمة وراقب الفانوسين الفيروزيين.',
          intro: 'عندما ينقلب فانوس، يغيّر لونه فوراً، فيصير يهاجم بدل أن يحمي. والفحص يتكرّر في موجات حتى يستقر اللوح.',
          done: (m) => [
            `قبل الحركة: الفانوس (أ) يراه ${m.sightAt(m.before, '0,0')[0]} من فوانيسك مقابل ${m.sightAt(m.before, '0,0')[1]} من فوانيسه، و(ب) يراه ${m.sightAt(m.before, '0,2')[0]} مقابل ${m.sightAt(m.before, '0,2')[1]}. الاثنان بأمان.`,
            `بعد فانوسك: (أ) صار ${m.sightAt(m.atPlacement, '0,0')[0]} مقابل ${m.sightAt(m.atPlacement, '0,0')[1]}، فانقلب إليك. هذه الموجة الأولى.`,
            `وبانقلابه خسر (ب) حارسه وكسب مهاجماً: صار ${m.sightAt(m.midChain, '0,2')[0]} مقابل ${m.sightAt(m.midChain, '0,2')[1]}، فانقلب هو أيضاً. هذه الموجة الثانية.`,
            `حركة واحدة قلبت ${m.flipped} من فوانيس الخصم، وأضافت لك ${m.end.score[m.mover] - m.before.score[m.mover]} نقطة.`,
          ],
        },
      },
      outro: 'هذه كل القواعد. الباقي لك.',
    },
    en: {
      title: 'Learn to play',
      of: (a, b) => `Lesson ${a} of ${b}`,
      next: 'Next lesson', back: 'Back', close: 'Close', retry: 'Try again', finish: 'Start playing',
      play: 'Place the lantern on the marked cell',
      tapTarget: 'Tap the marked cell',
      wrongCell: 'Not that one. Tap the marked cell with the dashed ring.',
      goldName: 'Gold', turqName: 'Turquoise',
      youPlay: p => `You play ${p === 1 ? 'gold' : 'turquoise'}`,
      lessons: {
        light: {
          name: 'Light',
          task: 'Place your lantern in the centre of the board.',
          intro: 'Every lantern lights two cells in each of its six directions.',
          done: (m) => [
            `One lantern in the centre lit ${m.atPlacement.lit[m.mover]} cells: two in each of the six directions.`,
            `You now have ${m.end.score[m.mover]} points: the lantern itself, plus the cells only you light.`,
          ],
        },
        block: {
          name: 'Blocking',
          task: 'Place your lantern on the marked cell, right next to the gold one.',
          intro: 'Light does not pass through lanterns. Any lantern blocks it, including your own.',
          done: (m, k) => [
            `The cell behind your lantern was lit by gold. Now it is not.`,
            `Gold went from lighting ${m.before.lit[m.other]} cells to ${m.end.lit[m.other]}, and from ${m.before.score[m.other]} points to ${m.end.score[m.other]}.`,
            `Blocking is a weapon: one cell in the right place cuts a whole beam.`,
          ],
        },
        own: {
          name: 'Owning a cell',
          task: 'Place your lantern so the marked cell is lit by two of yours against one gold.',
          intro: 'An empty cell belongs to whoever lights it with more lanterns. A tie belongs to nobody.',
          done: (m, k) => [
            `The marked cell was ${m.lightAt(m.before, k)[0]} gold against ${m.lightAt(m.before, k)[1]} turquoise: a tie, so nobody owned it.`,
            `It is now ${m.lightAt(m.end, k)[0]} against ${m.lightAt(m.end, k)[1]}, so it is yours.`,
            `Your score went from ${m.before.score[m.mover]} to ${m.end.score[m.mover]}.`,
          ],
        },
        capture: {
          name: 'Capture',
          task: 'Place your third lantern so that it sees the turquoise one.',
          intro: 'A lantern sees another if they are on one straight line, two cells apart or closer, with nothing between them. If three of your lanterns see an enemy lantern, and they outnumber the ones defending it, it switches to you.',
          done: (m, k) => [
            `Before your move only ${m.sightAt(m.before, k)[0]} of your lanterns saw it: fewer than three, so it was safe.`,
            `With your new lantern that is ${m.sightAt(m.atPlacement, k)[0]} against ${m.sightAt(m.atPlacement, k)[1]} of its own, so it switched.`,
            `Your score jumped from ${m.before.score[m.mover]} to ${m.end.score[m.mover]}.`,
          ],
        },
        protect: {
          name: 'Protection',
          task: 'Exactly the same move. Place your lantern on the marked cell.',
          intro: 'The same position, except turquoise has three lanterns guarding it. Try the move that just worked.',
          done: (m, k) => [
            `Your third lantern arrived: ${m.sightAt(m.atPlacement, k)[0]} of yours see the turquoise lantern.`,
            `But ${m.sightAt(m.atPlacement, k)[1]} of its own see it too. Three against three is not enough: capture needs more, not equal.`,
            `Nothing switched. Guarding each other is the real defence in this game.`,
          ],
        },
        chain: {
          name: 'The chain',
          task: 'Place your lantern on the marked cell and watch both turquoise lanterns.',
          intro: 'A lantern that switches changes colour at once, so it starts attacking instead of defending. The check repeats in waves until the board settles.',
          done: (m) => [
            `Before the move, (A) was seen by ${m.sightAt(m.before, '0,0')[0]} gold and ${m.sightAt(m.before, '0,0')[1]} turquoise, and (B) by ${m.sightAt(m.before, '0,2')[0]} and ${m.sightAt(m.before, '0,2')[1]}. Both safe.`,
            `After your lantern: (A) is ${m.sightAt(m.atPlacement, '0,0')[0]} against ${m.sightAt(m.atPlacement, '0,0')[1]}, so it switches. Wave one.`,
            `And with it gone, (B) lost its guard and gained an attacker: ${m.sightAt(m.midChain, '0,2')[0]} against ${m.sightAt(m.midChain, '0,2')[1]}, so it switches too. Wave two.`,
            `One move, ${m.flipped} lanterns, ${m.end.score[m.mover] - m.before.score[m.mover]} points.`,
          ],
        },
      },
      outro: 'That is all the rules. The rest is up to you.',
    },
  };

  const tx = () => TX[lang] || TX.ar;

  function layout() {
    const rect = cv.getBoundingClientRect();
    const d = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(rect.width * d); cv.height = Math.round(rect.height * d);
    const R = lesson.radius;
    const size = Math.min(cv.width / (3 * R + 2.2), cv.height / (Math.sqrt(3) * (2 * R + 1) + 0.4));
    lay = { dpr: d, size, cx: cv.width / 2, cy: cv.height / 2 };
  }
  const pos = i => [lay.cx + lay.size * 1.5 * m.geo.cells[i].q, lay.cy + lay.size * Math.sqrt(3) * (m.geo.cells[i].r + m.geo.cells[i].q / 2)];

  function cellAtXY(x, y) {
    const X = (x - lay.cx) / lay.size, Y = (y - lay.cy) / lay.size;
    let q = (2 / 3) * X, r = (-1 / 3) * X + (Math.sqrt(3) / 3) * Y, s = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    const i = m.geo.index.get(rq + ',' + rr);
    return i === undefined ? -1 : i;
  }

  // Which board to show: the start position, or the animation's current frame, or the end.
  function shownBoard() {
    if (stage === 'task') {
      if (hoverCell >= 0 && hoverCell !== m.target) return m.boards.before; // preview handled separately
      return m.boards.before;
    }
    return anim ? anim.board : m.boards.after;
  }

  function paint() {
    if (!m) return;
    const size = lay.size;
    c2.clearRect(0, 0, cv.width, cv.height);
    let board = shownBoard(), light = null, flips = null;
    // preview of a cell the player is considering
    if (stage === 'task' && hoverCell >= 0 && m.boards.before[hoverCell] === 0) {
      const b = m.boards.before.slice();
      const sc = window.Fawanees.makeScratch(m.geo.N);
      const w = window.Fawanees.applyMove(m.geo, b, m.mover, hoverCell, LS.RULES, sc, true);
      board = b; light = sc; flips = new Set([].concat(...w));
    }
    if (!light) { light = window.Fawanees.makeScratch(m.geo.N); window.Fawanees.computeLight(m.geo, board, light); }
    paintTiles(c2, m.geo, pos, size, board, light);
    paintBeams(c2, m.geo, pos, size, board);
    // the cell the player has to play
    if (stage === 'task') {
      const [x, y] = pos(m.target);
      const pulse = reduceMotion ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 520));
      c2.save();
      c2.setLineDash([size * 0.22, size * 0.16]);
      c2.strokeStyle = `rgba(255,226,160,${(0.45 + 0.55 * pulse).toFixed(2)})`;
      c2.lineWidth = Math.max(2, size * 0.1);
      hexPath(c2, x, y, size * 0.86); c2.stroke();
      c2.restore();
    }
    // lanterns
    const now = performance.now();
    for (let i = 0; i < m.geo.N; i++) {
      const p = board[i]; if (!p) continue;
      const [x, y] = pos(i);
      const fresh = anim && anim.born && anim.born[i] !== undefined ? Math.min(1, Math.max(0, (now - anim.born[i]) / 320)) : 1;
      drawLantern(c2, x, y, size * 0.95 * (0.62 + 0.38 * fresh), p, hoverCell === i && stage === 'task' ? 0.75 : 1, fresh < 1 ? 1.6 - 0.6 * fresh : 1);
      if (flips && flips.has(i)) { c2.strokeStyle = '#ffffff'; c2.lineWidth = Math.max(1.5, size * 0.08); c2.beginPath(); c2.arc(x, y, size * 0.72, 0, Math.PI * 2); c2.stroke(); }
    }
    // labels on the lanterns the lesson asks the player to watch
    (lesson.watch || []).forEach((k, n) => {
      const i = m.geo.index.get(k), [x, y] = pos(i);
      const r = Math.max(8, size * 0.3), bx = x + size * 0.6, by = y - size * 0.6;
      c2.fillStyle = '#ffffff'; c2.beginPath(); c2.arc(bx, by, r, 0, Math.PI * 2); c2.fill();
      c2.fillStyle = '#15112a'; c2.font = `700 ${Math.round(r * 1.25)}px "IBM Plex Sans Arabic", sans-serif`;
      c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(lang === 'ar' ? ['أ', 'ب', 'ج'][n] : ['A', 'B', 'C'][n], bx, by);
    });
  }

  function loop() {
    if (!dlg.open) return;
    paint();
    if (anim || (stage === 'task' && !reduceMotion)) requestAnimationFrame(loop);
  }

  function load(i) {
    step = Math.max(0, Math.min(LS.LESSONS.length - 1, i));
    lesson = LS.LESSONS[step];
    m = LS.measure(lesson);
    stage = 'task'; anim = null; animToken++; hoverCell = -1;
    render();
    layout(); requestAnimationFrame(loop);
  }

  function render() {
    const T = tx(), L = T.lessons[lesson.id];
    document.getElementById('learnStep').textContent = T.of(step + 1, LS.LESSONS.length);
    document.getElementById('learnName').textContent = L.name;
    document.getElementById('learnSide').textContent = T.youPlay(m.mover);
    const body = document.getElementById('learnBody');
    body.innerHTML = '';
    const add = (text, cls) => { const el = document.createElement('p'); el.textContent = text; if (cls) el.className = cls; body.appendChild(el); return el; };
    add(L.intro);
    if (stage === 'task') add(L.task, 'learn-task');
    else {
      const k = (lesson.watch || [])[0];
      L.done(m, k).forEach(line => add(line, 'learn-result'));
      if (step === LS.LESSONS.length - 1) add(T.outro, 'learn-task');
    }
    document.getElementById('learnBack').disabled = step === 0;
    document.getElementById('learnBack').textContent = T.back;
    // The board is a canvas, so this button is the keyboard route through the lesson.
    const play = document.getElementById('learnPlay');
    play.hidden = stage !== 'task';
    play.textContent = T.play;
    const next = document.getElementById('learnNext');
    next.hidden = stage === 'task';
    next.textContent = step === LS.LESSONS.length - 1 ? T.finish : T.next;
    document.getElementById('learnHint').textContent = stage === 'task' ? T.tapTarget : '';
    document.getElementById('learnClose').textContent = T.close;
  }

  function playTarget() {
    if (stage !== 'task') return;
    stage = 'result';
    const born = {}; const t0 = performance.now();
    born[m.target] = t0;
    // step through the capture waves so the chain is visible rather than instantaneous
    const frames = [m.boards.placed.slice()];
    let b = m.boards.placed.slice();
    m.waves.forEach(w => { b = b.slice(); w.forEach(i => { b[i] = m.mover; }); frames.push(b); });
    anim = { board: frames[0], born };
    const token = ++animToken;
    let f = 0;
    const advance = () => {
      if (token !== animToken || !anim) return;     // the player has already moved on
      f++;
      if (f >= frames.length) { anim = null; paint(); return; }
      (m.waves[f - 1] || []).forEach(i => { born[i] = performance.now(); });
      anim.board = frames[f];
      setTimeout(advance, reduceMotion ? 0 : 620);
    };
    setTimeout(advance, reduceMotion ? 0 : 420);
    requestAnimationFrame(loop);
    render();
  }

  function pointer(e) {
    const r = cv.getBoundingClientRect();
    return cellAtXY((e.clientX - r.left) * lay.dpr, (e.clientY - r.top) * lay.dpr);
  }
  cv.addEventListener('click', e => {
    if (stage !== 'task') return;
    const i = pointer(e);
    if (i === m.target) return playTarget();
    if (i >= 0 && m.boards.before[i] === 0) { hoverCell = i; paint(); document.getElementById('learnHint').textContent = tx().wrongCell; }
  });
  cv.addEventListener('mousemove', e => {
    if (stage !== 'task' || matchMedia('(hover: none)').matches) return;
    const i = pointer(e); const h = (i >= 0 && m.boards.before[i] === 0) ? i : -1;
    if (h !== hoverCell) { hoverCell = h; paint(); }
  });
  cv.addEventListener('mouseleave', () => { if (hoverCell >= 0) { hoverCell = -1; paint(); } });

  document.getElementById('learnNext').onclick = () => {
    if (step === LS.LESSONS.length - 1) { dlg.close(); return; }
    load(step + 1);
  };
  document.getElementById('learnBack').onclick = () => load(step - 1);
  document.getElementById('learnPlay').onclick = () => playTarget();
  window.addEventListener('resize', () => { if (dlg.open) { layout(); paint(); } });

  return {
    open(at) {
      load(at || 0);
      if (!dlg.open) dlg.showModal();
      layout(); requestAnimationFrame(loop);
    },
    relabel() { if (dlg.open) { render(); paint(); } },
    get step() { return step; },
    get stage() { return stage; },
    get lessonId() { return lesson ? lesson.id : null; },
    get lessonCount() { return LS.LESSONS.length; },
    targetXY() { const [x, y] = pos(m.target); return [x / lay.dpr, y / lay.dpr]; },
  };
})();

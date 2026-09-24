// Runs inside the Web Worker. engine.js is prepended to this file when the worker Blob is built,
// so `Fawanees` is already defined here.
//
// Protocol
//   in : {type:'ping'}
//        {type:'search', id, radius, rules, board:ArrayBuffer, side, opts}
//   out: {type:'ready'}
//        {type:'depth', id, depth, move, value, nodes, ms, pv, scores, side}   one per completed depth
//        {type:'done',  id, ...same shape}                                      final answer
//        {type:'fail',  id, error}
'use strict';
(function () {
  const F = self.Fawanees;
  let engine = null, engineKey = '';

  function engineFor(radius, rules) {
    const key = radius + '|' + JSON.stringify(rules);
    if (!engine || engineKey !== key) {
      const geo = F.makeGeometry(radius);
      geo.range = rules.range || 99;
      engine = new F.Engine(geo, rules, { mob: 0 });
      engineKey = key;
    }
    return engine;
  }

  self.onmessage = function (ev) {
    const msg = ev.data;
    if (!msg) return;
    if (msg.type === 'ping') { self.postMessage({ type: 'ready' }); return; }
    if (msg.type !== 'search') return;
    try {
      const E = engineFor(msg.radius, msg.rules);
      const board = new Int8Array(msg.board);
      const opts = msg.opts || {};
      const run = E.startSearch(board, msg.side, opts);
      const deadline = Date.now() + (opts.timeMs ?? 1000);
      while (!run.finished && Date.now() <= deadline) {
        if (!run.step(deadline)) break;
        const s = run.snapshot();
        s.type = 'depth'; s.id = msg.id;
        self.postMessage(s);
      }
      const r = run.result();
      r.type = 'done'; r.id = msg.id;
      self.postMessage(r);
    } catch (err) {
      self.postMessage({ type: 'fail', id: msg.id, error: String((err && err.message) || err) });
    }
  };
})();

// A worker_threads pool that spreads self-play games across every core.
//
// The caller supplies a list of jobs. Each job is a plain object describing games to play;
// the worker file turns it into a result object. Results come back in job order.
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

function runPool(workerFile, jobs, { threads = Math.max(1, os.cpus().length - 1), onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const results = new Array(jobs.length);
    let next = 0, done = 0, failed = false;
    const n = Math.min(threads, jobs.length) || 1;
    const workers = [];
    const t0 = Date.now();

    const give = (w) => {
      if (failed) return;
      if (next >= jobs.length) { w.postMessage({ type: 'bye' }); return; }
      const i = next++;
      w.postMessage({ type: 'job', index: i, job: jobs[i] });
    };

    for (let k = 0; k < n; k++) {
      const w = new Worker(path.resolve(workerFile));
      workers.push(w);
      w.on('message', (m) => {
        results[m.index] = m.result;
        done++;
        if (onProgress) onProgress(done, jobs.length, Date.now() - t0, m.result);
        give(w);
      });
      w.on('error', (e) => { if (!failed) { failed = true; reject(e); } workers.forEach(x => x.terminate()); });
      w.on('exit', () => {
        if (failed) return;
        if (done === jobs.length && workers.every(x => x.threadId === -1 || x === w)) { /* handled below */ }
      });
      give(w);
    }

    const check = setInterval(() => {
      if (failed) { clearInterval(check); return; }
      if (done === jobs.length) {
        clearInterval(check);
        Promise.all(workers.map(w => w.terminate())).then(() => resolve(results));
      }
    }, 50);
  });
}

module.exports = { runPool, cores: os.cpus().length };

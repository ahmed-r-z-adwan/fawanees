// Prints the rule-variant comparison as a markdown table, from the dynamics runs on disk.
//   node sim/variantTable.js
const fs = require('fs');

const ROWS = [
  ['K=3, M=1 (current)', 'docs/measurements/dyn-k3.json'],
  ['K=3, M=2', 'docs/measurements/dyn-k3m2.json'],
  ['K=4, M=1', 'docs/measurements/dyn-k4.json'],
];

const pct = x => (100 * x).toFixed(1) + '%';
const num = (x, d = 2) => x.toFixed(d);

const cols = [
  ['first player', r => `${pct(r.openerWinRate)} ±${(100 * r.openerWinRateHalfWidth).toFixed(1)}`],
  ['last lead change', r => `${pct(r.lastLeadChange)} ±${(100 * r.lastLeadChangeHalfWidth).toFixed(1)}`],
  ['comeback', r => pct(r.comebackRate)],
  ['avg margin', r => num(r.marginAvg, 1)],
  ['chains / game', r => num(r.chainsPerGame)],
  ['games with a chain', r => pct(r.gamesWithAChain)],
  ['biggest chain (avg)', r => num(r.biggestChainPerGame, 1)],
  ['biggest chain (ever)', r => String(r.biggestChainEver)],
  ['captures / game', r => num(r.capturingMovesPerGame, 1)],
  ['lanterns flipped / game', r => num(r.lanternsFlippedPerGame, 1)],
  ['games', r => String(r.games)],
];

const loaded = ROWS.map(([name, file]) => {
  const d = JSON.parse(fs.readFileSync(file, 'utf8')).variants[0];
  return { name, openings: d.openings.length, takes: d.responderTakesOn, r: d.played };
}).filter(Boolean);

const head = ['measure', ...loaded.map(x => x.name)];
const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
for (const [label, get] of cols) lines.push(`| ${label} | ${loaded.map(x => get(x.r)).join(' | ')} |`);
lines.push(`| opening cells used | ${loaded.map(x => x.openings).join(' | ')} |`);
lines.push(`| responder takes the lantern on | ${loaded.map(x => x.takes).join(' | ')} |`);
console.log(lines.join('\n'));
console.log('\nEach variant is played from its own balanced openings, found by a separate opening study,');
console.log('so no variant is judged on openings chosen for a different rule set. Every reply enumerated,');
console.log('depth 3 both sides. A "chain" is a capture that resolved in two waves or more.');

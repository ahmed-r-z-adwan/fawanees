const { run } = require('./sim.js');
const E = (d, w) => ({ type: 'engine', depth: d, w });
const S = +process.argv[2], K = +(process.argv[3] || 3);
const rules = { K, restrict: false, supply: S };
console.log(`--- supply ${S} K=${K}`);
run(`d2 vs d2`, 4, rules, E(2, { mob: 0 }), E(2, { mob: 0 }), 120);
run(`d3 vs d3`, 4, rules, E(3, { mob: 0 }), E(3, { mob: 0 }), 40);
run(`d1 vs d3`, 4, rules, E(1, { mob: 0 }), E(3, { mob: 0 }), 30);
run(`d3 vs d1`, 4, rules, E(3, { mob: 0 }), E(1, { mob: 0 }), 30);

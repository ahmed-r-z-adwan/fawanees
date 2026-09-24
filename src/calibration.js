// Win-chance model. Replaced by sim/calibrate.js with a fit against real self-play outcomes.
// Until then this is the prototype's uncalibrated guess and the UI must not present it as measured.
window.FawaneesCalibration = {
  measured: false,
  source: 'uncalibrated guess from the prototype',
  // eval (points, from gold's point of view) + phase (0..1) -> P(gold wins)
  prob: function (evalGold) { return 1 / (1 + Math.exp(-evalGold / 7)); },
};

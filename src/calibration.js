// Win-chance model. Replaced by sim/calibrate.js with a fit against real self-play outcomes.
// Until then this is the prototype's uncalibrated guess, and the UI must not present it as measured.
window.FawaneesCalibration = {
  measured: false,
  source: 'uncalibrated guess from the prototype',
  // value: search value in points from gold's side; phase: lanterns placed / total supply
  prob: function (value, phase, goldToMove) { return 1 / (1 + Math.exp(-value / 7)); },
};

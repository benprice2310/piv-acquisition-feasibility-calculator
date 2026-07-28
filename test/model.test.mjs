import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULTS,
  FLUIDS,
  THRESHOLDS,
  evaluate,
  sinc,
  solveCorrelationDt,
  sweepDt,
  worstStatus
} from '../src/model.js';

const close = (actual, expected, tol = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)),
    `expected ${actual} ≈ ${expected}`
  );

test('image scale and magnification follow the sensor geometry', () => {
  const r = evaluate({});
  close(r.imaging.scale, 0.1 / 2048);
  close(r.imaging.magnification, 6.5e-6 / (0.1 / 2048));
});

test('design velocity and particle-image displacement', () => {
  const r = evaluate({ dt: 1e-3 });
  close(r.flow.uDesign, 0.8);
  /* 0.8 m/s over 1 ms is 0.8 mm, at 48.83 µm/px that is 16.38 px */
  close(r.displacement.displacementPx, (0.8 * 1e-3) / (0.1 / 2048));
  close(r.displacement.displacementPx, 16.384, 1e-4);
});

test('retention limits invert the displacement rules', () => {
  const r = evaluate({});
  const scale = 0.1 / 2048;
  close(r.timing.dtImage, (32 * 0.25 * scale) / 0.8);
  close(r.timing.dtSheet, (2e-3 * 0.25) / (3 * 0.05));
  /* the recommended separation keeps a margin below the hard limit */
  assert.ok(r.timing.dtRecommended < r.timing.dtHard);
  close(r.timing.dtHard, Math.min(r.timing.dtImage, r.timing.dtSheet, r.timing.dtCorrelation));
});

test('particle-image diameter combines geometric and diffraction terms', () => {
  const r = evaluate({ particleDiameter: 0 });
  /* with no geometric image the diameter is purely diffraction limited */
  close(r.imaging.imageDiameter, r.imaging.diffractionDiameter);
  const withParticle = evaluate({ particleDiameter: 100e-6 });
  assert.ok(withParticle.imaging.imageDiameter > withParticle.imaging.diffractionDiameter);
});

test('depth of field matches the closed form 4.88 f#² λ (1+1/M)²', () => {
  const r = evaluate({});
  const { magnification: M } = r.imaging;
  const expected = 4.88 * DEFAULTS.fNumber ** 2 * 532e-9 * (1 + 1 / M) ** 2;
  close(r.imaging.depthOfField, expected, 1e-9);
});

test('valid-detection merit degrades with pulse separation', () => {
  const short = evaluate({ dt: 1e-4, windowShifting: false });
  const long = evaluate({ dt: 2e-3, windowShifting: false });
  assert.ok(short.correlation.merit > long.correlation.merit);
  /* window shifting removes the in-plane loss term */
  const shifted = evaluate({ dt: 2e-3, windowShifting: true });
  assert.equal(shifted.correlation.fi, 1);
  assert.ok(shifted.correlation.merit > long.correlation.merit);
});

test('solveCorrelationDt returns the separation where the merit hits the target', () => {
  const ni = 20;
  const imageRate = 500;
  const sheetRate = 100;
  const dt = solveCorrelationDt({ ni, target: 7, imageRate, sheetRate });
  const merit = ni * (1 - imageRate * dt) * (1 - sheetRate * dt);
  close(merit, 7, 1e-5);
});

test('solveCorrelationDt is zero when seeding alone cannot reach the target', () => {
  assert.equal(solveCorrelationDt({ ni: 3, target: 7, imageRate: 10, sheetRate: 10 }), 0);
});

test('velocity uncertainty scales as sigma * scale / dt', () => {
  const a = evaluate({ dt: 1e-3 });
  close(a.displacement.displacementPx, 16.384, 1e-4);
  const b = evaluate({ dt: 2e-3 });
  close(b.displacement.velocityResolution, a.displacement.velocityResolution / 2);
  close(a.displacement.relativeError, a.displacement.velocityResolution / 0.8);
  close(a.displacement.dynamicVelocityRange, (32 * 0.25) / 0.1);
});

test('the accuracy floor and the retention ceiling bracket the usable dt', () => {
  const r = evaluate({});
  close(
    r.timing.dtFloor,
    (0.1 * r.imaging.scale) / (0.8 * THRESHOLDS.relativeErrorPass)
  );
  assert.equal(r.timing.windowConflict, r.timing.dtFloor > r.timing.dtRecommended);
});

test('window filtering attenuates structures as a top-hat sinc', () => {
  close(sinc(0), 1);
  close(sinc(1), 0, 1e-12);
  const r = evaluate({ structureLength: 3 * (32 * 0.1) / 2048 });
  /* structure exactly three windows long keeps sinc(1/3) ≈ 0.827 */
  close(r.interrogation.attenuation, Math.abs(sinc(1 / 3)), 1e-9);
  close(r.interrogation.windowsAcross, 3, 1e-9);
});

test('vector spacing accounts for overlap without inventing resolution', () => {
  const none = evaluate({ overlap: 0 });
  const half = evaluate({ overlap: 0.5 });
  close(half.interrogation.vectorSpacing, none.interrogation.vectorSpacing / 2);
  close(half.interrogation.attenuation, none.interrogation.attenuation);
  assert.equal(half.interrogation.vectorSamples, none.interrogation.vectorSamples * 2);
});

test('tracer response time and Stokes number', () => {
  const r = evaluate({});
  close(r.tracer.responseTime, (1050 * (10e-6) ** 2) / (18 * FLUIDS.water.viscosity));
  close(r.tracer.stokes, r.tracer.responseTime / (0.05 / 0.8));
  /* neutrally buoyant tracers do not settle */
  const neutral = evaluate({ particleDensity: FLUIDS.water.density });
  close(neutral.tracer.settlingVelocity, 0, 1e-12);
});

test('heavy particles in air fail the tracer checks', () => {
  const r = evaluate({
    ...DEFAULTS,
    fluidDensity: FLUIDS.air.density,
    fluidViscosity: FLUIDS.air.viscosity,
    particleDiameter: 100e-6,
    particleDensity: 2500,
    uMean: 20,
    structureLength: 0.01
  });
  const stokes = r.checks.find((c) => c.id === 'stokes');
  assert.equal(stokes.status, 'fail');
  assert.equal(r.verdict, 'fail');
});

test('temporal sampling counts fields per structure passage', () => {
  const r = evaluate({ rate: 1000, structureLength: 0.05 });
  close(r.temporal.temporalSamples, (1000 * 0.05) / 0.8);
  close(r.temporal.convectionFrequency, 0.8 / 0.05);
  close(r.temporal.theoreticalLength, (2 * 0.8) / 1000);
});

test('a pulse pair longer than the frame period is flagged', () => {
  const r = evaluate({ rate: 1000, dt: 2e-3 });
  const frame = r.checks.find((c) => c.id === 'frame');
  assert.equal(frame.status, 'fail');
});

test('verdict is the worst of the individual checks', () => {
  const r = evaluate({});
  assert.equal(r.verdict, worstStatus(r.checks.map((c) => c.status)));
  assert.equal(worstStatus(['pass', 'margin', 'pass']), 'margin');
  assert.equal(worstStatus(['pass', 'margin', 'fail']), 'fail');
  assert.equal(worstStatus([]), 'pass');
});

test('a well-posed water-channel configuration passes every check', () => {
  const r = evaluate({ rate: 200 });
  const failing = r.checks.filter((c) => c.status !== 'pass').map((c) => c.id);
  assert.deepEqual(failing, []);
});

test('degenerate inputs never produce NaN', () => {
  const r = evaluate({
    dt: 0,
    rate: 0,
    uMean: 0,
    uRms: 0,
    wMean: 0,
    wRms: 0,
    fovWidth: 0,
    imageWidthPx: 0,
    windowPx: 0,
    concentration: 0,
    particleDiameter: 0,
    structureLength: 0,
    sigmaPx: 0
  });
  const walk = (node, path = '$') => {
    if (typeof node === 'number') assert.ok(!Number.isNaN(node), `${path} is NaN`);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
    }
  };
  walk(r);
  for (const check of r.checks) {
    assert.ok(['pass', 'margin', 'fail'].includes(check.status));
    assert.ok(!/NaN|undefined/.test(check.value + check.detail), check.value + check.detail);
  }
});

test('the dt sweep spans the requested decade range monotonically', () => {
  const r = evaluate({ windowShifting: false });
  const { points } = sweepDt(r, { min: 1e-6, max: 1e-1, samples: 50 });
  assert.equal(points.length, 50);
  close(points[0].dt, 1e-6, 1e-9);
  close(points.at(-1).dt, 1e-1, 1e-9);
  for (let i = 1; i < points.length; i += 1) {
    assert.ok(points[i].merit <= points[i - 1].merit + 1e-12);
    assert.ok(points[i].relativeError <= points[i - 1].relativeError + 1e-12);
  }
});

test('a short pulse separation is an accuracy problem, not a retention one', () => {
  const r = evaluate({ dt: 1e-5 });
  assert.equal(r.checks.find((c) => c.id === 'pair').status, 'pass');
  assert.equal(r.checks.find((c) => c.id === 'accuracy').status, 'fail');
});

test('seeding too sparse to reach the merit target fails its own criterion', () => {
  const r = evaluate({ concentration: 1e8 });
  assert.equal(r.checks.find((c) => c.id === 'correlation').status, 'fail');
  assert.equal(r.timing.dtCorrelation, 0);
  /* No Δt fixes sparse seeding, so the retention ceiling is left alone rather
     than collapsed to zero: the remedy is to seed more, not to retime. */
  assert.equal(r.timing.dtHard, r.timing.dtImage);
  assert.equal(r.timing.limiter, 'in-plane displacement');
});

test('valid detection binds the ceiling when it is the tightest limit', () => {
  const r = evaluate({ concentration: 1.5e9, windowShifting: false });
  assert.ok(r.timing.dtCorrelation > 0);
  assert.equal(r.timing.dtHard, r.timing.dtCorrelation);
  assert.equal(r.timing.limiter, 'valid-detection probability');
});

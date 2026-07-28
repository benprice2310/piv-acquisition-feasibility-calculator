/*
 * PIV acquisition feasibility model.
 *
 * Pure functions, no DOM. Every quantity is SI unless the name says otherwise:
 * lengths in metres, times in seconds, velocities in m/s, densities in kg/m^3,
 * dynamic viscosity in Pa s, number densities in m^-3. Pixel quantities carry a
 * `Px` suffix.
 *
 * References for the criteria implemented here are listed in README.md.
 */

export const G = 9.80665;

export const FLUIDS = {
  water: { label: 'Water, 20 °C', density: 998.2, viscosity: 1.002e-3 },
  air: { label: 'Air, 20 °C, 1 atm', density: 1.204, viscosity: 1.825e-5 },
  custom: { label: 'Custom', density: 998.2, viscosity: 1.002e-3 }
};

/* Acceptance thresholds. Collected here so the whole rule set is auditable. */
export const THRESHOLDS = {
  /* Keane & Adrian valid-detection figure of merit N_I F_I F_O. */
  correlationPass: 7,
  correlationMargin: 5,
  /* Particle-image diameter in pixels: below 2 px the sub-pixel estimator
     biases towards integer displacements (peak locking). */
  imageDiameterPx: { fail: 1.5, margin: 2, comfortable: 4 },
  /* Relative uncertainty of the design velocity. */
  relativeErrorPass: 0.02,
  relativeErrorMargin: 0.05,
  /* Displacement gradient across the interrogation window, in pixels of
     displacement per pixel of window. */
  gradientPass: 0.05,
  gradientMargin: 0.1,
  /* Amplitude of a sinusoidal structure surviving the window's top-hat filter. */
  attenuationPass: 0.8,
  attenuationMargin: 0.64,
  /* Vector samples per structure length. */
  vectorSamplesPass: 4,
  vectorSamplesMargin: 2,
  /* PIV fields acquired while the structure convects past the plane. */
  temporalSamplesPass: 5,
  temporalSamplesMargin: 2,
  /* Stokes number based on the structure passage time. */
  stokesPass: 0.1,
  stokesMargin: 0.5,
  /* Settling velocity as a fraction of the design velocity. */
  settlingPass: 0.01,
  settlingMargin: 0.05,
  /* Depth of field as a fraction of the sheet thickness. */
  depthOfFieldPass: 1,
  depthOfFieldMargin: 0.5
};

/* Fraction of the hard retention limit used as the recommended setting. */
export const MARGIN_FACTOR = 0.8;

const STATUS_RANK = { pass: 0, margin: 1, fail: 2 };

export const worstStatus = (statuses) =>
  statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), 'pass');

/* Descending metric: larger is better. */
const gradeHigh = (value, pass, margin) =>
  value >= pass ? 'pass' : value >= margin ? 'margin' : 'fail';

/* Ascending metric: smaller is better. */
const gradeLow = (value, pass, margin) =>
  value <= pass ? 'pass' : value <= margin ? 'margin' : 'fail';

const clampRange = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

const finitePositive = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/* Frequencies read better with a prefix than in exponent notation. */
const fmtHz = (v) =>
  !Number.isFinite(v)
    ? '—'
    : v >= 1e6
      ? `${(v / 1e6).toPrecision(3)} MHz`
      : v >= 1e3
        ? `${(v / 1e3).toPrecision(3)} kHz`
        : `${v.toPrecision(3)} Hz`;

/* Ratios that round to zero should say so rather than print 0.00 %. */
const fmtRatio = (v) =>
  !Number.isFinite(v) ? '—' : v > 0 && v < 1e-4 ? '< 0.01 %' : `${(v * 100).toFixed(2)} %`;

/* Normalised sinc, sin(pi x)/(pi x). */
export const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/*
 * Default input set: a bench-top water channel. Also the shape contract for
 * `evaluate` — every key is required.
 */
export const DEFAULTS = {
  /* Timing */
  dt: 3.5e-4,
  rate: 15,
  /* Flow */
  uMean: 0.5,
  uRms: 0.1,
  wMean: 0,
  wRms: 0.05,
  k: 3,
  /* Imaging */
  fovWidth: 0.1,
  imageWidthPx: 2048,
  pixelPitch: 6.5e-6,
  fNumber: 11,
  wavelength: 532e-9,
  /* Light sheet */
  sheetThickness: 2e-3,
  /* Interrogation */
  windowPx: 32,
  overlap: 0.5,
  shiftFraction: 0.25,
  sheetFraction: 0.25,
  windowShifting: true,
  /* Seeding and tracers */
  concentration: 2e9,
  particleDiameter: 10e-6,
  particleDensity: 1050,
  fluidDensity: FLUIDS.water.density,
  fluidViscosity: FLUIDS.water.viscosity,
  /* Analysis */
  sigmaPx: 0.1,
  structureLength: 0.05
};

/*
 * Solve N_I F_I F_O = target for the pulse separation. The product is
 * monotonically decreasing in dt over the interval where both factors are
 * positive, so a bisection is both safe and exact enough for planning.
 */
export function solveCorrelationDt({ ni, target, imageRate, sheetRate }) {
  if (!(ni > 0)) return 0;
  const merit = (dt) =>
    ni * Math.max(0, 1 - imageRate * dt) * Math.max(0, 1 - sheetRate * dt);
  if (merit(0) < target) return 0;
  /* Upper bracket: the dt at which either factor reaches zero. */
  const rates = [imageRate, sheetRate].filter((r) => r > 0);
  if (rates.length === 0) return Infinity;
  let hi = Math.min(...rates.map((r) => 1 / r));
  let lo = 0;
  for (let i = 0; i < 80; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (merit(mid) >= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Evaluate one acquisition configuration.
 *
 * @param {typeof DEFAULTS} raw
 * @returns {object} derived quantities, per-criterion checks and an overall verdict
 */
export function evaluate(raw) {
  const input = { ...DEFAULTS, ...raw };

  const dt = finitePositive(input.dt, 1e-9);
  const rate = finitePositive(input.rate, 1e-9);
  const fovWidth = finitePositive(input.fovWidth, 1e-6);
  const imageWidthPx = finitePositive(input.imageWidthPx, 1);
  const pixelPitch = finitePositive(input.pixelPitch, 1e-6);
  const fNumber = finitePositive(input.fNumber, 1);
  const wavelength = finitePositive(input.wavelength, 1e-9);
  const sheetThickness = finitePositive(input.sheetThickness, 1e-9);
  const windowPx = finitePositive(input.windowPx, 1);
  const overlap = clampRange(input.overlap, 0, 0.95);
  const shiftFraction = clampRange(input.shiftFraction, 0.01, 1);
  const sheetFraction = clampRange(input.sheetFraction, 0.01, 1);
  const sigmaPx = finitePositive(input.sigmaPx, 0.01);
  const structureLength = finitePositive(input.structureLength, 1e-9);
  const particleDiameter = Math.max(0, input.particleDiameter);
  const fluidViscosity = finitePositive(input.fluidViscosity, 1e-9);
  const k = Math.max(0, input.k);

  /* ---- Imaging geometry ---- */
  const scale = fovWidth / imageWidthPx; // metres per pixel in object space
  const magnification = pixelPitch / scale;
  const diffractionDiameter = 2.44 * fNumber * (1 + magnification) * wavelength;
  const imageDiameter = Math.hypot(magnification * particleDiameter, diffractionDiameter);
  const imageDiameterPx = imageDiameter / pixelPitch;
  const depthOfField =
    (2 * fNumber * diffractionDiameter * (1 + magnification)) / magnification ** 2;

  /* ---- Design velocities ---- */
  const uDesign = Math.max(0, input.uMean) + k * Math.max(0, input.uRms);
  const wDesign = Math.max(0, input.wMean) + k * Math.max(0, input.wRms);

  /* ---- Displacements at the chosen dt ---- */
  const displacementPx = (uDesign * dt) / scale;
  const sheetTravel = wDesign * dt;
  const allowedPx = windowPx * shiftFraction;
  const allowedSheet = sheetThickness * sheetFraction;

  /* ---- Retention limits on dt ---- */
  const dtImage = uDesign > 0 ? (allowedPx * scale) / uDesign : Infinity;
  const dtSheet = wDesign > 0 ? allowedSheet / wDesign : Infinity;

  /* ---- Interrogation geometry ---- */
  const windowSize = windowPx * scale;
  const vectorSpacing = windowSize * (1 - overlap);
  const vectorsAcross = Math.floor(imageWidthPx / (windowPx * (1 - overlap)));

  /* ---- Loss-of-pairs figure of merit (Keane & Adrian) ---- */
  const effectiveDepth = Math.min(sheetThickness, depthOfField);
  const ni = Math.max(0, input.concentration) * windowSize ** 2 * effectiveDepth;
  const imageLossRate = uDesign / windowSize; // dFI/dt
  const sheetLossRate = wDesign / sheetThickness; // dFO/dt
  const fi = input.windowShifting ? 1 : Math.max(0, 1 - imageLossRate * dt);
  const fo = Math.max(0, 1 - sheetLossRate * dt);
  const merit = ni * fi * fo;
  const dtCorrelation = solveCorrelationDt({
    ni,
    target: THRESHOLDS.correlationPass,
    imageRate: input.windowShifting ? 0 : imageLossRate,
    sheetRate: sheetLossRate
  });

  /* ---- Accuracy floor on dt ---- */
  const velocityResolution = (sigmaPx * scale) / dt; // m/s
  const relativeError = uDesign > 0 ? velocityResolution / uDesign : Infinity;
  const rmsResolution = input.uRms > 0 ? velocityResolution / input.uRms : Infinity;
  const dtAccuracy =
    uDesign > 0 ? (sigmaPx * scale) / (uDesign * THRESHOLDS.relativeErrorPass) : 0;
  const dynamicVelocityRange = allowedPx / sigmaPx;

  /* ---- Operating window ---- */
  /* A zero from the solver means no separation reaches the merit target, which
     is a seeding problem rather than a timing one: leave the retention ceiling
     in place and let the valid-detection criterion report it. */
  const dtHard = Math.min(dtImage, dtSheet, dtCorrelation || Infinity);
  const dtRecommended = MARGIN_FACTOR * dtHard;
  const dtFloor = dtAccuracy;
  const limiter =
    dtHard === dtImage
      ? 'in-plane displacement'
      : dtHard === dtSheet
        ? 'out-of-plane sheet loss'
        : 'valid-detection probability';
  const windowConflict = dtFloor > dtRecommended;
  const framePeriod = 1 / rate;

  /* ---- Spatial resolution ---- */
  const attenuation = Math.abs(sinc(windowSize / structureLength));
  const windowsAcross = structureLength / windowSize;
  const vectorSamples = structureLength / vectorSpacing;

  /* ---- Velocity gradient across a window ----
     The velocity difference sampled by one window is estimated from the design
     fluctuation spread over the structure, Δu ≈ k u′ D_w / L. The practical
     criterion is the displacement gradient in pixels per pixel; the classical
     Keane & Adrian parameter a = M |Δu| Δt / d_τ is reported alongside it. */
  const velocityDifference = k * Math.max(0, input.uRms) * Math.min(1, windowSize / structureLength);
  const gradientDisplacementPx = (velocityDifference * dt) / scale;
  const gradient = gradientDisplacementPx / windowPx;
  const gradientOverImage =
    imageDiameterPx > 0 ? gradientDisplacementPx / imageDiameterPx : Infinity;

  /* ---- Tracer fidelity ---- */
  const responseTime =
    (Math.max(0, input.particleDensity) * particleDiameter ** 2) / (18 * fluidViscosity);
  const structureTime = uDesign > 0 ? structureLength / uDesign : Infinity;
  const stokes = Number.isFinite(structureTime) && structureTime > 0
    ? responseTime / structureTime
    : 0;
  const responseFrequency = responseTime > 0 ? 1 / (2 * Math.PI * responseTime) : Infinity;
  const settlingVelocity =
    (particleDiameter ** 2 * (input.particleDensity - input.fluidDensity) * G) /
    (18 * fluidViscosity);
  const settlingRatio = uDesign > 0 ? Math.abs(settlingVelocity) / uDesign : Infinity;

  /* ---- Temporal sampling ---- */
  const temporalSamples = uDesign > 0 ? (rate * structureLength) / uDesign : Infinity;
  const convectionFrequency = uDesign > 0 ? uDesign / structureLength : 0;
  const theoreticalLength = (2 * uDesign) / rate;
  const conservativeLength = (5 * uDesign) / rate;

  /* Retention only degrades as dt grows; a short dt is an accuracy problem, and
     that is reported by its own criterion. */
  const pairStatus = dt <= dtRecommended ? 'pass' : dt <= dtHard ? 'margin' : 'fail';

  const checks = [
    {
      id: 'pair',
      group: 'timing',
      label: 'Particle-pair retention',
      value: `${displacementPx.toFixed(1)} px shift`,
      detail: `limit ${allowedPx.toFixed(1)} px; sheet travel ${(sheetTravel * 1e3).toFixed(3)} of ${(allowedSheet * 1e3).toFixed(3)} mm`,
      status: pairStatus,
      formula: 'ΔX = U_d Δt / s ≤ f_s D_I,  Δz = W_d Δt ≤ f_z Δz₀'
    },
    {
      id: 'correlation',
      group: 'timing',
      label: 'Valid-detection merit',
      value: `N_I F_I F_O = ${merit.toFixed(1)}`,
      detail: `N_I = ${ni.toFixed(1)} images per window, F_I = ${fi.toFixed(2)}, F_O = ${fo.toFixed(2)}; target ≥ ${THRESHOLDS.correlationPass}`,
      status: gradeHigh(merit, THRESHOLDS.correlationPass, THRESHOLDS.correlationMargin),
      formula: 'N_I F_I F_O ≥ 7 (Keane & Adrian)'
    },
    {
      id: 'accuracy',
      group: 'timing',
      label: 'Velocity uncertainty',
      value: `${fmtRatio(relativeError)} of U_d`,
      detail: `σ_U = ${velocityResolution.toPrecision(3)} m/s = ${(rmsResolution * 100).toFixed(1)} % of u′; DVR ≈ ${dynamicVelocityRange.toFixed(0)}:1`,
      status: gradeLow(
        relativeError,
        THRESHOLDS.relativeErrorPass,
        THRESHOLDS.relativeErrorMargin
      ),
      formula: 'σ_U = σ_px · s / Δt'
    },
    {
      id: 'frame',
      group: 'timing',
      label: 'Pulse pair within frame period',
      value: `Δt / T = ${(dt / framePeriod).toFixed(3)}`,
      detail: `frame period ${(framePeriod * 1e3).toPrecision(3)} ms at ${fmtHz(rate)}`,
      status: gradeLow(dt / framePeriod, 0.5, 1),
      formula: 'Δt < 1 / f'
    },
    {
      id: 'particleImage',
      group: 'imaging',
      label: 'Particle-image diameter',
      value: `${imageDiameterPx.toFixed(2)} px`,
      detail:
        imageDiameterPx < THRESHOLDS.imageDiameterPx.margin
          ? 'below 2 px: peak locking biases sub-pixel estimates'
          : imageDiameterPx > THRESHOLDS.imageDiameterPx.comfortable
            ? 'above 4 px: accuracy and resolution are being spent on blur'
            : 'in the 2–4 px band that minimises sub-pixel error',
      status:
        imageDiameterPx < THRESHOLDS.imageDiameterPx.fail
          ? 'fail'
          : imageDiameterPx < THRESHOLDS.imageDiameterPx.margin ||
              imageDiameterPx > THRESHOLDS.imageDiameterPx.comfortable
            ? 'margin'
            : 'pass',
      formula: 'd_τ = √((M d_p)² + d_diff²),  d_diff = 2.44 f# (1+M) λ'
    },
    {
      id: 'depthOfField',
      group: 'imaging',
      label: 'Depth of field vs sheet',
      value: `${(depthOfField / sheetThickness).toFixed(2)} × sheet`,
      detail: `δz = ${(depthOfField * 1e3).toFixed(2)} mm at f/${fNumber.toPrecision(3)}, M = ${magnification.toPrecision(3)}`,
      status: gradeHigh(
        depthOfField / sheetThickness,
        THRESHOLDS.depthOfFieldPass,
        THRESHOLDS.depthOfFieldMargin
      ),
      formula: 'δz = 2 f# d_diff (1+M) / M²'
    },
    {
      id: 'gradient',
      group: 'imaging',
      label: 'Displacement gradient',
      value: `${gradient.toFixed(3)} px/px`,
      detail: `displacement varies by ${gradientDisplacementPx.toFixed(2)} px across a window, ${gradientOverImage.toFixed(2)} × d_τ; target ≤ ${THRESHOLDS.gradientPass}`,
      status: gradeLow(gradient, THRESHOLDS.gradientPass, THRESHOLDS.gradientMargin),
      formula: '|∂ΔX/∂x| = k u′ Δt / L ≤ 0.05'
    },
    {
      id: 'spatial',
      group: 'resolution',
      label: 'Structure amplitude retained',
      value: `${(attenuation * 100).toFixed(0)} %`,
      detail:
        windowsAcross >= 1
          ? `window ${(windowSize * 1e3).toPrecision(3)} mm = L/${windowsAcross.toPrecision(2)}; top-hat filter at this wavelength`
          : `window ${(windowSize * 1e3).toPrecision(3)} mm is wider than the structure: it averages the feature away`,
      status: gradeHigh(
        attenuation,
        THRESHOLDS.attenuationPass,
        THRESHOLDS.attenuationMargin
      ),
      formula: 'A/A₀ = |sinc(D_w / L)|'
    },
    {
      id: 'sampling',
      group: 'resolution',
      label: 'Vectors across structure',
      value: `${vectorSamples.toFixed(1)}`,
      detail: `spacing ${(vectorSpacing * 1e3).toFixed(2)} mm; ${vectorsAcross} vectors across the image`,
      status: gradeHigh(
        vectorSamples,
        THRESHOLDS.vectorSamplesPass,
        THRESHOLDS.vectorSamplesMargin
      ),
      formula: 'N_v = L / [D_w (1 − overlap)]'
    },
    {
      id: 'temporal',
      group: 'resolution',
      label: 'Fields per structure',
      value: Number.isFinite(temporalSamples) ? `${temporalSamples.toFixed(2)}` : '∞',
      detail: `convection frequency ${fmtHz(convectionFrequency)}; Nyquist needs ${fmtHz(2 * convectionFrequency)}`,
      status: gradeHigh(
        temporalSamples,
        THRESHOLDS.temporalSamplesPass,
        THRESHOLDS.temporalSamplesMargin
      ),
      formula: 'N_t = f L / U_d'
    },
    {
      id: 'stokes',
      group: 'tracer',
      label: 'Tracer Stokes number',
      value: `St = ${stokes.toPrecision(2)}`,
      detail: `τ_p = ${responseTime.toPrecision(3)} s; flat response to ≈ ${fmtHz(responseFrequency)}`,
      status: gradeLow(stokes, THRESHOLDS.stokesPass, THRESHOLDS.stokesMargin),
      formula: 'St = τ_p U_d / L,  τ_p = ρ_p d_p² / (18 μ)'
    },
    {
      id: 'settling',
      group: 'tracer',
      label: 'Settling bias',
      value: `${fmtRatio(settlingRatio)} of U_d`,
      detail: `U_g = ${Math.abs(settlingVelocity).toPrecision(3)} m/s`,
      status: gradeLow(settlingRatio, THRESHOLDS.settlingPass, THRESHOLDS.settlingMargin),
      formula: 'U_g = d_p² (ρ_p − ρ_f) g / (18 μ)'
    }
  ];

  const verdict = worstStatus(checks.map((c) => c.status));

  return {
    input,
    verdict,
    checks,
    imaging: {
      scale,
      magnification,
      diffractionDiameter,
      imageDiameter,
      imageDiameterPx,
      depthOfField,
      effectiveDepth,
      fovWidth
    },
    flow: { uDesign, wDesign, velocityDifference },
    displacement: {
      displacementPx,
      allowedPx,
      sheetTravel,
      allowedSheet,
      velocityResolution,
      relativeError,
      rmsResolution,
      dynamicVelocityRange
    },
    correlation: { ni, fi, fo, merit, imageLossRate, sheetLossRate },
    interrogation: { windowSize, vectorSpacing, vectorsAcross, attenuation, windowsAcross, vectorSamples },
    gradient: { value: gradient, overImageDiameter: gradientOverImage, displacementPx: gradientDisplacementPx },
    tracer: { responseTime, responseFrequency, stokes, settlingVelocity, settlingRatio },
    timing: {
      dt,
      dtImage,
      dtSheet,
      dtCorrelation,
      dtHard,
      dtRecommended,
      dtFloor,
      limiter,
      windowConflict,
      framePeriod,
      pairStatus
    },
    temporal: {
      temporalSamples,
      convectionFrequency,
      theoreticalLength,
      conservativeLength,
      theoreticalFrequency: rate / 2,
      conservativeFrequency: rate / 5
    }
  };
}

/*
 * Curves for the trade-off chart: how the valid-detection merit and the
 * relative velocity uncertainty vary with the pulse separation.
 */
export function sweepDt(result, { min, max, samples = 120 }) {
  const { correlation, input, imaging, flow, displacement } = result;
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const dt = 10 ** (logMin + ((logMax - logMin) * i) / (samples - 1));
    const fi = input.windowShifting
      ? 1
      : Math.max(0, 1 - correlation.imageLossRate * dt);
    const fo = Math.max(0, 1 - correlation.sheetLossRate * dt);
    points.push({
      dt,
      merit: correlation.ni * fi * fo,
      relativeError:
        flow.uDesign > 0
          ? (input.sigmaPx * imaging.scale) / (dt * flow.uDesign)
          : Infinity,
      displacementPx: (flow.uDesign * dt) / imaging.scale
    });
  }
  return { points, ni: correlation.ni, allowedPx: displacement.allowedPx };
}

/*
 * Browser layer: builds the form, keeps the URL in sync with the inputs and
 * renders the verdict, the three charts and the criteria list.
 */

import { DEFAULTS, FLUIDS, THRESHOLDS, evaluate, sweepDt } from './model.js';
import { PRESETS, PRESET_BY_ID } from './presets.js';

/* ------------------------------------------------------------------ units */

const identity = { toSI: (v) => v, toDisplay: (v) => v };
const scaled = (factor) => ({ toSI: (v) => v * factor, toDisplay: (v) => v / factor });

/*
 * The single source of truth for the form. `key` is the query-string name used
 * in shareable links, so it is short and must stay stable.
 */
const FIELDS = [
  { id: 'rate', key: 'f', section: 'timing', label: 'Repetition rate', unit: 'Hz', min: 0.01, max: 1e6, step: 'any', ...identity,
    help: 'Velocity fields per second. Sets the measurement cadence, not the time between the two pulses.' },
  { id: 'dt', key: 'dt', section: 'timing', label: 'Pulse separation Δt', unit: 'µs', min: 0.01, max: 1e6, step: 'any', ...scaled(1e-6),
    help: 'Time between the two laser pulses of one pair.' },
  { id: 'uMean', key: 'u', section: 'timing', label: 'Mean in-plane speed', unit: 'm/s', min: 0, max: 1000, step: 'any', ...identity,
    help: 'Largest relevant mean speed parallel to the sheet.' },
  { id: 'uRms', key: 'ur', section: 'timing', label: 'In-plane RMS u′', unit: 'm/s', min: 0, max: 1000, step: 'any', ...identity,
    help: 'RMS fluctuation parallel to the sheet.' },
  { id: 'wMean', key: 'w', section: 'timing', label: 'Mean out-of-plane', unit: 'm/s', min: 0, max: 1000, step: 'any', ...identity,
    help: 'Mean velocity normal to the sheet. Zero for a nominally two-dimensional plane.' },
  { id: 'wRms', key: 'wr', section: 'timing', label: 'Out-of-plane RMS w′', unit: 'm/s', min: 0, max: 1000, step: 'any', ...identity,
    help: 'RMS velocity normal to the sheet: this is what carries particles out of the light sheet.' },
  { id: 'k', key: 'k', section: 'timing', label: 'Design multiplier k', unit: '× RMS', min: 0, max: 10, step: 0.5, ...identity,
    help: 'Design velocities are U + k u′ and W + k w′. Three RMS is conservative for near-Gaussian fluctuations.' },

  { id: 'fovWidth', key: 'fov', section: 'camera', label: 'Field of view', unit: 'mm', min: 0.01, max: 1e5, step: 'any', ...scaled(1e-3),
    help: 'Object width imaged across the sensor width used.' },
  { id: 'imageWidthPx', key: 'npx', section: 'camera', label: 'Image width', unit: 'px', min: 16, max: 1e5, step: 1, ...identity,
    help: 'Pixels spanning that field of view, after cropping or binning.' },
  { id: 'pixelPitch', key: 'pp', section: 'camera', label: 'Pixel pitch', unit: 'µm', min: 0.1, max: 100, step: 'any', ...scaled(1e-6),
    help: 'Physical sensor pixel size. With the field of view this fixes the magnification.' },
  { id: 'fNumber', key: 'fn', section: 'camera', label: 'Lens f-number', unit: 'f/', min: 0.7, max: 64, step: 'any', ...identity,
    help: 'Working aperture. Stopping down enlarges the particle images and deepens the focus, at the cost of light.' },
  { id: 'wavelength', key: 'lam', section: 'camera', label: 'Laser wavelength', unit: 'nm', min: 200, max: 1600, step: 1, ...scaled(1e-9),
    help: 'Illumination wavelength; 532 nm for a frequency-doubled Nd:YAG.' },

  { id: 'sheetThickness', key: 'dz', section: 'interrogation', label: 'Sheet thickness Δz₀', unit: 'mm', min: 0.001, max: 100, step: 'any', ...scaled(1e-3),
    help: 'Effective illuminated thickness, not the nominal optical width.' },
  { id: 'windowPx', key: 'win', section: 'interrogation', label: 'Final window', unit: 'px', min: 4, max: 512, step: 4, ...identity,
    help: 'Final interrogation window size. This, not the overlap, sets the spatial resolution.' },
  { id: 'overlap', key: 'ov', section: 'interrogation', label: 'Window overlap', unit: '%', min: 0, max: 95, step: 5, ...scaled(0.01),
    help: 'Overlap between adjacent windows. It adds vectors, not information.' },
  { id: 'shiftFraction', key: 'sf', section: 'interrogation', label: 'Allowed shift', unit: '% of window', min: 1, max: 100, step: 1, ...scaled(0.01),
    help: 'Displacement cap as a fraction of the window: the quarter rule.' },
  { id: 'sheetFraction', key: 'zf', section: 'interrogation', label: 'Allowed sheet travel', unit: '% of Δz₀', min: 1, max: 100, step: 1, ...scaled(0.01),
    help: 'Out-of-plane travel cap as a fraction of the sheet thickness.' },
  { id: 'sigmaPx', key: 'sig', section: 'interrogation', label: 'Correlation uncertainty', unit: 'px', min: 0.005, max: 2, step: 'any', ...identity,
    help: 'RMS displacement error of the sub-pixel peak fit. About 0.1 px for well-formed 2–3 px particle images, and roughly 0.05 d_τ in general.' },
  { id: 'windowShifting', key: 'ws', section: 'interrogation', label: 'Window shifting or multi-pass', type: 'checkbox',
    help: 'Iterative window offset removes in-plane loss of pairs, so F_I is taken as 1.' },

  { id: 'fluidDensity', key: 'rf', section: 'seeding', label: 'Fluid density', unit: 'kg/m³', min: 0.001, max: 20000, step: 'any', ...identity,
    help: 'Density of the working fluid.' },
  { id: 'fluidViscosity', key: 'mu', section: 'seeding', label: 'Dynamic viscosity', unit: 'µPa·s', min: 0.1, max: 1e7, step: 'any', ...scaled(1e-6),
    help: 'Dynamic viscosity: 18.25 µPa·s for air, 1002 µPa·s for water at 20 °C.' },
  { id: 'particleDiameter', key: 'dp', section: 'seeding', label: 'Tracer diameter', unit: 'µm', min: 0.01, max: 1000, step: 'any', ...scaled(1e-6),
    help: 'Mean tracer diameter. Larger particles scatter more light but follow the flow less well.' },
  { id: 'particleDensity', key: 'rp', section: 'seeding', label: 'Tracer density', unit: 'kg/m³', min: 1, max: 20000, step: 'any', ...identity,
    help: 'Tracer material density.' },
  { id: 'concentration', key: 'c', section: 'seeding', label: 'Seeding concentration', unit: 'per mm³', min: 0.001, max: 1e5, step: 'any', ...scaled(1e9),
    help: 'Number density of tracers. Together with the window volume this gives the particle images per window.' },

  { id: 'structureLength', key: 'L', section: 'target', label: 'Structure length L', unit: 'mm', min: 0.001, max: 1e5, step: 'any', ...scaled(1e-3),
    help: 'Wavelength of the smallest flow structure you intend to resolve. Checked against the window filter, the vector spacing and the repetition rate.' }
];

const SECTIONS = [
  { id: 'timing', title: 'Timing and flow' },
  { id: 'camera', title: 'Camera and lens' },
  { id: 'interrogation', title: 'Sheet and interrogation' },
  { id: 'seeding', title: 'Seeding and tracers' },
  { id: 'target', title: 'Target structure' }
];

/* What to change when a criterion is not met. */
const REMEDIES = {
  pair: 'shorten Δt, enlarge the final window or thicken the sheet',
  correlation: 'seed more densely, enlarge the window or shorten Δt',
  accuracy: 'lengthen Δt, magnify more or accept a coarser velocity resolution',
  frame: 'lower the repetition rate or shorten Δt',
  particleImage: 'change the aperture: stopping down enlarges the particle images',
  depthOfField: 'stop the lens down or thin the light sheet',
  gradient: 'shorten Δt or use smaller windows with window deformation',
  spatial: 'use smaller windows or a smaller field of view',
  sampling: 'increase the overlap or use smaller windows',
  temporal: 'raise the repetition rate or accept larger structures',
  stokes: 'use smaller or lighter tracers',
  settling: 'match the tracer density to the fluid or use smaller tracers'
};

/* ------------------------------------------------------------- formatting */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  if (s < 1e-6) return `${(s * 1e9).toFixed(0)} ns`;
  if (s < 1e-3) return `${(s * 1e6).toPrecision(3)} µs`;
  if (s < 1) return `${(s * 1e3).toPrecision(3)} ms`;
  return `${s.toPrecision(3)} s`;
};

const fmtLength = (m) => {
  if (!Number.isFinite(m)) return '—';
  if (m < 1e-3) return `${(m * 1e6).toPrecision(3)} µm`;
  if (m < 1) return `${(m * 1e3).toPrecision(3)} mm`;
  return `${m.toPrecision(3)} m`;
};

const fmtFreq = (hz) =>
  !Number.isFinite(hz) ? '—' : hz >= 1000 ? `${(hz / 1000).toPrecision(3)} kHz` : `${hz.toPrecision(3)} Hz`;

const tidy = (v) => Number(Number(v).toPrecision(6));

const fmtSpeed = (v) =>
  v < 0.1 ? `${Number((v * 1000).toPrecision(3))} mm/s` : `${Number(v.toPrecision(3))} m/s`;

const fmtPercent = (v) => `${Number((v * 100).toPrecision(3))} %`;

/* A decade window around everything worth showing, at least three decades wide. */
const dtDomain = (result) => {
  const t = result.timing;
  const values = [t.dt, t.dtFloor, t.dtImage, t.dtSheet, t.dtCorrelation, t.dtRecommended]
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) return [1e-7, 1];
  let lo = Math.floor(Math.log10(Math.min(...values) / 2));
  let hi = Math.ceil(Math.log10(Math.max(...values) * 2));
  while (hi - lo < 2) { lo -= 1; hi += 1; }
  if (hi - lo > 6) lo = hi - 6;
  return [10 ** lo, 10 ** hi];
};

/* Round up to the next 1, 2 or 5 times a power of ten. */
const niceCeil = (value) => {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const step = [1, 2, 5, 10].find((s) => value <= s * base) ?? 10;
  return step * base;
};

/* --------------------------------------------------------------- elements */

const NS = 'http://www.w3.org/2000/svg';

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
};

const svg = (tag, attrs = {}, text) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
};

const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

/* ----------------------------------------------------------------- scales */

const logScale = (domain, range) => {
  const [d0, d1] = [Math.log10(domain[0]), Math.log10(domain[1])];
  const [r0, r1] = range;
  const fn = (v) =>
    r0 + ((Math.log10(clamp(v, domain[0], domain[1])) - d0) / (d1 - d0)) * (r1 - r0);
  fn.domain = domain;
  fn.range = range;
  return fn;
};

const linScale = (domain, range) => {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  return (v) => r0 + ((clamp(v, d0, d1) - d0) / (d1 - d0 || 1)) * (r1 - r0);
};

const decades = (lo, hi) => {
  const out = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e += 1) {
    out.push(10 ** e);
  }
  return out;
};

/* ------------------------------------------------------------------ state */

let state = { ...DEFAULTS };
let activePreset = 'water-channel';

const readUrl = () => {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (![...params.keys()].length) return null;
  const preset = params.get('p');
  const base = preset && PRESET_BY_ID[preset] ? { ...PRESET_BY_ID[preset].input } : { ...DEFAULTS };
  if (preset && PRESET_BY_ID[preset]) activePreset = preset;
  for (const field of FIELDS) {
    if (!params.has(field.key)) continue;
    const value = params.get(field.key);
    if (field.type === 'checkbox') base[field.id] = value === '1';
    else if (Number.isFinite(Number(value))) base[field.id] = field.toSI(Number(value));
  }
  return base;
};

const writeUrl = () => {
  const params = new URLSearchParams();
  params.set('p', activePreset);
  const base = PRESET_BY_ID[activePreset]?.input ?? DEFAULTS;
  for (const field of FIELDS) {
    if (field.type === 'checkbox') {
      if (Boolean(state[field.id]) === Boolean(base[field.id])) continue;
      params.set(field.key, state[field.id] ? '1' : '0');
      continue;
    }
    const value = tidy(field.toDisplay(state[field.id]));
    if (value === tidy(field.toDisplay(base[field.id]))) continue;
    params.set(field.key, String(value));
  }
  const url = `${location.pathname}${location.search}#${params.toString()}`;
  history.replaceState(null, '', url);
};

/* ------------------------------------------------------------------- form */

const buildForm = (form) => {
  for (const section of SECTIONS) {
    const grid = el('div', { class: 'field-grid' });
    for (const field of FIELDS.filter((f) => f.section === section.id)) {
      if (field.type === 'checkbox') {
        const input = el('input', { type: 'checkbox', id: `in-${field.id}` });
        grid.appendChild(
          el('div', { class: 'field-check span-2', title: field.help }, [
            input,
            el('label', { for: `in-${field.id}`, text: field.label })
          ])
        );
        continue;
      }
      const input = el('input', {
        type: 'number',
        id: `in-${field.id}`,
        min: field.min,
        max: field.max,
        step: field.step,
        inputmode: 'decimal'
      });
      grid.appendChild(
        el('div', { class: `field${field.section === 'target' ? ' span-2' : ''}`, title: field.help }, [
          el('div', { class: 'field-label' }, [
            el('label', { for: `in-${field.id}`, text: field.label }),
            el('span', { class: 'field-unit', text: field.unit })
          ]),
          input
        ])
      );
    }
    if (section.id === 'seeding') {
      const select = el('select', { id: 'in-fluid' });
      for (const [key, fluid] of Object.entries(FLUIDS)) {
        select.appendChild(el('option', { value: key, text: fluid.label }));
      }
      grid.insertBefore(
        el('div', { class: 'field span-2' }, [
          el('div', { class: 'field-label' }, [el('label', { for: 'in-fluid', text: 'Working fluid' })]),
          select
        ]),
        grid.firstChild
      );
    }
    form.appendChild(el('section', { class: 'card' }, [el('h2', { text: section.title }), grid]));
  }
};

const syncFluidSelect = () => {
  const select = document.getElementById('in-fluid');
  const match = Object.entries(FLUIDS).find(
    ([key, fluid]) =>
      key !== 'custom' &&
      Math.abs(fluid.density - state.fluidDensity) < 1e-6 &&
      Math.abs(fluid.viscosity - state.fluidViscosity) < 1e-12
  );
  select.value = match ? match[0] : 'custom';
};

const writeForm = () => {
  for (const field of FIELDS) {
    const input = document.getElementById(`in-${field.id}`);
    if (!input) continue;
    if (field.type === 'checkbox') input.checked = Boolean(state[field.id]);
    else input.value = String(tidy(field.toDisplay(state[field.id])));
  }
  syncFluidSelect();
};

const readForm = () => {
  const next = { ...state };
  for (const field of FIELDS) {
    const input = document.getElementById(`in-${field.id}`);
    if (!input) continue;
    if (field.type === 'checkbox') {
      next[field.id] = input.checked;
      continue;
    }
    const value = Number(input.value);
    if (input.value !== '' && Number.isFinite(value)) next[field.id] = field.toSI(value);
  }
  return next;
};

/* ---------------------------------------------------------------- charts */

const drawAxis = (root, { x, y0, y1, ticks, format, title, titleY, tickOffset = 16 }) => {
  for (const tick of ticks) {
    const px = x(tick);
    root.appendChild(svg('line', { x1: px, y1: y0, x2: px, y2: y1, class: 'grid' }));
    root.appendChild(
      svg('text', { x: px, y: y1 + tickOffset, 'text-anchor': 'middle', class: 'tick' }, format(tick))
    );
  }
  root.appendChild(svg('line', { x1: x.range[0], y1: y1, x2: x.range[1], y2: y1, class: 'axis' }));
  if (title) {
    root.appendChild(
      svg('text', {
        x: (x.range[0] + x.range[1]) / 2,
        y: titleY,
        'text-anchor': 'middle',
        class: 'axis-title'
      }, title)
    );
  }
};

const marker = (root, { x, y0, y1, label, cls, labelY, anchorFlip, skip }) => {
  if (skip) return;
  root.appendChild(svg('line', { x1: x, y1: y0, x2: x, y2: y1, class: cls }));
  root.appendChild(
    svg('text', {
      x: anchorFlip ? x - 5 : x + 5,
      y: labelY,
      'text-anchor': anchorFlip ? 'end' : 'start',
      class: 'annotation'
    }, label)
  );
};

const renderWindowChart = (result, DT_DOMAIN) => {
  const node = document.getElementById('chart-window');
  clear(node);
  const [w, h] = [760, 284];
  const pad = { top: 40, right: 26, bottom: 82, left: 26 };
  const x = logScale(DT_DOMAIN, [pad.left, w - pad.right]);
  const y0 = pad.top;
  const y1 = h - pad.bottom;
  const { timing } = result;

  const outside = (value) => !(value >= DT_DOMAIN[0] && value <= DT_DOMAIN[1]);

  const seg = (from, to, cls) => {
    const a = x(from);
    const b = x(to);
    if (b - a <= 0.5) return;
    node.appendChild(svg('rect', { x: a, y: y0, width: b - a, height: y1 - y0, class: cls }));
  };

  const floorX = timing.dtFloor;
  const recX = timing.dtRecommended;
  const hardX = timing.dtHard;
  seg(DT_DOMAIN[0], floorX, 'zone-floor');
  if (recX > floorX) seg(floorX, recX, 'zone-pass');
  seg(Math.max(floorX, recX), hardX, 'zone-margin');
  seg(hardX, DT_DOMAIN[1], 'zone-fail');

  drawAxis(node, {
    x,
    y0,
    y1,
    ticks: decades(DT_DOMAIN[0], DT_DOMAIN[1]),
    format: fmtTime,
    title: 'Pulse-pair separation Δt',
    titleY: h - 14,
    tickOffset: 36
  });

  /* The usable band is often a fraction of a decade wide, so it also gets an
     explicit bracket under the axis where it cannot be missed. */
  const bracket = (from, to, cls, label) => {
    const a = clamp(x(from), pad.left, w - pad.right);
    const b = clamp(x(to), pad.left, w - pad.right);
    const by = y1 + 13;
    const stroke = cls === 'ok' ? 'band-ok' : 'band-bad';
    node.appendChild(svg('line', { x1: a, y1: by, x2: Math.max(b, a + 1), y2: by, class: stroke }));
    for (const px of [a, Math.max(b, a + 1)]) {
      node.appendChild(svg('line', { x1: px, y1: by - 5, x2: px, y2: by + 5, class: stroke }));
    }
    const right = b > (pad.left + w - pad.right) / 2;
    const text = svg('text', {
      x: right ? a - 8 : b + 8,
      y: by + 4,
      'text-anchor': right ? 'end' : 'start',
      class: 'annotation'
    }, label);
    node.appendChild(text);
  };
  if (timing.windowConflict) {
    bracket(recX, floorX, 'bad', 'no Δt satisfies both limits');
  } else {
    bracket(floorX, recX, 'ok', `usable ${fmtTime(timing.dtFloor)} – ${fmtTime(timing.dtRecommended)}`);
  }

  const zoneLabel = (from, to, text) => {
    const a = Math.max(x(from), pad.left);
    const b = Math.min(x(to), w - pad.right);
    if (b - a < 78) return;
    node.appendChild(
      svg('text', { x: (a + b) / 2, y: y0 + 16, 'text-anchor': 'middle', class: 'zone-label' }, text)
    );
  };
  zoneLabel(DT_DOMAIN[0], floorX, 'noise limited');
  if (recX > floorX) zoneLabel(floorX, recX, 'recommended');
  zoneLabel(Math.max(floorX, recX), hardX, 'margin');
  zoneLabel(hardX, DT_DOMAIN[1], 'pairs lost');

  marker(node, {
    x: x(timing.dtImage), y0, y1, skip: outside(timing.dtImage), cls: 'marker-image',
    label: `in-plane ${fmtTime(timing.dtImage)}`,
    labelY: y1 - 12,
    anchorFlip: x(timing.dtImage) > w - 200
  });
  if (Number.isFinite(timing.dtSheet)) {
    marker(node, {
      x: x(timing.dtSheet), y0, y1, skip: outside(timing.dtSheet), cls: 'marker-sheet',
      label: `sheet ${fmtTime(timing.dtSheet)}`,
      labelY: y1 - 30,
      anchorFlip: x(timing.dtSheet) > w - 200
    });
  }
  if (timing.dtCorrelation > 0 && Number.isFinite(timing.dtCorrelation)) {
    marker(node, {
      x: x(timing.dtCorrelation), y0, y1, skip: outside(timing.dtCorrelation), cls: 'marker-correlation',
      label: `N_I F_I F_O = 7 at ${fmtTime(timing.dtCorrelation)}`,
      labelY: y1 - 48,
      anchorFlip: x(timing.dtCorrelation) > w - 260
    });
  }
  marker(node, {
    x: x(timing.framePeriod), y0, y1, skip: outside(timing.framePeriod), cls: 'marker-rate',
    label: `frame period ${fmtTime(timing.framePeriod)}`,
    labelY: y0 + 34,
    anchorFlip: x(timing.framePeriod) > w - 220
  });
  marker(node, {
    x: x(timing.dt), y0: y0 - 14, y1, cls: 'marker-choice',
    label: `chosen ${fmtTime(timing.dt)}`,
    labelY: y0 - 20,
    anchorFlip: x(timing.dt) > w - 160
  });
};

const renderTradeoffChart = (result, DT_DOMAIN) => {
  const node = document.getElementById('chart-tradeoff');
  clear(node);
  const [w, h] = [760, 260];
  const pad = { top: 26, right: 66, bottom: 58, left: 62 };
  const x = logScale(DT_DOMAIN, [pad.left, w - pad.right]);
  const y0 = pad.top;
  const y1 = h - pad.bottom;
  const { points } = sweepDt(result, { min: DT_DOMAIN[0], max: DT_DOMAIN[1], samples: 200 });
  const meritMax = niceCeil(Math.max(10, result.correlation.ni * 1.15));
  const yMerit = linScale([0, meritMax], [y1, y0]);
  const errDomain = [1e-4, 1];
  const yError = logScale(errDomain, [y1, y0]);

  drawAxis(node, {
    x, y0, y1,
    ticks: decades(DT_DOMAIN[0], DT_DOMAIN[1]),
    format: fmtTime,
    title: 'Pulse-pair separation Δt',
    titleY: h - 16
  });

  /* Left axis: valid-detection merit. */
  node.appendChild(svg('line', { x1: pad.left, y1: y0, x2: pad.left, y2: y1, class: 'axis' }));
  for (const value of [0, meritMax / 4, meritMax / 2, (3 * meritMax) / 4, meritMax]) {
    node.appendChild(
      svg('text', { x: pad.left - 8, y: yMerit(value) + 4, 'text-anchor': 'end', class: 'tick' },
        String(Number(value.toPrecision(3))))
    );
  }
  node.appendChild(
    svg('text', {
      x: 16, y: (y0 + y1) / 2, transform: `rotate(-90 16 ${(y0 + y1) / 2})`,
      'text-anchor': 'middle', class: 'axis-title'
    }, 'N_I F_I F_O')
  );

  /* Right axis: relative uncertainty. */
  node.appendChild(svg('line', { x1: w - pad.right, y1: y0, x2: w - pad.right, y2: y1, class: 'axis' }));
  for (const value of decades(errDomain[0], errDomain[1])) {
    node.appendChild(
      svg('text', { x: w - pad.right + 8, y: yError(value) + 4, class: 'tick' }, fmtPercent(value))
    );
  }
  node.appendChild(
    svg('text', {
      x: w - 12, y: (y0 + y1) / 2, transform: `rotate(-90 ${w - 12} ${(y0 + y1) / 2})`,
      'text-anchor': 'middle', class: 'axis-title'
    }, 'σ_U / U_d')
  );

  const path = (accessor, scale, cls) => {
    let d = '';
    let open = false;
    for (const point of points) {
      const value = accessor(point);
      if (!Number.isFinite(value) || value <= 0) { open = false; continue; }
      const px = x(point.dt);
      const py = scale(value);
      if (py < y0 - 1 || py > y1 + 1) { open = false; continue; }
      d += `${open ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)} `;
      open = true;
    }
    if (d) node.appendChild(svg('path', { d: d.trim(), class: cls }));
  };

  node.appendChild(svg('line', {
    x1: pad.left, y1: yMerit(THRESHOLDS.correlationPass),
    x2: w - pad.right, y2: yMerit(THRESHOLDS.correlationPass), class: 'target-line'
  }));
  node.appendChild(svg('text', {
    x: pad.left + 6, y: yMerit(THRESHOLDS.correlationPass) - 5, class: 'annotation'
  }, 'merit target 7'));
  node.appendChild(svg('line', {
    x1: pad.left, y1: yError(THRESHOLDS.relativeErrorPass),
    x2: w - pad.right, y2: yError(THRESHOLDS.relativeErrorPass), class: 'target-line'
  }));
  node.appendChild(svg('text', {
    x: w - pad.right - 6, y: yError(THRESHOLDS.relativeErrorPass) - 5,
    'text-anchor': 'end', class: 'annotation'
  }, 'uncertainty target 2%'));

  path((p) => p.merit, yMerit, 'curve-merit');
  path((p) => p.relativeError, yError, 'curve-error');

  marker(node, {
    x: x(result.timing.dt), y0: y0 - 8, y1, cls: 'marker-choice',
    label: `chosen ${fmtTime(result.timing.dt)}`,
    labelY: y0 - 12,
    anchorFlip: x(result.timing.dt) > w - 160
  });
};

const renderMapChart = (result) => {
  const node = document.getElementById('chart-map');
  clear(node);
  const [w, h] = [760, 420];
  const pad = { top: 30, right: 26, bottom: 66, left: 74 };
  const lengthDomain = [1e-4, 2];
  const speedDomain = [1e-3, 100];
  const x = logScale(lengthDomain, [pad.left, w - pad.right]);
  const y = logScale(speedDomain, [h - pad.bottom, pad.top]);
  const left = pad.left;
  const right = w - pad.right;
  const top = pad.top;
  const bottom = h - pad.bottom;
  const { input, flow, interrogation } = result;
  const rate = input.rate;

  /* Boundaries L = n U / f are straight lines of unit slope on log-log axes. */
  const boundary = (n) => ({
    top: x((n * speedDomain[1]) / rate),
    bottom: x((n * speedDomain[0]) / rate)
  });
  const two = boundary(2);
  const five = boundary(5);
  node.appendChild(svg('polygon', {
    points: `${left},${top} ${two.top},${top} ${two.bottom},${bottom} ${left},${bottom}`,
    class: 'zone-fail'
  }));
  node.appendChild(svg('polygon', {
    points: `${two.top},${top} ${five.top},${top} ${five.bottom},${bottom} ${two.bottom},${bottom}`,
    class: 'zone-margin'
  }));
  node.appendChild(svg('polygon', {
    points: `${five.top},${top} ${right},${top} ${right},${bottom} ${five.bottom},${bottom}`,
    class: 'zone-pass'
  }));

  for (const tick of decades(lengthDomain[0], lengthDomain[1])) {
    node.appendChild(svg('line', { x1: x(tick), y1: top, x2: x(tick), y2: bottom, class: 'grid' }));
    node.appendChild(svg('text', { x: x(tick), y: bottom + 17, 'text-anchor': 'middle', class: 'tick' },
      fmtLength(tick)));
  }
  for (const tick of decades(speedDomain[0], speedDomain[1])) {
    node.appendChild(svg('line', { x1: left, y1: y(tick), x2: right, y2: y(tick), class: 'grid' }));
    node.appendChild(svg('text', { x: left - 10, y: y(tick) + 4, 'text-anchor': 'end', class: 'tick' },
      fmtSpeed(tick)));
  }
  node.appendChild(svg('line', { x1: left, y1: bottom, x2: right, y2: bottom, class: 'axis' }));
  node.appendChild(svg('line', { x1: left, y1: top, x2: left, y2: bottom, class: 'axis' }));
  node.appendChild(svg('text', { x: (left + right) / 2, y: h - 20, 'text-anchor': 'middle', class: 'axis-title' },
    'Structure length L'));
  node.appendChild(svg('text', {
    x: 18, y: (top + bottom) / 2, transform: `rotate(-90 18 ${(top + bottom) / 2})`,
    'text-anchor': 'middle', class: 'axis-title'
  }, 'Convection velocity U_c'));

  const lowU = Math.max(speedDomain[0], input.uMean - input.k * input.uRms);
  const highU = Math.min(speedDomain[1], Math.max(speedDomain[0], input.uMean + input.k * input.uRms));
  node.appendChild(svg('rect', {
    x: left, y: y(highU), width: right - left, height: Math.max(1, y(lowU) - y(highU)), class: 'band-flow'
  }));
  node.appendChild(svg('line', { x1: left, y1: y(input.uMean), x2: right, y2: y(input.uMean), class: 'line-mean' }));
  node.appendChild(svg('line', { x1: left, y1: y(flow.uDesign), x2: right, y2: y(flow.uDesign), class: 'line-design' }));

  /* Spatial limits are vertical: they do not depend on the convection speed. */
  const vline = (value, cls, label, labelY) => {
    const px = x(value);
    node.appendChild(svg('line', { x1: px, y1: top, x2: px, y2: bottom, class: cls }));
    const flip = px > right - 150;
    node.appendChild(svg('text', {
      x: flip ? px - 5 : px + 5, y: labelY, 'text-anchor': flip ? 'end' : 'start', class: 'annotation'
    }, label));
  };
  vline(interrogation.windowSize, 'line-window', `window ${fmtLength(interrogation.windowSize)}`, bottom - 12);
  vline(2 * interrogation.vectorSpacing, 'line-nyquist', `2 × spacing ${fmtLength(2 * interrogation.vectorSpacing)}`, bottom - 30);
  vline(input.structureLength, 'line-structure', `target L ${fmtLength(input.structureLength)}`, top + 42);

  node.appendChild(svg('circle', {
    cx: x(result.temporal.theoreticalLength), cy: y(flow.uDesign), r: 6, class: 'dot-theory'
  }));
  node.appendChild(svg('circle', {
    cx: x(result.temporal.conservativeLength), cy: y(flow.uDesign), r: 6, class: 'dot-conservative'
  }));
  node.appendChild(svg('text', {
    x: left + 8, y: y(flow.uDesign) - 8, class: 'annotation'
  }, `U_d = ${flow.uDesign.toPrecision(3)} m/s`));

  const zoneLabel = (a, b, text) => {
    if (b - a < 90) return;
    node.appendChild(svg('text', { x: (a + b) / 2, y: top + 18, 'text-anchor': 'middle', class: 'zone-label' }, text));
  };
  zoneLabel(left, two.top, 'under-sampled');
  zoneLabel(two.top, five.top, '2–5 fields');
  zoneLabel(five.top, right, '≥ 5 fields');
};

const LEGENDS = {
  'legend-window': [
    ['marker-choice', 'chosen Δt'],
    ['marker-image', 'in-plane limit'],
    ['marker-sheet', 'sheet limit'],
    ['marker-correlation', 'valid-detection limit'],
    ['marker-rate', 'frame period']
  ],
  'legend-tradeoff': [
    ['curve-merit', 'valid-detection merit'],
    ['curve-error', 'relative uncertainty'],
    ['marker-choice', 'chosen Δt']
  ],
  'legend-map': [
    ['line-design', 'design velocity U_d'],
    ['line-mean', 'mean velocity'],
    ['line-window', 'window width'],
    ['line-nyquist', 'vector Nyquist'],
    ['line-structure', 'target L']
  ]
};

const renderLegends = () => {
  for (const [id, entries] of Object.entries(LEGENDS)) {
    const node = document.getElementById(id);
    clear(node);
    for (const [cls, label] of entries) {
      const swatch = svg('svg', { width: 18, height: 8, 'aria-hidden': 'true' });
      swatch.appendChild(svg('line', { x1: 0, y1: 4, x2: 18, y2: 4, class: cls }));
      node.appendChild(el('span', {}, [swatch, el('span', { text: label })]));
    }
  }
};

/* ---------------------------------------------------------------- results */

const statCards = (result) => {
  const { timing, displacement, correlation, imaging, interrogation, temporal } = result;
  return [
    ['Recommended Δt', `≤ ${fmtTime(timing.dtRecommended)}`, `limited by ${timing.limiter}`],
    ['Usable Δt band', timing.windowConflict ? 'none' : `${fmtTime(timing.dtFloor)} – ${fmtTime(timing.dtRecommended)}`,
      timing.windowConflict ? 'accuracy floor is above the retention ceiling' : 'accuracy floor to recommended ceiling'],
    ['Image displacement', `${displacement.displacementPx.toFixed(1)} px`, `cap ${displacement.allowedPx.toFixed(1)} px, DVR ${displacement.dynamicVelocityRange.toFixed(0)}:1`],
    ['Valid-detection merit', correlation.merit.toFixed(1), `N_I = ${correlation.ni.toFixed(1)} per window`],
    ['Particle image size', `${imaging.imageDiameterPx.toFixed(2)} px`, `M = ${imaging.magnification.toPrecision(3)}, δz = ${fmtLength(imaging.depthOfField)}`],
    ['Velocity resolution', `${displacement.velocityResolution.toPrecision(3)} m/s`, `${(displacement.relativeError * 100).toFixed(2)} % of U_d`],
    ['Vector spacing', fmtLength(interrogation.vectorSpacing), `${interrogation.vectorsAcross} vectors across the image`],
    ['Fields per structure', Number.isFinite(temporal.temporalSamples) ? temporal.temporalSamples.toPrecision(3) : '∞',
      `convection ${fmtFreq(temporal.convectionFrequency)}, Nyquist needs ${fmtFreq(2 * temporal.convectionFrequency)}`]
  ];
};

const renderStats = (result) => {
  const node = document.getElementById('stats');
  clear(node);
  for (const [label, value, note] of statCards(result)) {
    node.appendChild(
      el('div', { class: 'stat' }, [
        el('span', { class: 'stat-label', text: label }),
        el('span', { class: 'stat-value', text: value }),
        el('span', { class: 'stat-note', text: note })
      ])
    );
  }
};

const renderVerdict = (result) => {
  const chip = document.getElementById('verdict-chip');
  const headline = document.getElementById('verdict-headline');
  const detail = document.getElementById('verdict-detail');
  const banner = document.getElementById('verdict');
  const failing = result.checks.filter((c) => c.status === 'fail');
  const marginal = result.checks.filter((c) => c.status === 'margin');

  banner.className = `card verdict verdict-${result.verdict}`;
  chip.className = `chip chip-${result.verdict}`;
  chip.textContent = result.verdict === 'pass' ? 'feasible' : result.verdict === 'margin' ? 'tight' : 'not feasible';

  if (result.verdict === 'pass') {
    headline.textContent = 'Every criterion is satisfied';
    detail.textContent = `Δt = ${fmtTime(result.timing.dt)} sits inside the recommended band and the design velocity is ${result.flow.uDesign.toPrecision(3)} m/s.`;
  } else {
    const worst = failing.length ? failing : marginal;
    headline.textContent = failing.length
      ? `${failing.length} ${failing.length > 1 ? 'criteria' : 'criterion'} not met: ${worst.map((c) => c.label.toLowerCase()).join(', ')}`
      : `Little margin on ${marginal.map((c) => c.label.toLowerCase()).join(', ')}`;
    detail.textContent = worst
      .map((c) => `${c.label}: ${REMEDIES[c.id] ?? 'revise the configuration'}`)
      .join('. ') + '.';
  }
  if (result.timing.windowConflict) {
    detail.textContent += ` No Δt satisfies both the ${(THRESHOLDS.relativeErrorPass * 100).toFixed(0)} % accuracy floor and the retention ceiling: enlarge the window, magnify more, or accept a coarser velocity resolution.`;
  }
};

const renderChecks = (result) => {
  const node = document.getElementById('checks');
  clear(node);
  for (const check of result.checks) {
    node.appendChild(
      el('div', { class: `check check-${check.status}` }, [
        el('span', { class: 'check-label', text: check.label }),
        el('span', { class: 'check-value', text: check.value }),
        el('span', { class: `chip chip-${check.status}`, text: check.status }),
        el('span', { class: 'check-detail', text: check.detail }),
        el('span', { class: 'check-formula', text: check.formula })
      ])
    );
  }
};

/* ---------------------------------------------------------------- exports */

const summaryMarkdown = (result) => {
  const lines = [];
  lines.push('# PIV acquisition feasibility');
  lines.push('');
  lines.push(`Verdict: **${result.verdict}** at Δt = ${fmtTime(result.timing.dt)}, ${fmtFreq(result.input.rate)} repetition rate.`);
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push('| Quantity | Value |');
  lines.push('| --- | --- |');
  for (const field of FIELDS) {
    const value = field.type === 'checkbox'
      ? (result.input[field.id] ? 'yes' : 'no')
      : `${tidy(field.toDisplay(result.input[field.id]))} ${field.unit}`;
    lines.push(`| ${field.label} | ${value} |`);
  }
  lines.push('');
  lines.push('## Derived');
  lines.push('');
  lines.push('| Quantity | Value | Note |');
  lines.push('| --- | --- | --- |');
  for (const [label, value, note] of statCards(result)) lines.push(`| ${label} | ${value} | ${note} |`);
  lines.push('');
  lines.push('## Criteria');
  lines.push('');
  lines.push('| Criterion | Value | Status | Detail |');
  lines.push('| --- | --- | --- | --- |');
  for (const check of result.checks) {
    lines.push(`| ${check.label} | ${check.value} | ${check.status} | ${check.detail} |`);
  }
  lines.push('');
  lines.push(`Link: ${location.href}`);
  return lines.join('\n');
};

const toast = (message) => {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.dataset.visible = 'true';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.dataset.visible = 'false'; }, 1800);
};

const copyText = async (text, message) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const area = el('textarea', { class: 'sr-only' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy');
    area.remove();
    toast(ok ? message : 'Copy failed; select the text manually');
  }
};

const downloadJson = (result) => {
  const payload = {
    tool: 'piv-acquisition-feasibility-calculator',
    preset: activePreset,
    link: location.href,
    inputsSI: result.input,
    verdict: result.verdict,
    checks: result.checks.map(({ id, label, value, detail, status, formula }) => ({
      id, label, value, detail, status, formula
    })),
    derived: {
      imaging: result.imaging,
      flow: result.flow,
      displacement: result.displacement,
      correlation: result.correlation,
      interrogation: result.interrogation,
      gradient: result.gradient,
      tracer: result.tracer,
      timing: result.timing,
      temporal: result.temporal
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'piv-feasibility.json' });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast('Downloaded piv-feasibility.json');
};

/* ------------------------------------------------------------------- boot */

const render = () => {
  const result = evaluate(state);
  renderVerdict(result);
  renderStats(result);
  const domain = dtDomain(result);
  renderWindowChart(result, domain);
  renderTradeoffChart(result, domain);
  renderMapChart(result);
  renderChecks(result);
  writeUrl();
  return result;
};

const applyTheme = (theme) => {
  const root = document.documentElement;
  if (theme) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  document.getElementById('action-theme').setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
};

const storedTheme = () => {
  try { return localStorage.getItem('piv-theme'); } catch { return null; }
};

const init = () => {
  const form = document.getElementById('controls');
  buildForm(form);
  renderLegends();

  const preset = document.getElementById('preset');
  for (const item of PRESETS) preset.appendChild(el('option', { value: item.id, text: item.label }));

  const fromUrl = readUrl();
  state = fromUrl ?? { ...PRESET_BY_ID[activePreset].input };
  preset.value = activePreset;
  writeForm();
  render();

  form.addEventListener('input', () => {
    state = readForm();
    syncFluidSelect();
    render();
  });

  document.getElementById('in-fluid').addEventListener('change', (event) => {
    const fluid = FLUIDS[event.target.value];
    if (!fluid) return;
    state = { ...state, fluidDensity: fluid.density, fluidViscosity: fluid.viscosity };
    writeForm();
    render();
  });

  preset.addEventListener('change', (event) => {
    const item = PRESET_BY_ID[event.target.value];
    if (!item) return;
    activePreset = item.id;
    state = { ...item.input };
    writeForm();
    render();
    toast(item.note);
  });

  document.getElementById('action-link').addEventListener('click', () => {
    writeUrl();
    copyText(location.href, 'Link copied');
  });
  document.getElementById('action-summary').addEventListener('click', () => {
    copyText(summaryMarkdown(evaluate(state)), 'Summary copied as Markdown');
  });
  document.getElementById('action-json').addEventListener('click', () => downloadJson(evaluate(state)));
  document.getElementById('action-theme').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('piv-theme', next); } catch { /* private mode */ }
  });

  window.addEventListener('hashchange', () => {
    const next = readUrl();
    if (!next) return;
    state = next;
    document.getElementById('preset').value = activePreset;
    writeForm();
    render();
  });

  applyTheme(storedTheme());
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

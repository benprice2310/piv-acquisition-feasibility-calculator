/*
 * Starting points for common 2D PIV arrangements. Values are SI and complete:
 * selecting a preset replaces the whole input set.
 */

import { DEFAULTS, FLUIDS } from './model.js';

const water = {
  fluidDensity: FLUIDS.water.density,
  fluidViscosity: FLUIDS.water.viscosity,
  particleDiameter: 10e-6,
  particleDensity: 1050
};

const air = {
  fluidDensity: FLUIDS.air.density,
  fluidViscosity: FLUIDS.air.viscosity,
  particleDiameter: 1e-6,
  particleDensity: 900
};

export const PRESETS = [
  {
    id: 'water-channel',
    label: 'Water channel, 15 Hz Nd:YAG',
    note: 'Bench-top channel with a double-pulse laser. Time resolution is the binding constraint.',
    input: { ...DEFAULTS }
  },
  {
    id: 'water-timeresolved',
    label: 'Water tunnel, time resolved',
    note: 'High-speed camera and pulsed diode laser at 500 Hz; large pixels need a slow lens.',
    input: {
      ...DEFAULTS,
      ...water,
      dt: 7e-4,
      rate: 500,
      uMean: 0.3,
      uRms: 0.05,
      wMean: 0,
      wRms: 0.03,
      fovWidth: 0.06,
      imageWidthPx: 1024,
      pixelPitch: 20e-6,
      fNumber: 22,
      wavelength: 527e-9,
      sheetThickness: 1.5e-3,
      concentration: 4e9,
      structureLength: 0.015
    }
  },
  {
    id: 'air-jet',
    label: 'High-speed air jet, 10 kHz',
    note: 'Sub-10 µs pulse separation; DEHS droplets track the shear layer.',
    input: {
      ...DEFAULTS,
      ...air,
      dt: 9e-6,
      rate: 10000,
      uMean: 20,
      uRms: 2,
      wMean: 0,
      wRms: 1.5,
      fovWidth: 0.04,
      imageWidthPx: 1024,
      pixelPitch: 20e-6,
      fNumber: 22,
      wavelength: 527e-9,
      sheetThickness: 1e-3,
      concentration: 10e9,
      structureLength: 0.02
    }
  },
  {
    id: 'wind-tunnel',
    label: 'Wind tunnel, large field of view',
    note: 'Statistically converged mean fields; 5 Hz cannot follow structures in time.',
    input: {
      ...DEFAULTS,
      ...air,
      dt: 6e-5,
      rate: 5,
      uMean: 10,
      uRms: 0.5,
      wMean: 0,
      wRms: 0.5,
      fovWidth: 0.3,
      imageWidthPx: 4096,
      pixelPitch: 5.5e-6,
      fNumber: 8,
      sheetThickness: 2e-3,
      windowPx: 48,
      concentration: 1e9,
      structureLength: 0.1
    }
  },
  {
    id: 'plume',
    label: 'Buoyant plume in air, 100 Hz',
    note: 'Slow flow, so the accuracy floor rather than pair loss sets the pulse separation.',
    input: {
      ...DEFAULTS,
      ...air,
      dt: 7e-4,
      rate: 120,
      uMean: 0.3,
      uRms: 0.1,
      wMean: 0,
      wRms: 0.05,
      fovWidth: 0.15,
      imageWidthPx: 2048,
      sheetThickness: 2e-3,
      concentration: 2e9,
      structureLength: 0.03
    }
  }
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

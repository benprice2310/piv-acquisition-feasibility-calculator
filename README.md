# PIV Acquisition Feasibility Calculator

A browser-based planning tool for two-dimensional particle image velocimetry (PIV). It evaluates three distinct measurement constraints:

- particle-pair retention within a pulse pair;
- spatial resolution of a desired flow structure; and
- temporal sampling of advecting structures across successive PIV fields.

## Use

Open `index.html` in a modern web browser. No installation or server is required.

Enter the laser timing, expected flow velocities, camera field of view, interrogation settings, laser-sheet thickness, and desired structure length. The tool updates its operating maps and feasibility checks immediately.

## Model

The particle-pair calculation uses the design velocities

```text
U_design = U_mean + k u_rms
W_design = k w_rms
```

and checks image displacement and out-of-plane sheet traversal during the pulse-pair separation.

The spatial calculation distinguishes the physical interrogation-window width from vector spacing:

```text
window width = window pixels × field of view / image pixels
vector spacing = window width × (1 − overlap)
```

Overlap increases vector density but does not recover spatial information filtered by the interrogation window.

The temporal calculation estimates the number of velocity fields acquired while a structure of length `L` advects past the measurement plane:

```text
samples = repetition rate × L / U_design
```

Two samples are shown as a theoretical limit and five samples as a conservative planning threshold.

## Limitations

This is an acquisition-planning calculator, not a guarantee of successful PIV processing. Correlation quality also depends on particle-image diameter, seeding density, illumination uniformity, velocity gradients, background noise, camera timing, calibration, and the processing algorithm. The displayed spatial thresholds are practical heuristics rather than universal physical limits.

## Source

The editable visualization fragment is in `src/piv-acquisition-feasibility-calculator.html`. The root `index.html` is the standalone browser version.

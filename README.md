# PIV acquisition feasibility calculator

A browser-based planning tool for two-dimensional particle image velocimetry. Describe
the laser, camera, lens, light sheet, seeding and flow, and it reports the pulse
separation you can actually use, the scales that survive correlation, and which
criterion is the one holding you back.

Everything runs in the page. There is no server, no build step for the user, and no
network request at runtime.

## Use

Open [`index.html`](index.html) in a browser, or visit the deployed page at
`https://benprice2310.github.io/piv-acquisition-feasibility-calculator/`.

- **Presets** load a complete configuration for a water channel, a time-resolved water
  tunnel, a high-speed air jet, a large wind tunnel or a buoyant plume.
- **Copy link** puts the whole input set in the URL fragment, so a configuration can be
  shared or bookmarked. Only values that differ from the preset appear in the link.
- **Copy summary** produces a Markdown table of inputs, derived quantities and criteria
  for a lab notebook; **JSON** downloads the same content as data.
- The page is print-friendly, follows the system light/dark theme, and has a manual
  theme toggle.

## What it checks

Twelve criteria, grouped by what they constrain. Each one reports its value, its status
and the expression behind it.

### Timing

| Criterion | Expression | Target |
| --- | --- | --- |
| Particle-pair retention | `ΔX = U_d Δt / s ≤ f_s D_I` and `W_d Δt ≤ f_z Δz₀` | quarter rule, configurable |
| Valid-detection merit | `N_I F_I F_O` with `F_I = 1 − ΔX / D_I`, `F_O = 1 − W_d Δt / Δz₀` | ≥ 7 |
| Velocity uncertainty | `σ_U = σ_px s / Δt` | ≤ 2 % of `U_d` |
| Pulse pair within frame period | `Δt < 1 / f` | ≤ 0.5 |

### Imaging

| Criterion | Expression | Target |
| --- | --- | --- |
| Particle-image diameter | `d_τ = √((M d_p)² + d_diff²)`, `d_diff = 2.44 f# (1 + M) λ` | 2–4 px |
| Depth of field against sheet | `δz = 2 f# d_diff (1 + M) / M²` | `δz ≥ Δz₀` |
| Displacement gradient | `∂ΔX/∂x ≈ k u′ Δt / L` | ≤ 0.05 px/px |

### Resolution

| Criterion | Expression | Target |
| --- | --- | --- |
| Structure amplitude retained | `A/A₀ = \|sinc(D_w / L)\|` | ≥ 0.8 |
| Vectors across structure | `N_v = L / [D_w (1 − overlap)]` | ≥ 4 |
| Fields per structure | `N_t = f L / U_d` | ≥ 5 |

### Tracers

| Criterion | Expression | Target |
| --- | --- | --- |
| Stokes number | `St = τ_p U_d / L`, `τ_p = ρ_p d_p² / (18 μ)` | ≤ 0.1 |
| Settling bias | `U_g = d_p² (ρ_p − ρ_f) g / (18 μ)` | ≤ 1 % of `U_d` |

Design velocities are `U_d = U + k u′` and `W_d = W + k w′`; `s` is the image scale in
metres per pixel, `M = p / s` the magnification from the pixel pitch, `D_I` the final
interrogation window in pixels and `D_w = D_I s` its width in the flow.

Two consequences are worth stating plainly, because they are what the tool exists to
surface. Overlap adds vectors but not information: the interrogation window is a top-hat
filter, and its attenuation depends on the window width alone. And a short pulse
separation is not automatically safe — below the accuracy floor the displacement is too
small to measure precisely, so Δt has a usable band, not just a ceiling.

## Reading the charts

1. **Operating window.** A logarithmic Δt axis with four regions: below the accuracy
   floor the displacement is too small to measure precisely, then the recommended band,
   then the remaining margin, then the region where pairs are lost. The in-plane, sheet,
   valid-detection and frame-period limits are marked individually so it is obvious which
   one binds.
2. **Cost and benefit of Δt.** The valid-detection merit and the relative velocity
   uncertainty over the same axis. Lengthening Δt buys precision and spends correlation
   quality; the usable setting is where both are still acceptable.
3. **Resolvable structures.** Structure length against convection velocity. The diagonal
   bands come from the repetition rate, the vertical lines from the interrogation window
   and the vector spacing. A structure has to clear both to be measured.

## Development

```sh
npm test        # model and build tests, no dependencies
npm run build   # regenerate index.html from src/
npm run check   # build, test, and fail if index.html is stale
```

Sources live in `src/` and the deployable page is the generated `index.html`:

| File | Role |
| --- | --- |
| `src/model.js` | the physics: pure functions, SI units, no DOM |
| `src/presets.js` | complete input sets for common arrangements |
| `src/layout.html` | page markup; the form itself is generated from the field registry |
| `src/app.js` | form, URL state, charts, exports |
| `src/theme.css`, `src/app.css` | tokens and layout |
| `build.mjs` | flattens the modules into one file and stamps a hash-based CSP |
| `test/` | model behaviour, and a check that `index.html` matches `src/` |

`build.mjs` has no dependencies. It concatenates the ES modules into a single scope —
failing the build on duplicate top-level names — inlines the styles, computes SHA-256
hashes of the inline blocks and emits a `Content-Security-Policy` that admits exactly
those two blocks and nothing else. The build is deterministic, which is what lets CI
verify that the committed page matches the sources.

## Deployment

`.github/workflows/pages.yml` rebuilds the page and publishes it to GitHub Pages on
every push to `main`. Enable it once under *Settings → Pages → Source → GitHub Actions*.
`.github/workflows/ci.yml` runs the tests on every branch and fails if `index.html` was
not rebuilt after a change to `src/`.

Because the output is one static file with no external references, it can equally be
emailed, committed to a lab wiki, or opened from a USB stick offline.

## Limitations

This is an acquisition-planning tool, not a guarantee that correlation will succeed. It
says nothing about calibration, illumination uniformity, reflections, timing jitter,
laser pulse energy or the processing algorithm. The velocity difference across a window
is estimated from the design fluctuation and the structure length rather than measured;
substitute your own shear estimate when you have one. Thresholds are conventional
practice rather than physical laws, and the tool says which is which.

## References

- R. D. Keane and R. J. Adrian, *Optimization of particle image velocimeters*, Meas. Sci.
  Technol. **1** (1990) 1202.
- J. Westerweel, *Fundamentals of digital particle image velocimetry*, Meas. Sci. Technol.
  **8** (1997) 1379.
- R. J. Adrian and J. Westerweel, *Particle Image Velocimetry*, Cambridge University
  Press, 2011.
- M. Raffel, C. E. Willert, F. Scarano, C. J. Kähler, S. T. Wereley and J. Kompenhans,
  *Particle Image Velocimetry: A Practical Guide*, 3rd ed., Springer, 2018.

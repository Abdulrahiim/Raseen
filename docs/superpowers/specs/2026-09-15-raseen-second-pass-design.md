# Raseen dashboard — second pass (15 Sep 2026)

Binding spec for six changes the user asked for on 15 Sep 2026. The first-pass redesign spec
(`2026-09-15-raseen-dashboard-redesign.md`) still holds for everything it covers: tokens,
type, the instrument style, the house rules, the kill sentences. This document only adds.

The user could not be consulted mid-task, so every decision below is stated with the
assumption it rests on. Where a request could be read two ways the reading is given.

## The requests, and the reading taken

| # | Request (paraphrased) | Reading |
|---|---|---|
| 1 | The gradient page's Play is far too fast; the timing is in minutes but it flies; make it slower and adjustable. | Replay runs at 100 simulated seconds per real second (a 140-minute event in 84 s). Add a replay-speed control with a real-time option, a much slower default, remembered per browser. |
| 2 | Add to the gradient control idea: if the cloud will cover the middle 10 of 30 blocks and take 20 % of them, pre-cut all 30 by 10 %; when the cloud lands, raise the two sides to fill the gap ("a virtual battery"). | A second **response strategy**, computed as real controller code: **pre-hold and backfill**. Every block is held down evenly ahead of the front by the forecast loss plus a margin; when the cloud lands, blocks still in sun raise their output so export stays flat; after the cloud clears, everyone returns at the up-gradient. The existing farthest-first ramp stays as the other strategy. The words "virtual battery" and "store" never appear in UI copy (kill sentence); the honest phrase is "the blocks still in sun give back what they were holding". |
| 3 | The block chart shows 30 bars, but the plant has ~360 MVPS. | The controller dispatches 30 control blocks (the design basis), each a contiguous cluster of the 363 MV power stations. The chart gains a **Stations** view (363 bars grouped under their blocks, the default) beside the **Blocks** view. Stations in a block share the block's set-point, and the chart says so. |
| 4 | Make the replay slow and realistic: a notification says a cloud arrives in T, will cover X blocks, the suggested response is Y, it is running, and the system then acts. | A **guided replay**: press *Replay the event* and playback jumps to a briefing moment a few minutes before the response must start, pauses on a forecast notice with the numbers and the suggested response, and continues when *Run the response* is pressed. Further notices mark response start, contact, full cover, clearing and the end. The notices are derived from the scenario numbers, never invented. |
| 5 | Fault injection on the Humaij plant page does not work. | Three real defects (below). Fix all three, on the live server and on the static build. |
| 6 | A proper dark theme. | A full dark token set in `shell.css`, a toggle in the shared top bar, applied before first paint, remembered per browser, system preference as the default. |
| 7 | An "explain" button that animates through every part of the dashboard with Next / Previous / Skip. | A **guided tour** per view (Kingdom, Plant overview, Gradient control): a spotlight that slides from element to element with a card beside it. Started only by the button (house rule: motion only in answer to a click). |

## Fixed decisions

- Stack unchanged: vanilla HTML, ES modules, hand-written CSS, inline SVG, no build step.
- Every colour comes from a `shell.css` token. The dark theme is a second value for each token,
  not a second stylesheet.
- The controller remains real code. The new strategy is a Python scheme run by the scenario
  runner and carried in every frame, not a client-side animation.
- Nothing here changes the abstract D1 reference numbers pinned in `tests/test_control.py`.
- `ENGINE_REVISION` in `raseen/scenario/runner.py` becomes `"r3"`, because the frames change
  shape and the cache must not serve r2 files.
- Old cached scenarios and the current static files lack `P_hold`; the page must fall back
  (`frame.P_hold ?? frame.P_bgc`) rather than break.

## 1 · Replay speed

`control.js`:

- `REPLAY_RATE` is replaced by `state.speed`, simulated seconds per real second. Options,
  shown as a `<select id="rs-speed">` in the transport row: **Real time** (1), **×5**, **×10**,
  **×30**, **×60**. Default **×10**. Stored in `localStorage["rs-speed"]`.
- The timer ticks every 100 ms and accumulates `speed × 0.1` simulated seconds; frames advance
  whenever the accumulator passes the scenario's own frame step (`stepMinutes() × 60`), so the
  static build's 20-second frames and the live 10-second frames play at the same simulated
  pace. `prefers-reduced-motion` keeps the current coarser stepping.
- Space bar, ←/→ and the scrubber are unchanged.

## 2 · Pre-hold and backfill — the second strategy

### Physics (`raseen/control`)

`planner.py` — `plan_trajectory(..., hold_margin: float = 0.0)`. In the `flat` branch the hold
level becomes `H = max(0, A_min − hold_margin)`; the pre-descent starts `(plant_mw − H) / g`
before the first shaded step; the plant holds `H` until the last shaded step and re-ascends at
`g_up` from `H`. `Plan` gains `hold_mw` (`H` when flat, else `A_min`). With `hold_margin = 0`
the existing flat behaviour is bit-identical.

`allocate.py` — `allocate_hold(A, cap, target, *, slew_lim, prev, shaded) -> list[float]`:

1. band: `lo_i = max(0, prev_i − slew_i)`, `hi_i = min(A_i, prev_i + slew_i)`; a block whose
   sun fell below `lo_i` is forced to `A_i` (same rule as `allocate_bgc`);
2. start from `p_i = clamp(prev_i, lo_i, hi_i)` — a shaded block therefore follows its own
   sun down and is never curtailed further by the controller;
3. residual `r = Σp − target`. If `r > 0` (the plant must come down — the pre-hold descent),
   take it from **unshaded** blocks in proportion to `p_i` (an even fraction off every block,
   which is the user's "10 % everywhere"), within `lo_i`; then from shaded blocks the same
   way; then, only if slew cannot deliver, proportionally beyond slew. If `r < 0` (the
   plant must come up — the backfill), give it to **unshaded** blocks in proportion to their
   room `hi_i − p_i`, then to shaded blocks toward their `A_i`; if the blocks in sun cannot
   cover it, export leaves the line — that is reported, not hidden;
4. return `min(A_i, max(0, p_i))`.

`simulate.py` — `simulate_scheme(..., coverage: list[list[float]] | None = None)` and a new
scheme `"hold"`. A block is *shaded* for the hold scheme when `coverage[k][i] > 0.02` or
`etas[k][i] <= 0`; with `coverage=None` only the ETA test is used. `R` for the hold scheme is
`firm_reserve` as for `bgc` (headroom on blocks with ETA beyond the horizon — the backfill the
plant can still call on).

`runner.py` —
- `plan_h = plan_trajectory(times, A_tot_planned, PLANT_MW, g=…, flat=True,
  hold_margin=plan.delta, confidence=…, kappa=…, reserve_override=…, horizon=…)`;
  `P_star_hold` gets the same stall `apply_release` treatment and `min(·, A_tot)` clamp as
  `P_star`;
- `results["hold"] = simulate_scheme("hold", …, P_star=P_star_hold, coverage=cov)`;
- every frame carries `"P_hold": [...]` and `agg` gains `"P_hold"`, `"P_star_hold"`,
  `"R_hold"`;
- `kpis["hold"]` from `metrics(...)` with `P_star=P_star_hold`;
- `front` gains: `hold_mw` (the flat level), `hold_margin_mw` (= `delta`),
  `t_hold_start_min` (`plan_h.t_desc_start`), `t_first_min`, `t_last_min` (first / last
  shaded step of the planned field), `blocks_reached` (blocks whose planned coverage ever
  exceeds 0.5), `stations_reached` (stations whose planned coverage ever exceeds 0.5),
  `first_block`, `last_block` (ids by planned arrival among the reached blocks).
- `ENGINE_REVISION = "r3"`.

`build_static.py`'s `slim()` keeps `P_hold`, `agg.P_hold`, `agg.P_star_hold`, `agg.R_hold`.

Tests (add to `tests/test_control.py`, `tests/test_webapp.py`): the hold allocator keeps
export flat through a partial cover on a 3-block case and never curtails a shaded block;
unshaded blocks rise at contact; `hold_margin` lowers the flat line and starts the descent
earlier; `hold_margin=0` reproduces the old flat line; the scenario response carries `P_hold`,
`kpis.hold` and the new `front` fields; D1 numbers unchanged.

### The page (`control.js`)

- `state.controller ∈ {"uni","bgc","hold"}`. The hero segment stays **Plant-level | Raseen**.
  A new segment **Strategy** in *The response* panel, `id="rs-strategy"`: **Declared ramp**
  (bgc) | **Pre-hold and backfill** (hold). It applies when Raseen is the controller; choosing a
  strategy while Plant-level is selected switches the controller to Raseen.
- `P(ctl)` = `frame["P_" + ctl] ?? frame.P_bgc`; declared line = `agg.P_star_hold` for hold,
  `agg.P_star` otherwise; reserve `R_hold` for hold.
- The hero chart draws the active Raseen strategy as the accent line; the other strategy is
  not drawn (one Raseen line, as now); the declared line follows the active strategy.
- KPIs use `scn.kpis[ctl]`; the comparison "the other way" is bgc↔hold when Raseen, uni
  otherwise.
- Copy under the strategy segment (`<p class="rs-note">`), exact:
  - ramp: "Export comes down at the declared gradient and climbs back at the same rate.
    Headroom is held on the blocks the cloud reaches last, where it can still be spent."
  - hold: "Ahead of the cloud every block is held down evenly by the forecast loss plus a
    margin. When the cloud lands, the blocks still in sun raise their output and export stays
    flat through the crossing. Nothing is stored — the blocks in sun give back what they were
    holding."
- A new prepared situation, key `band-middle`, label "A band over the middle of the plant",
  params `{ cover_frac: 0.4 }`, and it selects the hold strategy when loaded (client-side
  `view: { controller: "hold" }`). Added to `SCENARIO_SITUATIONS` in `build_static.py` too.

## 3 · Stations view of the block chart

`charts.js` `blockGradient(mount, blocks, frame, opts)` gains `opts.grain ∈ {"blocks","stations"}`
and `opts.stations = { mvps, index, mw }` (the site's `mvps`, `mvps_block_index`, `mvps_mw`).

Stations view: blocks in the chosen order (by arrival / west to east); inside each block its
member stations by station number, one thin bar each, contiguous, with a 4 px gap between
blocks. A station's set-point is `P_i / cap_i × mvps_mw` and its available `A_i / cap_i ×
mvps_mw` — the block's share, because the controller dispatches blocks. Block id and ETA sit
in the header lane once per group; station numbers are not printed (hover gives "MVPS 0123 —
B07"). Cloud cover shading, headroom stack, rise marker per block as now.

Segment `id="rs-grain"` in the panel head: **Stations** (default) | **Blocks**. The panel title
becomes "Set-point of every station" / "…of every control block" with the segment. A note under
the chart, exact: "363 MV power stations in 30 control blocks. The controller dispatches
blocks; the stations in a block share its set-point."

## 4 · Guided replay

`control.js` builds, from `scn.front` and `scn.kpis`, an ordered event list:

| key | at (min) | text |
|---|---|---|
| forecast | `t_resp − 3` | "Forecast received: a {solid front / thin band / scattered cumulus} moving {heading words} at {v} km/h reaches the fence in {minutes to t=0} min. It will reach {blocks_reached} of 30 blocks ({stations_reached} of 363 stations), {first_block} first, and take up to {D} MW at full cover. Suggested response: {strategy sentence}." |
| response | `t_resp` | ramp: "Response running: export descending at {g} MW/min, headroom held on the blocks the cloud reaches last." hold: "Response running: every block held down evenly toward {hold} MW, {margin} MW of it margin for a deeper cloud." |
| contact | 0 | "Cloud at the fence. {first_block} is losing sun; the blocks still in sun are raising their output to cover it." |
| cover | `t_min` | "Full cover. Export {P at t_min} MW against {A} MW available; the plant is holding {held} MW back." |
| clearing | `t_rise` | "Clearing. Returning to full output at {g_up} MW/min." |
| stalled | `detect_at` (if any) | "The front stalled and the forecast was wrong. Curtailment is being released nearest-first; the energy spilled while waiting is logged." |
| deeper | `deepen_at` (if any) | "The front is deeper than forecast. The margin absorbs the extra loss if it can." |
| over | first frame after `t_rise` with A back at plant capacity, or the last frame | "Event over. Energy not exported: {spill} MWh, {pct} % of a clear day." |

where `t_resp = t_hold_start_min` for hold, `t_desc_start_min` for the ramp, and the strategy
sentence is the copy from §2 with the numbers filled in ("held down {h} % evenly").

Presentation:
- `Replay the event` button (`id="rs-replay"`, primary) in the transport: seeks to the
  `forecast` moment, opens the **briefing** (`id="rs-brief"`, a panel between the hero and the
  readout: the forecast text, the suggested response, buttons **Run the response** and
  **Dismiss**), and pauses. *Run the response* closes the briefing and starts playback at the
  chosen speed. *Play* alone never opens the briefing.
- During playback each event, as its time is passed, shows as a notice (`id="rs-notice"`, one
  fixed card top-right under the top bar, the one floating element this page adds; it stays
  until the next event or 12 real seconds) and is appended to the **event log**
  (`id="rs-events"`, a list under the transport inside the hero panel, hairline rows, past
  events in `--rs-text-2`, the current one in `--rs-text`, future ones muted). Scrubbing
  backwards clears later events from the log. The log is rebuilt on every scenario load.
- Reduced motion: the notice appears without transition.

## 5 · Fault injection on the Plant page

Defects found in `najm3000/dashboard/static/app.js` and `tools/rs-static-api.js`:

1. The Asset / Fault selects are filled only inside `refreshModel()`, which returns early until
   the WebGL renderer exists and then awaits the 22 MB 3D file. Until then the selects are
   empty, *Inject fault* posts empty strings, the API answers 400, and `fetch` does not throw,
   so nothing is shown.
2. A failed POST is silent for the same reason (no `ok` check).
3. On the static build the fetch shim answers every fault call with a no-op, so the published
   demo cannot inject at all.

Fixes:
- Split `refreshModel()` into `refreshFaultPanel()` (fetch `/api/block/{id}/model` JSON,
  fill the selects from `parts` filtered by the catalogue, render the fault list — no 3D
  dependency) and the 3D load. Call `refreshFaultPanel()` from `selectBlock()` and after every
  inject/clear; the 3D load stays in the background.
- *Inject fault* uses a `postJSON` that throws on `!ok`; the error goes to the banner. On
  success the model status line says "Injected: {label} on {asset}. See the alarm log."
- Enable the button whenever the selects have a value, independent of WebGL.
- Shim: an in-memory fault registry (`inject`/`clear`/`list`, keyed by block+asset, catalogue
  from the bundle's `status.fault_catalogue`); `/api/plant` reports `fault_severity` per block
  from it; `/api/block/{id}/model` maps faults onto `parts`; `/api/alarms` lists them newest
  first; `/api/diagnostics/{id}` returns a finding built from the injected fault with the basis
  "Static build: read from the injected demonstration fault, not inferred from signals."
- Remove the Plant page's hidden `#theme-toggle` button and its listener (the shell now owns
  the theme).

## 6 · Dark theme

`shell.css` gains `:root[data-theme="dark"] { … }` redefining every token: surfaces
(`--pb-canvas #121917`, `--pb-card #1a2320`, `--pb-rail #161e1b`, borders `#2a3833` /
`#3a4b45`, `--rs-surface-2 #1f2926`, `--rs-surface-3 #26322d`, `--surface-3` likewise), text
(`--rs-text #e6ede9`, `--rs-text-2 #b4c3ba`, `--rs-muted #93a79c` — must clear 4.5:1 on
`--rs-surface-3`), header (`--pb-header #1d2c27`, `--pb-header-2 #172420`), the data plane
brightened for a dark ground (`--rs-amber #d9a53a`, `--rs-teal #35b0a8`, `--rs-violet #7f9fbd`,
`--rs-violet-dim #46596b`, `--rs-cyan #62b8d9`, `--rs-rust #d9735c`, `--rs-good #4fb583`,
`--rs-warn #d9952b`, `--rs-bad #d9596b`, and the `--amber`/`--accent`/`--violet`/… aliases),
reading pairs *lighter* than their marks (`--rs-amber-text #e6b95a`, `--rs-teal-text #57c9c1`,
`--rs-violet-text #a6bfd6`, `--rs-rust-text #e79a86`, `--rs-good-text #74cc9c`), the sage ramp
inverted to run dark→light (`--ramp-0 #1f2b26` … `--ramp-5 #9fbfae`), `--map-ground`,
`--cloud #9aa6b2`, `--rs-shadow-lg` heavier, `color-scheme: dark`. The exact values may be
tuned but every pairing used as text must be checked at 4.5:1.

`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { …same block… } }` so
the system preference applies when nothing is stored. The three pages drop the hard-coded
`data-theme="light"` on `<html>`.

`splash.js` (already in every `<head>`) applies the stored choice before first paint:
`localStorage["rs-theme"]` → `documentElement.dataset.theme`; no stored choice → leave unset
(the media query decides).

`sidebar.js` top bar: a toggle button `id="rs-theme"` (☾ / ☀, `aria-pressed`, label "Switch to
dark theme" / "…light theme"). Click: flip `dataset.theme`, store it, dispatch
`window.dispatchEvent(new CustomEvent("rs-theme", { detail: { theme } }))`. Listeners:
`control.js` re-renders both charts and repaints the map legend / view; `kingdom.js` repaints
the map markers; `app.js` re-draws trends and calls `refreshTheme()`.

Literals to retire: `charts.js` cursor dot stroke `#fff` → `cssVar("--pb-card")`; `shell.css`
slider thumb `#fff` → `var(--pb-card)`; `.rs-banner` pinks → `color-mix` from `--rs-bad`;
`styles.css` `color-scheme: light` removed and `.maplibregl-map` ground → `--map-ground`;
`model.js` `surface()` reads `--pb-canvas`.

## 7 · Guided tour

New `raseen/web/tour.js` (classic script, no imports, loaded after `sidebar.js` on all three
pages) and `raseen/web/tour.css` (linked from the three pages).

- `window.RaseenTour.start(name?)` — name defaults from the page: `kingdom`, `plant`, or
  `gradient` when `location.hash === "#gradient"` (or on `/control`).
- A step: `{ target: selector | null, title, body, before?: fn }`. `before` runs before the
  step is shown (switch a segment, seek the replay, open a view) and may return a promise.
- Overlay: a fixed spotlight element with a huge `box-shadow` dimming everything else and a
  2 px sage ring; its `top/left/width/height` transition over 320 ms so it visibly slides
  from one element to the next (this is the requested animation). A card beside the target
  (flips above/below/left/right to stay on screen; centred when no target) with the title,
  the body, "Step 3 of 12", and buttons **Previous**, **Next** (**Done** on the last), **Skip
  tour**. Keys ←/→/Esc. Targets are scrolled into view before measuring; resize and scroll
  re-measure. `prefers-reduced-motion` removes the transition.
- Focus is trapped in the card; the button that opened the tour gets focus back on close.
- Copy must describe what is on screen, in the house voice, and repeat no kill sentence.
  Draft the steps from the page markup; the Gradient control tour must include: the plot and
  the held-headroom band, the controller and strategy choice, replay and speed, the briefing
  and event log, the readout strip, the balance sentence, the map and its colour modes, the
  cloud sliders, the response controls, stall/deepen, situations, the station/block chart and
  its toggle, how the event ends, the steepest fall. Plant overview: status bar, timeline,
  readout tiles, block grid + satellite, block detail, alarms, deviation analysis, station
  model and fault injection, trends, weather, provenance. Kingdom: readout bar, technology
  mix, filters, list, map + key, sources.
- Targets are found by id/selector at step time; a missing target is skipped, not an error.

Element ids the tour relies on (the gradient page must provide them): `rs-gen`, `rs-ctl`
(controller segment), `rs-transport`, `rs-speed`, `rs-replay`, `rs-brief`, `rs-events`,
`rs-readout`, `rs-say`, `rs-map`, `rs-map-modes`, `rs-cloud` (the cloud panel),
`rs-response` (the response panel), `rs-strategy`, `rs-situation-panel`, `rs-blocks`,
`rs-grain`, `rs-kpis`, `rs-ramp`.

## File ownership for the implementation (to avoid edit collisions)

| Agent | Owns |
|---|---|
| A · physics | `raseen/control/allocate.py`, `planner.py`, `simulate.py`, `fixture.py`, `raseen/scenario/runner.py`, `tests/test_control.py`, `tests/test_webapp.py` |
| B · faults | `najm3000/dashboard/static/app.js`, `tools/rs-static-api.js`, `najm3000/dashboard/static/index.html` (fault panel + theme button only) |
| D · tour | `raseen/web/tour.js`, `raseen/web/tour.css` (new) |
| E · gradient page | `raseen/web/control.js`, `charts.js`, `control.css`, `site-plan.js` |
| C · theme (after A/B/D/E) | `shell.css`, `styles.css`, `kingdom.css`, `splash.js`, `sidebar.js`, `kingdom.js`, `kingdom-map.js`, `model.js`, plus the one-line theme hooks in `app.js` and `control.js` |
| lead | the three HTML files, `build_static.py`, docs rebuild, README notes |

## Addendum (16 Sep 2026) — free sliders on the published build, and the opening card

The user asked for all the cloud sliders to work. On the published build they snapped to
pre-rendered values and moved one at a time because there was no server. The fix is a port
of the simulation to the browser, `raseen/web/engine.js` (shadow fields, planner, both
allocators, the schemes, the metrics, the economics and the runner, dependency-free), which
`control.js` uses in static mode; the live server keeps calling the API. The port is held to
the Python by `tests/test_engine_js.py` on seven cases: the plant total agrees to the tenth
of a megawatt carried in the payload, a single block's share may differ by up to 2.5 MW on a
frame where two blocks tie for the water-fill. The static build no longer renders scenarios
(`build_static.py` lost `SCENARIO_SITUATIONS`, `SCENARIO_AXES`, `slim()`), which takes
20 MB out of `docs/`. For the scattered case the first 48 draws of Python's `Random(1)` are
embedded so the browser seeds the same sky.

The opening card now plays on every load, refresh included (the session gate is gone), and
slower: 0.6 s in, 1.7 s hold, 0.8 s out. This replaces the "once per session" rule in the
first-pass spec's Motion section at the user's request.

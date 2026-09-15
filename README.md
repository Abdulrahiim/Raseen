# Raseen · رَصين

**Block Gradient Control for gigawatt solar: a no-storage controller that turns a cloud
crossing a 3,000 MW PV plant into a declared, grid-code-shaped ramp instead of a cliff —
block by block, inside the plant, using instructions the Saudi Arabian Grid Code already
defines.**

*رَصين — composed, steady, unshaken: the plant that keeps its composure when the cloud comes.*

> We don't predict the weather. We predict its operational impact and control the plant,
> block by block, so the grid sees a schedule instead of a cliff.
>
> لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً، فترى الشبكة جدولاً بدل هاوية.

**Live demo:** <https://abdulrahiim.github.io/Raseen/> — the dashboard pre-rendered as a static
site. Everything in it is simulated.

---

## The idea in one paragraph

A 3,000 MW PV plant is not one generator; it is thirty control blocks spread over kilometres,
and a cloud crosses them one after another over several minutes. Raseen takes the operator's
external forecast as an **input**, derives each block's arrival and departure time from it, and
drives per-block active-power set-points through
the existing Power Plant Controller so the plant's export follows a smooth, pre-declared
gradient — descending ahead of the front, holding a rolling reserve on the blocks the cloud has
not reached, re-ascending behind it. The energy that shapes the ramp is a thin slice of
sunshine deliberately not exported for a few minutes: no battery, no new hardware, no new
rights. The governing relation is `g = D / (τ + L)` — the declared gradient `g` fixes how much
lead time `L` the controller needs for a deficit `D` over a transit `τ`, and the spill follows
from the gradient, not from how the curtailment is spread across blocks.

In the **abstract** design case carried by the repository's tests (`app/tests/test_control.py`
— an idealised 30 × 100 MW plant and a perfectly forecast front), a scenario with an 1,800 MW
deficit over a 10-minute transit, held to 90 MW/min (3 %/min of plant capacity), turns a
1,800 MW ten-minute drop into a 900 MW one with roughly ten minutes of declared notice, at a
cost of about 305 MWh of spilled sunshine. The same event on the **real** 363-station geometry
the dashboard draws spills about 335 MWh with ~11 minutes of lead — the abstract case is the
tests' fixed reference point, not the number the dashboard shows. Both are outputs of this
simulation, not measurements.

---

## Claims discipline

These are hard constraints on how the project is described, in code comments, in the UI and in
any document. They exist because each one is a claim the physics does not support.

**Never say:**

| Do not claim | Why |
|---|---|
| "AI predicts clouds before they reach the plant" | The external forecast is an **input**. Raseen predicts the *operational impact* of a front it is told about. |
| "Operators are blind to the weather" | They are not. Raseen adds block-level timing and control, not sight. |
| "The grid will collapse" | Out of scope and unevidenced. Raseen shapes one plant's export. |
| "We store energy as headroom" | There is no storage. Headroom is sunshine not exported. |
| "No energy is lost" | Curtailed sunshine **is** spilled. That is the cost of the ramp, and it is reported. |
| "We test LVRT" | Ride-through is not modelled or tested here. |
| "We control loads" | Load control is a distribution-service-provider function, not this plant's. |

And: never invent a performance number. If a figure cannot be computed by the code in this
repository, it does not get stated.

---

## What is simulated

Everything. Specifically:

- **Plant geometry** is **as-designed**, not as-built — 363 MV power stations in the layout
  against a 365-station design basis, grouped into 30 contiguous control blocks of unequal
  size.
- **The controller is real code.** The trajectory planner, the block allocator and the metrics
  are the actual algorithms, not a playback of a recording.
- **Telemetry, irradiance, forecast, PPC and TSP interfaces are simulated.** The cloud shadow
  fields (solid front, thin band, scattered) are generated, not observed.
- **The model is not calibrated and not validated** against a real plant, and the economics use
  stated assumptions (energy value, clear-day yield, battery-block cost) that are documented in
  `app/raseen/scenario/economics.py` and returned with every API response.

Every API response carries a classification string and a disclaimer so no page can render a
number without its provenance.

---

## What is in this repository

```
Raseen/
├── app/                the application: controller, simulation, API and dashboard
│   ├── raseen/         geometry · shadow fields · control · scenario · registry · web assets
│   ├── najm3000/       vendored pre-commissioning twin (physics engine + dashboard)
│   ├── config/         plant configuration (project, equipment, blocks, data sources)
│   ├── tools/          static-site builder for the GitHub Pages demo
│   └── tests/          geometry, shadow, controller, scenario and web-app tests
├── docs/               the pre-rendered static site GitHub Pages serves
└── render.yaml         optional blueprint for deploying the live backend
```

`app/README.md` is the engineering reference: module layout, configuration variables, the
static build and the container deploy. Start there for anything beyond running it.

### The dashboard

| Page | What it shows |
|---|---|
| **Kingdom** | Saudi utility-scale renewable projects (indicative registry) and the 380 kV transmission backbone (schematic) on a map, with layer, technology and status filters. |
| **Plant** | The reference plant — named *Humaij* in the dashboard, 3,000 MWac — in two views. **Overview** is the supervisory desk: the 363-station site on satellite imagery, real block layout, 3D drill-down, expected-vs-measured trends and fault injection. **Gradient control** is the cloud crossing: power at the connection point with the held headroom shaded under it, a readout of what the cloud took and what the blocks still in sun gave back to cover it, the 30 block set-points, and sliders for the cloud's speed, size, position and direction. The left rail is the only place either view is reached from. |

---

## Run it locally

From the repository root:

```powershell
cd app
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[dev]"
.venv\Scripts\python.exe -m raseen            # http://127.0.0.1:8000
```

The first request builds the simulated adapter (~20 s); after that it is quick. The app lands
on the Kingdom page; the sidebar switches pages. The maps use Esri's keyless tile services and
need internet — both fall back to a drawn plan if tiles or WebGL are unavailable.

Tests and lint (from `app/`):

```powershell
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe -m ruff check raseen tests
```

### Rebuilding the static demo

GitHub Pages serves static files only, so `tools/build_static.py` pre-renders the dashboard
into `docs/` — the pages, their assets, the registry and geometry as JSON, a curated set of
scenarios, and a day bundle for the Plant page. The static build is read-only: manual fault
injection is not included, and the gradient-control sliders step between pre-rendered clouds
one axis at a time (the four cloud sliders each have their own spine of scenarios; moving one
returns the other three to their defaults). Run the app locally for free movement.

```powershell
.venv\Scripts\python.exe tools\build_static.py          # regenerate ../docs
.venv\Scripts\python.exe -m http.server -d ..\docs      # preview at http://localhost:8000
```

`docs/` on `main` is what the live demo serves, so committing a rebuilt `docs/` publishes it.

---

## Status

A prototype. The controller reproduces its analytic design case, and holds its declared
gradient **when the forecast it is given is right**. It does not hold under a mis-forecast:
the shipped "front stalls", "front 20 % deeper than forecast" and "scattered cumulus"
scenarios all break the declared gradient, by a wide margin in the deepening case. Those
controls exist to show that limit, not to hide it — the honest claim is a scheduled ramp
against a front you already know about, not a guarantee against one you do not.

Block arrival times in the simulation are **ground truth taken from the shadow generator**,
not an estimate inferred from telemetry (the `provenance` block served with every scenario
says so). A real deployment would need a nowcast in that place, and its error is exactly what
the stall and deepen controls stand in for.

It has not been run against measured plant data, connected to a real Power Plant Controller,
or reviewed by a transmission system operator.

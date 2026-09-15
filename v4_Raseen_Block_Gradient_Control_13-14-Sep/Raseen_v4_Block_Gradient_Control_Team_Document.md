# Raseen (رَصين) v4 — Block Gradient Control
## Team working document · concept, physics, specification, work packages

*Raseen — رَصين — composed, steady, unshaken: the plant that keeps its composure when the cloud comes. The project was called NAJM-3000 until 14 September 2026; the 3,000 MW reference plant in the twin keeps that name.*

**Version 4.1 · Monday 14 September 2026 (v4.0 issued 13 September as NAJM-3000 v4) · Energy Hackathon 2026 · Track 1 Operational Efficiency · Challenge 2 "Grid stability with variable renewable production"**
**Registration closes Wednesday 16 September — submit the idea file in Section 14 by Monday 15 September.**

Companion files: `Raseen_v4_Block_Gradient_Control_Explainer.html` (interactive model of everything in Sections 2–5) and `raseen_bgc_sim.py` (the block simulation behind every number in this document; run it to regenerate the tables). Open items from the 14 September dissent pass are listed in Section 16.

**Contents:** 0 What changed · 1 Problem · 2 Physics · 3 Block Gradient Control · 4 Dynamic Solar Headroom · 5 Worked numbers · 6 Architecture · 7 Algorithms · 8 Interfaces · 9 Grid Code mapping · 10 Innovation claims · 11 KPIs · 12 Work packages · 13 Pitch and jury · 14 Idea file EN/AR · 15 Glossary · 16 Risks

---

## 0. Read this first — what changed, and the one-paragraph idea

Raseen v3 (then called the NAJM-3000 Grid Twin) was a plant-plus-battery twin: forecast the cloud, pre-position a 500 MW / 2,000 MWh battery, shape the ramp, declare it to National Grid SA. Two things changed the direction:

1. **Weather forecasting is not our innovation.** Large operators already buy hours-ahead forecasts (satellite, NWP, AI) and run digital twins. Raseen does not compete with that. **The external forecast is an input.** Our work starts after it: we convert a forecast into the optimal physical response *inside* the plant.
2. **No battery.** A utility-scale BESS is the most expensive way to shape a ramp. The flexibility we need already exists inside a gigawatt PV plant: 3,000 inverters, a Power Plant Controller (PPC), SCADA, weather stations, and 60 km² of geography over which a cloud is never everywhere at once.

**The idea in one paragraph.** A 3,000 MW PV plant is not one generator; it is thirty 100 MW blocks spread over eight kilometres. A cloud crosses those blocks one after another, in ten minutes. Raseen treats the plant as a spatial array: it takes the external forecast, measures the front on the first blocks it touches, computes each block's arrival and departure time, and drives per-block active-power set-points so that the plant's export follows a smooth, pre-declared gradient while the cloud passes — descending before the front, holding a rolling reserve on the blocks the cloud has not reached, and re-ascending behind it. The energy that shapes the ramp is a thin slice of sunshine deliberately not exported for a few minutes — no battery, no new hardware, no new rights. We call the controller **Block Gradient Control (BGC)**; the moving reserve it creates is the **Rolling Solar Reserve**; the standing version, held before an uncertain event, is **Dynamic Solar Headroom (DSH)**. Every instruction it issues already exists in the Saudi Arabian Grid Code (May 2026): Active Power Gradient, Delta Regulation, Absolute Limitation, updated Declarations, advance notification.

**The pitch sentence.** *We don't predict the weather. We predict its operational impact and control the plant, block by block, so the grid sees a schedule instead of a cliff.*

**الجملة العربية.** *لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً، فترى الشبكة جدولاً بدل هاوية.*

### 0.1 What stays from v3 (still true, still needed)

- The plant is a planned contingency by regulation (SERA TPC: N-2 for renewable parks above the minimum spinning reserve), and the Grid Code buys Contingency Reserve against "weather forecast uncertainties" (SAGC 4.41.15). Better plant-side behaviour has Code-recognised value.
- The channels exist: renewable generators may update Declarations on better infeed forecasts down to one hour before real time (SAGC 5.3.8.1(iii)); events with an Operational Effect must be notified "as far in advance as practicable" (4.46.3.2). The **Ramp Event Notice** stays.
- The plant's own 19 weather stations and block meters are a spatial sensor array: the **sentinel nowcast** stays — but it is now framed as *impact* nowcasting (arrival time and depth per block), not weather forecasting.
- Jurisdiction is unchanged: no load control (DSP/TSP domain), no instructing the TSO, no simulated ride-through.
- The physics engine (pvlib, 365 MV stations, 150+ tests) and the control room exist and are reused.

### 0.2 What is removed

- The battery and everything built on it (SoC pre-positioning, Plan A/Plan B battery dispatch).
- Any sentence that claims to forecast clouds better than the operator's provider.

---

## 1. The problem, stated the way a grid engineer accepts it

A 3,000 MWac park is ≈ 4 % of the Kingdom's 72.9 GW record peak. A solid cloud band crossing it at ~48 km/h removes ≈ 1,800 MW in ten minutes — 180 MW per minute, faster and larger than the trip of any single thermal unit, which is why SERA's Transmission Planning Criteria subject such parks to N-2 testing. Today the grid absorbs this with its reserve ladder (fast frequency response ≤ 1 s, primary ≤ 5 s, secondary ≤ 15 s, tertiary ≤ 90 s–5 min, contingency 24 h → real time; SAGC 4.31.1, 4.41). That works, and it is paid for: reserve is capacity kept idle, and the Code says part of it is kept against weather uncertainty.

The operator's forecast provider can say "a band arrives between 13:40 and 14:10". It cannot say which of the 3,000 inverters loses power at 13:52:30 and which at 13:58:10, and it does not decide what the plant should do about it. That gap — from a forecast to a physically executed, grid-visible response — is Raseen's job.

**Objective function, in words:** deliver the plant's output to the Point of Interconnection (POI) along a gradient the TSO can schedule, spilling the least sunshine to do so, while keeping a reserve the plant can honestly declare — using only software, the PPC, the inverters and the plant's sensors.

---

## 2. The physics — five relations the whole idea rests on

All symbols in MW, minutes, MWh. Block *i* has available active power *Aᵢ(t)* (what the sun would let it export right now; the Grid Code's own term is *Available Active Power*) and export set-point *Pᵢ(t)*. Plant available *A(t) = Σ Aᵢ(t)*, plant export *P(t) = Σ Pᵢ(t)*.

**(1) No storage means export can never exceed available.** *P(t) ≤ A(t)* at every instant. Everything the plant does is *subtraction*; the only question is where and when to subtract.

**(2) Headroom is the subtraction.** *hᵢ(t) = Aᵢ(t) − Pᵢ(t)* ≥ 0. Plant headroom *H(t) = Σ hᵢ*. Headroom on a block exists only while the sun is on it: when the cloud reaches block *i*, *Aᵢ* falls and *hᵢ* falls with it. **Headroom is upward reserve with an expiry time equal to the block's cloud arrival time.**

**(3) The gradient a plant can promise is set by lead time.** For a front of depth *D* (MW lost at full cover) that crosses the plant in *τ* minutes, holding the export to a down-gradient *g* (MW/min) requires starting the descent *L* minutes before the front reaches the fence:

  *L = D/g − τ*  ⇔  *g = D / (τ + L)*

With *D* = 1,800 MW and *τ* = 10 min: an upwind mast 8 km out (10 min at 48 km/h) supports *g* = 90 MW/min (3 %/min); a 20-minute satellite/provider nowcast supports 60 MW/min (2 %/min); no lead at all leaves the natural 180 MW/min. **This is the honest contract between the forecast provider and Raseen: they supply *L*, we turn *L* into a guaranteed *g*.**

**(4) The energy cost of shaping is set by the gradient, not by the allocation.** Spilled energy on the way down, for a linear front with natural rate *r = D/τ*:

  *E_down = (r − g) · τ · (D/g) / 2*  (MW·min; divide by 60 for MWh)

For the design front: 30 MWh at 150 MW/min, 75 at 120, 150 at 90, 300 at 60. The up-ramp behind the cloud costs about the same again if shaped to the same *g*, but needs no forecast — only curtailment of the blocks that recover first. **Any allocation of the curtailment among blocks that satisfies (1) spills exactly the same energy.** BGC does not spill less than a plant-level controller for a perfectly forecast front; what it does is listed in Section 3.

**(5) Rolling Solar Reserve.** The reserve the plant can honestly promise for the next *Hʳ* minutes is the headroom on blocks the cloud will not reach within *Hʳ*:

  *R(t, Hʳ) = Σ { hᵢ(t) : ETAᵢ(t) > Hʳ }*

It "rolls" because as the front advances, blocks drop out of the set and new headroom is placed further along the front's path. *R* is what goes in the Ramp Event Notice as firm upward reserve — a number a plant-level controller cannot compute, because it does not know which headroom expires when.

---

## 3. Block Gradient Control — the spotlight

### 3.1 Definition

The plant is partitioned into control blocks (30 × 100 MW in this document; in the twin, groups of the 365 MV stations). Each block carries a live record:

| Field | Source | Unit |
|---|---|---|
| id, row, column, centroid (lat/lon), area | design data | — |
| irradiance (GHI/POA), module temperature | block weather station or nearest of the 19 | W/m², °C |
| inverter output *Pᵢ* and reactive output *Qᵢ* | SCADA | MW, MVAr |
| available power *Aᵢ* | physics engine (pvlib) from irradiance and temperature, soiling state | MW |
| post-event level *Aᵢ⁻* | *Aᵢ* × (1 − depth) from the impact nowcast | MW |
| cloud arrival ETAᵢ, departure ETDᵢ, confidence | impact nowcast (Section 6) | min, min, 0–1 |
| set-point *Pᵢ\** and Q assignment | BGC | MW, MVAr |
| headroom *hᵢ*, firm flag (ETAᵢ > *Hʳ*) | derived | MW, bool |
| slew limit, inverter S-rating, DC/AC ratio | design data | %/min, MVA, — |

**BGC** computes, every 10 s, the vector of block set-points *Pᵢ\*(t)* such that the plant export follows the declared trajectory *P\*(t)* (Section 5) with curtailment placed by cloud arrival order:

- **Descend-first.** Blocks the front reaches next are brought down to their post-event level *Aᵢ⁻* before it arrives (weight ∝ exp(−ETAᵢ/σ), σ ≈ 3 min). When the shadow hits them, their output does not step — it is already there.
- **Reserve slice.** A designed headroom Δ is held on blocks with ETAᵢ > *Hʳ* — the far end of the plant — and re-rolled every minute as ETAs shrink. This is the Rolling Solar Reserve; its size is a decision variable set by forecast confidence (Section 3.4).
- **Slew-limited, feed-forward.** Set-points change only where the front is; each block moves at most 10 %/min so the PPC's feedback loop only corrects small residuals.
- **Reactive migration.** Shaded blocks, whose inverters have most of their apparent-power rating free, take the plant's reactive-power duty so sunny blocks can run at unity power factor and full *P*.

The **spatial power gradient** the plant shows at any instant — shaded blocks at their available power, the next blocks already at their post-event level, mid-plant blocks descending, far blocks near full with a reserve slice — is not a picture we draw; it is the state the controller produces. Snapshot from the design case (g = 60 MW/min, west→east front, 10 columns):

| t (min from fence contact) | col 1 | col 2 | col 3 | col 4 | col 5 | col 6 | col 7 | col 8 | col 9 | col 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| −10 (set-point, % of 100 MW) | 51 | 63 | 72 | 79 | 83 | 87 | 89 | 91 | 92 | 93 |
| −5 | 40 | 40 | 53 | 65 | 73 | 79 | 84 | 87 | 89 | 90 |
| 0 (front at the western fence) | 40 | 40 | 40 | 47 | 62 | 65 | 69 | 75 | 79 | 81 |
| +5 (cols 1–5 shaded, available 40) | 40 | 40 | 40 | 40 | 40 | 43 | 53 | 62 | 72 | 70 |
| +8 | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 54 | 66 |
| +10 (fully covered) | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 40 |

The "60 / 70 / 80 / 90 / 100 %" picture in the concept note is exactly one of these rows: the first block the cloud will reach sits lowest, the last sits highest, and the percentages are not chosen by hand — they are the optimizer's output for that minute's ETAs, depth and confidence, and they move east with the front every 10 s.

For comparison, a plant-level controller (one set-point, spread in proportion by the PPC — the state of the art) shows 80/80/…/80 at −10, 60/60/…/60 at 0 and, at +3, curtails the *already shaded* blocks to 26 MW of their 40 MW available while sunny blocks sit at 66. Same export, same spill, but its reserve is wherever the proportional rule left it, and every shading event re-scales all thirty set-points at once.

### 3.2 The three phases — before, during, after

**Before the cloud (T−L to T0).** Input: the external forecast (hours) and the on-site impact nowcast (minutes). BGC starts the plant's descent *L = D/g − τ* minutes before fence contact — the only forecast-dependent commitment — beginning with the blocks nearest the front. The Ramp Event Notice goes to the TSO with the declared trajectory and the firm reserve *R*. If the front stalls, curtailment is released in the same order it was placed, nearest blocks first; the plant is back at full output within the slew limit.

**During transit (T0 to T0+τ).** The first blocks touched confirm speed, heading and depth (sentinel measurement), and every downstream ETA is corrected. Shaded blocks sit at their available power and take the reactive duty. The descent continues on the not-yet-shaded blocks so the plant export stays on the declared line. The reserve slice rolls east one block at a time. At full cover, export equals available — there is no headroom to hold, and the plant says so in the notice ("residual to be covered by other plant: 1,800 MW for the plateau").

**After — the exit (T_exit to T_exit+τ).** The trailing edge frees the western blocks first. Left alone, the plant would recover at 180 MW/min. BGC holds the recovering blocks to the declared up-gradient by curtailing them as they come back into the sun — the headroom wave now travels *behind* the cloud — and releases the last curtailment when the plant is back at full output. The exit needs no forecast: curtailment can only remove power, and the blocks recover in the order the sentinels see.

### 3.3 What BGC does that a plant-level set-point cannot — and what it does not do

| BGC does | Because |
|---|---|
| Computes the feasible declared trajectory from block-level ETAs and depths | A plant-level number cannot say which 40 % of the plant is producing at t+5 |
| Places curtailment so no block steps when the shadow arrives, and set-points change only where the front is | Descend-first by ETA; per-block slew limits; the PPC loop corrects residuals only |
| Holds a reserve that is *firm for a stated horizon* and declares it | Headroom on a block expires at its ETA; only per-block ETAs let you count what survives *Hʳ* minutes |
| Releases false alarms block by block, nearest first, without a plant-wide re-scale | The plan changes only where the observation changed |
| Moves reactive duty to shaded inverters | Their apparent-power rating is free; sunny blocks keep full active power (SAGC 2.11.13.1 envelope respected at the POI) |
| Uses the same block grid as the sensor that measures the front | Sentinel nowcast: the first 20 % of blocks hit give speed, heading, depth for the remaining 80 % |

| BGC does **not** | Say it plainly |
|---|---|
| Spill less energy than a plant-level pre-ramp for a perfectly forecast front | Relation (4): spill is fixed by *g* and the forecast lead |
| Stop the plant losing 1,800 MW under full cover | Without storage, export ≤ available; the reserve ladder covers the plateau, as the Code intends |
| Forecast the weather | The provider's forecast is an input; Raseen forecasts *impact* (per-block arrival and depth) |
| Control anything outside the plant | No loads, no instructions to the TSO |

### 3.4 The gradient shape is a decision, not a picture

How much of the required curtailment to put on near blocks (descend-first) versus far blocks (reserve) depends on how much the forecast can be trusted:

- **Front confirmed by sentinels, depth known:** steep gradient — near blocks fully down, far blocks untouched, small Δ. Minimum control activity, zero steps.
- **Front expected from the provider only, depth uncertain:** flatter gradient — larger Δ on far blocks, so a deeper-than-forecast front can be absorbed by releasing reserve instead of violating the declared line.
- **Scattered cumulus (no coherent front):** standing Dynamic Solar Headroom (Section 4) on blocks outside the predicted shadow paths.

The optimizer chooses σ and Δ each minute from the nowcast confidence. **The spatial gradient is the visible trace of the forecast confidence.**

---

## 4. Dynamic Solar Headroom — the standing reserve

The Grid Code already defines the mode: **Active Power Delta Regulation** — "a control mode of the Power Park Module which constrains the Active Power output to a required constant value in proportion to the Available Active Power" (SAGC definitions; instructable under 2.11.13.11 and 5.4.2.3). A plant in Delta mode holds Δ MW of headroom below its available power. Raseen makes Delta *dynamic*: Δ is non-zero only when the forecast says an event is likely, sized to the expected partial-cover loss, and *spatial*: held on the blocks least likely to be shaded.

Three things DSH buys:

1. **Partial clouds become invisible to the grid.** A two-column-wide band (360 MW dip at 180 MW/min, twice) is absorbed: Raseen pre-descends the plant to the transit minimum at 2 %/min, holds it flat while the band crosses, and re-ascends behind it — 46 MWh not exported, POI ramp 60 MW/min instead of 180, no dip at all during transit.
2. **Upward frequency response becomes possible.** SAGC 2.11.13.10 requires PPMs to modulate active power for frequency deviations below 59.8 Hz — but "output power shall be limited by the available output power". At MPP a PV plant can only respond downward. With Δ held, it can respond upward: DSH is what makes a PV plant a *bidirectional* frequency-response provider when the TSP activates Frequency Regulation (2.11.13.9).
3. **A firm number for the TSO.** *R(t, Hʳ)* with Δ placed on far-ETA blocks is declarable as reserve for a stated horizon — the basis of a System Service under SAGC 2.14.1 ("(ix) reduction or increase in Active Power … (xi) any other System Service").

Cost: Δ × holding time. 250 MW for 30 minutes = 125 MWh ≈ 0.5 % of a clear day. The optimizer compares this with the event-triggered alternative (cheaper, needs timing) every minute.
## 5. Worked numbers (block simulation, 10-second steps)

Design plant: 3,000 MWac, 30 blocks of 100 MW in 10 columns (west→east, 800 m each) × 3 rows. Design front D1: solid band at 48 km/h (one column per minute, τ = 10 min), depth 60 % (D = 1,800 MW), 40-minute plateau, 10-minute exit. Front D2: thin band two columns wide (360 MW dip). The simulation script (`bgc_sim.py`) is delivered with this document; the interactive model in the HTML explainer implements the same equations.

### 5.1 D1 — the gradient/lead/spill trade-off Raseen optimises

| Declared gradient g | %/min of capacity | Lead needed before fence contact L = D/g − τ | Max 10-min POI drop | Spilled on the way down | Spilled on the way up (same g) | Total | Spilled before contact (false-alarm exposure) |
|---|---|---|---|---|---|---|---|
| 180 MW/min (no control) | 6 % | 0 | 1,800 MW | 0 | 0 | 0 | 0 |
| 150 | 5 % | 2 min | 1,500 MW | 30 MWh | 35 MWh | 65 MWh | 5 MWh |
| 120 | 4 % | 5 min | 1,200 MW | 75 | 80 | 155 | 24 |
| 90 | 3 % | 10 min | 900 MW | 150 | 155 | 305 | 74 |
| 60 | 2 % | 20 min | 600 MW | 300 | 305 | 605 | 198 |

Context: a clear day at this plant yields ≈ 25 GWh; the 3 %/min row costs ≈ 1.2 % of that day. Plant-level and block-level control give the same spill (relation 4); the rows differ only in *g* and *L*. The "spilled before contact" column is the energy at risk if the front never arrives — the false-alarm cost that a 2 %/min promise carries and a 4 %/min promise largely avoids. Published field experience agrees: with all-sky-imager nowcasts and curtailment, 81 % of ramp violations were removed but 13 % of the curtailment was spent on false positives (DLR, EPJ Photovoltaics 2024).

### 5.2 D2 — a thin band (the common case)

| Scheme | POI during transit | Max POI gradient | Not exported | Lead |
|---|---|---|---|---|
| No control | 360 MW dip, twice | 180 MW/min | 0 | — |
| Gradient only, 3 %/min | 360 MW dip, shaped | 90 MW/min | 13 MWh | 2 min |
| DSH flat-hold, pre-descent 2 %/min | **flat at 2,640 MW** | 60 MW/min (pre-descent only) | 46 MWh | 6 min |
| DSH flat-hold, pre-descent 4 %/min | flat at 2,640 MW | 120 MW/min | 28 MWh | 3 min |

### 5.3 Economics — why no battery

| | Battery block (SPPC standard) | Raseen headroom |
|---|---|---|
| Hardware | 500 MW / 2,000 MWh, ≈ SAR 1.09 bn (SAR 4.35 bn for four, August 2026 award) | none new: PPC, inverters, SCADA, weather stations, software |
| Annual cost of the ramp service | ≈ SAR 110–130 m/yr annualised (15 yr, 8 %, before O&M) — and one block shapes at most 500 MW of an 1,800 MW event | spilled sunshine: at 3 %/min ≈ 2 % of annual energy ≈ 150 GWh ≈ **SAR 7–8 m/yr** at SAR 50/MWh (Shuaibah 1 PPA ≈ 3.9 halalah/kWh ≈ SAR 39/MWh; recent rounds 4–6 halalah) |
| Field anchor for the % of energy | — | measured at a 38.5 MW plant with sky-camera forecasts: 7.96 % (1 %/min), **4.37 % (2 %/min), 1.38 % (5 %/min), 0.33 % (10 %/min)** — an upper bound for a 3 GW park, whose aggregate ramps are geographically smoother (Marcos et al., UPNA) |
| Who pays | the IPP's balance sheet | on a TSP Gradient/Delta instruction the reduction is settled under the PPA; as a contracted System Service (SAGC 2.14.1) it is paid; self-initiated, it is the IPP's cost — ≈ SAR 15,000 per severe event at 3 %/min |
| Right tool for | evening-peak energy shifting (4 hours of energy) | ramp shaping and reserve (minutes of power) |

The line for the jury: **for ramp shaping, spilling the world's cheapest sunshine is an order of magnitude cheaper than storing it. Buy batteries for the evening peak; use headroom for the ramp.**

---

## 6. System architecture

```
 External forecast provider ──► [F] Forecast ingestion (hours: cloud/dust probability, timing window)
 (operator's existing vendor)                     │
 On-site stations (19), block meters (365),       ▼
 optional upwind mast ──────────► [N] Impact nowcast  ── per-block ETA, ETD, depth, confidence
                                                  │
 pvlib physics engine (exists) ─► [P] Available Active Power per block Aᵢ(t), plant A(t)
                                                  │
                                                  ▼
                                   [T] Trajectory planner  ── declared POI line P*(t): g, L, Δ, R(t,Hʳ)
                                                  │
                                                  ▼
                                   [B] Block Gradient Control ── Pᵢ*(t), Qᵢ*(t) every 10 s
                                                  │
                    ┌─────────────────────────────┴───────────────────────────┐
                    ▼                                                         ▼
     [X] PPC interface (per-group limits,                     [C] Declarations & notices to the TSP
         Modbus TCP / IEC 61850 / OPC UA)                          (Availability Notice 10:00 D-1,
         → inverters (existing firmware: droop,                     updated Declarations to H-1,
           ride-through, dynamic voltage support)                   Ramp Event Notice inside H-1)
                    │
                    ▼
     [U] Twin & control room (exists): block map, gradient view, POI chart, KPIs, compliance ledger
```

| Module | Status | Function | Cycle |
|---|---|---|---|
| **F · Forecast ingestion** | new, thin | Normalises the provider's product (probability of cover, timing window, expected depth) plus NCM dust outlook into an event hypothesis | as delivered (15 min–1 h) |
| **N · Impact nowcast** | new (extends v3 sentinel) | From station/block irradiance lags: front speed and heading; per-block ETA/ETD/depth with confidence; updates every minute once the front touches the plant | 1 min |
| **P · Physics engine** | exists | *Aᵢ(t)* from irradiance, temperature, tracker geometry, soiling; the Code's Available Active Power | 10 s |
| **T · Trajectory planner** | new | Chooses *g*, *L*, Δ, *Hʳ* from D, τ, forecast lead and confidence; produces *P\*(t)* and *R(t)*; recomputes when N updates | 1 min |
| **B · Block Gradient Control** | new — the core | Allocation of curtailment by ETA (descend-first + reserve slice), slew limits, reactive migration, false-alarm release | 10 s |
| **X · PPC interface** | new (mock in the prototype) | Writes group active-power limits and Q set-points to the PPC; reads back inverter output; never bypasses the PPC's protection and fast loops | 10 s |
| **C · Declarations & notices** | v3, adapted | Availability Notice/Nomination, updated Declarations, Ramp Event Notice with trajectory, firm reserve, residual by reserve band; compliance ledger | event-driven |
| **U · Twin & control room** | exists, extended | Block map with set-point gradient and cloud overlay, POI chart (available / export / declared), reserve gauge, KPIs | live |

**Time-domain separation (unchanged principle):** milliseconds — inverter firmware (ride-through 300 ms, dynamic voltage support 20–60 ms, RoCoF 2.5 Hz/s), never simulated by Raseen; seconds — PPC feedback and droop (PPM initial delay ≤ 2 s, SAGC 4.41.7); **10 s–15 min — Raseen (B, N, P)**; hours to day-ahead — F, T, C.

---

## 7. Algorithms (what the other team implements)

### 7.1 Impact nowcast — per-block ETA from the plant's own sensors

1. Every minute, take the last 10 minutes of 1-s irradiance (or block output) from all stations/blocks. Compute the clear-sky index *kᵢ(t)* = measured / pvlib clear-sky.
2. Detect the front: the earliest stations whose *k* falls below a threshold (e.g. 0.7 sustained for 30 s) define the leading-edge set.
3. Estimate the shadow-motion vector: cross-correlate the *k* time series of station pairs; the lag between stations along the motion direction gives speed *v*, and the direction that maximises correlation gives heading *θ*. (Fallback before contact: provider/satellite cloud-motion vector; optional upwind mast.)
4. Project: for each block centroid, ETAᵢ = distance along *θ* from the leading edge ÷ *v*; ETDᵢ from the trailing edge if visible, else from the provider's band length. Depth *dᵢ* = 1 − mean *k* behind the edge (from the blocks already shaded).
5. Confidence: from the number of blocks already hit (0.3 before contact from provider only; 0.7 after the first column; 0.9 after 20 % of blocks) and the residual of the propagation fit.

### 7.2 Trajectory planner

Inputs: *D = Σ dᵢ Aᵢ*, τ (from *v* and plant extent along *θ*), forecast lead *L_avail* (time until first ETA), confidence *c*, TSP-registered ramp rate and any active Gradient/Delta instruction.

1. Feasible gradient: *g_feas = D / (τ + L_avail)*. Declared *g* = max(*g_feas*, TSP-instructed or registered value). If the TSP has instructed a stricter gradient than the lead allows, Raseen reports the shortfall in the notice rather than pretending.
2. Descent start *t_s* = first ETA − (*D/g* − τ). Plateau = plant available under full cover. Up-gradient *g_up* from the registered value (may differ from *g*).
3. Reserve slice Δ = *D · (1 − c) · κ* (κ ≈ 0.25 tunable), capped at 10 % of plant; horizon *Hʳ* = 5 min.
4. Output *P\*(t)* for the next 60 min at 10-s resolution and *R(t, Hʳ)*; regenerate on every nowcast update; if confidence collapses (front stalls), switch to *release mode* (Section 7.4).

### 7.3 Block allocation (BGC core) — every 10 s

```
input:  Aᵢ, Aᵢ⁻ = Aᵢ(1−dᵢ), ETAᵢ, P*(t), Δ, Hʳ, σ, slew, Pᵢ(prev)
C ← max(0, Σ Aᵢ − P*)                         # required curtailment
far ← { i : ETAᵢ > Hʳ and Aᵢ > Aᵢ⁻ }           # reserve carriers
curᵢ ← min(Δ/|far|, Aᵢ − Aᵢ⁻)  for i in far   # 1. reserve slice
rem ← C − Σ curᵢ
wᵢ ← exp(−max(ETAᵢ,0)/σ) for blocks with room  # 2. descend-first, water-filling with caps
while rem > ε and candidates:
    give each candidate share = rem·wᵢ/Σw, capped at (Aᵢ − Aᵢ⁻ − curᵢ); drop capped blocks
if rem > ε: spread rem in proportion to remaining room (target below the sum of floors)
Pᵢ* ← Aᵢ − curᵢ                                # 3. set-points
Pᵢ* ← clamp(Pᵢ*, Pᵢ(prev) ± slew·Δt, ≤ Aᵢ)     # 4. slew limit
rebalance the slew residual so Σ Pᵢ* = P*       # 5. keep the aggregate exact
Qᵢ* ← plant Q order allocated ∝ √(Sᵢ² − Pᵢ*²)    # 6. reactive duty to the freest inverters
output Pᵢ*, Qᵢ* → PPC groups
```

Between nowcast updates (N runs every minute, B every 10 s) the ETAs are decremented deterministically by the elapsed time using the last front speed — ETAᵢ ← ETAᵢ − Δt — and replaced when N delivers a new set; B never acts on a stale arrival time.

The same problem can be written as a small LP (30 variables, 60 constraints) minimising Σ wᵢ·(Aᵢ − Pᵢ) subject to Σ Pᵢ = P\*, Aᵢ⁻ ≤ Pᵢ ≤ Aᵢ (with Pᵢ ≤ Aᵢ − Δᵢ on reserve blocks) and slew bounds; it solves in milliseconds. Use the LP if the heuristic's edge cases (many partially shaded blocks) become messy.

### 7.4 Rolling re-plan and false-alarm release

Each minute: re-run N → T → B. If the nowcast confidence drops (no station confirms the front by first-ETA + 2 min), the planner sets *C → 0* along a release ramp bounded by the registered up-gradient; B releases blocks in reverse order of placement (nearest first). Log the event as a false alarm with its spilled energy; this is a KPI, not a secret.

### 7.5 Exit shaping

When ETDᵢ arrive (trailing edge on the sentinels), the target line rises at *g_up*. B curtails the *recovering* blocks — headroom wave behind the cloud — until export equals available. No forecast dependency: only blocks already in the sun are curtailed.

### 7.6 Reactive migration

Plant Q order (from the PPC's voltage/reactive control mode) is allocated in proportion to each inverter group's free apparent power √(Sᵢ² − Pᵢ\*²). Shaded groups carry most of it; the POI P–Q point stays inside the Grid Code envelope (Q = ±0.33 pu above 20 % P). The active-power gain — sunny blocks that would otherwise supply part of the Q order at part-load now run at unity power factor — depends on the inverter S-rating margin, the DC/AC ratio and the size of the Q order; WP3 computes it in the simulation rather than assuming a percentage.

---

## 8. Interfaces

| Interface | Direction | Protocol / format | Content |
|---|---|---|---|
| Forecast provider → F | in | vendor API / files (JSON, GRIB, netCDF) | cloud cover probability, cloud-motion vector, timing window, dust outlook (NCM) |
| Stations, block meters → N, P | in | SCADA historian / OPC UA / Modbus | 1-s irradiance, temperature, per-inverter P/Q |
| B → PPC | out | Modbus TCP registers or IEC 61850 (MMXU/DRCC) or OPC UA tags per inverter group | active-power limit (kW), reactive set-point (kVAr), slew (kW/s); PPC keeps authority over protection, plant-level limits and TSP set-points |
| PPC → B | in | same | achieved P/Q per group, alarms |
| TSP instructions → T | in | TSP interface (5.3.5.1) / operator entry | Gradient, Delta, Absolute Limitation, Frequency Regulation on/off |
| C → TSP | out | TSP electronic interface; fallback per SAGC 1.12.3 | Availability Notice, updated Declaration, Ramp Event Notice (Section 9) |

In the prototype the PPC and the TSP endpoints are mocks that record what they receive and render it.

---

## 9. Grid Code mapping (SAGC May 2026, SADC June 2026, SERA TPC 2025)

| Raseen element | Code anchor | Wording to use |
|---|---|---|
| Available Active Power per block | Definitions | "the power the PPM could deliver at the Connection Point based on renewable primary energy conditions" — our pvlib stream *is* this quantity |
| Declared gradient | 2.11.13.11(i), 5.4.2.3 — **Active Power Gradient** instruction; Ramp Rate as a registered Scheduling & Dispatch Parameter (A5.1); ±10 % in the Dispatch Accuracy Test 4.50.8.8 | "we hold the registered ramp rate and any instructed gradient" |
| Dynamic Solar Headroom | **Active Power Delta Regulation** (definition; 2.11.13.11; 5.4.2.3) | "Delta Regulation made dynamic and spatial" |
| Upward frequency response | 2.11.13.7–10 (droop 2–8 %, set point 5 %, dead-band ≤ 0.05 Hz; response limited by available output) | "headroom is what makes a PV plant a bidirectional frequency-response provider" |
| Reactive migration | 2.11.13.1–2 (Q = ±0.33 pu above 20 % P), 2.11.13.12–14 | "the POI stays inside the envelope; the duty moves to the freest inverters" |
| Ramp Event Notice | 5.3.8.1(iii) updated Declarations to H-1; 4.46.3.2 / 4.46.4.1 notification as far in advance as practicable; 5.3.3.2(i) special factors | "we automate the Declaration the Code already lets us update" |
| Compliance evidence | 4.50.8.7 — for renewable generation, Declared Data Capability Tests "may be undertaken by continuous monitoring of the environmental conditions, Output parameters and Grid parameters" | "the twin is the continuous monitor the Code describes" |
| System Service | 2.14.1 (ix) reduction or increase in Active Power due to a System Constraint; (xi) any other System Service | "a contractable service, not a favour" |
| Why the TSO cares | 4.41.15 Contingency Reserve against weather forecast uncertainties; 4.42.1.1(vi) reserve sized on the largest infeed; TPC 2.3.4 N-2 for parks above the minimum spinning reserve | "we shrink the uncertainty the reserve is bought against" |
| What we never touch | SADC OC.6 (Demand Control = DSP), SAGC 2.13–2.14 (DSR = TSP System Service); 2.11.13.16–18 ride-through (firmware) | "no loads, no instructions to the TSO, no simulated ride-through" |

---

## 10. Innovation claims — exactly what is new, and what is not

**Not new (cite it, do not claim it):**
- Curtailment-based ramp-rate control without storage, using short-term forecasts, at plant level — demonstrated and quantified (Marcos et al., Universidad Pública de Navarra, 38.5 MW Amareleja plant: losses 7.96 → 0.03 % of annual energy for 1 → 30 %/min; DLR/Eye2Sky, EPJ Photovoltaics 2024, 20.8 MWp with 13-camera all-sky-imager nowcasts, 81 % fewer violations).
- Headroom-based grid services from a PV plant — demonstrated (NREL/CAISO/First Solar 2017, 300 MW plant operated 30 MW below peak to follow AGC and provide frequency response).
- Ramp-rate limiting with uniform commands to PV subsystems — patented (GE, US 8,901,411, reactive, no forecasting, no spatial allocation).

**New (say it, and say "to our knowledge"):**
1. **Block Gradient Control** — allocation of the required curtailment across a gigawatt plant by per-block cloud-arrival time, with a designed rolling reserve on the blocks the cloud reaches last, slew-limited feed-forward set-points, and reactive-duty migration to shaded blocks. Prior work treats the plant as a single unit.
2. **The lead-time contract** *g = D/(τ + L)* as the explicit interface between an external forecast and the plant's guaranteed gradient — the forecast provider supplies *L*, the plant converts it into *g*, and the notice to the TSO carries both.
3. **A declarable Rolling Solar Reserve** *R(t, Hʳ)* — headroom counted only on blocks that will still be in the sun for the stated horizon — mapped to the Saudi Grid Code's Delta Regulation, updated Declarations (5.3.8.1(iii)) and 4.46 notifications, and to the continuous-monitoring compliance path (4.50.8.7).
4. **Pre-commissioning delivery** — the controller is built and exercised on the twin before the plant exists, with real irradiance statistics (K.A.CARE RRAtlas 1-minute data), so the plant connects with its ramp behaviour already declared.

**Do not say:** "AI predicts clouds", "the grid will collapse", "we save X % versus a battery" without the assumptions on the slide, "we control loads", "we test LVRT".

---

## 11. KPIs and acceptance tests for the prototype

| KPI | Target for 7 October | Test |
|---|---|---|
| POI follows the declared line | within ±2 % of set-point (SAGC 2.11.13.11 accuracy) for the whole D1 event | simulated D1 at g = 60/90/120 MW/min |
| Maximum POI down-gradient | ≤ declared g (±10 %, SAGC 4.50.8.8) | D1, D2 |
| No block steps at shadow arrival | per-block set-point change at ETA ≤ 5 % of block | D1 |
| Firm reserve declared vs delivered | declared R(t, 5 min) is ≥ 95 % deliverable in simulation | inject a 20 % deeper front at t = +2 min |
| Spill equals the analytic value | ±5 % of relation (4) | D1 at four gradients |
| False-alarm release | back to full output within slew limit; spilled energy logged | stall the front at t = −2 min |
| Notice lead time | Ramp Event Notice issued ≥ L before contact with the trajectory and R | D1 |
| Reactive envelope | POI P–Q inside ±0.33 pu throughout | D1 with a 0.2 pu Q order |
| Impact nowcast accuracy | ETA error ≤ 60 s for blocks ≥ 3 columns downstream, after 20 % of blocks are hit | replay of RRAtlas-derived shadow fields |

---

## 12. Work packages for the team (17 September → 6 October)

| WP | Deliverable | Definition of done | Owner | Days |
|---|---|---|---|---|
| WP1 Block model | 30 control blocks mapped onto the 365 MV stations; *Aᵢ(t)* from the physics engine; shadow-field generator (solid band, thin band, scattered) with RRAtlas 1-min irradiance as the driver | D1/D2 replay produces the aggregate curves in Section 5 | physics | 3 |
| WP2 Impact nowcast | Lag-correlation front tracker; per-block ETA/ETD/depth/confidence; provider-forecast ingestion stub | ETA KPI met on replay | data | 5 |
| WP3 Planner + BGC | Trajectory planner (g, L, Δ, R); allocation heuristic and LP; slew; reactive migration; release mode | KPIs 1–6, 8 | control | 6 |
| WP4 PPC & TSP mocks | Group set-point writer/reader; notice generator (Section 9 fields); compliance ledger | notice renders with trajectory and R; ledger shows the 4.50 checks | infrastructure | 3 |
| WP5 Control-room views | Block map with gradient colouring and cloud overlay; POI chart (available / export / declared); reserve gauge; KPI tiles; event replay | demo storyline runs end to end | dashboard | 5 |
| WP6 Evaluation | Annual replay on one RRAtlas year: energy spilled vs gradient, false-alarm rate, events per year; the economics table with the team's own numbers | results slide | all | 4 |
| WP7 Pitch | Bilingual deck, 3-minute fallback video, jury drills | two full rehearsals | lead | 3 |

**Cut list:** no battery, no load control, no EMT/ride-through simulation, no new 3D, no deep learning, no live PPC or TSP connection, no more than three shadow-field types.

---

## 13. Pitch narrative (8 minutes) and jury questions

1. **Thesis (30 s).** "A 3,000 MW solar plant is thirty plants. A cloud crosses them one by one. We conduct them."
2. **What exists (45 s).** Operators already have hours-ahead forecasts and twins. We take that forecast as an input. Our question starts after it: what should the plant *do*?
3. **The physics (60 s).** No battery ⇒ export ≤ available. The only lever is *when and where* to subtract. The gradient you can promise is *D/(τ + L)*: the provider gives us *L*, we give the grid *g*.
4. **Block Gradient Control (120 s).** The animation: the front enters from the west; blocks descend to their post-event level just before the shadow reaches them; the reserve slice rolls along the far blocks; the POI is a straight declared line; the exit wave follows the cloud out. Then the honesty line: same spill as a plant-level pre-ramp — what we add is firmness, precision, reactive migration and sensing.
5. **Numbers (60 s).** D1 table: 1,800 MW cliff → 900 MW at 3 %/min for 305 MWh (1.2 % of a day, ≈ SAR 15,000); D2: a 360 MW dip made invisible for 46 MWh. Battery block: SAR 1.09 bn.
6. **The Code (45 s).** Delta Regulation, Gradient, updated Declarations to H-1, 4.46 notices, continuous-monitoring compliance — every instruction Raseen issues already has a clause number.
7. **What we don't claim (30 s).** No weather forecasting, no load control, no ride-through simulation, no "grid collapse".
8. **Ask (30 s).** One real plant's SCADA and one K.A.CARE station to calibrate the nowcast; a System Service pilot with National Grid SA.

**Jury questions and the answers that hold:**

1. *"Operators already forecast clouds."* — "Yes, and we use their forecast. Forecasting tells you a band arrives at 13:52; it does not tell 3,000 inverters what to do at 13:52:30. We convert the forecast into set-points, block by block, with a declared gradient and a firm reserve."
2. *"Why not just curtail the whole plant with the PPC?"* — "For a perfectly forecast front you spill the same energy — we say so. A plant-level set-point cannot tell you which headroom expires in three minutes, so it cannot declare a firm reserve; it re-scales all thirty blocks every time one is shaded; it curtails shaded blocks it should leave alone; and it cannot move reactive duty. Block control is what makes the promise executable and declarable."
3. *"You are throwing away energy."* — "About 1–2 % of annual energy at 3 %/min, measured at real plants; ≈ SAR 7–8 m/yr for this plant. A battery block that shapes a third of the same event costs about SAR 120 m/yr. Spilling the world's cheapest sunshine is the cheapest reserve in the Kingdom. Batteries belong on the evening peak."
4. *"What if the forecast is wrong?"* — "A late front costs the pre-ramp energy; the table shows it: 24 MWh at 4 %/min, 198 MWh at 2 %/min. We trigger on confidence, release nearest blocks first the moment the sentinels disagree, and report the false-alarm rate as a KPI."
5. *"What if the front is deeper than forecast?"* — "That is what the reserve slice on the far blocks is for; its size grows with forecast uncertainty. If it is exhausted, the export leaves the declared line — and the notice already told the TSO the residual under full cover."
6. *"Can inverters and the PPC do this?"* — "Group active-power limits and reactive set-points are standard PPC functions over Modbus/IEC 61850; we write them every 10 s within slew limits. Everything faster than a second stays in the firmware the Grid Code certifies."
7. *"Is 10 seconds fast enough?"* — "The shadow crosses a 100 MW block in about a minute. We move set-points 6 steps per block crossing; the PPC's own loop corrects the residual. The Code's set-point accuracy test allows 10 minutes."
8. *"Reactive power?"* — "The plant must hold ±0.33 pu at the POI. Shaded inverters have almost their full rating free; we give them the duty and let the sunny ones run at unity power factor."
9. *"Where does the 3 %/min come from?"* — "From the lead time: 1,800 MW over 10 minutes of crossing plus 10 minutes of lead is 90 MW/min. Give us 20 minutes of lead and it is 60. The number is the provider's lead time turned into a promise."
10. *"Who pays for the curtailment?"* — "If the TSP instructs a Gradient or Delta, it is settled under the PPA. As a System Service under 2.14.1 it is paid. Self-initiated, it is our cost — SAR 15,000 per severe event."
11. *"Is the plant real?"* — "NAJM-3000 is a representative 3 GW park modelled on the current NREP round. The irradiance driving it is real — K.A.CARE 1-minute measurements — and so are the physics engine and the controller; the plant itself is a stand-in until a developer gives us theirs."
12. *"Cyber?"* — "Raseen writes to the PPC inside the plant network and sends one signed, one-way message to the TSP. It removed the feature — load control — that would have widened the surface."
13. *"Why inside one plant and not across the region's plants?"* — "Because that is where the jurisdiction ends. Cross-plant coordination is the TSP's job; each plant declares its own gradient and reserve and National Grid SA schedules the sum. Raseen makes each plant's declaration trustworthy — which is exactly the input that system-level coordination needs."

**Kill sentences (never say):** "AI predicts clouds before they reach the plant" · "operators are blind to the weather" · "the grid will collapse" · "we store energy as headroom" (headroom is not storage) · "no energy is lost" · "we test LVRT" · "we control loads" · "please start the gas turbines".

---

## 14. Idea file for registration (v4 text)

**Title.** Raseen (رَصين) — Block Gradient Control: a no-storage digital twin controller that turns weather forecasts into a scheduled, declarable ramp for gigawatt solar.

**Track / challenge.** Track 1 Operational Efficiency · Challenge 2 "Grid stability with variable renewable production".

**Problem.** The Kingdom adds ≈ 20 GW of PV a year toward 50 % renewables by 2030. A 3 GW park is ≈ 4 % of the 72.9 GW record peak; a cloud band removes 1,800 MW from it in ten minutes — an N-2 contingency under SERA's planning criteria, absorbed today by reserve that the Grid Code keeps "against weather forecast uncertainties" (SAGC 4.41.15). Operators already receive hours-ahead forecasts; what is missing is the conversion of a forecast into an optimal physical response inside the plant, without buying a battery.

**Solution.** *We don't predict the weather; we predict its operational impact and control the plant, block by block.* Raseen takes the operator's existing external forecast as an input and treats a 3,000 MW plant as thirty spatial blocks. From that forecast and the plant's own sensors it computes each block's cloud arrival and departure time, then drives per-block active-power set-points through the existing PPC so that the plant's export follows a declared gradient — descending before the front, holding a rolling reserve on the blocks the cloud has not reached, re-ascending behind it. Block Gradient Control keeps a firm, declarable reserve (headroom counted only on blocks that stay in the sun), moves reactive duty to shaded inverters, and releases false alarms block by block. Dynamic Solar Headroom — the Code's Delta Regulation made dynamic and spatial — absorbs partial clouds entirely and makes the plant a bidirectional frequency-response provider. Every instruction maps to the Saudi Grid Code (Gradient, Delta, updated Declarations to H-1, 4.46 notification, continuous-monitoring compliance). Built on the team's existing pvlib physics engine and control room, before the plant is commissioned.

**Business model.** Customer: the IPP or its O&M contractor at plants above ~500 MW, and NREP bidders who need declarable ramp behaviour at financial close rather than after commissioning. Product: Raseen is licensed per plant per year (software plus integration to the existing PPC), with an optional share of System Service revenue once National Grid SA contracts the Rolling Solar Reserve under SAGC 2.14.1. Why now: the May 2026 Grid Code created the instruction set (Gradient, Delta Regulation, Declarations to H-1) and the 2030 target creates the plants — the two did not exist together before 2026. Market: about 12.5 GW of PV in operation at end-2025 in roughly twenty plants, every NREP award since 2023 at 1–2 GW per plant, and ≈ 20 GW a year being added toward a stated 2030 pathway of the order of 100–130 GW of renewables, most of it PV — on the order of 50–80 gigawatt-scale plants by 2030, each one a licence.

**What it does not do.** Predict weather (the forecast is an input); control loads; instruct the TSO; simulate ride-through; require storage.

**Emerging technologies.** Digital twin; physics-informed impact nowcasting; spatio-temporal optimisation of inverter set-points; IoT/SCADA/PPC integration; geospatial visualisation.

**Data.** K.A.CARE Renewable Resource Atlas (1-minute irradiance); NCM dust forecasts; the operator's forecast feed (mocked); Ministry of Energy open data (peak load, consumption by operational region); GASTAT 2024 energy statistics; SAGC May 2026, SADC June 2026, SERA TPC 2025.

**Expected impact.** A 1,800 MW cliff delivered as a 900 MW, 3 %/min scheduled ramp with ≥ 10 minutes' notice for ≈ 1 % of a day's energy; partial clouds made invisible to the grid; a declarable solar reserve without a battery — at roughly one-tenth to one-fifteenth of the annual cost of a battery block for the same ramp service.

**Team.** [Leader — Saudi national]; [physics engine]; [data and nowcast]; [control and optimisation]; [control room]. Eligibility: 2–5 members, 18+, Saudi nationals or residents; leader and at least one member attend 7–9 October in person.

### ملف الفكرة — النسخة العربية

**العنوان.** رَصين — التحكم بالتدرّج الكتلي: متحكم توأم رقمي بلا تخزين يحوّل توقعات الطقس إلى منحدر مجدول ومُعلَن لمحطات الطاقة الشمسية الجيجاواطية.

**المسار / التحدي.** مسار الكفاءة التشغيلية — التحدي الثاني «استقرار الشبكة الكهربائية مع تغير إنتاج الطاقة المتجددة».

**المشكلة.** تضيف المملكة نحو 20 جيجاواط من الطاقة الشمسية سنوياً للوصول إلى 50٪ من الطاقة المتجددة بحلول 2030. تمثل محطة 3 جيجاواط نحو 4٪ من الحمل الذروي القياسي البالغ 72.9 جيجاواط؛ وتزيل سحابة كثيفة 1,800 ميجاواط منها خلال عشر دقائق — حالة طوارئ من نوع N-2 بموجب معايير التخطيط لدى هيئة تنظيم الكهرباء، تُمتصّ اليوم باحتياطي يحتفظ به الكود الكهربائي «مقابل عدم يقين توقعات الطقس» (4.41.15). المشغلون يتلقون أصلاً توقعات قبل ساعات؛ والغائب هو تحويل التوقع إلى استجابة فيزيائية مثلى داخل المحطة، من دون شراء بطارية.

**الحل.** *لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً.* يأخذ رَصين توقعات الطقس التي يمتلكها المشغّل أصلاً كمُدخل — فالتنبؤ بالطقس ليس ابتكارنا — ويعامل محطة 3,000 ميجاواط كثلاثين كتلة مكانية. من ذلك التوقع ومن مستشعرات المحطة نفسها يحسب زمن وصول الظل ومغادرته لكل كتلة، ثم يقود نقاط ضبط القدرة الفاعلة لكل كتلة عبر متحكم المحطة القائم بحيث يتبع تصدير المحطة تدرّجاً مُعلناً — ينخفض قبل الجبهة، ويحتفظ باحتياطي متدحرج على الكتل التي لم تبلغها السحابة، ويرتفع خلفها. يحافظ «التحكم بالتدرّج الكتلي» على احتياطي مؤكَّد قابل للإعلان (هامش يُحتسب فقط على الكتل التي تبقى تحت الشمس)، وينقل واجب القدرة غير الفاعلة إلى العواكس المظلَّلة، ويفكّ الإنذارات الكاذبة كتلةً كتلة. و«هامش الطاقة الشمسية الديناميكي» — وهو «تنظيم دلتا» في الكود مُحوَّلاً إلى نمط ديناميكي مكاني — يمتصّ السحب الجزئية كلياً ويجعل المحطة مزوّداً ثنائي الاتجاه للاستجابة الترددية. كل تعليمة تصدر عنه لها بند في الكود السعودي للشبكة (التدرّج، دلتا، الإعلانات المحدّثة حتى ساعة قبل الوقت الفعلي، إشعار 4.46، الامتثال بالمراقبة المستمرة). مبني على محرك pvlib وغرفة التحكم الموجودَين لدى الفريق، قبل التشغيل التجريبي.

**نموذج العمل.** العميل: المنتج المستقل للطاقة أو مقاول التشغيل والصيانة في المحطات التي تتجاوز نحو 500 ميجاواط، والمطوّرون المتنافسون في جولات البرنامج الوطني للطاقة المتجددة الذين يحتاجون سلوك منحدر قابلاً للإعلان عند الإغلاق المالي لا بعد التشغيل. المنتج: ترخيص سنوي لكل محطة (برمجيات وتكامل مع متحكم المحطة القائم)، مع حصة اختيارية من إيراد خدمة النظام عند تعاقد الشركة السعودية للشبكة على «الاحتياطي الشمسي المتدحرج» بموجب البند 2.14.1. لماذا الآن: كود الشبكة (مايو 2026) أوجد مجموعة التعليمات (التدرّج، تنظيم دلتا، الإعلانات حتى ساعة قبل الوقت الفعلي)، وهدف 2030 يوجد المحطات — ولم يجتمع الاثنان قبل 2026. السوق: نحو 12.5 جيجاواط شمسية عاملة بنهاية 2025 في نحو عشرين محطة، وكل ترسية منذ 2023 بقدرة 1–2 جيجاواط للمحطة، ونحو 20 جيجاواط تُضاف سنوياً — أي ما يقارب 50–80 محطة جيجاواطية بحلول 2030، كل منها ترخيص.

**ما لا يفعله.** لا يتنبأ بالطقس (التوقع مُدخل)، ولا يتحكم بالأحمال، ولا يوجّه تعليمات لمشغل النقل، ولا يحاكي تجاوز الأعطال، ولا يحتاج تخزيناً.

**التقنيات الناشئة.** التوأم الرقمي؛ التنبؤ القريب بالأثر المستند إلى الفيزياء؛ التحسين المكاني-الزمني لنقاط ضبط العواكس؛ تكامل إنترنت الأشياء/سكادا/متحكم المحطة؛ التصور الجغرافي.

**البيانات.** أطلس الموارد المتجددة (إشعاع بدقة دقيقة)؛ توقعات الغبار للمركز الوطني للأرصاد؛ تغذية توقعات المشغل (محاكاة)؛ البيانات المفتوحة لوزارة الطاقة (الحمل الذروي، الاستهلاك حسب المناطق التشغيلية)؛ إحصاءات الطاقة 2024؛ الكود السعودي للشبكة مايو 2026، كود التوزيع يونيو 2026، معايير تخطيط النقل 2025.

**الأثر المتوقع.** هاوية 1,800 ميجاواط تُسلَّم كمنحدر مجدول بـ900 ميجاواط بمعدل 3٪/دقيقة مع إشعار مسبق لا يقل عن 10 دقائق مقابل نحو 1٪ من طاقة اليوم؛ سحب جزئية لا تراها الشبكة؛ احتياطي شمسي قابل للإعلان بلا بطارية — بنحو عُشر إلى جزء من خمسة عشر من الكلفة السنوية لوحدة بطارية للخدمة نفسها.

**الفريق.** [قائد الفريق — سعودي]؛ [المحرك الفيزيائي]؛ [البيانات والتنبؤ القريب]؛ [التحكم والتحسين]؛ [غرفة التحكم]. الأهلية: 2–5 أعضاء، فوق 18 عاماً، سعوديون أو مقيمون؛ يحضر القائد وعضو واحد على الأقل حضورياً في 7–9 أكتوبر.

---

## 15. Glossary (EN / AR)

| Term | Meaning | العربية |
|---|---|---|
| Available Active Power, *Aᵢ* | power a block could export now given the sun on it (Grid Code term) | القدرة الفاعلة المتاحة |
| Headroom, *hᵢ* | available minus export; upward reserve that expires when the cloud arrives | الهامش |
| Block Gradient Control (BGC) | allocation of curtailment across blocks by cloud-arrival order to hold a declared plant gradient | التحكم بالتدرّج الكتلي |
| Rolling Solar Reserve, *R(t, Hʳ)* | headroom on blocks the cloud will not reach within *Hʳ* | الاحتياطي الشمسي المتدحرج |
| Dynamic Solar Headroom (DSH) | standing headroom (Delta Regulation) held only while an event is likely, placed on the safest blocks | هامش الطاقة الشمسية الديناميكي |
| Declared gradient, *g* | the POI ramp rate Raseen promises; *g = D/(τ + L)* | التدرّج المُعلَن |
| Lead time, *L* | minutes of forecast before fence contact that Raseen can trust | زمن الاستباق |
| Crossing time, τ | minutes for the front to cross the plant along its heading | زمن العبور |
| Depth, *D* | MW lost at full cover | عمق الهبوط |
| Impact nowcast | per-block ETA/ETD/depth from the plant's own sensors — not weather forecasting | التنبؤ القريب بالأثر |
| Ramp Event Notice | the updated Declaration / 4.46 notification carrying the trajectory, reserve and residual | إشعار حدث المنحدر |
| PPC | Power Plant Controller — the plant's existing set-point authority | متحكم المحطة |
| POI | Point of Interconnection / Connection Point | نقطة الربط |

## 16. Risks and open questions

- **Forecast lead.** The declared gradient depends on the provider's lead time and confidence. Contract the lead time explicitly; publish *g* as a function of *L*, not as a fixed promise.
- **PPA treatment of self-initiated curtailment.** Confirm with SPPC/TSP how Gradient/Delta-instructed reductions and contracted System Services are settled; frame BGC as a service, not a unilateral loss.
- **PPC access.** Some PPC vendors restrict per-group limits; confirm write access and cycle times at the pilot plant.
- **Sensor density.** 19 stations over 60 km² give ~1.8 km spacing; block-level inverter output (365 stations) is the finer sensor. Use both.
- **Irregular fronts.** The design case is a straight front; real shadow fields are ragged. WP1 must include a scattered-cumulus shadow generator so WP3 is tested on it.
- **Do not overclaim.** The energy-neutrality of allocation (relation 4) is a fact; the jury may know it. Lead with firmness, precision, sensing and cost — and with the animation.

### 16.1 Open items from the 14 September dissent pass (full text: `project-notes/raseen-v4-dissent.md`)

- **Test the concession (F3).** Add a scattered-cumulus shadow field D3 to `raseen_bgc_sim.py` and run both controllers with a PPC loop delay; report tracking error against the declared line and any extra spill. Zero delta = proof the concession is honest; non-zero = a recovered headline claim.
- **Price the benefit (F4).** The Rolling Solar Reserve maps to a paid System Service but has no SAR figure. Needed: what the TSP pays per MW of reserve, or the avoided cost of the thermal capacity it displaces (SAGC 4.41.15 is the budget line Raseen shrinks).
- **Make the gradient a result, not a table row (F5).** Minimise E[cost(g)] = events/yr × [shaping spill(g) + P(false) × pre-contact spill(g)] − reserve value(g) over g, using Table 5.1 and the DLR 13 % false-positive rate; needs F4's number.
- **Sensitivity sweep on σ, κ, Hʳ (F6)** — show the KPIs are flat across a range; "tunable" reads as "unvalidated".
- **Prior-art search on claim 1 (F7)** — search "zonal curtailment", "cluster curtailment", "spatially resolved plant control", "cloud-aware dispatch"; cite what is found.
- **A letter of interest from one IPP or NREP developer (F8)** — the highest-value non-technical action before 7 October.
- **De-risk the critical path (F9)** — build WP3 against ground-truth ETAs from the WP1 shadow generator from day one; swap WP2's estimates in when they arrive.
- **Consider the reframe (A1)** — lead with "a new declarable reserve product for gigawatt solar, and the controller that makes it real" once F4 has a number; and **cost the token battery (A2)** — a 50 MW / 50 MWh store as false-alarm insurance, so "no battery" becomes a result rather than a stance.

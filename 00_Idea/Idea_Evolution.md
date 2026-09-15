# Raseen (رَصين) — every idea considered, and why v4 is the one

A single place for the whole trail of ideas since 7 September 2026, so the team can answer "why not X?" without re-reading four documents. Sources: the 7 Sep research brief (v1), the team's own reference guides (v2), the 11 Sep logic audit (v3), the 13–14 Sep concept documents (v4) and the 14 Sep dissent pass.

---

## 1. The eight ideas ranked on 7 September (research brief, Section 7)

Scored 1–5 on fit to the challenge text, data you can actually get, buildable to demo quality by 7 October, novelty in the Saudi context, and reuse of what the team already has.

| # | Idea | Challenge | Total /25 | Where it went |
|---|---|---|---|---|
| 1 | **NAJM-3000 Grid Twin** — the existing twin plus forecasting, ramp management and grid-code compliance | T1·C2 | **22** | Became v2 → v3 → v4 (Raseen). |
| 2 | **Dust-aware derating & cleaning dispatch** — NCM 72-h dust forecast into a soiling model calibrated with Saudi loss rates (6 % in 5 weeks Dhahran; 11.5 % in 72 h Riyadh; 20 % after one storm); MW loss per block, cleaning-crew routing, deficit warning | T1·C2 / T3·C1 | 21 | Folded into the forecast-ingestion module of v3/v4 (NCM dust outlook feeds the event hypothesis and the physics engine's soiling state). Still a candidate stand-alone product later. |
| 3 | **Grid-Code Copilot** — retrieval assistant over SAGC/SADC/TPC/GEPC that answers with the clause and runs the test in a simulator | T1·C2 | 20 | Its substance became the compliance & notice engine and the clause-by-clause mapping (v3 §, v4 §9). Not pitched as a chatbot. |
| 4 | **Ramp Radar** — fleet-level PV ramp and reserve-need forecaster for the TSO | T1·C2 | 19 | Rejected as the product: forecasting is the operators' vendors' business and system-level coordination is the TSP's jurisdiction (v4 jury answer 13). The *reserve* half survives as the declarable Rolling Solar Reserve. |
| 5 | **Surplus-to-Value** — routing midday PV surplus to desalination, district cooling, EV fleets, electrolysers | T3·C2 | 18 | Different track, different team profile. Dropped. |
| 6 | **Outage-risk heatmap** — regional distribution-outage model from SAIDI/SAIFI, line lengths, automation % | T3·C1 | 18 | Analytics on annual data; modest novelty. Dropped. |
| 7 | **Pre-cooling demand response for households** | T3·C2 | 14 | Dropped. |
| 8 | **Cyber-physical anomaly detection** — the twin's physics residual flags SCADA readings that are physically impossible (SAIF angle) | SAIF | 21 | Parked. Only relevant if the team also enters SAIF (closes 28 Sep); not part of the Energy Hackathon entry. |

---

## 2. What the team's v2 references added (9–11 September)

- **English six-module guide:** forecasting stack, battery coordination, grid-code compliance, control room, twin, and **Smart Load Control** (curtailing/shifting loads during ramps).
- **Arabic three-module "final" reference:** LightGBM cloud/production forecast, MILP battery coordinator, grid-code compliance package.
- **OPUS grilling report (9 Sep):** a stress test of the claims.

What the 11 Sep audit found and fixed:

| Claim or module | Verdict | Reason (with the clause) |
|---|---|---|
| Smart Load Control | **Removed** | Demand control is a Distribution Service Provider function (SADC OC.6); Demand-Side Response is a TSP System Service (SAGC 2.13–2.14). A generator has no right to it. |
| "The grid will collapse" | **Removed** | SERA's Transmission Planning Criteria already subject renewable parks above the minimum spinning reserve to N-2 testing; the reserve ladder (SAGC 4.31.1, 4.41) is designed to absorb the loss. Say "the grid pays for reserve it would not need". |
| LVRT / droop "testing" in the twin | **Removed** | Ride-through and droop are certified inverter-firmware behaviour (2.11.13.7–10, 2.11.13.16–18) in the millisecond domain; a 10-second twin cannot test them. |
| Dual-track submission | **Removed** | One idea in one track. |
| Cloud forecasting as the product | Kept in v3, **removed in v4** | See section 3. |
| MILP battery coordinator | Kept in v3, **removed in v4** | See section 3. |
| Grid-code compliance package, Ramp Event Notice | **Kept** | SAGC 5.3.8.1(iii) lets renewable generators update Declarations to H-1; 4.46.3.2 requires advance notification of events with an Operational Effect. |
| The twin, the physics engine, the 19-station sensor array | **Kept** | The sensor array became the "sentinel nowcast" (v3) and then the impact nowcast (v4). |

---

## 3. The v4 direction change (13 September) — two corrections

1. **The forecast is an input, not the product.** Large operators already buy hours-ahead forecasts (satellite, NWP, machine learning) and run digital twins. Positioning the entry as "AI that predicts clouds before they reach the plant" would be competing with vendors on their home ground and would insult the jury's own operators. The provider says *a band arrives between 13:40 and 14:10*; it cannot say which inverter loses power at 13:52:30, and it does not decide what the plant should do. That conversion — forecast → physically executed, grid-visible response — is the product.
2. **No battery.** A utility-scale battery is the most expensive way to shape a ramp (SPPC block: 500 MW / 2,000 MWh ≈ SAR 1.09 bn). The flexibility already exists inside the plant: 3,000 inverters with individual set-points, the PPC, SCADA, 19 weather stations, 60 km² over which a cloud is never everywhere at once. Spilling sunshine for a few minutes costs ≈ SAR 7–8 m/yr for the same ramp service — an order of magnitude less.

### The three concepts that came out of it

| Concept | Arabic | What it is | Grid Code anchor |
|---|---|---|---|
| **Block Gradient Control (BGC)** — the spotlight | التحكم بالتدرّج الكتلي | The plant as 30 × 100 MW spatial blocks, each with coordinates, irradiance, inverter output, available power, post-event level, cloud ETA/ETD with confidence, set-point, headroom, firm flag, slew limit. Every 10 s the required curtailment is placed by cloud-arrival order (descend-first), a reserve slice is kept on the far blocks, set-points are slew-limited, reactive duty migrates to shaded inverters, false alarms are released nearest-first. Works before contact, during transit and at exit. | Active Power Gradient (2.11.13.11, 5.4.2.3); set-point accuracy 2 % / 0.5 % within 10 min; Dispatch Accuracy Test ±10 % (4.50.8.8) |
| **Rolling Solar Reserve** | الاحتياطي الشمسي المتدحرج | Headroom counted only on blocks the cloud will not reach within the stated horizon: R(t, Hʳ) = Σ { hᵢ : ETAᵢ > Hʳ }. It moves with the front ("moving headroom") and is the only reserve a PV plant can honestly declare. | Updated Declarations to H-1 (5.3.8.1(iii)); 4.46 notification; System Service 2.14.1; continuous-monitoring compliance 4.50.8.7 |
| **Dynamic Solar Headroom (DSH)** | هامش الطاقة الشمسية الديناميكي | The Code's Active Power Delta Regulation made dynamic (only while an event is likely) and spatial (on the blocks least likely to be shaded). Absorbs partial clouds entirely; makes the plant a bidirectional frequency-response provider. | Delta Regulation (definition; 2.11.13.11); upward response 2.11.13.10; Frequency Regulation 2.11.13.9 |

### The physics that disciplines the claims

- No storage ⇒ export ≤ available at every instant. Everything is subtraction; the only question is where and when.
- Headroom on a block expires when the shadow arrives — which is why a plant-level number cannot be a reserve.
- **The lead-time contract:** g = D / (τ + L). The forecast provider supplies the lead L; the plant converts it into a guaranteed gradient g. D = 1,800 MW, τ = 10 min: 10 minutes of lead → 90 MW/min (3 %/min); 20 → 60; 5 → 120.
- **Spill is fixed by the gradient, not by the allocation:** E = (r − g)·τ·(D/g)/2. BGC spills the same energy as a plant-level pre-ramp for a perfectly forecast front — the documents say so first. What BGC adds: no block steps when the shadow arrives, a firm and declarable reserve, localised false-alarm release, reactive migration, and the block grid as the sensor.
- Design case D1 numbers: g = 150 / 120 / 90 / 60 MW/min needs L = 2 / 5 / 10 / 20 min and spills 65 / 155 / 305 / 605 MWh in total (5 / 24 / 74 / 198 MWh before contact — the false-alarm exposure). Thin band D2: flat at 2,640 MW for 46 MWh.

---

## 4. Ideas raised by the 14 September dissent pass (not yet done)

| Ref | Idea | Status |
|---|---|---|
| F1 | Answer the Entrepreneurship criterion: customer, licence model, why now, market from the published pipeline | **Done in v4.1** (idea file EN/AR; explainer "Who buys it" card) |
| F2 | Arabic idea file must lead with "the forecast is an input" | **Done in v4.1** |
| F3 | Test the "same spill" concession on a ragged shadow field with a PPC loop delay | Open — `raseen_bgc_sim.py` D3 |
| F4 | Price the Rolling Solar Reserve in SAR | Open — needs the TSP tariff or avoided-capacity cost |
| F5 | Make the declared gradient an expected-value optimisation result | Open — needs F4 |
| F6 | Sensitivity sweep on σ, κ, Hʳ | Open |
| F7 | Prior-art search on spatial/zonal curtailment | Open |
| F8 | Letter of interest from an IPP / NREP developer; lead with "the irradiance is real" | Open (the "irradiance is real" line is now in jury answer 11) |
| F9 | Build WP3 against ground-truth ETAs so a WP2 slip does not sink the demo | Open — plan change |
| F10 | Specify ETA handling between nowcast updates | **Done in v4.1** (§7.3) |
| F11 | Do not assert the 1–3 % reactive-migration gain | **Done in v4.1** (§7.6) |
| A1 | Reframe as "a new declarable reserve product for gigawatt solar, and the controller that makes it real" | Consider for the 9 Oct pitch once F4 has a number |
| A2 | Cost a token 50 MW / 50 MWh battery as false-alarm insurance | Open — one hour of analysis |
| A3 | Thirteenth jury answer: why inside one plant, not across the region | **Done in v4.1** |

---

## 5. Names

| Date | Name | Note |
|---|---|---|
| 7–13 Sep | NAJM-3000 (نجم-3000) | "Najm" = star; the 3,000 MWac reference plant and, until 14 Sep, the project |
| 14 Sep → | **Raseen (رَصين)** | composed, steady, unshaken — the plant that keeps its composure when the cloud comes. NAJM-3000 stays as the plant's name inside the twin. |

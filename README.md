# Raseen · رَصين

**A no-storage digital-twin controller that turns the weather forecast a solar operator already has into a scheduled, declarable ramp — block by block, inside the plant, with every instruction already defined in the Saudi Arabian Grid Code.**

*Raseen — رَصين — composed, steady, unshaken: the plant that keeps its composure when the cloud comes.*
The project was called **NAJM-3000** from its first deck (7 September 2026) until 14 September 2026; NAJM-3000 remains the name of the 3,000 MWac reference plant inside the twin.

> **We don't predict the weather. We predict its operational impact and control the plant, block by block, so the grid sees a schedule instead of a cliff.**
> **لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً، فترى الشبكة جدولاً بدل هاوية.**

Entry for the Ministry of Energy **Energy Hackathon 2026 — أوقِد أفكارك**, Track 1 Operational Efficiency · Challenge 2 "Grid stability with variable renewable production" (استقرار الشبكة الكهربائية مع تغير إنتاج الطاقة المتجددة).

---

## Dates that matter

| When | What |
|---|---|
| **Mon 15 Sep 2026** | Submit the idea file (`00_Idea/Raseen_Idea_File_for_Registration.md`) at hackathon.moenergy.gov.sa — registration **closes Wed 16 Sep** |
| 30 Sep | Qualifiers announced |
| 7–9 Oct | Camp at KAPSARC — leader + at least one member in person; day 3 is the jury pitch |
| 13 Oct | Winners announced on the WPC25 stage |
| 28 Sep / 24–26 Nov | SAIF (saifair.sa, Ministry of Interior) — a separate event; registration closes 28 Sep if the team also wants the cyber-physical angle there |

Team rules: 2–5 members, all 18+, Saudi nationals or residents, **Saudi team leader**, one idea in one track, emerging technologies / digital solutions, integrated presentation.

---

## Folder map

```
Raseen/
├── README.md                         ← this file: what Raseen is, version history, open items
├── 00_Idea/
│   ├── Raseen_Idea_File_for_Registration.md   ← EN + AR text to paste into the portal (fill in team roles)
│   └── Idea_Evolution.md                      ← every idea considered since 7 Sep and why v4 is the one
├── v1_NAJM-3000_Digital_Twin_and_Research_Brief_7-Sep/
│   ├── NAJM3000_Digital_Twin_deck.pdf         ← the original team deck (pre-commissioning twin of a 3,000 MWac plant)
│   ├── Energy_Hackathon_2026_Research_Brief_NAJM-3000.docx / .pdf / .md   ← events, rules, data sources, eight ranked ideas, first idea file
├── v2_Team_Reference_Documents_9-11-Sep/
│   ├── NAJM-3000_Reference_Guide_EN.md        ← the team's six-module English guide (incl. Smart Load Control)
│   ├── NAJM-3000_Final_Team_Reference_AR.md   ← the team's three-module Arabic "final" reference
│   ├── OPUS_Grilling_Report_EN.html           ← the stress-test / grilling report dated 9 Sep
│   └── Challenge_Card_Track1_Operational_Efficiency_AR.md   ← the ministry's supporting card for the challenge
├── v3_Grid_Twin_Logic_Audit_11-Sep/
│   ├── NAJM-3000_Grid_Twin_Logic_Audit_v3.md / .html / .pdf   ← claim-by-claim audit of v2 and the "100 % logical" v3 idea (plant + 500 MW battery)
│   ├── najm3000_design_case_scenario.py       ← the D1 scenario script behind the v3 numbers
│   └── design_case_D1.svg                     ← the v3 design-case chart
├── v4_Raseen_Block_Gradient_Control_13-14-Sep/
│   ├── Raseen_v4_Block_Gradient_Control_Team_Document.md   ← THE working document for the team (16 sections)
│   ├── Raseen_v4_Block_Gradient_Control_Explainer.html     ← interactive explainer with the live block-gradient model (open in any browser)
│   └── raseen_bgc_sim.py                                   ← the block simulation behind every number (python3, no dependencies)
├── references/                       ← full texts used for the Grid Code mapping and the challenge research
│   ├── SAGC_Saudi_Arabian_Grid_Code_May_2026.md
│   ├── SADC_Saudi_Arabian_Distribution_Code_June_2026.md
│   ├── SERA_Transmission_Planning_Criteria_2025.md
│   ├── SERA_Generation_Expansion_Planning_Criteria_2021.md
│   ├── SERA_District_Cooling_Services_Supply_Code.md
│   ├── MDPI_ApplSci_2025_15-10031_DRL_storage_scheduling.md
│   └── IEA_Managing_Seasonal_and_Interannual_Variability_of_Renewables.md
└── project-notes/
    ├── hackathon-key-facts.md         ← verified facts: events, rules, Grid Code values, numbers for the pitch, current idea state
    ├── raseen-v4-dissent.md           ← the 14 Sep constructive-dissent pass on v4 (F1–F11, A1–A3) — the open to-do list
    └── cortex-setup.md                ← tooling notes for the prototype code (Cortex agents/skills)
```

The `.md` files open in any text editor (VS Code, Obsidian, Typora render them nicely). The explainer is a single self-contained HTML file — double-click it; it needs no server, only an internet connection for the fonts.

---

## Version history — how the idea got here

| Version | Date | Name | What it was | What changed and why |
|---|---|---|---|---|
| **v1** | 7 Sep | NAJM-3000 Digital Twin | The team's deck: a pre-commissioning digital twin of a 3,000 MWac plant — pvlib physics engine, simulated SCADA, 3D model, browser control room, 365 MV stations, 19 weather stations. The research brief mapped the two events, corrected the SAIF/Energy-Hackathon mix-up, verified the rules and data sources, and ranked eight ideas; "NAJM-3000 Grid Twin" scored highest. | Established: Track 1 · Challenge 2 is the target; the twin is the asset; the deck needed grid-stability substance. |
| **v2** | 9–11 Sep | NAJM-3000 Grid Twin (team references) | The team's English six-module guide (forecasting, battery coordination, compliance, Smart Load Control, …) and the Arabic three-module "final" reference (LightGBM forecast, MILP battery coordinator, grid-code compliance package), plus the OPUS grilling report. | Strong on ambition, weak on jurisdiction and physics: load control is a Distribution Service Provider function, "grid collapse" framing, ride-through "testing" in a twin. |
| **v3** | 11 Sep | NAJM-3000 Grid Twin — logic audit | Claim-by-claim audit against the full texts of SAGC May 2026, SADC June 2026, SERA TPC and GEPC; a "100 % logical" idea: three-horizon forecast stack (NCM dust → Meteosat → sentinel nowcast from the plant's own stations), MILP battery scheduler, Grid-Code compliance & notice engine (Ramp Event Notice). | Dropped Smart Load Control, "collapse" framing, LVRT testing, the dual-track claim. Kept the twin, the sentinel idea, the compliance engine. Still needed a 500 MW / 2,000 MWh battery. |
| **v4.0** | 13 Sep | NAJM-3000 v4 — Block Gradient Control | Direction change: the operator's external forecast is an **input**, not the product; **no battery**. New core: **Block Gradient Control** — the plant as 30 × 100 MW blocks, curtailment placed by cloud-arrival time, a **Rolling Solar Reserve** on the blocks the cloud reaches last, **Dynamic Solar Headroom** (the Code's Delta Regulation made dynamic and spatial). Physics: g = D/(τ + L); spill is fixed by the gradient, not the allocation. Interactive explainer with the live block model. | Removes the most expensive component and the weakest claim ("we forecast clouds"); everything the controller issues already exists in the Grid Code. |
| **v4.1** | 14 Sep | **Raseen (رَصين)** | Renamed. Same concept, plus the cheap fixes from the dissent pass: a business-model paragraph in the idea file (customer, licence, why now, market), the Arabic idea file reframed so "the forecast is an input" comes first, ETA handling between nowcast updates specified, the reactive-power gain no longer asserted as a percentage, a thirteenth jury answer ("why inside one plant?"). | Answers the Entrepreneurship criterion the FAQ names; fixes the bilingual reading risk. |

---

## The idea in one paragraph (current)

A 3,000 MW PV plant is not one generator; it is thirty 100 MW blocks spread over eight kilometres, and a cloud crosses them one after another in ten minutes. Raseen takes the external forecast as an input, measures the front on the first blocks it touches, computes each block's arrival and departure time, and drives per-block active-power set-points through the existing Power Plant Controller so that the plant's export follows a smooth, pre-declared gradient — descending before the front, holding a rolling reserve on the blocks the cloud has not reached, re-ascending behind it. The energy that shapes the ramp is a thin slice of sunshine deliberately not exported for a few minutes: no battery, no new hardware, no new rights. Headline: an 1,800 MW cliff becomes a 900 MW ramp at 3 %/min with ten minutes' notice, for ≈ 305 MWh (≈ 1.2 % of a day, ≈ SAR 15,000) — versus a SAR 1.09 bn battery block that covers a third of the same event.

**Never say:** "AI predicts clouds before they reach the plant" · "operators are blind to the weather" · "the grid will collapse" · "we store energy as headroom" · "no energy is lost" · "we test LVRT" · "we control loads".

---

## Open items before the camp (from `project-notes/raseen-v4-dissent.md`)

1. **Test the concession (F3)** — add a scattered-cumulus shadow field to `raseen_bgc_sim.py`, run both controllers with a PPC loop delay, report tracking error and spill. Either proof or a recovered headline.
2. **Price the benefit (F4)** — a SAR figure for the Rolling Solar Reserve (what the TSP pays per MW of reserve, or the avoided thermal capacity). Unlocks F5 (the declared gradient as an optimisation result) and the A1 reframe ("a new declarable reserve product for gigawatt solar").
3. **Sensitivity sweep (F6)** on σ, κ, Hʳ — show the KPIs are flat.
4. **Prior-art search (F7)** on "zonal / cluster curtailment", "spatially resolved plant control", "cloud-aware dispatch".
5. **A letter of interest (F8)** from one IPP or NREP developer — the highest-value non-technical action.
6. **Critical path (F9)** — build the controller (WP3) against ground-truth ETAs from the shadow generator (WP1) from day one; swap in the nowcast (WP2) when it arrives.
7. **Cost the token battery (A2)** — a 50 MW / 50 MWh store as false-alarm insurance, so "no battery" is a result, not a stance.

---

## Running the simulation

```
cd v4_Raseen_Block_Gradient_Control_13-14-Sep
python3 raseen_bgc_sim.py
```

Prints the metrics for the design cases (uniform vs Block Gradient Control at 60/90/120/150 MW/min, the thin-band cases, the analytic spill check) and writes `raseen_sim.json`. Pure Python, no packages needed. The JavaScript model inside the explainer implements the same equations and reproduces the same numbers.

# The Comprehensive Reference Guide for NAJM-3000

---

This document serves as the primary and comprehensive reference for the Energy Hackathon team. It contains all technical details, strategic framing, and practical examples explaining the concept from A to Z. It is the ultimate guide for building the MVP (Minimum Viable Product) and preparing for the final pitch to the judging panel.

# 1. Introduction & Executive Summary

NAJM-3000 is a predictive digital twin for utility-scale solar power plants. It acts as the intelligent bridge between the solar plant, the battery energy storage system (BESS), and the electrical grid.

This project is not just a dashboard displaying current events; it is a system that lives in the future. It predicts dust and cloud disturbances, tests their impact on the plant and grid in a virtual simulation environment *before* they occur, and then coordinates the battery and inverters. Crucially, it also applies **Smart Load Control** to temporarily disconnect non-essential loads. Finally, it calculates the exact external reserve required to mitigate power fluctuations and maintain stability at the Point of Interconnection (POI) before the grid frequency is physically impacted.

The system performs five core, interconnected functions in a Closed Loop:
1. **Predicts** the event (Seeing the future).
2. **Simulates** the impact (Experiencing the event before it happens).
3. **Decides** the optimal response (Planning battery and load dispatch).
4. **Executes** the decision (Sending commands within the simulation).
5. **Measures** the result and declares plant capability (Performance comparison).

# 2. The Hackathon Context & The Problem We Solve

We are competing in Track 1 (Operational Efficiency), specifically Challenge 2, which focuses on "Grid stability with variable renewable production."

**The Current Landscape in Saudi Arabia:**
Saudi Vision 2030 aims to reach 50% electricity production from renewable sources (approximately 130 GW). A single 3000 MW solar plant accounts for about 4% of the Kingdom's peak load (which reached 72.9 GW in summer 2024). 
When a dense cloud band or dust storm passes over this plant, the grid loses a massive amount of power in mere minutes. This loss can be faster and larger than the tripping of the largest thermal generation unit on the national grid.

Today, grids operate mostly reactively. The grid operator often does not grasp the magnitude of the problem until the plant physically starts dropping power. In that critical moment, the operator scrambles to find reserve power, posing a severe threat to frequency and voltage stability.

# 3. Technical Problem Deep Dive

When plant production drops sharply, a series of critical questions emerge that traditional systems fail to answer in advance:

- **Magnitude of Drop:** Exactly how many megawatts will we lose?
- **Speed of Drop:** What is the Ramp Rate at the POI? Will it violate the limits set by the Saudi Arabian Grid Code?
- **Storage Readiness:** Is the battery sufficiently charged? If so, how many megawatts can it realistically compensate during the drop?
- **Grid Code Requirements:** Do we need to reserve a portion of the battery's energy for Frequency Response instead of fully discharging it?
- **Reactive Power:** Will injecting Active Power conflict with the inverters' Reactive Power and voltage support obligations?
- **Load Management:** Are there non-essential loads connected to the grid that can be temporarily curtailed to ease the burden?
- **Residual Deficit:** Ultimately, what is the final deficit number that the national grid must cover from other plants?

NAJM-3000 gathers data, calculates these variables, and answers these questions well before the event, giving the grid ample time to prepare rather than being caught off guard.

# 4. The Innovative Solution: A Grid & Load Twin

To conceptualize the system simply, imagine a machine that combines three inventions:
1. **A Flight Simulator:** We input the dust and cloud conditions and let the system "fly" the plant virtually to see when and how its power will crash.
2. **An Autopilot:** A mathematical optimization algorithm that figures out the safest "landing" (how to smartly discharge the battery and which loads to turn off).
3. **An Early Warning System:** It contacts the control tower (the Transmission System Operator - TSO) and says: "We have done everything in our power locally; you only need to cover this specific remaining deficit."

This integration transforms the digital twin concept from a passive monitoring tool into an tool for **Proactive Operation**. This is exactly what will impress the jury when compared to conventional solutions.

# 5. Smart Load Control - Strategic Depth

The secret weapon that makes this project fiercely competitive is that we do not stop at solving the problem from the **Supply** side (batteries and inverters); we also tackle it from the **Demand** side.

How does Smart Load Control work in NAJM-3000?
- When the system predicts an approaching cloud causing a sharp power drop.
- It rapidly scans the Flexible/Controllable Loads connected to the plant or local distribution network.
- It evaluates the "criticality" of these loads based on recent historical data.

**Practical Example 1:**
We have an EV Charging Station connected to the grid. The system analyzes the last 3 days of data and finds its usage rate is extremely low (idle/wasted load). When the dust storm hits, the system sends a command to temporarily curtail or disconnect this station (e.g., for 15 minutes). This frees up highly valuable energy at a critical time.

**Practical Example 2:**
Non-critical cooling systems in administrative buildings linked to the plant. The cooling can be reduced by just 1 degree for a very short period (30 minutes) without users noticing, saving multiple megawatts to support the grid during the solar generation dip.

As soon as the weather event passes and solar generation ramps back up, the system issues a reverse command to reconnect the loads. This application minimizes the deficit, saves money, and requires no massive infrastructure investments.

# 6. System Architecture (The Six Modules)

NAJM-3000 consists of six interconnected software modules working together to produce the final decision:

## Module 1: Physics Engine (Solar Production)
Uses libraries like `pvlib` to convert weather data (irradiance, temperature, wind, panel specs, and angles) into expected power output. This forms the sound physical foundation of the system.

## Module 2: Forecast Engine (Uncertainty & ML)
Corrects the physics engine's errors based on historical data using Machine Learning, specifically algorithms like LightGBM. It generates multiple scenarios (P50/P90) to convey the confidence level of the forecast, rather than a single deterministic number that could be wrong.

## Module 3: Dust & Derating Engine
Converts weather forecasts (e.g., from the National Center of Meteorology - NCM) into an expected capacity loss percentage. It distinguishes between suspended atmospheric dust (which blocks the sun) and accumulated soiling on the panels (which requires cleaning dispatch).

## Module 4: Storage & Load Dispatcher
This is the mastermind. A mathematical algorithm using Mixed Integer Linear Programming (MILP) solves the optimization problem. It takes constraints (battery discharge limits, State of Charge, available flexible loads, and permissible ramp rates) and outputs the optimal operational plan.

## Module 5: Grid-code Envelope (Network Twin)
Takes the operational plan from Module 4 and tests it on a simulated network model to ensure compliance with the Saudi Grid Code (e.g., Low Voltage Ride Through - LVRT, and Droop Control).

## Module 6: Twin UI / Dashboard
The interface that will dazzle the jury. It features a 3D map of the plant, forecast status, deficit amount, battery state, curtailed loads, and the final simulation outcome before physical execution.

# 7. Detailed Operational Scenario (For the Pitch)

To clearly demonstrate the idea to the jury using realistic numbers, we use the following precise scenario:

**Normal State:**
- Actual plant production: 3000 MW.
- Available battery capacity: 500 MW.
- All loads operating normally.

**Problem Occurs (Hazard Detection):**
- NAJM-3000 receives an update: A severe dust wave will hit the plant in 15 minutes.
- Modules 1 and 3 calculate the impact: Production will drop by 60% over 10 minutes.
- Expected loss = 1800 MW.

**Normal Intervention (Without NAJM-3000):**
- Production plummets suddenly.
- The battery tries to compensate but discharges too quickly or is mismanaged, violating the allowed ramp rate.
- An alarm triggers at the National Grid control center indicating a massive sudden drop (1800 MW). The operator is forced to fire up backup gas turbines—a very expensive and slow process, risking critical frequency dips.

**Smart Intervention (With NAJM-3000):**
1. 15 minutes before the event, the system simulates and identifies the upcoming deficit.
2. It schedules the battery (500 MW) to smooth the drop (Ramp-rate limiting) rather than discharging blindly.
3. It scans for flexible loads, finds idle EV chargers and non-critical building loads, and temporarily disconnects them to save 100 MW.
4. It sends an instant message to the grid: "In 15 minutes, we will lose 1800 MW. We have compensated 600 MW locally via battery and load shedding. Please prepare to cover a residual deficit of exactly 1200 MW."
5. The storm passes safely, frequency stability is excellent, the system recharges the battery, and reconnects the loads.

# 8. Comparison with the Research Brief and Other Ideas

Reviewing the Energy Hackathon 2026 Research Brief, we see several proposed ideas. The updated NAJM-3000 outperforms them all for the following reasons:

- **Compared to Idea 1 (Original NAJM-3000 Grid Twin):**
  The previous version relied solely on generation and battery planning. It was strong, but a 500 MW battery often cannot cover a massive drop. The current version adds a new weapon: Load Management. This transforms it from a system solving half the problem (Supply) into an integrated system solving both Supply and Demand.

- **Compared to Idea 5 (Surplus-to-Value):**
  The brief suggested load management during *Surplus* times (when the sun is shining and demand is low), like running desalination plants. Our idea utilizes load management during *Deficit* and emergency times (dust and clouds), which provides vastly higher value for instantaneous grid stability and frequency protection.

- **Overcoming Cybersecurity Challenges:**
  The brief noted that load control might raise security concerns because it connects the operator to consumers. Our solution smartly bypasses this: we do not control residential homes. We control large, semi-independent loads connected to the plant or local grid (like idle EV chargers identified by usage data). This minimizes the cyber-risk scope, keeping it contained and acceptable.

# 9. Why Will This Idea Win?

This idea is engineered to win because it is:
1. **Realistic:** It does not claim to solve a 1800 MW drop with a 500 MW battery. It acknowledges physics, respects limits, and extracts maximum efficiency from available resources.
2. **Proactive:** The magic phrase for the jury is: "We test the problem inside the digital twin and solve it before it happens in reality."
3. **Code Compliant:** Our focus on the Saudi Grid Code (voltage, frequency, ramp rate) proves to the technical judges that we understand the real industry, not just coding.
4. **Innovative & Dual-Impact:** Merging BESS with Smart Load fulfills the challenges of both Track 1 and Track 3 in the Hackathon.

# 10. Hackathon Execution Plan (MVP)

To build a presentable prototype during the short hackathon period (MVP):
- We will not build a full AI that reads from real sensors; we will use historical data and simulation.
- We will program 3 pre-set weather scenarios (Normal, Moderate Dust, Sudden Dense Cloud).
- We will code the optimization algorithm (using a Python library like PuLP or SciPy) to dispatch battery power and make load-shedding decisions.
- The Front-End UI will be the hero: an interactive dashboard showing pre- and post-intervention graphs.
- The Comparison: We will show a split-screen; one side shows grid collapse without NAJM, the other shows stability thanks to NAJM.

# 11. FAQ for the Team

**Q: What if the jury asks: "Your battery is 500 MW, the drop is 1800 MW, how can you claim your system protects the grid?"**
A: This is the core of our realism. Any system claiming to cover 1800 with a 500 battery is lying. Our system protects the grid in two ways: First, it sheds non-essential loads to reduce the deficit. Second, it regulates the 500 MW discharge to cushion the "shock" (Ramp Rate) and gives an accurate, early warning to the grid about the remaining 1200 MW so they can spin up reserves in time.

**Q: Where do we get the data for non-essential loads?**
A: In reality, this comes from smart meters tied to the plant's SCADA or local provider. For the hackathon, we will mock this using synthetic data representing an EV charging station and project facility buildings.

**Q: Does intervening in loads compromise user comfort?**
A: No, because we apply a filtering algorithm. The system checks the "last 3 days" of consumption. If a charger is idle, disconnecting it harms no one. If we must reduce AC, it is by 1 degree for max 20 minutes (the duration of a fast cloud/dust passage), which humans won't notice due to the building's thermal inertia.

**Q: Why use LightGBM specifically?**
A: Because it is exceptionally fast and accurate for Tabular Data, perfectly blending field measurements with weather forecasts to produce highly reliable uncertainty scenarios.

---

This document represents the official reference for the NAJM-3000 team and forms the foundation for all technical and commercial pitches to the judging panels.

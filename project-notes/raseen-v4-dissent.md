# Raseen (then NAJM-3000) v4 — constructive dissent pass

Produced 14 Sep 2026 by running the Cortex `constructive-dissent` skill at **Rigorous** intensity
against the v4 team document. Rigorous = attack the premises, not just the
methods; justified by the stakes (registration closes 16 Sep, jury pitch 9 Oct).

Findings are ordered by severity and tagged by deadline. Nothing here says the concept is wrong —
the physics and the Grid Code mapping are the strongest parts of the document and survive the pass
intact. The attacks land on what is *missing* and on what the document concedes too cheaply.

**Status after v4.1 (14 Sep, renamed Raseen):** F1, F2, F10, F11 and A3 are done in the v4.1 team
document and explainer. F3–F9, A1 and A2 remain open — see the README's "Open items".

---

## Before 15 September (idea file)

### F1 — The entrepreneurship criterion is scored and unanswered · severity: high · DONE in v4.1

The FAQ names four aims: Innovation, Entrepreneurship, Application, Integration. The document is
exceptional on Application and Integration, strong on Innovation, and **silent on Entrepreneurship**.
There is no customer, no business model, no revenue line, no market size. The prize package includes
post-hackathon entrepreneurship enablement, which signals a jury that weights this.

This is the cheapest scoring gain available and it is a paragraph, not a work package:

- **Who buys** — the IPP or its O&M provider, at plants above ~500 MW; secondarily the developers
  bidding NREP rounds, who need declarable ramp behaviour at financial close rather than after
  commissioning.
- **How sold** — annual software licence per plant, or a share of the System Service revenue under
  SAGC 2.14.1. Note which one and why.
- **Why now** — Grid Code May 2026 created the instruction set (Gradient, Delta, H-1 Declarations);
  the 50 %-by-2030 target creates the plants. Neither existed together before 2026.
- **Market** — number of Saudi PV plants above the threshold now and by 2030 × licence. Use the
  Kingdom's own published pipeline; do not invent a TAM.

**Assumption being challenged:** that technical merit alone is scored. The rubric says otherwise.

### F2 — The Arabic idea file reads closer to a kill sentence than the English · severity: medium · DONE in v4.1

English discipline is tight: *impact* nowcast, forecast-as-input, repeated in §0, §1, §3.3, §10.
The Arabic الحل paragraph opened with «يحسب زمن وصول السحابة ومغادرتها لكل كتلة» — computes each
block's cloud arrival and departure. An Arabic-only reader met "we compute when the cloud arrives"
before meeting «التوقع مُدخل», which sat down in «ما لا يفعله». The disclaimer arrived after the
impression had formed.

Fix: move the input framing into the first clause of الحل, and carry the pitch sentence
«لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي» into the idea file itself, not only the deck. Jurors at
KAPSARC will read the Arabic.

### F3 — "Same spill as plant-level control" is conceded before it is tested · severity: high · OPEN

§3.3 and jury answer 2 concede that BGC spills exactly what a plant-level pre-ramp spills. The
concession is honest and relation (4) supports it — **for a perfectly forecast, straight, uniform
front.** §16 then admits real shadow fields are ragged.

Under a ragged field the proportional plant-level rule drives some blocks below their post-event
floor while others cap at available. The allocation becomes infeasible, and the plant either misses
the declared line or over-curtails. That is an energy and compliance difference, and it is exactly
what BGC's caps and water-filling prevent.

The document asserts the neutrality globally and never runs the case where it breaks. After the
concession, the remaining pitch is "firmness, precision, reactive migration, sensing" — four
abstractions. One number would replace all four.

**Action:** add shadow field D3 (scattered cumulus) to `raseen_bgc_sim.py` and run both controllers
(with a PPC feedback delay for the plant-level rule). Report tracking error against the declared line
and any extra spill. If the delta is zero, the concession stands and you have proof; if it is not, you
have recovered the headline claim.

---

## Before 7 October (camp)

### F4 — The benefit side of the economics is never priced · severity: high · OPEN

§5.3 prices the *cost* of Raseen (spilled sunshine) against the *cost* of a battery. It never prices
what Raseen delivers. The Rolling Solar Reserve is the thing a plant-level controller cannot produce,
it maps to a paid System Service, and it has no SAR figure anywhere in the document.

Without it, jury answer 3 compares two costs and invites "so your product is a cheaper way to lose
money". With it, the comparison becomes cost versus revenue.

The input needed: what the TSO pays per MW of contingency reserve, or failing a public tariff, the
avoided cost of the thermal capacity the reserve displaces. SAGC 4.41.15 already says part of the
reserve is bought against weather uncertainty — that is the budget line Raseen shrinks.

### F5 — The optimal gradient is an expected-value problem the document sets up and drops · severity: medium · OPEN

Every ingredient is present and never assembled. Table 5.1 gives shaping spill and pre-contact spill
per gradient. §5.1 cites the DLR 13 % false-positive rate. Nothing combines them.

  E[cost(g)] = events/yr × [ shaping spill(g) + P(false) × pre-contact spill(g) ] − reserve value(g)

Minimise over g and the declared gradient stops being a table row and becomes a result. This is the
single most defensible piece of analysis available to you, it needs no new code beyond a loop over
the existing table, and it converts jury answer 4 from anecdote to arithmetic.

### F6 — σ, κ, Hʳ are magic numbers · severity: medium · OPEN

σ ≈ 3 min, κ ≈ 0.25, Hʳ = 5 min appear with "tunable" and no derivation. A jury with a control
engineer on it will ask, and "tunable" reads as "unvalidated".

Fix: one sensitivity sweep. Show the KPIs are flat across a range of each. A flat surface says the
design is robust; a knife-edge says it isn't, which you would also want to know before 7 October.

### F7 — Novelty claim 1 is the exposed one · severity: medium · OPEN

Claims 2, 3 and 4 (the g = D/(τ+L) contract, the declarable R(t,Hʳ) mapped to Saudi clauses,
pre-commissioning delivery) are defensible — clause-level regulatory mapping is jurisdiction-specific
and unlikely to be pre-empted. Claim 1, spatial allocation of curtailment inside a plant, is the one
that could already exist under other names: zonal or cluster curtailment, spatially-resolved plant
control, cloud-aware dispatch. The GE patent cited is the uniform case; a non-uniform variant may be
findable.

"To our knowledge" is already in the text, which is correct practice. Spend two hours searching those
specific phrasings anyway. Discovering prior art yourself and citing it is a strength; being handed it
by a juror is not.

### F8 — Everything is simulated, and the honest answer to that is currently weak · severity: medium · PARTLY DONE

Jury answer 11 — "the plant is a stand-in until a developer gives us theirs" — is honest and flat.
Two things strengthen it without overclaiming:

- Lead with the fact that the *irradiance* is real. RRAtlas 1-minute measured data driving the shadow
  fields is not synthetic, and saying so early changes how the rest of the evidence is heard.
  (Now in jury answer 11 of v4.1.)
- Between now and 7 October, a letter of interest from one IPP or NREP developer would move both the
  Application and Entrepreneurship scores at once. Ambitious in three weeks, and the highest-value
  non-technical action on the list.

### F9 — WP3 sits on the critical path behind WP2 · severity: medium · OPEN

WP3 (planner + BGC, 6 days, the core) depends on WP1 and WP2. WP2 (nowcast, 5 days) is the least
predictable work in the plan — front tracking from lag correlation either works on the replay data or
needs iteration. If WP2 slips, WP3 cannot hit KPIs 1–6 and the demo has no core.

Fix: develop WP3 against **ground-truth ETAs emitted by the WP1 shadow generator** from day one, and
swap WP2's estimated ETAs in when they arrive. The two then proceed in parallel and a WP2 slip costs
nowcast accuracy (KPI 9) rather than the entire controller demonstration.

### F10 — Spec gap: ETA staleness between nowcast updates · severity: low · DONE in v4.1

N updates every minute; B runs every 10 s. At 48 km/h a minute is one full column. The document did
not say what B does with ETAs between updates. It now does (§7.3): ETAs are decremented
deterministically by the elapsed time using the last front speed and replaced when N delivers a new set.

### F11 — The 1–3 % reactive migration gain is asserted · severity: low · DONE in v4.1

§7.6 stated an expected active-power gain of 1–3 % with no derivation. It depends on the inverter
S-rating margin, the DC/AC ratio and the size of the Q order — all of which you have. v4.1 replaces the
number with the qualitative claim and assigns the derivation to WP3.

---

## Generated alternatives

### A1 — Lead with the reserve product, not the controller

**Approach:** reframe the headline from "a controller that shapes ramps" to "a new declarable reserve
product for gigawatt solar, and the controller that makes it real". BGC becomes the enabler of
R(t,Hʳ) rather than the claim itself.

**Advantages:** moves the innovation from control theory — where prior art is dense and F7 bites —
to the market and regulatory layer, where the Saudi clause mapping is genuinely yours. Answers the
entrepreneurship criterion structurally rather than with a bolted-on slide. Neutralises the §3.3
concession entirely, because nobody is claiming to spill less.

**Trade-offs:** requires F4's pricing to exist, or the product has no price. Also a larger edit than
two days allows for the idea file — but the *pitch* can be reframed by 7 October even if the
registration text is not.

### A2 — Cost the small battery you rejected

**Approach:** the document treats "no battery" as a premise. Invert it: price a token battery —
say 50 MW / 50 MWh, under 2 % of plant — solely as false-alarm insurance, since the pre-contact
spill (5–198 MWh) is exactly the exposure a small store would cover.

**Advantages:** converts "no battery" from a stance into a result. Jury answer 3 becomes "we costed
it at three scales and here is the crossover", which is a much harder answer to attack than a
principle. Also pre-empts the obvious hostile question from anyone who works in storage.

**Trade-offs:** an hour of analysis, and a risk that the number comes out favourable to the battery
at 2 %/min. That is worth knowing privately before a juror finds it publicly.

### A3 — Have the plant-cluster answer ready · DONE in v4.1

"Why inside one plant and not across the region's plants?" The answer exists in the document's own
logic — cross-plant coordination is TSP jurisdiction, each plant declares its own g, and the TSO
schedules the sum — and is now jury answer 13.

---

## Synthesis

**Strengthen the current proposal:** F1 and F2 before 15 September (done); F3 and F5 before the camp;
they are the two findings that convert conceded ground back into claims, and both run on code you
already have.

**Consider A1 if:** F4's pricing produces a credible number. Then the reframe is available for the
9 October pitch regardless of what the registration text says.

**Unresolved, needs information you do not have:** the SAR value of contingency reserve (F4); whether
claim 1 survives a prior-art search (F7); whether any developer contact is reachable before 7 October
(F8).

**What survived the pass untouched:** the physics in §2, the Grid Code mapping in §9, the kill-sentence
discipline in the English text, and the decision to concede relation (4) rather than hide it. The
document's honesty is its strongest rhetorical asset — F3 argues for testing the concession, not
withdrawing it.

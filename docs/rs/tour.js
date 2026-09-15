/* Guided tour — "Explain this page" in the top bar, on all three pages.

   One spotlight, one card. The spotlight is a fixed box whose box-shadow dims everything but
   the element under it, and its top, left, width and height are transitioned so it slides
   from one target to the next; the card sits beside it and flips sides to stay on screen.
   The steps are written against the page's real markup and looked up at step time: an
   element that is not there — a control the published build hides, a panel that only opens
   after Replay — is skipped and dropped from the count, not an error, so the tour never
   breaks when a page loses a piece.

   The copy keeps the house rules. Everything shown is simulated; the forecast is an input;
   headroom is sunshine deliberately not exported, and the blocks still in sun give back what
   they were holding. There is no battery anywhere in the mechanism and none in these words.

   A classic script on purpose: it has to attach to the top bar the moment sidebar.js has
   drawn it, on pages with and without a module graph, and the static build only rewrites
   src= and href= paths, not bare imports. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  //: Breathing room between a target's edge and the ring, the gap between the ring and the
  //  card, and how close to the viewport edge the card may come.
  const PAD = 6;
  const GAP = 12;
  const EDGE = 16;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /* Two frames, not one: the first commits the scroll and the new card content, the second
     is the first frame laid out with both, which is the one worth measuring. */
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const near = (a, b) => Math.abs(a - b) < 0.5;

  /** Resolve when `pred` returns something truthy, or give up after `timeout` ms. */
  async function waitFor(pred, timeout) {
    const until = performance.now() + timeout;
    while (performance.now() < until) {
      if (pred()) return true;
      await wait(80);
    }
    return !!pred();
  }

  /* A target is a selector or a function returning an element. It only counts if it is in
     the document and takes up space: a `hidden` panel has no rects, an empty container has
     no height, and a ring drawn round either would point at nothing. */
  function resolve(target) {
    if (!target) return null;
    let el = null;
    try { el = typeof target === "function" ? target() : document.querySelector(target); } catch (e) { el = null; }
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  }

  /* Whichever panel an element sits in. The Plant page's panels carry no ids of their own,
     and pointing at a panel's one identified child would ring half of it. */
  const panelOf = (id, cls) => () => { const el = $(id); return el ? el.closest(cls) || el : null; };

  // ── the page's two views ────────────────────────────────────────────────
  /* The Plant page holds two views behind the hash, and the rail is the only control that
     changes it. The tour may change it too, because a tour of a view nobody can see would be
     nonsense — and it is the one thing the tour does to the page unasked. Returns whether
     the hash moved, so the caller knows to wait for the page to follow. */
  function showView(hash) {
    if (!$("sup-view") || !$("gc-view")) return false;
    const onGradient = location.hash === "#gradient";
    if (hash ? onGradient : !onGradient) return false;
    location.hash = hash;
    return true;
  }
  async function preparePlant() {
    if (showView("")) await nextFrame();
  }
  async function prepareGradient() {
    if (showView("#gradient")) await nextFrame();
    // The view mounts lazily and the scenario is fetched: wait for the plot to be drawn, up
    // to a few seconds, so the first targeted step has something to point at. If it never
    // comes the tour still runs, skipping what is not there.
    await waitFor(() => $("rs-gen") && $("rs-gen").querySelector("svg"), 6000);
  }

  /* Replay the event is what opens the briefing, so the tour presses it — the one page
     control the tour operates, and only while the briefing is closed. Playback stays paused:
     the briefing waits for Run the response, and the tour never presses that. */
  async function openBriefing() {
    const replay = $("rs-replay");
    if (!$("rs-brief") || resolve("#rs-brief") || !replay || replay.disabled) return;
    replay.click();
    await waitFor(() => resolve("#rs-brief"), 1500);
  }

  // ── the tours ───────────────────────────────────────────────────────────
  /* A step: { target, title, body, before?, present? }. `target` is a selector, a function
     or null (a card in the middle of the screen). `before` runs before the step is shown and
     may return a promise. `present` says whether the step should be counted at the start
     when its target is not yet visible — the briefing exists but is hidden until opened. */
  const TOURS = {
    kingdom: {
      steps: [
        { target: null, title: "The Kingdom page",
          body: "Every utility-scale renewable project announced in Saudi Arabia, and the 380 kV backbone between them, from public announcements. This tour walks the readout, the technology mix, the filters, the list and the map, and ends at the sources." },
        { target: ".rs-registry .rs-readout", title: "The readout bar",
          body: "The first cell is everything in the registry, in gigawatts, and the cells after it split that by status. The small square in front of each label is the ring colour that status has on the map." },
        { target: ".rs-mix", title: "Technology mix",
          body: "One bar read as a proportion, biggest technology first. The same colours fill the markers on the map." },
        { target: ".rs-filters", title: "Filters",
          body: "Untick a technology or a status and it leaves the list and the map together. The count in the Plants panel says how many projects are left." },
        { target: ".rs-fleet", title: "Plants",
          body: "Everything that passes the filters, largest first, with Humaij pinned to the top because it is the plant the rest of this dashboard is about. Search narrows by name or region. Select a plant to fly the map to it; select Humaij to open its page." },
        { target: ".rs-map-tools", title: "Map layers",
          body: "Plants, the grid schematic and the labels switch off one at a time. Fit Kingdom brings the whole country back into view after you have panned away." },
        { target: "#rs-kmap", title: "Where they are",
          body: "One marker per project, at its announced site. Hover a marker for the project behind it. The backbone is drawn as a schematic of the 380 kV network, not a survey of it." },
        { target: ".rs-map-key", title: "Reading a marker",
          body: "Fill is the technology, ring is the status. The outlined marker is Humaij, the modelled plant. The dashed line is the 380 kV backbone; in its second colour it is Humaij's own 110 kV evacuation." },
        { target: ".rs-foot", title: "Scale and sources",
          body: "For scale: the Kingdom's record peak load, the renewables running when it was set, the PV installed since, and the 2030 target — and what share of that peak Humaij alone would be, once built. Every figure on this page is traced to the source named here." },
        { target: null, title: "That is the Kingdom",
          body: "The rail on the left leads to the plant: Overview for what every MV block at Humaij is making across a simulated day, and Gradient control for what Raseen does when a cloud crosses it. Explain this page works on both." },
      ],
    },

    plant: {
      prepare: preparePlant,
      steps: [
        { target: null, title: "Plant overview",
          body: "Humaij as a supervisory desk: one simulated day, every MV block, and where the simulated meter and the model disagree. No meter has been read — the plant is modelled, not measured, and the model has not been calibrated against anything. The tour runs from the status bar to the provenance note at the foot." },
        { target: ".statusbar", title: "The status bar",
          body: "The plant, how many MV blocks are configured, how many alarms are active, and two flags that say what you are looking at: the data source reads SIM because every value is simulated, and the model reads uncalibrated because it has never been fitted to a real plant." },
        { target: ".timeline-panel", title: "The simulated day",
          body: "The day is a recording. Go live plays it, the arrows step one frame at a time, and the scrubber goes to any moment; the clock shows the simulated time of day." },
        { target: '.tile-row[aria-label="Plant readout"]', title: "The readout",
          body: "Plant AC power, plane-of-array irradiance and module temperature at the current moment, then two comparisons: the simulated measurement against what the model expects, as a percentage, and the performance ratio, measured over expected." },
        { target: panelOf("plant-grid", ".panel"), title: "Blocks",
          body: "Each cell is one MV block, shaded by its AC output; Deviation recolours them by how far each is from the model. Satellite lays the same blocks over the site. Select a block and the panels below fill with it." },
        { target: panelOf("block-detail", ".panel"), title: "Block detail",
          body: "The selected block's own readings: its configuration, irradiance and temperatures, tracker angle, and power at each stage from the inverter's DC input to the block's AC output. All of it simulated, as the note says." },
        { target: panelOf("alarm-log", ".panel"), title: "Alarms and events",
          body: "Active plant events, newest first, with the count in the badge. A fault injected in the station model below appears here." },
        { target: panelOf("diag-body", ".panel"), title: "Deviation analysis",
          body: "For the selected block, a finding on why measured and expected disagree, with a confidence and the basis it rests on; when nothing is wrong it says so. It is attribution over simulated signals, and the basis line always names what the finding was read from." },
        { target: "#model-viewer", title: "Station model",
          body: "A 3D model of the selected block's station. It is a large file and loads in the background after the rest of the page, so it may still be arriving." },
        { target: ".model-controls", title: "Fault injection",
          body: "Choose an asset and a fault, and Inject fault puts that fault on the station. It then shows in the alarm log and in the deviation analysis. Clear all removes every injected fault; Fit all reframes the model." },
        { target: panelOf("chart-power", ".panel"), title: "Trends",
          body: "Irradiance, temperature and inverter power for the selected block across the simulated day, each on its own scale. The power chart draws expected against measured, which is where the deviation tile above comes from." },
        { target: panelOf("wx-ghi", ".panel"), title: "Weather input",
          body: "The weather the simulation was driven with: global and plane-of-array irradiance, ambient temperature and wind speed. The note says how the source is classified — it is an input, not a measurement." },
        { target: ".footnote", title: "Provenance",
          body: "The footnote states what this page is: the disclaimer that covers every value on it, and how the block count was arrived at. Read it before quoting a number." },
        { target: null, title: "That is the overview",
          body: "Gradient control, in the rail, is the other view of this plant: a cloud crossing it block by block, and what Raseen does about it. Explain this page works there too." },
      ],
    },

    gradient: {
      prepare: prepareGradient,
      steps: [
        { target: null, title: "Gradient control",
          body: "A cloud crosses Humaij. Raseen holds power back on the blocks still in sun and lets it go as the cloud lands on the others, so export follows a declared ramp instead of the sun. Everything on the page is simulated. The tour follows the page from the plot at the top to the numbers at the bottom." },
        { target: "#rs-gen", title: "Power at the connection point",
          body: "Amber is what the sun offers, teal is export under Raseen, grey is one plant-level set-point, and the dashed line is the ramp the plant declared. The shaded band between available and export is held headroom: sunshine deliberately not exported, so the blocks still in sun can give it back when the cloud lands." },
        { target: "#rs-ctl", title: "Plant-level or Raseen",
          body: "Plant-level is the state of the art: one set-point for the whole plant. Raseen dispatches the <b>30</b> control blocks separately. The plot, the readout and every number below follow whichever is selected." },
        { target: "#rs-transport", title: "Replay",
          body: "Play runs the event, the minute buttons step it, and the scrubber goes anywhere; space and the arrow keys do the same. The marks say when the ramp starts, how long the crossing lasts and when the cloud clears." },
        { target: "#rs-speed", title: "Speed",
          body: "Simulated seconds per real second. Real time is what an operator would sit through; <b>×10</b> is the default, so a two-hour event plays in minutes. The choice is remembered in this browser." },
        { target: "#rs-replay", title: "Replay the event",
          body: "The guided run. It jumps to a few minutes before the response has to start, opens a briefing with the forecast and the suggested response, and waits. Play on its own never opens the briefing." },
        { target: "#rs-brief", before: openBriefing, present: () => !!$("rs-brief"), title: "The briefing",
          body: "The forecast in the scenario's own numbers: what kind of cloud, how fast, when it reaches the fence, how many blocks and stations it will reach and how much power it takes at full cover, then the suggested response. Run the response starts playback; Dismiss closes it." },
        { target: "#rs-events", title: "The event log",
          body: "Every notice the run will raise, in order: forecast, response, contact, full cover, clearing and the end, plus a stall or a deepening when the case has one. Past events dim, the current one is bright, future ones are muted. Each is derived from the scenario, never invented." },
        { target: "#rs-readout", title: "The readout strip",
          body: "Right now: what the sun offers, what is exported, how much is held back and how much of that can still be spent, how many blocks are in full sun, and the line the plant declared. The colour square in front of each label is that quantity's colour in the plot." },
        { target: panelOf("rs-say", ".rs-panel"), title: "The balance sentence",
          body: "The mechanism, measured over the last minute: what the cloud took off the blocks it reached, what the blocks still in sun put back, and how far export moved. When export falls less than the sun does, the bar splits the loss into what was absorbed inside the plant and what the connection point saw." },
        { target: "#rs-map", title: "The plant, block by block",
          body: "Every control block on the as-designed layout, coloured by the current frame. Hover a block for its numbers; select one and the chart below picks it out." },
        { target: "#rs-map-modes", title: "Colouring the blocks",
          body: "Output shades each block by its set-point as a share of capacity. Headroom shows what is held on it, and whether the cloud will arrive before it can be spent. Cloud arrival shows the minutes until the front reaches it." },
        { target: "#rs-cloud", title: "The cloud",
          body: "Speed, size, position and direction shape the front; the kind of cloud, the power it takes at full cover and the softness of its edge finish it. Every change re-runs the whole plant. On the published build the sliders step between pre-computed clouds, one axis at a time." },
        { target: "#rs-response", title: "The response",
          body: "The declared down-gradient is the ramp the plant promises the grid; confidence in the forecast sets how much extra it holds back in case the forecast is wrong. Under them, what the choice implies: crossing time, the lead the ramp needs, power lost at full cover, and the reserve that confidence buys." },
        { target: "#rs-strategy", title: "Strategy",
          body: "Declared ramp brings export down at the declared gradient and holds headroom on the blocks the cloud reaches last, where it can still be spent. Pre-hold and backfill holds every block down evenly ahead of the front; when the cloud lands, the blocks still in sun raise their output and export stays flat. Nothing is stored either way — the blocks in sun give back what they were holding." },
        { target: () => { const el = $("rs-stall"); return el ? el.closest(".rs-btn-row") || el : null; }, title: "Breaking the forecast",
          body: "Two ways to make the forecast wrong at the current moment. Stall freezes the front where it is; Raseen releases curtailment nearest-first after a two-minute confirmation and logs the energy spilled while waiting as the cost of the false alarm. Deepen makes the cloud take <b>20 %</b> more than forecast, and the reserve absorbs it if it can." },
        { target: "#rs-situation-panel", title: "Situations",
          body: "Prepared cases for what a slider cannot express: a different kind of cloud, a gentler or steeper ramp, a front that stalls or deepens, a band over the middle of the plant. Loading one sets every control to match." },
        { target: "#rs-blocks", title: "Set-point of every station",
          body: "One bar per station, grouped under its control block, in the order the cloud arrives. Teal is the set-point, the amber line is what the sun offers, and the stack between them is headroom: solid where it can still be spent, faded where the cloud arrives before it can be. A triangle marks a block raising its output right now." },
        { target: "#rs-grain", title: "Stations or blocks",
          body: "<b>363</b> MV power stations sit in <b>30</b> control blocks. The controller dispatches blocks, so the stations in a block share its set-point; Blocks collapses the chart to the thirty the controller actually moves." },
        { target: "#rs-kpis", title: "How the event ends",
          body: "What a grid operator would ask: the steepest ten-minute drop and the steepest fall per minute, each against the uncontrolled plant; the reserve held at contact; the energy not exported and its share of a clear day; what was curtailed on blocks already under the cloud; and what that energy was worth." },
        { target: "#rs-ramp", title: "Steepest fall",
          body: "Left uncontrolled, the plant follows the sun down at the rate on the left. Under Raseen the fall is the declared gradient on the right. The note says what that promise costs in lead time before the cloud arrives." },
        { target: null, title: "That is the page",
          body: "Press Replay the event to watch the run with its briefing, or move a slider and watch the whole plant re-run. All of it is simulated: the geometry is as designed, the forecast is an input, and no meter has been read." },
      ],
    },
  };

  /* Which tour a page gets when none is named. The standalone /control route is the gradient
     page; the Plant page is whichever of its two views the hash shows; everything else,
     including the static build's index.html, is the Kingdom. */
  function defaultTour() {
    const p = location.pathname.toLowerCase();
    if (p.includes("control")) return "gradient";
    if (p.includes("plant")) return location.hash === "#gradient" ? "gradient" : "plant";
    return "kingdom";
  }

  // ── state and the overlay ───────────────────────────────────────────────
  const state = {
    steps: [], i: 0, el: null, rect: null, vw: 0, vh: 0,
    root: null, spot: null, card: null, opener: null, busy: false, ticking: false,
  };
  let startToken = 0;

  function build() {
    const root = document.createElement("div");
    root.className = "rs-tour";
    root.hidden = true;
    root.innerHTML =
      '<div class="rs-tour-spot is-void"></div>' +
      '<div class="rs-tour-card" role="dialog" aria-modal="true" aria-labelledby="rs-tour-title" aria-describedby="rs-tour-body">' +
        '<div aria-live="polite" aria-atomic="true">' +
          '<div class="rs-tour-head"><h3 class="rs-tour-title" id="rs-tour-title"></h3><span class="rs-tour-step" id="rs-tour-step"></span></div>' +
          '<p class="rs-tour-body" id="rs-tour-body"></p>' +
        "</div>" +
        '<div class="rs-tour-foot">' +
          '<button type="button" class="rs-tour-btn quiet" data-act="skip">Skip tour</button>' +
          '<span class="rs-tour-spacer"></span>' +
          '<button type="button" class="rs-tour-btn" data-act="prev">Previous</button>' +
          '<button type="button" class="rs-tour-btn primary" data-act="next">Next</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    state.root = root;
    state.spot = root.querySelector(".rs-tour-spot");
    state.card = root.querySelector(".rs-tour-card");
  }

  // ── placing the spotlight and the card ──────────────────────────────────
  function placeSpot(rect) {
    const sp = state.spot;
    sp.classList.toggle("is-void", !rect);
    const r = rect || { top: innerHeight / 2, left: innerWidth / 2, width: 0, height: 0 };
    sp.style.top = `${r.top}px`; sp.style.left = `${r.left}px`;
    sp.style.width = `${r.width}px`; sp.style.height = `${r.height}px`;
  }

  /* Below the target, then above, then right, then left — the first side the card fits on.
     Wide panels want the card under them; a segment in a panel head wants it there too, and
     the two short sides are for a tall map on a short screen. If no side fits, the side with
     the most room takes it and the card overlaps the ring rather than leave the screen. */
  function placeCard(rect) {
    const c = state.card, cw = c.offsetWidth, ch = c.offsetHeight, W = innerWidth, H = innerHeight;
    const clampX = (x) => Math.max(EDGE, Math.min(W - cw - EDGE, x));
    const clampY = (y) => Math.max(EDGE, Math.min(H - ch - EDGE, y));
    let top, left;
    if (!rect) {
      top = (H - ch) / 2; left = (W - cw) / 2;
    } else {
      const bottom = rect.top + rect.height, right = rect.left + rect.width;
      const cx = rect.left + rect.width / 2 - cw / 2, cy = rect.top + rect.height / 2 - ch / 2;
      const sides = [
        { top: bottom + GAP, left: clampX(cx), fits: bottom + GAP + ch <= H - EDGE, room: H - bottom },
        { top: rect.top - GAP - ch, left: clampX(cx), fits: rect.top - GAP - ch >= EDGE, room: rect.top },
        { top: clampY(cy), left: right + GAP, fits: right + GAP + cw <= W - EDGE, room: W - right },
        { top: clampY(cy), left: rect.left - GAP - cw, fits: rect.left - GAP - cw >= EDGE, room: rect.left },
      ];
      const pick = sides.find((s) => s.fits) || sides.reduce((a, b) => (b.room > a.room ? b : a));
      top = clampY(pick.top); left = clampX(pick.left);
    }
    c.style.top = `${Math.round(top)}px`; c.style.left = `${Math.round(left)}px`;
  }

  /* `animate` is the step change, where the ring slides. Anything else — a scroll, a resize —
     snaps, because the target has moved with the page and the ring must stay on it. A snap
     whose measurement matches the last one is dropped: the page's own scroll event, fired by
     scrolling the target into view, would otherwise land mid-slide and cut it short. */
  function measure(animate) {
    const s = state.steps[state.i];
    if (!s || !state.root) return;
    let el = state.el;
    if (el && !resolve(() => el)) el = state.el = resolve(s.target);
    let rect = null;
    if (el) {
      const r = el.getBoundingClientRect();
      rect = { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
    }
    if (!animate && state.vw === innerWidth && state.vh === innerHeight) {
      const same = rect && state.rect
        ? ["top", "left", "width", "height"].every((k) => near(rect[k], state.rect[k]))
        : rect === state.rect;
      if (same) return;
    }
    state.rect = rect; state.vw = innerWidth; state.vh = innerHeight;
    if (!animate) state.root.classList.add("is-snap");
    placeSpot(rect);
    placeCard(rect);
    if (!animate) { void state.root.offsetWidth; state.root.classList.remove("is-snap"); }
  }

  function onMove() {
    if (state.ticking || !state.root) return;
    state.ticking = true;
    requestAnimationFrame(() => { state.ticking = false; measure(false); });
  }

  // ── stepping ────────────────────────────────────────────────────────────
  async function show(s, el) {
    const n = state.steps.length, i = state.i;
    $("rs-tour-title").textContent = s.title;
    $("rs-tour-body").innerHTML = s.body;
    $("rs-tour-step").textContent = `Step ${i + 1} of ${n}`;
    const prev = state.card.querySelector('[data-act="prev"]');
    const next = state.card.querySelector('[data-act="next"]');
    prev.disabled = i === 0;
    next.textContent = i === n - 1 ? "Done" : "Next";
    state.root.hidden = false;
    // Instant, not smooth: the page jumps and the ring slides to the target, one motion, not
    // two racing each other.
    if (el) el.scrollIntoView({ block: "center", inline: "nearest" });
    measure(true);
    // Focus stays where it was inside the card unless that button has just been disabled or
    // focus was never in the card; then the way forward gets it.
    const a = document.activeElement;
    if (!a || !state.card.contains(a) || a.disabled) next.focus({ preventScroll: true });
    await nextFrame();
    measure(false);
  }

  /* Move to step `i`, travelling in direction `dir`. A step whose target is missing is
     dropped from the list and the walk continues the same way, so the count on the card
     stays honest. Walking off the end is the end; walking off the start stays put. */
  async function go(i, dir) {
    if (state.busy || !state.root) return;
    state.busy = true;
    try {
      while (i >= 0 && i < state.steps.length) {
        const s = state.steps[i];
        if (s.before) { try { await s.before(); } catch (e) { /* a hook must not strand the tour */ } }
        if (!state.root) return;
        const el = s.target ? resolve(s.target) : null;
        if (s.target && !el) { state.steps.splice(i, 1); if (dir < 0) i -= 1; continue; }
        state.i = i; state.el = el;
        await show(s, el);
        return;
      }
      if (i >= state.steps.length) stop();
    } finally {
      state.busy = false;
    }
  }

  function step(dir) {
    if (state.busy || !state.root) return;
    if (dir > 0 && state.i >= state.steps.length - 1) { stop(); return; }
    if (dir < 0 && state.i <= 0) return;
    go(state.i + dir, dir);
  }

  // ── input ───────────────────────────────────────────────────────────────
  function onClick(e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;   // the dim itself does nothing; Esc and Skip tour are the ways out
    const act = btn.dataset.act;
    if (act === "next") step(1);
    else if (act === "prev") step(-1);
    else if (act === "skip") stop();
  }

  /* Tab cycles inside the card. Focus that has escaped — a click on the dim lands on the body
     — comes back in at whichever end the key was heading for. */
  function trap(e) {
    const items = [...state.card.querySelectorAll("button:not(:disabled)")];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], a = document.activeElement;
    const inside = state.card.contains(a);
    if (e.shiftKey && (!inside || a === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || a === last)) { e.preventDefault(); first.focus(); }
  }

  function onKey(e) {
    if (!state.root) return;
    if (e.key === "Escape") { e.preventDefault(); stop(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "Tab") trap(e);
    // Nothing underneath should hear a key while the tour is up: the gradient page seeks on
    // the arrow keys and toggles playback on the space bar. Buttons still get their default
    // activation, which is not a listener.
    e.stopPropagation();
  }

  // ── start and stop ──────────────────────────────────────────────────────
  async function start(name) {
    const key = name || defaultTour();
    const tour = TOURS[key];
    if (!tour) return;
    stop();
    const token = ++startToken;
    state.opener = $("rs-explain") || document.activeElement;
    // Bring the right view up before anything is counted: on the Plant page half the targets
    // do not exist until their view is shown and mounted.
    if (tour.prepare) { try { await tour.prepare(); } catch (e) { /* run with what is there */ } }
    if (token !== startToken) return;   // started again while waiting; the later call wins
    state.steps = tour.steps.filter((s) => !s.target || (s.present ? s.present() : !!resolve(s.target)));
    state.i = 0; state.el = null; state.rect = null; state.vw = 0; state.vh = 0;
    build();
    document.addEventListener("keydown", onKey, true);
    addEventListener("scroll", onMove, { passive: true, capture: true });
    addEventListener("resize", onMove, { passive: true });
    go(0, 1);
  }

  function stop() {
    if (!state.root) return;
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("scroll", onMove, true);
    removeEventListener("resize", onMove);
    state.root.remove();
    const opener = state.opener;
    Object.assign(state, { steps: [], i: 0, el: null, rect: null, root: null, spot: null, card: null, opener: null, busy: false, ticking: false });
    // Focus goes back to the button that opened the tour, so a keyboard user is where they
    // were before it started.
    const back = opener && opener.isConnected ? opener : $("rs-explain");
    if (back && back.focus) back.focus({ preventScroll: true });
  }

  const bind = () => { const b = $("rs-explain"); if (b) b.addEventListener("click", () => start()); };
  if ($("rs-explain")) bind(); else document.addEventListener("DOMContentLoaded", bind);

  window.RaseenTour = { start, stop };
})();

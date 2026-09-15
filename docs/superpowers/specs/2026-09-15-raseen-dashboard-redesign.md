# Raseen dashboard — redesign spec (15 Sep 2026)

The single source of truth for this pass. Every page must end up looking like it came out of
the same studio on the same day.

## What we are designing

A grid control desk for a 3 000 MW solar plant. The audience is a grid operator and an
engineering jury. The job of the dashboard is to show that when a cloud crosses the plant,
Raseen holds export on a declared ramp instead of letting it fall with the sun — and to show
the mechanism that does it.

Design it like an **instrument**, not a document and not a SaaS product page.

## Fixed decisions (do not relitigate)

- Stack: vanilla HTML, ES modules, hand-written CSS. No frameworks, no build step, no
  `package.json`. Charts are hand-rolled inline SVG.
- Every colour, radius, font and spacing value comes from a token in `raseen/web/shell.css`.
  Do not introduce a new hex literal in a page stylesheet; if you need a colour that is not
  there, say so rather than inventing one locally.
- Type: **IBM Plex Sans** for language, **IBM Plex Mono** for every number (tabular figures),
  **IBM Plex Sans Arabic** for Arabic. All three are already in each page's font request.
- Sage (`--pb-green`, `--pb-deep`, `--pb-header`) is **structure only**: rail, header,
  active state, focus ring. It never encodes a measurement.
- The data plane is a small fixed set, one colour per physical quantity, and it is the same
  on every page and in every chart:

  | token | quantity |
  |---|---|
  | `--amber` `#bf8a1f` | available power — what the sun offers |
  | `--accent` `#1f8a84` | export at the connection point under Raseen |
  | `--violet` `#5b7c99` | held headroom / firm reserve |
  | `--violet-dim` `#b3c6d4` | headroom that expires before it can be used |
  | `--rust` `#c0553f` | uncontrolled — what the sun does unaided |
  | `--muted` `#7c9088` | plant-level (the state of the art we are beating) |
  | `--ramp-0…5` | sage ramp, only for map/grid choropleths |

## House style — what to stop doing

These are the specific tells in the current build. Remove them everywhere.

1. **No tracked-out ALL-CAPS micro-labels.** `text-transform: uppercase` +
   `letter-spacing` on tile labels reads as template chrome. Sentence case, IBM Plex Sans,
   `--rs-text-2`.
2. **No middle-dot meta strings.** `"MW · simulated"`, `"geometry as-designed · values
   simulated"`. The simulation state is a property of the whole page: it is stated once, in
   the top bar and the rail foot, and nowhere else. A unit is just a unit.
3. **No identical floating cards.** Panels sit flat on the desk: 1px `--pb-border`, radius
   `--rs-radius`, **no shadow**. Only tooltips and the splash are allowed to float.
4. **No decorative gradients.** The banner gradient is gone; the header is one flat field.
5. **No dead chrome.** The fake `in / f / @` social icons are deleted. If a control does
   nothing, it does not exist.
6. **No numbered markers** (01 / 02 / 03) unless the content really is a sequence. The event
   timeline (T−L, T0, τ, exit) genuinely is one; nothing else is.
7. **No repeated headers.** The top bar carries the brand and the plant identity. A page
   head carries the page's own title once. Never both.

## Layout grammar

Every page is: fixed top bar (56px) → fixed left rail (216px) → page head → body.

- `.rs-topbar` — page title (21px/600) and a one-line subtitle in plain language. Right side
  holds only live state (a clock, a phase).
- `.rs-panel` — an instrument face. `.rs-panel-head h2` is 13.5px/600 sentence case.
- **Readout strip** — the replacement for a row of KPI cards. One panel, cells divided by
  hairlines, no gaps between them: an instrument bar, not six floating boxes. Each cell is
  `key` (13px sans, `--rs-text-2`) / `value` (mono, tabular) / `unit` (11.5px muted), with an
  8px colour key square in front of the label matching the chart series. That colour key
  replaces the separate chart legend.
- The most-used control is never at the bottom of a scroll.

## Motion

Exactly one non-interactive moment on the site: the opening title card (`splash.js`), once
per session — the mark arrives, holds ~0.7 s, fades out in ~0.24 s. Everything else moves
only in answer to a click or a drag. No section fade-ins, no hover lifts on cards.
`prefers-reduced-motion` is respected everywhere.

## Navigation

Three destinations, three controls, in the rail only:

```
◎ Kingdom
  Plant — Humaij          (a heading, not a button)
  ▦ Overview              → plant           / plant.html
  ◐ Gradient control      → plant#gradient  / plant.html#gradient
```

The Plant page's in-page `Supervisory | Gradient Control` tab strip is **deleted**. The page
switches view on `hashchange` and on load, driven by the rail. The standalone `/control`
route still exists and the Gradient control item owns it.

## Copy

Plain, active, sentence case. Name things as an operator would. Keep the honesty rules: the
plant is never described as operational, the model never as calibrated or validated, the
forecast is an input and not a product, and headroom is **not** storage — never write "we
store energy", "virtual battery" as a claim, "AI predicts clouds", or "no energy is lost".
"Held headroom", "firm reserve", "released to cover the loss" are the right words.

## Accessibility floor

- Body text ≥ 4.5:1 on its background; large numbers ≥ 3:1. Check any pairing you change.
- Visible keyboard focus (`:focus-visible` ring is defined in shell.css — do not remove it).
- Every control reachable by keyboard; segmented controls are real `<button>`s.
- Works down to 400px: the rail collapses to 60px icons, grids fall to one column.

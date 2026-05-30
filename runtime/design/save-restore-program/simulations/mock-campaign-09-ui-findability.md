# Mock Campaign 09 — UI findability after visual pass (run #14, WS-G)

**Owner:** Playtest-Readiness Program Lead
**Created:** 2026-05-30 (run #14)
**Status:** SHIPPED green
**Scope:** WS-G UI-iteration safety — verify that the run #14 CSS
foundation pass (`tokens.css.ts` extensions, `:focus-visible`,
button reset, radii unification, landing hero) did NOT make any
critical playtest interaction unreachable or unactivatable.

## Why this exists

The user's rule (WS-G playbook): **after ANY UI change, re-run mock
campaigns + verify UI elements can be FOUND and ACTIVATED.** The
run #14 CSS pass touches:

- Global `button` styles (font / padding / border / background).
- Global `:focus-visible` ring.
- A new `.landing-hero` + `.landing-cta` for the no-campaign view.
- The session-open player digest surface (`session-open-player-recap`).
- DM-PC-detail rename editor (`dm-pc-rename-*`).
- New radii tokens (`--r-pill`).
- New shadow tokens.

The hazard: a global `button { padding: var(--s-2) var(--s-3) }`
change could push a chip button off the visible region, or a
`background: var(--button-bg)` could blend the button into the
surface and make it look like static text. Mock campaign 09 walks
the critical interaction paths via the rendered DOM and asserts the
elements are reachable + activatable.

## Coverage scope

The test exercises THE FOLLOWING interaction paths through happy-
dom (NOT Playwright — that's a future M8 pass; for now we drive the
LitElement render directly):

1. **No-campaign landing**: the `Open Underleaf` CTA is rendered as
   a clickable anchor with the new `landing-cta` class, has a
   non-empty `href`, and a `@click` handler fires.
2. **Recently-played list**: when a localStorage save exists, the
   list renders + each entry has a clickable resume affordance.
3. **DM session-open launcher**: when a session-digest exists, the
   "Open session…" button renders on the DM cockpit, has no
   `disabled` attribute, and its click flips `appMode`.
4. **Player session-open recap**: a non-coord viewer in
   session-open mode with a digest sees the "Previously, at the
   table…" card with the digest body rendered.
5. **DM-PC-detail rename row**: the Edit affordance per identity
   field (name / pronouns / backstory) renders, clicking opens the
   inline input, typing updates the draft, Save fires the
   `onRenamePc` callback with the new value.
6. **Player digest fallback**: when NO digest exists, player sees
   the "DM is re-orienting" placeholder (regression-pin so the new
   surface doesn't accidentally show for non-digest sessions).

## Out of scope

- Native picker affordances (folder picker, file picker) — they're
  driven by `showOpenFilePicker` / `showDirectoryPicker` browser
  APIs that happy-dom doesn't implement. Documented as a Playwright
  follow-up.
- Cross-browser visual rendering — the CSS sees no rendering at
  test time (happy-dom's style engine is partial). The mock-09
  asserts STRUCTURE + INTERACTION, not pixel correctness.
- Full Playwright e2e — task #418 (AI e2e stub migration) is the
  precondition; defer until that's done.

## Assertions

Each scenario asserts:
- The element EXISTS in the rendered DOM (queryable by class /
  text / role).
- The element is NOT `disabled` when it shouldn't be.
- Clicking the element TRIGGERS the host's expected handler (via
  spy / state-flip assertion).

## What this test does NOT pin

- Specific token values (those are covered by `format-stability`-
  style snapshot tests if we add them).
- Layout positioning (happy-dom doesn't paint).
- Animation behavior.

## How this maps to consultant findings

- Visual Design expert #5 (landing hero): assertion 1.
- TTRPG/UX expert top-3 #3 (player digest surface): assertions 4 + 6.
- TTRPG/UX expert top-3 #1 (OP-045 rename): assertion 5.
- TTRPG/UX expert Q10 (DM session-open discoverability): assertion 3.

## Re-validation cadence

Run on every UI-touching commit per WS-G's discipline. The mock
campaigns 01-08 stay GREEN; this one is the visual-pass companion.

## File

`src/persistence.simulation-09-ui-findability.test.ts`

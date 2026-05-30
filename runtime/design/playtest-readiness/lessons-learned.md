# Playtest-readiness — lessons learned

A short, living index of lessons the program has paid for in
real bugs that escaped expert review.  Each entry names the bug,
the pattern, the carrier, and the discipline that closes the
loop.

---

## LL-1 — UX-3 false positive (run #14)

**Bug:** the player-facing "Previously, at the table" recap was
shipped with a test that forced `appMode = 'session-open'` from
the test side.  The test passed.  In production, the routing
path that should have flipped `appMode` automatically didn't
fire — the player landed in the wrong mode.

**Pattern:** unit-testing the destination state directly,
bypassing the production routing.  The unit test pins the
post-state but not the path that produces it.

**Carrier:** test-side mutation of `appMode` instead of driving
the chain (`applySessionViewChange` reacts to session-view
change → flips `appMode` based on conditions).

**Discipline:** mock campaigns drive PRODUCTION paths.  No
test-side `appMode = X` or equivalent state-poking shortcut.
Mock-10 ships as the carrier (run #15).

---

## LL-2 — Start fresh false positive (run #17)

**Bug:** the resume-prompt "Start fresh" button fires a
destructive (silently broken) clear with no confirmation:

1. NO confirmation gate — single click discards months of
   progress.
2. The clear was a single line (`this.resumePromptDoc = null`)
   that DIDN'T clear the underlying autosave, the WebRTC peer
   state, or the chargen drafts.  After "Start fresh," the next
   reload re-staged the same prompt; clicking Resume restored
   the prior session including the PC the DM thought they'd
   discarded and a stale peer entry for another DM.

**Pattern:** "obvious dismissal handler" coverage.  The unit
test (`quire-app.cross-device-probe.test.ts:213`) pinned exactly
that `resumePromptDoc = null` line.  It passed.  The production
user experience was completely broken.  Two v3 consultants —
adversarial and TTRPG-UX — both signed off PLAYTEST GREEN
without walking the Start fresh button.

**Carrier:** localStorage `quire.save.<owner>-<repo>` survived
the dismiss handler; the in-memory `session` controller's
peer-roster survived because the dismiss handler didn't fire a
`peer-leave`; the chargen drafts survived because the handler
didn't touch them.

**Discipline:** every state-clearing button gets an end-to-end
mock that walks the production path:

1. Click the literal button via `app.dismissResumePrompt()` (or
   the equivalent production handler — NOT the internal state-
   clear method).
2. Drive the confirm modal via the production mount + click,
   not by injecting a synthetic Promise.
3. Assert AFTER the production chain settles: the localStorage
   key is gone; the in-memory state is cleared; the next
   `startHosting` produces a clean session with no leftover
   events.

Mock-11 (`src/persistence.simulation-11-start-fresh.test.ts`) is
the carrier.  Run #17 ships.

---

## LL-3 — Retire dialog "white frame" (run #17 emergency)

**Bug:** the user clicks Retire on a PC.  A "white frame in
the middle of the screen" appears — the form (textarea + Cancel
+ Retire commit) renders but is HIDDEN behind the dialog
backdrop, so the user can't click anything to confirm or cancel.
Every chargen-dm-review modal (review / edit / retire / revise)
shared the bug; the user just hadn't tried the others in a
production flow.

**Pattern:** light-DOM `<slot>`-based Lit primitive.  The
`<quire-modal>` element used `createRenderRoot(): this` (so
callers' CSS could target it without `::part`), then tried to
distribute children via `<slot>`.  `<slot>` only works inside
a shadow root — in light DOM it's an inert element with no
distribution.  The host's children rendered as SIBLINGS of the
`<dialog>` rather than INSIDE it, and `showModal()` promoted
only the empty dialog into the top layer.

**Carrier:** the test environment (happy-dom) does not
implement `showModal()`'s top-layer semantics; every node was
reachable via querySelector regardless of whether it would
actually surface in production.  `chargen-dm-review.test.ts`
asserted that the textarea + buttons exist somewhere reachable
from `<quire-modal>` — they did, just as siblings.  The test
passed; production was broken.

**Discipline:** for every primitive that wraps content in a
top-layer / popover / portal / shadow-root mechanism, the
primitive test MUST assert the content is INSIDE the wrapper
element, not just findable from the host root.  The new
regression `Run #17 regression: host children land INSIDE the
<dialog>, not as siblings` pins the dialog-contains-content
invariant.  The chargen-dm-review retire test pins the same
invariant end-to-end through the production click path.

The same discipline applies to FUTURE primitives — for the
Popover API or any future shadow-DOM-themed primitive: assert
the content's *placement*, not just its existence.

**Cross-pattern with LL-2:** both bugs slipped past the run #16
PLAYTEST-GREEN consultants for the same reason: a test that
asserts a sliver of behavior (state field updated; node
reachable) smaller than what the user sees.  See "The
cross-cutting lesson" below.

---

## The cross-cutting lesson

LL-1, LL-2, and LL-3 share the same anti-pattern: a small unit
test that DOES pass but pins a sliver of behavior smaller than
what the user sees.  The production path between "user clicks
the button" and "the state the user observes" is bigger than the
sliver the unit test pins.

### What classes of test would have caught these?

- **End-to-end production-routing tests.**  Mock campaigns at
  the engine + Lit-app altitude.  The user clicks via the
  production click handler; the test asserts the final user-
  visible state, NOT an intermediate state-machine field.
- **"Empty-state assertion" helpers** that walk every localStorage
  key + every WebRTC peer table after a clear.  These make the
  full-clear contract explicit.  Recommended for future
  state-clearing affordances (e.g. "log out of cloud sync"
  surfaces in M6a-OAuth).

### Where to add the discipline

- **Before shipping a state-clearing affordance:** write the
  mock campaign that walks the production path.  No mock?  Open
  the next-OP and don't ship the feature without it.
- **Before any consultant pass:** the consultant brief MUST
  list "walk every state-clearing button end-to-end" as a
  scoped question.  v3 briefs implicitly assumed someone else
  had done this — nobody had.
- **In review playbooks:** add "for every dismiss/clear/discard
  affordance, the reviewer EITHER produces a mock-campaign-
  shaped end-to-end assertion OR files an OP for the next
  reviewer."

---

## LL-3 — Invisible dialogs (run #18 hotfix)

**Bug:** the run #17 Start-fresh confirm dialog opened (the
autofocus DID fire on the Cancel button — diagnostic in the
user's console) but was completely invisible.  Same root cause
hit `<cloud-push-consent-dialog>` (run #5/#6, never noticed
because first-push is rare) and `<pc-revoke-confirm-dialog>`
(run #18, never exercised before the user tried it).  User
reported "Start fresh has no effect."

**Pattern:** custom-element confirm dialogs override
`createRenderRoot()` to render into LIGHT DOM (so host CSS
reaches them) and emit a custom `<div class="*-backdrop">` +
`<section class="*-dialog">` pair instead of a native
`<dialog>` + `::backdrop`.  The class names referenced in the
template MUST also exist as CSS rules in `quire-app.css.ts`.
For all three dialogs they did NOT.  The dialog DOM was in the
document, in normal flow, with `position: static`, no
z-index, no backdrop, no centered child — invisible.

**Carrier:** unit tests for each dialog asserted the rendered
DOM shape (Cancel button present, Confirm button present,
`resolve(true)` fires on click) — they never asserted the
dialog was visible on a real page.  The `<quire-modal>` rewrite
(DEC-038) was a sibling fix for the OTHER family (modals that
used `<dialog>` + `<slot>` and lost children to the top-layer
promotion) — that fix didn't apply here because these dialogs
never used `<dialog>` at all.

**Discipline:**
- New rule: any custom-element confirm-dialog rendering to
  light DOM MUST add its `*-backdrop` and `*-dialog` class
  names to the `LIGHT_DOM_DIALOG_BACKDROPS` / `_BODIES` arrays
  in `src/ui/styles/dialog-visibility.test.ts`.  The test is
  a static check on `quire-app.css.ts` — fails at PR time if a
  class is referenced in the template but has no CSS rule (or
  has a rule but no `position: fixed` for the backdrop).
- Adversarial reviewer playbook addendum: for every NEW
  custom-element dialog, walk the END-TO-END user click in a
  manual or e2e harness (not happy-dom, which doesn't compute
  layout enough to surface invisible-but-present elements).
- "Sliver test pinned smaller than what user sees" pattern is
  now LL-1/LL-2/LL-3 — three independent escapes.  The unit-
  test layer keeps missing the visibility/path/clearing
  problems because it's the wrong altitude for them.

### LL-3 amendment (the c20702f fix didn't fix it)

Shipping c20702f (CSS rules for the three backdrops) did NOT
make the dialogs visible.  The deeper root cause: `<quire-shell>`
declares ONLY named slots (topbar / rail / stage / aside / dock).
The three confirm-dialogs were authored as CHILDREN of
`<quire-shell>` with no `slot=` attribute, so they sat in light
DOM but the browser never distributed them to any slot.  Even
with `position: fixed; inset: 0; z-index: 1000` applied, the
backdrop's bounding rect was 0×0 because the element was never
laid out at all.  Fix in d5d1a9c: move all four overlay elements
out as siblings of `<quire-shell>`.

The d5d1a9c fix was found by running an actual Playwright probe
against the live deploy.  The static `dialog-visibility.test.ts`
shipped in c20702f couldn't detect this — source inspection
sees the CSS but not the runtime slot distribution.  The
unit-test layer for the confirm-dialog component itself can't
detect it either, because the component renders fine in
isolation; it's the HOST'S mount point that broke layout.

**Closed by:** `e2e/dialog-visibility.spec.ts` — a real-Chromium
Playwright spec that opens each dialog programmatically and
asserts the backdrop fills the viewport.  Register new
custom-element confirm-dialogs in its `DIALOGS_TO_PROBE`
array; the test fails at PR time if a new dialog can't be
made visible from its mount point.

**Discipline upgrade (in response to user's "do you need
better and more realistic test coverage using actual
browsers?"):** YES.  The pattern is now:
1. Static text test (`src/ui/styles/dialog-visibility.test.ts`)
   for the CSS-rule-missing flavor.  Fast.  Catches authoring
   errors at PR time.
2. **Real-browser e2e test (`e2e/dialog-visibility.spec.ts`)
   for the layout flavor.**  Slow (5s).  Catches the slot-
   distribution / containing-block / ancestor-CSS flavors.
3. Manual probe via `dialog-visibility-probe.mjs` style script
   when investigating a user-reported "dialog has no effect"
   to triage which layer (CSS / mount / handler).

Three layers; no single layer would have caught both c20702f
and d5d1a9c bugs.  The bug class is "rendered DOM looks right
but the user sees nothing" — only a real browser knows.

---

## Lessons that did NOT need a new entry

- The OP-039 firewall hole (run #9): caught by mock campaign 01,
  the FIRST mock campaign shipped — the discipline (mock
  campaigns walk production paths) works, the gap was that we
  hadn't built mock-09/10/11 yet.
- The H-1/H-2 cross-campaign leaks (run #16): caught by the v3
  adversarial consultant walking the same surface that produced
  v2's findings.  Multi-expert iteration is doing what it's
  supposed to.

What both LL-1 and LL-2 share that the above don't: the bug
lives in the UI-handler ↔ persistence-carrier chain, NOT in the
core engine.  The mock campaigns at the engine layer don't
exercise this chain.  Mock campaigns at the Lit-app altitude do.

The discipline going forward: mock campaigns SHIFT UP to the Lit
altitude for any "user clicks button → multi-layer state clear"
affordance.  Engine-layer mocks stay good for materializer
contracts, firewall fuzzing, and event-log invariants.

---

## Update cadence

- After every consultant-found bug that escaped the prior
  pass: add an LL-N entry.
- After every product-owner-reported bug: same.
- After every "we shipped X and a week later realized Y": same.

This doc is the carrier for the program's self-correction.

# Playtest-Readiness Program — Status

**Last updated:** 2026-05-30 run #17 EMERGENCY (TWO P0s —
Start fresh + retire dialog "white frame")

**Status:** **PLAYTEST GREEN re-affirmed after both run-#17
emergency P0s closed.**  The product owner ran a dry-run on
2026-05-30 and surfaced two P0s that the v3 consultants signed
off without catching:

1. The "Start fresh" affordance had no confirmation modal AND
   didn't actually clear local state.  Closed: DEC-036
   (orchestrator) + DEC-037 (confirm gate) + Mock Campaign 11.
2. The retire dialog rendered as "a white frame in the middle
   of the screen, but I can't do anything to actually
   confirm."  Root cause: `<quire-modal>` used light-DOM
   `<slot>` which doesn't distribute — the form rendered as
   sibling of the dialog, hidden behind backdrop in production.
   Closed: DEC-038 (rewrote `<quire-modal>` to wrap host
   children in a real `<dialog>`).  All four chargen-dm-review
   modals (review / edit / retire / revise) had the same bug;
   one fix closes all of them.

Both engineering contracts are now correct and end-to-end
pinned by tests.  No further consultant pass is required before
playtest day — the fixes are isolated, additive, and shipped
with regression tests pinning the load-bearing invariants.

See LL-2 + LL-3 in `lessons-learned.md` for the trust-but-
verify retrospectives — second and third instances of the same
pattern (test asserts a sliver of behavior smaller than what
the user sees).

**Prior run #16 status (preserved for context):** Both v3
consultants (adversarial + ttrpg-ux) signed off GO.  Run #16
closed H-2 + H-1 and documented H-3 deferral as OP-046.

**Active workstreams (final state):**
- WS-A (data-format forward-compat): DEC-031 amended (H-3
  deferral documented); OP-046 filed for post-playtest
  defense-in-depth extension.
- WS-B (DM write-up phase): H-2 closed — `<session-digest>`
  discard-and-load on campaignSlug change (DEC-034).
- WS-C (chargen polish): no changes this run; UX-4
  documented in handoff as known-issue (Q&A-only playtest).
- WS-D (full backup E2E): maintained green.
- WS-E (AI integration): no changes this run.
- WS-F (visual polish): visual v2 #2-#5 walked + deferred
  (no playtest-1 leverage).
- WS-G (UI-iteration discipline): mock-10 extended (+2
  scenarios for H-2 + H-1).

**Latest deploy hash:** 4779a9c (run #17 emergency ship)
**Branch:** main

---

## Run #17 — what shipped (P0 Start fresh fix)

The product owner ran a real playtest dry-run on 2026-05-30 and
surfaced a P0:

> i tried to "start fresh" for a completely new game. first of
> all, that should warn me and ask for confirmation as we don't
> want dm's to accidentally blow away months of progress. but
> more importantly, fresh starts don't seem to work right now.
> i still see the player that I created earlier, and i still
> see a "stale" instance of another dm that appears to be
> connected in the roster and that i need to remove

Diagnosed in `start-fresh-diagnosis-2026-05-30.md`.  Two distinct
bugs:

1. NO confirmation gate on either "Start fresh" surface.
2. The resume-prompt "Start fresh" handler was one line
   (`this.resumePromptDoc = null;`) that didn't clear the
   underlying autosave / in-memory state / WebRTC peers /
   chargen drafts.

### Phase 1 — diagnosis

Walked every Start fresh / Discard / Disconnect callsite.  Two
real "Start fresh" affordances (resume-prompt + cross-device
probe); the latter is locally safe but visually identical to
the former (defense-in-depth: confirm both).  Six carriers
identified:

1. localStorage autosave (`quire.save.<owner>-<repo>`)
2. In-memory session state
3. WebRTC peer connections (so other peers update their roster)
4. `loadedExtraFields`
5. Chargen drafts (`quire.chargen.<slug>:slot1..9`)
6. Cross-device probe seen-marker — VERIFIED in-memory only;
   no localStorage carrier.

### Phase 2 — fix shipped

**New file** `src/ui/regions/start-fresh-confirm-dialog.ts`:
two-step confirm modal with destructive + safe variants.  Default
focus on Cancel.  Escape / backdrop click resolve as Cancel.
12 unit tests (`start-fresh-confirm-dialog.test.ts`).

**New orchestrator** in `src/quire-app.ts`:
- `startFreshForCampaign(campaign)` clears all 6 carriers in
  the right order: `announceLeaveAndExit()` → autosave key
  delete → chargen draft clear → prompts null → probe reset →
  `loadedExtraFields` clear.
- `confirmStartFresh(campaign, variant)` opens the dialog +
  resolves on user click.
- `dismissResumePrompt()` now async, routes through confirm
  (destructive variant), calls orchestrator.
- `dismissCrossDeviceProbe()` now async, routes through confirm
  (safe variant), then clears the staged match.
- Resume button on the resume-prompt no longer routes through
  the confirm-gated `dismissResumePrompt` (it shouldn't — the
  intent is OPPOSITE); rewired to nullify `resumePromptDoc`
  directly.

**Decisions** DEC-036 (orchestrator) + DEC-037 (confirm gate)
landed in `decisions.md`.

### Phase 3 — Mock Campaign 11

`src/persistence.simulation-11-start-fresh.test.ts` — 8
production-path scenarios:

1. No autosave → no-op happy path.
2. Autosave + no live session → confirm clears.
3. Live session → peer teardown + autosave clear.
4. Cancel preserves state entirely.
5. Prior session's PC does NOT survive (user's exact bug).
6. Stale peer-join does NOT survive (user's other observation).
7. Chargen drafts cleared on all 9 slots.
8. Cross-device probe Start fresh routes through safe-variant
   confirm; cloud copy untouched.

Doc: `design/save-restore-program/simulations/mock-campaign-11-
start-fresh.md`.

### Phase 4 — regression check

Full `npm test` GREEN.  Mock campaigns 01 (cross-session loop)
+ 09 (UI findability) + 10 (routing + drafts) all pass.  Tests:
3066 passed + 2 skipped = 3068 (up from 3045 baseline; +21 net
= 12 dialog + 8 mock-11 + 1 cross-device cancel test added,
existing dismissCrossDeviceProbe test rewired).

### Phase 5 — trust-but-verify retrospective

LL-2 written in `design/playtest-readiness/lessons-learned.md`.
The pattern: a single-line dismiss handler with a unit test that
pinned exactly that one-line behavior — test passes, production
broken.  Same pattern as LL-1 (UX-3 false positive, run #14).
Discipline going forward: every state-clearing affordance gets
a mock-campaign-shaped end-to-end test that drives the
production click handler + asserts the user-visible state, NOT
the internal state field.

## Run #17 — Phase 6 (retire dialog "white frame" emergency)

After the Start fresh work shipped, the product owner reported
the SECOND P0:

> Trying to "retire" the existing PC brings up a white frame in
> the middle of the screen, but I can't do anything to actually
> confirm.

### Diagnosis

Root cause: `<quire-modal>` (Phase 3a primitive, 2026-05-25)
used `createRenderRoot(): this` (light DOM so callers' CSS
could target it) AND rendered `<dialog><slot></slot></dialog>`.
But `<slot>` only distributes inside a shadow root; in light
DOM it's an inert element.  The host's children rendered as
SIBLINGS of the empty `<dialog>`.  When `showModal()` ran, only
the empty dialog entered the top layer — the form (textarea +
Cancel + Retire commit) stayed in the normal flow, hidden
behind the dialog backdrop.

All four chargen-dm-review modals (review / edit / retire /
revise) shared the bug; the user happened to hit retire first.

### Why it slipped past every prior consultant

happy-dom does not implement `showModal()`'s top-layer
semantics — every node was reachable via `querySelector`
regardless of whether it would actually surface in production.
Tests asserted "the textarea exists somewhere inside
`<quire-modal>`" — and it did, just as a sibling.  LL-3
captures the pattern.

### Fix

Rewrote `src/ui/components/quire-modal.ts`: drops the `<slot>`
distribution; instead, programmatically wraps the host's
existing (and dynamically-added, via MutationObserver) children
in a real `<dialog>` element with the host's class mirrored on
the dialog.  Zero caller-site changes required.

DEC-038 (dialog-wrap pattern) logged in
`save-restore-program/decisions.md`.

### Regression coverage

- 3 new tests in `src/ui/components/quire-modal.test.ts`
  pinning the dialog-contains-content invariant (host children
  INSIDE the `<dialog>`, host class mirrored on the dialog,
  dynamic children re-parent into the dialog).
- 2 new end-to-end tests in
  `src/ui/regions/chargen-dm-review.test.ts` pinning the
  retire dialog's controls inside the dialog + the commit click
  end-to-end fires `onRetirePc` with the typed reason.

### Cumulative run #17 tests

3069 passing + 2 skipped = 3071 across 156 files (up from
3045 baseline at run #16; +24 net).  Typecheck clean.

### GO call

**PLAYTEST GREEN re-affirmed engineering-side after BOTH P0s
closed.**  The reserved-contingency for surprises is now
spent; if a third P0 surfaces during the real playtest, the
program lead escalates to the human.

Files changed (run #17, both emergencies):
- `src/quire-app.ts` (orchestrator + handlers + dialog mount; P0-1)
- `src/ui/components/quire-modal.ts` (REWRITE; P0-2)
- `src/ui/components/quire-modal.test.ts` (3 new regression tests; P0-2)
- `src/ui/regions/chargen-dm-review.test.ts` (2 new regression tests; P0-2)
- `src/ui/regions/start-fresh-confirm-dialog.ts` (NEW; P0-1)
- `src/ui/regions/start-fresh-confirm-dialog.test.ts` (NEW; P0-1)
- `src/persistence.simulation-11-start-fresh.test.ts` (NEW; P0-1)
- `src/quire-app.cross-device-probe.test.ts` (test rewired; P0-1)
- `design/playtest-readiness/start-fresh-diagnosis-2026-05-30.md` (NEW)
- `design/playtest-readiness/lessons-learned.md` (NEW; LL-1 + LL-2 + LL-3)
- `design/playtest-readiness/playtest-handoff.md` (Patches §0 added)
- `design/playtest-readiness/playtest-readiness-plan.md` (Appendix D updated)
- `design/save-restore-program/simulations/mock-campaign-11-start-fresh.md` (NEW)
- `design/save-restore-program/decisions.md` (DEC-036 + DEC-037 + DEC-038)
- `design/save-restore-program/open-problems.md` (OP-047 + OP-048)

### Product call needing human (1)

The diagnosis flagged chargen-drafts as needing a product call:
should "Start fresh" wipe per-slot chargen drafts (`quire.chargen.
<slug>:slot1..9`)?

**My recommendation, shipped as the default:** YES, wipe them.
Rationale in `start-fresh-diagnosis-2026-05-30.md` §5 (C5).

If the human prefers PRESERVING drafts (the playtest table
hand-off uses different physical devices for DM vs player so
the DM's Start fresh CAN'T touch player drafts on the player's
device anyway), revert the chargen-clear loop in
`startFreshForCampaign` and update mock-11 Scenario 7
accordingly.  This is a 5-line change.

---

## Run #16 — what shipped

### Phase 1 — H-2 closed (Adversarial v3, P2)

`<session-digest>` now handles cross-campaign slug change
correctly.  Per DEC-034 (discard-and-load semantic):

- `updated(changed)` distinguishes initial-mount from
  campaign-slug CHANGE.  On change: cancel pending debounced
  persist timer, clear in-memory draft + errorMessage +
  generatedByResponseId, THEN call `loadPersistedDraft()`.
- Initial-mount path unchanged (the draft is empty by
  construction; `connectedCallback` raced ahead of
  lifecycle).
- The campaign-A draft (if any) is preserved in
  localStorage under A's key — it will surface again when
  the DM returns to A.

**Pinned by:** `src/persistence.simulation-10-routing-and-
drafts.test.ts` Scenario 8.  Walks: mount with slug A, set
dirty draft, change `.campaignSlug = "B"` (B has a
persisted draft seeded), assert textarea shows B's
text NOT A's, assert localStorage[B-key] is unchanged
(not contaminated with A's text).

### Phase 2 — H-1 closed (Adversarial v3, P3)

`playerLastSeenDigestTsInMemory` now resets to `0` on:

- `navigateToRoute` slug-mismatch branch (next to the run-#15
  `loadedExtraFields = undefined` clear).
- `leaveSession` (clean home-route shutdown).

Per DEC-035.  The persisted localStorage marker is
owner+repo-scoped (already isolates correctly across
campaigns); the in-memory mirror was process-scoped and
would otherwise suppress campaign B's recap if B's latest
digest's ts < A's dismissed marker.

**Pinned by:** Mock-10 Scenario 9.  Walks: dismiss campaign
A's recap → assert mirror advanced → navigateToRoute to
campaign B → assert mirror === 0; then set mirror to a
large value → leaveSession → assert mirror === 0.

### Phase 3 — H-3 deferred (Adversarial v3, P3)

`focus-grant`, `pc-retire/pc-archive`, and
`map-blob-add/move` scrubbers strip DM-only sub-fields by
NAME with kind-specific vocabularies (not in
DM_ONLY_CHARACTER_FIELDS).  The run-#15 string-scan
defense doesn't catch v:2 renames in those vocabularies.

- DEC-031 amended with explicit scope-of-defense note
  ("Run #16 amendment").
- OP-046 filed at `open-problems.md` (P3, post-playtest):
  introduce kind-specific `FOCUS_DM_ONLY_FIELDS` /
  `RETIRE_DM_ONLY_FIELDS` / `MAP_BLOB_DM_ONLY_FIELDS`
  vocabularies + generalized
  `payloadFieldNameKeyNamesField(p, vocab)` helper.
- No live hazard: v:2 shapes don't exist; DEC-031 §1
  contract-prohibition + materializer `isPayloadV1`
  silent-no-op are the first two defenses.

### Phase 4 — Visual cohesion #2-#5 walked + deferred

Walked the visual v2 #2-#5 list (deferred from run #15):
demote legacy `<h1>Quire</h1>` on idle, `.session-bar`
token migration, DM-operational surface variant, 5
highest-density pill radii to `--r-pill`.  None
load-bearing for playtest 1.  The ttrpg-ux-expert v3
report (Q1-Q10) did not surface visual regressions and
explicitly affirmed the cockpit is cohesive enough.
Deferred to keep this run's focus on the handoff doc.

### Phase 5 — PLAYTEST HANDOFF DOC SHIPPED

`design/playtest-readiness/playtest-handoff.md` — the
deliverable for the human + DM + co-DM + test table.
Required sections all present:

- What's playtest-ready (verified capabilities) — cross-
  references v3 GO verdict.
- Known issues (UX-4 placeholder paths, UX-6 dmGuidance,
  UX-3 v2 #3 backstory collapse, OP-046 defense-in-depth,
  AI-2 cache_control, AI-3 live PC state, AI-4 in-memory
  undo, task #416 co-DM toast).  Each entry: severity,
  user-impact statement, workaround.
- Setup checklist — Chrome/Edge requirement, FS-API folder
  connect path, invite links, OAuth deferred state.
- First-session ritual — chargen first (Q&A path, world
  rules walk-through, intent-against-pressure), then play
  (firewall + AI gate).
- End-of-session ritual — DM writes the digest, drafts
  autosave, "Previously, at the table…" surfaces next
  session.
- Between sessions — cloud-folder push, DM authors next
  chapter, table returns.
- What we want to learn — 10 questions for the human +
  DM (digest write-through, "Previously" visibility,
  rename, cloud backup, **silent-player firewall hold**,
  visual cohesion, chargen-as-story, AI accept-or-reject,
  co-DM, discoverability gaps).
- Bug reporting — file format, triage rules (P0 for
  spoiler-firewall breach, do NOT patch at the table, do
  NOT warn the player about the leak).

### Phase 6 — Final pre-playtest sweep

- `npm test`: 3045 passing + 2 skipped = 3047 total (was
  3043 + 2 = 3045 at run #15; **+2 net this run**, both
  in mock-10).
- `npx tsc --noEmit`: clean.
- `npm run build`: clean (main chunk 660KB, on par with
  prior runs).
- 154 test files (unchanged from run #15).
- Mock-09 (5 tests) + Mock-10 (9 tests, was 7) verified
  green.
- DoD walked: north-star §1.1-1.5 + bug bar §1.4 + test
  coverage gates §1.5 all satisfied.

---

## Tests + baselines

- **Test count:** 3045 passed + 2 skipped = 3047
  (up from 3045 baseline at run #15; **+2 net this run**).
- **Test files:** 154.
- **Typecheck:** clean.
- **Build:** clean (660KB main chunk).
- **No credentials in diff.**

### Changed files this run

- `src/ui/regions/session-digest.ts` — updated() now
  discards in-memory draft + cancels pending save on
  campaignSlug CHANGE before load.
- `src/quire-app.ts` — `playerLastSeenDigestTsInMemory = 0`
  in navigateToRoute slug-mismatch branch + leaveSession.
- `src/persistence.simulation-10-routing-and-drafts.test.ts`
  — Scenarios 8 + 9 added.
- `design/save-restore-program/decisions.md` — DEC-034 +
  DEC-035 + DEC-031 amendment.
- `design/save-restore-program/open-problems.md` — OP-046
  filed.
- `design/playtest-readiness/playtest-readiness-plan.md` —
  Appendix C (run #16 triage + PLAYTEST GREEN).
- `design/playtest-readiness/playtest-handoff.md` — **NEW
  deliverable**.

---

## PLAYTEST GREEN

The program is GREEN.  The build is ready for the first
real human playtest.

Both v3 consultants signed off:

- **Adversarial v3 (`review-history/adversarial-run15-
  fixes-2026-05-30.md`):** "GO for playtest 1, all critical
  fixes verified."
- **TTRPG/UX v3 (`review-history/ttrpg-ux-expert-v3-
  2026-05-30.md`):** "GO.  Playtest GREEN."

Run #16 closes the remaining hazards they identified.  The
reserved run #17 contingency is **unspent**.

Run-budget consumed: 16 of expected 16.

---

## What's NOT in this turn

- M6a-OAuth (still gated on maintainer flipping
  `GOOGLE.status` — do NOT flip in code).
- M6c (post-playtest).
- AI-2 / AI-3 / AI-4 (post-playtest known-issues per
  handoff doc).
- UX-4 free-write + pre-gen chargen paths (M8-track).
- Visual cohesion #2-#5 (post-playtest polish; ttrpg-ux
  v3 affirmed not load-bearing).

---

## Decisions pending the human (SHORT LIST)

None this run.  The build is ready; the playtest table is
the next signal.

If the playtest surfaces a finding that needs a product
call (e.g. "free-write path is too critical to defer past
session 2"), the next run-lead will land it here.

---

## Health summary

- 🟢 WS-A format-stability + FC-2 (DEC-032) + H-3 deferral
  (DEC-031 amend + OP-046).
- 🟢 WS-B UX-5 digest draft persistence + H-2 discard-and-
  load (DEC-034).
- 🟢 WS-C UX-3 player routing + H-1 in-memory mirror reset
  (DEC-035).
- 🟢 WS-D cloud backup E2E maintained.
- 🟡 WS-E AI integration — AI-2 / AI-3 / AI-4 deferred per
  handoff doc.
- 🟢 WS-F visual polish — foundation shipped run #14-#15;
  v2 #2-#5 walked + deferred (not load-bearing per v3).
- 🟢 WS-G UI-iteration discipline — mock-10 +2 scenarios.

**🟢 PLAYTEST READY.**

---

## Where to find things

- Master plan → `playtest-readiness-plan.md` (Appendix A
  is run-#14 triage; Appendix B is run-#15; Appendix C is
  run-#16 PLAYTEST GREEN).
- **Playtest handoff (run #16 deliverable)** →
  `playtest-handoff.md`.
- Format-stability contract → `format-stability.md`.
- DEC-031 (+ run-#16 amendment) + DEC-032 + DEC-033 +
  DEC-034 + DEC-035 →
  `../save-restore-program/decisions.md`.
- OP-046 (post-playtest defense-in-depth backlog) →
  `../save-restore-program/open-problems.md`.
- Consultant briefs (v1, v2, v3) →
  `consultant-briefs/`.
- Consultant reports (v1, v2, v3) → `review-history/`.
- Mock-campaign 10 (Scenarios 1-9) →
  `../../src/persistence.simulation-10-routing-and-drafts.
  test.ts`.

# Playtest-Readiness Program — Status

**Last updated:** 2026-05-30 run #16 (PLAYTEST GREEN — final
program-lead run before playtest 1)

**Status:** **PLAYTEST GREEN.**  Both v3 consultants (adversarial
+ ttrpg-ux) signed off GO for playtest 1.  Run #16 closes H-2
(only P2) + H-1 (P3 cleanup) and documents H-3 deferral as
OP-046.  The playtest-handoff doc captures everything the
human + DM + test table need before session 1.

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

**Latest deploy hash:** TBD after push (run #16 ship)
**Branch:** main

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

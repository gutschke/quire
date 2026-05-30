# Playtest-Readiness Program — Status

**Last updated:** 2026-05-30 run #15 (v2 consultant ingestion +
critical fixes + foundation continuation + mock-10 + run-#16 briefs)
**Active workstreams:**
- WS-A (data-format forward-compat): EXTENDED this run (DEC-032
  FC-2 narrowing + parity for bond-ratify + pc-create)
- WS-B (DM write-up phase): UX-5 SHIPPED (digest draft
  persistence)
- WS-C (chargen polish): UX-3 routing fix SHIPPED (player auto-
  trigger)
- WS-D (full backup E2E): unchanged (maintained green)
- WS-E (AI integration): no changes this run (AI-2, AI-3 still
  queued)
- WS-F (visual polish): foundation CONTINUED (`.card` migration
  + topbar focus + brittle-class doc); items 6-10 partial
- WS-G (UI-iteration discipline): MOCK-10 shipped + mock-09
  Scenario 4 updated to exercise production routing

**Latest deploy hash:** 6a6f8f4 (run #15 ship)
**Branch:** main

---

## Run #15 — what shipped

### Phase 1 — Triage (Appendix B in playtest-readiness-plan.md)

All 3 v2 consultant reports walked; every finding triaged with
priority + ship-target + owner.  Critical fixes shipped this
run; foundation continuation items 6-10 partially shipped
(`.card` migration as the highest-ROI #1); remaining items
queued for run #16.

### Phase 1 — Critical fixes (v2 P1s)

**UX-3 routing fix (TTRPG/UX v2 top-3 #1 + #2).**
The run #14 player "Previously, at the table…" recap card
mounted on a surface NO PLAYER ever reached.  Mock-09 Scenario
4 passed only because it forced `appMode = 'session-open'`
from outside the production routing path.

- `src/quire-app.ts` — added a second auto-trigger branch in
  the `applySessionViewChange` subscriber that fires for
  player viewers (`!coordHolders.has(peerId)`) when
  `playerHasUnseenDigest` returns true.
- New helpers `playerHasUnseenDigest`,
  `getPlayerLastSeenDigestTs`,
  `setPlayerLastSeenDigestTs`,
  `dismissPlayerDigestRecap`, +
  `playerLastSeenDigestTsInMemory` field (belt-and-suspenders
  for the campaign-discovery-lags-session-view race).
- Persistent seen-marker at
  `quire.player-digest-seen.<owner>-<repo>` keeps the player
  from re-flipping after dismiss; in-memory mirror handles
  the race.
- `renderSessionOpenStage` non-coord branch — now renders the
  digest body via `renderMarkdown` + `unsafeHTML` (not the
  raw `<pre>` of run #14); added a Dismiss button
  ("Got it — continue") wired to
  `dismissPlayerDigestRecap`.
- DEC-033 codifies the design.

**FC-2 scrubber parity for bond-ratify + pc-create
(Adversarial v2 H-1).**
The forward-compat architect explicitly named bond-ratify +
pc-create in the run #14 report; DEC-031 §Alternatives mis-
classified them as immune.  Both scrubbers DO read by sub-
field key.

- `src/persistence.ts` — new helper
  `payloadFieldNameKeyNamesDmField` + fixed vocabulary
  `FIELD_NAME_KEYS = ['field', 'path', 'target', 'key', 'attr',
  'prop']`.  Both `bond-ratify` and `pc-create` scrubbers
  apply the helper.
- DEC-032 supersedes DEC-031 §Alternatives.

**FC-2 narrowing (Adversarial v2 H-3).**
The run #14 broad value-scan dropped `pc-edit { field:'name',
value:'tax' }` because `'tax'` matches a DM-only field name.
With OP-045 shipping rename, a player named "Tax" would
silently lose all pc-edit events on the player projection.

- Narrowed the scan from "all string values" to the fixed
  `FIELD_NAME_KEYS` vocabulary.  Same helper as the parity
  fix.
- DEC-032 documents the tradeoff (contract-level prohibition
  from DEC-031 §1 remains the primary defense; INV-7 v:2
  silent-no-op is the second).
- 3 new regression tests in
  `src/persistence.format-stability.test.ts`:
  - "Tax" rename SURVIVES.
  - bond-ratify v:2 rename bypass IS DROPPED.
  - pc-create v:2 rename bypass IS DROPPED.

**loadedExtraFields cross-campaign clear (Adversarial v2 H-2).**
- `src/quire-app.ts:navigateToRoute` — one-line clear of
  `this.loadedExtraFields = undefined` in the slug-mismatch
  path so a DM jumping directly between campaign URLs doesn't
  contaminate the new campaign's first autosave.

**UX-5 digest draft persistence (TTRPG/UX v2 Q8).**
The DM's mid-wrap recap draft used to live in `@state` only;
tab close mid-edit silently lost the recap.

- NEW module `src/digest-draft-persistence.ts` (mirrors
  `chargen-persistence.ts` exactly — same load/save/clear
  contract + same defensive shape).
- `src/ui/regions/session-digest.ts` — new `campaignSlug`
  prop + connectedCallback load + 750ms debounced @input
  save + handleSave/Discard clears + disconnectedCallback
  flush.
- `src/quire-app.ts` — new
  `currentCampaignSlugForPersistence` helper +
  `<session-digest>` wired.

**Send button regression (Visual v2 Q4).**
The run #14 global button reset demoted Send in chat + AI
panel to muted-secondary (indistinguishable from cancel).

- `src/ui/regions/chat-panel.ts:108` —
  `class="btn-primary"`.
- `src/ui/regions/ai-panel.ts:635` — same.

### Phase 2 — Foundation continuation

**.card migration to tokens (Visual v2 #1, highest-ROI).**
The single highest-leverage CSS edit available.  Propagates
the foundation through every region that inherits `.card`
(AI panel + DM operational + session-digest + backups-card
+ recents + chargen wrapper).

- `src/ui/styles/quire-app.css.ts:.card` — migrated:
  `light-dark(#fcfcfc, #1f1f1f)` → `var(--surface-card)`;
  `6px` → `var(--r-card)`;
  `light-dark(#ddd, #333)` → `var(--border-hairline)`;
  + `box-shadow: var(--shadow-card)`.

**Topbar help-chip focus-visible token (Visual v2 Q3).**
- `.quire-topbar-help-chip:focus-visible` →
  `outline: var(--ring-focus)`.  Most user-visible focus-ring
  collision closed.  Chargen-only rings (lines 1493, 2008)
  left alone per expert "benign" call.

**Brittle-class radar doc comments (Visual v2 Q10).**
- `src/ui/styles/quire-app.css.ts:100-117` — named the
  test-pinned classes.
- `src/ui/styles/tokens.css.ts:42` — named the consumed token
  vocabulary.  Future visual passes coordinate renames in
  lockstep.

### Phase 3 — Mock campaign 10 (UI iteration discipline)

NEW simulation `src/persistence.simulation-10-routing-and-
drafts.test.ts` (7 scenarios).  Per the run #14 lesson — "ALL
UX tests must respect production code paths; don't shortcut
state in fixtures":

- Scenario 1: player auto-flips to session-open via
  PRODUCTION trigger (NO test-side appMode mutation).
- Scenario 2: Dismiss persists the seen-marker; later
  session-view changes do NOT re-flip.
- Scenario 3: a STRICTLY NEWER digest re-flips after dismiss.
- Scenario 4: digest-draft persistence helpers round-trip.
- Scenario 5: storage keys are campaign-scoped.
- Scenario 6: `<session-digest>` picks up a persisted draft
  on connect.
- Scenario 7: FC-2 narrowing — "Tax" rename survives.

Doc at
`../save-restore-program/simulations/mock-campaign-10-
routing-and-drafts.md`.

Mock-09 Scenario 4 ALSO updated to assert the production
auto-trigger fires (no test-side mutation).

### Phase 4 — Consultant briefs for run #16

- `consultant-briefs/adversarial-run15-fixes.md` —
  re-verifies the run #15 critical fixes don't introduce new
  gaps (UX-3 routing + dismiss races, FC-2 vocabulary
  completeness, UX-5 draft leak/stale cases, extraFields
  cross-campaign edges).
- `consultant-briefs/ttrpg-ux-expert-v3.md` — final
  playtest GREEN gate (GO/NO-GO call per v2 Q9 hard cap).

### Phase 5 — Docs

- `playtest-readiness-plan.md` Appendix B (v2 triage table).
- `decisions.md` DEC-032 (FC-2 narrowing + parity) + DEC-033
  (player auto-trigger).
- `simulations/mock-campaign-10-routing-and-drafts.md`.
- This status doc.

---

## Tests + baselines

- **Test count:** 3043 passed + 2 skipped = 3045 (up from
  3035 baseline at run #14; **+10 net this run**).
- **Test files:** 154 (up from 153).
- **Typecheck:** clean.
- **Build:** unverified (run before push).
- **No credentials in diff.**

### New / updated test files this run

- `src/persistence.simulation-10-routing-and-drafts.test.ts`
  (NEW; 7 scenarios).
- `src/persistence.format-stability.test.ts` (extended; +3
  FC-2 narrowing + parity tests).
- `src/persistence.simulation-09-ui-findability.test.ts`
  (updated; Scenario 4 now asserts production auto-trigger).
- `src/quire-app.player-digest-surface.test.ts` (updated;
  beforeAll ensures markdown pipeline).

### Production-code touches this run

- `src/quire-app.ts` (player auto-trigger + dismiss handler
  + helpers; loadedExtraFields cross-campaign clear; session-
  digest campaignSlug wiring; markdown rendering of player
  recap).
- `src/persistence.ts` (FIELD_NAME_KEYS +
  payloadFieldNameKeyNamesDmField + pc-edit / bond-ratify /
  pc-create scrubber updates).
- `src/digest-draft-persistence.ts` (NEW module).
- `src/ui/regions/session-digest.ts` (campaignSlug prop +
  lifecycle hooks + persistence wiring).
- `src/ui/regions/chat-panel.ts` (btn-primary).
- `src/ui/regions/ai-panel.ts` (btn-primary).
- `src/ui/styles/quire-app.css.ts` (.card migration + topbar
  focus + brittle-class doc).
- `src/ui/styles/tokens.css.ts` (public token contract doc).

---

## What's queued for run #16 (PLAYTEST GREEN target)

### Consultant briefs to dispatch (2 in parallel)

- Adversarial review of run-#15 fixes (verify the critical
  fixes don't introduce new gaps).
- TTRPG/UX expert v3 (final GO/NO-GO call against the
  playtest-readiness bar).

### Lead work queue (run #16)

- INGEST 2 consultant reports.
- TRIAGE; if GREEN, no new work.
- If NEEDS-FIX:
  - Ship the SHORTEST set of fixes that close the GO call.
- If GREEN-light: ship the deferred visual #2-#5 as a single
  CSS diff:
  - Demote legacy `<h1>Quire</h1>` on idle.
  - Migrate `.session-bar` to tokens.
  - DM-operational surface variant.
  - 5 highest-density pill radii migration.
- Single-line P2 cleanup if time.
- Pre-playtest final sweep.

### Carry-over (not blocking)

- AI-2 (Anthropic cache_control) — queued for post-playtest
  unless adversarial flags as P1.
- AI-3 (live PC harm/stress in AI context) — queued.
- UX-6 (`dmGuidance` UI) — P2 post-playtest.
- AI e2e stale stubs (task #418).
- Resume-prompt enrichment (#429).

---

## Decisions pending the human (SHORT LIST)

None this run.

If the run #16 consultant reports surface a NO-GO call OR a
decision needing human input (e.g. "ship the playtest with
deferred items", "go to run #17"), it lands here.

---

## Health summary

- 🟢 WS-A format-stability + FC-2 narrowing + parity (DEC-032).
- 🟢 WS-B UX-5 digest draft persistence shipped.
- 🟢 WS-C UX-3 player routing shipped + DEC-033.
- 🟢 WS-D cloud backup E2E maintained.
- 🟡 WS-E AI integration — no changes this run.
- 🟡 WS-F visual polish — `.card` migration shipped; #2-#5
  deferred to run #16.
- 🟢 WS-G UI-iteration discipline — mock-10 + mock-09 production-
  path fix.

Run-budget consumed: 15 of expected 16.  **1 run remains** in
the user's hard cap before playtest GREEN escalation.

---

## Where to find things

- Master plan → `playtest-readiness-plan.md` (Appendix A is
  the run-#14 triage; Appendix B is run-#15)
- Format-stability contract → `format-stability.md`
- DEC-031 (run-#14 contract) + DEC-032 (run-#15 revision) +
  DEC-033 (run-#15 player auto-trigger) →
  `../save-restore-program/decisions.md`
- OP-045 RESOLVED → `../save-restore-program/open-problems.md`
- Consultant briefs (v1, v2, run-#15 adversarial) →
  `consultant-briefs/`
- Consultant reports → `review-history/`
- New module → `../../src/digest-draft-persistence.ts`
- Mock-campaign 10 doc →
  `../save-restore-program/simulations/mock-campaign-10-
  routing-and-drafts.md`
- Mock-campaign 10 test →
  `../../src/persistence.simulation-10-routing-and-drafts.
  test.ts`

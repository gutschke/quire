# Playtest-Readiness Program — Status

**Last updated:** 2026-05-30 run #14 (consultant ingestion +
P0/P1 fixes + visual CSS foundation + mock-09 + v2 briefs)
**Active workstreams:**
- WS-A (data-format forward-compat): EXTENDED this run
  (INV-EXTRA-LOOP + INV-RENAME-FIREWALL + DEC-031)
- WS-B (DM write-up phase): FINDING-E closed (digest reaches
  DM AI context); v2 brief queued
- WS-C (chargen polish): OP-045 closed; v2 brief queued
- WS-D (full backup E2E): maintained green; cloud-backup-e2e
  unaffected by run-#14 changes
- WS-E (AI integration): FINDING-E shipped; AI-2 (cache) +
  AI-3 (live PC state) deferred to next run
- WS-F (visual polish): FOUNDATION shipped (items 1-5 as
  single CSS diff); v2 brief queued for items 6-10
- WS-G (UI-iteration discipline): MOCK-09 shipped (WS-G
  validation walk for the visual pass)

**Latest deploy hash:** 6ac731b (run #14 ship)
**Branch:** main

---

## Run #14 — what shipped

### Phase 1 — Triage (Appendix A in playtest-readiness-plan.md)

All 4 consultant reports walked; every finding triaged with
priority + ship-target + owner. P0/P1 shipped this run; P2
+ next-run-lead items captured in the table.

### Phase 2 — P0 fixes (Forward-Compat architect findings)

**P0a — `extraFields` autosave loop fix (INV-EXTRA-LOOP).**

- `src/persistence.ts:serializeSession` + `serializeSessionForViewer`
  now accept an optional `extraFields` argument and re-emit it
  if non-empty.
- `applySaveToLog` surfaces the loaded doc's extraFields on
  `LoadResult` so the host can thread them back.
- `src/quire-app.ts:loadedExtraFields` stores the loaded value
  after `loadFromString` and threads it to every serialize
  call (`buildSaveDocument`, `buildShareableSaveDocument`, the
  backups-push-request handler). Cleared on `leaveSession`.
- 4 new tests in `src/persistence.format-stability.test.ts`
  under `INV-EXTRA-LOOP` pin the full loop (parse → apply →
  serialize → stringify) for DM coord save, DM projection,
  player projection, and greenfield-no-extraFields.
- `format-stability.md` updated with INV-EXTRA-LOOP block.

**P0b — Scrubber field-rename guard (INV-RENAME-FIREWALL).**

- `src/persistence.ts:PER_KIND_SCRUBBERS['pc-edit']` now also
  scans EVERY top-level string value for DM-only field-path
  names; any match drops the event. Defense-in-depth alongside
  the contract-level prohibition in DEC-031.
- DEC-031 logged in `decisions.md` — contract: renaming a
  sub-field key on an existing kind is FORBIDDEN.
- 5 new tests in `src/persistence.format-stability.test.ts`
  under `INV-RENAME-FIREWALL` pin: v:1 baseline drop, v:1
  pc-create scrub, v:2 path rename drop, v:2 dotted path
  drop, benign harm=2 survives, materialize no-op.
- `format-stability.md` updated with INV-RENAME-FIREWALL block
  + maintainer self-check addition.

### Phase 2 — P1 fixes

**P1a — OP-045 rename gap (TTRPG/UX Top-3 #1).**

- `src/character-edits.ts` — three new branches (name,
  pronouns, backstory) with caps matching `pc-create` (80 /
  40 / 8000). Empty pronouns clears the field; empty name +
  empty backstory are rejected.
- `src/ui/regions/dm-pc-detail.ts` — new `RenamePcCallback`
  type + `onRenamePc` prop + `identity` prop + `renameOpenField`/
  `renameDraft` @state + `renderRenameSection()` +
  `renderRenameRow()` rendering per-field disclosure-on-click
  editor.
- `src/quire-app.ts:renderDmPcDetail` wires `identity` (read
  from `effectiveCharacter`) + `onRenamePc` (`submitPcEdit`).
- Round-trip tests in `persistence.chargen-roundtrip.test.ts`
  FLIPPED from LOCKED-BROKEN to FIXED (9 new assertions
  covering valid edits, caps, type defense, round-trip).
- `character-edits.test.ts` "ignores unknown keys" updated to
  use truly-unknown keys; added "applies backstory edit"
  positive test.
- OP-045 marked RESOLVED in `open-problems.md` with full
  closure block.

**P1b — FINDING-E digest-in-AI-context (TTRPG/UX Top-3 #2 + AI auditor Top-3 #1).**

- `src/ai/campaign-context.ts:CampaignContextRequest` adds
  `priorDigests?: ReadonlyArray<string>` param.
  `buildCampaignContext` synthesizes a
  `session-digests/previously.md` file with a `# Previously`
  block when priorDigests is non-empty.
- `src/quire-app.ts:submitAiPrompt` reads
  `sessionView.filteredShared.sessionDigests` (firewall-safe
  source) and threads markdowns to `buildCampaignContext`.
- 5 new tests in `campaign-context.test.ts` under `FINDING-E`
  pin: emits Previously file, joins multiple digests in
  order, no-emit on undefined/empty, player-facing OK,
  firewall (no `dm/*` paths).
- 1 new test in `persistence.simulation-08-dm-writeup-phase.test.ts`
  asserts end-to-end FINDING-E with firewall check.

**P1c — Player "Previously" surface (TTRPG/UX Top-3 #3).**

- `src/quire-app.ts:renderSessionOpenStage` non-coord branch
  now renders a `.session-open-player-recap` card containing
  the last digest's markdown body when present. Falls back to
  the original "DM is re-orienting" placeholder when no
  digest exists.
- Reads from `filteredShared.sessionDigests` (firewall-safe).
- New test file `src/quire-app.player-digest-surface.test.ts`
  with 2 tests: renders with digest, falls back without.
- CSS for `.session-open-player-recap` + `.session-open-player-digest`
  shipped as part of the visual pass.

### Phase 3 — Visual CSS foundation pass (Visual Design items 1-5)

Single CSS-only commit shipping the highest-leverage 5:

- **Tokens (`src/ui/styles/tokens.css.ts`):** new
  `--r-pill`, `--shadow-card`, `--shadow-elev-1`,
  `--ring-focus`, `--button-bg`, `--button-bg-hover`,
  `--button-bg-primary`, `--button-ink-primary`.
- **Global `*:focus-visible`:** ring + 2px offset + chip
  radius. Previously only 7 hand-rolled outlines existed.
- **Global `button {}` reset:** font:inherit, cursor:pointer,
  consistent padding, hairline border, button-bg surface,
  hover transition. Previously every region rolled its own.
- **`.btn-primary`:** new accent-teal-filled variant for
  primary CTAs.
- **`.landing-hero` + `.landing-cta`:** new no-campaign
  landing — a centered max-560px hero card with primary
  Underleaf CTA, demoting the dense prose to a one-line muted
  footer. `quire-app.ts:renderIdle` rewires to use it.
- **Run-#14-specific surface classes:**
  `.session-open-player-recap`, `.session-open-player-digest`,
  `.dm-pc-rename-*` family — supports the new P1 surfaces.

### Phase 3.5 — Mock campaign 09 (UI findability — WS-G)

- Doc: `design/save-restore-program/simulations/mock-campaign-09-ui-findability.md`.
- Test: `src/persistence.simulation-09-ui-findability.test.ts`
  with 5 assertions: landing hero CTA reachable, DM
  session-open mode renders, player recap renders with digest
  body, player fallback without digest, button-hidden smoke
  check.

### Phase 5 — Consultant briefs v2 for run #15

- `consultant-briefs/visual-design-expert-v2.md` — re-audit
  the foundation pass + tell run #15 which of items 6-10 to
  ship next.
- `consultant-briefs/ttrpg-ux-expert-v2.md` — verify UX-1
  (OP-045), UX-2 (FINDING-E), UX-3 (player surface) closures
  + flag remaining gaps before playtest.
- `consultant-briefs/adversarial-run14-fixes.md` — new
  adversarial brief specifically targeting the 5 fixes
  shipped this run (the "trust-but-verify" cadence — run #13
  missed FC-1 + FC-2; the second pass must do better).

---

## Tests + baselines

- **Test count:** 3033 passed + 2 skipped = 3035 (up from
  3004 baseline at run #13; **+31 net this run**).
- **Test files:** 153 (up from 151).
- **Typecheck:** clean.
- **Build:** unverified (run before push).
- **No credentials in diff.**

### New / updated test files this run

- `src/persistence.format-stability.test.ts` (extended; +9
  tests: INV-EXTRA-LOOP × 4, INV-RENAME-FIREWALL × 5).
- `src/persistence.chargen-roundtrip.test.ts` (extended;
  LOCKED-BROKEN flipped to FIXED, +9 new asserts).
- `src/character-edits.test.ts` (extended; 1 fix + 1 new).
- `src/ai/campaign-context.test.ts` (extended; +5 FINDING-E
  tests).
- `src/persistence.simulation-08-dm-writeup-phase.test.ts`
  (extended; +1 FINDING-E assertion).
- `src/quire-app.player-digest-surface.test.ts` (NEW; 2
  tests).
- `src/persistence.simulation-09-ui-findability.test.ts`
  (NEW; 5 tests).

### Production-code touches this run

- `src/persistence.ts` (serializeSession + serializeSessionForViewer
  + applySaveToLog + pc-edit scrubber + LoadResult).
- `src/quire-app.ts` (loadedExtraFields + threading +
  renderSessionOpenStage non-coord branch + renderDmPcDetail
  identity wiring + renderIdle landing hero).
- `src/character-edits.ts` (name/pronouns/backstory branches
  + caps).
- `src/ui/regions/dm-pc-detail.ts` (rename UI).
- `src/ai/campaign-context.ts` (priorDigests + Previously
  block).
- `src/ui/styles/tokens.css.ts` (new tokens).
- `src/ui/styles/quire-app.css.ts` (foundation CSS block).

---

## What's queued for run #15

### Consultant briefs to dispatch (3 in parallel)

- Visual Design expert v2 (foundation pass re-audit + items
  6-10 prioritization).
- TTRPG/UX expert v2 (closure verification + playtest GREEN
  estimate).
- Adversarial review of run-#14 fixes (5 fixes, trust-but-
  verify cadence).

### Lead work queue (run #15)

- INGEST 3 consultant reports.
- TRIAGE findings into P0/P1/P2/NO-FIX.
- SHIP P0/P1 fixes.
- Items already-known to ship next run:
  - AI-2: Anthropic `cache_control` on system+tools prefix
    (P1, M-fix).
  - AI-3: Live PC state (harm/stress) injected into AI
    context (P1, M-fix; was already queued v1.1).
  - UX-5: Spoiler-edit-dialog + digest drafts surviving
    page-reload (P2).
  - UX-6: `dmGuidance` UI surface (P2).
  - VIS-6..10: Picked subset from visual v2 report.
- AI e2e stale stubs (task #418) — pending if time.

### Run #16 + contingency

- Round 3 of consultant iteration if needed.
- Final playtest-GREEN gate.
- Resume-prompt enrichment (#429).

---

## Decisions pending the human (SHORT LIST)

None this run.

If the run #15 consultant reports surface a decision needing
human input (e.g. "should the player rail also offer a PC
rename affordance?"), it lands here in run #16.

---

## Health summary

- 🟢 WS-A format-stability + INV-EXTRA-LOOP + INV-RENAME-FIREWALL.
- 🟢 WS-B DM write-up + FINDING-E closed; player surface shipped.
- 🟢 WS-C chargen polish + OP-045 RESOLVED.
- 🟢 WS-D cloud backup E2E maintained.
- 🟡 WS-E AI integration — FINDING-E closed; AI-2 + AI-3 queued.
- 🟡 WS-F visual polish — foundation shipped; items 6-10 queued
  on v2 review.
- 🟢 WS-G UI-iteration discipline + mock-09 walked.

Run-budget consumed: 14 of expected 16. **2 runs remain** in
the user's hard cap before playtest GREEN escalation.

---

## Where to find things

- Master plan → `playtest-readiness-plan.md` (Appendix A is
  the run-#14 triage table)
- Format-stability contract → `format-stability.md`
  (extended: INV-EXTRA-LOOP, INV-RENAME-FIREWALL)
- DEC-031 (run-#14 contract) → `../save-restore-program/decisions.md`
- OP-045 RESOLVED → `../save-restore-program/open-problems.md`
- Consultant briefs (v1) → `consultant-briefs/<role>.md`
- Consultant briefs (v2 + adversarial) →
  `consultant-briefs/<role>-v2.md`,
  `consultant-briefs/adversarial-run14-fixes.md`
- Consultant reports (v1) →
  `review-history/<role>-2026-05-30.md`
- Mock-campaign 09 doc →
  `../save-restore-program/simulations/mock-campaign-09-ui-findability.md`
- Mock-campaign 09 test →
  `../../src/persistence.simulation-09-ui-findability.test.ts`
- Player-digest-surface test →
  `../../src/quire-app.player-digest-surface.test.ts`

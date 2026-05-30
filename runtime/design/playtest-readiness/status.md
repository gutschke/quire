# Playtest-Readiness Program — Status

**Last updated:** 2026-05-30 run #13 (master plan + 4 consultant
briefs queued + WS-A/B/C/D autonomous work shipped)
**Active workstreams:**
- WS-A (data-format forward-compat): SHIPPED this run
- WS-B (DM write-up phase): mock campaign 08 SHIPPED; consultant
  brief queued
- WS-C (chargen polish): round-trip tests SHIPPED; OP-045 filed;
  consultant brief queued
- WS-D (full backup E2E): cloud-backup-e2e test SHIPPED
- WS-E (AI integration audit): consultant brief queued (no
  autonomous work this run; awaits report)
- WS-F (visual polish): consultant brief queued (zero autonomous
  changes per the discipline doc)
- WS-G (UI-iteration safety discipline): codified in the master
  plan §6

**Latest deploy hash:** (set at end of this run)
**Branch:** main

---

## Run #13 — what shipped

### Master plan + 4 consultant briefs (Step 1 + 2)

- `design/playtest-readiness/playtest-readiness-plan.md` (NEW)
  — master plan. North star, 8-concerns-map, 7-workstreams,
  sequencing, risks, UI-iteration safety playbook (WS-G),
  resumption protocol.

- `design/playtest-readiness/consultant-briefs/visual-design-expert.md`
  (NEW) — 500 words; visual-design / game-design expert
  briefed for the WS-F first-impression audit.

- `design/playtest-readiness/consultant-briefs/ttrpg-ux-expert.md`
  (NEW) — 500 words; TTRPG/UX expert briefed for chargen
  polish (WS-C) + DM write-up phase (WS-B) deep review.

- `design/playtest-readiness/consultant-briefs/forward-compat-architect.md`
  (NEW) — 600 words; forward-compat / data-format architect
  briefed to independently audit the format-stability work
  done in WS-A.

- `design/playtest-readiness/consultant-briefs/ai-integration-auditor.md`
  (NEW) — 500 words; AI integration auditor briefed for the
  AI write API + context + player-facing firewall pass.

### WS-A — Data format forward-compat lock SHIPPED

- `design/playtest-readiness/format-stability.md` (NEW) — the
  forward-compat contract.  7 invariants (INV-1 through
  INV-7).  Findings A-E catalog (1 RESOLVED, 2 NO ACTION, 1
  UNDER REVIEW, 1 DEFERRED for consultant).

- **`src/persistence.ts` extended** (`SaveDocument.extraFields`
  passthrough + `parseSaveDocument` preserves unknown top-level
  fields + `stringifySave` re-flattens them).  Defense: known-
  key collision is dropped; serialized output never contains
  the internal `extraFields` key.  Doc comments explicitly
  warn that the passthrough must NOT be used for known-DM-only
  data.

- **`src/persistence.format-stability.test.ts` (NEW)** — 18 tests
  pinning INV-1 through INV-7 + a defensive collision test.

### WS-B — DM write-up phase mock campaign SHIPPED

- `design/save-restore-program/simulations/mock-campaign-08-dm-writeup-phase.md`
  (NEW) — full scenario doc; 6 coverage scenarios.

- **`src/persistence.simulation-08-dm-writeup-phase.test.ts`
  (NEW)** — 9 tests pinning the digest lifecycle:
  authorship + save/restore round-trip, player-visible
  projection (firewall holds), byte-identical roundtrip,
  co-DM authorship after yield, non-coord rejection, invalid-
  payload rejection at materialize, forward-compat for future
  sub-fields (INV-2 cross-check), partition-then-rejoin
  delivers the digest, multi-session append-only ordering.

  FINDING-E (deferred): verifying the AI context plumbing
  actually INCLUDES the digest in prompt assembly is out of
  scope for this simulation; filed for the AI integration
  auditor brief.

### WS-C — Chargen polish round-trip tests SHIPPED

- **`src/persistence.chargen-roundtrip.test.ts` (NEW)** — 12
  tests covering:
  - pc-create full payload round-trip (name + pronouns +
    backstory).
  - Non-ASCII names + pronouns + backstory.
  - pc-create first-write-wins (locked).
  - applyCharacterEdits LOCKED-BROKEN behavior for name +
    pronouns + backstory (GAP-A / OP-045).
  - Numeric pc-edits (harm + stress) round-trip.
  - Player save firewall (DM-only dmNotes stripped).
  - Coord save preserves DM-only fields.
  - projectSaveForViewer strips DM-only sub-fields on
    restore-side.
  - Mid-chargen draft (chargen-pack-deliver) survives
    round-trip.
  - Full chargen flow byte-identical roundtrip.

- **OP-045 (NEW, P1) FILED** — `applyCharacterEdits` has no
  handlers for `name` / `pronouns` / `backstory`.  A player
  cannot rename their PC post-ratify with the events the engine
  currently supports.  Fix path 1: add three branches to
  `applyCharacterEdits` (~30 LOC).  Real-world playtest impact.
  Scheduled for run #14 alongside the TTRPG/UX consultant's
  findings.

### WS-D — Cloud backup E2E SHIPPED

- **`src/persistence.cloud-backup-e2e.test.ts` (NEW)** — 5
  tests driving a SUBSTANTIAL campaign (~500 events covering
  chargen, play, scene reveals, advancement, retire, co-DM
  transition, 2 session digests) through the FULL FsApiCloudPush
  push/pull pipeline.

  Asserts:
  - DM coord projection round-trips via cloud folder.
  - Player projection survives the full loop (firewall intact).
  - Cross-device probe (`listSavesInFolder`) discovers the
    file.
  - 0 unknownKinds on a substantial log.
  - Byte-identical roundtrip through the cloud folder hop.

### WS-G — UI-iteration safety discipline

- Codified in the master plan §6.  Re-validation gate (full
  `npm test` after any UI change), discoverability check (for
  chrome-only changes), post-change mock walk (which mock
  campaign covers which UI surface), and the consultant-approved
  bypass rule (still must re-validate).

---

## Tests + baselines

- **Test count:** 3002 + 2 skipped = 3004 (up from 2960
  baseline at run #12; **+44 new this run**).
- **Test files:** 151 (up from 147).
- **Typecheck:** clean.
- **Build:** clean (646KB main chunk; on par with prior runs).
- **No credentials in diff.**

### New test files this run

- `src/persistence.format-stability.test.ts` (18 tests)
- `src/persistence.simulation-08-dm-writeup-phase.test.ts` (9 tests)
- `src/persistence.chargen-roundtrip.test.ts` (12 tests)
- `src/persistence.cloud-backup-e2e.test.ts` (5 tests)

---

## What's queued for run #14

### Consultant report ingestion (parallel)

All 4 briefs are self-contained and ready to dispatch. The
parent will dispatch them in parallel. Reports land in
`design/playtest-readiness/review-history/<role>-YYYY-MM-DD.md`.

When run #14 starts:

1. Read the 4 consultant reports.
2. Triage findings into P0/P1/P2.
3. Ship P0/P1 fixes.
4. Especially: top 3-5 visual changes from the visual-design
   expert report, then run WS-G re-validation.
5. OP-045 chargen rename fix lands here.

### Already-known follow-ups

- **OP-045 (P1, run #13 filed)** — chargen rename gap. Fix
  path 1 (add handlers to `applyCharacterEdits`). ~30 LOC.

- **AI write API context plumbing** — the digest's appearance
  in next-session AI context is FILED for the AI integration
  auditor; the lead picks up any P0/P1 they surface.

- **Resume-prompt enrichment** (#429, M5 follow-up) — still
  queued.

### Subsequent runs (15-16)

- Second round of expert iteration (per the multi-expert
  iteration pattern memory).
- Any AI write API gaps.
- Final sweep + PLAYTEST GREEN gate.

---

## Decisions pending the human (SHORT LIST)

None this run.

If the visual-design expert or AI integration auditor
surface findings that need a human call (e.g. "the AI
spoiler-tact behavior is wrong by design, here are 2
alternatives"), they'll land here in run #14.

---

## Health summary

- All M6a-FS green status from run #12 maintained.
- 🟢 WS-A format-stability contract locked.
- 🟢 WS-B DM write-up mock campaign green.
- 🟢 WS-C chargen round-trip tests green; OP-045 filed.
- 🟢 WS-D cloud backup E2E green.
- 🟢 WS-G UI-iteration discipline codified.
- 🟡 WS-E AI integration audit — consultant brief queued.
- 🟡 WS-F visual polish — consultant brief queued.

---

## Where to find things

- Master plan → `playtest-readiness-plan.md`
- Format-stability contract → `format-stability.md`
- Consultant briefs → `consultant-briefs/<role>.md`
- Consultant reports → `review-history/<role>-YYYY-MM-DD.md`
  (none yet)
- Mock-campaign 08 doc →
  `../save-restore-program/simulations/mock-campaign-08-dm-writeup-phase.md`
- Mock-campaign 08 test →
  `../../src/persistence.simulation-08-dm-writeup-phase.test.ts`
- Chargen round-trip tests →
  `../../src/persistence.chargen-roundtrip.test.ts`
- Cloud backup E2E →
  `../../src/persistence.cloud-backup-e2e.test.ts`
- Format-stability tests →
  `../../src/persistence.format-stability.test.ts`
- OP-045 →
  `../save-restore-program/open-problems.md`

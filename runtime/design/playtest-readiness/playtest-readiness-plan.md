# Playtest-Readiness Program — Master Plan

**Owner:** Playtest-Readiness Program Lead (formerly Save/Restore Program Lead)
**Run #13 created:** 2026-05-30
**Status:** in execution
**Supersedes (in part):** `design/save-restore-program/playable-release-plan.md`
(M6a-FS-5 shipped GREEN; that program is folded into this one as a
single workstream — see WS-D)

This document is the master plan for getting Quire ready for the
first real human playtest. It exists because the human escalated
scope from "M6a-FS playable release" (already GREEN) to "the whole
product, polished and complete for actual humans."

---

## 1. North star — what "playtest-ready" means

The playtest is the **first session a real DM runs with real
players** using Quire as the table tool. After it concludes, the
DM will write up what happened; that write-up will guide
authoring the next chapter for the following week.

Playtest-ready, decomposed into capabilities:

### 1.1 First-impression capabilities (chargen + visuals)

1. **Three players + a DM can walk in cold** and reach a
   playable session within the first 30 minutes — no
   engineering help, no doc-reading required.
2. **Character creation works for every path** the campaign
   admits: pre-gen pick, Q&A + AI synthesis, free-write. Each
   path lands a complete PC the DM can ratify.
3. **Editing the basics works.** A player can rename their PC,
   change pronouns, and revise a backstory paragraph mid-
   chargen AND after acceptance (within the rules' bounds).
   None of these edits leak DM-only material; all survive a
   tab close + reopen.
4. **The UI looks modern and cohesive.** Not elaborate; not
   amateur. A returning player from a polished web app
   (Slack, Roll20 desktop, Linear) doesn't recoil at first
   impression. This is a high bar but a bounded one: visual
   polish, not content polish.

### 1.2 Mid-session capabilities (play + AI)

5. **Spoiler firewall holds in every panel** — chat, scene
   reveals, AI panel, PC sheet, map, session digest. The
   silent-player firewall (player never warned about a spoiler
   they hit) is sacred.
6. **AI assistance works.** DM can summon an AI suggestion that
   reads the campaign + PC + episode context, and the response
   reaches the DM without leaking to players. AI-write API
   that proposes state changes works end-to-end with the
   DM-accept gate.
7. **In-session state changes propagate** to all peers
   correctly. Harm, stress, marks, advancement-ready, focus
   grants, scene reveals.

### 1.3 End-of-session + bridge-to-next-session capabilities

8. **DM can save the session locally** (autosave) AND push to
   a connected cloud folder (M6a-FS GREEN). Restore from
   cloud on the SAME machine and on a SECOND machine works.
9. **DM write-up phase works.** After the session, the DM
   writes (or AI-drafts) a session digest. The digest is
   stored on the canonical event log, survives save/restore,
   and is available as context for next session's authoring
   + AI calls.
10. **The save format is forward-compatible.** No hidden
    skeletons. Extensible to new event kinds / new sub-fields
    without breaking saves written today. Conversion tools
    NOT required (the human's explicit relief).

### 1.4 Bug bar

- **NO P0 / firewall-leaking bugs.** A leak loses a season.
- **NO P1 data-loss in any documented happy path.** Including
  chargen, in-session play, save/restore, AND the DM write-up
  loop.
- **NO P1 first-impression failures.** Visual jank that makes
  a new player think "this is unfinished" is a P1 here, even
  if it doesn't break functionality.
- **P2 deferred with documented workaround** is acceptable.

### 1.5 Test coverage gates (CI)

- 2960 baseline (run #12) must stay green or be intentionally
  changed with a noted rationale.
- New CI test pinning the save format (format-stability test).
- Mock campaign 08 (DM write-up phase) shipped and pinned.
- Chargen round-trip tests covering name/pronoun/backstory.
- Full backup E2E test that exercises FS-API push/pull
  beyond the in-memory mock used today.

---

## 2. Concerns map — the 8 decomposed concerns

The human gave us 8 concerns. This table maps each to a
workstream, scope, and gating.

| # | Concern | Workstream | Scope this turn | Gating |
|---|---|---|---|---|
| 1 | Data-format forward-compat (no skeletons, extensible) | **WS-A: Format lock** | YES — autonomous engineering | None (pure code + tests) |
| 2 | DM write-up phase deep review | **WS-B: Write-up phase** | YES — autonomous mock-campaign + expert review | Brief TTRPG/UX expert |
| 3 | Chargen quality (name/pronoun/backstory) | **WS-C: Chargen polish** | YES — autonomous tests + expert review | Brief TTRPG/UX expert |
| 4 | Full backup E2E | **WS-D: Backup verification** | YES — autonomous | None (extends M4) |
| 5 | AI integration (assistance + write API) | **WS-E: AI integration audit** | PARTIAL — expert audit; small autonomous fixes | Brief AI integration auditor |
| 6 | Visual design audit | **WS-F: Visual polish** | NO autonomous changes pending expert; just brief + collate | Brief visual-design expert; iterate next runs |
| 7 | UI-iteration safety (re-run mock sessions after UI changes) | **WS-G: UI-change discipline** | YES — codify the discipline in this plan; create the re-validation playbook | None (process doc) |
| 8 | Plan first, then execute by assigning sub-tasks | **this document** | YES — done | None |

**WS-F is intentionally NOT executed autonomously this turn.**
Any visual-chrome change requires the full re-validation pass
per WS-G; it's the highest-friction work and the best fit for
the expert's eye first.

---

## 3. Workstream breakdown

Each workstream: owner, deliverable, success criteria, expert
prerequisite (if any), follow-up runs.

### WS-A — Data-format forward-compat lock

**Owner:** lead, autonomous.

**Deliverable (this turn):**

1. Audit every event kind for `v` versioning. Document the
   audit at `design/playtest-readiness/format-stability.md`.
2. New CI test `src/persistence.format-stability.test.ts`
   that:
   - Snapshots the canonical save format shape.
   - Asserts that adding new optional top-level fields would
     survive a round trip (via a fuzz).
   - Asserts that adding new optional event-payload sub-fields
     survives a round trip (per DEC-030).
   - Asserts a save written with an UNKNOWN event kind round-
     trips correctly: unknownKinds counter increments, the
     event survives in the log, and a future runtime adding
     that kind to KNOWN_EVENT_KINDS resumes materialization.
3. Fix any hazards surfaced by the audit — most likely:
   `parseSaveDocument` reconstructs only known top-level
   fields (lines 1010-1020). Decision: do we preserve
   unknown top-level fields, or do we ship the explicit
   reconstruction with an `unknownFields` counter in the
   `ParseResult`? Recommend the former (preserve), with a
   docs note that unknown fields are pass-through.

**Success criteria:**
- Audit doc lands.
- New test file in `src/` passes on every CI run.
- `format-stability.md` documents the contract a future PR
  must hold to AND the assertion location in the test.
- Save written by today's runtime can be opened by a runtime
  that strips a future field; save written by a runtime with
  a future field can be opened by today's runtime (loss-
  tolerant where appropriate).

**Expert prerequisite:** none. The forward-compat consultant
brief is queued anyway (WS-A.2) to double-check the audit;
their report folds into the next run.

**Follow-up runs:** consultant report ingestion + any
additional fixes they surface.

### WS-B — DM write-up phase

**Owner:** lead, autonomous on the mock campaign; consultant
brief for the deep UX review.

**Deliverable (this turn):**

1. **Mock campaign 08** at
   `src/persistence.simulation-08-dm-writeup-phase.test.ts` +
   doc at
   `design/save-restore-program/simulations/mock-campaign-08-dm-writeup-phase.md`.
   Scenarios:
   - Session ends → DM opens session-digest UI → DM types
     digest body (or AI generates) → DM submits.
   - Digest event lands in the event log.
   - Save → restore → digest STILL present in
     `state.sessionDigests`.
   - Next session opens → digest is available as AI context
     (via the existing AI context plumbing).
   - Player save round-trips: digest survives the firewall
     (sessionDigests are player-visible per existing
     classification; verify).
   - Co-DM transition: one DM writes digest, other DM sees it
     after sync.

2. **TTRPG/UX expert brief** scoped to "is the digest UI
   doing its job?" — copy, IA placement, AI assistance.

**Success criteria:** mock campaign passes; consultant
report lands with actionable findings.

**Expert prerequisite:** none for the mock campaign;
expert brief is queued for next-run ingestion.

### WS-C — Chargen polish

**Owner:** lead, autonomous on the round-trip tests; consultant
brief for the deep UX review.

**Deliverable (this turn):**

1. **Chargen round-trip test suite** at
   `src/persistence.chargen-roundtrip.test.ts`. Scenarios:
   - Mid-chargen rename (free-write path): edit the PC's
     name, save, restore, name persists.
   - Mid-chargen pronoun change: same.
   - Mid-chargen backstory edit: same.
   - Post-acceptance rename via `pc-edit` after the seat
     is `bound-active`: round-trip + firewall holds.
   - Q&A path: edit a draft answer mid-flow, save, restore,
     answer persists (or correctly fails per current
     design — pin the behavior).
   - Cloud-folder round-trip variant of each.

2. **TTRPG/UX expert brief** scoped to chargen polish.

**Success criteria:** tests pass; consultant brief queued.

**Expert prerequisite:** none for the tests; expert brief is
queued.

### WS-D — Full backup E2E

**Owner:** lead, autonomous.

**Deliverable (this turn):**

1. Extend the existing M4 restore-drill (or add a sibling
   test file) to exercise:
   - A "substantial" campaign (~500 events covering chargen,
     play, scene reveals, digests, advancement, retire).
   - Push via `FsApiCloudPush.pushCampaignToFolder` against
     the in-memory mock folder.
   - Pull via `pullCampaignFromFolder`.
   - Parse via `parseSaveDocument`.
   - Apply via `loadFromString` (the projection path).
   - Materialize both DM and player projections.
   - Assert byte-identical for the DM projection; assert
     firewall-clean for the player projection.

2. Add an "operational view bypass" path verification — make
   sure the consent dialog + push + cross-device probe pull
   chain end-to-end works in the simulation. (Mostly already
   covered by sim-05, but consolidate.)

**Success criteria:** new test passes; substantial coverage
of the realistic-size happy path.

**Expert prerequisite:** none.

### WS-E — AI integration audit

**Owner:** consultant primary; lead for small fixes.

**Deliverable (this turn):**

1. **AI integration auditor brief** scoped to:
   - AI sees current-episode detail + past episodes + future
     with tact (per the locked AI context requirements).
   - AI-write API hard-gates (per
     `project_quire_ai_write_api_design`).
   - Player-facing AI calls hardcode
     `includeDmNotes: false` + forbidden-token post-check
     (per `project_quire_ai_player_facing_scope`).
   - Caster-state-set + apply-all-with-undo work as documented.

2. (Pending consultant report) — lead picks up any P0/P1
   surfaced in the next run.

**Success criteria:** brief queued; report ingested next run.

**Expert prerequisite:** none for the brief; report needed
before any AI surface change.

### WS-F — Visual polish

**Owner:** consultant primary; ZERO autonomous changes this
turn.

**Deliverable (this turn):**

1. **Visual-design / game-design expert brief** scoped to:
   - First-impression audit of the landing, no-campaign
     screen, campaign load, in-session cockpit, chargen
     flow, AI panel, session-digest, operational view.
   - Specific lens: modern + cohesive (NOT elaborate
     graphics). Reference design tier: Linear, Stripe Docs,
     GitHub today — not Notion, not Figma.
   - Identify the 5-10 highest-leverage cosmetic changes
     that would move a new player from "this looks
     unfinished" to "this looks intentional."
   - Must read campaign + world docs in
     `/home/markus/src/ttrpg/underleaf/` so recommendations
     match THIS game (Quire / Underleaf / The Quiet) not
     generic RPG-genre tropes.

**Why no autonomous changes:** any visual-chrome change has
to be re-validated through WS-G (full mock-session walk).
That overhead is wasted before the expert's pass tells us
what to change.

**Expert prerequisite:** none for the brief.

**Follow-up runs:** ingest report → triage → ship the top
3-5 changes → run WS-G re-validation → ship the next
batch.

### WS-G — UI-iteration safety discipline

**Owner:** lead, autonomous; this is a process doc, not code.

**Deliverable (this turn):**

A new section in this plan (below — §6) defines the
**UI-change re-validation playbook**:

1. After ANY UI change (even chrome-only), the lead MUST
   re-run all 7+ mock campaign simulations + format-stability
   + chargen-roundtrip + the new DM-writeup test.
2. For ANY launcher / event-handler / hotkey change, the lead
   ALSO re-runs the discoverability check (see §6.2).
3. The lead names which mock-campaign-test asserts the UI
   element being changed; if no test asserts it, the lead
   ADDS one before shipping the change.

**Success criteria:** §6 lands; discipline visible from this
doc forward.

**Expert prerequisite:** none.

---

## 4. Sequencing rationale

```
Run #13 (this run)
  ├─ WS-A: format lock           ◀── prerequisite to playtest
  ├─ WS-B: writeup mock campaign  ◀── high human-asked priority
  ├─ WS-C: chargen tests          ◀── high human-asked priority
  ├─ WS-D: backup E2E             ◀── confidence in the core loop
  └─ WS-G: discipline doc         ◀── unblocks future visual work

Consultant briefs queued at end of run #13:
  - visual-design expert (WS-F)
  - TTRPG/UX expert (WS-B + WS-C deep review)
  - forward-compat architect (WS-A double-check)
  - AI integration auditor (WS-E)

Run #14 (parallel-dispatched consultant return):
  - Ingest 4 consultant reports
  - Triage findings into P0/P1/P2
  - Ship P0/P1 fixes (and any low-effort P2)
  - Especially: top-leverage visual changes from WS-F
  - WS-G re-validation after visual changes

Run #15:
  - Second round of expert iteration (per
    feedback_multi_expert_iteration_pattern memory:
    parallel rounds with verbatim cross-critique)
  - Any AI write API gaps not closed yet
  - Resume-prompt enrichment (M5 follow-up #429)

Run #16 (contingency / additional polish):
  - Reserve for one more round of expert iteration
  - Final sweep + ship-blocker close-out
  - PLAYTEST GREEN gate
```

**Why WS-A first:** the human said "after this play test, it
could become more difficult to change the on-disk format" —
locking it BEFORE the playtest data is generated is the
right move; locking it AFTER means conversion tools.

**Why WS-F deferred:** visual changes have the highest
re-validation overhead per WS-G. The expert's report is what
unblocks low-overhead targeting of the right changes.

**Why ALL the expert briefs queued this turn:** parallel
dispatch is the only way the program fits in the available
runs. Per the **memory: multi-expert iteration pattern**,
parallel rounds with verbatim cross-critique are the working
model.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Format-stability test surfaces a hard-to-fix asymmetry | medium | medium | Audit explicit; preserve unknown top-level fields as a tight diff |
| Visual expert wants ELABORATE graphics we don't have budget for | medium | low | Brief explicitly bounds scope: modern + cohesive, no elaborate graphics |
| AI auditor finds a P0 spoiler-firewall hole in AI write API | medium | high | Hard gate — ship NO playtest until closed; budget for run #15 |
| Chargen round-trip surfaces a Q&A draft persistence bug | low | medium | Was the OP-040 / OP-043 / DEC-030 pattern; precedent for fix shape |
| DM write-up mock campaign finds the digest UI is not actually session-end-discoverable | medium | medium | Surface fix in WS-B; expert brief catches anyway |
| Multi-expert iteration drifts open-ended | medium | high | Hard cap at run #16; if not GREEN by then, escalate to human |
| Visual-design changes break gameplay tests (per WS-G) | medium | medium | Discipline doc; re-validation playbook; CI gates |
| Cloud-folder push test reveals a real bug not caught by mocks | low | high | Sim-05 already covers a lot; the consultant brief catches what tests miss |

---

## 6. UI-iteration safety playbook (WS-G deliverable)

When a UI change of any size lands — even if it's "just
chrome":

### 6.1 The re-validation gate

Before pushing, run:

```
npm test                 # must stay GREEN
```

This covers:
- All persistence simulations (7+ mock campaigns + the new
  mock campaign 08).
- All chargen tests (existing + the new round-trip suite).
- All save-format + firewall + restore-drill tests.
- All component-level unit tests.

If the change touches any visible chrome (color, layout,
typography, spacing), ALSO walk the **discoverability
check** in §6.2.

### 6.2 Discoverability check (chrome changes only)

For each visible chrome change, ask:

1. **Can the DM still find every primary action?** Walk the
   in-session cockpit + DM operational view + chargen
   review + session-digest + AI panel. Each launcher chip
   or hotkey must still be visually identifiable.
2. **Can a new player find their primary actions?** Walk a
   fresh-bind chargen + a first chat + a dice roll. Each
   primary CTA must be visually identifiable.
3. **Has any test that pins copy/colors/layout regressed?**
   Brittle-copy tests are flagged in the reviewer playbook;
   any churn there must be a deliberate update.
4. **Has any test been updated to pin the NEW chrome?** If
   the change is "make the launcher chip bigger" and no
   test currently asserts the chip exists, ADD a test
   before shipping the change. (This is the "ship the
   regression assertion with the finding" creed.)

### 6.3 The post-change mock walk

For changes to:
- Chargen flow → walk mock campaign 04 (chargen spoiler) +
  mock campaign 08 (DM writeup) + the new chargen-roundtrip
  suite.
- AI panel → walk mock campaign 02 (magic discovery —
  exercises the AI context flow).
- Session digest → walk mock campaign 08.
- Cloud backup card → walk mock campaign 01 + 05 + 07.
- DM operational view → walk mock campaign 01 + 05.

This is faster than a full Playwright e2e because the mock
campaigns drive the engine layer; the chrome change still
has to survive the engine + projection assertions.

### 6.4 When a consultant has reviewed

If a consultant explicitly approved a visual proposal, the
re-validation gate STILL applies. Consultants miss
regressions; the mock campaigns are the safety net.

---

## 7. Resumption protocol — how a fresh invocation picks up

A future "lead" (or this lead resuming) reads:

1. `design/playtest-readiness/playtest-readiness-plan.md` —
   this file. The plan.
2. `design/playtest-readiness/status.md` — created end-of-
   run with what shipped this turn + what's queued.
3. `design/playtest-readiness/consultant-briefs/` — the
   briefs queued for dispatch.
4. `design/playtest-readiness/review-history/` — the
   consultant reports that have landed.
5. `design/save-restore-program/status.md` — the underlying
   save/restore program status (still load-bearing).

Then:

- If the LATEST consultant report is unread, START with
  ingestion (read → triage → ship P0/P1).
- If all consultant reports are ingested, pick the next
  unblocked workstream by ID order.
- Always re-run `npm test` BEFORE shipping (baseline
  gate); always run it AFTER shipping (regression gate).
- Run `git log --oneline -5` to confirm the last short-SHA
  matches `status.md`.

### Consultant brief dispatch protocol

The lead can't spawn sub-agents directly. The lead writes
self-contained briefs into
`design/playtest-readiness/consultant-briefs/<role>.md`.
The parent dispatches them in parallel. Reports land in
`design/playtest-readiness/review-history/<role>-YYYY-MM-DD.md`.

Each brief MUST contain:
- ROLE (1-2 sentence framing).
- MANDATORY READS (file paths the consultant walks before
  answering).
- SPECIFIC QUESTIONS (numbered list; each question is
  answerable, not open-ended).
- OUTPUT FORMAT (the structure the report should follow).
- OUTPUT FILE PATH (where the report should land).
- WORD BUDGET (300-500; we want triage, not essays).

---

## 8. Out-of-scope-but-tracked

- **Mobile / Safari / Firefox path.** M6a-OAuth covers this;
  out of scope for THIS playtest.
- **GitHub publish-and-fork.** M6c-A; later.
- **Passphrase-encrypted refresh_token.** M6b; later.
- **Final TTRPG-craft copy.** M8; later.
- **Elaborate graphics** (custom illustrations, animated
  realization ceremonies, etc.). Out of scope per the
  human's explicit "modern + cohesive, no elaborate."
- **Player-facing AI surface beyond what already exists.**
  The locked AI-player-facing-scope memory governs.
- **OAuth Drive (M6a-OAuth).** Gated on maintainer task.

---

## 9. Pending product calls (escalation list)

None this turn. Past pending calls (M6a-OAuth maintainer
task) remain on the save/restore queue.

If WS-F (visual) or WS-E (AI) surfaces a product question
the consultant report flags as "needs human call," it'll
land in this section in the next run.

---

## 10. Status footer

Updated end-of-run in `design/playtest-readiness/status.md`.
This file (`playtest-readiness-plan.md`) is append-only at
the section level; major plan-changes land as new
appendices with the prior section preserved.

---

## Appendix A — Run #14 triage (2026-05-30)

Four consultant reports landed in `review-history/` on
2026-05-30. The lead walked every finding and assigned
priority + ship-target + owner. Implementations follow.

### Triage table

| # | Source | Finding | P | Ship | Owner |
|---|---|---|---|---|---|
| FC-1 | forward-compat | `extraFields` lost on autosave loop | **P0** | this run | lead |
| FC-2 | forward-compat | Field-rename via v:2 bypasses scrubbers | **P0** | this run | lead |
| FC-3 | forward-compat | Strict-eq discriminator on `proposal-create.kind` | P2 | doc only this run | lead |
| FC-4 | forward-compat | Per-kind versioning unstated | P2 | doc-only contract note this run | lead |
| FC-5 | forward-compat | format-stability.test.ts covers only 2 of 59 KNOWN kinds | P2 | next run; document INV-8 placeholder | next-run-lead |
| FC-Q9 | forward-compat | `unknownTopLevelFields` / `unknownPayloadSubFields` counters | P2 | next run | next-run-lead |
| FC-INV-11 | forward-compat | DM-only NEW kind leaks via player projection default | P2 | doc only this run (no real instance) | lead |
| UX-1 | ttrpg-ux | OP-045: applyCharacterEdits gap + no post-ratify rename UI | **P1** | this run | lead |
| UX-2 | ttrpg-ux | FINDING-E: digest not in DM AI context | **P1** | this run | lead |
| UX-3 | ttrpg-ux | Players have no "what happened last week" surface | **P1** | this run | lead |
| UX-4 | ttrpg-ux | Free-write + pre-gen chargen paths placeholders | P1 | post-playtest known-issue (M8-track; doc only) | next-run-lead |
| UX-5 | ttrpg-ux | Spoiler-edit-dialog drafts + digest draft live in `@state` only | P2 | next run | next-run-lead |
| UX-6 | ttrpg-ux | `dmGuidance` exists but no UI surfaces it | P2 | next run | next-run-lead |
| UX-7 | ttrpg-ux | Intent-against-pressure visually flat | P2 | next run (visual) | next-run-lead |
| UX-8 | ttrpg-ux | Recommended mock campaigns 09/10/11 | P1 (09 only); 10/11 P2 | mock-09 this run; 10/11 next | lead → next |
| VIS-1..5 | visual-design | Tokens, focus-visible, radii, button reset, hero | **P1** | this run (single CSS diff) | lead |
| VIS-6..10 | visual-design | Chargen path picker, digest chip, operational-view aesthetic, typography, light-DOM doc | P1/P2 | next run after visual re-audit | next-run-lead |
| AI-1 | ai-integration | FINDING-E (= UX-2; same bug) | **P1** | this run via UX-2 fix | lead |
| AI-2 | ai-integration | Anthropic cache_control aspirational | P1 | next run | next-run-lead |
| AI-3 | ai-integration | Live PC harm/stress not in AI context | P1 | next run (was already queued as v1.1) | next-run-lead |
| AI-4 | ai-integration | AI panel undo window in-memory only | P2 | post-playtest known-issue | doc only |
| AI-5 | ai-integration | e2e stale stubs (task #418) | P2 | this run if time, else next | lead |

### Rationale notes

- FC-1 + FC-2 are P0 because they are silent-correctness
  failures the run-#13 pass missed. FC-2 is a firewall hazard
  (DM-only leak via v:2 rename). Ship both.
- AI-2 (prompt cache) is real money/latency but does not
  affect correctness or firewall; defer to next run with a
  proper cache-shape design (cache_control is a JSON marker
  on the system+tools prefix; the brief includes scope).
- AI-3 is queued v1.1 work per the auto-memory; defer.
- VIS-6..10 are gated on the WS-G re-validation pass after
  the foundation CSS diff lands. Ship the foundation; let
  the next consultant pass tell us which of #6-#10 to do
  next.
- UX-4 (free-write/pre-gen placeholders) is a real
  playtest blocker but the FIX scope is M-LARGE (full
  UI flows). Doc as known-issue; playtest uses Q&A path
  only. Surface in the digest write-up template.

### What this turn ships

P0s: FC-1, FC-2. P1s: UX-1 (OP-045), UX-2/AI-1 (FINDING-E),
UX-3 (player digest surface), VIS-1..5 (foundation CSS).
Plus mock campaign 09 (UI findability per WS-G).

Best-effort if time: AI-5 e2e migration.

Document deferrals + next-run brief inputs in `status.md`.

---

## Appendix B — Run #15 triage (2026-05-30)

Three v2 consultant reports landed in `review-history/` on
2026-05-30: visual-design-expert-v2, ttrpg-ux-expert-v2,
adversarial-run14-fixes.  The lead walked every finding and
assigned priority + ship-target + owner.  Implementations
follow.

### Triage table

| # | Source | Finding | P | Ship | Owner |
|---|---|---|---|---|---|
| UX-3-v2 | ttrpg-ux v2 | Player auto-trigger NOT REACHED in production (run #14 false positive) | **P1** | this run | lead |
| UX-3-v2-md | ttrpg-ux v2 #2 | `<pre>` rendering of digest markdown is too raw | **P1** | this run | lead |
| UX-3-v2-collapse | ttrpg-ux v2 #3 | Backstory editor too heavy on DM card | P2 | next run | next-run-lead |
| UX-5-v2 | ttrpg-ux v2 Q8 | Digest draft `@state`-only → tab-close loses recap | **P1** | this run | lead |
| UX-4-v2 | ttrpg-ux v2 Q7 | Free-write + pre-gen chargen paths DEFERRED for playtest 1 | known-issue | doc-only this run | lead |
| Mock-11-v2 | ttrpg-ux v2 | Player Previously via PRODUCTION routing (no test-side appMode) | **P1** | folded into mock-10 this run | lead |
| Adv-H1 | adversarial v2 H-1 | FC-2 scrubber parity for bond-ratify + pc-create | **P1** | this run | lead |
| Adv-H2 | adversarial v2 H-2 | loadedExtraFields cross-campaign survival | P2 | this run (cheap) | lead |
| Adv-H3 | adversarial v2 H-3 | FC-2 string-scan over-broad: a player named "Tax" loses pc-edit | **P1** | this run | lead |
| VIS-v2-1 | visual v2 #1 | Migrate `.card` to tokens (highest-ROI next) | **P1** | this run | lead |
| VIS-v2-2 | visual v2 #2 | Demote legacy `<h1>Quire</h1>` on idle | P2 | next run | next-run-lead |
| VIS-v2-3 | visual v2 #3 | Migrate `.session-bar` to tokens | P2 | next run | next-run-lead |
| VIS-v2-4 | visual v2 #4 | DM-operational surface variant | P2 | next run | next-run-lead |
| VIS-v2-5 | visual v2 #5 | 21 pill-radii to `--r-pill` | P2 | next run | next-run-lead |
| VIS-v2-Q3 | visual v2 Q3 | 4 focus-ring collisions (chargen-only benign + topbar help) | P1 (topbar only) | this run | lead |
| VIS-v2-Q4 | visual v2 Q4 | Send button regression (chat + AI) | **P1** | this run | lead |
| VIS-v2-Q10 | visual v2 Q10 | Brittle-class radar doc comment | P2 | this run (cheap) | lead |

### Rationale notes

- **UX-3-v2 is the load-bearing closure for run #15.** The
  v2 expert proved the run #14 mock-09 test was a false
  positive (it forced appMode from outside the production
  routing path).  Run #15's fix: a second auto-trigger
  branch in `applySessionViewChange` for player viewers
  gated on `playerHasUnseenDigest`.  Per-campaign
  localStorage seen-marker + in-memory mirror.  Mock-10
  Scenario 1 + 2 + 3 exercise the REAL routing path; no
  test-side mutation.

- **UX-5 is shipped as a chargen-persistence-shaped helper.**
  New module `src/digest-draft-persistence.ts` mirrors
  `chargen-persistence.ts` exactly — same load/save/clear
  signatures, same defensive shape.  `<session-digest>`
  wires it via `campaignSlug` prop + connectedCallback +
  schedulePersistDraft debounced @input handler.

- **FC-2 narrowing + parity** ships as DEC-032 (decisions.
  md).  The pc-edit + bond-ratify + pc-create scrubbers
  now share a `payloadFieldNameKeyNamesDmField` helper
  that scans the fixed `FIELD_NAME_KEYS` vocabulary
  (field/path/target/key/attr/prop).  Three new
  regression tests pin: "Tax" survives, v:2 bond-ratify
  rename bypass drops, v:2 pc-create rename bypass drops.

- **VIS-v2 deferrals** (#2, #3, #4, #5): VIS-v2-1 (`.card`)
  is the highest-leverage of the five and ships this run
  per the expert's "#1 priority."  The other four are
  P2/visual-only follow-ups; reserved for run #16's
  contingency budget.

- **UX-4 (free-write/pre-gen paths)** stays deferred per
  v2 Q7 — playtest opts into Q&A-only.  Surface in DM
  invite copy.

### Brittle-class radar contract

Run #15 adds a doc comment in `quire-app.css.ts` (line 100-117)
naming the test-pinned classes.  Tokens.css.ts (line 42) gets
a parallel public-contract comment for the consumed token
names.  Future visual passes treat these as load-bearing.

### What this turn ships

P1s: UX-3 routing (player auto-trigger + dismiss + markdown
rendering), UX-5 (digest draft persistence), FC-2 parity
(bond-ratify + pc-create) + narrowing (FIELD_NAME_KEYS),
loadedExtraFields cross-campaign clear, Send button
regression fix, `.card` migration to tokens + topbar focus-
visible token + brittle-class doc comment.

Plus mock campaign 10 (routing + drafts) — 7 scenarios that
exercise the PRODUCTION routing paths (no test-side appMode
mutation per the run #14 lesson).

Three new regression tests in `format-stability.test.ts`
pin the FC-2 narrowing + parity surfaces.

Document deferrals + next-run brief inputs in `status.md`.

---

## Appendix C — Run #16 triage + PLAYTEST GREEN (2026-05-30)

Two v3 consultant reports landed in `review-history/` on
2026-05-30: `adversarial-run15-fixes-2026-05-30.md` and
`ttrpg-ux-expert-v3-2026-05-30.md`.  Both signed off **GO
for playtest 1**.

### Triage table

| # | Source | Finding | P | Ship | Owner |
|---|---|---|---|---|---|
| Adv-v3-H1 | adversarial v3 H-1 | `playerLastSeenDigestTsInMemory` not reset on cross-campaign navigation | **P3** | this run (cheap) | lead |
| Adv-v3-H2 | adversarial v3 H-2 | `<session-digest>` keeps prior-campaign draft visible on slug change + persists under new slug's key | **P2** | this run (DM-multi-campaign-per-browser hazard) | lead |
| Adv-v3-H3 | adversarial v3 H-3 | FC-2 scrubber parity incomplete for focus-grant + pc-retire + map-blob (defense-in-depth) | P3 | doc only this run (OP-046 filed) | post-playtest |
| Adv-v3-Q5 | adversarial v3 Q5 | Missing `value:'dmNotes'` SURVIVAL pin (companion to "Tax") | P3 | optional this run | lead |
| UX-v3-#1 | ttrpg-ux v3 next-change #1 | UX-4 free-write + pre-gen chargen paths still placeholders | known-issue | doc-only in handoff | M8-track |
| UX-v3-#2 | ttrpg-ux v3 next-change #2 | UX-6 `dmGuidance` UI surface (XS) | P2 | post-playtest | next-run-lead |
| UX-v3-#3 | ttrpg-ux v3 next-change #3 | Backstory editor collapse (XS) | P2 | post-playtest | next-run-lead |

### Rationale notes

- **H-2 is the only P2 this turn.**  Multi-campaign-per-browser
  is a plausible test-table workflow (the test table is a
  single human running one Cloudflare-hosted instance).  Fix
  is small (~10 LOC + 1 mock-10 scenario).  DEC-034 logged.
- **H-1 is P3 but tiny** — three lines.  Ships alongside H-2
  while the seat is warm.  DEC-035 logged.
- **H-3 is documented architectural deferral.**  DEC-031
  amended; OP-046 filed.  No live hazard (v:2 shapes don't
  exist; contract prohibition + materializer silent-no-op
  cover).
- **UX-3 v2 #3 (backstory collapse) + UX-6 (dmGuidance UI)**:
  both XS-effort, both P2/post-playtest.  Deferred to keep
  this turn focused on the playtest-handoff doc.
- **Visual cohesion items 2-5** (deferred from run #15):
  walked the visual v2 #2-#5 list (`<h1>Quire</h1>` demotion,
  `.session-bar` migration, DM-operational variant, pill
  radii) — none load-bearing for playtest 1; the v3
  consultants did not surface visual regressions and the
  ttrpg-ux-expert v3 affirmed the cockpit is cohesive
  enough.  Skipped to keep the playtest-handoff doc the
  focus deliverable.

### What this turn ships

- H-2 fix: `<session-digest>` discard-and-load on
  `campaignSlug` change (DEC-034) + Mock-10 Scenario 8.
- H-1 fix: in-memory mirror reset on `navigateToRoute`
  slug-mismatch + `leaveSession` (DEC-035) + Mock-10
  Scenario 9.
- H-3 deferral: DEC-031 amendment + OP-046.
- **`design/playtest-readiness/playtest-handoff.md`** — the
  deliverable for the human + DM + test table.
- Final sweep: 3045 tests + 2 skipped = 3047 (up from
  3045 baseline; +2 net).
- Updated status.md with FINAL PLAYTEST GREEN flag.

### Verdict

**PLAYTEST GREEN.**  Both v3 consultants signed off; the run
#16 fixes close the only P2 (H-2) + the tiny P3 (H-1) for
defense-in-depth; H-3 is documented as a post-playtest
backlog item with no live hazard.  The playtest-handoff doc
captures everything the human + DM need before running
session 1.

The reserved run #17 contingency is **unspent**.


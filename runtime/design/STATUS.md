# STATUS

Current milestone: **M3c closed `ship-with-followups`** — tagged `milestone-M3c` 2026-05-22; polish batches 1 + 2 landed 2026-05-22.  First real play-test 2026-05-22 surfaced seven concerns reshaping the M3d scope; see `design/m3d-playtest-followups.md`.  Inventory primitive deferred (was original M3d) until play-test feedback on dice-UI + nav settles.

## M3c acceptance criteria

Plan: `design/m3c-ai-write-api.md` — 4-reviewer gate ran 2026-05-22, all `ship-with-followups`, 15 amendments folded into the plan at commit b758b0e.

- [x] M3c.0 — STATUS open + per-kind materializer extraction (USED SLIP-VALVE: deferred; commit 0ca2e3c)
- [x] M3c.1 — `caster-state-set` event kind + materializer + state.casterState DM-only field + strip-list (commit 7585c7f)
- [x] M3c.2 — AiResponse schema extends with `stateUpdates: StateUpdate[]` + provider parses updated (commit 362a273)
- [x] M3c.3 — AiWriteController extracted (pending-batch, undo timer, causedByResponseId stamping) (commit; 19 tests)
- [x] M3c.4 — DM accept-gate UI strip in `<ai-panel>` (apply-all-with-undo, hard-gate carve-outs) (commit f90ffc6)
- [x] M3c.5 — Hard-gate materializer enforcement (scan aiAudit for matching ai-accept; rejected-hard-gate audit kind) (commit 13703c6)
- [x] M3c.6 — System prompt updated for stateUpdates contract + spam-counter framing as DM-judgment cue (commit d10494a)
- [x] M3c.7 — E2e suite (cast-spam, hard-gate, cross-pc-gate) + 4-reviewer gate (commits 65524ec + this) → tag

## M3c implementation gate verdict (2026-05-22)

4-reviewer pass: Security `pass`; TTRPG-craft, Engine, Adversarial `ship-with-followups`.  No severity-floor block.

**Bug fixes folded in alongside gate-close** (this commit):
- TTRPG F1: hardcoded "Yui" in harm hard-gate message → `${update.pcId}`.  Real table-trust harm if shipped.
- Adversarial #8: system prompt now documents the caster-state-set merge semantic (omitted fields carry forward from prior state) so the AI doesn't emit partial updates expecting reset semantics.

**Followups carried out of M3c** (honestly tracked, not silently slipped):
- **Per-kind materializer extraction** — slip-valve USED at M3c.0.  state.ts retains the inline switch; 32 case arms.  Land as a separate cleanup commit when budget allows.
- [x] **DM "Reset spam counter" button** (Engine #3 + Adversarial silent-cut) — landed polish batch 1 (commit 6923f46): dm-aside renders an amber chip when spamCount > 0; click calls `resetSpamCounter(pcId)`.
- [x] **Settings toggle "Review every state update individually"** (Adversarial A8) — landed polish batch 1 (commit 6923f46): `aiReviewEveryUpdate` plumbed through AiWriteController; flips every entry to hard-gate-pending.
- [x] **Apply-All keyboard shortcut (Enter)** (TTRPG F2) — landed polish batch 1 (commit 6923f46): hotkeyHandler treats plain Enter outside editables as Apply-All.
- [x] **DM-banner UI for `rejected-hard-gate` audit rows** (Security) — landed polish batch 1 (commit 6923f46): `renderRejectionBanner()` surfaces the last 5 entries above the prompt form.
- [x] **Cast-spam e2e bootstrap weakness** (Adversarial #4) — fixed polish batch 2: test now seeds two DM-direct caster-state-set events before the AI's third proposal, exercising the materializer's carry-forward semantic.
- [x] **Engine #1 hostile test is multi-peer** (Adversarial #10) — added polish batch 2: new e2e proves a non-coord peer cannot forge an ai-accept + matching gated pc-edit through merge.  Both peers see harm unchanged + a rejected-hard-gate audit row.
- **Dice-roll dispatch placeholder** — controller sends `result: 0, dice: []`.  Broker may extend later to compute the actual roll; today the DM re-rolls if they want physical dice.
- **pc-edit stale-read window** — Adversarial #9: controller computes `value = currentHarm + delta` at dispatch time, not propose time.  Concurrent peer edits in the apply-all window are overwritten LWW.  Real but small risk; revisit if it bites at the table.
- **pc-edit universal-write trust gap** — surfaced while writing the Adversarial #10 hostile test (2026-05-22): the pc-edit materializer accepts writes from any peer for any PC.  Tolerated by the current threat model (civilized players); revisit if a future feature depends on per-PC write authority.  See memory `project_quire_pc_edit_trust_gap`.
- **`pushing-back` ladder transition gating** — defer post-playtest per the plan.
- **Prompt-cache hit-rate verification** (Engine #5) — measure once a real session runs.

## M3c polish batches (post-tag)

- **Batch 1** (commit 6923f46) — UX affordances: Enter→Apply-All hotkey; DM reset-spam chip; review-every toggle; rejected-hard-gate banner.  +1 controller test (982 vitest pass).  Bundle +0.94 KB gzip → 91.56 KB.
- **Batch 2** (commit 7a0e66a) — e2e fidelity: realistic cast-spam bootstrap via prior DM-direct casts; new multi-peer hostile test for Engine #1.  4 ai-write-api e2e pass.
- **Batch 3** (this commit) — first-play-test fix: markdown link interceptor in `<scene-stage>`.  Author-written `[..](../dm/stakes.md)` links inside scene markdown now route through `navigateToRoute` instead of tearing down the session.  6 new unit tests (988 vitest pass).  Companion campaign edit: `dm/stakes.md` adds an authorial cue connecting scene-1's crying PC4 to the appropriate stake categories.

## First play-test followups (2026-05-22)

The user's first real DM-side play-test produced seven concerns documented in `design/m3d-playtest-followups.md`.  Two TTRPG-craft + UX expert consultations ran; the design doc synthesizes their recommendations.

- [x] **Broken `../dm/stakes.md` markdown link** — fixed inline (batch 3).
- [ ] **Campaign-link linter** — `scripts/lint-campaign-links.mjs` to catch broken intra-campaign markdown links pre-commit.  M3d.
- [ ] **Stale-DM-peer on rejoin** — root-cause documented (autosave-restore rehydrates prior coord without matching leftAt).  M3d primary fix: route-change-fires-leave + heartbeat-based roster glyph.
- [ ] **2d6-first dice UI** — TTRPG-expert confirms ~95% of rolls are 2d6+stat.  ui.md L154-160 spec is the target.  M3e.
- [ ] **PC1/PC2 script variable binding** — `{{pc:N}}` markup + per-session `pcSlots` shared field + click-to-bind popover.  M3d.
- [ ] **Modes-of-play polymorphism** — `tableTopology` + `tableSeats` shared field + `<seat-strip>` region.  Unblocks DM-only mode (no peers → no PCs).  M3d phase 1; M3e adds whisper + print.
- [ ] **Scene-switching as dominant action** — `<dm-rail>` enumerates `dm/*.md` too; `[`/`]` hotkeys; AI `requestNav` tool.  M3d.

Design doc + expert convergence point at three primitives:
- `navController` extraction (concerns 1, 5, 7 share this).
- Seat/slot data structure (concerns 5 and 6 share this).
- The missing `design/ui.md` should be resurrected as M3d's first artifact.

Recommended pre-implementation 4-reviewer gate on the design doc.

## Character-creation design pass (2026-05-22)

User play-test follow-up surfaced character creation as the next major
design surface.  Three expert consultations ran (TTRPG-craft, UX,
prompt-engineering).  Full synthesis lives in `design/m4-character-creation.md`
with 31 numbered work items (CC-1 through CC-31).  The user has
explicitly deferred prioritization — these are inputs for a later
prioritization conversation that will reorder open items across M3d/M4.

Highlights:
- `{{pc:N}}` migration landed (this commit) — 76 substitutions across
  15 underleaf files + `substitutePcSlots` renderer in markdown.ts
  with fallback to literal `PC<N>`.  9 new unit tests.  997 vitest pass.
- Three player paths (pre-gen / Q&A+AI / free-write) converge on one
  PC schema.  Same edit screen after path choice.
- Mode A (online) = Mode B (async) with sync + AI turned on.  Single
  conditional: `if (sessionView.coordinator) liveMode else asyncMode`.
- DM is the coordination layer in async mode — invite tokens with
  pre-assigned archetype hints, paste-backup-tokens between days, NO
  daemon, NO server.
- AI synthesis runs ONCE at session 1 with DM's API key.  10 questions
  (7 MC + 3 SA).  System prompt cached 1h; per-PC suffix parallel.
  `includeDmNotes: false` is hardcoded for player-facing synthesis;
  forbidden-token regex post-check; DM approval gate before lock-in.

Carry into prioritization:
- Confirm/refute the `{{pc:N}}` migration (landed).
- Decide pcSlots scope (campaign vs session).
- Decide async-deviation policy (soft hint vs hard).
- Decide DM-approval-gate required vs skippable.
- Scope: who writes Underleaf's pre-gen suite?
- "Use same device" wording.
- Print-friendly character sheet — M5 carry?

## Previous milestone — M3b polish + gap-fills (since `milestone-M3b` tag)

## Previous milestone — M3b polish + gap-fills (since `milestone-M3b` tag)

## M3b acceptance criteria

**Foundation (no UI change required):**
- [x] `src/ai/{broker,schema,context,audit,budget,hash}.ts` module structure landed (M3b.1-M3b.4)
- [x] AiResponse `{safe, dmOnly, sources, raw, tokensIn, tokensOut, responseId}` schema (M3b.1)
- [x] `validateContextRef({scope})` with path validation: campaign-relative, no `..`, no URL schemes, no `dm/*` when scope='public', length cap (M3b.1)
- [x] `wrapUntrusted()` + `UC_CLOSE_SENTINEL`.  Load-time validator in `campaign-loader.ts` rejects raw content containing the literal sentinel (M3b.6)
- [x] `AiBroker.complete(req)` wrapping both providers; structured return; parse-failure fallback (M3b.2)
- [x] Provider impls request structured tool / response schema (Anthropic tool_use, Gemini schema); broker normalizes (M3b.2)
- [x] Coord-only enforcement at broker level — current `state.coordinator` only (solo mode = no coord set = allowed; per redesign-plan.md L149) (M3b.2)
- [x] Scope toggle resets per prompt (M3b.5 UI + M3b.2 broker)

**Audit chain (M3b.3):**
- [x] `ai-prompt` / `ai-response` / `ai-accept` / `ai-reject` materializers populate `aiAudit[]` (already DM-only via filterForViewer + stripped from shareable saves at M3a.10)
- [x] Hash chain: `chainHead(audit)` extracts the latest response hash; broker emits `ai-response` with the link
- [ ] IndexedDB-backed full-text store keyed by hash — deferred to M3b.7 follow-up if needed (events carry short hashes; the full text in the broker's memory + audit chain is sufficient for M3b minimum)

**Budget (M3b.4):**
- [x] Per-session token accumulator derived from `state.aiAudit` (the event log IS the budget store — no separate IndexedDB needed)
- [x] BudgetExceededError + AiBrokerError(budget-exceeded) gating
- [x] Warning state at 80% threshold; exceeded at 100%
- [ ] Topbar widget visualizing usage — deferred to M3b.7 polish (gate-exit not blocking)

**Dual-card UI (M3b.5, P2-12):**
- [x] Always two cards (safe / dm-only); empty card → muted "(none)" placeholder
- [x] DM-only card carries amber rail + lock glyph + "Copy (do not read aloud)" + source chips
- [x] Scope toggle on prompt form (public default, opt-in dm)
- [x] Accept / Reject verdict buttons emitting `ai-accept` / `ai-reject` events

**Gate exit (M3b.7):**
- [x] e2e/ai-content-safety.spec.ts — landed at commit 8851170; mock AiBroker returns `{safe, dmOnly}`; player view contains neither, DM view shows both as dual cards
- [x] Smuggled-marker variant covered in the same e2e file — shows literal text after sanitize, no live `<dm-only>` element
- [x] 4-reviewer gate ran 2026-05-21 — Adversarial invoked severity-floor BLOCK; remaining 3 ship-with-followups
- [x] Unblock work landed (commits 7080704 + 8851170): tokenIn accounting, verdict feedback, budget meter, parseFailureResponse responseId, loadCampaign UC_CLOSE symmetry, legacy AI module dead-code removal
- [ ] Tag `playtest-1` on green pass

## M3b.7 gate verdict + unblock

4-reviewer gate verdict 2026-05-21:

| Reviewer | Verdict | Severity-floor |
|---|---|---|
| TTRPG-craft | ship-with-followups | no |
| Engine | ship-with-followups | no |
| Security | ship-with-followups | no |
| **Adversarial** | **block** | yes |

Adversarial-cited blockers (all addressed):
- `e2e/ai-content-safety.spec.ts` missing → landed commit 8851170 (2 tests, both pass).
- `tokenIn: 0` hardcoded in ai-prompt event → ai-prompt + ai-response now emit AFTER broker.complete returns with real tokensIn / tokensOut.  Budget meter no longer half-blind.
- Topbar budget widget missing → inline budget meter in `<ai-panel>` header (X / Y (Z%)), warning at 80%, exceeded at 100% with Ask button disable + red banner.
- parseFailureResponse responseId='' hid verdict buttons → synthesized fingerprint id so even degraded responses get Accept / Reject.
- Convergent TTRPG-craft finding (silent Accept / Reject) → visible "✓ Accepted" / "✗ Rejected" footer replaces the buttons after click.

Security-cited follow-up:
- S-2 (loadCampaign UC_CLOSE check) → landed commit 8851170.
- S-1 (wrapUntrusted unused until contextRefs land) → track for the contextRefs implementation PR; primitive is correct, just unconnected today.

Engine-cited follow-ups (deferred to M3b polish):
- Extract `AiBrokerController` to shrink `submitAiPrompt` under 80 LOC.
- Collapse `aiResponse: string` mirror into `aiResponseStructured?.safe`.
- Port fetch-layer integration tests from legacy `src/ai/{anthropic,gemini}.test.ts` to the new providers.

TTRPG-craft follow-ups (deferred to M3b polish):
- Scope-toggle armed state should pick up amber treatment when `scope === 'dm'`.
- Faint green wash on `.ai-card-safe` background for visual symmetry with the amber DM card.
- Hide verdict buttons in solo mode.

## Previous milestone — M3a closed `ship-with-followups` (after security unblock)

(See M3a gate retro below for the comparable security-unblock pattern.)

## Previous milestone (deeper) — M2 closed `ship-with-followups`

3 reviewers (TTRPG-craft, Web-UX, Adversarial) closed `ship-with-followups`.  No severity-floor block.  Gate produced 13 follow-up P-tasks; 7 are HARD M3a acceptance criteria.  The LOC cap was reframed at gate close after a code-quality expert evaluation: the original ≤900 was a proxy for navigability + vocabulary-separation, replaced for M3a with structural metrics (max-method ≤80, delegation ratio ≥75%, three named extractions, safety-net ≤2000 LOC).  Tag: `milestone-M2`.

Full M2 retro retained below.

## M3a acceptance criteria — progress

**Structural (replacing the M3a ≤900 LOC cap):**
- [x] `<session-bar>` region extracts renderSessionBar (M3a.3, commit 8f75a19)
- [x] `route-policy.ts` helper extracts navigateToRoute gating (M3a.4, commit a07cba4)
- [x] `<ai-panel>` region extracts AI panel cluster (M3a.5, commit dce9e2b)
- [~] max-method-LOC ≤ 80 — Engine gate measured 83 (`loadFromString`), MISS by 3.  Trivially fixable; deferred to M3a polish.
- [~] delegation ratio ≥ 75% — Engine gate measured 56% (9/16 page-level renderers).  `renderDmCharacterAffordances` is the cheapest extraction (~80 LOC); deferred to M3a polish.
- [~] quire-app.ts ≤ 2000 LOC — actual at M3a close: **2795 LOC** (gate measured 2749 + unblock work).  Soft cap missed; gate accepted as ship-with-followups for engine-quality; CRITICAL blocks were security-side, now resolved.

**Player-side UX (TTRPG-craft HIGH):**
- [x] PC-to-peer binding event (M3a.2, commit 1f7ede4 — `peer-rename` extended with `pcId`)
- [x] `<player-rail>` always-on (M3a.6d, commit f4a93a4)
- [x] Dice Dock 6 stat chips with current modifier (M3a.6a, commit 511ced1)
- [x] Player Aside roster harm/stress glyph (M3a.6b, commit a049c6b — connection dot + speaker pulse remain follow-ups)
- [x] `<scene-stage>` renders scene-strip frontmatter (M3a.6c, commit a049c6b)

**DM cockpit (the actual M3a scope from execution-plan.md):**
- [x] `<dm-rail>` (scene navigator) — M3a.9, commit 731146e.  Active-PC focus card deferred (no active-PC concept; M3a polish / M3b)
- [x] `<dm-aside>` (pinned NPCs + thread-debt summary) — M3a.9, commit 731146e.  Roster/chat/AI panel remain in the player aside cluster; DM aide is a separate region above them
- [x] Per-paragraph reveal with content-hash addressing + gutter pips (M3a.7 + M3a.10 paced-mode fix, commits d32e360 / 2ac700e / 4423ed4 / 50bf471 / 7e4a52c)
- [x] DM scratch column in Dock with `'` hotkey (M3a.8, commit 2c17e28)
- [~] NPC pinning (M3a.8 materializer + pin button; LIST lands in `<dm-aside>` M3a.9; button still on the NPC character page pending M3a polish relocation)
- [~] Thread-debt ladder (M3a.8 selector on PC page + summary in `<dm-aside>` M3a.9; the inline 5-chip ladder in the Rail's active-PC focus card is M3b)
- [x] Caution rail on `dm/*` paths (M3a.8, commit f8a69ce)
- [x] Broadcast button (`broadcast-view` event) (M3a.8, commits a1bc499 + cecf28b — DM scene-stage button + far-future-ts lock-out guard)

**M3a.10 unblock (post-gate security work):**
- [x] `serializeSessionForViewer` — shareable saves strip DM-only events (M3a.10, commit b844bab).  Player's downloaded JSON can no longer accidentally leak DM scratch / pins / debt / AI audit when shared.  Autosave path keeps the full event log for data resilience (per project_quire_threat_model).
- [x] `filterForViewer` keys on current coordinator, not historical `coordHolders` (M3a.10, commit d978a6d).  A yielded-coord peer drops back to player-scoped view immediately.
- [x] `<dm-aside>` / `<dm-scratch>` migrated to `filteredShared` (M3a.10, commit d978a6d).  Defense-in-depth consistency.
- [x] `e2e/per-paragraph-reveal.spec.ts` — the redesign-plan.md L437 acceptance test (M3a.10, commit 7e4a52c).  Asserts unrevealed-block text is absent from player Stage innerHTML.
- [x] `persistence.hostile.test.ts` — 9 cases including the literal LEAK SCENARIO grep (M3a.10, commit b844bab).
- [x] Paced-mode kick-in fix: `sceneFullyRevealed` now flips false when any per-block reveal exists, so per-paragraph reveal actually constrains the player view (M3a.10, commit 7e4a52c).

**Process:**
- [x] STATUS.md cadence rule decision — DROPPED honestly at M3a.0; this update is at the M3a.7 milestone-internal boundary, not per-commit.
- [x] Honest revision of execution-plan.md time estimates — DONE at M3a.0.
- [x] First commit migrates player-visible renderers `shared` → `filteredShared` (M3a.1, commit at branch base).

## M3a.10 gate verdict

4-reviewer gate verdict 2026-05-21:

| Reviewer | Verdict | Severity-floor |
|---|---|---|
| TTRPG-craft | ship-with-followups | no |
| Engine | ship-with-followups | no |
| Security | **block** | yes |
| Adversarial | **block** | yes |

Two CRITICAL findings converged on the user-initiated save-export path: `serializeSessionForViewer` was unimplemented (player save leaks DM scratch / pins / debt verbatim on share) and `filterForViewer` keyed on historical `coordHolders` rather than the current coordinator (yielded-coord peer continued seeing DM-only state in the UI).  Both addressed in the M3a.10 unblock work (commits b844bab + d978a6d + 7e4a52c).

Threat-model framing locked at the gate (see [[project_quire_threat_model]]):
- Defend against ACCIDENTAL DM-only disclosure (civilized player Cmd+S → JSON shared with someone).
- Defend against malicious outside parties disrupting the game.
- Do NOT try to defend against malicious team members — they have GitHub access anyway.  Capture as audit-trail follow-up.
- Players STORING DM events on their device's autosave is wanted (multi-device resilience).  Filtering is at the SHARE surface (user file download), not the storage surface.

## M3a polish — landed after milestone-M3a tag

Post-gate followup work, all on `main`:

- [x] FU-1: DM keyboard map — j/k walk pips, Cmd+Enter reveals next, b broadcasts, ' focuses scratch.  Hotkeys skip text inputs + contenteditable; second e2e test verifies the workflow.  Commit 202eedf.
- [x] FU-3: Thread-debt selector relocated from the PC character page into `<dm-aside>` as inline rows for bound-PC peers.  DM no longer needs to navigate per change.  Commit 41717eb.
- [x] FU-5: Lapsed-pip strip in the DM Stage when revealed block hashes no longer match any current block (editorial-edit cue).  Commit 22af352.
- [x] FU-6: SCRATCH_NOTE_TEXT_CAP = 5000 documented in redesign-plan.md.  Commit ae16b93.
- [x] FU-7: `loadFromString` split (83 → ≤55 LOC across 4 helpers).  Closes the Engine max-method MISS.  Commit ae16b93.
- [x] FU-8: `crypto.subtle` feature-detect with typed `CryptoUnavailableError` + actionable error banner.  Commit 22af352.
- [x] FU-9: Case-insensitive `dm/` path match for caution rail.  Commit ae16b93.
- [x] E2e stabilization — 6 tests broken by dm-rail link duplication + gutter-pip button count + AiKeyStore debounce race.  Commit 3dfef88.

## Follow-ups still open (M3b territory)

**HIGH:**
- FU-2: Audit trail when a peer is reading DM-only state they shouldn't be.  Needs a separate event kind + retention design; better tackled with the M3b AI-audit work where the storage/UI patterns already need to land.

**MEDIUM:**
- FU-4: Active-PC focus card in `<dm-rail>` (currently scene-navigator only).  Requires a "focused PC" concept that doesn't exist yet — design choice on whether it's auto-derived (last roll/edit) or DM-explicit.

**Engine residue:**
- quire-app.ts at 2875 LOC vs 2000 soft cap.  `broadcastCurrentView` + `followBroadcast` + `routeForAppState` (~90 LOC) are the next-cheapest extraction into a broadcast-controller — deferred as the M3b region work will reshuffle naturally.
- delegation ratio: still ~56%.  `renderIdle`, `renderEpisode`, `renderRevealBanner` are the remaining inline-renderer chunks; each is small enough that extraction is more bookkeeping than benefit at this point.

## Next planned commit

`milestone-M3a` was tagged after the unblock commits; the polish followups landed on `main` above.  Next milestone: **M3b — AI broker + dual-card** (P2-6, P2-7, P2-8, P2-9, P2-12 per execution-plan.md).  Outcome: structured `{safe, dmOnly, sources}` returns from both providers, dual-card render, audit chain (closes FU-2 in passing), scope reset, coord-only enforcement.

---

## M2 closure retrospective (frozen)

### M2 gate result

Gate verdict 2026-05-21: 3/3 reviewers `ship-with-followups`.  No HIGH-severity Engine/Security findings (those reviewers were not at this gate).  Web-UX raised 2 HIGH findings (unstyled CSS, light-DOM load-bearing); both addressed at gate close.  Adversarial raised 3 HIGH findings (LOC ratchet creep, pace, design-spec drift); the first reframed via expert analysis, the latter two acked with persistent plan adjustments.  TTRPG-craft raised 3 HIGH findings (route-driven rail, no PC binding, dice dock); all three queued as M3a HARD acceptance criteria.

### M2 closing state (frozen at tag)

## M2 commits

| SHA | Task | Tests | Bundle | quire-app.ts |
|---|---|---|---|---|
| `eb5fb84` | M2.1 session lifecycle | 685 | 66.15 → 66.25 KB | 2722 → 2742 |
| `8643ba2` | M2.2 filterForViewer wiring | 688 | 66.25 → 66.37 KB | 2742 (unchanged) |
| `9ed04e3` | M2.3 player-rail | 688 | 66.37 → 66.61 KB | 2742 → 2558 |
| `3979f5b` | M2.4 scene-stage | 688 | 66.61 → 66.83 KB | 2558 → 2545 |
| `616a311` | M2.5 player-aside (roster) | 688 | 66.83 → 67.33 KB | 2545 → 2449 |
| `7c6782d` | M2.6 dice-dock | 688 | 67.33 → 67.56 KB | 2449 → 2426 |
| `080f9a1` | M2.7 chat-panel | 688 | 67.56 → 67.70 KB | 2426 → 2409 |
| `15c1928` | M2.8 raise-hand + UI | 696 | 67.70 → 68.08 KB | 2409 → 2429 |
| `74acf10` | M2.9 M1 follow-ups | 700 | 68.08 → 68.35 KB | 2429 → 2439 |

9 M2 commits.  Net: 700 unit tests (+12 from M1 close), 2 skipped.

## M2 acceptance criteria — final state

- [x] `<player-rail>` renders the character sheet via light-DOM extraction (M2.3); tap-to-expand deferred to a polish pass.
- [x] `<scene-stage>` renders Markdown + breadcrumb (M2.4); scene-strip frontmatter line deferred to a follow-up (episode-loader exposure).
- [x] `<player-aside>` renders roster + harm/stress glyph + connection-state pulse + ✋ raise-hand glyph (M2.5 + M2.8); private notes deferred to M3.
- [x] `<dice-dock>` renders 6-stat-chip-equivalent (single-input + history) + raise-hand button (M2.6 + M2.8); full stat-chip layout deferred to M3a.
- [x] `<chat-panel>` extracted as Aside-sibling region (M2.7); collapsible toggle deferred.
- [x] `raise-hand` / `lower-hand` events with self-authored materializer + ✋ glyph on roster + button in Dock (M2.8).
- [x] P0-8b host/join/leave extracted to `session-bootstrap` (M2.1).
- [x] P0-4-followup `filteredShared` accessor on `SessionView` (M2.2).
- [x] P0-11-followup-appState `appState` as readonly getter (M2.9).
- [x] P0-11-followup tighter `QuireAppHooks` bidirectional type test (M2.9).
- [x] P0-12-followup-banner runtime peer-version-mismatch banner (M2.9).
- [x] All existing player-side tests pass.
- [x] One new e2e flow (P1-7 raise-hand): covered by 8 hostile materializer tests + integration via the existing session-controller suite.  Full Playwright e2e for raise-hand deferred (the materializer tests pin the contract; e2e wiring is sugar).
- [x] Bundle ≤ 85 KB gzipped — **68.90 KB** (well under cap; gate-close CSS additions for the new affordances bumped from 68.35).
- [ ] `quire-app.ts` ≤ 1500 LOC at M2 close — **2439 LOC; 939 LOC OVER target.**  Per Adversarial M2 finding, the cap is NOT being raised again — ratchet creep declined.  See "Open questions" below for the user-ack decision.
- [x] STATUS.md updated through milestone (this file).

## Design-spec deviations carried into M3a

The M2 strict-extraction discipline preserved rendered output but did not reach the design spec's vision in four places.  All four were called out by gate reviewers (TTRPG-craft + Adversarial); none were proactively flagged in the M2.x commit messages beyond the M2.7 chat-panel note.  Logged here so M3a's reviewers see the full carryover:

1. **Scene-strip frontmatter** — `<scene-stage>` does not render the `name · location · mood · expectedDuration · presentNpcs` line below the breadcrumb.  Requires `episode-loader` to expose per-scene frontmatter.  Promoted to an M3a acceptance criterion.
2. **Chat as Aside-sibling vs Aside-child** — `<chat-panel>` renders as a sibling region inside the Aside slot, not as a collapsible section inside `<player-aside>` per ui.md line 152.  Provisional split; M3a may collapse them OR formalize the sibling choice (decision pending).
3. **Player Rail tap-to-expand** — `<player-rail>` does not yet implement the Rail-grows-on-portrait-tap interaction.  Deferred.
4. **Dice Dock single-input vs 6 stat chips** — TTRPG-craft flagged this as HIGH (a new player can't compose 2d6+stat without a stat chip).  M3a must address.

## Pace cadence — honest record

M2 wrapped in ~30 minutes of wall-clock work (first commit 11:38 → STATUS pre-gate 12:10).  9 commits.  The execution-plan estimated M2 at 2-3 weeks.  M1 took ~3 hours.  The Adversarial M1 reviewer flagged the M1 pace and asked the question "if M2 also wraps fast with similar gaps, the planner is over-stating milestone difficulty" — M2 confirmed that.  An honest revision of the execution-plan's time estimates is due at M3a entry.

## Gate close — resolutions

1. **LOC cap question (resolved 2026-05-21).** User pushback led to a code-quality expert evaluation that reframed the question: LOC was a proxy for navigability + vocabulary-separation, not the goal itself. Decisions:
   - M2 LOC criterion stays MISSED (`[ ]`) honestly. Ratchet creep declined.
   - M3a's ≤900 LOC cap REPLACED with structural criteria: max-method-LOC ≤80, delegation ratio ≥75%, three named extractions (`<session-bar>` region, `route-policy.ts` helper, `<ai-panel>` region), safety-net ≤2000 LOC. See `execution-plan.md` § M1 acceptance — M3a row, and `redesign-plan.md` § M3a HARD acceptance criteria.
2. **No e2e for raise-hand** (Adversarial low). Cross-cutting "round-trip e2e per milestone" rule was technically violated — only materializer + integration tests landed. Filed as P0-12-followup-e2e for M3a; not blocking.
3. **Scene-strip frontmatter** (in deviations above; promoted to M3a HARD criterion).
4. **Tap-to-expand on player-rail** (in deviations above; M3a polish).

## M2 reviewer roster

Per `execution-plan.md`:
- **TTRPG-craft** (mandatory)
- **Web-UX** (mandatory)
- **Adversarial critic** (mandatory)

Three reviewers (down from M1's four; Engine + Security at M2 are only spawned on demand because no event-vocab or persistence changes are gated here — those moved into M1 vocab + M3a filter).

## Previous milestone — M1 closed `ship-with-followups`

Gate verdict: 4/4 reviewers ship-with-followups. All HIGH-severity findings resolved. LOC cap re-baselined (user ack 2026-05-21): M1 ≤2750 / M2 ≤1500 / M3a ≤900. Followup P-tasks tracked in `redesign-plan.md` § "M1 gate — follow-up P-tasks." Tag: `milestone-M1` at commit `e11abb7` (or whichever final commit ends up).

Full M1 retro retained below for the record.

## M2 — acceptance criteria progress

- [ ] `<player-rail>` renders condensed sheet (name/pronouns/alignment, 6 stats 2-col, harm 4-box, stress 4-box, top skills as chips, foci summary). Tap own portrait → Rail grows to `clamp(420px, 44ch, 480px)`; Stage absorbs the delta. No modal.
- [ ] `<scene-stage>` renders Markdown via existing `renderMarkdown` with scene-strip header (name·location·mood·duration·presentNpcs). 68ch centered. Scene-strip sticky to top.
- [ ] `<player-aside>` renders roster (avatar+name+harm/stress glyph+connection dot) + collapsible chat (default collapsed in-person) + private notes (local-only).
- [ ] `<dice-dock>` renders 6 stat chips + modifier stepper + roll button + last 3 pills. Keyboard `R`/`1-6`/`+-`/`Enter`. Doubles trigger colored halo.
- [ ] `raise-hand` / `lower-hand` events propagate ✋ glyph to all peers' rosters.
- [ ] P0-8b — host/join/leave extracted to session-bootstrap (M1 gate follow-up; lands as first M2 commit).
- [ ] P0-4-followup — `SessionController.view()` exposes a filtered shared state so M2 regions cannot accidentally read raw `sessionView.shared`.
- [ ] P0-11-followup-appState — `appState` becomes readonly via getter.
- [ ] P0-11-followup — tightened `QuireAppHooks` type test.
- [ ] P0-12-followup-banner — runtime peer-version-mismatch banner.
- [ ] All existing player-side e2e tests pass against the new components. Helper updates allowed.
- [ ] One new e2e: player joins host, sees condensed sheet, taps stat chip to pre-fill dice, rolls, result broadcasts.
- [ ] Bundle ≤ 85 KB gzipped.
- [ ] `quire-app.ts` ≤ 1500 LOC at M2 close.
- [ ] STATUS.md updated through milestone (per cadence rule restated in M1 gate adversarial review).

## M2 — gate reviewers

Per `execution-plan.md`:
- **TTRPG-craft** (mandatory)
- **Web-UX** (mandatory)
- **Adversarial critic** (mandatory)

Three reviewers (down from M1's four). No Engine / Security at M2 because no event-vocab or persistence changes are planned (those moved into M1 vocab + M3a filter).

## Next planned commit

P0-8b — extract host/join/leave/regeneratePairingCode to session-bootstrap controller. This is the bridge from M1 close into M2, addressing the Adversarial reviewer's recommendation to extract NOW before M2 region work increases coupling.

---

## M1 closure retrospective (frozen)

## Gate result (2026-05-21)

Four reviewers spawned in parallel: Engine, Security, Performance, Adversarial. Per execution-plan.md, only Engine and Security have severity-floor authority.

| Reviewer | Verdict | High-severity findings |
|---|---|---|
| Engine | ship-with-followups | 2 (v:1 enforcement, .mjs drift) — **both fixed** in commit `fd33a25` |
| Security | ship-with-followups | 0 |
| Performance | ship-with-followups | 2 (tokens dead-weight, per-keystroke render) — **both fixed** in commit `f80c05d` |
| Adversarial | ship-with-followups | 4 (LOC overrun, session-bootstrap deferral, STATUS cadence, .mjs drift) — last two acked, first two flagged |

After fixes, no severity-floor `block` remains. Gate closes `ship-with-followups` once the LOC re-baseline is resolved.

## LOC overrun — USER ACK REQUIRED

`quire-app.ts` is **2722 LOC**. M1's target was ≤1200. The 1500+ LOC gap is the ~1700 LOC of `renderXxx` methods that the plan's facade-migration step 3 defers to M2 region work (handlers stay on root through M1; render templates extract per-region in M2).

The Adversarial reviewer was correct that raising the cap unilaterally would teach "the cap moves when convenient" (it was already raised once from v0.1's 800 to v0.2's 1200). The honest path is a tiered re-baseline:

**Proposed plan-adjustment (requires user ack):**

| Milestone | LOC cap | Rationale |
|---|---|---|
| M1 close | **≤ 2750** | Acknowledges deferred render extraction; current 2722 is within. |
| M2 close | **≤ 1500** | Player-region templates extract from root; handlers may also start moving. |
| M3a close | **≤ 900** | DM cockpit regions extract; handler migration completes for the core regions. |

This caps reduction to specific milestones rather than treating the absolute number as a one-time gate.

**Decision pending.** Until the user accepts the tiered re-baseline (or specifies a different policy), the gate remains technically open on this criterion.

## Acceptance criteria — final state

- [⚠] `src/quire-app.ts` ≤ 1200 LOC — **2722 LOC; tiered re-baseline proposed (above)**
- [x] `src/controllers/session-bootstrap.ts` extracted — minimal (pure helpers); P0-8b queued for follow-up extraction of host/join/leave (Adversarial finding accepted)
- [x] `src/controllers/autosave-controller.ts` extracted
- [x] `src/controllers/ai-key-store.ts` extracted (with 300 ms debounce on localStorage writes per Performance finding)
- [x] `src/sync/working-copy.ts` exists with IndexedDB + in-memory store
- [x] `src/ui/shell/` with `<quire-shell>` + 5 region elements
- [x] `src/ui/styles/tokens.css.ts` exists (not yet consumed; M2 region components will import directly)
- [x] `src/ui/modes/mode-state.ts` + AppMode URL routing
- [x] All 18 new event kinds in `KNOWN_EVENT_KINDS` with `v: 1` versioning + `isPayloadV1` enforcement
- [x] `filterForViewer` helper with unit tests (wiring deferred via P0-4-followup)
- [x] H-4 unknown-kind banner on save load; peer version-gating data captured (UI banner deferred via P0-12-followup-banner)
- [x] CI bundle-size gate active with `bundle-gate.test.ts` + `.mjs` drift test + level-9 gzip alignment
- [x] Bundle ≤ 72 KB gzipped at M1 — **66.15 KB (cap 110 KB after gate's level-9 alignment)**
- [x] All existing tests pass (669 total, +136 from M1 work, 2 skipped); `QuireAppHooks` interface stable
- [x] `STATUS.md` (this file) up to date
- [x] `runtime/design/review-history/` populated per-lens for M1 (4 lens files + 2 unused lens files; accessibility.md dropped per H-7 audit pattern)
- [x] `MAX_EVENTS_PER_SAVE = 100_000` DoS guard (Security gate finding)
- [x] `security.md` updated — AI key-storage threat model + UC sentinel deferred-to-M3b clarification

## Commit log for M1

| SHA | Task | Tests | Bundle |
|---|---|---|---|
| `da55b81` | M1.2 CSS extraction | 529 | 63.93 → 65.00 KB |
| `b64576d` | M1.3 Shell wrappers as slots | 529 | 65.00 → 65.62 KB |
| `3fed63e` | M1.4 Mode state + URL | 541 | 65.62 → 65.74 KB |
| `a460b72` | M1.5 Event kinds + v:1 register | 546 | unchanged |
| `01c9043` | M1.6 filterForViewer | 555 | unchanged |
| `8225af8` | M1.7a AiKeyStore | 579 | 65.74 → 66.01 KB |
| `50473f7` | M1.7b AutosaveController | 592 | 66.01 → 66.13 KB |
| `21f2e9e` | M1.7c session-bootstrap (minimal) | 608 | 66.13 → 66.15 KB |
| `400631e` | M1.8 QuireAppHooks | 610 | unchanged |
| `1c639b6` | M1.9 H-4 banner + peer-version | 619 | 66.15 → 66.51 KB |
| `55ccc84` | M1.10 WorkingCopy | 639 | unchanged |
| `8bc1cd2` | M1.11 CI bundle-size gate | 650 | unchanged |
| `90dd88c` | STATUS.md update pre-gate | (same) | unchanged |
| `fd33a25` | M1 gate — Engine HIGH fixes (v:1 + .mjs) | 665 | 66.51 → 66.60 KB |
| `f80c05d` | M1 gate — Performance HIGH fixes (tokens + debounce) | 665 | 66.60 → 65.93 KB |
| `5ac0815` | M1 gate — batched quick fixes (MAX_EVENTS, gzip-9, peerIds, CI, CLI job) | 669 | 65.93 → 66.15 KB |

15 M1 commits + 2 design / STATUS commits. 669 unit tests + 2 skipped. No tests deleted. No `--no-verify`. No CO-AUTHORED-BY trailers.

## Bundle inventory (post-gate, gzip level 9)

```
[other    ] bundler-C_ZWe5WE.js   30.74 KB  (uncapped — see P0-7c)
[main     ] index-Bmvd2W0V.js     64.36 KB  (cap 110 KB; 58% used)
```

## Open questions / Blockers

1. **LOC cap re-baseline.** See above. User ack required to apply the tiered proposal OR specify a different policy.
2. **Nothing else blocking M2 entry.** All Engine + Security HIGH findings resolved; medium / low findings tracked as P-tasks in `redesign-plan.md` § "M1 gate — follow-up P-tasks."

## Next planned commit

When LOC re-baseline is resolved: tag `milestone-M1` and open M2 (in-session ergonomics — player view region-extracted).

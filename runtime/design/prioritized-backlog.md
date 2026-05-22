# Prioritized backlog — Phase 3 synthesis (2026-05-22)

> **Status:** REPLACES the previous Phase 2-era synthesis after the Phase 2 4-reviewer gate produced ~50 new items and the original backlog (M3D follow-ons, CC items, V-* tech debt) was reranked against the gate findings.  Three lenses (TTRPG-craft / UX / Engine) ran in parallel against the consolidated `phase3-catalog.md` (~105 items).

## Synthesis rules

- All three agree → final priority is the agreement.
- TTRPG + UX P0, Engine lower → P0 (table-bites trumps architectural caution).
- Engine P0 for security/foundation, others lower → P1 elevation (engine knows what foundations cost).
- 2-of-3 P0 → P0 unless dissent is on a real cost concern.
- Single-lens dissent → majority wins; dissent noted inline.

## Three-way P0 (all three lenses agree)

These are the Mode-B-play-test gate; ship together before any async-mode invite leaves the building.

| ID | Item | Notes |
|---|---|---|
| **P3D-1** | Wire campaign-manifest spoiler/place hybrid seams (`synthesizeBackstoryForSlot` reads `campaign.base.manifest.aiBackstory?`). | All P0.  Engine: ~30 LOC; unblocks the spoiler-wiring cluster. |
| **P3D-2** | Scrub `CC-13` task-tracker leak from user-facing error + add Mode B in-product warning. | All P0.  UX: "the seams are showing" moment that erodes confidence at first contact. |
| **P3D-3** | Strip play-app shell on chargen route; mobile-acceptable. | All P0.  UX: player on phone visits invite URL → 5-region cockpit instead of wizard. |

## Convergent P0 clusters (2+ lenses P0, treat as one body of work)

The reviewers independently flagged these clusters where one Phase 2 finding pulls in 3-5 catalog items.  Ship each as ONE commit, not separate.

### Cluster A — Spoiler-wiring (Mode-B safety guard)
- **P3D-1** (engine wiring; above)
- **P3A-2** (campaign-side spoiler list in `campaign.json` + system-prompt "don't use synonyms" line)
- **P3T-8** (Bay Area place allowlist in `campaign.json`)
- **P3A-16** (Unicode NFKC + strip ZWS before spoiler scan — F-S3 bypass)
- **P3A-18** (Strip markdown emphasis before spoiler scan — F-S5 bypass)

TTRPG: P0 cluster.  UX: P0 (without it, leak at session 1 is unrecoverable).  Engine: P0 (P3D-1) + P1 (rest).  Final: **P0 as one commit.**

### Cluster B — Mode-B works end-to-end
- **P3D-2** (in-product warning + scrub `CC-13` leak; above)
- **P3D-3** (strip shell; above)
- **P3U-3** (Mode B "Recommended → Required" pack-download copy)
- **CC-13** (DM-side pack intake — paste-token / WebRTC pull — the substantive fix behind the warning)

TTRPG: P0 (P3D-2/3) + P3U-3 P0.  UX: all P0 ("anyone trying async play hits all four immediately").  Engine: P0 (P3D-2/3) + P2 (CC-13).  Final: **P0 cluster.**  Note: CC-13 may slip to Phase 3b if the in-product warning closes 80% of the user-facing breakage.

### Cluster C — Sheet-ready PCs
- **P3T-1** (campaign-side: add skill-mastery + stat-array questions)
- **P3T-2** (engine: extend AI response schema with `skillMastery` + `stats`)
- **P3T-3** (campaign-side: prior-connection question)
- **P3T-4** (campaign-side: raise `meaningful-item` minLength)

TTRPG: P0 cluster (without these, synthesized PCs aren't playable).  UX: P1 (workflow works without sheet-ready, but barely).  Engine: P0 for P3T-2 (foundational schema), P3 for campaign-side items (not engine work).  Final: **P0 cluster** — TTRPG correctly observes that a synthesized PC who can't sit down to play means the DM does paperwork at the table.

### Cluster D — M3D-4b dice-Dock primary action
- **M3D-4b** (big "Roll 2d6" button + last-3 pills + result animation + R/1-6/+/-/Enter keyboard + Cast (Costly/Hard) macros)
- **M3C-2** (dice-roll dispatch placeholder fix — `result: 0` today)

TTRPG: M3D-4b P0 ("dice felt wrong" in first play-test; only stepper shipped).  UX: P0 ("ONE thing players do every turn").  Engine: P2 (stepper already shipped — incremental).  Final: **P0** — when 2 lenses say "table-friction highest", the engine's "we shipped some of it" doesn't override.  M3C-2 P1 follow-on.

## Convergent P0 — DM review surface (the next-substantive-chargen-touch)

The convergent finding from ALL FOUR Phase 2 reviewers: invite-manager + seat-strip + dm-aside should be one DM-review surface, not three stacked cards.  The same code change closes Engine §3 (ChargenController extraction), TTRPG #8 (SA-vs-backstory diff), and UX #15 (3-card merge).

### Cluster E — Unified DM-review surface
- **P3T-17** ≡ **CC-24** ≡ **P3U-12** ≡ **P3E-1** — same scope.
- **P3T-16** (DM side-by-side SA-vs-backstory diff view) — landed inside this surface.
- **P3U-11** (seat-strip resolve pcId → display name) — landed inside this surface.
- **P3T-19** ("ask this player to revise" affordance) — landed inside this surface.

TTRPG: P1 cluster (top-5 first-ship).  UX: **P0** ("the single biggest workflow item in the catalog").  Engine: P1 (the ChargenController extraction "next substantive chargen touch" lands here).  Final: **P0** — UX argues correctly that DMs rubber-stamp bad PCs without it; the size of the refactor doesn't change its impact.

## P1 — should land in next sub-milestone

### Synthesis-quality prompt cluster

| ID | Item | Convergence |
|---|---|---|
| **P3T-5** | Honor `aiRole` in `formatAnsweredQuestion` (~20 LOC; highest single-leverage prompt fix). | TTRPG P1; UX P1; Engine **P0** (engine right that this is the foundation under P3T-2 sheet-ready story). Settle P1. |
| **P3T-10** | Extend system prompt's `Avoid:` list with "main-character framing" + "early-life foreshadowing" + "self-conscious narration." | TTRPG P1; UX P1; Engine P3 (campaign-side). |
| **P3T-11** | Per-slot sensory-anchor injection so 5 PCs synthesized off same prompt vary. | TTRPG P1; UX P1; Engine P1. |
| **P3T-12** | Intent-moment paraphrase check (semantic validator extension). | TTRPG P0; UX P2 (DM gate covers); Engine P1 (also blocks CC-38/39 opt-out). Settle P1 — UX makes this conditional on Cluster E shipping with diff view; if Cluster E ships without diff, bump to P0. |

### Defense-in-depth security batch

| ID | Item | Notes |
|---|---|---|
| **P3A-1** | F-PI2 OPEN-tag escape in `wrapUntrusted`. | Engine **P0** ("same bug shape as the BLOCKER; gate should have escalated this too"). Settle P0-or-P1 — agreed-with-engine to P1 because the close-tag is the catastrophic case. |
| **P3A-10** | F-P2 pack answer-key newline/control/sentinel rejection. | Engine P0; UX P1; TTRPG P2. Settle P1 — engine's "smuggle vector across trust boundary" trumps TTRPG's "rare attack." |
| **P3A-12** | F-P4 1MB input cap on `parseChargenPack`. | Engine P0; UX P1; TTRPG P2. Settle P1. |
| **P3A-13** | F-L1 chargen-persistence slug-sanitize collision (include fingerprint in key). | Engine P0; UX P2; TTRPG P2. Settle P1 — engine's "multi-campaign DMs hit this" is real. |
| **P3A-19** | F-V3 hard tag-count upper bound as ERROR. | Engine P1; others P2. Settle P1. |
| **P3A-20** | F-V5 pronouns sanitization (40-char cap + char class). | Engine P1; others P2. Settle P1. |
| **P3A-21** | F-PI4 strip unknown fields from synthesis response. | Engine P1; others P2. Settle P1. |
| **P3A-14** | F-L3 chargen-persistence 256 KB cap with visible warning. | Engine P1; others P2. Settle P1. |

### Token codec hardening (smaller; bundle together)

| ID | Item | Notes |
|---|---|---|
| **P3A-4** | F-T1 fingerprint upgrade OR comment-as-collision-detector. | Engine P1; others P2. Bundle. |
| **P3A-5** | F-T2 4096-char input cap on `decodeInviteToken`. | Engine P1; others P2. Bundle. |
| **P3A-7** | F-T4 issuedAt future-window 24h → 1h. | Engine P1; others P3. Bundle. |
| **P3A-8** | F-T5 mirror decoder validation in encoder. | Engine P1; others P3. Bundle. |
| **P3A-9** | F-P1 `$schemaVersion` allowlist regex. | Engine P1; others P3. Bundle. |
| **P3A-11** | F-P3 reject pack `$schemaVersion` newer than current. | Engine P1; others P2. Bundle. |

### Tag suggestions + per-archetype consistency

| ID | Item | Notes |
|---|---|---|
| **P3T-6** | Per-archetype tag suggestion table in `campaign.json` (CC-29). | TTRPG P1; UX P2; Engine P3 (campaign-side). Settle P1. |
| **P3T-7** | Tag-vs-archetype validator check. | TTRPG P2; UX P2; Engine P1 (engine half of P3T-6). DEP P3T-6. Settle P1. |

### Player flow polish

| ID | Item | Notes |
|---|---|---|
| **P3U-1** | Drop Step 6 Resume; surface resume as banner on Step 1. | TTRPG P2; UX P1; Engine P1. Conditional: P1 only IF CC-11 resume lands same sub-milestone (else P2). |
| **P3U-5** | Hide / disable unimplemented chargen paths (free-write, pre-gen). | TTRPG P1; UX **P0**; Engine P1. Settle P1 — UX argues correctly that placeholder dev copy on a player-reached screen is a bad first impression. |
| **P3U-6** | Failure-banner imperatives + scrub task-tracker leaks. | TTRPG P1; UX P1; Engine P1. |
| **P3U-9** | Required-marker legend + soft-block validation on Next from Step 4. | TTRPG P1; UX P1; Engine P1. |
| **P3U-7** | Token-error states: "go back" button + DM-contact hint. | All P1/P2. Settle P1. |

### Nav + multi-peer

| ID | Item | Notes |
|---|---|---|
| **M3D-3b** | Heartbeat-based tri-state roster glyph + `peer-reclaim` event kind. | TTRPG P2; UX P1; Engine P1. Settle P1. |
| **M3D-5b** | Click-to-bind popover on `{{pc:N}}` + AI `pc-slot-bind` write tool. | TTRPG P1; UX P1; Engine P1. Foundational for CC-32..37 rebinding. |
| **M3D-7b** | `[`/`]` keyboard nav + Cmd-K palette + AI `requestNav` tool. | TTRPG P1; UX P1; Engine P2. Settle P1 — Cmd-K is load-bearing for DM mid-scene navigation. |

### AI cost discipline

| ID | Item | Notes |
|---|---|---|
| **CC-22** | 1h `cache_control` on synthesis prefix + parallel suffix calls. | TTRPG P2; UX P2; Engine P1. Settle P1 — engine right that token spend accumulates; cheap to add now. |
| **M3C-6** | Prompt-cache hit-rate verification (one-time measurement after first real session). | TTRPG P1; UX P2; Engine P2. Settle P1 — informs CC-22 priority. |
| **CC-14** | "Synthesize all backstories" DM batch button. | TTRPG P1; UX P1; Engine P1. |

## P2 — should land in next 2-3 sub-milestones

| ID | Item | Notes |
|---|---|---|
| **P3T-9** | Recent-transplant softening on place-allowlist warning. | Pairs with P3T-8 (Cluster A). |
| **P3T-13** | Reorder `campaign.json` questions (intent-moment higher). | Campaign-side; low-friction-when-touched. |
| **P3T-15** | Cross-PC name uniqueness check. | Annoying once; easy in DM review. |
| **P3T-18** | Regenerate-name / regenerate-tags finer-grained iteration. | Polish on CC-23b. |
| **P3U-2** | Pack-button from Step 4 onward. | Mode-B mitigation; CC-13 covers most. |
| **P3U-4** | Path-pick auto-advance or labeled-Next. | Workflow micro-polish. |
| **P3U-8** | Progress-strip done-state visuals. | Polish. |
| **P3U-10** | Q&A textarea: show character bound in placeholder. | Polish. |
| **P3U-13** | Path buttons → radiogroup semantics for a11y. | Right thing to do; low blast radius. |
| **P3U-14** | "Pack downloaded as quire-pc-…json — check Downloads" hint. | One-line. |
| **P3U-15** | Path-switch indicator on later steps. | Polish; depends on CC-7/CC-8 which are P3. |
| **P3U-16** | Returning-player welcome variant. | Depends on resume UX (P3U-1). |
| **CC-23b** | Re-roll / regenerate-paragraph / edit-freely iteration UX. | DEP Cluster E. |
| **CC-32 through CC-37** | Slot rebinding lifecycle. | SPLIT: PC-death rebind earlier than session-boundary independence. DEP M3D-5b. |
| **CC-4** | Per-PC `SaveDocument` typed shape. | Engine cleanup; lands when CC-32..37 multiply consumers. |
| **CC-16** | 72-hour crystallization soft-warning surface. | Engagement-layer polish. |
| **M3C-5** | `pushing-back` ladder transition gating. | Post-playtest. |
| **P3A-3** | F-V1/F-V2 generic semantic validator. | Subsumed by P3T-12 for the specific intent-moment case. |
| **P3A-6** | F-T3 double-URL-encode detection hint. | Surfaces once; copy fix. |
| **P3A-15** | F-L4 cross-tab `storage` event listener. | Rare lifecycle. |
| **P3A-17** | F-S4 retry bumps temperature OR pinpoint instruction. | Quality, not safety. |
| **P3A-22** | F-PI3 dmConstraints documentation + UI hint. | Civilized-DM assumption. |
| **P3A-23** | U-* test gap backfill (~15 tests). | Engineering hygiene. |
| **P3E-2** | `keyValueStore.ts` persistence abstraction. | TTRPG P3; UX P2; Engine P2 with caveat ("3 prefixes is fine; refactor when a 4th appears"). Settle P3 per tech-debt policy unless triggered by a new consumer. |
| **P3E-3** | Demote `AiProvider.parse` off the interface. | Wait for third AI shape (per gate's own gating). |
| **V-5** | `primaryRoll` UI wire-through. | Lands with M3D-4b (Cluster D). Embedded P1. |
| **V-12** | DM-only path predicate hardcoded in `buildPlayerFacingContext`. | Engine: "low-friction cleanup while touching P3D-1's hybrid seam." Lands inside Cluster A. Effective P1. |
| **Q-CC-1** | Async-mode archetype-deviation policy decision. | Needed before async-mode-at-scale. |
| **Q-CC-3** | "Use same device" wording. | Copy decision; user owns. |

## P3 — defer indefinitely

All three lenses agree these are non-impacting OR speculative.

| Category | Items |
|---|---|
| **Three chargen paths (over-engineering)** | CC-7 (free-write editor), CC-8 (pre-gen browser), CC-9 (path toggle). Convergent finding: P3U-5 hides them; ship Q&A polished, defer the rest to v2 entirely. |
| **DM-gate opt-out** | CC-38 (`aiBackstory.requiresDmApproval` flag), CC-39 (validator-still-runs path). Locked behind P3T-12 + P3A-3 landing; even then "feature that exists to be turned on and regretted." |
| **Constraint DSL** | CC-15 (`party_requires` / `party_unique`). DMs read 5 PCs and notice; speculative without play-test demand. |
| **Policy-in-engine refactors** | V-1, V-2, V-3, V-4, V-7, V-10. Locked decision: cross-campaign timeline is a good while out; zero user-visible improvement until campaign #2. |
| **Speculative chargen polish** | P3T-14 (alignment label deflation), P3U-15 (path-switch indicator). |
| **Engine hygiene without payoff** | P3E-4 (next-split candidates — 6-10 KB gzip recoverable but not where the bite is). |
| **Already-resolved / explicit-defer** | M3B-1 (IndexedDB full-text store), M3B-2 (topbar budget widget), M3B-3 (`playtest-1` tag), M3C-1b (no current debt), M3C-3 / M3C-4 (tolerated per threat model), Q-CC-2, Q-CC-4, Q-CC-5. |

## Recommended next-milestone scope (Phase 3a — ~1-2 weeks)

The P0 clusters fit cleanly into one sub-milestone targeting Mode-B safety + sheet-ready PCs.  Order them by dependency:

**Phase 3a-1 — Sheet-ready PCs (foundational schema):**
- P3T-2 (engine: response schema extension for `skillMastery` + `stats`)
- P3T-5 (engine: aiRole-aware `formatAnsweredQuestion`)
- P3T-1 + P3T-3 + P3T-4 (campaign-side: skill/stat questions, prior-connection, raise `meaningful-item` min)

**Phase 3a-2 — Spoiler-wiring cluster:**
- P3D-1 (engine wiring)
- V-12 (`buildPlayerFacingContext` path-predicate hybridization — landed inside the wiring touch)
- P3A-2 (campaign-side spoiler list + system-prompt synonyms line)
- P3T-8 (campaign-side Bay Area allowlist)
- P3A-16 (Unicode normalize before spoiler scan)
- P3A-18 (markdown emphasis strip before spoiler scan)

**Phase 3a-3 — Mode-B safety:**
- P3D-2 (in-product warning + scrub `CC-13` leak)
- P3D-3 (strip play-app shell)
- P3U-3 (escalate "Recommended → Required" copy)

**Phase 3a-4 — Dice-Dock primary action:**
- M3D-4b (big Roll 2d6 button + last-3 pills + Cast macros + keyboard)
- V-5 (primaryRoll UI wire-through; embedded in M3D-4b)
- M3C-2 (dice-roll dispatch placeholder fix)

**Phase 3a-5 — Unified DM review surface (the big refactor):**
- Cluster E as one body of work
- ChargenController extraction (P3E-1) lands as the vehicle, not standalone
- Cluster opens the seam for CC-23b, P3T-18, P3T-19 polish in Phase 3b

**Total estimated scope:** ~400-600 LOC + campaign-side `campaign.json` edits + tests.  Bundle budget under control via the lazy-loaded chargen chunks already in place.

## Phase 3b (the polish + nav phase, ~1-2 weeks)

- Defense-in-depth security batch (P3A-1 + P3A-10 + P3A-12 + P3A-13 + P3A-14 + P3A-19 + P3A-20 + P3A-21).
- Token codec hardening bundle (P3A-4 + P3A-5 + P3A-7 + P3A-8 + P3A-9 + P3A-11).
- Tag + per-archetype consistency (P3T-6 + P3T-7).
- Synthesis prompt polish (P3T-10 + P3T-11 + P3T-12).
- Player flow polish (P3U-1 + P3U-5 + P3U-6 + P3U-9 + P3U-7).
- Nav (M3D-3b heartbeat + M3D-5b click-to-bind + M3D-7b Cmd-K).
- AI cost (CC-22 + M3C-6 + CC-14).

## Open questions for the user (carry forward)

These are not engineering-blocking; surface as the next-session reprioritization conversation.

1. **Phase 3a/3b sequencing.**  Above proposes Phase 3a as the "Mode-B safety" tight focus, with the unified review surface (the biggest chunk) landed as the closing item.  Alternative: front-load the review surface, defer some 3a-1 sheet-ready work.  Either order works; pick by appetite.

2. **CC-13 in 3a or 3b?**  Three reviewers split: TTRPG P1, UX **P0** (without it Mode B can't actually work), Engine P2.  Recommendation: P3D-2's warning closes 80% of the user-facing breakage; CC-13 fits naturally in 3b.  But if the user expects async play in Phase 3, bump.

3. **P3T-12 (intent-moment paraphrase) — P0 or P1?**  TTRPG insists P0 because it's the magic-discovery arc's anchor; UX P2 because the DM-review surface (Cluster E) is the human-eyes guard.  Recommendation: P1 — if Cluster E ships with the diff view by default, the validator is a belt-and-suspenders layer; if Cluster E ships without it, bump P3T-12 to P0.

4. **Three-paths question (CC-7/8/9).**  All three lenses converged on "hide and defer to v2."  This is a meaningful product-scope decision; user confirmation recommended.

5. **DM-gate opt-out (CC-38/39).**  All three lenses recommend P3 (don't even design until P3T-12 + P3A-3 land).  TTRPG calls it "the feature that exists to be turned on and regretted."  Confirm: dropping the opt-out from the active backlog?

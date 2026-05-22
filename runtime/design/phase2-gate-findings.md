# Phase 2 gate verdict — 4-reviewer synthesis (2026-05-22)

**Status:** Phase 2 functionally complete; gate verdict **ship-with-followups**, mirroring the M3c milestone's earlier 4-reviewer pass shape.  One BLOCKER (F-PI1) was fixed inline before this doc; the rest of the findings carry forward as a Phase 3 backlog.

**Reviewers (parallel, post-CC-23 commit):**
- TTRPG-craft — will the synthesis produce *good characters*?
- UX — does the end-to-end flow bite a player or DM at a real table?
- Engine — are architectural choices going to make Phase 3 harder?
- Adversarial — what bypasses / smuggle vectors slipped through?

## Verdict at a glance

| Severity | Count | Status |
|---|---|---|
| BLOCKER | 1 | **fixed inline** (F-PI1; commit before this doc) |
| BIG | 17 | carried to Phase 3 backlog (P0/P1 split below) |
| MEDIUM | 23 | carried to Phase 3 backlog |
| NIT | 18 | low priority; opportunistic cleanup |

No severity-floor block.  The remaining BIGs are non-shipping-blocking but each one is a real concern that warrants its own commit; the chargen flow IS usable today after the F-PI1 fix.

## Convergent findings (multiple reviewers, same issue)

These deserve P0 status — when 2+ reviewers hit the same gap independently, the signal is high.

1. **Engine-vs-campaign hybrid seams exist but aren't wired.**
   - Engine §1: `synthesizeBackstoryForSlot` never reads `campaign.base.manifest.aiBackstory?.spoilerTokens` / `placeAllowlist`.
   - TTRPG #7 + #6: spoiler list too narrow (need synonyms); Bay Area allowlist not declared.
   - Adversarial F-S2: trivial synonym bypass.
   - **Resolution:** add the wiring + declare campaign-side fields.  Partly addressed by the F-S2 fix that extends `DEFAULT_SPOILER_TOKENS`; the wiring + per-campaign override is still pending.

2. **DM has no rich review surface for synthesized PCs.**
   - TTRPG #8: DM can't compare SA vs backstory; rubber-stamps bad PCs.
   - UX #14: seat-strip shows raw pcId not display name.
   - UX #15: invite-manager + seat-strip + dm-aside are three stacked cards with no grouping.
   - Engine §3: ChargenController extraction would unify ownership.
   - **Resolution:** CC-24 (DM-approval gate) lands as a unified "Seat → PC → backstory" surface, NOT as a banner on invite-manager.  Wraps seat-strip + per-seat-synthesize + per-seat-review-pill into one card.

3. **Validator + spoiler check are STRUCTURAL only; no semantic content guard.**
   - Adversarial F-V1: validator passes "the Hush" / "the Stillness" backstories.
   - Adversarial F-V2: validator never checks the intent-against-pressure SA is reflected in the backstory.
   - TTRPG: missing tag-vs-archetype consistency, missing SA-vs-backstory consistency.
   - **Resolution:** content checks land in Phase 3 (CC-27 SA-vs-MC consistency from the F5 critique).  In the meantime, CC-24's human-eyes gate is the actual semantic check — and CC-39 (DM-gate opt-out) MUST NOT allow opt-out when the campaign has spoilers declared.

4. **Mode B has multiple silent breakages.**
   - UX #3: error message leaks `CC-13` to users; no in-product warning that pack-import isn't wired.
   - UX #5: "Recommended" pack-download language too weak (in Mode B it's MANDATORY).
   - **Resolution:** mode-detection in the chargen region (no live coord → Mode B → escalate copy + add in-product Mode-B warning to invite-manager).

5. **Question quality gaps that make synthesized PCs unplayable.**
   - TTRPG #1: no skill-mastery + no stat array (PCs aren't sheet-ready).
   - TTRPG #2: prior-connection-to-another-PC missing.
   - TTRPG #3: `meaningful-item` 10-char minimum lets players bypass with "my watch".
   - **Resolution:** campaign-side changes to `underleaf/campaign.json`; engine-side may need to extend the synthesis response schema for stat/skill data.

## Per-reviewer findings (full details in scrollback)

### TTRPG-craft (4 BIG / 4 MEDIUM / 1 NIT)
- BIG: skill+stat missing from Q&A; prior-connection question missing; meaningful-item min too low; `aiRole` ignored in formatAnsweredQuestion.
- BIG (failure modes surviving CC-20+CC-21): PCs all sound the same; tag-vs-archetype drift; fictional places; backstory contradicts intent-SA.
- BIG (DM workflow): no SA-vs-backstory comparison surface; no surface for "AI took liberties on the mandatory question".
- MEDIUM: flight-reason doubles up timing; system prompt missing "main-character framing" avoid; no per-call sensory anchor.
- NIT: alignment labels too loaded; pronouns sanitization.

### UX (3 BIG / 9 MEDIUM / 6 NIT)
- BIG: full play-app shell wraps chargen wizard; Step 6 Resume is phantom; Mode B silent breakage with `CC-13` leak.
- MEDIUM: Pack button only on step 5; recommended-language too weak; path-pick has no commit affordance; placeholder dev copy for free-write/pre-gen; synth failure banners no next-action; token-error states are dead-ends; mobile hostile; progress strip no done-visuals; required-marker no legend + no validation enforcement.
- NIT: textarea sizing; seat-strip raw pcId; 3-card DM chargen surface; radiogroup semantics; pack download "where did it go?"; no path-switch indicator.

### Engine / architecture (1 BIG / 3 MEDIUM / 4 NIT)
- BIG: QuireApp @state count at 40 + 4 chargen-lifecycle promises; ChargenController extraction recommended.
- MEDIUM: Engine-vs-campaign drift (hybrid seams unread); persistence triplication (3 localStorage prefixes); `AiProvider.parse` vestigial for synthesis.
- NIT: result union shape OK; code-split posture OK; mockProvider test pattern OK; AppRoute per-route error variant OK.

### Adversarial (1 BLOCKER / 9 BIG / 13 MEDIUM / many NIT)
- **BLOCKER F-PI1: triple-quote close-tag bypass → fixed inline before this doc.**
- BIG: spoiler list trivially synonym-defeated (F-S2 — partly addressed); validator semantic gaps (F-V1/V2); pack answer-key sanitize (F-P2); pack schema-version newer-version downgrade (F-P3); chargen-persistence slug-sanitize collision (F-L1); chargen-persistence size cap (F-L3); validator tag count error (F-V3); dmConstraints AI-roundtrip injection surface (F-PI3).
- MEDIUM: campaignFingerprint djb2 only (F-T1); decode bounded input (F-T2); double-URL-encode failure (F-T3); retry-doesn't-bump-temperature (F-S4); markdown-emphasis bypass (F-S5); etc.

## Recommended Phase 3 backlog ordering (post-this-doc)

Each item is a follow-up commit; ordered roughly by impact × cost.

### P0 — should land before any Mode B play-test (3 items)
- **P0-1: Wire campaign-manifest spoiler/place hybrid seams** (Engine §1; ~30 LOC).  Make `synthesizeBackstoryForSlot` read `campaign.base.manifest.aiBackstory?` and forward `spoilerTokens` + `placeAllowlist` to the synthesizer.  Adds 1 campaign-schema field + the wire path.
- **P0-2: Scrub `CC-13` reference from user-facing error + add Mode B in-product warning** (UX #3; ~20 LOC + copy).  Today's error message leaks task-tracker IDs to users; Mode B is silently broken with no surfaced warning.
- **P0-3: Strip play-app shell on chargen route** (UX #1, #10; ~50 LOC).  Player visiting invite URL sees clean single-column wizard, not the full 5-region cockpit.  Mobile-compatible.

### P1 — should land before Phase 3 closes (8 items)
- **P1-1: Drop Step 6 Resume; surface resume as banner on Step 1** (UX #2; small).
- **P1-2: `aiRole`-aware formatAnsweredQuestion** (TTRPG #4; ~20 LOC).  Highest single-leverage prompt improvement.
- **P1-3: Failure-banner imperatives + scrub task-tracker leaks** (UX #8; copy work).
- **P1-4: SA-vs-backstory consistency check** (TTRPG + Adversarial F-V2; Phase 3 implementation of CC-27).
- **P1-5: Add prior-connection + skill-mastery questions to Underleaf campaign.json** (TTRPG #1, #2; campaign-side).
- **P1-6: Per-PC review surface in invite-manager / seat-strip** (TTRPG + UX #15; CC-24 implementation).
- **P1-7: ChargenController extraction** (Engine §3; ~250 LOC refactor).  Triggered by next substantive chargen change.
- **P1-8: Hide / disable unimplemented chargen paths (free-write, pre-gen)** (UX #7; ~10 LOC).

### P2 — opportunistic / next-touch (many items)
All MEDIUM findings not listed above.  Triage at the start of Phase 3 implementation.

### P3 — defer
NITs.  Touch when adjacent code is being modified anyway.

## Decisions locked

- **F-PI1: FIXED** (this gate review's BLOCKER).  Commit before this doc.
- **F-S2 partial: FIXED** (extended `DEFAULT_SPOILER_TOKENS` to 17 entries).  Wiring + campaign-side declaration remains as P0-1.
- **CC-24 + Engine §3 + UX #15 — same scope**: the per-seat DM-approval gate, the per-seat name-display fix, and the seat-strip-vs-invite-manager merge ARE the same UI surface.  Implement as one item, not three.
- **CC-39 opt-out is dangerous when CC-20 is the only check**: don't ship CC-39 (opt-out from DM gate) until either F-V1 (semantic validator) lands OR the campaign-manifest can declare "spoilers-mandate-gate" to forbid opt-out.

## Outcome

The synthesis call works end-to-end (1284 tests pass; bundle under budget; Mode A flow is real).  Phase 2 ships with the F-PI1 fix in place.  Phase 3 priorities are clear and the convergent findings give a natural P0 cluster (3 items, ~100 LOC + copy) that closes the highest-impact remaining gaps.

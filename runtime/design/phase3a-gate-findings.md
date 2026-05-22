# Phase 3a milestone-close — 4-reviewer synthesis (2026-05-22)

**Status:** Phase 3a functionally complete; gate verdict **ship-with-one-blocker-and-followups**, mirroring the Phase 2 gate's shape.  All five P0 clusters (A through E) + the sanity-review batch landed; ~20 commits across `quire/runtime` + `underleaf`.

**Reviewers (parallel, post-Cluster-E):**
- TTRPG-craft — will the implemented system support good play?
- UX — does the end-to-end flow work for real players + DMs?
- Engine — code quality + boundary discipline + Phase 3b launchpad strength.
- Adversarial — security gaps + threat-model regressions.

## Verdict at a glance

| Severity | Count | Lens-attribution |
|---|---|---|
| BLOCKER | 1 | TTRPG (verified by absence in UX/Engine/Adv punchlists too) |
| BIG | 10 | 2 TTRPG + 5 UX + 2 Engine + 1 Adversarial |
| MEDIUM | 15 | spread across all four lenses |
| NIT | many | bundled into Phase 3b natural-touch list |

No reviewer found a play-test-blocking defect EXCEPT the single load-bearing BLOCKER below; the other UX-claimed BLOCKERS were doc-reconciliation and flow-length items that don't actually prevent play.

## Convergent findings (multiple reviewers, same issue)

These deserve P0 status in Phase 3b — when 2+ reviewers hit the same gap independently, the signal is high.

### Convergent-1 (THE blocker): Accept produces no playable PC
**Lenses**: TTRPG **B1** (explicit BLOCKER); UX (implicit — no DM workflow surface for "now play with the synth"); Engine (implicit — no PC document is ever written; the audit chain has nothing to commit to).

`chargen-controller.ts:287-297` — `acceptSlot()` emits a scratch-note (`"DM accepted synthesized PC for slot N: name=X, responseId=Y"`) and flips the local `_acceptedSlots` flag.  Nothing else.  No `pc-edit` event, no character JSON write, no slot binding.  At session 1:

- DM clicks Accept → seat still shows the raw `pcId` (because `getBoundCharacter` resolves the bound id, not the synthesized PC).
- Player has no sheet (`<player-rail>` reads `boundCharacter`, which is null because nothing wrote a record).
- `<dice-dock>` receives `stats: null` → no Cast macros render → "the ONE thing players do every turn" is broken.
- The DM-review surface is FOREVER stuck at "Accepted" with no path forward.

**Resolution**: Phase 3b-1 MUST land the materialization step.  Two options:
1. **CC-4 SaveDocument** (proper) — a `pc-create` (or equivalent) event writes the synthesized PC into `characters/pcs/<id>.json` campaign state; the existing character-loader picks it up.  Pairs with the per-PC SaveDocument model the synthesis was designed to feed.
2. **In-memory PC overlay** (cheap) — a session-event-log entry that the bound-character resolver reads as the canonical PC for the slot.  Faster to ship; longer-term debt.

Recommend option 1.  Without one of them, Phase 3a is verification-only software; you cannot actually play.

### Convergent-2: Rubber-stamp safety on the DM review surface
**Lenses**: UX (default-collapsed expand + 9-seats-always + Mode-B banner permanent); TTRPG (SA-vs-backstory diff heuristic too permissive — stop-list needed); Adversarial (substring `indexOf` highlight skips word-boundary check — "plane" highlights inside "explained").

Cluster E built the unified DM review surface specifically to PREVENT rubber-stamping.  As shipped, the safety net is hidden behind an expand button, the highlight heuristic produces false-confidence hits, and the surface renders 9 seats regardless of party size.  The result is "the DM sees ✓ name + chips + stat-grid + warning-count and accepts."

**Resolution** — small bundle of fixes:
- Default-expand the diff on first render of an un-accepted `ok` result (`chargen-dm-review.ts:297, 326-331`).
- Filter `ALL_SLOTS` by campaign-declared party size (or by bound/invite-issued slots).  Avoids "do I need 9 players?" confusion.
- Auto-collapse the Mode-B banner once any seat is accepted (or one-time-dismiss).
- Add a small stop-list to the highlight-token extractor (`chargen-dm-review.ts:527-545`); drop "really / thing / first / never / always / mother / father / friends" before adding to the highlight set.
- Tighten highlight match with the same lookaround discipline as `containsSpoilerTokens` (`chargen-dm-review.ts:578-616`).

### Convergent-3: Cast (Hard, −2) silent worst-case
**Lenses**: TTRPG **B4** (rules-loss — rules.md L122 says "−1 to −2 penalty (DM judgment)"); UX **BIG** (a DM clicking the macro silently loses the −1 reading).

`dice-dock.ts:212-215, 257` always emits `2d6 + WIS − 2 + offset`.  The label and tooltip declare the −2 worst-case, but the macro doesn't surface the choice.

**Resolution**: split into two macros — `Cast (Hard, −1)` + `Cast (Hard, −2)` two-button row — OR open the stepper with −2 pre-filled instead of auto-rolling.  Preserves DM judgment at the click site, not buried in tooltip text.

### Convergent-4: AI-proposed wild outcome (double-1) has no player-visible signal
**Lenses**: TTRPG **B2** (the doubles halo in `quire-app.ts:2223` only fires on direct player rolls, not AI-dispatched); Engine **MEDIUM #3** (the wild-outcome detection is `[C]` policy hardcoded in engine — should be campaign-declared); Adversarial **M1** (AI-controlled `purpose` in the wild-outcome scratch-note is unscanned).

Engine M1 (step 7a) emits a scratch-note when AI-dispatched rolls come up double-1, but: the player only sees the standard roll result (no halo), the threshold is hardcoded in engine, and the scratch-note text contains AI-controlled `purpose` that has no spoiler scan.

**Resolution** — three-part fix:
- Route AI-dispatched rolls through the same halo-computation path as player rolls (`quire-app.ts:2223`); cheap fix since `dispatch` already has `rolled.rolls`.
- Move wild-outcome threshold to campaign manifest (`rules.wildOutcomes[…]` or similar) — Engine boundary fix.
- Scan `purpose` for spoiler tokens when emitting the scratch-note (or sanitize / cap to 80 chars per the Adversarial #M1 recommendation).

### Convergent-5: Engine-vs-campaign boundary drift
**Lenses**: Engine **BIG B2** (hardcoded Underleaf question IDs `flight-reason / prior-connection / meaningful-item / intent-moment` + human labels "Why on Flight 887?" inside `<chargen-dm-review>`); Engine **MEDIUM #3** (wild-outcome predicate hardcoded).

`chargen-dm-review.ts:480-485` violates the engine/campaign discipline doc (`engine-vs-campaign-boundary.md` L116-122) — "every new violation either gets a hybrid shape or gets the TODO comment."  Neither happened.

**Resolution** — pick one per site:
- Minimum: add `TODO(campaign-policy)` flag (cheap, preserves discipline audit).
- Better: campaign manifest declares `CampaignCharCreationQuestion.diffAnchor?` per question; engine reads it.

### Convergent-6: Pre-Phase-3b bundle hygiene
**Lenses**: Engine **BIG B1** (CSS for the lazy `chargen-dm-review` + `character-creation` chunks lives in the eager main bundle); UX (visual-bundle drift on amber callouts not using `--dm-amber` token, lint-level).

49 `.chargen-dm-review-*` rules + ~30 `.character-creation-*` rules ship in `quire-app.css.ts` (main bundle) even though the elements only ever mount in chargen contexts.  Reclaimable ~1-2 KB main-bundle.

**Resolution**: extract per-region CSS to the region modules via Lit's `static styles` (or a sibling `.css.ts`) so the lazy chunks own their style.  ~30 min of mechanical refactor.

## Non-convergent BIG findings (single-lens; worth Phase 3b cluster)

These are real BIGs but not multi-lens convergent.  Group them by Phase 3b cluster shape:

### UX BIG: Step 4 question-flow grouping
13 questions in a single `<ol>` with no sub-section headers (`character-creation.ts:397-407`).  At ~340ch viewport reads as a wall of textareas.  Emit `<h3>` separators ("About your PC" → "Mechanics" → "Anchors") since the question IDs encode the arc.

### UX BIG: Revise modal uses `window.prompt()`
Native OS dialog, can't be themed, blocks the page, offers no synth preview.  Phase 3b candidate: small in-region inline form (textarea + reason chips + cancel/send).  Adversarial M2 pairs here — also add input cap (`window.prompt` is unbounded; scratch-note text cap of 5000 chars silently drops the entire note when exceeded).

### UX BIG: `<dm-aside>` ordering
Renders ABOVE `<chargen-dm-review>` (`quire-app.ts:1138-1152`).  In session 1, the DM's primary workflow IS chargen review; thread-debt is irrelevant until session 2+.  Conditional reorder: review-surface first when any seat is unaccepted; demote below dm-aside once all accepted.

### TTRPG MEDIUM: Question count + flow tuning
- `intent-horizon` (Q6) is a preview question for `intent-moment` (Q12); answer is mechanically unused.  Drop or fold.
- `default-weirdness-response` (Q4) has `aiRole: skeleton` but its value would be voice-shaping; upgrade or drop.
- Chargen is actually 13 questions, not the 12 referenced in commit messages — doc reconciliation.

### TTRPG MEDIUM: Spoiler-token Underleaf-specific gaps
Add `"thread"`, `"threads"`, `"unforced"` to the campaign spoiler list — Underleaf-specific magic vocab that the AI naturally produces when paraphrasing `intent-moment` answers.

### TTRPG MEDIUM: maxSkillMastery too lenient
Validator allows 2-4 picks; rules cap is "+2 from skills" so 2 is canonical, 3 generous, 4 violates intent.  Drop to 3 (`backstory-validator.ts:102`).

### TTRPG MEDIUM: Prior-connection "estranged family" reads dramatic
Add a softer "Family — same family, but not close (cousins, in-laws)" alongside.  Players who don't want the soap-opera potential have a non-dramatic family option that still defuses the strangers-on-flight collapse.

### Engine MEDIUM: Map/Set churn in dm-review adapter
`quire-app.ts:1194-1218` builds three fresh Map/Set instances on every QuireApp render.  Fine for 9 slots but bites if Phase 3b adds heartbeat-frequency renders.  Cache + invalidate on controller-mutate.

### Engine MEDIUM: `pcCharacterCache` vs `boundCharacter` bridge
Two caches, still independent.  Bridge in `refreshBoundCharacter` (`quire-app.ts:2477`); ~3 LOC.

### Engine MEDIUM: Dead delegate stubs
`quire-app.ts:1268` (`synthesizeBackstoryForSlot`) + L1276 (`generateInviteUrl`) — no callers outside the file.  Delete; touch the `SynthesizeBackstoryResult` doc-comment that references the dead delegate.

### Adversarial BIG: F-S5c (NEW) mixed glue+split bypass
Two-scan sanitize (F-S5b) doesn't cover tokens that use the SAME strip-char as BOTH glue AND splitter: `the*Q*uiet` → collapsed = `theQuiet` (lookbehind sees `e`, no match) → spaced = `the Q uiet` (no contiguous "Quiet").  Civilized-AI threat-model survives but the doc overstated coverage.  Add a third scan that strips `[*_]` AND splits-on-runs-of-format-chars, OR add a unit test asserting this case and document as known-residual.

### Adversarial MEDIUM: F-PI4 reassessment
The accept-scratch-note in Cluster E is a new reader of the synthesis response that didn't exist when F-PI4 was P1-deferred.  Re-evaluate priority — extra AI fields now have a downstream consumer.

## Recommended Phase 3b cluster candidates

Convergent findings drive cluster definition (same shape as Phase 2 gate → Phase 3a clusters).

### Phase 3b-1 — PLAYABLE PC (Convergent-1 BLOCKER)
Single most important commit.  Materialize the synthesized PC on accept:
- `pc-create` (or equivalent) event kind + materializer.
- Write to campaign character-loader path OR session-event-log overlay.
- Wire `boundCharacter` resolution to pick up the new PC.
- Sheet view + dice-dock stats consume the materialized record.

### Phase 3b-2 — DM REVIEW RUBBER-STAMP DEFENSE (Convergent-2)
Cluster of small fixes targeting "the safety net is too easy to skip":
- Default-expand the diff for un-accepted seats.
- Filter `ALL_SLOTS` by party size.
- Auto-collapse Mode-B banner once any seat is accepted.
- Stop-list for the highlight heuristic.
- Word-boundary discipline on highlight match.
- Move `<chargen-dm-review>` above `<dm-aside>` when any seat is unaccepted.

### Phase 3b-3 — CAST RULES FIDELITY (Convergent-3)
- Split Cast (Hard) into `−1` + `−2` (or stepper-pre-fill).
- Engine boundary fix for wild-outcome threshold (campaign-declared).
- Route AI-dispatched rolls through halo-computation path.
- Scan AI-controlled `purpose` for spoiler tokens when emitting scratch-notes.

### Phase 3b-4 — ENGINE HYGIENE (Convergent-5 + Convergent-6)
Bundle of cheap touches before Phase 3b grows the codebase further:
- CSS to lazy chunks via `static styles`.
- `TODO(campaign-policy)` on the Underleaf-id-hardcoded sites OR proper `diffAnchor?` campaign-declared shape.
- Delete dead delegate stubs.
- pcCharacterCache bridge.
- Map/Set churn cache.

### Phase 3b-5 — CHARGEN FLOW TUNING (TTRPG/UX MEDIUMs)
- Question-grouping `<h3>`s in step 4.
- Reconcile question count (drop `intent-horizon` or upgrade).
- maxSkillMastery 4 → 3.
- Spoiler tokens: add "thread"/"threads"/"unforced".
- Prior-connection: add softer "Family — not close" option.
- Trim step-5 implementation-apology copy + resolve "backup vs required" framing.
- Revise modal → inline form with reason chips.

### Phase 3b-6 — SECURITY FOLLOWUPS (residual)
- F-S5c third-scan OR documented-residual + regression test.
- F-PI4 priority reassessment.
- F-V3 / F-V5 / F-P2 / F-P4 / F-L1 / F-L3 still backlogged from Phase 2 — pick up in this cluster.

## Confirmed clean (no follow-up)

- **STABLE CONTRACT freezes** — `SynthesizeBackstoryResult`, `PcBackstorySynthesisResponse`, `CampaignAiBackstory`, `ChargenHost` all stable.
- **ChargenController cohesion** — 600 LOC, 9 callbacks; not bloated.
- **`<chargen-dm-review>` coherence** — 668 LOC; per-seat-card extraction would be premature.
- **F-PI1 wrapUntrusted** — intact.
- **F-S2 spoiler synonyms list** — 17 + Underleaf-specific tokens.
- **F-S3 NFKC normalize** — intact.
- **F-S5 markdown emphasis strip** + **F-S5b glue-collapse fix** + **F-S6 expanded Cf class**.
- **F-S7 (homoglyphs) deferral** — still appropriate; system-prompt + auto-retry are primary defense.
- **F-PI1 → present** — no XSS regressions on the new `<chargen-dm-review>` interpolation points (all via Lit's `${...}` auto-escape).
- **`isPcStats` validator** — robust against bool/string/NaN/Infinity/non-integer/missing-key.
- **Caster-state snapshot revert** (Engine B2) — correct multi-update behavior verified.
- **Audit-chain scratch-note copy** — parseable; recommended to switch to `kind:` prefix when a third structured site lands.
- **Bundle health** — main 100-103 KB / 110 KB cap.
- **Test coverage** — 1369 tests; new regions/controllers covered.

## Outcome

Phase 3a is a **strong milestone** — the unified DM-review surface, the sheet-ready PC schema, the spoiler-wiring hardening, the dice-Dock primary actions, the chargen-shell strip, and the Cluster-E controller extraction all ship cleanly.  The codebase is genuinely a stronger Phase 3b launchpad than Phase 3 began with.

The single BLOCKER is also the single most important Phase 3b commit — the system as shipped lets the DM REVIEW a PC but not PLAY with one.  Phase 3b-1 must close that loop before any first play-test.

After 3b-1, the convergent-2 (rubber-stamp defense) and convergent-3 (Cast rules fidelity) clusters are the highest-value next bodies of work.

The four reviewers cite this milestone as the closest the project has been to play-ready.  Don't lose momentum.

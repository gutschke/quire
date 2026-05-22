# Phase 3 catalog — all open work items (2026-05-22)

Comprehensive list of every open work item at the close of Phase 2, consolidating:
- The 17 BIG / 23 MEDIUM / 18 NIT findings from the Phase 2 4-reviewer gate (`phase2-gate-findings.md`).
- Original `backlog-catalog.md` items still un-landed (M3D follow-ons, CC items, V-* tech debt, etc.).
- Open Q-CC questions awaiting decision.

Each row carries: stable ID • engine/campaign tag [E]/[C]/[H] • one-line description • source reviewer (when from Phase 2 gate) or source doc.

This catalog feeds a 3-lens prioritization pass (TTRPG-craft / UX / Engine) that replaces `prioritized-backlog.md`'s synthesis.

---

## Items already P0-flagged by the Phase 2 gate

Three items the gate review's convergent findings raised to "ship before any Mode B play-test."  Re-listed here for completeness; experts should confirm or adjust.

| ID | E/C/H | Description |
|---|---|---|
| **P3D-1** | E | Wire campaign-manifest spoiler/place hybrid seams (Engine §1; ~30 LOC). `synthesizeBackstoryForSlot` doesn't read `campaign.base.manifest.aiBackstory?` even though the synthesizer accepts `spoilerTokens?` / `validatorOptions.placeAllowlist`. |
| **P3D-2** | E | Scrub `CC-13` user-facing leak + Mode B in-product warning (UX #3). Today's error message says `"Import the player's pack first (CC-13)"` — task-ID literal in user copy. Mode-B DMs have no in-product warning that pack-import isn't wired. |
| **P3D-3** | E | Strip play-app shell on chargen route (UX #1, #10; ~50 LOC). Player visiting invite URL sees full 5-region cockpit instead of single-column wizard. Also unblocks mobile. |

## Phase 2 reviewer findings carried (sorted by reviewer)

### TTRPG-craft items (originally P1+)

| ID | E/C/H | Description |
|---|---|---|
| **P3T-1** | C | Add skill-mastery + stat-array questions to Underleaf campaign.json (TTRPG BIG #1). Without these, synthesized PCs aren't sheet-ready. |
| **P3T-2** | E | Extend AI response schema with `skillMastery` + `stats` fields so the result is sheet-ready (engine half of P3T-1). |
| **P3T-3** | C | Add prior-connection-to-another-PC question (TTRPG BIG #2). Load-bearing per `pcs/README.md` L39. |
| **P3T-4** | C | Raise `meaningful-item` minLength from 10 → 40-60 chars (TTRPG BIG #3). |
| **P3T-5** | E | Honor `aiRole` in `formatAnsweredQuestion` (TTRPG BIG #4). Each role (`voice-sample` / `grounder` / `skeleton`) gets a different presentation instruction. ~20 LOC. |
| **P3T-6** | C | Per-archetype tag suggestion table in `campaign.json` (TTRPG BIG #5; CC-29). Prevents AI from drifting tags off-archetype. |
| **P3T-7** | E + C | Tag-vs-archetype validator check (TTRPG BIG #5 engine half). Validator warns when none of the suggested tags appear. |
| **P3T-8** | C | Bay Area place allowlist in `campaign.json` (TTRPG BIG #6; CC-30). |
| **P3T-9** | E | Recent-transplant softening of place-allowlist warning (TTRPG MEDIUM). |
| **P3T-10** | C | Extend system prompt's `Avoid:` list with "main-character framing" + "early-life foreshadowing" + "self-conscious narration" (TTRPG MEDIUM). |
| **P3T-11** | E | Per-slot sensory-anchor injection so 5 PCs synthesized off the same prompt get tone variance (TTRPG BIG). |
| **P3T-12** | E | Intent-moment consistency check (validator extension): backstory must paraphrase the player's verbatim intent-moment SA (TTRPG BIG; CC-27). |
| **P3T-13** | C | Reorder `campaign.json` questions: intent-moment higher (anchors later questions); split flight-reason into reason + timing (TTRPG MEDIUM). |
| **P3T-14** | C | Deflate alignment labels (drop "destruction tastes good" wink) (TTRPG NIT). |
| **P3T-15** | E | Cross-PC name uniqueness check (validator extension) (TTRPG NIT). |
| **P3T-16** | E | DM side-by-side SA-vs-backstory review surface (TTRPG BIG #8). Diff view or paired-quote display so the DM can spot AI liberties. |
| **P3T-17** | E | Per-PC review-pill on seat-strip with expandable detail (TTRPG BIG #8 + UX #15 + Engine §3 — same scope). |
| **P3T-18** | E | "Regenerate name" / "regenerate tags" finer-grained iteration affordances (TTRPG MEDIUM). |
| **P3T-19** | E | Per-PC "ask this player to revise" affordance (TTRPG MEDIUM). |

### UX items

| ID | E/C/H | Description |
|---|---|---|
| **P3U-1** | E | Step 6 "Resume" → drop from progress strip; surface resume as a banner on Step 1 (UX BIG #2). |
| **P3U-2** | E | Pack-my-character button from Step 4 onward (UX MEDIUM #4). Passive affordance until Step 5's strong CTA. |
| **P3U-3** | E | Mode-B escalate "Recommended" → "Required" for pack download (UX MEDIUM #5). Detect mode by absence of live coord. |
| **P3U-4** | E | Path-pick auto-advance OR Next labeled with selection (UX MEDIUM #6). |
| **P3U-5** | E | Hide / disable unimplemented chargen paths (free-write, pre-gen) (UX MEDIUM #7). |
| **P3U-6** | E + C | Failure-banner imperatives (UX MEDIUM #8). "Action: X" line per failure code. Copy work. |
| **P3U-7** | E | Token-error states get a "go back" button + DM-context hint (UX MEDIUM #9). |
| **P3U-8** | E | Progress strip done-state visual treatment (UX MEDIUM #11). Checkmark / fill bar between pips. |
| **P3U-9** | E | Required-marker legend + soft-block validation on Next from Step 4 (UX MEDIUM #12). |
| **P3U-10** | E | Q&A textarea: show bound ("10-400 characters") in placeholder before typing begins (UX NIT). |
| **P3U-11** | E | Seat-strip: resolve pcId → display name (UX NIT #14). |
| **P3U-12** | E | DM cockpit chargen surface: merge invite-manager + seat-strip into one card (UX NIT #15). |
| **P3U-13** | E | Path buttons → radiogroup semantics for a11y (UX NIT #16). |
| **P3U-14** | E | Pack download "where did it go" hint in feedback line (UX NIT #17). |
| **P3U-15** | E | Path-switch indicator on later steps (UX NIT #18). |
| **P3U-16** | E | Returning-player welcome copy variant ("your answers are loaded") (UX NIT out-of-lane note). |

### Engine items

| ID | E/C/H | Description |
|---|---|---|
| **P3E-1** | E | ChargenController extraction from QuireApp (Engine BIG §3). ~250 LOC refactor; do at next substantive chargen touch. |
| **P3E-2** | E | `keyValueStore.ts` abstraction to dedupe the 3 localStorage prefix consumers (Engine MEDIUM §5). Single IndexedDB-migration seam. |
| **P3E-3** | E | Demote `AiProvider.parse` off the interface; let each caller own parsing (Engine MEDIUM §8). Wait for third AI shape OR move broker's own parse out of provider impls. |
| **P3E-4** | E | Next-split candidates: `dm-rail` / `dm-aside` / `dm-scratch` / `ai-panel` — player session loads these unconditionally; ~6-10 KB gzip recoverable (Engine NIT §4). |

### Adversarial items (BLOCKER F-PI1 already fixed; F-S2 partial done)

| ID | E/C/H | Description |
|---|---|---|
| **P3A-1** | E | F-PI2: extend `wrapUntrusted` to escape the OPEN tag, not just close (Adversarial BIG). |
| **P3A-2** | E + C | F-S2 completion: declare per-campaign spoiler list in `campaign.json` (campaign side) AND add CC-19 system-prompt line telling the AI not to use synonyms (campaign side). |
| **P3A-3** | E | F-V1/F-V2: validator semantic content checks (intent-moment paraphrase detection; "the Hush"-style synonym detection). |
| **P3A-4** | E | F-T1: upgrade `campaignFingerprint` from djb2 to SHA-256-truncated-128-bits via Web Crypto, OR comment explicitly that fingerprint is collision-detector not security identity. |
| **P3A-5** | E | F-T2: bound `decodeInviteToken` input length at 4096 chars. |
| **P3A-6** | E | F-T3: detect double-URL-encoded tokens (`%2B`/`%2F`) and surface "did you copy the WHOLE URL?" |
| **P3A-7** | E | F-T4: tighten future-dated `issuedAt` boundary from 24h to 1h. |
| **P3A-8** | E | F-T5: mirror decoder validation in encoder (validate `issuedAt` / `campaignFingerprint` at encode time). |
| **P3A-9** | E | F-P1: tighten `$schemaVersion` regex to allowlist of known versions. |
| **P3A-10** | E | F-P2: reject pack answer keys containing newlines / control chars / sentinel substrings. |
| **P3A-11** | E | F-P3: reject pack `$schemaVersion` newer than current (prevents downgrade attack). |
| **P3A-12** | E | F-P4: caller-side input cap on `parseChargenPack` (~1 MB). |
| **P3A-13** | E | F-L1: chargen-persistence slug-sanitize collision (include fingerprint in key OR use percent-encoded slug). |
| **P3A-14** | E | F-L3: chargen-persistence size cap at ~256KB with visible warning on exceed. |
| **P3A-15** | E | F-L4: cross-tab `storage` event listener so cleared state notifies other tabs. |
| **P3A-16** | E | F-S3: Unicode normalize (NFKC + strip ZWS) before spoiler scan. Catches `"Qu​iet"` and homoglyph attacks. |
| **P3A-17** | E | F-S4: retry bumps temperature OR appends pinpoint instruction (vs same prompt). |
| **P3A-18** | E | F-S5: strip markdown emphasis (`*`, `_`, `**`) from backstory before spoiler scan. Catches `"the **Q**uiet"`. |
| **P3A-19** | E | F-V3: hard upper bound on tags count (e.g., 20) as ERROR severity, not warning. |
| **P3A-20** | E | F-V5: pronouns sanitization (40 char cap; `[A-Za-z/\s]` only). |
| **P3A-21** | E | F-PI4: strip unknown fields from synthesis response (defense-in-depth). |
| **P3A-22** | E | F-PI3: document DM-AI-roundtrip assumption + add UI hint at dmConstraints field. |
| **P3A-23** | E | Test gaps documented as `U-*` codes in adversarial review (~15 tests). |

## Original backlog items still open

### M3D follow-ons (not landed yet)

| ID | E/C/H | Description |
|---|---|---|
| **M3D-3b** | E | Heartbeat-based tri-state roster glyph (live/quiet/gone) + `peer-reclaim` event kind. |
| **M3D-4b** | E + H | Big "Roll 2d6" button as primary affordance + last-3 pills with click-to-reroll + result animation + R/1-6/+/-/Enter keyboard + Cast (Costly/Hard) macros. |
| **M3D-5b** | E | Click-to-bind popover on rendered `{{pc:N}}` spans + display-name resolution + AI `pc-slot-bind` write tool. |
| **M3D-7b** | E | `[`/`]` keyboard navigation + AI `requestNav` tool + Cmd-K palette + recently-visited list. |

### CC items not yet landed

| ID | E/C/H | Description |
|---|---|---|
| **CC-4** | E | Per-PC `SaveDocument` variant — formalize the localStorage shape into a typed SaveDocument matching the rest of the app's persistence patterns. |
| **CC-7** | E | Free-write markdown editor (path 2 of 3). |
| **CC-8** | H | Pre-gen browser with edit-after-picking (path 3 of 3). Browser is engine; pre-gens are campaign. |
| **CC-9** | E | Path toggle (Q&A ↔ free-write) with answer-preservation on switch. |
| **CC-13** | E | Session-1 intake: WebRTC pull / paste-token / collapse-to-Mode-A for unfinished players. The DM-side counterpart to CC-10's player-side pack export. |
| **CC-14** | E | "Synthesize all backstories" DM batch button (today the DM clicks per-slot). |
| **CC-15** | H | DM constraint DSL (`party_requires` + `party_unique` min subset). |
| **CC-16** | H | Soft-warning surface for 72-hour-crystallization + engagement-layer balance. |
| **CC-22** | E | 1h prompt cache `cache_control` header on synthesis prefix + parallel suffix calls. |
| **CC-23b** | E | Re-roll whole / regenerate-paragraph / edit-freely UX (iteration polish on top of the now-working synthesize call). |
| **CC-24** | E | DM approval gate + per-PC pill (merged with P3T-17). |
| **CC-32 through CC-37** | E | Slot rebinding lifecycle (PC-death, player-leave temp/permanent, mid-session rebinding, AI-assisted, session/chapter boundary independence). |
| **CC-38, CC-39** | H + E | `aiBackstory.requiresDmApproval` opt-out flag. Locked-pending per gate finding: NOT shippable until F-V1 (semantic validator) lands. |

### Policy-in-engine violations (V-1..V-10; V-9 done, V-11 acceptable)

| ID | E/C/H | Description |
|---|---|---|
| **V-1** | H | CasterLadderState 5-state enum hardcoded in `state.ts` → campaign-declared. |
| **V-2** | H | Hard-gate categories baked into materializer → `hardGateRules[]` schema. |
| **V-3** | H | Harm/stress max + stat range constants → campaign-declared track shapes. |
| **V-4** | H | Stat keys (STR/DEX/CON/INT/WIS/CHA) → campaign-declared stat block. |
| **V-5** | H | Schema half landed; primaryRoll UI wire-through (consumed by M3D-4b). |
| **V-6** | H | Spoiler tokens → campaign-declared (P3A-2 covers this). |
| **V-7** | H | AI system prompt → campaign-declared override (currently Underleaf-hardcoded). |
| **V-8** | C | Chargen 10-question vocabulary → campaign-declared (LANDED — `characterCreation.questions[]` in campaign.json is the canonical example). |
| **V-10** | H | Generic state-event kind (long-term). |
| **V-12** | E | DM-only path predicate (`dm/` + `design/DM-ONLY/`) is hardcoded in `buildPlayerFacingContext`. New violation surfaced in critique pass. |

### M3c followups still open

| ID | E/C/H | Description |
|---|---|---|
| **M3C-1b** | E | Per-kind materializer extraction (already landed once via M3C-1 dispatch map; ongoing as new event kinds add — no current debt). |
| **M3C-2** | E | Dice-roll dispatch placeholder fix (controller emits `result: 0, dice: []`). |
| **M3C-3** | E | pc-edit stale-read window (tolerated by threat model; revisit if it bites). |
| **M3C-4** | E | pc-edit universal-write trust gap (tolerated by threat model). |
| **M3C-5** | C | `pushing-back` ladder transition gating (defer post-playtest). |
| **M3C-6** | E | Prompt-cache hit-rate verification (measure once a real session runs). |

### M3b followups still open

| ID | E/C/H | Description |
|---|---|---|
| **M3B-1** | E | IndexedDB full-text store keyed by AI hash (deferred; audit chain + in-memory is enough today). |
| **M3B-2** | E | Topbar budget widget (inline meter in `<ai-panel>` already lands the security minimum; topbar variant is polish). |
| **M3B-3** | E | Tag `playtest-1` on green pass (bookkeeping). |

### Open M4 questions awaiting decision

| ID | Description |
|---|---|
| **Q-CC-1** | Async-mode archetype-deviation policy (soft hint default proposed). |
| **Q-CC-2** | Pre-gen library scope (proposal: not needed for v1; edit existing PC files). |
| **Q-CC-3** | "Use same device" wording (user owns; placeholder copy in CC-5). |
| **Q-CC-4** | AI synthesis progress indicator at scale (defer per UX expert; 5 calls in parallel finish ~30s). |
| **Q-CC-5** | Print-friendly character sheet (M5 carry per UX expert). |

## Count

- Phase 2 gate-flagged P0: 3 (P3D-*).
- Phase 2 TTRPG findings: 19 (P3T-*).
- Phase 2 UX findings: 16 (P3U-*).
- Phase 2 Engine findings: 4 (P3E-*).
- Phase 2 Adversarial findings: 23 (P3A-*).
- Original M3D follow-ons: 4.
- CC items still open: ~14 (CC-4 + CC-7 + CC-8 + CC-9 + CC-13 + CC-14 + CC-15 + CC-16 + CC-22 + CC-23b + CC-24 + CC-32..37 + CC-38/39).
- V-* violations: 9 open (V-1..V-4, V-6/V-7 partial, V-10, V-12).
- M3C followups: 5 open.
- M3B followups: 3 open.
- Open M4 questions: 5.

**Total ~105 distinct work items.**  Many cluster into related units (the convergent CC-24 + P3T-17 + P3U-12 + P3E-1 is one body of work, not four), so the actual implementation-unit count after the prioritization pass synthesizes overlaps will likely halve.

## Rubric for the prioritization pass

Each expert tags every item:
- **P0** — must land before next sub-milestone ships.
- **P1** — should land in the next sub-milestone.
- **P2** — should land in the next 2-3 sub-milestones.
- **P3** — defer indefinitely.

May also flag **DEP <ID>**, **MERGE <ID>**, **SPLIT**.

Cross-reference: prior P0 (P3D-1/2/3) is the gate verdict's recommendation; experts may confirm or adjust.

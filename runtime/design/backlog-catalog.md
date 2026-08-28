# Quire backlog catalog (flat, prioritizable)

**Status:** consolidated list of every open work item as of 2026-05-22.  Built for the cross-expert prioritization pass.  Each row carries: stable ID • [E]/[C]/[H] tag • one-line description • source doc.

Items completed in the M3c polish runs and earlier are NOT listed here — only open items.  Items marked HYBRID-acceptable (V-11) or DONE (V-9) are likewise omitted.

This doc is meant to be re-edited *after* prioritization with a `P0`/`P1`/`P2`/`P3` column.  For the initial pass, that column is empty.

## Item IDs at a glance

- **M3D-N**: play-test follow-ups from `m3d-playtest-followups.md`.
- **CC-N**: character-creation items from `m4-character-creation.md`.
- **V-N**: policy-in-engine violations from `engine-vs-campaign-boundary.md`.
- **Q-CC-N**: open M4 questions awaiting user/expert decision.
- **M3C-N**: M3c followups still open from `STATUS.md`.
- **M3B-N**: M3b followups still open from `STATUS.md`.

Overlap notes: where two items describe the same work (e.g. V-5 ≡ M3D-4 ≡ part of CC-?), the catalog lists only the canonical source ID and notes the alias.

## Catalog

| ID | E/C/H | One-line | Source |
|---|---|---|---|
| **Play-test followups (m3d)** | | | |
| M3D-2 | E | Campaign-link linter (catch broken intra-campaign `.md` links pre-commit). | m3d §2 |
| M3D-3 | E | Stale-DM-peer cleanup: route-change-fires-leave + heartbeat-based tri-state roster glyph. | m3d §3 |
| M3D-4 | H | 2d6-first dice-Dock UI per `quire/design/ui.md` L154-160; auto-pull stat mod, last-3 pills per-PC, doubles halo. *(≡ V-5; engine renders, campaign declares primary roll.)* | m3d §4, V-5 |
| M3D-5 | E | Live `pcSlots` shared field + click-in-prose rebinding popover; AI `pc-slot-bind` write tool. *(≡ CC-2 deeper layer.)* | m3d §5, CC-2 |
| M3D-6 | E | Modes-of-play polymorphism: `tableTopology` + `tableSeats` field + `<seat-strip>` region; whisper event kind; print stylesheet pass. | m3d §6 |
| M3D-7 | E | Scene-switching primary affordance: `<dm-rail>` enumerates `dm/*.md`; `[`/`]` hotkeys; AI `requestNav` tool; Cmd-K palette; recent-visited list. | m3d §7 |
| **Char-creation primitives** | | | |
| CC-1 | E | `tableSeats` shared field + `<seat-strip>` region (also covered by M3D-6). | m4 |
| CC-2 | E | `pcSlots` shared field + click-to-bind UI + AI `pc-slot-bind` (renderer landed; live state TODO). | m4 |
| CC-3 | E | New `AppMode = 'character-creation'` + invite-token route variant. | m4 |
| CC-4 | E | `SaveDocument` variant scoped to one PC; persistence-controller variant. | m4 |
| **Char-creation player flow** | | | |
| CC-5 | E | 6-step `<character-creation>` region (Landing → Read-first → Pick path → Work → Done → Resume). | m4 |
| CC-6 | C | Q&A form for 7 MC + 3 SA questions with conditional follow-ups. *(Campaign declares; engine renders. Alias of V-8 implementation.)* | m4, V-8 |
| CC-7 | E | Free-write markdown editor with mandatory question pinned. | m4 |
| CC-8 | H | Pre-gen browser with edit-after-picking. (Browser engine; pre-gens campaign.) | m4 |
| CC-9 | E | Path toggle (Q&A ↔ free-write) with answer-preservation. | m4 |
| CC-10 | E | "Pack my character" file download + copy-as-token export. | m4 |
| CC-11 | E | Resume-on-revisit + wrong-device empty state. | m4 |
| **Char-creation DM flow** | | | |
| CC-12 | E | `<invite-manager>` panel: list slots + generate-link + paste-incoming-token. | m4 |
| CC-13 | E | Session-1 intake: WebRTC pull / paste-token / collapse-to-Mode-A unfinished. | m4 |
| CC-14 | H | "Synthesize all backstories" DM button + per-PC review pills. | m4 |
| CC-15 | H | DM constraint DSL: `party_requires` + `party_unique` first; full DSL later. | m4 |
| CC-16 | H | Soft-warning surface for 72-hour-crystallization + engagement-layer balance. | m4 |
| **AI synthesis** | | | |
| CC-17 | H | Backstory-synthesis schema variant in `src/ai/schema.ts`. | m4 |
| CC-18 | E | Player-facing context builder that hard-overrides `includeDmNotes: false`. | m4 |
| CC-19 | C | System prompt (negative-tone + hard constraints + few-shot). *(Alias of V-7 implementation.)* | m4, V-7 |
| CC-20 | C | Forbidden-token post-check + single auto-retry. *(Alias of V-6 implementation.)* | m4, V-6 |
| CC-21 | C | Structural validator (word count, place token, name uniqueness). | m4 |
| CC-22 | E | 1h cache for campaign prefix; parallel suffix calls. | m4 |
| CC-23 | E | Re-roll whole / regenerate-paragraph / edit-freely UX. | m4 |
| CC-24 | E | DM approval gate + per-PC pill. | m4 |
| **Pre-API-key checks** | | | |
| CC-25 | E | Required-fields + length validator. | m4 |
| CC-26 | C | Bay Area place allowlist + recent-transplant exemption. | m4 |
| CC-27 | C | MC ↔ short-answer consistency cross-check. | m4 |
| **Underleaf-specific** | | | |
| CC-28 | C | Promote `pcs/README.md` 5-element list into structured questionnaire schema. | m4 |
| CC-29 | C | Per-archetype tag suggestions for AI synthesis. | m4 |
| CC-30 | C | Curated Bay Area place allowlist for place-grounding question. | m4 |
| CC-31 | C | "Two technical PCs" default constraint for Episode 1. | m4 |
| **Slot rebinding (Q2 user clarification)** | | | |
| CC-32 | E | DM-triggered slot reassignment (PC death → new character). | m4 |
| CC-33 | E | Player-temporarily-out: slot reserved; rebinds on return. | m4 |
| CC-34 | E | Player-permanently-leaves: reassign or retire as DM-controlled NPC. | m4 |
| CC-35 | E | Mid-session rebinding affordance behind a confirm. | m4 |
| CC-36 | E | AI-assisted rebinding via extended `pc-slot-bind` (DM voice-commands the rebind). | m4 |
| CC-37 | E | Session/chapter-boundary independence: rebinding works at any granularity. | m4 |
| **DM-gate opt-out (Q3 user clarification)** | | | |
| CC-38 | H | `aiBackstory.requiresDmApproval` field in `campaign.json` (default true). | m4 |
| CC-39 | E | When opt-out is active, post-gen validators still run; only human-eyes step skipped. | m4 |
| **Policy-in-engine violations (V-1..V-8, V-10)** | | | |
| V-1 | H | CasterLadderState 5-state enum hardcoded in `state.ts` → campaign-declared. | boundary |
| V-2 | H | Hard-gate categories baked into materializer → `hardGateRules[]` schema. | boundary |
| V-3 | H | Harm/stress max + stat range constants → campaign-declared track shapes. | boundary |
| V-4 | H | Stat keys (STR/DEX/CON/INT/WIS/CHA) → campaign-declared stat block. | boundary |
| V-5 | H | 2d6+stat primary resolution → campaign-declared `primaryRoll`. *(≡ M3D-4.)* | boundary, M3D-4 |
| V-6 | C | Forbidden-token list → campaign-declared `spoilerTokens[]`. *(≡ CC-20.)* | boundary, CC-20 |
| V-7 | C | AI system-prompt language → campaign-declared tone anchors. *(≡ CC-19.)* | boundary, CC-19 |
| V-8 | C | Chargen 10-question vocabulary → campaign-declared `characterCreation.questions[]`. *(≡ CC-6.)* | boundary, CC-6 |
| V-10 | H | Underleaf-shaped event kinds (e.g. `caster-state-set`) → generic state-event with declared schema. *Long-term.* | boundary |
| **Open M4 questions (Q-CC)** | | | |
| Q-CC-1 | H | Async-mode archetype-deviation policy: soft hint vs hard enforcement? | m4 |
| Q-CC-2 | C | Pre-gen library scope: does Underleaf ship a 5-PC suite? Who writes? | m4 |
| Q-CC-3 | E | "Use same device" wording — tone decision. | m4 |
| Q-CC-4 | E | AI synthesis-at-scale UI: progress indicator + cancel-one-PC option? | m4 |
| Q-CC-5 | H | Print-friendly character sheet — M5 carry or sooner? | m4 |
| ADV-1 | E | **Surface advancement-mark provenance in the UI.** PC records now carry `markBullets` (which of the five criteria are ticked this cycle) and `markLog` (append-only: episode, bullet, note, and a `reconstructed` flag for marks reverse-engineered after the fact). Nothing renders either. A player should be able to see *why* they hold a mark — "Ep 3: you tore up your own satchel for kindling" is worth more to them than "3/5" — and the log deliberately survives the cycle reset so it can become a campaign-long record of what each PC has done. Schema landed 2026-08-27; `pc.schema.json` documents both fields. | m5 |
| ADV-2 | E | **`record.marks` is inert and now ambiguous.** `character-loader.ts` derives the count from `markBullets` and warns that "anything reading `record.marks` directly was inert". The field is now maintained as a denormalised mirror for print output, which is a trap waiting for a future reader. Either remove it, or make the loader assert the mirror matches the derived count. | m5 |
| ADV-3 | C | **Mark assignment is DM-side by house practice**, not player-side as `rules.md` describes ("each player may mark up to one"). Worth reconciling: either the rules text follows practice, or the UI offers both modes. Campaign policy, not engine. | m5 |
| **M3c followups still open** | | | |
| M3C-1 | E | Per-kind materializer extraction (slip-valve was used; state.ts has 32-case switch). | STATUS |
| M3C-2 | E | Dice-roll dispatch placeholder fix (`result: 0, dice: []`). | STATUS |
| M3C-3 | E | pc-edit stale-read window (controller computes `value = currentHarm + delta` at dispatch). | STATUS |
| M3C-4 | E | pc-edit universal-write trust gap (any peer can write any PC; tolerated per threat model). | STATUS |
| M3C-5 | C | `pushing-back` ladder transition gating (defer post-playtest). | STATUS |
| M3C-6 | E | Prompt-cache hit-rate verification (measure once a real session runs). | STATUS |
| **M3b followups still open** | | | |
| M3B-1 | E | IndexedDB full-text store keyed by AI response hash. | STATUS |
| M3B-2 | E | Topbar budget widget visualizing AI usage. | STATUS |
| M3B-3 | E | Tag `playtest-1` on green pass. | STATUS |

**Count:** 6 M3D + 39 CC + 9 V + 5 Q-CC + 6 M3C + 3 M3B = **68 items** for prioritization.
**Aliases:** M3D-4 ≡ V-5; M3D-5 ⊃ CC-2; CC-6 ≡ V-8; CC-19 ≡ V-7; CC-20 ≡ V-6.  When prioritizing the canonical (lower-numbered) item, the alias automatically inherits.

## Rubric for prioritization (each expert tags every item)

- **P0** — must land before the next milestone ships; play-test bites without it.
- **P1** — should land in the next milestone; significant lift but not a play-test blocker.
- **P2** — should land in the next 2-3 milestones; non-critical lift OR foundational for deferred work.
- **P3** — defer indefinitely; nice-to-have, speculative, or covered by another item.

Each expert may also flag:
- **DEP** — this item depends on another in the catalog; cite the predecessor ID.
- **MERGE** — propose merging with another item ID.
- **SPLIT** — propose splitting into smaller items.

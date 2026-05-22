# M3c — AI write API + inventory primitive

**Status:** DRAFT — pending 4-reviewer gate (TTRPG-craft, Engine, Security, Adversarial).
**Author input:** TTRPG-expert advisor recommendations recorded in `[[project_quire_ai_write_api_design]]`; user-stated requirements in `[[project_quire_state_lifecycle]]`.
**Date:** 2026-05-22.

## Goal

Let the DM offload routine bookkeeping AND ad-hoc improvisation to the AI, with explicit accept-gating:

1. **Tier-2 state updates** — the AI applies harm/stress, rolls dice, advances the caster ladder (the "Timmy cast 5 spells" example).
2. **Ad-hoc content additions** — the AI generates an unexpected NPC, room description, or item; the DM accepts and the new content is live in the session.
3. **Inventory** as a first-class state — items have a home; AI can put one in someone's pack.

## Scope

**IN:**

- New event kind `caster-state-set` (tier-2, ladder + tax + spam-counter for a PC).
- Existing event kinds become AI-writable (`pc-edit`, `dice-roll`).
- New session-scoped event kinds: `npc-create-session`, `location-describe-session`, `item-create-session`.
- New inventory event kinds: `inventory-add`, `inventory-remove`, `inventory-transfer`.
- AiResponse schema extension: `stateUpdates` (live writes) + `contentProposals` (new content) arrays.
- Provider tool schemas updated for both providers.
- DM accept-gate UI:
  - State updates: apply-all-with-60s-undo, one-line summaries (per TTRPG-expert).
  - Content proposals: preview + edit + accept/reject (session-scope only).
- HARD-GATED transitions (always explicit DM click): harm box 3-4, ladder→Hunted, tax-release.
- Inventory rendering on the player-rail (collapsible).
- AI-suggested informal weight notes when relevant; no strict encumbrance rules.

**OUT (deferred to M4 living-doc):**

- Permanent content commits to the GitHub campaign repo.
- Session-digest builder (M4 P3-1).
- DiffProposal schema for repo edits (M4 P3-2).
- Strict weight / encumbrance / item-slot rules — Quire's prime directive rejects this.

## Phases

### Phase 1 — Tier-2 state-update event vocabulary

- **New event kind `caster-state-set`.**  Coord-authored.  Payload `{ v: 1, pcId, ladderState, reason?, taxActive?, spamCount? }`.
  - `ladderState`: `'quiet' | 'noticed' | 'watched' | 'pushing-back' | 'hunted' | ''` (empty clears).
  - `reason`: short string, doubles as DM's suggested narration line (per rules-reference.md L135 — ladder must be narrated in fiction, not as a number).
  - `taxActive`: bool — trying-too-hard flag per L179-186.
  - `spamCount`: int — Free/Cheap cast counter per L141 (resets at scene boundary).
  - Materializer maintains `casterState: Record<pcId, CasterState>` in SessionState.  DM-only render-gated.
- **AiResponse schema extension:**
  ```ts
  interface AiResponse {
    safe: string;
    dmOnly: string;
    sources: SourceRef[];
    stateUpdates: StateUpdate[];   // NEW — empty by default
    contentProposals: ContentProposal[]; // NEW — empty by default (Phase 4)
    // raw, tokens, responseId as today
  }

  type StateUpdate =
    | { kind: 'pc-edit'; pcId: string; field: 'harm' | 'stress'; delta: number; reason?: string }
    | { kind: 'dice-roll'; purpose: string; expression: string; modifierBreakdown?: string }
    | { kind: 'caster-state-set'; pcId: string; ladderState: string; reason?: string; taxActive?: boolean; spamCount?: number };
  ```
- **Provider tool/schema updates** — both Anthropic tool_use and Gemini responseSchema gain the new fields.  `stateUpdates` defaults to empty; providers that don't return it (parse failure) get the empty default.
- **`parseFailureResponse`** keeps `stateUpdates: []` so a degraded response cannot accidentally inject writes.

### Phase 2 — State-update DM-accept UI

- **In `<ai-panel>` dual-card:** when `response.stateUpdates.length > 0`, render a **state-updates strip** below the dmOnly card.
- **Strip layout** (per TTRPG-expert UX):
  - Heading: "AI proposed N updates."
  - One-line summary per update — derived from the typed payload:
    - `pc-edit`: "Yui: +1 stress (Frayed cast)"
    - `dice-roll`: "Coin toss: 8 — Partial (with +2 from Costly cast)"
    - `caster-state-set`: "Timmy: ladder → Watched (\"the lights flicker again\")"
  - **Default action: Apply all** on Enter.  After click, batch commits as events + 60-second undo banner appears.
  - **Per-update revert glyph** — click during undo window to roll back one specific update.
  - **HARD-GATE markers** — updates that match the gate list render with an explicit "Accept this change" button INSTEAD of being apply-all-eligible.  These are: harm box 3-4 transitions, ladder→Hunted, tax-release.  The batch can apply EVERYTHING ELSE; the hard-gated entries wait for individual clicks.
- **Settings toggle (under AI Settings):** "Review every state update individually" — defaults off.  When on, every entry requires explicit click (first-session trust mode).

### Phase 3 — Inventory primitive

- **Schema:** PC character record gains `inventory?: Item[]` field.  Item shape:
  ```ts
  interface Item {
    id: string;          // stable within the session/repo
    name: string;
    description?: string;
    /** Informal note like "2 lbs" or "heavy" — display only, no rule enforcement. */
    weight?: string;
    /** Free-form tags like "fragile", "equipped", "consumable". */
    tags?: string[];
  }
  ```
- **State:** session-derived `pcInventory: Record<pcId, Item[]>` materialized from inventory events.
- **New event kinds (all coord-only OR self-only-for-own-PC per discussion):**
  - `inventory-add` — `{ v: 1, pcId, item: Item }`
  - `inventory-remove` — `{ v: 1, pcId, itemId }`
  - `inventory-transfer` — `{ v: 1, fromPcId, toPcId, itemId }`
- **Materializer:** standard apply-to-Record pattern; idempotent by itemId; cap items-per-PC at 100 (DoS guard).
- **UI:** new `<player-inventory>` region OR inline section on `<player-rail>` (below stats, above bonds/foci).  Collapsible.  DM sees every bound PC's inventory in `<dm-aside>` summary view.

### Phase 4 — Content proposal API

- **AiResponse `contentProposals` array:**
  ```ts
  type ContentProposal =
    | { kind: 'npc'; id: string; name: string; role: string; motivation?: string; voice?: string; stats?: Partial<Stats>; backstory?: string }
    | { kind: 'location'; id: string; name: string; description: string; tags?: string[] }
    | { kind: 'item'; id: string; name: string; description?: string; weight?: string; tags?: string[]; proposedOwner?: string };
  ```
- **DM accept UI** — different from state-updates because the DM might want to edit before accepting:
  - One card per proposal, expandable.
  - Edit-in-place text fields for every value.
  - Three actions: **Accept (session-only)**, **Accept + add to inventory** (item only, when proposedOwner is set), **Reject**.
  - No apply-all default — each proposal is a discrete creative decision.
- **Session-scoped persistence:** new event kinds (coord-only, v:1):
  - `npc-create-session` — `{ npc: NpcProposal }`
  - `location-describe-session` — `{ location: LocationProposal }`
  - `item-create-session` — `{ item: ItemProposal }` (optionally followed by `inventory-add`)
- **Stripped from shareable saves** — like scratch-note + npc-pin.  DM's mid-session improvisation doesn't accidentally leak.
- **Visual distinction in roster / dm-aside:** session-scoped NPCs render with a small "session" badge so the DM remembers "this one isn't canon yet — promote via M4 living-doc to commit."

### Phase 5 — M3c gate

Standard 4-reviewer pattern.  Acceptance tests:

- **e2e/ai-cast-spam.spec.ts** — Timmy-5-spells scenario.  Mock AI returns stateUpdates with pc-edit + dice-roll + caster-state-set.  DM hits Apply All; all 3 events land; undo restores previous state.
- **e2e/ai-npc-add.spec.ts** — AI proposes a new NPC; DM accepts; NPC appears in dm-aside roster with "session" badge; DM can pin them.
- **e2e/ai-item-to-inventory.spec.ts** — AI proposes an item with proposedOwner set; DM clicks "Accept + add to inventory"; item appears on the PC's inventory section.
- **Hard-gate e2e:** AI proposes harm box 3 transition for Yui; DM cannot Apply-All past it; must click explicitly.

## Open questions for review

1. **Inventory authority** — should PCs be able to add items to their own inventory (self-only `inventory-add` if `pcId === my-bound-PC`), or coord-only?  TTRPG-craft + UX should weigh in.
2. **Session-scoped NPC visibility to players** — session NPCs DO need to be player-visible (they're in the scene); but the AI-generated proposal text might include DM-only motivation.  Need to split the proposal into player-visible card (name, role, voice) + DM-only card (motivation, stats, backstory) BEFORE the accept lands.
3. **Inventory weight philosophy** — purely cosmetic display, or does the AI ever use it for narrative ("the cable is heavy — Yui can carry one or the other, not both")?  Per the user's "informal tracking by AI" guidance, the latter — but where does the AI's awareness come from?  Probably: AI reads each PC's full inventory in context (already wired by [[project_quire_ai_character_access]] once PC sheets are fetched).
4. **Spam-counter scene boundary** — `casterState.spamCount` resets when?  Scene transition is the natural anchor (DM advances scene); but Quire scenes can blur.  Maybe AI handles reset implicitly via caster-state-set with `spamCount: 0`.
5. **Edit-in-place for content proposals** — what fields are editable?  All free-text yes; what about NPC stats (numeric)?  Probably all editable, with validation against the rules schema before commit.
6. **Token cost** — adding stateUpdates + contentProposals to the structured tool roughly doubles the output size when the AI fires writes.  Acceptable per the cache strategy memo (output tokens cost 5x input but are still bounded).

## Vocabulary additions summary

| Event kind | Authority | Tier | DM-only field affected |
|---|---|---|---|
| caster-state-set | coord | 2 | casterState (NEW, DM-only) |
| inventory-add | coord OR self-bound-pc | 2/persisted | pcInventory (player-visible) |
| inventory-remove | coord OR self-bound-pc | 2/persisted | pcInventory |
| inventory-transfer | coord | 2/persisted | pcInventory |
| npc-create-session | coord | 2 | sessionNpcs (NEW, partially player-visible) |
| location-describe-session | coord | 2 | sessionLocations (NEW, player-visible) |
| item-create-session | coord | 2 | sessionItems (NEW, player-visible) |

## Migration / compatibility

- All new event kinds get `v: 1`; materializers reject unknown `v` (existing pattern).
- Adding fields to `AiResponse` is backward-compatible — old providers omit them; broker defaults to empty arrays.
- `parseFailureResponse` keeps every write array empty, so a parse failure cannot inject writes.

## Tests

- Per-materializer hostile coverage (cap, format, coord-gate) — ~8 tests per kind × 6 new kinds = 48 vitest tests.
- AiResponse schema tests: stateUpdates + contentProposals parsing, type-guard, parseFailure fallback.
- Provider parse tests for the new fields.
- 4 e2e tests as listed in Phase 5.

## Followups carried out of M3c

- M4 — permanent commit of session content via living-doc workflow (DiffProposal, session-digest, baseSha validation).
- M4 — promotion rules for tier-2 → tier-1 (which states auto-carry across sessions: harm, stress, debt, tax per TTRPG-expert).
- M3c polish — AI-suggested weight commentary integrated into the inventory UI (after baseline lands).

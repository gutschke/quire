# M3c — AI state-update write API

**Status:** REVISED after 4-reviewer gate BLOCK; locked by user 2026-05-22.
**Scope was split:** content additions + inventory primitive moved to M3d.
**Predecessor block:** [[project_quire_m3c_gate_verdict]] in memory.

## Goal

Let the DM offload routine bookkeeping to the AI mid-session: harm/stress applications, dice rolls with the right modifier math, advancing the caster ladder.  The AI proposes a batch of state updates; the DM applies-all-with-undo by default, with explicit-click hard gates on the story-shaping transitions.

**Specifically:** the "Timmy cast 5 spells affecting a coin toss, let me know the outcome and update everyone's stats" scenario from user 2026-05-22.

## Scope

**IN:**

- New event kind `caster-state-set` (tier-2; ladder + tax + spam-counter for a PC).
- Existing event kinds become AI-writable: `pc-edit`, `dice-roll`.
- AiResponse schema extension: `stateUpdates: StateUpdate[]` (defaults `[]` for backward compat).
- Provider tool schemas updated (Anthropic tool, Gemini responseSchema).
- DM accept-gate UI: apply-all-with-60s-undo, one-line summaries.
- HARD-GATE list (always explicit DM click; never apply-all-eligible):
  - harm box 3→4 transition (underleaf/world/rules.md L78-79)
  - stress box 4 (Broken) transition (L90)
  - caster ladder → Hunted (L133)
  - trying-too-hard activation (L179-186)
  - trying-too-hard release (L182)
  - double-1 wild outcome (L47)
  - cross-PC pc-edit (delta on a peer's bound PC)
- Provenance: `causedByResponseId?: string` on every state-update event payload.  Materializer rejects hard-gated transitions when this is set without an `ai-accept` predecessor (defense-in-depth).
- Per-kind materializer extraction (`src/core/materializers/*.ts`) — landing Phase 1 commits since the switch is already past the redesign-plan.md L67 threshold.
- `AiWriteController` extraction (parallel to AiKeyStore) — Phase 2 prerequisite.

**OUT (deferred to M3d):**

- Inventory primitive (tier-2 per user; needs its own milestone).
- Content proposals (NPC / room / item creation).
- "Just say yes" narrate-only path.

**OUT (deferred to M4 living-doc):**

- Permanent commit of session content to GitHub.
- Session-digest builder.
- DiffProposal schema.
- AJV validation pipeline.

## Phases

### Phase 1 — Event vocabulary + materializer extraction

- **New event kind `caster-state-set`** (coord-only).
  - Payload: `{ v: 1, pcId, ladderState, reason?, taxActive?, spamCount?, causedByResponseId? }`.
  - `ladderState`: `'quiet' | 'noticed' | 'watched' | 'pushing-back' | 'hunted' | 'clear'` (explicit `'clear'` sentinel — avoids the empty-string-as-sentinel fragility Engine flagged).
  - `reason`: short string; rendered as the DM's narration prompt (underleaf/world/rules.md L135 — ladder must be narrated, not numbered).  **Rendered via plain Lit text interpolation in the UI (auto-escaped), NOT `renderMarkdown(unsafeHTML(...))`** — Security S-2.
  - `taxActive`: bool — trying-too-hard per L179-186.
  - `spamCount`: int — Free/Cheap cast counter per L141.  Reset emitter: **DM-direct "Reset spam counter" button** in the cockpit (Engine #3 / TTRPG #2).  Auto-reset on scene transition deferred to M3d — the runtime has no scene-transition event today; AI is told to ask the DM rather than auto-zero.
  - `causedByResponseId`: when set, materializer enforces hard-gate (see Phase 3).
- **Materializer:** mutates `state.casterState: Record<pcId, CasterState>` (NEW DM-only field — wiped by `filterForViewer`, stripped from shareable saves).
- **PER-KIND MATERIALIZER EXTRACTION** (Engine #2 + redesign-plan.md L67):
  - state.ts currently has **31 case arms** (Adversarial A-new-1 — original plan said 17; actual count from `grep -c "case '" src/core/state.ts`).  Materializer extraction is ~4-6 commits at minimum, not a single mechanical drop.
  - Move every case (caster-state-set + the existing 31) into `src/core/materializers/<kind>.ts`, each exporting an `apply(state, event)` function.
  - state.ts retains the switch as a thin dispatch table.
  - Each per-kind module is independently testable from `<kind>.test.ts`.
  - Ship the extraction as a sequence of small commits (one per logical grouping — peers/coord, scene-reveal-pair, dice/chat/pcedit, ai-*, scratch/pin/debt/broadcast, caster-state-set) before the rest of M3c lands.
  - **Slip-valve:** if the extraction overruns the milestone budget, drop the per-kind extraction from M3c and ship caster-state-set inline; the extraction becomes M3c.5.  Document explicitly so the implementer has permission to slip.
- **AiResponse schema extension:**
  ```ts
  interface AiResponse {
    safe: string;
    dmOnly: string;
    sources: SourceRef[];
    stateUpdates: StateUpdate[];   // NEW — defaults to []
    raw: string;
    tokensIn: number;
    tokensOut: number;
    responseId: string;
  }

  type StateUpdate =
    | {
        kind: 'pc-edit';
        pcId: string;
        field: 'harm' | 'stress';
        delta: number;
        reason?: string;
      }
    | {
        kind: 'dice-roll';
        purpose: string;
        expression: string;
        modifierBreakdown?: string;
      }
    | {
        kind: 'caster-state-set';
        pcId: string;
        ladderState: 'quiet' | 'noticed' | 'watched' | 'pushing-back' | 'hunted' | 'clear';
        reason?: string;
        taxActive?: boolean;
        spamCount?: number;
      };
  ```
  - `isAiResponse` updated to accept `stateUpdates` as optional + defaulted `[]`.  Wrong-type rejects (e.g. `stateUpdates: 'not an array'` → false).
  - `parseFailureResponse` initializes `stateUpdates: []`.
- **pc-edit subset rationale:** the AI-writable `pc-edit` is intentionally narrower than the manual one (harm/stress only).  Other pc-edit fields (e.g. arbitrary stat changes) require DM-direct, never AI-proposed.  Document this in the schema.

### Phase 2 — AiWriteController + DM accept-gate UI

- **Extract `AiWriteController`** (new file `src/controllers/ai-write-controller.ts`).  Holds:
  - The current pending-batch state (array of `{ stateUpdate, status }`).
  - The 60-second undo timer + cancellation handle.
  - The per-update hard-gate state (`pending-explicit-accept`).
  - The dispatch helpers that translate StateUpdate → event append.
  - The optional `causedByResponseId` stamping (pulled from the broker's most recent response).
  - QuireApp uses it via `aiWrites.accept(updates)`, `aiWrites.revert(id)`, etc.  Keeps quire-app.ts from collapsing past 3500 LOC.
- **In `<ai-panel>`:** when `response.stateUpdates.length > 0`, render an **AI Updates strip** below the dmOnly card.
  - One-line summary per update — derived from the typed payload + the rules-narration convention:
    - `pc-edit`: "Yui: +1 stress (Frayed cast)"
    - `dice-roll`: "Coin toss: 8 — Partial (with +2 from Costly cast)"
    - `caster-state-set`: rendered with `reason` as primary text (e.g. "Timmy: \"the lights flicker again\"") and the state label (e.g. "→ Watched") as small DM-only metadata.  This honors underleaf/world/rules.md L135 ("narrate aloud, never by number").
  - **Default action: Apply All** on Enter.  Batch commits as events with `causedByResponseId = <current ai-response responseId>`.
  - **60-second undo banner** after apply.  Per-update revert glyph during undo window.
  - **HARD-GATE entries** are excluded from Apply All; each renders with its own explicit "Accept this change" button + a small description of why it's gated ("Yui's harm reaching box 4 is out-of-action — confirm to apply.").  The non-gated entries can still apply-all-on-Enter; the gated ones wait.
- **Settings toggle** (under AI Settings): "Review every state update individually" — defaults off.  When on, every entry requires explicit click (first-session trust mode).

### Phase 3 — Materializer-side hard-gate enforcement

- When an event arrives with `payload.causedByResponseId` set, the materializer checks whether it's a hard-gated transition:
  - `pc-edit` transitioning harm to box 3 or 4 (current vs new value), OR stress to box 4
  - `caster-state-set` with `ladderState: 'hunted'`, OR `taxActive: true` transition (was false → now true), OR `taxActive: false` transition (release)
  - cross-PC `pc-edit` (event.peerId is the coord, payload.pcId is a different bound PC than the coord's own)
  - `dice-roll` resulting in a double-1 (the broker won't emit this; this catches a hypothetical hostile)
- **Mechanism** (Engine #1 — corrected from the prior draft):
  - There is NO "emission batch" or shared-prevHash concept the materializer can see.  EventLog uses causal-then-lexicographic total order (vector-clock-sum primary, `peerId:seq` tiebreak).
  - At apply-time for a hard-gated event whose payload carries `causedByResponseId`, the materializer scans `state.aiAudit` for an entry with `kind: 'accept'` whose `responseId === event.payload.causedByResponseId`.  The scan is O(audit-depth), bounded by `AI_AUDIT_CAP = 5000`.
  - **Causality guarantee:** the coord owns both the `ai-accept` and the state-update events.  Both come from the same peer's seq counter.  ai-accept has the smaller seq, so its vector-clock-sum is smaller, so it materializes first.  When the state-update applies, the ai-accept is already in `aiAudit`.
  - **Hostile path:** if a hostile coord appends a state-update at seq N without first appending an ai-accept at a smaller seq, the materializer scan finds no matching accept and rejects.  A retroactive ai-accept at seq N+1 cannot rescue the earlier event (events are immutable after rejection).  Defense-in-depth holds for free.
- **Rejection visibility** (TTRPG #1): rejected hard-gated events are NOT silently dropped.  The materializer appends a synthetic audit entry (a new `aiAudit` kind `rejected-hard-gate` or piggyback on existing) so the DM sees that an AI proposal was refused.  The cockpit shows a one-line banner.  Silent drops break forensic auditability and DM trust.
- Per-kind materializers each gain a `isHardGated(event, state)` helper for readability.
- **Hostile test required** for the mechanism: append a `pc-edit` with `causedByResponseId: 'r1'` BEFORE the corresponding `ai-accept` on the same peer.  Materialize.  Verify the pc-edit was rejected.

**Out-of-scope but documented (Adversarial A-new-2):** manual (DM-direct) cross-PC `pc-edit` events without `causedByResponseId` are NOT gated by this mechanism — they would land as today.  Closing that pre-existing gap is a separate concern.

### Phase 4 — Strip-list

- `serializeSessionForViewer` in persistence.ts: add `caster-state-set` to `PLAYER_SCOPE_STRIP_KINDS`.  (Other M3c-affected kinds are already stripped or are player-visible by design.)
- **No `appliedEventIds` on ai-accept** (Engine #2): events have unknown ids at append time; the reverse query already works via `causedByResponseId` + `aiAudit` lookup.  ("Which prompt caused Yui to lose 3 harm?" → scan pc-edit events on Yui, project `causedByResponseId`, look up the matching `aiAudit` entry's prompt half.)  Skipping a redundant field with ordering hazards.

### Phase 5 — M3c gate

Standard 4-reviewer pattern.  Acceptance:

- **e2e/ai-cast-spam.spec.ts** — Timmy-5-spells.  Mock AI returns `stateUpdates` with pc-edit + dice-roll + caster-state-set.  DM hits Apply All; non-gated events land with `causedByResponseId`; budget meter updates.  Undo restores previous state.
- **e2e/ai-hard-gate.spec.ts** — AI proposes harm box 3 transition for Yui.  Apply All applies everything else; hard-gated entry sits with explicit-accept button; DM clicks it, event lands.
- **e2e/ai-cross-pc-gate.spec.ts** — DM is bound to PC alice; AI proposes pc-edit on PC bob (bound to peer "guest").  Hard-gate triggers.  DM accepts explicitly.
- **Vitest hostile suite** for caster-state-set materializer: cap (none — single per-pcId LWW), format, coord-gate, ladderState enum + 'clear' sentinel, taxActive bool only, spamCount finite int only, causedByResponseId either absent or matching ai-response in audit.

## Open questions (none blocking — locked at user-decision)

All previous M3c open questions either resolved or moved to M3d.  The implementation should proceed once this revision passes the 4-reviewer gate.

## Vocabulary additions

| Event kind | Authority | Tier | DM-only field affected | causedByResponseId |
|---|---|---|---|---|
| caster-state-set | coord | 2 | casterState (NEW, DM-only) | always set when AI-emitted |
| (extends) pc-edit | coord OR self-bound-pc | 2 | pcEdits | when AI-emitted |
| (extends) dice-roll | coord OR self-bound-pc | 2 | diceRolls | when AI-emitted |
| (extends) ai-accept | coord | 2 | aiAudit | n/a — extends appliedEventIds |

## Migration / compatibility

- `caster-state-set` is new in v:1.  Existing peers without it ignore via the unknown-kinds banner (P0-12).
- AiResponse extension: optional fields, defaulted `[]`.  Old providers omit them; broker fills the default.
- `causedByResponseId` is optional on every state-update payload.  Manual (DM-direct) events omit it.

## Tests

- ~60 vitest cases for the caster-state-set materializer + per-kind extraction sweep + AiResponse schema extension + isAiResponse changes + the hard-gate hostile path (Engine-required: pc-edit appended before ai-accept on same peer must reject).
- 3 e2e specs as listed.
- Snapshot-style test for the new AI panel strip rendering (already pattern in scene-stage.test.ts).
- **Realistic landing** (Engine #4 / Adversarial A8): ~880-900 vitest + ~22 playwright spec files (current baseline 823 vitest, 19 specs — three new e2e specs = ~22 total, not 16 as the prior draft erroneously claimed).

## Followups out of M3c

- **M3c polish (deferrable):** the "Review every state update individually" settings toggle is the lowest-stakes feature in this milestone.  If implementation runs hot, drop it last; the apply-all-with-undo + hard-gate carve-outs cover the safety properties.  Track as ship-with-followup-ok.  (Adversarial A8.)
- **Prompt-cache hit-rate verification** (Engine #5): after M3c rollout, verify `tokensIn` on second-and-later AI requests in a session still shows the cache discount.  The new tool schema lands in the system-prompt prefix where Anthropic's prompt caching already covers it; verify the cache-write delta on first-request-after-restart amortizes.
- **AI prompt framing** (TTRPG #3): the system prompt must instruct the AI to frame the spam-counter / 3rd-4th-cast threshold as a DM-judgment cue ("ask the DM if a stress check is warranted"), not as a deterministic trigger ("spamCount===3 → emit stress check").  Rules-reference.md L141 is explicit that this is DM judgment.
- **M3d**: inventory primitive (rapid-change tier-2 per user) + content proposals (NPC / room / item, session-scoped only) + "Just say yes" narrate-only path + scene-transition auto-reset for spam counter (if a scene-transition event lands by then).  Requires the M4 promotion-from-session-scope path to be specified FIRST OR explicit acknowledgment that session content remains session-only until M4.
- **M3d/M4 wrap-untrusted forward-note** (Security S-6): when session-digest cycling lands, any session event field with AI-authored text (currently `caster-state-set.reason`; future inventory/content `reason`s) MUST pass through `wrapUntrusted` when injected as prompt context.  `caster-state-set.reason` is NOT currently cycled back through campaign-context.ts; the latent risk activates when M3d/M4 introduces session-as-context.
- **M4**: living-doc workflow.  Session-digest builder, DiffProposal schema, GitHub commit path.  Promotes session-scope state (NPCs, items, locations the players will remember) to tier-1 in the campaign repo.
- **`pushing-back` ladder transition gating** (Adversarial #4): currently NOT hard-gated.  Borderline — the world begins working against the PC (underleaf/world/rules.md L132).  Defer to TTRPG-craft after first playtest; add to hard-gate list if it ships at-pace.
- **Manual cross-PC `pc-edit` gap** (Adversarial A-new-2): a DM directly editing another player's bound PC is not gated.  Pre-existing; M3c adds AI gating only.  Closing the manual gap is a separate concern.

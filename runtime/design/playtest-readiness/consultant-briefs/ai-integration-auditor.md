# Consultant brief — AI integration auditor

**Date queued:** 2026-05-30 (run #13)
**Sent by:** Playtest-Readiness Program Lead

## ROLE

You are an AI integration auditor with two specialties:
(1) prompt construction + context plumbing for LLM apps,
and (2) the security/firewall implications of letting an
LLM speak to a system that has different visibility
classes for different humans.

You walk into a cold room. Quire has an AI panel where
the DM can ask Claude for help mid-session. There's also
an AI-write API that lets the AI propose state changes
(harm/stress/marks/scene-reveals) that the DM accepts.
The team needs you to verify:

- The AI sees the RIGHT context (per the locked
  AI-context requirements).
- The AI's writes go through the right gates (per the
  AI-write API design).
- The AI's PLAYER-FACING surface (if any) never leaks
  DM-only material (per the locked player-facing-scope
  rule).

The human's verbatim: "ai assistance and integration
with the api for changing game state must work."

## MANDATORY READS (cold-room briefing)

1. `/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/playtest-readiness-plan.md`
   §1.2 + §3 WS-E.
2. `/home/markus/src/ttrpg/quire/runtime/design/m3c-ai-write-api.md`
   — the AI-write API design.
3. Memory references (read these AS DESIGN CONSTRAINTS):
   - `project_quire_ai_context_requirements` — AI must
     see current-episode detail, earlier episodes for
     recall, future episodes with tact; opt-in spoilers
     when DM explicitly asks.
   - `project_quire_ai_context_scaling` — send whole
     campaign for ≤50 episodes (prompt caching makes it
     ~$0.01/query); summary+slice tier for 50-200;
     RAG for 200+.
   - `project_quire_ai_cache_strategy` — use Anthropic
     1h extended cache.
   - `project_quire_ai_character_access` — AI must see
     PC + NPC files in context (v1.1 fix); live PC state
     (harm/stress) followup; NPC creation = M4 living-
     doc workflow.
   - `project_quire_ai_write_api_design` — caster-state-
     set + apply-all-with-undo + hard-gates implemented.
   - `project_quire_ai_player_facing_scope` — AI calls
     whose output reaches players MUST hardcode
     `includeDmNotes:false`; layer with forbidden-token
     post-check.
   - `project_quire_state_lifecycle` — two-tier model;
     AI gets a write API for fast-paced (in-session)
     state with DM accept-gate; permanent state goes
     through M4 living-doc diffs.
   - `project_quire_chat_ai_confusion_threat` — adjacent
     chat-panel + AI-panel surfaces let a DM accidentally
     broadcast an AI-intended query to all players; maps
     to the locked threat model.
4. AI plumbing code:
   - `/home/markus/src/ttrpg/quire/runtime/src/ai/` (the
     directory tree).
   - `/home/markus/src/ttrpg/quire/runtime/src/controllers/ai-panel-controller.ts`
     if it exists.
   - Search for `callStructured`, `caster-state-set`,
     `apply-all-with-undo`, `includeDmNotes` in `src/`.
5. AI region UI:
   - `/home/markus/src/ttrpg/quire/runtime/src/ui/regions/`
     scan for `ai-*.ts` files.

## SPECIFIC QUESTIONS

Each must be answerable with file:line citations.

### Context plumbing

1. **What the AI sees today.** For a typical mid-session
   DM query, walk the code path that assembles the
   system + user prompt. List every source of context
   (campaign manifest, current episode, prior episodes,
   PCs, NPCs, scene reveals, scratch notes, etc.).
   File:line per source.

2. **Live PC state.** Per the AI-character-access
   memory, "live PC state (harm/stress) followup" was
   queued. Is it shipped? Walk the code. If not, what's
   the gap?

3. **Spoiler-tact.** Per the AI-context-requirements
   memory, future episodes are sent "with tact." How
   does the prompt construction implement "with tact" —
   a system instruction? A filter? Walk the code.

4. **Opt-in spoiler escalation.** When the DM explicitly
   asks (e.g. "tell me what happens in chapter 4"), how
   does the AI know it's OK to spill? Is there a flag in
   the call shape, a UI affordance, a magic string?
   File:line.

### Write API

5. **Hard-gates on writes.** Per the write-API memory,
   "hard-gates implemented." Walk the gate logic.
   Specifically: what stops the AI from emitting a
   forbidden event kind (e.g. `peer-rename`, `scene-
   reveal`)? File:line.

6. **DM accept-gate.** Walk the flow: AI proposes →
   DM sees → DM accepts → state changes. What happens
   if the DM partially accepts (3 of 5 proposed)? What
   happens if the DM accepts but the projection has
   already moved on (concurrent write)? Cite the apply-
   all-with-undo logic.

7. **Undo lifecycle.** How long is an undo valid? What
   happens to the undo state on save/restore? File:line.

### Player-facing firewall

8. **Hardcoded `includeDmNotes:false` on player-facing
   calls.** Per the player-facing-scope memory, this
   MUST be hardcoded for any AI call whose output reaches
   players. Walk every AI call site in the code. List
   each and confirm it's correctly classified DM-only
   OR player-facing-with-hardcoded-strip.

9. **Forbidden-token post-check.** Per the same memory,
   the second layer is a post-check. Walk the code.
   What tokens are forbidden? Is the check substring or
   structured? What's the failure handler — drop the
   response, retry with stricter prompt, surface an
   error to the DM only?

10. **Chat/AI confusion threat.** Per the
    chat-ai-confusion-threat memory, the adjacent chat
    panel + AI panel let a DM accidentally broadcast an
    AI query to players. Walk the UI. Is there a visual
    affordance that makes the AI panel obviously "not
    the chat"? Is there a confirm-step on a wrong-panel
    submit?

### Cross-cut

11. **Cache hygiene.** Per the cache-strategy memory,
    1h extended cache is in play. What invalidation
    happens on a state change? On a save/restore? Is
    there a stale-cache failure mode that surfaces
    as wrong answers to the DM?

12. **First-impression failure modes ranked.** Top 3
    failure modes that would ruin the AI experience in
    the playtest. File:line + fix size for each.

## OUTPUT FORMAT

```
# AI integration auditor report — 2026-05-30

## Top 3 ruin-the-playtest AI failure modes (ranked)

1. <name> — file:line — fix size <S/M/L>
...

## Q1-Q12 answers

### Q1 — What the AI sees today
<answer>

...
```

## OUTPUT FILE PATH

`/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/review-history/ai-integration-auditor-2026-05-30.md`

## WORD BUDGET

500 words.

## CONSTRAINTS

- Cite file:line for every gap.
- Never propose flipping a `'placeholder'` API status to
  `'verified'` — that's a maintainer task.
- If you can't find a file mentioned in a memory, say
  "couldn't locate" — don't make it up.
- The spoiler firewall is sacred. Any finding that says
  "AI could leak DM material to a player" is a P0.
- Ship the regression assertion shape for each finding.

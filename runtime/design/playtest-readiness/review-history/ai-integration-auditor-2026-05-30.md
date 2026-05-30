# AI integration auditor report — 2026-05-30

## Top 3 ruin-the-playtest AI failure modes (ranked)

1. **AI panel cannot see prior-session digest** — `quire-app.ts:6906-6917`. `submitAiPrompt` builds context via `buildCampaignContext` (campaign files only). It never injects `state.sessionDigests[*].markdown`. Digest-generation paths (3675, 3989) DO pass `priorDigestMarkdown`, but the DM's mid-session AI questions do not. Confirms FINDING-E. Fix size: **S** (concat last digest into `wrappedUser` or extend `buildCampaignContext`). Assertion: `quire-app.ai.test.ts` — `submitAiPrompt` after a `session-digest` event must include `digest.markdown` in `provider.callStructured`'s captured `prompt` arg.
2. **Anthropic prompt cache claim is aspirational** — `providers/anthropic.ts:58-74` has no `cache_control` block; `broker.ts:243-254` does not stamp the static prefix. Comment at `quire-app.ts:6898` references `cache_control` as if wired. Auto-memory claims "1h extended cache". At ≤50-episode scale this is the difference between $0.01/query and $0.10+/query AND causes 2-4 s extra latency per DM ask. Fix size: **M** (add `cache_control: {type:'ephemeral'}` to the system+tools prefix; gate by extended-cache beta header). Assertion: `anthropic.test.ts` — request body for second `callStructured` carries `cache_control` on system/tools prefix.
3. **Live PC harm/stress not in AI context** — `campaign-context.ts:154-159` fetches `characters/pcs/<id>.json` (static disk record). It never reads `state.pcEdits[pcId]` (live harm/stress) or `state.casterState[pcId]`. The AI proposing `pc-edit +1 harm` on a PC already at harm 3 cannot self-gate via knowledge of the current value (the materializer hard-gate catches it — `state.ts:1531`, but the AI is blind to the inflection point). Memory `project_quire_ai_character_access` explicitly queues this as the v1.1 follow-up. Fix size: **M** (synthesize a "live PC state" block from `view.shared.pcEdits + casterState` and prepend to the prompt; wrap in `<untrusted_content source="live-state">`). Assertion: `quire-app.ai.test.ts` — after a `pc-edit harm=3`, the next prompt must include "harm: 3" for that pcId.

## Q1-Q12 answers

### Q1 — What the AI sees today
`quire-app.ts:6863-6995`. Sources: `campaign.json` + `world/overview.md` (`campaign-context.ts:142`); current ep manifest + every scene (143-147); per-episode `dm/*.md` (149-152) when `scope==='dm'`; every PC + NPC file (154-159); campaign-wide `design/DM-ONLY/*.md` (160-162) when scope=dm. NOT included: scratchNotes, aiAudit, live pcEdits/casterState, sessionDigests, NPC-pins, the bound peer's chat history.

### Q2 — Live PC state
**Not shipped.** See Top-3 #3.

### Q3 — Spoiler tact
System-prompt instruction only — `ai-key-store.ts:127-140` ("DEFAULT … without volunteering future plot"). No filter, no context-cut. Future-episode scene files ARE sent (`orderedCampaignEpisodes` lists every slug, `quire-app.ts:7022`); tact is purely model-trust.

### Q4 — Opt-in spoiler escalation
No flag in the call shape; the system prompt's EXPLICIT-ASK CARVE-OUT (`ai-key-store.ts:132-137`) tells the AI to spill freely when phrased as planning. UI has no "spoilers OK" affordance — the DM phrases their way into it. The scope toggle (`ai-panel.ts:619-628`) controls DM-notes inclusion, not spoiler tact.

### Q5 — Write hard-gates
Two-layer: AiWriteController gates the apply-all path (`ai-write-controller.ts:266-313`) and the materializer enforces at apply (`state.ts:2129-2143, 1485-1551`). The materializer is the load-bearing one. Forbidden kinds (`peer-rename`, `scene-reveal`) cannot be emitted because `StateUpdate` is a closed union (`schema.ts` — 3 kinds only) and `broker.ts:307` filters via `isStateUpdate`. Defense-in-depth solid.

### Q6 — DM accept-gate / partial-accept
`applyAll` (218) processes status='pending' only; `applyOne` (231) handles hard-gated entries individually. Partial accept supported. **Stale-read hazard**: `dispatch` (415) reads `currentHarm/Stress` from the live view at apply-time — if a peer concurrently emitted `pc-edit` between propose and apply, the AI's `delta` is added to the NEW current value (not the value the AI saw). Existing task #411 covers this. Mostly tolerable mid-session.

### Q7 — Undo lifecycle
`UNDO_WINDOW_MS = 60_000` (`ai-write-controller.ts:84`). Timer-based; `clearUndoTimer` fires on a new `proposeBatch`. **Survives nothing**: the batch lives only in controller memory — page reload, save/restore, or a `clear()` all drop the undo window. The compensating event flows through the normal log, so reverts persist; the WINDOW does not.

### Q8 — Player-facing AI calls
Call sites: `quire-app.ts:6928` (DM aide — DM-only by construction; `showAiPanel` gates on `isCoordinator`); `chargen-controller.ts:1696` (synth — uses `buildPlayerFacingContext`, scope=public hardcoded at `campaign-context.ts:217`); `complementarity-hints.ts:120` (DM-facing, hooks may be pasted to player chat — system prompt forbids hidden-lore framing at line 57); `spoiler-check.ts:374` (AI semantic check, DM-only); `quire-app.ts:3680` (session-digest — bundle pre-filtered to player-visible kinds at `:3624-3645`); `quire-app.ts:3995` (diff proposals — DM-only, filtered via `filterEventsForDiffProposal`). All player-bound paths correctly hard-coded.

### Q9 — Forbidden-token post-check
`spoiler-check.ts:214-251` (substring + word-boundary, NFKC-normalized, two-pass collapsed+spaced); AI semantic re-check at `:357-426` filters false positives. Tokens: `DEFAULT_SPOILER_TOKENS` (`:61-82`), overridable per `campaign.json.aiBackstory.spoilerTokens`. Failure handler: single auto-retry (`backstory-synthesizer.ts:209-251`); persistent leak → `spoiler-leak-persistent` with `rejectedResponse` so DM can hand-edit. **DM-facing only — players never told.** Honors silent-firewall.

### Q10 — Chat/AI confusion
`ai-panel.ts:601` renders `ai (DM)>` glyph; `:605` placeholder reads "Ask the AI privately". No confirm-step on submit. Defense is visual only. Chat-panel sibling has no symmetric "this is broadcast" cue. The `submitAiPrompt`-from-chat route (`quire-app.ts:7572`) actually pulls a draft FROM chat INTO AI when prefixed `/ai`, so the inverse misroute (typed in chat panel intending AI) is only flagged via `chat-spoiler-lint-controller` substring scan on send.

### Q11 — Cache hygiene
Not applicable: no cache wired (see Top-3 #2). When it lands, `cache_control` should sit on system+tools+the static campaign-context prefix; the DM's typed prompt + live-state suffix are dynamic. Save/restore is irrelevant to a server-side ephemeral cache; in-memory key would naturally invalidate on reload.

### Q12 — See Top 3 above.

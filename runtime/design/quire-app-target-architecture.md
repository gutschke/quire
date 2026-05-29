# quire-app.ts — target architecture + decomposition finish line

**Status:** definition (2026-05-29, #409, Architect consultancy B4/B5).
This gives the E-LARGE-1 controller-extraction wave a *finish line* and
the right *metrics*, and sequences the perf prerequisite that must land
before further extraction.

## The problem

`quire-app.ts` is the god-object root component. A large extraction
wave (E-LARGE-1/2) pulled state *clusters* into Lit ReactiveControllers,
but **LOC barely moved** because the extractions took *state* while the
*behavior* (handlers, event-authoring) stayed on the host. Without a
defined END STATE, every extraction feels arbitrary and LOC plateaus
around 7k indefinitely. (See [[feedback_loc_is_a_proxy]]: LOC is a
lagging proxy — measure the real property.)

## Current state (verified 2026-05-29)

| Metric | Value | Notes |
|---|---|---|
| LOC | 7465 | the *lagging proxy* |
| reactive `@state()` decorators | 32 | **the real metric** — domain state on the host (corrected: the earlier "41" came from `grep -c "@state"`, which also caught ~9 JSDoc *mentions*; the accurate decorator count is `grep -cE "@state\(\)"` = 32) |
| `@property` | 2 | (it's the root; few inbound props) |
| `render*` methods | ~42 | the orchestrator's legitimate job |
| total methods | ~199 | so ~157 non-render logic/handler methods |
| `session.append(...)` sites | 49 | the event-authoring surface |
| controllers already extracted | 12 → 13 | + `ai-panel-controller` (#413) |

**#413 progress (2026-05-29):** `AiPanelController` extracted — the 10
AI-panel fields moved off the host (reactive `@state()` **32 → 22**).
Delegating get/set accessors on the host preserve every call site
verbatim (firewall-adjacent surface → zero behavior change → green).
`transientError` stayed on the host (a SHARED error field, not
AI-panel-specific — a trust-but-verify catch). The cross-controller
*orchestration* (`submitAiPrompt`, `shareAiResponseToChat`) stays on the
host by design; its panel-state writes flow through the delegating
setters. Handler-behavior migration into the controller is the natural
follow-on increment.

## The END STATE

`quire-app.ts` becomes a **render-orchestrator + thin event-authoring
facade**:

- It owns ONLY *view-orchestration* `@state` — what's on screen, not
  domain facts: `appMode`, `wrapStep`, `showRoster`, `stageTab`,
  `_appState` (routing), `sessionView` (the projected view it renders),
  plus the firewall-derived render caches `boundCharacter` /
  `boundCampaign` (which stay here because they're the coord-flip
  invalidation targets — see [[feedback_engineering_practices_from_reviews]]).
- It composes the region components (the ~42 `render*` methods stay —
  composing the UI tree IS the orchestrator's job) and delegates
  domain state + event authoring to controllers.
- Domain `@state` and the handlers that author events live on
  controllers, reached through the controller's public API.

**This is not "zero LOC" — it's zero *domain ownership*.** The target is
a host that, read top-to-bottom, is "wire controllers → project view →
compose regions → delegate."

## Metrics that matter (and targets)

| Metric | Now | Target | Why |
|---|---|---|---|
| domain `@state` on host | 22 (was 32; #413 moved 10) | **≤ ~8** (view-orchestration only) | the host shouldn't *own* domain facts |
| event-authoring methods on host | most of 49 sites | **near 0** (delegated to controllers) | authoring belongs with the state it mutates |
| LOC | 7465 | trends down (~2–3k) as a *result* | a lagging indicator, not a goal |

Track the first two. LOC follows; don't chase it directly.

## Decomposition roadmap (next targets, prioritized)

The remaining `@state` fields cluster into clear extraction candidates. In
priority order (biggest-cohesion-first, after the perf prereq below):

1. **`AiPanelController`** — ✅ STATE EXTRACTED (#413, 2026-05-29). The
   10 AI fields (`aiPromptDraft`, `aiResponse`, `aiResponseStructured`,
   `aiScope`, `aiVerdictResponseId`, `aiVerdictKind`, `aiLoading`,
   `aiShowSettings`, `aiReviewEveryUpdate`, `aiBudgetCeiling`) now live on
   the controller (NOT `transientError` — that's a shared host error
   field). Sits alongside `AiWriteController` (write-batch) + `AiKeyStore`
   (keys). **Firewall:** `aiResponseStructured` carries a `dmOnly` slice;
   the firewall is the `showAiPanel()` render-gate (live `isCoordinator()`),
   which stayed on the host and is pinned by `coord-flip-firewall.test.ts`
   — verified intact. FOLLOW-ON: migrate the panel-state mutations
   (currently inline in `submitAiPrompt` / the render handlers) into
   controller methods so behavior — not just state — lives there.
2. **`DiceController`** — ✅ SHIPPED (#414, 2026-05-29). Unlike the AI
   panel this is STATE + BEHAVIOR: `rolls`/`rollDraft`/`rollError` + the
   parse→roll→history→draft-clear logic moved to the controller; the
   host keeps a delegating `submitRoll` (called from the `/roll` slash
   path + tests) + getters, and publishes the roll to peers via an env
   callback (host owns the session gate). `@state()` 22 → 19.
3. **`ChatController`** — ❌ RECLASSIFIED, not extracting (#414 review,
   2026-05-29). On inspection it doesn't pencil out: `chatDraft` /
   `chatError` are transient INPUT-DRAFT state — the same category as
   `joinCodeDraft` / `displayNameDraft` / `renameDraft`, which this very
   doc lists as STAYING on the host. And `submitChat` is cross-controller
   ORCHESTRATION (it routes `/roll` → dice, `/ai` → the AI panel, caps
   length, and gates through `ChatSpoilerLintController`'s firewall),
   which legitimately stays on the host exactly like `submitAiPrompt`.
   So a "ChatController" would be a thin 2-field bag for state that
   belongs with the host's view-input — net churn, no real cohesion win.
   The chat DOMAIN state (messages) already lives in the event log /
   `sessionView`, not on the host. Leaving `chatDraft`/`chatError` as
   host view-input is the correct classification.

Stays on the host (view-orchestration / input-drafts / firewall-derived):
`appMode`, `wrapStep`, `showRoster`, `stageTab`, `_appState`,
`sessionView`, `boundCharacter`, `boundCampaign`,
`saveStatus`/`loadStatus`/`resumePromptDoc` (thin status mirrors of
`AutosaveController`), and the input-drafts `joinCodeDraft`,
`displayNameDraft`, `renameDraft`, `chatDraft`, `chatError`,
`aiPromptDraft`-style fields that are tied to a render template.

Each extraction follows the validated facade-migration order
([[feedback_facade_migration_pattern]]) and must keep the suite green
step-by-step.

## Prerequisite (do BEFORE further extraction) — E-PERF

`peer.state()` re-materializes the ENTIRE event log on every call
(`core/peer.ts:122-123`: `materialize(this.log.events())`), and the
session subscriber calls `requestUpdate()` with **no debounce**
(`quire-app.ts:619,630`). Today the monolith batches renders, so it
hasn't bitten — but **more controllers = more `requestUpdate` churn =
more full-log re-materializations per interaction.** Extracting first
would multiply the render surface on top of an O(n log n)-per-render
materialize. So sequence the perf work FIRST:

- **Memoize materialization**: cache the materialized `SessionState`
  keyed on the log's size/clock snapshot; only re-fold when the log
  actually grew. (`materialize` is already a pure fold — safe to memoize.)
- **Debounce `requestUpdate`** on the session-update path (microtask or
  rAF coalesce) so a burst of applied events triggers one render.

Tracked as a task (E-PERF). Target the 4-hour / thousands-of-events /
≤50-episode session profile from [[project_quire_ai_context_scaling]].

**UPDATE (2026-05-29, #412 SHIPPED):** the **memoization is done** —
`EventLog` now exposes a `revision()` counter (bumps on append + a
newly-applied apply) and `Peer.state()` memoizes the materialize fold
keyed on it. This collapses the redundant same-revision materializes (a
local append previously materialized the whole log TWICE — once via
`peer.append → notifyStateChange → onStateChange → notify`, once via the
controller method's explicit `notify()` — plus the coordinator-check
reads). Firewall-NEUTRAL: it caches the UNFILTERED state;
`filterForViewer` still runs fresh per `view()`. The **`requestUpdate`
debounce was found unnecessary** (trust-but-verify): the session
subscriber sets the `@state sessionView`, and Lit already batches all
`@state` writes into ONE render per microtask — renders are already
coalesced regardless of how many controllers fire. The only residual
micro-cost is a second `filterForViewer` on the double-notify;
eliminating it needs a viewer-keyed view memo, which carries firewall
risk (a stale projection) and isn't worth it without profiling
evidence — deferred.

## Invariants every extraction MUST preserve

- **The spoiler firewall** (the crown jewel). Any `@state`/cache that
  holds character/DM data and moves to a controller must keep its
  coord-flip invalidation (clear in `invalidateViewerScopedCachesOnCoordChange`
  + assert in `coord-flip-firewall.test.ts`) OR render-gate on live
  `isCoordinator()`. This bug class breached 3× — see the reviewer
  playbook's Adversarial section.
- **Determinism**: materializer / event-sourcing changes keep
  `materialize` a pure fold; concurrent-write order stays
  `causalCompare` (pinned by `state.determinism.test.ts`).
- **Engine vs campaign boundary**: don't bake new campaign policy into
  the engine during a move (see `engine-vs-campaign-boundary.md`).
- **Tests green at every step** (the facade-migration discipline).

## Non-goals

- A from-scratch rewrite. This is incremental extraction toward a
  defined target, not a big-bang.
- Chasing a LOC number. The host can be 3k LOC of legitimate render
  composition; that's fine if domain `@state` ≈ 0.

# Runtime redesign — engineering plan

Status: plan v0.1 (May 2026). Companion to [`../../design/ui.md`](../../design/ui.md), which is the design spec. This doc is the engineering plan: event-kind vocabulary, state additions, component decomposition, bundle budget, and **prioritized task list (P0-P5)**.

## Background

The current `src/quire-app.ts` is a ~3800-line Lit god-object rendering a vertical stack of cards (`renderSessionBar` / `renderRosterPanel` / `renderRevealBanner` / `renderBody` / `renderChatPanel` / `renderAiPanel`). It works but is the wrong shape for the cockpit UI specified in `ui.md`. The redesign introduces a five-region grid shell, new event vocabulary for per-paragraph reveal / map / scratch / thread-debt / broadcast, an `AiBroker` with structured tool returns, and a living-document workflow.

Highest-leverage move: **grid shell + region decomposition (P0)**. Until quire-app.ts stops being a god-object, every new feature accumulates weight on a structure that can't carry it. Everything in P1-P5 is significantly easier once foundation lands.

## Event vocabulary additions

Current `KNOWN_EVENT_KINDS` (see `src/core/state.ts:198-212`): `peer-join`, `peer-leave`, `peer-rename`, `peer-disconnect`, `coordinator-claim`, `coordinator-yield`, `coordinator-reclaim`, `scene-reveal`, `scene-unreveal`, `dice-roll`, `chat`, `pc-edit`, `note`.

New event kinds (add to `KNOWN_EVENT_KINDS` in P0-5 even before materializers ship, so saves from intermediate versions are forward-compatible):

| Kind | Authority | Payload | Materializes | Visible to |
|---|---|---|---|---|
| `scene-reveal-paragraph` | coord | `{scenePath, blockHash, paragraphIndex?}` | `revealedParagraphs[scenePath]: Set<blockHash>` | all |
| `scene-unreveal-paragraph` | coord | `{scenePath, blockHash}` | `revealedParagraphs[scenePath]: Set<blockHash>` | all |
| `thread-debt-set` | coord | `{pcId, level: 'quiet'|'noticed'|'watched'|'pushing-back'|'hunted'}` | `threadDebt[pcId]` | DM-only (render gate) |
| `npc-pin` | coord | `{npcId}` | `pinnedNpcs[]` | DM-only |
| `npc-unpin` | coord | `{npcId}` | `pinnedNpcs[]` | DM-only |
| `map-blob-add` | coord | `{scenePath, blobId, label, x, y, kind?}` | `mapBlobs[scenePath]` | all |
| `map-blob-move` | coord | `{scenePath, blobId, x, y}` | `mapBlobs[scenePath]` (LWW per blobId) | all |
| `map-blob-remove` | coord | `{scenePath, blobId}` | `mapBlobs[scenePath]` | all |
| `map-blob-reveal` | coord | `{scenePath, blobId}` | `mapBlobReveals[scenePath]` | gates player render |
| `map-blob-unreveal` | coord | `{scenePath, blobId}` | `mapBlobReveals[scenePath]` | gates player render |
| `broadcast-view` | coord | `{stagePath, tab?, scrollAnchor?}` | `broadcastView?` (LWW single slot) | all |
| `raise-hand` | self | `{}` | `raisedHands[peerId]` | all |
| `lower-hand` | self | `{}` | `raisedHands[peerId]` | all |
| `scratch-note` | coord | `{text, scenePath?}` | `scratchNotes[]` | **DM-only**, stripped from player save export |
| `ai-prompt` | coord | `{promptHash, model, contextRefs, tokenIn}` | `aiAudit[]` | DM-only |
| `ai-response` | coord | `{responseId, tokenOut, hash, prevHash}` | `aiAudit[]` | DM-only |
| `ai-accept` | coord | `{responseId, category?}` | `aiAudit[]` | DM-only |
| `ai-reject` | coord | `{responseId, category?}` | `aiAudit[]` | DM-only |

**Block identification — content hash, not position.** `blockHash` is the first 12 hex characters of `sha256(normalize(blockText))`, where `normalize` trims trailing whitespace and collapses internal whitespace runs to a single space. This survives mid-campaign edits: inserting a new paragraph, fixing a typo, or upstream merge does NOT invalidate prior reveals for unchanged blocks. When a block IS edited, its hash changes and prior reveals for that block silently lapse to hidden — which is correct behavior (the text changed; the DM should re-decide). The DM-side gutter renders lapsed pips in a distinct faint color so the DM sees what changed.

`paragraphIndex?` is included as a non-authoritative UI hint for tooltips ("approximately paragraph 3 of scene"). The materializer ignores it.

**Migration semantics for existing `scene-reveal`**: keep as sugar — revealing the whole scene synthesizes a `scene-reveal-paragraph` for every current block hash (or, more cheaply, the materializer keeps a derived `revealedScenes: string[]` that includes any scene with a whole-scene `scene-reveal` event or a non-empty `revealedParagraphs[scenePath]`). Existing player flows that check `revealedScenes.includes(path)` continue to work without code change. Cleanest implementation: materializer maintains both fields; `revealedScenes` is read-only and derived.

**Transient (local-only, DO NOT log)**: PC focus (which PC the DM is "nudging"), Stage tab selection, Aside collapse state, Rail expansion, dice modifier draft. These are local UI state.

**Two complementary filters**, both required:

1. **`filterForViewer(state: SessionState, viewerPeerId): SessionState`** in `src/core/state.ts`. Strips DM-only fields (`scratchNotes`, `aiAudit`, `threadDebt`, `pinnedNpcs`, and the DM-only entries of `mapBlobs` per the reveal mask) when the viewer is not in `coordHolders`. Used by region components for render-side gating. Prevents in-session leaks.
2. **`serializeSessionForViewer(events, campaign, savedByPeerId, scope: 'dm'|'player')`** in `src/persistence.ts`. Strips entire EVENTS from the save when `scope === 'player'` — specifically, drops `scratch-note`, `ai-prompt`, `ai-response`, `ai-accept`, `ai-reject`, `npc-pin`, `npc-unpin`, `thread-debt-set` events. The player-scope save then materializes to a state with no DM-only content. Without this, a DM who clicks "Save" and shares the JSON file inadvertently exposes their scratch column. The filter is event-level because state is derived; filtering only state would still leave DM-only events in the saved log to be re-materialized on load.

Hostile-input tests must verify that `scratch-note` events never appear in a player-scope export; that the resulting save loads cleanly with `applySaveToLog`; that the player-scope materialized state contains no DM-only fields.

**New caps to add** (DoS guards alongside existing `ID_CAP`/`CHAT_CAP`/etc.):

```
REVEALED_BLOCKS_PER_SCENE_CAP = 256   /* hashes per scene, well above any realistic length */
BLOCK_HASH_LENGTH             = 16    /* hex chars; 64 bits — collision probability 1-in-130B
                                          at 256K hashes (256 blocks × 1000 scenes) */
MAP_BLOB_COUNT_CAP            = 500   /* per scene */
PINNED_NPC_CAP                = 50
SCRATCH_NOTE_CAP              = 5000
```

**Per-case validator convention.** With ~17 new event kinds added to the `applyEventToState` switch in `src/core/state.ts`, each case gains a payload validator. Convention: define one top-of-file helper per kind (`isScratchNotePayload`, `isMapBlobAddPayload`, `isThreadDebtSetPayload`, ...) following the existing `isPlainObjectPayload` / `isBoundedString` / `isSafeKey` style. Each validator is independently testable from `state.hostile.test.ts`. Do NOT inline payload validation in the switch cases; the resulting drift across 17 cases becomes unreviewable.

**Payload versioning.** Every new event payload carries an explicit `v: 1` field. Materializers check `v` and reject unknown versions, surfacing them via the H-4 unknown-kind banner. This buys freedom to revise payload shapes through M3a/M3b without breaking saves — a critical-path concern because the content-hash addressing for `scene-reveal-paragraph` was itself a late change driven by adversarial critique.

**Block-hash compute pipeline.** `getBlockHashes(scenePath, source): Promise<string[]>` lives in `src/markdown/block-hashes.ts` with a `WeakMap<source, hash[]>` cache. Hashes are computed ONCE per scene load via `crypto.subtle.digest('SHA-256', ...)`, then fed synchronously to `renderMarkdownParagraphs`. Render is sync; hashing is async at load time only. This avoids the per-frame async-in-render problem that a naive in-renderer hash would cause.

## SessionState shape after additions

```ts
interface SessionState {
  // ... existing fields ...
  revealedParagraphs: Record<string /*scenePath*/, Set<string /*blockHash*/>>;
  threadDebt: Record<string /*pcId*/, ThreadDebtLevel>;
  pinnedNpcs: string[];
  mapBlobs: Record<string /*scenePath*/, MapBlob[]>;
  mapBlobReveals: Record<string, Set<string /*blobId*/>>;
  broadcastView?: { stagePath: string; tab?: StageTab; ts: number };
  raisedHands: Set<PeerId>;
  scratchNotes: ScratchNote[];
  aiAudit: AiAuditEntry[];
}
```

`scratchNotes` and `aiAudit` are render-gated DM-only. `threadDebt` and `pinnedNpcs` are shared (co-DM continuity, post-session AI ingestion) and render-gated DM-only.

**Important: state is never serialized; events are.** `src/persistence.ts:42-55` defines the save document as `{$schemaVersion, savedAt, campaign, savedByPeerId, events}`. State is rebuilt from events via `materialize()` on load. New `Set` types in `SessionState` are in-memory-only; nothing extra is needed to serialize them. The persistence concern is **event stripping**, not state stripping (see next section).

## AI broker architecture

Current shape: `src/ai/anthropic.ts` and `src/ai/gemini.ts` are independent text-in/string-out functions (`callAnthropic`, `callGemini`). The new shape:

```
src/ai/
  broker.ts          — AiBroker class; the only thing the UI calls
  providers/
    anthropic.ts     — provider impl (HTTP shape mostly unchanged)
    gemini.ts        — provider impl
    extension.ts     — Chrome-extension-bridged Anthropic (DEFERRED v2)
  context.ts         — wrapUntrusted(), buildContext()
  audit.ts           — hash chain, IndexedDB-backed full text
  budget.ts          — token meter
  schema.ts          — AiResponse, AiDiffProposal validation
```

Interface:

```ts
interface AiCompleteRequest {
  prompt: string;
  scope: 'public' | 'dm';     // public default; DM-only opt-in
  contextRefs?: string[];      // campaign-relative file paths; validated
  signal?: AbortSignal;
}

interface AiResponse {
  safe: string;
  dmOnly: string;
  sources: SourceRef[];
  raw: string;
  tokensIn: number;
  tokensOut: number;
  responseId: string;
}

class AiBroker {
  complete(req: AiCompleteRequest): Promise<AiResponse>;
  proposeChanges(digest: SessionDigest): Promise<DiffProposal[]>;
}
```

Provider impls request a structured tool (Claude tools / Gemini response schema) with the `AiResponse` shape. Broker normalizes both; on parse failure synthesizes `{safe: '', dmOnly: '(AI response was not in the expected format; raw text saved to audit log)', sources: []}` rather than throwing.

**`contextRefs` path validation** (security-critical, P2-6 includes this). Every path in `contextRefs` must:
- Be campaign-relative (no leading `/`).
- Not contain `..` segments after normalization.
- Pass the same path validator that `CampaignLoader` uses for fetched files.
- When `scope === 'public'`, must not start with `dm/` or `design/DM-ONLY/` (the broker enforces this even if the path is otherwise valid — defense in depth against a DM who toggles scope wrong mid-prompt).

Validation lives in `src/ai/context.ts` and is independently testable from `ai/context.hostile.test.ts`. Cases: absolute paths, `../etc/passwd`-style, paths to `dm/*` with public scope, paths to nonexistent files.

**Scope toggle resets per prompt.** The DM's "include DM notes" toggle is consumed by the broker on submit and resets to `public` for the next prompt. This is part of the safety property: a DM who toggled DM-mode for an earlier query in the session does not stay armed.

**AI calls restricted to current coordinator only.** A peer who is in `coordHolders` historically but is NOT currently `state.coordinator` cannot fire `complete()` or `proposeChanges()` — the broker checks `this.session.view().shared.coordinator === this.session.view().peerId` and rejects. This keeps the hash-chained audit a strict chain (single appender), not a fork-prone DAG.

**Untrusted content wrapping**: every campaign-sourced string passed in `contextRefs` is wrapped in `<untrusted_content source="...">…</untrusted_content>`, with literal `</untrusted_content>` strings replaced by `<!--UC_CLOSE-->` sentinels. A **load-time validator** in `campaign-loader.ts` rejects raw campaign content that contains the literal sentinel `<!--UC_CLOSE-->`. Hostile-input tests: literal sentinel in body, frontmatter values, YAML keys, code fences, HTML comments inside Markdown.

**Differentiated retry strategy by call site.**
- `complete()` — latency-sensitive (DM is waiting on the typing cursor). On parse failure: return degraded `{safe:'', dmOnly:'(AI response was not in the expected format; raw text saved to audit log)', sources:[]}` immediately.
- `proposeChanges()` — batch operation (DM is reviewing a diff). On parse failure: retry up to 2× with a clarification prompt appended ("Your previous response did not validate against the schema. Please return ONLY a JSON array of DiffProposal objects."), then degrade if still failing.

**Provider quirks the broker must handle.**
- **Anthropic tool use** can include a leading `text` block before the `tool_use` block (Claude often narrates its tool choice). Broker iterates `content[]` and picks the first `tool_use` block, treating absent `tool_use` as parse failure.
- **Gemini structured output** does NOT support `oneOf`/`anyOf` for response root. `DiffProposal`'s `category` union is worked around via a single object with all category fields optional, validated client-side.
- **Both providers** occasionally violate their schemas under load. Tests at the `fetch` mock layer (not the SDK mock) cover malformed JSON, wrong shape, mixed text/tool_use blocks, and truncated responses.
- **Runtime fallback** for text-only response despite forced tool choice: broker attempts a second-pass regex extraction for `safe:` and `dmOnly:` blocks before synthesizing the parse-error response.

**Audit chain**: every prompt/response is hashed and chained against the previous (`{prevHash, promptHash, responseHash, ts, tokens}`). Chain head goes to events.jsonl via `ai-prompt`/`ai-response`. Full text lives in IndexedDB on the DM's machine, keyed by hash. After coord handoff, the new coordinator picks up the chain head from `aiAudit` (the latest event's `responseHash` becomes the new `prevHash`) and appends from there.

**Budget**: `tokensIn + tokensOut` accumulated per session, persisted in IndexedDB keyed by session id, displayed in Topbar widget. Hard-stop above ceiling; warning above 80%. UI treatment when ceiling hit: AI prompt input disables; banner above input reads "Token budget reached for this session." Pending in-flight prompt is cancelled. The ceiling is configurable per-DM in Settings.

## UI shell decomposition

Target file layout:

```
src/
  ui/
    quire-app.ts             — shell. Owns AppMode, sessionView, route,
                                region slots. Target ~300 LOC.
    shell/
      topbar.ts              — <quire-topbar>
      rail.ts                — <quire-rail>
      stage.ts               — <quire-stage>
      aside.ts               — <quire-aside>
      dock.ts                — <quire-dock>
    regions/
      player-rail.ts         — condensed sheet, expand-on-tap
      dm-rail.ts             — scene nav + active-PC card + DM sheet
      player-aside.ts        — roster + chat + private notes
      dm-aside.ts            — roster + pinned NPCs + DM aide + AI console
      scene-stage.ts         — markdown + reveal pips + scene strip
      outline-stage.ts       — scene list (DM)
      npcs-stage.ts          — per-episode dm/npcs.md (DM)
      map-stage.ts           — image + SVG blob overlay
      authoring-stage.ts     — markdown editor (lazy chunk)
      diff-stage.ts          — post-session diff review (lazy chunk)
    modes/
      mode-state.ts          — AppMode enum + transitions
    styles/
      tokens.css             — oklch palette, clamp() typography
  controllers/
    session-controller.ts    (moved from src/)
  ai/
    broker.ts                (see above)
  living/
    session-digest.ts        — builds AI input
    diff-format.ts           — DiffProposal schema + JSON Pointer
    proposals.ts             — proposal flow
  sync/
    working-copy.ts          — IndexedDB dirty-files store
    manual-export.ts         — tarball download backend
```

`AppMode = 'pre-session' | 'in-session' | 'post-session' | 'authoring' | 'solo-browse'`. The shell selects which region implementation to mount per slot based on `(AppMode, isCoordinator())`. Region components communicate only through:

- A read-only `SessionView` prop (filtered via `filterForViewer`).
- Events bubbled to the shell, which forwards to `SessionController.append`.

Shared services (`SessionController`, `AiBroker`, `CampaignLoader`, `WorkingCopy`) are provided via Lit context (`@lit/context`) — avoid prop-drilling.

**Migration path — facade-migration pattern** (do not rewrite all at once):

1. **Extract CSS.** Move all `static styles` content from `quire-app.ts` to `src/ui/styles/tokens.css` and per-region `static styles` strings. Tests untouched. Reclaims ~700 LOC.
2. **Shell wrappers as slots.** Introduce `<quire-shell>` + region elements as Lit wrappers that `<slot>` the existing `renderXxx` output. The shell does no rendering of its own; `quire-app.render()` is unchanged. Tests untouched.
3. **One region per commit (handlers stay on root).** For each region: keep the handler method on `QuireApp` exported via `@lit/context`. The region's template lives in the new component; the region dispatches `CustomEvent`s that `QuireApp` listens for and routes to the original method. Public methods on `QuireApp` are untouched — `quire-app.*.test.ts` continue to work because the test surface is the public methods on the root.
4. **Handler migration (M2/M3a phase).** Once all regions are extracted as templates, refactor each region's internals to own its state. Tests need updates here.

**E2E harness shim.** ~11 e2e files cast `document.querySelector('quire-app')` to private-method types (`multi-session.spec.ts`, `full-session.spec.ts`, `sync.spec.ts`, `soak.spec.ts`, etc.). P0-11 captures the surface as `QuireAppHooks` in `src/types/hooks.ts`; `quire-app` keeps the facade through M3a. After M3a, hooks may migrate per region.

**Multi-region interaction tests** (`quire-app.chat.test.ts`, `.reveal.test.ts`, `.pc-edit.test.ts`) walk shadow-DOM textContent. After extraction the tree is `<quire-app><quire-shell><player-aside>…</player-aside></quire-shell></quire-app>` with two shadow boundaries. Add a `walkShadow(el): string` helper to the test setup and update test bodies once. This IS a forced edit to test code at extraction time — be honest about it in commit messages.

## Bundle budget

Current bundle: **~64 KB gzipped.** New costs (gzipped estimates):

| Addition | Cost | Lazy-loadable? |
|---|---|---|
| Grid shell + 8-10 region components | +10 KB | no |
| Map renderer (SVG, no library) | +5 KB | yes (per-scene) |
| Diff view (text-line diff hand-rolled) | +3 KB | yes (post-session only) |
| AI broker + audit + budget + schema validation | +8 KB | no |
| Ajv (authoring lint) | +25 KB | yes |
| CodeMirror 6 (editor + markdown + yaml + lint) | +100-120 KB | yes |
| Frontmatter form (schema-driven) | +5 KB | yes |

**Without lazy loading**: ~64 + 30 + 130 = ~225 KB. **With lazy loading** of authoring + diff + map: in-session bundle stays at ~95-100 KB. Authoring chunk (~130 KB) loads only when the user opens authoring mode. Diff chunk loads on "Wrap session." Map chunk loads when entering Map tab.

Vite dynamic imports: `import('./regions/authoring-stage')` returns a promise; shell mounts a "Loading editor…" placeholder.

**CI bundle-size regression test (P0-7)**: a CI step runs `vite build --report` and fails the build if the gzipped main chunk exceeds **110 KB** (12% headroom over the ~98 KB target). The authoring chunk has its own budget of **150 KB**. Without this gate, the in-session bundle silently grows over the project's lifetime.

Verify the CodeMirror 6 budget with a real `vite build` on a CM-included scratch branch before P4-3 lands — if it falls outside the +100-120 KB range, revise this section.

## Prioritized task list

Task IDs (P0-1, P0-2, ...) are referenced by plan docs and commit messages.

### P0 — Foundation (blocks everything)

- **P0-1 — Grid-shell + theme tokens.** Extract CSS to `src/ui/styles/tokens.css` (oklch palette, clamp typography). Introduce `<quire-shell>` with five named slots. Initially fills slots with existing `renderXxx` outputs. **Files**: `src/quire-app.ts`, new `src/ui/shell/`, new `src/ui/styles/tokens.css`. **Blocks**: P1-*, P2-*.
- **P0-2 — Mode state machine.** `AppMode = 'pre-session'|'in-session'|'post-session'|'authoring'|'solo-browse'` as a property on `QuireApp`; routing → mode mapping. **Files**: `src/routing.ts`, `src/quire-app.ts`, new `src/ui/modes/mode-state.ts`. **Blocks**: P3-*, P4-*.
- **P0-3 — Region component decomposition.** Extract `<quire-rail>`, `<quire-stage>`, `<quire-aside>`, `<quire-dock>`, `<quire-topbar>` as stub Lit elements that accept a `view: SessionView` prop and forward events. Region templates render initially via the facade-migration pattern (handlers stay on `QuireApp`, regions dispatch events). **Files**: `src/ui/shell/*`. **Blocks**: P1-*, P2-*.
- **P0-4 — `filterForViewer` helper.** Centralize DM-only render gating. **Files**: `src/core/state.ts`. **Blocks**: P2-2, P2-3, P2-4, P2-5, P5-5.
- **P0-5 — New event kinds registered with `v: 1` versioning.** Add all 17 new kinds to `KNOWN_EVENT_KINDS` (no materializers yet) so concurrent feature work doesn't drift and forward-compat is preserved. Every new payload schema carries explicit `v: 1`; materializers reject unknown `v`. **Files**: `src/core/state.ts`. **Blocks**: P1-7, P2-2, P2-3, P2-4, P2-5, P2-7, P2-11, P5-3.
- **P0-6 — Hygiene: architecture.md UI shape + phone-first update.** Replace stale framing. **Files**: `quire/design/architecture.md`.
- **P0-7 — CI bundle-size regression gate.** Add `vite build --report` to CI; fail when gzipped main chunk exceeds 110 KB or the authoring lazy chunk exceeds 150 KB. Add `bundle-gate.test.ts` so the gate is regression-protected (not just a manual one-shot). **Files**: CI workflow, `vite.config.ts` (size-limit plugin or equivalent). **Blocks**: none, but P4-3 verifies CodeMirror 6 fits the lazy budget.
- **P0-8 — Extract `session-bootstrap.ts`.** Encapsulate campaign loading, session host/join/leave lifecycle, R3-A pre-session route gating, R3-C campaign discovery. **Files**: new `src/controllers/session-bootstrap.ts`; extraction from `src/quire-app.ts`. **Blocks**: M1 LOC target.
- **P0-9 — Extract `autosave-controller.ts`.** Debounced autosave with quota warning. **Files**: new `src/controllers/autosave-controller.ts`; extraction from `src/quire-app.ts`. **Blocks**: M1 LOC target.
- **P0-10 — Extract `ai-key-store.ts`.** Provider selection, key management, legacy migration. **Files**: new `src/controllers/ai-key-store.ts`; extraction from `src/quire-app.ts`. **Blocks**: M1 LOC target.
- **P0-11 — `QuireAppHooks` interface for e2e harness.** Capture the surface that ~11 e2e files cast `document.querySelector('quire-app')` to. Stable through M3a; can fragment per region after that. **Files**: new `src/types/hooks.ts`; e2e harness updates. **Blocks**: M1 acceptance ("all existing tests still pass").
- **P0-12 — Peer version-gating at join.** Refuse joins from peers whose runtime announces an older `KNOWN_EVENT_KINDS` than M2's baseline. Clear "your DM is running a newer Quire — please update" error. Plus the H-4 unknown-kind banner for in-session events. **Files**: `src/session-controller.ts`, `src/quire-app.ts`. **Blocks**: prevents silent state divergence in mixed-version sessions.
- **P0-13 — `WorkingCopy` IndexedDB store** (promoted from P4-1). Foundational primitive needed by M3a (scratch export filter relies on event-stripping; export targets a writable surface) and M4 (per-category git commits). Read/write/list/revert/commit API. Lazy-init OK. **Files**: new `src/sync/working-copy.ts`. **Blocks**: M3a `serializeSessionForViewer` export path, M4 commit path.

### P1 — Critical in-session ergonomics

- **P1-1 — Player Rail (condensed PC sheet).** Move current sheet from `renderCharacter` into `<player-rail>`. Tap-to-expand state (Rail grows). **Files**: `src/ui/regions/player-rail.ts`. **Depends on**: P0-1, P0-3.
- **P1-2 — Scene Stage with scene-strip header.** Wrap current `renderScene` in `<scene-stage>` with a frontmatter-driven header (location, mood, duration, presentNpcs). **Files**: `src/ui/regions/scene-stage.ts`, `src/episode-loader.ts` (expose frontmatter). **Depends on**: P0-1, P0-3.
- **P1-3 — Roster Aside with harm/stress glyphs + connection dots + current-speaker pulse.** Reuse `renderRosterRow`; derive per-peer harm/stress from `pcEdits`. **Files**: `src/ui/regions/player-aside.ts`. **Depends on**: P0-3.
- **P1-4 — Dice Dock.** Move `renderRollPanel` into `<quire-dock>` with stat-chip UI (6 buttons + modifier stepper + last-3 pills). Keyboard: `R`, `1-6`, `+`/`-`, `Enter`. **Files**: `src/ui/regions/dice-dock.ts`. **Depends on**: P0-3.
- **P1-5 — DM Rail (scene navigator + active-PC focus + DM sheet).** **Files**: `src/ui/regions/dm-rail.ts`. **Depends on**: P0-3.
- **P1-6 — Chat collapse in Aside.** Move `renderChatPanel` into Aside; default collapsed in-person. **Depends on**: P0-3.
- **P1-7 — Raise-hand event + indicator.** Add `raise-hand`/`lower-hand` materializers; render ✋ in player Dock + DM Aside roster. **Files**: `src/core/state.ts`, `src/session-controller.ts`. **Depends on**: P0-5.

### P2 — DM cockpit additions

- **P2-1 — Per-paragraph reveal: markdown pipeline split.** Add `renderMarkdownParagraphs(text)` that splits source into blocks (paragraphs, lists, blockquotes, code fences, headings, tables) and renders each independently. Leave existing `renderMarkdown` unchanged for other callers. **Files**: `src/markdown.ts`, tests. **Depends on**: P0-1.
- **P2-2 — `scene-reveal-paragraph` event + state + gutter pips.** Materializer for `revealedParagraphs`; gutter pip UI in scene-stage. CSS hides blocks not in revealed set for players. **Files**: `src/core/state.ts`, `src/ui/regions/scene-stage.ts`. **Depends on**: P0-5, P2-1, P0-4.
- **P2-3 — DM scratch column in Dock.** `scratch-note` event + materializer + always-visible input. Hotkey `'`. Stripped from player save exports. **Files**: `src/core/state.ts`, `src/ui/regions/dm-dock.ts`, `src/persistence.ts` (export filter). **Depends on**: P0-5, P0-4.
- **P2-4 — NPC pinning.** `npc-pin`/`npc-unpin` events; pinned-NPC strip in DM Aside; pin survives scene changes. **Files**: `src/core/state.ts`, `src/ui/regions/dm-aside.ts`. **Depends on**: P0-5, P0-4.
- **P2-5 — Thread-debt ladder.** `thread-debt-set` event + 24 px ladder strip above Stage prose (DM-only). Per-PC rungs, not session-wide. **Files**: `src/core/state.ts`, `src/ui/regions/scene-stage.ts`. **Depends on**: P0-5, P0-4.
- **P2-6 — AiBroker class + structured `{safe, dmOnly, sources}` return.** Wraps existing Anthropic/Gemini calls; structured tool spec; parse-failure fallback. **Files**: `src/ai/broker.ts`, `src/ai/providers/*`, `src/ai/schema.ts`, `src/ai/context.ts`. Parallel-safe with shell work.
- **P2-7 — AI audit chain + events.** `ai-prompt`/`ai-response`/`ai-accept`/`ai-reject` events; IndexedDB-backed full-text store. **Files**: `src/ai/audit.ts`, `src/core/state.ts`. **Depends on**: P2-6, P0-5.
- **P2-8 — Public-only context default + DM-only opt-in toggle.** `buildContext({scope})`. **Files**: `src/ai/context.ts`, AI prompt UI. **Depends on**: P2-6.
- **P2-9 — Token-budget meter.** Per-session accumulator, Topbar widget, hard-stop ceiling. **Files**: `src/ai/budget.ts`. **Depends on**: P2-6.
- **P2-10 — Caution rail when DM views `dm/*` files.** Path-based detection in stage; persistent amber left-border + sticky `[!CAUTION]` banner. **Files**: `src/ui/regions/scene-stage.ts`. **Depends on**: P0-1.
- **P2-11 — Broadcast-view button + event.** `broadcast-view` event; players' Stage listens and navigates. **Files**: `src/core/state.ts`, `src/ui/regions/dm-dock.ts`, `src/quire-app.ts`. **Depends on**: P0-5.
- **P2-12 — Dual-card AI response renderer.** Always two cards. Empty card shows muted "(none)" placeholder. DM-only card carries amber rail + badge + lock glyph + "copy (do not read aloud)" + source chips. **Files**: `src/ui/regions/dm-aside.ts`. **Depends on**: P2-6.

### P3 — Living-document workflow (THE unique feature)

- **P3-1 — Session-digest builder.** Module that takes events + scratch notes + summary + current campaign files and produces a single prompt-budget-bounded string. Reuses untrusted-content wrapper. **Files**: `src/living/session-digest.ts`. **Depends on**: P2-6.
- **P3-2 — Diff format + JSON Pointer addressing + provenance.** `DiffProposal` schema; `baseSha` validation to reject if file moved. **Files**: `src/living/diff-format.ts`. **Depends on**: P2-6.
- **P3-3 — AI proposal flow (NPC-update MVP).** AI given `characters/npcs/*.json` + session digest; returns proposals; per-field accept/reject. **Files**: `src/ai/broker.ts` (extend), `src/living/proposals.ts`. **Depends on**: P3-1, P3-2.
- **P3-4 — Diff-view region (post-session, lazy chunk).** Two-pane current/proposed, category strip, per-proposal `✓`/`✗`/`✎`, per-category commit buttons. **Files**: `src/ui/regions/diff-stage.ts`. **Depends on**: P0-2, P3-3.
- **P3-5 — WorkingCopy + per-category commit.** IndexedDB dirty-files store; one git commit per accepted category. **Files**: `src/sync/working-copy.ts`. **Depends on**: P4-2 (manual export) or stub.
- **P3-6 — Extend categories** beyond NPC-update: scene-retcon, new-thread, dropped-thread, pacing-note. Same pipe. **Depends on**: P3-3.

### P4 — Authoring mode

- **P4-1 — WorkingCopy read-through delegation** (the bulk of P4-1 moved to P0-13). Read-through wiring in `campaign-loader.ts` when path is dirty. **Files**: `src/campaign-loader.ts`. **Depends on**: P0-13.
- **P4-2 — Manual export sync backend.** Tarball download of dirty files. **Files**: `src/sync/manual-export.ts`. **Depends on**: P4-1.
- **P4-3 — CodeMirror 6 lazy integration.** Editor + markdown + yaml language modes. **Files**: `src/ui/regions/authoring-stage.ts`, `vite.config.ts` (chunk). **Depends on**: P0-2.
- **P4-4 — Frontmatter form (schema-driven).** YAML keys as typed inputs from `schema/v0/*.schema.json`; bidirectional with editor. **Files**: `src/ui/authoring/frontmatter-form.ts`. **Depends on**: P4-3.
- **P4-5 — AJV lint panel.** Schema validation; errors inline with line numbers. **Files**: `src/ui/authoring/lint-panel.ts`. Same lazy chunk as P4-3.
- **P4-6 — File-tree component.** Campaign repo tree in Rail position during authoring mode. **Files**: `src/ui/authoring/file-tree.ts`. **Depends on**: P4-1.
- **P4-7 — Scaffolding (New Campaign / Episode / Scene).** Template files in `runtime/public/templates/`. **Depends on**: P4-1, P4-3.

### P5 — Maps MVP

- **P5-1 — `fetchCampaignBinary` + Blob IndexedDB cache.** Accepts `image/png`, `image/jpeg`, `image/webp` only. Rejects `image/svg+xml` (the SVG embedding contract is not yet locked; see H-5). **Files**: `src/campaign-loader.ts`.
- **P5-2 — `map:` frontmatter on `LoadedEpisode.scene`.** **Files**: `src/episode-loader.ts`. **Depends on**: P5-1.
- **P5-3 — Map blob events + materializers.** All seven `map-blob-*` events. **Files**: `src/core/state.ts`. **Depends on**: P0-5.
- **P5-4 — `<quire-map>` region.** Image rendered via `<img src=blob:...>` ONLY (never `<object>`, `<iframe>`, inline `<svg>`, or CSS `background-image`). SVG overlay for blobs is a sibling `<svg>` element, not the loaded asset. Drag handlers attach to `<g>` elements. **Files**: `src/ui/regions/map-stage.ts`. **Depends on**: P5-1, P5-2, P5-3.
- **P5-5 — Player blob-reveal gating.** Via `filterForViewer`. **Depends on**: P0-4, P5-4.

### M1 gate — follow-up P-tasks (added 2026-05-21 from gate findings)

The M1 gate closed `ship-with-followups`.  These tasks land in the
indicated milestones; reviewers will check them at the relevant
gates.

- **P0-4-followup — Wire `filterForViewer` into `SessionController.view()`.** Add a `filteredShared` accessor on `SessionView` (or replace `shared` outright with the filtered view) so M2 region components cannot accidentally read raw `sessionView.shared` and skip the DM-only gate.  Land alongside the first M2 player-region commit.  Files: `src/session-controller.ts`, `src/core/state.ts`.  Source: Engine.
- **P0-4-followup-coord — Distinguish `coordHolders` (monotonic, reveal-authority) from `currentCoordHolders` (read-gating).** A peer who briefly held coord then yielded should lose DM-only read access; current `filterForViewer` treats them as DM-equivalent until kicked.  Land in M3a alongside the first DM-only event materializer.  Files: `src/core/state.ts`.  Source: Engine.
- **P0-7b — Bundle-gate runner integration test.** Beyond the text-grep drift test added in M1, spawn `node scripts/check-bundle-size.mjs` against a fixture dist/ tree and assert exit code 1 on over-cap.  Land alongside M5 (when authoring chunk first exists so both caps have fixtures).  Files: `src/bundle-gate.test.ts`, `e2e/_fixtures/`.  Source: Engine + Adversarial.
- **P0-7c — Add `'other'` chunk cap or total-cold-path cap.** Today the PeerJS bundler chunk (~31 KB) falls outside any cap; a regression that bloats it is invisible.  Either add `OTHER_CHUNK_CAP_BYTES = 50 * 1024` or a total cold-path cap of 110 KB.  Lands in M2 when the lazy-chunk story firms up.  Files: `src/bundle-gate.ts`, `scripts/check-bundle-size.mjs`.  Source: Performance.
- **P0-7d — Bundle-gate integration test that runs `vite build` and asserts the chunk-naming structure.** Catches Vite manualChunks renames that would silently downgrade enforcement.  Lands in M5 alongside the authoring chunk.  Files: `src/bundle-gate.test.ts`.  Source: Performance.
- **P0-8b — Extract `host/join/leave/regeneratePairingCode` to session-bootstrap.** The M1 deferral was rationalized as "M2 entanglement", but the Adversarial reviewer correctly noted that after M2 these methods become MORE coupled (the @state fields they read move into the roster region).  Extract during M1 close-out OR as the first M2 commit.  Files: `src/controllers/session-bootstrap.ts`, `src/quire-app.ts`.  Source: Adversarial.
- **P0-11-followup — Tighten `QuireAppHooks` type test to bidirectional assignability.** Current test only checks `QuireApp → QuireAppHooks` assignability; widening a method signature (`submitChat(text, retry?)`) would pass silently.  Add a `MutuallyAssignable<A, B>` helper or per-method invariant checks.  Lands at M2 close.  Files: `src/types/hooks.test.ts`.  Source: Adversarial.
- **P0-11-followup-appState — Convert `appState` from public field to public getter.** Current implementation is `@state appState: AppState` which is writable from outside the class.  The hooks contract declares `readonly`, but TypeScript doesn't enforce this with a public field.  Switch to `private _appState` + `get appState(): Readonly<AppState>`.  Lands in M2.  Files: `src/quire-app.ts`.  Source: Engine.
- **P0-12-followup-banner — Runtime peer-version-mismatch banner.** `knownKindsCount` is captured in PeerPresence but no UI surfaces a banner when an active peer reports a lower count than `KNOWN_EVENT_KINDS.size`.  Lands alongside the roster region in M2.  Trigger: `peer.knownKindsCount < local.size OR peer.knownKindsCount > local.size + 50` (a "from-the-future" inflation suggests a malicious peer).  Files: `src/ui/regions/dm-aside.ts`, `src/ui/regions/player-aside.ts`.  Source: Engine + Security.
- **P0-12-followup-refuse-join — Transport-layer refuse-join for older runtimes.** Today the peer-join just embeds knownKindsCount; the transport layer doesn't refuse the join.  Decide whether to refuse joins from peers whose count is below M2's baseline, or just warn.  Lands in M2 alongside the banner.  Files: `src/session-controller.ts`, `src/session-peerjs.ts`.  Source: Engine.
- **P2-3-followup — AutosaveController uses `serializeSessionForViewer` (NOT the unfiltered `buildSaveDocument`) for non-coordinator peers.** A player who autosaves their session and then exports the JSON would otherwise leak DM-only events.  Critical at M3a when DM-only events first ship.  Files: `src/controllers/autosave-controller.ts`, `src/quire-app.ts`.  Source: Security.
- **P3-3-followup-autosave-cost — Cheap pre-check on event count before `stringifySave` in autosave.** Currently autosave serializes the full event log on every debounced fire, then checks the result against REFUSE.  Pre-check `doc.events.length` against a count threshold (e.g. 20_000) before serializing.  Lands in M3a.  Files: `src/controllers/autosave-controller.ts`.  Source: Performance.
- **P4-1-followup-close — `WorkingCopy.close()` lifecycle.** IndexedDB connection stays open forever; needs a close path when M4 introduces multi-instance use (per-campaign WorkingCopy).  Lands in M4.  Files: `src/sync/working-copy.ts`.  Source: Performance.
- **P4-1-followup-paths — Refactor `WorkingCopy.isValidPath` to share with `campaign-loader`'s path validator.** Today the two implementations diverge slightly; WorkingCopy's `..` substring check false-rejects legitimate filenames like `1.0..1.md`.  Factor a shared `validateCampaignRelativePath()` helper.  Lands in M3a or M4.  Files: `src/sync/working-copy.ts`, `src/campaign-loader.ts`.  Source: Engine + Security.
- **H-2-now — UC_CLOSE sentinel validator.** `security.md` claims a load-time validator exists; it doesn't.  Either implement now (single regex in `loadCampaign` and `fetchCampaignFile` rejecting any raw content containing `<!--UC_CLOSE-->`) or amend security.md to say "(planned for M3b)".  **Recommended: amend security.md at M1 close (documentation alignment); ship the validator with M3b's AI broker.**  Files: `quire/design/security.md` OR `src/campaign-loader.ts`.  Source: Security.
- **H-7-bootstrap — Drop `accessibility.md` from `review-history/`.** Per the v0.2 execution plan, accessibility is tracked via the H-7 cross-cutting audit, not per-milestone gates.  The empty per-lens file is bootstrap drift; either delete or replace with a one-line pointer to H-7.  Files: `runtime/design/review-history/accessibility.md`.  Source: Adversarial.
- **H-process-status-cadence — Restate the "STATUS.md update per significant commit" cadence at M2 kickoff.**  M1 updated STATUS only at start + end (2 commits out of 13).  Source: Adversarial.  No file change needed; the next milestone-opening commit should refresh STATUS and the next gate review will hold the cadence accountable.

### M2 gate — follow-up P-tasks (added 2026-05-21)

The M2 gate closed `ship-with-followups` from all three reviewers (TTRPG-craft, Web-UX, Adversarial). No HIGH-severity Engine/Security findings (those reviewers weren't at this gate). HIGH findings from the spawned lenses surfaced two action-required-at-gate-close items (unstyled CSS, STATUS honesty) — addressed inline in the gate-close commit — plus a substantial list of M3a follow-ups.

**M3a acceptance criteria (HARD, ack-required 2026-05-21)**:

*Structural (replacing the M3a ≤900 LOC cap; see execution-plan.md § M1 acceptance — M3a row)*:
- **P-M3a-session-bar-region** — `<session-bar>` region extracts `renderSessionBar` (216 LOC currently). Same pattern as the M2 region extractions; lifecycle delegates stay on root. (Code-quality expert + Adversarial HIGH.)
- **P-M3a-route-policy** — `src/controllers/route-policy.ts` extracts the gating logic from `navigateToRoute`: R3-A pre-session block, non-coord episode/scene gates, NPC DM-only check.  Pure function `decideRoute(route, sessionView) → 'allow' | { kind: 'block', message, details }`. (Code-quality expert HIGH.)
- **P-M3a-ai-panel-region** — `<ai-panel>` region extracts `renderAiPanel` + `renderAiSettings` + `renderAiPromptForm` (174 LOC together). AI getter/setter cluster on QuireApp can collapse alongside or migrate into the region with AiKeyStore injected directly. (Code-quality expert HIGH.)
- Structural caps at M3a close: max-method-LOC ≤ 80, delegation ratio ≥ 75%, quire-app.ts ≤ 2000 LOC.

*Player-side UX (from TTRPG-craft review)*:
- **P-M3a-rail-always-on** — `<player-rail>` mounts in the rail slot whenever there's an active session with a PC binding, regardless of the route. Scene route renders Stage, not Rail. (TTRPG-craft HIGH.)
- **P-M3a-pc-binding** — Add a PC-to-peer binding (extend `peer-rename` with `pcId`, OR new `peer-bind-pc` event).  Migrate `presence.character` from free-text to PC id reference.  Order BEFORE any UI consumes it. (TTRPG-craft HIGH.)
- **P-M3a-stat-chips** — Dice Dock renders 6 stat chips with current-modifier display (depends on P-M3a-pc-binding). (TTRPG-craft HIGH.)
- **P-M3a-scene-strip** — Episode-loader exposes per-scene frontmatter; `<scene-stage>` renders the scene-strip header below the breadcrumb. (TTRPG-craft + Web-UX MEDIUM.)
- **P-M3a-roster-glyphs** — Player Aside roster shows harm/stress glyph + connection-state dot + current-speaker pulse (depends on P-M3a-pc-binding). (TTRPG-craft MEDIUM.)

*Process*:
- **P-M3a-filteredShared-migrate** — First M3a commit migrates all player-visible renderers from `sessionView.shared` to `sessionView.filteredShared`. Locked-in M3a gate criterion. (Adversarial MEDIUM.)
- **P-M3a-status-cadence-decision** — STATUS.md cadence rule is unenforceable in practice at current pace. Decide: drop the rule honestly, add a pre-commit hook, OR commit STATUS as a separate commit between feature commits. (Adversarial MEDIUM.)

**M3a opening tasks (polish; can land in any M3a commit)**:
- **P0-12-followup-e2e** — Playwright e2e for raise-hand (DM hosts, player raises hand, DM sees glyph; satisfies cross-cutting "round-trip e2e" rule retroactively). (Adversarial LOW.)
- **P1-regions-harmonize** — Normalize region prop interfaces (callback names, type exports, TemplateResult-as-prop vs structured events). Land before M3a adds 4 DM-side regions. (Web-UX MEDIUM + Adversarial LOW.)
- **P1-7-followup-hand-auto-lower** — On `scene-reveal-paragraph` event, auto-emit `lower-hand` for all currently-raised hands (mechanics-fade). (TTRPG-craft MEDIUM.)
- **P1-7-followup-hand-dm-decision** — Decide whether materializer rejects `raise-hand` from current coordinator (defense-in-depth) or whether the DM glyph render path is intentional. Document. (TTRPG-craft MEDIUM + Adversarial LOW.)
- **P-M3a-raise-hand-position** — Move raise-hand button OUT of the `<form>` element (current placement risks Enter-key submitting the roll form); position at Dock-right per ui.md. (Web-UX MEDIUM.)
- **P-M3a-banner-language** — Adjust version-mismatch banner copy to player-fluent language ("older Quire — some scenes/actions may look different to them") instead of engineer-jargon ("may not render every event"). (TTRPG-craft LOW.)
- **P-M3a-status-update** — Correct STATUS to reflect what shipped vs the 4 design-spec deviations (already applied at gate close).
- **P-M3a-pace-acknowledge** — Honestly revise the execution-plan's time estimates at M3a entry. M1 (3h) + M2 (30min) are wildly faster than the 2-3 weeks each was budgeted. Either the planner over-stated difficulty or corners are being cut faster than reviews catch. Acknowledge in plan. (Adversarial HIGH.)

**Architectural note added to plan**:
- **A-1 — Light-DOM region rendering**: M3 token-migration is a per-region all-or-nothing CSS rewrite because legacy CSS keys to bare class selectors. Two plan-of-record options: (a) per-region migration with synchronous selector→token rewrite, (b) ship `tokens.css.ts` as a global stylesheet and keep regions light-DOM. Option (b) is cheaper; option (a) is "right" per traditional Lit practice. **Decide at M3a entry.** (Web-UX HIGH.)
- **A-2 — Region prop convention**: After P1-regions-harmonize, all callbacks named `on<Verb><Subject>` (e.g. `onSubmitChat` not `onSubmit`; `onRollDraftChange` not `onDraftChange`). All TemplateResult-as-prop usages refactored to structured events (e.g. scene-stage's `headerExtras`). (Web-UX MEDIUM.)

### Cross-cutting hygiene (do alongside P0/P1)

- **H-1 — Resolve architecture.md "phone-first" / desktop-only conflict.** Done as part of P0-6 (already applied).
- **H-2 — Markdown sanitizer `<img>` handling audit.** Map work depends on understanding what survives the sanitize hook. **Files**: `src/markdown.ts`, `src/markdown.hostile.test.ts`.
- **H-3 — `revealedScenes` ↔ `revealedParagraphs` migration spec.** Resolved: materializer maintains both fields. `revealedScenes` is a derived read-only array containing every scene path that has either a whole-scene `scene-reveal` event OR a non-empty `revealedParagraphs[scenePath]` set. Existing callers that check `revealedScenes.includes(path)` keep working. New callers use `revealedParagraphs[scenePath]` for block-level granularity. Document this in code comments alongside `state.ts:KNOWN_EVENT_KINDS`.
- **H-4 — Unknown-event-kinds banner.** When `applySaveToLog` encounters event kinds not in the current runtime's `KNOWN_EVENT_KINDS`, surface a one-line banner: "This save contains N event kinds your runtime doesn't recognize; some scene state may be incomplete." Belongs in `persistence.ts`. The materializer already silently ignores unknown kinds (forward-compat is preserved); the banner adds back-compat visibility. **Files**: `src/persistence.ts`.
- **H-5 — Map asset MIME restriction.** The map fetch path accepts `image/png`, `image/jpeg`, `image/webp` only. SVG is rejected pending an audit of how it renders through the embedding path; see P5 notes. **Files**: `src/campaign-loader.ts` (binary fetch path).
- **H-6 — Error-state UI for budget ceiling, baseSha mismatch, lapsed paragraph reveals, AI parse failure, sync push failure.** See [`ui.md`'s "Error states"](../../design/ui.md#error-states) section. These are touched across many regions; track that the design constraints land alongside each feature task.
- **H-7 — Accessibility constraints.** Per [`ui.md`'s "Accessibility"](../../design/ui.md#accessibility) section: WCAG AA contrast on the oklch palette must be verified at implementation time. Live-region ARIA on the Stage updates and dice rolls. `aria-live="polite"` on revealed-paragraph appearance; `aria-live="assertive"` on dice results. Focus management when Rail expands and search palette opens.
- **H-8 — CLI lint TODOs**: see [`quire/cli/TODO.md`](../../cli/TODO.md) and the "Lint-side TODOs" section of [`quire/design/authoring.md`](../../design/authoring.md). Independent of runtime; mentioned here for cross-project visibility.

### Deferred to v2

- **D-1** Anthropic via Chrome extension (`src/ai/providers/extension.ts`). Architecture.md mandates long-term; v1 uses `anthropic-dangerous-direct-browser-access` (documented residual risk).
- **D-2** GitHub PAT / device-flow sync backend.
- **D-3** Google Drive App-folder sync backend.
- **D-4** Real 3-way merge UI for upstream-moved conflicts (v1 ships detect-and-block).
- **D-5** Multi-DM concurrent-editing affordances; v1 assumes single DM at a time even though `coordHolders` already supports the history.
- **D-6** Advanced map providers (`MapProvider` interface beyond static image).
- **D-7** Streaming AI responses.
- **D-8** Mid-session `truncate` event for partial rewind; v1 ships whole-session rewind only.
- **D-9** Service-worker offline-capability hardening for authoring writes.
- **D-10** Tactical grid combat / live token movement / fog of war.
- **D-11** Per-paragraph heading-fusion grouping syntax.

## Recommended ordering

The plan is not strictly sequential — many P1/P2 tasks parallel-safe once P0 lands. Mapped to the milestone structure in [`execution-plan.md`](execution-plan.md):

1. **M1 — Foundation (3-4 weeks)**: P0-1 through P0-13. Outcome: shell exists, region scaffolds present, event vocabulary frozen with `v: 1` versioned payloads and content-hash paragraph identifiers, mode state defined, peer-version-gating in place, WorkingCopy primitive shipped, three controllers extracted (`session-bootstrap`, `autosave-controller`, `ai-key-store`), CI bundle-size gate regression-protected, stale arch docs updated.
2. **M2 — Player view (2-3 weeks)**: P1-1 through P1-7 (excluding P1-5 DM Rail). Outcome: players use new region components for the full session; scene rendering via existing `renderMarkdown` (no per-paragraph yet).
3. **M3a — DM cockpit, no AI (3-4 weeks)**: P1-5, P2-1 (incl. `getBlockHashes` async cache), P2-2 (incl. player-DOM omission), P2-3 (incl. `serializeSessionForViewer`), P2-4, P2-5, P2-10, P2-11. Outcome: gutter pips, scratch column, NPC pinning, thread-debt ladder, caution rail, broadcast. **v1 ships at end of M3a.** Tag `playtest-1`; run real session.
4. **M3b — AI broker + dual-card (3-4 weeks)**: P2-6, P2-7, P2-8, P2-9, P2-12. Outcome: structured `{safe, dmOnly, sources}` returns from both providers, dual-card render, audit chain, scope reset, coord-only enforcement.
5. **M4 — Living-document MVP (5-7 weeks)**: P3-1 through P3-6. P3-3 alone is ~3 weeks; the rest plumbs around it. NPC-update category only; other 4 categories deferred.
6. **M5 — Authoring (3-4 weeks)**: P4-2 through P4-7 (P4-1 WorkingCopy already in M1).
7. **M6 — Maps MVP (2 weeks)**: P5-1 through P5-5.

**Honest estimates** (revised from v0.1's overconfident 14-19 weeks):

- **v1 (M1+M2+M3a)**: **8-11 weeks** (~2-3 months).
- **v1.1 (M3b+M4)**: **8-11 weeks** beyond v1.
- **v1.2 (M5+M6)**: **5-6 weeks** beyond v1.1.
- **Total to feature-parity with the design spec**: **20-27 weeks** (5-7 months).
- Add ~2.5 weeks across the whole project for **review-gate overhead** (multi-agent reviews + remediation), not previously budgeted.

The original "14-19 weeks v1" framing was wrong because (a) v1 was overscoped to include the riskiest AI broker + living-doc work, and (b) gate overhead was unaccounted. The split puts the high-uncertainty work in v1.1, keeping the v1 release date defensible.

## Test strategy notes

### General

- Existing unit tests (`src/*.test.ts`) target the current `quire-app.ts` shape. They should mostly survive the region-extraction in P0-3 because events still bubble to the root. Update test setups module-by-module as regions extract.
- E2E suite (`e2e/*.spec.ts`) is route-driven and should survive the shell refactor as long as URLs and visible affordances retain their names. Where Stage tabs replace direct routes, add `openSceneTab(ctx, tab)` helpers.
- New event kinds get standard materializer tests (`state.test.ts`) and hostile-input tests (`state.hostile.test.ts` — DoS cap, payload validation, authority bypass attempts).
- AI broker work needs new mocks of structured tool returns; existing `ai/anthropic.test.ts` and `ai/gemini.test.ts` patterns extend.

### New required test coverage

- **E2E dual-card AI safety** (`e2e/ai-content-safety.spec.ts`): mock AiBroker returns `{safe: 'X', dmOnly: 'Y'}`; player view contains only `X`; DM view contains both; `Y` does not appear anywhere in the player's DOM (not even with `display: none`). Plus the malicious variant: AI returns `{safe: 'X<dm-only>Y</dm-only>', dmOnly: ''}` — verify the player view shows the smuggled marker as literal text after sanitize, never executes it.
- **E2E per-paragraph reveal** (`e2e/per-paragraph-reveal.spec.ts`): DM reveals block-hash for paragraph 3; player's Stage DOM contains paragraphs 1-3 only; paragraph 4's source text is NOT present in the player's DOM. Render-side hiding via CSS is forbidden — the renderer must omit hidden blocks from the player-pipeline entirely.
- **`<!--UC_CLOSE-->` sentinel validation** (`campaign-loader.hostile.test.ts`): literal sentinel in body, frontmatter values, YAML keys, code fences, HTML comments. Each case rejects the campaign at load time.
- **`contextRefs` path validation** (`ai/context.hostile.test.ts`): absolute paths, `../etc/passwd`-style, `dm/*` paths with `scope: 'public'`, paths to nonexistent files. Each rejected by the validator before reaching the provider.
- **Player save export filtering** (`persistence.hostile.test.ts`): a session with `scratch-note`, `ai-prompt`, `ai-response`, `npc-pin`, `thread-debt-set` events exported with `scope: 'player'` contains none of those event kinds; the resulting save loads with `applySaveToLog`; the materialized player state contains no DM-only fields.
- **Living-doc hostile proposals** (`living/proposals.hostile.test.ts`): proposals citing non-existent files; proposals with `baseSha` mismatch; proposals with `before` text not matching current file state (out-of-band edit); proposals containing literal `<untrusted_content>` strings. Each rejected by `DiffProposal` validation.
- **Bundle-size regression**: P0-7 establishes the CI gate. The gate alone is the test.
- **Block-hash stability** (`markdown.test.ts`): the same source block text produces the same hash across runs; a trailing-whitespace-only diff produces the same hash; an actual text edit produces a different hash.
- **AI coordinator-only enforcement** (`ai/broker.test.ts`): a peer in `coordHolders` but NOT current coordinator cannot call `complete()`; the broker rejects.
- **AI scope reset per prompt** (`ai/broker.test.ts`): submitting a prompt with `scope: 'dm'` leaves the next call defaulted to `scope: 'public'`.

## Cross-references

- Design spec: [`../../design/ui.md`](../../design/ui.md)
- Architecture overview: [`../../design/architecture.md`](../../design/architecture.md)
- Authoring conventions: [`../../design/authoring.md`](../../design/authoring.md)
- Rules: [`../../design/rules-reference.md`](../../design/rules-reference.md)
- Schemas: [`../../design/schemas.md`](../../design/schemas.md)
- Security: [`../../design/security.md`](../../design/security.md)
- CLI lint TODOs: [`../../cli/TODO.md`](../../cli/TODO.md)

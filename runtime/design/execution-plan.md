# Runtime redesign — execution plan

Status: execution plan v0.2 (2026-05-21, revised after multi-agent adversarial review). Operational companion to [`redesign-plan.md`](redesign-plan.md) (the engineering task list) and [`../../design/ui.md`](../../design/ui.md) (the design spec).

**v0.2 changes from v0.1** (driven by PM, engineering, and adversarial critique):
- M3 split into M3a (cockpit, non-AI) and M3b (AI broker + dual-card).
- v1 redefined as **M1 + M2 + M3a** (~9-12 weeks). M3b + M4 land as v1.1.
- Reviewer rosters trimmed to ≤5 per gate; A11y dropped as a gate (separate H-7 audit milestone).
- Arbiter agent removed; user breaks ties directly.
- Time estimates revised honestly to 18-24 weeks for full feature set.
- M1 acceptance includes explicit extraction tasks for session-bootstrap, autosave-controller, ai-key-store, and WorkingCopy.
- Severity-floor and user-override paths added to the review-gate process.
- STATUS.md / REVIEW_HISTORY.md introduced for cross-milestone continuity.
- Feature flags + security-hotfix off-ramp added.

## How to read this doc

For each milestone:
- **Goal** — one sentence stating what the milestone proves.
- **Includes** — task IDs from [`redesign-plan.md`](redesign-plan.md).
- **Acceptance criteria** — testable checklist. Every item must pass before the gate.
- **Review gate** — which expert agents must independently review.
- **Adjustment authority** — what reviewers may change without explicit user re-approval.

Work within a milestone is normal commit-by-commit. Review happens at the gate. TDD per the user's memory: write the failing test first, make it pass, refactor.

## Roster of review agents

These are personas spawned at milestone gates — fresh agents with no prior conversation context. Each gets read access to the codebase and the docs. **Each is told to find problems, not validate.**

| Agent | Lens | Spawned at |
|---|---|---|
| **TTRPG-craft** | Player + DM ergonomics, scene flow, mechanics in background | M2, M3a, M3b, M4 |
| **Web-UX** | Layout, density, glanceability, reactivity, visual hierarchy | M2, M5 |
| **Engine** | Code structure, types, event-log invariants, persistence, lazy-chunking | M1, M3a, M3b, M4, M5, M6 |
| **Security** | AI safety, content gating, untrusted-content, save-export filters, hostile inputs | M1, M3a, M3b, M4, M6 |
| **Performance** | Bundle size, paint/reflow cost, render-pipeline efficiency | M1, M3b |
| **Adversarial critic** | Generalist red-team — finds gaps the specialists missed | every gate |

**Accessibility** is NOT a per-milestone gate. WCAG-AA contrast, keyboard nav, ARIA on live regions, and focus management are tracked via cross-cutting task **H-7** in `redesign-plan.md` and audited once after M3a lands (when the most interactive surfaces exist) and again after M5. This avoids redundant findings across multiple gates and frees the per-milestone reviews for milestone-specific risks.

## Review-gate process

At each gate:

1. **Self-check.** Implementor runs the milestone's acceptance criteria locally. If any item fails, do not open the gate. Update `STATUS.md` with current state.
2. **Parallel review.** Spawn the required reviewers in parallel (one tool call, multiple Agent invocations). Each receives:
   - The milestone briefing (goal + acceptance criteria + relevant code paths)
   - `STATUS.md` (current state of this milestone)
   - The relevant lens's `REVIEW_HISTORY.md` (so they don't re-flag resolved findings)
   - Authority to read any file
   - The required output schema
3. **Each reviewer returns:**
   ```
   verdict: 'ship' | 'ship-with-followups' | 'block'
   findings: [{severity: 'high'|'medium'|'low', area, summary, evidence, recommendation}]
   plan-adjustments: [{file, change, rationale}]
   ```
4. **Severity floor.** A `high`-severity finding from **Security** or **Engine** forces `block` regardless of other reviewers' verdicts. This prevents an over-cautious reviewer from blocking on cosmetics AND prevents an over-eager reviewer from waving through a security gap. Other reviewers' `block` verdicts are advisory but require user acknowledgement before override.
5. **Synthesis.**
   - All reviewers `ship` → gate closed.
   - Any `block` triggered by severity floor → fix, re-run the affected reviewers only.
   - User-override of a non-forced `block` → log to `redesign-plan.md`'s residual-risk section with rationale.
   - `ship-with-followups` from multiple reviewers in overlapping areas → followups land in the NEXT milestone or in P-deferred.
6. **Plan adjustments.**
   - **Unilateral (no user ack needed)**: reviewers may add follow-up P-tasks, flag risks, rewrite acceptance criteria for FUTURE milestones, propose new hostile-test cases.
   - **Requires user ack before applying**: renaming any event kind, changing the region grid, dropping a hostile-test family, changing a bundle budget, descoping a milestone.
   - Applied adjustments are direct edits to `redesign-plan.md` annotated `Plan adjusted at M<n> gate: <one-line rationale>`.
7. **Reviewer disagreement on same area** → surface both findings verbatim to the user with a one-sentence summary; user decides; user edits the plan. No arbiter agent.
8. **Reviewer failure** (malformed structured output, citation of nonexistent files): re-spawn once with a sharper briefing. After two failures, user is notified and gate proceeds without that reviewer's verdict — log in `REVIEW_HISTORY.md`.

When the gate closes, tag the commit `milestone-M<n>` and update `STATUS.md` to the next milestone's "in flight."

### Finding-granular acceptance

Findings within a reviewer's report are accepted individually. The implementor's response to each finding is one of:

- `acked` — applied immediately as a code change.
- `wontfix: <reason>` — explicit refusal with a one-line rationale logged in `REVIEW_HISTORY.md`.
- `deferred: <task-id>` — promoted to a P-task in `redesign-plan.md`.

This avoids the "rescind the whole adjustment" backstop the v0.1 plan relied on, which proved brittle under finding load.

## Cross-cutting expectations

Apply to ALL milestones; reviewers will check these.

- **TDD.** Every new module ships with tests written first. Materializers get standard tests + hostile-input tests (DoS caps, payload validation, authority bypass).
- **Tests stay green at every commit** — with these explicit allowances:
  - `test.fixme(...)` is allowed when a test is broken by a deliberate migration step; each `fixme` carries a comment with an issue ID and the milestone it must be re-enabled by.
  - Tests testing implementation details of decomposed code may be deleted, **provided** the invariant they protect is covered by an integration or e2e test. Deletion requires a one-line commit-message justification.
- **Bundle-size CI gate** active from M1: main chunk ≤ 110 KB gzipped; authoring lazy chunk ≤ 150 KB; lazy-chunk shared-deps with main monitored via `vite build --report`.
- **Feature flags for milestone-cumulative builds.** Each milestone's new user-facing affordances live behind a `?features=<comma-separated>` URL flag defaulting OFF until the milestone enters its ship phase. This allows the developer (or a brave playtester) to pull `main` between milestones without encountering half-built features. The flag spec is documented in `redesign-plan.md`.
- **STATUS.md** at `runtime/design/STATUS.md`. A one-paragraph file the implementor updates per significant commit (or end-of-day) noting: current milestone, current acceptance-criteria checklist state, blockers, next planned commit. Survives context resets; reviewers read it as input.
- **REVIEW_HISTORY.md** per lens at `runtime/design/review-history/<lens>.md`. Each file is a running record of `(finding → resolution)` tuples produced by prior gates of that lens. Reviewers MUST be briefed with the relevant lens history. This prevents recurring same-finding-each-gate noise.
- **No `--no-verify`** on commits. Pre-commit hooks must pass.
- **No Co-Authored-By trailer.** Per memory.
- **No regression of round-1/2/3 fixes** (R3-A, R3-B, R3-C). Existing tests prove these.
- **Round-trip e2e per milestone.** Every milestone ships at least one Playwright e2e exercising the new feature end-to-end with real broker + real WebRTC.
- **Security-hotfix off-ramp.** A commit tagged `security:` in its message skips the gate process. Tag as `security-hotfix-M<n>-N` rather than waiting for the next milestone. The user is notified and the affected security lens is run on the hotfix commit only.

## Facade migration pattern (M1 + M2 + M3a)

The god-object decomposition cannot survive a naive "extract one region per commit" approach because Lit's shadow-DOM CSS isolation and the existing private-method handler topology will break tests mid-extraction. The disciplined pattern:

1. **Commit 1: extract CSS** to `src/ui/styles/tokens.css` + per-region `static styles` strings, **still inside `quire-app.ts`**. Tests untouched.
2. **Commit 2: shell wrappers as slots.** Introduce `<quire-shell>` + region elements as Lit wrappers that `<slot>` the existing `renderXxx` output. The shell does no rendering of its own; `quire-app.render()` is unchanged. Tests untouched.
3. **Commits 3-N: one region per commit.** For each region, **keep the handler method on `QuireApp`** exported via `@lit/context` (or as a property callback). The region's template lives in the new component; the region dispatches `CustomEvent`s that `QuireApp` listens for and routes to the original method. Public methods on `QuireApp` are untouched, so `quire-app.*.test.ts` continue to work.
4. **M2/M3a phase: handler migration.** Refactor each region's internals to own its state. This is where tests need updates.

**E2E harness shim.** ~11 e2e files (`multi-session.spec.ts`, `full-session.spec.ts`, `sync.spec.ts`, `soak.spec.ts`, etc.) use `document.querySelector('quire-app')` and cast to internal-method types. M1 preserves `quire-app` as a thin facade exposing the same hook surface; the hook interface is captured as `QuireAppHooks` in `src/types/hooks.ts` and is stable through M3a. After M3a, hooks may migrate per region.

This pattern is added to the user's `feedback_tdd_and_critic_workflow` memory as project-specific guidance.

---

## M1 — Foundation: god-object decomposition

**Goal:** `src/quire-app.ts` is no longer a 3792-LOC god-object. A grid shell with five named region slots is in place. Event vocabulary is locked. WorkingCopy primitive exists. Existing functionality is unchanged from a user perspective.

**Includes (from `redesign-plan.md`):** P0-1, P0-2, P0-3, P0-4, P0-5, P0-6, P0-7, **P0-8 (NEW: `session-bootstrap.ts` extraction)**, **P0-9 (NEW: `autosave-controller.ts` extraction)**, **P0-10 (NEW: `ai-key-store.ts` extraction)**, **P4-1 promoted (WorkingCopy IndexedDB store)**, H-2, H-3, H-4.

**Acceptance criteria:**

- [ ] `src/quire-app.ts` is ≤ **1200 LOC** (revised from v0.1's 800 — see facade-migration pattern). The remaining content is shell composition, mode routing, AI key plumbing dispatch, autosave dispatch, region event routing.
- [ ] `src/controllers/session-bootstrap.ts` extracted — encapsulates campaign loading, session lifecycle (host/join/leave), R3-A pre-session route gating, R3-C campaign discovery.
- [ ] `src/controllers/autosave-controller.ts` extracted — debounced autosave with quota warning.
- [ ] `src/controllers/ai-key-store.ts` extracted — provider selection, key management, legacy migration.
- [ ] `src/sync/working-copy.ts` exists with IndexedDB dirty-files store. Read/write/list/revert/commit API. Lazy-init OK (first call to `WorkingCopy.get()` opens the connection).
- [ ] `src/ui/shell/` contains `<quire-shell>`, `<quire-topbar>`, `<quire-rail>`, `<quire-stage>`, `<quire-aside>`, `<quire-dock>` as Lit elements with stable prop interfaces.
- [ ] `src/ui/styles/tokens.css` with the oklch palette + clamp typography from `ui.md`. Consumed via CSS variables, not duplicated.
- [ ] `src/ui/modes/mode-state.ts` defines `AppMode` and URL routing. Default `in-session`.
- [ ] `src/core/state.ts` lists all 17 new event kinds in `KNOWN_EVENT_KINDS`. Each new payload schema carries `v: 1`. Materializers reject unknown payload versions with the H-4 banner. Materializers for the new kinds are NOT required at M1.
- [ ] `filterForViewer(state, viewerPeerId)` exists with unit tests covering all DM-only fields. (`serializeSessionForViewer` moves to M3a where first DM-only event lands.)
- [ ] H-4 unknown-kind banner: `applySaveToLog` reports unknown kinds; `quire-app` surfaces a one-line banner. Plus version-gating at peer-join: if remote peer's `KNOWN_EVENT_KINDS` set is older than M2, refuse the join with a clear "your DM is running a newer Quire — please update" error.
- [ ] **CI bundle-size gate active.** Verified by `bundle-gate.test.ts` (regression-protected, not just a one-shot throwaway-branch test).
- [ ] **Bundle ≤ 72 KB gzipped** at M1 (revised from v0.1's 75 KB; +5-7 KB delta for new Lit elements is realistic, not "bytes-neutral").
- [ ] **All existing tests still pass.** `QuireAppHooks` interface in `src/types/hooks.ts` keeps e2e harness shim working through M3a.
- [ ] `STATUS.md` created and updated through M1; closes with M1 final state.
- [ ] `runtime/design/review-history/` directory created.
- [ ] `quire/design/architecture.md` UI shape section reflects redesign (already done in commit `2c786c7`; verify no drift).

**Review gate — M1:**
- **Engine** (mandatory)
- **Security** (mandatory)
- **Performance** (mandatory)
- **Adversarial critic** (mandatory)

Four reviewers. No TTRPG-craft or Web-UX at M1 — no user-facing changes to evaluate. Accessibility tracked in H-7, not gated here.

**Adjustment authority at M1:**
- Reviewers may reshape region component interfaces, the `QuireAppHooks` shape, the controller boundaries.
- Reviewers may NOT change the five-region grid choice (design decision, not engineering).
- Reviewers may NOT change M1's LOC cap or bundle cap unilaterally (requires user ack).

---

## M2 — Player view region-extracted

**Goal:** a player can complete a full session using the new region components. No DM-only affordances yet. Scene rendering still uses whole-scene `renderMarkdown` (per-paragraph reveal lands in M3a).

**Includes:** P1-1, P1-2, P1-3, P1-4, P1-6, P1-7.

**Acceptance criteria:**

- [ ] `<player-rail>` renders the condensed sheet (name, pronouns, alignment, 6 stats in 2-col, harm 4-box, stress 4-box, top skills as chips, foci summary). Tap own portrait → Rail grows to `clamp(420px, 44ch, 480px)`; Stage absorbs the delta. No modal, no overlay.
- [ ] `<scene-stage>` renders Markdown via existing `renderMarkdown` with the scene-strip header (name·location·mood·duration·presentNpcs). 68ch centered. Scene-strip is sticky.
- [ ] `<player-aside>` renders roster + collapsible chat + private notes (local-only, never replicated).
- [ ] `<dice-dock>` renders 6 stat chips + modifier stepper + roll button + last 3 pills. Keyboard `R`/`1-6`/`+-`/`Enter`. Doubles trigger colored halo.
- [ ] `raise-hand` / `lower-hand` events propagate ✋ glyph to all peers' rosters.
- [ ] All existing player-side e2e tests pass against new components. Helper updates allowed where harness shim changes — documented in commits.
- [ ] One new e2e: player joins host, sees condensed sheet, taps stat chip to pre-fill dice, rolls, result broadcasts.
- [ ] Bundle ≤ 85 KB gzipped.
- [ ] `STATUS.md` updated through milestone.

**Review gate — M2:**
- **TTRPG-craft** (mandatory)
- **Web-UX** (mandatory)
- **Adversarial critic** (mandatory)

Three reviewers. Engine + Security not at M2 because no event-vocab or persistence changes — those moved into M1 (vocab) or M3a (filter). Performance covered by CI gate.

**Adjustment authority at M2:**
- Reviewers may reshape the dice popover, add player-side keyboard shortcuts, propose Rail expansion ergonomics changes.
- Reviewers may NOT add DM-only affordances (M3a).

---

## M3a — DM cockpit (no AI)

**Goal:** the DM can run a session with the cockpit affordances — scene navigator, per-paragraph reveal, scratch column, NPC pinning, thread-debt ladder, caution rail, broadcast button. **Text-only AI continues to work via the existing `callAnthropic`/`callGemini` path; structured AI returns + dual-card land in M3b.**

This is the **v1 ship boundary**. M1+M2+M3a = v1.

**Includes:** P1-5, P2-1, P2-2, P2-3 (incl. event-stripping for player save export — `serializeSessionForViewer`), P2-4, P2-5, P2-10, P2-11.

**Acceptance criteria:**

- [ ] `<dm-rail>` renders scene navigator (top ~60%) + active-PC focus card with thread-debt ladder inline (bottom ~40%). Clicking a player in Aside roster surfaces their sheet here.
- [ ] `src/markdown/block-hashes.ts` exposes `getBlockHashes(scenePath, source): Promise<string[]>` with WeakMap cache. **Async one-time compute via SubtleCrypto sha256; 16 hex chars** (64 bits — collision probability 1-in-130 billion at 256 hashes/scene × 1000 scenes). Cached results fed synchronously to `renderMarkdownParagraphs`.
- [ ] `renderMarkdownParagraphs` (in `src/markdown.ts`) splits source into blocks. Tests cover CommonMark edge cases: `<!-- comment -->` alone, inline comments, list items, blockquotes, code fences, tables. Block-hash stability tested: same source → same hash; whitespace-only diff → same hash; text edit → different hash.
- [ ] `<scene-stage>` for DM renders gutter pip column. `J`/`K` walks paragraphs; `Space` toggles pip. `scene-reveal-paragraph` events propagate.
- [ ] **Player Stage never emits hidden blocks to the DOM.** Verified by e2e: `expect(playerInnerText).not.toContain(hiddenParagraphText)` even with devtools open.
- [ ] Lapsed pips: when a `scene-reveal-paragraph` event references a `blockHash` no longer matching any current block, the DM's gutter renders a faint "lapsed" pip. Behavior documented in DM docs.
- [ ] `serializeSessionForViewer` in `src/persistence.ts`. Hostile tests prove player-scope export strips `scratch-note`, `ai-prompt`, `ai-response`, `npc-pin`, `thread-debt-set` events.
- [ ] `<dm-dock>` adds scratch input (`'` hotkey), Reveal button (Cmd-Enter), Broadcast button (`B`). `broadcast-view` event navigates players within ≤500ms.
- [ ] Caution rail: path-based detection of `dm/` and `design/DM-ONLY/`; 4 px amber left border + sticky `[!CAUTION]` banner.
- [ ] `<dm-aside>` roster-dominant: roster (largest), pinned NPCs (`npc-pin`/`npc-unpin`), stakes/pacing collapsed strip. AI uses the existing text-only prompt UI (no structured returns yet).
- [ ] Thread-debt ladder inline in active-PC card. `thread-debt-set` event; player-side filter strips it.
- [ ] Hostile tests: per-paragraph player-DOM check, player save export filter, payload-version rejection for unknown `v`.
- [ ] Bundle ≤ 95 KB gzipped.
- [ ] One new e2e: DM hosts, reveals scene 1 paragraph-by-paragraph, pins NPC, sets thread debt, broadcasts to player; player sees only revealed paragraphs and never has DM-only content in their DOM.
- [ ] **Playtest checkpoint.** Tag `playtest-1`. Run a real session with a willing DM. Capture notes; feed into M3b's TTRPG-craft briefing.

**Review gate — M3a:**
- **TTRPG-craft** (mandatory)
- **Engine** (mandatory)
- **Security** (mandatory)
- **Adversarial critic** (mandatory)

Four reviewers. Web-UX merged into TTRPG-craft (both lenses cover the cockpit; one persona is enough). Performance via CI gate. Accessibility queued for H-7 audit after M3a.

**Adjustment authority at M3a:**
- Reviewers may rename event kinds (with user ack), reshape gutter pip ergonomics, propose thread-debt ladder placement changes if gameplay testing reveals invisibility.
- Reviewers may NOT add AI-broker affordances (M3b).
- Reviewers may propose **shipping v1 immediately at M3a close** if the playtest is strongly positive and M3b/M4 risk profile is judged too high.

---

## M3b — AI broker + dual-card (v1.1 part 1)

**Goal:** AI assistance moves to structured `{safe, dmOnly, sources}` returns from both providers, with the dual-card visual treatment, audit chain, scope-toggle reset, and coord-only enforcement.

**Includes:** P2-6, P2-7, P2-8, P2-9, P2-12, plus the AI-related caps and hostile tests.

**Acceptance criteria:**

- [ ] `AiBroker` class in `src/ai/broker.ts`. Both Anthropic and Gemini providers return structured `{safe, dmOnly, sources}`.
- [ ] **Anthropic provider** uses tool use with forced `tool_choice`. Broker iterates `content[]` and picks the first `tool_use` block (Claude may emit a leading `text` block). Test case: response with `[{type:'text'}, {type:'tool_use'}]` produces structured result, not synthetic fallback.
- [ ] **Gemini provider** uses `responseSchema` with `responseMimeType: 'application/json'`. `DiffProposal` (M4) discriminator union worked around via a single object with all optional fields, validated client-side. Documented limitation.
- [ ] **Parse-failure retry strategy differs by call site**: `complete()` returns degraded `{safe:'', dmOnly:'(parse error)', sources:[]}` immediately (latency-sensitive — DM is waiting). `proposeChanges()` (lands in M4) retries up to 2× with clarification prompt, then degrades. Tests at the `fetch` mock layer cover malformed JSON, wrong shape, mixed text/tool_use blocks.
- [ ] **Runtime fallback**: if provider returns text-only response despite forced tool choice, broker attempts a second-pass regex extraction for `safe:` / `dmOnly:` blocks before synthesizing parse-error.
- [ ] AI response renderer: **only non-empty cards render**. Safe card no rail; DM-only card has 4 px amber rail + `[DM-ONLY]` badge + lock glyph + warm-tinted background + "Copy (do not read aloud)" button + source chips. Provenance footer below.
- [ ] **`contextRefs` path validation** (security-critical): campaign-relative only, no `..`, no absolute. When `scope === 'public'`, `dm/*` and `design/DM-ONLY/` paths rejected. Hostile tests in `ai/context.hostile.test.ts`.
- [ ] **Scope-toggle resets to `public` after every prompt submit.** Test: submit with `scope: 'dm'`; next default is `public`.
- [ ] **AI calls coord-only.** Broker rejects non-current-coordinator. Test: peer in `coordHolders` historically but not currently coordinator gets rejected.
- [ ] AI audit chain: `ai-prompt`/`ai-response`/`ai-accept`/`ai-reject` events carry hashes; full text in IndexedDB. After coord handoff, new coordinator picks up chain head from `aiAudit`.
- [ ] Token budget meter in Topbar. Hard-stop at ceiling disables AI input.
- [ ] Hostile tests: UC_CLOSE sentinel rejected at campaign load; dual-card smuggling (`<dm-only>` in safe text renders as literal); contextRefs path traversal; coord-only enforcement; scope-reset.
- [ ] Bundle ≤ 100 KB gzipped.
- [ ] One new e2e: DM sends AI prompt with `scope: 'public'`, sees dual-card render with safe content only, provenance footer notes "AI considered: scenes/01.md."

**Review gate — M3b:**
- **TTRPG-craft** (mandatory)
- **Engine** (mandatory)
- **Security** (mandatory)
- **Performance** (mandatory — structured-tool roundtrip latency matters)
- **Adversarial critic** (mandatory)

Five reviewers. AI is the most-uncertain surface in the project; this is the one gate where five lenses are warranted.

**Adjustment authority at M3b:**
- Reviewers may reshape broker internals, retry strategy specifics, dual-card visual details.
- Reviewers may NOT change scope-reset behavior or coord-only enforcement (security properties).

---

## M4 — Living-document MVP (v1.1 part 2)

**Goal:** the DM can wrap a session and walk an AI-proposed per-NPC diff against the campaign repo. NPC-update category is end-to-end; other four categories follow in v1.2.

**Includes:** P3-1, P3-2, P3-3, P3-4 (lazy chunk), P3-5 (uses M1's WorkingCopy).

**Acceptance criteria:**

- [ ] Post-session mode landing: Stage → diff-review; Dock → one-line status; Rail → session event timeline; Aside → DM summary as sticky reference.
- [ ] DM writes session summary in textarea; local until commit.
- [ ] `src/living/session-digest.ts` builds prompt-bounded digest from events + scratch notes + summary + relevant campaign files.
- [ ] `AiBroker.proposeChanges(digest)` returns structured `DiffProposal[]` with NPC-update category. Uses M3b's `complete()` infrastructure plus retry-2× before degrade.
- [ ] Each proposal renders as card: current (left) / proposed (right) / source chip footer / `✓`/`✗`/`✎` controls. Accepted → single-line confirmation. Rejected → greyed with undo.
- [ ] `baseSha` validation; proposals on moved files rejected with refresh affordance.
- [ ] Per-category commit: "Commit N accepted NPC updates" → one git commit in WorkingCopy.
- [ ] Manual export (P4-2 minimal) downloads tarball of dirty files.
- [ ] Hostile tests: nonexistent file refs, baseSha mismatch, before-text mismatch, embedded `<untrusted_content>` strings.
- [ ] Diff chunk lazy-loaded (verified: not in in-session bundle).
- [ ] One new e2e: full session with 3 NPC interactions → Wrap Session → mocked AI proposes 3 changes → accept 2 / reject 1 → single commit lands.

**Review gate — M4:**
- **TTRPG-craft** (mandatory)
- **Engine** (mandatory)
- **Security** (mandatory)
- **Adversarial critic** (mandatory)

Four reviewers. Same set as M3a — no Web-UX (TTRPG-craft covers the diff workflow ergonomics); Performance via CI gate.

**Adjustment authority at M4:**
- Reviewers may revise `DiffProposal` schema, propose category consolidation.
- Reviewers may **propose deferring living-doc entirely to v1.2** if M4 reveals AI proposal quality is insufficient. The fallback is acceptable; v1 was already shipped at M3a.

---

## M5 — Authoring mode (v1.2 part 1)

**Goal:** the DM can author or edit campaign content in-browser; in-session bundle does not pay this cost.

**Includes:** P4-2, P4-3, P4-4, P4-5, P4-6, P4-7. (P4-1 WorkingCopy already landed in M1.)

**Acceptance criteria:**

- [ ] Authoring mode entry triggers dynamic import of CodeMirror 6 + frontmatter form + lint panel + file tree.
- [ ] Stage = split editor (left) + preview (right), 50/50, drag-resizable.
- [ ] Rail = campaign file tree with dirty-state dots.
- [ ] Aside = schema-driven frontmatter form (typed inputs from `schema/v0/*.schema.json`); bidirectional with editor YAML.
- [ ] AJV lint panel below form; inline error markers.
- [ ] Preview toggles "player view" / "DM view."
- [ ] Scaffolding: New Episode / New Scene / New Campaign each scaffold from `runtime/public/templates/`.
- [ ] `Cmd-S` writes to WorkingCopy; status bar shows dirty/clean + last commit time.
- [ ] Manual export tarball works for full dirty set.
- [ ] Authoring lazy chunk ≤ 150 KB gzipped (CI gate).
- [ ] In-session bundle unchanged from M3b.
- [ ] Authoring-mode cold-start TTI ≤ 1.5s on 13" laptop (measured).
- [ ] **Lazy-chunk shared-deps test**: `vite build --report` output asserts authoring chunk does NOT share with main beyond whitelist (`lit-html`, `tslib`).
- [ ] One new e2e: open authoring, create scene, fill frontmatter via form, save, export tarball, verify content.

**Review gate — M5:**
- **Web-UX** (mandatory)
- **Engine** (mandatory)
- **Adversarial critic** (mandatory)

Three reviewers. No TTRPG-craft (authoring is a non-play workflow); no Security (no new content-safety surface); Performance via CI gate. Accessibility tracked in H-7 second pass after M5.

**Adjustment authority at M5:**
- Reviewers may swap CodeMirror 6 for smaller editor IF bundle gate fails persistently.
- Reviewers may defer New Campaign scaffolding to v1.3.

---

## M6 — Maps MVP (v1.2 part 2)

**Goal:** static image + draggable named blobs + hide/reveal to players.

**Includes:** P5-1, P5-2, P5-3, P5-4, P5-5.

**Acceptance criteria:**

- [ ] `fetchCampaignBinary()` accepts `image/png`/`image/jpeg`/`image/webp` only; rejects `image/svg+xml` and all others.
- [ ] `episode-loader.ts` exposes `map:` frontmatter field.
- [ ] When scene has `map:`, Map tab appears in Stage tab strip.
- [ ] `<quire-map>` renders via `<img src=blob:...>` ONLY. Never `<object>`/`<iframe>`/inline `<svg>`/`background-image`.
- [ ] SVG overlay is sibling `<svg>`, not loaded asset.
- [ ] DM ops: add (click empty), move (drag), remove (delete on focused), reveal/unreveal (button on blob).
- [ ] Players see only revealed blobs.
- [ ] Hostile tests: SVG masquerading as PNG (server-side MIME) renders safely; non-image MIME rejected.
- [ ] Map renderer lazy-loaded; not in in-session bundle until scene with `map:` opens.
- [ ] One new e2e: DM hosts at scene with `map:`, drops 3 blobs, reveals 2, player joins and sees 2.

**Review gate — M6:**
- **Engine** (mandatory)
- **Security** (mandatory)
- **Adversarial critic** (mandatory)

Three reviewers. Web-UX optional (spawn if blob ergonomics need tuning). No TTRPG-craft (Map is a tool, not a gameplay system).

**Adjustment authority at M6:**
- Reviewers may add `point-at` event kind if blob-only insufficient.
- Reviewers may defer Map to v1.3 if sanitizer audit reveals deeper work needed.

---

## v1 ship boundary

**v1 = M1 + M2 + M3a.** Approximately 9-12 weeks. Delivers:
- Five-region cockpit with reactive layout.
- Per-paragraph reveal (the highest-leverage DM affordance).
- DM scratch column, NPC pinning, thread-debt ladder, caution rail, broadcast button.
- Player save-export with DM-only events stripped.
- Existing text-only AI continues to work (Anthropic/Gemini via `callXxx`).

**v1.1 = M3b + M4.** Approximately 6-8 weeks after v1.
- Structured `{safe, dmOnly, sources}` AI returns + dual-card.
- Living-document post-session diff (NPC-update category).

**v1.2 = M5 + M6.** Approximately 5-7 weeks after v1.1.
- In-browser authoring with frontmatter form + lint.
- Static-image maps with named blobs.

**Honest total**: 20-27 weeks (5-7 months) from M1 start to full feature parity with the design spec. v1 lands in 2-3 months.

## Descope ladder (in order of preference)

If a milestone runs long, descope by:

1. **M6 (maps)** — DMs share images out-of-band.
2. **M5 (authoring)** — DMs edit in their editor of choice.
3. **M4 categories** — ship NPC-update only; defer rest.
4. **M4 entirely** — v1.1 ships M3b only.
5. **M3b** — v1.1 ships nothing AI-broker-related; M4 if it ships uses simple text-prompt path.

**Do NOT descope M1, M2, or M3a.** These are non-negotiable for any release.

## Mid-project absence recovery

If the developer is absent ≥ 2 weeks:
- On return, read `STATUS.md` first. It's the most recent snapshot.
- Re-spawn the current milestone's Engine reviewer with the current commit state and ask: "given the STATUS, what's the safest next commit?" This produces a thaw-out plan in 5 minutes.
- Do not attempt to re-read all prior gate transcripts. Trust the REVIEW_HISTORY.md summaries.

## Cross-references

- Design spec: [`../../design/ui.md`](../../design/ui.md)
- Engineering plan: [`redesign-plan.md`](redesign-plan.md)
- Architecture: [`../../design/architecture.md`](../../design/architecture.md)
- Security: [`../../design/security.md`](../../design/security.md)
- Memory: `feedback_plan_critique_iterate`, `feedback_tdd_and_critic_workflow`, `feedback_document_cross_project_todos`.

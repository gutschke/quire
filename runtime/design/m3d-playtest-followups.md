# M3d (and beyond) — first-play-test followups

**Status:** design input, not yet a sequenced plan.  Awaiting user scope decision.
**Source:** first real play-test 2026-05-22 (DM-only mode, Underleaf episode 1).
**Reviewers consulted:** TTRPG-craft expert (roll UI), UX expert (navigation, modes, seat model, stale-peer).

The play-test surfaced **seven concerns** that, taken together, point to a coherent next milestone scope.  Three of them (#1, #3, #5) share a navigation primitive; two (#2, #3) share a seat/slot primitive; one (#4) is pure cleanup.  Recommendation: M3d ships the navigation + seat primitives + the cleanup; M3e takes the roll-UI overhaul.  See "Suggested sequencing" at the end.

## The seven concerns

### 1. Broken intra-campaign markdown link (immediate fix landed)

**Symptom:** Scene 02 (The Threads) contains `[dm/stakes.md](../dm/stakes.md)`.  Clicking it navigated the browser away from the SPA → tore down the active session → bad-state cascade.

**Landed inline (commit pending):** `src/ui/regions/scene-stage.ts` now installs a delegated click handler on the markdown container that resolves `.md` hrefs relative to the current scene and routes through `navigateToRoute`.  Refuses upward-escape past episode root.  External `https://` / `mailto:` / anchor (`#section`) / non-md hrefs pass through untouched.  Six unit tests cover the resolution + interception behavior.

**Followup (NOT landed):** the fix lives in scene-stage only.  Any other surface that renders campaign markdown (character pages, NPC pages, future DM-only-file surfaces in M4) must apply the same interception.  Extract a shared helper as part of M3d's nav primitive (see #5).

### 2. Linter for broken intra-campaign links

**Symptom:** the `stakes.md` link wasn't really broken — the file exists on disk.  But the *runtime* couldn't navigate to it.  A separate class of bug is *actually-missing-file* links.

**Recommended scope:** add a `runtime/scripts/lint-campaign-links.mjs` (or similar) that:
- Walks `episodes/*/scenes/*.md`, `episodes/*/dm/*.md`, `characters/**/*.md`.
- Extracts every relative `.md` link in the bodies (after frontmatter).
- Resolves each link against the source file's directory.
- Reports any that don't resolve to a real file in the campaign tree.
- Runs at `npm run check` or pre-commit; fails CI on a miss.

Open question: does this run on the *runtime* repo, the *campaign* repo, or both?  The runtime CI doesn't have the underleaf repo checked out today.  Probably: ship the script in the runtime and have the underleaf repo run it via a thin wrapper.

### 3. Stale-DM-peer on rejoin (root cause documented; full fix in M3d)

**Symptom:** browser back-button (from a bad markdown link) tore down the session; rejoining showed two DMs.  DM manually evicted the old one.

**Root cause** (investigated 2026-05-22):
- `beforeunload` best-effort emits `peer-leave` but doesn't flush autosave; if the leave broadcast races the unload, the leftAt mark is lost.
- Autosave restore rehydrates the prior coord's `peer-join` + `coordinator-claim` *without* a matching `peer-leave`.
- The new tab is a *new* peer (new peerId), so the prior coord lingers visibly.

**Primary trigger eliminated** by #1's fix (no more accidental navigate-away from bad markdown).

**Followup fixes for M3d:**
- **Route-change-fires-leave:** in `navigateToRoute`, detect "campaign → home" transition and call the same path as `leaveSession`.  Cheapest 90% fix.
- **Stable peer identity:** new `peer-reclaim` event kind — "I'm peerId X, claiming the prior session role held by peerId Y."  Hard-gate via session secret or host approval.  Sibling of M3c's hard-gate pattern.
- **Heartbeat-driven reaping:** WebRTC data-channel ping → tri-state roster glyph (`live` / `quiet` / `gone`).  Don't auto-evict; surface a "Reap?" affordance.

### 4. Roll UI optimized for 2d6 + stat (M3e scope)

**TTRPG-expert confirmed:** ~95% of rolls in our rules are `2d6 + stat`.  d20/d% aren't in the rules at all.  Double-1 / double-6 wild outcomes are *defined on the d6 pair* — switching to other dice would lose them.

**Recommended target:** the existing `ui.md` L154-160 spec (six stat chips + modifier stepper + `+1 from tag` + big "Roll 2d6" + last-3 pills + doubles halo).  Land that as the Dock default.  Demote the current `/roll <expr>` to a collapsed "Other dice…" disclosure.

**Specifics worth locking before implementation:**
- Auto-pull stat modifier from bound PC's sheet — no DM typing.
- Auto-apply harm/stress penalty as a labelled stepper adjustment.
- Cast (Costly/Hard) macros surface ONLY when bound PC has `knowsTheyCanCast: true` (preserves the magic-realization authorial boundary).
- Last-3 pills are per-PC, not session-global.
- AI-emitted rolls carry an `(AI)` badge in the pills + disable click-to-reroll.
- AI-proposed rolls stay in the Aside ai-panel strip (M3c accept-gate); the Dock is for self-initiated rolls.

**Open playtest questions (do NOT decide pre-playtest):**
- Q-DICE-1: harm/stress auto-penalty default-on or default-off?
- Q-DICE-2: Hard-cast penalty default −1 or picker?
- Q-DICE-3: AI dice-roll — big-readout animate, or silent pill?
- Q-DICE-4: when DM has no bound PC, hide Roll-2d6 entirely?

### 5. PC1/PC2 script variable binding (M3d scope)

**Symptom:** scenes write `PC1`, `PC2`, … as placeholder names.  The user wants click-to-bind so the rendered script substitutes the assigned character's name.

**UX-expert recommendations:**
- **Author markup: `{{pc:N}}`** in scene source — bare `PC1` is too easy to false-positive.  One-time migration script for the existing campaign.
- **Binding scope: per-session, with a per-campaign default.**  Lives in shared session state as `pcSlots: Record<slot, PcId>`.
- **The renderer transforms at display time.** `data-pc-slot` on substituted spans.  Click the rendered name → popover with PC picker → emits `pc-slot-bind` event → all peers re-render.
- **AI integration:** AI sees scene prose pre-substitution but its *replies* use the bound names.  System prompt addendum to include the `pcSlots` mapping.
- **New M3c-style write tool:** `pc-slot-bind` as a sibling of `caster-state-set` and `pc-edit`.  AI can propose bindings; DM accepts.
- **Unbound fallback:** render the literal `{{pc:N}}` placeholder so paper prep still works.

### 6. Modes-of-play polymorphism (M3d scope for seats; M3e for whisper/print)

**Symptom:** the user was play-testing in DM-only-computer mode without a peer roster → no PCs visible.  This is a workflow break, not a missing feature.

**UX-expert recommendations:**
- **New `tableTopology` setting** orthogonal to existing `AppMode`: `{ distributed, dm-screen, hybrid, paper-only }`.  Persisted on the campaign; overridable per session.  A new `table-topology-set` event kind.
- **Decouple PC binding from peer binding.**  Today's `peer-rename` extends with `pcId`, assuming 1:1 peer↔PC.  In `dm-screen` mode there are zero peers; the DM picks "which PC files are at the table tonight" out of `characters/pcs/` into a new `tableSeats: PcId[]` shared field.
- **DM-side seat-strip:** a new `<seat-strip>` sibling of `<dm-aside>` renders one row per seat (portrait, name, harm/stress, top stress trigger, whisper affordance).  In `distributed` mode the same strip renders one row per peer.  Data shape converges; source differs.
- **DM whisper:** new event kind, DM-only-visible, scoped to `seatId`.  Materializes into a one-line callout in the DM's view only.  Never in player events (no leak vector).  AI can author whispers as a `whisper-suggest` stateUpdate.
- **Print stylesheet:** smallest lift to make character sheets + episode outlines + stakes menus printable.  CSS-only first pass; PDF generation later.  Make `@media print` rules first-class in `tokens.css.ts`.

### 7. Switching scenes/dm-docs as the dominant DM action (M3d scope)

**Symptom:** DM bounces between `scenes/0N-*.md`, `dm/coincidences.md`, `dm/stakes.md`, `dm/the-gate.md` constantly.  Today's Rail shows `scenes/*` only — `dm/*` files aren't in the navigable list.

**UX-expert recommendations:**
- **`dm/*` docs are first-class peers of scenes in `<dm-rail>`.** Expand the data model from `{ scenes: string[] }` to `{ scenes: string[]; dmDocs: string[] }`.  Auto-enumerate `dm/*.md` in `episode-loader.ts`.
- **Always-expand the active episode** (today scenes expand only when `isCurrent`).
- **Keyboard navigation:** `[`/`]` for prev/next item in the current episode (union of scenes + dm docs in declaration order).  Reserve `j`/`k` for paragraph-pip walk (current).
- **AI nav as part of M3d:** `navController.requestNav({ target: 'engineering section', confidence?: number })` — fuzzy match against current episode's scenes + dm docs + pinned NPCs + scene-frontmatter locations.  Confirmation chip when ambiguous.  Mirrors M3c's *propose → accept* pattern in the AI panel.
- **Recently-visited list:** small "Recent" group above the episode list — last 5 visited within the session.  Local-only state.

## Cross-cutting findings

**Three concerns want the same primitive — a `navController`.**  #1 (markdown-link interception is now in scene-stage but needs to live elsewhere too), #5 (PC slot rebinding needs the renderer to know about routes), #7 (Rail + Cmd-K + AI nav all funnel through one API).  **First commit of M3d should be an extraction of `navController`** from `quire-app.ts`'s current `navigate()` + `navigateToRoute()` (lines 668+, 861+).  That's the seam.

**Two concerns share the seat primitive.**  `pcSlots` (#5) and `tableSeats` (#6) are essentially the same data structure viewed two ways — scene-side substitution and seat-strip rendering.  Implement them as one underlying shared-state field; expose two render paths.

**`design/ui.md` is missing.**  Both experts reached for it; only `redesign-plan.md` exists today.  Reconstructing `ui.md` from this design doc + the existing region implementations should be part of M3d's first phase.

## Suggested sequencing

**M3d — navigation + seat + cleanup (estimated 4-6 work sessions):**
1. **navController extraction** + shared markdown-link interceptor.  Lifts #1's fix into a reusable surface.
2. **Stale-peer cleanup primitives** (route-change-fires-leave + heartbeat-driven roster glyph).  Closes #3.
3. **Campaign-link linter** (#2).  Small, independent, ship-anytime.
4. **`<dm-rail>` expansion + `[`/`]` hotkeys** (#7).  Adds dm/* enumeration to episode-loader, default-expand active episode.
5. **`tableSeats` shared field + `<seat-strip>` region** (#6 phase 1).  Unblocks DM-only mode play-testing.
6. **`pcSlots` + `{{pc:N}}` renderer + click-to-bind** (#5 phase 1).  Local-only state initially; event-backed in a follow-on.
7. **AI `requestNav` tool** wired into the broker (#7).

**M3e — roll UI + whisper + print (estimated 3-5 work sessions):**
1. **Dice-Dock spec from ui.md L154-160** (#4).  Stat chips + stepper + 2d6 button + pills + doubles halo.
2. **Whisper event kind** + DM whisper UI (#6 phase 2).
3. **Print stylesheet pass** (#6 phase 3).
4. **AI `whisper-suggest` + `pc-slot-bind` write tools** (#5 phase 2 + #6 phase 2).

**Pre-implementation gate (recommended):** run a 4-reviewer pass on this design doc before any code lands.  The convergent finding from both experts is that the navigation primitive is load-bearing — getting it wrong sets up problems for several milestones.

## Open questions for the user

Before sequencing or implementation:

1. **Confirm M3d/M3e split.**  Alternative: pull the roll UI forward to M3d if it bites in play-testing more than the seat work.
2. **Resurrect `design/ui.md`?**  Both experts hit the missing-file blocker.  Make it M3d's first artifact.
3. **`{{pc:N}}` migration:** ok to do a one-shot s/PC1/{{pc:1}}/ across the underleaf campaign?  Or do we want a per-author opt-in?
4. **Print artifacts:** acceptable to ship CSS-print first and defer PDF generation indefinitely?  Or is PDF a hard requirement for a future "publish campaign" workflow?
5. **AI nav tool authority:** should `requestNav` auto-execute on high-confidence matches with an undo toast (TTRPG/UX recommendation), or always show a confirmation chip?  This is the propose-vs-act trade we made deliberately in M3c.

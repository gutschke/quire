# Run #19 synthesis — UX must-haves design + decisions

This doc captures the parent-level synthesis of three parallel
expert reports for the four items in `ux-must-haves.md`. The lead
engineer implements per this doc; each numbered resolution below
is binding unless the lead surfaces a genuine engineering reason
to deviate (with a written justification + a DEC).

## Expert reports (read in full before implementing)

1. `review-history/ttrpg-ux-ux-must-haves-2026-05-30.md`
   — interaction shape for MH-1 / MH-2 / MH-3
2. `review-history/visual-splitter-pattern-2026-05-30.md`
   — splitter pattern for MH-4
3. `review-history/adversarial-ux-must-haves-2026-05-30.md`
   — firewall implications across all four items (GO-WITH-FIXES:
   **1×P0**, **4×P1**, 5×P2)

## Settled resolutions (parent decisions)

### R-A — UX-MH-1 event-kind shape

**Decision:** Introduce a NEW event kind `peer-rename-by-coord`
with payload `{ targetPeerId: string, newDisplayName: string }`,
coord-author-gated. Do NOT extend `peer-rename` (its semantic is
self-rename, materializer writes the author's own entry). Do NOT
extend `pc-edit` (player display name lives on the peer, not on
the PC — the human follows the human, the PC follows the seat).

**Why:** Adversarial P0. The lead's planning had assumed
`peer-rename` could be DM-authored on behalf of a player's seat;
that's INERT (R2.1 share-envelope defense + materializer writes
`state.peers[event.peerId]` = author, not target). A separate
event kind makes the coord-only authorization explicit at the
firewall + materializer layer.

**Materializer must:** check `event.meta.peerId === coordinator` AND
target's `peers[targetPeerId]` exists, then write
`state.peers[targetPeerId].displayName = newDisplayName`. Reject
silently otherwise (per civilized-peer threat model — log
warning, don't surface error UI).

**Firewall classification:** player-visible event kind (display
name is already player-visible via chat byline); no DM-only
sub-fields. Per-kind scrubber is a no-op; materializer is the
one above. Both must land in the same commit (DEC-030 pair).

### R-B — UX-MH-1 surface treatment

**Decision (per TTRPG/UX expert):**
- Chargen + chargen-dm-review + dm-pc-detail surfaces: **two-line
  stack** with PC name above, player name below in a smaller
  weight. Don't introduce a new helper — extend the rendering
  template directly.
- Stage-roster + dm-roster-strip: **compact dot form**
  `Sora · Alice` (U+00B7 dot) so play-loop reading isn't slowed.
- DO NOT touch the chat byline pattern (already shows the right
  player name).

**Edit affordance:**
- Player edits OWN display name via the existing topbar input
  (unchanged).
- DM edits ANY player's display name from chargen-dm-review's
  per-row tray (see R-D) by emitting `peer-rename-by-coord`.

### R-C — UX-MH-2 tag event-kind shape

**Decision:** Introduce TWO new sibling event kinds
`pc-tag-add` `{ pcId, tagText }` and `pc-tag-remove`
`{ pcId, tagText }`. Each MUST land with the full
firewall-classification quad (scrubber + materializer +
rebroadcast filter check + sync-response filter check) in the
SAME commit (P1 #1 from adversarial).

**Atomic rename:** TTRPG/UX expert flagged that inline tag
rename causes flicker if implemented as remove+add. Add a third
event `pc-tag-rename` `{ pcId, oldTagText, newTagText }` with
atomic materializer. Engineering prerequisite for MH-2's
chip-rename UX.

**Authorization:** any peer can author all three (matches existing
pc-edit trust gap — DEC-tracked tolerance). The DM-edit UI just
exposes the affordance already present at the protocol layer.

### R-D — UX-MH-2 interaction shape

**Decision (per TTRPG/UX expert):**
- **Per-row "Edit / Review" tray** in chargen-dm-review. NOT
  modals. Modals steal focus from the cross-row comparison the
  DM is actually doing.
- Tray contains: name input, pronouns input, tag-chip strip
  with `×` per chip + inline-rename click + add-tag input,
  full backstory textarea.
- **Autosave throughout. NO Save buttons.** Debounced 400ms
  (match existing chargen autosave cadence). Emit on debounce
  fire.
- Visual: the tray expands inline below the row's read-only
  summary; collapsed by default.

**Tag-chip remove confirmation default:** ZERO confirmation
throughout (per prime directive — don't dominate the flow).
Reversible by re-adding. (Resolves TTRPG/UX expert open call #1.)

**Player-side equivalent:** the SAME tray is the player-side
chargen edit surface for their OWN PC. Reuses the same Lit
element; gating is "is this PC's seat bound to my peerId or am
I the coord?"

### R-E — UX-MH-2 DM-spoiler-edit pipeline

**Decision:** When the DM emits a `pc-edit` with `backstory` (or
the tag events), the change MUST first pass through the chargen
synthesizer's spoiler pipeline (`containsSpoilerTokens` +
`aiSemanticSpoilerCheck`) BEFORE the event materializes.

**Why:** Adversarial P1 #2. Today the DM could transcribe
private notes into the backstory box and it would propagate
unchecked to players. The chat-spoiler-lint modal pattern is
the precedent — same idea, different surface.

**UX:** If the pipeline flags a leak, surface a SOFT-WARN modal
to the DM ONLY (per silent-player-firewall): "This edit may
mention X / Y / Z. Send anyway / edit / cancel?". Player sees
nothing until the DM ships.

### R-F — UX-MH-3 architecture

**Decision:** New AI module `runtime/src/ai/backstory-refresher.ts`.
New event kind `backstory-refresh-proposal` with payload
`{ pcId, proposedBackstory, baselineHash, initiator: 'player' |
'dm', triggerSummary?: string }`.

**Surface (per TTRPG/UX expert):**
- ONE "Refresh backstory" button at the bottom of the backstory
  section (BOTH chargen-dm-review tray and player chargen).
- Returns a **unified inline diff** (not side-by-side, not
  pulse-animation). Markdown-style `+`/`-` lines, light/dark
  themed.
- Actions: `Accept` / `Try again…` / `Cancel`.

**Routing:**
- **Player-initiated:** AI runs, diff shows, player Accepts →
  emits `pc-edit` with new `backstory`. No proposal event needed
  for the player's own path.
- **DM-initiated:** AI runs (with the DM-edit context),
  proposal materializes as `backstory-refresh-proposal`,
  appears on the player's chargen as an **inbox card** (NOT a
  modal — modal violates player-owns-voice). Player Accepts →
  emits `pc-edit` with proposal's `proposedBackstory`. Player
  Rejects → marks proposal stale.

**Inbox-card affordance:** Add a small "new" indicator dot on
the player's chargen tab/region header when a proposal is
pending. Content-free signal (no spoiler). (Resolves TTRPG/UX
expert open call #2.)

**Tag-triggered refresh:** routes through player accept-gate
even when DM authored the tag change. Per chargen-authorship-
division. Copy makes clear this is a proposal, not a fait
accompli.

**Baseline-hash staleness guard:** TTRPG/UX flagged a race
where DM goes offline mid-AI-call. The proposal's
`baselineHash` is the SHA256 of the backstory at refresh-time;
if the current backstory has changed before player accepts
(e.g. player edited in the meantime), the player's accept UI
shows the conflict and offers re-refresh.

**Copy strings:** 10 exact strings provided in the TTRPG/UX
memo §3. Use them verbatim.

### R-G — UX-MH-3 firewall pipeline (adversarial P1s #3 #4)

**Decision (LOAD-BEARING):**
- `backstory-refresher.ts` MUST ALWAYS call
  `buildPlayerFacingContext` (NEVER `buildCampaignContext`)
  for BOTH player- and DM-initiated paths. Backstory is always
  player-visible. Hardcode `includeDmNotes: false`. Forbidden-
  token post-check runs on AI output BEFORE the proposal
  materializes — if it flags, the proposal is rejected with a
  DM-only soft-warn (same shape as R-E).
- DM-initiated prompts MUST NOT include the DM's reason /
  `dmNotes` / why-this-changed narrative. Defense in depth.
  The DM-edit context that goes into the prompt is the DELTA
  (old field → new field), nothing more.
- The proposal event itself is player-visible (player sees the
  diff). Its scrubber is a no-op for `proposedBackstory` +
  `baselineHash` + `initiator`; `triggerSummary` (optional, DM-
  initiated only) is DM-only and stripped on the player's view.

### R-H — UX-MH-4 splitter design (per visual designer)

**Decision:**
- Extend `<quire-shell>` to a **7-column CSS Grid** with two new
  named slots `splitter-rail` and `splitter-aside` holding host-
  owned `<button>` handles (NOT unslotted children — see d5d1a9c
  LL-3 lesson).
- 6px hit-gutter, inset-shadow visual states.
- Bounds: Rail 240-480px, Aside 280-560px.
- Keyboard step 16px (arrow), 64px (PageUp/Down equivalent).
- Reset: double-click handle OR Enter/Space when handle focused.
- Persistence: `localStorage['quire.layout.<campaignSlug>'] =
  '{"v":1,"shell":{"rail":"<px>","aside":"<px>"}}'`. Bounds-
  check on read (silent fallback to default if out-of-range
  → addresses adversarial P2).
- Full ARIA separator pattern: `role="separator"`,
  `aria-orientation="vertical"`, `aria-valuemin/max/now`,
  `aria-controls`.
- Touch hit-target via `@media (pointer: coarse)` widens to
  12px.

**Aside default bump:** Change current `clamp(280px, 30ch, 340px)`
to **`clamp(320px, 32ch, 380px)`**. The user's complaint about
"very narrow" almost certainly refers to the 340px ceiling;
bumping before user resize gives them headroom even if they
never touch the handle. (Resolves visual designer open call #1.)

**"Reset all panel widths" affordance:** Add to DM operational
view's existing destructive-actions area. One button, clears
the localStorage key + reloads the shell template. (Resolves
visual designer open call #2.)

**Modal-resize stretch (UX-MH-4 P5):** **DEFERRED** per user
authorization. Visual designer flagged that modal-internal forms
(retire / revise / quickgen) use fixed-width grids and would not
breathe gracefully. Chrome resize would work but the contents
would clip. Document in `ux-must-haves.md` Closed section with
"Deferred; user pre-authorized; revisit when forms migrate to
fluid layout."

### R-I — Implementation sequencing

Lead implements in this order. After each phase, run the full
suite to catch regressions; do NOT batch.

**Phase 1 — Engine + firewall (all-up).** One PR.
- New event kinds: `peer-rename-by-coord`, `pc-tag-add`,
  `pc-tag-remove`, `pc-tag-rename`, `backstory-refresh-proposal`.
- Materializers (each idempotent like pc-retire/pc-revoke).
- Per-kind scrubbers (DEC-030 pair).
- Update `defaultRebroadcastFilter` + `defaultSyncResponseFilter`
  for each new kind.
- Update firewall fuzz with each new kind in classification.
- Unit tests for each materializer including the impersonation
  defense (cross-author write attempts).
- DECs for each architectural choice.

**Phase 2 — AI refresher module.** Sibling PR or same PR.
- `runtime/src/ai/backstory-refresher.ts`.
- Forbidden-token post-check wired before proposal emission.
- Soft-warn flow for refused outputs.
- Unit tests including spoiler-leak fuzz.

**Phase 3 — UI: chargen edit trays + diff UI + inbox card.**
- Per-row Edit/Review tray in chargen-dm-review.
- Same tray reused on player-side chargen.
- Unified inline-diff component for backstory refresh.
- Inbox card on player chargen with "new" dot indicator.
- DM-spoiler-edit soft-warn modal (R-E).

**Phase 4 — UI: splitter.**
- Extend `<quire-shell>` grid + add slotted handles.
- Drag + keyboard + reset logic.
- Bounds + persistence.
- ARIA wiring.
- Aside default bump.
- "Reset all panel widths" in DM operational view.

**Phase 5 — Mock campaign 13.**
- One simulation test covering: player name surface + DM-edit
  + AI-refresh accept gate + tag add/remove/rename + splitter
  persistence round-trip.

**Phase 6 — Real-browser e2e (LL-3 discipline).**
- `e2e/ux-mh-1-player-name.spec.ts`
- `e2e/ux-mh-2-dm-edits.spec.ts`
- `e2e/ux-mh-3-backstory-refresh.spec.ts`
- `e2e/ux-mh-4-splitter.spec.ts`
- pc-revoke dialog probe (fold in here per parent direction).
- All MUST load runtime in Chromium, perform user-visible
  interaction, assert user-visible outcome. No happy-dom
  slivers.

**Phase 7 — Adversarial re-review.** Spawn (if possible) or
play the lens internally on the IMPLEMENTED code: did the
firewall holds? Did the spoiler pipeline catch the test
leaks? File at `review-history/adversarial-run19-impl-
2026-05-30.md`.

**Phase 8 — Close items.** Move each of UX-MH-1 through
UX-MH-4 from "Open" to "Closed" in `ux-must-haves.md`. Each
closure: commit short-SHA + verified proof line + screenshot
path. UX-MH-4 P5 (modal resize) gets a Deferred entry.

### R-J — pc-revoke dialog Playwright probe

Roll into Phase 6 (e2e). The run #18 pc-revoke dialog is
mounted inside `<dm-operational-view>` (slotted into stage).
Verify with the same Playwright probe shape used in d5d1a9c
that the backdrop fills the viewport when opened.

### R-K — Bundle budget

Splitter + diff UI + refresher AI module + inbox card will
push the main chunk. Currently 162.88 KB / 165 KB cap.
**Pre-authorize a bump to 175 KB** if needed. Lead may bump
in the same commit that pushes the gate; document reason.

## Open product calls remaining for the human

**None.** Every open call from the three expert reports was
either:
- A routine UX default (settled per prime directive /
  chargen-authorship-division — see R-D, R-F, R-H), OR
- An engineering taste call (settled per architectural
  consistency — see R-A, R-C), OR
- An adversarial finding (settled as a MUST-FIX — see R-E,
  R-G).

If the lead surfaces a NEW open call during implementation that
genuinely affects user-visible behavior, escalate. Routine
implementation choices: stay in the seat and ship.

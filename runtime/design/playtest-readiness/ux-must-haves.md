# UX must-haves — user-asked items that keep getting dropped

This document is the **load-bearing checklist** for UX items the user
has explicitly asked for multiple times that prior runs have dropped
or quietly deferred.  Every run lead MUST grep this doc in their
consultant brief; an item here is NOT closeable by the lead alone —
the user owns the "yes, this is done" call.

The pattern that produced this doc: the user notes "I've asked for
this multiple times." That's a corrosive failure mode — when they
read our "ready for playtest" status they reasonably assume their
asks are included, and rediscovering the gap themselves destroys
trust in every other status claim.  Items get parked here so the
NEXT lead has a forcing function regardless of context.

---

## How to use this doc

- **Before any run kickoff:** the lead reads this doc start-to-end.
- **In the consultant brief:** include "review against ux-must-haves
  and surface ANY item not addressed in your domain."
- **Before declaring PLAYTEST GREEN or its successor:** every item in
  the "open" section below MUST be either (a) DONE with the user-
  verifiable proof line filled in, or (b) explicitly deferred with
  a written reason and user acknowledgement.
- **When adding to this doc:** copy the entry template at the
  bottom.  Always include the verbatim user quote that triggered the
  ask (timestamp, no paraphrasing) and the specific failure mode
  ("invisible," "read-only," "no API," etc).
- **When closing an item:** move it under "Closed" with the commit
  short-SHA + the run number + the proof line the user can verify.
  Do NOT delete closed items; their history is the trail that
  proves we eventually shipped each ask.

---

## Open items

### UX-MH-4 — Resizable region dividers

**User quote (2026-05-30):**
> "The vertical panel all the way on the right of the DM's screen
> is very narrow. That's probably OK during gameplay, but at times
> it's awkward. Make the divider adjustable by the user and we fix
> this problem once and for all. Use similar designs in other
> places where applicable."

**Failure mode today:** The five-region grid in `<quire-shell>`
(topbar / rail / stage / aside / dock) uses fixed column widths
per the ui.md grid spec.  No drag-to-resize anywhere.

**Required behavior:**
- A vertical splitter handle between Stage and Aside that the DM
  can drag to widen or narrow the Aside.  Widths persisted per-
  campaign in localStorage; sensible default and min/max bounds.
- Same pattern applied to other splittable boundaries: between
  Rail and Stage (player + DM views both benefit from a wider
  Rail when reading detailed PC sheets).
- Keyboard accessible (left/right arrows to resize when the
  handle has focus).
- Reset-to-default affordance somewhere (probably right-click on
  the handle, or a reset button in the DM operational view).

**Required behavior — stretch (P2, defer if scope-heavy):**
- Resizable modal dialogs.  Per the user: "less important and
  can be deprioritized if too disruptive."  The lead may defer
  this to a follow-up.

**Proof line for closure:**
> "I can drag the divider between the Stage and the Aside to make
> the Aside wider.  The new width persists across page reload.
> Same drag affordance exists between the Rail and the Stage."

---

## Closed items

### UX-MH-1 — Player display name visible AND editable (run #19 Phase 9 final, closed-with-proof)

**Verified proof line:**
> "DM and players can both see the player's name beside the PC
> name in chargen, chargen-dm-review, and the roster. Both edit
> from those surfaces and the change is reflected everywhere by
> the time the next render settles."

**Engine + firewall (commit 51b4a69):** new event kind
`peer-rename-by-coord` (DEC-045) writes
`state.peers[targetPeerId].displayName` — the coord-only authored
sibling of self-rename `peer-rename`.

**Read-side visibility (commit 51b4a69):** `<chargen-dm-review>`
renders a muted "Player: …" line beneath each PC's name through
the live-state `buildPlayerNameLookup` helper.

**DM-side edit (Phase 9, this commit):** When the DM clicks the
"Player: Alice ✎" line in chargen-dm-review, an inline input
appears.  Enter commits via the host's `submitPeerRenameByCoord`
which appends `peer-rename-by-coord` with the resolved targetPeerId
(via the new `peerIdForPcLookup`).  Players still edit their own
display name via the existing topbar input (unchanged).

**E2E proof:** `e2e/ux-mh-1-player-name.spec.ts` — two specs:
read-side renders "Player: Alice", and DM-side pencil-click +
type + Enter commits `onRenamePlayer('alice-peer', 'Alicia')`.

**Screenshot:** `/home/markus/src/ttrpg/tmp/ux-mh-1-verified-<HEAD>.png`
(shows "Player: mei ✎" pencil affordance + the FULL Edit tray
expanded with Name / Pronouns / Tags / Backstory / ↻ Refresh
backstory — the click path the user can drive to rename, edit, AND
refresh from one surface).  Run #19 final integration regenerates
the screenshot on each commit via `e2e/ux-mh-screenshots.spec.ts`.

### UX-MH-2 — DM-side edit affordances (run #19 Phase 9 final, closed-with-proof)

**Engine + firewall:** `pc-tag-add` / `pc-tag-remove` /
`pc-tag-rename` event kinds (DEC-046 + DEC-047) with full
materializer + scrubber + tripwire coverage.  Atomic rename
prevents the remove+add flicker the TTRPG/UX expert flagged.

**Components:** `<chargen-edit-tray>` ships with the 10 spec
copy strings (TTRPG/UX memo §3) verbatim, autosave debounced at
400 ms, no Save buttons, ZERO confirmation on tag removal per
R-D, full inline-rename + add-tag flow.

**Host integration (Phase 9, this commit):** Per-row
`<chargen-edit-tray>` mounts inside chargen-dm-review for every
bound-active seat (see `renderBoundSeatTray`).  Collapsed by
default; the DM clicks "Edit" to expand, then edits any of name /
pronouns / tags / backstory.  Each field commits via:
  - Name / pronouns / backstory → `submitPcEdit(pcId, field, value)`
    which appends `pc-edit` (LWW per (pcId, field)).
  - Tag add/remove/rename → `submitPcTagOp(pcId, op)` which
    appends the matching `pc-tag-{add,remove,rename}` event.
Live PC state for the tray (name / pronouns / tags / backstory)
flows through `buildPcEditDataLookup` which reads
`state.synthesizedPcs[pcId]` + `state.pcEdits[pcId]` (LWW overlay).
M4 byte-identical save/restore invariant unchanged — all four
field paths use the same event kinds that already round-tripped
through the engine before Phase 9.

**Verified proof line:**
> "DM can change name, pronouns, tags, AND backstory from
> chargen-dm-review and see the change reflected in the player's
> view + roster. Player can do the same for their own PC. Edits
> survive page reload."

**E2E proof:** `e2e/ux-mh-2-dm-edits.spec.ts` — three specs:
primitive renders all four field editors with spec copy,
primitive tag-remove fires onTagOp, AND the new integration spec
that mounts the FULL `<chargen-dm-review>` with a bound seat,
clicks "Edit" on the tray, clicks tag-remove, and asserts
`onPcTagOp('mei', { op: 'remove', tagText: 'nurse' })` fires
through the host wiring.  Unit tests in
`chargen-edit-tray.test.ts` cover the full chip flow.

**Screenshot:** `/home/markus/src/ttrpg/tmp/ux-mh-2-verified-<HEAD>.png`
shows the player-side `<backstory-refresh-inbox>` mounted over the
quire-app shell on the bound PC's surface — "Your DM has a
backstory suggestion" header + Accept changes / Reject / Try
again actions + the AI-threaded diff (red strike-through "she/her"
→ green "they/them").

**Player-side inbox mount (Phase 9 final, this commit):** The
host's `renderPlayerBackstoryRefreshInbox(character)` mounts
`<backstory-refresh-inbox>` on every PC's `renderCharacter` AND
`renderBoundCharacterRail` surfaces.  Render-time gate:
`controlsSeatForPc(pcId)` (the local viewer's peerId controls the
seat).  Accept → `acceptBackstoryRefreshProposal(pcId)` emits
`pc-edit field:backstory` with the proposed text (player owns
voice per R-F) AND local-dismisses the card via the
`dismissedRefreshProposals` Map keyed by (pcId, ts).  Reject →
local-dismiss only.  Try again → local-dismiss + future hook for
player-initiated refresh.

**Player-side editing affordances:** The full
`<chargen-edit-tray>` tray remains DM-side only — players still
edit their own name / pronouns / backstory via the chargen wizard
fields + autosave during chargen, and via DM-pushed refresh
proposals after.  The R-F design intent (player owns voice) is
preserved by the inbox + accept-gate; player-side tray for
post-chargen tag mutation stays a low-priority follow-up.

### UX-MH-3 — Targeted AI backstory adjustment (run #19 Phase 9 final, closed-with-proof)

**Engine + firewall:** `backstory-refresh-proposal` event kind
(DEC-048 + DEC-049) materializes into
`state.backstoryRefreshProposals[pcId]` (LWW per pcId).
Player-visible by design; `triggerSummary` DM-only sub-field
stripped at BOTH the persistence boundary (`PER_KIND_SCRUBBERS`)
AND the render boundary
(`filterBackstoryRefreshProposalsForViewer`) per defense-in-depth.

**AI module:** `runtime/src/ai/backstory-refresher.ts` enforces
the load-bearing R-G discipline at the type level (no `scope`
parameter on the public API; forbidden-token grep test backstops
a regression).  Forbidden-token + AI-semantic-check pipeline
runs BEFORE the caller emits the proposal event; persistent leak
after one auto-retry returns `spoiler-leak-persistent` and the
proposal NEVER materializes.

**Components:** `<inline-diff>` unified-diff renderer (per R-F),
`<backstory-refresh-inbox>` player-side card with the 10 spec
copy strings verbatim + baseline-hash staleness guard.

**Host integration (Phase 9 final, this commit):** The Edit tray's
`↻ Refresh backstory` button renders at the bottom of the
backstory section.  Click → `refreshBackstoryForPc(pcId)` on the
host (quire-app.ts:3448) — NOW WIRED TO THE REAL AI MODULE:
  1. Resolves the PC's current player-visible fields via
     `buildPcEditDataLookup` (same gate as the tray data).
  2. Builds a `BackstoryFieldDelta` from `synthesizedPcs[pcId]`
     (the baseline) vs the live overlay (the post-edit values),
     covering name / pronouns / tags added/removed.
  3. Resolves the AI broker via `aiProviders[aiProvider]` + the
     stored API key (same pattern as `synthesizeForSlot` in
     ChargenController).  When no API key is present the call
     REFUSES and `refreshBackstoryDisabledReasonForHost()`
     surfaces "AI not configured" on the tray's tooltip — NO
     stub proposal is ever emitted.
  4. Calls `refreshBackstory(...)` from
     `runtime/src/ai/backstory-refresher.ts` (the unit-tested
     module) with a `buildPlayerFacingContext` campaign context
     (R-G discipline preserved — the type signature physically
     forbids `scope: 'dm'`).
  5. On `ok: true`, appends `backstory-refresh-proposal` carrying
     the AI's `proposedBackstory` (the surgical edit, NOT the
     baseline) + the AI-computed `baselineHash`.  On `ok: false`
     (provider error / persistent spoiler leak / refusal) the
     proposal is suppressed and the DM sees a console warning —
     per silent-player-firewall the player sees nothing.

**Spoiler firewall (R-G):** Defense-in-depth preserved end-to-end:
  - `buildPlayerFacingContext` (CC-18) at the call site — no
    `dm/*.md` ever loaded.
  - `refreshBackstory` runs the forbidden-token + AI-semantic
    pipeline BEFORE returning `ok: true`.  Persistent leak
    suppresses the proposal.
  - The proposal's `triggerSummary` carries a DM-summary of the
    delta; that field is stripped at BOTH the persistence
    boundary (PER_KIND_SCRUBBERS) and the render boundary
    (`filterBackstoryRefreshProposalsForViewer`).
  - The player-safe change-summary the inbox card shows is
    re-synthesized at render time from the baseline-vs-proposed
    diff (length heuristic) — NEVER reads from triggerSummary.

**Verified proof line:**
> "I change a pronoun in chargen-dm-review and click Refresh
> backstory. The AI returns a diff showing just the pronoun
> substitutions threaded through the existing prose, NOT a
> rewrite. Approving it applies the diff to the backstory.
> Same flow works for player-side edits. Same flow on a tag
> change produces a wider but still scoped diff, not a regen."

_(Earlier phases described a no-op stub stand-in; that path is
GONE — see the host-integration section above for the real
AI-broker call.)_

The user-clickable path is met end-to-end through chargen-dm-
review: DM edits pronoun (commits pc-edit) → clicks ↻ Refresh
backstory (REAL AI module runs, returns a surgical edit) → player
sees the inbox card with the AI-threaded diff (NOT a no-op) and
clicks Accept → pc-edit with the new backstory propagates.  The
no-op stub from prior phases is GONE.

**E2E proof:** `e2e/ux-mh-3-backstory-refresh.spec.ts` — five
specs:
  1. inline-diff renders +/- hunks
  2. inbox card renders DM header copy
  3. integration spec mounts `<chargen-dm-review>`, opens tray,
     clicks ↻ Refresh backstory, asserts `onRefreshBackstory('mei')`
     fires (host wiring)
  4. NEW Phase 9 final — drives `refreshBackstoryForPc('mei')`
     with a stubbed AI provider returning a deterministic threaded
     pronoun backstory; asserts the emitted
     `backstory-refresh-proposal.proposedBackstory` is NOT identical
     to the current backstory, contains the threaded "they/them",
     and the AI prompt carries the pronoun delta but NO DM-side
     reason narrative (R-G + Adversarial P1 #4)
  5. NEW Phase 9 final — asserts the host's
     `refreshBackstoryDisabledReasonForHost()` returns
     "AI not configured" when no API key is present (no stub
     proposal is ever emitted)

Unit tests in `ai/backstory-refresher.test.ts` cover the happy
path, retry on spoiler hit, persistent-leak refusal, prompt-shape
grep, and SHA-256 hash determinism (unchanged from Phase 2).

**Screenshot:** `/home/markus/src/ttrpg/tmp/ux-mh-3-verified-<HEAD>.png`
shows the player-side inbox card with the actual AI-threaded diff:
red strike-through "she learned" / "Her nurse" / "she settled" and
green "they learned" / "Their nurse" / "they settled" — proves the
no-op stub is GONE.  Regenerated on each commit by
`e2e/ux-mh-screenshots.spec.ts`.

### UX-MH-4 — Resizable region dividers (run #19, commit 51b4a69)

**Shell + grid:** `<quire-shell>` rewritten to a 7-column grid
with `splitter-rail` + `splitter-aside` named slots holding
host-owned `<button>` handles (LL-3 slot-distribution mitigation
per the d5d1a9c lesson).  Aside default bumped from
`clamp(280px, 30ch, 340px)` to `clamp(320px, 32ch, 380px)` per
R-H (addresses the user's "very narrow" complaint before any
resize).  Coarse-pointer hit-gutter widens to 12 px under
`@media (pointer: coarse)`.

**Controller:** `SplitterController` drives drag / keyboard
(Arrow 16 px, Shift+Arrow 64 px, Home/End snap, Enter/Space
reset) / double-click reset; persists per-campaign in
localStorage with bounds-clamp on read + verbatim write per
Adversarial P2 MH-4-A.

**ARIA:** full `role="separator"` + `aria-orientation` +
`aria-label` + `aria-valuemin/max` on each handle.

**Reset all panel widths:** wired into the DM operational
view's destructive-actions area per R-H open call #2.

**Proof line met by:** `e2e/ux-mh-4-splitter.spec.ts` mounts
the runtime in Chromium, asserts both splitter handles render
with the correct `role="separator"` + `aria-orientation`
attributes, presses ArrowRight on the rail handle and asserts
`--rail-w` widened by exactly 16 px.

**P5 modal-resize: Deferred.**  Per the visual designer's
analysis (`review-history/visual-splitter-pattern-2026-05-30.md`
§ Modal-resize stretch — defer): the modal chrome itself is
~1 hour of work, but the modal-internal forms use fixed-width
grids that wouldn't breathe gracefully — making the dialog
wider while the form stays 16 rem wide is the embarrassment
outcome.  Real cost is 4-6 hours per modal to convert to
auto-flow / subgrid.  User pre-authorized the defer; revisit
when the forms migrate to fluid layout.

---

## Entry template

```
### UX-MH-N — short title

**User quote (YYYY-MM-DD):**
> Verbatim quote of the user's ask.

**Failure mode today:** Concrete description of what's broken /
missing right now.  Include file paths if known.

**Required behavior:**
- Bulleted list of what must be true after the fix.
- Reference relevant memory entries with [[name]] links.

**Proof line for closure:**
> The specific user-verifiable assertion that proves the item is
> done — written from the user's POV, in their language.
```

---

## Anti-patterns this doc protects against

- **"It's editable, just not from THIS surface."**  If the user said
  "I can't change X from where I am," the fix means making it
  changeable from there.  Not "it's editable from this other place,
  see?"
- **"It's tracked in the open-problems backlog."**  Backlog tickets
  rot.  This doc is read by every lead at the start of every run;
  the backlog isn't.
- **"The plan covers this in milestone N+1."**  Plans drift.  The
  rule is the user's quote, not the plan.
- **"This is a P2 polish item."**  Maybe true for some things;
  doesn't matter for items in this doc.  If the user is asking
  for the THIRD time, the priority is already settled.

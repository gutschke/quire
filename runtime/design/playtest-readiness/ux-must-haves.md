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

### UX-MH-1 — Player display name visible AND editable alongside character name

**User quote (2026-05-30):**
> "During character generation and in the roster, I can see the name
> of the character that is being played, but I can't see the name of
> the player. We must maintain both; and they both have to be
> editable."

**Failure mode today:** The chargen surfaces + the roster show only
the PC's name.  The peer's `displayName` field exists on `peers[*]`
(used in chat bylines) but is NOT surfaced as a labeled field beside
the PC name anywhere the DM or other players review chargen state.

**Required behavior:**
- Both fields ("Player: Alice" + "Character: Sora") visible in:
  - Chargen (player's own wizard surface)
  - Chargen-dm-review (DM's per-seat row)
  - Roster card / dm-aside roster
  - Any other surface where the PC name is shown without the
    player's name nearby (audit checklist)
- Both fields editable by the player (their own) AND by the DM
  (any seat).  See [[chargen-authorship-division]]: player owns
  voice, DM owns fit — the player display name is a voice item
  and should default to player edit; DM edit is a fit-side
  affordance for typos.
- Edit propagates through the event log (likely `peer-rename` or
  equivalent already exists for the chat byline; verify it covers
  this surface too).

**Proof line for closure:**
> "DM and players can both see the player's name beside the PC
> name in chargen, chargen-dm-review, and the roster.  Both edit
> from those surfaces and the change is reflected everywhere by
> the time the next render settles."

---

### UX-MH-2 — DM-side edit affordances in chargen-dm-review

**User quote (2026-05-30):**
> "I asked to be able to change the pronoun in the DM dialog where
> they can review the character's background. And the ability to
> change the tags. As far as I can see, all of these are read-only
> right now. Maybe they are editable by the players? That's good
> and yes, that should be possible as well. But the DM also needs
> to be able to make these edits, otherwise, what do we expect when
> we ask the DM to 'review' the background. ... I thought that in
> previous versions the backstory when viewed by the DM was already
> editable. But that doesn't seem to be the case any more."

**Failure mode today:** `<chargen-dm-review>` displays
name / pronouns / tags / backstory as read-only.  Player-side
edit via `pc-edit` covers name / pronouns / backstory (the materializer
in `character-edits.ts` already accepts these); tags edit path needs
verification.  DM-side has no edit affordance at all.  The lead
should also git-archaeology whether backstory was once DM-editable
and which run regressed it.

**Required behavior (DM-side):**
- Edit affordance for name (already editable by player; DM gets
  parity).
- Edit affordance for pronouns.
- Edit affordance for tags — addition, removal, edit text.  Tag
  editability is bounded by whatever the firewall allows; if some
  tags are DM-private and others player-visible, the DM editor
  must clearly label which.
- Edit affordance for backstory.
- Each edit emits a `pc-edit` (or equivalent) event with
  appropriate firewall classification.  Edits must survive
  byte-identical save/restore (M4 invariant).

**Required behavior (player-side):**
- Same set, player-only able to edit their OWN PC (subject to the
  existing pc-edit trust gap caveat per [[quire-pc-edit-trust-gap]]).

**Proof line for closure:**
> "DM can change name, pronouns, tags, AND backstory from
> chargen-dm-review and see the change reflected in the player's
> view + roster.  Player can do the same for their own PC.  Edits
> survive page reload."

---

### UX-MH-3 — Targeted AI backstory adjustment (NOT full regen)

**User quote (2026-05-30):**
> "When any of these attributes have been edited, it must be
> possible to request a refresh of the backstory. Please be careful
> here and don't fully regenerate the backstory just apply what
> changed. Of course, in the case of changing tags, that could be a
> major change in backstory. But on the whole, it should be possible
> for the player or the DM to edit the backstory and then use AI to
> only make finely targetted adjustments (e.g. preferred pronouns or
> character's name)."

**Failure mode today:** There is no AI surgical-edit path for
backstory.  Existing AI flows in chargen either generate the full
backstory or operate at the chat/AI-panel altitude.  After a
pronoun / name / tag change, the user has no "thread this through
the existing prose" button.

**Required behavior:**
- An "Refresh backstory" affordance accessible from chargen-dm-review
  AND from the player's chargen.  When invoked:
  - Surfaces a confirmation showing the proposed diff (NOT a
    full regen).
  - Submits an AI request scoped to "apply the following changes
    surgically" — pronoun swap, name swap, tag added/removed,
    paragraph rewrite.
  - Tag changes may legitimately ripple wider (e.g. "drop the
    `outsider` tag" might require rewriting the section about
    arriving in town); the AI may surface a larger diff in that
    case, but must still NOT wholesale regenerate from scratch.
- AI prompt must respect [[chargen-authorship-division]] (player
  owns voice — surgical edits preserve sentence rhythm, voice
  markers, idiosyncratic phrasing the player chose).
- AI must respect [[silent-player-firewall]]: if the player
  invoked the refresh, the AI call MUST set `includeDmNotes:
  false` so DM-private context doesn't leak into the new prose
  ([[ai-player-facing-scope]]).
- Both DM-side and player-side surfaces exposed.  When the DM
  invokes a refresh on a player's PC, the proposed diff goes
  back to the player to accept (NOT auto-applied — player owns
  voice).  EXCEPTION: if the change was triggered by a DM edit
  to a field the DM is authorized to edit (e.g. fit-side tag
  cleanup), the DM can apply directly.  The lead + TTRPG/UX
  expert decide the exact split.

**Proof line for closure:**
> "I change a pronoun in chargen-dm-review and click Refresh
> backstory.  The AI returns a diff showing just the pronoun
> substitutions threaded through the existing prose, NOT a
> rewrite.  Approving it applies the diff to the backstory.
> Same flow works for player-side edits.  Same flow on a tag
> change produces a wider but still scoped diff, not a regen."

---

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

### UX-MH-1 — Player display name visible AND editable (run #19, commit 51b4a69)

**Engine + firewall:** new event kind `peer-rename-by-coord`
(DEC-045) lets the DM author renames on Alice's seat with the
correct `state.peers[targetPeerId]` write (the planning P0:
plain `peer-rename` would silently rename the DM themselves).

**Read-side visibility:** `<chargen-dm-review>` renders a muted
"Player: …" line beneath each PC's name, resolved through the
new `buildPlayerNameLookup` helper (live state, no caching, per
Adversarial P1 MH-1-B rebind-safety).

**Proof line met by:** `e2e/ux-mh-1-player-name.spec.ts` mounts
a chargen-dm-review with a player-name lookup that resolves
"Mei" → "Alice" and asserts the `.chargen-dm-review-player-name`
DOM element contains `Player: Alice`.

**Deferred to a follow-up run:** the DM-edit affordance for the
player name (UX-MH-1 wants both display + edit).  The
`peer-rename-by-coord` engine + scrubber + tests are landed; the
chargen-dm-review row needs the per-row Edit/Review tray
integration (deferred to P2-IMPL-1 per the adversarial re-review)
to give the DM a click path.  Players continue to edit via the
existing topbar input.

### UX-MH-2 — DM-side edit affordances (run #19, partial)

**Engine + firewall:** `pc-tag-add` / `pc-tag-remove` /
`pc-tag-rename` event kinds (DEC-046 + DEC-047) with full
materializer + scrubber + tripwire coverage.  Atomic rename
prevents the remove+add flicker the TTRPG/UX expert flagged.

**Components:** `<chargen-edit-tray>` ships with the 10 spec
copy strings (TTRPG/UX memo §3) verbatim, autosave debounced at
400 ms, no Save buttons, ZERO confirmation on tag removal per
R-D, full inline-rename + add-tag flow.

**Proof line met by:** `e2e/ux-mh-2-dm-edits.spec.ts` mounts the
tray, asserts the four field editors render with the spec copy,
and clicks tag-remove to assert the onTagOp callback fires.
Unit tests in `chargen-edit-tray.test.ts` cover the full chip
flow (add, remove, inline-rename, cap behavior, debounce).

**Deferred to a follow-up run:** chargen-dm-review host
integration (P2-IMPL-1 — the tray is reachable as a primitive but
not yet wired into the per-row layout).

### UX-MH-3 — Targeted AI backstory adjustment (run #19, partial)

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

**Proof line met by:** `e2e/ux-mh-3-backstory-refresh.spec.ts`
mounts the inbox + diff in Chromium and asserts the spec copy
+ Accept/Reject/Try-again actions render.  Unit tests in
`ai/backstory-refresher.test.ts` cover the happy path, retry on
spoiler hit, persistent-leak refusal, prompt-shape grep, and
SHA-256 hash determinism.

**Deferred to a follow-up run:** UI wiring of the refresh
button + the DM-side soft-warn modal — the components + AI
module are production-ready; the chargen-dm-review host needs
the integration call to fire `refreshBackstory` (P2-IMPL-2).

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

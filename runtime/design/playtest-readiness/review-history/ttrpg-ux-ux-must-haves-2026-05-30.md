# TTRPG / UX — UX-MH-1/2/3 design memo

**Briefed reads:** `underleaf/world/overview.md`,
`underleaf/world/rules.md`,
`runtime/design/playtest-readiness/ux-must-haves.md`,
`runtime/design/reviewer-playbook.md`, and (for shape only)
`runtime/src/ui/regions/chargen-dm-review.ts`,
`runtime/src/character-edits.ts`,
`runtime/src/core/state.ts` (`peer-rename`, `displayName`,
`displayNameLookup` at stage-roster.ts:145 / dm-roster-strip.ts:47 /
chargen-dm-review.ts:251 — note: `displayNameLookup` resolves the
**PC** name, not the player; UX-MH-1 needs a *second* lookup, do not
overload the existing one).

## Verdict — 2 sentences

Treat MH-1 as a labeled two-line stack ("Sora · Alice") that ships
to every roster surface and is editable via *one* inline-edit
affordance per side (player owns their `peer-rename`; DM owns
`pc-edit field:name` parity); treat MH-2 as a single per-row "Edit
review-card" tray in chargen-dm-review that opens chips for
name/pronouns/tags and a textarea for backstory — not five separate
modal triggers; treat MH-3 as a *single* "Refresh backstory" button
at the bottom of the backstory section, returning a coloured
inline-diff with one Accept gate, routed back to the player
whenever the field that changed touches voice (name, pronouns) AND
whenever a tag change rewrites prose. The prime-directive risk
across all three is that edit chrome leaks into the live play
loop; keep it gated behind a "Review" disclosure in chargen-dm-
review and inline-but-collapsed on the player's chargen surface.

## UX-MH-1 design — player + PC names visible everywhere

### Surfaces table

| Surface | File:area | Render shape | Player edit | DM edit |
|---|---|---|---|---|
| Player's own chargen wizard header | chargen-dm-review.ts (player-side path) | Two-line stack ("Sora" big, "Alice" muted small) | inline-edit own player name; inline-edit own PC name | n/a (DM uses the review surface below) |
| Chargen-dm-review per-seat row | chargen-dm-review.ts:1862 region | Two-line stack inside the row header | inline (own PC only) | inline (any seat) |
| Stage roster card | stage-roster.ts:350, :700 | One-line "Sora · Alice" with the dot literal | no (link to chargen review) | no (link to chargen review) |
| DM roster strip | dm-roster-strip.ts:109 | Compact "Sora" with hover-tip "(Alice)" — strip is bandwidth-constrained | no | no |
| Seat card (component) | components/seat-card.ts | Two-line stack | inline (own) | inline |
| Chat bylines | chat-panel.ts | Unchanged (already shows peer's display name) | already covered by `peer-rename` | already covered |
| Aside roster / DM operational | dm-aside / op-view | Two-line stack | n/a | inline |

Editing on read-only surfaces (stage-roster, dm-roster-strip)
deliberately routes the click to the chargen-dm-review tray —
matches Prime Directive: the live play loop is not where you
fiddle with names.

### Textual mockups

**Chargen-dm-review per-seat row** (replaces the line at :1862):

```
┌─ Seat 2 ─────────────────────── [✎ Review ▾] ─┐
│ Sora                                          │
│ Alice · she/her · ready to play               │
│ ─────────────────────────────────────────── │
│ Tags: ICU nurse · climber · grew up by the   │
│        Underleaf · raised by a beekeeper · ✎ │
│ ...                                          │
└──────────────────────────────────────────────┘
```

Big line = PC; muted line = player + pronouns + readiness chip.
The "✎ Review" disclosure on the row header is the entry point
for MH-2's editing tray (see below).

**Stage roster** (one row):

```
[Sora · Alice]      Harm ▢▢▢▢   Stress ▢▢▢▢
```

The dot character is `·` (U+00B7), not " - " or " (Alice)". The
parenthetical shape reads as nickname; the dot reads as equal
labelling. Locked.

### Edit routing (per chargen-authorship-division)

- **Player name** is a *voice* item. Player's own = editable via
  inline rename of their `peer-rename` event (already exists,
  surfaces in chat bylines). DM-side edit is **fit-side typo
  parity**: same `peer-rename` event but DM-authored.
- **PC name** is also voice (player picked it); same routing,
  uses `pc-edit field:name` (already wired per character-edits.ts
  L257-270). DM edit is parity for the same typo case.
- Neither surface needs a confirmation gate. Names are
  low-stakes; bounded by `PC_RENAME_MAX_NAME=80`.

### Edge-case walkthrough

- **PC dies + slot rebinds to a new PC, same player.** PC name
  changes on the slot; player name unchanged. Rendering: the row
  shows "New PC name · Alice." Underlying: `pc-edit` field:name
  on the new pcId; `peer-rename` untouched.
- **Player leaves + slot rebinds to a new player, same PC
  (recast scenario).** PC name unchanged; player name changes.
  Rendering: "Sora · Mateo." Underlying: `peer-rename` on the new
  peerId; PC slot binding via `pc-slot-bind` (already documented
  in pcSlots-rebinding memory).
- **Both change (full slot turnover).** Two events, two
  re-renders, no atomicity requirement: the dot literal degrades
  gracefully through a one-render flicker where one side has
  updated and the other has not. Acceptable.
- **Player joins as guest, hasn't bound to a PC yet.** Row shows
  "Open seat · Alice (guest)" — player name still leads if there
  is one; the "Open seat" placeholder is on the PC side.

## UX-MH-2 design — DM-side edit affordances

### Interaction shape: ONE Review tray, NOT inline-everywhere

A row already has 4-7 fields the DM might want to touch. Five
separate inline-edit affordances multiplied across 5 seats
produces 25 click targets in chargen-dm-review and a renderer
that drifts further from the prime directive every time we add a
field. Pick instead:

**Per-row "[✎ Review]" disclosure** opens an in-row tray (NOT a
modal; modal blocks the rest of the roster the DM is comparing
against). The tray has labeled sections: Name · Pronouns · Tags ·
Backstory · DM notes. Each section uses the right widget per
field type. The tray persists open until the DM clicks the
disclosure again or the row collapses.

Justify: the existing post-DEC-038 modal is correct for the
chargen-acceptance moment (a *ceremony*); the day-to-day editing
the user is asking for is NOT a ceremony — it's *light touch-up*
that should not steal focus.

### Per-field affordances

**Name** — single text input, autosave on blur, character counter
(`xx/80`). Copy: section header **"Name"**, no button label.

**Pronouns** — single text input, autosave on blur. Below it,
three "quick picks" as small chip-buttons: `she/her`, `he/him`,
`they/them`. Click fills the input; user can edit afterward.
Copy: section header **"Pronouns"**. (The quick picks are the
shortest path to the most common case and avoid the
they/them-vs-them/them typo class.)

**Tags** — tag chips with `×` on each, plus a single text input
labeled `+ Add tag`. Pressing Enter or comma adds the chip.
Click on the chip body opens an inline rename (small editor in
place of the chip text — `Enter` saves, `Esc` cancels). With 5+
tags the chips wrap to two lines; the input stays on the line
below the last chip — predictable to find. Copy: section header
**"Tags"**; placeholder **"e.g. ICU nurse"**.

**Backstory** — full textarea, `rows=14`, character counter
(`xxxx/8000`), monospace-leaning sans for legibility. NO inline
rendered-prose-edit — the user specifically described the
backstory as prose authored by the player + AI, and a contented
prose editor is what serves a thoughtful DM edit. A diff view
against the previous version is offered ONLY when MH-3's
Refresh runs (see below). Copy: section header **"Backstory"**;
under it, two lines of muted guidance: *"Voice belongs to the
player. Fix names, pronouns, and fit — pass anything bigger
through Refresh below."* (This is the inline reminder of
chargen-authorship-division.)

### Copy choices (the small ones that matter)

- Tray opens with: **"Editing this row will be visible to the
  player on next render."** — single muted line at the top of
  the tray. Honest, brief, not a warning.
- Add-tag button hover: **"Add a tag — short specifics
  (occupation, training, a defining experience)."**
- Tag remove on hover: **"Remove this tag"** — not "Delete".
- Section save indicators: a tiny `✓ saved` chip that fades in
  for 1.2s after autosave. No "Save" button anywhere; the tray
  is auto-save throughout to match how `pc-edit` already works.
- Discard / undo: rely on the existing pc-edit replay history.
  Do NOT add a per-tray undo button — the undo surface is
  global (per the AI-write-API M3c shipped pattern).

### Tag chips edge case (5+ tags)

Chips wrap as `flex-wrap: wrap; gap: 4px`. Long tags
("raised by a beekeeper, briefly") do NOT truncate — let them
take the room they need. The input stays on its own line. A
"+5 more" overflow is the wrong shape; chargen has at most
3-5 tags at creation (rules.md:64) and ≤8 with advancement —
never enough for overflow.

## UX-MH-3 design — targeted AI backstory adjustment

### Entry-point

ONE button, NOT two. Place it at the **bottom of the Backstory
section in the MH-2 tray**, beneath the textarea, full width:

```
[ ↻ Refresh backstory ]
   Threads recent edits (name, pronouns, tags) through the prose.
```

Rationale: an inline-next-to-the-field button confuses
intent — "did the user mean refresh-just-this-field or
refresh-everything?" There is only one refresh: it sees the
diff between the *baseline* backstory and the *current*
field values and proposes a surgical edit honouring everything.
That's what the user asked for.

Disable + tooltip when the backstory already matches all fields:
**"Backstory is up to date with current edits."**

### Diff UI

When AI returns, the tray's Backstory section flips into a
**unified inline diff** rendered in the textarea's place:

- Removed text: red strikethrough on light-red background.
- Added text: green underline on light-green background.
- Unchanged text: default body color.
- A small toolbar at the top of the diff: `[ Accept ] [ Try
  again… ] [ Cancel ]`. `Try again…` opens a one-line prompt
  input ("Anything to add? e.g. keep the bookstore reference")
  and re-submits with that hint.

NOT side-by-side. Side-by-side doubles the column count and
breaks tag/pronoun chip layout the tray is already paying for.
NOT a "pulse-then-settle" animation — the user needs to *see*
what changed and decide, not watch motion theatre.

### Consent gate — DM-initiated change to a player's PC

When the DM edits any field on a player's PC and clicks
Refresh, the proposed diff routes to the **player as an
inbox-style notification card** on their chargen surface (not a
modal — modals across the firewall are the canonical "DM
imposed my screen on you" pattern, which violates the player-
owns-voice rule even when the DM is trying to help).

The card shows:

```
┌─ Your DM has a backstory suggestion ─────────┐
│ Your DM updated [pronouns] for Sora and asks │
│ if you'd like the backstory threaded through │
│ to match.                                    │
│                                              │
│ [the diff, same inline format as above]      │
│                                              │
│ [ Accept ] [ Reject ] [ Try again… ]         │
└──────────────────────────────────────────────┘
```

While waiting, the DM sees the same diff in their tray with the
toolbar replaced by **"Waiting for Alice to review… [Cancel
request]"**. Cancel withdraws the proposal cleanly (player's
card disappears).

If the player rejects: the DM sees **"Alice kept the original
backstory. The [pronoun] edit is still applied."** — *no
reason field*. Forcing a player to justify rejection drifts
toward adversarial framing.

### Consent gate — player-initiated change

Same flow, no card to the DM. The player accepts their own
diff directly. The DM sees the change next render (chargen-
dm-review re-renders on `pc-edit`).

### Tag-change branch copy

Tag changes get the same routing as pronoun changes per the
parent decision. The card header changes:

```
Your DM changed a tag for Sora and proposes
this backstory adjustment.
```

(Not: *"…and the AI rewrote your backstory."* The phrasing
locates agency: the DM made the call; the AI proposed prose;
**you decide.**)

### Exact copy strings (8)

1. Refresh button (tray): **"↻ Refresh backstory"**
2. Refresh button hover: **"Threads recent edits (name,
   pronouns, tags) through the prose. Does not regenerate from
   scratch."**
3. Refresh button disabled tooltip: **"Backstory is up to date
   with current edits."**
4. DM-waiting state: **"Waiting for Alice to review… [Cancel
   request]"**
5. Player notification card header (field edit): **"Your DM
   has a backstory suggestion"**
6. Player notification card body (field edit): **"Your DM
   updated {field} for {pcName} and asks if you'd like the
   backstory threaded through to match."**
7. Player notification card header (tag edit): **"Your DM
   updated a tag for {pcName} and proposes a backstory
   adjustment."**
8. DM-sees-rejection: **"Alice kept the original backstory.
   The {field} edit is still applied."**
9. Player-side accept-own action label: **"Accept changes"**
   (not "Apply"; *changes* matches what the diff is showing).
10. Try-again prompt placeholder: **"Anything to add? e.g.
    keep the bookstore reference"**

## Adversarial corners I'd flag

1. **Two-line stack at 5+ seats vertically wastes the rail.**
   Stage-roster's compact one-liner with the dot is the
   safety valve; do NOT replicate the two-line stack into
   stage-roster or the dm-roster-strip. (Locked above; flag
   here because reviewers will push back.)
2. **Tag chip rename in place collides with click-to-remove.**
   Pick: `×` is a separate hover-button on the chip's right
   edge; clicking the chip body opens rename. If the click
   target is ambiguous on touch screens the user picks the
   `×` accidentally and loses a tag. Mitigation: confirm-on-
   tag-remove ONLY for tags that already existed at chargen
   acceptance (i.e. ones the AI may have anchored to in the
   backstory). New, unsaved tags remove without confirmation.
3. **800-word backstory in the diff view.** Inline diff at
   that size still works (it's prose, not code); the colored
   highlights remain skimmable. But the "Try again…" path
   re-renders the diff *over* the now-displayed one — keep
   the previous diff visible during AI in-flight, greyed,
   with a spinner overlay; do NOT clear it. Losing the
   previous proposal because you asked the AI for "one more
   tweak" is the rage-quit case.
4. **DM offline mid-refresh.** AI request is in flight on the
   DM's tab, DM disconnects. Two failure modes: (a) the
   request completes and the proposal can't reach the player
   (no problem — player sees nothing, no leak); (b) request
   completes after DM reconnects, proposal lands stale
   against further player edits in the interim. Mitigation:
   the proposal payload includes the baseline backstory hash;
   if the player's current baseline differs, the player card
   shows **"This suggestion was made against an older version
   of your backstory. [View anyway] [Discard]"** — explicit,
   not silent.
5. **Slow AI response (20s+).** The DM's tray toolbar should
   show progress; copy: **"Threading… typically 10-20 seconds"**
   (matches the existing :2323 copy verbatim — minimizes test
   churn per the brittle-copy radar). After 30s, offer
   **[Cancel]**.
6. **Player presence: card shown when player offline.** The
   notification card persists across player reconnect (it's
   an event in the log; the player sees it when they next
   load chargen). No silent expiry. The DM's waiting state
   shows **"Alice is offline. They'll see this when they
   return."** — honest disclosure that the gate is real.
7. **`includeDmNotes` on a DM-initiated refresh.** Per
   ai-player-facing-scope, the diff goes to the player; the
   AI call MUST hardcode `includeDmNotes:false` *even though
   the DM is the one initiating it.* The output is
   player-facing the moment it crosses to the player card.
   Regression test: assert that the AI request for a
   DM-initiated Refresh has `includeDmNotes:false`.
8. **Tag-rename masquerading as a remove+add.** If the DM
   clicks chip body, edits "climber" → "boulderer", we should
   emit a single rename op (one event), not remove + add (two
   events) — otherwise the player sees a flicker where the
   tag briefly vanishes from the visible list. character-
   edits.ts doesn't currently support array ops on tags
   (L31-35); this is a prerequisite engine change for MH-2's
   tag editor. Flag for the engineering reviewer.

## Open product calls for the human

1. **Tag-chip remove confirmation default.** I picked
   "confirm only on tags that existed at acceptance." If you
   want zero-confirmation throughout (favour speed of edit),
   say so — both shapes are defensible.
2. **Inbox card vs toast for player notification.** I picked
   a persistent inbox card on the chargen surface to honor
   the silent-firewall principle (a toast in the play loop
   would interrupt the player mid-scene; a card on chargen
   surfaces only when they go look). If you'd rather have a
   subtle "new" dot on the chargen tab so the player notices
   without opening it, that's a small addition. Default: yes
   to the dot.

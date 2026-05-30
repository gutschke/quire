# Mock Campaign 04 — Chargen spoiler authorship through save/restore

## Scenario brief

A returning player drafts their backstory in chargen.  The campaign
has a prophecy arc as a DM-only thread.  The player — who has
absorbed genre cues from their friend the DM dropping vague hints —
writes a backstory line that mentions "the Quiet" (the locked
spoiler token for this campaign per `project_quire_world` +
`feedback_silent_player_firewall`).  The player has no idea this
is a campaign-level spoiler; they're just leaning into the world's
aesthetic.

The system MUST:

- Allow the draft to land in the DM's review queue (the firewall
  doesn't refuse player content — players author their own truth).
- Show the DM an amber spoiler chip on the offending answer so the
  DM can decide what to do.
- NOT warn the player.  Per `feedback_silent_player_firewall`,
  telling the player they hit a spoiler IS itself a spoiler.

Save/restore boundary makes this load-bearing:

- The DM saves mid-chargen (a player has delivered their pack but
  the DM hasn't yet accepted).  Closes the tab.  Reopens next
  week.  Pulls the cloud save.  The pending pack must still surface
  with the amber spoiler chip.
- The player has been disconnected (closed their tab).  Their draft
  must survive the round trip — they pick up exactly where they
  left off when they reconnect.

This campaign is the chargen-side analog of mock campaign 02 (which
covered the live-play firewall).  Together they cover the two
"player content" surfaces — drafts at chargen + active play —
across the save/restore boundary.

## Driving approach

**Code-level simulation** at
`src/persistence.simulation-04-chargen-spoiler.test.ts`.  Drives the
production `Peer` + `InMemoryNetwork` + real save/restore primitives
through the per-turn script.  The spoiler-scan helper
(`containsSpoilerTokens` from `src/ai/spoiler-check.ts`) is invoked
directly to mirror what `chargen-dm-review` does at render time.

Why not Playwright: the firewall lives in the engine layer
(`filterForViewer` + `serializeSessionForViewer` + the materializer
for `chargen-pack-deliver`).  The amber chip is a render-time
projection of `state.pendingChargenPacks` × the campaign's
`spoilerTokens` array.  All of these survive a code-level simulation
that drives the same primitives the UI calls at render.

## Per-turn script

### SESSION 1 — Player drafts a pack with a spoiler token

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 1 | DM (markus) | `coordinator-claim` + 2 `seat-add`s for slots 1+2 | DM coord; 2 empty seats. |
| 2 | DM | DM has DM-only scratch-note pinned: "Prophecy: Anya is the chosen one" | DM-only state. |
| 3 | Player (anya-player) | Joins via invite; lands on chargen route slot 1; drafts a pack. | Pack draft lives in `state.pendingChargenPacks` (after delivery). |
| 4 | anya-player | `chargen-pack-deliver` with: chosenPath=qa; answers={`intent-moment`: "I felt the Quiet stir when my dad lost his job.", `meaningful-item`: "a brass key"}; bondDrafts=[]. | State materializes the pack into `state.pendingChargenPacks`. |
| 5 | DM's chargen-dm-review render | Scans the answer with `containsSpoilerTokens(value, ['Quiet'])` → returns `['quiet']` for the intent-moment answer; empty for meaningful-item. | DM sees the amber chip rendering on intent-moment ONLY. |
| 6 | Player render | Player's `filterForViewer` projection: `pendingChargenPacks` is a coord-only state field (review queue is DM private). | Player sees NOTHING about the spoiler scan.  Per silent-player firewall. |

### Save boundary — DM pushes the active session

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 7 | DM | `serializeSession` of full DM-coord log → push to folder. | Save file lands.  DM save contains the pack-deliver event. |
| 8 | Mei (autosave path) | n/a — Mei isn't joined yet for this campaign in session 1. | n/a |
| 9 | Player (anya-player autosave path) | `serializeSessionForViewer` for the player's autosave. | Player's autosave keeps her OWN chargen-pack-deliver event (her own draft).  Does NOT contain DM scratch-note. |

### SESSION 2 — DM reopens; the pack still surfaces with chip

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 10 | DM | Fresh world; pull from folder; parse; project for coord (no-op); apply events. | DM state rehydrates; `state.pendingChargenPacks` has the player's pack. |
| 11 | DM's chargen-dm-review render | Same scan as beat 5. | Amber chip persists. |
| 12 | Player (anya-player rejoins) | sync-request → sync-response; OP-039 firewall strips PLAYER_SCOPE_STRIP_KINDS. | Player's raw log has no scratch-note. |
| 13 | Player (anya-player) | Looks at her own chargen surface. | Her draft is recoverable from the pack the DM still holds (she'd typically be re-rendering chargen UI from her own localStorage cache, but the in-engine state.pendingChargenPacks is the truth as held by the DM). |

## Invariants asserted

- **A1 (DM-side render):** Spoiler chip surfaces on the spoiler-
  laden answer + does NOT surface on the clean answer (beat 5 +
  beat 11).
- **A2 (player-side render):** Player has no `state.pendingChargenPacks`
  in their filtered state (review queue is DM-private).
- **A3 (scratch-note firewall):** DM scratch-note does NOT appear in
  player's filtered state, raw log, or save projection — pre-restore
  AND post-restore.
- **A4 (save round-trip determinism):** Stringified pulled save
  equals stringified pushed save byte-for-byte.
- **A5 (pack survives restore):** After restore, the DM's
  `state.pendingChargenPacks` still contains the player's pack with
  the spoiler-laden answer intact.
- **A6 (silent-player firewall):** The player's PRE-save and POST-
  save filtered state never contains the spoiler scan result, the
  spoiler-token vocabulary, or any reference to the prophecy arc.
- **A7 (sync-response firewall hardening — late-joining player):**
  A fresh player joining post-restore gets neither the DM scratch-
  note NOR the spoiler vocabulary via sync-response.

## Findings

### FINDING-A (sanity-confirmed)

Silent-player firewall HOLDS across the save/restore boundary for
chargen drafts.  All invariants A1-A7 verified by the two passing
sub-tests in `src/persistence.simulation-04-chargen-spoiler.test.ts`:

- DM sees the amber chip on the spoiler-laden answer pre- AND
  post-restore (A1 + A5).
- Player's filtered state contains no spoiler vocabulary at any
  point (A6).
- Cross-PC firewall: a fresh player joining post-restore via
  sync-response gets neither the DM scratch-note nor the spoiler
  vocabulary (A7).
- Save round-trip byte-determinism preserved (A4).

### FINDING-B (sanity-confirmed)

Player draft survives the player's own autosave-restore round trip.
A returning player on a fresh device who restores from her own
autosave gets her own pack back materialized.  This is the
counterpart of "DM-coord save is the canonical store" — the
player's autosave is still valid for HER OWN content.

### FINDING-C (chargen workflow note, NOT a bug)

`pendingChargenPacks` projection wipes the answers from the sender's
view AND the destination PC bind is what reconnects a returning
player to her draft in the chargen UI (the chargen surface reads
from the player's localStorage chargen state — `pcSlots` + the
chargen pack draft cache — not directly from
`state.pendingChargenPacks`).  Save/restore preserves the deliver
event so the DM's queue stays intact; the player's UI re-hydrates
from her own client-side chargen cache.  No new save/restore
infrastructure needed.

### FINDING-D (potential UX wart, follow-up)

A player who closes her tab mid-draft AFTER delivering the pack
gets a slightly confusing experience on reconnect: the DM's review
shows her pack with the placeholder pip, but she doesn't see her
own answers echoed back in `pendingChargenPacks` (by design — the
sender's projection wipes the answers).  Her chargen UI sources her
draft state from local chargen storage, not from
`pendingChargenPacks` — so this is invisible to the player in the
typical case.  But if her local chargen state is wiped (browser
cleared site data on the player's device while the DM still holds
the pack in their save), her draft is irretrievable from the
DM-coord side (the deliver event is in the save, but the projection
strips it for her on render — she'd see her placeholder pip but no
content to edit).

Filed as a follow-up note rather than OP — the recovery path
(deliver again from blank chargen) IS available, and the data-loss
window is "player wipes their device between deliver and DM-accept,
without the player still being able to reauthor."  Sub-P3 in the
DEC-023 class-2 framing.

## Why this campaign matters for playable release

Chargen is the FIRST encounter most players have with a Quire
campaign.  A spoiler leak here permanently shapes the player's
mental model — they can't "un-know" they hit a campaign secret on
their very first interaction.  The silent-player firewall is the
single most prime-directive-load-bearing invariant Quire ships;
mock campaign 04 is its save/restore boundary stress test.

A pack-deliver event sitting in the DM's pending queue is the
canonical example of "player content the firewall protects in both
directions":

- The player authored it (player content; player has agency).
- The DM consumes it (DM gets to decide what to do; spoiler chip
  is the DM-only affordance).
- The player must NEVER perceive the scan happened OR the DM's
  decision tree (silent-player firewall).

Across save/restore, all three of these properties must hold
without leakage, both for the DM's pull-and-resume workflow AND for
a player joining fresh after the DM has restored.

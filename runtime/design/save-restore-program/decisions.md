# Save/Restore Program Decisions

Append-only. Never edit a prior entry — supersede with a new entry that
references the prior. Format:

```
## DEC-NNN — title (YYYY-MM-DD)

**Decision:** ...
**Why:** ...
**Alternatives:** ...
**Tradeoffs:** ...
**Revisit if:** ...
```

---

## DEC-044 — DM operational view surfaces `pc-revoke` behind a per-seat "Manage seat ▾" disclosure (2026-05-30, run #18)

**Decision:** the `pc-revoke` UI affordance lives ONLY in the DM
operational view (`appMode === 'dm-operational'`), on a per-seat
collapsible disclosure that surfaces two destructive options for
bound-active seats:

- **Reset character (recast)…** — `variant === 'reset-character'`,
  default `narrativeShape === 'recast'` in the dialog.
- **Remove player from this seat…** — `variant === 'remove-player'`,
  default `narrativeShape === 'offstage-forever'` (DM can switch
  to `never-arrived`).

Both routes open `<pc-revoke-confirm-dialog>` (a fresh primitive
modelled on the run-#17 `<start-fresh-confirm-dialog>` idiom: light
DOM, custom backdrop, default-focused Cancel, Escape resolves
null).  The dialog body explicitly names the silent-player
firewall ("Your players won't be told this happened") so the DM
consents to the firewall in action.  Bond tombstone configuration
(stand-in name + optional NPC reassignment) lives in the same
dialog as a second fieldset.

Confirm dispatches a `pc-revoke-request` CustomEvent up to the
host (`<quire-app>`), which routes through `handlePcRevokeRequest`
→ `appendPcRevoke` → engine event.

**Why:** the TTRPG expert advisory locked this placement (Q7):
- Not chargen-dm-review — the need spans into early sessions, not
  just pre-chargen.
- Not the live session-roster header — anything that breaks scene
  momentum is a UX bug (Riley persona); revoke is between-sessions
  work.
- The DM operational view already houses destructive-shaped
  operations (Start fresh, Disconnect, cloud-push consent) and
  groups revoke with peers in cognitive shape — *things the DM
  does to the campaign's shape, not its fiction.*

The two-step confirm gate mirrors DEC-037 (Start fresh) for
consistency.  Reusing the run-#17 dialog idiom (NOT `<quire-modal>`
which would re-introduce the LL-3 light-DOM `<slot>` failure mode)
keeps the surface predictable.

**Alternatives:**
- Surface revoke from the session-roster header (active play).
  Rejected per Q7 — scene-momentum hazard.
- Surface only from chargen-dm-review.  Rejected — bounds the
  affordance to a pre-chargen window the user explicitly said it
  needs to outlive.
- One destructive button with a narrativeShape picker.  Rejected —
  the `reset-character` vs `remove-player` axis is the DM's mental
  model (the choice is "which problem am I solving?", not "what
  narrative framing do I want?"); the destructive button's label
  should match that mental model directly.

**Tradeoffs:**
- The launcher chip + Esc-to-close discovery path remains the same
  as before; no new entrypoint surface.  Run #18 doesn't add an
  in-app discoverability cue for the new affordance — DM finds it
  via the operational view, same as backups.  Followup if playtest
  surfaces a discoverability gap.
- Per-bond decisions defer to a future iteration: today the
  dialog applies one tombstone name + one optional NPC
  reassignment uniformly across all inbound bonds.  Per-bond
  routing would be a bigger UI; tracked as a follow-up.

**Revisit if:** playtest surfaces (a) DMs missing the affordance
entirely (discoverability), or (b) DMs needing per-bond tombstone
choices (per-bond UX).

---

## DEC-043 — `pc-revoke` engine primitive for player removal / PC rebirth (2026-05-30, run #18)

**Decision:** ship `pc-revoke` as a new coord-only event kind,
distinct from `pc-retire` / `pc-archive`.  Payload shape:

```ts
interface PcRevokePayload {
  v: 1;
  pcId: string;
  slot: number;
  narrativeShape?: 'never-arrived' | 'offstage-forever' | 'recast';
  causedByPeerId?: PeerId;
  bondTombstoneName?: string;
  bondTombstoneNpcId?: string;
}
```

Materializer (per Q5 expert advisory + DEC-030 firewall-tolerance):
1. Seat → `revoked` SlotState (sticky-N preserved).
2. `delete state.synthesizedPcs[pcId]`.
3. Clear DM-private per-PC state: `pcAccidentalGrants[pcId]`,
   `casterState[pcId]`, `threadDebt[pcId]`, `pcFoci[pcId]`,
   `pcEdits[pcId]`.  (DEC-041.)
4. Outbound bonds (`pcBonds[pcId]`) dropped; outbound proposals
   (`pcBondProposals[pcId]`) dropped.
5. Inbound bonds tombstoned with DM-supplied stand-in name + optional
   NPC id; inbound proposals (un-ratified) dropped.
6. Retire-flow leftovers (`pcRetireRequests`, `pcRetireRejections`
   for the pcId) cleared.
7. `peers[*].pcId === pcId` claims cleared (surgical — DO NOT
   emit `peer-leave`; the peer may still be a guest after recast).

`narrativeShape` is DM-only authorial framing; stripped from
non-coord saves by `scrubRevoke` / `REVOKE_DM_ONLY_PAYLOAD_FIELDS`.
The materializer tolerates absence per DEC-030's contract (treats
as safe default `offstage-forever` — equivalent player projection
since all three shapes leave the seat in `revoked`).

For recast, the DM follows up with `pc-create` + `pc-slot-bind`:
the already-permissive `pc-slot-bind` materializer transitions
`revoked` → `bound-active` naturally with no extra wiring.

**Why:** the TTRPG expert advisory (Q1 + Q6) locked this as a
distinct event kind, not a `pc-retire` extension.  `pc-retire`'s
invariant is *the PC is preserved as a referenced narrative
entity* (memorialized via `seatMemory` + `inFictionRetireReason`).
`pc-revoke`'s invariant deliberately violates that — the PC is
ERASED for the `never-arrived` case (chair empty from the start) +
the recast case (new PC always was the one in the story).
Conflating would force the DM to choose between "honest in-
fiction" (memorial visible) and "actually gone" via copy-overload
on one event — the conflated-affordance shape the firewall
punishes.

One atomic event per Q5: composing `pc-archive` + `peer-leave` +
`pc-create` atomicity-breaks across the firewall (three independent
materializations produce a brief "Mei is here / Mei is gone / new
PC arrived" flicker in roster diffs — exactly the leak Q10 warns
about).  Precedent: `pc-mark-realization` (multi-field batch
collapsed into one event for the same atomicity reason).

**Alternatives:**
- Extend `pc-retire` with a `revoked` enum value.  Rejected per
  the conflated-affordance shape above.
- Compose `pc-archive` + `peer-leave` + `pc-create`.  Rejected per
  atomicity-break above.
- Don't ship anything; tell DMs to manually edit the save file.
  Rejected per the user's explicit ask + the prime directive (the
  engine should help the DM tell a clean retold story).

**Tradeoffs:**
- `narrativeShape` is purely advisory — the player projection looks
  identical for all three shapes.  Future-proofing: if the DM
  surface ever wants to render narrative-shape-specific framing on
  the DM operational view's history, the field is there.
- `revoked` SlotState is a new top-level state (see DEC-039).
- Causes a one-time observable change to the player's roster
  (Q10): the revoked PC's `synthesizedPcs` entry disappears.
  Acceptable under the civilized-peer threat model; the DM picks
  the in-fiction explanation in chat.

**Revisit if:** playtest reveals the need for `pc-revoke-request`
(player-initiated revoke; see DEC-042) or per-bond tombstone
decisions in the dialog.

---

## DEC-042 — No `pc-revoke-request` (player-initiated revoke) in v1 (2026-05-30, run #18)

**Decision:** the v1 of `pc-revoke` is coord-only.  No
player-initiated `pc-revoke-request` event exists.

**Why:** TTRPG expert advisory Q5 + open product call 4:
"Players asking to erase themselves from the story is a table
conversation, not an engine primitive.  `pc-retire-request`
covers the common case of 'I'd like my PC to step offstage' —
revoke is for the harder out-of-game churn cases (vanished
player, unhappy player → recast) which require DM judgment AND a
table conversation BEFORE the engine event fires.  Building a
request flow without that table conversation as the rate-limiter
risks players normalising 'request a revoke' as a routine
affordance — bad for the empathy-of-table-design axis."

The user's verbatim ask was about the DM's affordance ("we
absolutely need the ability to clearly wipe out a player"); they
did not ask for a player-initiated path.

**Alternatives:**
- Mirror `pc-retire-request` with a `pc-revoke-request` +
  `pc-revoke-reject` pair.  Rejected per the empathy-of-table-
  design rationale above.

**Tradeoffs:**
- Rare-but-real "I'm uncomfortable with how this turned out"
  cases require an out-of-band DM ping (chat / DM message / out-
  of-game conversation).  Acceptable; the alternative (in-engine
  request affordance) risks normalising the move.

**Revisit if:** playtest surfaces repeated friction around the
table-conversation handoff (player wants to flag the revoke
desire without speaking up in front of the table).

---

## DEC-041 — `pc-revoke` clears the DM-private magic-discovery log for the pcId (2026-05-30, run #18)

**Decision:** `applyPcRevokeEvent` deletes `pcAccidentalGrants[pcId]`
+ `casterState[pcId]` + `threadDebt[pcId]` + `pcFoci[pcId]` +
`pcEdits[pcId]` along with the `synthesizedPcs[pcId]` entry.  The
new (or absent) PC starts fresh.

**Why:** TTRPG expert advisory Q2 + Q9 Underleaf-specific note +
open product call 3: "Engine-true answer is yes; table-true
answer might be the DM wants to keep it as a note for the new PC's
chargen.  I lean engine-true."  We took the engine-true default.

The magic-discovery accidental-cast log (rules.md:178) is a per-PC
narrative record of "the PC did magic things they didn't realize
were magic."  Carrying it over to the recast PC would mean the
new player is implicitly handed an arc they didn't author —
contrary to the Player owns voice principle of the chargen
authorship division.  For `never-arrived` / `offstage-forever` the
PC entry is gone anyway, so the question is moot.

**Why ALL DM-private per-PC state, not just the magic log:**
`casterState`, `threadDebt`, `pcFoci`, `pcEdits` are all
similarly per-PC; leaking any of them across a revoke creates a
phantom-PC hazard.  Easier to nuke the lot than maintain a
selective allowlist — and any of these surviving would render
weirdly on the new PC's sheet.

**Alternatives:**
- Keep the magic log + clear everything else.  Rejected per the
  authorship-division rationale above.
- Keep nothing per-PC + leave it to the DM to re-create on the
  new PC.  Same as the chosen approach (the new PC starts at
  zero); the DEC just documents WHICH per-PC structures get
  cleared.

**Tradeoffs:**
- If a DM WANTS to preserve a magic-discovery note for the
  recast PC's chargen, they have to save it out-of-band (DM
  notes / scratchpad) before the revoke.  Acceptable; this is the
  rarer case.

**Revisit if:** playtest reveals DMs reaching for the prior magic
log on recasts frequently enough that the workflow friction
matters.

---

## DEC-040 — Bond reassignment is existing-NPC only in v1 (no on-the-fly NPC create) (2026-05-30, run #18)

**Decision:** the `<pc-revoke-confirm-dialog>` accepts an
`availableNpcs` list from the host + lets the DM pick one as the
bond reassignment target.  The dialog does NOT support on-the-fly
NPC creation; that lands later via the M4 living-doc workflow.

The host (`<quire-app>`) passes an empty `availableNpcs=[]` today
because Underleaf's NPC store (`synthesizedNpcs`) is a future
addition — the dialog falls back to the free-text stand-in name
input.

**Why:** TTRPG expert advisory open product call 2: "I'd recommend
existing NPCs only for v1; on-the-fly create can ride the M4
living-doc workflow later.  Product call about how much chrome
the dialog needs."  We took the existing-only default.

Building an in-dialog "Create a new NPC named X with backstory Y"
form would multiply the dialog's footprint + couple it to the
not-yet-existent NPC authoring surface.  The free-text stand-in
name covers the immediate need (the bond reads "(former friend)
Mateo" rather than vanishing or dangling).

**Alternatives:**
- Inline NPC creation in the dialog.  Rejected per dialog-bloat +
  scope.
- No NPC reassignment at all (pure free-text tombstone).  Rejected
  — when the campaign DOES have NPCs (M4+), reassigning to a real
  NPC is the highest-craft mitigation per Q3 (bond text drifts
  smoothly rather than vanishes).

**Tradeoffs:**
- v1 DMs without an NPC store get only the free-text stand-in
  name option.  Fine; that's the right shape for the playtest
  table.

**Revisit if:** M4 lands a living-doc NPC store + the dialog
should pull from it; or the dialog's chrome should grow to
include in-line NPC creation.

---

## DEC-039 — Two new SlotStates (`unbound-revoked` + `bound-recast`) collapsed to ONE: `revoked` (2026-05-30, run #18)

**Decision:** the TTRPG expert recommended two new `SlotState`
values (`unbound-revoked` + `bound-recast`) to avoid a brief
flicker during the recast handoff.  We collapsed both into a
single `revoked` state.

**Why (divergence from default):** the recast flow is two events:
`pc-revoke` (slot → `revoked`) followed immediately by
`pc-create` + `pc-slot-bind` (slot → `bound-active`).  The two-
state design would have `pc-revoke` route to `bound-recast` (slot
holds the OLD pcId as a placeholder during chargen) vs
`unbound-revoked` (slot empty for vanished-player).

Walking the materializer + sticky-N + bond-rewrite paths
revealed two facts:

1. **`bound-recast` as a holding state requires the materializer
   to know which `pc-revoke` is followed by a chargen flow.**
   That information isn't in the event payload — it's a UI
   pattern.  Encoding it in the SlotState pushes the UI's
   "what does the DM intend next?" into the engine, exactly the
   anti-pattern the playbook warns against.

2. **The flicker the two-state design avoids is observable in
   ~one render tick** between `pc-revoke` materialization and
   `pc-slot-bind` materialization for recast.  Both events land
   atomically in the DM's session log; the player's projection
   sees the seat in `revoked` for a single frame, then
   `bound-active` with the new pcId.  In practice the recast
   flow involves chargen authoring (minutes), so the seat is
   genuinely in `revoked` for the full chargen duration.  The
   one-tick atomic-flush flicker concern doesn't apply.

The expert called this "engineering judgment, not TTRPG
judgment" — exercising that judgment, the simpler single state
wins.

**Alternatives:**
- Two SlotStates as the expert recommended.  Rejected per above.
- Reuse `unbound`.  Rejected — sticky-N requires the slot to be
  present (so the integer doesn't renumber), and `unbound` would
  conflate the "never had a player" case (empty seat for an unsold
  seat) with the "had a player; we wiped them" case (deliberate
  revoke).  The DM operational view's "Manage seats" surface uses
  `revoked` to render explanatory text on the row — would be
  ambiguous if collapsed into `unbound`.

**Tradeoffs:**
- Single-tick flicker on recast (see above).  Mitigated by
  chargen duration in practice.
- The `revoked` state needs its own seat-card rendering ("Open
  seat") + restoration of the right behavior from the operational
  view (no destructive affordances for revoked seats; the row
  shows an explanatory message instead).  Both wired in this run.

**Revisit if:** the flicker becomes user-visible (DMs report
"Mei flashes back as 'revoked' before the new PC appears"); the
mitigation would be the two-state design after all.

---

## DEC-038 — `<quire-modal>` wraps the host's children in a real `<dialog>` (2026-05-30, run #17 emergency)

**Decision:** `<quire-modal>` no longer relies on `<slot>`
distribution.  Instead, on connect (and on every subsequent
mutation), it moves all of the host element's direct children
into a single `<dialog class="quire-modal-dialog">` that it
appends as the sole top-level child.  The host's `class`
attribute is mirrored onto the inner `<dialog>` so per-region
CSS targeting (e.g. `.chargen-dm-review-retire-modal { padding,
border, background, … }`) styles the dialog frame itself —
which is what enters the top layer when `showModal()` is
called.  A MutationObserver catches dynamically-added children
(typical of Lit re-renders) and re-parents them too.

**Why:** the product owner hit a P0 during a playtest dry-run:
"Trying to 'retire' the existing PC brings up a white frame in
the middle of the screen, but I can't do anything to actually
confirm."  Root cause: `<quire-modal>` rendered
`<dialog><slot></slot></dialog>` into the host's LIGHT DOM, but
`<slot>` only distributes inside a shadow root.  The host's
children rendered as SIBLINGS of the empty `<dialog>`, so
`showModal()` promoted the empty dialog to the top layer while
the form content stayed in the normal flow — hidden behind the
backdrop.  All four chargen-dm-review modals (review / edit /
retire / revise) shared the bug; the user just hadn't tried
the others in a flow yet.

The slot-distribution failure was invisible to happy-dom
tests because happy-dom does not implement showModal()'s
top-layer semantics — every node was reachable via querySelector
regardless of whether it would actually surface in production.

**Alternatives:**
- Shadow-DOM the `<quire-modal>`.  Rejected: per-region CSS
  (`.chargen-dm-review-retire-modal`) cannot reach into a shadow
  root without `::part` / CSS variables; every caller would need
  to be migrated.  Significantly larger diff during an emergency
  fix.
- Render the form content as a property (`.content=${html\`…\`}`)
  instead of children.  Rejected: every caller's site needs
  rewriting; same blast radius as the shadow-DOM approach.
- Use a portal pattern (e.g. moving content to body on open).
  Rejected: Lit reconciliation gets confused when its template
  markers move outside the parent component's render root.
- Don't extract the modal primitive; let each caller manage its
  own `<dialog>`.  Rejected: regressing the Phase 3a extraction
  defeats the design's point and re-introduces the four-way
  duplication.

The chosen approach keeps the existing caller surface identical
(`<quire-modal class="…"><div>…</div></quire-modal>`) and only
changes the internal mechanic.  Zero caller-site changes
required.

**Tradeoffs:**
- MutationObserver fires on every child-list mutation.  The
  observer body is cheap (Array.from + conditional moves), and
  Lit's reconciliation already minimizes child-list mutations,
  so this is well under any performance threshold.
- The `<dialog>` is created lazily and persists for the host's
  lifetime — fine because the modal is a singleton per host
  element.

**Revisit if:** we adopt a different modal primitive (e.g. an
HTML Popover-API-based one) or migrate to shadow DOM with
themeable CSS variables.  Both would naturally supersede this
decision; until then, the dialog-wrap stays.

---

## DEC-037 — Start fresh routes through a two-step confirm gate (2026-05-30, run #17)

**Decision:** Every "Start fresh" affordance — the
resume-prompt button AND the cross-device probe button — opens
the host-owned `<start-fresh-confirm-dialog>` before doing any
destructive work.  The dialog is mandatory even for the
locally-safe variant (the cross-device probe) because the
button label is identical to the destructive variant and the
user can't tell them apart by reading the label alone.

The dialog spec carries a `variant` field (`'destructive'` /
`'safe'`) so the body copy correctly names what will be
discarded (or, in the safe variant, that nothing will be
discarded).  The destructive variant also surfaces the event
count of the staged save so the DM can gauge "how much is at
risk."

Default focus is the Cancel button — a misclick / stray Enter
press resolves as Cancel, NOT as Confirm.

**Why:** the product owner ran a dry-run on 2026-05-30 and
discovered the resume-prompt "Start fresh" button fires a
destructive (silently broken) clear with no confirmation.  A
single misclick discards months of progress.  The v3
consultants signed off PLAYTEST GREEN without walking this
surface — the unit test that pinned the dismiss handler asserted
exactly the line of code that was broken, so it passed.

**Alternatives:**
- Confirm only the destructive variant.  Rejected: defense-in-
  depth requires confirming both because the user can't tell
  them apart, and the confirm modal is cheap.
- Use `window.confirm()` instead of a custom dialog.  Rejected:
  inconsistent chrome with the rest of the app + no way to
  surface the event count + accessibility concerns.
- Make Start fresh a hotkey-only affordance with no button.
  Rejected: the button is the discoverable surface; hiding it
  drives users to manually delete localStorage, which is worse.

**Tradeoffs:** one more click for a DM who genuinely does want
to start fresh.  Mitigation: the dialog auto-focuses Cancel so
the DM keyboard path is "click → Tab → Enter" — same number of
keypresses as a single confirmed click.

**Revisit if:** a DM workflow accumulates many "Start fresh"
clicks per session (the playtest will tell us).  Today's bar:
DM Start fresh is a campaign-lifetime event, NOT a session-
lifetime one — adding a click is fine.

---

## DEC-036 — Start fresh clears 6 carriers as an orchestrated unit (2026-05-30, run #17)

**Decision:** `startFreshForCampaign(campaign)` is the single
orchestrator that fires after the confirm modal resolves true.
It clears six carriers in a deliberate order:

1. **Live session teardown via `announceLeaveAndExit()`** when
   a session is active.  This fires `peer-leave` on the wire
   FIRST so other peers update their roster, then flushes the
   autosave + tears down the local session.  When no session is
   active, calls `leaveSession()` directly for the in-memory
   resets it performs.
2. **localStorage autosave key** (`quire.save.<owner>-<repo>`)
   removed.  This is the user's exact bug carrier: the prior
   session's events (including `pc-create` for the leftover
   PC + `peer-join` for the stale DM peer) lived here.
3. **Chargen drafts** (`quire.chargen.<slug>:slot1..9`) cleared
   for every possible slot.  On a shared dev machine the drafts
   can repopulate a "fresh" session; on real player devices a
   real player should never see a DM's Start fresh, so this is
   safe.  Surfaced in the confirm modal copy.
4. **Staged prompts** (`resumePromptDoc` + `crossDeviceProbeMatch`)
   cleared so the surfaces don't re-render against nulled
   downstream state.
5. **Cross-device probe guard** reset so the next landing
   re-probes — if a folder is connected with a cloud backup,
   the DM should be re-offered "Load it."  Start fresh
   deliberately does NOT mutate cloud copies (DEC-015).
6. **`loadedExtraFields`** explicitly cleared.  `leaveSession`
   already does this, but if a future refactor splits the
   leaveSession cleanup, the Start fresh contract holds
   regardless.

**Why:** the carrier walk found six distinct places state lives
across "Start fresh."  Without a single orchestrator, each
button would have to duplicate the list and any future button
would forget at least one.  DRY this up at the right altitude
so the contract is checkable by inspection.

**Alternatives:**
- Inline the clears in each button.  Rejected: drift waiting
  to happen.
- Hide the clears in `leaveSession`.  Rejected: leaveSession is
  the CLEAN-shutdown path that preserves autosave for the next
  resume.  Start fresh is the DESTRUCTIVE path.  Conflating
  them breaks the resume-after-leave contract.
- Skip the cross-device probe reset.  Rejected: the DM should
  be re-offered "Load it" on a deliberate re-landing.

**Tradeoffs:** chargen draft clearing on a shared dev machine
can wipe a DM-helper's in-progress draft.  Mitigation: surface
this in the confirm modal copy.  In production with real
players on real devices, the players' chargen drafts live on
DIFFERENT browsers — Start fresh on the DM's device doesn't
touch them.

**Revisit if:** a DM reports that Start fresh wiped a chargen
draft they wanted to keep.  Then either narrow the clear
(per-campaign-NOT-per-slot? per-session?) or make it opt-out
in the confirm modal.  For the playtest, the wider clear is
the safer default.

---

## DEC-035 — Player-digest in-memory seen-marker resets on campaign navigation + leaveSession (2026-05-30, run #16)

**Decision:** `playerLastSeenDigestTsInMemory` (the
process-scoped mirror of the per-campaign persisted seen
marker introduced in DEC-033) MUST be reset to `0` on:

1. `navigateToRoute` slug-mismatch branch (cross-campaign
   navigation while the browser tab stays open).
2. `leaveSession` (clean home-route / session shutdown).

The persisted localStorage key is owner+repo-scoped so it
already isolates correctly across campaigns; the in-memory
mirror is a global instance field whose stale value would
otherwise suppress campaign B's recap if B's latest digest's
ts < A's dismissed marker.

**Why:** Adversarial v3 H-1 (`review-history/adversarial-
run15-fixes-2026-05-30.md`).  Single-campaign playtest 1 does
not trigger this; the fix is two lines and trivially safe to
ship before playtest so the multi-campaign DM workflow works
correctly on day one.

**Alternatives considered:**
- Eliminate the in-memory mirror.  Rejected: the mirror is
  belt-and-suspenders for the "player joined before
  getCurrentCampaign() resolves" race (DEC-033's rationale).
- Per-campaign in-memory map.  Rejected: complexity, no
  benefit over reset-on-navigate.

**Tradeoffs:** None — the persisted seen-marker is the
load-bearing one; the mirror is a race-window patch.

**Revisit if:** A future surface relies on the in-memory
mirror persisting across navigations (e.g. cross-campaign
"global notifications").  None today.

---

## DEC-034 — Digest-draft discard-and-load on campaign-slug change (2026-05-30, run #16)

**Decision:** When `<session-digest>`'s `campaignSlug`
property changes mid-life (host re-renders with a different
campaign), the component:

1. Cancels any pending debounced persist timer.
2. Clears the in-memory draft + error message +
   generatedByResponseId.
3. Loads the new slug's persisted draft (if any).

This is the **discard-and-load** semantic.  The current draft
(if any) belongs to the PRIOR campaign and is preserved in
localStorage under the prior campaign's key — it will surface
again when the DM returns to that campaign.

**Why:** Adversarial v3 H-2 (`review-history/adversarial-
run15-fixes-2026-05-30.md`).  The run-#15 `loadPersistedDraft`
early-returned if `this.draft.length > 0`, leaving the prior
campaign's draft visible on the new campaign's editor surface
AND the next keystroke would persist campaign A's text under
campaign B's storage key.  Threat-model-wise this is on-DM-
device only (no peer leak), but a DM running two campaigns
from one browser would cross-contaminate drafts and could
accidentally Save A's recap into B.

**Alternatives considered:**
- Prompt the DM ("Discard the in-progress draft?").  Heavier;
  matches the chargen pattern, but a campaign-slug change is
  not the same load-bearing decision as chargen rename — the
  campaign change IS the decision.
- Merge the drafts (concatenate or interleave).  Nonsensical
  for recap prose.
- Preserve the draft "in case the DM meant the slug change
  to be transient."  Rejected: the slug change IS the
  authoritative campaign identity — preserving means leaking.

**Tradeoffs:** A DM who types a draft for campaign A, then
switches to campaign B BEFORE the 750ms debounced save has
fired, loses the unsaved keystrokes for A.  This is the
same boundary as `disconnectedCallback` (already flushes
pending), but the campaign-switch path runs synchronously
through `updated()` before the next tick fires the timer.
Acceptable: the DM's intent on a campaign-switch is "I'm
done with A's surface" by construction, and the typical
DM workflow finishes the draft before switching.

**Revisit if:** Real DM usage shows the campaign-switch
data-loss boundary biting (then add a flush-pending-save
step before the discard).

---

## DEC-032 — Scrubber rename-firewall narrows to FIELD_NAME_KEYS + extends to bond-ratify + pc-create (2026-05-30, run #15)

**Decision:** Revise the run-#14 rename-firewall defense in two
ways per the adversarial v2 review:

1. **Narrow the scan from "all string values" to a fixed
   vocabulary of field-name keys.**  The scanned vocabulary is
   `FIELD_NAME_KEYS = ['field', 'path', 'target', 'key', 'attr',
   'prop']` — keys whose SEMANTIC value is "this sub-field of
   the payload NAMES the character field being targeted."  v:1
   uses `field`; a future v:2 author renaming the semantic key
   would pick from this vocabulary.  The run-#14 broad scan
   rejected `pc-edit { field:'name', value:'tax' }` (a player
   named "Tax") because the VALUE matched a DM-only field name
   — cross-device divergence when OP-045 ships rename.  The
   narrowing trades the never-triggered "v:2 author writes the
   DM-only string as a RAW non-field-name value" defense (already
   covered by DEC-031 §1's contract-level prohibition) for the
   live "player names themselves something that happens to match
   a DM-only field name" case.

2. **Apply the scan to `bond-ratify` and `pc-create`** in
   addition to `pc-edit`.  The architect's run-#14 report named
   these two as the same FC-2 bug class; DEC-031 §Alternatives
   mis-classified them as immune.  Both scrubbers DO read by
   sub-field key (`'dmNotes' in obj` for bond-ratify;
   `DM_ONLY_CHARACTER_FIELDS.includes(k)` per key for pc-create).
   A hypothetical v:2 that renames `dmNotes` → `private`
   bypasses both in the same way the pc-edit scan now defends
   against.

**Why:** Adversarial v2 H-1 + H-3 (`review-history/adversarial-
run14-fixes-2026-05-30.md`).  The forward-compat architect
explicitly named bond-ratify + pc-create in run #14; the lead
mis-classified them.  The "Tax" false-positive surfaces a
real cross-device divergence under the live OP-045 rename
surface.

**Alternatives considered:**
- Keep the broad scan + pin "Tax-survives" with a custom branch
  for `field === 'name'`.  Rejected: narrowing by KNOWN VOCAB
  is cleaner than special-casing one field.
- Drop the scan entirely and rely on DEC-031 §1's contract.
  Rejected: defense-in-depth is the run-#14 design and the
  contract is just a doc; the scan stops the leak if a future
  engineer accidentally breaks the contract.
- Apply the scan to EVERY scrubber (focus-grant, pc-retire,
  map-blob-add/move).  Deferred: today's audit found these
  scrubbers strip by FIELD NAME (not by sub-field key), so the
  rename-bypass shape doesn't apply.  If a future scrubber reads
  by sub-field key, extend.

**Tradeoffs:** Narrowing leaves a hypothetical "v:2 author
writes `randomKey: 'dmNotes'` directly (not via a known
field-name key)" gap.  Per DEC-031 §1 (contract-level
prohibition), that case is forbidden at the contract level;
the materializer's INV-7 v:2 silent no-op is the second
defense.  Acceptable.

**Revisit if:** A new event kind whose scrubber reads sub-fields
by key (not by name) lands; extend `FIELD_NAME_KEYS` to cover
its semantic vocabulary OR extend the per-kind scrubber list.
Or: a future emitter actually picks one of FIELD_NAME_KEYS for
a benign player-visible value (then re-narrow).

---

## DEC-033 — Player-side session-open auto-trigger with localStorage seen-marker (2026-05-30, run #15)

**Decision:** The session-open auto-flip in
`applySessionViewChange` (`quire-app.ts`) now has a second
gated path that flips PLAYER viewers (non-coord) into
`appMode = 'session-open'` when:

- They have at least one `filteredShared.sessionDigest`, AND
- That latest digest's `ts` is STRICTLY GREATER than the
  persisted "last-seen" marker for this campaign on this
  device.

The "last-seen" marker lives at the localStorage key
`quire.player-digest-seen.<owner>-<repo>`.  A per-instance
in-memory mirror also tracks the marker so a player who
dismissed BEFORE the campaign manifest finished loading still
gets the dismiss honored (campaign discovery via the host's
peer-join can lag the first session-view fire).

The dismiss handler is wired to a "Got it — continue" button
on the player-side recap card.  It updates BOTH the in-memory
mirror and the localStorage entry, then exits back to
`appMode = 'in-session'`.

**Why:** TTRPG/UX expert v2 surfaced UX-3 as a false positive
— the run #14 recap card mounted on a surface NO player ever
reached, because the coord-only trigger never fired for
players, and the launcher chip was coord-only.  The expert's
top-3 #1 recommended an additional player-side trigger gated
on a per-peer dismissed-digest-id marker; this implements
that recommendation.  Players otherwise had ZERO bridge to
last week's session even though the digest was already in
their `filteredShared.sessionDigests`.

The seen-marker, not a "always show on first navigation" or
"always show on every load," because the latter two would
nag the player every session-view-change; the firsthand
gate "did the player explicitly say they're done with this
digest" is what dismissals everywhere else use.

**Alternatives considered:**
- Mount the recap on a player-reachable path (e.g. campaign
  landing or resume-prompt).  Rejected: the recap fits the
  session-open ritual; the issue was a routing fix, not a
  placement fix.
- No persistence — the recap shows every time the page loads.
  Rejected: nags the player after they acknowledged.
- Per-DIGEST-ID seen-marker (one marker per digest).
  Rejected: complexity not needed; `ts > seen-ts` covers the
  "newer digest re-fires" case and is simpler.

**Tradeoffs:** Clearing localStorage drops the seen-marker;
the player would see the same digest again.  Acceptable;
explicit "fresh state" is what clearing was for.

**Revisit if:** Real DM usage shows the auto-trigger nags
returning players (then add a "remind me next session" path
or move to a chip-style discovery surface), OR co-DMs in
`bound-following` mode see the recap when they shouldn't
(currently they would because the gate is `!coordHolders.
has(peerId)`, but bound-following co-DMs are typically
ALSO in coordHolders; verify).

---

## DEC-031 — Scrubbers strip DM-only field NAMES regardless of sub-field key (2026-05-30, run #14)

**Decision:** Per-kind scrubbers in
`persistence.ts:PER_KIND_SCRUBBERS` must defend against the
"future field-rename bypass" class.  The today-implementation
of the `pc-edit` scrubber reads `payload.field` by name; a
hypothetical future v:2 that renames the sub-field key from
`field` to `path` (or any other) would silently bypass the
DM-only-field check.

The defense ships in TWO LAYERS:

1. **Contract-level prohibition (forward-compat contract):**
   Renaming a sub-field key on an existing kind is FORBIDDEN.
   A future runtime that needs to evolve the shape MUST add
   a new event kind name (e.g. `pc-edit-v2`).  Per-kind
   payload `v` versioning stays inside the payload; the
   payload's field-key shape is frozen.  Codified in
   `design/playtest-readiness/format-stability.md`
   §INV-RENAME-FIREWALL and the Maintainer Self-Check.

2. **Code-level defense-in-depth (run #14 ship):** The
   `pc-edit` scrubber now scans ALL string-valued top-level
   fields of the payload.  If ANY string matches a DM-only
   character field path (per `isDmOnlyCharacterFieldPath`),
   the event is dropped from the player projection regardless
   of which sub-field key carries it.  This catches the v:2
   rename even if the contract is broken accidentally.

**Why:** The forward-compat architect (2026-05-30 report,
run #14) identified this as a P0 firewall hazard.  The
materializer's `isPayloadV1` check is the THIRD line of
defense (silent no-op on v:2 payload); the scrubber is the
FIRST.  Skipping the scrubber would land DM-private text in
the player save file even though the materializer wouldn't
APPLY the edit — the LEAK is the firewall hole, not the
APPLY.

**Alternatives considered:**
- Make the scrubber version-aware (gate on `p.v === 1`).
  Rejected: a v:2 author who accidentally breaks the
  contract by renaming the key would write `p.v = 1`
  thinking the new shape is back-compat; the version check
  would let it through.  The string-scan defends regardless.
- Drop ALL v:2-or-higher pc-edit events entirely.
  Rejected: forward-compat principle says unknown shapes
  survive the LOG so the future runtime can re-materialize.
  The log should keep the event; the player PROJECTION drops
  the leaky payload.
- Apply the same string-scan to every other scrubbed kind.
  Deferred: the audit found `pc-edit` is the only kind
  whose scrubber-by-key would bypass on rename today.  Other
  scrubbers strip by field-NAME already
  (`PC_EVENT_DM_ONLY_PAYLOAD_FIELDS`,
  `FOCUS_DM_ONLY_PAYLOAD_FIELDS`,
  `RETIRE_DM_ONLY_PAYLOAD_FIELDS`).  If a future scrubber
  reads by sub-field key, this DEC applies and the new
  scrubber must include a string-scan.

**Tradeoffs:** The string-scan is O(payload-keys) per event;
payloads are small (5-10 keys) and the scan is hot only on
the player-projection path (not on materialize).  Negligible
cost.

False-positive risk: a benign pc-edit could carry a string
value coincidentally matching "dmNotes" or "tax".  The audit
of today's emitters found no such case (values are user-typed
prose, numbers, booleans, or enum values that don't collide
with the DM-only field name set).  The regression test
`'the strengthened scrubber does NOT over-strip: a benign
pc-edit harm=2 SURVIVES'` pins the no-false-positive
property.

**Revisit if:** A new event kind whose scrubber reads
sub-fields by key (not by name) lands; reapply the
string-scan defense.  Or: a future emitter writes a benign
string value matching a DM-only field name; at that point
the scan must be narrowed to specific known sub-field-name
keys.

**Run #16 amendment — explicit scope of the string-scan
defense:** The `FIELD_NAME_KEYS` × `isDmOnlyCharacterFieldPath`
scan defends ONLY the DM_ONLY_CHARACTER_FIELDS vocabulary,
applied to the three kinds where the rename-via-character-
field-key bypass is plausible (`pc-edit`, `bond-ratify`,
`pc-create`).  Other event kinds whose scrubbers strip
DM-only sub-fields — `focus-grant` (strips `boundFor`,
`notes`), `pc-retire`/`pc-archive` (strips `reason`,
`scene`), `map-blob-add`/`map-blob-move` (strips blob
position fields) — have DIFFERENT DM-only vocabularies and
remain at contract-only forward-compat protection per §1
above.  Adversarial v3 H-3 documented this gap; the
defense-in-depth extension (introduce kind-specific
vocabularies + a generalized
`payloadFieldNameKeyNamesField(p, vocab)` helper) is a
**post-playtest backlog item** filed as OP-046.  No live
hazard: v:2 shapes don't exist today; the contract
prohibition in §1 + the materializer's `isPayloadV1` silent
no-op are the first two layers.  Tracking the extension
keeps the loop closed.

---

## DEC-030 — Materializers tolerate firewall-stripped optional sub-fields (2026-05-30)

**Decision:** When a per-kind scrubber in
`persistence.ts:PER_KIND_SCRUBBERS` strips a sub-field from an
event's payload, the materializer in `core/state.ts` MUST tolerate
that absence — produce the same materialized state shape, with the
DM-only field left unset.  This is the SSOT-correct pattern for the
save firewall: keep the event, drop the sub-field, materializer
is tolerant.

**Why:** OP-043 surfaced the inverse anti-pattern: the
`pc-retire` / `pc-archive` materializer required `p.reason` to be
one of four enum values; the firewall stripped it on player save;
the materializer silently dropped the event; the retired seat
showed as `bound-active` on a player's localStorage restore — a
visible-broken-state class-2 regression.  The fix is small (allow
`p.reason === undefined` and skip the seat's DM-only field
assignment).  Codifying the pattern prevents the same shape from
recurring on the next per-kind scrubber + materializer pair the
program ships.

The pattern check that surfaced no sibling bugs found that:
- All OTHER scrubbers in PER_KIND_SCRUBBERS strip OPTIONAL fields
  whose materializers validate only when present.
- `pc-edit` drops the event entirely when DM-only (no materialize
  attempt).
- `pc-create` strips all DM-only character fields, all optional;
  materializer requires only mandatory chargen fields.
- `pc-retire` / `pc-archive` was the UNIQUE case because the
  enum was treated as required.

**Alternatives:**
- Move the stripped field OUT of the scrubber list — wrong
  direction; leaks DM material into player saves.  Rejected.
- Synthesize a companion "presence" event for player saves that
  omits the DM-only sub-field — heavy; new event kind, two
  materializers, classification dance per shipped scrubber.
  Rejected.

**Tradeoffs:** The materializer's "required vs. optional"
distinction becomes load-bearing.  A new per-kind scrubber that
strips a field MUST come with a tolerance-on-absence check in
the materializer.  Add the cross-check to the engineer's
self-check list (the M6a-FS-5 pattern check is the precedent;
codify it).

**Revisit if:** A future scrubber/materializer pair encounters
a genuinely required field that can't be made tolerant (e.g.
an enum that the materializer NEEDS to select a downstream code
path).  Then revisit option 3 (presence event) or reclassify
the kind out of PLAYER_SCOPE_STRIP_KINDS / out of the per-kind
scrubber.

---

## DEC-001 — Charter the save/restore program (2026-05-29)

**Decision:** Spin up `design/save-restore-program/` as the program's living
doc set. Roadmap M0–M8 published. The 2026-05-29 four-expert review's
findings are the seed backlog; future findings get logged here.

**Why:** Save/restore was being shipped piecemeal across many other features.
The four-expert review surfaced a live firewall leak, a broken "any party
member can continue" promise, and a silent-eviction UX failure — none of
which has a single owner. The program structure gives the work an owner-of-
record and a continuity mechanism for cross-session work.

**Alternatives:**
- Add tasks to the global backlog without a doc set. Rejected: the
  cross-cutting decisions (honest-scope, in-fiction copy, durability model)
  need a single home, not 8 backlog tickets pointing at each other.
- Extend the existing `multi-session-test-plan.md`. Rejected: that doc is
  test-strategy-shaped, not program-shaped, and predates the broader scope.

**Tradeoffs:** Adds another doc set the engineer must keep up to date.
Mitigation: `status.md` is the single resumption-entry-point.

**Revisit if:** Save/restore feels solved and the doc set goes stale (then
collapse into a single `runtime/design/save-restore.md` post-mortem).

---

## DEC-029 — DM operational view ships as a discrete surface (option (b)) (2026-05-29)

**Decision:** M6a-FS host integration (OP-038) embeds the
`<backups-card>` element inside a **discrete DM operational
view surface**, NOT as a card inline in the existing
`renderCampaign` / `renderEpisode` flow.

Implementation shape:

- New `appMode` value `'dm-operational'` joins the existing
  modal-overlay vocabulary (`session-wrap-marks`,
  `session-open`).  Coordinator-only.  Esc closes back to
  `in-session`.
- Launcher: a small chip on the DM Aside ("Operational view…")
  parallel to "Wrap session…".  No new chrome on the player
  cockpit.
- The operational view renders Backups (M6a-FS today; M6a-OAuth
  joins as a sibling line later) + leaves room for future
  engineering-reality surfaces (eviction status, local autosave
  health, account-mismatch chip, etc.) per `ux-strategy.md`
  locked principle 3.
- The session-digest chip surface (placement A) remains the
  just-in-time discovery path — orthogonal to the operational
  view.  Both can ship without blocking each other.

The human's verbatim product input:

> (b) sounds like the better design from a future proofing
> point of view. if the lead engineer agrees, let them drive
> the process including full implementation, qa, end-to-end
> testing and a mock campaign that is targeted to find subtle
> holes and bugs in our game.  get this code ready for a
> playable release

The lead engineer (program lead) agrees with (b).  Reasoning:

1. **Locked principle 3 already specified this shape.**
   `ux-strategy.md` "DM gets the operational view" was
   written BEFORE M6a-FS landed.  Option (a) would have
   collapsed the operational view into the play cockpit,
   contradicting the doc set the program has been writing
   toward.
2. **Future surfaces will land here.**  Local autosave
   status, manual save, eviction stats, account-mismatch
   chip (NEW-SEC-4), browser-storage health — all want a
   single hidden surface.  Inlining them as cards next to
   play content would violate the prime directive.
3. **The cost of (b) is small.**  `appMode` already
   supports modal full-page overlays (`session-wrap-marks`,
   `session-open`).  Adding `dm-operational` follows the
   established pattern; the diff is a new branch in
   `renderBody`, a launcher chip, and a hotkey listener
   for escape.
4. **Silent-player firewall is cleaner.**  A discrete
   `appMode === 'dm-operational'` branch with
   `if (!isCoordinator()) return nothing` is one short-
   circuit.  An inline card has more code paths (it would
   need to be conditionally rendered in EVERY render
   branch where it might appear) and more regression
   surface.
5. **Discoverability is not lost.**  §A10 placement A
   (session-digest chip) is the just-in-time entry; the
   operational view doesn't need to be discoverable from
   cold.  The operational view's job is "I want to
   administer right now" — DMs who think "where's my
   backup state?" need a stable place to look, not a chip
   that appears only at session-close.

**Why this happens THIS run (not deferred):** The human
escalated M6a-FS to "ready for playable release" — that
requires the user-visible path being live + tested.
Picking (b) and shipping it now means subsequent runs
spend their budget on bug-hunting (mock campaigns) and
mainline polish, not on architectural rework.

**Alternatives:**

- **(a) Inline card.**  Cheapest path to ship M6a-FS user-
  visible; ~1 ship-day of work.  Rejected per the
  arguments above.  Would have to be reworked when
  M6a-OAuth lands (and again when manual-save / eviction
  surfaces want a home).
- **Defer the surface decision and ship as a hidden
  query-string-toggle.**  Rejected: the operational view
  is the user-visible consumer of run #7's engine layer;
  hiding it behind a query flag means the engine layer
  has no production exercise path.
- **Stand up the operational view AND add an inline chip
  for "Backup is connected, last push 12m ago".**  Maybe
  later.  Today: don't multiply surfaces until we know the
  inline chip is needed.  §A10 placement A (session-digest)
  already covers the just-in-time recall.

**Tradeoffs:** Slightly larger run #8 diff (~150 LOC for
the operational view surface + launcher + hotkey + tests)
vs. ~30 LOC for option (a)'s inline card.  Acceptable:
the deferred-cost of reworking (a) later exceeds today's
extra LOC.  Also: an additional `appMode` value is one
more state machine branch to keep covered — already-
tested pattern; not new surface area.

**Revisit if:** Real DM usage shows the operational view
is too hidden (then promote a static "Backup status"
glyph somewhere always-visible on the DM Aside that
launches the view), OR the operational view grows past
3 sections and needs its own internal navigation
(promote to a multi-tab surface).

---

## DEC-028 — M6a-FS (File System Access API) ships ahead of M6a-OAuth (2026-05-29)

**Decision:** Split M6a into TWO parallel paths and ship the
File-System-Access-API path FIRST:

- **M6a-FS (NEW, ships FIRST).**  The DM picks an OS-level
  folder via `window.showDirectoryPicker`; Quire writes the
  save file there; the user's desktop sync client (Google
  Drive Desktop / Dropbox / OneDrive / iCloud Drive) handles
  cloud upload.  ZERO maintainer infrastructure — no OAuth
  client_id, no Cloudflare proxy, no Google project
  registration.  Provider-agnostic.

- **M6a-OAuth (the work scaffolded in run #6).**  Drive REST
  via OAuth PKCE.  Stays valid and stays GATED on the
  maintainer's verified-OAuth-app registration.  Ships
  AFTER M6a-FS — it's the right answer for mobile, Safari,
  Firefox, and DMs without a desktop sync client.

The verbatim product input from the human:

> a google cloud project is acceptable, but it would be even
> better if a dm could sync to their consumer google drive
> without requiring a google project. much lower barrier to
> entry that way

The clarifying observation: even the *maintainer-side* OAuth
app registration is a setup cost we can avoid for a meaningful
portion of users.  The File System Access API removes that
cost entirely — the DM picks the folder (which can be inside
ANY sync tool's watched tree); Quire writes; the user's
existing desktop sync client uploads.

**Why this ordering is right:**

1. **Lowest barrier to entry actually ships first.**  M6a-OAuth
   is currently blocked on a maintainer task (register the
   verified Google OAuth app + flip `GOOGLE.status` from
   `'placeholder'` to `'verified'`).  Until that happens, every
   M6a-OAuth surface is in a "Cloud sync is not yet available"
   state.  M6a-FS has NO such gate — the maintainer flips it
   live with a code change + a deploy, not an external
   registration.  Shipping M6a-FS first means END-USERS get
   cloud durability TODAY (modulo Chromium-desktop browser
   support) regardless of maintainer-side timing.
2. **Provider-agnostic by construction.**  M6a-OAuth ties
   durability to Google Drive specifically.  M6a-FS works for
   any cloud the DM already pays for (Drive, Dropbox,
   OneDrive, iCloud, …) without Quire knowing or caring.
   Honors the prime directive: the DM uses the tool they
   already have, not the tool we picked for them.
3. **Threat-model wins.**  Under DEC-023, internet-rando
   surface area must be minimized.  M6a-FS has NO network
   surface — no token to steal, no third-party flow we
   authorize.  Folder handles are per-origin; no other site
   can reach them.  The DM's existing desktop sync client is
   the trust boundary, not anything Quire ships.
4. **Engine layer survives the ordering swap.**  Run #6's
   OAuth orchestrator + Drive client + consent ledger are
   unaffected.  M6a-FS is a sibling path that REUSES the
   consent ledger (destination `'fs-api'` added in run #7)
   without reusing the OAuth pieces.

**Trade-offs (already discussed with the human, accepted):**

- **Chromium desktop only.**  Safari and Firefox don't ship
  the API yet; mobile platforms gate it off.  Feature
  detection (`fs-api-availability.ts`) surfaces the right
  "try Chrome on desktop / wait for OAuth Drive" copy per
  reason (safari / firefox / mobile / no-api).
- **Requires DM has a desktop sync client installed.**  Quire
  can't verify this; we trust the DM to pick a folder that's
  actually synced if they want cloud durability.  The consent
  copy spells this out ("If that folder is watched by Google
  Drive Desktop, Dropbox, …").
- **Mobile = no path here at all.**  Mobile DMs wait for
  M6a-OAuth.

**Alternatives:**

- Ship M6a-OAuth first, then M6a-FS as a follow-up.  Rejected:
  per the durability-for-end-users argument above, M6a-FS
  removes a maintainer-side gate, which means it actually
  reaches users sooner.
- Ship M6a-OAuth only and skip M6a-FS.  Rejected per the
  human's product call.  Even with OAuth working, the
  "register a Google project" cost is non-zero, and the
  FS-API path captures users who already pay for Dropbox or
  iCloud and don't want Drive.
- Ship M6a-FS only and drop M6a-OAuth.  Rejected: Safari,
  Firefox, and mobile users need a path; OAuth Drive is that
  path.

**Tradeoffs:** Two parallel implementations to maintain.
Mitigated by sharing the consent ledger surface (single
ceremony) + same `SaveDocument` format on both sides + the
backups-card region rendering either backend's status (when
both eventually ship, the card can render "Folder + Drive"
side-by-side or pick one per user preference; that UX
decision is M6a-OAuth-completion-tier).

**Revisit if:** Safari or Firefox ships the File System Access
API (then drop the "wait for OAuth Drive" alternative copy on
those browsers).  Or if a real DM workflow surfaces a need we
can't meet via either path (then re-scope).

---

## DEC-027 — M6a cloud-sync placement: session-digest primary + DM operational view secondary (2026-05-29)

**Decision:** The "Back up to my Drive" affordance lives on
TWO surfaces in M6a:
1. **Primary, just-in-time:** the session-digest chip at
   session-close.  This is the moment a DM understands the
   value of backup (they just finished a session; they're
   about to close the tab).
2. **Discovery, always-available:** the DM-only operational
   view's "Backups" section.  A DM who knows the
   operational view exists can find backup state at any
   time; a DM who doesn't will encounter it via the chip.

The consultant's third surface — a "cloud backup attached"
badge on the recently-played row — is DEFERRED.  It depends
on the §A11 cross-device probe being live AND the DM being
signed into Drive on the device where the landing renders.

The fourth obvious surface — a setup-wizard / first-launch
"Connect cloud sync" ceremony — is REJECTED.  Setup wizards
fail the TTRPG prime directive (admin before play).  A DM
should never encounter cloud sync before they're ready to
use it.

**Why:** Three drivers:

1. **Prime directive (TTRPG memory).**  A returning DM after
   3 months sits down to RUN their table, not to administer
   it.  Surfacing backup as a first-launch ceremony pushes
   admin into the worst possible moment.
2. **Discovery story.**  The session-digest chip recurs at
   every session-close, so a DM who ignores it the first
   time sees it again next session.  It is its own discovery
   surface — no separate "did you know you can back up?"
   surface needed.
3. **Silent-player firewall.**  The session-digest already
   renders behind a DM-only conditional.  Adding the backup
   chip to the same surface inherits the firewall without
   adding a new conditional path that could regress.

**Alternatives:**

- Single surface (digest-chip only).  Rejected: a DM who
  wants to verify "is cloud backup still working?" mid-
  campaign has no surface to check.  The operational view
  is the natural home for engineering reality (per the
  existing locked principle 3 in `ux-strategy.md`).
- Add the recently-played row badge in M6a.  Rejected for
  M6a: the badge requires the §A11 probe to be live OR
  requires probing local manifest state for "cloud
  attached" hints we don't track today.  Better as a
  follow-up once §A11 ships.
- First-launch setup wizard.  Rejected per prime directive.
- "Connect Drive" pre-prompt on the no-campaign landing.
  Rejected for the same reason — admin before play.

**Tradeoffs:** A DM who shuts down their tab between
session-end and session-digest render misses the primary
surface; they'd only encounter backup via the operational
view (if they know it exists).  Acceptable — the operational
view is the engineering-reality surface anyway, and the
session-digest captures the modal moment.

**Revisit if:** Real DM usage shows the operational view is
too hidden to function as the discovery surface for
backup-curious DMs (then promote a static "Backup status"
chip somewhere always-visible), OR the recently-played
badge becomes cheap once §A11 ships (then promote it
back to M6a-tier).

---

## DEC-026 — APP+WebAuthn-in-popup verification deferred to UAT (2026-05-29)

**Decision:** OP-024 (APP + WebAuthn-in-popup detector +
fallback) is implemented per the design (popup-failure detector
shared with OP-015, full-page-redirect fallback), but VERIFIED
against a real APP-enrolled Google account is deferred to UAT
(M8). The detector + fallback ship in M6a; the live APP-flow
walkthrough is a UAT checklist item.

**Why:** No APP-enrolled test account is available to the
program lead today. The detector logic itself is mechanically
exercisable (popup-close-without-postMessage in <2s, error
`security_key_required`, sessionStorage empty on return) and is
covered by unit tests. The remaining gap is "does the real
APP-WebAuthn ceremony INSIDE the popup behave the way our
detector expects" — that needs hardware-key UX testing, which
belongs in M8 UAT.

Recorded as a known limitation in `open-problems.md` (OP-024
status: "logic shipped, real-APP verification parked-until-UAT")
and in `ux-strategy.md` as a UAT milestone item.

**Alternatives:**
- Block M6a ship on APP-flow verification. Rejected: no test
  account today; would indefinitely block ship for a class of
  user we cannot reach. The detector + fallback is the right
  defense; UAT is the right venue for proving the runtime
  experience.
- Skip the detector + fallback entirely. Rejected: would leave
  APP users silently locked out instead of falling back to the
  full-page-redirect path.

**Tradeoffs:** First APP-enrolled DM may surface a detection
edge case (e.g. WebAuthn ceremony succeeds in popup but takes
longer than 2s; our timeout fires false-positive). Acceptable
as a UAT finding; we'll widen the timeout or change the signal
once we have real data.

**Revisit if:** A program contributor enrolls an account in APP
specifically for testing (then run the live walkthrough and
collapse the deferral), OR a UAT report surfaces a real APP
user being silently broken (then expedite the detector tuning).

---

## DEC-025 — Well-known discovery doc hosted on Cloudflare Pages static asset (2026-05-29)

**Decision:** The OAuth discovery document spec'd by DEC-017 +
DEC-013 lives at `runtime/public/.well-known/quire-oauth.json`,
served by Cloudflare Pages as a static asset. The maintainer
edits the file and pushes; CDN-cache TTL is documented in
`maintainer-ops.md`.

**Why:** Three alternatives were considered for the hosting
story (OP-018):

1. **Cloudflare Pages static asset.** Cheapest, least moving
   parts, no extra dependency. CDN cache TTL is short for
   `.well-known` URLs on Pages (Cloudflare default is ~1-5
   minutes for static files in this directory; documented as
   the emergency-rotation lag in `maintainer-ops.md`).
2. **Separate Cloudflare Worker.** Lets us serve the doc with
   custom cache headers + edge logic (e.g. region-specific
   client_id). Rejected: extra deploy surface, extra failure
   mode, no demonstrated need for the dynamism.
3. **Third-party static host (e.g. GitHub Pages).** Decouples
   the discovery doc lifecycle from the Quire deploy.
   Rejected: introduces a separate trust boundary
   (compromise of the third-party host = compromise of the
   client_id rotation channel). Cloudflare Pages is already
   in our trust boundary for the bundle; folding the
   discovery doc into the same boundary is correct.

**Alternatives:** see above.

**Tradeoffs:** Emergency rotation has CDN cache TTL of a few
minutes. The runtime SHOULD treat the discovery doc as a hint
("use this client_id by preference") rather than a hard
override — the build-time embedded baseline (per OP-017g) is
always the safe fallback. Documented in `maintainer-ops.md`.

**Revisit if:** A real rotation incident takes longer than the
TTL we're comfortable with (then pivot to a Worker with
explicit cache-control headers).

---

## DEC-024 — Maintainer ops doc colocated with save-restore-program (2026-05-29)

**Decision:** The cloud-sync maintainer ops doc lives at
`design/save-restore-program/maintainer-ops.md`. Colocate with
the rest of the program for discoverability — a future
maintainer rebuilding context from disk finds the operational
runbook next to the architectural docs.

**Why:** Three locations were considered for the ops doc
(OP-017g):

1. **Colocated.** Inside `design/save-restore-program/`. Easy
   to find when reading the program from `status.md` outward.
   Risk: the program doc set already has 12 files; one more
   makes resumption-from-disk denser.
2. **Top-level `ops/`.** Future-proof if the maintainer surface
   grows beyond save-restore (e.g. signaling-server ops,
   Underleaf-publish ops). Risk: prematurely creates a
   structure for a single doc.
3. **Inside `docs/`.** With the user-facing docs. Rejected:
   maintainer ops is NOT user-facing; co-locating with
   user-facing docs causes accidental drift toward
   end-user-readable framing that misses the audience.

Picked colocated as the right default; promote to top-level
`ops/` once a second ops doc lands (signaling-server, Underleaf-
publish, anything else that needs out-of-band maintainer
coordination).

**Alternatives:** see above.

**Tradeoffs:** The program doc set grows by one file. Mitigated
by `status.md`'s "Where to find things" section pointing at it
explicitly.

**Revisit if:** A second non-save-restore ops doc gets written
(then promote both to `ops/`).

---

## DEC-023 — Threat model: zero attack surface from internet randos; malicious co-players out of scope (2026-05-29)

**Decision:** Codify the human's verbatim product framing as
the canonical threat model for save/restore + cloud sync (and
inherited by future cloud-touching milestones):

> Need to be worried about hostile 3rd parties. There should be
> practically zero attack surface from random malicious parties
> on the internet at large. **That's an important design goal!**
> But we aren't really worried about our own players. As long as
> they can't ACCIDENTALLY disrupt the integrity of the game we are
> good. If they maliciously try to disrupt the game, that's a
> social problem that we can deal with in other ways; we don't
> need a technical solution for a social problem.

Decomposed into three classes:

| Threat class | Mitigation posture |
|---|---|
| **Internet randos / external attackers** | **ZERO attack surface goal.** Every external surface (OAuth flow, callback page, cloud-saved format, network endpoints, supply-chain integrity of the shipped client_id) must be hardened. Treat any new external surface as a strong default to "don't add it." |
| **Accidental disclosure between trusted teammates** | Defend against this (spoiler firewall already does; keep extending it). Map-blob leak (M1), restore-firewall leak (NEW-ADV-1), rebroadcast leak (NEW-ADV-2) — all in scope. |
| **Malicious co-players** | **OUT OF SCOPE. Don't add technical defenses.** Findings that only matter against a malicious co-player are deprioritized or closed-no-fix. Social problem; social mitigation. |

**Why:** The original program documents conflated all three
classes. The human's clarification gives the program a clean
prioritization rule: any finding's severity must be tied to which
of the three classes it sits under. Items in class 1 are P0/P1
by default; class 2 follows the existing firewall-class
prioritization; class 3 is closed-no-fix unless it incidentally
also helps class 1 or 2.

**Concrete re-classifications under this framing (see
`open-problems.md` re-triage block 2026-05-29 R4):**

- NEW-ADV-5 / OP-017g (canonical client_id integrity, supply
  chain) — STAYS P0. An attacker who swaps client_id on
  Cloudflare = internet rando reaching the DM.
- NEW-ADV-8 / OP-017 (callback-page CSP + golden-diff) —
  STAYS P0/P1. Reflected-XSS class; internet randos.
- NEW-SEC-2 / OP-021 (state nonce intent binding) — STAYS P1.
  CSRF defense against internet randos.
- NEW-SEC-7 (M6b KDF cost) — KEEP PBKDF2 ≥600k. The threat is
  "another process on the user's machine reads IndexedDB" or
  "attacker has user's hard drive" — a hostile 3rd party with
  local access IS in scope per class 1.
- NEW-ADV-6 (M6b passphrase brute-force from co-located
  adversary with stolen IndexedDB) — STAYS in scope but the
  realistic adversary is "thief with the laptop", not "malicious
  co-player." Microcopy honest: "delays a casual snooper, not a
  determined attacker." The KDF cost itself is fine at PBKDF2
  ≥600k.
- ADV-2 / OP-011 (revision_id concurrency races by malicious
  co-DM) — DOWNGRADED. Malicious co-DM = class 3. But
  accidental concurrent push between trusted co-DMs IS class 2
  ("accidentally disrupt") — pull-rebase-push automation stays.
- ARC-2 / OP-011 (multi-DM merge UX) — same as above.
  Accidental disruption stays in scope; malicious DM does not.
- pc-edit trust gap (memory: `project_quire_pc_edit_trust_gap`)
  — DOWNGRADED-confirmed. Already classified as "tolerated by
  current threat model"; threat is malicious co-player, which is
  out of scope.
- OP-017h (retry-backoff on rate-limit DoS by hostile co-DM) —
  DOWNGRADED. Hostile co-DM = class 3. Accidental rate-limit
  (DM scripts a backup loop that wedges) is class 2 but doesn't
  need exponential backoff — a simple "max 3 retries then
  surface error" handles it.

**Alternatives:**
- Continue defending against all three classes uniformly.
  Rejected: bloats scope, adds friction (TOTP-on-co-DM,
  attestation-on-bond-consent etc.) that violates the prime
  directive.
- Defer the codification ("we'll figure out scope per finding").
  Rejected: leaves the program without a sharp prioritization
  rule; expert reviews will keep re-litigating it.

**Tradeoffs:** A malicious co-player could absolutely disrupt
the table — pc-edit-spam, scratch-note-spam, bond-consent-
withdraw-loop. Social mitigation only (kick from table). We
accept this. The locked threat-model memory
(`project_quire_threat_model`) already named this; DEC-023
makes it operational for the save/restore + cloud-sync work.

**Revisit if:** A new use case introduces an asymmetric trust
relationship (e.g. "Quire-as-a-service hosts public matchmaking"
— then random players ARE class 1, not class 3). Until then,
the civilized-peer model holds.

---

## DEC-022 — Layered M6 ship sequence is M6a → M6c → M6b (2026-05-29)

**Decision:** Re-rank the M6 layered ship from DEC-008's
`M6a → M6b → M6c` to `M6a → M6c → M6b`. Account-loss
durability (NEW-ADV-3 / OP-017e) outweighs cross-session
ephemerality (the original UX driver for M6b).

**Why:** OP-017e identified `drive.appdata` as structurally
irrecoverable on Google account death. The cleanest mitigation
is M6c (GitHub-hosted save, survives the DM's Google account).
Shipping M6c before M6b means the durability promise is held
EVEN IF a DM never moves past the M6a "re-auth per session"
inconvenience.

The UX cost of re-auth-per-session in M6a-only mode is real but
recoverable (one click + biometric per session). The cost of
losing a campaign because the DM's Google account died is
catastrophic and unrecoverable. Order accordingly.

Subsumes DEC-008's `M6a → M6b → M6c` sequence.

**Alternatives:**
- Keep DEC-008 ordering (M6b before M6c). Rejected per the
  durability argument above.
- Ship M6c immediately after M6a as the SECOND surface
  (skipping M6b entirely). Rejected: M6b is still wanted as a
  cross-session-persistence option, just not at the cost of
  account-loss-durability.
- Land M6c in parallel with M6b. Rejected: serialization gives
  one durability story at a time, reduces shipping risk.

**Tradeoffs:** Weekly DMs running M6a-only re-auth every
session for the duration of M6c-then-M6b development.
Mitigation: M6c can absorb some of M6b's "session persistence"
value (GitHub PATs / Device Flow tokens last weeks; even though
that's the same C4 boundary problem in a different jurisdiction).

**Revisit if:** Real DMs polling shows M6a-only is unworkable
even WITH M6c as the durability story (then promote M6b).

---

## DEC-021 — M6b passphrase KDF: PBKDF2-SHA256 ≥600k + 12-char floor + honest microcopy (2026-05-29)

**Decision:** M6b's passphrase-encrypted refresh_token uses:

- KDF: **PBKDF2-SHA256, ≥600k iterations** (NIST 2023+
  recommendation; aligns with 1Password 2024 default).
- Cipher: **AES-GCM-256** (96-bit IV, per-message-fresh).
- **Passphrase floor: 12 characters** (validated at entry).
- Per-origin random salt, persisted in IndexedDB alongside the
  ciphertext.
- **Microcopy** at passphrase entry: "This passphrase delays a
  casual snooper, not a determined attacker. Quire encrypts your
  Google login on this device; anyone with both your laptop and
  your passphrase can read it." (Final string deferred to M8.)

**Why:** NEW-SEC-7 surfaced the choice between PBKDF2 ≥600k
(ship-now) and scrypt-via-WASM (security-better at a much
higher engineering cost). The honest answer is that any browser-
side KDF protecting a refresh token loses to a determined
attacker who has both the user's hard drive and time. PBKDF2
600k delays an opportunistic attacker (laptop thief plinking
at a few passwords) by minutes-to-hours; that's the realistic
attack surface in the civilized-peer + zero-attack-from-internet
model (DEC-023). False-sense-of-security is worse than no
encryption — the microcopy honesty closes that gap.

**Alternatives:**
- scrypt or argon2id via WASM. Rejected for v1: ≥2x engineering
  cost (WASM bundling, fallback paths, integrity), unclear
  benefit at our threat-model tier.
- No KDF — store refresh_token unencrypted. Rejected: violates
  C4 "no creds in browser unencrypted" + the M6b motivation
  entirely.
- Higher iteration count (≥1M). Acceptable but exceeds NIST
  2023 recommendation; revisit when the recommendation moves.

**Tradeoffs:** PBKDF2 ≥600k takes ~300-500ms to derive on a
2020-era laptop; that's the perceptible passphrase-unlock delay.
Acceptable for once-per-session; would not be acceptable for
per-action prompts.

**Revisit if:** scrypt-via-WASM matures into a low-cost-of-
adoption primitive (then re-evaluate), OR NIST recommendation
moves past 600k (then bump), OR a real DM reports the unlock
delay is intrusive (then accept it as the cost or downgrade
iterations + admit it openly in the microcopy).

---

## DEC-020 — Player-content first-push consent ceremony locked (2026-05-29)

**Decision:** Keep the first-push consent dialog from DEC-011.
Player content (chat, character drafts, bond notes, intent
statements) leaving the table to the DM's Google Drive is
firewall-ethos-relevant; the one-time DM-only acknowledgment
("You are uploading the full table's content...") is cheap and
honors Quire's "never tell a player about a thing they didn't
consent to" framing.

Confirms DEC-011 against the alternative ("skip dialog; rely on
civilized-peer model entirely"). The dialog is silent-player-
firewall-preserving (DM is educated; players are NOT notified).

**Why:** DEC-011's logic still holds. A future DM asking "wait,
players' words go to MY drive?" is a real surface; we should be
ahead of it. The dialog is also the natural surface for the
NEW-ADV-4 "what's saved" disclosure (OP-017f).

**Alternatives:** see DEC-011 alternatives.

**Tradeoffs:** see DEC-011 tradeoffs.

**Revisit if:** see DEC-011 revisit.

---

## DEC-019 — M5 recently-played list scopes by sha256(google_sub) post-OAuth (2026-05-29)

**Decision:** Patch the existing M5 recently-played list (commit
`0ef07c3`) to scope localStorage keys by `sha256(google_sub)`
once OAuth has run. Pure-local DMs (no OAuth) keep today's
anonymous per-origin behavior. Two distinct Google users on the
same browser profile get disjoint lists.

**Why:** OP-026 + NEW-PRV-3 framed the cross-tab leak — M5's
list lives in `localStorage`, same-origin-shared across all
tabs / profiles on the same OS user. A DM + their partner
sharing a laptop become passive observers of each other's
campaign cadence. Account-hashing closes the leak under class 2
(accidental disclosure between trusted-but-distinct humans on
the same machine).

**Why sha256(google_sub) specifically:**
- `google_sub` is a stable opaque identifier; not the email
  (which can be re-mapped at the directory level).
- sha256 is sufficient — we're scoping a UI list, not
  cryptographically authenticating. No need for HMAC.
- Truncate to first 16 hex chars for the localStorage key
  prefix (avoid 64-char key clutter).

**Alternatives:**
- Don't scope; accept the leak. Rejected per the firewall-
  ethos read above.
- Scope by raw email. Rejected: email exposed in the
  localStorage key view of devtools is more revealing than a
  hash.
- Scope by a fresh per-tab UUID. Rejected: defeats the
  cross-session-resume use case the list serves.

**Tradeoffs:** Two implementation paths (anonymous + account-
scoped) co-exist. The migration boundary is the first
successful OAuth login per origin; pre-OAuth entries remain
visible until the user manually clears them. Acceptable.

**Revisit if:** A DM reports the account-scoped list is
confusing (then surface a "[Show all entries on this device]"
toggle from the operational view).

---

## DEC-018 — Cloudflare Worker token-exchange fallback blocks behind explicit DEC (2026-05-29)

**Decision:** Any introduction of a Cloudflare Worker as a
token-exchange proxy (SEC-3 fallback / OP-019) requires an
explicit follow-up DEC entry. The Worker is NOT a default
deployment artifact. The decision is gated on the CORS probe
outcome (OP-016):

- If `oauth2.googleapis.com/token` accepts PKCE-CORS from our
  origin: NO Worker. Direct client-side exchange ships.
- If CORS is blocked: PAUSE. Write a follow-up DEC explicitly
  authorizing the Worker, covering hosting, no-log policy,
  reproducible build, disclosure copy in the connect-Drive
  ceremony, and self-hoster override. Only then build it.

**Why:** A maintainer-run Worker that brokers token exchange
materially changes the threat model — the maintainer (or
anyone who compromises the Cloudflare deploy) can observe every
auth code + verifier and could redeem them. Under DEC-023's
zero-attack-surface goal for internet randos, the Worker
becomes a single point of compromise. Avoiding it where
possible is the right default; introducing it requires
explicit owner-of-record sign-off.

**Alternatives:**
- Accept "maintainer-trusted" default and build the Worker
  proactively. Rejected: the Worker is not needed if CORS is
  open, and building it speculatively is wasted work + extra
  surface.
- Refuse to build the Worker even if CORS blocks (forces
  self-host-only). Rejected: blocks the canonical hosted
  experience for users who don't want to self-host.

**Tradeoffs:** If CORS blocks AND we can't authorize the Worker
within a tight timeline, M6a ship slips. Mitigation: the
Worker authorization can be drafted in parallel with the CORS
probe (so we're ready to ship the Worker decision the moment
the probe forces it).

**Revisit if:** Google reverses the PKCE-CORS policy mid-
shipping; revisit the probe result.

---

## DEC-017 — Canonical OAuth client_id is runtime-overridable + has a discovery document (2026-05-29)

**Decision:** Confirm DEC-013's spec: ship the canonical
client_id PLUS three override mechanisms (build-time env, query
parameter, campaign-manifest field) PLUS a discovery document
at `/.well-known/quire-oauth.json` from day one.

This is the locked answer to OP-018's incident-response question.
The alternative — "build-time only with a documented incident-
response delay" — is rejected because Cloudflare Pages CDN cache
lag (per `feedback_show_deploy_hash`) means hours of degraded
state, which is unacceptable for a security-primitive rotation.

**Why:** Two failure modes argue for runtime override:
1. **Compromise / abuse-throttle.** If the canonical client_id
   is compromised or rate-limited by Google due to abuse, every
   DM whose tab is open needs to fetch a new client_id. Without
   runtime override, that's a redeploy + CDN cache flush; with
   runtime override + discovery doc, it's a single Cloudflare-
   KV update propagating through the discovery endpoint.
2. **Self-hosting.** Self-hosters need their own client_id from
   day one; the same override mechanism serves both use cases.

The discovery document gives us a graceful-degradation surface
("client_id unavailable — self-host or wait for fix") instead
of a silent "Connect Drive does nothing" failure.

**Alternatives:** see DEC-013 alternatives.

**Tradeoffs:** see DEC-013 tradeoffs.

**Revisit if:** see DEC-013 revisit.

---

## DEC-016 — M6c re-ranked ahead of M6b for account-loss durability (2026-05-29)

**Decision:** Re-rank the layered M6 ship so M6c (GitHub-
hosted save) ships BEFORE M6b (passphrase-encrypted
refresh_token). Operational order: **M6a → M6c → M6b**.

This is the human's product call on NEW-ADV-3 / OP-017e.
`drive.appdata` is structurally irrecoverable on Google
account death; a GitHub-hosted save survives that failure
mode.

**Why:** See DEC-022 for the full rationale. The cleanest
mitigation for account-loss-durability is a save destination
on a different provider — GitHub. M6c was already planned as
"later"; promote it to "immediately after M6a."

The M6b cross-session-persistence UX gap remains real but is
now second priority after durability.

**Alternatives:**
- Keep DEC-008 ordering. Rejected per durability argument
  (see DEC-022).
- Mandatory auto-download local copy on each push (OP-017e
  option 1) as the only durability story. Rejected: still
  fragile to "DM's machine died too" + adds UX friction every
  push.
- Promote `drive.file` to the recoverability path (OP-017e
  option 2). Rejected: re-introduces the ADV-1 share-link
  risk (the very thing DEC-009 was meant to close).

**Tradeoffs:** M6b weekly-DM cross-session UX work pushes
out; some weekly DMs will continue re-auth-per-session under
M6a longer than they would have under DEC-008's ordering.
Acceptable trade.

**Revisit if:** Real DMs report the M6a-then-M6c sequence is
unworkable in practice (e.g. GitHub Device Flow ceremony is
intolerable at-table for every backup), and durability via
auto-local-disk-copy is acceptable. Then promote M6b back to
second slot.

---

## DEC-015 — Cross-device cloud discovery is pull-on-discovery, never auto-load (2026-05-29)

**Decision:** When a DM lands on a campaign URL with no local
state AND has connected Drive, Quire probes `drive.appdata` for
a file matching the campaignId. If found, surface "[Load it]
[Start fresh]" — Load is the default action. NEVER auto-load
silently.

**Why:** NEW-UX-2 framed the failure mode: DM on tablet next
week with empty localStorage doesn't know the cloud backup
exists; starts a fresh save; the next push destroys last week's
events (pull-rebase-push can't rebase empty). Auto-load would
solve discoverability but violates "no surprise restore" — a
DM intending a fresh start should never have last week's events
silently replayed.

**Alternatives:**
- Auto-load when local is empty. Rejected: silent restore is
  worse than missing backup; surprises the DM.
- No probe — DM must manually click "Pull from Drive." Rejected:
  per NEW-UX-2 this is the failure mode itself.

**Tradeoffs:** Probe runs on every cold landing where Drive is
connected. Drive API call cost is one HEAD per campaignId;
acceptable. Surface delay (~200ms median) is part of the page
render budget.

**Revisit if:** A DM reports the prompt is intrusive on repeat
visits; cache the probe result with a freshness window.

---

## DEC-014 — Co-DM Drive ownership is per-DM-appdata for M6a; shared model deferred to M6c (2026-05-29)

**Decision:** Each co-DM connects their OWN Drive account and
pushes to their own `drive.appdata`. Pull-on-discovery (DEC-015)
probes whichever co-DM is currently signed in. Shared canonical
ownership is deferred to M6c (GitHub naturally shares via
co-author commits on the same repo).

**Why:** NEW-UX-4 identified the gap; per-DM-Drive is the
simplest M6a model with no shared-state coordination. Designated-
backup-DM and shared-Drive ownership models require additional
ceremony (manifest events, ratification) that's M6c-shaped.

**Alternatives:**
- Designated backup-DM with hand-off recorded in manifest event.
  Rejected for v1: extra UI surface + edge cases around primary-
  DM-loss recovery exactly when we need backup most.
- Shared Drive folder via `drive.file`. Rejected: re-introduces
  the ADV-1 share-link risk DEC-009 defaults closed.

**Tradeoffs:** Co-DMs each hold an independent backup; the CRDT
merge layer handles divergence at restore time. Documented
limitation: if BOTH co-DMs lose access to their accounts, no
backup survives. Mitigated by M6c (GitHub) sequencing.

**Revisit if:** Real co-DM workflows surface a need for a
canonical shared backup; promote M6c or design a shared-Drive
mechanism.

---

## DEC-013 — Default to runtime-overridable `client_id` from day one (2026-05-29)

**Decision:** Quire ships with a canonical client_id PLUS three
override mechanisms from day one:
1. Build-time env var (`QUIRE_OAUTH_CLIENT_ID`) for self-hosters.
2. Runtime query parameter (`?clientId=...`) for emergency
   discovery rotation.
3. Campaign-manifest field (`oauth.clientId`) for per-campaign
   override.

Plus a discovery-document fetch at `/.well-known/quire-oauth.json`
that returns the current canonical client_id + a status flag.
If status is `unavailable`, surface "client_id unavailable —
self-host or wait for fix" graceful-degradation banner.

**Why:** NEW-SEC-5 framed the incident-response gap: if the
canonical client_id is compromised (or revoked by Google, or
abuse-rate-limited), rotation requires every DM to fetch a new
bundle. Cloudflare Pages CDN cache lag means hours of degraded
state. NEW-ADV-5 framed the supply-chain integrity angle: the
shipped client_id is a security primitive an attacker who
compromises the deploy can swap.

Subsumes OP-013 (self-hoster override) — the same mechanism
serves both incident-response rotation AND self-hosters.

**Alternatives:**
- Build-time only override. Rejected per NEW-SEC-5: a DM whose
  client_id was rotated must wait for a new deploy + cache
  invalidation; minutes-to-hours of unavailable backups.
- Canonical-only (no override). Rejected: single point of
  failure on the maintainer's OAuth app.

**Tradeoffs:** Three override paths is more surface to test +
document. Mitigation: query-param override is hidden behind a
documented incident-response procedure ("emergency rotation");
campaign-manifest override is opt-in per campaign; env-var
override is documented in the self-hoster setup guide.

**Revisit if:** Override usage becomes a vector for tricking
DMs into auth-ing to a malicious client_id (then add a "you
are using a non-canonical client_id" warning banner).

---

## DEC-012 — `state` nonce binds intent, not just CSRF (2026-05-29)

**Decision:** The OAuth `state` parameter encodes the user's
INTENT alongside the CSRF nonce:

```
state = base64url({
  nonce: <crypto.getRandomValues 256-bit>,
  intent: 'push' | 'pull' | 'connect',
  campaignId: '<owner>/<repo>@<ref>',
  fileRev: '<drive-revision-id> | null',
  ts: <ms-epoch>,
  flowId: '<per-flow-uuid>'
})
```

Plus an HMAC over the intent fields using a per-tab session
secret (generated at first `state` mint, stored in sessionStorage).
On OAuth return:
1. Verify HMAC (defends against tampering).
2. Verify `flowId` matches the listener's current flow (NEW-SEC-1).
3. Verify `campaignId` matches the currently-foregrounded
   campaign (NEW-SEC-2).
4. Verify `ts` is within 10 minutes (stale-state defense).

**Why:** NEW-SEC-2 framed the gap: classic OAuth `state` answers
"did this auth response correspond to MY request?" but NOT "and
that request was to push CAMPAIGN X." A two-flow race lets a
returning auth token write to the wrong campaign.

Civilized-peer threat model accepts `campaignId` landing in
URL-bar history (NOT a spoiler-relevant disclosure for Quire's
model). Confirmed by adversarial-routing per the security
consultant's hand-off.

**Alternatives:**
- Opaque `state` (today's draft). Rejected per NEW-SEC-2.
- Server-side intent storage. Rejected: would re-introduce a
  server component the no-server architecture excludes.

**Tradeoffs:** `state` becomes longer (~200 chars vs ~40). Still
well under URL length limits.

**Revisit if:** Campaign-id-in-URL-bar becomes a complaint
surface (re-evaluate the firewall classification).

---

## DEC-011 — Player content consent ceremony on first cloud push (2026-05-29)

**Decision:** On the first cloud push for a campaign, surface a
one-time DM-only acknowledgment dialog (silent-player-firewall
preserved — players are NOT notified):

> "You are uploading the full table's content (including your
> players' chat, character drafts, and bond notes) to YOUR
> Google Drive. Players can read what they have written to this
> campaign; they cannot see this Drive folder. [Acknowledge]"

The acknowledgment is per-campaign, persistent (`localStorage`),
re-prompted on campaign-id change or destination change.

**Why:** NEW-PRV-4 framed the gap: the DM-coord projection
contains every player's authored content (chat, character drafts,
bond notes, intent statements). Silent upload to the DM's Drive
violates Quire's firewall ethos ("never tell a player about a
thing they didn't consent to") in spirit — the player didn't
consent to their words leaving the table. Also surfaces GDPR-
adjacent concerns; the home-game safe harbor is unclear when
content includes adult/violent fiction.

**Alternatives:**
- Per-player opt-out UI. Rejected for v1: prime directive
  violation (admin before play). Deferred to v2 if a real DM
  raises it.
- No acknowledgment. Rejected: silent custody transfer of
  player content fails the firewall ethos test.

**Tradeoffs:** One extra click per campaign on first push.
Mitigation: the dialog is also the natural surface for the
NEW-ADV-4 "what's saved" disclosure (DEC-010 sibling).

**Revisit if:** A player surfaces objection to backed-up
content; promote per-player opt-out.

---

## DEC-010 — Restore + rebroadcast firewall is BOTH apply-side and broadcast-side (2026-05-29)

**Decision:** NEW-ADV-1 + NEW-ADV-2 closure shipped in
commit `a7dedac`. Two complementary surfaces:

1. **Apply-side projection.** `persistence.ts` exports
   `projectSaveForViewer(doc, viewerIsCoord)`, the symmetric
   restore-side companion to `serializeSessionForViewer`.
   `quire-app.loadFromString` calls it with
   `viewerIsCoord=(sessionView.mode==='host')` before applying.
   Host loads are a no-op projection (auto-reclaim on next tick);
   guest loads strip DM-only events from the save before they
   reach the local event log.

2. **Broadcast-side classifier.** `persistence.ts` exports
   `defaultRebroadcastFilter(event)`. `Peer` takes an optional
   `rebroadcastFilter` in its constructor options;
   `session-controller.ts` wires the default into production.
   `Peer.forwardShareToOthers` runs every event through the
   filter before sending — DM-only kinds dropped, partial-
   payloads field-scrubbed via the same `PER_KIND_SCRUBBERS`
   registry that the save-side projection uses.

**Why:** The independent adversarial consultant's NEW-ADV-1 is
the 5th breach in the render-gated-but-restore-not-gated class
(same class as #392/#393/#395 + M1 map-blob). NEW-ADV-2 is the
sister leak from DEC-005's auto-broadcast — even though
NEW-ADV-1's projection prevents DM-only events from ENTERING
the loading peer's log in the happy path, the broadcast filter
is the defense-in-depth net if that projection ever regresses
OR if a DM-only event reaches the log via a different path
(buggy peer, hostile save, future regression).

Both fixes use the SAME `PER_KIND_SCRUBBERS` + `PLAYER_SCOPE_STRIP_KINDS`
registry; no new firewall list. The SSOT keeps classification
load-bearing across save / load / rebroadcast surfaces.

**Why injected (not imported) for the Peer filter:** The
`core/` layer must not depend on `persistence.ts` (would
introduce a circular import). Dependency injection via the
constructor option keeps `core/peer.ts` clean and lets
`session-controller.ts` wire the production seam.

**Alternatives:**
- Hard-refuse a coord-projection save when the local peer is
  non-coord ("Reclaim coord first, then import."). Rejected:
  legitimately broken for the cross-week sick-DM-handoff case
  where the new coord LEGITIMATELY needs the prior DM's
  scratch-notes + AI-context.
- Move `PLAYER_SCOPE_STRIP_KINDS` into `core/` so peer.ts can
  import it directly. Rejected as a larger refactor; revisit if
  more controllers need the firewall registry.
- Skip the rebroadcast filter and rely on NEW-ADV-1 alone.
  Rejected: defense-in-depth; the SAME firewall regression
  pattern keeps recurring (#392/#393/#395/M1 + now NEW-ADV-1).
  The cost of the filter is one PER_KIND_SCRUBBERS lookup per
  rebroadcast call; negligible.

**Tradeoffs:** Map-blob payloads at rebroadcast time use a
conservative empty reveal-mask (drop labels). The receiving
peer re-materializes the revealed state from its own log. A
player who receives a rebroadcast `map-blob-add` for a
not-yet-revealed blob sees it appear on their map without a
label until the reveal fires. Acceptable; the alternative
(send the label, trust the receiver to strip on render) is
the exact regression class NEW-ADV-2 catches.

**Revisit if:** A real session shows the conservative reveal-
mask is too aggressive for legitimate map-blob workflows
(then teach the filter to compute the reveal-mask from the
receiving peer's log before sending).

---

## DEC-009 — Default Drive scope is `drive.appdata`, not `drive.file` (2026-05-29)

**Decision:** Cloud-sync to Google Drive defaults to the
`drive.appdata` scope (hidden per-app folder). `drive.file` is
available as an opt-in setting for users who want manual recovery
via Drive's UI.

**Why:** The ADV-1 review finding (in `auth-strategy-review.md`)
identified a P1 leak: a DM accidentally clicking "Anyone with link
can view" on their Drive UI exposes the cleartext save (DM-coord
projection includes DM-only events) to anyone with the link.
`drive.appdata` is not visible in the user's Drive UI and not
shareable — closes the leak path structurally rather than relying
on a runtime warning.

**Why opt-in `drive.file`:** Some users want a manual backup workflow
("if Quire breaks, I can grab the JSON from my Drive"). Offer it,
with a docs link explaining the share-link warning.

**Alternatives:**
- Default to `drive.file` with ACL-check warning. Rejected: the ACL
  query has eventual-consistency concerns and the warning relies on
  the DM reading it before clicking through.
- Don't offer `drive.file` at all. Rejected: removes a legitimate
  recovery path some users will value.

**Tradeoffs:** `drive.appdata` is opaque to the DM (no manual
inspection via Drive UI). Mitigation: DM-only operational view
exposes a "Download backup" button that fetches the appdata file
and saves it to local disk.

**Revisit if:** Google deprecates `drive.appdata` or imposes a
quota that hurts. (Currently quota is shared with Drive's main 15GB
free tier; not a problem for sub-1MB Quire saves.)

---

## DEC-008 — M6 ships in three layered stages: appdata-ephemeral → passphrase-refresh → GitHub (2026-05-29)

**Decision:** M6 splits into M6a/M6b/M6c.
- **M6a:** Google Drive `drive.appdata` + PKCE + ephemeral
  access_token in JS memory (re-auth per session).
- **M6b:** Add passphrase-encrypted refresh_token in IndexedDB for
  cross-session persistence. APP users degrade to M6a.
- **M6c:** GitHub Device Flow + same save format committed to a
  configured repo path.

**Why:** Per UX-3 review finding, "re-auth every session" is
UX-unacceptable for weekly DMs. But the strict-no-creds C4 constraint
also has real value (especially for APP users). The layered ship
gets us the SHIPPABLE-FROM-DAY-ONE M6a while the UX-acceptable
M6b lands as a follow-up. M6c is the GitHub path which is similar
mechanics but different ceremony — natural follow-up.

**Alternatives:**
- Single-shot ship of all three. Rejected: too much scope for one
  reviewable commit; review surface area is enormous.
- Skip M6c entirely. Rejected: Underleaf is already GitHub-hosted;
  the symmetry of "campaign content on GitHub, saves on GitHub
  too" is valuable.

**Tradeoffs:** M6a-only is the minimum-viable ship. DMs running M6a
will re-auth per session for the duration of M6b development.

**Revisit if:** M6a UX is acceptable enough that M6b is unnecessary.
(Polling DMs after a few sessions of M6a-only will tell us.)

---

## DEC-007 — Build cloud sync (M6); strict OAuth + no creds in browser is the floor (2026-05-29)

**Decision:** Build cloud sync per the human's mid-session OP-006 call.
Locked constraints in `auth-strategy.md`:
- OAuth-based (PKCE for SPAs; no client_secret in the browser).
- No long-lived secrets persist unencrypted in localStorage / IndexedDB.
- Minimum-viable scopes: `drive.file` (Google), `public_repo` v1
  (GitHub).
- Must degrade gracefully under Google Advanced Protection Program.
- DM-initiated, manual push/pull is acceptable (no background daemon).
- Browser-to-browser sync (WebRTC) remains the live-session default;
  cloud is the **durability layer** for "all browsers evicted."

**Why:** The human explicitly chose build-over-strip and gave the
architectural shape ("OAuth ideally, user logs into third party then
pushes from browser, no credential sharing, scope-minimal, APP-compat").
This converts OP-006 from a binary-choice question into a design-and-
ship effort with consultant review as gating.

**Alternatives:**
- Strip the implication (was the prior recommended-default). Rejected by
  the human; we now have specific design constraints to work against.
- Build without security review. Rejected: the constraints are tight
  enough (no creds, APP, minimum scope) that getting them wrong
  silently could expose user data in a way that's hard to reverse.

**Tradeoffs:** Real engineering cost (estimated 1-2 weeks per provider).
Mitigation: design first, ship second. Draft 1 of `auth-strategy.md`
captures the architecture in writing for consultant review BEFORE any
code lands.

**Revisit if:** A consultant surfaces a fundamental obstacle (e.g.
"`drive.file` doesn't actually persist across sessions the way we
think"). Then re-scope.

---

## DEC-006 — M4 ships drill tests as standard CI, not nightly (2026-05-29)

**Decision:** The M4 restore-drill tests live in
`src/persistence.restore-drill.test.ts` and run on every `npm test`
(every CI invocation). NOT moved to a separate nightly job.

**Why:** The original roadmap framed M4 as "nightly job" because the
e2e versions of these scenarios are slow. The in-memory transport
makes the unit-test version ~140ms wall-clock for all 12 tests —
effectively free. Nightly would just add another infra path to
maintain for no latency win.

**Alternatives:**
- Separate nightly workflow firing on a schedule. Rejected: pure
  overhead. `npm test` already runs these.
- Keep in e2e only. Rejected: CI skips e2e; regressions land silently.

**Tradeoffs:** A devloper running `npm test` pays ~140ms more per run.
Mitigation: trivial.

**Revisit if:** The drill grows to 100+ tests and wall-clock matters.
Then split into `test:drill` ↔ `test:fast` and run the drill nightly +
on tagged commits only.

---

## DEC-005 — `applyEvent` propagates via the `sync-response` gossip path by default (2026-05-29)

**Decision:** `Peer.applyEvent(event)` now forwards newly-applied
events to all connected peers using `forwardShareToOthers` (sync-
response, hub-forwarding path). Callers can opt out with
`{ propagate: false }`.

**Why:** The architect-claim reproduction
(`peer.restore-rebroadcast.test.ts`) showed the 3-peer race: bob+carol
are connected, alice joins, on-connect bob+carol sync-request alice
who responds with EMPTY (her log was just constructed), THEN alice
loads N events via applyEvent. Pre-fix those N events never reach
bob+carol — pull-only model leaves a permanent gap. Default-on
propagation closes it.

**Why sync-response not share:** The `share` envelope is rejected by
the R2.1 impersonation defense when `event.peerId !== from`. Restored
events may be authored by a PRIOR session's peers (e.g. "bob's log
was restored from alice's autosave"). `sync-response` is exempt by
design — gossip-forwarding inherently re-ships events authored by
others. Recipients dedup via the EventLog id check, so retries are
idempotent.

**Alternatives:**
- Always propagate (no opt-out). Rejected: the `regenerateCode` path
  in session-controller leaves the network + rejoins; propagating
  during the in-between window has nothing to broadcast to and
  generates wasted work later. The opt-out keeps the seam usable.
- Batch propagate (one sync-response with all loaded events). Future
  optimization. Today's per-event broadcast is O(N×P) but correct;
  recipients dedup. Real campaigns load <10k events from save,
  multiplied by <8 peers ≈ 80k message-sends. localStorage saves
  the day on per-message overhead. Revisit if profiling shows it
  matters.
- Make the loader call `Peer.append` to "re-author" each event.
  Rejected: that creates NEW event ids and breaks idempotency,
  defeats the LWW determinism, and double-counts every restored
  event for everyone who already had it.

**Tradeoffs:** A peer who restores from save fires N broadcasts. For
realistic N (<10k for a long campaign) this is acceptable. The
recipient dedup at EventLog.apply makes retries free.

**Revisit if:** A profiling pass shows the per-event broadcast is
a bottleneck for a real DM session. Then batch into chunks.

---

## DEC-004 — Tab-close uses `visibilitychange === 'hidden'`, NOT `beforeunload` (2026-05-29)

**Decision:** `AutosaveController` listens for `visibilitychange` on
`document`. When `visibilityState === 'hidden'` AND a save is pending,
flush synchronously. The legacy `hostDisconnected()` cancel-on-route-
change behavior is preserved (distinct path; legitimate unmount
during slug navigation).

**Why:**
- `beforeunload` is suppressed on mobile Safari and during
  `pagehide`-triggered bfcache eviction. Saves there are silently
  lost.
- `visibilitychange → hidden` fires reliably across desktop + mobile
  and is the WHATWG Page Lifecycle recommendation.
- Synchronous `localStorage.setItem` inside a `visibilitychange`
  handler is durable — the browser has not yet released the page.
- `pagehide` ALSO fires but only on real unloads. `visibilitychange`
  fires on background-tab-too, which is the common DM case (alt-tab
  to GitHub for scene markdown). Saving more aggressively is fine —
  it's a single localStorage write, debounced internally by checking
  `this.timer === null` before doing work.

**Alternatives:**
- `beforeunload` alone — rejected per above.
- Both `beforeunload` + `visibilitychange` — rejected: double-write
  in some browsers, no durability gain.
- Make `hostDisconnected()` flush instead of cancel — rejected:
  route-change-during-typing should NOT fire a save, and the Lit
  lifecycle calls `hostDisconnected` for both tab-close AND
  route-change without distinguishing them.

**Tradeoffs:** Saving on tab-background increases localStorage write
frequency in DM workflows that frequently alt-tab. Mitigation: the
in-flight-pending check (`timer === null` short-circuit) means we
only write when there's an actual buffered change. Real cost:
near-zero.

**Revisit if:** A reproducible test shows a tab-close path where
`visibilitychange` does NOT fire (mobile Safari freeze, OS-level
tab-kill) — then add `pagehide` as a second signal.

---

## DEC-003 — Scrubber gets a precomputed reveal-mask via `ScrubContext` (2026-05-29)

**Decision:** `EventScrubber` signature is now `(event, ctx) => …`
where `ctx.revealedMapBlobs` is a precomputed `Set` of
`${scenePath}\0${blobId}` keys for blobs revealed at the end of the log.
Built once per `serializeSessionForViewer` call.

**Why:** `map-blob-add` / `map-blob-move` need to know whether to keep
the label, and the answer depends on the FUTURE `map-blob-reveal`
events in the same log. The materializer for map blobs is a no-op stub
today (M3a/M6 future), so we can't reuse `state.mapBlobReveals`. The
context object generalizes for the next cross-event scrub we'll write.

**Alternatives:**
- Always strip `label` from `map-blob-add`. Rejected: revealed blobs
  carry their label from the original `map-blob-add` event in the
  materializer; stripping the label here means revealed blobs would
  re-materialize with empty labels on the player side, breaking the
  player-visible-map promise.
- Two-pass on `serializeSessionForViewer` (compute, then rewrite).
  Rejected: this IS that approach, but cleaner expressed as a
  per-scrubber decision rather than a special-case after-pass.
- Compute reveal-mask lazily inside the scrubber. Rejected: O(n²) for
  no reason. Precompute once.

**Tradeoffs:** Every scrubber signature is now `(event, ctx)` even when
unused. Mitigation: existing scrubbers accept a second optional
parameter naturally.

**Revisit if:** Another cross-event scrub needs a different precomputed
fact (then add a second field to `ScrubContext`).

---

## DEC-002 — M1 fixes both Adversarial #1 (map-blob payload) AND #2 (causedByResponseId) in one commit (2026-05-29)

**Decision:** Bundle the two field-granularity scrubber additions into a
single M1 ship because they share the same scrubber-registry mechanism and
the same test infrastructure.

**Why:** The `PER_KIND_SCRUBBERS` registry is the cleanest place for both.
Shipping them together means one new self-completing tripwire (Adversarial
#3) covers both. Splitting would double the design overhead for negligible
risk reduction.

**Alternatives:**
- Two separate commits. Rejected: needless ceremony.
- Defer #2 because it's "latent today." Rejected: latent-today is exactly
  when an audit-trail field gets quietly added downstream; the cheap fix
  now precludes the regression.

**Tradeoffs:** One slightly larger commit. Mitigation: tests cover each
case independently so bisect still works.

**Revisit if:** The two fixes pull in different directions during
implementation (then split).

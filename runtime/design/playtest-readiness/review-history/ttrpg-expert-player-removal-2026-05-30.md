# TTRPG / Game Design — player removal + PC rebirth advisory

**Briefed reads:** `underleaf/world/rules.md`, `underleaf/world/overview.md`,
`runtime/design/reviewer-playbook.md`, `runtime/src/core/state.ts`
(`Seat`, `PcLifecycleState`, `applyPcRetireOrArchiveEvent`, bond
plumbing), `runtime/src/character-loader.ts`.

## Verdict — 2 sentences

Both scenarios are genuinely out-of-band: the storytelling primitive
isn't "another way to retire" — it's *the DM editing the fiction's
ledger of who was ever at the table*. Ship one new coord-only event,
`pc-revoke`, with a `narrativeShape` discriminator
(`never-arrived` / `offstage-forever` / `recast`); do NOT extend
`pc-retire`, do NOT touch chat/dice history, and surface it in the
DM operational view behind the run-#17 two-step confirm idiom.

## Q1-Q10 answers

### Q1. Scenario A in-fiction shape (player vanishes)

**Claim.** Underleaf's right shape is **"never really arrived"** —
the seat collapses out of history as if that chair was empty.

**Rationale.** `overview.md` is grounded, present-day, low-fantasy
("You are a person trying to live your life in an interesting
time."): the cosmology supports quiet continuity edits (people drift
out of group chats) far better than melodramatic death framing.
`pc-retire` already covers "this PC stepped offstage with a player-
safe in-fiction reason" and memorializes the seat via `seatMemory`
(state.ts:280). What's missing is *"the character never existed in
this telling at all"* — exactly what the user requested.

**Underleaf-specific note.** Sticky-N seats (state.ts:243-245) mean
the slot integer is reserved for replay determinism regardless of
shape. "Never arrived" cannot mean *deleted slot*; it means *slot
returns to unbound, prior PC record cleared, no memorial.*

### Q2. Scenario B in-fiction shape (PC rebirth in same slot)

**Claim.** The right shape is **out-of-game retcon** — the DM and
player agree the new PC was always the one in the story. NOT "old PC
died offscreen," NOT "magical reset."

**Rationale.** "Old PC died" forces every prior scene to re-narrate
around a death — the exact reauthoring the user explicitly wants to
avoid. "Magical reset" is worse: it weaponizes The Quiet
(rules.md:128) as a narrative-laundering device. The five-state
ladder is *earned by the caster's behavior in fiction*; using it to
cover an out-of-game churn breaks rules.md's "Story over mechanics"
pillar in reverse — making a meta event masquerade as in-fiction
consequence. The honest framing is the long-running-group convention
*"from now on it was always Mira, not Yui"*: events stay, identity
at that slot replaces wholesale.

**Underleaf-specific note.** The magic-discovery DM-private
accidental-cast log (rules.md:178) is per-PC. On recast the log
should clear for the new PC — they shouldn't inherit two sessions
of latent casting they didn't play. This is a clean-slate concern,
not a fiction-shape concern.

### Q3. Bonds and cross-PC references

**Claim.** **Tombstone with DM-chosen handling.** Three sub-options
at revoke time:
- **Reassign** (recommended default for "offstage" / "recast"):
  DM picks a new target PC or NPC; bond text may need tweak.
- **Tombstone** (default for "never-arrived"): bond text survives,
  target shows as "(former friend)" or DM-supplied stand-in name.
- **Drop**: bond disappears with no fanfare — only when bond was
  brand-new.

**Rationale (prime directive + silent-player firewall).** Hard-
deleting leaves the remaining player staring at a sheet that *was
different last session*, generating the exact "what happened?"
question the firewall suppresses. Reassign-to-NPC is the best
general fit for Underleaf: bonds were authored toward a *person*;
NPCs are people; grounded tone makes "I trust them to hold my line"
re-pointable. Telling the remaining player "your bond was orphaned
because the DM removed Yui" is the canonical firewall violation —
the change must be experienced as *fiction shifting under them*,
the way fiction always shifts.

**Engine semantics.** `pc-revoke`'s materializer walks
`state.pcBonds` + `state.pcBondProposals` and either rewrites
`targetPcId` (reassign) or marks tombstoned (sentinel
`targetPcId === '__former__'` + DM-supplied stand-in text).

### Q4. Chat history and prior events

**Claim.** **Stay verbatim, with byline preserved** (option (a)).

**Rationale.** The session is event-sourced; persistence has a
byte-identical round-trip invariant (M4 restore drill). Retroactively
scrubbing chat/dice events would invalidate that, require a
destructive log-rewrite the architecture rejects, and erase the
audit trail if the player returns. The prime directive cuts both
ways: the *story* is what the table experienced. Wiping a player's
contributions denies remaining players the truth of what they
played. The chat log IS the campaign's memory; a critical hit
narrated three sessions ago is part of the fiction's spine — the PC
is gone, the *roll happened*. Treat the byline as ink, not pencil.

Of the brief's four options: (a) ✓; (b) cover-up + breaks audit;
(c) trashes invariants and forecloses on the player returning; (d)
creates per-viewer truth drift — exactly the firewall complexity
the engine has worked to *reduce*.

### Q5. The "creative retcon" semantic

**Claim.** **One new coord-only event: `pc-revoke`.** NOT a
sequence of existing events.

**Rationale.** Composing `pc-archive` + `peer-leave` +
`pc-create-new` atomicity-breaks across the firewall: three
independent materializations on player peers produce a brief
"Yui is here / Yui is gone / new PC arrived" flicker in roster
diffs — exactly the leak Q10 warns about. The reviewer-playbook's
"must-be-atomic multi-event sequences → single atomic event"
guidance (precedent: `pc-mark-realization`) applies directly.

**Minimum primitive shape.**
```ts
interface PcRevokePayload {
  v: 1;
  slot: number;                              // operate on the seat
  narrativeShape: 'never-arrived'
                | 'offstage-forever'
                | 'recast';
  inFictionLabel?: string;                   // player-safe (optional)
  dmReason?: string;                         // DM-only, ≤ 200
  bondPolicy: 'tombstone' | 'reassign' | 'drop';
  bondReassignTarget?: string;               // pcId or npcId
}
```

Materializer (coord-only, idempotent like `pc-retire`):
1. Delete `synthesizedPcs[pcId]` for `never-arrived` /
   `offstage-forever`; mark-tombstoned for `recast` (referenced by
   old chat but not rendered as live PC).
2. Seat → `unbound-revoked` (sticky-N reserved) for
   `never-arrived` / `offstage-forever`; `bound-recast`
   interstitial for `recast`.
3. Apply bond policy to `pcBonds` + `pcBondProposals`.
4. Clear `pcRetireRequests` / `pcRetireRejections` for the pcId.
5. Clear `peers[*].pcId` claims for the slot (do NOT emit
   `peer-leave` — peer may still be a guest).
6. Clear the DM-private accidental-cast log for the pcId
   (Underleaf-specific; see Q2).

For scenario B the DM follows up with normal `pc-create` +
`pc-slot-bind`; `bound-recast` reserves the seat through chargen.

### Q6. Distinction from existing `pc-retire` / `pc-archive`

**Claim.** **Third kind, NOT an extension.**

**Rationale.** `pc-retire`'s invariant is *the PC is preserved as
a referenced narrative entity*: `synthesizedPcs[pcId]` stays;
seat memorializes via `seatMemory` + `inFictionRetireReason`;
Aside roster says *"the medic whose silence said more than her
words."* That is **exactly what the user said they don't want**.
`pc-revoke` intentionally violates that invariant for
`never-arrived`. Two distinct invariants → two distinct events.
Conflating would force the DM to choose between "honest in-
fiction" (with memorial visible) and "actually gone" via copy-
overload of one event — the conflated-affordance shape the
firewall punishes.

**Decision matrix for the DM:**

| Situation | Event | Player Aside roster shows |
|---|---|---|
| PC died/left in fiction; we honor | `pc-retire` | "Sora — left after the betrayal" |
| Stepping out, may return | `pc-archive` | "Sora — between chapters" |
| Player vanished; PC barely existed | `pc-revoke` (never-arrived) | "Open seat" |
| Player still here, PC didn't work | `pc-revoke` (recast) → new `pc-create` | new PC; no memorial of old |
| Player vanished mid-arc; PC mattered | `pc-revoke` (offstage-forever) | "Sora — went home"; NO memorial |

`offstage-forever` is deliberately stripped vs retire: no
`seatMemory`, no retire-reason enum, no honor-the-character UX.
It's *"they're not coming back; don't celebrate them."*

### Q7. UX placement

**Claim.** **DM operational view → roster card → per-seat "Manage
seat ▾" disclosure → "Remove from story…"**

**Rationale.** Not chargen-dm-review (bounded by the pre-chargen
window; user explicitly said the need spans into early sessions).
Not the live session-roster header (Riley persona: *anything that
breaks scene momentum is a UX bug* — revoke is between-sessions
work). The DM operational view already houses destructive-shaped
operations (Start fresh, Disconnect, cloud-push consent) and
groups revoke with peers in cognitive shape: *things the DM does
to the campaign's shape, not its fiction.*

Secondary lightweight entry-point in chargen-dm-review (pre-game
sub-case) is fine — same `pc-revoke` event under the hood, not a
parallel surface. I'd defer it past v1 (see sequencing).

### Q8. Confirmation gate

**Claim.** Two-step confirm. DM-only surface; players see nothing
about the affordance.

**Copy (prime directive + firewall honoring):**

Step 1 (disclosure on seat card):
> **Remove this seat from the story**
> Use when a player won't continue, or you and the player agree
> to recast their character.
> Shape: [Never arrived | Gone for good | Recast ▾]
> Bonds to this PC: [Carry over to (NPC) | Become memory of a
> former friend | Drop ▾]
> [Continue ▸]

Step 2 (confirm):
> You're about to remove **Sora** from the story.
> Your players won't be told — they'll see the seat as if it had
> always been this way. Their bonds to Sora will become bonds to
> **Mateo** (NPC).
> This is reversible only by reloading an earlier backup.
> [ Confirm ] [ Cancel ]

What's absent: no "files / records / database / delete / wipe /
purge" framing; no player-vs-DM language ("kick"); no mention to
remaining players — the copy explicitly names the silence so the
DM consents to the firewall in action.

### Q9. Pre-game / mid-game distinction

**Claim.** **The engine does NOT need a hard distinction.** Same
`pc-revoke` for both. The UI offers shape guidance, not gating.

**Rationale.** If the seat has zero gameplay events authored, all
three shapes are equivalent in effect. After even one session,
`never-arrived` still works narratively (the table agrees to
retell), but chat bylines remain (per Q4). When the seat has > 0
dice rolls or > N chat messages, show a DM-facing tooltip on
"never arrived": *"There are N moments from this player in the chat
log. They'll stay as-is in the history."* Prime-directive-honoring
disclosure: data to choose, not a gate.

**Underleaf-specific note.** The one pre-vs-mid asymmetry is the
DM-private accidental-cast log (rules.md:178). Clear it on revoke
regardless of shape — the new PC starts at zero accidental casts.

### Q10. Firewall implications

**Claim.** **Revoke leaks the change to remaining players via
roster diff**, acceptable under the civilized-peer threat model,
but requires deliberate UX to minimize.

**Leaks + mitigations:**
- **`synthesizedPcs` disappearing** is observable: players who
  rendered "Sora" last session stop. *Mitigation:* this IS the
  leak surface; can't pretend Sora's tile was never there if
  players saw it. DM picks the in-fiction explanation; UI doesn't
  auto-narrate. Matches Underleaf's grounded tone (people quietly
  stop appearing).
- **`peers[peerId].pcId` going null** is observable as the
  player's presence chip changing if they're still connected.
  *Mitigation:* prefer running revoke *after* the player has left.
  UI guard: *"Player is currently connected. Wait until they've
  left, or proceed anyway."*
- **Bond-list change on the remaining player's sheet.**
  *Mitigation:* per Q3, prefer reassign-to-NPC; bond text drifts
  smoothly rather than vanishes. Highest-craft mitigation.
- **Slot index renumbering:** *do not.* Sticky-N is load-bearing
  for replay determinism. Slot 3 stays slot 3; empty slot renders
  as "Open seat."

Threat-model alignment: matches the locked civilized-peer model
(`project_quire_threat_model`). The table will know there was a
fourth PC; the engine helps the DM tell a clean retold story, not
provide cryptographic forgetfulness.

## Recommended engine primitives

1. **`pc-revoke`** event kind, coord-only, payload per Q5.
   Atomic materializer mirroring `pc-retire`'s idempotency
   pattern (state.ts:3007 same-state guard).
2. **Two new `SlotState`s** (recommended; see open call):
   `unbound-revoked` (seat slot held by sticky-N, treated as empty
   in roster) and `bound-recast` (interstitial during replacement-
   PC chargen).
3. **Firewall classification.** Player-visible event kind with
   DM-only sub-fields (same shape as `pc-retire`): `dmReason`
   strips via a `RETIRE_DM_ONLY_PAYLOAD_FIELDS`-style entry;
   other fields survive. Hand off to Adversarial per
   reviewer-playbook §Hand-off rule.
4. **Bond-rewrite helpers** in `state.ts`, extracted as named
   functions (tombstone / reassign / drop) for reuse and
   property-testing.
5. **Tombstone sentinel.** `targetPcId === '__former__'` + DM-
   supplied stand-in text suffix on the bond entry.
6. **Accidental-cast-log clear.** Underleaf-specific: clear the
   DM-private log for the pcId on revoke (any shape).
7. **No `pc-revoke-request`** for v1. Players asking to erase
   themselves from the story is a table conversation, not an
   engine primitive. `pc-retire-request` covers the common case.

## Recommended UX surfaces

- **Primary:** DM operational view → roster card → per-seat
  "Manage seat ▾" → "Remove from story…" (two-step confirm per
  Q8).
- **Secondary (defer past v1):** chargen-dm-review per-pack
  context menu → "Player won't continue / start over."
- **Tertiary (skip for v1):** recently-played list per-seat
  toggle.
- **Post-revoke toast (DM-only):** *"Sora removed. Bonds carried
  over to Mateo. Players won't be notified."* — the "won't be
  notified" line is the DM's explicit consent to the silent-
  player firewall.

## Open product calls for the human

1. **One SlotState or two?** Two (`unbound-revoked` +
   `bound-recast`) avoids the brief flicker; one keeps the state
   machine smaller. Engineering judgment, not TTRPG judgment.
2. **Reassign-to-NPC: existing only, or on-the-fly create?**
   I'd recommend existing NPCs only for v1; on-the-fly create
   can ride the M4 living-doc workflow later. Product call about
   how much chrome the dialog needs.
3. **Auto-clear the magic-discovery DM-private log on revoke?**
   Engine-true answer is yes; table-true answer might be the DM
   wants to keep it as a note for the new PC's chargen. I lean
   engine-true. Product call.
4. **Player-initiated revoke?** Rare but real ("I'm uncomfortable
   with how this turned out"). Out of scope for v1; flag for
   empathy-of-table-design axis.

## How the lead should sequence this

Land `pc-revoke` event + materializer + firewall classification +
slot-state additions first (one PR, with the regression test
asserting bond-rewrite + `synthesizedPcs` clear + roster-diff
shape per the reviewer creed). Wire the DM operational view
surface with the two-step confirm second, copying the run-#17
`<start-fresh-confirm-dialog>` idiom. Defer the chargen-dm-review
entrypoint to a third PR after a mock-campaign 12 ("player ghost +
recast") playthrough surfaces the real DM workflow — UI for the
chargen-window case should follow observed need, not anticipated
need.

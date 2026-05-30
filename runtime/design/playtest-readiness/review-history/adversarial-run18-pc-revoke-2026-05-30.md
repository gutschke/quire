# Adversarial review — run #18 pc-revoke — 2026-05-30

In-program adversarial pass on Run #18 (`pc-revoke` engine + DM
operational view UI surface).  Goal: confirm firewall + bond +
sticky-N invariants hold + nothing regresses Run #16 / Run #17
PLAYTEST GREEN.

## Verdict — one sentence

GO for playtest 1 with run #18 included; ALL Run #18 surfaces hold
the firewall + bond-rewrite + silent-player invariants; one P3
follow-up (per-bond tombstone configuration) noted as the right
shape of future iteration, NOT a playtest blocker.

## Surfaces audited

1. `pc-revoke` engine event (state.ts:3155-3350): payload validation,
   materializer, idempotence, peer.pcId clear, bond rewrites, magic-
   discovery wipe.
2. `scrubRevoke` per-kind scrubber + `REVOKE_DM_ONLY_PAYLOAD_FIELDS`
   (persistence.ts:131-134, 489-504).
3. `EVENT_KINDS_PLAYER_VISIBLE` classification (persistence.ts:774-
   780).
4. Restore-firewall-fuzz coverage (persistence.restore-firewall-
   fuzz.helpers.ts:198+).
5. `appendPcRevoke` + `handlePcRevokeRequest` + `buildManageSeatRows`
   host wiring (quire-app.ts).
6. `<pc-revoke-confirm-dialog>` + Manage seats section
   (dm-operational-view.ts) + 10 dialog tests + 7 manage-seats
   tests + 7 mock-12 scenarios.

## Firewall invariants

### F-1 (PASS) — DM-only sub-field strip on player save

`scrubRevoke` strips `narrativeShape` + `causedByPeerId` (mock-12
D1).  Materializer tolerates absence per DEC-030 — slot still
enters `revoked` on the player projection (mock-12 D1 + E1).

### F-2 (PASS) — Bond tombstone is player-safe by construction

`bondTombstoneName` + `bondTombstoneNpcId` survive into the player
save AS-IS.  The DM authored the string explicitly knowing the
remaining player would see it (the dialog copy names the silence
gate first).  This is the right shape per Q3 expert advisory + the
"silent-player firewall" memory entry: the player sees the renamed
bond as if the fiction shifted under them, not as a system-inserted
notification.

### F-3 (PASS) — No system chat / toast inserted

Mock-12 E1: chat-event count is identical pre/post revoke on both
DM + player projections.  Engine emits ONE event (the `pc-revoke`
itself) and nothing else.  No "Mei was removed" announcement.

### F-4 (PASS) — Sticky-N preserved

Slot integer doesn't renumber on revoke.  Mock-12 A1 + B1 + C1 all
assert slots 1 + 3 (or 1 alone) untouched while slot 2 (or 1) gets
revoked.

### F-5 (PASS) — Materializer cross-check (slot vs pcId consistency)

state.ts:3243-3255: the materializer finds the seat by walking
`pcSlots` for the pcId, then asserts `targetSlot === p.slot`.  A
hostile / corrupted event quoting the wrong pcId for the wrong
slot is silently rejected.

### F-6 (PASS) — Idempotence

state.ts:3257: `if (prior.state === 'revoked') return;` — re-emitting
`pc-revoke` on an already-revoked seat is a no-op.

### F-7 (NOT A FINDING — by-design) — Player's view of the revoked PC's prior chat

Per Q4 expert advisory (mock-12 A2): pre-revoke chat lines survive
verbatim with byline preserved.  This IS the design — the chat log
is the campaign's memory.  A player reading back the chat history
DOES see the revoked PC's prior contributions.  This is the "honest
about what happened at the table" stance.

## Bond invariants

### B-1 (PASS) — Inbound bonds tombstoned, never dropped

mock-12 A1 + B2.  Bond entry survives; gains a `tombstone.name`
field (+ optional `targetNpcId`).  The renderer can show "(former
friend) Mateo" without crashing on a deleted synthesizedPcs lookup.

### B-2 (PASS) — Outbound bonds dropped (no orphan source)

state.ts:3290 — `delete state.pcBonds[p.pcId]` for the revoked PC.
No source PC left to render bonds under.

### B-3 (PASS) — Inbound proposals dropped

state.ts:3316-3322: un-ratified proposals targeting the revoked PC
are filtered out.  Per Q3 expert advisory: stale drafts to a
revoked PC are confusing; let the source player re-author if needed.

### B-4 (PASS) — Outbound proposals dropped

state.ts:3291: `delete state.pcBondProposals[p.pcId]` — same shape
as outbound bonds.

### B-5 (P3, deferred per design — NOT a blocker)

Per-bond tombstone configuration not yet surfaced in the dialog.
Today: ONE tombstone name + ONE optional NPC reassignment applies
to ALL inbound bonds uniformly.  Per the design DEC-040 + the
expert's Q3: this is acceptable for v1; per-bond decisions are a
follow-up iteration.  The dialog displays the list of inbound bond
sources so the DM knows what they're affecting.

## Silent-player firewall

### S-1 (PASS) — DM consent gate copy

The confirm dialog body explicitly reads "Your players won't be told
this happened.  Choose the fictional explanation you want to use."
The DM cannot proceed without seeing the firewall implication.  Per
expert Q8.

### S-2 (PASS) — Player-side surface is empty

mock-12-style assertion in dm-operational-view.test.ts (last test
in Manage seats describe): `renderForDm=false` + non-empty
`manageSeats` prop → the Manage seats section is absent on the
player render.  Defense-in-depth in addition to the
`isCoordinator()` host gate.

### S-3 (PASS) — No leaked DM-only metadata in the player projection

mock-12 D1.  `narrativeShape` + `causedByPeerId` stripped.  Player
sees ONLY: pcId, slot, bondTombstoneName, bondTombstoneNpcId (the
last two are player-safe by construction).

## Forward-compat parity

### FC-1 (PASS) — `REVOKE_DM_ONLY_PAYLOAD_FIELDS` is the contract

Run #14 INV-RENAME-FIREWALL: a v:2 of pc-revoke that renames
`narrativeShape` to a new key requires the maintainer to ship a
scrubber update.  DEC-031 §1's contract-level prohibition load-bears
as the primary defense.  `scrubRevoke` doesn't apply the
`payloadFieldNameKeyNamesDmField` scan because the pc-revoke DM-
only fields (`narrativeShape`, `causedByPeerId`) are NOT in the
`DM_ONLY_CHARACTER_FIELDS` vocabulary — that scan would never
trigger on pc-revoke payloads either way.  The right defense is
DEC-031's contract.  CLEAN.

### FC-2 (NOT A FINDING) — No `FIELD_NAME_KEYS` overlap with pc-revoke payload keys

Walked: `field` / `path` / `target` / `key` / `attr` / `prop` — none
match pc-revoke's payload field names.  No false-positive risk on
the FIELD_NAME_KEYS scan EVEN IF we added it to scrubRevoke.

## Host wiring

### H-1 (PASS) — `appendPcRevoke` validation gates

Confirms coord-only + active-session + valid enum + bounded string
lengths before appending.  Slot bounded to 1..256.  Refuses
silently on any violation, returns false.

### H-2 (PASS) — `handlePcRevokeRequest` is the bridge

Pure shape adaptation from the UI's `PcRevokeRequestDetail` →
`appendPcRevoke` arg shape.  Optional fields conditionally spread
to avoid emitting `undefined` properties on the event payload.

### H-3 (PASS) — `buildManageSeatRows` is read-only

Walks `sessionView.shared.pcSlots` + `synthesizedPcs` + `pcBonds`.
No mutation.  Inbound-bond sources de-duplicated per source PC.
Display names resolved via `synthesizedPcs[pcId].name ?? pcId`
fallback.  Returns empty when no active session or non-coord.

### H-4 (PASS) — Manage seats prop is empty for player-side render

`renderDmOperationalView` only builds `manageSeats` when `dm`
short-circuit passes.  Player render gets `manageSeats=[]` AND the
view's `renderForDm=false` short-circuit also fires.  Both gates.

## Lessons-learned coverage

### LL-1/2/3 — Production click path drives the engine state

Mock-12 C1 drives a real `QuireApp` Lit element through the click
path: mount → seed session → flip appMode → click toggle → click
remove → flip dialog radio → click confirm → wait → assert ENGINE
STATE (not DOM render flags).  Closes the same anti-pattern that
LL-1 / LL-2 / LL-3 named.  CLEAN per the discipline.

## Top hazards (ranked)

### H-1 (P3, post-playtest) — Manage seats discoverability not tested in-app

Run #18 doesn't add an in-app discoverability cue for the new
affordance.  DMs find it via the operational view, same as backups.
NOT a playtest blocker (the operational view is a low-stress
surface; DMs already know how to open it).  If playtest surfaces
DMs missing the affordance entirely, follow up with a chip
launcher (similar shape to OP-037's session-digest backup chip).

### H-2 (P3, post-playtest) — Inbound bond NPC reassignment defaults to empty

`<quire-app>` passes `availableNpcs=[]` because the campaign-level
NPC store (`synthesizedNpcs`) is a future addition (DEC-040).  The
dialog falls back to the free-text stand-in input correctly; this is
the documented v1 shape, NOT a finding.

### H-3 (NOT FILED) — None more

No P0 / P1 / P2 hazards identified.

## GO / NO-GO

**GO for playtest 1 with run #18 included.**

The Run #18 surfaces are isolated to the DM operational view
(behind the dm-operational appMode) and the engine event
(`pc-revoke`, behind coord-claim gate).  The Run #16/#17 PLAYTEST
GREEN paths are unaffected — Mock-11 (Start fresh), Mock-10
(cross-campaign routing + digest), Mock-09 (UI findability) all
still pass.

The reserved contingency for surprises is conceptually unspent — if
a playtest dry-run with the new affordance surfaces a P0, the
program lead has full discretion to escalate.

## Files audited

- `runtime/src/core/state.ts` (pc-revoke materializer + payload
  validation + bond rewrite + idempotence guard)
- `runtime/src/persistence.ts` (REVOKE_DM_ONLY_PAYLOAD_FIELDS +
  scrubRevoke + EVENT_KINDS_PLAYER_VISIBLE entry)
- `runtime/src/persistence.restore-firewall-fuzz.helpers.ts`
  (pc-revoke sentinel planter)
- `runtime/src/quire-app.ts` (appendPcRevoke, handlePcRevokeRequest,
  buildManageSeatRows, renderDmOperationalView wiring)
- `runtime/src/ui/regions/dm-operational-view.ts` (Manage seats
  section + dialog mount)
- `runtime/src/ui/regions/pc-revoke-confirm-dialog.ts` (dialog UX)
- `runtime/src/ui/regions/pc-revoke-confirm-dialog.test.ts` (10
  tests)
- `runtime/src/ui/regions/dm-operational-view.test.ts` (manage
  seats section: 7 new tests)
- `runtime/src/persistence.simulation-12-revoke-and-recast.test.ts`
  (7 scenarios end-to-end)

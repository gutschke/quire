# Mock Campaign 06 — Game-mechanic edges through save/restore

## Scenario brief

A mid-arc table with two PCs.  Mei (player A) has been pushing into
trouble all session and stands at harm 3 / stress 3 — one more bad
roll away from the rules.md:131 "out-of-action" box.  Anya (player
B) is the veteran PC with 7 advancements taken (one shy of the
rules.md:166 cap of 8).  The DM has been seeding bonds + foci for
session 6 and is about to bump up against the
rules.md-grounded ceiling:

- `MAX_BOND_DRAFTS = 3` (chargen-pack.ts:115).
- `ADVANCEMENT_CAP = 8` (character-loader.ts:84).
- `HARM_MAX = 4` / `STRESS_MAX = 4` (character-edits.ts:48-49).
- Focus grants have no engine cap — but the rendered UI must
  not blow up at "many foci" either.

What we exercise:

1. **Harm to max (4)** — Mei takes the killing-blow hit; sheet
   renders "out-of-action"; save mid-state; restore on the same
   peer + fresh peer; sheet still renders correctly.
2. **Stress to max (4)** — Mei rolls a stress 4 (Broken); save /
   restore; sheet still renders correctly.
3. **Advancement to cap (8)** — Anya takes her 8th advancement;
   the session-open-stage cap-reached chip appears in place of
   the "advancement taken" button; save; restore; the cap chip
   survives the round-trip; a 9th advancement attempt clamps.
4. **Bond limit (3 drafts)** — Mei's chargen pack already
   declared 3 bond drafts at chargen time; the chargen-pack
   validator + chargen-persistence cap-handling are exercised;
   a 4th bond-draft submission is dropped per cap; save /
   restore preserves the 3 accepted bonds.
5. **Focus-grant "many"** — DM grants 10 foci to Anya across the
   session; save / restore; non-coord viewer sees the foci;
   `boundFor` / `notes` (DM-only sub-fields) are stripped per
   D-prep-2-A; foci appear in stable order.
6. **PC retire mid-session** — Mei retires (state=`bound-retired`,
   reason=`died`, scene=`ep04/scene-07-the-quiet-took-her`); save;
   restore on a non-coord viewer.  Verify:
   - retired-tile renders (state preserved).
   - seat memory preserved.
   - DM-only retire metadata (`reason` enum + `scene` path) is
     STRIPPED on player save per BLOCKER B-1 firewall.
   - player-safe `inFictionReason` survives.
7. **Co-DM yield with half-completed scene-reveal** — primary DM
   has revealed scene `ep04/scene-07` but only revealed 2 of the
   4 paragraph blocks via `scene-reveal-paragraph`.  Primary
   yields, co-DM takes over, saves; restore preserves the
   partial reveal mask (player sees the 2 revealed blocks AND
   the scene-revealed-state; the 2 unrevealed blocks remain
   gated).

## Driving approach

**Code-level simulation** at
`src/persistence.simulation-06-game-mechanic-edges.test.ts`.
Drives the same Peer + InMemoryNetwork primitives the other
simulations use; asserts invariants between beats; the test file
IS the simulation transcript.

The render-layer assertions exercise `filterForViewer` +
`applyCharacterEdits` + the persistence projection helpers —
together these are the load-bearing rendering chain for sheet
display.

## Per-turn script

### Beat 1-4: pre-session setup

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 1 | DM | `peer-join` × 3 + `coordinator-claim` + `seat-add` × 2 + `pc-create` × 2 + `pc-slot-bind` × 2 | Two seats bound to Mei + Anya. |
| 2 | Mei-player | `peer-rename({pcId: 'mei'})` | Mei controller-bound. |
| 3 | Anya-player | `peer-rename({pcId: 'anya'})` | Anya controller-bound. |
| 4 | DM | Push Anya to 7 advancements via `pc-edit({field:'advancements', value:7})` | Anya at cap-1. |

### Beat 5-7: harm-to-max

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 5 | DM | `pc-edit({pcId:'mei', field:'harm', value: 4})` | applyCharacterEdits clamps to HARM_MAX=4; state.pcEdits['mei'].harm = 4. |
| 6 | (assert) | Render Mei via `applyCharacterEdits(base, edits)` | `effectiveCharacter.harm === 4`; harmTagLabel returns the box-4 "out-of-action" string. |
| 7 | DM | Manual save: `serializeSession(events, now)` → stringifySave → parseSaveDocument → applySaveToLog → fresh log on new peer | Same materialized state; harm=4 persists; render is same; firewall holds for non-coord viewer. |

### Beat 8-10: stress-to-max

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 8 | DM | `pc-edit({pcId:'mei', field:'stress', value: 4})` | clamps to STRESS_MAX=4. |
| 9 | (assert) | Render Mei via `applyCharacterEdits` | `effectiveCharacter.stress === 4`; render layer should mark Mei as "Broken" per harmTagLabel-equivalent. |
| 10 | DM | Save → restore → re-render | All consistent. |

### Beat 11-14: advancement to cap

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 11 | DM | `pc-edit({pcId:'anya', field:'advancements', value: 8})` | Anya at cap. |
| 12 | (assert) | Render the carryover card for Anya | `CarryoverPcCard.advancements === 8` → session-open-stage shows "advancement cap reached (8)" instead of "Advancement taken — reset marks" button. |
| 13 | DM | Save → restore | `pcEdits.anya.advancements === 8` survives. |
| 14 | DM | Attempts pc-edit({field:'advancements', value: 9}) | applyCharacterEdits stores raw 9 in pcEdits (no engine clamp on advancements per the floor-only branch); but the cap-reached chip still renders at >=8. Document the latent over-cap exposure. |

### Beat 15-17: bond drafts at cap

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 15 | Mei | `packChargen({bondDrafts: 3 drafts})` | Valid pack. |
| 16 | Mei | Tries `packChargen` with 4 drafts | `validateChargenPack` rejects; throws or returns invalid. |
| 17 | DM | Saves the pack-bundled session, restores, asserts 3 ratified bonds survive | Bonds present + `dmNotes` sub-fields stripped on player save. |

### Beat 18-21: many foci

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 18 | DM | 10 × `focus-grant({pcId:'anya', focus:{id, name, domain, boundFor:'DM-private', notes:'DM-private'}})` | All 10 land; state.pcFoci['anya'] has 10 entries. |
| 19 | (assert) | filterForViewer for Anya viewer | sees all 10 foci by name + domain; boundFor + notes stripped. |
| 20 | DM | Save → restore | foci order preserved (event sort). |
| 21 | (firewall) | serializeSessionForViewer for non-coord viewer (Anya), parse, replay | events contain focus-grant; payloads have NO boundFor or notes. |

### Beat 22-25: PC retire mid-session

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 22 | DM | `pc-retire({v:1, pcId:'mei', state:'bound-retired', reason:'died', scene:'ep04/scene-07-the-quiet-took-her', inFictionReason:'Mei walked into the silence.', seatMemory:'She heard them and answered.'})` | Materializer: seat → bound-retired; retireReason='died'; retiredScene=path; inFictionRetireReason= player-safe text. |
| 23 | (assert non-coord render) | filterForViewer for Anya viewer | sees seat state=bound-retired + inFictionReason + seatMemory; does NOT see retireReason / retiredScene / retiredAt (`state.ts` per-Seat filter strips these). |
| 24 | DM | Manual save → serializeSessionForViewer for Anya → stringify → parse | the persisted pc-retire event payload has NO `reason` and NO `scene` (B-1 BLOCKER fix). |
| 25 | DM | Same save, restored on a fresh Anya peer, materialize, filter → render | retired-tile renders identical to live-play render in beat 23. |

### Beat 26-30: co-DM yield with half-completed scene reveal

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 26 | DM | `scene-reveal({scenePath:'ep04/scene-07'})` + 2 × `scene-reveal-paragraph({scenePath, blockHash})` (blocks A + B) | state.revealedScenes contains the scene; partial paragraph reveal map captured. |
| 27 | DM | `coordinator-yield()` + co-DM `coordinator-claim()` | Co-DM in charge. |
| 28 | Co-DM | Manual save (DM-coord projection) → parse → replay | revealedScenes + scene-reveal-paragraph events all survive. |
| 29 | (Anya-viewer) | After fresh-load + materialize + filterForViewer | sees scene as revealed (player perspective); 2 paragraph blocks marked revealed; the other 2 blocks remain gated. |
| 30 | (firewall) | serializeSessionForViewer for Anya, parse, materialize | same: 2 blocks revealed, 2 gated.  No DM-staging spoiler leaks. |

## Invariants asserted

- **A1 (harm clamp + render):** pc-edit harm value gets stored,
  `applyCharacterEdits` clamps to HARM_MAX=4, render shows the
  rules-correct "out-of-action" labeling.
- **A2 (stress clamp + render):** parallel of A1 for stress.
- **A3 (advancement cap UX):** at advancements >= 8 the carryover
  card renderer surfaces the cap-reached chip in place of the
  reset button.  Survives save/restore.
- **A4 (bond-draft cap):** packChargen rejects > 3 drafts;
  validator is load-bearing.
- **A5 (focus-grant scale):** 10 foci materialize correctly;
  filterForViewer sees name+domain; persistence scrub strips
  boundFor + notes (D-prep-2-A scrubber).
- **A6 (pc-retire firewall):** persisted event payload has NO
  reason and NO scene for non-coord viewers (B-1 BLOCKER fix).
- **A7 (retired-tile render):** state=`bound-retired` survives
  filterForViewer; player sees inFictionReason + seatMemory.
- **A8 (co-DM yield preserves scene-reveal mask):** scene-reveal
  + scene-reveal-paragraph events survive coordinator-yield;
  half-revealed state restores correctly for a non-coord
  viewer.

## Findings

### FINDING-A (NEW, P3 — engine permits advancements > 8)

**Severity:** P3 (latent; UI safety holds).

**Evidence:** `applyCharacterEdits` (character-edits.ts:124-130)
clamps `harm` + `stress` to their HARM_MAX/STRESS_MAX caps but
treats `advancements` + `marks` as floor-only (`Math.max(0, Math.
floor(value))`).  A pc-edit with `advancements: 9` lands as 9 in
the effective record.

**Why P3:** The render layer is self-protecting.  The session-
open-stage carryover card uses `if (c.advancements >= 8) →
cap-reached chip` (session-open-stage.ts:266-269), so even at
9+ the chip still triggers — the player can't accidentally take
a 9th advancement via the UI button (it disappears).

**Realistic exposure:** none today.  The UI flow (`takeAdvancement`
in quire-app.ts) checks the chip-render gate before emitting the
pc-edit.  A hostile peer (DEC-023 class 3 = out of scope) or a
future AI-write path could push advancements arbitrarily high
without engine clamp.

**Mitigation:** add `clamped = clamp(value, 0, ADVANCEMENT_CAP)`
to the `advancements` branch in character-edits.ts.  Three-line
fix; defensive only.

**Status:** filed; ship-or-defer at M6a-FS-5 cleanup or M7 pass.
Does NOT block playable release.

### FINDING-B (NEW, P1 — pc-retire player save loses retired state)

**Severity:** P1 (class 2 — gameplay continuity AND visible
broken state after restore).

**Evidence:** `core/state.ts:applyPcRetireOrArchiveEvent` (line
2961-2968) requires `p.reason` to be one of four enum values
('died' / 'departed' / 'converted-to-npc' / 'other').  The
player-save firewall (`persistence.ts:RETIRE_DM_ONLY_PAYLOAD_
FIELDS`, B-1 BLOCKER fix) strips `reason` from non-coord-save
projections.  Result: when a player restores their autosave (or
loads via §FS.11 cross-device probe as non-coord), the pc-retire
event is silently dropped, and the retired seat materializes as
`bound-active` — wrong state, wrong render.

The DM-coord save path is unaffected (the DM keeps `reason`).
Live-play sync-response also unaffected (OP-039's
`defaultSyncResponseFilter` strips by KIND not sub-field, so
joining peers get the full pc-retire payload).

**Surfaces:**
1. **Player tab restored from localStorage autosave.** Most
   likely real-world hit: player opens campaign tab next week,
   localStorage replays → retired seat appears active.
2. **Cross-device probe pulls DM save + loads as non-coord.**
   Probe load runs `projectSaveForViewer(doc, viewerIsCoord:
   false)`, applying the same firewall.  Same bug.
3. **Player export → fresh device import.** Same shape.

**Hypothesis (fix paths, pick 1):**
1. **Materializer tolerates missing reason** (PREFERRED).  Treat
   `p.reason === undefined` as a benign signal — the event landed
   from a player projection.  Materialize the seat into
   `bound-retired` with `retireReason` absent.  Render uses
   `inFictionRetireReason` (player-safe), so the result is
   correct visually.  Symmetric with B-1's intent.
2. **Move `reason` out of RETIRE_DM_ONLY_PAYLOAD_FIELDS.**  Would
   leak the enum to player saves — wrong direction.
3. **Synthesize a `pc-retire-presence` companion event** that
   doesn't carry `reason`.  Heavy; new event kind, two
   materializers, classification dance.

**Why P1:** The retired-tile renders WRONG state ('bound-active')
to a player who restores their autosave.  The DM thinks the
player saw "Mei retired" but the player sees "Mei active" with
no recourse.  Functional regression that PLAYERS see; prime-
directive-adjacent (the game state is wrong, players can't
recover without DM intervention).

**Mitigation today:** workflow workaround — the DM can re-emit
pc-retire from their coord projection if they notice.  Live-play
sync rebuilds the seat correctly the moment the player rejoins
the live session.  So the bug fires only when a player loads
their save WITHOUT a live session to sync from.

**Filed:** OP-043 in `open-problems.md`.

### FINDING-C (sanity-confirmed)

harm / stress clamp to their caps on `applyCharacterEdits`
(HARM_MAX=4, STRESS_MAX=4).  Save / restore preserves the
clamped value.  Cross-PC visibility of harm IS intentional
(rules.md:131 — harm is a table-public clock); the firewall
protects DM-only fields like `magicPhase`, `dmNotes`, not
physical stats.

### FINDING-D (sanity-confirmed)

`packChargen` rejects > MAX_BOND_DRAFTS (3) by throwing
`ChargenPackError('malformed')`.  Validator is load-bearing.

### FINDING-E (sanity-confirmed)

10 focus-grants survive save/restore for both DM and player
projections.  Player save strips `boundFor` + `notes` from each
focus payload (FOCUS_DM_ONLY_PAYLOAD_FIELDS).  Restored player
state has 10 foci with name+domain+id preserved and no DM-only
sub-fields.

### FINDING-F (sanity-confirmed)

pc-retire firewall AT THE PAYLOAD LAYER works: player save's
pc-retire event payload has no `reason` and no `scene`.  See
FINDING-B for the materialization gap this creates.

### FINDING-G (sanity-confirmed)

Co-DM yield with half-revealed scene-reveal-paragraph events:
save → restore preserves both the scene reveal AND the 2 of 4
paragraph blocks marked.  Both DM and player projections.  No
new finding.

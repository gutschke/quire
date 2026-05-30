# Open Problems

Bugs found but not yet fixed; questions awaiting human judgment. Each entry:
severity, evidence, hypothesis, owner, status.

Newest at top. When fixed, link to the commit and move to a separate
"resolved" section at the bottom.

## OP-045 — Chargen rename gap: applyCharacterEdits has no handler for name/pronouns/backstory [RESOLVED 2026-05-30 run #14] [R4: class 2 UX-gap, P1]

**STATUS:** RESOLVED in run #14.  `applyCharacterEdits` now
has `name` / `pronouns` / `backstory` branches matching
`pc-create` caps (80 / 40 / 8000); `dm-pc-detail` mounts a
post-ratify "Identity" disclosure row (DM-side) with Edit
buttons per field; quire-app threads `onRenamePc` and the
effective-character `identity` block.  Regression tests
flipped from LOCKED-BROKEN to FIXED in
`persistence.chargen-roundtrip.test.ts` (9 new assertions).
Engine: ~30 LOC.  UI: ~120 LOC.  See
`src/character-edits.ts` + `src/ui/regions/dm-pc-detail.ts`
+ `src/quire-app.ts:renderDmPcDetail`.

**Severity:** P1 for the playtest experience.  Not a firewall
issue; not a data-loss issue; but a **player can't change their
PC's name after the DM ratifies** with the events the engine
currently supports.

**Evidence (run #13, WS-C chargen polish round-trip pass):**
- `pc-create` (state.ts:2531) is first-write-wins: re-emitting
  with the same `pcId` no-ops.  So a "rename via re-emit"
  silently fails.
- `pc-edit` payloads land in `state.pcEdits[pcId]` via
  `applyPcEditEvent` (state.ts:2160).
- `effectiveCharacter` merges via `applyCharacterEdits`
  (character-edits.ts:103).
- `applyCharacterEdits` has handlers for: stats.*, harm,
  stress, advancements, marks, knowsTheyCanCast, magicPhase,
  moneyBand, tax.*, threadDebt.*, alignmentDrift.*,
  markBullets.*, dmNotes, and a few others — but **NO
  handlers for `name`, `pronouns`, or `backstory`**.

The result: a player wants to change "Theodore" to "Theo"
post-acceptance.  The DM authors `pc-edit` field=name
value='Theo'.  The event lands in `state.pcEdits[pcId]`.
`effectiveCharacter` runs `applyCharacterEdits` over it.  The
name branch is missing.  The PC still renders as "Theodore."

**Locked test coverage:** three LOCKED-BROKEN assertions in
`src/persistence.chargen-roundtrip.test.ts` PIN the broken
state so a future fix surfaces as test updates, not a silent
flip.

**Hypothesis (fix paths):**
1. **Add handlers to `applyCharacterEdits`** (recommended):
   add `name` / `pronouns` / `backstory` branches with size
   caps matching `pc-create`'s constraints
   (`PC_CREATE_MAX_NAME`, `PC_CREATE_MAX_PRONOUNS`,
   `PC_CREATE_MAX_BACKSTORY`).  Plus: ensure the
   filterForViewer projection preserves the edit (it should —
   `pcEdits` is player-visible state already).  Small diff
   (~30 LOC) + 3-6 test updates.
2. **New event kind `pc-rename`** — heavier; would let us
   audit rename specifically, but `pc-edit` is the established
   surface for character mutation.
3. **Drop first-write-wins on pc-create** — wrong direction;
   re-emission semantics are useful elsewhere.

**Path 1 is the natural fix.**  Same shape as the other
character edits.

**Real-world impact (playtest hit):**
- A player who picks an awkward name in chargen and wants to
  change it post-ratify has no working surface.
- The DM cannot rename a PC the player asked them to rename.
- Mid-chargen rename in the chargen UI is fine (no `pc-create`
  has fired yet).

**Owner:** playtest-readiness program lead.
**Status:** OPEN.  Filed P1.  Schedule for run #14 alongside
the TTRPG/UX consultant's chargen findings.

**Cross-cuts:**
- The TTRPG/UX consultant brief (queued run #13) explicitly
  asks Q2 about surgical edits for name/pronouns/backstory.
- The visual-design consultant's surfaces will see the
  rename UI; defer their feedback until the fix lands.

---

## R4 re-triage block (2026-05-29 under DEC-023 threat framing)

Per DEC-023, three classes drive severity:

1. **Internet randos / external attackers** — zero-attack-surface goal. P0/P1 by default.
2. **Accidental disclosure between trusted teammates** — keep defending. Firewall-class.
3. **Malicious co-players** — out of scope. Closed-no-fix unless incidentally helps 1 or 2.

Re-classifications recorded inline below (each affected OP carries
an [R4: <class>, <verdict>] tag). Summary:

- **STAYS P0/P1 (class 1):** OP-017g (canonical client_id integrity),
  OP-017 (callback page CSP + golden-diff), OP-018 (client_id
  incident response), OP-019 (Worker fallback decision), OP-021
  (state nonce intent binding), OP-020 (two-tab OAuth race),
  OP-016 (CORS probe), OP-030 (OAuth error PII).
- **STAYS P1 (class 2):** OP-017b (UX matrix; mid-session OAuth errors
  with players watching), OP-027 (player-content consent ceremony),
  OP-026 (M5 cross-tab leak), OP-022 (mid-session 401 detection),
  OP-023 (account-switch silent rebinding), OP-024 (APP + WebAuthn
  popup), OP-005 (strip-on-restore destructive warning).
- **STAYS P2 (class 1+2 mixed, doc/limit):** OP-017e (account-loss
  durability — addressed by DEC-016/M6c reorder), OP-017f (cleartext
  disclosure on Drive — doc), OP-031 (drive.appdata verified
  citation — doc), OP-028 (peerId cross-campaign re-identifier —
  doc), OP-029 (forensic recovery story — doc), OP-014 (microcopy),
  OP-015 (popup-blocker), OP-025 (save-format determinism doc).
- **DOWNGRADED (class 3, malicious co-DM/co-player):**
  - **OP-017h (retry-backoff for rate-limit DoS by hostile co-DM):**
    Was P2 framed against malicious co-DM. The realistic class 2
    risk ("DM accidentally backup-loop wedges Drive quota") is
    handled by simpler "max 3 retries then surface error." Hostile
    co-DM is class 3 = out of scope. **DOWNGRADED to P3.** The
    simpler error-cap is enough.
  - **OP-011 (multi-DM concurrent push conflict UX):** STAYS but
    rationale changes — accidental concurrent push between trusted
    co-DMs is class 2 (in scope per "accidentally disrupt"); the
    hostile-co-DM angle drops. Pull-rebase-push automation stays
    at current P3 priority — accidental concurrent push is a small
    window in real DM workflows.
- **NEW under R4 framing:**
  - **OP-032 (NEW):** Honest microcopy for the M6b passphrase
    floor — surface that the encryption defends against a casual
    snooper, not a determined attacker. Class 1 (internet randos
    with local access) requires this honesty. Per DEC-021.

---

## OP-044 — Engine permits `advancements` value above ADVANCEMENT_CAP (8) [mock-campaign-06 finding] [R4: class 3 / class 2 latent, P3] [RESOLVED 2026-05-30 run #12]

**Resolution (run #12):** `applyCharacterEdits` now clamps
`advancements` to `[0, ADVANCEMENT_CAP]` and `marks` to `[0, 5]`
(rules.md:157,166).  Defense-in-depth alongside the existing UI
render gate (`>= 8` chip).  New `MARKS_MAX = 5` constant exported
from `character-edits.ts`.  2 new unit tests + mock-campaign-06
FINDING-A test updated to expect the clamped behavior.

**Status:** RESOLVED.



**Severity:** P3 (latent; render gate self-protects).
**Evidence:** Mock campaign 06 (run #11 — game-mechanic edges)
FINDING-A.  `applyCharacterEdits` clamps `harm` + `stress` to
their HARM_MAX / STRESS_MAX caps but treats `advancements` +
`marks` as floor-only (`Math.max(0, Math.floor(value))`).  A
pc-edit with `advancements: 9` lands as 9 in the effective
record.
**Why P3:** The render layer is self-protecting — the session-
open-stage carryover card uses `if (c.advancements >= 8) →
cap-reached chip` (session-open-stage.ts:266-269), so even at
9+ the chip still triggers and the "Advancement taken" button
disappears.  No realistic UI path emits an over-cap pc-edit
today.  Future AI-write paths or a hostile peer (class 3 =
out of scope) could push the value arbitrarily.
**Hypothesis:** Add `clamped = clamp(value, 0, ADVANCEMENT_CAP)`
to the `advancements` branch in `character-edits.ts`.  Mirror
for `marks` (cap at 5 per rules.md:149 advancement-mark count).
Three-line fix; defensive only.
**Owner:** save/restore program lead.
**Status:** OPEN.  P3 polish, M6a-FS-5 cleanup or M7.  Does NOT
block playable release.

---

## OP-043 — pc-retire player-save round-trip fails to materialize retired seat [mock-campaign-06 finding] [R4: class 2 gameplay-continuity, P1] [RESOLVED 2026-05-30 run #12]

**Resolution (run #12):** `applyPcRetireOrArchiveEvent` now
tolerates `p.reason === undefined` (firewall-stripped).  When
the player-save firewall scrubs `reason` + `scene` from a
non-coord projection, the materializer still flips the seat to
`bound-retired` (or `bound-archived`) with `retireReason` +
`retiredScene` unset.  Render uses `inFictionRetireReason`
(player-safe), so the result is visually correct.  Same
SSOT-correct shape as `scrubMapBlobIfUnrevealed` (keep the
event, drop the sub-field, materializer is tolerant).

2 new regression tests in `state.test.ts` cover both
`pc-retire` + `pc-archive` paths.  Mock-campaign-06 FINDING-B
test updated to expect the fixed behavior; sim-06 now asserts
the retired seat materializes on player-save round-trip.

**Pattern check** (the "walk PER_KIND_SCRUBBERS × materializers"
investigation per run #12 mandate): all other entries in
`PER_KIND_SCRUBBERS` strip OPTIONAL fields whose materializers
validate only when present.  `pc-retire` / `pc-archive` were
unique in requiring `reason` to be a non-undefined enum value.
**No sibling bugs found.**  Survey:
  - `pc-edit`: drops the event entirely when `field` is DM-only
    → no materialize attempt.  Wrapper-level `causedByResponseId`
    strip is benign (materializer ignores).
  - `map-blob-add` / `map-blob-move`: strips `blob.label`.
    Materializer is a no-op stub today (M3a/M6 future).
  - `focus-grant`: strips `focus.boundFor` + `focus.notes`.
    Materializer only requires `focus.name`; both stripped
    fields are validated-when-present.
  - `pc-retire` / `pc-archive`: strips `reason` + `scene`.
    **THIS WAS THE BUG.**  Now fixed.
  - `bond-ratify`: strips `dmNotes`.  Materializer validates
    when present; absent is fine.
  - `pc-create`: strips all DM-only character fields (magicPhase,
    knowsTheyCanCast, tax, threadDebt, accidentalGrants,
    alignmentDrift, dmNotes) + `causedByResponseId`.
    Materializer requires only the mandatory chargen fields
    (pcId, name, pronouns, tags, stats, skills, backstory) +
    validates DM-only fields when present.

**Status:** RESOLVED.



**Severity:** P1 (class 2 — visible-broken-state gameplay
continuity, NOT a firewall leak).
This is the SAME shape as OP-040: the firewall correctly strips
DM-only sub-fields from a player save, but the materializer is
strict about the field's presence and silently drops the event.
The retired-tile renders WRONG state (`bound-active`) to the
player after restore — a visible regression from what the player
saw at the table.
**Evidence:** Mock campaign 06 (run #11) FINDING-B.
`core/state.ts:applyPcRetireOrArchiveEvent` (lines 2961-2968)
requires `p.reason` to be one of four enum values.  The
player-save firewall (`persistence.ts:RETIRE_DM_ONLY_PAYLOAD_FIELDS`,
the B-1 BLOCKER fix) strips `reason` from non-coord projections.
Result: when a player restores their autosave OR loads a save
via `projectSaveForViewer(doc, viewerIsCoord:false)`, the
pc-retire event materializer rejects, leaving the seat as
`bound-active`.

**Surfaces (in likelihood-of-real-hit order):**
1. **Player tab restored from localStorage autosave.** Most
   likely real-world hit: a player closes their tab during/after
   a session where someone retired; opens later; their
   localStorage autosave projects through `loadFromString` with
   `viewerIsCoord = false`; pc-retire is dropped; the retired PC
   appears as still active in the player's view.
2. **Cross-device probe load as non-coord (§FS.11).**  If a
   guest joining a session uses the probe (rare; the probe is a
   DM affordance today), the same bug fires.
3. **Player export → fresh device import.**  Same shape.

**Live-play path is UNAFFECTED:**
- DM-coord save → DM-load: full save, `reason` preserved, works.
- Live sync-response: `defaultSyncResponseFilter` strips by KIND
  not sub-field per OP-039 fix; pc-retire payload survives intact
  for joining peers.  A player reconnecting to a live session
  rebuilds the retired seat correctly.

**Hypothesis (fix paths, in priority order):**
1. **Materializer tolerates missing `reason`** (PREFERRED).
   Treat `p.reason === undefined` as a benign signal — the event
   landed from a player projection.  Materialize the seat into
   `bound-retired` with `retireReason` absent.  Render uses
   `inFictionRetireReason` (player-safe), so the result is
   visually correct.  Same shape as the B-1 BLOCKER design intent:
   strip DM-only sub-fields without breaking seat state.  Tight
   diff at `applyPcRetireOrArchiveEvent`.
2. **Move `reason` out of `RETIRE_DM_ONLY_PAYLOAD_FIELDS`** —
   wrong direction; leaks the enum to player saves.  Rejected.
3. **Synthesize `pc-retire-presence` companion event** that
   omits `reason` — heavy; new event kind, two materializers,
   classification dance.  Avoid.

**Path 1 is the natural fix.**  Same fix shape that
`scrubMapBlobIfUnrevealed` uses (keep the event, drop the
sub-field, materializer is tolerant).  Engine accepting partial
payloads from the firewall is the SSOT-correct design.

**Release-blocker call:** Does NOT block playable release per
`playable-release-plan.md` definition (DM happy path is the
defined release bar; players are secondary save/restore users
because they reconnect via live WebRTC sync).  BUT: this is the
first P1 mock-campaign finding, and the player-side hit is
real-world (a tab restored from localStorage with a retired seat
WILL show the wrong state).  Stack-ranked as the FIRST item to
ship in M6a-FS-5 (run #12 cleanup) before the playable release
push.

**Owner:** save/restore program lead.
**Status:** OPEN.  Filed P1.  M6a-FS-5 priority.

---

## OP-042 — Consent dialog can interleave with concurrent host actions during active play [mock-campaign-05 finding] [R4: class 2 UX-surprise, P2]

**Severity:** P2 (class 2 — UX surprise, not corruption).
**Evidence:** Mock campaign 05 (run #10 — cloud push during active
play) FINDING-F.  When the M6a-FS consent dialog is open mid-
session, share-envelope events from peers continue to flow into the
DM's session.  This is INTENDED (the dialog shouldn't pause play).
However, today's host event handlers do NOT gate any of:
  - `handleBackupsPullRequest` (resume-prompt / cross-device probe load).
  - `handleBackupsPushRequest` (manual push via the card).
  - `crossDeviceProbeLoad`.
on dialog open state.  A DM who opens the consent dialog AND then
clicks the resume-prompt's "Load" can have both progress concurrently
— the consent ack would land at the same time as the load fires
events.
**Hypothesis:** Today's UI requires the DM to physically click both
the dialog and the resume button — a deliberate dual-click is the
trigger.  A real DM under flow won't do this.  But a future
auto-opening dialog (e.g. a backups-card timer triggers consent on
session-close) would interleave more easily and a load click during
the auto-open could surprise.
**Mitigation:** Defer.  Document in `ux-strategy.md §A12-row-N` as
"dialog open suppresses other modal interactions" — and add a
single dialog-open gate to the relevant host handlers when the
auto-open path lands.
**Owner:** save/restore program lead.
**Status:** OPEN.  Filed P2 — does NOT block playable release
(today's interleave requires deliberate dual-intent).

---

## OP-041 — First-push silently overwrites orphan save in connected folder [mock-campaign-05 finding] [R4: class 2 data-loss, P2] [RESOLVED 2026-05-30 run #12]

**Resolution (run #12):** `pushCampaignToFolder` now refuses
with `'first-push-orphan'` when the connected folder contains
a NON-EMPTY save file we never observed.  Added
`overwriteOrphan?: boolean` option so the host can proceed
after a DM acknowledgment.  0-byte placeholder files (left by
a previous failed `createWritable()`) are NOT treated as
orphans — they're our own residue and we proceed normally.
The `<backups-card>` `pushErrorMessage` got a new branch:
"This folder already has a save from another device.  Pull
first to see it, or disconnect and reconnect to a fresh
folder."

2 new unit tests in `fs-api-cloud-push.test.ts` cover the
refusal + the overwrite path.  Sim-05 offline-recovery test
continues to pass (the 0-byte exception preserves the retry
path).

**Status:** RESOLVED.



**Severity:** P2 (class 2 — accidental data loss to a trusted
party — the prior author of the orphan).
**Evidence:** Mock campaign 05 (run #10 — cloud push during active
play) FINDING-E.  `fs-api-cloud-push.ts pushCampaignToFolder` does
read-before-write conflict detection via:
```
if (currentLastModified > record.lastObservedModifiedMs) → conflict
```
On a FRESH connect, `record.lastObservedModifiedMs === null`, so
the conflict check short-circuits.  A folder that already contains
a `<slug>.quire-save.json` (orphaned from a prior browser profile,
a teammate's accidental push, a manual restore from an export,
etc.) is silently overwritten on the DM's first push.
**Why P2:** A DM connecting a fresh device to a folder with an
existing save EXPECTS Quire to either read it first or warn.
Today, the §FS.11 cross-device probe (shipped this run) DOES read
the folder on landing — so in the §A11 happy path the DM sees
the existing file and chooses [Load it] or [Start fresh].  When
they choose [Start fresh], the intentional-overwrite semantic
holds.  BUT: if the probe doesn't fire (e.g. the DM connects the
folder AFTER landing, via the operational view's Connect chip),
the first push overwrites without warning.
**Hypothesis:** Tighten `pushCampaignToFolder` to:
  - When `record.lastObservedModifiedMs === null` AND
    `getFileHandle(create:false)` returns a non-null file,
    surface a NEW `reason: 'first-push-orphan'` so the UI can
    prompt: "A different device already saved here.  Overwrite?".
  - When the DM confirms, set the baseline AND push.
  - When the DM cancels, leave the file alone + offer Pull.
**Recovery today:** Google Drive Desktop / Dropbox both have
version history; the orphan is recoverable out-of-band.  The
cross-device probe (§FS.11 shipped this run) closes the typical
path.
**Owner:** save/restore program lead.
**Status:** OPEN.  Filed P2 — does NOT block playable release.
The probe + sync-client version history together close the
realistic data-loss window.  Schedule for M6a-FS-4 (run #11) or
M6a-FS-5 (run #12) as a pre-release polish.

---

## OP-040 — pc-mark-realization survives the OP-039 sync-response strip; player joining mid-tax sees no cast capability [mock-campaign-02 finding] [R4: class 2 gameplay-continuity, P2]

**Severity:** P2 (class 2 — gameplay continuity, NOT a firewall leak).
This is the OPPOSITE shape from the leak class — a player who SHOULD
see their own player-visible state (knowsTheyCanCast + tax.active
overlay on their own PC) doesn't get it because the underlying event
is classified DM-only and stripped by the OP-039 firewall during
sync-response catch-up.
**Evidence:** Mock campaign 02 (run #9 — magic discovery arc through
save/restore) surfaced this.  `pc-mark-realization` is in
`PLAYER_SCOPE_STRIP_KINDS` (rationale: the existence of "DM marked
Mei realized at time T" is DM-private bookkeeping per Wave D-prep-2
review).  OP-039's filter drops the event from sync-response.  In a
LIVE play scenario, this is fine — `share` envelope delivers the
event to all peers, including the PC owner; filterForViewer at
render keeps `knowsTheyCanCast` + `tax.active` for the owner.  In a
SAVE/RESTORE-then-rejoin scenario where the player JOINS AFTER the
realization was already authored, sync-response is the only catch-up
channel, and the filter drops pc-mark-realization → materializer
never fires → pcEdits[mei] is empty → filterForViewer projects
nothing → player's sheet shows no cast capability.
**Hypothesis (fix paths, deferred):**
  1. **Reclassify pc-mark-realization OUT of PLAYER_SCOPE_STRIP_KINDS**
     — let the event flow through; rely on filterForViewer's
     per-viewer projection to hide it from non-owner players (the
     same model pc-edit uses).  Risk: event-existence-vs-effect
     classification rule needs a explicit review.
  2. **DM workflow:** surface a "re-mark realization for late-
     joiner" affordance in the DM operational view when a peer
     joins fresh post-realization.  Idempotent on the visible
     state.
  3. **Per-PC "snapshot" event** that the joining peer applies
     to fast-forward their own player-visible state.  Heavier.
**Mitigation in production:** the broken case is narrow — the
realization is normally a moment players WITNESS at the table.
A player who was online for the realization → her in-memory state
has it → her session-end state hands off correctly across cookie
+ recently-played + DM-coord-save chain.  The pure "join fresh
mid-tax" workflow is rare and recoverable (DM re-marks).
**Owner:** save/restore lead → escalate to engine architect for
classification decision.
**Status:** OPEN.  Filed P2 — does NOT block playable release
(workflow workaround exists).  Architectural review may pick path 1
during M7+ if the workaround proves friction-y.

---

## OP-039 — `sync-request → sync-response` carries DM-only events unfiltered [mock-campaign-01 finding] [R4: class 2, P2] [RESOLVED 2026-05-29 run #9]

**Resolution (run #9):** `defaultSyncResponseFilter` shipped in
`src/persistence.ts` — drops `PLAYER_SCOPE_STRIP_KINDS` events but
deliberately does NOT run per-field scrubbers (the joining peer's
filterForViewer + serializeSessionForViewer have viewer context the
gossip seam lacks).  Wired into `Peer` via new
`syncResponseFilter` option (separate from `rebroadcastFilter` so
the two surfaces can evolve independently).  Session-controller
passes the default; `IDENTITY_SYNC_RESPONSE_FILTER` is the default
for bare-Peer tests.  Three regression tests in
`persistence.restore-firewall-fuzz.test.ts` cover:
  1. Peer holding scratch-note drops it on sync-response.
  2. Exhaustive: every PLAYER_SCOPE_STRIP_KINDS event dropped.
  3. Identity behavior preserved when no DM-only events present.

OP-040 (above) was surfaced as a load-bearing side-effect of the
fix and tracked separately.

**Status:** RESOLVED.



**Severity:** P2 (class 2 — accidental disclosure between trusted
peers).  Not a play-time leak (filterForViewer hides DM events at
render time AND serializeSessionForViewer strips them from the
player's autosave), but it is a sister to NEW-ADV-2 — the same
firewall class that DEC-010 closed for `applyEvent → forwardShareToOthers`
is NOT closed for the `sync-request → sync-response` path.
**Evidence:** Mock campaign 01 (run #8 — flagship cross-session
cloud loop) initially asserted "after restore + a new player joins,
the player's RAW event log does NOT contain `scratch-note`."  It
failed.  Tracing: `Peer.handleMessage` `sync-request` case calls
`this.log.since(payload.clock)` and ships the full list of events
to the requester via a direct `transport.send(from, {kind:
'sync-response', events})` (`src/core/peer.ts:330-338`).  No
`rebroadcastFilter` is applied — only the `forwardShareToOthers`
helper carries the filter.  A fresh player who joins a session
where the DM has already done `append('scratch-note', …)` receives
the scratch-note events into their event log via sync-response.
**Render-layer mitigation (already in place):** `filterForViewer`
zeros out `scratchNotes`, `pinnedNpcs`, etc. for non-coord viewers
— so the rendered UI is clean.  `serializeSessionForViewer`
(autosave / manual save) also strips DM-only events — so the
player's autosave is clean.
**Hypothesis:** The firewall hole is the player's raw event log
on a peer that joined an active session.  In practice this is
visible only to a developer-tools inspection of the running tab
or a future feature that exposes the raw log.  Tolerated under the
existing threat model (DEC-023 class 2 — civilized peers).  Fix
would be to wrap the `sync-response` build with
`this.rebroadcastFilter` on the responding side OR teach the
`sync-request` handler to do `log.since(...).map(filter)`
before responding.  Either fix is small but firewall-adjacent —
covered by the same SSOT (PLAYER_SCOPE_STRIP_KINDS).
**Owner:** save/restore program lead.
**Status:** OPEN.  Filed as P2 — does NOT block playable
release per `playable-release-plan.md` (the render firewall + the
save firewall both hold; the hole is the raw log in tab memory).
The fix is a one-line wrap in the `sync-request` handler.
Schedule for M6a-FS-2 (next run) alongside the session-digest
chip work — same surface; same review attention.

---

## OP-038 — M6a-FS host integration: wire `<backups-card>` into the DM operational view [run #7 follow-up] [RESOLVED 2026-05-29 run #8 — option (b) shipped per DEC-029]

**Severity:** P1 for shipping M6a-FS end-to-end.
**Evidence:** Run #7 shipped the engine layer (`fs-api-*.ts`) +
the `<backups-card>` Lit region.  The card is self-contained
with a narrow props surface (cloudPush, campaignId,
renderForDm, requestConsent) but is NOT yet embedded in
`quire-app.ts`.  Without the embed it has no path to render in
production.
**Hypothesis:** The DM-only operational view spec'd in
`ux-strategy.md §A10 placement B` doesn't exist as a discrete
render path in `quire-app.ts` yet — the section's "always-
rendered when the surface is open" assumes a surface that is
itself pending.  Two options for the embed:
  (a) Add a new DM-only "Backups" section to the existing
      campaign render path (renderCampaign / renderEpisode)
      guarded on isCoordinator().  Cheapest path; ships
      M6a-FS user-visible without inventing the operational
      view.
  (b) Stand up the operational view as a discrete surface (its
      own hotkey, its own render branch), then embed
      `<backups-card>` inside it.  Aligns with the longer-
      term `ux-strategy.md` arch but is a bigger lift.
**Owner:** save/restore program lead, next run.
**Status:** OPEN.  Recommended scope for run #8: pick (a) for
M6a-FS ship-readiness; (b) is its own milestone.

## OP-037 — M6a-FS session-digest chip surface [run #7 follow-up] [RESOLVED 2026-05-29 run #9]

**Resolution (run #9):** Shipped the session-digest backup chip
per `ux-strategy.md §A10-A`.  Implementation:
- `<session-digest>` gains a `showBackupChip` property (defaults
  false for safety on existing tests).  When true AND viewer is
  DM AND no draft is in flight AND no generation in progress,
  appends a "Back up tonight's session?" chip with an "Open
  backups…" button.
- Click dispatches `session-digest-open-operational-view`
  (bubbles + composed).  Host listens, sets `appMode =
  'dm-operational'`.
- Defense-in-depth: player viewer (no onGenerate/onSave) never
  sees the chip; host-controlled flag suppresses it for
  non-Chromium browsers via `isBackupChipAvailable()` →
  `getAvailabilityVerdict().available`.
- Chip is suppressed during mid-edit (don't yank the DM out).

5 new unit tests in `src/ui/regions/session-digest.test.ts`
cover: player viewer (no chip), host opt-out, chip render,
chip click → event bubble, chip suppression mid-draft.

**Status:** RESOLVED.

**Severity:** P2.
**Evidence:** `ux-strategy.md §A10 placement A` specs the
session-digest chip as the PRIMARY just-in-time surface for
backup discovery.  Run #7 shipped the discovery (placement B)
surface only.
**Hypothesis:** The session-digest UI already exists
(`src/ui/regions/session-digest.ts`); adding the backup chip
is a localized edit + a host wiring.  Deferred to run #8
alongside OP-038 because both share the host-integration
work.
**Owner:** save/restore program lead, next run.

## OP-036 — M6a-FS push event handler in host [run #7 follow-up] [RESOLVED 2026-05-29 run #8 — `handleBackupsPushRequest` + `handleBackupsPullRequest` shipped in `quire-app.ts`]

**Severity:** P1 for shipping M6a-FS end-to-end.
**Evidence:** `<backups-card>` dispatches `backups-push-request`
when the DM clicks "Push now."  The host must listen, build a
fresh save document via `serializeSession` / `stringifySave`
(the canonical save path), call
`fsApiCloudPush.pushCampaignToFolder({campaignId, body})`, and
hand the result back to the card via `applyPushResult`.  The
card's tests cover the event dispatch + the apply-result chip
rendering; the host-side wiring is the missing piece.
**Hypothesis:** Same host-integration work as OP-038; ships
together.
**Owner:** save/restore program lead, next run.
**Status:** OPEN.

## OP-035 — M6c-A publish-side roster scrub [R4: class 2 UI, P2]

**Severity:** P2 (cosmetic).
**Evidence:** `github-publish-fork-analysis.md` Q3. Original DM's
`peer-join` / `peer-leave` events persist into the materialized
state of a forked campaign — the forking DM's roster shows the
original DM as "in the roster." Cosmetic; no security impact
under DEC-023 (class 2 at worst).
**Hypothesis:** The M6c-A `publishSeedFromSession()` helper drops
`peer-join` / `peer-leave` events from the original peers ahead
of writing the published save. Alternative: keep them and add a
UI tag ("historical participant, not at this table").
**Owner:** save-restore lead — small publish-side helper.
**Status:** open. Non-blocking for M6c-A; nice-to-have at ship.

---

## OP-034 — M6c-A publish-time event-range truncation UX [R4: class 2, P2]

**Severity:** P2 (UX).
**Evidence:** `github-publish-fork-analysis.md` Q2. The
publish-time UX needs a "pick a seed point" affordance that
respects per-author causal boundaries. Truncating at an arbitrary
event index can leave a causal gap (the loaded log applies fine
but materialized state is missing whatever the omitted event
would have set).
**Hypothesis:** Publish UX presents episode boundaries (or the
last `scene-reveal` event per author) as save-point candidates.
DM picks one; the helper truncates to the chosen boundary,
respecting per-author monotonicity.
**Owner:** save-restore lead + TTRPG-UX for the "save point"
labeling.
**Status:** open. Non-blocking — can ship M6c-A with
"publish-whole-log-only" first and add truncation in v1.1.

---

## OP-033 — M6c-A publish-side scrub helper + consent ceremony [R4: class 1, P1]

**Severity:** P1 (BLOCKS M6c-A ship).
**Evidence:** `github-publish-fork-analysis.md` Q4. The publish
seed goes to a PUBLIC GitHub repo. A careless implementation that
uses the full DM-coord save as the seed would put DM scratch-
notes, AI prompts, NPC pins, etc. on a world-readable repo —
internet-rando-readable forever. This is DEC-023 class 1
(internet randos) since "anyone on GitHub" includes randos.
**Hypothesis:**
  1. **Helper:** `publishSeedFromSession()` in `persistence.ts`
     that calls `serializeSessionForViewer` with the non-coord
     projection (player-scope strip via existing
     `PLAYER_SCOPE_STRIP_KINDS` + `PER_KIND_SCRUBBERS`). NO new
     firewall list — the existing SSOT IS the publish-side
     firewall.
  2. **Consent ceremony:** First-publish DM-only acknowledgment
     dialog (sibling to DEC-011 / DEC-020): "Publishing this
     seed makes the table's player-visible content (chat,
     scenes, character drafts the players have submitted) PUBLIC
     on GitHub. DM-only material (your scratch notes, AI
     prompts, NPC pins) is stripped before upload. [Acknowledge]"
  3. **Regression test:** Sentinel-fuzz that plants DM-only
     markers in every DM-only kind + sub-field, asserts no
     sentinel survives the publish projection. Reuses the
     existing `persistence.restore-firewall-fuzz.test.ts`
     pattern.
**Owner:** save-restore lead.
**Status:** open. BLOCKS M6c-A ship. Composes naturally with
the existing firewall SSOT — small surface, large
correctness payoff.

---

## OP-032 — M6b passphrase honest-microcopy surface [R4: class 1, P1]

**Severity:** P1 for M6b (NOT blocking M6a).
**Evidence:** DEC-021 + DEC-023. The M6b passphrase-encrypted
refresh_token defends against a casual snooper with local
access; not a determined attacker. The user must understand
this at passphrase-entry time — otherwise they'll trust the
encryption more than it deserves, and a determined attacker
(class 1 with local hard-drive access) succeeds against an
over-confident user.
**Hypothesis:** Locked microcopy spec (final string deferred
to M8): "This passphrase delays a casual snooper, not a
determined attacker. Quire encrypts your Google login on this
device; anyone with both your laptop and your passphrase can
read it." Plus a passphrase-floor validator (≥12 chars).
**Owner:** save-restore lead + TTRPG-craft for the final
string at M8.
**Status:** open. Land with M6b code.

---

## OP-031 — `drive.appdata` revocation / content-scan semantics need verified citation [R4: class 2, P2]

**Severity:** P2 (doc-only).
**Evidence:** NEW-PRV-9 (privacy consultant 2026-05-29).
The draft claims `drive.appdata` files are deleted on grant
revocation and not scanned by Google's content-safety pipeline;
the consultant flagged both as unverified. Google's actual
behavior is "orphaned but not deleted" on revoke, and TOS
reserves the right to scan all Drive content.
**Hypothesis:** Verify against Google's current docs; cite URL +
retrieval date in `auth-strategy.md`. If confirmed: add DM-only
docs entry ("Disconnect → Erase before revoking"; "Drive may
scan campaign content; consider GitHub for dark fiction").
**Owner:** save-restore lead — doc-only fix.
**Status:** open. Doc work; not ship-blocking.

---

## OP-030 — OAuth error logging may leak email PII [R4: class 1, P1] [RESOLVED 2026-05-29 run #5 by way of run #4 callback ship]

**Resolution (re-verified run #5):** The OAuth callback page
(`public/auth/google/callback.js`, shipped run #4 `a78d109`)
parses `error_description` from the Google redirect but
DELIBERATELY does NOT forward it via `postMessage` — only the
`error` enum is forwarded.  Google's token-endpoint error
response itself is fetched directly by the opener; the opener
code path is the next surface and is on the M6a-code TODO list
(it will use a `redactOAuthError` helper before any logging).
This run's gate ships the callback-side strip; the
opener-side strip lands with M6a code.

Per-line evidence in `callback.js:73-77` (the variable is
parsed for completeness but the comment block explicitly notes
"NOT the description, which can carry email PII — OP-030").

Golden-diff hash covers the callback page so this defense
cannot be silently regressed.  Re-verify: a future PR that
adds `errorDescription` to the postMessage payload necessarily
changes the file hash + must be called out explicitly in PR
description.

**Status (callback-side):** RESOLVED.
**Follow-up (opener-side):** lands with M6a code — the
`redactOAuthError(err)` helper + regression fuzz are still
spec'd; track under the M6a OAuth code TODO, not as a separate
ship gate.

**Severity:** P2 (defense-in-depth).
**Evidence:** NEW-PRV-8 (privacy consultant 2026-05-29).
Google's token endpoint errors can include the user's email in
the JSON body. A well-meaning `console.error(err)` becomes a
permanent landmine for any future extension/devtools observer.
**Hypothesis:** Build a `redactOAuthError(err)` helper that
strips known PII fields (email, sub, name, picture) before
logging. Add a regression fuzz that feeds error-shaped payloads
through the logger and asserts no email-shaped string survives.
**Owner:** save-restore lead (engineering).
**Status:** open. Land before any OAuth-error code path ships.

---

## OP-029 — Forensic recovery story when DM reports a leak [R4: class 2, P2 doc]

**Severity:** P2 (documented limitation).
**Evidence:** NEW-PRV-7 (privacy consultant 2026-05-29).
Quire stores no server-side logs; a DM who reports "my saves
leaked" has no Quire-side history to reconstruct from. Consistent
with the no-server architecture but needs to be NAMED so the DM
isn't surprised mid-incident.
**Hypothesis:** Add to user-facing privacy doc; add a deep-link
in the DM-only operational view to
`myaccount.google.com/security` for one-click revoke. NOT
adding server-side telemetry (would be a worse privacy trade).
**Owner:** UX (in-fiction copy of the revoke-help affordance).
**Status:** open. Doc-only; no ship gate.

---

## OP-028 — `peerId` is a stable cross-campaign re-identifier in saved logs [R4: class 2, P2 doc]

**Severity:** P2 (documented limitation; pseudonymity).
**Evidence:** NEW-PRV-5 (privacy consultant 2026-05-29).
The same DM saving two different campaigns embeds the same
`peerId` in every save event. Anyone with read access to both
saves can link the two campaigns to the same author. Standard
CRDT-with-stable-peer-id assumption but invisible to the DM.
**Hypothesis:** Document the linkage explicitly in the token
threat-model table. Surface in DM-only operational view ("Your
participant ID for this campaign: 7f2a... [Rotate peerId]").
Rotation breaks LWW determinism with old events; guard rail
limits the action to "creating a new campaign."
**Owner:** Engineering (rotation primitive design); save-restore
lead (doc).
**Status:** open. Doc-first; rotation primitive is a follow-up.

---

## OP-027 — DM-uploads-players'-content has no consent ceremony [ACCEPT for M6a] [R4: class 2, P1 — confirmed by DEC-020] [RESOLVED-LOGIC 2026-05-29 run #5]

**Resolution (logic layer, run #5):** Consent ledger module
`src/auth/cloud-push-consent.ts` ships with:
- `hasAcknowledged(storage, campaignId, destination)` —
  fail-closed lookup (re-prompts on missing / corrupt / version
  mismatch / campaignId-or-destination mismatch in the record).
- `recordAcknowledgment(storage, campaignId, destination, now)`
  — idempotent write.
- `withdrawAcknowledgment(storage, campaignId, destination)`
  — hooks into the OP-029 "Disconnect → Erase" affordance.
- `ConsentDestination` union — `google-drive-appdata`,
  `google-drive-file`, `github-private`, `github-public`. Each
  destination is a separate custody transfer, gets its own
  acknowledgment (per DEC-020).
- `browserLocalStorageConsentStorage()` for production +
  `inMemoryConsentStorage()` for tests.
- `DEFAULT_CONSENT_COPY` — engineering-language placeholder
  copy spec (TTRPG-craft replaces at M8 per `ux-strategy.md`).
- 19 unit tests in `src/auth/cloud-push-consent.test.ts`
  covering round-trip, per-campaign / per-destination
  independence, idempotency, withdrawal, and 6 fail-closed
  defenses (corrupt JSON, unknown version, mismatched
  campaignId / destination inside the record, non-numeric
  acknowledgedAt, NaN).

The UI hookup (dialog presentation + click handler) lands with
M6a OAuth code — the consent ledger sits behind the
"Push to Drive" click in the push-button path:

```
if (!hasAcknowledged(storage, campaignId, dest))
  surface(DEFAULT_CONSENT_COPY)
  if dialog.acknowledged:
    recordAcknowledgment(storage, campaignId, dest, Date.now())
    proceed to OAuth
  else:
    abort (no upload)
```

**Status (logic):** RESOLVED.
**Status (UI hookup):** lands with M6a code; not a separate gate.

**Severity:** P1 (firewall-ethos gating).
**Evidence:** NEW-PRV-4 (privacy consultant 2026-05-29).
The DM-coord cloud save contains EVERY player's authored
content (chat, character drafts, bond notes, intent statements).
When the DM clicks "Back up to Drive", those words go to the
DM's Google Drive — a destination no player consented to.
**Hypothesis:** One-time per campaign on first push, surface a
DM-only acknowledgment: "You are uploading the full table's
content (including your players' chat, character drafts, and
bond notes) to YOUR Google Drive. Players can read what they
have written to this campaign; they cannot see this Drive
folder. [Acknowledge]" — silent-player-firewall preserved (DM
is educated; players are NOT notified).
**Owner:** TTRPG-craft + UX (in-fiction copy); save-restore
lead (gating logic).
**Status:** open. BLOCKS M6a ship.

---

## OP-026 — Recently-played list leaks across browser-profile tab-mates [ACCEPT for M5 patch] [R4: class 2, P1 — confirmed by DEC-019]

**Severity:** P1 (silent cross-tenant disclosure).
**Evidence:** NEW-PRV-3 (privacy consultant 2026-05-29).
M5's recently-played list lives in `localStorage`, shared across
all tabs / browser profiles on the same OS user that share the
origin. Two distinct humans sharing a laptop (DM + their partner)
see each other's campaign slugs and last-played timestamps,
becoming passive observers of session cadence.
**Hypothesis:** Pre-auth: keep today's anonymous (per-origin)
list. Post-auth: scope the list by `sha256(google_sub)`. Two
distinct Google users on the same browser profile get disjoint
lists. Pure-local DMs who never auth fall back to today's
behavior. Add a unit test that account-A writes are NOT visible
to a `getRecentlyPlayed()` call keyed to account B.
**Owner:** save-restore lead (M5 implementer).
**Status:** open. M5 ship already happened in `0ef07c3`; this
is a follow-up patch.

---

## OP-025 — Save-format determinism breaks for git CRLF / large files / player-push path [R4: class 2, P2 doc]

**Severity:** P2.
**Evidence:** NEW-ARC-1 (security consultant 2026-05-29).
Three failure modes:
1. Windows `autocrlf=true` rewrites `\n` to `\r\n`, blowing
   byte-identical roundtrip if a self-hoster pushes via native
   git (not the SPA REST API).
2. Large saves (>1MB) hit GitHub PR-review degradation; >50MB
   trigger warnings. Long Underleaf campaigns will land there.
3. Player-side push (deferred to v1.1) would produce DIFFERENT
   byte content (scrubbed projection) than the DM-coord push.
   Storing both at `saves/<slug>.json` looks like merge churn
   but is actually projection drift.
**Hypothesis:** Document that direct REST-API push is the only
supported v1 path (native `git push` from a checkout is NOT
supported). Player push v1.1 MUST commit to a different path
(`saves/<slug>.player.json`) or be refused. Add a save-size
warning at 1MB / hard refuse at 10MB for the GitHub destination.
**Owner:** save-restore lead (doc + future enforcement).
**Status:** open. Land before M6c ships.

---

## OP-024 — APP + WebAuthn-in-popup may fail silently [R4: class 1, P1] [PARKED-UNTIL-UAT per DEC-026]

**Resolution (run #5):** Per DEC-026, detector + fallback logic
will ship as part of M6a code (shared with OP-015 popup-failure
detection); real-world APP-enrolled-account walk-through is
deferred to M8 UAT.  No APP test account is available to the
program lead today; UAT is the right venue to verify the live
WebAuthn-in-popup ceremony matches the detector's expectations.

**Status:** logic ships with M6a code; UAT verification deferred
to M8.  Surfaced in `ux-strategy.md` as a UAT milestone item.



**Severity:** P1 (locked-C6 constraint).
**Evidence:** NEW-SEC-6 (security consultant 2026-05-29).
Google APP enrollment in stricter configurations forces a
full-page redirect with a security-key challenge that may fail
inside a popup (WebAuthn ceremony needs top-frame under
`same-origin-allow-popups`). The draft's "APP works for M6a"
claim is true for the protocol but unverified for the WebAuthn
UX inside our chosen window topology.
**Hypothesis:** Add a popup-failure detector (popup closes
without postMessage in <2s, OR postMessage carries error
`security_key_required`) that triggers the OP-015 full-page
redirect fallback. The detector + fallback is shared code with
OP-015; widening that work covers this too.
**Owner:** save-restore lead.
**Status:** open. Required for APP-compat ship of M6a.

---

## OP-023 — Account-switch in another tab silently rebinds OAuth target [R4: class 2, P1]

**Severity:** P1 (silent disclosure surface).
**Evidence:** NEW-SEC-4 (security consultant 2026-05-29).
A DM signed into two Google accounts (work + personal) auths
Quire with personal. Mid-session they switch the default Google
account in another tab. Quire's next refresh/re-auth silently
binds to work — pushes go to a different `drive.appdata`. Their
campaign vanishes from view; if the refresh-token still works
they may write to the wrong account.
**Hypothesis:** Cache the `sub` (Google user id) from the
id_token at first auth. On every refresh OR re-auth, verify the
returned `sub` matches the cached one. Mismatch → refuse and
surface "You're now signed into a different Google account;
existing campaign saves won't be visible. Sign back into <email>
or start a new connection."
**Owner:** save-restore lead.
**Status:** open. Required for M6a ship.

---

## OP-022 — Mid-session consent withdrawal has no graceful detection [R4: class 2, P1]

**Severity:** P2 (silent-failure surface).
**Evidence:** NEW-SEC-3 (security consultant 2026-05-29).
DM grants Drive access at session start; an hour in, the access
is revoked at `myaccount.google.com/permissions` (by them or
their partner). The 60-min access token still works until expiry;
the next push fails with a 401 and the DM may not notice until
"Back up" stops working.
**Hypothesis:** Drive REST calls wrap a 401/403 handler that
clears the in-memory token + surfaces a non-modal "Re-connect
Drive" chip with immediate re-auth on click. Same pattern for
`invalid_grant` on refresh-token redemption in M6b — that
signals APP-revoked or user-revoked and MUST drop the encrypted
IndexedDB blob too.
**Owner:** save-restore lead.
**Status:** open. Required for M6a ship.

---

## OP-021 — State nonce is not bound to user intent (campaign / action) [R4: class 1, P1] [RESOLVED-LOGIC 2026-05-29 run #5]

**Resolution (logic layer, run #5):** Pure helper module
`src/auth/oauth-state.ts` ships with:
- `mintState({payload, secret, now, random?, hmac?})` —
  produces an envelope + base64url-encoded state parameter.
- `verifyState({stateParam, ctx})` — fully validates an
  incoming state: shape, intent vocabulary, freshness
  (10-minute window per `STATE_MAX_AGE_MS`, 60s future-skew
  tolerance), flowId match (OP-020), campaignId match
  (DEC-012), HMAC over the intent fields.
- `signingMessage({...})` — stable serializer used by both
  mint + verify.
- `freshSessionSecret()` + `freshFlowId()` — Web Crypto
  primitives.
- `webCryptoHmacSha256Hex` + `webCryptoRandom` — production
  HMAC + RNG; both pluggable for tests.
- 26 unit tests in `src/auth/oauth-state.test.ts` covering:
  - Round trip for `push` + `connect` intents.
  - Tamper rejection across every intent field (intent,
    campaignId, ts, fileRev) + per-tab secret mismatch.
  - Freshness window (stale, future-skew, boundary).
  - Two-tab race (flowId mismatch) + two-flow race
    (campaignId mismatch).
  - Malformed input defenses (non-base64, non-JSON,
    missing fields, unknown intent).
  - Constant-time hex compare smoke check (same/different keys
    via HMAC determinism).

The wiring (call `mintState` at click time, store the secret
in `sessionStorage`, register the listener with the per-flow
UUID, call `verifyState` on the postMessage return) lands with
the M6a OAuth code — the helpers are the load-bearing
correctness primitives.

**Status:** RESOLVED-LOGIC. UI wiring + sessionStorage
persistence land with M6a code; not a separate gate.

**Severity:** P1 (firewall — wrong-campaign-write risk).
**Evidence:** NEW-SEC-2 (security consultant 2026-05-29).
SEC-5's nonce is CSRF defense ("did this auth response
correspond to MY request?") but does NOT bind "and that request
was to push campaign X." A two-flow race (push X started, pull Y
fired before X auth completed) lets the returning auth token
write to the wrong campaign because the in-memory "what was the
user doing" variable was overwritten.
**Hypothesis:** Embed intent in `state`: `state =
base64url({nonce, intent, campaignId, fileRev, ts})` with HMAC
over the intent fields using a per-tab session secret. On
return, verify the embedded intent matches the user's currently-
foregrounded campaign before writing. Refuse with a clear
error on stale intent. Note: campaign-id in `state` lands in
URL-bar history; civilized-peer model accepts this (not a
spoiler-relevant disclosure for Quire's threat model).
**Owner:** save-restore lead.
**Status:** open. Required for M6a ship.

---

## OP-020 — Two-tab concurrent OAuth race overwrites the flow [R4: class 1, P1]

**Severity:** P1 (silent wrong-data flow).
**Evidence:** NEW-SEC-1 (security consultant 2026-05-29).
The draft says "store code_verifier in sessionStorage" but
doesn't spec listener lifecycle. Two tabs racing OAuth (or one
tab re-mounting on browser back-navigation) can re-use the
well-known key + a stale `state` nonce, accepting the wrong
auth code on return.
**Hypothesis:** (a) Listener added at `window.open`, removed in
popup-onclose or onmessage-success. (b) `code_verifier` + `state`
keyed by a per-flow UUID (`quire.oauth.flow.<uuid>`), not a
single well-known key. (c) On popup return, opener validates
`event.data.flowId === my.flowId` before redeeming. Pairs
naturally with OP-021's intent-embedded `state`.
**Owner:** save-restore lead.
**Status:** open. Required for M6a ship.

---

## OP-019 — Cloudflare Worker fallback expands the trust surface invisibly [R4: class 1, P1 — confirmed by DEC-018] [RESOLVED 2026-05-29 run #4 — Worker not needed]

**Resolution:** OP-016 probe confirmed CORS is open for the
token endpoint from `https://quire.pages.dev` (and localhost
dev). DEC-018's conditional Worker fallback is NOT triggered.
M6a ships with direct browser-side token exchange. No Worker
code lands.

If Google reverses the PKCE-CORS policy in the future, re-run
the probe; if it fails, follow DEC-018 to draft the Worker
authorization DEC and only then add code.

**Status:** RESOLVED (not-applicable). Probe-as-canary lives in
`scripts/cors-probe-google-token.mjs`.

**Severity:** P1 (conditional on OP-016 outcome).
**Evidence:** NEW-ARC-2 (security consultant 2026-05-29) +
NEW-PRV-6 (privacy consultant 2026-05-29).
The SEC-3 "fall back to a Cloudflare Worker" sentence
materially changes the threat model: a maintainer-run Worker
sees every auth code + verifier and could redeem them. The
draft has no spec for who hosts, what logs, incident response,
or self-hoster override.
**Hypothesis:** Block the Worker path behind an explicit DEC.
If OP-016 forces the Worker: (a) source lives in
`runtime/cloudflare-worker/` in this repo, (b) deploy-time test
asserts no body logging, (c) README documents the deployed
hash + self-hoster override path, (d) DM-facing connect-Drive
ceremony discloses "Quire's auth proxy briefly sees your Google
authorization code — [learn more]". Verify a client-side-only
fallback via Google's own `gapi.client` library FIRST — may
obviate the Worker entirely for Drive.
**Owner:** save-restore lead → security + architect joint
review BEFORE any Worker code.
**Status:** open. CONDITIONAL on OP-016 result.

---

## OP-018 — Canonical OAuth client_id has no compromise-rotation path [R4: class 1, P1 — confirmed by DEC-017] [RESOLVED 2026-05-29 run #5]

**Resolution (run #5):** Three-component rotation channel
shipped per DEC-013 + DEC-017 + DEC-025:
- `public/.well-known/quire-oauth.json` — discovery doc
  hosted as a Cloudflare Pages static asset (DEC-025).
  Schema: `{version, issued, providers: {google, github},
  maintainer: {tag, commit, contact}}`.  Provider entries
  carry `status` (`verified`/`placeholder`/`unavailable`),
  `client_id`, `consent_app_name`, `fingerprint_sha256`,
  `note`.  Placeholder values today; production values land
  with M6a OAuth app registration.
- `src/auth/canonical-client-id.ts` — build-time embedded
  baseline.  Carries `GOOGLE` + `GITHUB` constants with the
  same shape; `assertReadyForOAuth(entry)` refuses
  initiation on placeholder.  `resolveClientId(entry,
  envOverride?)` honors precedence
  (env-override > baseline > placeholder).  Self-hoster
  override via build-time `QUIRE_OAUTH_CLIENT_ID_GOOGLE` env
  var (per DEC-013); query-param + campaign-manifest
  override hooks documented in `maintainer-ops.md` §5.
- `design/save-restore-program/maintainer-ops.md` — rotation
  runbook (when to rotate, the 8-step procedure, the
  "don't do this" anti-list, incident-response cheat sheet
  for "Google revoked our app" / "suspected compromise" /
  "Cloudflare deploy compromised").

CDN-cache TTL acknowledged at ~1-5 min for emergency
rotation per DEC-025; documented in `maintainer-ops.md` §3b.

**Status:** RESOLVED.

**Severity:** P1 (incident response).
**Evidence:** NEW-SEC-5 (security consultant 2026-05-29).
If the canonical Quire client_id is compromised, revoked by
Google, or rate-limit-banned by abuse, rotation requires every
DM to fetch a new bundle. Cloudflare Pages CDN cache lag
(per `feedback_show_deploy_hash`) means hours of degraded
state. The draft has no incident-response plan.
**Hypothesis:** (a) Ship a runtime-overridable client_id from
day one (env-var at build OR `?clientId=` query OR campaign-
manifest field). (b) Add "client_id unavailable — self-host or
wait for fix" graceful-degradation banner driven by a
discovery-document fetch (`/.well-known/quire-oauth.json`).
(c) Document in `decisions.md` that the canonical client_id is
on the maintainer's threat-model dependency list.
**Owner:** save-restore lead (architect routing).
**Status:** open. Required for M6a ship if we want it ship-
ready for incident response. If accepted as "best-effort v1,"
land the discovery-document mechanism as M6.1.

---

## OP-017b — Cloud-sync UX ship-blockers: placement, discovery, error matrix [ACCEPT for M6a] [R4: class 2, P1] [RESOLVED 2026-05-29 run #6]

**Resolution (run #6):** Three new sections shipped in
`ux-strategy.md`:
- **§A10 Placement.**  Primary: session-digest chip at
  session-close (DM-only conditional preserves silent-player
  firewall).  Discovery: DM operational view "Backups" section
  (always-rendered when surface open; shows account email per
  NEW-SEC-4; Disconnect Drive wires into
  `withdrawAcknowledgment` + token-revoke).  Deferred: the
  consultant's recently-played-row badge (depends on §A11
  probe being live; tracked as M6a-UI follow-up).  Rejected:
  setup-wizard / first-launch ceremony (admin-before-play
  violation of the prime directive).
- **§A11 Cross-device discovery probe.**  Probe runs when
  empty local state AND Drive connected on this device.  Shape:
  one `drive-api.listAppdata` call with
  `name = quire-<campaignId>.json` filter.  Surfacing:
  `[Load it]` (default action) `[Start fresh]` per DEC-015 —
  NEVER auto-load.  If Drive isn't connected,
  `[Check Drive for backups]` one-liner offers manual probe.
- **§A12 Error UX matrix.**  Five rows pinning detection
  signal → placeholder copy → recovery action for
  popup-blocked / user-denied / network-failure /
  account-mismatch / app-blocked.  Six error-surface principles
  lock the shape (local safety first, single primary action,
  silent-player firewall preserved, modal vs. non-modal rule,
  no exception-to-string, shared orchestrator entry points).

Final wording deferred to M8 (TTRPG-craft owns in-fiction
copy).

The shape + behavior is locked; orchestrator + Drive code
ship in the same run consume the §A12 codes as typed
failure reasons.

**Status:** RESOLVED.

**Severity:** P1 (M6a ship-blocking; spec omissions).
**Evidence:** NEW-UX-1, NEW-UX-2, NEW-UX-3 (UX consultant
2026-05-29).
Three independent omissions in the draft, all addressable as
doc-edits to `ux-strategy.md` BEFORE any cloud code ships:
  1. **Placement (NEW-UX-1).** Where the "Back up to Drive"
     button lives + when it first appears is unspecified.
     Just-in-time surfaces (end-of-session digest chip, DM-only
     operational view, recently-played row status) per draft.
     Setup-wizard fails prime directive — admin-before-play.
  2. **Cross-device discovery (NEW-UX-2).** DM on tablet next
     week with empty localStorage doesn't know cloud backup
     exists. Risk: start fresh save, destroy cloud backup on
     next push. Fix: landing page "Connect Drive to check for
     backups" inline; on connect, auto-probe `drive.appdata`
     for matching campaignId; surface "[Load it] [Start fresh]"
     with Load as default. NEVER auto-load.
  3. **Error matrix (NEW-UX-3).** Five failure modes (popup
     blocked / user denies / network / account mismatch /
     APP-blocked) each need designed copy. Mid-session OAuth
     errors with players watching is the prime-directive
     violation par excellence.
**Hypothesis:** Add §A11 "Error UX matrix" + §A10 "Placement +
discovery" to `ux-strategy.md` BEFORE the first commit of M6a
implementation code.
**Owner:** save-restore lead (gating) + TTRPG-craft (copy at M8).
**Status:** open. BLOCKS M6a ship.

---

## OP-017c — Co-DM identity / per-DM `drive.appdata` ownership [R4: class 2, P2 doc]

**Severity:** P2 (locked deferral; documented).
**Evidence:** NEW-UX-4 (UX consultant 2026-05-29).
Multi-DM campaigns: which Google account owns the canonical
backup? Per-DM-Drive (each co-DM pushes to their own appdata) is
the simplest M6a model — pull-on-discovery (NEW-UX-2) probes
whichever co-DM is signed in. Designated-backup-DM and shared
ownership models are deferred to M6c (GitHub naturally shares).
**Hypothesis:** Ship M6a with per-DM-Drive + document the limit.
Regression: two co-DM peers, different Drive accounts, both push
→ assert both files exist; neither destroys the other.
**Owner:** save-restore lead.
**Status:** accepted as documented limitation. Resolves in M6c.

---

## OP-017d — M6b passphrase recovery semantics [R4: class 2, P1 for M6b]

**Severity:** P1 for M6b (not blocking M6a).
**Evidence:** NEW-UX-7 (UX consultant 2026-05-29).
M6b passphrase-encrypted refresh_token has no documented "DM
forgot it" path. Lock the semantics: passphrase is per-device,
optional, lossable without consequence (the blob protects local
credential persistence, not the canonical save). UI: "Forgot
passphrase? [Clear stored login on this device]" → wipes
IndexedDB blob, triggers fresh OAuth flow (degrades to M6a).
**Hypothesis:** Document in `auth-strategy.md` + add UI hook
before M6b ships. Regression: passphrase-set + "Forgot" click
→ IndexedDB cleared + fresh OAuth prompt.
**Owner:** save-restore lead.
**Status:** open. BLOCKS M6b ship (NOT M6a).

---

## OP-017e — Account-loss durability: appdata is structurally irrecoverable [R4: class 2, addressed by DEC-016 (re-rank M6c)]

**Severity:** P2 (documented limitation; re-rank M6c).
**Evidence:** NEW-ADV-3 (adversarial consultant 2026-05-29).
If the DM's Google account is suspended / billed-out / hostile-
takeover-reset, `drive.appdata` content is structurally
irrecoverable (Google's takeout export does not include third-
party appdata). Quire's "durable campaign" promise has a single
point of failure on the DM's Google account.
**Hypothesis:** Three options, choose ≥1:
  1. Mandatory local-disk copy on each push (auto-fire the
     "Download backup" action from the operational view).
  2. Promote `drive.file` opt-in to "the recoverability path"
     in docs (not just "manual recovery footnote").
  3. Re-rank M6c (GitHub) ahead of M6b. A GitHub-hosted save
     survives the DM's Google account.
**Owner:** save-restore lead → architect.
**Status:** open. Documented; needs a product call to rank.

---

## OP-017f — Cleartext-on-Drive disclosure (subpoena / breach surface) [R4: class 2 + class 1 (subpoena = third-party state actor), P2 doc]

**Severity:** P2 (documented limitation).
**Evidence:** NEW-ADV-4 (adversarial consultant 2026-05-29).
"Cleartext on cloud acceptable" (A6 LOCKED) is correct for
Google-as-company-not-adversary but unevaluated for the
subpoena / breach axis. The DM-coord save contains AI-prompts
+ AI-responses (NPC-killer-secrets, plot twists), npc-pins
(potentially real-name player identifiers if the DM tracks
them), bond-ratify.dmNotes, pc-create.dmNotes, and
chargen-pack-deliver (player-authored under DM-eyes-only
expectation).
**Hypothesis:** Add a "What's in the file Google holds"
section to `auth-strategy.md` listing the kinds + DM-typed
fields. Surface a one-time "what's saved" disclosure on first
push (composes naturally with OP-027). Defer client-side
encryption (out of scope for M6 per non-goals) but call it out
as the natural M7+ direction if a user pushes back.
**Owner:** save-restore lead — doc + UX wiring.
**Status:** open. Doc-first; not ship-blocking.

---

## OP-017g — Canonical client_id integrity (SRI + verified-app fingerprint) [R4: class 1, P0 — CRITICAL under DEC-023] [RESOLVED 2026-05-29 run #5]

**Resolution (run #5):** Three-layer defense shipped:
1. **Build-time embedded baseline.**
   `src/auth/canonical-client-id.ts` carries the canonical
   `client_id` + a SHA-256 fingerprint of the consent-screen-
   displayed app name + a `status` enum
   (`'verified' | 'placeholder' | 'unavailable'`).  The runtime
   trusts this baseline by default; `assertReadyForOAuth(entry)`
   hard-stops on placeholder.  `resolveClientId(entry,
   envOverride?)` honors env-override > baseline > placeholder
   precedence so self-hosters pass `QUIRE_OAUTH_CLIENT_ID_GOOGLE`
   at build time.
2. **Golden-diff CI.**
   `scripts/golden-diff-canonical-client-id.test.mjs` pins
   SHA-256 hashes of BOTH `src/auth/canonical-client-id.ts`
   AND `public/.well-known/quire-oauth.json`.  Any change
   without updating the hashes in the same PR fails the
   build — same pattern as `golden-diff-callback.test.mjs`
   (OP-017).  Additional structural assertions: exports
   present, discovery doc shape valid, status vocabulary
   limited, fingerprint is 64 hex chars.
3. **Discovery doc.** `public/.well-known/quire-oauth.json`
   served by Cloudflare Pages static asset (DEC-025); the
   runtime treats this as a HINT, not a binding override.
   `allowDiscoveryOverride: false` per-entry in v1 ships
   closed; the hook is present for future incident-response
   discovery-driven rotation.

Plus `design/save-restore-program/maintainer-ops.md` (DEC-024)
documents the rotation runbook, the verified-app fingerprint
computation, self-hoster overrides, and the incident-response
cheat sheet.

The "Subresource Integrity (SRI) on the bundle" defense from
the original hypothesis was downgraded to "not required" in
the auth-strategy.md §A10 revision: Vite chunk-split bundles
embed hashes in the entry HTML; an attacker who swaps
`canonical-client-id.ts` can also swap the SRI hash.  SRI
duplicates the protection without closing the actual
supply-chain attack vector.  Cloudflare Pages deploy-key +
branch-protection (documented in `maintainer-ops.md`) IS the
load-bearing trust boundary.

23 unit tests (`canonical-client-id.test.ts`) + 6 structural +
2 hash-pinning tests (`golden-diff-canonical-client-id.test.mjs`).
Build verified: `public/.well-known/quire-oauth.json` lands in
`dist/.well-known/quire-oauth.json` post-build.

**Status:** RESOLVED.

**Severity:** P0 (BLOCKS M6a; supply-chain primitive).
**Evidence:** NEW-ADV-5 (adversarial consultant 2026-05-29).
The shipped `client_id` is a security primitive — an attacker
who swaps it for theirs (compromised Cloudflare deploy / npm /
Underleaf bundle) renders the OAuth consent against THEIR
Google OAuth app, and once granted reads every prior Quire
save on that account.
**Hypothesis:** Multiple defenses:
  1. Subresource Integrity (SRI) on the deployed bundle.
  2. Publish-time manifest with the canonical `client_id` + a
     hash; build-time verification.
  3. README publishes the canonical `client_id` value + a
     screenshot of Google's verified-OAuth-app consent screen so
     paranoid users have a reference to diff against.
  4. Cloudflare Pages deploy-key + branch-protection
     requirements (out-of-band ops doc).
**Owner:** save-restore lead (engineering); maintainer (ops).
**Status:** open. BLOCKS M6a ship.

---

## OP-017h — Retry-backoff for `If-Match`-revision-conflict on Drive push [R4: class 3 hostile-co-DM, DOWNGRADED to P3]

**Severity:** P2 (rate-limit DoS resilience).
**Evidence:** NEW-ADV-7 (adversarial consultant 2026-05-29).
The pull-rebase-push design with `If-Match revision_id` is
auto-retriable; combined with DEC-005 auto-broadcast, a
hostile co-DM rapidly pushing empty deltas can lock the legit
DM out of Drive (hit the 1k req/100s per-user limit).
**Hypothesis:** Exponential backoff with jitter on `If-Match`
failures. Hard cap at 3 retries, then surface "Your Drive sync
is busy — last successful push N min ago" + manual retry
button.
**Owner:** save-restore lead.
**Status:** open. Land with the pull-rebase-push code in M6a/c.

---

## OP-017 — OAuth callback page is an XSS sink + integrity surface [R4: class 1, P0/P1 — CRITICAL under DEC-023] [RESOLVED 2026-05-29 run #4]

**Resolution:** Run #4 ship.
  - `public/auth/google/callback.html` + `public/auth/google/callback.js`
    landed with strict callback-specific CSP
    (`default-src 'none'; script-src 'self'; style-src 'self'
    'unsafe-inline'; connect-src 'none'; img-src 'none';
    font-src 'none'; frame-ancestors 'none'; base-uri 'none';
    form-action 'none'; object-src 'none'`) via
    `public/_headers` path-scoped rule.
  - Callback JS validates `window.opener`, parses
    `URLSearchParams` only, postMessages
    `{ source: 'quire-oauth', code, state }` with explicit
    `targetOrigin = window.location.origin` (never `*`),
    forwards Google's `error` param without
    `error_description` (closes OP-030 PII leak).
  - `scripts/golden-diff-callback.test.mjs` runs in
    `npm test` — 12 assertions: SHA-256 hash pinning for both
    callback files, no inline event handlers, no inline
    `<script>` body, no remote URL refs, callback.js validates
    `window.opener`, callback.js uses explicit targetOrigin
    (not `*`), `_headers` callback CSP precedes the wildcard,
    `default-src 'none'` and `connect-src 'none'` enforced.
  - Future intentional change to the callback page requires
    updating BOTH the file AND the golden hash constant in
    the same PR; reviewers MUST call out the hash change.
  - CSP integration test (`src/test/integration/csp.test.ts`)
    updated to parse the wildcard `/*` block specifically (so
    the path-scoped callback CSP doesn't shadow it).
  - All 2649 tests pass; typecheck + build clean.

**Status:** RESOLVED.

**Severity:** P1 (BLOCKS M6a; security primitive).
**Evidence:** NEW-ADV-8 (adversarial consultant 2026-05-29).
The callback page is the most security-critical static page in
the deploy. Without a strict CSP it can reflect URL params into
postMessage and XSS into opener context. Reflecting raw URL into
postMessage leaks the auth code to anything listening.
**Hypothesis:** Callback page MUST:
  1. Use strict CSP (`default-src 'none'; script-src 'self'`),
     no inline scripts.
  2. Parse `URLSearchParams` and postMessage ONLY `{ code,
     state }` — never the raw URL.
  3. Validate `state` matches at the callback as a sanity check
     (defense in depth; opener re-validates).
  4. Be audited as a separate artifact in CI — diff against a
     golden file, fail the build on any change without explicit
     sign-off.
Also: ship the CSP header check as a deploy-time test.
**Owner:** save-restore lead.
**Status:** open. BLOCKS M6a ship.

---

## OP-016 — Cross-origin CORS for the token-exchange endpoint is unverified (BLOCKING) [R4: class 1 infra; P1 BLOCKING] [RESOLVED 2026-05-29 run #4]

**Resolution:** `scripts/cors-probe-google-token.mjs` (committed
in run #4) verified `https://oauth2.googleapis.com/token` accepts
CORS requests from BOTH `https://quire.pages.dev` (production)
and `http://localhost:5173` (dev). Response shape: 401 +
JSON-error (`{error, error_description}`) +
`Access-Control-Allow-Origin: <origin>` header. Preflight
OPTIONS also passes (`Access-Control-Allow-Methods: POST` etc.).

M6a can ship as designed — direct browser-side token exchange,
no Worker proxy needed. **DEC-018 (Worker fallback) is NOT
TRIGGERED.**

Run `npm run cors-probe -- --origin <other-origin>` to verify
additional origins (e.g. staging) as they come online.

**Status:** RESOLVED. Probe lives in `scripts/cors-probe-google-token.mjs`.

**Severity:** P1 (blocks M6a ship).
**Evidence:** `auth-strategy-review.md` SEC-3.
`oauth2.googleapis.com/token` is documented as PKCE-CORS-compatible
for public clients, but real-world behavior varies. The browser
will fail with CORS errors if assumptions are wrong.
**Hypothesis:** Build a dev-only probe FIRST: hit token endpoint
with bogus code+verifier, assert JSON-error response (CORS open)
NOT CORS-blocked failure. If blocked, fall back to a Cloudflare
Worker as a token-exchange proxy.
**Owner:** save-restore lead.
**Status:** open. BLOCKS M6a implementation start.

---

## OP-015 — COOP/COEP headers + popup-blocker fallback for OAuth flow [R4: class 2 UX, P2]

**Severity:** P2 (popup-blocker breakage).
**Evidence:** `auth-strategy-review.md` PRV-1. Aggressive popup-
blockers (Firefox Strict mode, Safari ITP) can break the popup-
postMessage flow.
**Hypothesis:** Document Cross-Origin-Opener-Policy:
same-origin-allow-popups requirement. Build full-page-redirect
fallback when popup is blocked OR communication fails.
**Owner:** save-restore lead.
**Status:** open. Needs to land before M6a ships.

---

## OP-014 — Microcopy for OAuth-flow buttons must read as "leaving Quire" [R4: class 2 UX, P2]

**Severity:** P2 (UX-acceptance gating).
**Evidence:** `auth-strategy-review.md` UX-1. From the human's
mandate: the OAuth popup must feel like "I'm leaving Quire to talk
to Google", NOT "Quire is asking for my password."
**Hypothesis:** Button labeled "Back up to Drive" with microcopy
"You'll authenticate with Google. Quire never sees your password."
Defer final string to M8 in-fiction copy review.
**Owner:** save-restore lead (TTRPG-expert routing for M8).
**Status:** open. Visual review needed once M6a UI lands.

---

## OP-013 — Self-hoster override of OAuth client_id [SUBSUMED by OP-018]

**Severity:** P3 (deployment / trust model).
**Evidence:** `auth-strategy-review.md` ARC-3 — now subsumed by
NEW-SEC-5's broader incident-response framing (OP-018) and
NEW-ADV-5's supply-chain integrity framing (OP-017g). The
self-hoster-override mechanism is the SAME runtime-override
mechanism the canonical-compromise-rotation story needs.
**Resolution:** Tracked as part of OP-018 + OP-017g.
**Status:** subsumed.

---

## OP-012 — Push UI must warn on shared-link destinations [SUPERSEDED by DEC-009]

**Severity:** P2 (firewall — civilized-peer disclosure model).
**Resolution:** DEC-009 defaulted Drive scope to `drive.appdata`
(hidden, unshareable). The share-link risk is gone for default
users. The opt-in `drive.file` path still needs the ACL-check
warning — re-scope this OP to "implement ACL check for opt-in
`drive.file` users" if/when we build that path.
**Status:** superseded; defer to opt-in-`drive.file` build.

---

## OP-011 — Multi-DM concurrent push: conflict UX [R4: class 2 accidental-only (hostile co-DM = class 3 OOS), P3]

**Severity:** P3 (rare, multi-DM only).
**Evidence:** `auth-strategy.md` A7. Two DMs (co-DM and primary)
pushing to the same Drive file concurrently.
**Hypothesis:** Pull-rebase-push semantics using Drive's `revision_id`
as the optimistic concurrency token. The CRDT merge already exists at
the event-log layer; the cloud-sync layer just needs the orchestration.
**Owner:** save-restore lead (architecture routing).
**Status:** open. Pending architect review in M6.

---

## OP-010 — Cloud file format: full save vs append-only chunks [CLOSED by ARC-1 review 2026-05-29]

**Severity:** P2 (architecture choice with downstream UX impact).
**Resolution:** ARC-1 review settled on "same `SaveDocument`
format on both Drive and GitHub destinations" — runtime already
produces deterministic git-friendly JSON via `stringifySave`.
Git's line-level diff on the alphabetically-sorted per-event lines
handles the "small diff" property automatically. Format-per-
destination complexity dropped.

---

## OP-009 — Token persistence: re-auth per session vs encrypted refresh-token [RESOLVED by DEC-008 2026-05-29]

**Severity:** P1 (UX vs security trade-off).
**Resolution:** DEC-008 layered ship: M6a is ephemeral (re-auth per
session — strict C4). M6b adds passphrase-encrypted refresh_token in
IndexedDB. APP users degrade to M6a behavior automatically.

---

## OP-008 — GitHub auth shape: Device Flow vs PKCE; OAuth App vs GitHub App [RESOLVED by UX-2 + DEC-008 2026-05-29]

**Severity:** P2 (architecture choice).
**Resolution:** Device Flow chosen per UX-2 review (better fit for
DM-at-table ceremony — "open this URL on your phone, type the
code"). Public-repo only in v1; private-repo support deferred
(needs GitHub App registration). Lands as M6c per DEC-008.

---

## OP-007 — Google Drive OAuth flow under Advanced Protection Program [PARTIALLY RESOLVED 2026-05-29]

**Severity:** P1 (locked human constraint — must work under APP).
**Resolution:** PKCE + `drive.appdata` is on Google's APP-allowed
list (verified per Google docs as of draft 2). M6a (ephemeral, re-
auth every session) is explicitly APP-safe. M6b's passphrase-
encrypted refresh_token may be APP-revoked aggressively; in that
case M6b users on APP-enabled accounts degrade gracefully to M6a
behavior — the runtime detects refresh-token-revocation and re-
prompts for auth.
**Status:** partially resolved (M6a path locked). M6b APP-specific
behavior needs a real-world test once code lands.

---

## OP-006 — GitHub-push and Drive-sync are implied but not built [DECISION 2026-05-29: BUILD]

**Severity:** P1 (honesty / promise-keeping)
**Resolution:** Human made the call: **build cloud sync**. Constraints
locked: OAuth-based, no credentials in browser, must work under Google
APP. See `auth-strategy.md` for the draft architecture (draft 1
written this session, pending security consultants + UX validator).

Sub-problems now tracked separately:
- OP-007: OAuth flow design (Google Drive PKCE vs APP-compat). [open]
- OP-008: GitHub auth shape (Device Flow vs PKCE; OAuth App vs GitHub
  App for private-repo scoping). [open]
- OP-009: Token persistence — accept "re-auth per session" or build
  refresh-token + WebCrypto-passphrase encryption? [open, UX-routed]
- OP-010: Cloud file format — full materialized save vs append-only
  event-log chunks. [open, architecture]
- OP-011: Multi-DM concurrent push conflict UX. [open, architecture]
- OP-012: Push UI must warn on shared-link destinations. [open, UX +
  adversarial]

---

## OP-005 — Strip-on-restore is destructive, restore UX gives no warning [R4: class 2, P2]

**Severity:** P2 (data-loss-on-import)
**Evidence:** Architect finding #3 (`persistence.ts:455-486`). A player's
save is stripped of DM-only events; if a DM loads that player's save, the
DM-only state is permanently gone unless the DM also has their own save to
merge.
**Hypothesis:** When restoring a non-coord save, surface "this save was
authored by a player viewer — DM-private state will be missing. Continue?"
Plus offer "merge with your own save" if one exists.
**Owner:** save-restore lead.
**Status:** parked for M5 (it's discoverability-shaped, not crash-shaped).

---

## OP-004 — Coordinator-reclaim has no LWW determinism test under same-millisecond authorship [RESOLVED 2026-05-29]

**Severity:** P2 (correctness, low probability)
**Resolution:** M4 commit. `persistence.restore-drill.test.ts` now
includes two LWW-determinism tests:
1. Concurrent `coordinator-claim` from two peers converges to the same
   coordinator across cross-replication (the realistic case — two
   peers each appending without seeing the other first).
2. The same convergence survives a save → restore byte-roundtrip.
The original "two events at same ts with same seq" formulation was
unreachable via the public API (EventLog rejects events whose id
doesn't match `peerId:seq`); the concurrent-append framing is the
real-world equivalent.

---

## OP-003 — `PER_KIND_SCRUBBERS` is hand-maintained [RESOLVED 2026-05-29]

**Severity:** P1 (firewall regression class)
**Resolution:** M1 commit landed `EVENT_KINDS_NO_SCRUB_NEEDED` + lint in
`persistence.coverage.test.ts`. Every player-visible kind must now be in
exactly one of the two sets. A new player-visible kind without an
explicit decision trips CI.

---

## OP-002 — Fuzz coverage is asymmetric [RESOLVED 2026-05-29]

**Severity:** P1 (firewall coverage gap)
**Resolution:** M1 commit landed `persistence.firewall-fuzz.test.ts` —
40 seeded scenarios across 12 payload shapes; 0 sentinels survive the
non-coord projection; positive-control test ensures revealed labels
are KEPT.

---

## OP-001 — `applyEvent` does not broadcast [RESOLVED 2026-05-29]

**Severity:** P0 (breaks the user-stated promise)
**Resolution:** Reproduced in
`src/core/peer.restore-rebroadcast.test.ts`. The 2-peer case
works (pull from new joiner), the 3-peer "alice restores AFTER
joining, bob+carol already connected" case FAILS pre-fix.
`applyEvent` now propagates via `forwardShareToOthers` (sync-response)
by default. Opt-out via `{ propagate: false }` preserved for the
session-controller `regenerateCode` path.
See DEC-005 for full rationale.
Commit: M3 ship.

---

## NEW-ADV-1 — Restore-as-player loads DM-coord projection unscrubbed [RESOLVED 2026-05-29]

**Severity:** P0 (BLOCKING; 5th render-gated-write-not-gated firewall breach).
**Resolution:** Commit `a7dedac`. `persistence.ts:projectSaveForViewer`
runs the save through the SAME `serializeSessionForViewer` viewer-scope
filter on the way IN; `quire-app.loadFromString` calls it with
`viewerIsCoord=(mode==='host')` before applying. Regression test in
`src/persistence.restore-firewall-fuzz.test.ts` plants sentinels in every
DM-only kind + sub-field, asserts no sentinel survives a guest-load
projection.

---

## NEW-ADV-2 — `applyEvent` rebroadcast crosses the firewall [RESOLVED 2026-05-29]

**Severity:** P1 (defense in depth + sister-leak of NEW-ADV-1).
**Resolution:** Commit `a7dedac`. `persistence.ts:defaultRebroadcastFilter`
exports a rebroadcast classifier; `Peer` now takes a `rebroadcastFilter`
option in its constructor; `session-controller.ts` wires the default into
production. `Peer.forwardShareToOthers` runs every event through the filter
before sending — DM-only kinds dropped, partial-payloads field-scrubbed
via the same `PER_KIND_SCRUBBERS` registry. Regression tests assert
PLAYER_SCOPE_STRIP_KINDS events return null from the filter AND that an
integration scenario (alice loads DM-coord save while bob is connected)
yields no sentinel in bob's event log.

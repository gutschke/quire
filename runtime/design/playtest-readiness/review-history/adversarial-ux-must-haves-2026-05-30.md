# Adversarial review — UX must-haves (UX-MH-1..4) — 2026-05-30

Firewall pass on the four asks in
`design/playtest-readiness/ux-must-haves.md`.  Engineering shapes
pre-settled by the parent guidance; this memo attacks every NEW
user-facing affordance for accidental DM disclosure + silent-
player-firewall violations under DEC-023 / DEC-030 / DEC-031.

## Verdict

**GO-WITH-FIXES** for playtest 1.

Counts: **P0 ×1**, **P1 ×4**, **P2 ×5**.  UX-MH-4 trivially clean.

## Per-ask findings

### UX-MH-1 — Player name beside PC name

**[P0 — MH-1-A] Parent's "DM authors peer-rename on behalf of
another peer's seat" is INERT against the materializer + R2.1.**
`core/peer.ts:331` rejects share envelopes where
`event.peerId !== from` (R2.1 impersonation defense).  A
DM-authored peer-rename for Alice's seat carries
`event.peerId=dmPeerId`; the materializer at
`core/state.ts:1993-2026` then writes `state.peers[dmPeerId]`,
not Alice's entry.  The DM renames themselves.  Exact class of
bug LL-1 catches.
- Mitigation: NEW event kind `peer-rename-by-coord` with
  `targetPeerId` payload, coord-author gate; materializer writes
  `state.peers[p.targetPeerId].name`.  Classify as player-visible
  (peerId + cap-bounded string; no scrubber needed).  R2.1 stays
  clean (the DM IS the author).
- Test: `peer-rename-by-coord.production-path.test.ts` — drive
  the click handler, assert `view.peers[alicePeerId].name`
  changes on BOTH DM and guest projections.  Do NOT call the
  materializer directly (LL-1 sliver trap).

**[P1 — MH-1-B] Stale player name after rebind = silent
disclosure of the prior player's identity.**
Per `project_quire_pcslots_rebinding`, a seat may rebind to a
new player mid-campaign.  Bond entries or roster cards that
captured the player-name AT RATIFY TIME will keep showing the
prior name after rebind.
- Mitigation: render the player-name overlay by joining LIVE
  `state.peers[pcSlots[slot].controllerPeerId].name` per render;
  do NOT cache.  Mirrors the #398 own-PC-reveal fix (resolve
  via live presence map).
- Test: `peer-rename-rebind.live-resolution.test.ts`.

**[P2 — MH-1-C] Eye-line adjacency leak risk in chargen-dm-review.**
A `Player: Alice` label rendered immediately above the DM's
`dmNotes` textarea creates a screen-share mis-read vector.  Not
a firewall leak per the threat model — DM's own screen.
- Mitigation: visually demarcate the DM-private block ("DM-only
  — never shared"); hand to visual-design pass.

**[P2 — MH-1-D] No accidental-flood guard on rename.**
A UI oninput-handler bug would emit one peer-rename per
keystroke.  Threat model excludes malicious teammates; same
vector lands via a bug.
- Mitigation: 250 ms debounce on append; per-peer per-session
  cap of ~200.  Test: `peer-rename.debounce-and-cap.test.ts`.

### UX-MH-2 — DM-side edit affordances

**[P1 — MH-2-A] Tag editing requires NEW event kinds; the
firewall classification quad MUST land in the same commit.**
`character-edits.ts:32` excludes `tags` from `pc-edit` (arrays
have bad LWW merge).  Parent settles on `pc-tag-add` +
`pc-tag-remove`.  Per the playbook's two-questions rule, each
new kind needs to appear in `KNOWN_EVENT_KINDS` AND exactly one
of `PLAYER_SCOPE_STRIP_KINDS` / `EVENT_KINDS_PLAYER_VISIBLE`,
AND in `EVENT_KINDS_NO_SCRUB_NEEDED` (tags are uniformly
player-visible per `character-loader.test.ts:402-418`).
- Mitigation: ship the classification + the
  `persistence.coverage.test.ts` tripwire rows alongside the
  materializer.  Per-tag cap 80 chars (matches `state.ts:1367`);
  ≤8 tags per PC; reject empty / duplicate.
- Test: `pc-tag-add-remove.firewall.test.ts`.

**[P1 — MH-2-B] DM-authored backstory edits MUST run the
chat-spoiler-lint pipeline before propagating.**
`backstory` is player-visible (`character-loader.test.ts:418`).
A DM transcribing notes into the box ("Mei is the Quiet's
vessel — must thread") broadcasts verbatim today.  No semantic
check intercepts.  Mirrors the
`feedback_engineering_practices_from_reviews` self-check.
- Mitigation: reuse the chargen synthesizer's pipeline
  (`backstory-synthesizer.ts:240+`):
  `containsSpoilerTokens` → `aiSemanticSpoilerCheck` → one
  retry → fail-closed.  On hit: soft-warn DM, refuse to ship
  until explicit override.  Silent-player-firewall: NEVER tell
  the player.  Player-authored backstory edits skip the lint
  (player owns voice).
- Test: `dm-backstory-edit.spoiler-lint.test.ts`.

**[P2 — MH-2-C] Per-field edit ordering creates an observable
multi-step projection.**
DM changes pronouns + adds two tags → 3 events serialize.  For
~100 ms the player sees pronouns updated but only one tag
present.  Not a firewall leak; per
`feedback_engineering_practices_from_reviews` (atomic-sequences),
log as known minor.  Future: `pc-edit-bundle` atomic event,
parallel to `pc-mark-realization`.

**[P2 — MH-2-D] pc-edit trust gap is amplified by the new UI.**
Per `project_quire_pc_edit_trust_gap`, any peer can write any
`pc-edit` today; the threat model tolerates it.  The new UI
turns the protocol-level capability into a button.
- Mitigation: gate the affordance's allowed fields to exactly
  `{name, pronouns, tags, backstory}` (the four named in the
  user quote).  No surface for any field in
  `DM_ONLY_CHARACTER_FIELDS`.  UI-layer enforcement; protocol
  unchanged.
- Test: `chargen-dm-review.allowed-fields.test.ts`.

### UX-MH-3 — Targeted AI backstory refresh (load-bearing)

**[P1 — MH-3-A] `backstory-refresher.ts` MUST call
`buildPlayerFacingContext`, NEVER `buildCampaignContext` with
`scope:'dm'` — for every entry point (player-initiated AND
DM-initiated).**
The type-level override at `ai/campaign-context.ts:262` is the
first line of defense (docstring lines 248-261).  Backstory is
always player-visible regardless of who triggers the refresh.
- Mitigation: module has no `scope` parameter on its public
  API; only ever calls `buildPlayerFacingContext`.  CI grep
  lint: `scope:\s*['"]dm['"]` MUST NOT appear in the module.
- Test: `backstory-refresher.scope-discipline.test.ts` — spy
  on `buildCampaignContext`, assert `scope:'public'` for EVERY
  entry point.  Companion grep lint.

**[P1 — MH-3-B] Forbidden-token + semantic spoiler check MUST
run on AI output BEFORE the `backstory-refresh-proposal`
materializes; otherwise the proposal event carries the leak to
the player accept gate.**
"DM will catch it before accept" is the inverted silent-player
trap: if the DM accepts the proposal as-is, the player sees the
spoiler-shaped prose.  Locked rule: telling the player they hit
a spoiler IS the spoiler.
- Mitigation: reuse the synthesizer pipeline verbatim.  On
  post-retry persistent leak: NEVER materialize the proposal;
  DM-side warning ("AI named hidden lore; try again").
- Test: `backstory-refresher.spoiler-pipeline.test.ts` — mock
  provider returns "the Quiet had touched her"; assert NO
  proposal event emits; assert exactly one retry.

**[P1 — MH-3-C] `backstory-refresh-proposal` is a NEW event
kind needing the full classification quad.**
Payload temptation: a `rationale` field for the DM ("threading
the Quiet reveal") that, if present and unscrubbed, leaks to
the player on rebroadcast.
- Mitigation: schema is strictly
  `{v, pcId, proposedBackstory, anchors[]}` — NO rationale,
  NO causedByResponseId.  Classify as `EVENT_KINDS_PLAYER_VISIBLE`;
  register a per-kind scrubber that drops
  `PC_EVENT_DM_ONLY_PAYLOAD_FIELDS` (mirrors pc-edit at
  `persistence.ts:353`).  Apply
  `payloadFieldNameKeyNamesDmField` for future-rename defense
  (DEC-031).
- Test: `backstory-refresh-proposal.firewall-coverage.test.ts`
  extends the tripwire; sentinel-planter in
  `persistence.restore-firewall-fuzz.helpers.ts`.

**[P1 — MH-3-D] DM-initiated refresh prompt MUST NOT include
DM's reason / dmNotes / why-this-tag-changed narrative.**
Defense in depth: even though P1-B's lint catches leakage in
the AI output, putting DM-private text INTO the prompt invites
echoing.  Concrete: DM removed `outsider` tag because the Quiet
rejected Sora — the prompt-builder must send only the
structured diff `{added: [], removed: ['outsider']}` + prior
prose + `buildPlayerFacingContext`.  Mirrors
`diff-proposal-prompt.ts:30-34` inverted (NPC diff-proposal
LEGITIMATELY sees DM material; the player-facing refresher
must NOT).
- Test: `backstory-refresher.prompt-shape.test.ts` — introspect
  the assembled prompt for absence of `dmNotes`, `dmGuidance`,
  free-form DM rationale strings.

**[P2 — MH-3-E] DM-disconnect race during AI request.**
DM clicks Refresh, AI request fires, DM laptop sleeps,
response arrives → handler gone.  Acceptable IF requests are
local-to-issuing-peer and aborted on disconnect.
- Mitigation: register the AI request's `AbortController` on
  disconnect; never hand the in-flight request context to a
  re-elected coord.

**[P2 — MH-3-F] If a player-side "try again with prompt"
ships, the player's prompt becomes AI input but the context
block MUST still come from `buildPlayerFacingContext`.**
Covered by P1-A's module-level discipline if respected.

### UX-MH-4 — Resizable region dividers

**[P2 — MH-4-A] localStorage corruption / out-of-bounds widths.**
Hand-edited `-99999px` / `NaN` / `1e18px` produces a degenerate
grid the user can't recover from (LL-3 dialog-no-effect class
of bug).
- Mitigation: clamp on load to `[120, 720]`-ish per axis; fall
  back to default on `NaN`/non-finite/non-numeric.  Reset-to-
  default affordance per the spec.
- Test: `splitter-bounds.test.ts`.

## Cross-cutting concerns

**[CC-1]** All four new event kinds (`peer-rename-by-coord`;
`pc-tag-add`; `pc-tag-remove`; `backstory-refresh-proposal`)
MUST land WITH classification in the same commit.  The
`persistence.coverage.test.ts` tripwire enforces the partition;
un-classified kinds fail CI.

**[CC-2]** Silent-player-firewall lens on every new
player-facing surface: NO "we detected a spoiler" banners on
the player side.  DM-side warning only.

**[CC-3]** Per LL-3, any new confirm-dialog in UX-MH-3 ("Apply
this AI proposal?") MUST register in `DIALOGS_TO_PROBE`
(`e2e/dialog-visibility.spec.ts`) AND `LIGHT_DOM_DIALOG_BACKDROPS`
/ `_BODIES` (`src/ui/styles/dialog-visibility.test.ts`).

**[CC-4]** UX-MH-2 amplifies the pc-edit trust gap surface; re-
flag the gap for the next iteration when the threat model
tightens.

## Recommended test coverage

End-to-end + real-browser (LL-3 prefers real Chromium for new
dialogs):
- `peer-rename-by-coord.production-path.test.ts`
- `peer-rename-rebind.live-resolution.test.ts`
- `pc-tag-add-remove.firewall.test.ts`
- `dm-backstory-edit.spoiler-lint.test.ts`
- `backstory-refresher.scope-discipline.test.ts` + grep CI lint
- `backstory-refresher.spoiler-pipeline.test.ts`
- `backstory-refresher.prompt-shape.test.ts`
- `backstory-refresh-proposal.firewall-coverage.test.ts`
- `chargen-dm-review.allowed-fields.test.ts`
- `e2e/dialog-visibility.spec.ts` extension for the proposal
  confirm-dialog (if shipped as a custom-element light-DOM dialog)
- `splitter-bounds.test.ts`

Engine-level invariant pinning:
- Extend `persistence.coverage.test.ts` with the four new kinds.
- Extend `persistence.restore-firewall-fuzz.helpers.ts` with
  sentinel planters for each new kind.
- Add to `coord-flip-firewall.test.ts` "ADD NEW MIRRORS HERE"
  any new `@state`/cache holding proposal drafts (per the
  playbook's coord-flip checklist; #392/#393/#395 class).

## Open product calls for human

1. **UX-MH-3 DM-direct-apply rule.**  The ux-must-haves.md spec
   leaves "DM-can-apply-directly when triggered by DM-authorized
   field edit" for the lead + TTRPG/UX expert.  Firewall-side I
   see no leak either way (the prose is player-visible
   regardless of who applies); this is a craft / authorship
   call.  Defer to TTRPG/UX expert.
2. **UX-MH-1 event-kind shape: new `peer-rename-by-coord` vs
   extend pc-edit with `playerDisplayName`.**  Both are
   firewall-clean if classified correctly; choice is engineering
   taste (today the field lives on peer presence, not the PC
   record).  Defer to engineering lead.

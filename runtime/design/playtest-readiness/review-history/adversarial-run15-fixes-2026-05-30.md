# Adversarial review — run #15 fixes — 2026-05-30

Third pass on run #15's critical fixes; GO/NO-GO before playtest.
Verifies the v2-flagged items closed AND probes new edges.

## Verdict per fix (P0 / P1 / P2 hazards found)

- **UX-3 routing (player auto-trigger)**: CLEAN for playtest 1
  (single-campaign).  P3 in-memory-mirror cross-campaign leak — see
  H-1.  Bound-following co-DM correctly stays in `coordHolders`
  (set is append-only), no leak from the player branch.
- **UX-3 dismiss**: CLEAN.  Dismiss handler is synchronous on the JS
  event loop; the read+write of `last.ts` cannot interleave with a
  new digest arrival.  Newer-digest re-flip pinned in Scenario 3.
- **FC-2 narrowing (FIELD_NAME_KEYS)**: CLEAN.  "Tax" rename
  survives (Scenario 7 + format-stability:763).  Vocabulary covers
  every observed v:1-author choice; see Q4 for plausible-but-
  unrecommended additions.
- **FC-2 parity (bond-ratify + pc-create)**: CLEAN.  Both scrubbers
  now run `payloadFieldNameKeyNamesDmField` BEFORE the by-name strip.
  Run-#14 false-positive on "Tax" → run-#15 narrowing keeps Tax safe
  while still catching v:2 path:dmNotes (pinned).
- **`loadedExtraFields` cross-campaign clear**: CLEAN.  Line 1532
  closes the slug-mismatch hole the v2 named.  `leaveSession` (6788)
  still covers home-route + clean shutdown.
- **UX-5 digest draft persistence**: P2 hazard — see H-2 (cross-
  campaign visual-leak via `updated()` early-return).  Per-helper
  storage layer + Scenarios 4-6 are clean.
- **Send button regression**: not re-audited in depth (visual-only,
  no firewall surface).  Trust the regression test.
- **`.card` migration**: out of scope for adversarial; no firewall
  surface.

## Top 3 hazards (ranked)

### H-1 (P3, playtest-safe) — `playerLastSeenDigestTsInMemory` carries across campaigns

`quire-app.ts:2241, 2264, 2293`.  The instance field is `0` on mount
and only ever increased via `setPlayerLastSeenDigestTs`.  It is
NEVER reset on `navigateToRoute` cross-campaign or on
`leaveSession`.  Walk: player dismisses campaign A's digest with
`ts=T_A`.  In-memory mirror = T_A.  Player navigates to campaign B
whose latest digest has `ts=T_B < T_A` (B's last play was earlier
than A's).  `playerHasUnseenDigest` reads
`Math.max(persisted_B, T_A) = T_A`; `T_B > T_A` is false → no
auto-flip → player never sees campaign B's recap.  Not a leak (no
DM-only content); UX correctness.  Playtest 1 is a single campaign,
so this won't trigger.  P3.

**Fix shape**: reset `playerLastSeenDigestTsInMemory = 0` in the
slug-mismatch branch of `navigateToRoute` (next to the
`loadedExtraFields = undefined` line at 1532) and in `leaveSession`.
Two-line additive.

### H-2 (P2) — Cross-campaign digest-draft visual leak

`src/ui/regions/session-digest.ts:172-183`.  `loadPersistedDraft`
early-returns `if (this.draft.length > 0)`.  Walk: DM types "spoiler-
adjacent recap" in campaign A's editor.  Host re-renders with
`campaignSlug='B-slug'`.  `updated()` fires, calls
`loadPersistedDraft()`, which early-returns because `this.draft`
still holds campaign A's text.  Now the campaign-A draft is visible
on the campaign-B editor surface AND the next `@input` would persist
it under campaign B's storage key.  Threat-model-wise this is on-DM-
device only (no peer leak), but a DM running two campaigns from one
browser could cross-contaminate drafts and accidentally Save A's
recap into B.  Mock-10 Scenario 6 only covers the empty-→-loaded
case, not the dirty-→-switched case.

**Fix shape**: in `updated()`, on `campaignSlug` change, FIRST clear
`this.draft = ''; this.generatedByResponseId = undefined;` THEN call
`loadPersistedDraft()`.  Cancel any pending `digestDraftSaveTimer`
so the in-flight save doesn't write campaign A's text under
campaign B's key.

### H-3 (P3, defense-in-depth) — Scrubber rename parity is incomplete for focus-grant + pc-retire/pc-archive

`persistence.ts:339, 359, 360`.  The FC-2 parity covers pc-edit +
bond-ratify + pc-create (which all carry character-field-vocabulary
DM fields → `FIELD_NAME_KEYS` × `isDmOnlyCharacterFieldPath` is the
right shape).  `focus-grant` strips `boundFor`/`notes` by-name;
`pc-retire`/`pc-archive` strip `reason`/`scene` by-name.  A v:2
author renaming `boundFor` → `private` or `scene` → `path` would
bypass the by-name strip.  The DM-only vocabulary here is NOT in
DM_ONLY_CHARACTER_FIELDS so the FIELD_NAME_KEYS scan doesn't catch
it.  Per DEC-031's contract-level prohibition this is contract-
covered; defense-in-depth is the missing layer.

**Fix shape (post-playtest)**: introduce kind-specific vocabularies
(FOCUS_DM_ONLY_FIELDS, RETIRE_DM_ONLY_FIELDS) and a generalized
`payloadFieldNameKeyNamesField(p, vocab)`.  NOT ship-blocking — v:2
shapes don't exist today.  Track post-playtest.

## Q1-Q10 answers

**Q1 (CO-DM leak via player branch).**  No.  Co-DM authority adds the
peer to `coordHolders` (state.ts:1999, never cleared per the "ever-
expressed" contract at state.ts:425-428).  `!coordHolders.has(peerId)`
correctly excludes any peer who has ever held coord.  A bound-
following peer who has not yet expressed coord IS a player by the
gate's definition; on flip they get `filteredShared` (DM-only fields
already stripped) and the non-coord branch at quire-app.ts:2353-2398.
No leak.

**Q2 (in-memory mirror cross-campaign).**  YES — H-1 above.  P3
(no disclosure; UX-correctness).  Won't fire in playtest 1.

**Q3 (dismiss vs new-digest race).**  No race.  `dismissPlayerDigestRecap`
reads `digests[length-1]` then synchronously calls
`setPlayerLastSeenDigestTs(last.ts)`.  Single JS event loop; no new
event can interleave.  If a NEWER digest arrives later, its `ts >
seen-marker` triggers the next flip (pinned by Scenario 3).
Subtle: `setPlayerLastSeenDigestTs` writes localStorage
UNCONDITIONALLY (not Math.max), so a stale value written by a
dismiss in tab A after tab B already advanced the marker would
regress localStorage.  Multi-tab corner; flag for post-playtest.

**Q4 (FIELD_NAME_KEYS completeness).**  `field/path/target/key/attr/prop`
covers the common JS-author vocabulary.  Plausible additions a v:2
author might pick: `selector`, `slot`, `member`, `route`.  `id`
typically NAMES a record, not a field — skip.  `name` collides with
the legitimate rename payload — DO NOT add (would re-introduce the
"Tax" false-positive).  Per DEC-031 contract-only, vocabulary is
belt-not-suspenders; recommend NOT extending until a v:2 candidate
emerges.

**Q5 (player named literally "dmNotes").**  Walk: `field:'name',
value:'dmNotes'`.  `p.field === 'name'` → not DM-only.
`FIELD_NAME_KEYS` scan: `field, path, target, key, attr, prop` →
only `field='name'` is present; `'name'` not in DM_ONLY_CHARACTER_FIELDS.
Returns false.  Event SURVIVES.  Player's display name is the string
"dmNotes".  No leak.  Recommend: keep current behavior; do NOT
extend to value-scan.  Add a test pinning `value:'dmNotes'`
SURVIVES (mirrors the "Tax" pin).

**Q6 (more scrubbers needing parity).**  See H-3.  `focus-grant`,
`pc-retire`, `pc-archive`, `map-blob-add`, `map-blob-move`.  None
ship-blocking; all v:2-only hypotheticals; DEC-031 contract-covers.

**Q7 (digest draft leak across PCs).**  Keying by `campaignSlug`
only is correct: one digest-in-progress per campaign by design.
Two unsaved drafts in the same campaign would overwrite — but Save
clears + reload re-loads — so this is "single draft at a time" by
construction.  Acceptable.

**Q8 (save fails).**  `handleSave` only clears state + persisted
entry when `onSave` returns true (line 399).  Fails-correctly:
draft survives in state AND in localStorage.  Verified.

**Q9 (campaign-slug change leaves stale draft on screen).**  YES —
H-2 above.  P2.  Recommend fixing before playtest IF the test table
runs multiple campaigns in one browser; otherwise post-playtest.

**Q10 (anti-regression vs silent revert).**
- UX-3 routing: Scenarios 1+2+3 lock production-path semantics
  (NO test-side appMode mutation).  GOOD.
- FC-2 narrowing: format-stability:763 ("Tax" SURVIVES) + format-
  stability:795/824 (bond-ratify/pc-create v:2 rename DROPS).  GOOD.
  Missing: a `value:'dmNotes'` SURVIVAL pin (Q5).
- UX-5 persistence: Scenarios 4-6 lock helpers + connect-load.
  Missing: a campaign-switch dirty-draft pin (H-2 above).
- loadedExtraFields: format-stability has the INV-EXTRA-LOOP pin;
  recommend a per-`navigateToRoute(slug-B)` cross-campaign test
  asserting `loadedExtraFields === undefined` post-navigation.

## Regression-pin recommendations

- **FC-2 Q5 pin**: `pc-edit { field:'name', value:'dmNotes' }`
  SURVIVES player projection.  Companion to the "Tax" pin.
- **UX-5 H-2 pin**: mount `<session-digest campaignSlug="A">`, type
  text, change `.campaignSlug = "B"`, assert textarea.value === ''
  AND `localStorage.getItem(key-for-B)` does NOT contain "A draft".
- **UX-3 H-1 pin** (post-playtest): switch campaigns, assert
  `playerLastSeenDigestTsInMemory === 0` and the campaign-B digest
  triggers an auto-flip even when its ts < the campaign-A marker.
- **FC-2 parity (defense-in-depth)** (post-playtest): walk
  every entry in `PER_KIND_SCRUBBERS` × a "v:2 rename of the
  by-name target" — pins H-3 for the scrubbers that don't yet
  defend in depth.

---

**GO/NO-GO**: GO for playtest 1.  All hazards found are P2/P3 with
no disclosure risk under the locked threat model (DEC-023).  H-2
(cross-campaign visual leak in digest draft) is the highest-value
fix before playtest if multi-campaign-per-browser is in the test
table's workflow; if playtest 1 is single-campaign, defer.

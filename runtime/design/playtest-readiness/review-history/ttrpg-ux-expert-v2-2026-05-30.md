# TTRPG/UX expert v2 report — 2026-05-30

## Foundation pass — chargen + writeup + player-bridge grade

**B-minus.** UX-1 and UX-2 are clean closures with the right surface,
the right semantics, the right cap-mirroring. UX-3 mounts a recap
card on a surface NO player reaches in production — closure is
test-true but user-story false; this single defect drops the grade
from B-plus to B-minus.

## Closure verification (UX-1, UX-2, UX-3)

**UX-1 (OP-045 rename) — CLOSED.** Engine branches in
`src/character-edits.ts:257-286` with the correct caps; the
`Identity` block in `src/ui/regions/dm-pc-detail.ts:392-499` mounts
above the DM details; host wiring at `src/quire-app.ts:8044-8053`
emits `pc-edit` through `submitPcEdit`; the player rail's name
flows from `effectiveCharacter` (`quire-app.ts:4682,4690`) so a
rename surfaces to the player immediately. Residual edges: (a)
backstory editor opens the FULL backstory inline on the
DM-only surface — visible only to the DM, but a 6-row textarea
of a player-written paragraph in the DM-details card feels off;
recommend a 2-row collapsed preview that expands on click.
(b) `<dm-pc-detail>` only renders for the coord; a co-DM in
`bound-following` mode sees nothing here — fine for playtest 1.

**UX-2 (FINDING-E digest-in-AI-context) — CLOSED.**
`buildCampaignContext` (`src/ai/campaign-context.ts:213-240`)
synthesizes a `# Previously` block from `priorDigests`; caller at
`src/quire-app.ts:6952-6967` reads from `filteredShared.sessionDigests`
(firewall-correct). Placement is APPENDED (not inserted between
campaign.json and per-episode scenes as the comment suggests) — fine
in practice, the system prompt drives priority. Residual: the
block emits a synthetic path `session-digests/previously.md` so the
`wrapUntrusted` source-attr is honest; verified.

**UX-3 (player "Previously" surface) — NOT CLOSED.**
`renderSessionOpenStage` (`quire-app.ts:2218-2247`) renders the
recap card only when `appMode === 'session-open'`. The auto-trigger
at `quire-app.ts:1306-1314` is gated on `coordHolders.has(peerId)`
— **player viewers never flip to session-open mode**. The
`Open session…` launcher at `quire-app.ts:2185-2201` is gated on
`isCoordinator()`. The mock-09 Scenario-4 assertion only passes
because the test FORCES `player.appMode = 'session-open'`
(`persistence.simulation-09-ui-findability.test.ts:142`). At the
real table, a player joining session 2 sees the in-session
cockpit with NO recap — the exact gap v1 flagged. The card
exists, the routing does not.

## Top 3 next changes (ranked)

1. **`src/quire-app.ts:1297-1315` — player auto-open trigger.**
   Drop the `coordHolders.has(peerId)` clause for an
   ADDITIONAL player-side flip ONLY when `sessionDigests` newer
   than the player's local "last-seen" marker exist. Auto-flip
   for the player, with a Dismiss → in-session button on the
   recap card. Without this, UX-3 ships dead code. Size S
   (~15 LOC + a per-peer dismissed-digest-id in localStorage).

2. **`src/quire-app.ts:2237` — render markdown, not `<pre>`.**
   The recap body is currently a `<pre>` block; an
   AI-generated digest is markdown (headings, lists, bold).
   Use the existing markdown renderer the chat / session-digest
   editor uses. The "show summary, expand for detail" pattern
   is overkill for ~600-word digests; render markdown cleanly
   and let the card scroll. Size S (~8 LOC).

3. **`src/ui/regions/dm-pc-detail.ts:415-421` — backstory
   row collapse.** The full backstory inline in the
   `Identity` block is visually heavy in a DM-details card
   that also shows magic-phase + tax + drift. Render a 2-line
   collapsed preview with "Edit" expanding the textarea.
   Same pattern as the existing rename-row, just default-
   collapsed. Size XS.

## Q1-Q10 answers

**Q1.** Rename flow feels right end-to-end. DM clicks Edit →
Identity row opens → types "Theo" → Save fires `submitPcEdit` →
`pc-edit` event materializes → `effectiveCharacter` rebuilds →
both DM details + player rail render "Theo" on next paint. No
firewall edge: backstory editor IS on a DM-only surface, but
the content is player-authored material the player put there;
showing it to the DM in their own private card is not a
disclosure. The visual heaviness IS a problem (see Top-3 #3).

**Q2.** AI feels grounded. The `# Previously` block leads with
a clear framing line ("These are the saved session recaps from
prior play, in chronological order"), separates multiple digests
with `---`. Placement is END of files array; campaign.json
remains first. Per the system-prompt's locality bias this is
fine. If `sessionDigests.length > 5` the digest mass exceeds
campaign.json — that's a future scaling problem, not playtest 1.

**Q3.** Player path: DM auto-trigger fires; player STAYS in
`in-session`. Player sees no recap at all. The `<pre>` rendering
question is moot because nobody reaches the surface (see Top-3
#1, #2). Even if reachable, raw markdown in `<pre>` is wrong —
the digest is markdown by contract.

**Q4.** Firewall holds *as the digest is authored*. The
`SESSION_DIGEST_SYSTEM_PROMPT` enforces past-tense + no-spoilers
during AI drafting, and the DM is the human gate. **Engine
guard NOT needed** — adding one would create the silent-player
firewall violation (warning the player that they hit a spoiler
IS the spoiler). DM is the gate; this is the locked design.
Doc'd as a DM training point in the digest editor's helper
copy.

**Q5.** `dm-pc-detail` is the right DM surface. PC rename on
the player's rail is NOT needed for playtest 1 — the player
asks the DM verbally; DM types it. The peer-rename
(`player-aside`) is the unambiguous display-name affordance.
Adding a player-side PC rename would muddy the locked authorship
model (DM owns ratified state).

**Q6.** Mock-09 covers reachability of the LANDING and the
rendering of the recap card given a forced appMode. It DOES
NOT cover the rename row's full interaction (open → type →
save → emit). Add: a `pc-edit` event assertion after clicking
the dm-pc-detail Identity Edit → Save sequence. Cheap; mirrors
chargen-roundtrip's LOCKED-BROKEN-flip pattern.

**Q7.** Q&A-only is sufficient for playtest 1 if all three
players opt in. Recommend the table is told this in the DM
invite copy ("we're playing the Q&A path; pre-gen + free-write
land later"). The "running late, give me a sheet" player is
real; for THIS playtest the DM hand-rolls a Q&A walkthrough
for them at the table. Defer is acceptable; surface in the
recently-played list's helper text.

**Q8.** Priorities for run #16:
- **UX-5 (drafts in @state):** P1. A 3-hour session whose DM
  loses their digest draft on tab close is a real playtest
  failure. Ship before playtest.
- **UX-6 (`dmGuidance` UI):** P2. Nice-to-have; not blocking.
- **UX-7 (intent-against-pressure visual weight):** P2. The
  magic-realization arc depends on this answer being authored
  with care; visual lift helps but the locked source-of-truth
  IS the answer text, which works today.

**Q9.** **NOT GREEN.** Two more runs at minimum: #16 must
close the UX-3 player reachability defect, UX-5 digest draft
persistence, and the mock-09 rename interaction assertion.
That leaves one contingency run. Hard cap holds IF the lead
takes the Top-3 changes above and DOESN'T re-spawn a full
consultant round on chrome polish. Skip the chrome — ship
the surfaces.

**Q10.** Mock-10 (digest draft round-trip via reload) is still
needed — covers UX-5 the moment the lead ships it. Mock-11
(player projection of recap during session-open) — RESCOPE.
The real test now is: "player joins session 2, sees recap
WITHOUT manual appMode forcing." Add a `expect(player.appMode)
.toBe('session-open')` after the auto-trigger fires for a
non-coord viewer.

## Mock campaign recommendations 10-11 (updated)

- **mock-10:** session-digest draft typed → page reload →
  draft preserved (locks UX-5 closure).
- **mock-11:** session 2 begins with `sessionDigests.length > 0`;
  player peer joins; assert `player.appMode === 'session-open'`
  WITHOUT test-side mutation; assert recap card renders
  markdown formatted (not `<pre>` text).

## Estimated runs to playtest GREEN

**Two more runs (#16 + #17).** Run #16: ship Top-3 + UX-5 +
mock-10/11. Run #17: contingency for whatever the next
consultant round finds + final sweep. The hard cap at #16 is
TIGHT but achievable IF chrome polish is skipped and the lead
ships only the routing + persistence work. If chrome creeps
back in, escalate to the human at end of #16.

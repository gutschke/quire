# Quire Playtest Handoff — Session 1

**Owner:** Playtest-Readiness Program Lead
**Status:** PLAYTEST GREEN — ready for the first real human session
**Run that closed the gate:** #16 (2026-05-30)
**Patches since handoff:** Run #17 (2026-05-30) — see §0 below
**Companion docs:** `playtest-readiness-plan.md`,
`status.md`, `../save-restore-program/decisions.md`,
`../save-restore-program/open-problems.md`

---

## 0. Patches since handoff (run #17)

The product owner ran a dry-run on 2026-05-30 and surfaced two
P0 playtest blockers.  Both fixed in run #17 before any real
table sat down.

### P0-1 — "Start fresh" was a misclick away from data loss + didn't actually clear state

- **What was happening:** the resume-prompt "Start fresh"
  button fired a destructive (silently broken) clear with NO
  confirmation, and the clear was a single line that only
  dismissed the staged prompt object — leaving the localStorage
  autosave, WebRTC peer roster, and chargen drafts intact.  After
  "Start fresh," the next reload re-staged the same prompt and
  clicking Resume restored the prior session (including any PC
  the DM thought they'd discarded and any stale DM-peer roster
  entries).
- **What we fixed:**
  1. Both "Start fresh" affordances (resume prompt + cross-device
     probe) now open the new `<start-fresh-confirm-dialog>`
     before doing anything destructive (DEC-037).  Cancel is
     default-focused; the modal body names what will be lost
     (event count from the staged autosave) and what will NOT be
     touched (cloud backups).
  2. The actual clear is now an orchestrated `startFreshFor-
     Campaign(...)` that fires `announceLeaveAndExit()` (so other
     peers see this DM drop off the roster), clears the
     `quire.save.<owner>-<repo>` localStorage key, wipes chargen
     drafts for all slots, drops staged prompts + `loadedExtra-
     Fields`, and resets the cross-device probe guard (DEC-036).
- **Regression carriers:** mock campaign 11
  (`src/persistence.simulation-11-start-fresh.test.ts`) walks
  the production click path through all six clear categories
  + cross-device "safe" variant.
- **Where to read more:** DEC-036 + DEC-037 in `../save-
  restore-program/decisions.md`; diagnosis walkthrough at
  `start-fresh-diagnosis-2026-05-30.md`.

### P0-2 — Retire dialog was a "white frame in the middle of the screen"

- **What was happening:** clicking Retire on a bound PC opened
  the dialog but the DM couldn't interact with anything — just
  a white frame with no visible buttons.  Root cause: the
  shared `<quire-modal>` primitive rendered `<dialog><slot></
  slot></dialog>` into LIGHT DOM, but `<slot>` only distributes
  in shadow DOM.  The host's children (the form + buttons)
  rendered as SIBLINGS of the empty `<dialog>`.
  `showModal()` promoted the empty dialog into the top layer;
  the form stayed in the normal flow, hidden behind the
  backdrop.  All four chargen-dm-review modals (review / edit
  / retire / revise) shared the bug.
- **What we fixed:** rewrote `<quire-modal>` so it programmatically
  wraps the host's existing (and dynamically-added) children
  inside a real `<dialog>` element, mirroring the host's `class`
  onto the dialog so per-region CSS still styles the frame
  (DEC-038).  Zero caller-site changes required.
- **Regression carriers:** new assertions in
  `src/ui/components/quire-modal.test.ts` (host children land
  INSIDE the `<dialog>`; class is mirrored; dynamic children
  re-parent) + new chargen-dm-review tests that pin the retire
  dialog's controls inside the `<dialog>` and the commit click
  end-to-end.

### Test count

Run #16 PLAYTEST GREEN: 3045 + 2 skipped = 3047 across 154 files.
Run #17 patches: 3069 + 2 skipped = 3071 across 156 files.
Delta: **+24 net** (mock-11 + quire-modal regressions + retire
dialog end-to-end + Start fresh diagnostic + cross-device probe
revisions).

### What this means for the playtest

Both bugs were blockers — fixed.  The table can sit down.  The
patches are entirely additive on top of the run #16 GREEN
state; the rest of the GREEN inventory below stands unchanged.
The lessons captured in `lessons-learned.md` (LL-2 + new LL-3)
flag the test gap that allowed both bugs through PLAYTEST GREEN
in the first place: unit tests that assert a sliver of behavior
smaller than what the user sees.

---

This is the document a DM, a co-DM, and the human running
the test table read **before** running session 1.  It exists
to (a) name what the build can be trusted with, (b) name
what's not finished so the table doesn't trip on it, and
(c) walk the rituals before / during / after the session.

---

## 1. What's playtest-ready

Both run-#16 consultants (adversarial v3 + TTRPG/UX v3)
returned **GO for playtest 1**.  Verified capabilities the
test table can rely on:

- **Cold-walk to playable session within 30 minutes.**
  Three players + a DM open the campaign URL; chargen
  (Q&A path); ratify; first scene.  No engineering help
  required.
- **Spoiler firewall holds in every panel.**  Chat, scene
  reveals, AI panel, PC sheet, map, session digest.  The
  silent-player firewall is the load-bearing one — players
  are NEVER warned about a spoiler they hit.
- **In-session state propagates correctly.**  Harm, stress,
  marks, advancement-ready, focus grants, scene reveals all
  sync to every peer.
- **AI assistance works.**  The DM can summon AI suggestions
  that read campaign + PC + episode context.  AI write API
  proposes state changes with the DM-accept gate
  (caster-state-set, apply-all-with-undo, hard-gates per
  DEC-XXX).
- **Save format is forward-compatible.**  No hidden
  skeletons.  Extensible.  No conversion tools required for
  future-runtime opens of today's saves (DEC-030 +
  DEC-031 + DEC-032 + format-stability.md).
- **DM can save the session locally + push to a connected
  folder.**  M6a-FS playable release GREEN.  Restore from
  cloud on a SECOND machine works (mock-campaign 01 + 05
  pin this).
- **DM write-up phase works.**  After the session, the DM
  authors a digest (free-form or AI-drafted); the digest
  lands on the canonical event log, survives save/restore,
  and is available as AI context next session (mock-08 +
  mock-10).
- **Player "Previously, at the table…" surface auto-fires.**
  On next session-open, players who haven't dismissed the
  digest see it rendered as markdown with a "Continue"
  button.  Dismissed once = stays dismissed.  A newer
  digest re-fires (mock-10 Scenarios 1-3).
- **Mid-chargen + post-ratify rename works** for name,
  pronouns, backstory (OP-045 closed, run #14).
- **3045 passing tests + 154 test files.**  Includes 10
  mock campaigns covering chargen spoilers, network
  partitions, cloud-push during active play, co-DM
  transitions, game-mechanic edges, DM write-up phase,
  UI findability, and routing + drafts.

Both consultants signed off explicitly:

- **Adversarial v3 (`review-history/adversarial-run15-
  fixes-2026-05-30.md`):** "GO for playtest 1, all critical
  fixes verified."
- **TTRPG/UX v3 (`review-history/ttrpg-ux-expert-v3-
  2026-05-30.md`):** "GO.  Playtest GREEN."

---

## 2. Known issues

These are real, documented, and intentionally deferred.
The table will not hit any of them on the happy path; the
DM should know they exist so an unexpected surface doesn't
look like an unknown bug.

### Chargen path coverage (P1, doc-only)

- **Q&A is the only fully-tested chargen path.**  Free-write
  and pre-gen are placeholders.  The DM's invite copy MUST
  say "We're playing the Q&A character creation path"
  (see §3 below for the recommended invite wording).
- Reference: UX-4 in `playtest-readiness-plan.md` Appendix
  A.

### dmGuidance field exists but no UI (P2, post-playtest)

- The digest-prompt schema has a `dmGuidance` field
  (`session-digest-prompt.ts:58`) that would let the DM
  steer an AI-drafted recap.  No textarea wired today.
- **Workaround:** DM edits the AI draft directly after
  generation.
- Reference: TTRPG/UX v3 next-change #2.

### Backstory editor is visually heavy on DM card (P2, post-playtest)

- `dm-pc-detail.ts:415-421` renders the full inline editor.
  Future polish: collapse to a 2-line preview.
- **Workaround:** None needed; just visual density.
- Reference: TTRPG/UX v3 next-change #3.

### FC-2 defense-in-depth incomplete for focus-grant / pc-retire / map-blob (P3, post-playtest)

- The run-#15 string-scan defense protects pc-edit,
  bond-ratify, pc-create against future v:2 rename bypasses.
  focus-grant, pc-retire/archive, and map-blob-add/move
  scrubbers strip DM-only sub-fields by NAME and remain at
  contract-only protection (DEC-031 §1).
- **No live hazard:** v:2 shapes don't exist; the contract
  prohibition + materializer silent-no-op are the first two
  defenses.
- Filed as OP-046.

### Anthropic prompt cache_control not yet applied (P1, post-playtest)

- AI calls work; the cache marker is not yet wired on the
  system+tools prefix.  Real money/latency impact at scale;
  not a correctness or firewall issue.
- Reference: AI-2 in `playtest-readiness-plan.md` Appendix A.

### Live PC harm/stress not in AI context (P1, post-playtest)

- Documented v1.1 work per the auto-memory.  AI sees the
  PC's persisted state but not the live in-session deltas
  before they materialize.
- Reference: AI-3 in `playtest-readiness-plan.md` Appendix A.

### AI panel undo window in-memory only (P2, post-playtest)

- A tab close mid-AI-write loses the undo window.
- **Workaround:** complete the accept-or-reject decision in
  the same tab session.
- Reference: AI-4.

### Co-DM ratify-race feedback toast (low-pri)

- If two DMs ratify the same PC concurrently, the losing
  DM does not see explicit feedback (the state still
  resolves correctly — last-write-wins).
- **Workaround:** Co-DM workflow handoff is typically
  explicit.
- Tracking task #416.

---

## 3. Setup checklist (before the table arrives)

The DM walks this list once.

### 3.1 Open Quire

- Open the Quire URL (Cloudflare-hosted instance).  No
  install.  Chrome or Edge desktop strongly recommended —
  the cloud-backup path uses the File System Access API
  which is Chromium-desktop-only today.  Safari and Firefox
  will play correctly but will not show the cloud-backup
  affordances; the DM will need to back up the autosaved
  campaign manually if they want a between-session safety
  net.

### 3.2 (Recommended) Connect a folder for cloud backup

- Click into DM operational view → Backups → "Connect a
  folder."  Pick a folder synced by Dropbox, Google Drive,
  iCloud, OneDrive, etc.  This is the M6a-FS path: Quire
  writes `<campaign-slug>.quire-save.json` to the folder;
  the OS-level sync tool replicates it to the cloud.
- Quire NEVER talks to a cloud provider directly on this
  path.  The OAuth Drive path (M6a-OAuth) is gated on
  maintainer registration of the verified Google OAuth app
  — see `maintainer-ops.md`.
- After connecting, the DM can click "Push now" → confirms
  "Pushed N bytes."  Verify in the folder.

### 3.3 Generate invite links for players

- The DM start-hosts the campaign; the pairing code
  appears.  The DM shares the campaign URL (or the
  character-creation invite token) with each player out-
  of-band (Discord, email).
- Each player opens the link, enters their display name,
  and joins.

### 3.4 (Optional) Google Drive / GitHub backup

- Currently gated on the maintainer flipping
  `GOOGLE.status` from `'placeholder'` to `'verified'` in
  `canonical-client-id.ts`.  Until that flip, the OAuth
  path is dormant.  Use the FS-API path (§3.2) for
  playtest 1.
- GitHub publish-and-fork (M6c-A) is post-playtest.

---

## 4. First-session ritual

### 4.1 Chargen FIRST, then play

The DM tells players:

> "We're playing the Q&A character creation path.  You'll
> answer about six short questions; the AI drafts a
> backstory from your voice; I (the DM) ratify before play
> begins.  Expect 10-15 minutes total.  Free-write and
> pre-gen are coming in a later release."

The intent-against-pressure question is mandatory.  The
DM ratifies each PC by clicking "Accept" in the chargen
review surface.

### 4.2 World rules

Reference the existing world docs in
`/home/markus/src/ttrpg/underleaf/world/` and
`/world/rules-and-mechanics/`.  Quire's resolution is
2d6 vs. target; harm + stress + advancement + magic
discovery arc are documented there.  The DM walks the
table through the "civilized players" threat model
explicitly: Quire defends against accidental disclosure
between trusted teammates, NOT against malicious co-
players.

### 4.3 Play

Standard play.  Dice rolls, harm/stress, scene reveals,
AI suggestions, all sync to peers.  The DM is the AI
panel gatekeeper — player-facing AI surfaces hard-code
`includeDmNotes:false` per the spoiler firewall.

---

## 5. End-of-session ritual

### 5.1 DM writes the digest

When the session is winding down, the DM clicks
"Wrap session…" on the DM Aside.  This opens the
session-digest surface.

- Option A: type the recap free-form.
- Option B: click "Generate digest" — the AI drafts a
  recap from the player-visible event log.  Edit freely
  before saving.

**Drafts autosave** (750ms debounced).  A tab close
mid-edit will not lose the recap (mock-10 Scenario 4).

Click "Save digest" when done.  This appends a
`session-digest` event to the canonical log and writes
it into shared state, where players will read it as
"Previously, at the table…" on next session-open.

### 5.2 What the digest does for the next session

- Players see it on session-open (the recap card auto-
  fires; the DM can also re-open it explicitly via the
  "Open session…" launcher).
- The AI sees it as context for next session's AI calls
  (`priorDigests` in `buildCampaignContext`).
- The DM can reference it when authoring the next chapter.

---

## 6. Between sessions

### 6.1 DM pushes the cloud backup

- Open DM operational view → Backups → "Push now."
- Confirms "Pushed N bytes."
- The OS-level sync tool replicates to the cloud.

If running multi-machine: on the second machine, with the
same folder mounted (Dropbox/iCloud/etc), Quire shows the
cross-device probe prompt on cold-load: "[Load it] [Start
fresh]."  Click "Load it" to resume.

### 6.2 DM authors next chapter

The DM writes the next chapter referencing the digest +
the campaign world docs.  The AI can be queried with the
campaign context for chapter-authoring assistance.

### 6.3 Test table returns next week

Same campaign URL.  The "Previously, at the table…"
recap auto-fires for each returning player.  Each
clicks "Continue" once they've read it.

---

## 7. What we want to learn

The human + DM should look for these in playtest 1.  Each
is a question we cannot answer from tests alone.

1. **Did the DM successfully complete the wrap digest?**
   - UX-5 (draft persistence) + FINDING-E (AI context)
     gates depend on this happening.
   - Look for: did the DM click "Wrap session…"?  Did
     they type a draft?  Did they Save?
   - Failure mode to watch: DM forgets the wrap step
     entirely and just closes the tab.

2. **Did players notice the "Previously" surface on
   re-open?**
   - UX-3 routing is the load-bearing run-#15 fix.
   - Look for: did EACH player see the recap card?  Did
     they click "Continue"?
   - Failure mode: card fires but a player misses it
     visually (the dismiss button is small).

3. **Did the rename path work?**
   - OP-045 closed in run #14.  Did any player rename
     their PC during chargen?  Post-ratify?  Did the new
     name persist across save/restore?

4. **Did cloud backup survive the cross-session gap?**
   - DM pushes Saturday night; opens fresh Sunday
     morning + restores; everything intact?
   - Failure mode: orphan-save conflict (mitigated by
     §FS.11 probe + OP-041 fix; should not trigger).

5. **Did the spoiler firewall hold?**
   - The hard question.  The silent-player firewall
     means a player who would otherwise NOTICE a leak
     does NOT get warned.  After the session, ask each
     player **what they saw** in chat / AI panel / PC
     sheet / map / scene reveals / digest.  Cross-check
     against what the DM knew was hidden.
   - Failure mode to watch: ANY player names a spoiler
     element they shouldn't have known.  That's a P0
     finding.

6. **Visual cohesion: did anything feel obviously
   broken or inconsistent?**
   - First-impression bar.  Was the cockpit cohesive?
     Did button styles match?  Was anything jarring?
     (run #15's `.card` migration, button reset fix,
     focus rings landed on the main surfaces.)
   - Failure mode: a player who has used Slack or Linear
     recoils at a specific element.

7. **Did the chargen Q&A path feel like a story-
   collaboration tool or a form?**
   - Per the prime directive: game supports storytelling,
     never dominates.  Did the player feel they were
     authoring their PC?  Or filling out a survey?
   - Failure mode: any player reports "I felt like I was
     answering a quiz."

8. **Did the AI write API's DM-accept gate feel natural?**
   - When the AI proposed state changes (harm, stress,
     advancement-ready), did the DM accept-or-reject in
     a way that didn't break narrative flow?
   - Failure mode: DM ignores the proposals because the
     UI is in the way.

9. **Did co-DM transitions work?** (if running)
   - Mock-campaign 03 pins the engine layer; real-world
     UX is the missing data point.
   - Failure mode: DM hands off coord and the receiving
     DM sees stale state.

10. **What questions did players ask the DM that the UI
    should have answered?**
    - Discoverability is the highest-leverage post-
      playtest signal.  If a player asks "where do I see
      my harm?" — the harm display has a discoverability
      gap.

---

## 8. Bug reporting

When a real bug surfaces during or after playtest:

### Format

File in `/home/markus/src/ttrpg/quire/runtime/design/save-
restore-program/open-problems.md` as a new OP-NNN at the
top.  Use the existing template:

```
## OP-NNN — short title [STATUS] [Pclass]

**Severity:** P0/P1/P2/P3
**Evidence:** What was observed, what the expected
behavior was, repro steps if any.
**Hypothesis:** What's likely happening; fix paths.
**Real-world impact:** Who hits this and how often.
**Owner:** playtest-readiness program lead
**Status:** OPEN
**Cross-cuts:** Any DECs, other OPs, or workstreams it
touches.
```

### Triage at the playtest table

- **Did a player see DM-only content they shouldn't have
  seen?**  P0.  Stop the session.  File the OP.  The
  spoiler firewall is sacred.
- **Did the DM lose data they had written?**  P1.
  Recoverable by reload + retry usually; document the
  repro.
- **Did a player get visibly confused by the UI?**  P1
  if they couldn't recover without DM help; P2 if they
  recovered.
- **Did something look wrong but work?**  P2 visual.
- **Did something the table didn't notice?**  P3 — file
  it when the table tells you about it later.

### What NOT to do

- Do not patch the code at the table.  File the OP,
  finish the session, ship the fix in a later run.
- Do not warn the player about the spoiler.  The
  silent-player firewall says: telling the player they
  hit a spoiler IS itself a spoiler.  Soft-warn the DM
  via the AI semantic pass instead.

---

## 9. Final program-lead notes

- Test count: **3045 passing + 2 skipped = 3047 total**
  across 154 files at run #16's HEAD.
- All 10 mock-campaign simulations green.
- Format stability test pins the save format contract.
- Cross-device probe + cloud backup verified through
  mock-campaign 05 + 07.
- Chargen round-trip + Q&A path verified through
  mock-campaign 04 + 08 + chargen-roundtrip suite.

The build is ready.  The table is the next signal.

— Run #16 Program Lead, 2026-05-30

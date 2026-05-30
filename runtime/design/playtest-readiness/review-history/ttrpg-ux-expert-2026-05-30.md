# TTRPG/UX expert report — chargen + DM writeup — 2026-05-30

## Top 3 ruin-the-playtest failure modes (ranked)

1. **Post-accept rename/pronouns/backstory edits silently no-op** —
   `src/character-edits.ts:103-244` — fix size **S** (~30 LOC: add
   three string branches with caps from `state.ts:1348-1353`). This is
   OP-045. The player asks "can I be Theo not Theodore?"; DM clicks
   the only obvious surface (pre-accept inline-edit at
   `chargen-dm-review.ts:1293`) — but it's gated on
   `!acceptedSlots.has(slot)`. Result after ratify: nothing renders an
   edit, and even if a host wires `pc-edit` field:name, the materialize
   path drops it. Worst kind of bug — looks like it worked.
2. **Digest never reaches the AI panel next week** — FINDING-E,
   confirmed: `src/ai/campaign-context.ts:116-194` builds context from
   campaign files + PC/NPC; `sessionDigests` is read ONLY by
   `diff-proposal-prompt.ts:78` (NPC-update flow). The DM opens AI
   panel next session, types "what happened with Iris last week?" —
   AI has nothing. Fix size **M**: thread `lastDigestMarkdown` from
   `v.filteredShared.sessionDigests` into `buildCampaignContext`
   inputs, render as `# Previously` block. Mirror the
   session-digest-prompt's `priorDigestMarkdown` pattern.
3. **Players have no "what happened last time" surface** —
   `quire-app.ts:2172-2188` gates `Open session…` on
   `isCoordinator()`, and `renderSessionOpenStage` returns a
   "DM is re-orienting" placeholder for players. The mock-08 verifies
   the digest is in the player projection but no PLAYER UI mounts
   `<session-digest>` or surfaces `priorDigests`. Players arrive
   session 2 with zero context. Fix size **M**: add a read-only
   prior-digest card to the player landing/rail when
   `sessionDigests.length > 0`.

## Q1-Q11 answers

### Q1 — Three paths under load
Free-write + pre-gen UIs are placeholders (`character-creation.ts:478-491`:
"input UI lands in a later commit"). Only Q&A works end-to-end. A
mixed-path table CANNOT happen today. DM sees only ratify cards
(`chargen-dm-review.ts:246`); no "who's still answering" telemetry —
DM cannot tell who's stuck. **Lock**: assert each path produces a
ratify card with the path label.

### Q2 — Surgical edits work
- **Pre-accept**: name + pronouns inline (`chargen-dm-review.ts:1293`);
  backstory only via "Review backstory + answers" modal or `Re-sync`.
  No backstory header field.
- **Post-accept**: NO surface for any of the three. `dm-pc-detail.ts`
  shows no name/pronouns/backstory editor (verified via grep). The
  player-aside "rename" is the PEER display name, not the PC
  (`player-aside.ts:26-63`). This is the OP-045 trap doubled.
**Lock**: `applyCharacterEdits(r, { name: 'X' }).name === 'X'`.

### Q3 — Mid-chargen edits survive save/restore
Beyond the locked round-trip cases: **(a)** pronoun-patched backstory
(`patchInPlace`, controller:740) — round-trip the substituted text
without verb-agreement hint regressing. **(b)** Edit + reload mid-modal
in the spoiler-rejected `renderEditDialog` (`chargen-dm-review.ts:1378`):
`editDraftName`/`editDraftBackstory` live in `@state`, NOT autosaved —
tab close loses the draft silently. **(c)** Q&A answer typed at T1,
re-emit `chargen-pack` at T2 — verify last-write semantics. **Lock**:
"draft in spoiler edit dialog flushed to chargen-persistence before
event emit."

### Q4 — Intention-against-pressure question
Lives as `intent-moment` (required short-answer) +
`intent-horizon` (required MC) in `underleaf/campaign.json`. Renders
in `character-creation.ts:520-622` as one item in an ordered list
with `*` marker — no visual weight that signals "this one matters
most." It's the magic-realization arc's source-of-truth. Firewall:
yes — DM sees raw answers via `chargen-dm-review` `answersLookup`;
player only sees their own input. **Lock**: assert `intent-moment`
renders with `required: true`. **Gap (S)**: lift it visually
(separate heading, longer textarea hint). Don't add player-facing
"this is special" copy — that frames magic.

### Q5 — AI assistance during chargen
DM sees raw answers (`answersLookup`) + AI draft + drift banner
(`chargen-dm-review.ts:1900-2000`). Player sees AI authorship via
`SynthesizeBackstoryResult.name` rendering — they see the AI's prose
came back, but there's NO explicit "AI drafted this" badge in the
player-side `<character-creation>` flow. The player-facing chargen
is async/offline mostly; AI runs DM-side. Authorship chain visible
to DM, not player. Per memory `chargen_authorship`: that's correct —
player owns voice, AI owns prose; the player never sees their voice
overwritten. **Lock**: assert DM sees both `answersLookup(slot)`
result AND `synthResults.get(slot).response.backstory`.

### Q6 — End-of-session moment
DM clicks `Wrap session…` (rendered in cockpit, lazy-loads chunk) →
`appMode='session-wrap'` → `<wrap-stepper>` (`quire-app.ts:2498`)
with three steps: marks → digest → diff-review. Players see
`renderSessionWrapMarks` "Session wrap is DM-only" placeholder
(`quire-app.ts:2425-2431`). Good for firewall. AI assist: digest
step has `Generate digest` button → host's `generateSessionDigest`
calls broker with allowlisted player-visible kinds
(`session-digest-prompt.ts:269`). Draft lives local until Save —
correct firewall. **Concern**: 3-hour session, DM is tired, draft
held only in `@state` (`session-digest.ts:107`) — accidental
navigation away loses everything. **Lock**: assert digest draft
survives a re-render via autosave persistence, not just local state.

### Q7 — Digest as next-session context
Digest reaches NPC `diff-proposal-prompt` only. **NOT** wired into
the general AI panel context (`campaign-context.ts` does not read
`sessionDigests`). FINDING-E from mock-08 confirmed. This is the
human's literal concern ("help guide authoring the next chapter") —
today, it does not. **Lock**: `buildCampaignContext` includes the
latest digest markdown in a `# Previously` block, asserted by
fixture.

### Q8 — Digest authorship division
DM sole authorship (gated coord-only at `applySessionDigestEvent`).
AI suggests, DM edits, DM saves. Players cannot contribute. This is
intentional per silent-player-firewall: a player contribution to the
recap could leak that they noticed something the DM ran as a hidden
beat. KEEP. The DM `dmGuidance` field exists in
`session-digest-prompt.ts:58` but no UI surfaces it
(`session-digest.ts` editor only takes the final draft). **Gap
(S)**: an optional `dmGuidance` textarea before Generate would let
the DM aim the recap.

### Q9 — Save → restore → digest survives
mock-08 covers: round-trip; player visibility; co-DM yield; future
field; invalid input rejection; partition. **Missing edges**: (a)
digest authored MID-EDIT then page-reload — `@state` draft is lost
(see Q6). (b) Two co-DMs hit Generate simultaneously across a
partition — both `session-digest` events land on heal; players see
two recaps. (c) Digest exceeds 8000-char schema cap
(`session-digest-prompt.ts:243`) but under engine 20000 — silent
truncation? (d) Cloud-folder write of the digest event under FS-API
quota pressure.

### Q10 — First-impression after digest
Next session, DM-side: auto-open trigger at `quire-app.ts:1294-1303`
flips into session-open mode if `sessionDigests.length >
sessionOpens.length` — strong discoverability. **Player-side: NONE.**
`renderSessionOpenStage` (`quire-app.ts:2206-2216`) shows "DM is
re-orienting" placeholder. Player sees no digest. The digest IS in
their filtered state (`state.sessionDigests`), just no UI surface
reads it for the player. **Gap (M)**: read-only digest card on
player landing/rail when present. This is the literal "bridge to
next session" failing on the player side.

### Q11 — Failure modes ranked
See top of file. All three are P1 for playtest. None require new
mechanics or violate the three locked principles.

## Cross-checks against locked principles

- **Prime-directive**: a player-visible digest is past-tense fiction
  (the `SESSION_DIGEST_SYSTEM_PROMPT` enforces this) — supports
  storytelling, doesn't ground mechanics. PASS.
- **Silent-player firewall**: digest is pre-filtered to player-
  visible kinds; magic-discovery arc explicitly handled in the system
  prompt (`session-digest-prompt.ts:89-94`). PASS. No player-facing
  spoiler warning anywhere in chargen or digest. PASS.
- **Source-of-truth**: every recommendation maps to existing rules.md
  + character-edits.ts + state.ts; no invented mechanics. PASS.

## Brittle-copy radar

`character-creation.ts:521-525` ("Take your time — about 10–15
minutes"), `session-digest.ts:120-122` ("Drafts the campfire recap
…"), `session-wrap-marks.ts:87-91` ("Tick the bullets each PC
earned…"). If any test pins these strings, surface as deliberate
update before copy churn.

## Recommended new mock campaigns

- **mock-09**: post-ratify name/pronouns/backstory edit → reload →
  verify edit applied (will FAIL until OP-045 fix lands).
- **mock-10**: digest draft typed → page-reload → verify draft
  preserved (will FAIL today).
- **mock-11**: player projection at session-open includes the
  prior digest in a player-readable surface (gap-driven test).

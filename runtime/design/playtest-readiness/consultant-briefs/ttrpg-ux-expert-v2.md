# TTRPG/UX expert — v2 brief (run #15)

## ROLE

You are a senior TTRPG / UX expert re-auditing Quire's run #14
chargen, write-up phase, and player session-open changes. Your
run #1 report (2026-05-30) identified 3 top-tier playtest-blocking
failures + 8 follow-ups. The lead shipped UX-1 (OP-045 rename
gap), UX-2 (FINDING-E digest-in-AI-context), and UX-3 (player
"previously" surface) in run #14. Your v2 job is to verify those
fixes actually close the user-story gaps + identify what's left
before playtest.

## MANDATORY READS (in order)

1. Your run #1 report:
   `review-history/ttrpg-ux-expert-2026-05-30.md`.
2. Run #14 triage: `playtest-readiness-plan.md` Appendix A —
   focus on UX-1, UX-2, UX-3 ship status.
3. OP-045 closure: `design/save-restore-program/open-problems.md`
   — read the RESOLVED block.
4. Engine fix: `src/character-edits.ts` — note the new
   name/pronouns/backstory branches.
5. UI fix: `src/ui/regions/dm-pc-detail.ts` — the new
   `renderRenameSection` + `RenamePcCallback` + the host wiring
   in `src/quire-app.ts:renderDmPcDetail` (search for
   `onRenamePc`).
6. AI context fix: `src/ai/campaign-context.ts` — the new
   `priorDigests` parameter + the `# Previously` block synthesis.
7. Player surface fix: `src/quire-app.ts:renderSessionOpenStage`
   non-coord branch — the `.session-open-player-recap` block.
8. Mock-09 (UI findability):
   `src/persistence.simulation-09-ui-findability.test.ts`.
9. Quire/Underleaf world docs:
   `/home/markus/src/ttrpg/underleaf/` — campaign tone.

## SPECIFIC QUESTIONS

1. **OP-045 closure quality.** Walk the post-ratify rename flow:
   the DM clicks "Edit" next to "Name" in the dm-pc-detail Identity
   block, types "Theo", clicks "Save". Does the resulting UX feel
   like the right answer to the player's "can I be Theo not
   Theodore?" ask? Specific: does the DM see the rename's effect
   immediately? Does the player see it on their rail? Any
   firewall edge with the backstory editor showing the FULL
   backstory text on a DM-only surface (`dm-pc-detail`) — is
   that confused with DM-private content?

2. **FINDING-E closure quality.** The DM now types
   "what happened with Iris last week?" in the AI panel.
   `campaign-context.ts:buildCampaignContext` synthesizes a
   `# Previously` block from `state.sessionDigests`. Walk the
   end-user experience: does the AI's answer FEEL grounded in
   last week, or does the AI still feel "blind"? Is the
   `# Previously` block placement (after campaign.json /
   world/overview.md, before episode scenes) right? Or should
   it lead?

3. **Player "Previously" surface quality.** A player joins
   session 2; the DM hasn't yet flipped into session-open
   mode; the player sees… what? Walk the exact path. Then:
   player sees the recap card with the digest body in
   pre-formatted text. Does the rendering serve the player
   (the recap is supposed to RE-ORIENT, not dominate)? Or
   does the FULL digest body overwhelm? Recommend a
   "show summary, expand for detail" pattern if so.

4. **Silent-player firewall in the recap.** The digest IS
   player-visible per existing classification. Verify the
   recap surface NEVER shows `dmGuidance` (it doesn't — the
   field never lands on materialized state). Verify nothing
   in the rendered Markdown reveals a NEXT-WEEK plot detail
   the DM might have written in past-tense ("Mei discovered
   the…"). The system-prompt guards the AI's drafting, but
   if the DM hand-wrote a digest that mentions next week,
   the recap shows it. Is that on the DM (acceptable) or on
   the engine (needs a guard)?

5. **DM-side post-ratify rename — surface placement.** The
   rename UI lives inside `dm-pc-detail` ("DM details — Mei").
   Is that the right surface? Consider the player-aside
   "rename" (which is PEER display name, not PC) — should
   the PC rename surface ALSO appear on the player's own
   rail? Today the player has no canonical PC rename
   affordance.

6. **Mock-09 coverage.** Mock campaign 09 walks landing CTA,
   DM session-open mode, player recap card with + without
   digest, button hidden check. What's MISSING? Specifically:
   the OP-045 rename row interaction (the test asserts the
   row renders but not the full open → type → save → callback
   chain). Should that be added?

7. **Remaining UX-4 (free-write + pre-gen placeholders).** The
   triage punted this as M8-track. For playtest 1, is Q&A-only
   chargen sufficient (Mei + Anya + Iris all pick Q&A)? Or
   does the table need pre-gen at least for the "running late,
   give me a sheet"-shaped player? Recommend.

8. **Chargen polish gaps your v1 mentioned but the lead didn't
   close.** Drafts surviving page-reload (UX-5),
   `dmGuidance` UI (UX-6), intent-against-pressure visual
   weight (UX-7). Prioritize for run #16.

9. **Playtest GREEN gate.** Given run #14's shipped fixes and
   the remaining work, your honest estimate: how many more
   consultant rounds + run-iterations until the table can
   actually play? The user's discipline is hard-cap at run #16.

10. **Recommended mock campaigns 10-11.** Your v1 suggested
    these. Are they still needed post-#14 fixes? Adjust the
    scope.

## OUTPUT FORMAT

```
# TTRPG/UX expert v2 report — 2026-MM-DD

## Foundation pass — chargen + writeup + player-bridge grade
[A/B/C/D + 2-sentence why]

## Closure verification (UX-1, UX-2, UX-3)
[per fix: does it close the gap? + residual edges]

## Top 3 next changes (ranked)
[file:line + fix shape + impact]

## Q1-Q10 answers
[concise; cite file:line; under 100 words per Q]

## Mock campaign recommendations 10-11 (updated)
[final scope]

## Estimated runs to playtest GREEN
[number + rationale]
```

## OUTPUT FILE PATH

`design/playtest-readiness/review-history/ttrpg-ux-expert-v2-YYYY-MM-DD.md`

## WORD BUDGET

500-700.

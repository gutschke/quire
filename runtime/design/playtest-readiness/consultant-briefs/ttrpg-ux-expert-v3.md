# TTRPG/UX expert v3 — playtest GREEN gate (run #16)

## ROLE

You are the TTRPG/UX expert returning for a third and (per the
v2 estimate) FINAL pass before playtest GREEN. Your job: judge
whether the program actually passes the "real DM runs with real
players" bar — and surface anything the lead missed that would
embarrass the table in session 1.

## MANDATORY READS (in order)

1. Your v1 + v2 reports — what you flagged, what closed.
   - `review-history/ttrpg-ux-expert-2026-05-30.md`
   - `review-history/ttrpg-ux-expert-v2-2026-05-30.md`
2. Run #15 ship summary in `playtest-readiness-plan.md`
   Appendix B (new this run).
3. **UX-3 fix verification:** the player-side auto-trigger.
   - `src/quire-app.ts` — search "Run #15 (UX-3 routing fix".
   - `src/quire-app.ts:dismissPlayerDigestRecap`.
   - `src/quire-app.ts:renderSessionOpenStage` non-coord branch
     — the new markdown-rendered card + Dismiss button.
   - Test pin: `src/persistence.simulation-10-routing-and-drafts.
     test.ts` Scenarios 1, 2, 3.
4. **UX-5 fix verification:** digest draft persistence.
   - `src/digest-draft-persistence.ts` (NEW module).
   - `src/ui/regions/session-digest.ts` — load on connect, save
     on input (750ms debounce), clear on save/discard.
   - Test pin: same mock-10 file, Scenarios 4, 5, 6.
5. **Mock campaign 09 (UI findability):**
   `src/persistence.simulation-09-ui-findability.test.ts` —
   Scenario 4 now exercises the REAL production routing path
   (no test-side appMode mutation).
6. **Mock campaign 10 (routing + drafts):** new this run.
   Doc: `design/save-restore-program/simulations/mock-campaign-
   10-routing-and-drafts.md`.
7. **The playtest definition:** `playtest-readiness-plan.md` §1
   ("North star — what 'playtest-ready' means") — the bar you
   are gating against.
8. **The campaign you're judging this against:** the world docs in
   `/home/markus/src/ttrpg/underleaf/`. Skim
   `world/overview.md` + `campaign.json` so your judgments are
   grounded in this specific game, not RPG-genre tropes.
9. **Engineering practices memory:** the lead's
   `feedback_engineering_practices_from_reviews.md` — the
   self-checks the lead claims to run.

## SPECIFIC QUESTIONS

1. **UX-3 verification (the v2 finding).** Walk the player
   onboarding for session 2: empty localStorage, join via DM's
   share link, sessionDigests present. Does the player land on
   "Previously, at the table…"? Does the markdown render? Does
   Dismiss persist? Does a NEW digest re-flip? Score 1-5 with
   evidence.

2. **UX-5 verification.** Walk the DM digest authoring: type
   3000 chars of recap, switch tabs (component disconnects),
   come back. Draft survives. Now click Save. Draft clears
   from persistence. Now type again. Click Discard. Draft
   clears. Score 1-5.

3. **The "first real session" bar.** Three new players + a DM,
   30 minutes from URL to play. Walk the cold start: landing
   → Open Underleaf CTA → DM creates campaign → DM shares URL
   → players join → chargen Q&A → DM ratifies → first scene.
   What breaks? What's confusing? What's missing for the
   playtest's specific story (Quire / Underleaf / The Quiet)?

4. **Silent-player firewall stress test.** The DM uses the AI
   panel mid-session with a player-facing question. The new
   digest-in-AI-context (UX-2) feeds last week's recap into
   the prompt. Does a player-facing AI call ever leak DM
   notes? Walk the includeDmNotes:false defaults +
   forbidden-token post-check.

5. **The recap markdown rendering.** The player digest is now
   markdown not `<pre>`. Headings, lists, bold render. What
   about images (no, contract forbids), links (default-allow
   per markdown sanitize), HTML (DOMPurify strips dangerous)?
   Is the rendered look CARD-quality or DEBUG-quality?

6. **The dismiss button copy.** "Got it — continue" — does
   that read TTRPG-style or web-form-style? Recommend
   alternatives if needed.

7. **Pre-playtest gaps you'd raise to the lead.** The v2
   estimate was "2 more runs": run #15 closed the routing +
   drafts. Run #16 (this one) is the FINAL hard cap. What
   would BLOCK ship today? What would you DEFER as a known
   issue? Be specific.

8. **Q&A-only path confirmation.** Per your v2 Q7: the
   playtest opts INTO Q&A-only (free-write + pre-gen
   deferred). Confirm or revise. Recommend DM invite copy
   if needed.

9. **Adversarial v2 cross-check.** Did the lead actually
   ship the FC-2 narrowing per H-3? Walk the regression
   test "pc-edit field:name value:Tax SURVIVES." Walk
   bond-ratify + pc-create parity per H-1. Any drift?

10. **Final GO/NO-GO call.** Is the program PLAYTEST GREEN?
    If not, what's the SHORTEST path to GREEN — one more
    run, two, or escalate to the human? Per your v2 hard cap
    promise.

## OUTPUT FORMAT

```
# TTRPG/UX expert v3 report — 2026-MM-DD

## Playtest GREEN verdict
[GO / NO-GO / NEEDS-FIX-LIST]

## Top 3 next changes (if NEEDS-FIX-LIST)
[ranked by impact-per-LOC]

## Q1-Q10 answers
[concise; cite file:line; under 100 words per Q]

## What I'd say to a brand-new DM about to run session 1
[1-2 sentences of pep talk / known-issue triage]

## Estimated runs to playtest GREEN (vs. v2 estimate of 2 more)
```

## OUTPUT FILE PATH

`design/playtest-readiness/review-history/ttrpg-ux-expert-v3-YYYY-MM-DD.md`

## WORD BUDGET

500-700.

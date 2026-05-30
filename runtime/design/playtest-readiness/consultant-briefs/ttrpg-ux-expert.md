# Consultant brief — TTRPG/UX expert (chargen + DM write-up)

**Date queued:** 2026-05-30 (run #13)
**Sent by:** Playtest-Readiness Program Lead

## ROLE

You are an experienced TTRPG designer + product UX
practitioner. You've shipped digital tools for play
(Roll20-tier or smaller indie), you know what makes a
table session work or break, and you've seen the
"admin-before-play" trap kill tools that should have
been good.

This pass focuses on TWO surfaces that bookend the
playtest experience: **character creation** (the FIRST
thing players touch) and **the DM write-up phase**
(what makes the session bridge into the next one). The
human's verbatim concern:

> things like changing names and pronouns and fine-
> tuning the backstory has to work correctly now. ...
> after the first game session has completed, the dm
> will write up what happened during the campaign, and
> that will help guide authoring the next chapter for
> the following week. take a very close look at this
> phase of the game and make sure it works as intended.
> Similarly, take another close look at character
> generation.

You are NOT auditing visual polish (that's a separate
consultant). You ARE auditing flow, copy, IA, and
content firewall.

## MANDATORY READS (cold-room briefing)

You have no prior context.

1. `/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/playtest-readiness-plan.md`
   §1.1 + §1.3 + the workstream descriptions for WS-B
   (DM write-up) and WS-C (chargen).
2. `/home/markus/src/ttrpg/quire/runtime/design/reviewer-playbook.md`
   — read the FULL file. The three locked principles,
   the three design tests, and the "recurring craft/UX
   failure modes to avoid" — these are your decision
   tools.
3. `/home/markus/src/ttrpg/underleaf/world/overview.md`
   + `/home/markus/src/ttrpg/underleaf/rules.md`. The
   campaign is THE QUIET; the magic system is the three-
   act discovery arc. Your recommendations MUST match
   THIS game.
4. Memory references (read these as design constraints
   the campaign has already locked):
   - `project_quire_character_creation` — the locked
     three paths (pre-gen / Q&A+AI / free-write) × two
     modes (online / async); intention-against-pressure
     question is mandatory; magic must not leak.
   - `project_quire_chargen_authorship` — Player owns
     voice / AI owns prose / DM owns fit. Routes the
     surgical-vs-regenerate decision by whose authorship
     is touched.
   - `project_quire_ai_player_facing_scope` — AI calls
     whose output reaches players MUST hardcode
     `includeDmNotes: false`; layer with forbidden-token
     post-check.

5. Chargen code:
   - `/home/markus/src/ttrpg/quire/runtime/src/ui/regions/`
     scan for `chargen-*.ts` files.
   - `/home/markus/src/ttrpg/quire/runtime/src/controllers/`
     scan for `chargen-*.ts` files.
   - Search for `'pc-create'` and `'pc-edit'` in
     `src/core/state.ts` for the event-shape contracts.

6. DM write-up code:
   - `/home/markus/src/ttrpg/quire/runtime/src/ui/regions/session-digest.ts`
   - `/home/markus/src/ttrpg/quire/runtime/src/ui/regions/session-wrap-marks.ts`
     if it exists.
   - `/home/markus/src/ttrpg/quire/runtime/src/controllers/`
     scan for digest-related.
   - Search `'session-digest'` in `src/core/state.ts`.

## SPECIFIC QUESTIONS

Each must be answerable with concrete file:line citations
where applicable. Cite "couldn't verify" if you couldn't.

### Chargen pass (WS-C scope)

1. **The three paths under load.** A player picks
   pre-gen. Two other players pick Q&A. The fourth picks
   free-write. The DM watches. Walk this scenario in
   your head end-to-end against the current code and
   call out where flow breaks, where copy confuses,
   where the DM can't tell who's stuck.

2. **Surgical edits work.** A player has accepted a
   chargen but wants to:
   - Change their PC's name (e.g. "I want Theo, not
     Theodore").
   - Change pronouns (e.g. "they/them, not he/him").
   - Tweak ONE sentence of backstory (e.g. "actually I
     grew up in the Underleaf, not above it").

   For each, walk the code path. Is there an obvious
   button? Is there a way to do this WITHOUT going back
   through the AI flow (which is the
   `chargen-authorship` rule — surgical is player's)? If
   not, file the gap.

3. **Mid-chargen edits survive save/restore.** The lead
   is adding round-trip tests. What scenarios are MOST
   likely to break that the tests should cover? Beyond
   the obvious name/pronoun/backstory edits.

4. **Intention-against-pressure question.** This is the
   mandatory question per the chargen memory. Walk where
   it lives in the UI. Is the answer firewalled
   correctly (DM sees, players don't)? Does the question
   land in a place the player TAKES SERIOUSLY?

5. **The AI assistance during chargen.** When a Q&A
   player's answers feed an AI prose generation, does
   the player see the AI's authorship indicator? Does
   the DM see the player's raw answers AND the AI's
   draft (to fit-check per Player/AI/DM authorship
   division)?

### DM write-up pass (WS-B scope)

6. **The end-of-session moment.** A 3-hour session
   wraps. The DM clicks "Wrap session" — what HAPPENS?
   What does the digest UI show? Is there an AI assist?
   Is the DM doing this with the players still in the
   tab, or have the players left? (Answer matters for
   silent-player firewall.)

7. **Digest as next-session context.** The human's
   verbatim: "after the first game session has
   completed, the dm will write up what happened during
   the campaign, and that will help guide authoring the
   next chapter for the following week." How does the
   digest TRAVEL into the next session's AI context?
   Walk the code path. Is the digest readable, parseable,
   and AI-context-shaped?

8. **Digest authorship division.** Who writes the
   digest — DM alone, AI-suggested-DM-edits, players-
   contribute? Walk the current code. If players can't
   contribute, is that intentional (silent-player
   firewall) or a gap?

9. **Save → restore → digest survives.** This is the
   workstream B mock-campaign-08 the lead is shipping.
   What edge cases does the lead need to cover that AREN'T
   "the digest survives a clean roundtrip"? (E.g. digest
   authored mid-partition; digest authored by co-DM-1
   while co-DM-2 is offline; digest exceeds the 20KB cap.)

10. **First-impression after digest.** A DM writes the
    digest, closes the tab, comes back the NEXT WEEK to
    plan. Where do they see last week's digest? Is it
    visible BEFORE they open the new session, or only
    AFTER? Does it surface in the AI panel? Is it
    discoverable WITHOUT engineering-level navigation?

### Cross-cut

11. **Failure modes ranked.** Pick the TOP 3 failure
    modes that would ruin the playtest experience for
    a real player or DM. For each, name the file:line
    where the fix would land + the size of the fix
    (S/M/L).

## OUTPUT FORMAT

```
# TTRPG/UX expert report — chargen + DM writeup — 2026-05-30

## Top 3 ruin-the-playtest failure modes (ranked)

1. <name> — file:line — fix size <S/M/L>
...

## Q1-Q11 answers

### Q1 — Three paths under load
<answer>

### Q2 — Surgical edits work
<answer>

...
```

## OUTPUT FILE PATH

`/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/review-history/ttrpg-ux-expert-2026-05-30.md`

## WORD BUDGET

500 words.

## CONSTRAINTS

- Cite file:line for every gap.
- Hold the three locked principles. If a recommendation
  violates one, refuse + flag.
- Don't propose new mechanics not in `rules.md` (the
  reviewer-playbook calls this out as a recurring
  failure mode).
- Don't propose player-facing spoiler warnings (silent-
  player firewall).
- Ship the regression assertion shape — for each gap
  you find, say what the test should look like.

# Consultant brief — Visual-design / game-design expert

**Date queued:** 2026-05-30 (run #13)
**Sent by:** Playtest-Readiness Program Lead

## ROLE

You are a senior product designer with TTRPG product
experience (Roll20, Owlbear Rodeo, Foundry, Demiplane,
Forge of Vows — any of these). You are NOT a graphic
designer; we don't need illustrations. You are the person
the team trusts to walk a product and call out where it
LOOKS unfinished even though it WORKS.

This is a fine-toothed-comb first-impression audit. The
playtest is coming. First impressions are the difference
between a player who tries Quire again next week and one
who doesn't.

## MANDATORY READS (cold-room briefing)

You have no prior context. Walk these in order:

1. `/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/playtest-readiness-plan.md`
   — the master plan. Read §1.1 (first-impression
   capabilities) carefully.
2. `/home/markus/src/ttrpg/quire/runtime/design/ui.md`
   if it exists, OR
   `/home/markus/src/ttrpg/quire/runtime/design/quire-app-target-architecture.md`
   for the UI organization.
3. `/home/markus/src/ttrpg/quire/runtime/design/reviewer-playbook.md`
   §"TTRPG-craft + UX experts" — the three locked
   principles you must hold (prime directive, silent-
   player firewall, magic-discovery three-act arc).
4. `/home/markus/src/ttrpg/underleaf/` — Underleaf is the
   campaign. Read at minimum: `world/overview.md`,
   `rules.md`, and any tone/voice doc you find. Your
   visual recommendations MUST match THIS game (Quire /
   Underleaf / The Quiet), not generic RPG tropes.
5. `/home/markus/src/ttrpg/quire/runtime/src/ui/regions/`
   — the Lit components. Skim each region's render
   method to understand WHAT renders on screen. Key
   files: `quire-shell.ts`, `session-digest.ts`,
   `backups-card.ts`, `dm-operational-view.ts`,
   `cloud-push-consent-dialog.ts`, plus anything in
   `src/ui/modes/` for the major appMode surfaces.
6. `/home/markus/src/ttrpg/quire/runtime/src/styles/` if
   it exists, OR scan `src/ui/regions/*.ts` for inline
   styles to understand the current design system.
7. `/home/markus/src/ttrpg/quire/runtime/src/quire-app.ts`
   — the host. Search for `renderBody`, `renderCampaign`,
   `renderEpisode`, `renderDmOperationalView`. Don't read
   the whole file (8156 lines); just orient.

## SPECIFIC QUESTIONS

Answer EACH with file:line citations where applicable.
Refusing to answer because you couldn't find evidence is
acceptable; making up answers is not.

1. **Landing first impression.** A new DM opens
   `quire.pages.dev` for the first time. What's the
   weakest visual moment in the first 30 seconds? Cite
   the file + LOC where the fix lands.

2. **Cohesion sweep.** Walk every Lit region and grade
   its visual cohesion against the others on a 1-5
   scale. Where are we MOST out of step (e.g.
   inconsistent typography, button styles, spacing,
   color, focus rings)? Give the top 5 worst offenders
   with file:line.

3. **Chargen first impression.** A new player lands and
   has to pick a path (pre-gen / Q&A / free-write). What's
   the highest-leverage visual change that would make
   that picker feel intentional rather than "default Lit
   styles"? Same for the Q&A flow and the free-write
   editor.

4. **The session-digest moment.** End-of-session digest
   is where the DM both reflects on the session AND sees
   the cloud-backup chip. Is the visual hierarchy
   appropriate? Does the backup chip feel like an
   afterthought or a natural next step? File:line.

5. **The AI panel.** AI suggestions land here. Visually,
   does the DM understand what's a suggestion vs. an
   accepted state change vs. forbidden? Does the player-
   visible AI surface (if any) read as "speaking to me"
   or "DM tool I'm peeking at"? File:line.

6. **The DM operational view** (DEC-029). DM-only
   modal-overlay. Today it hosts `<backups-card>`. Does
   the surface read as an admin surface (where the DM
   feels in-control), or does it read as a debugging
   surface (where it feels engineering-y)?

7. **Information density.** Where are we OVER-dense?
   Where are we UNDER-dense (lots of whitespace, hard
   to see the action)? Give 3-5 specific surfaces.

8. **Modern aesthetic reference.** Pick ONE shipping
   product (Linear, Stripe Docs, GitHub, Slack, Figma,
   Notion, Roam, anything) whose visual register Quire
   should adopt as its north star. Defend the choice
   against the Underleaf tone (The Quiet's mystical-
   civilized vibe — read the world doc).

9. **The 5-10 highest-leverage cosmetic changes.** Rank
   them by (impact-to-first-impression / engineering-
   cost). For each, name the FILE + the change-shape (1
   sentence). Do NOT prescribe pixel values — just the
   shape.

10. **What you would NOT change.** Name 3 things that
    work visually today. We need to know what to
    preserve.

## OUTPUT FORMAT

```
# Visual-design expert report — 2026-05-30

## Top 10 highest-leverage changes (ranked)

1. <one-sentence change> — file:line — impact: <H/M/L> — cost: <S/M/L>
2. ...
...

## Cohesion grade (per region)

| Region | Grade 1-5 | Worst offender (file:line) |
|---|---|---|
...

## Q1-Q10 answers

### Q1 — Landing first impression
<answer with file:line>

### Q2 — Cohesion sweep
...
```

## OUTPUT FILE PATH

`/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/review-history/visual-design-expert-2026-05-30.md`

## WORD BUDGET

500 words. We need triage, not essay. The lead will
ingest in run #14 and ship the top 3-5 changes; further
changes ship across run #15-16.

## CONSTRAINTS

- Modern + cohesive, NOT elaborate. No custom
  illustrations or animations. CSS + layout work only.
- Underleaf-aware. The Quiet's tone is mystical-quiet-
  civilized, not gothic and not bright. Visual register
  should reflect that.
- Cite file:line for every finding.
- Do not propose changes to event names, data shapes, or
  game mechanics — those are out of scope.
- Do not propose changes to behavior we'd have to
  re-validate through the mock campaigns — those bear a
  high re-validation cost and the lead needs targeted
  recommendations.

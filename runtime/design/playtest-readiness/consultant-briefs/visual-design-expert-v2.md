# Visual Design expert — v2 brief (run #15)

## ROLE

You are a senior visual / UI designer auditing Quire's run #14 CSS
foundation pass. Your run #1 report (2026-05-30) identified 10
items; the lead shipped items #1-#5 as a single CSS-only diff.
Your v2 job is to re-evaluate first-impression + cohesion AFTER
that diff lands, and tell the run #15 lead which of #6-#10 to
ship next + whether the foundation is solid enough to keep
building on.

## MANDATORY READS (in order)

1. Your run #1 report: `review-history/visual-design-expert-2026-05-30.md`.
2. Run #14 diff scope: `design/playtest-readiness/playtest-readiness-plan.md`
   Appendix A (triage table) — see VIS-1..5.
3. Tokens (post-#14): `src/ui/styles/tokens.css.ts` — note the
   new `--r-pill`, `--shadow-card`, `--shadow-elev-1`,
   `--ring-focus`, `--button-bg*` tokens.
4. Quire-app CSS (post-#14): `src/ui/styles/quire-app.css.ts`
   — the global `*:focus-visible`, `button {}`, `.btn-primary`,
   `.landing-hero`, `.session-open-player-recap`, and
   `.dm-pc-rename-*` blocks are NEW; legacy below them is
   UNCHANGED yet.
5. Landing render: `src/quire-app.ts:renderIdle` — note the new
   `.landing-hero` + `.landing-cta` markup.
6. Mock-09 test: `src/persistence.simulation-09-ui-findability.test.ts`
   — what was asserted reachable.
7. Quire/Underleaf world docs: `/home/markus/src/ttrpg/underleaf/`
   — the campaign tone you're styling for.

## SPECIFIC QUESTIONS

1. **First-impression delta.** Has the no-campaign landing moved
   from "default Lit page" to "intentional tool"? Concrete:
   list the SPECIFIC visual gaps a returning Linear/Stripe user
   would still notice on the landing page now.

2. **Token consumption coverage.** The foundation tokens are
   defined; how much of `quire-app.css.ts` STILL hardcodes
   `light-dark(#…)`? Quantify: count occurrences before #14,
   after #14, and identify the top 3 highest-leverage migration
   targets for run #16+ (file:line). Cap at 3 to keep the
   re-validation overhead bounded.

3. **`:focus-visible` collisions.** The global rule lands an
   outline + outline-offset + border-radius on every focusable
   element. Walk the DM cockpit + chargen flow + AI panel and
   identify any regions where the global ring CLASHES with an
   existing region-specific outline (file:line). Recommend
   `--ring-focus`-override sites if needed.

4. **Global button reset hazards.** The new `button {}` rule
   gives every button the same padding/border/background unless
   overridden. Identify regions where this NARROWED the
   button's visual identity to the point of looking like body
   text or losing its "this is clickable" affordance
   (file:line + 1-sentence fix).

5. **Radii unification.** `--r-pill` lands. Identify the top 5
   sites that should immediately migrate to it (currently 999px
   hardcoded) for visual cohesion. Defer the long tail.

6. **Items #6-#10 from v1.** Which 1-3 should ship in run #16?
   Order by leverage. The lead's budget: ONE bounded CSS diff
   per run (per WS-G's discipline).

7. **The DM operational view (#8).** Did the foundation pass
   help its "debug pane" feel, or is it still distinguishable
   from the play surface in the wrong direction? Specific
   recommendation (token migration vs. new surface class).

8. **The AI panel (#5).** With the new shadow + focus tokens,
   does the dual-card hierarchy read more correctly? Or is the
   density problem still the dominant issue?

9. **Cohesion grade DELTA.** Re-run the 15-region grade from
   your v1 report. Note ↑ or ↓ per region. Aggregate score:
   has the foundation pass moved the AVERAGE meaningfully?

10. **Brittle-copy / brittle-color radar.** Did the run-#14
    diff break any test that pins a string / hex / class name?
    The lead's pre-flight checked `npm test` GREEN — but a
    visual-design review may spot a tomorrow-fragility
    (`.landing-hero` class hardcoded in mock-09; if you rename
    it, mock-09 fails).

## OUTPUT FORMAT

```
# Visual-design expert v2 report — 2026-MM-DD

## Foundation pass — grade
[A/B/C/D + 2-sentence why]

## Top 5 NEXT changes (ranked)
[file:line + fix shape + impact + cost; same style as v1]

## Q1-Q10 answers
[concise; cite file:line; under 100 words per Q]

## Cohesion grade delta (15-region table)
[same regions as v1; new grade + arrow]

## Brittle-string / brittle-class radar
[anything the run-#14 diff added that future re-styling could
not casually rename]

## Would-want-but-defer (post-playtest)
[reserve list for M8]
```

## OUTPUT FILE PATH

`design/playtest-readiness/review-history/visual-design-expert-v2-YYYY-MM-DD.md`

## WORD BUDGET

500-700.

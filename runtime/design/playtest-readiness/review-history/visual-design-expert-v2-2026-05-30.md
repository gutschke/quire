# Visual-design expert v2 report — 2026-05-30

## Foundation pass — grade

**B.** The foundation tokens, focus ring, button reset, and landing hero
land cleanly and are correctly architected (no regressions in the 5
high-traffic pinned tests; the new tokens are well-named and
campaign-tone-appropriate). The grade isn't an A because the foundation
sits ON TOP of the legacy `.card` / `.session-bar` / `.ai-panel` /
`.chargen-dm-review-*` blocks rather than replacing their material —
the no-campaign landing now shows a tokenized hero ABOVE a legacy
`.recent-campaigns` `.card` with a different background palette and
border-radius, which a Linear user reads as "two different apps."

## Top 5 NEXT changes (ranked)

1. **Migrate the global `.card` surface to tokens (covers ~60 % of all
   visible surfaces in one rule).** `quire-app.css.ts:3804-3810` is
   still `border-radius: 6px; background: light-dark(#fcfcfc, #1f1f1f);
   border: 1px solid light-dark(#ddd, #333)`. Every region that the v1
   audit graded 2 or 3 inherits this surface (AI panel, DM operational
   view, session-digest, backups-card, the no-campaign landing's
   recents list, the chargen wrapper). Replace with
   `background: var(--surface-card); border: var(--border-hairline);
   border-radius: var(--r-card); box-shadow: var(--shadow-card);`. This
   single edit is the highest-leverage cohesion win available — it
   propagates the foundation through the whole product without
   touching component logic, and it makes the new hero stop looking
   like a foreign object on the landing page. Impact: H. Cost: S.

2. **Demote the legacy `<header><h1>Quire</h1></header>` block on
   `renderIdle` and let the hero own the first impression.**
   `quire-app.ts:5214-5220` still renders a `header h1 { font-size:
   1.75rem }` (`quire-app.css.ts:3724-3727`) and an italic `.summary`
   (`:3729-3733`) ABOVE the new `.landing-hero`. A first-time visitor
   reads three competing titles in 100 px of vertical space ("Quire" /
   tagline / "Start with the sample campaign"). Either drop the
   external header on idle, OR move the wordmark into the hero
   (`<small class="brand">Quire</small>` above the `<h1>`). The hero
   should be the visual entry point, not a third card below the
   tagline. Impact: H (this is the v1 #5 leverage finishing). Cost: S.

3. **Migrate `.session-bar`, `.session-bar button`, `.session-bar
   input` to tokens.** `quire-app.css.ts:4010-4096`. The session-bar
   is the only chrome ALWAYS visible at the top, and it still carries
   five hardcoded `light-dark(#…)` colors and 4 px radii. Map
   background → `--surface-card`, border → `--border-hairline`,
   buttons inherit the new global reset (already done — verify the
   per-region overrides at `:4041-4049` are still needed; they
   shouldn't be). Impact: H (it's the persistent chrome). Cost: S.

4. **Adopt a `.surface-operational` variant for `dm-operational-view`
   (v1 #8, untouched by run #14).** `dm-operational-view.ts:146-167`
   still uses bare `.card`. Add to `quire-app.css.ts` (after the new
   foundation block): `.dm-operational-view { border-left: var
   (--border-dm-rail); background: color-mix(in oklch,
   var(--surface-card) 92 %, var(--dm-amber)); box-shadow:
   var(--shadow-elev-1); }`. This is the cheapest way to make the
   operational view stop reading as "debug pane" and start reading as
   "DM control room." The amber rail token already exists
   (`tokens.css.ts:56`); only this consumer site is missing. Impact:
   M. Cost: S.

5. **Migrate the 21 `999px` chip radii to `--r-pill`** (highest-density
   sites first: `quire-app.css.ts:3572, 4584, 4937, 5602, 5677` —
   player-rail chips, topbar help, track-meter chip, chargen-stepnav
   pill, chargen path-badge). Defer the rest. This finishes v1 #3
   without paying the cost of touching all 290+ `border-radius`
   declarations. Impact: M. Cost: S.

## Q1-Q10 answers

### Q1 — First-impression delta
Moved from grade 2 → 3, not 2 → 4. A returning Linear/Stripe user still
notices: (a) the wordmark `<h1>` (`quire-app.ts:5215`) sits on
default body type while the hero `<h2>` uses `--type-section` — two
type systems on screen; (b) the recently-played `.card`
(`:5299, no styles`) inherits the legacy `light-dark(#fcfcfc,#1f1f1f)`
+ 6 px radius, so the page reads as "hero card + foreign card"; (c) no
brand mark / favicon-equivalent in the hero — feels like a doc page,
not an app cockpit.

### Q2 — Token consumption coverage
`light-dark(` occurrences: **988 → 988** in `quire-app.css.ts` (the
diff added the new foundation block but did not migrate any legacy
sites — by design; this is the scaffold-then-migrate pattern). Top 3
highest-leverage migration targets: **(1)** `.card` at `:3804-3810`,
**(2)** `.session-bar` at `:4010-4096`, **(3)** `.ai-panel` /
`.ai-card` at `:5253-5256` + `:6143-6147`. Migrating `.card` alone
recolors the operational view, session-digest, backups-card, recents
list, and several chargen surfaces — best ROI by a wide margin.

### Q3 — `:focus-visible` collisions
Four existing region rings collide with the new global:
`quire-app.css.ts:1493` (chargen-dm-review-seat-dragover, 2 px dashed
blue), `:2008` (chargen-dm-review-phaseb-pip, 2 px solid indigo),
`:4437` (quire-topbar-help-chip, 2 px solid blue), `:4910`
(button.track-box hover, 1 px solid blue — this is hover, not focus,
so it collides visually but not by selector). The first two are
chargen-only and benign; `:4437` is on the persistent topbar and
should migrate to `--ring-focus` for cohesion. The track-box hover
ring is the most jarring — recommend `outline: var(--ring-focus);
outline-offset: 0` to match the global teal language.

### Q4 — Global button reset hazards
Two real hazards: (a) **`.session-bar button`** (`:4041-4049`) still
overrides background/border to the legacy grey — same-specificity, but
later in source so it wins; this means the global teal hover never
fires on the topbar. Either delete the legacy override (preferred) or
add `var(--button-bg-hover)` to its `:hover`. (b) **Bare `<button
type="submit">Send</button>`** in `chat-panel.ts:108`, `dice-dock.ts:
153`, `player-aside.ts:273`, `dm-scratch.ts:83`, `ai-panel.ts:635`
now ALL render as muted secondary buttons. Functional, but every
"primary action of this region" is now indistinguishable from cancel
/ secondary. Add `class="btn-primary"` to the AI write-strip submit
(`ai-panel.ts:635`) and the chat Send (`chat-panel.ts:108`) — those
two carry the most user weight. 1-sentence fix: thread `class="btn-
primary"` onto the dominant submit per region; leave the rest
neutral.

### Q5 — Radii unification
Top 5 immediate `--r-pill` migrations: `quire-app.css.ts:3572`
(`.player-rail-advancement-ready` chip — most visible per-session),
`:5677` (chargen path-badge), `:4584` (topbar help chip), `:331`
(chargen-dm-review-seat-pill), `:2179` (player-rail-language-chip).
These are the chips a player sees every session; the long tail (16
more) can drift. Also: `.ai-card-badge` at `:6167` uses `3px`, not
`999px` — that's a separate "should this be `--r-chip` or stay tiny?"
question; leave alone.

### Q6 — Items #6-#10 to ship in run #16
Order by leverage: **(1) v1 #9 — typography token application (`h1`,
`h2`, `.summary`, `.muted`)** because it visually finishes the
foundation pass; without it the hero's `--type-section` `<h2>` sits
above a `1.75 rem` `<h1>` and the page reads inconsistent. **(2) v1 #8
— `dm-operational-view` admin variant** because the operational view
ships visible today and reads as debug. **(3) v1 #6 — chargen path
picker as 3-up token grid** because the playtest WILL start with
chargen and v1 graded it 3; promoting to 4 closes the highest-traffic
gap that's not already on the persistent chrome. Defer v1 #7 (digest
backup chip — still a "B" surface) and v1 #10 (light-DOM doc — process
not aesthetic).

### Q7 — DM operational view
Foundation pass did NOT touch it. `dm-operational-view.ts:146-167`
still inherits bare `.card`. Recommendation: ship a NEW surface class
(`.dm-operational-view { border-left: var(--border-dm-rail); }`) NOT
a token migration of `.card` — because `.card` is correctly
"play-surface" elsewhere; the operational view wants to read
differently on purpose. This is a 6-line addition to `quire-app.css.
ts`, no markup change (the class is already on the section at line
147).

### Q8 — AI panel
Dual-card hierarchy is unchanged structurally (`ai-card`, `ai-card-
safe`, `ai-card-dm` at `quire-app.css.ts:6143-6175`) — the new
`--shadow-card` / `--shadow-elev-1` tokens are NOT applied to it yet,
so the verdict reads the same as v1 (the cards still feel flat). The
density problem also dominates: the v1 finding that budget + settings
+ write-strip + verdict + rejection-banner all compete for the same
visual register is unaddressed by the foundation diff. Recommend
deferring an AI-panel-specific pass until run #17 — too much per-
component work for the "one bounded CSS diff per run" budget.

### Q9 — Cohesion grade delta
See table below. Aggregate v1 average = **2.87 / 5**; v2 average =
**3.13 / 5** (+0.26). Meaningful but not transformative — the
foundation moved the landing + the focus-ring story across every
region, but most regions still inherit the legacy `.card` material
and didn't move.

### Q10 — Brittle-string / brittle-class radar
Run #14 added five class names that downstream tests now pin. Listed
below. None are dangerous TODAY, but they tightly couple the visual
contract to test contracts — if a future re-style wants to rename
`.landing-hero` → `.idle-hero`, mock-09 fails. Recommendation: add a
brief comment in `quire-app.css.ts:105` ("Class names below are
pinned by `persistence.simulation-09-ui-findability.test.ts` and
`dm-operational-view.ts`; coordinate renames.") so future visual
passes know where the contract lives.

## Cohesion grade delta (15-region table)

| Region | v1 | v2 | Δ | Note |
|---|---|---|---|---|
| `quire-app.ts` idle/landing | 2 | 3 | ↑ | hero lands; legacy header + recents still drag |
| `character-creation` | 3 | 3 | → | path picker untouched (v1 #6 deferred) |
| `chargen-dm-review` | 2 | 2 | → | 200+ bespoke rules unchanged |
| `session-bar` | 3 | 3 | → | persistent chrome still legacy |
| `dm-rail` | 4 | 4 | → | inherits cleaner focus ring |
| `player-rail` | 3 | 3 | → | chip palettes unchanged |
| `scene-stage` | 4 | 4 | → | already clean |
| `chat-panel` | 3 | 3 | → | Send button now muted-secondary (regression risk noted in Q4) |
| `ai-panel` | 3 | 3 | → | shadow tokens unused; density unchanged |
| `session-digest` | 2 | 2 | → | backup chip + light-DOM untouched |
| `backups-card` | 3 | 3 | → | inherits `.card` legacy |
| `dm-operational-view` | 2 | 2 | → | still reads as debug (#4 priority) |
| `cloud-push-consent-dialog` | 3 | 3 | → | dialog defaults |
| `session-open-stage` | 3 | 4 | ↑ | new player-recap teal rail reads intentional |
| `session-wrap-marks` | 3 | 3 | → | chips still fight player-rail |
| **Average** | **2.87** | **3.13** | **+0.26** | |

## Brittle-string / brittle-class radar

Classes added by run #14 that downstream code now pins:

1. `.landing-hero` — pinned in `persistence.simulation-09-ui-findability.
   test.ts:74` and in `quire-app.ts:5248`. Future rename = mock-09
   failure.
2. `a.landing-cta` — pinned same place at `:76` + `quire-app.ts:5256`.
3. `.session-open-player-recap` and `.session-open-player-digest` —
   pinned in mock-09 at `:151` + `quire-app.ts:2231, 2237`.
4. `.dm-pc-rename-*` family (10 classes at `quire-app.css.ts:155-265`)
   — coupled to the OP-045 PC-rename UI; rename triggers a cascade.
5. **Token names** `--r-pill`, `--shadow-card`, `--shadow-elev-1`,
   `--ring-focus`, `--button-bg*` — once consumed by region rules,
   these become a public contract. Worth adding a one-line `/**
   Public token contract — coordinate renames. */` doc-comment at
   `tokens.css.ts:42` so the next foundation pass treats them as load-
   bearing.

No string / hex regressions found.

## Would-want-but-defer (post-playtest M8)

- A full migration of all 988 `light-dark(#…)` occurrences to oklch
  tokens. Defer — the high-traffic surfaces (top 3 in Q2) deliver 80 %
  of the visual win at 10 % of the cost.
- AI panel density redesign — needs a content-strategy decision (which
  of the 7 sub-widgets are first-class?), not a CSS pass.
- Custom wordmark / favicon — explicitly out of scope per the brief.
- Motion pass on chip enter/leave — the tokens exist (`--motion-state`)
  but nothing consumes them; can wait.
- `chargen-dm-review-*` family consolidation (~200 bespoke rules) —
  worth a dedicated extraction milestone but too large for a single CSS
  diff; queue as M8 work.

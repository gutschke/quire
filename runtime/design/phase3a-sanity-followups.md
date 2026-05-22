# Phase 3a sanity review — deferred follow-ups (2026-05-22)

After Clusters A-D shipped (commits `3700299`, `3a10b27`, `80d89aa`,
`fbf05c0`, `08d6033`, `64ae6fc`), four parallel reviewers
(TTRPG-craft / UX / Engine / Adversarial) did a sanity pass before
Cluster E.  The convergent + cheap items landed in commits `45f7da6`,
`be2c4a3`, `de2d25b`.  This doc captures the items deferred from that
triage so they remain tracked.

## Deferred — security

### F-S7 (Adv B2) — homoglyph bypass
- **Site**: `src/ai/spoiler-check.ts` — `sanitizeForSpoilerScan`.
- **Shape**: NFKC normalization does NOT fold Cyrillic / Greek /
  Cherokee lookalikes.  `mаgic` (Cyrillic а U+0430), `prοphecy`
  (Greek omicron), `Quieт` (Cyrillic т) all slip through.
- **Why deferred**: a confusables-folding table is the proper fix;
  it's expensive (~2K char mapping) and not load-bearing today.
  System prompt's "no synonyms" line + the existing auto-retry path
  remain the primary defense.
- **Trigger to revisit**: a real campaign sees an AI emit one of
  these in production.

## Deferred — engine

### Engine B2 — `caster-state-set` over-revert
- **Site**: `src/controllers/ai-write-controller.ts:474-484`
  (`dispatchCompensating`).
- **Shape**: Revert always emits `'clear'` regardless of prior
  ladder state.  A `noticed → watched` apply that the DM undoes
  ends at `clear`, not back at `noticed`.
- **Why deferred**: pre-existing M3c-era issue, not introduced by
  Phase 3a.  Proper fix is snapshotting pre-apply state in
  `applyOne`/`applyAll`; pairs naturally with the audit-replay work
  later in Phase 3.
- **Trigger to revisit**: any DM hits the over-revert at a real
  table.

### Engine M1 — `dice-roll` hard-gate is dead code
- **Site**: `src/controllers/ai-write-controller.ts:275-285`.
- **Shape**: Hard-gate detector checks `modifierBreakdown` for the
  literal string `"double-1"`, which the broker never writes.
  With M3C-2 (Cluster D) the dispatcher now rolls real dice; the
  gate could inspect `rolled.rolls[0] === 1 && rolled.rolls[1] === 1`
  post-roll.
- **Decision needed**: either gate post-roll (correctness, double-1
  is "DM owns the twist" per rules.md L47) OR remove the comment
  promise.  Punted because the dispatch path doesn't currently
  surface rolled dice back to the hard-gate detector cleanly.
- **Trigger to revisit**: AI-proposed double-1 in production OR
  Cluster E refactor touches the dispatcher.

## Deferred — UX polish

### UX M4 — `.character-creation-pack-button` visual weight
- **Site**: `src/ui/regions/character-creation.ts:529-535`,
  `src/ui/styles/quire-app.css.ts` pack-button rules.
- **Shape**: The "Pack my character" button reads as visually
  quieter than the chip-buttons earlier in the wizard.  After the
  Required-pack callout escalation, the button itself should be a
  primary affordance (filled, not bordered).
- **Why deferred**: trivial CSS, but pairs with M6 (last-3 pill
  location) and the Cluster E unified DM-review work; defer the
  visual cluster so the design lands coherently.

### UX M6 — last-3 pills location vs. ui.md
- **Site**: `src/ui/regions/dice-dock.ts` `renderRecentPills`,
  `src/ui/styles/quire-app.css.ts` `.dice-recent-pills`.
- **Shape**: ui.md L156 specifies "Last 3 rolls shown to the right
  as small pills" — to the RIGHT of the form, not above.  Current
  Cluster D implementation stacks them above.  Also duplicates the
  full history list below.
- **Why deferred**: would require restructuring the dice-dock CSS
  grid; defer to V-5 wire-through pass.

### UX M2/13 (P3U-5) — disable unimplemented chargen paths
- **Site**: `src/ui/regions/character-creation.ts:296-309` —
  "Pick a pre-made PC" and "Write it yourself" buttons.
- **Shape**: Both still clickable; advance to step 4 with placeholder
  copy.  P3U-5 in the prioritized backlog (UX P0 there) calls for
  disabling them so first-impression players don't pick a path that
  bounces.
- **Why deferred**: pre-existing backlog item; not regressed by
  Phase 3a.  Will land as part of Phase 3b player-flow polish (see
  `prioritized-backlog.md` Cluster Phase 3b player flow).

### UX 11/12 — design-token drift on amber callouts
- **Site**: `src/ui/styles/quire-app.css.ts` lines for
  `.invite-manager-mode-b-warning` + `.character-creation-required-pack`.
- **Shape**: Both use raw hex amber rather than Quire's design tokens
  (`--dm-amber`).  Drift will matter when the palette is touched.
- **Why deferred**: lint-level; bundle with the next color-pass.

## Deferred — chargen flow

### UX M3 — stat/skill question slot
- **Site**: `underleaf/campaign.json` characterCreation.questions[]
  ordering.
- **Shape**: alignment (Q7) → stat-emphasis (Q8) jumps from
  "personality" to "stats" mid-stream.  Reviewer suggested
  reordering so mechanical questions cluster (1-4) and the narrative
  tail (5+) reads as a single arc.
- **Why deferred**: needs a play-test to validate the new order
  doesn't lose the existing flow's logic.  Defer to a dedicated
  reorder commit with the TTRPG-craft expert in the loop.

## Confirmed clean (no follow-up)

These were specifically gut-checked and confirmed fine:

- **Stat multiset validator** — `backstory-validator.ts:303-315`
  correctly accepts all valid 60 permutations of the canonical
  starting array.
- **Skill category strings** — `schema.ts:304-313` matches
  `rules.md:53-60` exactly.
- **System prompt tightness** — constrains output without
  over-prescribing the PC.
- **Engine-vs-campaign tagging** — `CampaignAiBackstory`,
  `DEFAULT_SPOILER_TOKENS`, `PcStats`, `QUIRE_SKILL_CATEGORIES` all
  carry the correct [E]/[C]/[H] posture.
- **F-PI1** — `wrapUntrusted` still load-bearing for
  prompt-injection defense.
- **Dice DoS** — 100×1000 expression is microseconds; not a real
  concern.
- **NIT bundle** — main bundle 98.21 KB / 110 KB cap; healthy.
- **`isPcStats` type guard** — strictly rejects coerced strings.

## What landed pre-Cluster-E

For audit traceability:

| Finding | Commit | Notes |
|---|---|---|
| Adv B1 (glue-collapse) | `45f7da6` | Two-scan sanitize. |
| Adv B3 (Cf-class expansion) | `45f7da6` | FORMAT_CONTROL_RE const. |
| Adv B4 (skillMastery dupes) | `45f7da6` | New ERROR code. |
| Engine N2 (shape-invalid code) | `45f7da6` | Symmetry with stats. |
| TTRPG B1 (Cast Hard label) | `be2c4a3` | "Cast (Hard, −2)". |
| TTRPG B2 (stress promise) | `be2c4a3` | Tooltips re-worded. |
| UX M5 (amber-collision reskin) | `be2c4a3` | Red/orange palette. |
| UX B1 / P3U-1 (step 6) | `be2c4a3` | TOTAL_STEPS 6 → 5. |
| UX B2 (time copy) | `be2c4a3` | 5 min → 10-15 min. |
| UX B3 + TTRPG M1 (prior-connection) | `be2c4a3` + `de2d25b` | Family → estranged. |
| Engine B1 (freeze union) | `be2c4a3` | Stable-contract comment. |
| TTRPG M2 (intent-moment min) | `de2d25b` | 40 → 100 chars. |
| TTRPG M3 (spoiler synonyms) | `de2d25b` | +5 entries. |
| TTRPG M4 (Bay Area places) | `de2d25b` | +14 entries. |

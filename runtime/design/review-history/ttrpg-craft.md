# Review history — ttrpg-craft

Per-lens running record of `(finding → resolution)` tuples from milestone gates.

## M2 — 2026-05-21

- **player-rail is route-driven, not always-on.** Defeats ui.md's "sheet never tabbed away from" property. A player viewing a scene who clicks their character link loses the scene Stage.
  - Resolution: **deferred: P-M3a-rail-always-on**. M3a HARD acceptance criterion. Requires P-M3a-pc-binding.

- **No PC-to-player binding.** Blocks stat-chip dice, always-on rail, per-peer harm/stress glyph, active-PC focus card.
  - Resolution: **deferred: P-M3a-pc-binding**. FIRST M3a task; ordered before any UI consumer.

- **Dice Dock unusable for new players.** Single text-input requires composing "2d6+stat" notation by hand. ui.md called for 6 stat chips with current modifier visible.
  - Resolution: **deferred: P-M3a-stat-chips**. M3a HARD acceptance criterion.

- **Scene-strip frontmatter omission.** `<scene-stage>` doesn't render location · mood · expectedDuration · presentNpcs. DM-side friction.
  - Resolution: **deferred: P-M3a-scene-strip**. Promoted from polish to M3a HARD acceptance criterion.

- **Raise-hand DM-self-raise anomaly.** Button hidden from DM but glyph render path renders for any peer. DM cannot raise hand via UI but materializer doesn't reject.
  - Resolution: **deferred: P1-7-followup-hand-dm-decision**.

- **Hand persists across scene changes.** Mechanics-fade violation.
  - Resolution: **deferred: P1-7-followup-hand-auto-lower**.

- **Player Aside missing harm/stress glyph, connection dot, current-speaker pulse.** STATUS overclaimed these.
  - Resolution: **acked**. STATUS now accurately reports what shipped; affordances queued for M3a (depend on P-M3a-pc-binding for harm/stress).

- **Chat-panel as Aside-sibling vs Aside-child.** Provisional split; M3a decides.
  - Resolution: **deferred to M3a decision**.

- **filteredShared has zero consumers.** Safe at M2 but risky at M3a.
  - Resolution: **deferred: P-M3a-filteredShared-migrate**. M3a HARD acceptance criterion (FIRST commit).

- **Light-DOM forward-compat misleading.** Component comments suggest shadow DOM is M3 path; CSS variables cascade fine through light DOM.
  - Resolution: **acked (plan note A-1)**. M3 decision: ship tokens as global stylesheet.

- **Banner threshold + copy.** +50 inflation threshold won't fire until ~M5+; banner text is engineer-jargon.
  - Resolution: **deferred: P-M3a-banner-language**.

- **M2 pace (30min wall-clock vs 2-3wk estimate).** Same yellow flag as M1.
  - Resolution: **acked (plan acknowledgement)**. STATUS records the delta; redesign-plan.md P-M3a-pace-acknowledge for time-estimate revision at M3a entry.

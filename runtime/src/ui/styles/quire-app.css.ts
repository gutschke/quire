/**
 * Legacy quire-app styles, extracted from `quire-app.ts` during M1
 * (P0-1 facade-migration step 1).  These are the existing styles
 * verbatim from the pre-refactor stack-of-cards UI; they will be
 * progressively split per-region and migrated to consume the design
 * tokens in `tokens.css.ts` as part of M2 region extraction.
 *
 * Do not edit these styles freely during M1; the migration discipline
 * is "extract first, refactor later."  New styles introduced in M1
 * (e.g. for shell wrappers) belong in their own per-region modules,
 * not here.
 */

import { css } from 'lit';

export const quireAppStyles = css`
    /*
     * Root host fills the viewport so the inner <quire-shell> grid
     * can use 100dvw/100dvh.  No outer scrollbar, no centered max-
     * width — the cockpit is the entire window per ui.md §
     * "Layout system — the five-region grid."
     */
    :host {
      display: block;
      width: 100dvw;
      height: 100dvh;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.55;
      color: light-dark(#111, #eee);
      background: light-dark(#fff, #1a1a1a);
      overflow: hidden;
    }

    /*
     * Each region's scroll container needs its content padded
     * consistently.  The .area divs inside quire-shell scroll their
     * own content; this rule applies the padding inside the region
     * containers themselves, NOT on the shell, so the scrollbar
     * sits at the area boundary rather than offsetting the prose.
     */
    .area-rail > *,
    .area-stage > *,
    .area-aside > * {
      padding: 0.6rem 1rem;
    }
    .area-topbar > *,
    .area-dock > * {
      padding: 0.3rem 1rem;
    }

    /* =============================================================
     * Run #14 visual pass — global foundation
     *
     * Item set: tokens consumption start (high-traffic surfaces),
     * :focus-visible ring, global button reset, landing hero,
     * radii unification to 3-step scale.  Bounded by WS-G's
     * UI-iteration safety playbook — the change is intentionally
     * CSS-only and small in surface area so the re-validation pass
     * (mock-09 + npm test) catches anything that drifts.
     *
     * Sites that previously inlined their own focus-outline,
     * border-radius, or button background SHOULD migrate to these
     * tokens in subsequent passes.  This commit lands the
     * foundation; per-region migrations are tracked by the
     * visual-design re-audit brief for run #15.
     * ============================================================= */
    *:focus-visible {
      outline: var(--ring-focus);
      outline-offset: 2px;
      border-radius: var(--r-chip);
    }
    button {
      font: inherit;
      cursor: pointer;
      border-radius: var(--r-chip);
      padding: var(--s-2) var(--s-3);
      border: 1px solid color-mix(in oklch, var(--ink-prose) 18%, transparent);
      background: var(--button-bg);
      color: inherit;
      transition: background var(--motion-hover), border-color var(--motion-hover);
    }
    button:hover {
      background: var(--button-bg-hover);
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .btn-primary {
      background: var(--button-bg-primary);
      color: var(--button-ink-primary);
      border-color: transparent;
      font-weight: 600;
    }
    .btn-primary:hover {
      background: color-mix(in oklch, var(--accent-teal) 88%, white);
    }

    /*
     * Brittle-class radar — coordinate renames.
     * Run #15 (visual-design expert v2 Q10): the following classes
     * are pinned by persistence.simulation-09-ui-findability.test.ts,
     * mock-campaign-10-routing-and-drafts.md (run #15), and the
     * surface tests in quire-app.player-digest-surface.test.ts.  A
     * future re-style that renames these classes MUST also update
     * the tests:
     *   .landing-hero, a.landing-cta (mock-09 Scenario 1)
     *   .session-open-player-recap, .session-open-player-digest
     *     (mock-09 Scenario 4)
     *   .session-open-player-recap-dismiss (run #15 dismiss
     *     handler — mock-09 Scenario 4 + mock-10)
     *   .dm-pc-rename-* family (OP-045 PC rename surface;
     *     pc-edit interaction tests + chargen-roundtrip tests)
     *   .session-digest-draft (digest editor textarea;
     *     persistence tests in session-digest.test.ts).
     */
    /* Visual #5 — no-campaign landing hero.  Promotes the
     * "Open Underleaf" CTA from a plain-blue text link to an
     * intentional first-impression card with a primary button.
     * The DM's first 30 seconds: a centered hero instead of three
     * stacked plaintext cards. */
    .landing-hero {
      max-width: 560px;
      margin: clamp(2rem, 8vh, 6rem) auto 1.5rem;
      padding: var(--s-6);
      background: var(--surface-card);
      border-radius: var(--r-card);
      border: var(--border-hairline);
      box-shadow: var(--shadow-card);
      text-align: center;
    }
    .landing-hero h1 {
      font-size: var(--type-section);
      margin: 0 0 var(--s-2);
    }
    .landing-hero p {
      color: color-mix(in oklch, var(--ink-prose) 70%, transparent);
      margin: 0 0 var(--s-4);
    }
    .landing-hero .landing-cta {
      display: inline-block;
      padding: var(--s-3) var(--s-6);
      border-radius: var(--r-chip);
      background: var(--button-bg-primary);
      color: var(--button-ink-primary);
      font-weight: 600;
      text-decoration: none;
      box-shadow: var(--shadow-elev-1);
      transition: background var(--motion-hover);
    }
    .landing-hero .landing-cta:hover {
      background: color-mix(in oklch, var(--accent-teal) 88%, white);
    }

    /* Player session-open digest surface (run #14 P1c) — the
     * "Previously, at the table…" card players see when the DM
     * is re-orienting and a digest is available. */
    .session-open-player-recap {
      border-left: 3px solid var(--accent-teal);
    }
    .session-open-player-digest {
      white-space: pre-wrap;
      font-family: inherit;
      font-size: var(--type-prose);
      line-height: 1.6;
      margin: var(--s-3) 0 0;
      padding: var(--s-3);
      background: color-mix(in oklch, var(--surface-card) 75%, transparent);
      border-radius: var(--r-chip);
    }

    /* OP-045 — dm-pc-detail rename editor styles (run #14). */
    .dm-pc-rename {
      margin-bottom: var(--s-4);
    }
    .dm-pc-rename-grid {
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
      margin: var(--s-2) 0 0;
    }
    .dm-pc-rename-row {
      display: grid;
      grid-template-columns: minmax(7rem, auto) 1fr;
      gap: var(--s-3);
      align-items: baseline;
    }
    .dm-pc-rename-label {
      color: color-mix(in oklch, var(--ink-prose) 65%, transparent);
      font-size: var(--type-chrome-base);
      margin: 0;
    }
    .dm-pc-rename-value {
      display: flex;
      align-items: baseline;
      gap: var(--s-2);
      margin: 0;
      flex-wrap: wrap;
    }
    .dm-pc-rename-current {
      flex: 1;
      min-width: 0;
    }
    .dm-pc-rename-edit {
      font-size: var(--type-chrome-tight);
    }
    .dm-pc-rename-input {
      flex: 1 1 16rem;
      min-width: 12rem;
      padding: var(--s-2);
      border-radius: var(--r-chip);
      border: var(--border-hairline);
      background: var(--surface-card);
      color: var(--ink-prose);
      font: inherit;
    }
    .dm-pc-rename-row-open {
      grid-template-columns: minmax(7rem, auto) 1fr;
    }
    .dm-pc-rename-actions {
      display: flex;
      gap: var(--s-2);
      margin-top: var(--s-2);
      width: 100%;
    }
    /* =========================== end run #14 foundation =========================== */

    /*
     * P3D-3: chargen route renders outside the five-region shell
     * (a player visiting an invite URL doesn't need the cockpit).
     * Centered single-column with a comfortable max-width and
     * generous padding; mobile-friendly because the column shrinks
     * to viewport width below the max.
     */
    .chargen-shell {
      display: block;
      max-width: 720px;
      width: 100%;
      margin: 0 auto;
      padding: 1.5rem 1.25rem 3rem;
      box-sizing: border-box;
      overflow-y: auto;
      max-height: 100dvh;
    }

    /* Phase 3a Cluster E step 2: unified DM review surface.  Per-seat
       card replacing the prior 3-card stack (invite-manager + seat-strip
       + dm-aside).  Step 6 deletes the legacy mounts. */
    .chargen-dm-review-intro {
      margin: 0 0 0.6rem;
    }
    .chargen-dm-review-mode-b {
      margin: 0.6rem 0;
      padding: 0.6rem 0.9rem;
      border-left: 3px solid light-dark(#cc8a00, #d4a73a);
      background: light-dark(#fff8e6, #2a2310);
      color: light-dark(#5a4400, #e6cd80);
      font-size: 0.88rem;
      border-radius: 3px;
    }
    .chargen-dm-review-mode-b strong {
      color: light-dark(#7a4400, #f0d68a);
    }
    .chargen-dm-review-seats {
      list-style: none;
      padding: 0;
      margin: 0.4rem 0 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    /* Phase B-prime (2026-05-25): empty-state when no seats yet. */
    .chargen-dm-review-seats-empty {
      padding: 0.7rem 0.9rem;
      border: 1px dashed light-dark(#cbd5e1, #475569);
      border-radius: 6px;
      font-size: 0.9rem;
    }
    /* Collapsed posture after "Start playing →" — bound seats glance. */
    .chargen-dm-review-seats-collapsed .chargen-dm-review-seat-actions,
    .chargen-dm-review-seats-collapsed .chargen-dm-review-synth {
      display: none;
    }
    .chargen-dm-review-roster-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.7rem 0 0;
      padding-top: 0.5rem;
      border-top: 1px solid light-dark(#e2e8f0, #1e293b);
    }
    .chargen-dm-review-collapse-controls {
      margin: 0.7rem 0 0;
      padding-top: 0.5rem;
      border-top: 1px solid light-dark(#e2e8f0, #1e293b);
    }
    .chargen-dm-review-add-seat,
    .chargen-dm-review-start-playing,
    .chargen-dm-review-resume {
      padding: 0.4rem 0.85rem;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      cursor: pointer;
      font: inherit;
    }
    .chargen-dm-review-add-seat:hover:not(:disabled),
    .chargen-dm-review-start-playing:hover,
    .chargen-dm-review-resume:hover {
      background: light-dark(#f1f5f9, #1e293b);
    }
    .chargen-dm-review-add-seat:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    /* "Start playing →" is the primary CTA; give it weight. */
    .chargen-dm-review-start-playing {
      border-color: light-dark(#0b3d7f, #79b8f0);
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      font-weight: 500;
      margin-left: auto;
    }
    .chargen-dm-review-cap-note {
      font-size: 0.85rem;
      align-self: center;
    }
    .chargen-dm-review-seat {
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#d4d4d4, #3a3a3a);
      border-radius: 6px;
      background: light-dark(#fafafa, #1d1d1d);
    }
    .chargen-dm-review-seat-accepted {
      border-color: light-dark(#16a34a, #4ade80);
      background: light-dark(#f0fdf4, #102e1c);
    }
    .chargen-dm-review-seat-head {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      margin-bottom: 0.4rem;
    }
    .chargen-dm-review-seat-pill {
      display: inline-block;
      padding: 0.1rem 0.55rem;
      border-radius: 999px;
      background: light-dark(#e2e8f0, #1e293b);
      color: light-dark(#0f172a, #cbd5e1);
      font-weight: 600;
      font-size: 0.85em;
    }
    .chargen-dm-review-seat-name code {
      background: transparent;
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
    }
    .chargen-dm-review-seat-display-name {
      font-weight: 500;
    }
    .chargen-dm-review-seat-id {
      font-size: 0.78em;
      opacity: 0.6;
      margin-left: 0.35rem;
    }
    .chargen-dm-review-seat-remove {
      /* Wave 1: X glyph on removable unbound seats.  Post-Wave-2
         polish: bumped opacity from 0.4 (UX review: too subtle for
         a destructive action on a stale seat).  0.6 reads as
         present-but-secondary; hover/focus jumps to 1.0. */
      margin-left: auto;
      padding: 0 0.4rem;
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      line-height: 1;
      opacity: 0.6;
      border-radius: 4px;
    }
    .chargen-dm-review-seat-remove:hover,
    .chargen-dm-review-seat-remove:focus-visible {
      opacity: 1;
      border-color: light-dark(#dc2626, #f87171);
      color: light-dark(#dc2626, #f87171);
    }
    .chargen-dm-review-remove-undo {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin: 0 0 0.6rem;
      padding: 0.4rem 0.7rem;
      background: light-dark(#fef3c7, #422006);
      border: 1px solid light-dark(#facc15, #a16207);
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .chargen-dm-review-remove-undo-btn {
      padding: 0.25rem 0.6rem;
      border: 1px solid light-dark(#a16207, #facc15);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      margin-left: auto;
    }
    .chargen-dm-review-remove-undo-btn:hover {
      background: light-dark(#fef9c3, #1e293b);
    }
    /* Wave 2: synth-result header click-to-edit affordance. */
    .chargen-dm-review-header-edit {
      border: 1px solid transparent;
      background: transparent;
      padding: 0 0.25rem;
      margin: 0;
      cursor: pointer;
      font: inherit;
      color: inherit;
      border-radius: 3px;
    }
    .chargen-dm-review-header-edit:hover {
      border-color: light-dark(#94a3b8, #475569);
      background: light-dark(#f1f5f9, #1e293b);
    }
    .chargen-dm-review-header-input {
      font: inherit;
      padding: 0.15rem 0.4rem;
      border: 1px solid light-dark(#94a3b8, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      min-width: 8em;
    }
    .chargen-dm-review-header-input-name {
      font-weight: 600;
    }
    /* Post-R5 UX fix: faint pencil glyph next to click-to-edit
       header values so the affordance is discoverable without
       hover.  UX-R5 ranked this as a first-table blocker. */
    .chargen-dm-review-header-edit-pencil {
      font-size: 0.65em;
      margin-left: 0.25rem;
      opacity: 0.35;
      vertical-align: 0.15em;
      transition: opacity 0.12s ease-out;
    }
    .chargen-dm-review-header-edit:hover .chargen-dm-review-header-edit-pencil,
    .chargen-dm-review-header-edit:focus-visible
      .chargen-dm-review-header-edit-pencil {
      opacity: 1;
      color: light-dark(#0b3d7f, #79b8f0);
    }
    /* Wave 2: drift banner — informational, not blocking.
       Post-Wave-2 polish: more vertical space below the banner so
       it visually separates from the Review/Accept actions row
       (UX review: was visually adjacent to Accept, reading as a
       precondition). */
    .chargen-dm-review-drift {
      margin: 0.5rem 0 1rem;
      padding: 0.5rem 0.7rem;
      background: light-dark(#fef3c7, #422006);
      border: 1px solid light-dark(#facc15, #a16207);
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .chargen-dm-review-drift-pip {
      margin-bottom: 0.4rem;
      padding-bottom: 0.35rem;
      border-bottom: 1px dashed light-dark(#facc15, #a16207);
      font-size: 0.9em;
    }
    .chargen-dm-review-drift-stats {
      font-variant-numeric: tabular-nums;
    }
    .chargen-dm-review-drift-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chargen-dm-review-drift-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-bottom: 0.3rem;
    }
    .chargen-dm-review-drift-field {
      font-weight: 600;
      min-width: 5em;
    }
    .chargen-dm-review-drift-before {
      text-decoration: line-through;
      opacity: 0.7;
    }
    .chargen-dm-review-drift-after {
      font-weight: 500;
    }
    .chargen-dm-review-drift-arrow {
      opacity: 0.6;
    }
    .chargen-dm-review-drift-leave,
    .chargen-dm-review-drift-patch,
    .chargen-dm-review-drift-resync {
      padding: 0.2rem 0.55rem;
      border: 1px solid light-dark(#a16207, #facc15);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
      margin-left: auto;
    }
    .chargen-dm-review-drift-leave:hover,
    .chargen-dm-review-drift-patch:not(:disabled):hover,
    .chargen-dm-review-drift-resync:not(:disabled):hover {
      background: light-dark(#fef9c3, #1e293b);
    }
    .chargen-dm-review-drift-patch:disabled,
    .chargen-dm-review-drift-resync:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      margin-left: 0;
    }
    .chargen-dm-review-drift-actions {
      display: flex;
      gap: 0.4rem;
      margin-top: 0.4rem;
      padding-top: 0.4rem;
      border-top: 1px dashed light-dark(#facc15, #a16207);
    }
    /* Wave 2: stat swap-pair editor — cell is clickable when
       editable, lock glyph on the player's chosen +2 stat. */
    .chargen-dm-review-stat-cell-editable {
      cursor: pointer;
      border: 1px solid transparent;
      background: transparent;
      font: inherit;
      color: inherit;
      padding: 0.2rem 0.3rem;
      border-radius: 3px;
    }
    .chargen-dm-review-stat-cell-editable:hover {
      background: light-dark(#f1f5f9, #1e293b);
      border-color: light-dark(#cbd5e1, #475569);
    }
    .chargen-dm-review-stat-cell-selected {
      border-color: light-dark(#0b3d7f, #79b8f0) !important;
      background: light-dark(#dbeafe, #1e3a8a);
    }
    .chargen-dm-review-stat-lock {
      font-size: 0.7em;
      margin-left: 0.2rem;
      opacity: 0.7;
    }
    .chargen-dm-review-stat-cell-pick {
      /* Subtle highlight on the player's-pick cell so the lock
         glyph has visual context. */
      box-shadow: inset 0 0 0 1px light-dark(#16a34a55, #4ade8055);
    }
    /* Post-R5 UX fix: hint text under the stat grid so DMs discover
       the two-click swap interaction.  UX-R5: "the click-to-swap
       interaction is invisible until you happen to click." */
    .chargen-dm-review-stat-hint {
      margin: 0.25rem 0 0;
      font-size: 0.8em;
      font-style: italic;
      text-align: center;
    }
    .chargen-dm-review-stat-confirm {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.4rem 0;
      padding: 0.4rem 0.6rem;
      background: light-dark(#fef3c7, #422006);
      border: 1px solid light-dark(#facc15, #a16207);
      border-radius: 4px;
      font-size: 0.88rem;
    }
    .chargen-dm-review-stat-confirm-yes,
    .chargen-dm-review-stat-confirm-no {
      padding: 0.2rem 0.55rem;
      border: 1px solid light-dark(#a16207, #facc15);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.9em;
    }
    .chargen-dm-review-stat-confirm-yes {
      margin-left: auto;
    }
    .chargen-dm-review-stat-confirm-yes:hover,
    .chargen-dm-review-stat-confirm-no:hover {
      background: light-dark(#fef9c3, #1e293b);
    }
    /* Wave 2: chip editing (tags + skills) */
    .chargen-dm-review-chip-editable {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }
    .chargen-dm-review-chip-remove {
      border: none;
      background: transparent;
      cursor: pointer;
      color: inherit;
      opacity: 0.5;
      padding: 0 0.15rem;
      font: inherit;
      font-size: 0.8em;
      border-radius: 2px;
    }
    .chargen-dm-review-chip-remove:hover {
      opacity: 1;
      color: light-dark(#dc2626, #f87171);
    }
    /* Post-R5 UX fix: clearly "add" affordance vs content chip.
       UX-R5 finding: DMs read a bare plus chip as "this PC has a +
       skill" mixed in with content chips.  Solution: dashed border,
       italic muted text, leading gap, "+ add" / "+ skill" label. */
    .chargen-dm-review-chip-add {
      cursor: pointer;
      border: 1px dashed light-dark(#94a3b8, #475569);
      background: transparent;
      color: light-dark(#64748b, #94a3b8);
      font: inherit;
      font-size: 0.85em;
      font-style: italic;
      padding: 0.1rem 0.55rem;
      border-radius: 999px;
      opacity: 0.8;
      margin-left: 0.3rem;
      transition: all 0.15s ease-out;
    }
    .chargen-dm-review-chip-add:hover {
      opacity: 1;
      border-style: solid;
      border-color: light-dark(#475569, #94a3b8);
      background: light-dark(#f1f5f9, #1e293b);
      color: light-dark(#0f172a, #e2e8f0);
    }
    .chargen-dm-review-chip-input {
      font: inherit;
      padding: 0.1rem 0.4rem;
      border: 1px solid light-dark(#94a3b8, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      min-width: 6em;
    }
    .chargen-dm-review-chip-add-empty {
      font-size: 0.85em;
    }
    /* P-R6: retire flow */
    .chargen-dm-review-seat-retire {
      margin-left: 0.3rem;
      padding: 0.15rem 0.5rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
      border-radius: 3px;
    }
    .chargen-dm-review-seat-retire:hover {
      background: light-dark(#fef9c3, #1e293b);
    }
    .chargen-dm-review-seat-tag {
      margin-left: 0.4rem;
      padding: 0.1rem 0.45rem;
      border-radius: 999px;
      font-size: 0.75em;
      font-weight: 500;
    }
    .chargen-dm-review-seat-tag-retired {
      background: light-dark(#fef3c7, #422006);
      color: light-dark(#92400e, #fcd34d);
    }
    .chargen-dm-review-seat-tag-archived {
      background: light-dark(#e2e8f0, #1e293b);
      color: light-dark(#475569, #94a3b8);
    }
    /* #294 (2026-05-26): the player-safe "seat memory" line under
       the retired/archived seat-card.  Italicized to read as a
       legacy quote; muted to keep the active roster's identity
       chips dominant. */
    .chargen-dm-review-seat-memory {
      margin: 0.35rem 0 0;
      font-style: italic;
      font-size: 0.9rem;
      color: light-dark(#475569, #94a3b8);
      line-height: 1.35;
    }
    .chargen-dm-review-retire-hint {
      display: block;
      font-size: 0.78rem;
      color: light-dark(#64748b, #94a3b8);
      margin-top: 0.15rem;
    }
    .chargen-dm-review-retire-memory-text {
      display: block;
      width: 100%;
      margin-top: 0.3rem;
      padding: 0.4rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      box-sizing: border-box;
      resize: vertical;
    }
    /* #294 (2026-05-26): Stage roster Retired tab seat-memory edit
       affordances.  "Add memory" / "Edit memory" button sits under
       the retire reason; clicking opens an inline textarea editor. */
    .stage-roster-memory-edit {
      margin-top: 0.3rem;
      padding: 0.15rem 0.55rem;
      border-radius: 3px;
      background: light-dark(#f1f5f9, #1e293b);
      color: light-dark(#0f172a, #e2e8f0);
      border: 1px dashed light-dark(#cbd5e1, #475569);
      font-size: 0.78rem;
      cursor: pointer;
    }
    .stage-roster-memory-edit:hover {
      background: light-dark(#e2e8f0, #334155);
    }
    .stage-roster-memory-editor {
      margin-top: 0.4rem;
      padding: 0.5rem;
      background: light-dark(#f8fafc, #0b1220);
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
    }
    .stage-roster-memory-label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .stage-roster-memory-hint {
      display: block;
      font-size: 0.75rem;
      color: light-dark(#64748b, #94a3b8);
      font-weight: 400;
      margin-top: 0.1rem;
    }
    .stage-roster-memory-text {
      display: block;
      width: 100%;
      margin-top: 0.3rem;
      padding: 0.4rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      box-sizing: border-box;
      resize: vertical;
    }
    .stage-roster-memory-actions {
      display: flex;
      gap: 0.4rem;
      margin-top: 0.4rem;
      justify-content: flex-end;
    }
    .stage-roster-memory-save {
      padding: 0.2rem 0.7rem;
      border-radius: 3px;
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      border: 1px solid light-dark(#bfdbfe, #1d4ed8);
      cursor: pointer;
    }
    .stage-roster-memory-cancel {
      padding: 0.2rem 0.7rem;
      border-radius: 3px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      cursor: pointer;
    }
    .chargen-dm-review-retire-modal {
      max-width: 32rem;
      padding: 1.2rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 6px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
    }
    .chargen-dm-review-retire-modal::backdrop {
      background: rgba(0, 0, 0, 0.4);
    }
    .chargen-dm-review-retire-body h3 {
      margin: 0 0 0.5rem;
    }
    .chargen-dm-review-retire-label {
      display: block;
      margin: 0.7rem 0;
    }
    .chargen-dm-review-retire-reason-text {
      display: block;
      width: 100%;
      margin-top: 0.3rem;
      padding: 0.4rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      box-sizing: border-box;
    }
    .chargen-dm-review-retire-fieldset {
      margin: 0.6rem 0;
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
    }
    .chargen-dm-review-retire-fieldset legend {
      padding: 0 0.4rem;
      font-size: 0.85em;
    }
    .chargen-dm-review-retire-fieldset label {
      display: inline-block;
      margin-right: 1rem;
    }
    .chargen-dm-review-retire-actions {
      display: flex;
      gap: 0.4rem;
      justify-content: flex-end;
      margin-top: 0.8rem;
    }
    .chargen-dm-review-retire-cancel,
    .chargen-dm-review-retire-commit {
      padding: 0.4rem 0.85rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .chargen-dm-review-retire-commit {
      border-color: light-dark(#dc2626, #f87171);
      background: light-dark(#fee2e2, #450a0a);
      color: light-dark(#dc2626, #fecaca);
      font-weight: 500;
    }
    .chargen-dm-review-retire-commit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    /* Wave 3c: revise dialog */
    .chargen-dm-review-revise-modal {
      max-width: 38rem;
      padding: 1.2rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 6px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
    }
    .chargen-dm-review-revise-modal::backdrop {
      background: rgba(0, 0, 0, 0.4);
    }
    .chargen-dm-review-revise-body h3 {
      margin: 0 0 0.5rem;
    }
    .chargen-dm-review-revise-label {
      display: block;
      margin: 0.7rem 0;
    }
    .chargen-dm-review-revise-reason {
      display: block;
      width: 100%;
      margin-top: 0.3rem;
      padding: 0.4rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      box-sizing: border-box;
    }
    .chargen-dm-review-revise-pinset {
      margin: 0.6rem 0;
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      max-height: 18rem;
      overflow-y: auto;
    }
    .chargen-dm-review-revise-pinset legend {
      padding: 0 0.4rem;
      font-size: 0.85em;
    }
    .chargen-dm-review-revise-pin-row {
      display: grid;
      grid-template-columns: auto 1fr 2fr;
      gap: 0.5rem;
      align-items: baseline;
      padding: 0.3rem 0;
      border-bottom: 1px dashed light-dark(#e2e8f0, #334155);
    }
    .chargen-dm-review-revise-pin-row:last-child {
      border-bottom: none;
    }
    .chargen-dm-review-revise-pin-prompt {
      font-weight: 500;
    }
    .chargen-dm-review-revise-pin-answer {
      font-size: 0.88em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chargen-dm-review-revise-actions {
      display: flex;
      gap: 0.4rem;
      justify-content: flex-end;
      margin-top: 0.8rem;
    }
    .chargen-dm-review-revise-cancel,
    .chargen-dm-review-revise-commit {
      padding: 0.4rem 0.85rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .chargen-dm-review-revise-commit {
      border-color: light-dark(#0b3d7f, #79b8f0);
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      font-weight: 500;
    }
    .chargen-dm-review-revise-cancel:hover,
    .chargen-dm-review-revise-commit:hover {
      filter: brightness(1.08);
    }
    /* Wave 3 polish: pronoun-patch hint pip */
    .chargen-dm-review-pronoun-hint {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin: 0.4rem 0;
      padding: 0.4rem 0.7rem;
      background: light-dark(#eff6ff, #1e293b);
      border: 1px solid light-dark(#93c5fd, #3b82f6);
      border-radius: 4px;
      font-size: 0.88em;
      line-height: 1.35;
    }
    .chargen-dm-review-pronoun-hint-dismiss {
      margin-left: auto;
      padding: 0 0.4rem;
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      line-height: 1;
      opacity: 0.6;
      border-radius: 3px;
    }
    .chargen-dm-review-pronoun-hint-dismiss:hover {
      opacity: 1;
      border-color: light-dark(#0b3d7f, #79b8f0);
    }
    /* Wave 3 polish: invite-URL re-issuance note */
    .chargen-dm-review-invite-note {
      flex-basis: 100%;
      margin: 0.3rem 0 0;
      font-size: 0.82em;
      line-height: 1.4;
    }
    /* Wave 3 polish: re-sync-in-flight status line */
    .chargen-dm-review-drift-resync-status {
      margin-top: 0.5rem;
      padding-top: 0.4rem;
      border-top: 1px dashed light-dark(#facc15, #a16207);
      font-size: 0.88em;
      font-style: italic;
      opacity: 0.85;
    }
    /* Post-R5 QA-BUG-4: re-sync failure banner */
    .chargen-dm-review-drift-resync-failure {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding: 0.4rem 0.6rem;
      background: light-dark(#fee2e2, #450a0a);
      border: 1px solid light-dark(#dc2626, #f87171);
      border-radius: 4px;
      font-size: 0.88em;
    }
    .chargen-dm-review-drift-resync-failure-dismiss {
      margin-left: auto;
      padding: 0 0.4rem;
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      line-height: 1;
      opacity: 0.6;
      border-radius: 3px;
    }
    .chargen-dm-review-drift-resync-failure-dismiss:hover {
      opacity: 1;
      border-color: light-dark(#dc2626, #f87171);
    }
    /* P-R12: "joining at session N" picker (catch-up advancement) */
    .chargen-dm-review-joining-session {
      margin: 0.5rem 0;
      padding: 0.4rem 0.6rem;
      background: light-dark(#f8fafc, #1e293b);
      border: 1px dashed light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      font-size: 0.88em;
    }
    .chargen-dm-review-joining-session label {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .chargen-dm-review-joining-input {
      width: 4rem;
      padding: 0.2rem 0.35rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      font: inherit;
      text-align: center;
    }
    .chargen-dm-review-joining-hint {
      font-size: 0.9em;
      font-style: italic;
    }
    /* P-R5: Stage tab bar (Scene | Roster) */
    .stage-tabs {
      display: flex;
      gap: 0.4rem;
      margin: 0 0 0.6rem;
      padding: 0.3rem 0;
      border-bottom: 1px solid light-dark(#e2e8f0, #1e293b);
    }
    .stage-tab {
      padding: 0.4rem 0.85rem;
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      border-radius: 4px 4px 0 0;
    }
    .stage-tab:hover {
      background: light-dark(#f1f5f9, #1e293b);
    }
    .stage-tab-active {
      border-color: light-dark(#cbd5e1, #475569);
      border-bottom-color: light-dark(#ffffff, #0f172a);
      background: light-dark(#ffffff, #0f172a);
      margin-bottom: -1px;
      font-weight: 500;
    }
    /* P-R5: Stage roster region */
    .stage-roster {
      padding: 0.7rem 0.9rem;
    }
    .stage-roster-head {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 0.6rem;
    }
    .stage-roster-head h2 {
      margin: 0;
      font-size: 1.1rem;
    }
    .stage-roster-tabs {
      display: flex;
      gap: 0.3rem;
      margin-left: auto;
    }
    .stage-roster-tab {
      padding: 0.3rem 0.6rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 0.88em;
      border-radius: 3px;
    }
    .stage-roster-tab:hover {
      background: light-dark(#f1f5f9, #1e293b);
    }
    .stage-roster-tab-active {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#0b3d7f, #79b8f0);
      color: light-dark(#0b3d7f, #dbeafe);
      font-weight: 500;
    }
    .stage-roster-tab-count {
      display: inline-block;
      margin-left: 0.3rem;
      padding: 0 0.4rem;
      background: light-dark(#e2e8f0, #1e293b);
      border-radius: 999px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .stage-roster-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .stage-roster-item {
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#d4d4d4, #3a3a3a);
      border-radius: 6px;
      background: light-dark(#fafafa, #1d1d1d);
    }
    .stage-roster-active-body {
      margin-top: 0.4rem;
    }
    .stage-roster-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-bottom: 0.35rem;
    }
    .stage-roster-tag-chip {
      padding: 0.1rem 0.5rem;
      background: light-dark(#e2e8f0, #1e293b);
      border-radius: 999px;
      font-size: 0.85em;
    }
    .stage-roster-status {
      display: flex;
      gap: 0.7rem;
      font-size: 0.85em;
    }
    .stage-roster-stat {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.1rem 0.45rem;
      border-radius: 3px;
      background: light-dark(#f1f5f9, #1e293b);
    }
    .stage-roster-stat-level-2 {
      background: light-dark(#fef3c7, #422006);
    }
    .stage-roster-stat-level-3 {
      background: light-dark(#fee2e2, #450a0a);
      color: light-dark(#dc2626, #fecaca);
    }
    .stage-roster-stat-level-4 {
      background: light-dark(#dc2626, #450a0a);
      color: light-dark(#ffffff, #fecaca);
      font-weight: 600;
    }
    /* Task #295: DM-private soft-notes editor on Active tiles.
       Amber-left-border matches the DM-only convention used in the
       chat-spoiler-lint modal + ai-card-dm.  Players never see this
       block (host gates render). */
    .stage-roster-dmnotes {
      margin-top: 0.45rem;
      padding-top: 0.4rem;
      border-top: 1px dashed light-dark(#cbd5e1, #334155);
    }
    .stage-roster-dmnotes-toggle {
      padding: 0.2rem 0.55rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82em;
    }
    .stage-roster-dmnotes-toggle-filled {
      border-color: light-dark(#d97706, #f59e0b);
      color: light-dark(#92400e, #fbbf24);
      font-weight: 500;
    }
    .stage-roster-dmnotes-text {
      display: block;
      width: 100%;
      margin-top: 0.35rem;
      padding: 0.45rem;
      box-sizing: border-box;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-left: 3px solid light-dark(#d97706, #f59e0b);
      background: light-dark(#fffbeb, #1c1917);
      color: inherit;
      border-radius: 3px;
      resize: vertical;
    }
    .stage-roster-empty {
      padding: 0.7rem;
      font-style: italic;
      text-align: center;
    }
    .stage-roster-retire-reason {
      margin: 0.4rem 0 0;
      font-size: 0.9em;
    }
    /* P-R4: in-session compact roster strip (DM aside) */
    .dm-roster-strip {
      padding: 0.5rem 0.7rem;
      margin-bottom: 0.6rem;
    }
    .dm-roster-strip-head {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
    }
    .dm-roster-strip-head h3 {
      margin: 0;
      font-size: 0.95rem;
    }
    .dm-roster-strip-add {
      margin-left: auto;
      padding: 0 0.5rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 1.1em;
      line-height: 1;
      border-radius: 4px;
    }
    .dm-roster-strip-add:hover {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#0b3d7f, #79b8f0);
    }
    .dm-roster-strip-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .dm-roster-strip-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.4rem;
      border-radius: 3px;
      background: light-dark(#fafafa, #1d1d1d);
      font-size: 0.88em;
    }
    .dm-roster-strip-row-dim {
      opacity: 0.55;
    }
    .dm-roster-strip-pill {
      flex-shrink: 0;
      padding: 0.05rem 0.4rem;
      background: light-dark(#e2e8f0, #1e293b);
      border-radius: 999px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .dm-roster-strip-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dm-roster-strip-stat {
      flex-shrink: 0;
      padding: 0 0.35rem;
      border-radius: 3px;
      background: light-dark(#f1f5f9, #1e293b);
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
    }
    .dm-roster-strip-stat-level-2 {
      background: light-dark(#fef3c7, #422006);
    }
    .dm-roster-strip-stat-level-3 {
      background: light-dark(#fee2e2, #450a0a);
      color: light-dark(#dc2626, #fecaca);
    }
    .dm-roster-strip-stat-level-4 {
      background: light-dark(#dc2626, #450a0a);
      color: light-dark(#ffffff, #fecaca);
      font-weight: 600;
    }
    .dm-roster-strip-state {
      flex-shrink: 0;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      font-size: 0.78em;
      font-weight: 500;
    }
    .dm-roster-strip-state-retired {
      background: light-dark(#fef3c7, #422006);
      color: light-dark(#92400e, #fcd34d);
    }
    .dm-roster-strip-state-archived {
      background: light-dark(#e2e8f0, #1e293b);
      color: light-dark(#475569, #94a3b8);
    }
    .dm-roster-strip-empty {
      margin: 0;
      padding: 0.3rem 0;
      font-style: italic;
      font-size: 0.88em;
    }
    /* Wave 2: conditional party-stats nudge */
    .chargen-dm-review-party-nudge {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin: 0 0 0.7rem;
      padding: 0.5rem 0.75rem;
      background: light-dark(#fffbeb, #1c1917);
      border: 1px solid light-dark(#fcd34d, #78350f);
      border-radius: 4px;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .chargen-dm-review-party-nudge-glyph {
      flex-shrink: 0;
      font-size: 1.1em;
    }
    .chargen-dm-review-seat-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .chargen-dm-review-seat-actions button {
      padding: 0.35rem 0.7rem;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
    }
    .chargen-dm-review-seat-actions button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    /* Pack import: <label> wrapping a hidden <input type="file">
       gives the file picker a button-shaped affordance that
       matches the sibling buttons in the actions row. */
    .chargen-dm-review-import-label {
      padding: 0.35rem 0.7rem;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }
    .chargen-dm-review-import-label[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .chargen-dm-review-import-input {
      /* Hide the native input but keep it focusable for keyboard
         users; clicking the <label> opens the picker. */
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .chargen-dm-review-import-status {
      margin-top: 0.4rem;
      padding: 0.35rem 0.6rem;
      border-radius: 4px;
      font-size: 0.88rem;
    }
    .chargen-dm-review-import-status-ok {
      background: light-dark(#ecfdf5, #022c22);
      color: light-dark(#0f5132, #4ade80);
      border-left: 3px solid light-dark(#16a34a, #4ade80);
    }
    .chargen-dm-review-import-status-err {
      background: light-dark(#fef2f2, #2a0e0e);
      color: light-dark(#7f1d1d, #fca5a5);
      border-left: 3px solid light-dark(#dc2626, #ef4444);
    }
    /* #253: live pack delivery pip — blue-rail accent (distinct from
       the green/red of import-status, so the DM scans "incoming live
       pack" at a glance). */
    .chargen-dm-review-pending-pack {
      margin-top: 0.5rem;
      padding: 0.45rem 0.7rem;
      border-radius: 4px;
      background: light-dark(#eff6ff, #0b1d3a);
      border-left: 3px solid light-dark(#0369a1, #38bdf8);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .chargen-dm-review-pending-pack-actions {
      display: flex;
      gap: 0.4rem;
      margin-left: auto;
    }
    .chargen-dm-review-pending-pack-accept,
    .chargen-dm-review-pending-pack-dismiss {
      padding: 0.25rem 0.7rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
    }
    .chargen-dm-review-pending-pack-accept {
      border-color: light-dark(#0369a1, #38bdf8);
      background: light-dark(#dbeafe, #082f49);
      color: light-dark(#0369a1, #bae6fd);
      font-weight: 500;
    }
    /* #254: AI complementarity hints in the quick-gen form. */
    .chargen-dm-review-complement-btn,
    .chargen-dm-review-complement-retry {
      padding: 0.3rem 0.7rem;
      border: 1px dashed light-dark(#7c3aed, #a78bfa);
      background: transparent;
      color: light-dark(#5b21b6, #c4b5fd);
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
      align-self: flex-start;
    }
    .chargen-dm-review-complement-loading {
      font-style: italic;
      font-size: 0.9em;
      margin: 0.3rem 0;
    }
    .chargen-dm-review-complement-failed {
      color: light-dark(#7f1d1d, #fca5a5);
      font-size: 0.88em;
      margin: 0.3rem 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: baseline;
    }
    .chargen-dm-review-complement-chips {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin: 0.45rem 0;
    }
    .chargen-dm-review-complement-label {
      font-size: 0.85em;
      margin: 0 0 0.2rem;
    }
    .chargen-dm-review-complement-chip {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-left: 3px solid light-dark(#7c3aed, #a78bfa);
      background: light-dark(#f5f3ff, #1e1b2e);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.88em;
    }
    .chargen-dm-review-complement-chip:hover {
      background: light-dark(#ede9fe, #2e1b4e);
    }

    /* #253: player-side "Send to DM" button — distinct from the
       file-download button. */
    .character-creation-send-button {
      padding: 0.4rem 0.9rem;
      border: 1px solid light-dark(#0369a1, #38bdf8);
      background: light-dark(#dbeafe, #082f49);
      color: light-dark(#0369a1, #bae6fd);
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-weight: 500;
    }
    /* Drag-drop hover state on the seat — outline + tint so the DM
       sees which seat will receive the dropped pack. */
    .chargen-dm-review-seat-dragover {
      outline: 2px dashed light-dark(#0b3d7f, #79b8f0);
      outline-offset: -2px;
      background: light-dark(#dbeafe, #0c1d3a);
    }
    /* Quick-generate inline form (per-seat). */
    .chargen-dm-review-quickgen-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding: 0.6rem 0.7rem;
      background: light-dark(#f8fafc, #0f172a);
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #334155);
    }
    .chargen-dm-review-quickgen-field {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.88rem;
    }
    .chargen-dm-review-quickgen-field span {
      font-weight: 500;
      color: light-dark(#475569, #94a3b8);
    }
    .chargen-dm-review-quickgen-field input,
    .chargen-dm-review-quickgen-field textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0b1220);
      color: inherit;
      font-family: inherit;
      font-size: 0.95em;
    }
    .chargen-dm-review-quickgen-field textarea {
      resize: vertical;
      min-height: 3rem;
    }
    .chargen-dm-review-quickgen-submit {
      align-self: flex-start;
      padding: 0.35rem 0.85rem;
      border-radius: 4px;
      border: 1px solid light-dark(#0b3d7f, #79b8f0);
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      cursor: pointer;
      font-weight: 500;
    }
    .chargen-dm-review-quickgen-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .chargen-dm-review-invite-result {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.4rem;
      flex-wrap: wrap;
    }
    .chargen-dm-review-invite-url {
      flex: 1 1 18ch;
      min-width: 0;
      padding: 0.3rem 0.5rem;
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
      font-size: 0.85em;
    }
    .chargen-dm-review-invite-copied {
      color: light-dark(#16803d, #4ade80);
      font-size: 0.85em;
    }
    .chargen-dm-review-synth {
      margin-top: 0.5rem;
      padding: 0.5rem 0.7rem;
      border-radius: 4px;
      font-size: 0.92rem;
    }
    .chargen-dm-review-synth-ok {
      background: light-dark(#ecfdf5, #022c22);
      border-left: 3px solid light-dark(#16a34a, #4ade80);
    }
    .chargen-dm-review-synth-warnings {
      color: light-dark(#92400e, #fcd34d);
      margin-top: 0.2rem;
    }
    /* Run #19 UX-MH-1: player-name beneath the PC name (two-line stack
       per TTRPG/UX expert R-B).  Muted weight so the play-loop
       eye-scan still keys on the PC name; player name is the
       contextual anchor below. */
    .chargen-dm-review-player-name {
      font-size: 0.85rem;
      color: light-dark(#475569, #94a3b8);
      margin-top: 0.1rem;
    }
    /* Run #19 UX-MH-4: splitter handles inside the shell's
       splitter-rail / splitter-aside slot.  6 px hit-target, 1 px
       hairline rule painted as an inset shadow so the box never
       resizes (drag math would skew on hover); 2 px accent rule on
       hover/focus/drag.  Cursor + tab-stop so keyboard users can
       reach the handles per the visual designer A11y spec. */
    button.region-splitter {
      width: 100%;
      height: 100%;
      background: transparent;
      border: 0;
      padding: 0;
      margin: 0;
      cursor: col-resize;
      box-shadow: inset 1px 0 0 0
        light-dark(rgba(15, 23, 42, 0.12), rgba(226, 232, 240, 0.12));
      transition: box-shadow var(--motion-hover);
      touch-action: none; /* avoid scroll-snap interference on touch */
    }
    button.region-splitter:hover,
    button.region-splitter:focus-visible,
    button.region-splitter[data-dragging] {
      box-shadow: inset 2px 0 0 0 var(--accent-teal);
      outline: none;
    }
    /* Reset-all-panel-widths affordance lives in the DM operational
       view's destructive-actions area (per visual designer R-H open
       call #2).  The button reuses the existing destructive-action
       button styling — no per-button CSS needed here. */
    .chargen-dm-review-synth-accepted {
      margin-top: 0.2rem;
      font-style: italic;
      color: light-dark(#16803d, #86efac);
    }
    .chargen-dm-review-synth-err {
      background: light-dark(#fef2f2, #2a0a0a);
      border-left: 3px solid light-dark(#dc2626, #f87171);
    }
    .chargen-dm-review-synth-spoiler {
      background: light-dark(#fff8e6, #2a2310);
      border-left: 3px solid light-dark(#cc8a00, #d4a73a);
    }
    .chargen-dm-review-synth-message {
      color: light-dark(#374151, #cbd5e1);
      font-size: 0.88em;
      margin-top: 0.2rem;
    }
    /* CC-24 + P3T-19: accept / revise action buttons under each
       result card.  Accept is the primary action (filled green);
       revise is secondary (bordered, neutral). */
    .chargen-dm-review-synth-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.5rem;
    }
    /* D5-D (2026-05-27): bond-count discoverability pip on
     * accepted chargen-dm-review slot cards. */
    .chargen-dm-review-bond-pip {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      font-size: 0.78rem;
      color: light-dark(#1d4ed8, #93c5fd);
      background: light-dark(#dbeafe, #1e3a8a);
      border: 1px solid light-dark(#60a5fa, #3b82f6);
      border-radius: 3px;
      align-self: center;
    }
    .chargen-dm-review-accept {
      padding: 0.35rem 0.85rem;
      border: 1px solid light-dark(#16a34a, #4ade80);
      background: light-dark(#16a34a, #166534);
      color: light-dark(#f0fdf4, #dcfce7);
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
    }
    .chargen-dm-review-accept:hover:not(:disabled) {
      background: light-dark(#15803d, #15803d);
    }
    .chargen-dm-review-accept:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .chargen-dm-review-revise {
      padding: 0.35rem 0.85rem;
      border: 1px solid light-dark(#9ca3af, #4b5563);
      background: transparent;
      color: light-dark(#374151, #d1d5db);
      border-radius: 4px;
      cursor: pointer;
    }
    .chargen-dm-review-revise:hover:not(:disabled) {
      background: light-dark(#f3f4f6, #1f2937);
    }

    /* Step 5: full review card pieces — chips, stat grid, expand
       button, diff view. */
    .chargen-dm-review-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin: 0.4rem 0;
    }
    .chargen-dm-review-chip {
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      background: light-dark(#e0e7ff, #1e1b4b);
      color: light-dark(#3730a3, #c7d2fe);
      font-size: 0.82em;
    }
    .chargen-dm-review-chip-skill {
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#14532d, #bbf7d0);
    }
    .chargen-dm-review-stat-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.25rem;
      margin: 0.4rem 0;
    }
    .chargen-dm-review-stat-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.25rem 0.3rem;
      border: 1px solid light-dark(#d4d4d4, #3a3a3a);
      border-radius: 4px;
      background: light-dark(#ffffff, #1a1a1a);
    }
    .chargen-dm-review-stat-label {
      font-size: 0.68em;
      letter-spacing: 0.05em;
      opacity: 0.7;
    }
    .chargen-dm-review-stat-mod {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .chargen-dm-review-warning-list {
      margin: 0.3rem 0 0;
      padding-left: 1.3rem;
      font-size: 0.85em;
    }
    .chargen-dm-review-warning-list code {
      background: light-dark(#fff7ed, #422006);
      padding: 0.05rem 0.3rem;
      border-radius: 3px;
      font-size: 0.92em;
    }
    .chargen-dm-review-expand {
      margin: 0.4rem 0;
      padding: 0.25rem 0.6rem;
      background: transparent;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      color: light-dark(#475569, #cbd5e1);
      font-size: 0.85em;
      cursor: pointer;
    }
    .chargen-dm-review-expand:hover {
      background: light-dark(#f1f5f9, #1e293b);
    }
    .chargen-dm-review-diff {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
      gap: 0.8rem;
      margin: 0.4rem 0;
      padding: 0.6rem;
      border: 1px dashed light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      background: light-dark(#f8fafc, #0f172a);
    }
    .chargen-dm-review-diff h4 {
      margin: 0 0 0.4rem;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.7;
    }
    .chargen-dm-review-diff dl {
      display: block;
      margin: 0;
      font-size: 0.88em;
    }
    .chargen-dm-review-diff dt {
      font-weight: 500;
      margin-top: 0.3rem;
    }
    .chargen-dm-review-diff dd {
      margin: 0 0 0.3rem 0;
      color: light-dark(#475569, #cbd5e1);
    }
    /* Gap B: DM-only amber spoiler chip on a player's Q&A answer.
       Same treatment as the bond spoiler chip. */
    .chargen-dm-review-answer-spoiler {
      display: inline-block;
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.75em;
      color: light-dark(#7c2d12, #fbbf24);
      background: light-dark(#fef3c7, #422006);
      border: 1px solid light-dark(#f59e0b, #92660e);
    }
    .chargen-dm-review-backstory-body p {
      margin: 0 0 0.4rem;
      font-size: 0.92em;
      line-height: 1.5;
    }
    .chargen-dm-review-mark {
      background: light-dark(#fef9c3, #422006);
      color: inherit;
      padding: 0 0.1rem;
      border-radius: 2px;
    }
    @media (max-width: 900px) {
      .chargen-dm-review-diff {
        grid-template-columns: 1fr;
      }
    }

    /* Phase 3b polish (2026-05-22): "Review backstory + answers"
       moved from inline-expand into a centered <dialog> overlay so
       the DM gets the full window width to read the side-by-side
       diff (the DM aside column is too narrow for two columns of
       prose).  Caps at 92vw / 85vh with internal scroll on the
       body so the sticky header + footer stay visible on long
       backstories.  ::backdrop dims the page; the dialog itself
       handles the focus trap. */
    dialog.chargen-dm-review-modal {
      /* Phase 3b polish (2026-05-23): same responsive sizing as
         the edit modal — scales with viewport, capped so it isn't
         a tiny dialog on a 27-inch screen or a ribbon on a 12-inch laptop.
         Review modal is slightly wider (1300px max vs edit's
         1200px) because it shows side-by-side Q&A + backstory. */
      width: clamp(min(92vw, 700px), 75vw, 1300px);
      max-height: min(90vh, 900px);
      padding: 0;
      border: 1px solid light-dark(#cbd5e1, #334155);
      border-radius: 8px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      /* Recent Chromium centers <dialog> automatically; older
         flavors used margin: auto.  Keep both as belt-and-braces. */
      margin: auto;
    }
    dialog.chargen-dm-review-modal::backdrop {
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(2px);
    }
    .chargen-dm-review-modal-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.7rem 1rem;
      border-bottom: 1px solid light-dark(#e2e8f0, #1e293b);
      background: light-dark(#f8fafc, #0b1220);
      /* Sticky inside the flex column — keeps the title visible as
         the body scrolls.  position: sticky on the head works
         because the dialog itself has overflow: hidden and the body
         has overflow-y: auto, so the body is the scroll viewport. */
      flex: 0 0 auto;
    }
    .chargen-dm-review-modal-title {
      margin: 0;
      font-size: 1.05em;
      flex: 1 1 auto;
      min-width: 0;
    }
    .chargen-dm-review-modal-close {
      flex: 0 0 auto;
      border: 1px solid transparent;
      background: transparent;
      font-size: 1.4em;
      line-height: 1;
      padding: 0.1rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      color: inherit;
    }
    .chargen-dm-review-modal-close:hover {
      background: light-dark(#e2e8f0, #1e293b);
    }
    .chargen-dm-review-modal-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 0.8rem 1rem;
    }
    /* Inside the modal the diff has plenty of width, so don't
       collapse to single-column until much narrower than the
       global 900px breakpoint. */
    .chargen-dm-review-modal-body .chargen-dm-review-diff {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 0.9fr);
      border: none;
      background: transparent;
      padding: 0;
      margin: 0;
    }
    @media (max-width: 980px) {
      .chargen-dm-review-modal-body .chargen-dm-review-diff {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
      }
      .chargen-dm-review-modal-body .chargen-dm-review-modal-provenance {
        grid-column: 1 / -1;
        border-left: none;
        border-top: 1px solid light-dark(#e2e8f0, #334155);
        padding-left: 0;
        padding-top: 0.6rem;
      }
    }
    @media (max-width: 700px) {
      .chargen-dm-review-modal-body .chargen-dm-review-diff {
        grid-template-columns: 1fr;
      }
    }
    .chargen-dm-review-modal-foot {
      flex: 0 0 auto;
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.6rem 1rem;
      border-top: 1px solid light-dark(#e2e8f0, #1e293b);
      background: light-dark(#f8fafc, #0b1220);
    }
    .chargen-dm-review-modal-foot button {
      padding: 0.35rem 0.9rem;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      cursor: pointer;
    }

    /* Phase 3b polish (2026-05-23): spoiler-leak failure card.
       The leaked words show as red chips so the DM sees at a
       glance which words triggered the firewall.  "Edit + accept"
       is the primary action — preserves the salvageable backstory.
       "Discard + try again" is secondary. */
    .chargen-dm-review-spoiler-tokens {
      list-style: none;
      padding: 0;
      margin: 0.4rem 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
    .chargen-dm-review-spoiler-token {
      padding: 0.1rem 0.55rem;
      border-radius: 999px;
      background: light-dark(#fef2f2, #2a0e0e);
      color: light-dark(#7f1d1d, #fca5a5);
      border: 1px solid light-dark(#fca5a5, #7f1d1d);
      font-size: 0.85em;
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
    }
    .chargen-dm-review-spoiler-token-inline {
      color: light-dark(#7f1d1d, #fca5a5);
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
    }
    .chargen-dm-review-rejected-preview {
      margin-top: 0.5rem;
      padding: 0.5rem 0.6rem;
      border-radius: 4px;
      background: light-dark(#ffffff, #0b1220);
      border: 1px dashed light-dark(#cbd5e1, #334155);
    }
    .chargen-dm-review-edit-accept {
      padding: 0.35rem 0.85rem;
      border-radius: 4px;
      border: 1px solid light-dark(#0b3d7f, #79b8f0);
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      cursor: pointer;
      font-weight: 500;
    }
    .chargen-dm-review-edit-accept:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .chargen-dm-review-discard {
      padding: 0.35rem 0.7rem;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
    }
    /* Phase B P2 (2026-05-26): terse Phase-B field chips on the
       chargen seat tile + the "Inferred N fields" pip.  Full editors
       live in the review modal's third (Provenance) column. */
    .chargen-dm-review-phaseb {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.75rem;
      margin-top: 0.35rem;
      font-size: 0.85rem;
    }
    .chargen-dm-review-phaseb-row {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .chargen-dm-review-phaseb-label {
      color: light-dark(#475569, #94a3b8);
      font-weight: 500;
    }
    .chargen-dm-review-phaseb-chip {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 3px;
      background: light-dark(#f1f5f9, #1e293b);
      color: light-dark(#0f172a, #e2e8f0);
      border: 1px solid light-dark(#e2e8f0, #334155);
    }
    .chargen-dm-review-phaseb-chip-money[data-band='broke'] {
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fecaca);
      border-color: light-dark(#fca5a5, #991b1b);
    }
    .chargen-dm-review-phaseb-chip-money[data-band='tight'] {
      background: light-dark(#fef3c7, #78350f);
      color: light-dark(#78350f, #fde68a);
      border-color: light-dark(#fde68a, #92400e);
    }
    .chargen-dm-review-phaseb-chip-money[data-band='comfortable'] {
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#14532d, #bbf7d0);
      border-color: light-dark(#bbf7d0, #166534);
    }
    .chargen-dm-review-phaseb-chip-money[data-band='well-off'],
    .chargen-dm-review-phaseb-chip-money[data-band='wealthy'] {
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#1e40af, #bfdbfe);
      border-color: light-dark(#bfdbfe, #1d4ed8);
    }
    .chargen-dm-review-phaseb-more {
      color: light-dark(#64748b, #94a3b8);
      font-style: italic;
    }
    .chargen-dm-review-phaseb-pip {
      margin-left: auto;
      padding: 0.15rem 0.5rem;
      border-radius: 3px;
      background: light-dark(#eef2ff, #1e1b4b);
      color: light-dark(#3730a3, #c7d2fe);
      border: 1px dashed light-dark(#c7d2fe, #4338ca);
      font-size: 0.8rem;
      cursor: pointer;
    }
    .chargen-dm-review-phaseb-pip:hover {
      background: light-dark(#e0e7ff, #312e81);
    }
    .chargen-dm-review-phaseb-pip:focus-visible {
      outline: 2px solid light-dark(#3730a3, #818cf8);
      outline-offset: 1px;
    }
    /* Phase B P2 verification fix (S2): race-mismatch banner shown
       when the DM tries to Accept but a re-sync has replaced the
       synth result mid-review. */
    .chargen-dm-review-race-banner {
      margin: 0.5rem 0;
      padding: 0.5rem 0.6rem;
      border-radius: 4px;
      background: light-dark(#fef3c7, #78350f);
      color: light-dark(#78350f, #fde68a);
      border: 1px solid light-dark(#fde68a, #92400e);
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .chargen-dm-review-race-banner strong {
      flex: 0 0 auto;
    }
    .chargen-dm-review-race-dismiss {
      margin-left: auto;
      padding: 0.15rem 0.5rem;
      border-radius: 3px;
      background: light-dark(#ffffff, #0f172a);
      color: light-dark(#78350f, #fde68a);
      border: 1px solid light-dark(#fde68a, #92400e);
      cursor: pointer;
      font-size: 0.78rem;
    }
    /* Provenance column inside the review modal (Phase B P2). */
    .chargen-dm-review-modal-provenance {
      border-left: 1px solid light-dark(#e2e8f0, #334155);
      padding-left: 1rem;
      font-size: 0.85rem;
      color: light-dark(#334155, #cbd5e1);
    }
    .chargen-dm-review-modal-provenance-field {
      margin-bottom: 0.75rem;
    }
    .chargen-dm-review-modal-provenance-field strong {
      display: block;
      margin-bottom: 0.2rem;
      color: light-dark(#0f172a, #f1f5f9);
    }
    .chargen-dm-review-prov-chip {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 3px;
      font-size: 0.78rem;
      margin-right: 0.3rem;
      vertical-align: middle;
    }
    .chargen-dm-review-prov-chip[data-prov='sourced'] {
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#14532d, #bbf7d0);
      border: 1px solid light-dark(#bbf7d0, #166534);
    }
    .chargen-dm-review-prov-chip[data-prov='inferred'] {
      background: light-dark(#fef3c7, #78350f);
      color: light-dark(#78350f, #fde68a);
      border: 1px solid light-dark(#fde68a, #92400e);
    }
    .chargen-dm-review-prov-chip[data-prov='free'] {
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fecaca);
      border: 1px solid light-dark(#fca5a5, #991b1b);
    }
    /* Edit dialog (mirrors the review modal's outer shape).
       Phase 3b polish (2026-05-23): responsive sizing.  Prior
       sizing — width:min(92vw,900px); max-height:85vh — was
       cramped on 12-inch laptops (~900px wide) and a tall narrow
       ribbon on 27-inch displays (~900px wide × 1224px tall in a
       2560×1440 viewport).  New sizing:
         width  = clamp(min(92vw,600px), 70vw, 1200px)
                  — 600..1200px range, 70% of viewport in between.
                  At 1280px viewport: 896px.  At 2560px: 1200px.
                  At 800px viewport: 736px (≥92vw floor protects).
         height = min(90vh, 900px)
                  — at 800px viewport: 720px.  At 1440px: 900px.
       Dialog body flexes; the textarea inside uses a clamp() on
       min-height (~45vh) so it gets a generous chunk of vertical
       room.  User can still drag-resize. */
    dialog.chargen-dm-review-edit-modal {
      width: clamp(min(92vw, 600px), 70vw, 1200px);
      max-height: min(90vh, 900px);
      padding: 0;
      border: 1px solid light-dark(#cbd5e1, #334155);
      border-radius: 8px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      margin: auto;
    }
    dialog.chargen-dm-review-edit-modal::backdrop {
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(2px);
    }
    .chargen-dm-review-edit-hint {
      margin: 0 0 0.7rem;
      padding: 0.45rem 0.7rem;
      border-left: 3px solid light-dark(#dc2626, #ef4444);
      background: light-dark(#fef2f2, #2a0e0e);
      color: light-dark(#7f1d1d, #fca5a5);
      border-radius: 0 4px 4px 0;
      font-size: 0.9rem;
    }
    .chargen-dm-review-edit-field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin: 0.6rem 0;
      font-size: 0.9rem;
    }
    .chargen-dm-review-edit-field span {
      font-weight: 500;
      color: light-dark(#475569, #94a3b8);
    }
    .chargen-dm-review-edit-field input,
    .chargen-dm-review-edit-field textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem 0.55rem;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0b1220);
      color: inherit;
      font-family: inherit;
      font-size: 0.95em;
    }
    .chargen-dm-review-edit-field textarea {
      resize: vertical;
      /* Phase 3b polish (2026-05-23): give the backstory textarea a
         generous chunk of viewport height by default so the DM can
         read a 400-word backstory without scrolling.  User can
         drag-resize down if they want a smaller textarea.  Cap at
         60vh so on tall displays it doesn't push the footer off-
         screen. */
      min-height: clamp(12rem, 45vh, 60vh);
      line-height: 1.5;
    }
    .chargen-dm-review-edit-save {
      padding: 0.35rem 0.9rem;
      border-radius: 4px;
      border: 1px solid light-dark(#0b3d7f, #79b8f0);
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      cursor: pointer;
      font-weight: 500;
    }
    .chargen-dm-review-edit-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ====================================================== */
    /* Phase B P4 (2026-05-26): player-rail language chip-list. */
    .player-rail-language-chips {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
    .player-rail-language-chip {
      padding: 0.1rem 0.55rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 999px;
      background: light-dark(#f1f5f9, #1e293b);
      font-size: 0.88em;
    }

    /* Phase B P3 Tier B (2026-05-26): dm-pc-detail DM-only card. */
    .dm-pc-detail {
      border-color: light-dark(#d97706, #f59e0b);
      border-left-width: 3px;
      background: light-dark(#fffbeb, #1c1917);
    }
    .dm-pc-detail h2 {
      color: light-dark(#92400e, #fbbf24);
    }
    .dm-pc-detail-section {
      margin-top: 0.7rem;
    }
    .dm-pc-detail-section h3 {
      font-size: 0.95em;
      margin: 0 0 0.3rem;
    }
    .dm-pc-detail-row {
      margin: 0.15rem 0;
      font-size: 0.9em;
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .dm-pc-detail-label {
      font-weight: 500;
      color: light-dark(#475569, #94a3b8);
    }
    /* Wave D-prep-2-C (T-LT2 2026-05-26): pip widget collapsed
       to one-line counter — old .dm-pc-detail-drift-pip styles
       deleted with the widget.  New .dm-pc-detail-drift-due is
       the "conversation due" chip that appears at marks >= 5. */
    .dm-pc-detail-drift-due {
      display: inline-block;
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
      background: light-dark(#fef3c7, #422006);
      color: light-dark(#92400e, #fcd34d);
      border: 1px solid light-dark(#fde68a, #92400e);
      font-size: 0.8em;
      font-weight: 500;
    }
    .dm-pc-detail-grants {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .dm-pc-detail-grant {
      font-size: 0.88em;
    }
    .dm-pc-detail-grant-ts {
      font-size: 0.85em;
    }
    .dm-pc-detail-notes {
      font-size: 0.9em;
      margin: 0;
      white-space: pre-wrap;
    }
    /* Wave B (2026-05-26): foci list + magic-arc DM runtime controls. */
    .dm-pc-detail-foci {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .dm-pc-detail-focus {
      padding: 0.25rem 0;
      border-bottom: 1px dotted light-dark(#e2e8f0, #334155);
    }
    .dm-pc-detail-focus:last-child {
      border-bottom: none;
    }
    .dm-pc-detail-focus-name {
      font-weight: 500;
    }
    .dm-pc-detail-focus-domain {
      font-size: 0.85em;
    }
    .dm-pc-detail-focus-status {
      display: inline-block;
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
      font-size: 0.72em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .dm-pc-detail-focus-status[data-status='active'] {
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#14532d, #bbf7d0);
    }
    .dm-pc-detail-focus-status[data-status='broken'],
    .dm-pc-detail-focus-status[data-status='corrupted'] {
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fecaca);
    }
    .dm-pc-detail-focus-status[data-status='faded'],
    .dm-pc-detail-focus-status[data-status='transformed'] {
      background: light-dark(#fef3c7, #78350f);
      color: light-dark(#78350f, #fde68a);
    }
    .dm-pc-detail-focus-notes {
      font-size: 0.85em;
      margin: 0.2rem 0 0;
    }
    .dm-pc-detail-arc-controls {
      border-top: 1px dashed light-dark(#fde68a, #92400e);
      padding-top: 0.6rem;
      margin-top: 0.5rem;
    }
    .dm-pc-detail-arc-controls h3 {
      color: light-dark(#92400e, #fcd34d);
    }
    .dm-pc-detail-arc-row {
      padding: 0.5rem 0;
      border-bottom: 1px dotted light-dark(#e2e8f0, #334155);
    }
    .dm-pc-detail-arc-row:last-child {
      border-bottom: none;
    }
    .dm-pc-detail-arc-label {
      display: block;
      font-weight: 500;
      font-size: 0.9em;
      margin-bottom: 0.2rem;
    }
    .dm-pc-detail-arc-hint {
      display: block;
      font-size: 0.78em;
      color: light-dark(#64748b, #94a3b8);
      font-weight: 400;
      margin-top: 0.1rem;
    }
    .dm-pc-detail-arc-text {
      display: block;
      width: 100%;
      margin-top: 0.3rem;
      padding: 0.35rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      box-sizing: border-box;
      resize: vertical;
    }
    .dm-pc-detail-arc-focus-form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.3rem;
    }
    .dm-pc-detail-arc-focus-form input {
      flex: 1 1 12rem;
      min-width: 0;
      padding: 0.3rem 0.45rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
    }
    .dm-pc-detail-arc-commit {
      margin-top: 0.35rem;
      padding: 0.25rem 0.75rem;
      border-radius: 3px;
      background: light-dark(#fef3c7, #422006);
      color: light-dark(#92400e, #fcd34d);
      border: 1px solid light-dark(#fcd34d, #92400e);
      cursor: pointer;
      font-weight: 500;
    }
    .dm-pc-detail-arc-commit:hover:not(:disabled) {
      background: light-dark(#fde68a, #78350f);
    }
    .dm-pc-detail-arc-commit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .dm-pc-detail-arc-cancel {
      margin-top: 0.35rem;
      padding: 0.25rem 0.75rem;
      border-radius: 3px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      cursor: pointer;
    }
    .dm-pc-detail-arc-realize {
      margin-top: 0.2rem;
      padding: 0.4rem 0.9rem;
      border-radius: 4px;
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      border: 1px solid light-dark(#93c5fd, #2563eb);
      cursor: pointer;
      font-weight: 500;
    }
    .dm-pc-detail-arc-realize:hover {
      background: light-dark(#bfdbfe, #1e40af);
    }
    .dm-pc-detail-arc-confirm {
      background: light-dark(#fffbeb, #1c1917);
      padding: 0.5rem;
      border-radius: 4px;
      border-left: 3px solid light-dark(#f59e0b, #b45309);
    }
    .dm-pc-detail-arc-confirm-actions {
      display: flex;
      gap: 0.4rem;
      margin-top: 0.5rem;
    }

    /* Phase B P5 (2026-05-26): session-wrap-marks end-of-session sheet. */
    .session-wrap-marks-head {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin: 0 0 0.6rem;
    }
    .session-wrap-marks-exit {
      margin-left: auto;
      padding: 0.3rem 0.8rem;
      border: 1px solid light-dark(#0369a1, #38bdf8);
      background: light-dark(#dbeafe, #082f49);
      color: light-dark(#0369a1, #bae6fd);
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
    }
    .session-wrap-marks-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }
    .session-wrap-marks-pc {
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 6px;
      background: light-dark(#fafafa, #1d1d1d);
    }
    .session-wrap-marks-pc-head {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      margin-bottom: 0.4rem;
    }
    .session-wrap-marks-counter {
      margin-left: auto;
      font-size: 0.85em;
      color: light-dark(#475569, #94a3b8);
    }
    .session-wrap-marks-counter-ready {
      color: light-dark(#15803d, #4ade80);
      font-weight: 500;
    }
    .session-wrap-marks-bullets {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .session-wrap-marks-bullet-label {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      cursor: pointer;
    }
    .session-wrap-marks-bullet-checked {
      color: light-dark(#15803d, #4ade80);
    }

    /* D4 (2026-05-26): session-digest panel — mounts as a sibling
       of session-wrap-marks during the wrap flow.  Editable for
       the coord; read-only "prior digests" list for players. */
    .session-digest {
      margin: 0.8rem 0 0;
      padding: 0.8rem 1rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 6px;
      background: light-dark(#fefce8, #1a1c0c);
    }
    .session-digest-head {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      margin: 0 0 0.6rem;
      flex-wrap: wrap;
    }
    .session-digest-head h3 {
      margin: 0;
    }
    .session-digest-hint {
      font-size: 0.85rem;
    }
    .session-digest-prior {
      margin: 0 0 0.8rem;
      padding: 0.6rem;
      background: light-dark(#ffffff, #0f172a);
      border: 1px solid light-dark(#e2e8f0, #334155);
      border-radius: 4px;
    }
    .session-digest-prior h4 {
      margin: 0 0 0.3rem;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: light-dark(#475569, #94a3b8);
    }
    .session-digest-prior-ts {
      font-size: 0.78rem;
      margin: 0 0 0.3rem;
    }
    .session-digest-prior-md {
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .session-digest-prior-md p {
      margin: 0 0 0.6rem;
    }
    .session-digest-prior-md p:last-child {
      margin-bottom: 0;
    }
    .session-digest-prior-md h1,
    .session-digest-prior-md h2,
    .session-digest-prior-md h3,
    .session-digest-prior-md h4 {
      font-size: 1rem;
      margin: 0.6rem 0 0.3rem;
    }
    .session-digest-prior-md ul,
    .session-digest-prior-md ol {
      margin: 0 0 0.6rem;
      padding-left: 1.2rem;
    }
    .session-digest-prior-older {
      margin-top: 0.5rem;
      font-size: 0.85rem;
    }
    .session-digest-prior-older summary {
      cursor: pointer;
    }
    .session-digest-error {
      margin: 0 0 0.6rem;
      padding: 0.4rem 0.6rem;
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fecaca);
      border: 1px solid light-dark(#fca5a5, #991b1b);
      border-radius: 3px;
      font-size: 0.88rem;
    }
    .session-digest-label {
      display: block;
      font-weight: 500;
      font-size: 0.9rem;
      margin-bottom: 0.3rem;
    }
    .session-digest-draft {
      display: block;
      width: 100%;
      margin-top: 0.3rem;
      padding: 0.5rem;
      font: inherit;
      font-size: 0.95rem;
      line-height: 1.45;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      box-sizing: border-box;
      resize: vertical;
    }
    .session-digest-actions {
      display: flex;
      gap: 0.4rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }
    .session-digest-generate {
      padding: 0.35rem 0.85rem;
      border-radius: 4px;
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#0b3d7f, #dbeafe);
      border: 1px solid light-dark(#93c5fd, #2563eb);
      cursor: pointer;
      font-weight: 500;
    }
    .session-digest-generate:hover:not(:disabled) {
      background: light-dark(#bfdbfe, #1e40af);
    }
    .session-digest-generate:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .session-digest-save {
      padding: 0.35rem 0.85rem;
      border-radius: 4px;
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#14532d, #bbf7d0);
      border: 1px solid light-dark(#86efac, #15803d);
      cursor: pointer;
      font-weight: 500;
    }
    .session-digest-save:hover:not(:disabled) {
      background: light-dark(#bbf7d0, #15803d);
    }
    .session-digest-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .session-digest-discard {
      padding: 0.35rem 0.7rem;
      border-radius: 4px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      cursor: pointer;
    }

    /* D1-C (2026-05-26): wrap-stepper shell. */
    .wrap-stepper {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      padding: 0.5rem 0;
    }
    .wrap-stepper-breadcrumb {
      border-bottom: 1px solid light-dark(#e2e8f0, #334155);
      padding-bottom: 0.4rem;
    }
    .wrap-stepper-breadcrumb ol {
      display: flex;
      gap: 0.4rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .wrap-stepper-crumb-button {
      padding: 0.3rem 0.7rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.88rem;
    }
    .wrap-stepper-crumb-current .wrap-stepper-crumb-button {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
      cursor: default;
    }
    .wrap-stepper-crumb-past .wrap-stepper-crumb-button {
      opacity: 0.7;
    }
    .wrap-stepper-crumb-index {
      margin-right: 0.25rem;
      color: light-dark(#64748b, #94a3b8);
    }
    .wrap-stepper-blurb {
      margin: 0;
      font-size: 0.88rem;
    }
    .wrap-stepper-footer {
      border-top: 1px solid light-dark(#e2e8f0, #334155);
      padding-top: 0.4rem;
      margin-top: 0.4rem;
    }
    .wrap-stepper-nav {
      display: flex;
      justify-content: space-between;
      gap: 0.4rem;
    }
    .wrap-stepper-back,
    .wrap-stepper-next,
    .wrap-stepper-finish {
      padding: 0.35rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.9em;
    }
    .wrap-stepper-finish {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
    }
    .wrap-stepper-back:disabled,
    .wrap-stepper-next:disabled,
    .wrap-stepper-finish:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* D1-D (2026-05-26): diff-review-stage 3-pane layout. */
    .diff-review-stage {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .diff-review-header {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .diff-review-header h3 {
      margin: 0;
    }
    .diff-review-actions {
      display: flex;
      gap: 0.4rem;
    }
    .diff-review-generate {
      padding: 0.35rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .diff-review-status {
      margin: 0;
      font-size: 0.85rem;
      color: light-dark(#64748b, #94a3b8);
    }
    .diff-review-error {
      margin: 0;
      padding: 0.4rem 0.6rem;
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fecaca);
      border: 1px solid light-dark(#fca5a5, #991b1b);
      border-radius: 3px;
      font-size: 0.88rem;
    }
    .diff-review-empty {
      padding: 1rem 0;
    }
    .diff-review-panes {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(0, 3fr) minmax(180px, 1fr);
      gap: 0.8rem;
    }
    .diff-review-queue,
    .diff-review-context {
      border: 1px solid light-dark(#e2e8f0, #334155);
      border-radius: 4px;
      padding: 0.5rem;
      font-size: 0.88rem;
    }
    .diff-review-queue h4,
    .diff-review-context h4 {
      margin: 0 0 0.4rem;
      font-size: 0.9rem;
    }
    .diff-review-queue ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .diff-review-queue-npc {
      margin: 0.4rem 0 0.2rem;
      font-weight: 600;
      font-size: 0.85rem;
    }
    .diff-review-queue-item {
      margin: 0;
    }
    .diff-review-queue-button {
      width: 100%;
      text-align: left;
      padding: 0.25rem 0.4rem;
      background: transparent;
      color: inherit;
      border: 1px solid transparent;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85rem;
    }
    .diff-review-queue-item-selected .diff-review-queue-button {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
    }
    .diff-review-queue-item-dm-only .diff-review-queue-button {
      border-left: 3px solid light-dark(#f59e0b, #d97706);
    }
    .diff-review-queue-field {
      font-family: ui-monospace, monospace;
      font-size: 0.82rem;
    }
    .diff-review-card {
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      padding: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .diff-review-card-dm-only {
      border-left: 4px solid light-dark(#f59e0b, #d97706);
      background: light-dark(#fffbeb, #292524);
    }
    .diff-review-card-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .diff-review-card-head h4 {
      margin: 0;
      font-family: ui-monospace, monospace;
      font-size: 0.95rem;
    }
    .diff-review-card-rail {
      font-size: 0.78rem;
      color: light-dark(#92400e, #fbbf24);
      font-weight: 600;
    }
    .diff-review-diff {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
    }
    .diff-review-before pre,
    .diff-review-after pre {
      margin: 0;
      padding: 0.4rem;
      background: light-dark(#f1f5f9, #1e293b);
      border-radius: 3px;
      font-size: 0.85rem;
      white-space: pre-wrap;
      max-height: 240px;
      overflow: auto;
    }
    .diff-review-edit-textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 3px;
      font: inherit;
      font-size: 0.88rem;
      font-family: ui-monospace, monospace;
    }
    .diff-review-card-actions {
      display: flex;
      gap: 0.4rem;
    }
    .diff-review-accept,
    .diff-review-reject {
      padding: 0.35rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .diff-review-accept {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
    }
    .diff-review-rationale {
      margin: 0 0 0.5rem;
      font-style: italic;
    }
    .diff-review-sources {
      margin-top: 0.4rem;
    }
    .diff-review-sources h5 {
      margin: 0 0 0.2rem;
      font-size: 0.85rem;
    }
    .diff-review-sources ul {
      list-style: none;
      margin: 0;
      padding-left: 0.4rem;
    }
    .diff-review-sources code {
      font-size: 0.78rem;
      color: light-dark(#475569, #94a3b8);
    }

    /* D2 (2026-05-26): session-open ritual surface. */
    .session-open-stage {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
      padding: 0.5rem;
    }
    .session-open-stage-head h2 {
      margin: 0 0 0.2rem;
    }
    .session-open-stage-head p.muted {
      margin: 0;
    }
    .session-open-stage-recap {
      border: 1px solid light-dark(#e2e8f0, #334155);
      border-radius: 4px;
      padding: 0.6rem 0.8rem;
      background: light-dark(#fafaf9, #1c1917);
    }
    .session-open-stage-recap h3 {
      margin: 0 0 0.4rem;
      font-size: 1rem;
    }
    .session-open-stage-digest p {
      margin: 0 0 0.5rem;
    }
    .session-open-stage-digest p:last-child {
      margin-bottom: 0;
    }
    .session-open-stage-carryover h3 {
      margin: 0 0 0.5rem;
      font-size: 1rem;
    }
    .session-open-stage-cards {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.6rem;
    }
    .session-open-stage-card {
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      padding: 0.5rem 0.7rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .session-open-stage-card-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .session-open-stage-card-stats {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.88rem;
    }
    .session-open-stage-card-stat {
      padding: 0.05rem 0;
    }
    .session-open-stage-dm-only {
      color: light-dark(#92400e, #fbbf24);
    }
    .session-open-stage-badge {
      display: inline-block;
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
      font-size: 0.72rem;
      font-weight: 600;
      vertical-align: middle;
    }
    .session-open-stage-badge-adv {
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#1e40af, #93c5fd);
    }
    .session-open-stage-badge-drift {
      background: light-dark(#fef3c7, #78350f);
      color: light-dark(#78350f, #fde68a);
    }
    .session-open-stage-drift-banner {
      margin-top: 0.3rem;
      padding: 0.3rem 0.4rem;
      border-left: 3px solid light-dark(#f59e0b, #d97706);
      background: light-dark(#fffbeb, #292524);
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.85rem;
    }
    .session-open-stage-drift-ack {
      align-self: flex-start;
      padding: 0.2rem 0.5rem;
      border: 1px solid light-dark(#fcd34d, #d97706);
      background: light-dark(#ffffff, #1c1917);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85rem;
    }
    /* Review 2026-05-28: the "advancement taken — reset marks" control
       beside a full marks badge.  Small inline button so it reads as a
       follow-on to the badge, not a primary action. */
    .session-open-stage-adv-take {
      margin-left: 0.4rem;
      padding: 0.1rem 0.45rem;
      border: 1px solid light-dark(#93c5fd, #1e40af);
      background: light-dark(#ffffff, #1c1917);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.72rem;
      vertical-align: middle;
    }
    .session-open-stage-adv-cap {
      margin-left: 0.4rem;
      font-size: 0.72rem;
      vertical-align: middle;
    }
    .session-open-stage-summary {
      margin: 0;
      font-size: 0.88rem;
    }
    .session-open-stage-footer {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      border-top: 1px solid light-dark(#e2e8f0, #334155);
      padding-top: 0.6rem;
    }
    .session-open-stage-begin {
      align-self: flex-end;
      padding: 0.4rem 1rem;
      border: 1px solid light-dark(#60a5fa, #3b82f6);
      background: light-dark(#dbeafe, #1e3a8a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .session-open-stage-begin:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .session-open-stage-error {
      margin: 0;
      padding: 0.3rem 0.5rem;
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fecaca);
      border: 1px solid light-dark(#fca5a5, #991b1b);
      border-radius: 3px;
      font-size: 0.85rem;
    }

    /* D3 (2026-05-26): DM-only clock-strip. */
    .clock-strip {
      margin: 0.5rem 0;
      padding: 0.5rem 0.7rem;
      border-left: 4px solid light-dark(#f59e0b, #d97706);
    }
    .clock-strip-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 0 0 0.4rem;
    }
    .clock-strip-head h3 {
      margin: 0;
      font-size: 0.95rem;
    }
    .clock-strip-add {
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.95rem;
    }
    .clock-strip-empty {
      margin: 0;
      font-size: 0.85rem;
    }
    .clock-strip-list {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 8rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .clock-strip-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.88rem;
    }
    .clock-strip-pie {
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }
    .clock-strip-pie:disabled {
      cursor: default;
      opacity: 0.5;
    }
    .clock-strip-svg .clock-strip-wedge-filled {
      fill: light-dark(#475569, #94a3b8);
      stroke: light-dark(#1e293b, #cbd5e1);
      stroke-width: 0.5;
    }
    .clock-strip-svg .clock-strip-wedge-empty {
      fill: light-dark(#f1f5f9, #1e293b);
      stroke: light-dark(#94a3b8, #475569);
      stroke-width: 0.5;
    }
    .clock-strip-row-full .clock-strip-wedge-filled {
      fill: light-dark(#dc2626, #ef4444);
      stroke: light-dark(#7f1d1d, #fca5a5);
      animation: clock-strip-pulse 2s ease-in-out infinite;
    }
    @keyframes clock-strip-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .clock-strip-row-acked {
      opacity: 0.6;
    }
    .clock-strip-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .clock-strip-counter {
      font-family: ui-monospace, monospace;
      font-size: 0.82rem;
      color: light-dark(#64748b, #94a3b8);
    }
    .clock-strip-delete {
      padding: 0.1rem 0.35rem;
      border: 1px solid transparent;
      background: transparent;
      color: light-dark(#94a3b8, #64748b);
      cursor: pointer;
      font: inherit;
      font-size: 0.85rem;
    }
    .clock-strip-delete:hover {
      color: light-dark(#dc2626, #ef4444);
      border-color: light-dark(#fca5a5, #991b1b);
      border-radius: 3px;
    }
    .clock-strip-create {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.4rem;
      padding: 0.3rem;
      border: 1px dashed light-dark(#cbd5e1, #475569);
      border-radius: 3px;
      font-size: 0.85rem;
    }
    .clock-strip-create-name {
      flex: 1;
      padding: 0.2rem 0.4rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 3px;
      font: inherit;
      font-size: 0.85rem;
      min-width: 0;
    }
    .clock-strip-create-sizes {
      display: flex;
      gap: 0.2rem;
    }
    .clock-strip-create-size {
      padding: 0.15rem 0.5rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82rem;
    }
    .clock-strip-create-size-selected {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
    }
    .clock-strip-create-submit,
    .clock-strip-create-cancel {
      padding: 0.15rem 0.5rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82rem;
    }
    .clock-strip-create-submit {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
    }

    .dm-wrap-session-launcher {
      margin: 0.5rem 0;
    }
    .dm-wrap-session-button {
      padding: 0.3rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.9em;
    }

    /* Phase B P1d (2026-05-26): foci-card field-renderer. */
    /* D5 (2026-05-27): bonds-card. */
    .bonds-card {
      margin-top: 0.6rem;
    }
    .bonds-card-head h4 {
      margin: 0 0 0.4rem;
      font-size: 0.95rem;
    }
    .bonds-card-empty {
      margin: 0;
      font-size: 0.85rem;
    }
    .bonds-card-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .bonds-card-row {
      border: 1px solid light-dark(#e2e8f0, #334155);
      border-radius: 4px;
      padding: 0.4rem 0.6rem;
      position: relative;
    }
    /* D5-cleanup (2026-05-27): inbound bond direction — visually
     * distinct so the player sees "Mei bonded to me" differently
     * from "I bonded to Iris."  UX-polish (post-D5 sweep) swapped
     * dashed border → solid + 3px left rail + explicit "Inbound"
     * pip; dashed read as "draft/incomplete" per scenario-S3. */
    .bonds-card-row-inbound {
      border-left: 3px solid light-dark(#94a3b8, #64748b);
      background: light-dark(#f8fafc, #1e293b);
    }
    .bonds-card-inbound-pip {
      display: inline-block;
      padding: 0.05rem 0.4rem;
      margin-right: 0.4rem;
      font-size: 0.72rem;
      font-weight: 600;
      color: light-dark(#475569, #cbd5e1);
      background: light-dark(#e2e8f0, #334155);
      border-radius: 3px;
      vertical-align: middle;
    }
    .bonds-card-target {
      font-size: 0.9rem;
    }
    .bonds-card-text {
      margin: 0.2rem 0 0;
      font-size: 0.88rem;
    }
    /* D5.5-B: cross-PC consent hint on an inbound bond — signals
       that the tie another player authored about this PC is a
       table conversation, not a system-enforced gate. */
    .bonds-card-inbound-consent {
      margin: 0.25rem 0 0;
      font-size: 0.78rem;
      font-style: italic;
    }
    .bonds-card-dm-notes {
      margin-top: 0.3rem;
      padding: 0.3rem 0.5rem;
      background: light-dark(#fffbeb, #292524);
      border-left: 3px solid light-dark(#f59e0b, #d97706);
      font-size: 0.82rem;
      color: light-dark(#92400e, #fde68a);
    }
    .bonds-card-remove {
      position: absolute;
      top: 0.3rem;
      right: 0.3rem;
      padding: 0.1rem 0.4rem;
      background: transparent;
      border: 1px solid transparent;
      color: light-dark(#94a3b8, #64748b);
      cursor: pointer;
      font: inherit;
      font-size: 0.85rem;
    }
    .bonds-card-remove:hover {
      color: light-dark(#dc2626, #ef4444);
      border-color: light-dark(#fca5a5, #991b1b);
      border-radius: 3px;
    }
    /* #387: two-step removal confirm for a ratified (established) bond.
       Framed as a story beat ("sever this tie"), not a silent delete. */
    .bonds-card-remove-confirm {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.3rem;
      padding: 0.3rem 0.4rem;
      border-left: 3px solid light-dark(#f59e0b, #d97706);
      background: light-dark(#fffbeb, #292524);
      font-size: 0.82rem;
    }
    .bonds-card-remove-confirm-msg {
      flex: 1 1 12rem;
    }
    .bonds-card-remove-confirm-yes,
    .bonds-card-remove-confirm-no {
      padding: 0.1rem 0.5rem;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82rem;
    }
    .bonds-card-remove-confirm-yes {
      border: 1px solid light-dark(#fca5a5, #991b1b);
      background: light-dark(#ffffff, #1c1917);
      color: light-dark(#dc2626, #ef4444);
    }
    .bonds-card-remove-confirm-no {
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #1c1917);
      color: inherit;
    }
    .bonds-card-add {
      margin-top: 0.4rem;
      padding: 0.3rem 0.7rem;
      border: 1px dashed light-dark(#cbd5e1, #475569);
      background: transparent;
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85rem;
    }
    .bonds-card-compose {
      margin-top: 0.4rem;
      padding: 0.5rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .bonds-card-compose-label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.85rem;
    }
    .bonds-card-compose-target,
    .bonds-card-compose-text {
      padding: 0.3rem 0.4rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 3px;
      font: inherit;
      font-size: 0.88rem;
    }
    .bonds-card-compose-actions {
      display: flex;
      gap: 0.4rem;
    }
    .bonds-card-compose-submit,
    .bonds-card-compose-cancel {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82rem;
    }
    .bonds-card-compose-submit {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
    }
    .bonds-card-compose-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .bonds-card-compose-hint {
      margin: 0;
      font-size: 0.78rem;
    }
    /* D5 (2026-05-27): dm-pc-detail pending-bond-proposal list. */
    .dm-pc-detail-bond-proposals {
      border-top: 1px solid light-dark(#e2e8f0, #334155);
      padding-top: 0.6rem;
      margin-top: 0.6rem;
    }
    .dm-pc-detail-bond-proposals h3 {
      margin: 0 0 0.4rem;
      font-size: 0.95rem;
    }
    .dm-pc-detail-bond-proposal-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .dm-pc-detail-bond-proposal {
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-left: 3px solid light-dark(#f59e0b, #d97706);
      border-radius: 4px;
      padding: 0.4rem 0.6rem;
    }
    .dm-pc-detail-bond-proposal p {
      margin: 0 0 0.2rem;
      font-size: 0.88rem;
    }
    .dm-pc-detail-bond-proposal-text {
      font-style: italic;
    }
    /* D5.5-B: amber "possible spoiler" chip on a bond proposal —
       DM-only signal that the player-authored text mentions a
       campaign secret.  Never shown to the authoring player. */
    .dm-pc-detail-bond-spoiler,
    .dm-aside-bond-queue-spoiler {
      margin: 0.25rem 0 0;
      padding: 0.2rem 0.45rem;
      border-radius: 0.25rem;
      font-size: 0.8rem;
      font-style: normal;
      color: light-dark(#7c2d12, #fbbf24);
      background: light-dark(#fef3c7, #422006);
      border: 1px solid light-dark(#f59e0b, #92660e);
    }
    .dm-pc-detail-bond-unresolved,
    .dm-aside-bond-queue-unresolved {
      font-size: 0.78rem;
      color: light-dark(#92660e, #d6a559);
    }
    .dm-pc-detail-bond-proposal-actions {
      display: flex;
      gap: 0.4rem;
      margin-top: 0.3rem;
    }
    .dm-pc-detail-bond-ratify,
    .dm-pc-detail-bond-reject {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82rem;
    }
    .dm-pc-detail-bond-ratify {
      background: light-dark(#dbeafe, #1e3a8a);
      border-color: light-dark(#60a5fa, #3b82f6);
    }
    /* D5-C-fix #1 (2026-05-27): inline dmNotes form on Ratify. */
    .dm-pc-detail-bond-ratify-form {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-top: 0.4rem;
      padding: 0.4rem;
      border: 1px dashed light-dark(#cbd5e1, #475569);
      border-radius: 3px;
    }
    .dm-pc-detail-bond-ratify-label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.85rem;
    }
    .dm-pc-detail-bond-ratify-notes {
      padding: 0.3rem 0.4rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 3px;
      font: inherit;
      font-size: 0.85rem;
    }
    .dm-pc-detail-bond-ratify-hint {
      margin: 0;
      font-size: 0.78rem;
    }
    /* UX-polish (2026-05-27 post-D5 sweep): two-step reject. */
    .dm-pc-detail-bond-reject-prompt {
      font-size: 0.85rem;
      color: light-dark(#7f1d1d, #fca5a5);
      margin-right: 0.4rem;
      align-self: center;
    }
    .dm-pc-detail-bond-reject-confirm {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#fca5a5, #991b1b);
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fecaca);
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82rem;
    }
    .dm-pc-detail-bond-reject-cancel {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.82rem;
    }
    /* D5-C-fix #3 (2026-05-27): pending-bond pip for player. */
    .bonds-card-pending-pip {
      margin-left: 0.4rem;
      font-size: 0.78rem;
      color: light-dark(#64748b, #94a3b8);
    }

    .foci-card {
      margin-top: 0.6rem;
    }
    .foci-card-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .foci-card-item {
      padding: 0.4rem 0.6rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-left: 3px solid light-dark(#16a34a, #4ade80);
      border-radius: 4px;
      background: light-dark(#f0fdf4, #022c22);
    }
    .foci-card-item.foci-card-status-broken {
      border-left-color: light-dark(#dc2626, #ef4444);
      background: light-dark(#fef2f2, #2a0e0e);
    }
    .foci-card-item.foci-card-status-faded {
      border-left-color: light-dark(#94a3b8, #64748b);
      background: light-dark(#f8fafc, #1e293b);
      opacity: 0.85;
    }
    .foci-card-item.foci-card-status-corrupted {
      border-left-color: light-dark(#7c3aed, #a78bfa);
      background: light-dark(#f5f3ff, #1e1b2e);
    }
    .foci-card-item.foci-card-status-transformed {
      border-left-color: light-dark(#d97706, #f59e0b);
      background: light-dark(#fffbeb, #1c1917);
    }
    .foci-card-head {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin: 0;
    }
    .foci-card-name {
      flex: 1;
    }
    .foci-card-status-chip {
      font-size: 0.78em;
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
      background: light-dark(#dcfce7, #052e16);
      color: light-dark(#15803d, #bbf7d0);
      text-transform: lowercase;
    }
    button.foci-card-status-chip {
      border: 1px solid currentColor;
      cursor: pointer;
      font: inherit;
      font-size: 0.78em;
    }
    .foci-card-status-chip-broken {
      background: light-dark(#fee2e2, #450a0a);
      color: light-dark(#dc2626, #fca5a5);
    }
    .foci-card-status-chip-faded {
      background: light-dark(#e2e8f0, #1e293b);
      color: light-dark(#475569, #94a3b8);
    }
    .foci-card-status-chip-corrupted {
      background: light-dark(#ede9fe, #2e1b4e);
      color: light-dark(#5b21b6, #c4b5fd);
    }
    .foci-card-status-chip-transformed {
      background: light-dark(#fef3c7, #422006);
      color: light-dark(#92400e, #fbbf24);
    }
    .foci-card-domain,
    .foci-card-boundfor,
    .foci-card-condition,
    .foci-card-notes {
      margin: 0.2rem 0 0;
      font-size: 0.88em;
    }
    .foci-card-field-label {
      font-weight: 500;
      font-size: 0.85em;
      opacity: 0.75;
    }

    /* Phase B P1d (2026-05-23): field-renderer components.    */
    /* ====================================================== */

    /* <rule-hover>: anchored popover for rule-consequence hints.
       The host is inline so it doesn't break flow; the popover is
       absolute-positioned relative to the host. */
    rule-hover {
      display: inline-block;
      position: relative;
    }
    .rule-hover-host {
      display: inline-block;
      position: relative;
    }
    .rule-hover-popover {
      position: absolute;
      z-index: 1000;
      pointer-events: none;
      padding: 0.25rem 0.55rem;
      border-radius: 4px;
      background: light-dark(#0f172a, #f1f5f9);
      color: light-dark(#f8fafc, #0f172a);
      font-size: 0.8rem;
      line-height: 1.3;
      white-space: nowrap;
      max-width: 30ch;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      animation: rule-hover-fade-in 120ms ease-out;
    }
    .rule-hover-popover-above {
      bottom: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
    }
    .rule-hover-popover-below {
      top: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
    }
    @keyframes rule-hover-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .rule-hover-popover {
        animation: none;
      }
    }

    /* <track-bar>: 4-box harm or stress track. */
    .track-bar {
      list-style: none;
      padding: 0;
      margin: 0;
      display: inline-flex;
      gap: 0.2rem;
    }
    .track-bar-cell {
      display: inline-block;
    }
    .track-bar-box {
      width: 1.6em;
      height: 1.6em;
      padding: 0;
      border-radius: 4px;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: light-dark(#334155, #cbd5e1);
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
      font-size: 0.9em;
      line-height: 1;
      cursor: not-allowed;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .track-bar-editable .track-bar-box {
      cursor: pointer;
    }
    .track-bar-editable .track-bar-box:hover:not(:disabled) {
      border-color: light-dark(#94a3b8, #64748b);
      background: light-dark(#f8fafc, #1e293b);
    }
    .track-bar-box-filled {
      background: light-dark(#fef2f2, #2a0e0e);
      border-color: light-dark(#dc2626, #ef4444);
      color: light-dark(#7f1d1d, #fca5a5);
    }
    .track-bar-stress .track-bar-box-filled {
      background: light-dark(#fff7ed, #2a1a0a);
      border-color: light-dark(#ea580c, #fb923c);
      color: light-dark(#7c2d12, #fdba74);
    }
    .track-bar-box-next {
      /* Subtle outline on the next-empty box so the DM's eye finds
         it quickly during a hover-to-preview-consequence flow. */
      border-style: dashed;
    }

    .invite-manager-mode-b-warning {
      margin: 0.6rem 0;
      padding: 0.6rem 0.9rem;
      border-left: 3px solid light-dark(#cc8a00, #d4a73a);
      background: light-dark(#fff8e6, #2a2310);
      color: light-dark(#5a4400, #e6cd80);
      font-size: 0.88rem;
      border-radius: 3px;
    }
    .invite-manager-mode-b-warning strong {
      color: light-dark(#7a4400, #f0d68a);
    }

    header h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .summary {
      font-style: italic;
      margin: 0.5rem 0 1.5rem;
      color: light-dark(#444, #aaa);
    }
    /* First-session Gap A: advancement signal on the player's own
       Rail.  The "ready" chip is warm + visible (the game's first
       payoff); the progress line stays faint per the prime
       directive (growth in the background). */
    .player-rail-advancement-ready {
      margin: 0.4rem 0 0.8rem;
      padding: 0.4rem 0.7rem;
      border-radius: 0.4rem;
      font-size: 0.9rem;
      color: light-dark(#3a2606, #f0c477);
      background: light-dark(#fef9e9, #2a2104);
      border: 1px solid light-dark(#d6a559, #92660e);
    }
    /* #398: post-Realization casting section.  Quiet, in-fiction; the
       tax line is amber (a live cost) and disappears when the DM
       releases the tax in fiction. */
    .player-rail-casting-known {
      margin: 0 0 0.4rem;
      font-size: 0.9rem;
    }
    .player-rail-casting-tax {
      margin: 0;
      padding: 0.35rem 0.6rem;
      border-left: 3px solid light-dark(#f59e0b, #d97706);
      background: light-dark(#fffbeb, #292524);
      font-size: 0.88rem;
      color: light-dark(#7a4400, #fbbf24);
    }
    /* #407: the one-shot Realization act-break treatment.  Deliberately
       quiet + ominous, NOT celebratory (the world has been LISTENING;
       the tax — a punishment for grasping — follows).  A slow settle-in
       gives the card's first arrival the weight of crossing a threshold;
       the moment line fades after a few seconds (auto-cleared in JS). */
    .player-rail-casting-threshold {
      animation: player-rail-casting-settle 1400ms ease-out;
      border-color: light-dark(#6366f1, #818cf8);
    }
    @keyframes player-rail-casting-settle {
      from {
        opacity: 0.2;
        transform: translateY(-4px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .player-rail-casting-moment {
      margin: 0 0 0.5rem;
      font-size: 1.05rem;
      font-style: italic;
      letter-spacing: 0.02em;
      color: light-dark(#4338ca, #a5b4fc);
    }
    @media (prefers-reduced-motion: reduce) {
      .player-rail-casting-threshold {
        animation: none;
      }
    }

    nav.breadcrumb {
      font-size: 0.9rem;
      margin: 0 0 1rem;
      color: light-dark(#555, #aaa);
    }

    nav.breadcrumb a {
      color: light-dark(#0050a0, #6bb6ff);
    }

    /*
     * Run #15 (visual-design expert v2 #1 — highest-leverage
     * next step): migrate the global .card surface to tokens.
     * Single-rule edit; propagates the foundation through every
     * region that inherits .card today (AI panel + DM operational
     * view + session-digest + backups-card + recents + chargen
     * wrapper).  The pre-fix light-dark legacy palette + 6 px
     * radius read as "foreign" next to the run #14 landing hero;
     * tokens unify the surface palette.
     */
    .card {
      padding: 1rem 1.25rem;
      border: var(--border-hairline);
      border-radius: var(--r-card);
      margin: 1rem 0;
      background: var(--surface-card);
      box-shadow: var(--shadow-card);
    }

    .card h2 {
      margin-top: 0;
      font-size: 1.15rem;
    }

    .card h3 {
      font-size: 1rem;
      margin: 1rem 0 0.5rem;
    }

    .card.placeholder {
      border-style: dashed;
      background: light-dark(#fafafa, #222);
    }

    .card.error {
      border-color: light-dark(#d77, #d44);
      background: light-dark(#fff5f5, #2a1a1a);
    }

    .card.error pre {
      background: light-dark(#fef0f0, #1a0a0a);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85em;
      white-space: pre-wrap;
      word-break: break-all;
    }

    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.4rem 1.25rem;
      margin: 0;
    }

    dt {
      font-weight: 500;
      color: light-dark(#555, #aaa);
    }

    dd {
      margin: 0;
    }

    ul {
      padding-left: 1.5em;
      margin: 0.5rem 0 0;
    }

    ul.episode-list,
    ul.scene-list {
      list-style: none;
      padding-left: 0;
      margin: 0.5rem 0 0;
    }

    ul.episode-list li,
    ul.scene-list li {
      padding: 0.25rem 0;
    }

    code {
      background: light-dark(#f0f0f0, #2a2a2a);
      padding: 0 0.25rem;
      border-radius: 3px;
      font-size: 0.95em;
    }

    a {
      color: light-dark(#0050a0, #6bb6ff);
    }

    .markdown > :first-child {
      margin-top: 0;
    }

    .markdown > :last-child {
      margin-bottom: 0;
    }

    .markdown h1 {
      font-size: 1.25rem;
      margin: 1.5rem 0 0.5rem;
    }

    .markdown h2 {
      font-size: 1.1rem;
      margin: 1.25rem 0 0.5rem;
    }

    .markdown h3 {
      font-size: 1rem;
      margin: 1rem 0 0.5rem;
    }

    .markdown p {
      margin: 0.75rem 0;
    }

    .markdown blockquote {
      border-left: 3px solid light-dark(#ccc, #555);
      padding: 0.25rem 1rem;
      margin: 0.75rem 0;
      color: light-dark(#555, #aaa);
    }

    .markdown pre {
      background: light-dark(#f4f4f4, #222);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.9em;
    }

    .markdown pre code {
      background: transparent;
      padding: 0;
    }

    .markdown hr {
      border: none;
      border-top: 1px solid light-dark(#e0e0e0, #333);
      margin: 1.5rem 0;
    }

    .markdown table {
      border-collapse: collapse;
      margin: 0.75rem 0;
    }

    .markdown th,
    .markdown td {
      border: 1px solid light-dark(#ddd, #333);
      padding: 0.25rem 0.5rem;
    }

    .roll-form {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.25rem 0;
    }

    .roll-form label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
    }

    .roll-form .roll-label {
      font-family: ui-monospace, monospace;
      color: light-dark(#555, #aaa);
    }

    .roll-form input[type='text'] {
      flex: 1;
      padding: 0.25rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .roll-form button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .roll-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.9em;
      margin: 0.25rem 0;
    }

    .roll-history {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0 0;
    }

    .roll-history li {
      padding: 0.15rem 0;
    }

    .muted {
      color: light-dark(#555, #aaa);
      font-size: 0.9em;
      margin: 0.25rem 0;
    }

    .session-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      margin: 0 0 1rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 6px;
      background: light-dark(#fafafa, #1f1f1f);
      font-size: 0.9em;
      flex-wrap: wrap;
    }

    .session-bar input {
      padding: 0.2rem 0.4rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .session-bar input.session-code {
      text-transform: uppercase;
      width: 8.5rem;
    }

    .session-bar input.session-name {
      width: 7rem;
    }

    .session-bar button {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
    }

    .session-bar .session-label {
      font-weight: 600;
    }

    .session-bar .session-sep {
      color: light-dark(#555, #aaa);
    }

    .session-bar .session-code-display code {
      font-size: 0.95em;
    }

    .session-bar .session-peers {
      color: light-dark(#555, #aaa);
      cursor: help;
    }

    .session-peers-warn {
      color: light-dark(#a04010, #d4885c);
      font-size: 0.9em;
    }

    .session-bar.session-active {
      border-color: light-dark(#9bb09b, #4a6a4a);
      background: light-dark(#f4faf4, #1a221a);
    }

    .session-bar.session-error {
      border-color: light-dark(#cc8888, #884444);
      background: light-dark(#fcf4f4, #221a1a);
    }

    .session-load-label {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      font-size: 0.85em;
    }

    .session-load-label input[type='file'] {
      display: none;
    }

    .reclaim-button {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#bb6a3a, #87481c);
      border-radius: 4px;
      background: light-dark(#fdf0d0, #2a1f10);
      color: light-dark(#7a4010, #d4885c);
      cursor: pointer;
      font-size: 0.85em;
    }

    .reclaim-modal {
      margin: 0.5rem 0;
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#bb6a3a, #87481c);
      border-radius: 6px;
      background: light-dark(#fdf6e8, #221a10);
    }

    .reclaim-modal-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .reclaim-modal-actions button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .reclaim-button-confirm {
      border-color: light-dark(#bb6a3a, #87481c) !important;
      background: light-dark(#fdf0d0, #2a1f10) !important;
      font-weight: 600;
    }

    /* #302 (2026-05-26): yield PC-fate prompt — same chrome as
       reclaim-modal but with the 3-radio fieldset.  Reactive path
       fires on coord→non-coord transition; voluntary path opens via
       the "Yield DM role" button. */
    .yield-pc-fate-fieldset {
      margin: 0.6rem 0;
      padding: 0.5rem 0.7rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
    }
    .yield-pc-fate-fieldset legend {
      padding: 0 0.4rem;
      font-size: 0.85em;
    }
    .yield-pc-fate-fieldset label {
      display: block;
      margin: 0.3rem 0;
      cursor: pointer;
    }
    .yield-pc-fate-reason-label {
      display: block;
      margin: 0.45rem 0 0.2rem;
      font-size: 0.85em;
    }
    .yield-pc-fate-reason {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 0.2rem;
      padding: 0.35rem 0.5rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
    }

    .resume-prompt {
      margin: 0 0 1rem;
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#9bb09b, #4a6a4a);
      border-radius: 6px;
      background: light-dark(#f4faf4, #1a221a);
    }

    .resume-prompt-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .resume-prompt-actions button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .save-status {
      font-size: 0.85em;
      color: light-dark(#555, #aaa);
      width: 100%;
    }

    .save-status.save-error {
      color: light-dark(#a01010, #ff7070);
    }

    .roster-panel {
      margin-top: 0.5rem;
    }

    .roster-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .roster-head h2 {
      margin: 0;
    }

    .roster-count {
      font-weight: normal;
      color: light-dark(#555, #aaa);
      margin-left: 0.3rem;
    }

    .roster-toggle {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .roster-list {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .roster-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.4rem;
      border-radius: 4px;
    }

    .roster-row.roster-row-self {
      background: light-dark(#f8f4e8, #221c10);
    }

    .roster-dm-tag {
      font-size: 0.7em;
      padding: 0.05rem 0.35rem;
      background: light-dark(#bb6a3a, #87481c);
      color: light-dark(#fff, #fdf0d0);
      border-radius: 3px;
      letter-spacing: 0.05em;
    }

    .roster-name {
      font-weight: 600;
    }

    .roster-char {
      color: light-dark(#555, #aaa);
      font-style: italic;
    }

    .roster-edit {
      margin-left: auto;
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 3px;
      background: light-dark(#fff, #1a1a1a);
      color: inherit;
      cursor: pointer;
      font-size: 0.8em;
    }

    .roster-kick {
      margin-left: 0.4rem;
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#cc8888, #884444);
      border-radius: 3px;
      background: light-dark(#fcf4f4, #221a1a);
      color: light-dark(#a01010, #ff7070);
      cursor: pointer;
      font-size: 0.8em;
    }

    .rename-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid light-dark(#eee, #2a2a2a);
    }

    .rename-form label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.9em;
    }

    .rename-form input[type='text'] {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
    }

    .rename-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .rename-actions button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .version-badge {
      margin: 2rem 0 0;
      padding-top: 0.5rem;
      text-align: right;
      font-size: 0.75em;
      font-family: ui-monospace, monospace;
      color: light-dark(#555, #aaa);
      border-top: 1px solid light-dark(#f0f0f0, #2a2a2a);
      cursor: help;
    }

    .session-role-hint {
      width: 100%;
      margin: 0 0 0.5rem;
      padding: 0.3rem 0.5rem;
      font-size: 0.85em;
      color: light-dark(#555, #aaa);
      background: light-dark(#fdfaf2, #1a1812);
      border-left: 3px solid light-dark(#bb9a3a, #876618);
      border-radius: 3px;
      line-height: 1.4;
    }

    .session-bar-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      width: 100%;
    }

    .session-copy-invite {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#9bb09b, #4a6a4a);
      border-radius: 4px;
      background: light-dark(#f4faf4, #1a221a);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .session-regenerate-code {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#bb9a3a, #876618);
      border-radius: 4px;
      background: light-dark(#fdf6e8, #2a2418);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .ai-key-hint {
      margin: 0.3rem 0 0;
      font-size: 0.8em;
      line-height: 1.4;
    }

    .ai-key-hint a {
      color: light-dark(#0050a0, #6bb6ff);
    }

    .broker-badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border: 1px solid light-dark(#bb9a3a, #876618);
      border-radius: 3px;
      background: light-dark(#fdf4d0, #2a2410);
      color: light-dark(#7a5e10, #d4b256);
      font-size: 0.8em;
      cursor: help;
    }

    /* Wave C1 (2026-05-26): topbar "?" chip → hotkey cheatsheet.
       Sits inline with the session-bar; same visual weight as the
       broker-badge so it doesn't dominate.  Also serves as the
       only on-screen affordance teaching the "?" keyboard
       shortcut exists. */
    .quire-topbar-help-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.7rem;
      height: 1.7rem;
      padding: 0;
      margin-left: 0.4rem;
      border-radius: 50%;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#f1f5f9, #1e293b);
      color: light-dark(#334155, #cbd5e1);
      font-size: 0.95rem;
      font-weight: 600;
      cursor: help;
    }
    .quire-topbar-help-chip:hover {
      background: light-dark(#e2e8f0, #334155);
      color: light-dark(#0f172a, #f1f5f9);
    }
    .quire-topbar-help-chip:focus-visible {
      /* Run #15 (visual-design expert v2 #3): topbar help-chip
         focus ring now consumes the global token for cohesion
         with the rest of the foundation pass.  The topbar is
         persistent chrome — its focus language must match the
         rest of the app. */
      outline: var(--ring-focus);
      outline-offset: 1px;
    }

    /* Wave C1 (2026-05-26): hotkey cheatsheet overlay (uses
       <quire-modal> primitive for showModal + esc + backdrop).
       Two grouped sections (Shared / DM); each row is keys → action. */
    .quire-help-overlay {
      max-width: 32rem;
      padding: 1rem 1.2rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 6px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
    }
    .quire-help-overlay::backdrop {
      background: rgba(0, 0, 0, 0.4);
    }
    .quire-help-overlay-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin: 0 0 0.6rem;
    }
    .quire-help-overlay-head h3 {
      margin: 0;
    }
    .quire-help-overlay-close {
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      border: 1px solid transparent;
      font-size: 1.1rem;
      cursor: pointer;
    }
    .quire-help-overlay-close:hover {
      background: light-dark(#f1f5f9, #1e293b);
    }
    .quire-help-overlay-group {
      margin: 0 0 0.8rem;
    }
    .quire-help-overlay-group h4 {
      margin: 0 0 0.3rem;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: light-dark(#475569, #94a3b8);
    }
    .quire-help-overlay-list {
      margin: 0;
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.35rem 0.9rem;
    }
    .quire-help-overlay-row {
      display: contents;
    }
    .quire-help-overlay-keys {
      margin: 0;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      white-space: nowrap;
    }
    .quire-help-overlay-keys kbd {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-bottom-width: 2px;
      border-radius: 3px;
      background: light-dark(#f8fafc, #1e293b);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85rem;
      color: light-dark(#0f172a, #f1f5f9);
    }
    .quire-help-overlay-sep {
      font-size: 0.78rem;
      color: light-dark(#64748b, #94a3b8);
    }
    .quire-help-overlay-action {
      margin: 0;
      font-size: 0.92rem;
    }
    .quire-help-overlay-foot {
      margin: 0.6rem 0 0;
      font-size: 0.78rem;
    }

    .session-bar .session-error-msg {
      color: light-dark(#a01010, #ff7070);
    }

    .chat-panel .chat-list {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0;
      max-height: 14rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      background: light-dark(#fafafa, #1a1a1a);
      border: 1px solid light-dark(#eee, #2a2a2a);
      border-radius: 4px;
      padding: 0.4rem 0.6rem;
    }

    .chat-panel .chat-list li {
      display: flex;
      gap: 0.4rem;
      font-size: 0.95em;
    }

    .chat-panel .chat-author {
      font-weight: 600;
      color: light-dark(#0050a0, #6bb6ff);
      flex-shrink: 0;
    }

    .chat-panel .chat-text {
      flex: 1;
      word-break: break-word;
    }

    /* B1 (Phase 3b-2A): cockpit input-routing safety.  Two adjacent
       aside surfaces accept text input — chat (public; goes to all
       players) and the AI DM-aide (private; visible only to you).
       The locked threat model is "defend against accidental DM
       disclosure"; the live play-test confirmed the canonical
       failure mode is a DM typing an AI-intended message into chat.
       Visual treatment + explicit copy + /ai slash escape hatch
       together make the confusion impossible at a glance.
       Surface-public is blue (cool / outward-facing); surface-
       private is amber-violet (warm / DM-only, reuses the existing
       DM-amber + ai-provider-tag palette). */
    .surface-public {
      border-left: 3px solid light-dark(#1d4ed8, #6bb6ff);
    }
    .surface-private {
      border-left: 3px solid light-dark(#9978b8, #c4a8e0);
    }
    .surface-public-tag,
    .surface-private-tag {
      display: inline-block;
      margin-left: 0.5rem;
      padding: 0.05rem 0.45rem;
      border-radius: 999px;
      font-size: 0.7em;
      font-weight: 400;
      letter-spacing: 0.02em;
      vertical-align: middle;
    }
    .surface-public-tag {
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#1e3a8a, #dbeafe);
    }
    .surface-private-tag {
      background: light-dark(#ede4f6, #2a2030);
      color: light-dark(#5b3a8a, #d0c0e6);
    }

    .chat-form {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .chat-form input {
      /* B2 (Phase 3b-2A): explicit flex: 1 1 auto plus min-width: 0
         so the input shrinks below its intrinsic content size when
         the aside column is narrow.  Without min-width: 0, flex
         items default to min-width: auto (= content-based) which
         pushed the Send button off-screen in the live play-test. */
      flex: 1 1 auto;
      min-width: 0;
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
    }
    .chat-form button {
      /* B2: complement to .chat-form input — button stays intrinsic
         width and refuses to shrink. */
      flex: 0 0 auto;
    }
    /* Wave A5 (2026-05-26): one-character disambiguator glyph on
       the chat input so DM can never confuse it with the AI input
       at a glance.  Mirrors the .ai-input-glyph below; same font
       treatment so the two read as the same control-family. */
    .chat-input-glyph,
    .ai-input-glyph {
      flex: 0 0 auto;
      align-self: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      font-weight: 500;
      padding: 0.15rem 0.35rem;
      border-radius: 3px;
      color: light-dark(#475569, #cbd5e1);
      background: light-dark(#f1f5f9, #1e293b);
      border: 1px solid light-dark(#e2e8f0, #334155);
      user-select: none;
    }
    .ai-input-glyph {
      /* DM-amber tint to pair with the AI panel's existing
         DM-private framing.  Tells the eye "this is the private
         AI input, not the player-visible chat input." */
      color: light-dark(#92400e, #fcd34d);
      background: light-dark(#fef3c7, #422006);
      border-color: light-dark(#fde68a, #92400e);
      align-self: flex-start;
      margin-top: 0.35rem;
    }

    .chat-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.85em;
      margin: 0.4rem 0 0;
    }

    .chat-form button {
      padding: 0.3rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    /* Task #293: chat-spoiler-lint modal — DM-only confirmation
       when the coordinator's chat draft tripped the substring
       spoiler scanner.  Amber-rail framing matches the dm-only
       conventions used elsewhere (e.g. ai-card-dm).  Never visible
       to players. */
    .chat-spoiler-lint-modal {
      max-width: 36rem;
      padding: 1.2rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-left: 4px solid light-dark(#d97706, #f59e0b);
      border-radius: 6px;
      background: light-dark(#fffbeb, #1c1917);
      color: inherit;
    }
    .chat-spoiler-lint-modal::backdrop {
      background: rgba(0, 0, 0, 0.4);
    }
    .chat-spoiler-lint-body h3 {
      margin: 0 0 0.5rem;
      color: light-dark(#92400e, #fbbf24);
    }
    .chat-spoiler-lint-intro {
      margin: 0.4rem 0 0.6rem;
    }
    .chat-spoiler-lint-draft {
      margin: 0.5rem 0;
      padding: 0.6rem 0.8rem;
      border-left: 3px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#f8fafc, #0f172a);
      font-style: italic;
      white-space: pre-wrap;
    }
    .chat-spoiler-lint-status {
      margin: 0.4rem 0 0.2rem;
      font-size: 0.9em;
    }
    .chat-spoiler-lint-status-checking {
      color: light-dark(#0369a1, #38bdf8);
    }
    .chat-spoiler-lint-status-clean {
      color: light-dark(#15803d, #4ade80);
    }
    .chat-spoiler-lint-status-leak {
      color: light-dark(#b45309, #fbbf24);
      font-weight: 500;
    }
    .chat-spoiler-lint-status-failed {
      color: light-dark(#475569, #94a3b8);
    }
    .chat-spoiler-lint-reason {
      margin: 0.2rem 0 0.6rem;
      font-size: 0.85em;
    }
    .chat-spoiler-lint-actions {
      display: flex;
      gap: 0.4rem;
      justify-content: flex-end;
      margin-top: 0.9rem;
      flex-wrap: wrap;
    }
    .chat-spoiler-lint-edit,
    .chat-spoiler-lint-route-ai,
    .chat-spoiler-lint-send {
      padding: 0.4rem 0.85rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .chat-spoiler-lint-route-ai {
      border-color: light-dark(#0369a1, #38bdf8);
      background: light-dark(#dbeafe, #082f49);
      color: light-dark(#0369a1, #bae6fd);
      font-weight: 500;
    }
    .chat-spoiler-lint-send {
      border-color: light-dark(#b45309, #f59e0b);
    }

    /* Light-DOM custom-element dialogs (cloud-consent, start-fresh,
       pc-revoke).  Each <foo-confirm-dialog> overrides createRenderRoot
       to render into light DOM (so host CSS reaches it) and emits a
       custom <div class="*-backdrop"> + <section class="*-dialog">
       pair instead of using the <dialog> element + ::backdrop.  These
       rules are what make them visible — without them the dialog DOM
       exists in document flow with NO position/z-index/background, so
       the user sees nothing happen when the affordance fires.  The
       autofocus warning still prints because the Cancel button
       actually got focused — that's the diagnostic. */
    .cloud-consent-backdrop,
    .start-fresh-backdrop,
    .pc-revoke-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(2px);
    }
    .cloud-consent-dialog,
    .start-fresh-dialog,
    .pc-revoke-dialog {
      box-sizing: border-box;
      width: 100%;
      max-width: 38rem;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
      padding: 1.2rem 1.4rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 8px;
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    }
    /* Destructive variants get an amber left rail so the DM reads
       them as "this is the one that wipes things." */
    .start-fresh-dialog[data-variant='destructive'],
    .pc-revoke-dialog {
      border-left: 4px solid light-dark(#d97706, #f59e0b);
    }
    .cloud-consent-title,
    .start-fresh-title,
    .pc-revoke-title {
      margin: 0 0 0.6rem;
      font-size: 1.1em;
      line-height: 1.3;
    }
    .start-fresh-slug {
      margin: 0 0 0.8rem;
      font-size: 0.85em;
      color: light-dark(#475569, #94a3b8);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .cloud-consent-body p,
    .start-fresh-body p {
      margin: 0.5rem 0;
      line-height: 1.45;
    }
    .pc-revoke-firewall-reminder {
      margin: 0.3rem 0 0.9rem;
      padding: 0.5rem 0.7rem;
      border-left: 3px solid light-dark(#d97706, #f59e0b);
      background: light-dark(#fffbeb, #1c1917);
      font-size: 0.92em;
      line-height: 1.4;
    }
    .pc-revoke-shape,
    .pc-revoke-bonds {
      margin: 0.6rem 0;
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#e2e8f0, #334155);
      border-radius: 5px;
    }
    .pc-revoke-shape legend,
    .pc-revoke-bonds legend {
      padding: 0 0.4rem;
      font-weight: 500;
      font-size: 0.92em;
    }
    .pc-revoke-shape label {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
      padding: 0.35rem 0;
      cursor: pointer;
      line-height: 1.4;
    }
    .pc-revoke-shape input[type='radio'] {
      margin-top: 0.25rem;
      flex: 0 0 auto;
    }
    .pc-revoke-bond-list {
      margin: 0.3rem 0 0.5rem;
      font-size: 0.9em;
      color: light-dark(#475569, #cbd5e1);
    }
    .pc-revoke-npc-label,
    .pc-revoke-tombstone-label {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      margin: 0.5rem 0;
      font-size: 0.92em;
    }
    .pc-revoke-npc-select,
    .pc-revoke-tombstone-input {
      padding: 0.4rem 0.5rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      background: light-dark(#ffffff, #1e293b);
      color: inherit;
      font: inherit;
    }
    .cloud-consent-actions,
    .start-fresh-actions,
    .pc-revoke-actions {
      display: flex;
      gap: 0.6rem;
      justify-content: flex-end;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    .cloud-consent-cancel,
    .cloud-consent-acknowledge,
    .start-fresh-cancel,
    .start-fresh-confirm,
    .pc-revoke-cancel,
    .pc-revoke-confirm {
      padding: 0.45rem 0.95rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #1e293b);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .cloud-consent-acknowledge,
    .start-fresh-confirm[data-destructive='true'],
    .pc-revoke-confirm[data-destructive='true'] {
      border-color: light-dark(#b45309, #f59e0b);
      background: light-dark(#fef3c7, #422006);
      color: light-dark(#7c2d12, #fde68a);
      font-weight: 500;
    }

    .reveal-chips {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      align-items: baseline;
    }

    .reveal-chip {
      display: inline-flex;
      align-items: center;
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#d9c89b, #5a4d2a);
      border-radius: 3px;
      background: light-dark(#fdf8e7, #2a2418);
      text-decoration: none;
      color: inherit;
    }

    .reveal-chip.reveal-chip-current {
      background: light-dark(#f4c860, #6a4d2a);
      border-color: light-dark(#b88c20, #b8983e);
      cursor: default;
    }

    .reveal-chip-marker {
      font-size: 0.85em;
      margin-left: 0.25rem;
      color: light-dark(#7a5c10, #d4b256);
    }

    .reveal-banner {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      padding: 0.4rem 0.6rem;
      margin: 0 0 1rem;
      border: 1px solid light-dark(#d9c89b, #5a4d2a);
      background: light-dark(#fdf8e7, #2a2418);
      border-radius: 6px;
      font-size: 0.92em;
      flex-wrap: wrap;
    }

    .reveal-banner-label {
      font-weight: 600;
    }

    .reveal-control {
      margin: 0.25rem 0 0;
    }

    .reveal-control button {
      padding: 0.3rem 0.75rem;
      border: 1px solid light-dark(#9a7e2a, #b8983e);
      border-radius: 4px;
      background: light-dark(#fdf3c8, #3a3018);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
    }

    .reveal-undo {
      margin-left: 0.5rem;
      padding: 0.25rem 0.6rem !important;
      border-color: light-dark(#888, #555) !important;
      background: light-dark(#f4f4f4, #222) !important;
      color: light-dark(#555, #aaa) !important;
      font-size: 0.85em !important;
    }

    .reveal-badge {
      display: inline-block;
      margin: 0.25rem 0 0;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.85em;
    }

    .reveal-badge-revealed {
      background: light-dark(#e0f0e0, #1f2a1f);
      color: light-dark(#2a6a2a, #88c088);
      border: 1px solid light-dark(#b0d0b0, #3a5a3a);
    }

    .reveal-badge-private {
      background: light-dark(#f0f0f0, #222);
      color: light-dark(#555, #aaa);
      border: 1px solid light-dark(#ddd, #333);
    }

    dl.stat-grid {
      display: grid;
      grid-template-columns: auto auto;
      gap: 0.25rem 0.75rem;
      margin: 0.5rem 0;
    }

    dl.stat-grid dt {
      font-weight: 600;
      align-self: center;
    }

    dl.stat-grid dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-bumpers {
      display: inline-flex;
      gap: 0.2rem;
    }

    .stat-bumpers button {
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
      line-height: 1;
    }

    .stat-bumpers button:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    .track-boxes {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }

    .track-box {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.4rem;
      height: 1.4rem;
      padding: 0;
      border: 1px solid light-dark(#aaa, #555);
      border-radius: 3px;
      background: light-dark(#fff, #1a1a1a);
      color: inherit;
      font-family: ui-monospace, monospace;
      font-size: 0.9em;
      cursor: pointer;
    }

    .track-box.track-box-filled {
      background: light-dark(#444, #ddd);
      color: light-dark(#fff, #111);
      border-color: light-dark(#222, #aaa);
    }

    button.track-box:hover {
      outline: 1px solid light-dark(#0050a0, #6bb6ff);
    }

    .track-count {
      margin-left: 0.4rem;
      color: light-dark(#555, #aaa);
      font-size: 0.85em;
    }

    /* P-R7 (2026-05-25): player-rail name-row switcher.  Shows a
       ▾ chevron next to the PC name when 2+ active PCs exist that
       the player can switch to.  Dropdown lists active PCs with
       optional "take over from <name>" inline-affirm. */
    .player-rail-name-row {
      position: relative;
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
    }
    .player-rail-name-row h1 {
      margin: 0;
    }
    .player-rail-name-switcher {
      padding: 0.05rem 0.55rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
      line-height: 1;
    }
    .player-rail-name-switcher:hover,
    .player-rail-name-switcher[aria-expanded='true'] {
      background: light-dark(#e2e8f0, #1e293b);
    }
    .player-rail-name-menu {
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 30;
      margin: 0.25rem 0 0;
      padding: 0.3rem 0;
      list-style: none;
      min-width: 12rem;
      max-width: 22rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 6px;
      background: light-dark(#ffffff, #0f172a);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    }
    .player-rail-name-menu-item {
      padding: 0;
      margin: 0;
    }
    .player-rail-name-menu-button {
      display: flex;
      width: 100%;
      align-items: baseline;
      gap: 0.4rem;
      padding: 0.35rem 0.7rem;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .player-rail-name-menu-button:hover {
      background: light-dark(#f1f5f9, #1e293b);
    }
    .player-rail-name-menu-button:disabled {
      cursor: default;
      opacity: 0.7;
    }
    .player-rail-name-menu-button-confirm {
      color: light-dark(#b45309, #fbbf24);
      font-weight: 500;
    }
    .player-rail-name-menu-name {
      flex: 1;
    }
    .player-rail-name-menu-tag {
      font-size: 0.8em;
    }
    .player-rail-name-menu-item-current .player-rail-name-menu-button {
      background: light-dark(#f8fafc, #1a2540);
    }
    .player-rail-name-menu-item-confirming
      .player-rail-name-menu-button {
      background: light-dark(#fef3c7, #422006);
    }

    /* P-R11 (2026-05-25): player-rail retire-request pip + form. */
    .player-rail-retire {
      margin: 0.4rem 0 0;
    }
    .player-rail-retire-open {
      padding: 0.25rem 0.7rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
    }
    .player-rail-retire-pending {
      padding: 0.3rem 0.6rem;
      background: light-dark(#f1f5f9, #1e293b);
      border-radius: 4px;
      font-size: 0.85em;
    }
    .player-rail-retire-declined {
      padding: 0.3rem 0.6rem;
      border-left: 3px solid light-dark(#d97706, #f59e0b);
      background: light-dark(#fffbeb, #1c1917);
      border-radius: 4px;
      font-size: 0.9em;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.4rem;
    }
    .player-rail-retire-tag {
      font-weight: 500;
    }
    .player-rail-retire-note {
      flex: 1;
      font-style: italic;
    }
    .player-rail-retire-form {
      margin: 0.4rem 0;
      padding: 0.6rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      border-radius: 4px;
      background: light-dark(#f8fafc, #0f172a);
    }
    .player-rail-retire-form-label,
    .player-rail-retire-form-reason {
      display: block;
      margin-bottom: 0.4rem;
      font-size: 0.85em;
    }
    .player-rail-retire-form-text {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 0.2rem;
      padding: 0.4rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
    }
    .player-rail-retire-form-actions {
      display: flex;
      gap: 0.4rem;
      justify-content: flex-end;
      margin-top: 0.5rem;
    }
    .player-rail-retire-form-cancel,
    .player-rail-retire-form-submit {
      padding: 0.3rem 0.8rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
    }
    .player-rail-retire-form-submit {
      border-color: light-dark(#0369a1, #38bdf8);
      background: light-dark(#dbeafe, #082f49);
      color: light-dark(#0369a1, #bae6fd);
      font-weight: 500;
    }
    .player-rail-retire-form-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* P-R11: DM-side accept/reject strip on Stage Roster Active tiles. */
    .stage-roster-retire-req {
      margin-top: 0.45rem;
      padding: 0.5rem 0.65rem;
      border: 1px solid light-dark(#d97706, #f59e0b);
      border-left-width: 3px;
      border-radius: 4px;
      background: light-dark(#fffbeb, #1c1917);
    }
    .stage-roster-retire-req-head {
      margin: 0 0 0.3rem;
      font-size: 0.9em;
      color: light-dark(#92400e, #fbbf24);
    }
    .stage-roster-retire-req-reason {
      margin: 0.2rem 0 0.45rem;
      padding: 0.35rem 0.5rem;
      border-left: 2px solid light-dark(#cbd5e1, #475569);
      font-style: italic;
      background: light-dark(#f8fafc, #0f172a);
    }
    .stage-roster-retire-req-actions {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .stage-roster-retire-req-accept,
    .stage-roster-retire-req-reject-open,
    .stage-roster-retire-req-reject-cancel,
    .stage-roster-retire-req-reject-submit {
      padding: 0.25rem 0.7rem;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
    }
    .stage-roster-retire-req-accept {
      border-color: light-dark(#15803d, #4ade80);
      background: light-dark(#dcfce7, #052e16);
      color: light-dark(#15803d, #bbf7d0);
      font-weight: 500;
    }
    .stage-roster-retire-req-reject {
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px dashed light-dark(#cbd5e1, #475569);
    }
    .stage-roster-retire-req-reject-label {
      display: block;
      font-size: 0.85em;
    }
    .stage-roster-retire-req-reject-text {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 0.2rem;
      padding: 0.35rem 0.45rem;
      font: inherit;
      border: 1px solid light-dark(#cbd5e1, #475569);
      background: light-dark(#ffffff, #0f172a);
      color: inherit;
      border-radius: 3px;
    }
    .stage-roster-retire-req-reject-actions {
      display: flex;
      gap: 0.4rem;
      justify-content: flex-end;
      margin-top: 0.4rem;
    }
    .stage-roster-retire-req-reject-submit {
      border-color: light-dark(#d97706, #f59e0b);
      background: light-dark(#fef3c7, #422006);
      color: light-dark(#92400e, #fbbf24);
      font-weight: 500;
    }

    /* #301 (2026-05-26): hidden-seat strip + Add hidden seat row. */
    .stage-roster-hidden-row {
      margin: 0.4rem 0 0;
      padding: 0.3rem 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-left: 3px solid light-dark(#7c3aed, #a78bfa);
      background: light-dark(#f5f3ff, #1e1b2e);
      border-radius: 3px;
      font-size: 0.85em;
    }
    .stage-roster-hidden-tag {
      flex: 1;
      color: light-dark(#5b21b6, #c4b5fd);
      font-weight: 500;
    }
    .stage-roster-hidden-reveal {
      padding: 0.25rem 0.7rem;
      border: 1px solid light-dark(#7c3aed, #a78bfa);
      background: light-dark(#ede9fe, #2e1b4e);
      color: light-dark(#5b21b6, #c4b5fd);
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
      font-weight: 500;
    }
    .stage-roster-add-hidden-row {
      margin: 0.7rem 0 0;
      text-align: center;
    }
    .stage-roster-add-hidden-btn {
      padding: 0.3rem 0.8rem;
      border: 1px dashed light-dark(#7c3aed, #a78bfa);
      background: transparent;
      color: light-dark(#5b21b6, #c4b5fd);
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
    }
    .stage-roster-add-hidden-btn:hover {
      background: light-dark(#f5f3ff, #1e1b2e);
    }

    /* P-R10: Browse NPCs sub-tab — list of NPC tiles with Promote. */
    .stage-roster-npc-list {
      gap: 0.5rem;
      display: flex;
      flex-direction: column;
      padding: 0;
      margin: 0;
      list-style: none;
    }
    .stage-roster-npc-head {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
    }
    .stage-roster-npc-id {
      font-size: 0.8em;
    }
    .stage-roster-npc-desc {
      margin: 0.3rem 0;
      font-size: 0.85em;
    }
    .stage-roster-npc-promote {
      padding: 0.3rem 0.8rem;
      border: 1px solid light-dark(#0369a1, #38bdf8);
      background: light-dark(#dbeafe, #082f49);
      color: light-dark(#0369a1, #bae6fd);
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 0.85em;
      font-weight: 500;
    }

    .ai-panel {
      border-color: light-dark(#c8b8d8, #4a3a5a);
      background: light-dark(#fbf8fd, #1f1a25);
    }

    .ai-panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .ai-panel-head h2 {
      margin: 0;
    }

    .ai-panel-head .ai-provider-tag {
      font-size: 0.8em;
      color: light-dark(#555, #aaa);
      margin-left: 0.5rem;
    }

    .ai-provider-choice {
      display: flex;
      gap: 0.75rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 4px;
      padding: 0.3rem 0.6rem;
      margin: 0;
    }

    .ai-provider-choice legend {
      font-size: 0.85em;
      padding: 0 0.3rem;
      color: light-dark(#555, #aaa);
    }

    .ai-provider-radio {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.9em;
    }

    .ai-settings select {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .ai-settings-toggle {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .ai-settings {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .ai-settings label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.9em;
    }

    .ai-settings input,
    .ai-settings textarea {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .ai-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .ai-form textarea {
      /* B2: explicit width + box-sizing so a tall textarea in a
         narrow aside doesn't overflow its parent card.  Same
         rationale as .chat-form input — Lit/HTML defaults give a
         textarea its cols=20 intrinsic width, which collides with
         the 280-340px aside column. */
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: inherit;
      resize: vertical;
    }

    .ai-form-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .ai-form button {
      padding: 0.3rem 0.85rem;
      border: 1px solid light-dark(#9978b8, #6a4d8a);
      border-radius: 4px;
      background: light-dark(#ede4f6, #2a2030);
      color: inherit;
      cursor: pointer;
    }

    .ai-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.9em;
      margin: 0.5rem 0 0;
    }

    .ai-response {
      margin-top: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: light-dark(#fff, #15101a);
      border: 1px solid light-dark(#e0d5ec, #3a2e4a);
      border-radius: 4px;
    }

    .ai-response > button {
      margin-top: 0.5rem;
      padding: 0.25rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    /* ---- M3a.6 affordances ---- */

    /* M3a.6b: roster harm/stress vitals + connection dot. */
    .roster-vitals {
      display: inline-flex;
      gap: 0.3em;
      margin: 0 0.4em;
      font-size: 0.85em;
      align-items: baseline;
    }
    .roster-harm {
      color: light-dark(#a01818, #ff6868);
      font-weight: 600;
    }
    .roster-stress {
      color: light-dark(#5928a0, #b07cd9);
      font-weight: 600;
    }

    /* M3a.6c: scene-strip header (location · mood · duration · npcs). */
    .scene-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4em;
      margin: 0.4rem 0 0.6rem;
      padding: 0.35rem 0.6rem;
      background: light-dark(#f5f5f5, #222);
      border-left: 3px solid light-dark(#888, #666);
      border-radius: 4px;
      font-size: 0.85em;
      color: light-dark(#444, #aaa);
      align-items: baseline;
    }
    .scene-strip-item {
      font-variant: small-caps;
      letter-spacing: 0.02em;
    }
    .scene-strip-mood {
      font-style: italic;
    }
    .scene-strip-sep {
      opacity: 0.5;
    }

    /* M3a.9: <dm-aside> and <dm-rail> DM-only regions.
       Light styling — these are workhorse panels.  Color hints
       use the existing amber accent so DM cockpit affordances
       feel of a piece. */
    .dm-aside-card,
    .dm-aside-empty,
    .dm-rail,
    .dm-rail-empty,
    .seat-strip,
    .seat-strip-empty,
    .invite-manager {
      border-left: 3px solid light-dark(#d4a017, #a07820);
    }
    /* CC-12: invite-manager panel.  Sits beside seat-strip in the
       DM aside; renders only in DM views. */
    .invite-manager-explainer {
      font-size: 0.88em;
      margin: 0.4rem 0 0.7rem;
    }
    .invite-manager-controls {
      display: flex;
      align-items: end;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .invite-manager-slot-label {
      display: flex;
      flex-direction: column;
      font-size: 0.85em;
      gap: 0.2rem;
    }
    .invite-manager-slot-select {
      padding: 0.3rem 0.4rem;
      border-radius: 0.25rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #0f172a);
    }
    .invite-manager-generate {
      padding: 0.4rem 0.7rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#925a17, #d6a559);
      background: light-dark(#fef3c7, #3a2a04);
      color: light-dark(#683f10, #f0c477);
      cursor: pointer;
      font-weight: 500;
    }
    .invite-manager-generate:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .invite-manager-result {
      margin-top: 0.7rem;
      padding: 0.5rem 0.6rem;
      border-radius: 0.3rem;
      background: light-dark(#f8fafc, #1e293b);
      border: 1px dashed light-dark(#cbd5e1, #334155);
    }
    .invite-manager-result-label {
      font-size: 0.85em;
      font-weight: 500;
      margin-bottom: 0.3rem;
    }
    .invite-manager-result-url {
      width: 100%;
      padding: 0.3rem 0.4rem;
      font-family: monospace;
      font-size: 0.85em;
      border-radius: 0.2rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #0f172a);
      box-sizing: border-box;
    }
    .invite-manager-result-actions {
      margin-top: 0.4rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .invite-manager-copy {
      padding: 0.25rem 0.6rem;
      border-radius: 0.25rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
    }
    .invite-manager-feedback {
      font-size: 0.85em;
      color: light-dark(#16803d, #4ade80);
    }
    /* CC-23: synthesize-backstory button + result surface. */
    .invite-manager-synthesize {
      padding: 0.4rem 0.7rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#3b82f6, #93c5fd);
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#1e3a8a, #93c5fd);
      cursor: pointer;
      font-weight: 500;
    }
    .invite-manager-synthesize:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .invite-manager-synth-result {
      margin-top: 0.7rem;
      padding: 0.5rem 0.6rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#f8fafc, #1e293b);
    }
    .invite-manager-synth-ok {
      border-color: light-dark(#16803d, #4ade80);
      background: light-dark(#dcfce7, #14532d);
    }
    .invite-manager-synth-err {
      border-color: light-dark(#dc2626, #ef4444);
      background: light-dark(#fee2e2, #3a1010);
    }
    .invite-manager-synth-spoiler {
      border-color: light-dark(#d97706, #fbbf24);
      background: light-dark(#fef3c7, #3a2a04);
    }
    .invite-manager-synth-label {
      font-weight: 600;
    }
    .invite-manager-synth-warnings,
    .invite-manager-synth-message {
      font-size: 0.88em;
      margin-top: 0.3rem;
    }

    /* CC-5: <character-creation> region (skeleton).  Renders as a
       Stage takeover — once F8 polish lands it'll get a wider grid
       column and collapse Rail / Aside / Dock; today it just sits
       in the Stage region. */
    .character-creation {
      max-width: 48rem;
    }
    .character-creation-error {
      border-left: 3px solid light-dark(#dc2626, #ef4444);
    }
    .character-creation-progress {
      display: flex;
      list-style: none;
      padding: 0;
      margin: 0 0 1rem;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .character-creation-progress-step {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.25rem 0.6rem;
      border-radius: 999px;
      background: light-dark(#f1f5f9, #1e293b);
      font-size: 0.85em;
      color: light-dark(#64748b, #94a3b8);
    }
    .character-creation-progress-step-current {
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#1e3a8a, #93c5fd);
      font-weight: 600;
    }
    .character-creation-progress-step-done {
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#14532d, #86efac);
    }
    .character-creation-progress-num {
      font-weight: 600;
    }
    .character-creation-step {
      margin: 1rem 0;
    }
    .character-creation-readfirst {
      padding-left: 1.5rem;
    }
    .character-creation-readfirst li {
      margin: 0.5rem 0;
    }
    .character-creation-paths {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      margin: 1rem 0;
    }
    .character-creation-path {
      text-align: left;
      padding: 0.7rem 0.9rem;
      border-radius: 0.4rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
    }
    .character-creation-path:hover {
      background: light-dark(#f8fafc, #1e293b);
      border-color: light-dark(#94a3b8, #475569);
    }
    .character-creation-path:disabled {
      cursor: not-allowed;
      opacity: 0.55;
      background: light-dark(#f1f5f9, #0b1220);
    }
    .character-creation-path:disabled:hover {
      background: light-dark(#f1f5f9, #0b1220);
      border-color: light-dark(#cbd5e1, #334155);
    }
    .character-creation-path-unavailable {
      margin-top: 0.4rem;
      font-size: 0.8em;
      font-style: italic;
      color: light-dark(#92400e, #d6a559);
    }
    .character-creation-path-chosen {
      border-color: light-dark(#0b3d7f, #79b8f0);
      background: light-dark(#dbeafe, #1e3a8a);
    }
    .character-creation-path-header {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.3rem;
    }
    .character-creation-path-title {
      font-weight: 600;
    }
    .character-creation-path-badge {
      font-size: 0.78em;
      padding: 0.05rem 0.45rem;
      border-radius: 999px;
      background: light-dark(#fef3c7, #3a2a04);
      color: light-dark(#925a17, #d6a559);
    }
    .character-creation-path-description {
      font-size: 0.9em;
      color: light-dark(#64748b, #94a3b8);
    }
    .character-creation-stepnav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 1rem;
      padding-top: 0.7rem;
      border-top: 1px solid light-dark(#e2e8f0, #1e293b);
    }
    .character-creation-stepnav button {
      padding: 0.4rem 0.7rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
    }
    .character-creation-stepnav button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .character-creation-stepnav-progress {
      font-size: 0.85em;
      color: light-dark(#64748b, #94a3b8);
    }

    /* CC-6: Q&A form rendered in step 4 when chosenPath='qa'. */
    .character-creation-qa {
      list-style: none;
      padding: 0;
      counter-reset: qa-counter;
    }
    .character-creation-qa-item {
      margin: 1.2rem 0;
      padding-bottom: 1rem;
      border-bottom: 1px solid light-dark(#e2e8f0, #1e293b);
    }
    .character-creation-qa-item:last-child {
      border-bottom: none;
    }
    .character-creation-qa-label {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }
    .character-creation-qa-num {
      color: light-dark(#64748b, #94a3b8);
      font-variant-numeric: tabular-nums;
    }
    .character-creation-qa-required {
      color: light-dark(#dc2626, #ef4444);
      font-weight: 700;
    }
    .character-creation-qa-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .character-creation-qa-mc {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      border: none;
      padding: 0;
      margin: 0;
    }
    .character-creation-qa-mc-option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#e2e8f0, #1e293b);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
    }
    .character-creation-qa-mc-option:hover {
      background: light-dark(#f8fafc, #1e293b);
    }
    .character-creation-qa-mc-option-chosen {
      border-color: light-dark(#0b3d7f, #79b8f0);
      background: light-dark(#dbeafe, #1e3a8a);
    }
    .character-creation-qa-textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.6rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #0f172a);
      font-family: inherit;
      font-size: inherit;
      resize: vertical;
      min-height: 4rem;
    }
    .character-creation-qa-meta {
      margin-top: 0.3rem;
      font-size: 0.82em;
      color: light-dark(#64748b, #94a3b8);
    }
    .character-creation-qa-hint-warn {
      color: light-dark(#925a17, #d6a559);
    }
    /* D5.5-B: the "Connections" step (optional bond authoring). */
    .character-creation-connections-note {
      font-size: 0.88em;
    }
    .character-creation-connections-empty {
      font-style: italic;
    }
    .character-creation-connections-list {
      list-style: none;
      margin: 0.6rem 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    .character-creation-connections-row {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.6rem 0.7rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      border-radius: 0.4rem;
      background: light-dark(#f8fafc, #0f172a);
    }
    .character-creation-connections-target-label,
    .character-creation-connections-text-label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.85em;
      color: light-dark(#475569, #94a3b8);
    }
    .character-creation-connections-target,
    .character-creation-connections-text {
      width: 100%;
      box-sizing: border-box;
      padding: 0.45rem 0.6rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #1e293b);
      font-family: inherit;
      font-size: 1rem;
      color: inherit;
    }
    .character-creation-connections-text {
      resize: vertical;
      min-height: 2.6rem;
    }
    .character-creation-connections-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .character-creation-connections-remove {
      padding: 0.25rem 0.6rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: transparent;
      color: light-dark(#64748b, #94a3b8);
      cursor: pointer;
      font-size: 0.85em;
    }
    .character-creation-connections-remove:hover {
      border-color: light-dark(#b91c1c, #f87171);
      color: light-dark(#b91c1c, #f87171);
    }
    .character-creation-connections-add {
      padding: 0.45rem 0.9rem;
      border-radius: 0.3rem;
      border: 1px dashed light-dark(#94a3b8, #475569);
      background: transparent;
      color: light-dark(#334155, #cbd5e1);
      cursor: pointer;
      font-size: 0.95em;
    }
    .character-creation-connections-add:hover {
      border-color: light-dark(#334155, #cbd5e1);
    }
    /* P3U-3: "Required: pack your character" callout on step 5.
       Stronger visual weight than .muted because the action is
       load-bearing — without the pack, the DM has no way to receive
       the player's answers (live pull isn't wired yet). */
    .character-creation-required-pack {
      padding: 0.6rem 0.9rem;
      border-left: 3px solid light-dark(#925a17, #d6a559);
      background: light-dark(#fef9e9, #2a2104);
      color: light-dark(#3a2606, #e6d09a);
      border-radius: 3px;
    }
    .character-creation-required-pack strong {
      color: light-dark(#683f10, #f0c477);
    }
    /* CC-10: Pack-my-character button + transient feedback. */
    .character-creation-pack-actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-top: 0.7rem;
    }
    /* UX M4 (Cluster E step 8a): pack-button is now a PRIMARY
       action — the Required-pack callout above it makes the click
       load-bearing for Mode B handoff.  Pre-fix it read as a
       quiet bordered button; the chip-buttons above competed for
       the eye.  Filled treatment (amber background + light text)
       so the eye lands on it after reading the callout. */
    .character-creation-pack-button {
      padding: 0.55rem 1rem;
      border-radius: 0.3rem;
      border: 1px solid light-dark(#925a17, #d6a559);
      background: light-dark(#925a17, #d6a559);
      color: light-dark(#fef3c7, #1a0f00);
      cursor: pointer;
      font-weight: 600;
      font-size: 1rem;
    }
    .character-creation-pack-button:hover {
      background: light-dark(#683f10, #f0c477);
    }
    .character-creation-pack-feedback {
      font-size: 0.88em;
    }
    .character-creation-pack-feedback-ok {
      color: light-dark(#16803d, #4ade80);
    }
    .character-creation-pack-feedback-err {
      color: light-dark(#dc2626, #ef4444);
    }
    /* D5.5 first-session polish: subtle autosave indicator under the
       step content.  Green "✓ Saved" (matching pack-feedback-ok),
       right-aligned so it reads as ambient status, not a primary
       message.  The -warn variant overrides alignment/color below. */
    .character-creation-savestate {
      font-size: 0.82em;
      text-align: right;
      margin: 0.25rem 0 0;
      color: light-dark(#64748b, #94a3b8);
    }
    .character-creation-savestate-ok {
      color: light-dark(#16803d, #4ade80);
    }
    /* Sticky autosave-failure caution — amber, not red: the player's
       work isn't gone (they can still Pack/Send), but they shouldn't
       trust device-local persistence.  Left-aligned + slightly larger
       than the ok line since it carries an action. */
    .character-creation-savestate-warn {
      text-align: left;
      font-size: 0.88em;
      color: light-dark(#b45309, #fbbf24);
    }
    /* First-session polish: soft non-blocking nudge on the Done step
       when required Q&A answers are blank.  Amber caution + an inline
       jump-back button. */
    .character-creation-done-incomplete {
      padding: 0.4rem 0.6rem;
      border-left: 3px solid light-dark(#f59e0b, #d97706);
      background: light-dark(#fffbeb, #292524);
      font-size: 0.92em;
    }
    .character-creation-done-back {
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#fcd34d, #d97706);
      background: light-dark(#ffffff, #1c1917);
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 0.92em;
    }
    /* M3D-6: seat-strip list of bound PC slots.  One row per slot;
       slot label as a small pill, pc id beside, optional unbind ×
       button at row end. */
    .seat-strip-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .seat-strip-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0;
    }
    .seat-strip-slot {
      display: inline-block;
      min-width: 2.5rem;
      padding: 0.05rem 0.45rem;
      border-radius: 999px;
      font-size: 0.85em;
      font-weight: 600;
      text-align: center;
      background: light-dark(#fef3c7, #3a2a04);
      color: light-dark(#925a17, #d6a559);
    }
    .seat-strip-pc-id {
      flex: 1;
      font-variant-numeric: tabular-nums;
    }
    .seat-strip-unbind {
      width: 1.4rem;
      height: 1.4rem;
      padding: 0;
      border-radius: 999px;
      border: 1px solid light-dark(#cbd5e1, #334155);
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
      line-height: 1;
      font-weight: 600;
    }
    .seat-strip-unbind:hover {
      background: light-dark(#fee2e2, #3a1010);
      border-color: light-dark(#dc2626, #ef4444);
    }
    /* D5-cleanup (2026-05-27): dm-aside pending bond queue. */
    .dm-aside-bond-queue {
      border-left: 3px solid light-dark(#60a5fa, #3b82f6);
    }
    .dm-aside-bond-queue-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .dm-aside-bond-queue-row {
      border: 1px solid light-dark(#e2e8f0, #334155);
      border-radius: 4px;
      padding: 0.4rem 0.5rem;
      font-size: 0.85rem;
    }
    .dm-aside-bond-queue-summary,
    .dm-aside-bond-queue-text {
      margin: 0 0 0.2rem;
    }
    .dm-aside-bond-queue-text {
      font-style: italic;
    }
    .dm-aside-bond-queue-link {
      font-size: 0.82rem;
      color: light-dark(#1d4ed8, #93c5fd);
    }

    .dm-aside-pinned {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .dm-aside-pinned-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5em;
      padding: 0.15rem 0;
      border-bottom: 1px dotted light-dark(#ddd, #333);
    }
    .dm-aside-unpin {
      background: transparent;
      border: 0;
      cursor: pointer;
      color: light-dark(#aa3030, #ff8080);
      padding: 0 0.3rem;
      font-size: 1.1em;
      line-height: 1;
    }
    .dm-aside-unpin:hover {
      color: light-dark(#cc1010, #ffa0a0);
    }
    /* Wave C4 (2026-05-26): thread-debt selector + reset-spam chip
       ported from the dm-aside debt + spam-reset rules when the
       surfaces consolidated into dm-pc-detail.  Verifier caught
       the unported-styles regression — chip is amber so it reads
       as the "scene-boundary cue" the DM resets at scene breaks;
       selector tracks the surrounding dm-pc-detail-row typography. */
    .dm-pc-detail-thread-debt-select {
      font-size: 0.9em;
      padding: 0.1rem 0.3rem;
      max-width: 14ch;
    }
    .dm-pc-detail-spam-reset {
      font-size: 0.78em;
      padding: 0.1rem 0.5rem;
      background: light-dark(#fff7e0, #2a2618);
      border: 1px solid light-dark(#b8841a, #856010);
      color: light-dark(#5a4310, #ffd479);
      border-radius: 3px;
      cursor: pointer;
    }
    .dm-pc-detail-spam-reset:hover {
      background: light-dark(#fff2cf, #3a2f20);
    }
    .dm-rail-episodes {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .dm-rail-episode {
      padding: 0.2rem 0;
    }
    .dm-rail-episode-name {
      font-weight: 500;
    }
    .dm-rail-episode-current .dm-rail-episode-name {
      color: light-dark(#0b3d7f, #79b8f0);
    }
    .dm-rail-scenes {
      list-style: none;
      padding: 0;
      margin: 0.2rem 0 0 1rem;
      font-size: 0.9em;
    }
    .dm-rail-scene-current a {
      font-weight: 600;
      color: light-dark(#0b3d7f, #79b8f0);
    }
    /* M3D-7: dm-doc sublist beneath scenes; amber-tinted label
       echoes the dm-only caution palette so the DM has a glance
       cue that these are not read-aloud files.  Indent matches
       the scenes list for visual grouping. */
    .dm-rail-dmdocs-label {
      font-size: 0.78em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: light-dark(#925a17, #d6a559);
      margin: 0.4rem 0 0 1rem;
    }
    .dm-rail-dmdocs {
      margin-top: 0.1rem;
    }
    .dm-rail-scene-dmdoc a {
      color: light-dark(#925a17, #d6a559);
    }
    .dm-rail-scene-dmdoc.dm-rail-scene-current a {
      color: light-dark(#683f10, #f0c477);
    }

    /* M3b.5 P2-12: dual-card AI response.  Two stacked cards
       (safe + DM-only); the DM-only card carries amber border +
       lock badge + "do not read aloud" copy button.  Layout
       deliberately separates them with a gap so the DM can read
       one card without scanning the other. */
    .ai-dual-card {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      margin-top: 0.6rem;
    }
    .ai-card {
      border-radius: 5px;
      padding: 0.5rem 0.7rem;
      background: light-dark(#fafafa, #1c1c1c);
      border: 1px solid light-dark(#ddd, #444);
    }
    .ai-card-safe {
      border-left: 3px solid light-dark(#0a7a3a, #5ac985);
    }
    .ai-card-dm {
      border-left: 3px solid light-dark(#d4a017, #a07820);
      background: light-dark(#fffbe6, #2a2618);
    }
    .ai-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.3rem;
    }
    .ai-card-badge {
      font-size: 0.75em;
      font-variant: small-caps;
      letter-spacing: 0.05em;
      padding: 0.1rem 0.5rem;
      border-radius: 3px;
    }
    .ai-card-badge-safe {
      color: light-dark(#0a7a3a, #5ac985);
      background: light-dark(#e6f7ec, #1a3a25);
    }
    .ai-card-badge-dm {
      color: light-dark(#5a4310, #ffd479);
      background: light-dark(#fff7e0, #3a2f10);
      font-weight: 600;
    }
    .ai-card-action {
      margin-top: 0.4rem;
      font-size: 0.85em;
      padding: 0.3rem 0.7rem;
    }
    .ai-card-action-copy {
      background: light-dark(#fff, #2a2618);
      border: 1px solid light-dark(#b8841a, #856010);
    }
    .ai-card-sources {
      list-style: none;
      padding: 0;
      margin: 0.4rem 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.4em;
      font-size: 0.85em;
    }
    .ai-card-source code {
      background: light-dark(#eef, #1a2a3a);
      padding: 0.05rem 0.4rem;
      border-radius: 2px;
    }
    .ai-card-verdict {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.4rem;
    }
    .ai-card-accept,
    .ai-card-reject {
      font-size: 0.85em;
      padding: 0.25rem 0.7rem;
    }
    .ai-scope-toggle {
      display: flex;
      align-items: center;
      gap: 0.4em;
      margin: 0.4rem 0;
      font-size: 0.9em;
      color: light-dark(#666, #aaa);
    }
    .ai-scope-toggle input[type='checkbox'] {
      margin: 0;
    }

    /* M3b gate fix: inline budget meter in panel header + verdict
       feedback footer + budget-exceeded banner above prompt form. */
    .ai-budget {
      font-size: 0.8em;
      font-variant: tabular-nums;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
    }
    .ai-budget-ok {
      color: light-dark(#666, #aaa);
      background: light-dark(#f2f2f2, #2a2a2a);
    }
    .ai-budget-warning {
      color: light-dark(#5a4310, #ffd479);
      background: light-dark(#fff7e0, #3a2f10);
    }
    .ai-budget-exceeded {
      color: light-dark(#7a1010, #ff8080);
      background: light-dark(#ffe6e6, #3a1818);
      font-weight: 600;
    }
    .ai-budget-banner {
      padding: 0.4rem 0.7rem;
      margin: 0.3rem 0;
      background: light-dark(#ffe6e6, #3a1818);
      border-left: 3px solid light-dark(#aa3030, #ff6060);
      color: light-dark(#7a1010, #ff9090);
      border-radius: 3px;
      font-size: 0.9em;
    }
    .ai-card-verdict-done {
      padding: 0.2rem 0;
    }
    .ai-card-verdict-done .muted {
      font-style: italic;
    }

    /* M3c followup (Security): visible banner for rejected
       hard-gate AI proposals. */
    .ai-rejection-banner {
      padding: 0.45rem 0.7rem;
      margin: 0.4rem 0;
      background: light-dark(#fff7e0, #3a2f10);
      border-left: 4px solid light-dark(#d4a017, #a07820);
      color: light-dark(#5a4310, #ffd479);
      border-radius: 4px;
      font-size: 0.9em;
    }
    .ai-rejection-list {
      list-style: disc;
      padding-left: 1.3em;
      margin: 0.3rem 0 0;
    }
    .ai-rejection-list code {
      font-family: ui-monospace, monospace;
      font-size: 0.85em;
    }

    /* M3c followup (Adversarial A8): individual-review toggle. */
    .ai-review-every-toggle {
      display: flex;
      align-items: flex-start;
      gap: 0.4em;
      margin-top: 0.4rem;
      font-size: 0.9em;
      color: light-dark(#666, #aaa);
    }
    .ai-review-every-toggle input[type='checkbox'] {
      margin: 0.2em 0 0;
    }

    /* M3c.4: AI-write accept-gate strip in <ai-panel>.  Sits below
       the dual-card; one-line summary per state-update proposal,
       Apply-All-on-Enter, per-entry revert during 60s undo window,
       hard-gate carve-outs with their own Accept-this-change. */
    .ai-write-strip {
      margin-top: 0.7rem;
      padding: 0.5rem 0.7rem;
      background: light-dark(#f3f7fa, #1c2229);
      border-left: 3px solid light-dark(#3a6ea5, #5a8cc8);
      border-radius: 4px;
    }
    .ai-write-strip-head {
      display: flex;
      align-items: baseline;
      gap: 0.6em;
      margin-bottom: 0.4rem;
      flex-wrap: wrap;
    }
    .ai-write-strip-label {
      font-variant: small-caps;
      letter-spacing: 0.04em;
      color: light-dark(#3a6ea5, #79b8f0);
    }
    .ai-write-apply-all {
      padding: 0.25rem 0.7rem;
      font-size: 0.9em;
      background: light-dark(#3a6ea5, #2e5a8a);
      color: light-dark(#fff, #fff);
      border: 0;
      border-radius: 3px;
      cursor: pointer;
    }
    .ai-write-apply-all:hover {
      background: light-dark(#2e5a8a, #406ea5);
    }
    .ai-write-undo-banner {
      font-size: 0.85em;
      color: light-dark(#0a7a3a, #5ac985);
    }
    .ai-write-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .ai-write-entry {
      display: flex;
      align-items: baseline;
      gap: 0.5em;
      padding: 0.15rem 0;
      border-bottom: 1px dotted light-dark(#ccc, #333);
      font-size: 0.92em;
    }
    .ai-write-entry-text {
      flex: 1;
    }
    .ai-write-entry-detail {
      font-size: 0.85em;
    }
    .ai-write-entry-applied {
      opacity: 0.75;
    }
    .ai-write-entry-reverted {
      opacity: 0.5;
      text-decoration: line-through;
    }
    .ai-write-entry-hard-gate-pending {
      background: light-dark(#fff7e0, #2a2618);
      padding: 0.2rem 0.4rem;
      border-left: 2px solid light-dark(#d4a017, #a07820);
      margin-left: -0.4rem;
    }
    .ai-write-accept-one {
      background: light-dark(#fff, #2a2618);
      border: 1px solid light-dark(#b8841a, #856010);
      color: light-dark(#5a4310, #ffd479);
      padding: 0.15rem 0.5rem;
      font-size: 0.85em;
      cursor: pointer;
      border-radius: 3px;
    }
    .ai-write-status-tag {
      font-size: 0.8em;
      color: light-dark(#0a7a3a, #5ac985);
    }
    .ai-write-revert-one {
      background: transparent;
      border: 0;
      cursor: pointer;
      color: light-dark(#aa3030, #ff8080);
      font-size: 0.85em;
    }

    /* M3a.8 P2-3: DM scratch column (Dock region). */
    .dm-scratch textarea {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      min-height: 2.5em;
      font-family: inherit;
    }
    .dm-scratch button {
      margin-top: 0.3rem;
    }
    .dm-scratch-list {
      list-style: none;
      padding: 0;
      margin: 0.4rem 0 0;
      font-size: 0.9em;
    }
    .dm-scratch-entry {
      padding: 0.2rem 0;
      border-top: 1px dotted light-dark(#ccc, #444);
      display: flex;
      gap: 0.4em;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .dm-scratch-ts {
      color: light-dark(#777, #999);
      font-size: 0.85em;
    }
    .dm-scratch-scene {
      color: light-dark(#888, #999);
    }

    /* M3a.8 P2-4/P2-5: DM-only affordances on the character page —
       NPC pin button or PC thread-debt selector.  Sits as a small
       card above the player-rail. */
    .dm-affordances {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.4rem 0.7rem;
      background: light-dark(#fffbe6, #2a2618);
      border-left: 3px solid light-dark(#d4a017, #a07820);
    }
    .dm-pin-btn {
      padding: 0.35rem 0.7rem;
      background: light-dark(#fff, #1f1f1f);
      border: 1px solid light-dark(#bbb, #555);
      border-radius: 3px;
      cursor: pointer;
    }
    /* M3a.8 P2-11: broadcast button (DM-only, in scene header). */
    .scene-broadcast-btn {
      display: inline-block;
      margin-left: 0.5rem;
      padding: 0.3rem 0.7rem;
      background: light-dark(#e3edf7, #1f3a5a);
      color: light-dark(#0b3d7f, #79b8f0);
      border: 1px solid light-dark(#a6c4e3, #2c5a8a);
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9em;
    }
    .scene-broadcast-btn:hover {
      background: light-dark(#cfe1f2, #2a4a6e);
    }

    /* M3a.8 P2-10: caution rail when the loaded scene path is
       DM-only (starts with dm/ or contains /dm/).  Amber border on
       the card + sticky banner so the DM cannot misread DM-only
       prose at the table.  Visual is intentionally heavy — the
       "do not read aloud" contract is load-bearing. */
    .dm-caution-banner {
      position: sticky;
      top: 0;
      z-index: 10;
      background: light-dark(#fff7e0, #3a2f10);
      border: 1px solid light-dark(#d4a017, #a07820);
      border-left-width: 4px;
      padding: 0.45rem 0.7rem;
      margin: 0 0 0.4rem;
      color: light-dark(#5a4310, #ffd479);
      border-radius: 4px;
    }
    .dm-caution-card {
      border-left: 4px solid light-dark(#d4a017, #a07820);
    }

    /* M3a.7 P2-2: per-block scene rendering + DM gutter pips.
       Players see only revealed blocks (DOM-omitted; this is paced
       disclosure, not confidentiality — see scene-stage.ts).  The
       DM view opts into the gutter via .scene-block-dm so older
       browsers without :has() still flow player blocks normally. */
    .scene-block {
      margin: 1em 0;
    }
    .scene-block-dm {
      display: grid;
      grid-template-columns: 1.5rem 1fr;
      gap: 0.4rem;
      align-items: start;
      margin: 0.2rem 0;
      padding: 0.1rem 0;
    }
    .scene-block-hidden {
      opacity: 0.5;
    }
    .scene-block-pip {
      grid-column: 1;
      background: transparent;
      border: 0;
      padding: 0.1rem 0.2rem;
      color: light-dark(#555, #aaa);
      cursor: pointer;
      font-size: 1.1em;
      line-height: 1;
      border-radius: 3px;
    }
    .scene-block-pip:hover {
      background: light-dark(#eee, #2a2a2a);
    }
    .scene-block-pip[aria-pressed='true'] {
      color: light-dark(#0a7a3a, #5ac985);
    }
    .scene-block-body {
      grid-column: 2;
      min-width: 0;
    }
    .scene-block-body > :first-child {
      margin-top: 0;
    }
    .scene-block-body > :last-child {
      margin-bottom: 0;
    }

    /* FU-5: lapsed-pip strip rendered at the END of the DM's block
       list when revealedParagraphs contains hashes that no longer
       match any current block.  Distinct color (half-circle glyph,
       muted hue) so the DM sees what changed after editing the
       campaign text mid-session. */
    .scene-block-lapsed-strip {
      grid-template-columns: 1fr;
      padding: 0.5rem 0.7rem;
      margin-top: 0.5rem;
      background: light-dark(#f5efe0, #2a2618);
      border-left: 3px solid light-dark(#b8841a, #856010);
      border-radius: 3px;
      font-size: 0.85em;
    }
    .scene-block-lapsed-label {
      color: light-dark(#5a4310, #c0a050);
      font-variant: small-caps;
      letter-spacing: 0.04em;
    }
    .scene-block-lapsed-list {
      list-style: none;
      padding: 0;
      margin: 0.3rem 0 0;
    }
    .scene-block-lapsed-list li {
      display: flex;
      align-items: center;
      gap: 0.4em;
      padding: 0.1rem 0;
    }
    .scene-block-pip-lapsed {
      color: light-dark(#b8841a, #c0a050) !important;
    }
    .scene-block-lapsed-hash {
      font-family: monospace;
      color: light-dark(#777, #999);
    }

    /* M3D-4b: dice-Dock primary action row.  The Roll-2d6 button is
       the most visually prominent control in the dock — table-friction
       lowest path is "click one thing to roll the canonical 2d6."
       Cast (Costly / Hard) macros sit beside it when stats are bound,
       prefilling the WIS modifier. */
    .dice-primary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      margin: 0.4rem 0 0.55rem;
    }
    .dice-primary-roll {
      font-size: 1.05rem;
      font-weight: 600;
      padding: 0.55rem 1.1rem;
      border: 1px solid light-dark(#1d4ed8, #6bb6ff);
      border-radius: 6px;
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#1e3a8a, #dbeafe);
      cursor: pointer;
      letter-spacing: 0.02em;
    }
    .dice-primary-roll:hover {
      background: light-dark(#bfdbfe, #1e40af);
    }
    .dice-primary-mod {
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
      opacity: 0.85;
      margin-left: 0.2rem;
    }
    .dice-primary-cast {
      font-weight: 500;
      padding: 0.5rem 0.85rem;
      border: 1px solid light-dark(#7c3aed, #c4b5fd);
      border-radius: 6px;
      background: light-dark(#ede9fe, #4c1d95);
      color: light-dark(#4c1d95, #ede9fe);
      cursor: pointer;
    }
    .dice-primary-cast:hover {
      background: light-dark(#ddd6fe, #5b21b6);
    }
    /* P3-sanity UX M5: re-skinned away from amber (which ui.md
       reserves for DM-only material — --dm-amber is the caution-
       rail / DM-aside hue).  Cast (Hard) is a high-stakes player
       action that auto-marks 2 stress per rules.md; red/orange
       signals "higher stakes" without colliding with the DM-amber
       semantic. */
    .dice-primary-cast-hard {
      border-color: light-dark(#b91c1c, #f87171);
      background: light-dark(#fee2e2, #5f1d1d);
      color: light-dark(#7f1d1d, #fee2e2);
    }
    .dice-primary-cast-hard:hover {
      background: light-dark(#fecaca, #7f1d1d);
    }

    /* UX M6 (Cluster E step 8b): pills repositioned to the RIGHT
       of the form (per ui.md L156 spec) and the duplicate full
       history list dropped.  Form + pills now share a flex row;
       on narrow viewports the pills wrap below. */
    .dice-form-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      align-items: center;
    }
    .dice-form-row > .roll-form {
      flex: 1 1 18ch;
    }
    .dice-recent-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin: 0;
      padding: 0;
      list-style: none;
      flex: 0 1 auto;
    }
    .dice-recent-pill {
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      background: light-dark(#f1f5f9, #1e293b);
      border: 1px solid light-dark(#cbd5e1, #334155);
      font-size: 0.85em;
      max-width: 30ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      /* Slide newly-inserted roll pills in from the left so the
         player has a clear "new roll arrived" cue.  Old pills
         (retained between renders via the Lit \`repeat\` key) keep
         their animation-name from a prior render but don't
         re-fire — only freshly inserted DOM nodes run the keyframe.
         Honors prefers-reduced-motion (rule below). */
      animation: dice-pill-slide-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @keyframes dice-pill-slide-in {
      from {
        transform: translateX(-32px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .dice-recent-pill {
        animation: none;
      }
    }
    .dice-recent-pill code {
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
      background: transparent;
      padding: 0;
    }

    /* M3a.6a: dice stat chips. */
    .dice-stat-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35em;
      margin: 0.35rem 0 0.65rem;
    }
    .dice-stat-chip {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 0.05rem;
      padding: 0.3rem 0.55rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 6px;
      background: light-dark(#fafafa, #1f1f1f);
      color: inherit;
      cursor: pointer;
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
      min-width: 3.2em;
    }
    .dice-stat-chip:hover {
      background: light-dark(#f0f0f0, #2c2c2c);
    }
    .dice-stat-label {
      font-size: 0.7em;
      letter-spacing: 0.05em;
      opacity: 0.7;
    }
    .dice-stat-mod {
      font-size: 1.05em;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    /* M3D-4: inline modifier stepper next to the stat chip row.
       Bounded ±2 per the rules cap (engine default; V-5
       wire-through honors campaign-declared bounds later).
       Sits BELOW the chip row in column flex so it's always
       visible without competing for chip space. */
    .dice-modifier-stepper {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0.3rem 0 0.3rem 0.2rem;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: light-dark(#f1f5f9, #1e293b);
    }
    .dice-modifier-step {
      width: 1.6rem;
      height: 1.6rem;
      padding: 0;
      border: 1px solid light-dark(#cbd5e1, #334155);
      border-radius: 999px;
      background: light-dark(#ffffff, #0f172a);
      cursor: pointer;
      font-weight: 600;
      line-height: 1;
    }
    .dice-modifier-step:hover:not(:disabled) {
      background: light-dark(#e2e8f0, #1e293b);
    }
    .dice-modifier-step:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .dice-modifier-value {
      font-variant-numeric: tabular-nums;
      min-width: 1.6rem;
      text-align: center;
      font-weight: 500;
      color: light-dark(#64748b, #94a3b8);
    }
    .dice-modifier-value-active {
      color: light-dark(#0b3d7f, #79b8f0);
      font-weight: 700;
    }

    /* M3D-4: doubles halo on roll-history entries.  Red ring on
       snake-eyes (double-1) so the DM doesn't miss the
       complication beat; gold on box-cars (double-6) so the DM
       doesn't miss the positive beat.  Per ui.md L156 +
       TTRPG-craft expert recommendation. */
    .roll-doubles-snake-eyes {
      box-shadow: 0 0 0 2px light-dark(#dc2626, #ef4444);
      border-radius: 0.25rem;
      padding: 0 0.2rem;
    }
    .roll-doubles-box-cars {
      box-shadow: 0 0 0 2px light-dark(#d97706, #fbbf24);
      border-radius: 0.25rem;
      padding: 0 0.2rem;
    }

    /* ---- M2.5/M2.8/M2.9 affordances (gate-close minimum styling). ---- */

    /* M2.8: ✋ glyph on roster rows for peers with raised hand. */
    .roster-hand {
      display: inline-block;
      margin: 0 0.4em;
      padding: 0 0.3em;
      border-radius: 999px;
      background: light-dark(#fef3c7, #3a2a04);
      font-size: 0.95em;
      line-height: 1.4;
    }

    /* M2.8: raise-hand button in the dice dock.  Subdued by default;
       active state (hand raised) flips background to amber so the
       state is visible at a glance.  Positioned slightly apart from
       the Roll button via flex gap inherited from .roll-form. */
    .raise-hand {
      margin-left: 0.75em;
      padding: 0.25rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }
    .raise-hand:hover {
      background: light-dark(#f4f4f4, #2c2c2c);
    }
    .raise-hand-active {
      background: light-dark(#fef3c7, #5a3f0a);
      border-color: light-dark(#d4a818, #c08c10);
    }

    /* M2.9 (P0-12-followup-banner): peer-version mismatch warning.
       Sits above the roster list, warm-tinted so it reads as
       informational rather than alarming.  role=status announces
       politely; the ⚠ glyph is the secondary signal. */
    .version-mismatch-banner {
      margin: 0.5rem 0;
      padding: 0.4em 0.7em;
      border-left: 3px solid light-dark(#d4a818, #c08c10);
      background: light-dark(#fef9e7, #2a2104);
      color: light-dark(#5a4a08, #f0e4b8);
      font-size: 0.85em;
      line-height: 1.4;
    }
    .version-mismatch-banner strong {
      color: inherit;
    }
`;

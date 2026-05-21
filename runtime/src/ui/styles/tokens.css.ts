/**
 * Design tokens (M1 foundation).
 *
 * Dark-first oklch palette + clamp() typography per `quire/design/ui.md`.
 * Tokens are exposed as CSS custom properties on `:host`; component CSS
 * (per-region styles) consumes them as `var(--surface-bg)` etc.
 *
 * The existing legacy palette in `quire-app.css.ts` (using `light-dark()`)
 * stays in place during M1. M2 region extractions will progressively
 * migrate components to consume these tokens directly.
 *
 * Spec source of truth: `quire/design/ui.md#color-tokens` and
 * `#reactive-typography`.
 */

import { css } from 'lit';

export const tokens = css`
  :host {
    /* ---- Surface + ink (dark-first) ---- */
    --surface-bg: oklch(16% 0.01 250);
    --surface-card: oklch(20% 0.012 250);
    --ink-prose: oklch(92% 0.01 90);

    /* ---- Accent + signals ---- */
    --accent-teal: oklch(72% 0.09 200);
    --dm-amber: oklch(78% 0.13 75);
    --harm-red: oklch(64% 0.16 25);
    --stress-violet: oklch(64% 0.12 295);

    /* ---- DM-only fill (amber at 8% alpha over surface-card) ---- */
    --dm-amber-fill: color-mix(in oklch, var(--dm-amber) 8%, var(--surface-card));

    /* ---- Spacing scale (4 px baseline, 8 px grid) ---- */
    --s-1: 4px;
    --s-2: 8px;
    --s-3: 12px;
    --s-4: 16px;
    --s-6: 24px;
    --s-8: 32px;

    /* ---- Radii ---- */
    --r-chip: 4px;
    --r-card: 8px;

    /* ---- Typography (clamp-driven, anchored to viewport width) ---- */
    --type-chrome-tight: clamp(12px, 0.55vw + 6px, 14px);
    --type-chrome-base: clamp(14px, 0.78vw + 8px, 18px);
    --type-section: clamp(15px, 1.2vw + 4px, 22px);
    --type-prose: clamp(16px, 0.95vw + 8px, 22px);
    --type-dice: clamp(28px, 2.4vw + 10px, 56px);

    /* ---- Borders + elevation ---- */
    --border-hairline: 1px solid color-mix(in oklch, var(--ink-prose) 12%, transparent);
    --border-dm-rail: 4px solid var(--dm-amber);

    /* ---- Motion ---- */
    --motion-hover: 100ms ease-out;
    --motion-state: 220ms ease-out;
    --motion-region: 180ms ease-out;
  }

  @media (prefers-color-scheme: light) {
    :host {
      --surface-bg: oklch(98% 0.005 90);
      --surface-card: oklch(100% 0 0);
      --ink-prose: oklch(20% 0.01 250);
      --accent-teal: oklch(58% 0.11 200);
      --dm-amber: oklch(62% 0.14 75);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --motion-hover: 0ms;
      --motion-state: 0ms;
      --motion-region: 0ms;
    }
  }
`;

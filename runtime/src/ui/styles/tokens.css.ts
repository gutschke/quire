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

    /**
     * Public token contract — coordinate renames.
     * Run #15 (visual-design expert v2 Q10): once a region rule
     * consumes a token (e.g. var(--r-card)), the token name
     * becomes a load-bearing public contract.  The brittle-class
     * radar in quire-app.css.ts (line 105) tracks which token
     * names are now consumed by region rules; if you rename a
     * token there, update the consumers in lockstep.  Tokens
     * known to be consumed by region rules as of run #15:
     *   --r-pill, --r-card, --shadow-card, --shadow-elev-1,
     *   --ring-focus, --button-bg, --button-bg-hover,
     *   --button-bg-primary, --button-ink-primary,
     *   --surface-card, --border-hairline.
     */
    /* ---- Radii (run #14 — collapsed 12-value sprawl to 3-step scale) ---- */
    --r-chip: 4px;
    --r-card: 8px;
    --r-pill: 999px;

    /* ---- Typography (clamp-driven, anchored to viewport width) ---- */
    --type-chrome-tight: clamp(12px, 0.55vw + 6px, 14px);
    --type-chrome-base: clamp(14px, 0.78vw + 8px, 18px);
    --type-section: clamp(15px, 1.2vw + 4px, 22px);
    --type-prose: clamp(16px, 0.95vw + 8px, 22px);
    --type-dice: clamp(28px, 2.4vw + 10px, 56px);

    /* ---- Borders + elevation ---- */
    --border-hairline: 1px solid color-mix(in oklch, var(--ink-prose) 12%, transparent);
    --border-dm-rail: 4px solid var(--dm-amber);

    /* ---- Shadows + focus ring (run #14 visual pass) ---- */
    --shadow-card: 0 1px 2px color-mix(in oklch, black 8%, transparent),
                   0 4px 12px color-mix(in oklch, black 6%, transparent);
    --shadow-elev-1: 0 2px 6px color-mix(in oklch, black 12%, transparent);
    --ring-focus: 0 0 0 2px color-mix(in oklch, var(--accent-teal) 55%, transparent);

    /* ---- Button surfaces (run #14 visual pass) ---- */
    --button-bg: var(--surface-card);
    --button-bg-hover: color-mix(in oklch, var(--surface-card) 88%, var(--accent-teal));
    --button-bg-primary: var(--accent-teal);
    --button-ink-primary: oklch(15% 0.01 250);

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

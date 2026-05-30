/**
 * <quire-shell> — the 7-column grid container with resizable
 * splitter slots.
 *
 *   +--------------------------------------------------------------------------+
 *   |                         TOPBAR (40 px)                                   |
 *   +--------+---+----------------------------------------+---+----------------+
 *   |        | s |                                        | s |                |
 *   |  RAIL  | p |                STAGE                   | p |     ASIDE      |
 *   |        | l |             (1fr, scrolls)             | l |                |
 *   |        | R |                                        | A |                |
 *   +--------+---+----------------------------------------+---+----------------+
 *   |                       DOCK (auto, ~56–120 px)                            |
 *   +--------------------------------------------------------------------------+
 *
 * Run #19 (2026-05-30) — UX-MH-4 resizable region dividers per the
 * visual designer's spec:
 *
 *  - 7-column grid (was 3): two new 6 px hit-gutter columns flank
 *    the Stage.
 *  - `splitter-rail` and `splitter-aside` named slots host the
 *    `<button>` splitter handles.  Slotted children (LL-3 mitigation
 *    — d5d1a9c lesson: unslotted children don't lay out in the grid
 *    template).  The host wires the `<button>` elements with
 *    pointer-capture drag logic.
 *  - `--rail-w` and `--aside-w` CSS custom properties drive the
 *    column widths.  The host inline-styles them on the shell as
 *    the user drags.  First paint before any JS = today's behavior
 *    via the `clamp()` fallback.
 *  - Aside default bumped per visual designer R-H from
 *    `clamp(280px, 30ch, 340px)` to `clamp(320px, 32ch, 380px)` —
 *    addresses the user's "very narrow" complaint without the user
 *    having to touch the handle.
 *
 * The handles themselves render as 6 px-wide buttons inside the
 * splitter columns.  The visible rule is painted via inset shadow
 * (1 px idle, 2 px hover/drag) so the box never resizes — drag
 * math would otherwise skew on hover.
 *
 * Splitter drag / keyboard / reset logic + ARIA wiring + persistence
 * lives in the host element (`quire-app.ts`).  The shell exposes the
 * slots + grid plumbing only.
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-shell')
export class QuireShell extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-areas:
        'topbar topbar  topbar topbar  topbar'
        'rail   splitR  stage  splitA  aside '
        'dock   dock    dock   dock    dock  ';
      grid-template-rows: auto 1fr auto;
      grid-template-columns:
        var(--rail-w, clamp(260px, 28ch, 320px))
        6px
        minmax(0, 1fr)
        6px
        var(--aside-w, clamp(320px, 32ch, 380px));
      gap: 0;
      width: 100dvw;
      height: 100dvh;
      box-sizing: border-box;
      overflow: hidden;
    }

    /*
     * Slot containers — Lit assigns slotted children based on their
     * slot="X" attribute on the host instance.  We place each slot
     * into the corresponding grid area.  Each slot is itself a
     * scroll container so its region's content can overflow without
     * affecting siblings.
     */
    .area {
      min-width: 0;
      min-height: 0;
      overflow: auto;
    }
    .area-topbar {
      grid-area: topbar;
      overflow: visible;
    }
    .area-rail {
      grid-area: rail;
    }
    .area-stage {
      grid-area: stage;
    }
    .area-aside {
      grid-area: aside;
    }
    .area-dock {
      grid-area: dock;
      overflow: visible;
    }

    /*
     * Run #19 UX-MH-4: splitter gutters.  6 px hit-target with a
     * 1-2 px visible inset-shadow rule (painted, not box-sized).
     * Hover + drag widen the rule to 2 px in the accent-teal color.
     * The data-dragging attribute on the handle (set by the host's
     * pointer-capture logic) keeps the dragged state highlighted
     * even after the pointer leaves the handle area.
     */
    .area-splitter-rail {
      grid-area: splitR;
      overflow: visible;
    }
    .area-splitter-aside {
      grid-area: splitA;
      overflow: visible;
    }
    /* The slotted <button> uses the area as its host; default
       button browser styles get stripped via the host's CSS in
       quire-app.css. */

    /*
     * Touch hit-target widening per visual designer adversarial #4:
     * WCAG 2.5.5 says 6 px is too small for coarse pointers.
     * Widen the GUTTER (not the visible rule) under coarse-pointer.
     */
    @media (pointer: coarse) {
      :host {
        grid-template-columns:
          var(--rail-w, clamp(260px, 28ch, 320px))
          12px
          minmax(0, 1fr)
          12px
          var(--aside-w, clamp(320px, 32ch, 380px));
      }
    }

    /*
     * Narrow viewport (≤ 1100 px, per ui.md L59): collapse to Rail
     * + Stage.  Aside + both splitter gutters disappear with the
     * Aside (the Aside-splitter is meaningless without an Aside);
     * the Rail-splitter survives so the DM can still resize the
     * Rail at narrow widths.  Per visual designer R-H persistence
     * spec the saved width is preserved across the collapse — when
     * the viewport widens again, both Aside + Aside-splitter re-
     * appear at the user's last value.
     */
    @media (max-width: 1100px) {
      :host {
        grid-template-areas:
          'topbar topbar  topbar'
          'rail   splitR  stage '
          'dock   dock    dock  ';
        grid-template-columns:
          var(--rail-w, clamp(220px, 26ch, 300px))
          6px
          minmax(0, 1fr);
      }
      .area-aside,
      .area-splitter-aside {
        display: none;
      }
    }
  `;

  override render(): TemplateResult {
    return html`
      <div class="area area-topbar"><slot name="topbar"></slot></div>
      <div class="area area-rail"><slot name="rail"></slot></div>
      <div class="area area-splitter-rail">
        <slot name="splitter-rail"></slot>
      </div>
      <div class="area area-stage"><slot name="stage"></slot></div>
      <div class="area area-splitter-aside">
        <slot name="splitter-aside"></slot>
      </div>
      <div class="area area-aside"><slot name="aside"></slot></div>
      <div class="area area-dock"><slot name="dock"></slot></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-shell': QuireShell;
  }
}

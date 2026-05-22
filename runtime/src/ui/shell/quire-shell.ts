/**
 * <quire-shell> — the five-region grid container.
 *
 * Per `quire/design/ui.md` the play-app shell is a single CSS Grid with
 * Topbar / Rail / Stage / Aside / Dock regions filling the viewport.
 *
 *   +----------------------------------------------------------------------+
 *   |                       TOPBAR (40 px)                                 |
 *   +----------+---------------------------------------------+-------------+
 *   |          |                                             |             |
 *   |   RAIL   |                  STAGE                      |    ASIDE    |
 *   |          |               (1fr, scrolls)                |             |
 *   |          |                                             |             |
 *   +----------+---------------------------------------------+-------------+
 *   |                  DOCK (auto, ~56–120 px)                             |
 *   +----------------------------------------------------------------------+
 *
 * Each region owns its own scroll; the shell itself never produces an
 * outer scrollbar.  Rail + Aside are sized in `ch` so they're driven by
 * the readable content width; Stage absorbs the rest.
 *
 * Slots:
 *   - topbar : <quire-topbar> placement (mode chip, session info)
 *   - rail   : <quire-rail>   (sheet for players; nav + active-PC for DM)
 *   - stage  : <quire-stage>  (scene / outline / map)
 *   - aside  : <quire-aside>  (roster, AI, chat)
 *   - dock   : <quire-dock>   (dice, reveal, broadcast, DM scratch)
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-shell')
export class QuireShell extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-areas:
        'topbar topbar topbar'
        'rail   stage  aside '
        'dock   dock   dock  ';
      grid-template-rows: auto 1fr auto;
      grid-template-columns:
        clamp(260px, 28ch, 320px)
        minmax(0, 1fr)
        clamp(280px, 30ch, 340px);
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
     * Narrow viewport (≤ 1100 px, per ui.md L59): collapse the
     * 3-column layout to Rail + Stage.  Aside disappears for v1
     * (the design calls for a slide-over drawer; that lands later).
     * Below 820 px we keep the 2-column layout but the Stage may
     * still feel cramped — design says "Quire is tuned for a larger
     * window."  No phone layout.
     */
    @media (max-width: 1100px) {
      :host {
        grid-template-areas:
          'topbar topbar'
          'rail   stage '
          'dock   dock  ';
        grid-template-columns: clamp(220px, 26ch, 300px) minmax(0, 1fr);
      }
      .area-aside {
        display: none;
      }
    }
  `;

  override render(): TemplateResult {
    return html`
      <div class="area area-topbar"><slot name="topbar"></slot></div>
      <div class="area area-rail"><slot name="rail"></slot></div>
      <div class="area area-stage"><slot name="stage"></slot></div>
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

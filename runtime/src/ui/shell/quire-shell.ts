/**
 * <quire-shell> — the five-region grid container.
 *
 * Per `quire/design/ui.md` the play-app shell is a single CSS Grid with
 * Topbar / Rail / Stage / Aside / Dock regions.  During M1 the shell is
 * declared but uses `display: contents` so the legacy stack-of-cards
 * layout (still controlled by the styles in `quire-app.css.ts`) remains
 * visually unchanged.  In M2 the shell's `:host` rule promotes to a real
 * grid; by then the region elements own their own styles and the legacy
 * sheet has shrunk.
 *
 * Slots:
 *   - topbar : <quire-topbar> placement (mode chip, session info)
 *   - rail   : <quire-rail>   (sheet for players; nav + active-PC for DM)
 *   - stage  : <quire-stage>  (scene / outline / map)
 *   - aside  : <quire-aside>  (roster, AI, chat)
 *   - dock   : <quire-dock>   (dice, reveal, broadcast, DM scratch)
 *
 * Acceptance for M1: this element exists, exposes the slots, and is
 * structurally transparent.  No reactive props yet — those land per-
 * region in M2.
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-shell')
export class QuireShell extends LitElement {
  static styles = css`
    /*
     * M1 layout: display:contents makes the shell invisible to layout,
     * so children flow as if there were no wrapper.  This preserves
     * the legacy stack visually while the structural decomposition
     * lands.  M2 swaps this for a real grid.
     */
    :host {
      display: contents;
    }
  `;

  override render(): TemplateResult {
    return html`
      <slot name="topbar"></slot>
      <slot name="rail"></slot>
      <slot name="stage"></slot>
      <slot name="aside"></slot>
      <slot name="dock"></slot>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-shell': QuireShell;
  }
}

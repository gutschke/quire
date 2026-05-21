/**
 * <quire-rail> — left region.
 *
 * M1 stub: structural slot only.  Per `ui.md`, the Rail is:
 *   - Players: condensed character sheet, tap-to-expand in place
 *   - DM: scene navigator (top ~60%) + active-PC focus card with
 *     thread-debt ladder inline (bottom ~40%); roster-mirror toggle.
 * Both views land in M2 (player) and M3a (DM).
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-rail')
export class QuireRail extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
  `;

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-rail': QuireRail;
  }
}

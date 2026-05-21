/**
 * <quire-topbar> — top region.
 *
 * M1 stub: structural slot only.  Receives the existing session bar via
 * the default slot from `quire-app.ts`.  Per `ui.md`, the Topbar will
 * eventually hold: Quire brand chip, current campaign + episode title,
 * mode chip, status / me chip, and (DM-only) the thread-debt ladder
 * slot for v1.1.  Those land in M2/M3a.
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-topbar')
export class QuireTopbar extends LitElement {
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
    'quire-topbar': QuireTopbar;
  }
}

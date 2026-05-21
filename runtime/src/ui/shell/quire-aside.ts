/**
 * <quire-aside> — right region.
 *
 * M1 stub: structural slot only.  Per `ui.md`, the Aside is
 * roster-dominant:
 *   - Roster (top, largest)
 *   - Pinned NPCs (DM-only, middle, expandable)
 *   - Stakes / pacing collapsed strip (DM-only)
 *   - AI console (DM-only, bottom, collapsed to one input row until used)
 *   - Chat (collapsible strip, default collapsed in-person)
 *   - Private notes (player view, bottom)
 * Population by mode lands in M2 (player aside) and M3a/M3b
 * (DM aside).
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-aside')
export class QuireAside extends LitElement {
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
    'quire-aside': QuireAside;
  }
}

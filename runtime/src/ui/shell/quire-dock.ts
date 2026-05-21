/**
 * <quire-dock> — bottom region.
 *
 * M1 stub: structural slot only.  Per `ui.md`, the Dock holds:
 *   - Players: dice bar (6 stat chips + modifier stepper + roll button
 *     + last-3 pills); raise-hand button
 *   - DM: dice bar + Reveal button + Broadcast button + scratch-column
 *     strip at Dock-top (always-visible one-line input, hotkey `'`)
 * Lands in M2 (dice + raise-hand) and M3a (DM verbs + scratch).
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-dock')
export class QuireDock extends LitElement {
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
    'quire-dock': QuireDock;
  }
}

/**
 * <quire-stage> — center region.
 *
 * M1 stub: structural slot only.  Per `ui.md`, the Stage holds the
 * "thing the table is looking at together":
 *   - Players: revealed scene prose, ~68ch centered, with scene-strip
 *     header (name·location·mood·duration·presentNpcs)
 *   - DM: same scene plus a left gutter column with per-paragraph
 *     reveal pips; Stage tabs (Scene · Outline · NPCs · Map);
 *     caution rail on `dm/*` content
 * In post-session mode the Stage shows the living-document diff
 * review; in authoring mode it's the markdown editor / preview split.
 * All landings: M2/M3a (scene), M4 (diff), M5 (authoring), M6 (map).
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('quire-stage')
export class QuireStage extends LitElement {
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
    'quire-stage': QuireStage;
  }
}

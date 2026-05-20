import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

/**
 * Root component for the Quire play app.
 *
 * Phase 1 scaffold cut: reads the ?campaign= URL parameter, displays a
 * placeholder.  Real campaign loading, schema validation, and the play UI
 * land in subsequent commits.
 */
@customElement('quire-app')
export class QuireApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 60ch;
      margin: 2rem auto;
      padding: 1rem;
      line-height: 1.5;
      color: light-dark(#111, #eee);
      background: light-dark(#fff, #1a1a1a);
    }
    h1 {
      font-size: 1.5rem;
      margin-top: 0;
    }
    .placeholder {
      padding: 1rem;
      border: 1px dashed light-dark(#888, #555);
      background: light-dark(#fafafa, #222);
      border-radius: 4px;
    }
    code {
      background: light-dark(#f0f0f0, #2a2a2a);
      padding: 0 0.25rem;
      border-radius: 3px;
      font-size: 0.95em;
    }
    a {
      color: light-dark(#0050a0, #6bb6ff);
    }
  `;

  @state() private campaignSlug: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    const params = new URLSearchParams(window.location.search);
    this.campaignSlug = params.get('campaign');
  }

  override render(): TemplateResult {
    return html`
      <h1>Quire</h1>
      <p>
        Browser-based TTRPG framework for collaborative interactive
        storytelling.
      </p>
      ${this.campaignSlug
        ? html`<p>
            Campaign requested: <code>${this.campaignSlug}</code>
            <br />Loader not yet implemented; this is the phase-1 scaffold.
          </p>`
        : html`<p>
            No campaign specified. Append
            <code>?campaign=&lt;owner&gt;/&lt;repo&gt;</code> to the URL to
            load a campaign once the loader ships.
          </p>`}
      <div class="placeholder">
        <p>
          <strong>Runtime under construction.</strong> Phase 1 in progress;
          see
          <a href="https://github.com/gutschke/quire">the project repository</a>
          for status.
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-app': QuireApp;
  }
}

import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import {
  loadCampaign,
  fetchCampaignFile,
  CampaignLoadError,
  type LoadedCampaign
} from './campaign-loader';
import { renderMarkdown } from './markdown';

interface CampaignWithExtras {
  data: LoadedCampaign;
  worldOverview: string | null;
}

type AppState =
  | { kind: 'idle' }
  | { kind: 'loading'; slug: string }
  | { kind: 'loaded'; loaded: CampaignWithExtras }
  | { kind: 'error'; message: string; details?: string };

function isAbortError(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError';
}

/**
 * Root component for the Quire play app.
 *
 * Phase 1: reads ?campaign=<owner>/<repo>[@ref], fetches the manifest and
 * (optionally) the public world overview, validates, and renders.  The play
 * UI proper — scenes, sheets, dice, AI prompt-bar — lands in subsequent
 * commits.
 */
@customElement('quire-app')
export class QuireApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 65ch;
      margin: 2rem auto;
      padding: 1rem;
      line-height: 1.55;
      color: light-dark(#111, #eee);
      background: light-dark(#fff, #1a1a1a);
    }

    header h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .summary {
      font-style: italic;
      margin: 0.5rem 0 1.5rem;
      color: light-dark(#444, #aaa);
    }

    .card {
      padding: 1rem 1.25rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 6px;
      margin: 1rem 0;
      background: light-dark(#fcfcfc, #1f1f1f);
    }

    .card h2 {
      margin-top: 0;
      font-size: 1.15rem;
    }

    .card h3 {
      font-size: 1rem;
      margin: 1rem 0 0.5rem;
    }

    .card.placeholder {
      border-style: dashed;
      background: light-dark(#fafafa, #222);
    }

    .card.error {
      border-color: light-dark(#d77, #d44);
      background: light-dark(#fff5f5, #2a1a1a);
    }

    .card.error pre {
      background: light-dark(#fef0f0, #1a0a0a);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85em;
      white-space: pre-wrap;
      word-break: break-all;
    }

    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.4rem 1.25rem;
      margin: 0;
    }

    dt {
      font-weight: 500;
      color: light-dark(#555, #aaa);
    }

    dd {
      margin: 0;
    }

    ul {
      padding-left: 1.5em;
      margin: 0.5rem 0 0;
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

    .markdown > :first-child {
      margin-top: 0;
    }

    .markdown > :last-child {
      margin-bottom: 0;
    }

    .markdown h1 {
      font-size: 1.25rem;
      margin: 1.5rem 0 0.5rem;
    }

    .markdown h2 {
      font-size: 1.1rem;
      margin: 1.25rem 0 0.5rem;
    }

    .markdown h3 {
      font-size: 1rem;
      margin: 1rem 0 0.5rem;
    }

    .markdown p {
      margin: 0.75rem 0;
    }

    .markdown blockquote {
      border-left: 3px solid light-dark(#ccc, #555);
      padding: 0.25rem 1rem;
      margin: 0.75rem 0;
      color: light-dark(#555, #aaa);
    }

    .markdown pre {
      background: light-dark(#f4f4f4, #222);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.9em;
    }

    .markdown pre code {
      background: transparent;
      padding: 0;
    }

    .markdown hr {
      border: none;
      border-top: 1px solid light-dark(#e0e0e0, #333);
      margin: 1.5rem 0;
    }

    .markdown table {
      border-collapse: collapse;
      margin: 0.75rem 0;
    }

    .markdown th,
    .markdown td {
      border: 1px solid light-dark(#ddd, #333);
      padding: 0.25rem 0.5rem;
    }
  `;

  @state() private appState: AppState = { kind: 'idle' };

  // AbortController for in-flight fetches.  Aborted from disconnectedCallback
  // so that an element removed mid-load doesn't update state after detach.
  private abortController?: AbortController;

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('campaign');
    if (!slug) return;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.appState = { kind: 'loading', slug };
    try {
      const data = await loadCampaign(slug, { signal });
      if (signal.aborted || !this.isConnected) return;
      // World overview is optional content — skip on 404, propagate other errors.
      const worldOverview = await fetchCampaignFile(
        data.source,
        'world/overview.md',
        { signal }
      );
      if (signal.aborted || !this.isConnected) return;
      this.appState = { kind: 'loaded', loaded: { data, worldOverview } };
    } catch (e) {
      if (isAbortError(e)) return;
      if (e instanceof CampaignLoadError) {
        this.appState = { kind: 'error', message: e.message, details: e.details };
      } else {
        this.appState = {
          kind: 'error',
          message: 'Unexpected error while loading campaign.',
          details: (e as Error)?.message ?? String(e)
        };
      }
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.abortController?.abort();
  }

  override render(): TemplateResult {
    switch (this.appState.kind) {
      case 'idle':
        return this.renderIdle();
      case 'loading':
        return this.renderLoading(this.appState.slug);
      case 'loaded':
        return this.renderLoaded(this.appState.loaded);
      case 'error':
        return this.renderError(this.appState.message, this.appState.details);
    }
  }

  private renderIdle(): TemplateResult {
    return html`
      <header>
        <h1>Quire</h1>
        <p class="summary">
          Browser-based TTRPG framework for collaborative interactive
          storytelling.
        </p>
      </header>
      <section class="card">
        <h2>No campaign loaded</h2>
        <p>
          Quire loads a campaign from a GitHub repository. Append
          <code>?campaign=&lt;owner&gt;/&lt;repo&gt;</code> to the URL, or
          <code>?campaign=&lt;owner&gt;/&lt;repo&gt;@&lt;ref&gt;</code> to
          pin a branch, tag, or commit.
        </p>
        <p>The sample campaign:</p>
        <p>
          <a href="?campaign=gutschke/underleaf">Open Underleaf →</a>
        </p>
      </section>
    `;
  }

  private renderLoading(slug: string): TemplateResult {
    return html`
      <header>
        <h1>Quire</h1>
      </header>
      <section class="card">
        <p>Loading campaign <code>${slug}</code>…</p>
      </section>
    `;
  }

  private renderLoaded({ data, worldOverview }: CampaignWithExtras): TemplateResult {
    const m = data.manifest;
    const src = data.source;
    return html`
      <header>
        <h1>${m.name}</h1>
        ${m.summary ? html`<p class="summary">${m.summary}</p>` : nothing}
      </header>
      <section class="card">
        <h2>About</h2>
        <dl>
          ${m.ip ? html`<dt>Setting</dt><dd>${m.ip}</dd>` : nothing}
          ${m.ageBand ? html`<dt>Recommended age</dt><dd>${m.ageBand}</dd>` : nothing}
          ${m.ruleset
            ? html`<dt>Ruleset</dt><dd><code>${m.ruleset}</code></dd>`
            : nothing}
          ${m.license ? html`<dt>License</dt><dd>${m.license}</dd>` : nothing}
          ${m.authors?.length
            ? html`<dt>Authors</dt><dd>${m.authors.join(', ')}</dd>`
            : nothing}
          <dt>Source</dt>
          <dd>
            <code>${src.owner}/${src.repo}@${src.ref}</code>
          </dd>
        </dl>
        ${m.contentNotes?.length
          ? html`
              <h3>Content notes</h3>
              <ul>
                ${m.contentNotes.map((note) => html`<li>${note}</li>`)}
              </ul>
            `
          : nothing}
      </section>
      ${worldOverview
        ? html`
            <section class="card">
              <h2>World overview</h2>
              <div class="markdown">
                ${unsafeHTML(renderMarkdown(worldOverview))}
              </div>
            </section>
          `
        : nothing}
      <section class="card placeholder">
        <p><strong>Play UI not yet implemented.</strong></p>
        <p>
          Scenes, character sheets, the dice helper, the AI prompt bar, and
          the multiplayer surface arrive in subsequent commits.
        </p>
      </section>
    `;
  }

  private renderError(message: string, details?: string): TemplateResult {
    // `message` and `details` originate from CampaignLoadError and may echo
    // user-controllable URL parts (the campaign slug).  Lit's text-context
    // interpolation auto-escapes — do NOT switch these to `unsafeHTML`.
    return html`
      <header>
        <h1>Quire</h1>
      </header>
      <section class="card error">
        <h2>Couldn't load campaign</h2>
        <p>${message}</p>
        ${details ? html`<pre>${details}</pre>` : nothing}
        <p>
          <a href="${window.location.pathname}">← Back to home</a>
        </p>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-app': QuireApp;
  }
}

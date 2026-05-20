import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import {
  loadCampaign,
  fetchCampaignFile,
  CampaignLoadError,
  type LoadedCampaign as LoadedCampaignBase
} from './campaign-loader';
import { loadEpisode, loadScene, type LoadedEpisode } from './episode-loader';
import {
  loadCharacter,
  CharacterLoadError,
  type LoadedCharacter,
  type CharacterKind
} from './character-loader';
import { renderMarkdown, type SanitizedHtml } from './markdown';
import { parseRoute, routeToSearch, type AppRoute } from './routing';
import {
  parseDiceCommand,
  rollDice,
  formatRoll,
  formatCommand,
  type DiceRoll
} from './dice';
import {
  SessionController,
  type SessionView,
  type TransportFactory
} from './session-controller';
import { createPeerjsFactory } from './session-peerjs';

const ROLL_HISTORY_MAX = 5;

interface LoadedCampaign {
  base: LoadedCampaignBase;
  worldOverview: string | null;
}

type LoadingLayer = 'campaign' | 'episode' | 'scene' | 'character';

type AppState =
  | { kind: 'idle' }
  | { kind: 'loading'; slug: string; layer: LoadingLayer }
  | { kind: 'campaign'; campaign: LoadedCampaign }
  | { kind: 'episode'; campaign: LoadedCampaign; episode: LoadedEpisode }
  | {
      kind: 'scene';
      campaign: LoadedCampaign;
      episode: LoadedEpisode;
      scene: { path: string; html: SanitizedHtml };
    }
  | { kind: 'character'; campaign: LoadedCampaign; character: LoadedCharacter }
  | { kind: 'error'; message: string; details?: string };

function isAbortError(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError';
}

function formatStat(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * Root component for the Quire play app.
 *
 * Handles four URL-driven views:
 *   /                                                  → welcome
 *   /?campaign=<slug>                                   → campaign overview + episode list
 *   /?campaign=<slug>&episode=<ep>                       → episode summary + scene list
 *   /?campaign=<slug>&episode=<ep>&scene=<path>          → single scene
 *
 * Navigates via History API; popstate restores prior views on back/forward.
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

    nav.breadcrumb {
      font-size: 0.9rem;
      margin: 0 0 1rem;
      color: light-dark(#555, #aaa);
    }

    nav.breadcrumb a {
      color: light-dark(#0050a0, #6bb6ff);
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

    ul.episode-list,
    ul.scene-list {
      list-style: none;
      padding-left: 0;
      margin: 0.5rem 0 0;
    }

    ul.episode-list li,
    ul.scene-list li {
      padding: 0.25rem 0;
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

    .roll-form {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.25rem 0;
    }

    .roll-form label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
    }

    .roll-form .roll-label {
      font-family: ui-monospace, monospace;
      color: light-dark(#555, #aaa);
    }

    .roll-form input[type='text'] {
      flex: 1;
      padding: 0.25rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .roll-form button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .roll-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.9em;
      margin: 0.25rem 0;
    }

    .roll-history {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0 0;
    }

    .roll-history li {
      padding: 0.15rem 0;
    }

    .muted {
      color: light-dark(#666, #888);
      font-size: 0.9em;
      margin: 0.25rem 0;
    }

    .session-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      margin: 0 0 1rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 6px;
      background: light-dark(#fafafa, #1f1f1f);
      font-size: 0.9em;
      flex-wrap: wrap;
    }

    .session-bar input {
      padding: 0.2rem 0.4rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .session-bar input.session-code {
      text-transform: uppercase;
      width: 8.5rem;
    }

    .session-bar input.session-name {
      width: 7rem;
    }

    .session-bar button {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
    }

    .session-bar .session-label {
      font-weight: 600;
    }

    .session-bar .session-sep {
      color: light-dark(#888, #777);
    }

    .session-bar .session-code-display code {
      font-size: 0.95em;
    }

    .session-bar .session-peers {
      color: light-dark(#555, #aaa);
    }

    .session-bar.session-active {
      border-color: light-dark(#9bb09b, #4a6a4a);
      background: light-dark(#f4faf4, #1a221a);
    }

    .session-bar.session-error {
      border-color: light-dark(#cc8888, #884444);
      background: light-dark(#fcf4f4, #221a1a);
    }

    .session-bar .session-error-msg {
      color: light-dark(#a01010, #ff7070);
    }

    .chat-panel .chat-list {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0;
      max-height: 14rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      background: light-dark(#fafafa, #1a1a1a);
      border: 1px solid light-dark(#eee, #2a2a2a);
      border-radius: 4px;
      padding: 0.4rem 0.6rem;
    }

    .chat-panel .chat-list li {
      display: flex;
      gap: 0.4rem;
      font-size: 0.95em;
    }

    .chat-panel .chat-author {
      font-weight: 600;
      color: light-dark(#0050a0, #6bb6ff);
      flex-shrink: 0;
    }

    .chat-panel .chat-text {
      flex: 1;
      word-break: break-word;
    }

    .chat-form {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .chat-form input {
      flex: 1;
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
    }

    .chat-form button {
      padding: 0.3rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }
  `;

  @state() private appState: AppState = { kind: 'idle' };
  @state() rolls: DiceRoll[] = [];
  @state() rollDraft: string = '';
  @state() rollError: string | null = null;
  @state() sessionView: SessionView | null = null;
  @state() joinCodeDraft: string = '';
  @state() displayNameDraft: string = '';
  @state() chatDraft: string = '';

  // Tests can replace this before connectedCallback runs to swap in
  // an in-memory transport factory.
  sessionFactory: TransportFactory = createPeerjsFactory();
  private session: SessionController | null = null;
  private unsubscribeSession: (() => void) | null = null;

  private abortController?: AbortController;
  private readonly popstateHandler = (): void => {
    void this.navigateToRoute(parseRoute(window.location.search));
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('popstate', this.popstateHandler);
    this.session = new SessionController(this.sessionFactory);
    this.unsubscribeSession = this.session.subscribe((v) => {
      this.sessionView = v;
    });
    void this.navigateToRoute(parseRoute(window.location.search));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this.popstateHandler);
    this.abortController?.abort();
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.session?.leave();
    this.session = null;
  }

  /** Resolve a route into the right loaded state, fetching as needed. */
  private async navigateToRoute(route: AppRoute): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    if (route.kind === 'home') {
      this.appState = { kind: 'idle' };
      return;
    }

    try {
      // Reuse already-loaded campaign if the slug matches.
      let campaign = this.getCurrentCampaign();
      if (!campaign || this.currentCampaignSlugMatches(route.slug) === false) {
        this.appState = {
          kind: 'loading',
          slug: route.slug,
          layer: 'campaign'
        };
        const base = await loadCampaign(route.slug, { signal });
        if (signal.aborted || !this.isConnected) return;
        const worldOverview = await fetchCampaignFile(
          base.source,
          'world/overview.md',
          { signal }
        );
        if (signal.aborted || !this.isConnected) return;
        campaign = { base, worldOverview };
      }

      if (route.kind === 'campaign') {
        this.appState = { kind: 'campaign', campaign };
        return;
      }

      // Character layer (independent of episode/scene)
      if (route.kind === 'character') {
        this.appState = {
          kind: 'loading',
          slug: route.characterId,
          layer: 'character'
        };
        const character = await loadCharacter(
          campaign.base.source,
          route.characterKind,
          route.characterId,
          { signal }
        );
        if (signal.aborted || !this.isConnected) return;
        this.appState = { kind: 'character', campaign, character };
        return;
      }

      // Episode layer
      let episode = this.getCurrentEpisode();
      if (!episode || episode.slug !== route.episode) {
        this.appState = {
          kind: 'loading',
          slug: route.episode,
          layer: 'episode'
        };
        episode = await loadEpisode(campaign.base.source, route.episode, {
          signal
        });
        if (signal.aborted || !this.isConnected) return;
      }

      if (route.kind === 'episode') {
        this.appState = { kind: 'episode', campaign, episode };
        return;
      }

      // Scene layer
      this.appState = {
        kind: 'loading',
        slug: route.scene,
        layer: 'scene'
      };
      const sceneText = await loadScene(
        campaign.base.source,
        route.episode,
        route.scene,
        { signal }
      );
      if (signal.aborted || !this.isConnected) return;
      if (sceneText === null) {
        throw new CampaignLoadError(
          `Scene "${route.scene}" not found in episode "${route.episode}".`
        );
      }
      this.appState = {
        kind: 'scene',
        campaign,
        episode,
        scene: { path: route.scene, html: renderMarkdown(sceneText) }
      };
    } catch (e) {
      if (isAbortError(e)) return;
      if (e instanceof CampaignLoadError || e instanceof CharacterLoadError) {
        this.appState = {
          kind: 'error',
          message: e.message,
          details: e.details
        };
      } else {
        this.appState = {
          kind: 'error',
          message: 'Unexpected error.',
          details: (e as Error)?.message ?? String(e)
        };
      }
    }
  }

  private getCurrentCampaign(): LoadedCampaign | undefined {
    const s = this.appState;
    if (
      s.kind === 'campaign' ||
      s.kind === 'episode' ||
      s.kind === 'scene' ||
      s.kind === 'character'
    ) {
      return s.campaign;
    }
    return undefined;
  }

  private getCurrentEpisode(): LoadedEpisode | undefined {
    const s = this.appState;
    if (s.kind === 'episode' || s.kind === 'scene') return s.episode;
    return undefined;
  }

  private currentCampaignSlugMatches(slug: string): boolean {
    const c = this.getCurrentCampaign();
    if (!c) return false;
    const src = c.base.source;
    // Reconstruct the slug used in the URL.
    const reconstructed =
      src.ref === 'main'
        ? `${src.owner}/${src.repo}`
        : `${src.owner}/${src.repo}@${src.ref}`;
    return reconstructed === slug;
  }

  /** Click handler: pushState the new route, then re-render via navigate. */
  private navigate(e: Event, route: AppRoute): void {
    e.preventDefault();
    const url = window.location.pathname + routeToSearch(route);
    history.pushState({}, '', url);
    void this.navigateToRoute(route);
  }

  override render(): TemplateResult {
    return html`${this.renderSessionBar()}${this.renderBody()}${this.renderChatPanel()}`;
  }

  private renderBody(): TemplateResult {
    switch (this.appState.kind) {
      case 'idle':
        return this.renderIdle();
      case 'loading':
        return this.renderLoading(this.appState.slug, this.appState.layer);
      case 'campaign':
        return this.renderCampaign(this.appState.campaign);
      case 'episode':
        return this.renderEpisode(
          this.appState.campaign,
          this.appState.episode
        );
      case 'scene':
        return this.renderScene(
          this.appState.campaign,
          this.appState.episode,
          this.appState.scene
        );
      case 'character':
        return this.renderCharacter(
          this.appState.campaign,
          this.appState.character
        );
      case 'error':
        return this.renderError(
          this.appState.message,
          this.appState.details
        );
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
          <a
            href="?campaign=gutschke/underleaf"
            @click=${(e: Event) =>
              this.navigate(e, {
                kind: 'campaign',
                slug: 'gutschke/underleaf'
              })}
            >Open Underleaf →</a
          >
        </p>
      </section>
    `;
  }

  private renderLoading(slug: string, layer: LoadingLayer): TemplateResult {
    return html`
      <header>
        <h1>Quire</h1>
      </header>
      <section class="card">
        <p>Loading ${layer} <code>${slug}</code>…</p>
      </section>
    `;
  }

  private renderCampaign({
    base,
    worldOverview
  }: LoadedCampaign): TemplateResult {
    const m = base.manifest;
    const src = base.source;
    const slug =
      src.ref === 'main'
        ? `${src.owner}/${src.repo}`
        : `${src.owner}/${src.repo}@${src.ref}`;
    return html`
      <header>
        <h1>${m.name}</h1>
        ${m.summary ? html`<p class="summary">${m.summary}</p>` : nothing}
      </header>
      <section class="card">
        <h2>About</h2>
        <dl>
          ${m.ip ? html`<dt>Setting</dt><dd>${m.ip}</dd>` : nothing}
          ${m.ageBand
            ? html`<dt>Recommended age</dt><dd>${m.ageBand}</dd>`
            : nothing}
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
      ${m.episodes?.length
        ? html`
            <section class="card">
              <h2>Episodes</h2>
              <ul class="episode-list">
                ${m.episodes.map(
                  (epSlug) => html`
                    <li>
                      <a
                        href=${routeToSearch({
                          kind: 'episode',
                          slug,
                          episode: epSlug
                        })}
                        @click=${(e: Event) =>
                          this.navigate(e, {
                            kind: 'episode',
                            slug,
                            episode: epSlug
                          })}
                        >${epSlug}</a
                      >
                    </li>
                  `
                )}
              </ul>
            </section>
          `
        : nothing}
      ${this.renderCharacterMenus(slug, m.characters)}
      ${this.renderRollPanel()}
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
    `;
  }

  private renderEpisode(
    campaign: LoadedCampaign,
    episode: LoadedEpisode
  ): TemplateResult {
    const m = episode.manifest;
    const slug = this.slugFor(campaign);
    return html`
      <header>
        <nav class="breadcrumb">
          <a
            href=${routeToSearch({ kind: 'campaign', slug })}
            @click=${(e: Event) =>
              this.navigate(e, { kind: 'campaign', slug })}
            >${campaign.base.manifest.name}</a
          >
          →
        </nav>
        <h1>${m.name}</h1>
        ${m.summary ? html`<p class="summary">${m.summary}</p>` : nothing}
      </header>
      <section class="card">
        <h2>Scenes</h2>
        ${m.scenes?.length
          ? html`
              <ul class="scene-list">
                ${m.scenes.map(
                  (scenePath) => html`
                    <li>
                      <a
                        href=${routeToSearch({
                          kind: 'scene',
                          slug,
                          episode: episode.slug,
                          scene: scenePath
                        })}
                        @click=${(e: Event) =>
                          this.navigate(e, {
                            kind: 'scene',
                            slug,
                            episode: episode.slug,
                            scene: scenePath
                          })}
                        >${scenePath}</a
                      >
                    </li>
                  `
                )}
              </ul>
            `
          : html`<p>This episode has no scene list yet.</p>`}
      </section>
      ${m.hooks?.length
        ? html`
            <section class="card">
              <h3>Hooks</h3>
              <ul>
                ${m.hooks.map((h) => html`<li>${h}</li>`)}
              </ul>
            </section>
          `
        : nothing}
    `;
  }

  private renderScene(
    campaign: LoadedCampaign,
    episode: LoadedEpisode,
    scene: { path: string; html: SanitizedHtml }
  ): TemplateResult {
    const slug = this.slugFor(campaign);
    return html`
      <header>
        <nav class="breadcrumb">
          <a
            href=${routeToSearch({ kind: 'campaign', slug })}
            @click=${(e: Event) =>
              this.navigate(e, { kind: 'campaign', slug })}
            >${campaign.base.manifest.name}</a
          >
          →
          <a
            href=${routeToSearch({
              kind: 'episode',
              slug,
              episode: episode.slug
            })}
            @click=${(e: Event) =>
              this.navigate(e, {
                kind: 'episode',
                slug,
                episode: episode.slug
              })}
            >${episode.manifest.name}</a
          >
          →
        </nav>
        <h1>${scene.path}</h1>
      </header>
      <section class="card">
        <div class="markdown">${unsafeHTML(scene.html)}</div>
      </section>
    `;
  }

  private renderSessionBar(): TemplateResult {
    const v = this.sessionView;
    if (!v) return html``;
    if (v.status === 'idle' && v.mode === 'solo') {
      return html`
        <div class="session-bar session-solo">
          <span class="session-label">Solo</span>
          <input
            type="text"
            class="session-name"
            .value=${this.displayNameDraft}
            placeholder="Your name"
            aria-label="Display name"
            @input=${(e: Event) => {
              this.displayNameDraft = (e.target as HTMLInputElement).value;
            }}
          />
          <button @click=${() => this.startHosting()}>Host session</button>
          <span class="session-sep">or</span>
          <input
            type="text"
            class="session-code"
            .value=${this.joinCodeDraft}
            placeholder="ABCD2345"
            aria-label="Pairing code"
            maxlength="12"
            @input=${(e: Event) => {
              this.joinCodeDraft = (
                e.target as HTMLInputElement
              ).value.toUpperCase();
            }}
          />
          <button @click=${() => this.joinSession()}>Join</button>
        </div>
      `;
    }
    if (v.status === 'connecting') {
      return html`
        <div class="session-bar session-connecting">
          <span class="session-label">
            ${v.mode === 'host' ? 'Starting session…' : 'Joining…'}
          </span>
          <button @click=${() => this.leaveSession()}>Cancel</button>
        </div>
      `;
    }
    if (v.status === 'error') {
      return html`
        <div class="session-bar session-error">
          <span class="session-label">Session error</span>
          <span class="session-error-msg">${v.error}</span>
          <button @click=${() => this.leaveSession()}>Dismiss</button>
        </div>
      `;
    }
    // active
    const peerCount = v.connectedPeers.length;
    return html`
      <div class="session-bar session-active">
        ${v.mode === 'host'
          ? html`
              <span class="session-label">Hosting</span>
              <span class="session-code-display">
                code: <code>${v.pairingCode}</code>
              </span>
            `
          : html`
              <span class="session-label">Joined</span>
              <span class="session-code-display">
                as <code>${v.peerId}</code>
              </span>
            `}
        <span class="session-peers">
          ${peerCount === 0
            ? 'no peers yet'
            : peerCount === 1
              ? '1 peer'
              : `${peerCount} peers`}
        </span>
        <button @click=${() => this.leaveSession()}>Leave</button>
      </div>
    `;
  }

  private renderChatPanel(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return html``;
    const messages = v.shared.chat;
    return html`
      <section class="card chat-panel">
        <h2>Chat</h2>
        ${messages.length === 0
          ? html`<p class="muted">No messages yet. Say hello.</p>`
          : html`
              <ul class="chat-list">
                ${messages.map(
                  (m) => html`
                    <li>
                      <span class="chat-author">
                        ${this.displayNameFor(m.peerId)}
                      </span>
                      <span class="chat-text">${m.text}</span>
                    </li>
                  `
                )}
              </ul>
            `}
        <form
          class="chat-form"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.submitChat(this.chatDraft);
          }}
        >
          <input
            type="text"
            .value=${this.chatDraft}
            placeholder="Say something…"
            aria-label="Chat message"
            maxlength="500"
            @input=${(e: Event) => {
              this.chatDraft = (e.target as HTMLInputElement).value;
            }}
          />
          <button type="submit">Send</button>
        </form>
      </section>
    `;
  }

  private renderRollPanel(): TemplateResult {
    return html`
      <section class="card">
        <h2>Dice</h2>
        <form
          class="roll-form"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.submitRoll(this.rollDraft);
          }}
        >
          <label>
            <span class="roll-label">/roll</span>
            <input
              type="text"
              .value=${this.rollDraft}
              placeholder="2d6+1"
              aria-label="Dice expression"
              @input=${(e: Event) => {
                this.rollDraft = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <button type="submit">Roll</button>
        </form>
        ${this.rollError
          ? html`<p class="roll-error">${this.rollError}</p>`
          : nothing}
        ${this.rolls.length
          ? html`
              <ul class="roll-history">
                ${this.rolls.map(
                  (r) => html`<li><code>${formatRoll(r)}</code></li>`
                )}
              </ul>
            `
          : html`<p class="muted">No rolls yet.</p>`}
      </section>
    `;
  }

  submitRoll(input: string): DiceRoll | null {
    const cmd = parseDiceCommand(input);
    if (!cmd) {
      this.rollError = `Couldn't parse "${input}". Try 2d6, 2d6+1, 1d20, etc.`;
      return null;
    }
    this.rollError = null;
    const roll = rollDice(cmd, this.rngForRoll);
    this.rolls = [roll, ...this.rolls].slice(0, ROLL_HISTORY_MAX);
    this.rollDraft = '';
    // If we're in an active session, publish so other peers see the roll.
    if (this.session && this.sessionView?.status === 'active') {
      this.session.append('dice-roll', {
        expression: formatCommand(roll.command),
        result: roll.total,
        dice: roll.rolls
      });
    }
    return roll;
  }

  startHosting(): void {
    if (!this.session) return;
    const name = this.displayNameDraft.trim() || undefined;
    void this.session
      .host(name)
      .catch(() => {
        /* error already surfaced via sessionView */
      });
  }

  joinSession(): void {
    if (!this.session) return;
    const code = this.joinCodeDraft.trim().toUpperCase();
    if (!code) return;
    const name = this.displayNameDraft.trim() || undefined;
    void this.session.join(code, name).catch(() => {
      /* surfaced via sessionView */
    });
  }

  leaveSession(): void {
    this.session?.leave();
    this.joinCodeDraft = '';
    this.chatDraft = '';
  }

  submitChat(text: string): boolean {
    if (!this.session || this.sessionView?.status !== 'active') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    this.session.append('chat', { text: trimmed });
    this.chatDraft = '';
    return true;
  }

  private displayNameFor(peerId: string): string {
    const peer = this.sessionView?.shared.peers[peerId];
    if (peer?.name && peer.name.length > 0) return peer.name;
    return peerId;
  }

  // Overridable from tests for determinism.
  rngForRoll: () => number = Math.random;

  private renderCharacterMenus(
    slug: string,
    characters: { pcs?: string[]; npcs?: string[] } | undefined
  ): TemplateResult {
    if (!characters) return html``;
    const hasPcs = !!characters.pcs?.length;
    const hasNpcs = !!characters.npcs?.length;
    if (!hasPcs && !hasNpcs) return html``;
    return html`
      <section class="card">
        <h2>Characters</h2>
        ${hasPcs
          ? html`
              <h3>Player characters</h3>
              <ul class="scene-list">
                ${characters.pcs!.map(
                  (id) => html`
                    <li>${this.characterLink(slug, 'pc', id)}</li>
                  `
                )}
              </ul>
            `
          : nothing}
        ${hasNpcs
          ? html`
              <h3>Non-player characters</h3>
              <ul class="scene-list">
                ${characters.npcs!.map(
                  (id) => html`
                    <li>${this.characterLink(slug, 'npc', id)}</li>
                  `
                )}
              </ul>
            `
          : nothing}
      </section>
    `;
  }

  private characterLink(
    slug: string,
    characterKind: CharacterKind,
    characterId: string
  ): TemplateResult {
    return html`
      <a
        href=${routeToSearch({
          kind: 'character',
          slug,
          characterKind,
          characterId
        })}
        @click=${(e: Event) =>
          this.navigate(e, {
            kind: 'character',
            slug,
            characterKind,
            characterId
          })}
        >${characterId}</a
      >
    `;
  }

  private renderCharacter(
    campaign: LoadedCampaign,
    character: LoadedCharacter
  ): TemplateResult {
    const slug = this.slugFor(campaign);
    const r = character.record;
    const kindLabel = character.kind === 'pc' ? 'PC' : 'NPC';
    return html`
      <header>
        <nav class="breadcrumb">
          <a
            href=${routeToSearch({ kind: 'campaign', slug })}
            @click=${(e: Event) =>
              this.navigate(e, { kind: 'campaign', slug })}
            >${campaign.base.manifest.name}</a
          >
          → ${kindLabel}
        </nav>
        <h1>${r.name}</h1>
        ${r.pronouns
          ? html`<p class="summary">${r.pronouns}</p>`
          : nothing}
      </header>
      <section class="card">
        <h2>Details</h2>
        <dl>
          ${r.role ? html`<dt>Role</dt><dd>${r.role}</dd>` : nothing}
          ${r.disposition
            ? html`<dt>Disposition</dt><dd>${r.disposition}</dd>`
            : nothing}
          ${r.alignment
            ? html`<dt>Alignment</dt><dd>${r.alignment}</dd>`
            : nothing}
          ${typeof r.harm === 'number'
            ? html`<dt>Harm</dt><dd>${r.harm}/4</dd>`
            : nothing}
          ${typeof r.stress === 'number'
            ? html`<dt>Stress</dt><dd>${r.stress}/4</dd>`
            : nothing}
        </dl>
        ${r.stats ? this.renderStatBlock(r.stats) : nothing}
        ${r.skills?.length
          ? html`
              <h3>Skills</h3>
              <ul>
                ${r.skills.map((s) => html`<li>${s}</li>`)}
              </ul>
            `
          : nothing}
        ${r.tags?.length
          ? html`
              <h3>Tags</h3>
              <ul>
                ${r.tags.map((t) => html`<li>${t}</li>`)}
              </ul>
            `
          : nothing}
        ${r.foci?.length
          ? html`
              <h3>Foci</h3>
              <ul>
                ${r.foci.map(
                  (f) => html`
                    <li>
                      <strong>${f.name}</strong>${f.domain
                        ? html` — ${f.domain}`
                        : nothing}${f.condition
                        ? html` (${f.condition})`
                        : nothing}
                    </li>
                  `
                )}
              </ul>
            `
          : nothing}
        ${r.signature?.length
          ? html`
              <h3>Signature</h3>
              <ul>
                ${r.signature.map((s) => html`<li>${s}</li>`)}
              </ul>
            `
          : nothing}
        ${r.voice ? html`<h3>Voice</h3><p>${r.voice}</p>` : nothing}
      </section>
      ${r.description
        ? html`
            <section class="card">
              <h2>Description</h2>
              <div class="markdown">
                ${unsafeHTML(renderMarkdown(r.description))}
              </div>
            </section>
          `
        : nothing}
      ${r.backstory
        ? html`
            <section class="card">
              <h2>Backstory</h2>
              <div class="markdown">
                ${unsafeHTML(renderMarkdown(r.backstory))}
              </div>
            </section>
          `
        : nothing}
      ${this.renderRollPanel()}
    `;
  }

  private renderStatBlock(stats: {
    str?: number;
    dex?: number;
    con?: number;
    int?: number;
    wis?: number;
    cha?: number;
  }): TemplateResult {
    const rows: Array<[string, number | undefined]> = [
      ['STR', stats.str],
      ['DEX', stats.dex],
      ['CON', stats.con],
      ['INT', stats.int],
      ['WIS', stats.wis],
      ['CHA', stats.cha]
    ];
    return html`
      <h3>Stats</h3>
      <dl>
        ${rows.map(
          ([label, val]) => html`
            <dt>${label}</dt>
            <dd>${typeof val === 'number' ? formatStat(val) : '—'}</dd>
          `
        )}
      </dl>
    `;
  }

  private renderError(message: string, details?: string): TemplateResult {
    // `message` and `details` originate from CampaignLoadError and may echo
    // user-controllable URL parts.  Lit's text-context interpolation
    // auto-escapes — do NOT switch these to `unsafeHTML`.
    return html`
      <header>
        <h1>Quire</h1>
      </header>
      <section class="card error">
        <h2>Couldn't load</h2>
        <p>${message}</p>
        ${details ? html`<pre>${details}</pre>` : nothing}
        <p>
          <a
            href=${window.location.pathname}
            @click=${(e: Event) => this.navigate(e, { kind: 'home' })}
            >← Back to home</a
          >
        </p>
      </section>
    `;
  }

  private slugFor(campaign: LoadedCampaign): string {
    const src = campaign.base.source;
    return src.ref === 'main'
      ? `${src.owner}/${src.repo}`
      : `${src.owner}/${src.repo}@${src.ref}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-app': QuireApp;
  }
}

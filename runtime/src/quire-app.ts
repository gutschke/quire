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
  type CharacterKind,
  type CharacterRecord
} from './character-loader';
import {
  applyCharacterEdits,
  HARM_MAX,
  STRESS_MAX,
  STAT_MIN,
  STAT_MAX
} from './character-edits';
import { callAnthropic, AnthropicError } from './ai/anthropic';
import { callGemini, GeminiError } from './ai/gemini';

export type AiProvider = 'claude' | 'gemini';

const AI_LEGACY_KEY_STORAGE = 'quire.ai.apiKey'; // pre-provider-split
const AI_PROVIDER_STORAGE = 'quire.ai.provider';
const AI_KEY_STORAGE = (p: AiProvider): string => `quire.ai.${p}.apiKey`;
const AI_MODEL_STORAGE = (p: AiProvider): string => `quire.ai.${p}.model`;
const AI_SYSTEM_STORAGE = 'quire.ai.systemPrompt';

const AI_DEFAULTS: Record<AiProvider, { model: string; label: string; models: string[] }> = {
  claude: {
    label: 'Anthropic (Claude)',
    model: 'claude-haiku-4-5-20251001',
    models: [
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
      'claude-opus-4-7'
    ]
  },
  gemini: {
    label: 'Google (Gemini)',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro']
  }
};

const AI_DEFAULT_SYSTEM = `You are a quiet TTRPG-aide voice for a DM running a session of Quire.
Respond in 1–3 short paragraphs, in-fiction when describing scenes or NPC
beats. Avoid meta-commentary, headers, lists, and "as the DM" framing.
The DM will paraphrase your text in their own voice; keep it tight,
sensory, and easy to read aloud.`;

export type AiClient = (req: {
  apiKey: string;
  model: string;
  system?: string;
  user: string;
  signal?: AbortSignal;
}) => Promise<string>;
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

    .reveal-banner {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      padding: 0.4rem 0.6rem;
      margin: 0 0 1rem;
      border: 1px solid light-dark(#d9c89b, #5a4d2a);
      background: light-dark(#fdf8e7, #2a2418);
      border-radius: 6px;
      font-size: 0.92em;
      flex-wrap: wrap;
    }

    .reveal-banner-label {
      font-weight: 600;
    }

    .reveal-control {
      margin: 0.25rem 0 0;
    }

    .reveal-control button {
      padding: 0.3rem 0.75rem;
      border: 1px solid light-dark(#9a7e2a, #b8983e);
      border-radius: 4px;
      background: light-dark(#fdf3c8, #3a3018);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
    }

    .reveal-badge {
      display: inline-block;
      margin: 0.25rem 0 0;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.85em;
    }

    .reveal-badge-revealed {
      background: light-dark(#e0f0e0, #1f2a1f);
      color: light-dark(#2a6a2a, #88c088);
      border: 1px solid light-dark(#b0d0b0, #3a5a3a);
    }

    .reveal-badge-private {
      background: light-dark(#f0f0f0, #222);
      color: light-dark(#666, #888);
      border: 1px solid light-dark(#ddd, #333);
    }

    dl.stat-grid {
      display: grid;
      grid-template-columns: auto auto;
      gap: 0.25rem 0.75rem;
      margin: 0.5rem 0;
    }

    dl.stat-grid dt {
      font-weight: 600;
      align-self: center;
    }

    dl.stat-grid dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-bumpers {
      display: inline-flex;
      gap: 0.2rem;
    }

    .stat-bumpers button {
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
      line-height: 1;
    }

    .stat-bumpers button:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    .track-boxes {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }

    .track-box {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.4rem;
      height: 1.4rem;
      padding: 0;
      border: 1px solid light-dark(#aaa, #555);
      border-radius: 3px;
      background: light-dark(#fff, #1a1a1a);
      color: inherit;
      font-family: ui-monospace, monospace;
      font-size: 0.9em;
      cursor: pointer;
    }

    .track-box.track-box-filled {
      background: light-dark(#444, #ddd);
      color: light-dark(#fff, #111);
      border-color: light-dark(#222, #aaa);
    }

    button.track-box:hover {
      outline: 1px solid light-dark(#0050a0, #6bb6ff);
    }

    .track-count {
      margin-left: 0.4rem;
      color: light-dark(#555, #aaa);
      font-size: 0.85em;
    }

    .ai-panel {
      border-color: light-dark(#c8b8d8, #4a3a5a);
      background: light-dark(#fbf8fd, #1f1a25);
    }

    .ai-panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .ai-panel-head h2 {
      margin: 0;
    }

    .ai-panel-head .ai-provider-tag {
      font-size: 0.8em;
      color: light-dark(#666, #888);
      margin-left: 0.5rem;
    }

    .ai-provider-choice {
      display: flex;
      gap: 0.75rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 4px;
      padding: 0.3rem 0.6rem;
      margin: 0;
    }

    .ai-provider-choice legend {
      font-size: 0.85em;
      padding: 0 0.3rem;
      color: light-dark(#666, #888);
    }

    .ai-provider-radio {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.9em;
    }

    .ai-settings select {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .ai-settings-toggle {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .ai-settings {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .ai-settings label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.9em;
    }

    .ai-settings input,
    .ai-settings textarea {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .ai-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .ai-form textarea {
      padding: 0.4rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: inherit;
      resize: vertical;
    }

    .ai-form-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .ai-form button {
      padding: 0.3rem 0.85rem;
      border: 1px solid light-dark(#9978b8, #6a4d8a);
      border-radius: 4px;
      background: light-dark(#ede4f6, #2a2030);
      color: inherit;
      cursor: pointer;
    }

    .ai-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.9em;
      margin: 0.5rem 0 0;
    }

    .ai-response {
      margin-top: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: light-dark(#fff, #15101a);
      border: 1px solid light-dark(#e0d5ec, #3a2e4a);
      border-radius: 4px;
    }

    .ai-response > button {
      margin-top: 0.5rem;
      padding: 0.25rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
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
  @state() aiProvider: AiProvider = 'claude';
  @state() aiApiKeys: Record<AiProvider, string> = { claude: '', gemini: '' };
  @state() aiModels: Record<AiProvider, string> = {
    claude: AI_DEFAULTS.claude.model,
    gemini: AI_DEFAULTS.gemini.model
  };
  @state() aiSystemPrompt: string = AI_DEFAULT_SYSTEM;
  @state() aiPromptDraft: string = '';
  @state() aiResponse: string | null = null;
  @state() aiLoading: boolean = false;
  @state() aiError: string | null = null;
  @state() aiShowSettings: boolean = false;

  // Tests can replace these; production uses real fetch-based clients.
  aiClients: Record<AiProvider, AiClient> = {
    claude: callAnthropic,
    gemini: callGemini
  };
  private aiAbort: AbortController | null = null;

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
    // Hydrate AI settings from localStorage if available.  Wrapped in
    // a try because localStorage can throw in some sandboxed contexts.
    try {
      const ls = window.localStorage;
      if (ls) {
        const provider = ls.getItem(AI_PROVIDER_STORAGE);
        if (provider === 'claude' || provider === 'gemini') {
          this.aiProvider = provider;
        }
        const claudeKey = ls.getItem(AI_KEY_STORAGE('claude'));
        const legacyKey = ls.getItem(AI_LEGACY_KEY_STORAGE);
        const geminiKey = ls.getItem(AI_KEY_STORAGE('gemini'));
        this.aiApiKeys = {
          claude: claudeKey ?? legacyKey ?? '',
          gemini: geminiKey ?? ''
        };
        const claudeModel = ls.getItem(AI_MODEL_STORAGE('claude'));
        const geminiModel = ls.getItem(AI_MODEL_STORAGE('gemini'));
        this.aiModels = {
          claude: claudeModel ?? AI_DEFAULTS.claude.model,
          gemini: geminiModel ?? AI_DEFAULTS.gemini.model
        };
        const s = ls.getItem(AI_SYSTEM_STORAGE);
        if (s) this.aiSystemPrompt = s;
      }
    } catch {
      /* ignore */
    }
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
        this.applyCampaignAiDefault(base.manifest.defaultAiProvider);
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
    return html`${this.renderSessionBar()}${this.renderRevealBanner()}${this.renderBody()}${this.renderChatPanel()}${this.renderAiPanel()}`;
  }

  private renderAiPanel(): TemplateResult {
    if (!this.showAiPanel()) return html``;
    const hasKey = this.aiApiKey.length > 0;
    return html`
      <section class="card ai-panel">
        <div class="ai-panel-head">
          <h2>
            DM aide
            <span class="ai-provider-tag">${AI_DEFAULTS[this.aiProvider].label}</span>
          </h2>
          <button
            type="button"
            class="ai-settings-toggle"
            @click=${() => {
              this.aiShowSettings = !this.aiShowSettings;
            }}
          >
            ${this.aiShowSettings ? 'Hide settings' : 'Settings'}
          </button>
        </div>
        ${this.aiShowSettings || !hasKey
          ? this.renderAiSettings()
          : nothing}
        ${hasKey ? this.renderAiPromptForm() : nothing}
        ${this.aiError
          ? html`<p class="ai-error">${this.aiError}</p>`
          : nothing}
        ${this.aiResponse
          ? html`
              <div class="ai-response">
                <div class="markdown">
                  ${unsafeHTML(renderMarkdown(this.aiResponse))}
                </div>
                ${this.sessionView?.status === 'active'
                  ? html`
                      <button
                        type="button"
                        @click=${() => this.shareAiResponseToChat()}
                      >
                        Share to chat
                      </button>
                    `
                  : nothing}
              </div>
            `
          : nothing}
      </section>
    `;
  }

  private renderAiSettings(): TemplateResult {
    const provider = this.aiProvider;
    const defs = AI_DEFAULTS[provider];
    const keyPlaceholder =
      provider === 'claude' ? 'sk-ant-…' : 'AIza…';
    const endpointLabel =
      provider === 'claude'
        ? 'api.anthropic.com'
        : 'generativelanguage.googleapis.com';
    return html`
      <div class="ai-settings">
        <fieldset class="ai-provider-choice">
          <legend>Provider</legend>
          ${(['claude', 'gemini'] as AiProvider[]).map(
            (p) => html`
              <label class="ai-provider-radio">
                <input
                  type="radio"
                  name="ai-provider"
                  .checked=${this.aiProvider === p}
                  @change=${() => this.setAiProvider(p)}
                />
                ${AI_DEFAULTS[p].label}
              </label>
            `
          )}
        </fieldset>
        <label>
          <span>${defs.label} API key</span>
          <input
            type="password"
            .value=${this.aiApiKeys[provider]}
            placeholder=${keyPlaceholder}
            autocomplete="off"
            @input=${(e: Event) =>
              this.setAiApiKey((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          <span>Model</span>
          <select
            .value=${this.aiModels[provider]}
            @change=${(e: Event) =>
              this.setAiModel((e.target as HTMLSelectElement).value)}
          >
            ${defs.models.map(
              (m) => html`
                <option .value=${m} ?selected=${m === this.aiModels[provider]}>
                  ${m}
                </option>
              `
            )}
          </select>
        </label>
        <label>
          <span>System prompt</span>
          <textarea
            rows="4"
            .value=${this.aiSystemPrompt}
            @input=${(e: Event) =>
              this.setAiSystemPrompt((e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        <p class="muted">
          Stored only in this browser's localStorage. Sent directly to
          ${endpointLabel} using your key.
        </p>
      </div>
    `;
  }

  private renderAiPromptForm(): TemplateResult {
    return html`
      <form
        class="ai-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          void this.submitAiPrompt(this.aiPromptDraft);
        }}
      >
        <textarea
          rows="3"
          .value=${this.aiPromptDraft}
          placeholder="Describe Yui's reaction. Or: NPC voice for the gate agent. Or: three sensory beats from the cabin."
          aria-label="AI prompt"
          ?disabled=${this.aiLoading}
          @input=${(e: Event) => {
            this.aiPromptDraft = (e.target as HTMLTextAreaElement).value;
          }}
        ></textarea>
        <div class="ai-form-actions">
          ${this.aiLoading
            ? html`<button
                type="button"
                @click=${() => this.cancelAiPrompt()}
              >
                Cancel
              </button>`
            : html`<button type="submit">Ask</button>`}
        </div>
      </form>
    `;
  }

  private renderRevealBanner(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return html``;
    const list = v.shared.revealedScenes;
    if (list.length === 0) return html``;
    const latest = list[list.length - 1];
    const parsed = QuireApp.parseRevealedPath(latest);
    if (!parsed) return html``;
    const campaign = this.getCurrentCampaign();
    if (!campaign) return html``;
    const slug = this.slugFor(campaign);
    // If we're already viewing the revealed scene, don't repeat ourselves.
    if (
      this.appState.kind === 'scene' &&
      this.appState.episode.slug === parsed.episode &&
      this.appState.scene.path === parsed.scene
    ) {
      return html``;
    }
    const route: AppRoute = {
      kind: 'scene',
      slug,
      episode: parsed.episode,
      scene: parsed.scene
    };
    return html`
      <div class="reveal-banner">
        <span class="reveal-banner-label">DM revealed:</span>
        <a
          href=${routeToSearch(route)}
          @click=${(e: Event) => this.navigate(e, route)}
          ><code>${parsed.scene}</code></a
        >
        <span class="muted">in ${parsed.episode}</span>
      </div>
    `;
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
        ${this.renderRevealControl(episode.slug, scene.path)}
      </header>
      <section class="card">
        <div class="markdown">${unsafeHTML(scene.html)}</div>
      </section>
    `;
  }

  private renderRevealControl(
    episodeSlug: string,
    scenePath: string
  ): TemplateResult {
    if (!this.sessionView || this.sessionView.status !== 'active')
      return html``;
    const full = QuireApp.scenePathFor(episodeSlug, scenePath);
    const already =
      this.sessionView.shared.revealedScenes.includes(full);
    if (!this.isCoordinator()) {
      return already
        ? html`<p class="reveal-badge reveal-badge-revealed">Revealed to players</p>`
        : html`<p class="reveal-badge reveal-badge-private">Not yet revealed</p>`;
    }
    if (already) {
      return html`<p class="reveal-badge reveal-badge-revealed">Already revealed</p>`;
    }
    return html`
      <p class="reveal-control">
        <button @click=${() => this.revealCurrentScene()}>
          Reveal to players
        </button>
      </p>
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

  /** True if the local peer is the coordinator in an active session. */
  isCoordinator(): boolean {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return false;
    return v.shared.coordinator === v.peerId;
  }

  /** Encode a scene's full repo path for the revealedScenes list. */
  private static scenePathFor(episodeSlug: string, scenePath: string): string {
    return `episodes/${episodeSlug}/${scenePath}`;
  }

  /**
   * Parse a revealedScenes entry back into URL components.  Returns null
   * if the entry doesn't have the expected `episodes/<ep>/<path>` shape.
   */
  static parseRevealedPath(
    full: string
  ): { episode: string; scene: string } | null {
    if (!full.startsWith('episodes/')) return null;
    const rest = full.slice('episodes/'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) return null;
    const episode = rest.slice(0, slash);
    const scene = rest.slice(slash + 1);
    if (!episode || !scene) return null;
    return { episode, scene };
  }

  /**
   * Coordinator-only: append a scene-reveal event for the current scene.
   * Silently no-ops in solo, when not on a scene view, when not the
   * coordinator, or when the scene is already revealed (the core
   * materializer dedups anyway, but skipping the event keeps the log
   * tidy).
   */
  revealCurrentScene(): boolean {
    if (!this.session || !this.isCoordinator()) return false;
    if (this.appState.kind !== 'scene') return false;
    const ep = this.appState.episode.slug;
    const sp = this.appState.scene.path;
    const full = QuireApp.scenePathFor(ep, sp);
    if (this.sessionView!.shared.revealedScenes.includes(full)) return false;
    this.session.append('scene-reveal', { scenePath: full });
    return true;
  }

  /**
   * Coordinator-or-self pc-edit append.  Returns false in solo or when
   * called for an NPC (NPCs are DM-only and not session-edited).  For
   * v1 anyone in the session can edit any PC — the materializer is LWW
   * per (pcId, field) so concurrent edits resolve cleanly even if two
   * players touch the same stat at the same time.
   */
  submitPcEdit(pcId: string, field: string, value: unknown): boolean {
    if (!this.session || this.sessionView?.status !== 'active') return false;
    this.session.append('pc-edit', { pcId, field, value });
    return true;
  }

  /**
   * The effective character record for rendering: base + any session-
   * shared edits (LWW per field).  Outside an active session, the base
   * record is returned unmodified.
   */
  effectiveCharacter(character: LoadedCharacter): CharacterRecord {
    if (!this.sessionView) return character.record;
    const overrides =
      character.kind === 'pc'
        ? this.sessionView.shared.pcEdits[character.id]
        : undefined;
    return applyCharacterEdits(character.record, overrides);
  }

  /**
   * Whether the AI panel should render: solo (so DMs can prep) OR
   * active session as coordinator (DM during play).  Hidden from
   * non-coordinator guests entirely.
   */
  showAiPanel(): boolean {
    if (!this.sessionView) return false;
    if (this.sessionView.mode === 'solo' && this.sessionView.status === 'idle')
      return true;
    if (this.sessionView.status === 'active' && this.isCoordinator()) return true;
    return false;
  }

  setAiProvider(provider: AiProvider): void {
    this.aiProvider = provider;
    try {
      window.localStorage?.setItem(AI_PROVIDER_STORAGE, provider);
    } catch {
      /* ignore */
    }
  }

  setAiApiKey(key: string, provider: AiProvider = this.aiProvider): void {
    this.aiApiKeys = { ...this.aiApiKeys, [provider]: key };
    try {
      if (key) {
        window.localStorage?.setItem(AI_KEY_STORAGE(provider), key);
      } else {
        window.localStorage?.removeItem(AI_KEY_STORAGE(provider));
      }
      // Clear the pre-split key once a new provider-scoped key exists.
      window.localStorage?.removeItem(AI_LEGACY_KEY_STORAGE);
    } catch {
      /* ignore */
    }
  }

  setAiModel(model: string, provider: AiProvider = this.aiProvider): void {
    this.aiModels = { ...this.aiModels, [provider]: model };
    try {
      window.localStorage?.setItem(AI_MODEL_STORAGE(provider), model);
    } catch {
      /* ignore */
    }
  }

  setAiSystemPrompt(text: string): void {
    this.aiSystemPrompt = text;
    try {
      if (text && text !== AI_DEFAULT_SYSTEM) {
        window.localStorage?.setItem(AI_SYSTEM_STORAGE, text);
      } else {
        window.localStorage?.removeItem(AI_SYSTEM_STORAGE);
      }
    } catch {
      /* ignore */
    }
  }

  get aiApiKey(): string {
    return this.aiApiKeys[this.aiProvider];
  }

  get aiModel(): string {
    return this.aiModels[this.aiProvider];
  }

  /**
   * Apply the campaign's defaultAiProvider hint only if the user has
   * not explicitly chosen a provider in localStorage.  The manifest
   * default is a "first-run suggestion", not a hard override — once
   * the user has touched the radio (or had a prior provider stored),
   * we respect their choice.
   */
  private applyCampaignAiDefault(
    manifestProvider: 'claude' | 'gemini' | 'none' | undefined
  ): void {
    if (!manifestProvider || manifestProvider === 'none') return;
    try {
      const explicit = window.localStorage?.getItem(AI_PROVIDER_STORAGE);
      if (explicit === 'claude' || explicit === 'gemini') return;
    } catch {
      /* fall through and apply the default */
    }
    if (this.aiProvider !== manifestProvider) this.aiProvider = manifestProvider;
  }

  async submitAiPrompt(prompt: string): Promise<string | null> {
    if (!this.showAiPanel()) return null;
    if (!this.aiApiKey) {
      this.aiError = 'Set an API key first.';
      return null;
    }
    const user = prompt.trim();
    if (!user) {
      this.aiError = 'Empty prompt.';
      return null;
    }
    this.aiAbort?.abort();
    const ac = new AbortController();
    this.aiAbort = ac;
    this.aiLoading = true;
    this.aiError = null;
    this.aiResponse = null;
    const client = this.aiClients[this.aiProvider];
    try {
      const text = await client({
        apiKey: this.aiApiKey,
        model: this.aiModel,
        system: this.aiSystemPrompt || undefined,
        user,
        signal: ac.signal
      });
      if (ac.signal.aborted) return null;
      this.aiResponse = text;
      this.aiPromptDraft = '';
      return text;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      if (e instanceof AnthropicError || e instanceof GeminiError) {
        this.aiError =
          e.status != null
            ? `API ${e.status}: ${e.message}`
            : e.message;
      } else {
        this.aiError = (e as Error).message ?? 'AI request failed.';
      }
      return null;
    } finally {
      if (this.aiAbort === ac) this.aiAbort = null;
      this.aiLoading = false;
    }
  }

  cancelAiPrompt(): void {
    this.aiAbort?.abort();
    this.aiAbort = null;
    this.aiLoading = false;
  }

  shareAiResponseToChat(): boolean {
    if (!this.aiResponse) return false;
    return this.submitChat(`[AI] ${this.aiResponse}`);
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
    const r = this.effectiveCharacter(character);
    const kindLabel = character.kind === 'pc' ? 'PC' : 'NPC';
    const editable =
      character.kind === 'pc' && this.sessionView?.status === 'active';
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
          ${typeof r.harm === 'number' || editable
            ? html`
                <dt>Harm</dt>
                <dd>${this.renderTrackBoxes(
                  'harm',
                  r.harm ?? 0,
                  HARM_MAX,
                  character.id,
                  editable
                )}</dd>
              `
            : nothing}
          ${typeof r.stress === 'number' || editable
            ? html`
                <dt>Stress</dt>
                <dd>${this.renderTrackBoxes(
                  'stress',
                  r.stress ?? 0,
                  STRESS_MAX,
                  character.id,
                  editable
                )}</dd>
              `
            : nothing}
        </dl>
        ${r.stats || editable
          ? this.renderStatBlock(
              r.stats ?? {},
              editable ? character.id : null
            )
          : nothing}
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

  private renderStatBlock(
    stats: {
      str?: number;
      dex?: number;
      con?: number;
      int?: number;
      wis?: number;
      cha?: number;
    },
    editablePcId: string | null
  ): TemplateResult {
    const rows: Array<[string, keyof typeof stats, number | undefined]> = [
      ['STR', 'str', stats.str],
      ['DEX', 'dex', stats.dex],
      ['CON', 'con', stats.con],
      ['INT', 'int', stats.int],
      ['WIS', 'wis', stats.wis],
      ['CHA', 'cha', stats.cha]
    ];
    return html`
      <h3>Stats</h3>
      <dl class="stat-grid">
        ${rows.map(
          ([label, key, val]) => html`
            <dt>${label}</dt>
            <dd>
              ${typeof val === 'number' ? formatStat(val) : '—'}
              ${editablePcId
                ? html`
                    <span class="stat-bumpers">
                      <button
                        type="button"
                        aria-label="Decrease ${label}"
                        ?disabled=${typeof val === 'number' && val <= STAT_MIN}
                        @click=${() =>
                          this.bumpStat(editablePcId, key, val ?? 0, -1)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label="Increase ${label}"
                        ?disabled=${typeof val === 'number' && val >= STAT_MAX}
                        @click=${() =>
                          this.bumpStat(editablePcId, key, val ?? 0, +1)}
                      >
                        +
                      </button>
                    </span>
                  `
                : nothing}
            </dd>
          `
        )}
      </dl>
    `;
  }

  private renderTrackBoxes(
    field: 'harm' | 'stress',
    current: number,
    max: number,
    pcId: string,
    editable: boolean
  ): TemplateResult {
    const boxes: TemplateResult[] = [];
    for (let i = 1; i <= max; i++) {
      const filled = i <= current;
      boxes.push(
        editable
          ? html`<button
              type="button"
              class="track-box ${filled ? 'track-box-filled' : ''}"
              aria-label="${field} box ${i}, ${filled ? 'filled' : 'empty'}"
              @click=${() => this.toggleTrackBox(pcId, field, i, current)}
            >
              ${filled ? '■' : '□'}
            </button>`
          : html`<span
              class="track-box ${filled ? 'track-box-filled' : ''}"
              aria-label="${field} box ${i}, ${filled ? 'filled' : 'empty'}"
            >
              ${filled ? '■' : '□'}
            </span>`
      );
    }
    return html`<span class="track-boxes">${boxes} <span class="track-count">${current}/${max}</span></span>`;
  }

  private bumpStat(
    pcId: string,
    key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
    current: number,
    delta: number
  ): void {
    const next = Math.min(STAT_MAX, Math.max(STAT_MIN, current + delta));
    if (next === current) return;
    this.submitPcEdit(pcId, `stats.${key}`, next);
  }

  private toggleTrackBox(
    pcId: string,
    field: 'harm' | 'stress',
    box: number,
    current: number
  ): void {
    // Clicking a filled box sets the track to box-1 (uncheck this and
    // everything past it); clicking an empty box sets it to box (fill
    // up to here).  This is the classic Powered-by-the-Apocalypse
    // track-edit UX.
    const next = box <= current ? box - 1 : box;
    if (next === current) return;
    this.submitPcEdit(pcId, field, next);
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

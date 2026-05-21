import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { quireAppStyles } from './ui/styles/quire-app.css';
// The new oklch design tokens (src/ui/styles/tokens.css.ts) are
// NOT consumed by QuireApp at M1 — the legacy quireAppStyles
// still drive the visual.  M2 region components import the
// tokens module directly when they need them; importing here
// would ship ~700 B gz of CSS variables to no consumer.
import './ui/shell/quire-shell';
import './ui/shell/quire-topbar';
import './ui/shell/quire-rail';
import './ui/shell/quire-stage';
import './ui/shell/quire-aside';
import './ui/shell/quire-dock';
import './ui/regions/player-rail';
import {
  parseMode,
  DEFAULT_APP_MODE,
  type AppMode
} from './ui/modes/mode-state';
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
  STAT_MIN,
  STAT_MAX
} from './character-edits';
import { callAnthropic, AnthropicError } from './ai/anthropic';
import { callGemini, GeminiError } from './ai/gemini';
import {
  serializeSession,
  stringifySave,
  parseSaveDocument,
  type SaveDocument,
  type LoadResult
} from './persistence';

// Autosave constants live in the AutosaveController (P0-9).

// AI provider / key / model / system-prompt state lives in
// src/controllers/ai-key-store.ts (P0-10).  Re-export the public types
// for callers that import them from quire-app.
export type { AiProvider, AiClient } from './controllers/ai-key-store';
import {
  AiKeyStore,
  AI_DEFAULTS,
  type AiProvider,
  type AiClient
} from './controllers/ai-key-store';
import { AutosaveController } from './controllers/autosave-controller';
import { KNOWN_EVENT_KINDS } from './core/state';
import {
  extractJoinCode as extractJoinCodeHelper,
  parseRevealedPath as parseRevealedPathHelper,
  scenePathFor as scenePathForHelper,
  buildInviteLink as buildInviteLinkHelper,
  doHostSession,
  doJoinSession,
  doLeaveSession,
  doRegenerateCode,
  doCopyInviteLink
} from './controllers/session-bootstrap';
import {
  renderMarkdown,
  renderMarkdownDocument,
  type SanitizedHtml
} from './markdown';
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
import {
  createPeerjsFactoryFromUrl,
  brokerConfigFromUrl
} from './session-peerjs';

const ROLL_HISTORY_MAX = 5;

/**
 * Hard cap on chat-event text length, in characters.  Matches the
 * `maxlength` on the chat <input>.  Applied at submitChat so any
 * programmatic caller (notably shareAiResponseToChat) cannot flood
 * the event log with kilobytes of AI output that would replicate
 * forever to every future joiner via sync-response.
 *
 * Keep this in sync with state.ts's CHAT_CAP — the materializer cap
 * is slightly higher (5000) than the UI cap (here) so that legacy
 * peers running a slightly older version can still ship messages we
 * accept.  If the two ever need to diverge meaningfully, document
 * why.
 */
const CHAT_MAX_LENGTH = 500;

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

/**
 * Strip an implicit `@main` ref so `owner/repo` and `owner/repo@main`
 * compare equal.  Used by currentCampaignSlugMatches to avoid
 * unnecessary refetches when the URL writes the default ref
 * explicitly.
 */
export function normalizeSlug(slug: string): string {
  return slug.endsWith('@main') ? slug.slice(0, -'@main'.length) : slug;
}

/**
 * Render a human-friendly relative timestamp ("2 minutes ago", "3
 * days ago") for the resume-prompt + save-status messages.
 */
function formatTimeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function isAbortError(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError';
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
  static styles = [quireAppStyles];

  /**
   * Current app state — public to satisfy the QuireAppHooks contract
   * (e2e tests poll `app.appState.kind` / `app.appState.character`).
   * Internally still mutated by navigateToRoute and the load
   * pipeline; do not assign from outside the class.
   */
  @state() appState: AppState = { kind: 'idle' };
  /**
   * Current AppMode driven by the URL's `?mode=` parameter.  See
   * `src/ui/modes/mode-state.ts`.  M1 just tracks the value; the
   * regions don't yet branch on it.  Region branching lands per
   * mode in M2 (in-session player), M3a/M3b (in-session DM), M4
   * (post-session), M5 (authoring).  Solo-browse remains implicit
   * (no live session) — see ui.md's "AppMode persistence" section.
   */
  @state() appMode: AppMode = DEFAULT_APP_MODE;
  @state() rolls: DiceRoll[] = [];
  @state() rollDraft: string = '';
  @state() rollError: string | null = null;
  @state() sessionView: SessionView | null = null;
  @state() joinCodeDraft: string = '';
  @state() displayNameDraft: string = '';
  @state() chatDraft: string = '';
  @state() inviteCopied: boolean = false;
  @state() showRoster: boolean = true;
  @state() renameDraft: { name: string; character: string } = {
    name: '',
    character: ''
  };
  @state() renameEditing: boolean = false;
  @state() chatError: string | null = null;
  // Persistence UI state
  @state() saveStatus: { kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string } =
    { kind: 'idle' };
  @state() loadStatus: { kind: 'idle' | 'loading' | 'loaded' | 'error'; message?: string } =
    { kind: 'idle' };
  @state() resumePromptDoc: SaveDocument | null = null;
  @state() reclaimConfirmShown: boolean = false;
  /**
   * Debounced autosave to localStorage encapsulated in the
   * AutosaveController (P0-9).  Constructor takes a buildDoc
   * callback so the controller doesn't need direct access to
   * session/campaign internals.
   */
  private autosave = new AutosaveController(this, () => this.buildSaveDocument());
  private campaignDiscoveryInFlight: boolean = false;
  /**
   * AI provider / key / model / system-prompt state is encapsulated
   * in the AiKeyStore reactive controller (P0-10).  QuireApp exposes
   * thin getters/setters so existing render and test surfaces
   * (`this.aiProvider`, `setAiApiKey(...)`, etc.) continue to work.
   */
  private aiKeys = new AiKeyStore(this);
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
  // an in-memory transport factory.  Production reads broker config
  // from URL params; default is the PeerJS cloud broker.
  sessionFactory: TransportFactory = createPeerjsFactoryFromUrl();
  private session: SessionController | null = null;
  private unsubscribeSession: (() => void) | null = null;

  private abortController?: AbortController;
  private readonly popstateHandler = (): void => {
    // Re-parse both route and mode on history navigation so the URL
    // is the source of truth across reloads + back/forward.  Mode is
    // observed but not yet acted upon at M1 — region content doesn't
    // branch on it until M2+.  The state update still triggers a
    // re-render so DevTools / test harnesses can observe the value.
    this.appMode = parseMode(window.location.search);
    void this.navigateToRoute(parseRoute(window.location.search));
  };

  override connectedCallback(): void {
    super.connectedCallback();
    // Seed appMode from URL on first mount; popstate keeps it in sync
    // thereafter.  M1 — observed but not yet acted upon.
    this.appMode = parseMode(window.location.search);
    window.addEventListener('popstate', this.popstateHandler);
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    this.session = new SessionController(this.sessionFactory);
    this.unsubscribeSession = this.session.subscribe((v) => {
      this.sessionView = v;
      // Debounced autosave to localStorage whenever the session state
      // changes — covers new events from any peer.
      if (v.status === 'active') this.scheduleAutosave();
      // R3-C: guest discovered the campaign via the host's
      // peer-join.  If we're idle (no campaign in the URL), trigger
      // a load + navigate to the campaign view.  Skip if we're
      // already on / loading the right campaign, or if there's no
      // shared campaign yet.
      if (
        v.status === 'active' &&
        v.shared.campaign &&
        this.appState.kind === 'idle' &&
        !this.campaignDiscoveryInFlight
      ) {
        this.campaignDiscoveryInFlight = true;
        const c = v.shared.campaign;
        const slug = c.ref === 'main' ? `${c.owner}/${c.repo}` : `${c.owner}/${c.repo}@${c.ref}`;
        const url = new URL(window.location.href);
        url.searchParams.set('campaign', slug);
        history.replaceState({}, '', url.pathname + url.search);
        void this.navigateToRoute({ kind: 'campaign', slug }).finally(() => {
          this.campaignDiscoveryInFlight = false;
        });
      }
      // Live-bounce a non-coordinator player if they're currently
      // viewing a scene the DM has just un-revealed.  Without this,
      // they'd see the now-private content until they navigate away.
      // Crucial nuance: only bounce when the local peer is
      // *explicitly* NOT coordinator (someone else is).  During the
      // brief window after the host calls runHost, shared.coordinator
      // is undefined until the local coord-claim event materializes
      // — bouncing in that window would kick the host off their
      // own scene before their own claim took effect.
      if (
        v.status === 'active' &&
        v.shared.coordinator &&
        v.shared.coordinator !== v.peerId &&
        this.appState.kind === 'scene'
      ) {
        const full = QuireApp.scenePathFor(
          this.appState.episode.slug,
          this.appState.scene.path
        );
        if (!v.shared.revealedScenes.includes(full)) {
          const slug = this.slugFor(this.appState.campaign);
          this.navigate(new Event('synthetic'), { kind: 'campaign', slug });
        }
      }
    });
    // AI settings hydration happens in AiKeyStore's hostConnected,
    // wired automatically via addController() in our constructor.
    void this.navigateToRoute(parseRoute(window.location.search));
    // Invite-link handling: if the URL carries ?join=<code>, pre-fill
    // the join input so the player just needs to enter their name +
    // click Join.  We do NOT auto-fire join() — players should
    // declare themselves with a name first.  The DM gets the same
    // affordance via "Copy invite" on the active-session bar.
    try {
      const params = new URLSearchParams(window.location.search);
      const joinCode = params.get('join');
      if (joinCode) {
        this.joinCodeDraft = joinCode.toUpperCase();
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Best-effort clean-leave on tab close.  beforeunload fires
   * synchronously; we append a peer-leave so other peers learn
   * about the departure even before the host emits its own
   * peer-disconnect.  The actual session.leave() runs in
   * disconnectedCallback so the broadcast goes out before the
   * transport tears down.
   */
  private readonly beforeUnloadHandler = (): void => {
    if (this.session && this.sessionView?.status === 'active') {
      // Synchronous append; no await on the underlying transport.
      // PeerJS data-channel send is fire-and-forget so this is
      // the best we can do for unclean close.
      try {
        (
          this.session as unknown as {
            peer?: { append: (k: string, p: unknown) => void };
          }
        ).peer?.append('peer-leave', {});
      } catch {
        /* tearing down anyway */
      }
    }
  };

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this.popstateHandler);
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
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
        // Surface the Resume-previous-session prompt when an autosave
        // exists for this campaign.  The prompt is dismissable and
        // only fires when arriving on the campaign view (not on
        // sub-routes — we don't want to interrupt episode/scene reads).
        this.checkResumePrompt();
        return;
      }

      // Character layer (independent of episode/scene)
      if (route.kind === 'character') {
        // DM-screen guard: NPC sheets carry dmNotes / signature /
        // voice and are not safe to expose to players in an active
        // session.  A non-coordinator who URL-hops to ?npc=foo gets
        // an error rather than the sheet.  In solo mode (no
        // session, or session not yet active) the gate is lifted —
        // a solo reader is free to browse NPC content.
        if (
          route.characterKind === 'npc' &&
          this.sessionView?.status === 'active' &&
          !this.isCoordinator()
        ) {
          throw new CharacterLoadError(
            'NPC sheets are only visible to the DM in an active session.',
            `Requested NPC: ${route.characterId}`
          );
        }
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

      // R3-A: scene/episode routes are session-only.  Pre-session
      // arrivals (someone clicked a URL the DM shared in chat) used
      // to auto-render the scene, leaking story content to a
      // not-yet-joined player.  Now we require an active session.
      //
      // - Pre-session: scene/episode routes are blocked; arrival
      //   lands on the campaign view with a clear "join first"
      //   message.  Solo browsing of scenes is gone — acceptable
      //   trade for the leak fix.  A DM doing solo prep clicks
      //   Host to become coordinator before navigating to scenes.
      // - Active session, coordinator: full access.
      // - Active session, non-coordinator: episode list refused;
      //   scene access limited to revealed scenes (B5 gating).
      const inActiveSession = this.sessionView?.status === 'active';
      if (!inActiveSession && (route.kind === 'episode' || route.kind === 'scene')) {
        throw new CampaignLoadError(
          'Scenes and episodes are only visible inside an active session.  Click "Host session" if you are the DM, or paste a code from your DM to join.',
          `Requested route: ${route.kind === 'scene' ? `${route.episode}/${route.scene}` : route.episode}`
        );
      }
      const isNonCoordPlayer =
        inActiveSession && !this.isCoordinator();
      if (isNonCoordPlayer && route.kind === 'episode') {
        throw new CampaignLoadError(
          'Episode lists are only visible to the DM.  Wait for the DM to reveal a scene.',
          `Requested episode: ${route.episode}`
        );
      }
      if (isNonCoordPlayer && route.kind === 'scene') {
        const fullPath = QuireApp.scenePathFor(route.episode, route.scene);
        if (!this.sessionView!.shared.revealedScenes.includes(fullPath)) {
          throw new CampaignLoadError(
            'That scene has not been revealed by the DM yet.',
            `Requested scene: ${route.episode}/${route.scene}`
          );
        }
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
      // Render via the document helper so YAML frontmatter
      // ("$schemaVersion: 0.1.0" etc.) is stripped from the body
      // before sanitization.  Without this it renders as literal
      // text at the top of the scene — a real bug surfaced during
      // manual testing.  TODO (frontmatter banners): some scene
      // authors also embed "DM-only" warning blockquotes via
      // GitHub `> [!CAUTION]` alerts.  Stripping those for
      // players requires a documented convention with the
      // campaign author; deferred until we settle on one (e.g.
      // `> [!DM]` blockquote, or `<!-- dm:start -->...<!-- dm:end -->`
      // HTML comments).  For now they render as-is.
      const sceneDoc = renderMarkdownDocument(sceneText);
      this.appState = {
        kind: 'scene',
        campaign,
        episode,
        scene: { path: route.scene, html: sceneDoc.html }
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
    // Normalize both sides so `owner/repo` and `owner/repo@main` are
    // treated as the same campaign — otherwise navigating around inside
    // a campaign opened with the explicit `@main` ref refetches the
    // whole manifest + world overview on every click.
    return normalizeSlug(`${src.owner}/${src.repo}@${src.ref}`) ===
      normalizeSlug(slug);
  }

  /** Click handler: pushState the new route, then re-render via navigate. */
  private navigate(e: Event, route: AppRoute): void {
    e.preventDefault();
    const url = window.location.pathname + routeToSearch(route);
    history.pushState({}, '', url);
    void this.navigateToRoute(route);
  }

  override render(): TemplateResult {
    /*
     * Facade-migration step 2: route the existing renderXxx output
     * through the five-region shell.  Region elements use
     * `display: contents` (see src/ui/shell/*) so the visual layout
     * is identical to the prior stack-of-cards.  M2 promotes shell
     * styling to a real CSS Grid as region content migrates.
     *
     * Region mapping (M1 — approximate; firms up in M2):
     *   topbar : session bar (host/join/leave + status)
     *   rail   : roster panel
     *   stage  : reveal banner + body (campaign/episode/scene)
     *   aside  : AI panel + chat panel
     *   dock   : version badge (real Dock content lands in M2)
     */
    return html`
      <quire-shell>
        <quire-topbar slot="topbar">${this.renderSessionBar()}</quire-topbar>
        <quire-rail slot="rail">${this.renderRosterPanel()}</quire-rail>
        <quire-stage slot="stage">${this.renderRevealBanner()}${this.renderBody()}</quire-stage>
        <quire-aside slot="aside">${this.renderAiPanel()}${this.renderChatPanel()}</quire-aside>
        <quire-dock slot="dock">${this.renderVersionBadge()}</quire-dock>
      </quire-shell>
    `;
  }

  /**
   * Roster of who's in the session.  DM and players both see the
   * full list with display names + character/status strings.
   * Helps roleplay continuity ("wait, who plays Yui?").  Toggleable
   * so the bar doesn't dominate the screen when not needed.
   */
  private renderRosterPanel(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return html``;
    const peers = Object.values(v.shared.peers).filter(
      (p) => p.leftAt === undefined
    );
    if (peers.length === 0) return html``;
    return html`
      <section class="card roster-panel">
        <div class="roster-head">
          <h2>
            Roster
            <span class="roster-count">(${peers.length})</span>
          </h2>
          <button
            type="button"
            class="roster-toggle"
            @click=${() => {
              this.showRoster = !this.showRoster;
            }}
          >
            ${this.showRoster ? 'Hide' : 'Show'}
          </button>
        </div>
        ${this.showRoster
          ? html`
              <ul class="roster-list">
                ${peers.map((p) => this.renderRosterRow(p))}
              </ul>
              ${this.renderRenameForm()}
            `
          : nothing}
      </section>
    `;
  }

  private renderRosterRow(
    peer: { peerId: string; name?: string; character?: string }
  ): TemplateResult {
    const v = this.sessionView!;
    const isSelf = peer.peerId === v.peerId;
    const isDm = v.shared.coordinator === peer.peerId;
    const localIsDm = this.isCoordinator();
    const canKick = localIsDm && !isSelf && !isDm;
    const name = peer.name ?? '(unnamed)';
    return html`
      <li class="roster-row ${isSelf ? 'roster-row-self' : ''}">
        ${isDm ? html`<span class="roster-dm-tag">DM</span>` : nothing}
        <span class="roster-name">${name}</span>
        ${peer.character
          ? html`<span class="roster-char">${peer.character}</span>`
          : nothing}
        ${isSelf
          ? html`<button
              type="button"
              class="roster-edit"
              @click=${() => this.beginRename()}
            >
              edit
            </button>`
          : nothing}
        ${canKick
          ? html`<button
              type="button"
              class="roster-kick"
              title="Remove this peer from the roster (use if they've left without disconnecting cleanly)"
              @click=${() => this.kickPeer(peer.peerId, name)}
            >
              remove
            </button>`
          : nothing}
      </li>
    `;
  }

  kickPeer(peerId: string, name: string): void {
    if (!this.session) return;
    if (!window.confirm(`Remove ${name} from the roster?`)) return;
    this.session.kickPeer(peerId);
  }

  private renderRenameForm(): TemplateResult {
    if (!this.renameEditing) return html``;
    return html`
      <form
        class="rename-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          this.submitRename();
        }}
      >
        <label>
          <span>Your name</span>
          <input
            type="text"
            .value=${this.renameDraft.name}
            maxlength="80"
            @input=${(e: Event) => {
              this.renameDraft = {
                ...this.renameDraft,
                name: (e.target as HTMLInputElement).value
              };
            }}
          />
        </label>
        <label>
          <span>Character / status</span>
          <input
            type="text"
            .value=${this.renameDraft.character}
            maxlength="80"
            placeholder="e.g. Yui Tanaka, or Tim (afk)"
            @input=${(e: Event) => {
              this.renameDraft = {
                ...this.renameDraft,
                character: (e.target as HTMLInputElement).value
              };
            }}
          />
        </label>
        <div class="rename-actions">
          <button
            type="button"
            @click=${() => {
              this.renameEditing = false;
            }}
          >
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    `;
  }

  private beginRename(): void {
    const v = this.sessionView;
    if (!v?.peerId) return;
    const self = v.shared.peers[v.peerId];
    this.renameDraft = {
      name: self?.name ?? '',
      character: self?.character ?? ''
    };
    this.renameEditing = true;
  }

  private submitRename(): void {
    if (!this.session) return;
    this.session.rename(this.renameDraft);
    this.renameEditing = false;
  }

  /**
   * Small footer badge identifying the build commit + timestamp.
   * Helps a manual tester confirm Cloudflare has deployed the
   * latest version before reporting issues against stale builds.
   * Hovering shows the full ISO timestamp.
   */
  private renderVersionBadge(): TemplateResult {
    const version =
      typeof __QUIRE_VERSION__ !== 'undefined' ? __QUIRE_VERSION__ : 'dev';
    const buildTime =
      typeof __QUIRE_BUILD_TIME__ !== 'undefined'
        ? __QUIRE_BUILD_TIME__
        : 'unknown';
    return html`
      <p class="version-badge" title=${`Built at ${buildTime}`}>
        build ${version}
      </p>
    `;
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
          ${hasKey
            ? html`<button
                type="button"
                class="ai-settings-toggle"
                @click=${() => {
                  this.aiShowSettings = !this.aiShowSettings;
                }}
              >
                ${this.aiShowSettings ? 'Hide settings' : 'Settings'}
              </button>`
            : nothing}
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
    const keyHint =
      provider === 'claude'
        ? html`Get an API key at
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              >console.anthropic.com</a
            >
            (paid; usage-based).  Free tier requires a credit card on
            file.`
        : html`Get an API key at
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              >aistudio.google.com</a
            >
            (generous free tier; no credit card needed).  This is the
            AI Studio key, NOT a Google One AI Premium subscription.`;
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
          <p class="ai-key-hint muted">${keyHint}</p>
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
    const campaign = this.getCurrentCampaign();
    if (!campaign) return html``;
    const slug = this.slugFor(campaign);
    // F4 fix: show ALL revealed scenes as chips, not just the
    // latest.  Players still reading scene 1 when the DM reveals
    // scene 2 used to lose the affordance for scene 1 entirely.
    // Now both stay reachable; the chip for the scene the player
    // is currently on is highlighted, so it's visually obvious
    // which one is "current".
    const currentScene =
      this.appState.kind === 'scene'
        ? `episodes/${this.appState.episode.slug}/${this.appState.scene.path}`
        : null;
    const chips: TemplateResult[] = [];
    for (let i = 0; i < list.length; i++) {
      const full = list[i];
      const parsed = QuireApp.parseRevealedPath(full);
      if (!parsed) continue;
      const route: AppRoute = {
        kind: 'scene',
        slug,
        episode: parsed.episode,
        scene: parsed.scene
      };
      const isCurrent = full === currentScene;
      chips.push(html`
        <a
          class="reveal-chip ${isCurrent ? 'reveal-chip-current' : ''}"
          href=${routeToSearch(route)}
          @click=${(e: Event) => this.navigate(e, route)}
          title=${`Revealed scene ${i + 1} of ${list.length} (in ${parsed.episode})`}
          ><code>${parsed.scene}</code>${isCurrent
            ? html`<span class="reveal-chip-marker"> (here)</span>`
            : nothing}</a
        >
      `);
    }
    if (chips.length === 0) return html``;
    return html`
      <div class="reveal-banner">
        <span class="reveal-banner-label">
          DM revealed${list.length > 1 ? ` (${list.length})` : ''}:
        </span>
        <span class="reveal-chips">${chips}</span>
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
    // Surface the most likely confused-arrival scenario: the user
    // opened a partial invite URL that has ?join= but no
    // ?campaign=, so even after they "Join" the session the campaign
    // never loads.  Without this hint, they'd see "No campaign
    // loaded" with a session bar that says "Joined as X" above —
    // genuinely confusing because they DID just join something.
    let hasJoinNoCampaign = false;
    try {
      const params = new URLSearchParams(window.location.search);
      hasJoinNoCampaign = !!params.get('join') && !params.get('campaign');
    } catch {
      /* ignore */
    }
    return html`
      <header>
        <h1>Quire</h1>
        <p class="summary">
          Browser-based TTRPG framework for collaborative interactive
          storytelling.
        </p>
      </header>
      ${hasJoinNoCampaign
        ? html`
            <section class="card error">
              <h2>Invite link is incomplete</h2>
              <p>
                This URL has a session code but no campaign.  The DM's
                invite link should include both — usually it looks like
                <code>?campaign=…&amp;join=…</code>.  Ask your DM to send
                the full link from their <strong>Copy invite</strong>
                button.
              </p>
            </section>
          `
        : nothing}
      ${this.sessionView?.status === 'active'
        ? html`
            <section class="card">
              <h2>Connected, but no campaign open</h2>
              <p>
                You're in the session, but Quire doesn't know which
                campaign you're playing.  Open the campaign URL (or
                ask your DM for the full invite link with
                <code>?campaign=…</code> in it).
              </p>
            </section>
          `
        : nothing}
      <section class="card">
        <h2>No campaign loaded</h2>
        <p>
          Quire loads a campaign from a GitHub repository.  Append
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
      ${m.episodes?.length && this.shouldShowDmContent()
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
      ${this.renderCharacterMenus(
        this.slugFor(campaign),
        campaign.base.manifest.characters
      )}
      ${this.renderRollPanel()}
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
      return html`
        <p class="reveal-control">
          <span class="reveal-badge reveal-badge-revealed"
            >Already revealed</span
          >
          <button
            class="reveal-undo"
            title="Undo this reveal — players will be navigated away if currently viewing it"
            @click=${() => this.unrevealCurrentScene()}
          >
            Un-reveal
          </button>
        </p>
      `;
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
    const brokerCfg = brokerConfigFromUrl();
    const brokerBadge = brokerCfg?.nonDefault
      ? html`<span
          class="broker-badge"
          title="Custom PeerJS broker configured via URL params (peerHost=${brokerCfg.host ??
          ''}).  Disable by removing the peer* query params."
          >custom broker</span
        >`
      : nothing;
    if (v.status === 'idle' && v.mode === 'solo') {
      // UX hint clarifies the two roles for first-time visitors:
      // DMs host; players paste a code their DM sent.  Without this,
      // the bar's "Host session OR Join" pair leaves players guessing
      // whether they should click Host or just wait.
      const nameMissing = this.displayNameDraft.trim().length === 0;
      const codeMissing = this.joinCodeDraft.trim().length === 0;
      const nameHint = nameMissing ? 'Enter your name first' : '';
      return html`
        <div class="session-bar session-solo">
          <p class="session-role-hint">
            <strong>DM:</strong> click Host to start a session and
            share the code (or invite link) that appears.
            <strong>Player:</strong> wait for your DM to send a code
            or invite link, then paste it below.  A name is required
            so others know who you are — no GUIDs in chat.
          </p>
          <div class="session-bar-row">
            <input
              type="text"
              class="session-name"
              .value=${this.displayNameDraft}
              placeholder="Your name (required)"
              aria-label="Display name"
              required
              @input=${(e: Event) => {
                this.displayNameDraft = (e.target as HTMLInputElement).value;
              }}
            />
            <button
              ?disabled=${nameMissing}
              title=${nameHint || 'Start a new session as the DM'}
              @click=${() => this.startHosting()}
            >
              Host session
            </button>
            <span class="session-sep">or</span>
            <input
              type="text"
              class="session-code"
              .value=${this.joinCodeDraft}
              placeholder="paste code or invite link from your DM"
              aria-label="Pairing code"
              maxlength="200"
              @input=${(e: Event) => {
                this.joinCodeDraft = QuireApp.extractJoinCode(
                  (e.target as HTMLInputElement).value
                );
              }}
            />
            <button
              ?disabled=${nameMissing || codeMissing}
              title=${nameMissing
                ? nameHint
                : codeMissing
                  ? 'Paste the code or invite link from your DM'
                  : 'Join your DM\'s session'}
              @click=${() => this.joinSession()}
            >
              Join
            </button>
            ${brokerBadge}
          </div>
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
    // F1 fix: report session membership (shared.peers, the
    // gossip-propagated count of who joined) instead of direct
    // WebRTC connections.  In a hub topology a guest's
    // connectedPeers is always 1 even when 4 people are in the
    // room — counting from shared.peers reflects what the user
    // actually cares about.  Show "(N reachable)" only when it
    // disagrees with the membership count, so the discrepancy is
    // surfaced when it matters (someone dropped) without cluttering
    // the bar in the happy path.
    const sessionMembers = Object.values(v.shared.peers).filter(
      (p) => p.peerId !== v.peerId && p.leftAt === undefined
    );
    // Disambiguate DM from other players (per manual-testing
    // feedback: "1 other player" was confusing when the only
    // other was the DM).
    const coordPeerId = v.shared.coordinator;
    const dmInOthers = sessionMembers.some((p) => p.peerId === coordPeerId);
    const playerCount = sessionMembers.filter(
      (p) => p.peerId !== coordPeerId
    ).length;
    const connected = v.connectedPeers.length;
    const labelParts: string[] = [];
    if (dmInOthers) labelParts.push('DM');
    if (playerCount === 1) labelParts.push('1 other player');
    else if (playerCount > 1) labelParts.push(`${playerCount} other players`);
    const memberCount = sessionMembers.length;
    const memberLabel =
      memberCount === 0
        ? 'no other players yet'
        : labelParts.length === 1
          ? labelParts[0] + ' connected'
          : labelParts.join(' + ');
    const reachabilityHint =
      memberCount > 0 && connected < memberCount
        ? html` <span
            class="session-peers-warn"
            title="Some peers are not directly reachable via WebRTC right now.  Events still flow if any peer can forward."
            >(${connected} direct)</span
          >`
        : nothing;
    return html`
      <div class="session-bar session-active">
        ${v.mode === 'host'
          ? html`
              <span class="session-label">Hosting</span>
              <span class="session-code-display">
                code: <code>${v.pairingCode}</code>
              </span>
              <button
                class="session-copy-invite"
                title="Copy a click-to-join link for players"
                @click=${() => this.copyInviteLink()}
              >
                ${this.inviteCopied ? 'Copied!' : 'Copy invite'}
              </button>
              <button
                class="session-regenerate-code"
                title="Issue a new code (defensive — use if a code leaks)"
                @click=${() => this.regeneratePairingCode()}
              >
                New code
              </button>
            `
          : html`
              <span class="session-label">Joined</span>
              <span class="session-code-display">
                as
                <code title="Internal peer id: ${v.peerId}"
                  >${(v.peerId && this.displayNameFor(v.peerId)) || 'unnamed'}</code
                >
              </span>
            `}
        <span
          class="session-peers"
          title=${sessionMembers
            .map((p) => p.name ?? p.peerId)
            .join(', ') || 'no other players in this session yet'}
        >
          ${memberLabel}${reachabilityHint}
        </span>
        ${brokerBadge}
        <button
          @click=${() => this.saveToFile()}
          title="Download a JSON save of this session"
        >
          Save
        </button>
        <label class="session-load-label" title="Load a JSON save file into this session">
          Load
          <input
            type="file"
            accept="application/json,.json"
            @change=${(e: Event) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void this.loadFromFile(f);
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </label>
        ${this.renderReclaimAffordance()}
        <button @click=${() => this.leaveSession()}>Leave</button>
        ${this.saveStatus.kind === 'saved'
          ? html`<span class="save-status">${this.saveStatus.message}</span>`
          : nothing}
        ${this.saveStatus.kind === 'error'
          ? html`<span class="save-status save-error">${this.saveStatus.message}</span>`
          : nothing}
        ${this.loadStatus.kind === 'loaded'
          ? html`<span class="save-status">${this.loadStatus.message}</span>`
          : nothing}
        ${this.loadStatus.kind === 'error'
          ? html`<span class="save-status save-error">${this.loadStatus.message}</span>`
          : nothing}
      </div>
      ${this.renderReclaimConfirmation()}
      ${this.renderResumePrompt()}
    `;
  }

  /**
   * The "Reclaim coordinator" button.  Visible to ANY peer in an
   * active session whose own peerId is NOT the current coordinator —
   * this supports the sick-DM scenario where a trusted player steps
   * in.  The confirmation dialog names the current coordinator
   * (deliberate action), and the reclaim itself is audit-trailed in
   * chat (broadcast transparency).
   */
  private renderReclaimAffordance(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return html``;
    if (!v.peerId) return html``;
    if (v.shared.coordinator === v.peerId) return html``;
    // Currently we're a non-coordinator.  Allow taking over.
    return html`
      <button
        class="reclaim-button"
        @click=${() => {
          this.reclaimConfirmShown = true;
        }}
        title="Take over as session coordinator (DM role)"
      >
        Reclaim DM
      </button>
    `;
  }

  private renderReclaimConfirmation(): TemplateResult {
    if (!this.reclaimConfirmShown) return html``;
    const v = this.sessionView;
    const current = v?.shared.coordinator;
    const currentName = current ? this.displayNameFor(current) : 'no-one';
    return html`
      <div class="reclaim-modal" role="alertdialog">
        <p>
          Take over as coordinator from <strong>${currentName}</strong>?
          This action is visible to all peers in chat.
        </p>
        <div class="reclaim-modal-actions">
          <button
            @click=${() => {
              this.reclaimConfirmShown = false;
            }}
          >
            Cancel
          </button>
          <button
            class="reclaim-button-confirm"
            @click=${() => this.reclaimCoordinator()}
          >
            Yes, take over
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Resume prompt: when the campaign view loads and an autosave
   * exists for the current slug, offer to surface the contents (so
   * the DM can either Load to continue or Dismiss to start fresh).
   */
  private renderResumePrompt(): TemplateResult {
    if (!this.resumePromptDoc) return html``;
    const doc = this.resumePromptDoc;
    const ago = formatTimeAgo(doc.savedAt);
    return html`
      <div class="resume-prompt" role="status">
        <p>
          You have an autosaved session for this campaign (${doc.events.length}
          events, saved ${ago}).
        </p>
        <div class="resume-prompt-actions">
          <button @click=${() => this.dismissResumePrompt()}>
            Start fresh
          </button>
          <button
            @click=${() => {
              const json = stringifySave(doc);
              this.dismissResumePrompt();
              if (this.session && this.sessionView?.status !== 'active') {
                // Need an active session before applying.  For
                // simplicity, prompt the user to host first; the
                // autosave still sits in localStorage so they can
                // re-trigger via the prompt after hosting.
                this.saveStatus = {
                  kind: 'error',
                  message:
                    'Host a session first, then this autosave will be available to load.'
                };
                return;
              }
              this.loadFromString(json);
            }}
          >
            Load autosave
          </button>
        </div>
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
              this.chatError = null;
            }}
          />
          <button type="submit">Send</button>
        </form>
        ${this.chatError
          ? html`<p class="chat-error">${this.chatError}</p>`
          : nothing}
      </section>
    `;
  }

  private renderRollPanel(): TemplateResult {
    // In an active session, the shared event log is the source of
    // truth for "who rolled what" — every peer sees every roll with
    // attribution.  In solo mode the local mirror is the only source.
    // We render the union to avoid showing duplicates when our own
    // dice-roll event has both been appended locally AND echoed back
    // through the materializer.
    const inSession = this.sessionView?.status === 'active';
    const shared = inSession ? this.sessionView!.shared.diceRolls : [];
    const entries: Array<{
      key: string;
      label: string;
      tierClass: string;
    }> = inSession
      ? // Most-recent first, capped to history limit.
        shared
          .slice()
          .reverse()
          .slice(0, ROLL_HISTORY_MAX)
          .map((r, i) => ({
            key: `s${r.ts}-${r.peerId}-${i}`,
            label: `${this.displayNameFor(r.peerId)}: ${r.expression} = ${r.result} [${r.dice.join(', ')}]`,
            tierClass: ''
          }))
      : this.rolls.map((r, i) => ({
          key: `l${i}`,
          label: formatRoll(r),
          tierClass: r.tier ? `roll-tier-${r.tier}` : ''
        }));
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
        ${entries.length
          ? html`
              <ul class="roll-history">
                ${entries.map(
                  (e) =>
                    html`<li>
                      <code class="${e.tierClass}">${e.label}</code>
                    </li>`
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

  // Session lifecycle methods delegate to session-bootstrap helpers
  // (P0-8b).  The @state input bindings (displayNameDraft,
  // joinCodeDraft) stay on QuireApp because they're tied to the
  // render templates; the LOGIC moves to testable helpers.

  startHosting(): void {
    // R3-C: embed the campaign reference in the host's peer-join
    // so guests who arrived without ?campaign= in their URL can
    // discover what to load.
    doHostSession(
      this.session,
      this.displayNameDraft,
      this.getCurrentCampaign()?.base.source
    );
  }

  joinSession(): void {
    doJoinSession(this.session, this.joinCodeDraft, this.displayNameDraft);
  }

  leaveSession(): void {
    doLeaveSession(this.session);
    this.joinCodeDraft = '';
    this.chatDraft = '';
  }

  /**
   * Build a click-to-join URL for the current session's pairing code.
   * Returns null when no active session.  Delegates to the pure
   * helper in session-bootstrap.ts (P0-8).
   */
  buildInviteLink(): string | null {
    if (this.sessionView?.status !== 'active') return null;
    return buildInviteLinkHelper(window.location.href, this.sessionView.pairingCode);
  }

  async regeneratePairingCode(): Promise<void> {
    await doRegenerateCode(
      this.session,
      this.displayNameDraft,
      this.getCurrentCampaign()?.base.source,
      () =>
        window.confirm(
          'Issue a new pairing code?  Players currently connected will be ' +
            'disconnected and need to rejoin with the new code or invite link.'
        )
    );
  }

  async copyInviteLink(): Promise<void> {
    const link = this.buildInviteLink();
    if (!link) return;
    const ok = await doCopyInviteLink(
      link,
      navigator.clipboard,
      (msg, def) => window.prompt(msg, def)
    );
    if (ok) {
      this.inviteCopied = true;
      // Reset the "Copied!" indicator after a moment so the button
      // becomes actionable again if the DM needs to copy a second
      // time (e.g. after a player joined late).
      setTimeout(() => {
        this.inviteCopied = false;
      }, 2000);
    }
  }

  /** True if the local peer is the coordinator in an active session. */
  isCoordinator(): boolean {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return false;
    return v.shared.coordinator === v.peerId;
  }

  /**
   * Whether to show DM-only structural content (episode list, scene
   * list, episode hooks, episode summary, etc).  True in solo mode
   * (no DM secret to keep) and when local peer is coordinator.
   * False for non-coord players in an active session — they should
   * see only the campaign metadata, character menus (PCs), and
   * whatever the DM has explicitly revealed via the reveal banner.
   *
   * This is the B5 fix: the original UI exposed the full scene
   * list to every peer, letting players read ahead.  Now players
   * navigate only via reveals.
   */
  shouldShowDmContent(): boolean {
    const v = this.sessionView;
    if (!v) return true; // before mount
    if (v.status !== 'active') return true; // solo
    return this.isCoordinator();
  }

  /**
   * Static delegates to the helpers in src/controllers/session-
   * bootstrap.ts (P0-8).  Kept on the class so existing tests that
   * call `QuireApp.extractJoinCode(...)` etc. continue to work; the
   * QuireAppHooks interface formalizes this surface.
   */
  private static scenePathFor(episodeSlug: string, scenePath: string): string {
    return scenePathForHelper(episodeSlug, scenePath);
  }

  static extractJoinCode(input: string): string {
    return extractJoinCodeHelper(input);
  }

  static parseRevealedPath(
    full: string
  ): { episode: string; scene: string } | null {
    return parseRevealedPathHelper(full);
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
   * Coordinator-only: un-reveal the current scene.  Emits a
   * scene-unreveal event that strikes the scene from
   * shared.revealedScenes.  Players currently viewing the
   * un-revealed scene get bounced back to the campaign view on
   * their next render (B5 gating refuses scene routes that
   * aren't currently revealed).
   */
  unrevealCurrentScene(): boolean {
    if (!this.session || !this.isCoordinator()) return false;
    if (this.appState.kind !== 'scene') return false;
    const ep = this.appState.episode.slug;
    const sp = this.appState.scene.path;
    const full = QuireApp.scenePathFor(ep, sp);
    if (!this.sessionView!.shared.revealedScenes.includes(full)) return false;
    this.session.append('scene-unreveal', { scenePath: full });
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

  // ── AI key-store delegations ──
  // The reactive AiKeyStore controller (P0-10) owns the underlying
  // state and localStorage I/O; these getters/setters preserve the
  // pre-extraction QuireApp surface so render code and tests don't
  // need updates.

  get aiProvider(): AiProvider { return this.aiKeys.provider; }
  get aiApiKeys(): Record<AiProvider, string> { return this.aiKeys.apiKeys; }
  get aiModels(): Record<AiProvider, string> { return this.aiKeys.models; }
  get aiSystemPrompt(): string { return this.aiKeys.systemPrompt; }
  get aiApiKey(): string { return this.aiKeys.apiKey; }
  get aiModel(): string { return this.aiKeys.model; }

  setAiProvider(provider: AiProvider): void {
    this.aiKeys.setProvider(provider);
  }

  setAiApiKey(key: string, provider: AiProvider = this.aiProvider): void {
    this.aiKeys.setApiKey(key, provider);
  }

  setAiModel(model: string, provider: AiProvider = this.aiProvider): void {
    this.aiKeys.setModel(model, provider);
  }

  setAiSystemPrompt(text: string): void {
    this.aiKeys.setSystemPrompt(text);
  }

  /**
   * Test / shutdown helper: force any debounced AI-key-store
   * localStorage writes to commit synchronously.  See
   * AiKeyStore.flushPending — storage writes for setApiKey and
   * setSystemPrompt are debounced 300 ms to avoid per-keystroke
   * render+IO churn.  Production calls this via hostDisconnected;
   * tests call it after a setAiApiKey/setAiSystemPrompt to read
   * back from localStorage without sleeping.
   */
  flushAiKeyStore(): void {
    this.aiKeys.flushPending();
  }

  private applyCampaignAiDefault(
    manifestProvider: 'claude' | 'gemini' | 'none' | undefined
  ): void {
    this.aiKeys.applyCampaignDefault(manifestProvider);
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
    // Truncate before delegating to submitChat so an over-long AI
    // response renders as "[AI] <truncated…>" rather than being
    // silently dropped or flooding the event log.  The truncated
    // marker tells the DM to copy/paste the full text manually if
    // they want all of it.
    const head = '[AI] ';
    const room = CHAT_MAX_LENGTH - head.length - 1;
    const body =
      this.aiResponse.length > room
        ? this.aiResponse.slice(0, room - 1) + '…'
        : this.aiResponse;
    return this.submitChat(head + body);
  }

  // -----------------------------------------------------------------
  // Persistence: Save / Load / Autosave / Reclaim
  // -----------------------------------------------------------------

  /**
   * Build the current save document for the loaded campaign +
   * active session.  Returns null when no session OR no campaign.
   */
  buildSaveDocument(): SaveDocument | null {
    if (!this.session || this.sessionView?.status !== 'active') return null;
    const campaign = this.getCurrentCampaign();
    if (!campaign) return null;
    const src = campaign.base.source;
    return serializeSession(
      this.session.getEvents(),
      { owner: src.owner, repo: src.repo, ref: src.ref },
      this.sessionView.peerId ?? 'unknown'
    );
  }

  /**
   * Download the current session as a JSON file.  No-op when not in
   * an active session (button is disabled in that state).  Returns
   * the SaveDocument that was offered, for tests.
   */
  saveToFile(): SaveDocument | null {
    const doc = this.buildSaveDocument();
    if (!doc) {
      this.saveStatus = {
        kind: 'error',
        message: 'No active session to save.'
      };
      return null;
    }
    const json = stringifySave(doc);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.campaign.owner}-${doc.campaign.repo}-${doc.savedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.saveStatus = { kind: 'saved', message: `Saved ${doc.events.length} events.` };
    return doc;
  }

  /**
   * Parse + apply a save document from a JSON string.  Returns the
   * LoadResult on success or null on parse failure (with the error
   * surfaced in loadStatus).
   */
  loadFromString(json: string): LoadResult | null {
    const parsed = parseSaveDocument(json);
    if (!parsed.ok) {
      this.loadStatus = { kind: 'error', message: parsed.error };
      return null;
    }
    if (!this.session || this.sessionView?.status !== 'active') {
      this.loadStatus = {
        kind: 'error',
        message: 'Start or host a session first, then load.'
      };
      return null;
    }
    // Cross-campaign protection: refuse to load a save for a
    // different campaign than the one currently open.
    const currentCampaign = this.getCurrentCampaign();
    if (currentCampaign) {
      const c = currentCampaign.base.source;
      if (
        c.owner !== parsed.doc.campaign.owner ||
        c.repo !== parsed.doc.campaign.repo
      ) {
        this.loadStatus = {
          kind: 'error',
          message: `Save is for ${parsed.doc.campaign.owner}/${parsed.doc.campaign.repo}, current campaign is ${c.owner}/${c.repo}.`
        };
        return null;
      }
    }
    let applied = 0;
    let unknownKinds = 0;
    for (const e of parsed.doc.events) {
      if (this.session.applyEvents([e]) > 0) applied++;
      // H-4 unknown-kind detection: count events whose kind isn't
      // in the local runtime's KNOWN_EVENT_KINDS vocabulary.  These
      // events still replicate (EventLog dedups by id) but the
      // materializer silently drops them — the banner alerts the
      // user that some scene state may be incomplete because they
      // are running an older Quire than the save was produced on.
      if (
        typeof e.kind !== 'string' ||
        !KNOWN_EVENT_KINDS.has(e.kind)
      ) {
        unknownKinds++;
      }
    }
    // Auto-reclaim if needed: when a host loads a save, the
    // session-1 coordinator-claim may sort earlier (older
    // clock-sum) than the new host's own claim, depending on
    // peerId tiebreak.  Without auto-reclaim, the coordinator
    // would be non-deterministic.  User intent: "the host who
    // loads is the DM."  Fire a coord-reclaim from the host so
    // they're unambiguously coordinator; the audit chat captures
    // the transition transparently.  A non-host (guest) who
    // loads does NOT auto-reclaim — that's the explicit "I want
    // to take over" workflow gated by the Reclaim button.
    if (
      this.sessionView!.mode === 'host' &&
      this.sessionView!.shared.coordinator !== this.sessionView!.peerId
    ) {
      this.session.reclaimCoordinator();
    }
    const result: LoadResult = {
      applied,
      duplicates: parsed.doc.events.length - applied,
      rejected: 0,
      unknownKinds,
      errors: []
    };
    // H-4 banner: prepend a one-line warning when the save contained
    // events from a newer runtime.  The events still replicate
    // (forward-compat), but the local materializer can't render
    // them; surface this so the user knows to update.
    const banner =
      unknownKinds > 0
        ? `This save contains ${unknownKinds} event kind${unknownKinds === 1 ? '' : 's'} this runtime doesn't recognize; some scene state may be incomplete (consider updating). `
        : '';
    this.loadStatus = {
      kind: 'loaded',
      message: `${banner}Loaded ${applied} new event${applied === 1 ? '' : 's'} (${result.duplicates} already present).`
    };
    return result;
  }

  /** File-picker driven load. */
  async loadFromFile(file: File): Promise<LoadResult | null> {
    const text = await file.text();
    return this.loadFromString(text);
  }

  /** Reclaim coordinator with confirmation. */
  reclaimCoordinator(): void {
    if (!this.session) return;
    this.session.reclaimCoordinator();
    this.reclaimConfirmShown = false;
  }

  /**
   * Trigger debounced autosave to localStorage.  Called on every
   * sessionView change while in an active session.  Storage key:
   * quire.save.<owner>-<repo>.
   */
  /**
   * Schedule a debounced autosave.  Delegates to AutosaveController
   * (P0-9).  Kept as a private method on QuireApp so the call sites
   * in the session-subscribe handler don't need to reach through
   * to the controller.
   */
  private scheduleAutosave(): void {
    this.autosave.schedule();
  }

  /** Look up an autosave for the current campaign and stage it as a Resume prompt. */
  private checkResumePrompt(): void {
    const campaign = this.getCurrentCampaign();
    if (!campaign) return;
    const resumed = this.autosave.checkResume(campaign.base.source);
    if (resumed) this.resumePromptDoc = resumed;
  }

  dismissResumePrompt(): void {
    this.resumePromptDoc = null;
  }

  submitChat(text: string): boolean {
    if (!this.session || this.sessionView?.status !== 'active') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    // Slash-command escape hatch: a leading /roll or /r routes through
    // the dice flow instead of chat.  The roll panel's "/roll" label
    // implies this affordance exists; this makes it true.  Anything
    // unparseable falls through to a regular chat message so the user
    // isn't penalized for typing a literal slash.
    if (/^\/(roll|r)\b/i.test(trimmed)) {
      const cmd = parseDiceCommand(trimmed);
      if (cmd) {
        this.submitRoll(trimmed);
        this.chatDraft = '';
        this.chatError = null;
        return true;
      }
      // Unparseable /roll: send as chat so user sees their literal
      // text rather than getting a silent no-op.
    }
    // F2 fix: cap with explicit user-facing feedback instead of a
    // silent no-op.  The user can see what was over-cap and edit it
    // back down rather than wondering why their long message
    // disappeared.
    if (trimmed.length > CHAT_MAX_LENGTH) {
      this.chatError = `Message too long (${trimmed.length} characters; max ${CHAT_MAX_LENGTH}).`;
      return false;
    }
    this.session.append('chat', { text: trimmed });
    this.chatDraft = '';
    this.chatError = null;
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
    // DM-screen guard: in an active session, non-coordinators
    // never see the NPC menu — the NPC sheet itself is also
    // gated in navigateToRoute, but hiding the menu prevents the
    // tantalizing "look at this list of NPCs I can't open" UX.
    const inActiveSession = this.sessionView?.status === 'active';
    const npcVisible = !inActiveSession || this.isCoordinator();
    const hasNpcs = npcVisible && !!characters.npcs?.length;
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

  /**
   * Render a character page.  Delegates the sheet itself to
   * <player-rail> (M2.3, P1-1); the roll panel still renders here
   * until M2.6 (dice-dock) moves it to the Dock slot of the shell.
   *
   * Edit handlers (bumpStat, toggleTrackBox, navigate) stay on
   * QuireApp per the facade-migration pattern — passed as callback
   * properties to the region component so the existing test surface
   * (quire-app.pc-edit.test.ts) is unchanged.
   */
  private renderCharacter(
    campaign: LoadedCampaign,
    character: LoadedCharacter
  ): TemplateResult {
    const slug = this.slugFor(campaign);
    const r = this.effectiveCharacter(character);
    const editable =
      character.kind === 'pc' && this.sessionView?.status === 'active';
    return html`
      <player-rail
        .character=${character}
        .effective=${r}
        .campaignName=${campaign.base.manifest.name}
        .campaignSlug=${slug}
        .editable=${editable}
        .onBumpStat=${(
          pcId: string,
          key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
          current: number,
          delta: number
        ) => this.bumpStat(pcId, key, current, delta)}
        .onToggleTrackBox=${(
          pcId: string,
          field: 'harm' | 'stress',
          box: number,
          current: number
        ) => this.toggleTrackBox(pcId, field, box, current)}
        .onNavigate=${(e: Event, route: AppRoute) =>
          this.navigate(e, route)}
      ></player-rail>
      ${this.renderRollPanel()}
    `;
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

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
import './ui/regions/scene-stage';
import './ui/regions/player-aside';
import './ui/regions/dice-dock';
import './ui/regions/chat-panel';
import './ui/regions/session-bar';
import './ui/regions/ai-panel';
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
  type AiProvider,
  type AiClient
} from './controllers/ai-key-store';
import { AutosaveController } from './controllers/autosave-controller';
import { decideRoute } from './controllers/route-policy';
import { KNOWN_EVENT_KINDS, type ThreadDebtLevel } from './core/state';
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
  renderMarkdownParagraphs,
  type MarkdownBlock
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
      scene: {
        path: string;
        /**
         * M3a.7 P2-2: per-block pipeline.  Each block carries a
         * content-hash + its own sanitized HTML so the renderer can
         * support per-paragraph reveal (DM gutter pips toggle
         * individual blocks; players see only the revealed subset).
         */
        blocks: MarkdownBlock[];
        /**
         * M3a.6c (P-M3a-scene-strip): parsed YAML frontmatter from
         * the scene file.  Surfaced in <scene-stage>'s scene-strip
         * header — location · mood · expectedDuration · presentNpcs.
         */
        frontmatter: Record<string, unknown>;
      };
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
   * Current app state.  Private backing @state; public getter
   * exposes a Readonly<AppState> for the QuireAppHooks contract
   * (e2e tests poll `app.appState.kind` / `app.appState.character`).
   *
   * P0-11-followup-appState (M1 gate Engine finding): the public
   * field was writable from outside the class.  The getter is
   * type-only — TypeScript readers can't assign — and the internal
   * navigateToRoute / load pipeline mutates `this._appState`
   * directly.  External callers that try `app.appState = X` now
   * get a TypeScript error.
   */
  @state() private _appState: AppState = { kind: 'idle' };
  get appState(): Readonly<AppState> {
    return this._appState;
  }
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
  /**
   * M3a.6 P-M3a-rail-always-on / P-M3a-stat-chips: the local
   * peer's currently-bound PC character record, loaded
   * asynchronously when the peer-rename pcId binding changes (or
   * is initially set on subscribe).  Cleared when the binding is
   * removed or session leaves.  When non-null, the dice dock can
   * surface stat chips, the player Rail can always show the
   * sheet, and the Aside roster can render harm/stress glyphs.
   */
  @state() boundCharacter: LoadedCharacter | null = null;
  /**
   * Campaign that {@link boundCharacter} belongs to.  Tracked alongside
   * the character so the always-on rail (M3a.6d) renders against the
   * correct campaign even mid-navigation (e.g. when switching
   * campaigns, before the async refresh completes).
   */
  @state() boundCampaign: LoadedCampaign | null = null;
  /** Track which (campaign+pcId) the boundCharacter was loaded for. */
  private boundCharacterFor: string = '';
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
      // M3a.6: track bound-PC for always-on rail + stat chips +
      // roster glyphs.  When the local peer has a pcId binding and
      // a campaign is loaded, lazy-fetch the PC character so the
      // Rail / Dice / Aside renderers have the data.
      this.refreshBoundCharacter();
      // M3a.8 P2-11: follow DM broadcasts.  Non-coord viewer
      // navigates to the broadcast target when its ts advances
      // past what we've already followed.  Skips the DM (no
      // self-bounce) and the initial subscribe (lastFollowed
      // starts at 0; a real broadcast carries a positive ts).
      this.followBroadcast();
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
      this._appState ={ kind: 'idle' };
      return;
    }

    // M3a.4 (P-M3a-route-policy): centralized gating policy.
    // Throws the appropriate error class based on the policy's
    // tag so the existing catch block below converts to error
    // state with the right wording.
    const decision = decideRoute(route, this.sessionView);
    if (decision.kind === 'deny') {
      this._appState = {
        kind: 'error',
        message: decision.message,
        details: decision.details
      };
      return;
    }

    try {
      // Reuse already-loaded campaign if the slug matches.
      let campaign = this.getCurrentCampaign();
      if (!campaign || this.currentCampaignSlugMatches(route.slug) === false) {
        this._appState ={
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
        this._appState ={ kind: 'campaign', campaign };
        // Surface the Resume-previous-session prompt when an autosave
        // exists for this campaign.  The prompt is dismissable and
        // only fires when arriving on the campaign view (not on
        // sub-routes — we don't want to interrupt episode/scene reads).
        this.checkResumePrompt();
        return;
      }

      // Character layer (independent of episode/scene).  The
      // DM-only NPC gate already ran via decideRoute above.
      if (route.kind === 'character') {
        this._appState ={
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
        this._appState ={ kind: 'character', campaign, character };
        return;
      }

      // Scene + episode pre-session gates already ran above.

      // Episode layer
      let episode = this.getCurrentEpisode();
      if (!episode || episode.slug !== route.episode) {
        this._appState ={
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
        this._appState ={ kind: 'episode', campaign, episode };
        return;
      }

      // Scene layer
      this._appState ={
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
      const sceneDoc = await renderMarkdownParagraphs(sceneText);
      this._appState ={
        kind: 'scene',
        campaign,
        episode,
        scene: {
          path: route.scene,
          blocks: sceneDoc.blocks,
          frontmatter: sceneDoc.frontmatter
        }
      };
    } catch (e) {
      if (isAbortError(e)) return;
      if (e instanceof CampaignLoadError || e instanceof CharacterLoadError) {
        this._appState ={
          kind: 'error',
          message: e.message,
          details: e.details
        };
      } else {
        this._appState ={
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
    // M3a.6d (P-M3a-rail-always-on): the Rail slot carries the
    // always-on bound-character sheet (the player's PC, glanceable
    // from any page).  Roster moves into the Aside slot alongside
    // chat + AI panel.  When no PC is bound (DM, unbound player,
    // idle) the Rail slot renders empty — the chrome remains so the
    // 5-slot layout stays consistent.
    return html`
      <quire-shell>
        <quire-topbar slot="topbar">${this.renderSessionBar()}</quire-topbar>
        <quire-rail slot="rail">${this.renderBoundCharacterRail()}</quire-rail>
        <quire-stage slot="stage">${this.renderRevealBanner()}${this.renderBody()}</quire-stage>
        <quire-aside slot="aside">${this.renderRosterPanel()}${this.renderChatPanel()}${this.renderAiPanel()}</quire-aside>
        <quire-dock slot="dock">${this.renderVersionBadge()}</quire-dock>
      </quire-shell>
    `;
  }

  /**
   * M3a.6d (P-M3a-rail-always-on): the always-on rail rendering.
   * Shows the bound PC's sheet on every page (not just the
   * character route).  Driven by `boundCharacter` — populated by
   * `refreshBoundCharacter` whenever the peer's pcId changes.  When
   * absent (no session, unbound peer, DM), renders nothing.
   *
   * The character page (`renderCharacter`) still renders its own
   * <player-rail> in the Stage for the currently-navigated
   * character — that may be a different PC (when reading another
   * player's sheet) or an NPC (DM-only).  The rail-in-slot is
   * always YOUR sheet; the rail-in-stage is whatever you opened.
   */
  private renderBoundCharacterRail(): TemplateResult | typeof nothing {
    const bound = this.boundCharacter;
    const campaign = this.boundCampaign;
    if (!bound || !campaign) return nothing;
    const slug = this.slugFor(campaign);
    const r = this.effectiveCharacter(bound);
    const editable = this.sessionView?.status === 'active';
    const claim = this.deriveClaimState(bound);
    return html`
      <player-rail
        .character=${bound}
        .effective=${r}
        .campaignName=${campaign.base.manifest.name}
        .campaignSlug=${slug}
        .editable=${editable}
        .claimState=${claim.state}
        .claimedBy=${claim.claimedBy}
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
        .onToggleClaim=${() => this.toggleClaimCharacter(bound)}
      ></player-rail>
    `;
  }

  /**
   * Roster of who's in the session.  DM and players both see the
   * full list with display names + character/status strings.
   * Helps roleplay continuity ("wait, who plays Yui?").  Toggleable
   * so the bar doesn't dominate the screen when not needed.
   */
  /**
   * Roster panel delegated to <player-aside> region (M2.5, P1-3).
   * @state fields (showRoster, renameEditing, renameDraft) stay on
   * QuireApp; the component receives them as @property and emits
   * callback events to mutate them.  beginRename / submitRename
   * stay as private methods invoked by the callback handlers.
   */
  private renderRosterPanel(): TemplateResult {
    return html`
      <player-aside
        .sessionView=${this.sessionView}
        .localIsCoordinator=${this.isCoordinator()}
        .localKindsCount=${KNOWN_EVENT_KINDS.size}
        .showRoster=${this.showRoster}
        .renameEditing=${this.renameEditing}
        .renameDraft=${this.renameDraft}
        .onToggleRoster=${() => {
          this.showRoster = !this.showRoster;
        }}
        .onBeginRename=${() => this.beginRename()}
        .onCancelRename=${() => {
          this.renameEditing = false;
        }}
        .onSubmitRename=${() => this.submitRename()}
        .onRenameDraftChange=${(d: { name: string; character: string }) => {
          this.renameDraft = d;
        }}
        .onKickPeer=${(peerId: string, name: string) =>
          this.kickPeer(peerId, name)}
      ></player-aside>
    `;
  }

  kickPeer(peerId: string, name: string): void {
    if (!this.session) return;
    if (!window.confirm(`Remove ${name} from the roster?`)) return;
    this.session.kickPeer(peerId);
  }

  private beginRename(): void {
    const v = this.sessionView;
    if (!v?.peerId) return;
    // M3a.1 — reading own peer record (player-visible field).
    const self = v.filteredShared.peers[v.peerId];
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

  /**
   * AI panel delegated to <ai-panel> region (M3a.5, P-M3a-ai-panel-region).
   * AiKeyStore state still lives on QuireApp via the getters added
   * in M1.7a; the region receives them as props.  The provider /
   * key / model / system-prompt setters delegate to AiKeyStore via
   * the existing setXxx methods.  submitAiPrompt + cancelAiPrompt
   * + shareAiResponseToChat stay as QuireApp methods.
   *
   * Pre-rendered response HTML: renderMarkdown(this.aiResponse) is
   * sanitized here so the region stays sanitize-pipeline-agnostic.
   */
  private renderAiPanel(): TemplateResult {
    if (!this.showAiPanel()) return html``;
    const responseHtml = this.aiResponse
      ? renderMarkdown(this.aiResponse)
      : null;
    return html`
      <ai-panel
        .visible=${true}
        .provider=${this.aiProvider}
        .apiKey=${this.aiApiKey}
        .apiKeys=${this.aiApiKeys}
        .models=${this.aiModels}
        .systemPrompt=${this.aiSystemPrompt}
        .showSettings=${this.aiShowSettings}
        .promptDraft=${this.aiPromptDraft}
        .loading=${this.aiLoading}
        .error=${this.aiError}
        .responseHtml=${responseHtml}
        .inSession=${this.sessionView?.status === 'active'}
        .onSetProvider=${(p: AiProvider) => this.setAiProvider(p)}
        .onSetApiKey=${(k: string) => this.setAiApiKey(k)}
        .onSetModel=${(m: string) => this.setAiModel(m)}
        .onSetSystemPrompt=${(t: string) => this.setAiSystemPrompt(t)}
        .onToggleSettings=${() => {
          this.aiShowSettings = !this.aiShowSettings;
        }}
        .onPromptDraftChange=${(t: string) => {
          this.aiPromptDraft = t;
        }}
        .onSubmit=${(p: string) => void this.submitAiPrompt(p)}
        .onCancel=${() => this.cancelAiPrompt()}
        .onShareToChat=${() => this.shareAiResponseToChat()}
      ></ai-panel>
    `;
  }

  private renderRevealBanner(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return html``;
    // M3a.1 — player-visible renderer reads filteredShared.
    const list = v.filteredShared.revealedScenes;
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

  /**
   * Render a scene page.  Delegates the scene prose + breadcrumb to
   * <scene-stage> (M2.4, P1-2).  M3a.6c adds the scene-strip
   * frontmatter pass-through (location · mood · expectedDuration ·
   * presentNpcs).  reveal-control still renders inline in the
   * header via headerExtras.
   */
  private renderScene(
    campaign: LoadedCampaign,
    episode: LoadedEpisode,
    scene: {
      path: string;
      blocks: MarkdownBlock[];
      frontmatter: Record<string, unknown>;
    }
  ): TemplateResult {
    const slug = this.slugFor(campaign);
    // M3a.7 P2-2: derive per-scene reveal mask + coord status.  The
    // full scene path used as the reveal key is the same one
    // emitted by revealCurrentScene (episodes/<slug>/<scenePath>).
    const fullScenePath = `episodes/${episode.slug}/${scene.path}`;
    const v = this.sessionView;
    const isCoord = this.isCoordinator();
    const revealedBlocks =
      v?.status === 'active'
        ? v.filteredShared.revealedParagraphs[fullScenePath] ?? new Set<string>()
        : new Set<string>();
    const sceneFullyRevealed =
      v?.status === 'active'
        ? v.filteredShared.revealedScenes.includes(fullScenePath)
        : true; // out of session: render everything for offline browsing
    return html`
      <scene-stage
        .campaignName=${campaign.base.manifest.name}
        .campaignSlug=${slug}
        .episodeName=${episode.manifest.name}
        .episodeSlug=${episode.slug}
        .scenePath=${scene.path}
        .sceneBlocks=${scene.blocks}
        .revealedBlocks=${revealedBlocks}
        .sceneFullyRevealed=${sceneFullyRevealed}
        .isCoordinator=${isCoord}
        .sceneFrontmatter=${scene.frontmatter}
        .onNavigate=${(e: Event, route: AppRoute) =>
          this.navigate(e, route)}
        .onToggleBlock=${(blockHash: string) =>
          this.toggleBlockReveal(fullScenePath, blockHash)}
        .onBroadcast=${() => this.broadcastCurrentView()}
        .headerExtras=${this.renderRevealControl(episode.slug, scene.path)}
      ></scene-stage>
      ${this.renderCharacterMenus(
        slug,
        campaign.base.manifest.characters
      )}
      ${this.renderRollPanel()}
    `;
  }

  /**
   * M3a.7 P2-2: emit a scene-reveal-paragraph or
   * scene-unreveal-paragraph event based on the block's current
   * reveal state.  No-op when offline / not coordinator — the
   * materializer would reject the event anyway, but skipping the
   * round-trip keeps the bus quiet.
   */
  toggleBlockReveal(fullScenePath: string, blockHash: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) {
      return false;
    }
    const set = v.shared.revealedParagraphs[fullScenePath];
    const revealed = set?.has(blockHash) ?? false;
    this.session.append(
      revealed ? 'scene-unreveal-paragraph' : 'scene-reveal-paragraph',
      { v: 1, scenePath: fullScenePath, blockHash }
    );
    return true;
  }

  private renderRevealControl(
    episodeSlug: string,
    scenePath: string
  ): TemplateResult {
    if (!this.sessionView || this.sessionView.status !== 'active')
      return html``;
    const full = QuireApp.scenePathFor(episodeSlug, scenePath);
    // M3a.1 — player-visible reveal-state badge (DM also reads
    // this; revealedScenes is in player-visible vocabulary).
    const already =
      this.sessionView.filteredShared.revealedScenes.includes(full);
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

  /**
   * Render the session bar via <session-bar> region (M3a.3).
   * Trailing reclaim-confirmation + resume-prompt modals render
   * as siblings since they're separate UI overlays.
   */
  private renderSessionBar(): TemplateResult {
    const v = this.sessionView;
    if (!v) return html``;
    const brokerCfg = brokerConfigFromUrl();
    const brokerBadge: TemplateResult | typeof nothing = brokerCfg?.nonDefault
      ? html`<span
          class="broker-badge"
          title="Custom PeerJS broker configured via URL params (peerHost=${brokerCfg.host ??
          ''}).  Disable by removing the peer* query params."
          >custom broker</span
        >`
      : nothing;
    return html`
      <session-bar
        .sessionView=${v}
        .displayNameDraft=${this.displayNameDraft}
        .joinCodeDraft=${this.joinCodeDraft}
        .inviteCopied=${this.inviteCopied}
        .saveStatus=${this.saveStatus}
        .loadStatus=${this.loadStatus}
        .brokerBadge=${brokerBadge}
        .reclaimAffordance=${this.renderReclaimAffordance()}
        .displayNameForPeer=${(pid: string) => this.displayNameFor(pid)}
        .onDisplayNameChange=${(v: string) => {
          this.displayNameDraft = v;
        }}
        .onJoinCodeChange=${(v: string) => {
          this.joinCodeDraft = v;
        }}
        .onHost=${() => this.startHosting()}
        .onJoin=${() => this.joinSession()}
        .onLeave=${() => this.leaveSession()}
        .onCopyInvite=${() => this.copyInviteLink()}
        .onRegenerateCode=${() => this.regeneratePairingCode()}
        .onSave=${() => this.saveToFile()}
        .onLoad=${(f: File) => this.loadFromFile(f)}
      ></session-bar>
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
    // M3a.1 — player-visible affordance (only non-DM peers see it).
    if (v.filteredShared.coordinator === v.peerId) return html``;
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

  /**
   * Chat panel delegated to <chat-panel> region (M2.7, P1-6).
   * Pre-formats entries (peerId → displayName) so the region
   * component stays data-only.  submitChat / chatDraft / chatError
   * state stays on QuireApp; callbacks bridge the input UI back
   * into the @state.
   */
  private renderChatPanel(): TemplateResult {
    const v = this.sessionView;
    const active = v?.status === 'active';
    const entries = active
      ? v!.shared.chat.map((m, i) => ({
          key: `${m.ts}-${m.peerId}-${i}`,
          author: this.displayNameFor(m.peerId),
          text: m.text
        }))
      : [];
    return html`
      <chat-panel
        .active=${active}
        .chatDraft=${this.chatDraft}
        .chatError=${this.chatError}
        .entries=${entries}
        .onDraftChange=${(v: string) => {
          this.chatDraft = v;
          this.chatError = null;
        }}
        .onSubmit=${(v: string) => this.submitChat(v)}
      ></chat-panel>
    `;
  }

  /**
   * Dice panel delegated to <dice-dock> region (M2.6, P1-4).  This
   * wrapper computes the merged history (shared event-log rolls when
   * in a session; local mirror when solo) so the region component
   * doesn't need access to displayNameFor or the sessionView.
   *
   * In an active session, the shared event log is the source of
   * truth for "who rolled what" — every peer sees every roll with
   * attribution.  In solo mode the local mirror is the only source.
   * We render the union to avoid showing duplicates when our own
   * dice-roll event has both been appended locally AND echoed back
   * through the materializer.
   */
  private renderRollPanel(): TemplateResult {
    const inSession = this.sessionView?.status === 'active';
    // M3a.1 — player-visible renderer reads filteredShared.
    const shared = inSession ? this.sessionView!.filteredShared.diceRolls : [];
    const entries: Array<{
      key: string;
      label: string;
      tierClass: string;
    }> = inSession
      ? shared
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
    // M2.8: raise-hand affordance.  Available to non-DM peers in an
    // active session (DMs reveal scenes; players raise hands).  DM
    // peers can still see the raised-hand glyph on the roster.
    const v = this.sessionView;
    const handAvailable =
      v?.status === 'active' && !!v.peerId && !this.isCoordinator();
    const handRaised =
      v?.status === 'active' && !!v.peerId && v.filteredShared.raisedHands.has(v.peerId);
    // M3a.6: stat chips for the bound PC.  Compute effective
    // stats by applying pcEdits.  Returns null when no PC is
    // bound, hiding the chips.
    const stats = this.computeBoundStats();
    return html`
      <dice-dock
        .rollDraft=${this.rollDraft}
        .rollError=${this.rollError}
        .entries=${entries}
        .handAvailable=${handAvailable}
        .handRaised=${handRaised}
        .stats=${stats}
        .onRollDraftChange=${(v: string) => {
          this.rollDraft = v;
        }}
        .onSubmitRoll=${(v: string) => this.submitRoll(v)}
        .onToggleHand=${() => this.toggleRaisedHand()}
      ></dice-dock>
    `;
  }

  /**
   * Effective stats (after pcEdits overlay) for the local peer's
   * bound PC.  Returns null when no PC is bound or the bound PC
   * lacks stats (legacy / minimal sheets — see
   * schemas.md "What goes in a record" — only name + version are
   * required).
   */
  private computeBoundStats(): {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  } | null {
    const c = this.boundCharacter;
    if (!c) return null;
    const eff = this.effectiveCharacter(c);
    const s = eff.stats;
    if (!s) return null;
    return {
      str: s.str ?? 0,
      dex: s.dex ?? 0,
      con: s.con ?? 0,
      int: s.int ?? 0,
      wis: s.wis ?? 0,
      cha: s.cha ?? 0
    };
  }

  /**
   * Toggle the local peer's raised-hand state.  Wraps
   * SessionController.toggleHand so e2e tests + harnesses can
   * programmatically invoke via `app.toggleRaisedHand()`.
   */
  toggleRaisedHand(): void {
    this.session?.toggleHand();
  }

  /**
   * M3a.8 P2-11: track the most recent broadcast we've already
   * followed.  Initialized to 0 so the first real broadcast
   * (positive ts) is always honored; subsequent broadcasts only
   * trigger navigation when strictly newer.  Per-instance state
   * (not persisted) — a reload resets it so an old broadcast
   * doesn't ambush the player on rejoin.
   */
  private lastFollowedBroadcastTs: number = 0;

  /**
   * M3a.8 P2-11: emit a broadcast-view event for the local DM's
   * current route.  No-op when offline / not coordinator.  The
   * payload's stagePath is the route's search-string so the
   * receiver can round-trip via parseRoute.
   */
  broadcastCurrentView(): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const route = this.routeForAppState();
    if (!route) return false;
    this.session.append('broadcast-view', {
      v: 1,
      stagePath: routeToSearch(route)
    });
    return true;
  }

  /**
   * Subscribe-side: navigate to the DM's broadcast target when a
   * newer broadcast arrives.  Skipped for the DM (who is the
   * author).  Pure handler — caller-paced via session subscribe.
   */
  private followBroadcast(): void {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return;
    const bv = v.filteredShared.broadcastView;
    if (!bv) return;
    if (bv.ts <= this.lastFollowedBroadcastTs) return;
    this.lastFollowedBroadcastTs = bv.ts;
    if (this.isCoordinator()) return;
    const route = parseRoute(bv.stagePath);
    if (route.kind === 'home') return;
    void this.navigateToRoute(route);
  }

  /**
   * M3a.8 P2-11: derive the AppRoute that corresponds to the
   * current AppState, for broadcasting purposes.  Returns null
   * when the local view has no broadcastable route (idle, error,
   * mid-load).
   */
  private routeForAppState(): AppRoute | null {
    const s = this.appState;
    switch (s.kind) {
      case 'campaign':
        return { kind: 'campaign', slug: this.slugFor(s.campaign) };
      case 'episode':
        return {
          kind: 'episode',
          slug: this.slugFor(s.campaign),
          episode: s.episode.slug
        };
      case 'scene':
        return {
          kind: 'scene',
          slug: this.slugFor(s.campaign),
          episode: s.episode.slug,
          scene: s.scene.path
        };
      case 'character':
        return {
          kind: 'character',
          slug: this.slugFor(s.campaign),
          characterKind: s.character.kind,
          characterId: s.character.id
        };
      default:
        return null;
    }
  }

  /**
   * M3a.6: refresh the bound PC character.  Called from the
   * session subscribe handler whenever sessionView changes.
   * Loads the PC asynchronously when the (campaign, pcId) tuple
   * changes; clears boundCharacter when the binding is removed.
   * Safe to call repeatedly — short-circuits when nothing changed.
   */
  private refreshBoundCharacter(): void {
    const v = this.sessionView;
    const campaign = this.getCurrentCampaign();
    const myPcId =
      v?.status === 'active' && v.peerId
        ? v.filteredShared.peers[v.peerId]?.pcId
        : undefined;
    const slug = campaign ? this.slugFor(campaign) : '';
    const key = myPcId ? `${slug}|${myPcId}` : '';
    if (key === this.boundCharacterFor) return;
    this.boundCharacterFor = key;
    if (!myPcId || !campaign) {
      this.boundCharacter = null;
      this.boundCampaign = null;
      return;
    }
    // Fire async load.  Failure clears the cache silently — the
    // binding is correct, the renderer just shows the unbound
    // state until the file resolves.
    void loadCharacter(campaign.base.source, 'pc', myPcId)
      .then((character) => {
        // Re-check the binding hasn't changed since we kicked off
        // the fetch.
        if (this.boundCharacterFor === key) {
          this.boundCharacter = character;
          this.boundCampaign = campaign;
        }
      })
      .catch(() => {
        if (this.boundCharacterFor === key) {
          this.boundCharacter = null;
          this.boundCampaign = null;
        }
      });
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
    // M3a.1 — player-visible (rendered via <player-rail>); reads
    // filtered.  pcEdits is preserved by filterForViewer (player-
    // visible field) so behavior is unchanged.
    const overrides =
      character.kind === 'pc'
        ? this.sessionView.filteredShared.pcEdits[character.id]
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
    // M3a.1 — used by player-visible chat + dice attribution.
    const peer = this.sessionView?.filteredShared.peers[peerId];
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

    // M3a.2 P-M3a-pc-binding: derive claim state.
    const claim = this.deriveClaimState(character);

    return html`
      ${this.renderDmCharacterAffordances(character)}
      <player-rail
        .character=${character}
        .effective=${r}
        .campaignName=${campaign.base.manifest.name}
        .campaignSlug=${slug}
        .editable=${editable}
        .claimState=${claim.state}
        .claimedBy=${claim.claimedBy}
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
        .onToggleClaim=${() => this.toggleClaimCharacter(character)}
      ></player-rail>
      ${this.renderRollPanel()}
    `;
  }

  /**
   * M3a.8 (P2-4 + P2-5): DM-only affordances on the character
   * page — pin/unpin (NPC only) and thread-debt-set (PC only).
   * Renders nothing for non-DM viewers.  M3a.9's `<dm-aside>` will
   * move the pinned-NPC list out of this in-page strip; the
   * action buttons themselves stay where the DM lives in the
   * page they're inspecting.
   */
  private renderDmCharacterAffordances(
    character: LoadedCharacter
  ): TemplateResult | typeof nothing {
    if (!this.isCoordinator()) return nothing;
    if (character.kind === 'npc') {
      const pinned =
        this.sessionView?.status === 'active' &&
        this.sessionView.shared.pinnedNpcs.includes(character.id);
      return html`
        <section class="card dm-affordances">
          <button
            type="button"
            class="dm-pin-btn"
            @click=${() => this.toggleNpcPin(character.id)}
          >
            ${pinned ? '📌 Unpin from DM aside' : '📌 Pin to DM aside'}
          </button>
        </section>
      `;
    }
    // character.kind === 'pc' → thread-debt selector.
    const v = this.sessionView;
    const current =
      v?.status === 'active' ? v.shared.threadDebt[character.id] ?? '' : '';
    const levels: Array<{ key: '' | ThreadDebtLevel; label: string }> = [
      { key: '', label: '— none —' },
      { key: 'quiet', label: 'quiet' },
      { key: 'noticed', label: 'noticed' },
      { key: 'watched', label: 'watched' },
      { key: 'pushing-back', label: 'pushing back' },
      { key: 'hunted', label: 'hunted' }
    ];
    return html`
      <section class="card dm-affordances">
        <label class="dm-thread-debt">
          <span>Thread debt:</span>
          <select
            @change=${(e: Event) =>
              this.setThreadDebt(
                character.id,
                (e.target as HTMLSelectElement).value as ThreadDebtLevel | ''
              )}
          >
            ${levels.map(
              (l) => html`
                <option value=${l.key} ?selected=${l.key === current}>
                  ${l.label}
                </option>
              `
            )}
          </select>
        </label>
      </section>
    `;
  }

  /**
   * M3a.8 P2-4: emit npc-pin or npc-unpin based on current state.
   * Coord-only; no-op outside an active session.
   */
  toggleNpcPin(npcId: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const pinned = v.shared.pinnedNpcs.includes(npcId);
    this.session.append(pinned ? 'npc-unpin' : 'npc-pin', { v: 1, npcId });
    return true;
  }

  /**
   * M3a.8 P2-5: emit thread-debt-set for a PC.  Empty-string level
   * clears the entry.  Coord-only.
   */
  setThreadDebt(pcId: string, level: ThreadDebtLevel | ''): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    this.session.append('thread-debt-set', { v: 1, pcId, level });
    return true;
  }

  /**
   * M3a.2 P-M3a-pc-binding: compute the displayed claim state for
   * the currently-viewed character.  Used by <player-rail> to pick
   * the right affordance (unclaimed → "Claim"; mine → "Release";
   * taken → "Take over").
   */
  private deriveClaimState(
    character: LoadedCharacter
  ): { state: 'unclaimable' | 'unclaimed' | 'mine' | 'taken'; claimedBy: string } {
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !v.peerId) {
      return { state: 'unclaimable', claimedBy: '' };
    }
    if (character.kind !== 'pc') {
      return { state: 'unclaimable', claimedBy: '' };
    }
    // Check who (if anyone) has this PC bound.  Filtered view is
    // safe — peers map is player-visible.
    let claimant: { peerId: string; name?: string } | null = null;
    for (const p of Object.values(v.filteredShared.peers)) {
      if (p.leftAt !== undefined) continue;
      if (p.pcId === character.id) {
        claimant = p;
        break;
      }
    }
    if (!claimant) return { state: 'unclaimed', claimedBy: '' };
    if (claimant.peerId === v.peerId) {
      return { state: 'mine', claimedBy: '' };
    }
    return {
      state: 'taken',
      claimedBy: claimant.name ?? '(unnamed)'
    };
  }

  /**
   * M3a.2: click handler for the claim affordance.  Emits a
   * peer-rename event with the relevant pcId (clear-string when
   * releasing, target pc id otherwise).  No window.confirm() for
   * "take over" — the conflict-resolution UX (warnings, peer
   * notifications) is M3a.6 polish.
   */
  toggleClaimCharacter(character: LoadedCharacter): void {
    if (!this.session) return;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !v.peerId) return;
    const me = v.filteredShared.peers[v.peerId];
    const myCurrentPcId = me?.pcId;
    if (myCurrentPcId === character.id) {
      // Release.
      this.session.rename({ pcId: '' });
    } else {
      // Claim or take-over.
      this.session.rename({ pcId: character.id });
    }
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

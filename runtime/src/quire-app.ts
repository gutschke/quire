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
import './ui/regions/dm-scratch';
import './ui/regions/dm-aside';
import './ui/regions/seat-strip';
// CC-3 / CC-5 / CC-12: chargen regions are dynamically imported
// (see `loadChargenRegion` / `loadInviteManagerRegion`).  They live
// outside the main bundle to keep the play-time path lean; users in
// a regular play session don't pay the JS cost of chargen UI.
import {
  encodeInviteToken,
  decodeInviteToken,
  campaignFingerprint,
  InviteTokenError
} from './invite-token';
import {
  packChargen,
  stringifyChargenPack,
  suggestedPackFilename,
  ChargenPackError
} from './chargen-pack';
import {
  loadChargenState,
  saveChargenState
} from './chargen-persistence';
import './ui/regions/dm-rail';
import type { DmRailEpisode } from './ui/regions/dm-rail';
import './ui/regions/dice-dock';

/**
 * M3D-4: doubles halo flag derived from a 2d6 result.  See
 * `<dice-dock>` for the matching CSS classes.
 */
type DoublesFlag = 'snake-eyes' | 'box-cars' | null;
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
import { AnthropicProviderError } from './ai/providers/anthropic';
import { GeminiProviderError } from './ai/providers/gemini';
import { AiBroker, AiBrokerError, type AiProvider as AiProviderImpl } from './ai/broker';
import {
  buildCampaignContext,
  wrapCampaignContext
} from './ai/campaign-context';
import { AiWriteController } from './controllers/ai-write-controller';
import type { AiWriteBatchView } from './ui/regions/ai-panel';
import { anthropicProvider } from './ai/providers/anthropic';
import { geminiProvider } from './ai/providers/gemini';
import type { AiResponse } from './ai/schema';
import type { ContextScope } from './ai/context';
import {
  promptHashFor,
  responseHashFor,
  chainHead
} from './ai/audit';
import { DEFAULT_BUDGET_CEILING, computeUsage } from './ai/budget';
import type { DualCardResponse } from './ui/regions/ai-panel';
import {
  serializeSession,
  serializeSessionForViewer,
  stringifySave,
  parseSaveDocument,
  type SaveDocument,
  type LoadResult
} from './persistence';

// Autosave constants live in the AutosaveController (P0-9).

// AI provider / key / model / system-prompt state lives in
// src/controllers/ai-key-store.ts (P0-10).  Re-export the public types
// for callers that import them from quire-app.
export type { AiProvider } from './controllers/ai-key-store';
import {
  AiKeyStore,
  type AiProvider
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
  CryptoUnavailableError,
  type MarkdownBlock,
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
  /**
   * CC-5 (M4 char-creation): the chargen route's loaded state.
   * `slot` is 0 + `tokenError` is set when the token failed to
   * decode; the region renders the friendly error banner.
   */
  | {
      kind: 'character-creation';
      campaign: LoadedCampaign;
      slot: number;
      tokenError: '' | 'malformed' | 'expired' | 'campaign-mismatch' | 'invalid-slot';
    }
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

  /**
   * CC-5: chosen-path state for the chargen region.  Local-only
   * today; IndexedDB persistence lands in CC-4 + CC-11.  Empty
   * string means "not chosen yet" (step 3 picker is unselected).
   */
  @state() private chargenChosenPath: 'qa' | 'free-write' | 'pre-gen' | '' =
    '';

  /**
   * CC-6: captured Q&A answers keyed by question id.  Local-only
   * today; IndexedDB persistence + per-PC SaveDocument variant land
   * in CC-4 + CC-11.  Empty object means "no answers yet."
   */
  @state() private chargenAnswers: Record<string, string> = {};

  /**
   * CC-10: transient feedback on the "Pack my character" download.
   * The chargen region surfaces "Packed!" / "Couldn't pack" copy
   * keyed on this value; auto-clears after a few seconds via
   * setTimeout.
   */
  @state() private chargenPackFeedback: '' | 'packed' | 'pack-failed' = '';

  /**
   * Code-split: track which chargen surfaces have been dynamically
   * loaded so subsequent invocations skip the import().
   *
   * Both `<character-creation>` (player-side chargen flow) and
   * `<invite-manager>` (DM-side invite generator) live outside the
   * main bundle.  A user in a regular play session never imports
   * them; a DM only imports invite-manager once they're coord; a
   * player only imports character-creation once they hit a
   * `?invite=` URL.  Saves ~3-4 KB gzip from the play-time bundle.
   */
  private chargenRegionLoaded: Promise<void> | null = null;
  private inviteManagerLoaded: Promise<void> | null = null;
  /**
   * `<invite-manager>` is rendered lazily — the render-time helper
   * gates on this flag so we don't emit an inert custom-element tag
   * before the module has been imported and the class registered.
   * Flipped to true inside the import resolver in
   * `loadInviteManagerRegion`.
   */
  @state() private inviteManagerDefined: boolean = false;

  /**
   * Idempotently dynamic-import `<character-creation>`.  Returns the
   * in-flight promise so concurrent callers share one fetch.
   */
  private loadChargenRegion(): Promise<void> {
    if (this.chargenRegionLoaded) return this.chargenRegionLoaded;
    this.chargenRegionLoaded = import('./ui/regions/character-creation').then(
      () => undefined
    );
    return this.chargenRegionLoaded;
  }

  /**
   * Idempotently dynamic-import `<invite-manager>`.  Returns the
   * in-flight promise so concurrent callers share one fetch.  Sets
   * `inviteManagerDefined` on resolution so `renderInviteManagerLazy`
   * can swap in the real element.
   */
  private loadInviteManagerRegion(): Promise<void> {
    if (this.inviteManagerLoaded) return this.inviteManagerLoaded;
    this.inviteManagerLoaded = import('./ui/regions/invite-manager').then(
      () => {
        this.inviteManagerDefined = true;
      }
    );
    return this.inviteManagerLoaded;
  }
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
  /**
   * M3c.4: AI-write batch controller.  Stages the AI's proposed
   * state updates after broker.complete returns; the DM accepts
   * via the strip in ai-panel.  See ai-write-controller.ts.
   */
  private aiWrites = new AiWriteController(this, {
    getSessionView: () => this.sessionView ?? undefined,
    getSession: () => this.session,
    getBoundPcId: () => {
      const v = this.sessionView;
      if (!v || v.status !== 'active' || !v.peerId) return undefined;
      const me = v.filteredShared.peers[v.peerId];
      return me?.pcId;
    },
    getReviewEveryUpdate: () => this.aiReviewEveryUpdate
  });
  /**
   * M3c followup (Adversarial A8): "Review every state update
   * individually" — first-session-trust mode where every AI-
   * proposed update faces an explicit-accept click, not just the
   * spec'd hard-gated transitions.  Persisted via AiKeyStore.
   */
  @state() aiReviewEveryUpdate: boolean = false;
  @state() aiPromptDraft: string = '';
  @state() aiResponse: string | null = null;
  /**
   * M3b.5: dual-card response from the broker.  When set, the
   * panel renders two cards (safe + DM-only) instead of the
   * legacy single block.  Sources land here too, plus the
   * responseId used for ai-accept / ai-reject events.
   */
  @state() aiResponseStructured: AiResponse | null = null;
  /** M3b.5: scope for the NEXT prompt.  Resets to 'public' on submit. */
  @state() aiScope: ContextScope = 'public';
  /**
   * M3b gate fix: track the most recent verdict the DM cast so the
   * ai-panel can render visible feedback ("✓ Accepted" / "✗ Rejected")
   * instead of leaving the buttons hot after click (silent-success
   * was reading as broken-button at the table).
   */
  @state() aiVerdictResponseId: string = '';
  @state() aiVerdictKind: '' | 'accept' | 'reject' = '';
  @state() aiLoading: boolean = false;
  @state() aiError: string | null = null;
  @state() aiShowSettings: boolean = false;

  /**
   * M3b.2: provider impls registered with the broker.  Production
   * uses real fetch-based clients; tests stub by assigning to this
   * field directly (it's intentionally public for that reason).
   */
  aiProviders: Record<AiProvider, AiProviderImpl> = {
    claude: anthropicProvider,
    gemini: geminiProvider
  };
  /** M3b.4: per-DM session-wide token budget. */
  @state() aiBudgetCeiling: number = DEFAULT_BUDGET_CEILING;
  private aiAbort: AbortController | null = null;

  // Tests can replace this before connectedCallback runs to swap in
  // an in-memory transport factory.  Production reads broker config
  // from URL params; default is the PeerJS cloud broker.
  sessionFactory: TransportFactory = createPeerjsFactoryFromUrl();
  private session: SessionController | null = null;
  private unsubscribeSession: (() => void) | null = null;

  private abortController?: AbortController;
  /**
   * DM keyboard map (FU-1 from M3a.10 gate).  Quiet at the table:
   *
   *   '           — focus DM scratch input
   *   j / k       — walk to next / previous scene-block pip
   *   Cmd+Enter   — reveal the next unrevealed block (paced reveal)
   *   b           — broadcast current view to players
   *
   * Plain Space on a focused pip toggles it (native button behavior).
   * All hotkeys are coord-only and skip when focus is in a text
   * input / textarea / select / contenteditable region so typed
   * characters land normally.
   */
  private readonly hotkeyHandler = (e: KeyboardEvent): void => {
    if (!this.isCoordinator()) return;
    if (this.hotkeyTargetIsEditable(e)) return;
    if (e.key === "'") {
      e.preventDefault();
      this.focusDmScratch();
      return;
    }
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      this.walkScenePip(+1);
      return;
    }
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      this.walkScenePip(-1);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      this.revealNextBlock();
      return;
    }
    // M3c followup (TTRPG F2): plain Enter applies all pending AI
    // state-updates (Apply-All shortcut).  Only fires when a batch
    // is pending and not already in the undo window — avoids
    // re-applying on every Enter press after the DM has acted.
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (this.aiWrites.hasUnappliedPending) {
        e.preventDefault();
        this.aiWrites.applyAll();
        return;
      }
    }
    if (e.key === 'b' || e.key === 'B') {
      // Don't fight Cmd+B / Ctrl+B (bold / browser shortcuts).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      this.broadcastCurrentView();
      return;
    }
  };

  /**
   * The keydown handler is attached to `window`, so events that
   * originate inside a shadow root arrive RETARGETED to the shadow
   * host — `event.target.tagName` reads as the host element
   * (quire-app), not the focused INPUT/TEXTAREA inside.  Without
   * walking `composedPath()`, a DM typing `j`/`k`/`b`/`'` into the
   * AI prompt, chat input, scratch column, or any other in-shadow
   * editable would have those keystrokes swallowed by the hotkey
   * handler.  We probe BOTH the composedPath and the live
   * `shadowRoot.activeElement` so the editable check works
   * regardless of how the event was fired.
   */
  private hotkeyTargetIsEditable(event: KeyboardEvent): boolean {
    const candidates: Element[] = [];
    // composedPath() is the most accurate — gives every element
    // from the actual focused leaf up through every shadow host
    // to window.
    for (const node of event.composedPath()) {
      if (node instanceof Element) candidates.push(node);
    }
    // Also consider the actively-focused element, in case the
    // keystroke was synthesized (programmatic dispatch) without a
    // composedPath that reaches the leaf.
    let active: Element | null = document.activeElement;
    while (active) {
      candidates.push(active);
      const sr = (active as HTMLElement & { shadowRoot?: ShadowRoot | null })
        .shadowRoot;
      active = sr?.activeElement ?? null;
    }
    for (const el of candidates) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
      }
      const ce = el.getAttribute?.('contenteditable');
      if (ce === '' || ce === 'true') return true;
    }
    return false;
  }

  private focusDmScratch(): void {
    const scratch = this.renderRoot.querySelector<HTMLElement>('dm-scratch');
    if (!scratch) return;
    (scratch as unknown as { focusInput: () => void }).focusInput();
  }

  /**
   * j/k navigation: focus the next or previous scene-block pip in
   * the current Stage.  Wraps around at the edges so the DM can
   * cycle continuously without lifting hands from the keyboard.
   *
   * Queries via `renderRoot` (= shadow root for QuireApp) because
   * the regions live inside the component's shadow tree; a plain
   * `this.querySelectorAll` searches only the light-DOM children.
   */
  private walkScenePip(delta: 1 | -1): void {
    const pips = Array.from(
      this.renderRoot.querySelectorAll<HTMLButtonElement>(
        '.scene-block-pip:not(.scene-block-pip-lapsed)'
      )
    );
    if (pips.length === 0) return;
    // `document.activeElement` returns the shadow host when focus is
    // inside the shadow tree; use `this.shadowRoot.activeElement` for
    // the actual focused descendant.
    const active =
      (this.shadowRoot?.activeElement as HTMLElement | null) ??
      (document.activeElement as HTMLElement | null);
    const currentIdx = active ? pips.indexOf(active as HTMLButtonElement) : -1;
    const nextIdx =
      currentIdx < 0
        ? delta > 0
          ? 0
          : pips.length - 1
        : (currentIdx + delta + pips.length) % pips.length;
    pips[nextIdx].focus();
  }

  /**
   * Cmd+Enter: reveal the first unrevealed block in source order.
   * Idempotent — when every block is revealed, this is a no-op.
   * The DM's focus moves to the pip that was just revealed so a
   * subsequent Cmd+Enter walks straight to the next one.
   */
  private revealNextBlock(): void {
    const pips = Array.from(
      this.renderRoot.querySelectorAll<HTMLButtonElement>(
        '.scene-block-pip:not(.scene-block-pip-lapsed)'
      )
    );
    const next = pips.find(
      (p) => p.getAttribute('aria-pressed') !== 'true'
    );
    if (!next) return;
    next.focus();
    next.click();
  }

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
    window.addEventListener('keydown', this.hotkeyHandler);
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
    window.removeEventListener('keydown', this.hotkeyHandler);
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
      // M3D-3 (route-change-fires-leave): if an active session is
      // currently hosted/joined when we SPA-navigate back to home,
      // emit a clean peer-leave + flush autosave + tear down BEFORE
      // returning to idle.  Without this, the prior coord's
      // peer-join + coordinator-claim rehydrate from autosave on a
      // later restore without a matching leftAt → stale-DM-peer
      // visible in the roster on rejoin.  The `beforeunload` path
      // also fires peer-leave, but it's best-effort (the browser may
      // tear down WebRTC before the message lands and before the
      // debounced autosave flushes); the SPA-navigation case is
      // synchronous and reliable.
      if (this.sessionView?.status === 'active') {
        this.announceLeaveAndExit();
      }
      this._appState = { kind: 'idle' };
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

      // CC-3 / CC-5: character-creation route — player visiting
      // an invite link.  Decode the token, validate against the
      // loaded campaign's fingerprint, and stage the chargen
      // region (which renders an error banner when validation
      // fails rather than booting the player back to home).
      if (route.kind === 'character-creation') {
        // Code-split: dynamic-import the chargen region module
        // BEFORE staging the appState so the render that follows
        // finds the custom element already defined.  Without this
        // the first paint shows an inert `<character-creation>`
        // tag until the import lands.
        await this.loadChargenRegion();
        if (signal.aborted || !this.isConnected) return;
        const expectedFp = campaignFingerprint(campaign.base.source);
        try {
          const payload = decodeInviteToken(route.inviteToken, {
            expectedFingerprint: expectedFp
          });
          // CC-11: resume — load any in-progress chargen state
          // for this campaign + slot from localStorage and seed
          // the @state fields.  Per F3 critique, key is slug+slot
          // not token, so token regeneration doesn't orphan data.
          const slug = this.slugFor(campaign);
          const resumed = loadChargenState(slug, payload.slot);
          if (resumed) {
            this.chargenChosenPath = resumed.chosenPath;
            this.chargenAnswers = resumed.answers;
          } else {
            // First visit (or different device): start fresh.
            // This is also the "wrong-device empty state" — no
            // banner needed because the player sees a clean
            // chargen flow.  The Pack-my-character export (CC-10)
            // is the cross-device recovery affordance.
            this.chargenChosenPath = '';
            this.chargenAnswers = {};
          }
          this._appState = {
            kind: 'character-creation',
            campaign,
            slot: payload.slot,
            tokenError: ''
          };
        } catch (e) {
          if (e instanceof InviteTokenError) {
            this._appState = {
              kind: 'character-creation',
              campaign,
              slot: 0,
              tokenError: e.code
            };
          } else {
            // Unexpected: re-throw to fall through to the generic
            // error branch below.
            throw e;
          }
        }
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
      } else if (e instanceof CryptoUnavailableError) {
        // FU-8: insecure context (HTTP / file://) gates Web Crypto.
        // Surface the actionable fix rather than a generic error.
        this._appState = {
          kind: 'error',
          message: 'Browser security context too weak.',
          details: e.message
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
    // M3a.9: DM gets cockpit regions (Rail = scene navigator; Aside
    // gains pinned-NPC + thread-debt summary above the shared
    // roster/chat/AI cluster).  Player view is unchanged.
    const dmRail = this.renderDmRail();
    const dmAside = this.renderDmAside();
    return html`
      <quire-shell>
        <quire-topbar slot="topbar">${this.renderSessionBar()}</quire-topbar>
        <quire-rail slot="rail">${dmRail ? dmRail : this.renderBoundCharacterRail()}</quire-rail>
        <quire-stage slot="stage">${this.renderRevealBanner()}${this.renderBody()}</quire-stage>
        <quire-aside slot="aside">${dmAside}${this.renderRosterPanel()}${this.renderChatPanel()}${this.renderAiPanel()}</quire-aside>
        <quire-dock slot="dock">${this.renderDmScratch()}${this.renderVersionBadge()}</quire-dock>
      </quire-shell>
    `;
  }

  /**
   * M3a.9: render the DM's Rail content.  Returns null when the
   * local peer is not the coordinator so the shell falls back to
   * the player's always-on bound-character rail.
   */
  private renderDmRail(): TemplateResult | null {
    if (!this.isCoordinator()) return null;
    const campaign = this.getCurrentCampaign();
    if (!campaign) return null;
    const slug = this.slugFor(campaign);
    const episodes: DmRailEpisode[] = (
      campaign.base.manifest.episodes ?? []
    ).map((epId) => {
      const loaded =
        this.getCurrentEpisode()?.slug === epId
          ? this.getCurrentEpisode()
          : undefined;
      return {
        slug: epId,
        name: loaded?.manifest.name ?? epId,
        scenes: loaded?.manifest.scenes ?? [],
        dmDocs: loaded?.manifest.dmDocs ?? []
      };
    });
    const ep = this.getCurrentEpisode();
    const sceneState = this.appState;
    const currentScene =
      sceneState.kind === 'scene' ? sceneState.scene.path : '';
    return html`
      <dm-rail
        .campaignSlug=${slug}
        .campaignName=${campaign.base.manifest.name}
        .episodes=${episodes}
        .currentEpisode=${ep?.slug ?? ''}
        .currentScene=${currentScene}
        .onNavigate=${(e: Event, route: AppRoute) => this.navigate(e, route)}
      ></dm-rail>
    `;
  }

  /**
   * M3a.9: render the DM's Aside content.  Returns nothing when
   * the local peer is not the coordinator so the player Aside
   * (roster + chat + AI panel) renders alone.
   */
  private renderDmAside(): TemplateResult | typeof nothing {
    if (!this.isCoordinator()) return nothing;
    const v = this.sessionView;
    if (!v || v.status !== 'active') return nothing;
    const campaign = this.getCurrentCampaign();
    const slug = campaign ? this.slugFor(campaign) : '';
    // FU-3: surface bound-PC peers so the DM can adjust thread-
    // debt inline from the cockpit.  Pulled from filteredShared
    // (no DM-only data needed; pcId binding is player-visible).
    const boundPcs = Object.values(v.filteredShared.peers)
      .filter((p) => p.leftAt === undefined && typeof p.pcId === 'string')
      .map((p) => ({
        pcId: p.pcId as string,
        name: p.name ?? (p.pcId as string),
        peerId: p.peerId
      }));
    return html`
      <dm-aside
        .campaignSlug=${slug}
        .pinnedNpcs=${v.filteredShared.pinnedNpcs}
        .threadDebt=${v.filteredShared.threadDebt}
        .boundPcs=${boundPcs}
        .casterState=${v.filteredShared.casterState}
        .onUnpin=${(npcId: string) => this.toggleNpcPin(npcId)}
        .onSetThreadDebt=${(pcId: string, level: ThreadDebtLevel | '') =>
          this.setThreadDebt(pcId, level)}
        .onResetSpamCounter=${(pcId: string) => this.resetSpamCounter(pcId)}
        .onNavigate=${(e: Event, route: AppRoute) => this.navigate(e, route)}
      ></dm-aside>
      <seat-strip
        .pcSlots=${v.filteredShared.pcSlots}
        .onUnbind=${(slot: number) => this.bindPcSlot(slot, null)}
      ></seat-strip>
      ${this.renderInviteManagerLazy(v.filteredShared.pcSlots)}
    `;
  }

  /**
   * Code-split: render the `<invite-manager>` region only after its
   * module is dynamically loaded.  Triggers the load on first call
   * (fire-and-forget; Lit re-renders once the import resolves and
   * the custom element is defined).  Until then, renders nothing
   * so the DM aside doesn't show a placeholder for an inert tag.
   */
  private renderInviteManagerLazy(
    pcSlots: Record<number, string>
  ): TemplateResult | typeof nothing {
    void this.loadInviteManagerRegion();
    // Lit gracefully renders an unknown custom element as a no-op
    // until the class is defined; once defined, the upgrade swaps
    // in the real element.  But to avoid even the empty-tag flicker
    // (and to keep the DOM clean for screen readers), we hold off
    // rendering until the import has resolved.  `inviteManagerLoaded`
    // is the in-flight promise; we use its existence as a "ready
    // soon" sentinel and re-render once it resolves (via the
    // .then().requestUpdate() in loadInviteManagerRegion below).
    if (!this.inviteManagerDefined) return nothing;
    return html`
      <invite-manager
        .pcSlots=${pcSlots}
        .onGenerate=${(slot: number) => this.generateInviteUrl(slot)}
      ></invite-manager>
    `;
  }

  /**
   * M3c followup (Engine #3 + TTRPG #2): emit a caster-state-set
   * event that zeros the spam counter for a PC, preserving the
   * other fields via the materializer's carry-forward semantic.
   * Coord-only.  No causedByResponseId — this is DM-direct, not
   * AI-proposed, so the hard-gate machinery doesn't apply.
   */
  resetSpamCounter(pcId: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const prior = v.filteredShared.casterState[pcId];
    if (!prior) return false;
    this.session.append('caster-state-set', {
      v: 1,
      pcId,
      ladderState: prior.ladderState,
      reason: prior.reason,
      taxActive: prior.taxActive,
      spamCount: 0
    });
    return true;
  }

  /**
   * M3D-5 / CC-2: bind a `{{pc:N}}` slot to a character id, or pass
   * `null` to clear the binding (renderer falls back to literal
   * `PC<N>`).  Coord-only; non-coords return false silently.
   *
   * Entry point for both the future click-to-bind UI (CC-2 phase 2)
   * and the AI write tool (CC-36 / pc-slot-bind via stateUpdates).
   * Slot range [1, 9] mirrors the `{{pc:N}}` regex in
   * `substitutePcSlots`.
   */
  bindPcSlot(slot: number, pcId: string | null): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) return false;
    this.session.append('pc-slot-bind', { v: 1, slot, pcId });
    return true;
  }

  /**
   * CC-11: debounced save of in-progress chargen state to
   * localStorage.  Called from the chargen region's onPickPath and
   * onAnswerChange callbacks.  Per F3 critique, the key is
   * slug+slot not invite-token UUID — token regeneration doesn't
   * orphan the player's data.
   *
   * Debounce window is shorter than the play-time autosave (300 ms
   * vs 1500 ms) because the chargen flow has fewer state changes
   * per unit time and the player will close the tab without
   * realizing the autosave is debounced; saving aggressively gives
   * a stronger "your work is safe" guarantee.
   */
  private chargenSaveTimer: ReturnType<typeof setTimeout> | null = null;

  private persistChargen(campaign: LoadedCampaign, slot: number): void {
    if (this.chargenSaveTimer) clearTimeout(this.chargenSaveTimer);
    this.chargenSaveTimer = setTimeout(() => {
      this.chargenSaveTimer = null;
      const slug = this.slugFor(campaign);
      saveChargenState(slug, slot, {
        chosenPath: this.chargenChosenPath,
        answers: this.chargenAnswers
      });
    }, 300);
  }

  /**
   * CC-10: serialize the in-progress chargen state for the given
   * campaign+slot and trigger a browser download.  Surfaces
   * "packed!" / "couldn't pack" feedback through
   * `chargenPackFeedback` for ~3 seconds.
   *
   * Pure-DOM download via Blob URL + anchor click — works in any
   * modern browser; no clipboard / filesystem APIs.  When the page
   * is served over `file://` or in a sandboxed iframe where Blob
   * URLs are disabled, the trigger surfaces a 'pack-failed' state
   * (the player can copy the answers manually as a fallback).
   */
  private packChargenAndDownload(
    campaign: LoadedCampaign,
    slot: number
  ): void {
    try {
      const fingerprint = campaignFingerprint(campaign.base.source);
      const doc = packChargen({
        campaignFingerprint: fingerprint,
        slot,
        chosenPath: this.chargenChosenPath,
        answers: this.chargenAnswers
      });
      const json = stringifyChargenPack(doc);
      const filename = suggestedPackFilename(doc, this.slugFor(campaign));
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.chargenPackFeedback = 'packed';
    } catch (e) {
      if (
        e instanceof ChargenPackError ||
        e instanceof Error // includes URL.createObjectURL failures in sandboxed envs
      ) {
        this.chargenPackFeedback = 'pack-failed';
      } else {
        throw e;
      }
    }
    // Auto-clear feedback after 3 seconds so the next interaction
    // doesn't see stale text.
    setTimeout(() => {
      if (
        this.chargenPackFeedback === 'packed' ||
        this.chargenPackFeedback === 'pack-failed'
      ) {
        this.chargenPackFeedback = '';
      }
    }, 3000);
  }

  /**
   * CC-12: generate an invite-URL for the given slot.  Coord-only
   * (the `<invite-manager>` region is only mounted in DM views, but
   * defense-in-depth check here too).  Returns the full URL on
   * success, null on failure (slot out of range, no campaign loaded,
   * encode failed).  The DM hands the URL to the intended player
   * out-of-band (email / chat); the player visits and lands on the
   * chargen route (CC-3).
   */
  generateInviteUrl(slot: number): Promise<string | null> {
    if (!this.isCoordinator()) return Promise.resolve(null);
    const campaign = this.getCurrentCampaign();
    if (!campaign) return Promise.resolve(null);
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
      return Promise.resolve(null);
    }
    try {
      const fingerprint = campaignFingerprint(campaign.base.source);
      const token = encodeInviteToken({
        slot,
        issuedAt: Date.now(),
        campaignFingerprint: fingerprint
      });
      const search = routeToSearch({
        kind: 'character-creation',
        slug: this.slugFor(campaign),
        inviteToken: token
      });
      const url = `${window.location.origin}${window.location.pathname}${search}`;
      return Promise.resolve(url);
    } catch {
      // encodeInviteToken throws InviteTokenError for invalid input;
      // the slot range check above should catch all cases, but a
      // defensive null-return keeps the UI's "generation failed"
      // path honest if a future bug slips a bad payload through.
      return Promise.resolve(null);
    }
  }

  /**
   * M3a.8 P2-3: render the <dm-scratch> region in the Dock slot
   * when the local peer is the DM.  Hidden for players (the
   * scratchNotes field is also stripped from their view by
   * filterForViewer; this is belt-and-suspenders).
   */
  private renderDmScratch(): TemplateResult | typeof nothing {
    if (!this.isCoordinator()) return nothing;
    const v = this.sessionView;
    if (!v || v.status !== 'active') return nothing;
    return html`
      <dm-scratch
        .entries=${v.filteredShared.scratchNotes}
        .onSubmit=${(text: string) => this.appendScratchNote(text)}
      ></dm-scratch>
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
        .pcSlotBindings=${this.sessionView?.shared.pcSlots ?? {}}
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
    // M3b.5: build the DualCardResponse from the structured broker
    // result.  Both halves go through the same markdown sanitize
    // pipeline as everywhere else.  Players never see this rendered
    // path — showAiPanel() already gates on isCoordinator() — but
    // the dmOnly content is never substituted into the player-
    // visible safe card under any code path (parse failures fall
    // back to safe:'' rather than guessing).
    const structured = this.aiResponseStructured;
    const dualResponse: DualCardResponse | null = structured
      ? {
          safeHtml: structured.safe
            ? renderMarkdown(structured.safe)
            : ('' as SanitizedHtml),
          dmOnlyHtml: structured.dmOnly
            ? renderMarkdown(structured.dmOnly)
            : ('' as SanitizedHtml),
          sources: structured.sources,
          responseId: structured.responseId
        }
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
        .response=${dualResponse}
        .scope=${this.aiScope}
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
        .onSetScope=${(s: ContextScope) => {
          this.aiScope = s;
        }}
        .onAcceptResponse=${(id: string) => this.acceptAiResponse(id)}
        .onRejectResponse=${(id: string) => this.rejectAiResponse(id)}
        .verdictResponseId=${this.aiVerdictResponseId}
        .verdictKind=${this.aiVerdictKind}
        .budget=${this.aiBudgetSummary()}
        .writeBatch=${this.aiWriteBatchView()}
        .recentRejections=${this.aiRecentRejections()}
        .reviewEveryUpdate=${this.aiReviewEveryUpdate}
        .onSetReviewEveryUpdate=${(v: boolean) => {
          this.aiReviewEveryUpdate = v;
        }}
        .onApplyAllWrites=${() => this.aiWrites.applyAll()}
        .onApplyWrite=${(id: string) => this.aiWrites.applyOne(id)}
        .onRevertWrite=${(id: string) => this.aiWrites.revertOne(id)}
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
      case 'character-creation':
        return this.renderCharacterCreation(
          this.appState.campaign,
          this.appState.slot,
          this.appState.tokenError
        );
      case 'error':
        return this.renderError(
          this.appState.message,
          this.appState.details
        );
    }
  }

  /**
   * CC-5: render the chargen region for an inbound invite-token
   * visit.  The region's step machine + step copy lives in
   * `<character-creation>`; QuireApp's job here is to feed it the
   * validated slot + campaign info (or the error code when token
   * validation failed at navigateToRoute time).
   *
   * Path-pick wiring is local-only today (the chosen path doesn't
   * persist across reloads yet).  CC-11 / CC-4 land the
   * IndexedDB-backed persistence.
   */
  private renderCharacterCreation(
    campaign: LoadedCampaign,
    slot: number,
    tokenError:
      | ''
      | 'malformed'
      | 'expired'
      | 'campaign-mismatch'
      | 'invalid-slot'
  ): TemplateResult {
    return html`
      <character-creation
        .slotNumber=${slot}
        .campaignName=${campaign.base.manifest.name}
        .tokenError=${tokenError}
        .chosenPath=${this.chargenChosenPath}
        .questions=${campaign.base.manifest.characterCreation?.questions ?? []}
        .answers=${this.chargenAnswers}
        .packFeedback=${this.chargenPackFeedback}
        .onPickPath=${(p: 'qa' | 'free-write' | 'pre-gen') => {
          this.chargenChosenPath = p;
          this.persistChargen(campaign, slot);
        }}
        .onAnswerChange=${(id: string, value: string) => {
          this.chargenAnswers = { ...this.chargenAnswers, [id]: value };
          this.persistChargen(campaign, slot);
        }}
        .onPack=${() => this.packChargenAndDownload(campaign, slot)}
      ></character-creation>
    `;
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
    // sceneFullyRevealed = "show every block to non-DM viewers."
    // True for offline browsing (no session) AND for whole-scene-
    // revealed scenes with NO per-block reveals yet (backward compat:
    // a campaign that only uses scene-reveal continues to render
    // everything for players).  As soon as the DM clicks a single
    // per-block pip, paced mode engages and players see only the
    // pip-revealed subset — this is the load-bearing behavior the
    // per-paragraph design exists to support.
    const sceneFullyRevealed =
      v?.status === 'active'
        ? revealedBlocks.size === 0 &&
          v.filteredShared.revealedScenes.includes(fullScenePath)
        : true;
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
        .pcSlotBindings=${this.sessionView?.shared.pcSlots ?? {}}
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
    // M3D-4: compute the doubles halo flag from the actual dice
    // array.  Only 2d6 doubles get a colored halo per ui.md L156
    // (red snake-eyes / gold box-cars).  Non-d6 doubles (e.g.
    // 2d20 nat-20s) are intentionally left un-haloed — the halo
    // belongs to the primary 2d6 resolution mechanic specifically.
    const halo = (dice: readonly number[]): DoublesFlag => {
      if (dice.length !== 2) return null;
      const [a, b] = dice;
      if (a !== b) return null;
      if (a === 1) return 'snake-eyes';
      if (a === 6) return 'box-cars';
      return null;
    };
    const entries: Array<{
      key: string;
      label: string;
      tierClass: string;
      doubles?: DoublesFlag;
    }> = inSession
      ? shared
          .slice()
          .reverse()
          .slice(0, ROLL_HISTORY_MAX)
          .map((r, i) => ({
            key: `s${r.ts}-${r.peerId}-${i}`,
            label: `${this.displayNameFor(r.peerId)}: ${r.expression} = ${r.result} [${r.dice.join(', ')}]`,
            tierClass: '',
            doubles: halo(r.dice)
          }))
      : this.rolls.map((r, i) => ({
          key: `l${i}`,
          label: formatRoll(r),
          tierClass: r.tier ? `roll-tier-${r.tier}` : '',
          // Local-mode DiceRoll has `rolls: number[]` (the die
          // results) where the shared/event shape has `dice: number[]`.
          // Same data, different field name.
          doubles: halo(r.rolls)
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
   * M3a.8 P2-3: append a scratch note as the current scene-path
   * (when in a scene context — the note carries the scenePath
   * hint so post-session AI ingestion can locate it).  Coord-only;
   * silently no-ops outside an active session.
   */
  appendScratchNote(text: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const s = this.appState;
    const scenePath =
      s.kind === 'scene'
        ? `episodes/${s.episode.slug}/${s.scene.path}`
        : undefined;
    this.session.append('scratch-note', { v: 1, text: trimmed, scenePath });
    return true;
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
    if (this.isCoordinator()) {
      // DM is the broadcast author — no self-bounce.  Still
      // advance the cursor so future broadcasts dispatch
      // correctly when the DM changes coord state.
      this.lastFollowedBroadcastTs = bv.ts;
      return;
    }
    const route = parseRoute(bv.stagePath);
    if (route.kind === 'home') {
      // Malformed stagePath — treat as followed so retry isn't
      // wedged on the same poisoned event.
      this.lastFollowedBroadcastTs = bv.ts;
      return;
    }
    // Advance the cursor AFTER navigation resolves so a DM retry
    // of the SAME ts still re-fires when the previous navigation
    // failed (the player lands on the error screen and the DM can
    // re-broadcast without bumping ts).
    void this.navigateToRoute(route).then(
      () => {
        this.lastFollowedBroadcastTs = bv.ts;
      },
      () => {
        // Don't advance on rejection — re-broadcast of the same
        // ts will retry.  navigateToRoute already handles its own
        // error display via _appState; no further surface needed.
      }
    );
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
   * M3D-3: clean shutdown when the SPA navigates back to home
   * with an active session.  Three steps in order, each load-bearing:
   *
   * 1. Append `peer-leave` to the in-memory event log so the leave
   *    event is observable both locally and to any still-connected
   *    peers (best-effort across WebRTC, same fire-and-forget shape
   *    used by `beforeUnloadHandler`).
   * 2. Run autosave synchronously (`performNow`) — without this, the
   *    debounced timer hasn't fired and the leave event sits in
   *    in-memory state only.  Restoring from this incomplete autosave
   *    on the next session restores the prior coord WITHOUT a
   *    leftAt — the original stale-DM-peer bug.
   * 3. Tear down the session controller via `leaveSession()`.
   *
   * Step 2 is what distinguishes this path from beforeUnloadHandler
   * (which doesn't flush — the page is about to unload anyway and
   * the autosave is racing against tab close).
   */
  private announceLeaveAndExit(): void {
    if (!this.session) return;
    try {
      (
        this.session as unknown as {
          peer?: { append: (k: string, p: unknown) => void };
        }
      ).peer?.append('peer-leave', {});
    } catch {
      /* the session is tearing down anyway; missed peer-leave on the
       * wire is recoverable by other peers' heartbeat reaping (future
       * M3D-3 follow-on). */
    }
    this.autosave.performNow();
    this.leaveSession();
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

  /**
   * M3b.5 (P2-6 + P2-7 + P2-12): broker-driven AI submit.  Replaces
   * the legacy text-only path.  Emits ai-prompt + ai-response events
   * with the audit-chain link so the post-session living-doc work
   * (M4+) can reconstruct the exchange.  Scope toggle is consumed
   * + reset to 'public' here per redesign-plan.md L147.
   *
   * For solo (no session) the broker rejects with not-coordinator;
   * the AI panel UI gates submit on showAiPanel() which itself
   * requires an active DM session, so this is defense in depth.
   */
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
    const session = this.session;
    // Solo mode is allowed: the panel is visible in solo (showAiPanel
    // returns true for solo/idle) and the broker accepts when no
    // coordinator is set.  In-session requires active + coord-self.
    const inSession = this.sessionView?.status === 'active';
    if (!session) {
      this.aiError = 'AI panel not ready.';
      return null;
    }
    this.aiAbort?.abort();
    const ac = new AbortController();
    this.aiAbort = ac;
    this.aiLoading = true;
    this.aiError = null;
    this.aiResponse = null;
    this.aiResponseStructured = null;
    const scope = this.aiScope;
    // Reset scope BEFORE the awaited call — the toggle should be
    // visually back to public the moment the DM hits Ask.
    this.aiScope = 'public';
    const broker = this.brokerForProvider(this.aiProvider);
    try {
      // M3b followup — campaign context.  Fetch the WHOLE
      // campaign (every episode listed in campaign.json) and
      // prepend it to the prompt so the AI can reach across
      // episodes — see [[project_quire_ai_context_scaling]].
      // Current episode goes first for the AI's locality bias;
      // prompt caching (Anthropic cache_control) on the static
      // prefix makes the per-query cost ~10% of raw.
      //
      // For campaigns > ~50 episodes the summary-and-slice
      // strategy needs to land (M3c+).  At v1's scale (≤20)
      // this fits well under the token budget.
      const campaign = this.getCurrentCampaign();
      const episode = this.getCurrentEpisode();
      const contextFiles = campaign
        ? await buildCampaignContext({
            source: campaign.base.source,
            scope,
            episodes: this.orderedCampaignEpisodes(campaign, episode?.slug),
            characters: {
              pcs: campaign.base.manifest.characters?.pcs ?? [],
              npcs: campaign.base.manifest.characters?.npcs ?? []
            },
            signal: ac.signal
          })
        : [];
      const contextBlock = wrapCampaignContext(contextFiles);
      const composedPrompt = contextBlock
        ? `${contextBlock}\n\n---\n\n${user}`
        : user;
      const result = await broker.complete({
        prompt: composedPrompt,
        scope,
        model: this.aiModel,
        systemPrompt: this.aiSystemPrompt || undefined,
        signal: ac.signal
      });
      if (ac.signal.aborted) return null;
      // Emit the prompt + response pair AFTER the broker call so
      // both events carry the real token counts from the provider
      // (the budget meter sums both halves; an early emit with
      // hard-coded tokensIn=0 silently undercounted by typically
      // 50-90% on context-heavy prompts).
      if (inSession) {
        const ph = await promptHashFor(user, this.aiModel, []);
        const rh = await responseHashFor(result.raw);
        const prev = chainHead(this.sessionView?.shared.aiAudit ?? []);
        session.append('ai-prompt', {
          v: 1,
          promptHash: ph.short,
          model: this.aiModel,
          tokenIn: result.tokensIn,
          contextRefs: []
        });
        session.append('ai-response', {
          v: 1,
          responseId: result.responseId || rh.short,
          tokenOut: result.tokensOut,
          hash: rh.short,
          prevHash: prev
        });
      }
      this.aiResponseStructured = result;
      // Clear any prior verdict so the new response's buttons are hot.
      this.aiVerdictResponseId = '';
      this.aiVerdictKind = '';
      // M3c.4: stage the AI's proposed state updates for DM accept.
      // Empty stateUpdates → clear() empties any prior batch so the
      // strip doesn't linger across prompts.
      if (result.stateUpdates.length > 0) {
        this.aiWrites.proposeBatch(
          result.stateUpdates,
          result.responseId || ''
        );
      } else {
        this.aiWrites.clear();
      }
      // Maintain legacy `aiResponse` (string) for the "Share to
      // chat" affordance and any test still referencing it.  Use
      // the safe half — never dmOnly — since shareToChat sends
      // text into the player-visible chat.
      this.aiResponse = result.safe;
      this.aiPromptDraft = '';
      return result.safe;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      if (e instanceof AiBrokerError) {
        this.aiError = e.message;
      } else if (
        e instanceof AnthropicProviderError ||
        e instanceof GeminiProviderError
      ) {
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

  /**
   * Order the campaign's episodes so the currently-loaded one
   * appears first.  buildCampaignContext sends them in this
   * order; the AI's attention naturally falls on the prefix +
   * the locality-bias hint matters for relevance.  When no
   * current episode is set (idle / campaign view), the manifest
   * order is preserved.
   */
  private orderedCampaignEpisodes(
    campaign: LoadedCampaign,
    currentSlug: string | undefined
  ): Array<{ slug: string; scenes?: string[] }> {
    const all = campaign.base.manifest.episodes ?? [];
    const episodes: Array<{ slug: string; scenes?: string[] }> = [];
    const currentEp = this.getCurrentEpisode();
    if (
      currentSlug &&
      currentEp?.slug === currentSlug &&
      all.includes(currentSlug)
    ) {
      episodes.push({
        slug: currentSlug,
        scenes: currentEp.manifest.scenes ?? []
      });
    }
    for (const slug of all) {
      if (slug !== currentSlug) episodes.push({ slug });
    }
    return episodes;
  }

  /**
   * M3c followup (Security): recent rejected-hard-gate audit
   * entries surface in a DM banner so silent rejection cannot
   * happen.  Capped at the most recent 5 entries; cleared when
   * the DM acknowledges (handled UI-side via a dismiss action).
   */
  private aiRecentRejections(): Array<{
    ts: number;
    rejectedKind: string;
    rejectedReason: string;
  }> {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return [];
    const audit = v.filteredShared.aiAudit ?? [];
    const out: Array<{
      ts: number;
      rejectedKind: string;
      rejectedReason: string;
    }> = [];
    for (let i = audit.length - 1; i >= 0 && out.length < 5; i--) {
      const e = audit[i];
      if (e.kind === 'rejected-hard-gate') {
        out.unshift({
          ts: e.ts,
          rejectedKind: e.rejectedKind ?? '?',
          rejectedReason: e.rejectedReason ?? ''
        });
      }
    }
    return out;
  }

  /**
   * M3c.4: serialize the AiWriteController state for the ai-panel
   * region.  Returns null when no pending batch.
   */
  private aiWriteBatchView(): AiWriteBatchView | null {
    const batch = this.aiWrites.currentBatch;
    if (batch.length === 0) return null;
    return {
      batch: batch.map((u) => ({
        id: u.id,
        update: u.update,
        status: u.status,
        hardGateReason: u.hardGateReason
      })),
      undoSecondsRemaining: this.aiWrites.undoSecondsRemaining,
      hasUnapplied: this.aiWrites.hasUnappliedPending
    };
  }

  /**
   * M3b gate fix: token-budget summary for the AI panel meter.
   * Returns null in solo or when no audit history exists so the
   * meter stays hidden until the DM actually starts using it.
   */
  private aiBudgetSummary(): {
    total: number;
    ceiling: number;
    warning: boolean;
    exceeded: boolean;
  } | null {
    const audit = this.sessionView?.shared.aiAudit;
    if (!audit || audit.length === 0) return null;
    const u = computeUsage(audit, this.aiBudgetCeiling);
    return {
      total: u.total,
      ceiling: u.ceiling,
      warning: u.warning,
      exceeded: u.exceeded
    };
  }

  /**
   * Construct a broker on demand.  Re-creates per call so tests
   * that swap `aiProviders[p]` between submits pick up the new
   * provider; the broker reads state via host getters anyway, so
   * the per-call alloc cost is negligible vs the network round-
   * trip it precedes.
   */
  private brokerForProvider(p: AiProvider): AiBroker {
    return new AiBroker(this.aiProviders[p], {
      getCoordinator: () => this.sessionView?.shared.coordinator,
      getLocalPeerId: () => this.sessionView?.peerId ?? undefined,
      getApiKey: () => this.aiKeys.apiKeys[p],
      getAiAudit: () => this.sessionView?.shared.aiAudit ?? [],
      getBudgetCeiling: () => this.aiBudgetCeiling
    });
  }

  /**
   * M3b.5: emit ai-accept / ai-reject for the DM's verdict on a
   * recent response.  Coord-only no-op outside an active session.
   */
  acceptAiResponse(responseId: string, category?: string): boolean {
    return this.recordAiVerdict('ai-accept', responseId, category);
  }
  rejectAiResponse(responseId: string, category?: string): boolean {
    return this.recordAiVerdict('ai-reject', responseId, category);
  }
  private recordAiVerdict(
    kind: 'ai-accept' | 'ai-reject',
    responseId: string,
    category?: string
  ): boolean {
    // Visual feedback flips regardless of session — the DM in solo
    // also wants to see their button click registered.  In session
    // the event also lands in the audit log for post-session
    // analysis.
    this.aiVerdictResponseId = responseId;
    this.aiVerdictKind = kind === 'ai-accept' ? 'accept' : 'reject';
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    this.session.append(kind, { v: 1, responseId, category });
    return true;
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
   *
   * Full event log — used by autosave (resilience: every player's
   * device keeps the complete log so we never lose DM material if
   * a single device fails).  USER-INITIATED file downloads go
   * through buildShareableSaveDocument instead, which strips
   * DM-only events for non-coord viewers.
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
   * Build a save document suitable for SHARING — the JSON that
   * lands in a user-initiated download.  Per the Quire threat
   * model (see design/security.md + memory: project_quire_threat_model):
   *
   *   - players STORING DM notes in their device's autosave is
   *     explicitly wanted (resilience against single-device data
   *     loss);
   *   - players READING DM notes (rendered, or surfaced in a file
   *     they downloaded + opened in a text editor) is the bug.
   *
   * The currently-acting DM gets the full save; everyone else
   * gets DM-only events filtered out.
   */
  buildShareableSaveDocument(): SaveDocument | null {
    if (!this.session || this.sessionView?.status !== 'active') return null;
    const campaign = this.getCurrentCampaign();
    if (!campaign) return null;
    const src = campaign.base.source;
    return serializeSessionForViewer(
      this.session.getEvents(),
      { owner: src.owner, repo: src.repo, ref: src.ref },
      this.sessionView.peerId ?? 'unknown',
      this.sessionView.shared.coordinator
    );
  }

  /**
   * Download the current session as a JSON file.  No-op when not in
   * an active session (button is disabled in that state).  Returns
   * the SaveDocument that was offered, for tests.
   */
  saveToFile(): SaveDocument | null {
    // User-initiated download → shareable variant.  A non-coord
    // player who hands this file to someone else cannot
    // accidentally leak DM scratch / pins / debt / AI audit.
    const doc = this.buildShareableSaveDocument();
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
    const campaignMismatch = this.detectCampaignMismatch(parsed.doc.campaign);
    if (campaignMismatch) {
      this.loadStatus = { kind: 'error', message: campaignMismatch };
      return null;
    }
    const { applied, unknownKinds } = this.applyLoadedEvents(parsed.doc.events);
    this.autoReclaimAfterLoad();
    const result: LoadResult = {
      applied,
      duplicates: parsed.doc.events.length - applied,
      rejected: 0,
      unknownKinds,
      errors: []
    };
    this.loadStatus = {
      kind: 'loaded',
      message: this.formatLoadBanner(applied, result.duplicates, unknownKinds)
    };
    return result;
  }

  /**
   * Cross-campaign protection: refuse to load a save whose campaign
   * pointer differs from the one currently open.  Returns the
   * user-facing error message, or null when the load may proceed.
   */
  private detectCampaignMismatch(
    saved: { owner: string; repo: string }
  ): string | null {
    const currentCampaign = this.getCurrentCampaign();
    if (!currentCampaign) return null;
    const c = currentCampaign.base.source;
    if (c.owner === saved.owner && c.repo === saved.repo) return null;
    return `Save is for ${saved.owner}/${saved.repo}, current campaign is ${c.owner}/${c.repo}.`;
  }

  /**
   * Replay the saved events into the active session and count both
   * applied-vs-duplicate and H-4 unknown-kind events.  Unknown-kind
   * events still replicate (EventLog dedups by id) but the
   * materializer drops them; the count drives the H-4 banner.
   */
  private applyLoadedEvents(
    events: readonly import('./core/event-log').QuireEvent[]
  ): { applied: number; unknownKinds: number } {
    let applied = 0;
    let unknownKinds = 0;
    for (const e of events) {
      if (this.session!.applyEvents([e]) > 0) applied++;
      if (typeof e.kind !== 'string' || !KNOWN_EVENT_KINDS.has(e.kind)) {
        unknownKinds++;
      }
    }
    return { applied, unknownKinds };
  }

  /**
   * When a host loads a save, fire a coord-reclaim so the loading
   * host is unambiguously coordinator regardless of the saved
   * session's claim history.  A guest who loads does NOT auto-
   * reclaim — that's the explicit Reclaim-button workflow.
   */
  private autoReclaimAfterLoad(): void {
    const v = this.sessionView!;
    if (v.mode === 'host' && v.shared.coordinator !== v.peerId) {
      this.session!.reclaimCoordinator();
    }
  }

  /**
   * Compose the user-facing load result message.  Prepends an H-4
   * unknown-kind warning when the save contained events from a
   * newer runtime than the local one understands.
   */
  private formatLoadBanner(
    applied: number,
    duplicates: number,
    unknownKinds: number
  ): string {
    const banner =
      unknownKinds > 0
        ? `This save contains ${unknownKinds} event kind${unknownKinds === 1 ? '' : 's'} this runtime doesn't recognize; some scene state may be incomplete (consider updating). `
        : '';
    return `${banner}Loaded ${applied} new event${applied === 1 ? '' : 's'} (${duplicates} already present).`;
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
        .pcSlotBindings=${this.sessionView?.shared.pcSlots ?? {}}
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
   * M3a.8 (P2-4): DM-only NPC pin/unpin button on the NPC
   * character page.  The PC thread-debt selector moved to
   * `<dm-aside>` at M3a polish FU-3 so the DM can adjust rungs
   * from the cockpit without page navigation; nothing renders for
   * PCs here anymore.  Renders nothing for non-DM viewers.
   */
  private renderDmCharacterAffordances(
    character: LoadedCharacter
  ): TemplateResult | typeof nothing {
    if (!this.isCoordinator()) return nothing;
    if (character.kind !== 'npc') return nothing;
    const pinned =
      this.sessionView?.status === 'active' &&
      this.sessionView.filteredShared.pinnedNpcs.includes(character.id);
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

  /**
   * M3a.8 P2-4: emit npc-pin or npc-unpin based on current state.
   * Coord-only; no-op outside an active session.
   */
  toggleNpcPin(npcId: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const pinned = v.filteredShared.pinnedNpcs.includes(npcId);
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

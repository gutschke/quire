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
import './ui/regions/stage-roster';
import './ui/regions/player-aside';
import './ui/regions/dm-scratch';
import './ui/regions/dm-aside';
import './ui/regions/dm-roster-strip';
// WRAP-LAZY (2026-05-27 holistic-review): the 5 wrap-direction
// regions live in a separate chunk loaded only when the DM enters
// wrap or open mode.  See `./ui/regions/wrap-mode-chunk.ts` for
// the barrel.  Type-only imports stay static (zero runtime cost).
import type { WrapStep } from './ui/regions/wrap-stepper';
import type { DiffProposalView } from './ui/regions/diff-review-stage';
import type { CarryoverPcCard } from './ui/regions/session-open-stage';
import './ui/regions/clock-strip';
import type { DmClockView } from './ui/regions/clock-strip';
import './ui/regions/dm-pc-detail';
// Phase 3a Cluster E step 6: <seat-strip> mount removed; the
// per-seat row rendering is now inside <chargen-dm-review>.  The
// region module still exists in the repo for git history; future
// commits may delete the file entirely.
// CC-3 / CC-5 / CC-12: chargen regions are dynamically imported
// (see `loadChargenRegion` / `loadInviteManagerRegion`).  They live
// outside the main bundle to keep the play-time path lean; users in
// a regular play session don't pay the JS cost of chargen UI.
import {
  decodeInviteToken,
  campaignFingerprint,
  InviteTokenError
} from './invite-token';
// Code-split: `backstory-synthesizer` + its dep chain (prompt
// assembler, spoiler-check, validator) only load when the DM
// invokes synthesis at session 1.  Playtime never touches it.
// Phase 3a Cluster E step 1: the orchestration moved into
// ChargenController; QuireApp only re-exports the result type for
// the legacy invite-manager surface shim.
import type { SynthesizeBackstoryResult } from './ai/backstory-synthesizer';
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
import './ui/components/quire-modal';
import './ui/components/quire-help-overlay';
import { HELP_OPEN_EVENT } from './ui/components/quire-help-overlay';
import {
  type ChatLintAiStatus
} from './ai/chat-spoiler-lint';
import { containsSpoilerTokens } from './ai/spoiler-check';
import {
  ChatSpoilerLintController,
  type ChatSpoilerLintUiState
} from './controllers/chat-spoiler-lint-controller';
import {
  ReclaimController,
  type YieldPcFatePrompt
} from './controllers/reclaim-controller';
import { BroadcastFollowingController } from './controllers/broadcast-following-controller';

// chat-spoiler-lint UI state lives in
// `./controllers/chat-spoiler-lint-controller` (extracted as
// part of E-LARGE-1 step 1, 2026-05-27).  Imported via the
// `ChatSpoilerLintUiState` type below.
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
  resolveSeatCap,
  type LoadedCampaign as LoadedCampaignBase
} from './campaign-loader';
import { loadEpisode, loadScene, type LoadedEpisode } from './episode-loader';
import {
  loadCharacter,
  stripDmOnlyFromCharacter,
  CharacterLoadError,
  isDmOnlyCharacterFieldPath,
  type LoadedCharacter,
  type CharacterKind,
  type CharacterRecord
} from './character-loader';
import {
  applyCharacterEdits,
  STAT_MIN,
  STAT_MAX,
  DM_NOTES_MAX
} from './character-edits';
import { AiBroker, AiBrokerError, type AiProvider as AiProviderImpl } from './ai/broker';
import {
  buildCampaignContext,
  wrapCampaignContext
} from './ai/campaign-context';
import { AiWriteController } from './controllers/ai-write-controller';
import { ChargenController } from './controllers/chargen-controller';
import type { AiWriteBatchView } from './ui/regions/ai-panel';
import { anthropicProvider } from './ai/providers/anthropic';
import { geminiProvider } from './ai/providers/gemini';
import type { AiResponse } from './ai/schema';
import type { ContextScope } from './ai/context';
import { wrapUntrusted } from './ai/context';
import {
  buildSessionDigestPrompt,
  SESSION_DIGEST_CALL_SCHEMA,
  SESSION_DIGEST_INPUT_KINDS
} from './ai/session-digest-prompt';
import {
  buildDiffProposalPrompt,
  DIFF_PROPOSAL_CALL_SCHEMA,
  filterEventsForDiffProposal,
  type NpcContext
} from './ai/diff-proposal-prompt';
import {
  applyProposalToWorkingCopy,
  validateProposal as validateDiffProposalShape,
  type DiffProposal
} from './living/diff-format';
import {
  WorkingCopy,
  IndexedDbWorkingCopyStore,
  type WorkingCopyStore
} from './sync/working-copy';
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
import {
  KNOWN_EVENT_KINDS,
  BOND_MAX_PER_PC,
  type Seat,
  type ThreadDebtLevel
} from './core/state';
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
  pcSlotsToBindings,
  renderMarkdown,
  renderMarkdownParagraphs,
  ensureMarkdownPipeline,
  onMarkdownPipelineReady,
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
import { isVitestTeardownError } from './test-env';

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

// -----------------------------------------------------------------
// WRAP-LAZY (2026-05-27 holistic-review): lazy-load the wrap-mode
// chunk on first transition into 'session-wrap-marks' or
// 'session-open'.  Until loaded, the host renders a placeholder.
// Module-level pattern (not a class field) so re-mounts of
// QuireApp during tests don't accidentally re-trigger the import.
// Mirrors the markdown-pipeline lazy-load (E-LH6).
// -----------------------------------------------------------------

type WrapModeChunk = typeof import('./ui/regions/wrap-mode-chunk');
let _wrapModeChunk: WrapModeChunk | null = null;
let _wrapModeChunkPromise: Promise<WrapModeChunk> | null = null;
const _wrapModeReadyCallbacks: Array<() => void> = [];

function ensureWrapModeChunk(): Promise<WrapModeChunk> {
  if (_wrapModeChunk) return Promise.resolve(_wrapModeChunk);
  if (!_wrapModeChunkPromise) {
    _wrapModeChunkPromise = import('./ui/regions/wrap-mode-chunk').then(
      (mod) => {
        _wrapModeChunk = mod;
        for (const cb of _wrapModeReadyCallbacks) {
          try {
            cb();
          } catch {
            // Don't let one listener block others.
          }
        }
        _wrapModeReadyCallbacks.length = 0;
        return mod;
      },
      (err) => {
        // Reset the cache so a subsequent call retries cleanly.
        // Vitest tears the env down between test files; the chunk's
        // inner imports can resolve after teardown + reject with
        // EnvironmentTeardownError.  Real load errors still throw.
        _wrapModeChunkPromise = null;
        if (!isVitestTeardownError(err)) throw err;
        return null as unknown as WrapModeChunk;
      }
    );
  }
  return _wrapModeChunkPromise;
}

function onWrapModeChunkReady(cb: () => void): void {
  if (_wrapModeChunk) {
    cb();
    return;
  }
  _wrapModeReadyCallbacks.push(cb);
}

function isWrapModeChunkLoaded(): boolean {
  return _wrapModeChunk !== null;
}

/** Test-only reset for the wrap-mode chunk cache. */
export function resetWrapModeChunkForTests(): void {
  _wrapModeChunk = null;
  _wrapModeChunkPromise = null;
  _wrapModeReadyCallbacks.length = 0;
}

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
 * Hostile-bundle regression (2026-05-26): clamp an NPC's stat
 * value into the [STAT_MIN, STAT_MAX] range pc-create requires.
 * Non-number / NaN coerces to 0.  Used by promoteNpcToPc so a
 * +5/+5 boss NPC can still be promoted — the DM rewrites
 * baselines via the edit dialog afterward.
 *
 * Note (verification a8af6419725d20f92 NIT): the pc-create
 * materializer in core/state.ts uses parallel constants
 * (PC_CREATE_STAT_MIN/MAX) that happen to equal STAT_MIN/MAX
 * today.  If those ever diverge, this clamp would silently
 * produce values the materializer rejects.  A static-assert
 * check in state.test.ts would catch the drift; deferred until
 * one side actually retunes.
 */
function clampPromoteStat(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (n < STAT_MIN) return STAT_MIN;
  if (n > STAT_MAX) return STAT_MAX;
  return Math.round(n);
}

/**
 * Task #293: one-line status copy for the chat-spoiler-lint modal,
 * varying with the async AI semantic check.  Pulled out of the
 * render method so the strings are easy to scan + adjust.
 */
function renderChatLintStatusLine(
  status: ChatLintAiStatus
): TemplateResult | typeof nothing {
  switch (status) {
    case 'unchecked':
      return html`<p class="chat-spoiler-lint-status muted">
        (No AI key configured — substring check only.)
      </p>`;
    case 'checking':
      return html`<p class="chat-spoiler-lint-status chat-spoiler-lint-status-checking">
        Asking the AI to double-check for false positives…
      </p>`;
    case 'clean':
      return html`<p class="chat-spoiler-lint-status chat-spoiler-lint-status-clean">
        ✓ AI thinks this is ordinary English — likely a false alarm.
      </p>`;
    case 'leak':
      return html`<p class="chat-spoiler-lint-status chat-spoiler-lint-status-leak">
        ⚠ AI confirms this would reveal hidden lore.
      </p>`;
    case 'failed':
      return html`<p class="chat-spoiler-lint-status chat-spoiler-lint-status-failed">
        AI check unavailable — substring hits stand.
      </p>`;
  }
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
   * Phase 3a Cluster E step 1: chargen state + lifecycle lifted into
   * a dedicated Lit ReactiveController.  Render code reads
   * `this.chargen.chosenPath` / `.answers` / `.packFeedback` etc.
   * The previous 4-6 @state fields + 4+ methods moved to
   * `src/controllers/chargen-controller.ts` so the unified DM-review
   * region (forthcoming Cluster E step 2) consumes a single seam.
   */
  private chargen = new ChargenController(this, {
    getCurrentCampaign: () => this.getCurrentCampaign(),
    getCampaignSlug: (c) => this.slugFor(c as LoadedCampaign),
    getAiProvider: () => this.aiProvider,
    getAiApiKey: () =>
      this.aiKeys.apiKeys[this.aiProvider] ?? '',
    getAiModel: () => this.aiModel,
    getAiProviders: () => this.aiProviders,
    getDmDisplayName: () => this.displayNameDraft,
    isCoordinator: () => this.isCoordinator(),
    getBoundCharacter: (pcId) => this.pcCharacterCache.get(pcId) ?? null,
    loadCharacterByPcId: (pcId) => this.loadCharacterByPcId(pcId),
    appendScratchNote: (text) => this.appendScratchNote(text),
    appendPcCreate: (payload) => this.appendPcCreate(payload),
    bindPcSlot: (slot, pcId) => this.bindPcSlot(slot, pcId),
    appendBondPropose: (payload) =>
      this.proposeBond({
        pcId: payload.pcId,
        targetPcId: '',
        targetPlaceholder: payload.targetPlaceholder,
        text: payload.text
      }),
    appendSeatAdd: (slot: number) => this.appendSeatAdd(slot),
    appendSeatRemove: (slot: number) => this.appendSeatRemove(slot),
    getPcSlots: () => this.sessionView?.shared.pcSlots ?? {},
    getSeatCap: () => this.currentSeatCap(),
    appendChargenPackDeliver: (slot, pack) =>
      this.appendChargenPackDeliver(slot, pack)
  });

  /**
   * Phase 3b-1: append a `pc-create` event from the chargen accept
   * path.  Coord-only (the materializer also enforces this, but
   * defense-in-depth at the host); silent no-op outside an active
   * session.  Returns true when the append succeeded so the
   * controller can decide whether to chase with `bindPcSlot`.
   */
  private appendPcCreate(payload: {
    pcId: string;
    name: string;
    pronouns: string;
    tags: string[];
    stats: {
      str: number;
      dex: number;
      con: number;
      int: number;
      wis: number;
      cha: number;
    };
    skills: string[];
    backstory: string;
    causedByResponseId?: string;
    startingAdvancements?: number;
    startingMarks?: number;
    languages?: string[];
    moneyBand?: 'broke' | 'tight' | 'comfortable' | 'well-off' | 'wealthy';
  }): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    this.session.append('pc-create', { v: 1, ...payload });
    return true;
  }

  /**
   * Per-pcId character cache for the DM-review name-resolution path
   * (P3U-12).  Distinct from `boundCharacter` (which is the LOCAL
   * peer's bound PC); this cache holds any pcId a DM-side surface
   * needs to display by name.  Lazy-populated by
   * `loadCharacterByPcId`; consumed via the controller's
   * `displayNameForBound`.
   */
  private pcCharacterCache = new Map<string, LoadedCharacter>();
  private pcCharacterInFlight = new Set<string>();

  /**
   * Wave A2 (2026-05-26) firewall hardening per QA-audit BLOCKER-2:
   * disk-loaded character records carry DM-only fields verbatim
   * (`magicPhase`, `knowsTheyCanCast`, `tax`, `threadDebt`,
   * `accidentalGrants`, `alignmentDrift`, `dmNotes`).  The
   * `filterForViewer` projection in `state.ts` only protects
   * records in `state.synthesizedPcs` — records loaded from disk
   * bypass it.  `character-loader.ts:340` explicitly calls out the
   * gap: "loader's records aren't routed through state.ts".
   *
   * This wrapper strips on the way INTO the cache when the local
   * viewer isn't the coord.  Defense-in-depth so downstream
   * consumers (boundCharacter, AI write controller, displayName
   * helpers) can't accidentally leak DM-only fields to the player.
   * The coord (DM) cache still holds full records for editing.
   */
  private cacheCharacterForLocalViewer(
    pcId: string,
    loaded: LoadedCharacter
  ): void {
    if (this.isCoordinator()) {
      this.pcCharacterCache.set(pcId, loaded);
      return;
    }
    const stripped: LoadedCharacter = {
      ...loaded,
      record: stripDmOnlyFromCharacter(loaded.record) as CharacterRecord
    };
    this.pcCharacterCache.set(pcId, stripped);
  }

  /**
   * COORD-FLIP FIREWALL INVARIANT (2026-05-27).  Every local cache
   * or `@state` mirror that holds character data with a strip
   * decision baked in AT WRITE TIME must be invalidated when the
   * local peer's coordinator status changes — otherwise a
   * coord→player transition leaves unstripped DM-only fields
   * readable by a now-player viewer (the bug class that hit 3×:
   * #392 chat-spoiler-lint, #393 pcCharacterCache, #395
   * boundCharacter).  The session subscriber calls this on the
   * `wasLocalCoord !== nowLocalCoord` edge.
   *
   * ⚠️ When you add a NEW character-bearing cache/@state mirror to
   * QuireApp, CLEAR IT HERE + add it to the coord-flip invariant
   * test (`quire-app.coord-flip-firewall.test.ts`).  A static read-
   * lint (Q-LT4) can't catch this class — the guard is this method
   * + its test.  The chat-spoiler-lint modal clears itself via its
   * own controller `hostUpdated`; it's listed in the test for
   * completeness.
   */
  private invalidateViewerScopedCachesOnCoordChange(): void {
    // pcCharacterCache: per-pcId loaded records, stripped-on-write.
    this.pcCharacterCache.clear();
    this.pcCharacterInFlight.clear();
    // boundCharacterFor: the short-circuit key for the
    // `boundCharacter` @state mirror — reset so refreshBoundCharacter
    // re-resolves with the current strip decision next render.
    this.boundCharacterFor = '';
  }

  private loadCharacterByPcId(pcId: string): void {
    if (pcId === '' || this.pcCharacterCache.has(pcId)) return;
    if (this.pcCharacterInFlight.has(pcId)) return;
    const campaign = this.getCurrentCampaign();
    if (!campaign) return;
    // Phase 3b-1 step 2: loader-overlay resolution.  If the pcId
    // refers to a synthesized PC (in `state.synthesizedPcs`), the
    // record lives in shared session state, not in the campaign
    // repo — resolve it synchronously without hitting the network.
    // The DM-review surface's display-name lookup and the bound-
    // character refresh both flow through this method, so a single
    // overlay-check here is sufficient for the chargen-accept path.
    const overlay = this.resolvePcFromOverlay(pcId, campaign);
    if (overlay) {
      this.cacheCharacterForLocalViewer(pcId, overlay);
      this.requestUpdate();
      return;
    }
    this.pcCharacterInFlight.add(pcId);
    // `loadCharacter` rejects on missing/invalid; on resolve the
    // record is always a non-null `LoadedCharacter` (see
    // `character-loader.ts`).  No defensive null-check needed.
    void loadCharacter(campaign.base.source, 'pc', pcId)
      .then((character) => {
        this.pcCharacterInFlight.delete(pcId);
        this.cacheCharacterForLocalViewer(pcId, character);
        this.requestUpdate();
      })
      .catch(() => {
        this.pcCharacterInFlight.delete(pcId);
      });
  }

  /**
   * Phase 3b-1 step 2: synthesized-PC overlay resolver.  Reads
   * `sessionView.filteredShared.synthesizedPcs[pcId]` and wraps the
   * `CharacterRecord` in a synthetic `LoadedCharacter` shaped
   * identically to a campaign-shipped PC, so downstream code
   * (`boundCharacter`, `pcCharacterCache`, `displayNameForBound`,
   * `computeBoundStats`) doesn't need to discriminate the two
   * sources.
   *
   * Returns null on overlay miss; the caller falls through to the
   * GitHub-raw fetch path.  Lookup is O(1) on a Record; no caching
   * needed.
   */
  private resolvePcFromOverlay(
    pcId: string,
    campaign: LoadedCampaign
  ): LoadedCharacter | null {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return null;
    const record = v.filteredShared.synthesizedPcs?.[pcId];
    if (!record) return null;
    return {
      kind: 'pc',
      id: pcId,
      record,
      source: campaign.base.source
    };
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
  /**
   * D1-C (2026-05-26): which sub-step of the wrap workflow is
   * showing.  Local to QuireApp; not URL-persisted (the destination
   * is the saved digest + ratified proposals — the path through is
   * ephemeral; reload during wrap returns to marks).  Reset to
   * 'marks' whenever the launcher enters wrap mode.
   */
  @state() wrapStep: WrapStep = 'marks';
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
   * Task #293 (chat-spoiler-lint, 2026-05-25): DM-only confirmation
   * state when a coordinator's chat draft contains substring-flagged
   * spoiler tokens.  Null means no pending confirmation — chat sends
   * proceed immediately.  When non-null, the lint modal is open and
   * the draft is held until the DM picks an action (send / route to
   * AI / cancel).  Per [[feedback_silent_player_firewall]] this
   * surface is COORDINATOR-ONLY; players never see anything.
   */
  /**
   * E-LARGE-1 step 1 (2026-05-27): chat-spoiler-lint state cluster
   * extracted to `ChatSpoilerLintController` (a Lit ReactiveController).
   * The controller owns the modal state + the AbortController for the
   * in-flight AI semantic check.  The `chatSpoilerLint` getter below
   * re-exposes the controller's state for the template + tests.
   */
  private readonly chatSpoilerLintCtrl = new ChatSpoilerLintController(this, {
    isCoordinator: () => this.isCoordinator(),
    hasActiveSession: () =>
      this.session !== null && this.sessionView?.status === 'active',
    getAiApiKey: () => this.aiApiKey,
    getAiProvider: () => this.aiProvider,
    getAiProviders: () => this.aiProviders,
    getAiModel: () => this.aiModel,
    chatMaxLength: () => CHAT_MAX_LENGTH,
    sendChat: (text) => {
      this.session?.append('chat', { text });
    },
    submitAiPrompt: (text) => {
      void this.submitAiPrompt(text);
    },
    setChatDraft: (draft) => {
      this.chatDraft = draft;
    },
    clearChatError: () => {
      this.chatError = null;
    }
  });

  /** Public getter for template + tests — see chatSpoilerLintCtrl. */
  get chatSpoilerLint(): ChatSpoilerLintUiState | null {
    return this.chatSpoilerLintCtrl.state;
  }
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
  /**
   * E-LARGE-1 step 2 (2026-05-27): coord-yield + reclaim cluster
   * extracted to `ReclaimController`.  The controller owns the
   * confirm-modal flag, the yield-PC-fate prompt state, AND the
   * reactive coord→non-coord edge detection (via `hostUpdated`).
   * QuireApp re-exposes `reclaimConfirmShown` + `yieldPcFatePrompt`
   * as getters so existing render + tests work unchanged.
   *
   * Controller-ordering note: `ReclaimController` is currently the
   * only controller in this constructor that implements
   * `hostUpdated`.  Lit invokes `hostUpdated` in registration
   * order; any future controller registered AFTER this one will
   * observe the modal state for the same tick.  Particularly
   * relevant if `AutosaveController` ever snapshots UI state.
   */
  private readonly reclaimCtrl = new ReclaimController(this, {
    getSessionView: () => this.sessionView,
    getPcName: (pcId) =>
      this.sessionView?.filteredShared.synthesizedPcs[pcId]?.name ?? pcId,
    retirePc: ({ pcId, inFictionReason }) => {
      if (!this.session) return false;
      this.session.append('pc-retire', {
        v: 1,
        pcId,
        state: 'bound-retired',
        inFictionReason,
        reason: 'departed'
      });
      // QA sanity-check SHOULD-FIX-3: verify the retire actually
      // landed before yielding.  EventLog.append → materialize is
      // synchronous through SessionController; if the validator
      // silently rejected, the seat won't be bound-retired and the
      // controller bails before emitting coord-yield.
      const slotEntry = Object.values(
        this.session.view().shared.pcSlots
      ).find((seat) => seat.pcId === pcId);
      return !slotEntry || slotEntry.state === 'bound-retired';
    },
    sidelinePc: () => {
      this.session?.rename({ pcId: '' });
    },
    yieldCoordinator: () => {
      this.session?.append('coordinator-yield', {});
    },
    // `transientError` is the shared ephemeral-error slot —
    // AI failures + engine bails + import / NPC-load errors
    // all flow through this single channel, rendered by the
    // AI panel's error band.  Future polish: per-domain
    // render slots (a status bar for engine errors, etc.).
    setBailError: (msg) => {
      this.transientError = msg;
    }
  });

  /** Public getter for template + tests — see reclaimCtrl. */
  get reclaimConfirmShown(): boolean {
    return this.reclaimCtrl.reclaimConfirmShown;
  }

  /** Public getter for template + tests — see reclaimCtrl. */
  get yieldPcFatePrompt(): YieldPcFatePrompt | null {
    return this.reclaimCtrl.yieldPcFatePrompt;
  }
  /**
   * Debounced autosave to localStorage encapsulated in the
   * AutosaveController (P0-9).  Constructor takes a buildDoc
   * callback so the controller doesn't need direct access to
   * session/campaign internals.
   */
  // Wave A1 (2026-05-26) firewall hardening per QA-audit BLOCKER-1:
  // autosave now routes through buildShareableSaveDocument so a
  // non-coord peer's localStorage doesn't store DM-only events
  // (scratch-note, npc-pin, thread-debt-set, ai-response, caster-
  // state-set).  The DM (coord) still gets the full save — the
  // function is identity for the acting coord and filters for every
  // other viewer.  Resilience for the DM is preserved; the "kid /
  // spouse picks up the player's laptop" threat is closed.
  private autosave = new AutosaveController(this, () =>
    this.buildShareableSaveDocument()
  );
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
  @state() transientError: string | null = null;
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
    // P-R4 (2026-05-25): F1 = add a new player seat (auto-fire).
    // The DM-roster strip surfaces this as a ⊕ button + this
    // hotkey.  Bypasses any modifier so Alt+F1 / Cmd+F1 don't
    // trigger (avoids fighting browser help dialogs).
    if (e.key === 'F1' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Only fire when a session is active — otherwise it's a no-op
      // and the browser's help-open default kicks in.
      const v = this.sessionView;
      if (v?.status === 'active') {
        e.preventDefault();
        this.chargen.addSeat();
        return;
      }
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
    // E-LH6 (2026-05-26): warm up the markdown pipeline asynchronously
    // so the heavy chunk (marked + DOMPurify + js-yaml) doesn't block
    // the first paint.  When it resolves, requestUpdate so consumers
    // that returned the empty SanitizedHtml placeholder on the first
    // render can re-render with real content.
    onMarkdownPipelineReady(() => this.requestUpdate());
    void ensureMarkdownPipeline();
    // WRAP-LAZY (2026-05-27): re-render once the wrap-mode chunk
    // resolves so any pending wrap/open render swaps from
    // placeholder to real region content.
    onWrapModeChunkReady(() => this.requestUpdate());
    // Seed appMode from URL on first mount; popstate keeps it in sync
    // thereafter.  M1 — observed but not yet acted upon.
    this.appMode = parseMode(window.location.search);
    window.addEventListener('popstate', this.popstateHandler);
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    window.addEventListener('keydown', this.hotkeyHandler);
    this.session = new SessionController(this.sessionFactory);
    this.unsubscribeSession = this.session.subscribe((v) => {
      const wasActive = this.sessionView?.status === 'active';
      const prevCoord =
        this.sessionView?.status === 'active'
          ? this.sessionView.filteredShared.coordinator
          : null;
      const prevPeerId =
        this.sessionView?.status === 'active'
          ? this.sessionView.peerId
          : null;
      const wasLocalCoord =
        prevCoord !== null && prevPeerId !== null && prevCoord === prevPeerId;
      this.sessionView = v;
      const nowLocalCoord =
        v.status === 'active' &&
        v.peerId !== null &&
        v.filteredShared.coordinator === v.peerId;
      if (wasLocalCoord !== nowLocalCoord) {
        this.invalidateViewerScopedCachesOnCoordChange();
      }
      // Debounced autosave to localStorage whenever the session state
      // changes — covers new events from any peer.
      if (v.status === 'active') this.scheduleAutosave();
      // Clear stale save/load banners on the transition INTO active.
      // saveStatus/loadStatus are sticky between status changes, so
      // an error fired before hosting (e.g. "No active session to
      // save", "Start or host a session first, then load.") would
      // otherwise contradict the now-visible "Hosting code: ..."
      // banner.  Only clear errors; preserve success banners (a
      // "Saved N events" pip should survive the surrounding
      // re-render).
      if (
        !wasActive &&
        v.status === 'active' &&
        this.saveStatus.kind === 'error'
      ) {
        this.saveStatus = { kind: 'idle' };
      }
      // D2 (2026-05-26): auto-open trigger.  Per UX D2-7: when a
      // session becomes active and the materialized state shows
      // there's a pending open ritual (sessionDigests.length >
      // sessionOpens.length), shift to session-open mode so the
      // DM walks the carryover before resuming play.  Coord-only:
      // player viewers stay in 'in-session' (the player-side
      // welcome-back surface is D2.5 / out of scope for MVP).
      // Reload during the ritual re-enters via this same trigger;
      // Begin clears the trigger by emitting a session-open event.
      if (
        v.status === 'active' &&
        this.appMode === 'in-session' &&
        v.peerId !== null &&
        v.shared.coordHolders.has(v.peerId) &&
        (v.shared.sessionDigests?.length ?? 0) >
          (v.shared.sessionOpens?.length ?? 0)
      ) {
        this.appMode = 'session-open';
      }
      // WRAP-LAZY: pre-fetch the wrap-mode chunk as soon as we
      // know the DM has prior digests + this is a coord viewer.
      // Even if they don't auto-open right now (e.g. session 1
      // never has digests), the moment they click "Wrap session…"
      // the chunk is already loaded.  Idempotent.
      if (
        v.status === 'active' &&
        v.peerId !== null &&
        v.shared.coordHolders.has(v.peerId)
      ) {
        void ensureWrapModeChunk();
      }
      if (
        !wasActive &&
        v.status === 'active' &&
        this.loadStatus.kind === 'error'
      ) {
        this.loadStatus = { kind: 'idle' };
      }
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
      // M3a.8 P2-11 broadcast-follow runs via
      // `BroadcastFollowingController.hostUpdated` (extracted
      // 2026-05-27, E-LARGE-1 step 3) — no explicit dispatch
      // needed here.  The @state update from setting
      // `this.sessionView` above triggers the Lit reactive
      // cycle which fires hostUpdated.
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

  // The coord→non-coord reactive auto-open hook for the yield-PC-
  // fate prompt lives in `ReclaimController.hostUpdated` (extracted
  // 2026-05-27, E-LARGE-1 step 2).  Lit fires `hostUpdated` after
  // the host's `updated()` returns, so no QuireApp-side dispatch
  // is needed.

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
        await this.chargen.loadChargenRegion();
        if (signal.aborted || !this.isConnected) return;
        const expectedFp = campaignFingerprint(campaign.base.source);
        try {
          const payload = decodeInviteToken(route.inviteToken, {
            expectedFingerprint: expectedFp
          });
          // CC-11: resume — load any in-progress chargen state
          // for this campaign + slot.  Per F3 critique, key is
          // slug+slot not token, so token regeneration doesn't
          // orphan data.  First-visit (or different device) seeds
          // an empty state — this is also the "wrong-device empty"
          // case: no banner needed because the player sees a clean
          // flow; the Pack-my-character export (CC-10) is the
          // cross-device recovery affordance.
          const slug = this.slugFor(campaign);
          this.chargen.seedFromStorage(slug, payload.slot);
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

    // P3D-3: the chargen route ("character-creation") is a player
    // visiting an invite URL.  The full play cockpit (session bar,
    // roster, chat, AI panel, dice dock, reveal banner) is noise at
    // chargen time — the player only needs the wizard.  Strip the
    // shell and render a centered single-column page; mobile-
    // friendly with no aside overflow on narrow viewports.
    if (this.appState.kind === 'character-creation') {
      return html`
        <main class="chargen-shell">${this.renderBody()}</main>
      `;
    }

    const dmRail = this.renderDmRail();
    const dmAside = this.renderDmAside();
    return html`
      <quire-shell>
        <quire-topbar slot="topbar">${this.renderSessionBar()}</quire-topbar>
        <quire-rail slot="rail">${dmRail ? dmRail : this.renderBoundCharacterRail()}</quire-rail>
        <quire-stage slot="stage">${this.renderRevealBanner()}${this.renderBody()}</quire-stage>
        <!-- Wave A5 (2026-05-26): Aside ordering per ui.md spec.
             Roster sits between chat and AI so the two text-input
             panels (chat-panel + ai-panel) are NEVER visually
             adjacent — closes the chat/AI-confusion accidental-
             disclosure threat with zero new chrome.  Stack order:
             dm-aside (pinned NPCs / debt) → roster → chat-panel →
             ai-panel (Aside-bottom per ui.md L196). -->
        <quire-aside slot="aside">${dmAside}${this.renderRosterPanel()}${this.renderChatPanel()}${this.renderAiPanel()}${this.renderChatSpoilerLintModal()}</quire-aside>
        <quire-dock slot="dock">${this.renderDmScratch()}${this.renderVersionBadge()}</quire-dock>
        <!-- Wave C1 (2026-05-26): hotkey overlay.  Self-contained;
             owns the "?" global keydown listener.  No prop wiring
             needed.  Topbar "?" chip dispatches a custom event the
             overlay listens for. -->
        <quire-help-overlay></quire-help-overlay>
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
    // Wave C4 (2026-05-26): thread-debt + caster-state + reset-spam
    // wiring removed from <dm-aside> and consolidated on
    // <dm-pc-detail>.  Per UX expert: "Rail wins as the canonical
    // home; dm-aside sheds thread-debt + caster-state entirely."
    // dm-aside is now strictly the pinned-NPC aide.
    // Wave C2 (2026-05-26): gate the chargen-dm-review mount on
    // chargenActive.  Pre-fix the 3,339-LOC region permanently
    // squatted the Aside even after every PC was bound and
    // accepted — UX-3 audit called it "the largest cognitive-load
    // drain in the cockpit."  Re-entry path: dm-roster-strip's
    // ⊕ button (F1 hotkey) adds an unbound seat → flips
    // chargenActive back true → component re-mounts.  No "Resume
    // chargen" affordance needed because the add-seat verb IS the
    // re-entry verb.
    const chargenActive = this.isChargenActive(v.filteredShared.pcSlots);
    return html`
      ${this.renderDmRosterStrip()}
      ${this.renderClockStrip()}
      ${this.renderWrapSessionLauncher()}
      <dm-aside
        .campaignSlug=${slug}
        .pinnedNpcs=${v.filteredShared.pinnedNpcs}
        .pendingBondProposals=${this.buildPendingBondProposalsForDmAside()}
        .onUnpin=${(npcId: string) => this.toggleNpcPin(npcId)}
        .onNavigate=${(e: Event, route: AppRoute) => this.navigate(e, route)}
      ></dm-aside>
      ${chargenActive
        ? this.renderChargenDmReviewLazy(v.filteredShared.pcSlots)
        : nothing}
    `;
  }

  /**
   * Wave C2 (2026-05-26): is there any chargen work pending?
   * The dm-aside mounts `<chargen-dm-review>` ONLY when this
   * returns true.  Definition: any unbound seat OR any pending
   * synth (in-flight or result-not-yet-accepted) OR any drift
   * the DM has yet to dismiss/apply.  When all three are quiet,
   * chargen is "done" and the surface unmounts.
   *
   * Note on race-safety: this is a render-time read of the
   * controller state.  When the controller state changes (synth
   * lands, slot accepted, seat added), Lit re-renders the parent
   * and re-evaluates this gate — no manual notification needed.
   */
  private isChargenActive(pcSlots: Record<number, Seat>): boolean {
    for (const seat of Object.values(pcSlots)) {
      if (seat.state === 'unbound') return true;
    }
    // Any in-flight synth OR un-accepted synth result counts as
    // "chargen still has something to show the DM."
    if (this.chargen.hasPendingSynth()) return true;
    return false;
  }

  /**
   * Phase B P5 (2026-05-26): "Wrap session" launcher button in
   * the DM aside.  Switches appMode to `session-wrap-marks`; the
   * renderBody dispatch then shows the end-of-session sheet.
   * Coord-only — non-coord peers don't see this branch at all.
   */
  private renderWrapSessionLauncher(): TemplateResult | typeof nothing {
    if (!this.isCoordinator()) return nothing;
    if (this.appMode === 'session-wrap-marks') return nothing;
    return html`<p class="dm-wrap-session-launcher">
      <button
        type="button"
        class="dm-wrap-session-button"
        title="Step away from play and walk the roster through end-of-session marks"
        @click=${() => {
          this.wrapStep = 'marks';
          this.appMode = 'session-wrap-marks';
        }}
      >
        Wrap session…
      </button>
      ${this.renderSessionOpenLauncher()}
    </p>`;
  }

  /**
   * D2 (2026-05-26): "Open session…" launcher.  Twin of wrap.
   * Coord-only; visible only when there's at least one prior
   * session-digest to pick up from.  Mostly redundant — the
   * auto-open trigger in `applySessionViewChange` fires the
   * ritual automatically — but provides explicit re-entry if the
   * DM has dismissed the auto-open or wants to re-read the digest
   * mid-session.
   */
  private renderSessionOpenLauncher(): TemplateResult | typeof nothing {
    if (!this.isCoordinator()) return nothing;
    if (this.appMode === 'session-open') return nothing;
    const v = this.sessionView;
    if (!v || v.status !== 'active') return nothing;
    if ((v.shared.sessionDigests?.length ?? 0) === 0) return nothing;
    return html`<button
      type="button"
      class="dm-wrap-session-button"
      title="Re-read last session's recap and review the table's carryover"
      @click=${() => {
        this.appMode = 'session-open';
      }}
    >
      Open session…
    </button>`;
  }

  /**
   * D2 (2026-05-26): render the session-open ritual surface.
   * Coord-only (Adversarial D2-1); the carryover cards surface
   * DM-only fields like tax + threadDebt rung + drift marks.
   * Non-coord viewers see a stripped-down "the DM is re-orienting"
   * pane to avoid leaking the surface's existence as a spoiler
   * vector.
   */
  private renderSessionOpenStage(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') {
      return html`<section class="card">
        <p class="muted">No active session.</p>
      </section>`;
    }
    if (!this.isCoordinator()) {
      // Player viewers see a placeholder — the surface itself is
      // DM-only, but we acknowledge the mode so a player checking
      // their viewport isn't confused by an unexplained empty body.
      return html`<section class="card">
        <h2>Session open — the DM is re-orienting the table</h2>
        <p class="muted">
          One moment while the DM walks the roster.  Play resumes
          shortly.
        </p>
      </section>`;
    }
    // WRAP-LAZY: same loader gate as renderSessionWrapMarks.
    if (!isWrapModeChunkLoaded()) {
      void ensureWrapModeChunk();
      return html`<section class="card">
        <p class="muted">Loading session-open surface…</p>
      </section>`;
    }
    const lastDigest =
      v.filteredShared.sessionDigests[
        v.filteredShared.sessionDigests.length - 1
      ];
    const sortedSlots = Object.keys(v.shared.pcSlots)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1)
      .sort((a, b) => a - b);
    const carryover: CarryoverPcCard[] = [];
    for (const slot of sortedSlots) {
      const seat = v.shared.pcSlots[slot];
      if (seat.state !== 'bound-active') continue;
      const pcId = seat.pcId;
      if (!pcId) continue;
      const record = v.shared.synthesizedPcs[pcId];
      if (!record) continue;
      const edits = v.shared.pcEdits[pcId] ?? {};
      const harm = this.numberOverlay(edits, 'harm', record.harm ?? 0);
      const stress = this.numberOverlay(edits, 'stress', record.stress ?? 0);
      const marks = this.numberOverlay(edits, 'marks', record.marks ?? 0);
      const taxActive =
        this.booleanOverlay(edits, 'tax.active',
          (record.tax as { active?: boolean } | undefined)?.active ?? false);
      const taxRemainingRaw = this.numberOverlay(
        edits,
        'tax.sessionsRemaining',
        (record.tax as { sessionsRemaining?: number } | undefined)
          ?.sessionsRemaining ?? 0
      );
      const driftMarks = this.numberOverlay(
        edits,
        'alignmentDrift.marks',
        (record.alignmentDrift as { marks?: number } | undefined)?.marks ?? 0
      );
      const threadDebtRungRaw = (edits['threadDebt.rung'] ??
        (record.threadDebt as { rung?: string } | undefined)?.rung) as
        | string
        | undefined;
      const card: CarryoverPcCard = {
        pcId,
        name: (record.name as string | undefined) ?? pcId,
        slot,
        harm,
        stress,
        marks,
        advancementReady: marks >= 5
      };
      if (taxActive && taxRemainingRaw > 0) {
        card.taxSessionsRemaining = taxRemainingRaw;
      }
      if (typeof threadDebtRungRaw === 'string' && threadDebtRungRaw.length > 0) {
        card.threadDebtRung = threadDebtRungRaw;
      }
      if (driftMarks > 0) {
        card.driftMarks = driftMarks;
      }
      carryover.push(card);
    }
    return html`<session-open-stage
      .lastDigestMarkdown=${lastDigest?.markdown ?? ''}
      .carryover=${carryover}
      .onBegin=${async () => this.beginSession()}
    ></session-open-stage>`;
  }

  /**
   * Helper: read a number-typed pc-edit overlay, falling back to
   * the base record value.  DM-only fields (tax.*, alignmentDrift.*)
   * use this same pattern via the dotted-field key.
   */
  private numberOverlay(
    edits: Record<string, unknown>,
    field: string,
    fallback: number
  ): number {
    const v = edits[field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return fallback;
  }

  private booleanOverlay(
    edits: Record<string, unknown>,
    field: string,
    fallback: boolean
  ): boolean {
    const v = edits[field];
    if (typeof v === 'boolean') return v;
    return fallback;
  }

  /**
   * D2 (2026-05-26): "Begin session" handler.  Coord-only.
   *
   * Emits one `session-open` event recording the coord + ts (D2-3
   * audit trail; idempotency comes from the materializer's
   * append-only contract) and transitions appMode to 'in-session'.
   *
   * **No tax-session decrement.**  D2-verifier (2026-05-26) caught
   * a contradiction with rules.md:184: tax is "**not a fade-out**
   * (no gradual -2 → -1 → 0); it's a gating beat" terminated by a
   * fiction-driven release moment (rules.md:182, the existing B8
   * "Release tax" button).  The earlier D2-4 lock prescribed a
   * per-session decrement that would have introduced a fade-out
   * mechanic the ruleset explicitly disclaims.  The lock is
   * REVERSED: D2 records the session-open marker and shows tax-
   * remaining info on the carryover card (DM-only) for context,
   * but does NOT mechanically advance it.  Existing magic-arc-
   * controls remain the only path to tax termination.
   *
   * Failure modes:
   *   - no active session → no-op
   *   - non-coord → no-op
   */
  async beginSession(): Promise<
    | { ok: true }
    | { ok: false; code: 'no-session' | 'no-coord'; message: string }
  > {
    const v = this.sessionView;
    if (!v || v.status !== 'active') {
      return { ok: false, code: 'no-session', message: 'No active session.' };
    }
    if (!this.isCoordinator()) {
      return { ok: false, code: 'no-coord', message: 'DM-only.' };
    }
    this.session?.append('session-open', { v: 1 });
    this.appMode = 'in-session';
    return { ok: true };
  }

  /**
   * Phase B P5 (2026-05-26): render the end-of-session marks sheet.
   * Pulls every bound-active PC from filteredShared (DM is coord
   * here; identity fast-path) + the current markBullets from
   * pcEdits + the record map.
   */
  private renderSessionWrapMarks(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) {
      return html`<section class="card">
        <h2>Session wrap is DM-only</h2>
        <p class="muted">
          Switch to the DM role (or load a session) to see this surface.
        </p>
      </section>`;
    }
    // WRAP-LAZY: render placeholder while the wrap-mode chunk
    // loads.  The session subscriber already kicked off the
    // import; this just covers the few-frames gap.
    if (!isWrapModeChunkLoaded()) {
      void ensureWrapModeChunk();
      return html`<section class="card">
        <p class="muted">Loading wrap surface…</p>
      </section>`;
    }
    const pcIds: string[] = [];
    const recordMap: Record<string, import('./character-loader').CharacterRecord> = {};
    const bulletsByPcId: Record<
      string,
      import('./character-loader').AdvancementMarkBullets
    > = {};
    const sortedSlots = Object.keys(v.shared.pcSlots)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1)
      .sort((a, b) => a - b);
    for (const slot of sortedSlots) {
      const seat = v.shared.pcSlots[slot];
      if (seat.state !== 'bound-active') continue;
      const pcId = seat.pcId;
      if (!pcId) continue;
      // Wave A3 (2026-05-26) firewall hardening: read from
      // filteredShared (viewer-scoped) so a non-coord wrap-marks
      // view never touches DM-only fields.  Identity fast-path for
      // the DM keeps behavior unchanged; convention violator fix.
      const record = v.filteredShared.synthesizedPcs[pcId];
      if (!record) continue;
      pcIds.push(pcId);
      recordMap[pcId] = record;
      // Bullets live on the record + can be overridden by pc-edits.
      // Build from both.
      const baseBullets =
        (record.markBullets as
          | import('./character-loader').AdvancementMarkBullets
          | undefined) ?? {};
      const edits = v.filteredShared.pcEdits[pcId] ?? {};
      const overlay: import('./character-loader').AdvancementMarkBullets = {
        ...baseBullets
      };
      for (const key of [
        'hardMoment',
        'learned',
        'risk',
        'against',
        'complication'
      ] as const) {
        const dotted = (edits as Record<string, unknown>)[
          `markBullets.${key}`
        ];
        if (typeof dotted === 'boolean') overlay[key] = dotted;
      }
      bulletsByPcId[pcId] = overlay;
    }
    // Use the exported helper so it stays load-bearing (verification
    // ac7a1cdcc81285f0c flagged the prior inline build as dead-code
    // adjacent to a tested export).
    // WRAP-LAZY: helper now lives in the lazy chunk; assert loaded.
    if (!_wrapModeChunk) {
      // Should be unreachable — the early-return above covers
      // not-loaded.  Defensive return.
      return html`<section class="card">
        <p class="muted">Loading…</p>
      </section>`;
    }
    const entries = _wrapModeChunk.buildWrapMarksEntries(
      recordMap,
      bulletsByPcId,
      pcIds
    );
    // D1-C (2026-05-26): wrap is now a STEPPER not a single scroll.
    // The marks pane is step 1; digest is step 2; diff-review is
    // step 3.  Each pane renders independently within the stepper
    // shell.  See WrapStepper for the UX rationale.
    const isCoord = this.isCoordinator();
    const priorDigests = v.filteredShared.sessionDigests.map((d) => ({
      ts: d.ts,
      markdown: d.markdown,
      savedByPeerId: d.savedByPeerId
    }));
    const finishWrap = (): void => {
      this.appMode = 'in-session';
    };
    return html`<wrap-stepper
      .step=${this.wrapStep}
      .onStepChange=${(next: WrapStep) => {
        this.wrapStep = next;
      }}
      .onFinish=${finishWrap}
    >
      ${this.wrapStep === 'marks'
        ? html`<session-wrap-marks
            .pcs=${entries}
            .onSetMarkBullet=${(
              pcId: string,
              key: keyof import('./character-loader').AdvancementMarkBullets,
              value: boolean
            ) => this.submitPcEdit(pcId, `markBullets.${key}`, value)}
          ></session-wrap-marks>`
        : nothing}
      ${this.wrapStep === 'digest'
        ? html`<session-digest
            .priorDigests=${priorDigests}
            .onGenerate=${
              isCoord
                ? async () => this.generateSessionDigest()
                : null
            }
            .onSave=${
              isCoord
                ? (md: string, rid?: string) =>
                    this.appendSessionDigest(
                      md,
                      rid ? { generatedByResponseId: rid } : undefined
                    )
                : null
            }
          ></session-digest>`
        : nothing}
      ${this.wrapStep === 'diff-review' ? this.renderDiffReviewPane() : nothing}
    </wrap-stepper>`;
  }

  /**
   * D1-D (2026-05-26): diff-review pane — mounts
   * <diff-review-stage> with the pending DiffProposals from
   * filtered shared state.  Coord-only callbacks are wired
   * conditionally so non-coord viewers see read-only.
   */
  private renderDiffReviewPane(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') {
      return html`<section class="card">
        <p class="muted">No active session.</p>
      </section>`;
    }
    const isCoord = this.isCoordinator();
    const proposals: DiffProposalView[] = v.filteredShared.diffProposals.map(
      (p) => {
        const view: DiffProposalView = {
          id: p.id,
          npcId: p.npcId,
          path: p.path,
          field: p.field,
          before: p.before,
          after: p.after,
          rationale: p.rationale
        };
        if (p.sourceEventIds) view.sourceEventIds = [...p.sourceEventIds];
        return view;
      }
    );
    return html`<diff-review-stage
      .proposals=${proposals}
      .onGenerate=${isCoord
        ? async () => this.generateDiffProposals()
        : null}
      .onAccept=${isCoord
        ? async (id: string, edited?: unknown) =>
            this.acceptDiffProposal(id, edited)
        : null}
      .onReject=${isCoord
        ? (id: string, opts?: { reason?: string }) =>
            this.rejectDiffProposal(id, opts)
        : null}
    ></diff-review-stage>`;
  }

  /**
   * P-R4 (2026-05-25): always-visible compact roster strip at the
   * top of the DM aside.  Reads filteredShared (no DM-only data
   * needed).  ⊕ verb + F1 hotkey both fire chargen.addSeat().
   */
  private renderDmRosterStrip(): TemplateResult | typeof nothing {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return nothing;
    return html`<dm-roster-strip
      .pcSlots=${v.filteredShared.pcSlots}
      .synthesizedPcs=${v.filteredShared.synthesizedPcs}
      .displayNameLookup=${(pcId: string) =>
        this.chargen.displayNameForBound(pcId)}
      .onAddSeat=${() => this.chargen.addSeat()}
    ></dm-roster-strip>`;
  }

  /**
   * D3 (2026-05-26): DM-only progress-clock strip.  Coord-only —
   * the host already gates the whole dm-aside surface on
   * isCoordinator() via renderBody dispatch, but the early-return
   * here is defense-in-depth in case dm-aside ever mounts in a
   * different path.
   */
  private renderClockStrip(): TemplateResult | typeof nothing {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return nothing;
    if (!this.isCoordinator()) return nothing;
    // dmClocks is wiped from filteredShared for non-coord by
    // filterForViewer, so a coord viewer sees the full map and a
    // non-coord wouldn't have reached here anyway.
    const clocks: DmClockView[] = Object.values(v.shared.dmClocks ?? {})
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({ id: c.id, name: c.name, size: c.size, filled: c.filled }));
    return html`<clock-strip
      .clocks=${clocks}
      .onCreate=${(name: string, size: 4 | 6) =>
        this.createDmClock(name, size)}
      .onTick=${(id: string, by: number) => this.tickDmClock(id, by)}
      .onDelete=${(id: string) => this.deleteDmClock(id)}
    ></clock-strip>`;
  }

  /**
   * D3 (2026-05-26): create a DM-only progress clock.  Coord-only.
   * Returns true on success.  The clock id is derived from the
   * name (lowercased, non-alphanumeric → dashes) + a short random
   * suffix to dedup similarly-named clocks.
   */
  createDmClock(name: string, size: 4 | 6): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 200) return false;
    if (size !== 4 && size !== 6) return false;
    // Slug + 6 hex chars; total ≤ 64 chars to satisfy materializer
    // validation.  Slugify by lowercasing + replacing non-allowed
    // chars with `-`, then collapsing runs + trimming.  D3-verifier
    // NIT: drop `.` from allowed chars so the host can never
    // produce a dotted id whose segments might match the proto-
    // pollution denylist (e.g. user types "foo.__proto__.bar").
    // The materializer rejects either way, but the host pre-clean
    // avoids the silent-no-emit UX bug.
    const slugRaw = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');
    const slug = slugRaw.length > 0 ? slugRaw.slice(0, 50) : 'clock';
    const rand = Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0');
    const id = `${slug}-${rand}`;
    this.session.append('dm-clock-create', {
      v: 1,
      id,
      name: trimmed,
      size
    });
    return true;
  }

  /**
   * D3 (2026-05-26): tick a clock by N (default +1).  Coord-only.
   * Delta semantics — materializer clamps `[0, size]`.  Returns
   * true on emit; false if validation prevents emit.
   */
  tickDmClock(id: string, by: number = 1): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!Number.isFinite(by) || !Number.isInteger(by)) return false;
    const clock = v.shared.dmClocks?.[id];
    if (!clock) return false;
    if (Math.abs(by) > clock.size) return false;
    this.session.append('dm-clock-tick', { v: 1, id, by });
    return true;
  }

  /**
   * D3 (2026-05-26): delete a clock entirely.  Coord-only.
   */
  deleteDmClock(id: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!v.shared.dmClocks?.[id]) return false;
    this.session.append('dm-clock-delete', { v: 1, id });
    return true;
  }

  /**
   * D5 (2026-05-27): propose a bond on a PC.  Player-side or
   * coord-side.  The materializer's authoring gate (D5-3) checks
   * that this peer is either coord OR the seat's controllerPeerId
   * for the bound PC — but we pre-check here for UX (host
   * returns false on rejection so the UI can disable the button).
   * Returns true on emit.
   */
  proposeBond(opts: {
    pcId: string;
    /** Real target pcId, OR '' when using targetPlaceholder. */
    targetPcId: string;
    /** D5.5-B: free-text placeholder when the target PC is unknown. */
    targetPlaceholder?: string;
    text: string;
  }): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active') return false;
    const trimmed = opts.text.trim();
    if (trimmed.length === 0 || trimmed.length > 500) return false;
    // D5.5-B: target is EITHER a real pcId OR a placeholder.
    const placeholder = opts.targetPlaceholder?.trim() ?? '';
    const hasRealTarget = opts.targetPcId.length > 0;
    const hasPlaceholder = placeholder.length > 0;
    if (hasRealTarget === hasPlaceholder) return false; // both/neither
    if (hasPlaceholder && placeholder.length > 80) return false;
    if (hasRealTarget && opts.pcId === opts.targetPcId) return false;
    if (!v.peerId) return false;
    // D5-3 gate pre-check.
    const isCoord = this.isCoordinator();
    let isController = false;
    for (const seat of Object.values(v.shared.pcSlots)) {
      if (
        seat.pcId === opts.pcId &&
        seat.controllerPeerId === v.peerId
      ) {
        isController = true;
        break;
      }
    }
    if (!isCoord && !isController) return false;
    // D5-C-fix #8 (2026-05-27 scenario Adv-MFN-3 +
    // Adv-watch-item-3): bump id entropy from 6 → 10 hex chars
    // (24 → 40 bits) so the materializer's dup-id silent-drop is
    // statistically irrelevant across a multi-session campaign
    // lifetime.  Cheap; total id length stays well under the
    // 64-char cap.  Pre-check against current proposals is also
    // cheap; if a dup somehow occurs (replay, time-of-check race),
    // the materializer still rejects safely.
    const r1 = Math.floor(Math.random() * 0xffffff).toString(16);
    const r2 = Math.floor(Math.random() * 0xffff).toString(16);
    const rand = (r1 + r2).padStart(10, '0');
    const id = `bond-${rand}`;
    const existingProposals = v.shared.pcBondProposals?.[opts.pcId] ?? [];
    if (existingProposals.some((q) => q.id === id)) return false;
    // D5.5-B review round 2 fix: mirror the materializer's cap so
    // the return value is honest.  Pre-fix, proposeBond returned
    // true even when the engine would silently drop the event at
    // `proposals + ratified >= BOND_MAX_PER_PC` — which made the
    // chargen acceptSlot's dropped-bond audit under-report (it
    // keys off this boolean).  The materializer remains the
    // authoritative gate; this is a faithful pre-check.
    const existingRatified = v.shared.pcBonds?.[opts.pcId] ?? [];
    if (existingProposals.length + existingRatified.length >= BOND_MAX_PER_PC) {
      return false;
    }
    const payload: Record<string, unknown> = {
      v: 1,
      id,
      pcId: opts.pcId,
      targetPcId: hasRealTarget ? opts.targetPcId : '',
      text: trimmed
    };
    if (hasPlaceholder) payload.targetPlaceholder = placeholder;
    this.session.append('bond-propose', payload);
    return true;
  }

  /**
   * D5 (2026-05-27): ratify a pending bond proposal.  Coord-only.
   * Optionally overrides the proposal text (DM edit) and adds
   * DM-only `dmNotes` (spoiler anchor).  Returns true on emit.
   */
  ratifyBond(opts: {
    pcId: string;
    id: string;
    text?: string;
    dmNotes?: string;
    /**
     * D5.5-B: resolve a placeholder proposal to a real target.
     * Required when the proposal carries a targetPlaceholder (no
     * real targetPcId); optional redirect otherwise.  The
     * materializer rejects a ratify that leaves a placeholder
     * unresolved, so the UI pre-checks this before enabling the
     * ratify button on a placeholder bond.
     */
    targetPcId?: string;
  }): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const proposals = v.shared.pcBondProposals?.[opts.pcId] ?? [];
    const proposal = proposals.find((p) => p.id === opts.id);
    if (!proposal) return false;
    // D5.5-B: a placeholder proposal can't be ratified without a
    // resolved target.  Pre-check here so the host returns false
    // (UI disables the ratify button) rather than emitting an
    // event the materializer will silently drop.
    const isPlaceholder =
      proposal.targetPcId.length === 0 &&
      (proposal.targetPlaceholder?.length ?? 0) > 0;
    if (isPlaceholder && (opts.targetPcId?.length ?? 0) === 0) return false;
    const payload: Record<string, unknown> = {
      v: 1,
      id: opts.id,
      pcId: opts.pcId
    };
    if (opts.text !== undefined) payload.text = opts.text;
    if (opts.dmNotes !== undefined && opts.dmNotes.length > 0) {
      payload.dmNotes = opts.dmNotes;
    }
    if (opts.targetPcId !== undefined && opts.targetPcId.length > 0) {
      payload.targetPcId = opts.targetPcId;
    }
    this.session.append('bond-ratify', payload);
    return true;
  }

  /**
   * D5 (2026-05-27): remove a bond (proposal or ratified) by id.
   * Coord-only.  Returns true on emit.
   */
  /**
   * D5 (2026-05-27): build the BondsCardEntry[] for `<bonds-card>`
   * for a given PC.  Read from `filteredShared.pcBonds[pcId]`
   * (viewer-scoped so non-coord viewers never see dmNotes) and
   * resolve target labels via the synthesizedPcs name lookup.
   * Falls back to "(retired PC)" or "(unknown)" for dangling
   * targets per D5-7.
   */
  private buildBondsCardEntries(
    pcId: string
  ): import('./ui/field-renderers/bonds-card').BondsCardEntry[] {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return [];
    const out: import('./ui/field-renderers/bonds-card').BondsCardEntry[] = [];
    // Outbound bonds (this PC bonded to someone else).
    const outbound = v.filteredShared.pcBonds?.[pcId] ?? [];
    for (const b of outbound) {
      const targetLabel = this.resolvePcDisplayLabel(b.targetPcId);
      const entry: import('./ui/field-renderers/bonds-card').BondsCardEntry = {
        id: b.id,
        targetPcId: b.targetPcId,
        text: b.text,
        targetLabel,
        direction: 'out'
      };
      if (b.dmNotes !== undefined) entry.dmNotes = b.dmNotes;
      out.push(entry);
    }
    // D5-cleanup (2026-05-27 TTRPG-A.5): inbound bonds (someone
    // else bonded TO this PC).  Engine keeps pcBonds keyed by
    // SOURCE PC; the renderer composes the inbound side at
    // display time.  Both player + DM views see inbound on the
    // target's character sheet — that's the "shared anchor"
    // semantic the design intends.
    for (const [sourcePcId, sourceBonds] of Object.entries(
      v.filteredShared.pcBonds ?? {}
    )) {
      if (sourcePcId === pcId) continue;
      for (const b of sourceBonds) {
        if (b.targetPcId !== pcId) continue;
        const sourceLabel = this.resolvePcDisplayLabel(sourcePcId);
        const targetLabel = this.resolvePcDisplayLabel(pcId);
        const entry: import('./ui/field-renderers/bonds-card').BondsCardEntry = {
          id: b.id,
          targetPcId: pcId,
          text: b.text,
          targetLabel,
          direction: 'in',
          sourceLabel
        };
        if (b.dmNotes !== undefined) entry.dmNotes = b.dmNotes;
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * D5-cleanup (2026-05-27): shared display-label resolver.  Reads
   * `filteredShared.synthesizedPcs[pcId].name` with fallback to
   * "(retired)" suffix when the seat is in a terminal state, or
   * "(unknown PC)" placeholder when the target is firewalled-out.
   * Used by both outbound + inbound bond rendering.
   */
  /**
   * D5.5-B deferred-enhancement (2026-05-28): substring-scan a
   * bond's player-authored text + free-text placeholder for
   * campaign spoiler tokens.  Returns the matched tokens (lowercased,
   * deduped) so the DM review surfaces can render an amber "possible
   * spoiler" chip BEFORE ratify.
   *
   * Per [[feedback_silent_player_firewall]]: this is a DM-ONLY
   * signal — the chip surfaces only on coord-gated surfaces
   * (dm-aside queue, dm-pc-detail ratify form).  The player who
   * typed the spoiler is NEVER told (telling them IS the spoiler).
   *
   * Uses the campaign's declared `aiBackstory.spoilerTokens` when
   * present (the curated Underleaf secret list), else the default
   * token set — same source the chargen synthesis firewall uses.
   * No AI call: a substring pass is the right weight for a passive
   * review chip; the DM makes the final call.
   */
  private bondTextSpoilerHits(text: string, placeholder?: string): string[] {
    const campaign = this.getCurrentCampaign();
    const declared = campaign?.base.manifest.aiBackstory?.spoilerTokens;
    const tokens = declared && declared.length > 0 ? declared : undefined;
    const combined =
      placeholder && placeholder.length > 0 ? `${placeholder} ${text}` : text;
    return containsSpoilerTokens(combined, tokens);
  }

  private resolvePcDisplayLabel(pcId: string): string {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return '(unknown PC)';
    const target = v.filteredShared.synthesizedPcs?.[pcId];
    const targetName = target?.name as string | undefined;
    if (!targetName) return '(unknown PC)';
    const targetSeat = Object.values(v.filteredShared.pcSlots).find(
      (s) => s.pcId === pcId
    );
    const retired =
      targetSeat?.state === 'bound-retired' ||
      targetSeat?.state === 'bound-archived';
    return retired ? `${targetName} (retired)` : targetName;
  }

  /**
   * D5 (2026-05-27): list of other PCs in the same campaign that
   * this PC could bond to.  Excludes the PC itself.  Reads from
   * `filteredShared.pcSlots` + `synthesizedPcs` to honor the
   * spoiler-firewall (UX-expert pre-design lock: targets must be
   * a PC the table has met).
   */
  /**
   * D5-cleanup (2026-05-27 TTRPG-A.4 / UX-2): build the
   * campaign-level pending bond proposal queue for dm-aside.
   * Reads from `v.shared.pcBondProposals` (DM-only state; this
   * method is coord-gated by the dm-aside render context).
   * Returns empty for non-coord viewers — dm-aside mount itself
   * is also coord-gated upstream.  Flattens all per-PC proposals
   * into a single list with label resolutions.
   */
  private buildPendingBondProposalsForDmAside(): Array<
    import('./ui/regions/dm-aside').DmAsideBondProposal
  > {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return [];
    if (!this.isCoordinator()) return [];
    const out: Array<
      import('./ui/regions/dm-aside').DmAsideBondProposal
    > = [];
    for (const [pcId, proposals] of Object.entries(
      v.shared.pcBondProposals ?? {}
    )) {
      const pcLabel = this.resolvePcDisplayLabel(pcId);
      for (const p of proposals) {
        // D5.5-B: a chargen placeholder bond has targetPcId === ''
        // + a free-text targetPlaceholder.  Surface the player's
        // typed target (otherwise invisible) + flag it unresolved
        // so the DM resolves it to a real PC at ratify.
        const isPlaceholder =
          p.targetPcId.length === 0 &&
          (p.targetPlaceholder?.length ?? 0) > 0;
        const spoilerHits = this.bondTextSpoilerHits(
          p.text,
          p.targetPlaceholder
        );
        out.push({
          id: p.id,
          pcId,
          pcLabel,
          targetLabel: isPlaceholder
            ? (p.targetPlaceholder as string)
            : this.resolvePcDisplayLabel(p.targetPcId),
          unresolved: isPlaceholder,
          text: p.text,
          proposedByPeerId: p.proposedByPeerId,
          ts: p.ts,
          ...(spoilerHits.length > 0 ? { spoilerHits } : {})
        });
      }
    }
    // Sort by ts ascending — oldest pending first (FIFO queue).
    // D5-cleanup-2 fix: was `a.id.localeCompare(b.id)` which
    // gave random order since bond ids are random hex.
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  /**
   * D5-C-fix (2026-05-27): pending bond proposal count for a PC.
   * Reads from `v.shared.pcBondProposals` (NOT filteredShared —
   * the player needs to see THEIR OWN pending count even though
   * filterForViewer wipes the map for non-coord shared
   * projection).  Acceptable per Q-LT4: this read is gated by
   * the controllerPeerId check at the next layer; only the
   * local player's own pending count flows through.
   *
   * Coord viewers see the full count for any PC.  Non-coord
   * viewers only see the count when the local peer controls the
   * seat.
   */
  private pendingBondProposalCount(pcId: string): number {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return 0;
    if (!this.isCoordinator()) {
      // Player branch: only show count for their own PC.
      let controlsSeat = false;
      for (const seat of Object.values(v.shared.pcSlots)) {
        if (seat.pcId === pcId && seat.controllerPeerId === v.peerId) {
          controlsSeat = true;
          break;
        }
      }
      if (!controlsSeat) return 0;
    }
    return v.shared.pcBondProposals?.[pcId]?.length ?? 0;
  }

  /**
   * D5-D (2026-05-27): pending-bond counts keyed by pcId.  Used by
   * `<chargen-dm-review>` to surface a "N pending bonds" pip on
   * each accepted slot card so the DM sees the work waiting
   * alongside backstory review.  Coord-only by design (the
   * chargen-dm-review surface is coord-mounted upstream).
   */
  private pendingBondCountsByPcId(): Record<string, number> {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return {};
    if (!this.isCoordinator()) return {};
    const out: Record<string, number> = {};
    for (const [pcId, proposals] of Object.entries(
      v.shared.pcBondProposals ?? {}
    )) {
      if (proposals.length > 0) out[pcId] = proposals.length;
    }
    return out;
  }

  private bondTargetCandidates(
    selfPcId: string
  ): Array<{ pcId: string; name: string }> {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return [];
    // D5-cleanup-2 (2026-05-27 scenario UX-5): exclude PCs the
    // viewer's PC has ALREADY bonded to (outbound, ratified or
    // pending).  Pre-fix the player could submit "Iris → Hadrian"
    // twice with different text and the engine accepted both
    // rows — reads as sloppy/buggy.  Filter by existing target
    // ids; the player can still remove + re-add to change a bond.
    const existingTargets = new Set<string>();
    const outboundRatified = v.filteredShared.pcBonds?.[selfPcId] ?? [];
    for (const b of outboundRatified) existingTargets.add(b.targetPcId);
    // Pending proposals only visible to coord viewers (D5-3) or
    // the controlling player.  Read from shared state when
    // appropriate; the union is the source-of-truth for the
    // "already used" set.
    const proposals = v.shared.pcBondProposals?.[selfPcId] ?? [];
    let canSeeOwnProposals = this.isCoordinator();
    if (!canSeeOwnProposals) {
      for (const seat of Object.values(v.shared.pcSlots)) {
        if (seat.pcId === selfPcId && seat.controllerPeerId === v.peerId) {
          canSeeOwnProposals = true;
          break;
        }
      }
    }
    if (canSeeOwnProposals) {
      for (const p of proposals) existingTargets.add(p.targetPcId);
    }
    const out: Array<{ pcId: string; name: string }> = [];
    for (const seat of Object.values(v.filteredShared.pcSlots)) {
      if (seat.state !== 'bound-active') continue;
      const pcId = seat.pcId;
      if (!pcId || pcId === selfPcId) continue;
      if (existingTargets.has(pcId)) continue;
      const record = v.filteredShared.synthesizedPcs?.[pcId];
      const name = (record?.name as string | undefined) ?? pcId;
      out.push({ pcId, name });
    }
    return out;
  }

  removeBond(opts: { pcId: string; id: string }): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const proposals = v.shared.pcBondProposals?.[opts.pcId] ?? [];
    const ratified = v.shared.pcBonds?.[opts.pcId] ?? [];
    const inProposals = proposals.some((p) => p.id === opts.id);
    const inRatified = ratified.some((b) => b.id === opts.id);
    if (!inProposals && !inRatified) return false;
    this.session.append('bond-remove', {
      v: 1,
      id: opts.id,
      pcId: opts.pcId
    });
    return true;
  }

  /**
   * Phase 3a Cluster E step 2/6: the unified DM-review region —
   * subsumes the prior `<seat-strip>` + `<invite-manager>` mounts.
   * Lazy-mounts the module on first DM render.
   */
  private renderChargenDmReviewLazy(
    pcSlots: Record<number, Seat>
  ): TemplateResult | typeof nothing {
    void this.chargen.loadDmReviewRegion();
    if (!this.chargen.dmReviewRegionDefined) return nothing;
    const campaign = this.getCurrentCampaign();
    return html`
      <chargen-dm-review
        .pcSlots=${pcSlots}
        .synthResults=${this.chargenSynthResultsView()}
        .synthInFlight=${this.chargenSynthInFlightView()}
        .acceptedSlots=${this.chargenAcceptedSlotsView()}
        .pendingBondCounts=${this.pendingBondCountsByPcId()}
        .displayNameLookup=${(pcId: string) =>
          this.chargen.displayNameForBound(pcId)}
        .answersLookup=${(slot: number) =>
          this.chargen.loadPersistedAnswers(slot)}
        .questions=${campaign?.base.manifest.characterCreation?.questions ??
        []}
        .onGenerate=${(slot: number) => this.chargen.generateInviteUrl(slot)}
        .onSynthesize=${(slot: number) =>
          this.chargen.synthesizeForSlot(slot, {
            playerDisplayName: this.displayNameDraft || undefined
          })}
        .onImportPack=${(slot: number, raw: string) =>
          this.chargen.importPackFromText(raw, slot)}
        .onQuickGenerate=${(
          slot: number,
          opts: { name: string; hook: string }
        ) =>
          this.chargen.synthesizeForSlot(slot, {
            playerDisplayName: this.displayNameDraft || undefined,
            // DM's name + hook become the synthesizer's dmConstraints
            // anchor.  The AI uses 'name' as the canonical PC name and
            // 'hook' as the concept it builds the backstory around.
            // No persisted player answers needed — inlineAnswers: {}
            // routes through the existing campaign-context + AI flow
            // without complaining about missing localStorage state.
            dmConstraints:
              `Use the name "${opts.name}" for the PC.  ` +
              `Core concept (DM-supplied because no player answers exist): ${opts.hook}`,
            inlineAnswers: {}
          })}
        .onAccept=${(slot: number, expectedResponseId?: string) =>
          this.chargen.acceptSlot(slot, expectedResponseId)}
        .onAcceptWithEdits=${(
          slot: number,
          edits: { name: string; backstory: string }
        ) => this.chargen.acceptWithEdits(slot, edits)}
        .onAddSeat=${() => this.chargen.addSeat()}
        .onRemoveSeat=${(slot: number) => this.chargen.removeSeat(slot)}
        .onReaddSeat=${(slot: number) => this.chargen.readdSeat(slot)}
        .seatCap=${this.currentSeatCap()}
        .onEditPreAccept=${(
          slot: number,
          patch: Partial<
            import('./ai/schema').PcBackstorySynthesisResponse
          >
        ) => this.chargen.editSynthFieldPreAccept(slot, patch)}
        .onDismissDrift=${(
          slot: number,
          field: keyof import('./ai/schema').PcBackstorySynthesisResponse
        ) => this.chargen.dismissPreAcceptDrift(slot, field)}
        .onPatchInPlace=${(slot: number) => this.chargen.patchInPlace(slot)}
        .onResyncBackstory=${async (slot: number) => {
          await this.chargen.resyncBackstoryForSlot(slot);
        }}
        .pronounPatchedSlots=${this.chargen.pronounPatchedSlotsSet()}
        .resyncInFlight=${this.chargen.resyncInFlightSet()}
        .resyncFailures=${this.chargen.resyncFailuresMap()}
        .acceptRaceMismatch=${this.chargen.acceptRaceMismatchSet()}
        .onDismissAcceptRaceMismatch=${(slot: number) =>
          this.chargen.clearAcceptRaceMismatch(slot)}
        .onDismissResyncFailure=${(slot: number) =>
          this.chargen.dismissResyncFailure(slot)}
        .joiningSession=${this.chargen.joiningSessionMap()}
        .onSetJoiningSession=${(slot: number, n: number) =>
          this.chargen.setJoiningSessionForSlot(slot, n)}
        .onDismissPronounPatchHint=${(slot: number) =>
          this.chargen.dismissPronounPatchHint(slot)}
        .onRetirePc=${(payload: {
          pcId: string;
          inFictionReason: string;
          reason: 'died' | 'departed' | 'converted-to-npc' | 'other';
          scene?: string;
          seatMemory?: string;
        }) => this.appendPcRetire(payload)}
        .preAcceptDrift=${this.chargen.preAcceptDriftMap()}
        .onRevise=${(
          slot: number,
          reason: string,
          pinnedQuestionIds?: readonly string[]
        ) =>
          this.chargen.requestReviseSlot(slot, reason, pinnedQuestionIds)}
        .pendingChargenPacks=${this.computePendingChargenPacksMap()}
        .onAcceptChargenPack=${this.isCoordinator()
          ? (senderPeerId: string, slot: number) =>
              this.acceptChargenPack(senderPeerId, slot)
          : null}
        .onDismissChargenPack=${this.isCoordinator()
          ? (senderPeerId: string, slot: number) =>
              this.dismissChargenPack(senderPeerId, slot)
          : null}
        .complementarityHints=${Object.fromEntries(
          this.chargen.complementarityHints
        )}
        .onRequestComplementarityHints=${(slot: number, hookSoFar: string) =>
          void this.chargen.requestComplementarityHintsForSlot(
            slot,
            () => this.buildRosterSnapshot(),
            hookSoFar
          )}
      ></chargen-dm-review>
    `;
  }

  /**
   * Phase B' (2026-05-25): adapter from the new Seat-shaped
   * `pcSlots` to the legacy `PcSlotBindings` (slot → display name)
   * that `substitutePcSlots` consumes.  Caches the result per
   * render frame is unnecessary — caller is a getter inside a Lit
   * template, called once per render.  Uses the chargen
   * controller's displayNameForBound which knows how to find a
   * name for a synthesized OR campaign-shipped PC.
   */
  private currentPcSlotBindings(): Record<number, string> {
    const slots = this.sessionView?.shared.pcSlots;
    if (!slots) return {};
    return pcSlotsToBindings(slots, (pcId) =>
      this.chargen.displayNameForBound(pcId)
    );
  }

  /**
   * Adapter that re-projects the controller's slot state into the
   * Map/Set props the region @property accepts.  Lit treats props
   * as identity-compared for change detection, so we build fresh
   * objects on each render — the controller's mutations don't
   * propagate through reference equality.  Cheap (≤ 9 slots).
   */
  private chargenSynthResultsView(): Map<
    number,
    ReturnType<ChargenController['getSynthResult']>
  > {
    const out = new Map();
    for (const slot of this.chargen.slotsWithSynthState()) {
      const r = this.chargen.getSynthResult(slot);
      if (r) out.set(slot, r);
    }
    return out;
  }
  private chargenSynthInFlightView(): Set<number> {
    const out = new Set<number>();
    for (let slot = 1; slot <= 9; slot++) {
      if (this.chargen.isSynthInFlight(slot)) out.add(slot);
    }
    return out;
  }
  private chargenAcceptedSlotsView(): Set<number> {
    const out = new Set<number>();
    for (const slot of this.chargen.slotsWithSynthState()) {
      if (this.chargen.isAccepted(slot)) out.add(slot);
    }
    return out;
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
    if (!Number.isInteger(slot) || slot < 1 || slot > this.currentSeatCap()) {
      return false;
    }
    this.session.append('pc-slot-bind', { v: 1, slot, pcId });
    return true;
  }

  /**
   * P-R2 (2026-05-25): the effective seat cap for the currently
   * loaded campaign, falling back to the engine default when no
   * campaign is loaded or the campaign doesn't declare one.  This
   * is the single source of truth used by both the host API guards
   * (bindPcSlot, appendSeatAdd) and the UI's "+ add player" verb.
   */
  currentSeatCap(): number {
    return resolveSeatCap(this.getCurrentCampaign()?.base.manifest);
  }

  /**
   * Phase B-prime (2026-05-25): emit a `seat-add` event allocating
   * an unbound seat at `slot`.  Coord-only.  Returns true on
   * append.  Caller (ChargenController.addSeat) computes the
   * lowest-unused integer to pass in.
   */
  appendSeatAdd(slot: number): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!Number.isInteger(slot) || slot < 1) return false;
    // P-R2: cap is now per-campaign (manifest.characterCreation.seatCap)
    // with engine default 9.  Engine accepts arbitrary positive
    // integers; this is the campaign-policy gate.
    if (slot > this.currentSeatCap()) return false;
    this.session.append('seat-add', { v: 1, slot });
    return true;
  }

  /**
   * P-R6 (2026-05-25): emit a `pc-retire` event flipping a bound-
   * active seat to bound-retired with the DM-authored narrative
   * metadata.  Coord-only.  Returns true on append.
   */
  appendPcRetire(payload: {
    pcId: string;
    inFictionReason: string;
    reason: 'died' | 'departed' | 'converted-to-npc' | 'other';
    scene?: string;
    /** #294: optional player-safe "seat memory" one-liner. */
    seatMemory?: string;
  }): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!payload.pcId || payload.pcId.length === 0) return false;
    if (
      typeof payload.inFictionReason !== 'string' ||
      payload.inFictionReason.trim().length === 0
    ) {
      return false;
    }
    const trimmedMemory = payload.seatMemory?.trim() ?? '';
    this.session.append('pc-retire', {
      v: 1,
      pcId: payload.pcId,
      state: 'bound-retired',
      inFictionReason: payload.inFictionReason.trim(),
      reason: payload.reason,
      ...(payload.scene ? { scene: payload.scene } : {}),
      ...(trimmedMemory.length > 0 ? { seatMemory: trimmedMemory } : {})
    });
    return true;
  }

  /**
   * Wave B (2026-05-26): magic-arc DM runtime controls — coord-
   * only event emitters for the four beat-affordances exposed on
   * `<dm-pc-detail>`.  Each returns true on append, false when
   * off-session / non-coord / payload invalid; the UI uses the
   * boolean to decide whether to clear its inline-editor draft.
   *
   * Per TTRPG-expert anti-pattern warning: these accept DM-typed
   * strings only.  Do NOT add an AI auto-suggest wrapper around
   * any of these — the silent-player-firewall principle requires
   * the DM to author silent grants / release moments in their own
   * words.
   */
  appendAccidentalGrantLog(pcId: string, note: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!pcId || pcId.length === 0) return false;
    const trimmed = note.trim();
    if (trimmed.length === 0 || trimmed.length > 200) return false;
    this.session.append('accidental-grant-log', {
      v: 1,
      pcId,
      note: trimmed
    });
    return true;
  }

  /**
   * Wave B: one-click Realization-beat affordance.  Multi-field
   * pc-edit batch — flips knowsTheyCanCast=true + sets
   * magicPhase=realization + activates the trying-too-hard tax
   * with 3 sessions remaining (rules.md:180-184 default).  The DM
   * narrates the beat in fiction first; this is the bookkeeping
   * after.
   *
   * Implementation: sends a sequence of pc-edit events (one per
   * field) since pc-edit currently carries one field per event.
   * Each event applied in log order; final shared state is the
   * union per LWW semantics on each field.
   */
  appendMarkRealization(pcId: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!pcId || pcId.length === 0) return false;
    // Wave D-prep-2 (2026-05-26): atomic single-event emit.
    // Pre-fix this method fired 4 sequential pc-edit events; a
    // network drop mid-batch left half-applied state (player told
    // they can cast but tax not active, or vice versa) on the
    // one-way Realization gate.  Single materializer call now
    // guarantees all-or-nothing.  Default taxSessions=3 per
    // rules.md:180-184.
    this.session.append('pc-mark-realization', {
      v: 1,
      pcId
    });
    return true;
  }

  /**
   * Wave B: grant a focus to a PC.  Coord-only; append-only.
   * Player-visible by design — once granted, the player's rail
   * surfaces the focus (rules.md:139).  Caller-side gate in the
   * UI ensures magicPhase >= 'realization' before this fires;
   * the engine doesn't check phase (campaigns may want to grant
   * a focus mid-Accidental for narrative reasons — the campaign-
   * policy boundary applies, not engine policy).
   */
  appendFocusGrant(
    pcId: string,
    focus: {
      name: string;
      domain?: string;
      condition?: string;
      notes?: string;
      status?: 'active' | 'broken' | 'faded' | 'corrupted' | 'transformed';
      boundFor?: string;
    }
  ): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!pcId || pcId.length === 0) return false;
    const name = focus.name?.trim();
    if (!name || name.length === 0 || name.length > 80) return false;
    const payloadFocus: typeof focus = { name };
    if (focus.domain && focus.domain.trim().length > 0) {
      payloadFocus.domain = focus.domain.trim();
    }
    if (focus.condition && focus.condition.trim().length > 0) {
      payloadFocus.condition = focus.condition.trim();
    }
    if (focus.notes && focus.notes.trim().length > 0) {
      payloadFocus.notes = focus.notes.trim();
    }
    if (focus.status !== undefined) payloadFocus.status = focus.status;
    if (focus.boundFor && focus.boundFor.trim().length > 0) {
      payloadFocus.boundFor = focus.boundFor.trim();
    }
    this.session.append('focus-grant', {
      v: 1,
      pcId,
      focus: payloadFocus
    });
    return true;
  }

  /**
   * Wave B: release the trying-too-hard tax in fiction (rules.md:182).
   * Coord-only.  Drops tax.active to false and records the DM-
   * authored release moment as a player-safe label.  The release
   * IS a fiction beat — narrate first, click after.
   *
   * **Note (Verifier N5):** this is the CANONICAL termination
   * path for the tax.  No engine-level decay decrements
   * `tax.sessionsRemaining` automatically; the DM either releases
   * here OR pc-edits the field manually if the campaign uses a
   * different cadence.  A session-end auto-decrement could land
   * in a future wave but is intentionally out of scope today.
   */
  appendReleaseTax(pcId: string, releaseMoment: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!pcId || pcId.length === 0) return false;
    const trimmed = releaseMoment.trim();
    if (trimmed.length === 0 || trimmed.length > 200) return false;
    this.session.append('pc-edit', {
      v: 1,
      pcId,
      field: 'tax.active',
      value: false
    });
    this.session.append('pc-edit', {
      v: 1,
      pcId,
      field: 'tax.releaseMoment',
      value: trimmed
    });
    return true;
  }

  /**
   * #294 (2026-05-26): coord-only seat-memory edit on a retired or
   * archived seat.  Empty string clears the memory.  Returns true on
   * append; refuses (returns false) when off-session / non-coord /
   * the slot is missing / the slot isn't in a terminal state.
   */
  appendSeatMemoryEdit(slot: number, text: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!Number.isInteger(slot) || slot < 1) return false;
    if (typeof text !== 'string' || text.length > 200) return false;
    // Verifier S1 fix: skip the no-op append when the DM opens the
    // editor on a seat with no memory, types nothing, and hits Save.
    // Empty-on-empty would otherwise broadcast a noise event and a
    // tiny info-leak (peers see "DM opened/closed the memory editor
    // on slot N").  Returns true so the UI still treats the call as
    // a successful commit (closes the editor).
    const current = v.filteredShared.pcSlots[slot]?.seatMemory ?? '';
    if (current.length === 0 && text.length === 0) return true;
    this.session.append('seat-memory-edit', { v: 1, slot, text });
    return true;
  }

  /**
   * D4 (2026-05-26): generate an AI-drafted session-recap.  Pure
   * read on the local event log + a single broker call; returns
   * the parsed markdown.  Does NOT emit any event — the caller
   * (DM) reviews/edits the draft + calls `appendSessionDigest`
   * to commit.
   *
   * Throws (returns null with a typed reason) when:
   *   - no session is active, or local viewer isn't coord
   *   - no AI key is set
   *   - the provider declines or errors
   *   - no qualifying events to digest
   *
   * Per practice memo + the silent-player-firewall:
   *   - The input bundle is PRE-FILTERED to player-visible event
   *     kinds (SESSION_DIGEST_INPUT_KINDS).  DM-only events
   *     (scratch-note, ai-prompt, accidental-grant-log, etc.)
   *     never reach the prompt.
   *   - The DRAFT is returned to the caller LOCALLY (no event
   *     emit).  Until the DM clicks Save, no peer sees the draft.
   *   - The AI is allowed to draft, but the DM gates the save.
   */
  async generateSessionDigest(opts?: {
    dmGuidance?: string;
    signal?: AbortSignal;
  }): Promise<
    | { ok: true; markdown: string; responseId: string }
    | { ok: false; code: 'no-session' | 'no-coord' | 'no-key' | 'no-events' | 'provider-error' | 'provider-refused' | 'aborted'; message: string }
  > {
    const v = this.sessionView;
    if (!v || v.status !== 'active') {
      return { ok: false, code: 'no-session', message: 'No active session.' };
    }
    if (!this.isCoordinator()) {
      return { ok: false, code: 'no-coord', message: 'Only the coord (DM) can generate a digest.' };
    }
    if (!this.aiApiKey || this.aiApiKey.length === 0) {
      return { ok: false, code: 'no-key', message: 'Set your AI API key first.' };
    }
    // Bundle = events with kind in the allowlist that happened
    // AFTER the most recent prior digest (or all of them, if no
    // prior digest exists).  Reads the live event log via the
    // session controller — the most authoritative source.
    const lastDigest =
      v.filteredShared.sessionDigests[
        v.filteredShared.sessionDigests.length - 1
      ];
    const cutoff = lastDigest?.ts ?? 0;
    const sessionStartTs = cutoff;
    const allEvents = this.session?.getEvents() ?? [];
    // Sub-field DM-only firewall: pc-edit is allowlisted (player-
    // visible fields like name + harm + stress feed the recap), but
    // a pc-edit touching a DM-only top-level field must NOT reach
    // the AI prompt — the markdown the DM saves becomes a player-
    // visible event, and DM-only scaffolding would routinely
    // surface in the draft.  Uses the shared
    // `isDmOnlyCharacterFieldPath` predicate (same one
    // `scrubEventForPlayer` in persistence.ts uses for player
    // autosaves).
    const bundledRaw = allEvents.filter((e) => {
      if (e.ts <= cutoff) return false;
      if (!SESSION_DIGEST_INPUT_KINDS.has(e.kind)) return false;
      if (e.kind === 'pc-edit') {
        const field = (e.payload as Record<string, unknown> | undefined)?.field;
        if (isDmOnlyCharacterFieldPath(field)) return false;
      }
      return true;
    });
    // D4-cleanup-4 (Adversarial A-1): pc-retire / pc-archive
    // payloads carry DM-private `reason` enum + `scene`.  The
    // summarizer narrows to pcId + inFictionReason today so nothing
    // leaks in practice, but the firewall would be implicit in the
    // summarizer's shape — one refactor that JSON-stringifies the
    // payload and the DM-private fields ride into the prompt.
    // Strip at the bundling stage so the firewall is structural.
    const bundled = bundledRaw.map((e) => {
      if (e.kind !== 'pc-retire' && e.kind !== 'pc-archive') return e;
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const { reason: _reason, scene: _scene, ...safe } = p;
      return { ...e, payload: safe };
    });
    if (bundled.length === 0) {
      return {
        ok: false,
        code: 'no-events',
        message:
          'No qualifying events since the last digest.  Nothing to recap.'
      };
    }
    // Campaign anchor — name + current episode/scene slug if any.
    const campaign = this.getCurrentCampaign();
    const campaignContext: {
      name?: string;
      currentEpisode?: string;
      currentScene?: string;
    } = {};
    if (campaign?.base.manifest.name) {
      campaignContext.name = campaign.base.manifest.name;
    }
    if (this.appState.kind === 'episode' || this.appState.kind === 'scene') {
      campaignContext.currentEpisode = this.appState.episode.slug;
    }
    if (this.appState.kind === 'scene') {
      campaignContext.currentScene = this.appState.scene.path;
    }
    const { system, user } = buildSessionDigestPrompt({
      events: bundled,
      campaignContext,
      ...(opts?.dmGuidance ? { dmGuidance: opts.dmGuidance } : {}),
      ...(lastDigest?.markdown
        ? { priorDigestMarkdown: lastDigest.markdown }
        : {})
    });
    const provider = this.aiProviders[this.aiProvider];
    try {
      const result = await provider.callStructured<{ markdown: string }>(
        {
          apiKey: this.aiApiKey,
          model: this.aiModel,
          systemPrompt: system,
          prompt: user,
          ...(opts?.signal ? { signal: opts.signal } : {})
        },
        SESSION_DIGEST_CALL_SCHEMA
      );
      if (!result.ok) {
        return {
          ok: false,
          code:
            result.refusal.kind === 'provider-error'
              ? 'provider-error'
              : 'provider-refused',
          message: result.refusal.message
        };
      }
      const markdown =
        typeof result.value?.markdown === 'string'
          ? result.value.markdown
          : '';
      if (markdown.length === 0) {
        return {
          ok: false,
          code: 'provider-error',
          message: 'Provider returned empty markdown.'
        };
      }
      // Remember the session-start boundary so the save can
      // record what range this digest covers.
      this._pendingDigestSessionStartTs = sessionStartTs;
      return { ok: true, markdown, responseId: result.responseId };
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { ok: false, code: 'aborted', message: 'Generation cancelled.' };
      }
      return {
        ok: false,
        code: 'provider-error',
        message: `Provider call failed: ${(e as Error).message}`
      };
    }
  }

  /**
   * D4 (2026-05-26): commit a (possibly DM-edited) session-recap
   * to the shared event log.  Coord-only.  `sessionStartTs` and
   * `generatedByResponseId` are taken from the most-recent
   * `generateSessionDigest` call when available; the DM hand-
   * writing a digest from scratch can pass `0` + no responseId.
   */
  appendSessionDigest(
    markdown: string,
    opts?: { sessionStartTs?: number; generatedByResponseId?: string }
  ): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const trimmed = markdown.trim();
    if (trimmed.length === 0 || trimmed.length > 20_000) return false;
    const sessionStartTs =
      opts?.sessionStartTs ?? this._pendingDigestSessionStartTs ?? 0;
    this.session.append('session-digest', {
      v: 1,
      sessionStartTs,
      markdown: trimmed,
      ...(opts?.generatedByResponseId
        ? { generatedByResponseId: opts.generatedByResponseId }
        : {})
    });
    // Clear the pending bookkeeping; a re-generation will set it
    // again.
    this._pendingDigestSessionStartTs = undefined;
    return true;
  }

  /** Bookkeeping for the most-recent `generateSessionDigest`
   *  call — used when the DM hits Save to record the start
   *  boundary of the recap window.  Cleared on save. */
  private _pendingDigestSessionStartTs: number | undefined = undefined;

  /**
   * D1-D (2026-05-26): per-app WorkingCopy for living-doc edits.
   * Lazy-init to keep the constructor light; the IDB connection
   * opens on first use (first proposal-accept).  Test injection:
   * pass via the static factory below (kept as a field, not a
   * constructor arg, so QuireApp stays a zero-arg LitElement).
   */
  private _workingCopy: WorkingCopy | null = null;
  /** Test seam — assign to override the default IDB-backed store. */
  workingCopyStoreFactory: (() => WorkingCopyStore) | null = null;
  private getWorkingCopy(): WorkingCopy {
    if (!this._workingCopy) {
      const store = this.workingCopyStoreFactory
        ? this.workingCopyStoreFactory()
        : new IndexedDbWorkingCopyStore();
      this._workingCopy = new WorkingCopy(store);
    }
    return this._workingCopy;
  }

  /**
   * D1-D (2026-05-26): ask the AI broker to propose NPC living-doc
   * updates based on the current session.  Coord-only.  The host
   * gathers the player-visible event bundle (same filter as
   * session-digest), the loaded NPC files (full content including
   * dmNotes per Adversarial B-2 — broadcast firewall happens at
   * accept time), and the most-recent session-digest (D4) as
   * framing context.  Proposals returned by the AI are validated
   * + appended via `proposal-create` events (DM-private; co-DM
   * replication via the event log).
   *
   * Returns: typed result with the count of validated proposals
   * appended, or a failure code the UI surfaces.  Does NOT write
   * anything to the WorkingCopy — that happens on accept.
   */
  async generateDiffProposals(opts?: {
    dmGuidance?: string;
    signal?: AbortSignal;
  }): Promise<
    | { ok: true; created: number; responseId: string }
    | {
        ok: false;
        code:
          | 'no-session'
          | 'no-coord'
          | 'no-key'
          | 'no-events'
          | 'no-npcs'
          | 'provider-error'
          | 'provider-refused'
          | 'aborted';
        message: string;
      }
  > {
    const v = this.sessionView;
    if (!v || v.status !== 'active') {
      return { ok: false, code: 'no-session', message: 'No active session.' };
    }
    if (!this.isCoordinator()) {
      return {
        ok: false,
        code: 'no-coord',
        message: 'Only the coord (DM) can generate proposals.'
      };
    }
    if (!this.aiApiKey || this.aiApiKey.length === 0) {
      return { ok: false, code: 'no-key', message: 'Set your AI API key first.' };
    }
    // Bundle player-visible events since the most-recent digest (or
    // session start) — same window as the digest itself.  D-prep-2-A
    // / D4-cleanup-3 firewall via filterEventsForDiffProposal.
    const lastDigest =
      v.filteredShared.sessionDigests[
        v.filteredShared.sessionDigests.length - 1
      ];
    const cutoff = lastDigest?.ts ?? 0;
    const allEvents = this.session?.getEvents() ?? [];
    const bundled = filterEventsForDiffProposal(
      allEvents.filter((e) => e.ts > cutoff)
    );
    if (bundled.length === 0) {
      return {
        ok: false,
        code: 'no-events',
        message: 'No qualifying events since the last digest.'
      };
    }
    // Collect NPC files: fetch every NPC listed in the campaign
    // manifest.  No cache — runs once per Generate click; the
    // latency cost is one-shot and the DM is gated on AI output
    // anyway.  Fetch failures are silently skipped (a malformed
    // NPC file shouldn't block the whole diff-review).
    const campaign = this.getCurrentCampaign();
    const npcIds = campaign?.base.manifest.characters?.npcs ?? [];
    const npcs: NpcContext[] = [];
    if (campaign) {
      for (const npcId of npcIds) {
        try {
          const loaded = await loadCharacter(
            campaign.base.source,
            'npc',
            npcId
          );
          npcs.push({
            npcId,
            path: `characters/npcs/${npcId}.json`,
            record: loaded.record as unknown as Record<string, unknown>
          });
        } catch {
          // Silently skip — one bad NPC file shouldn't block the diff.
        }
      }
    }
    if (npcs.length === 0) {
      return {
        ok: false,
        code: 'no-npcs',
        message: 'Campaign has no NPCs to propose updates against.'
      };
    }
    const campaignContext: {
      name?: string;
      currentEpisode?: string;
      currentScene?: string;
    } = {};
    if (campaign?.base.manifest.name) {
      campaignContext.name = campaign.base.manifest.name;
    }
    if (this.appState.kind === 'episode' || this.appState.kind === 'scene') {
      campaignContext.currentEpisode = this.appState.episode.slug;
    }
    if (this.appState.kind === 'scene') {
      campaignContext.currentScene = this.appState.scene.path;
    }
    const { system, user } = buildDiffProposalPrompt({
      events: bundled,
      npcs,
      campaignContext,
      ...(lastDigest?.markdown
        ? { sessionDigestMarkdown: lastDigest.markdown }
        : {}),
      ...(opts?.dmGuidance ? { dmGuidance: opts.dmGuidance } : {})
    });
    const provider = this.aiProviders[this.aiProvider];
    try {
      const result = await provider.callStructured<{ proposals: unknown[] }>(
        {
          apiKey: this.aiApiKey,
          model: this.aiModel,
          systemPrompt: system,
          prompt: user,
          ...(opts?.signal ? { signal: opts.signal } : {})
        },
        DIFF_PROPOSAL_CALL_SCHEMA
      );
      if (!result.ok) {
        return {
          ok: false,
          code:
            result.refusal.kind === 'provider-error'
              ? 'provider-error'
              : 'provider-refused',
          message: result.refusal.message
        };
      }
      const raw = Array.isArray(result.value?.proposals)
        ? result.value!.proposals
        : [];
      let created = 0;
      for (const item of raw) {
        const obj = item as Partial<DiffProposal> & Record<string, unknown>;
        const proposal: DiffProposal = {
          id: typeof obj.id === 'string' ? obj.id : '',
          kind: 'npc-update',
          npcId: typeof obj.npcId === 'string' ? obj.npcId : '',
          path: `characters/npcs/${typeof obj.npcId === 'string' ? obj.npcId : ''}.json`,
          field: typeof obj.field === 'string' ? obj.field : '',
          before: obj.before,
          after: obj.after,
          rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
          ...(Array.isArray(obj.sourceEventIds)
            ? { sourceEventIds: obj.sourceEventIds.filter((s): s is string => typeof s === 'string') }
            : {})
        };
        // Attach the baseSha from the NPC we proposed against, when
        // available — lets the apply step do staleness detection.
        // (NpcContext.baseSha is optional today; D5/M5 will wire git
        // SHAs through the loader.)
        const npcCtx = npcs.find((n) => n.npcId === proposal.npcId);
        if (npcCtx?.baseSha) proposal.baseSha = npcCtx.baseSha;
        const v2 = validateDiffProposalShape(proposal);
        if (!v2.ok) continue; // Drop malformed AI output silently.
        this.session?.append('proposal-create', {
          v: 1,
          id: proposal.id,
          kind: proposal.kind,
          npcId: proposal.npcId,
          path: proposal.path,
          field: proposal.field,
          before: proposal.before,
          after: proposal.after,
          rationale: proposal.rationale,
          ...(proposal.sourceEventIds
            ? { sourceEventIds: proposal.sourceEventIds }
            : {}),
          ...(proposal.baseSha ? { baseSha: proposal.baseSha } : {})
        });
        created++;
      }
      return { ok: true, created, responseId: result.responseId };
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { ok: false, code: 'aborted', message: 'Generation cancelled.' };
      }
      return {
        ok: false,
        code: 'provider-error',
        message: (e as Error).message
      };
    }
  }

  /**
   * D1-D (2026-05-26): accept a pending proposal.  Writes the
   * resolved `after` value to the WorkingCopy + emits
   * `proposal-accept` (which removes it from the pending queue
   * via the materializer).  Returns a typed result so the UI can
   * surface stale-base-sha vs other failures.
   *
   * `editedAfter` is the DM's possibly-modified version of the
   * AI's proposed `after` — if undefined, the original is used.
   */
  async acceptDiffProposal(
    id: string,
    editedAfter?: unknown
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        code: 'no-session' | 'no-coord' | 'not-found' | 'apply-failed';
        message: string;
      }
  > {
    const v = this.sessionView;
    if (!v || v.status !== 'active') {
      return { ok: false, code: 'no-session', message: 'No active session.' };
    }
    if (!this.isCoordinator()) {
      return { ok: false, code: 'no-coord', message: 'DM-only.' };
    }
    const pending = v.shared.diffProposals.find((p) => p.id === id);
    if (!pending) {
      return { ok: false, code: 'not-found', message: `proposal ${id} is not pending` };
    }
    const proposal: DiffProposal = {
      id: pending.id,
      kind: pending.kind,
      npcId: pending.npcId,
      path: pending.path,
      field: pending.field,
      before: pending.before,
      after: editedAfter !== undefined ? editedAfter : pending.after,
      rationale: pending.rationale,
      ...(pending.sourceEventIds ? { sourceEventIds: pending.sourceEventIds } : {}),
      ...(pending.baseSha ? { baseSha: pending.baseSha } : {})
    };
    // Seed fallbackJson from the loaded NPC file so the WC apply
    // works even on a fresh WC entry (the loader is the source of
    // truth pre-edit; the WC is the staging area post-edit).
    const campaign = this.getCurrentCampaign();
    let fallbackJson: string | undefined;
    if (campaign) {
      try {
        const loaded = await loadCharacter(
          campaign.base.source,
          'npc',
          pending.npcId
        );
        fallbackJson = JSON.stringify(loaded.record, null, 2) + '\n';
      } catch {
        // Will fall through to the WC's existing entry if any.
      }
    }
    const wc = this.getWorkingCopy();
    const applyResult = await applyProposalToWorkingCopy(
      proposal,
      wc,
      fallbackJson ? { fallbackJson } : undefined
    );
    if (!applyResult.ok) {
      return {
        ok: false,
        code: 'apply-failed',
        message: `${applyResult.code}: ${applyResult.message}`
      };
    }
    this.session?.append('proposal-accept', {
      v: 1,
      id: pending.id,
      resolvedAfter: proposal.after
    });
    return { ok: true };
  }

  /**
   * D1-D (2026-05-26): reject a pending proposal.  Emits
   * `proposal-reject` (materializer removes from queue).  No WC
   * side-effect.
   */
  rejectDiffProposal(id: string, opts?: { reason?: string }): boolean {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return false;
    if (!this.isCoordinator()) return false;
    if (!v.shared.diffProposals.some((p) => p.id === id)) return false;
    this.session?.append('proposal-reject', {
      v: 1,
      id,
      ...(opts?.reason ? { reason: opts.reason } : {})
    });
    return true;
  }

  /**
   * P-R6 (2026-05-25): emit a `pc-archive` event flipping a seat
   * (bound-active or bound-retired) to bound-archived.  Same shape
   * as pc-retire; the engine routes both to one materializer.
   */
  appendPcArchive(payload: {
    pcId: string;
    inFictionReason: string;
    reason: 'died' | 'departed' | 'converted-to-npc' | 'other';
    scene?: string;
  }): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!payload.pcId || payload.pcId.length === 0) return false;
    if (
      typeof payload.inFictionReason !== 'string' ||
      payload.inFictionReason.trim().length === 0
    ) {
      return false;
    }
    this.session.append('pc-archive', {
      v: 1,
      pcId: payload.pcId,
      state: 'bound-archived',
      inFictionReason: payload.inFictionReason.trim(),
      reason: payload.reason,
      ...(payload.scene ? { scene: payload.scene } : {})
    });
    return true;
  }

  /**
   * #254 (2026-05-26): build the roster snapshot the AI
   * complementarity-hints helper consumes.  Coord-only (callers
   * gate on isCoordinator); pulls every bound-active PC from
   * shared state + summarizes stats as a dominant axis.
   *
   * "Dominant stat" is computed as the largest absolute value
   * (positive or negative) — a -2 INT is as character-defining as
   * a +2 STR.  Ties resolve to the first stat in declaration order
   * so the result is deterministic.
   */
  private buildRosterSnapshot(): import('./ai/complementarity-hints').RosterSnapshot {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return { pcs: [] };
    const pcs: import('./ai/complementarity-hints').RosterSnapshot['pcs'] = [];
    // Wave A3 (2026-05-26) firewall hardening: AI prompt assembly
    // MUST read from filteredShared so a non-coord caller's
    // complementarity-hints request can never push DM-only fields
    // (magicPhase / knowsTheyCanCast / tax) into the prompt.
    // Identity fast-path for the DM keeps behavior unchanged.
    for (const seat of Object.values(v.filteredShared.pcSlots)) {
      if (seat.state !== 'bound-active') continue;
      const pcId = seat.pcId;
      if (!pcId) continue;
      const record = v.filteredShared.synthesizedPcs[pcId];
      if (!record) continue;
      const stats = record.stats ?? {};
      const order: Array<['STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA', number]> = [
        ['STR', stats.str ?? 0],
        ['DEX', stats.dex ?? 0],
        ['CON', stats.con ?? 0],
        ['INT', stats.int ?? 0],
        ['WIS', stats.wis ?? 0],
        ['CHA', stats.cha ?? 0]
      ];
      let domLabel: string = 'balanced';
      let domMag = 0;
      for (const [label, value] of order) {
        const mag = Math.abs(value);
        if (mag > domMag) {
          domMag = mag;
          domLabel = label;
        }
      }
      if (domMag === 0) domLabel = 'balanced';
      // The first tag is usually the role-defining one.  Limit to
      // 5 so the AI prompt stays compact.
      const tags = Array.isArray(record.tags)
        ? record.tags.slice(0, 5).filter((t) => typeof t === 'string')
        : [];
      const archetype = tags[0] ?? 'unspecified';
      pcs.push({
        name: typeof record.name === 'string' ? record.name : pcId,
        archetype,
        dominantStat: domLabel,
        tags
      });
    }
    return { pcs };
  }

  /**
   * #253 (2026-05-26): compute the slot→PendingPack map for the
   * chargen-dm-review surface.  Coord-only (the materializer
   * already strips for non-coord viewers; redundant gate here
   * keeps the player-side rendering of chargen-dm-review honest
   * even if the DM's UI ever reuses this method outside the
   * coord-only render path).
   *
   * Resolves senderPeerId → display name once per build so the
   * pip reads "Pack from Bob" rather than the raw peer id.
   */
  private computePendingChargenPacksMap(): Record<
    number,
    { senderPeerId: string; senderPeerName: string; packedAt: number }
  > {
    const out: Record<
      number,
      { senderPeerId: string; senderPeerName: string; packedAt: number }
    > = {};
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return out;
    for (const entry of v.shared.pendingChargenPacks) {
      // LWW: if multiple entries for the same slot somehow exist
      // (shouldn't, by sticky-N), the later one wins.
      const prior = out[entry.slot];
      if (prior && prior.packedAt >= entry.ts) continue;
      out[entry.slot] = {
        senderPeerId: entry.senderPeerId,
        senderPeerName: this.displayNameFor(entry.senderPeerId),
        packedAt: entry.ts
      };
    }
    return out;
  }

  /**
   * #253 (2026-05-26): player-authored chargen-pack-deliver
   * dispatch.  Coord-not-required (deliberate — chargen flow
   * authoring is player-side).  Silent no-op outside an active
   * session.  The materializer enforces shape + size limits
   * defense-in-depth.
   */
  appendChargenPackDeliver(
    slot: number,
    pack: import('./chargen-pack').ChargenPackDocument
  ): boolean {
    if (!this.session) return false;
    if (this.sessionView?.status !== 'active') return false;
    if (!Number.isInteger(slot) || slot < 1) return false;
    this.session.append('chargen-pack-deliver', { v: 1, slot, pack });
    return true;
  }

  /**
   * #253: coord-only dispatcher for `chargen-pack-clear`.  Used
   * by Accept (post-import) and Dismiss paths.  Identified by
   * `(senderPeerId, slot)` to match the materializer's key.
   */
  appendChargenPackClear(senderPeerId: string, slot: number): boolean {
    if (!this.session) return false;
    if (this.sessionView?.status !== 'active') return false;
    if (!this.isCoordinator()) return false;
    if (typeof senderPeerId !== 'string' || senderPeerId.length === 0) {
      return false;
    }
    if (!Number.isInteger(slot) || slot < 1) return false;
    this.session.append('chargen-pack-clear', {
      v: 1,
      senderPeerId,
      slot
    });
    return true;
  }

  /**
   * #253: DM accepts a pending pack — import locally, then emit
   * the clear event only if the import succeeded.  On failure
   * (campaign-mismatch, etc.) the pack stays pending so the DM
   * can fix the underlying issue + retry, OR dismiss explicitly.
   */
  acceptChargenPack(senderPeerId: string, slot: number): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    const entry = v.shared.pendingChargenPacks.find(
      (e) => e.senderPeerId === senderPeerId && e.slot === slot
    );
    if (!entry) return false;
    const result = this.chargen.importPack(entry.pack, slot);
    if (!result.ok) {
      this.transientError = `Import failed: ${result.message}`;
      return false;
    }
    return this.appendChargenPackClear(senderPeerId, slot);
  }

  /**
   * #253: DM dismisses a pending pack without importing.  Emits
   * the clear event directly.
   */
  dismissChargenPack(senderPeerId: string, slot: number): boolean {
    return this.appendChargenPackClear(senderPeerId, slot);
  }

  /**
   * #301 (2026-05-26): allocate the lowest unused slot integer as
   * an UNREVEALED seat (`revealed: false`).  Players never see it
   * until the DM later clicks Reveal on the resulting Active tile
   * (which fires `seat-reveal`).  Coord-only.
   */
  addHiddenSeat(): number | null {
    if (!this.session) return null;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return null;
    const taken = new Set<number>();
    for (const slotStr of Object.keys(v.shared.pcSlots)) {
      taken.add(Number(slotStr));
    }
    let slot = 1;
    while (taken.has(slot)) slot++;
    this.session.append('seat-add', { v: 1, slot, revealed: false });
    return slot;
  }

  /**
   * #301: flip an unrevealed seat to revealed.  Sticky — the engine
   * won't un-reveal a revealed seat through this path; the only
   * way "back to hidden" is removing the seat entirely (rare).
   */
  revealSeat(slot: number): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!Number.isInteger(slot) || slot < 1) return false;
    const seat = v.shared.pcSlots[slot];
    if (!seat || seat.revealed !== false) return false;
    this.session.append('seat-reveal', { v: 1, slot });
    return true;
  }

  /**
   * P-R10 (2026-05-25): promote a campaign NPC to a playable PC.
   * Coord-only.  Fetches the NPC record, allocates the lowest
   * unused slot integer, derives a unique pcId, and emits the
   * canonical pc-create + seat-add + pc-slot-bind triple — same
   * triple chargen accept uses, so the new PC behaves identically
   * to a chargen-synthesized one at every read site.
   *
   * The NPC entry stays in `campaign.characters.npcs` — the DM
   * may want to keep the NPC sheet for parallel narration, or
   * manually retire it.  Future work: a "convert" mode that also
   * removes the NPC from the manifest via M4 living-doc.
   *
   * Returns the allocated slot integer on success, null otherwise.
   * Surfaces failures via `transientError` (the closest existing toast
   * surface for ad-hoc DM-side errors).
   */
  async promoteNpcToPc(npcId: string): Promise<number | null> {
    if (!this.session) return null;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return null;
    if (typeof npcId !== 'string' || npcId.length === 0) return null;
    const campaign = this.getCurrentCampaign();
    if (!campaign) return null;
    // Load the NPC record (read-only fetch; not cached today).
    let loaded;
    try {
      loaded = await loadCharacter(
        campaign.base.source,
        'npc',
        npcId
      );
    } catch (e) {
      this.transientError = `Could not load NPC "${npcId}": ${(e as Error).message}`;
      return null;
    }
    // Compute the lowest unused slot integer (ignores
    // bound-retired / bound-archived which still occupy slots).
    const taken = new Set<number>();
    for (const slotStr of Object.keys(v.shared.pcSlots)) {
      taken.add(Number(slotStr));
    }
    let slot = 1;
    while (taken.has(slot)) slot++;
    // Derive a unique pcId from the NPC id.  Random suffix protects
    // against re-promotion (DM promotes the same NPC twice) +
    // against an existing pc with the same id.
    const rand = Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0');
    const newPcId = `pc-from-${npcId}-${rand}`;
    // Copy NPC fields into the flat pc-create payload shape.  The
    // materializer (applyPcCreateEvent in core/state.ts) validates a
    // FLAT shape — name/pronouns/tags/stats/skills/backstory all at
    // the top level — not nested under `record`.  Earlier versions
    // of this method nested the record and silently failed
    // validation; fix landed alongside the #302 tests that caught
    // it.  PC-required defaults applied where the NPC didn't carry
    // them (stats neutral, harm/stress 0, tags non-empty).
    const r = loaded.record;
    const npcStats = r.stats ?? {};
    // QA verification (run ac428a0d30ced0e3d) widened-surface
    // follow-up: an earlier draft also passed `r.tags`, `r.role`,
    // and `r.disposition` through unchanged.  NPC tags like
    // `"secret-quiet-cultist"` would leak post-reveal.  Same
    // mitigation as backstory: replace with neutral placeholders
    // and rely on the hidden-seat default (revealed:false) plus
    // the DM rewriting in the edit dialog before clicking Reveal.
    // Name + pronouns + stats stay (numbers + an identifying label
    // are not spoiler-bearing under the threat model; if the NPC's
    // name itself is a spoiler — e.g. "Mei's Sister" — the DM
    // renames before reveal).
    const tags: string[] = [
      `promoted from ${npcId}`,
      'newcomer to the table',
      'audit + rewrite before reveal'
    ];
    // QA sanity-check BLOCKING-1 mitigation step 2: promote to a
    // HIDDEN seat by default (#301 firewall).  This gives the DM
    // time to rewrite the placeholder backstory + audit any other
    // fields that came from the NPC sheet before players see the
    // PC.  DM clicks Reveal on the Stage Roster tile when ready.
    this.session.append('seat-add', { v: 1, slot, revealed: false });
    // QA sanity-check (run af29809d2760df714) BLOCKING-1: an
    // earlier draft of this method passed `r.backstory` / `r.description`
    // straight into the player-visible pc-create payload.  NPC sheets
    // in `characters/npcs/*.json` typically carry DM-private framing
    // ("works for The Quiet", "secretly Yui's brother") in those
    // fields — which would have rendered on the promoted PC's
    // player-bound sheet.  Fix: backstory becomes a neutral
    // placeholder the DM is expected to overwrite (via the
    // chargen-dm-review edit dialog or M4 living-doc) BEFORE the
    // seat is revealed.  Until then, the PC is functional but
    // player-side prose is intentionally bland.
    const promoteStub =
      `(Promoted from NPC ${npcId} — DM should rewrite this backstory ` +
      `to remove any DM-private framing before revealing the seat.)`;
    this.session.append('pc-create', {
      v: 1,
      pcId: newPcId,
      name: typeof r.name === 'string' && r.name.length > 0 ? r.name : npcId,
      pronouns: typeof r.pronouns === 'string' ? r.pronouns : '',
      tags,
      // Hostile-bundle regression: NPCs have permissive stat ranges
      // (combat NPCs run +5/+5/+5).  pc-create requires
      // PC_CREATE_STAT_MIN ≤ x ≤ PC_CREATE_STAT_MAX (i.e., [-3, 3]).
      // Clamp on the way in so the promote succeeds even for spicy
      // NPCs; the DM rewrites in the edit dialog if they want
      // different baselines.
      stats: {
        str: clampPromoteStat(npcStats.str),
        dex: clampPromoteStat(npcStats.dex),
        con: clampPromoteStat(npcStats.con),
        int: clampPromoteStat(npcStats.int),
        wis: clampPromoteStat(npcStats.wis),
        cha: clampPromoteStat(npcStats.cha)
      },
      skills: Array.isArray(r.skills) ? r.skills : [],
      backstory: promoteStub
    });
    this.session.append('pc-slot-bind', {
      v: 1,
      slot,
      pcId: newPcId
    });
    return slot;
  }

  /**
   * P-R11 (2026-05-25): coord-authored rejection of a pending
   * player retire request.  Removes the pending entry + adds an
   * audit-visible rejection note so the player's rail surfaces
   * "DM declined: <note>."
   */
  appendPcRetireReject(pcId: string, note: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!pcId || pcId.length === 0) return false;
    const req = v.shared.pcRetireRequests.find((r) => r.pcId === pcId);
    if (!req) return false;
    const trimmed = typeof note === 'string' ? note.trim() : '';
    this.session.append('pc-retire-reject', {
      v: 1,
      requestingPeerId: req.requestingPeerId,
      pcId,
      ...(trimmed.length > 0 ? { note: trimmed.slice(0, 200) } : {})
    });
    return true;
  }

  /**
   * P-R11 (2026-05-25): player-authored request to retire their
   * own bound PC.  The request is gated to the local peer's
   * currently-bound pcId; the engine refuses requests for
   * someone else's PC defense-in-depth.
   */
  appendPcRetireRequest(
    reason: 'died' | 'departed' | 'converted-to-npc' | 'other',
    inFictionReason: string
  ): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !v.peerId) return false;
    const me = v.filteredShared.peers[v.peerId];
    const pcId = me?.pcId;
    if (!pcId) return false;
    const trimmed =
      typeof inFictionReason === 'string' ? inFictionReason.trim() : '';
    if (trimmed.length === 0 || trimmed.length > 200) return false;
    this.session.append('pc-retire-request', {
      v: 1,
      pcId,
      inFictionReason: trimmed,
      reason
    });
    return true;
  }

  /**
   * Wave 1 (2026-05-25): emit a `seat-remove` event dropping an
   * unbound, empty seat that was added accidentally.  Coord-only.
   * The engine refuses to remove bound seats (sticky-N preserves
   * narrative history through retire-flow instead).
   */
  appendSeatRemove(slot: number): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !this.isCoordinator()) return false;
    if (!Number.isInteger(slot) || slot < 1) return false;
    this.session.append('seat-remove', { v: 1, slot });
    return true;
  }

  /**
   * Public delegate retained so a few off-path callers continue to
   * compile.  All real work lives in ChargenController.synthesizeForSlot.
   */
  async synthesizeBackstoryForSlot(
    slot: number,
    options: { playerDisplayName?: string; dmConstraints?: string } = {}
  ): Promise<SynthesizeBackstoryResult> {
    return this.chargen.synthesizeForSlot(slot, options);
  }

  /** CC-12 (Cluster E step 1): delegated to ChargenController. */
  generateInviteUrl(slot: number): Promise<string | null> {
    return this.chargen.generateInviteUrl(slot);
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
    const switcherEntries = this.computeSwitcherEntries(bound.id);
    const retirePip = this.computeRetirePip(bound.id);
    return html`
      <player-rail
        .character=${bound}
        .effective=${r}
        .campaignName=${campaign.base.manifest.name}
        .campaignSlug=${slug}
        .editable=${editable}
        .claimState=${claim.state}
        .claimedBy=${claim.claimedBy}
        .pcSlotBindings=${this.currentPcSlotBindings()}
        .switcherEntries=${switcherEntries}
        .onSwitchToPc=${switcherEntries.length >= 2
          ? (pcId: string) => this.switchBoundPcTo(pcId)
          : null}
        .retirePip=${retirePip}
        .onRequestRetire=${retirePip && !this.isCoordinator()
          ? (
              reason: 'died' | 'departed' | 'converted-to-npc' | 'other',
              note: string
            ) => this.appendPcRetireRequest(reason, note)
          : null}
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
        .onSetTrackValue=${(
          pcId: string,
          field: 'harm' | 'stress',
          value: number
        ) => this.setTrackValue(pcId, field, value)}
        .onSetMoneyBand=${(
          pcId: string,
          band: import('./character-loader').MoneyBand
        ) => this.submitPcEdit(pcId, 'moneyBand', band)}
        .onNavigate=${(e: Event, route: AppRoute) =>
          this.navigate(e, route)}
        .onToggleClaim=${() => this.toggleClaimCharacter(bound)}
        .bonds=${this.buildBondsCardEntries(bound.id)}
        .bondTargetCandidates=${this.bondTargetCandidates(bound.id)}
        .pendingBondProposalCount=${this.pendingBondProposalCount(bound.id)}
        .onProposeBond=${editable
          ? (targetPcId: string, text: string) =>
              void this.proposeBond({ pcId: bound.id, targetPcId, text })
          : null}
      ></player-rail>
    `;
  }

  /**
   * P-R7 (2026-05-25): build the name-row switcher entries for the
   * local peer.  The list contains the local peer's current bound
   * PC + every UNCLAIMED bound-active PC, all read from
   * filteredShared so player-bound viewers don't see PCs the
   * spoiler firewall would otherwise hide.  Returns [] for non-
   * session contexts (the rail just shows the plain h1).
   *
   * Conservative default: PCs claimed by ANOTHER live peer are
   * EXCLUDED to prevent accidental take-over via the switcher.
   * The dedicated "Take over" affordance on the claim row still
   * exists for the rare cross-player takeover case.
   */
  private computeSwitcherEntries(
    currentPcId: string
  ): import('./ui/regions/player-rail').SwitcherEntry[] {
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !v.peerId) return [];
    const myPeerId = v.peerId;
    const peerByPc: Record<string, { peerId: string; name?: string }> = {};
    for (const peer of Object.values(v.filteredShared.peers)) {
      if (peer.leftAt !== undefined) continue;
      if (!peer.pcId) continue;
      peerByPc[peer.pcId] = peer;
    }
    const slots = v.filteredShared.pcSlots;
    const synthesized = v.filteredShared.synthesizedPcs;
    const entries: import('./ui/regions/player-rail').SwitcherEntry[] = [];
    // Sort by slot integer for deterministic order.  Filter by
    // bound-active state so retired / archived / unbound seats
    // never appear in the dropdown.
    const sortedSlots = Object.keys(slots)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1)
      .sort((a, b) => a - b);
    for (const slot of sortedSlots) {
      const seat = slots[slot];
      if (seat.state !== 'bound-active') continue;
      const pcId = seat.pcId;
      if (!pcId) continue;
      const pcOwner = peerByPc[pcId];
      const isCurrent = pcId === currentPcId;
      const name = synthesized[pcId]?.name ?? pcId;
      // Per TTRPG-R7 verdict (Option b): include PCs claimed by
      // another peer too, but tag them with `takenBy` so the dropdown
      // can render an inline "Take over from <name>" affirm step.
      // The two-click confirm guards against accidental theft of a
      // teammate's PC.
      if (pcOwner && pcOwner.peerId !== myPeerId && !isCurrent) {
        entries.push({
          pcId,
          name,
          isCurrent: false,
          takenBy: pcOwner.name ?? '(unnamed)'
        });
      } else {
        entries.push({ pcId, name, isCurrent });
      }
    }
    return entries;
  }

  /**
   * P-R11 (2026-05-25): compute the player-rail retire-request pip
   * for the local viewer's bound PC.  Only the player who controls
   * the PC sees the pip; the DM-side accept/reject lives on the
   * Stage Roster tile instead.  Returns null when the surface
   * should be hidden entirely (DM view, NPC sheet, no session).
   */
  private computeRetirePip(
    pcId: string
  ): import('./ui/regions/player-rail').RetireRequestPip | null {
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !v.peerId) return null;
    // The DM-side accept/reject is on the Stage Roster; don't double-
    // surface for the coord.  Players see the pip.
    if (this.isCoordinator()) return null;
    const me = v.filteredShared.peers[v.peerId];
    if (!me?.pcId || me.pcId !== pcId) return null;
    const pending = v.filteredShared.pcRetireRequests?.find(
      (r) =>
        r.requestingPeerId === v.peerId && r.pcId === pcId
    );
    if (pending) return { status: 'pending' };
    const declined = v.filteredShared.pcRetireRejections?.find(
      (r) =>
        r.requestingPeerId === v.peerId && r.pcId === pcId
    );
    if (declined) {
      return declined.note !== undefined
        ? { status: 'declined', note: declined.note }
        : { status: 'declined' };
    }
    return { status: 'none' };
  }

  /**
   * P-R7: dispatch a peer-rename(pcId) when the player picks a
   * different PC from the switcher.  Same mechanism the claim
   * affordance uses; differs only in the UX surface.
   *
   * Per TTRPG-R7 verdict (BLOCKING-3a) also emit a `pc-switch`
   * audit event with from/to pcIds + the scene path at switch
   * time.  Post-session attribution uses this to answer "who
   * controlled which PC when scene X happened" without
   * reconstructing from peer-rename chronology.
   */
  switchBoundPcTo(pcId: string): boolean {
    if (!this.session) return false;
    const v = this.sessionView;
    if (!v || v.status !== 'active' || !v.peerId) return false;
    const me = v.filteredShared.peers[v.peerId];
    const from = me?.pcId ?? '';
    if (from === pcId) return false;
    this.session.rename({ pcId });
    const sceneState = this.appState;
    const scene =
      sceneState.kind === 'scene' ? sceneState.scene.path : '';
    this.session.append('pc-switch', {
      v: 1,
      from,
      to: pcId,
      scene
    });
    return true;
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
        .error=${this.transientError}
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
    // Phase B P5 (2026-05-26): when the DM has switched to
    // session-wrap-marks mode, replace the normal body with the
    // end-of-session sheet.  Coord-only via the mode-toggle
    // button in the DM aside.  Players who land here via URL see
    // the read-only DM-only fallback.  NOTE: applyPcEditEvent
    // does NOT gate markBullets.* edits to coord (see the
    // pc-edit universal-write trust gap noted in design/STATUS.md);
    // any peer could in theory author a markBullets edit and have
    // it materialize.  Tolerated by the current civilized-players
    // threat model.  If a future feature requires per-PC write
    // authority, that gap fix would also harden this surface.
    if (this.appMode === 'session-wrap-marks') {
      return this.renderSessionWrapMarks();
    }
    if (this.appMode === 'session-open') {
      return this.renderSessionOpenStage();
    }
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
        .chosenPath=${this.chargen.chosenPath}
        .questions=${campaign.base.manifest.characterCreation?.questions ?? []}
        .answers=${this.chargen.answers}
        .bondDrafts=${this.chargen.bondDrafts}
        .packFeedback=${this.chargen.packFeedback}
        .onPickPath=${(p: 'qa' | 'free-write' | 'pre-gen') => {
          this.chargen.setChosenPath(p);
          this.chargen.persistDebounced(campaign, slot);
        }}
        .onAnswerChange=${(id: string, value: string) => {
          this.chargen.setAnswer(id, value);
          this.chargen.persistDebounced(campaign, slot);
        }}
        .onBondDraftsChange=${(drafts: import('./chargen-pack').BondDraft[]) => {
          this.chargen.setBondDrafts(drafts);
          this.chargen.persistDebounced(campaign, slot);
        }}
        .onPack=${() => this.chargen.packAndDownload(campaign, slot)}
        .onSendToDm=${this.sessionView?.status === 'active'
          ? () => this.chargen.packAndSendToDm(campaign, slot)
          : null}
        .sendToDmFeedback=${this.chargen.sendToDmFeedback}
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
      ${isCoord ? this.renderStageTabBar() : nothing}
      ${this.stageTab === 'roster' && isCoord
        ? this.renderStageRoster()
        : html`<scene-stage
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
            .pcSlotBindings=${this.currentPcSlotBindings()}
            .onNavigate=${(e: Event, route: AppRoute) =>
              this.navigate(e, route)}
            .onToggleBlock=${(blockHash: string) =>
              this.toggleBlockReveal(fullScenePath, blockHash)}
            .onBroadcast=${() => this.broadcastCurrentView()}
            .headerExtras=${this.renderRevealControl(episode.slug, scene.path)}
          ></scene-stage>`}
      ${this.renderCharacterMenus(
        slug,
        campaign.base.manifest.characters
      )}
      ${this.renderRollPanel()}
    `;
  }

  /**
   * P-R5 (2026-05-25): Stage panel tab bar.  Only renders for the
   * coordinator (per ui.md the DM has Stage tabs; players see only
   * the active surface).  Default tab is 'scene'.  Other tabs
   * (Outline, NPCs, Map) land in M5+; for now: Scene + Roster.
   */
  private renderStageTabBar(): TemplateResult {
    return html`
      <nav class="stage-tabs" role="tablist" aria-label="Stage view">
        ${this.renderStageTabButton('scene', 'Scene')}
        ${this.renderStageTabButton('roster', 'Roster')}
      </nav>
    `;
  }

  private renderStageTabButton(
    tab: 'scene' | 'roster',
    label: string
  ): TemplateResult {
    const active = this.stageTab === tab;
    return html`<button
      type="button"
      class="stage-tab ${active ? 'stage-tab-active' : ''}"
      role="tab"
      aria-selected=${active ? 'true' : 'false'}
      @click=${() => {
        this.stageTab = tab;
      }}
    >
      ${label}
    </button>`;
  }

  private renderStageRoster(): TemplateResult {
    const v = this.sessionView;
    const slots = v?.status === 'active' ? v.filteredShared.pcSlots : {};
    const synthesized =
      v?.status === 'active' ? v.filteredShared.synthesizedPcs : {};
    // Task #295: collect current dmNotes per PC.  The shared state
    // holds them under `pcEdits[pcId].dmNotes` (LWW overlay); fall
    // back to the loaded record's dmNotes when no edit has happened
    // yet.  Coord-only — filteredShared strips this for players, so
    // the lookup naturally produces empty notes in non-coord views.
    const dmNotesByPcId: Record<string, string> = {};
    if (v?.status === 'active' && this.isCoordinator()) {
      const pcEdits = v.shared.pcEdits;
      for (const [pcId, record] of Object.entries(synthesized)) {
        const editValue = pcEdits?.[pcId]?.dmNotes;
        if (typeof editValue === 'string') {
          dmNotesByPcId[pcId] = editValue;
        } else if (typeof record.dmNotes === 'string') {
          dmNotesByPcId[pcId] = record.dmNotes;
        } else {
          dmNotesByPcId[pcId] = '';
        }
      }
    }
    // P-R10: NPC list for the Browse NPCs sub-tab.  Coord-only;
    // pulled from the campaign manifest (the same source the
    // /campaign overview reads).  Each entry shows what the DM has
    // for context — name, optional one-line description.  The
    // promote callback below fires the load + pc-create + seat-add
    // + pc-slot-bind sequence asynchronously.
    const npcsList: Array<
      import('./ui/regions/stage-roster').BrowseNpcEntry
    > = [];
    const campaignForStage = this.getCurrentCampaign();
    if (
      v?.status === 'active' &&
      this.isCoordinator() &&
      campaignForStage
    ) {
      const npcIds = campaignForStage.base.manifest.characters?.npcs ?? [];
      for (const npcId of npcIds) {
        npcsList.push({ id: npcId });
      }
    }
    // P-R11: pending retire requests, keyed by pcId.  Coord-only —
    // we render the strip for the DM's eyes.  Names are resolved via
    // the existing peer-name lookup so the DM sees "Bob requested…"
    // not a raw peer id.
    const pendingRetireRequests: Record<
      string,
      import('./ui/regions/stage-roster').PendingRetireRequest
    > = {};
    if (v?.status === 'active' && this.isCoordinator()) {
      for (const req of v.filteredShared.pcRetireRequests ?? []) {
        pendingRetireRequests[req.pcId] = {
          pcId: req.pcId,
          requestingPeerName: this.displayNameFor(req.requestingPeerId),
          inFictionReason: req.inFictionReason,
          reason: req.reason
        };
      }
    }
    // #301: build the set of pcIds whose seat is currently hidden
    // from players.  Coord-only — players never see the unfiltered
    // pcSlots, so `seat.revealed === false` here means "I'm the DM
    // looking at my own staged seat."  Active tiles render a 🔒
    // badge + Reveal button for these.
    const hiddenSeatPcIds = new Set<string>();
    if (v?.status === 'active' && this.isCoordinator()) {
      for (const seat of Object.values(v.shared.pcSlots)) {
        if (seat.revealed === false && seat.pcId) {
          hiddenSeatPcIds.add(seat.pcId);
        }
      }
    }
    return html`<stage-roster
      .pcSlots=${slots}
      .synthesizedPcs=${synthesized}
      .dmNotesByPcId=${dmNotesByPcId}
      .npcsList=${npcsList}
      .hiddenSeatPcIds=${hiddenSeatPcIds}
      .onAddHiddenSeat=${this.isCoordinator()
        ? () => this.addHiddenSeat()
        : null}
      .onRevealSeat=${this.isCoordinator()
        ? (slot: number) => this.revealSeat(slot)
        : null}
      .onEditSeatMemory=${this.isCoordinator()
        ? (slot: number, text: string) =>
            this.appendSeatMemoryEdit(slot, text)
        : null}
      .onPromoteNpc=${this.isCoordinator()
        ? (npcId: string) => {
            void this.promoteNpcToPc(npcId);
          }
        : null}
      .pendingRetireRequests=${pendingRetireRequests}
      .onAcceptRetireRequest=${this.isCoordinator()
        ? (pcId: string,
           reason: 'died' | 'departed' | 'converted-to-npc' | 'other',
           inFictionReason: string) =>
            this.appendPcRetire({
              pcId,
              reason,
              inFictionReason
            })
        : null}
      .onRejectRetireRequest=${this.isCoordinator()
        ? (pcId: string, note: string) =>
            this.appendPcRetireReject(pcId, note)
        : null}
      .displayNameLookup=${(pcId: string) => this.chargen.displayNameForBound(pcId)}
      .onRetirePc=${(slot: number) => {
        const seat = slots[slot];
        if (!seat?.pcId) return;
        const name = this.chargen.displayNameForBound(seat.pcId) ?? seat.pcId;
        const reason = window.prompt(
          `Retire ${name}? Enter an in-fiction reason (player-safe):`
        );
        if (!reason || reason.trim().length === 0) return;
        this.appendPcRetire({
          pcId: seat.pcId,
          inFictionReason: reason.trim(),
          reason: 'departed'
        });
      }}
      .onSetDmNotes=${this.isCoordinator()
        ? (pcId: string, value: string) =>
            this.appendDmNotesEdit(pcId, value)
        : null}
    ></stage-roster>`;
  }

  /**
   * Task #295: dispatch a pc-edit event writing the DM-private
   * soft-notes field.  Coord-only; bounded length enforced by the
   * `applyCharacterEdits` validator (silently drops oversized).
   */
  appendDmNotesEdit(pcId: string, value: string): boolean {
    if (!this.session) return false;
    if (this.sessionView?.status !== 'active') return false;
    if (!this.isCoordinator()) return false;
    if (typeof pcId !== 'string' || pcId.length === 0) return false;
    if (typeof value !== 'string') return false;
    if (value.length > DM_NOTES_MAX) return false;
    this.session.append('pc-edit', {
      pcId,
      field: 'dmNotes',
      value
    });
    return true;
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
      <!-- Wave C1 (2026-05-26): topbar "?" chip opens the hotkey
           cheatsheet.  Sits inline after session-bar; one keystroke
           or one click from anywhere.  Click dispatches a window
           event the overlay listens for (avoids prop-drilling). -->
      <button
        type="button"
        class="quire-topbar-help-chip"
        title="Keyboard shortcuts (?)"
        aria-label="Open keyboard shortcuts cheatsheet"
        @click=${() => {
          window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT));
        }}
      >
        ?
      </button>
      ${this.renderReclaimConfirmation()}
      ${this.renderYieldPrompt()}
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
    // #302 (2026-05-26): coord-self sees a "Yield DM role" button
    // instead of Reclaim.  Click opens a confirm that ALSO asks
    // about PC fate when the DM has a bound PC.
    if (v.filteredShared.coordinator === v.peerId) {
      return html`
        <button
          class="reclaim-button"
          @click=${() => this.openYieldPrompt()}
          title="Hand off the DM role to another peer"
        >
          Yield DM role
        </button>
      `;
    }
    // Currently we're a non-coordinator.  Allow taking over.
    return html`
      <button
        class="reclaim-button"
        @click=${() => this.reclaimCtrl.showReclaimConfirm()}
        title="Take over as session coordinator (DM role)"
      >
        Reclaim DM
      </button>
    `;
  }

  /**
   * #302 yield-prompt verbs.  Thin delegations to
   * `ReclaimController` (extracted 2026-05-27, E-LARGE-1 step 2).
   * See that file for the per-method semantics.
   */
  private openYieldPrompt(): void {
    this.reclaimCtrl.openYieldPrompt();
  }
  submitYieldPcFatePrompt(): boolean {
    return this.reclaimCtrl.submitYieldPcFatePrompt();
  }
  dismissYieldPcFatePrompt(): void {
    this.reclaimCtrl.dismissYieldPcFatePrompt();
  }
  setYieldPcFate(fate: 'keep' | 'sideline' | 'retire'): void {
    this.reclaimCtrl.setYieldPcFate(fate);
  }
  setYieldRetireReason(reason: string): void {
    this.reclaimCtrl.setYieldRetireReason(reason);
  }

  /**
   * #302: render the yield + PC-fate prompt modal.  Three radios
   * for Keep / Sideline / Retire when pcId is set; a plain confirm
   * when pcId is empty.  Reactive path (voluntary=false) renders
   * the same modal with "Already lost DM role — what about <PC>?"
   * framing instead of "About to yield…".
   */
  private renderYieldPrompt(): TemplateResult {
    const p = this.yieldPcFatePrompt;
    if (!p) return html``;
    const canSubmit =
      p.fate !== 'retire' || p.retireReason.trim().length > 0;
    const headline = p.voluntary
      ? p.pcId
        ? html`<p>
            Yielding DM role.  What should happen to
            <strong>${p.pcName}</strong>?
          </p>`
        : html`<p>Yield DM role?  The next player to click Reclaim picks it up.</p>`
      : html`<p>
          You're no longer DM.  What should happen to
          <strong>${p.pcName}</strong>?
        </p>`;
    const radios = p.pcId
      ? html`
          <fieldset class="yield-pc-fate-fieldset">
            <legend>Pick a PC fate</legend>
            <label>
              <input
                type="radio"
                name="yield-pc-fate"
                ?checked=${p.fate === 'keep'}
                @change=${() => this.setYieldPcFate('keep')}
              />
              <span>Keep playing — <strong>${p.pcName}</strong> stays bound to me.</span>
            </label>
            <label>
              <input
                type="radio"
                name="yield-pc-fate"
                ?checked=${p.fate === 'sideline'}
                @change=${() => this.setYieldPcFate('sideline')}
              />
              <span
                >Sideline — clear my binding; ${p.pcName} sits at the
                table until rebound.</span
              >
            </label>
            <label>
              <input
                type="radio"
                name="yield-pc-fate"
                ?checked=${p.fate === 'retire'}
                @change=${() => this.setYieldPcFate('retire')}
              />
              <span>Retire — ${p.pcName} leaves the story.</span>
            </label>
            ${p.fate === 'retire'
              ? html`<label class="yield-pc-fate-reason-label">
                  In-fiction reason (player-safe)
                  <input
                    type="text"
                    class="yield-pc-fate-reason"
                    maxlength="200"
                    placeholder="e.g., she stepped back to care for her sister"
                    .value=${p.retireReason}
                    @input=${(e: Event) =>
                      this.setYieldRetireReason(
                        (e.target as HTMLInputElement).value
                      )}
                  />
                </label>`
              : nothing}
          </fieldset>
        `
      : nothing;
    return html`
      <div class="reclaim-modal yield-pc-fate-modal" role="alertdialog">
        ${headline}${radios}
        <div class="reclaim-modal-actions">
          <button @click=${() => this.dismissYieldPcFatePrompt()}>
            Cancel
          </button>
          <button
            class="reclaim-button-confirm"
            ?disabled=${!canSubmit}
            @click=${() => this.submitYieldPcFatePrompt()}
          >
            ${p.voluntary ? 'Yield' : 'Confirm'}
          </button>
        </div>
      </div>
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
          <button @click=${() => this.reclaimCtrl.hideReclaimConfirm()}>
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
          Pick up where you left off?  ${doc.events.length} session
          event${doc.events.length === 1 ? '' : 's'} saved ${ago}.
        </p>
        <div class="resume-prompt-actions">
          <button @click=${() => this.dismissResumePrompt()}>
            Start fresh
          </button>
          <button
            @click=${() => {
              // #257 fix (2026-05-25): leave resumePromptDoc set so
              // startHosting picks it up after the session is
              // active.  Previously this called loadFromString
              // directly, which always failed with "Start or host
              // a session first" because no session existed yet —
              // the user saw "Resumed!" and was actually in a
              // fresh empty session.  startHosting now owns the
              // replay-after-host sequence.
              if (this.session && this.sessionView?.status === 'active') {
                // Edge case: a session is already active (the DM
                // hosted before clicking Resume).  Old direct-
                // loadFromString path works in this case.
                const json = stringifySave(doc);
                this.dismissResumePrompt();
                this.loadFromString(json);
              } else {
                // Normal path: trigger host, which replays the
                // staged doc.
                this.startHosting();
              }
            }}
          >
            Resume
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
   * Task #293: render the chat-spoiler-lint confirmation modal.
   * Only present when chatSpoilerLint is non-null, which only
   * happens for the coordinator (submitChat guards the trigger).
   * Per the silent-player-firewall rule this surface lives inside
   * the DM's aside region and never renders for players — but as
   * defense-in-depth we also gate the render on isCoordinator().
   */
  private renderChatSpoilerLintModal(): TemplateResult | typeof nothing {
    const state = this.chatSpoilerLint;
    if (!state) return nothing;
    if (!this.isCoordinator()) return nothing;
    const tokens = state.aiLeaks.length > 0
      ? state.aiLeaks
      : state.substringHits;
    const statusLine = renderChatLintStatusLine(state.aiStatus);
    const reasonLine =
      state.aiReason && state.aiStatus !== 'unchecked'
        ? html`<p class="chat-spoiler-lint-reason muted">${state.aiReason}</p>`
        : nothing;
    return html`
      <quire-modal
        class="chat-spoiler-lint-modal"
        ?open=${true}
        .onClose=${() => this.dismissChatSpoilerLint()}
      >
        <div class="chat-spoiler-lint-body">
          <h3>Hold up — this draft may leak campaign lore</h3>
          <p class="chat-spoiler-lint-intro">
            Your chat draft contains
            <strong>${tokens.join(', ')}</strong>, which your players
            don't know yet.  Chat broadcasts to every player.
          </p>
          <blockquote class="chat-spoiler-lint-draft">
            ${state.draft}
          </blockquote>
          ${statusLine}
          ${reasonLine}
          <div class="chat-spoiler-lint-actions">
            <button
              type="button"
              class="chat-spoiler-lint-edit"
              @click=${() => this.dismissChatSpoilerLint()}
            >
              Edit draft
            </button>
            <button
              type="button"
              class="chat-spoiler-lint-route-ai"
              @click=${() => this.routeChatSpoilerLintToAi()}
            >
              Ask the AI instead
            </button>
            <button
              type="button"
              class="chat-spoiler-lint-send"
              @click=${() => this.confirmChatSpoilerLintSend()}
            >
              Send to chat anyway
            </button>
          </div>
        </div>
      </quire-modal>
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
   * E-LARGE-1 step 3 (2026-05-27): broadcast-follow cursor +
   * navigate-on-newer-ts logic extracted to
   * `BroadcastFollowingController`.  Runs via hostUpdated each
   * Lit cycle — no QuireApp dispatch needed.  See controller
   * for the inFlight concurrency guard (extraction-time fix).
   */
  private readonly broadcastFollowingCtrl = new BroadcastFollowingController(
    this,
    {
      getSessionView: () => this.sessionView,
      isCoordinator: () => this.isCoordinator(),
      parseStagePath: (path) => parseRoute(path),
      navigateToRoute: (route) => this.navigateToRoute(route)
    }
  );

  /**
   * @internal Test-only escape hatch: read the broadcast-follow
   * cursor for assertions.  Also satisfies the noUnusedLocals
   * check on the controller field above — the controller
   * registers itself via host.addController, but TypeScript
   * can't see that side effect.  First `_*ForTest` precedent on
   * QuireApp; future test seams should follow this @internal-
   * JSDoc convention rather than proliferating naming variants.
   */
  get _broadcastFollowCursorForTest(): number {
    return this.broadcastFollowingCtrl._cursorForTest();
  }

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

  // followBroadcast lives in
  // `./controllers/broadcast-following-controller` (extracted
  // 2026-05-27, E-LARGE-1 step 3).

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
    // Phase 3b-1 step 2: synthesized PC overlay check.  When the
    // local peer's bound PC is a chargen-synthesized record, resolve
    // synchronously from session state — no network hit, no async
    // race.  Mirrors the same check in `loadCharacterByPcId`.
    // Wave A2 (2026-05-26) firewall hardening: when the local
    // viewer is a player, strip DM-only fields from boundCharacter
    // before storing.  The player's OWN PC's knowsTheyCanCast /
    // magicPhase / tax / threadDebt / accidentalGrants are DM-
    // controlled facts they don't surface on their own sheet
    // (Realization is delivered verbally at the table; the player
    // doesn't toggle their own knowsTheyCanCast).
    const stripForPlayer = (c: LoadedCharacter): LoadedCharacter =>
      this.isCoordinator()
        ? c
        : {
            ...c,
            record: stripDmOnlyFromCharacter(c.record) as CharacterRecord
          };
    const overlayChar = this.resolvePcFromOverlay(myPcId, campaign);
    if (overlayChar) {
      const safe = stripForPlayer(overlayChar);
      this.boundCharacter = safe;
      this.boundCampaign = campaign;
      // Mirror into the per-pcId cache so the DM-review surface's
      // display-name lookup hits the same record without a second
      // resolve.
      this.cacheCharacterForLocalViewer(myPcId, overlayChar);
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
          this.boundCharacter = stripForPlayer(character);
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

  async startHosting(): Promise<void> {
    // R3-C: embed the campaign reference in the host's peer-join
    // so guests who arrived without ?campaign= in their URL can
    // discover what to load.
    //
    // #257 fix (2026-05-25): now async — we await the underlying
    // session.host() so a staged resume-doc can replay after the
    // session is active.  Existing callers that don't await still
    // work; the Lit event handlers + tests both flush microtasks
    // before asserting.
    //
    // R6 Engineering note: re-entrancy guard for double-click on
    // Host (or Resume + Host in quick succession).  Without this,
    // doHostSession would queue a second session.host() call
    // before the first resolves.  Cheap insurance.
    if (this.hostingInProgress) return;
    this.hostingInProgress = true;
    try {
      await doHostSession(
        this.session,
        this.displayNameDraft,
        this.getCurrentCampaign()?.base.source
      );
    // If an autosave is staged for this campaign (or discoverable
    // in localStorage), replay it now that the session is active.
    // Previously the Resume modal called loadFromString directly
    // — which always failed with "Start or host a session first"
    // because no session was active.  The DM saw "Resumed" then
    // was actually in a fresh empty session.  startHosting now
    // owns the replay-after-host sequence.
    let docToReplay = this.resumePromptDoc;
    if (!docToReplay) {
      const source = this.getCurrentCampaign()?.base.source;
      if (source) docToReplay = this.autosave.checkResume(source);
    }
      if (docToReplay) {
        const json = stringifySave(docToReplay);
        // QA-R6 F6 fix: clear resumePromptDoc AFTER loadFromString
        // succeeds.  Previously cleared first → if doHostSession's
        // catch-and-swallow path masked a host failure (session
        // never went active), loadFromString would silently no-op
        // and the DM would be left with no prompt to retry.  Now
        // the prompt stays if the host failed; the DM can click
        // Resume again.
        const result = this.loadFromString(json);
        if (result) this.resumePromptDoc = null;
      }
    } finally {
      this.hostingInProgress = false;
    }
  }

  /** R6 Engineering note: re-entrancy guard for startHosting. */
  private hostingInProgress = false;

  /**
   * P-R5 (2026-05-25): which Stage tab is showing.  Default
   * 'scene' so existing flows are unchanged.  DM-only; players
   * don't see the tab bar.  Session-scoped — resets to 'scene'
   * on session change.
   */
  @state() private stageTab: 'scene' | 'roster' = 'scene';

  joinSession(): void {
    doJoinSession(this.session, this.joinCodeDraft, this.displayNameDraft);
  }

  leaveSession(): void {
    doLeaveSession(this.session);
    this.joinCodeDraft = '';
    this.chatDraft = '';
    // Firewall hygiene (2026-05-27): drop cached PC character
    // records on session leave so a follow-up session can't reuse
    // stale records (with a different viewer's role/permissions).
    this.pcCharacterCache.clear();
    this.pcCharacterInFlight.clear();
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
      this.transientError = 'Set an API key first.';
      return null;
    }
    const user = prompt.trim();
    if (!user) {
      this.transientError = 'Empty prompt.';
      return null;
    }
    const session = this.session;
    // Solo mode is allowed: the panel is visible in solo (showAiPanel
    // returns true for solo/idle) and the broker accepts when no
    // coordinator is set.  In-session requires active + coord-self.
    const inSession = this.sessionView?.status === 'active';
    if (!session) {
      this.transientError = 'AI panel not ready.';
      return null;
    }
    this.aiAbort?.abort();
    const ac = new AbortController();
    this.aiAbort = ac;
    this.aiLoading = true;
    this.transientError = null;
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
      // Wave A4 (2026-05-26) firewall hardening: wrap the DM's
      // typed prompt in `<untrusted_content>` sentinel.  DM-typed
      // means the DM may paste a player message, a scratch note,
      // or world text containing prompt-injection.  Same convention
      // backstory-synthesis-prompt established for player answers.
      const wrappedUser = wrapUntrusted(user, 'dm-ai-prompt');
      const composedPrompt = contextBlock
        ? `${contextBlock}\n\n---\n\n${wrappedUser}`
        : wrappedUser;
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
      // Phase 3b-X: provider errors flow through AiBrokerError; the
      // provider-specific error subclasses (AnthropicProviderError,
      // GeminiProviderError) were retired alongside the legacy
      // call()/parse() pair in step 9.
      if (e instanceof AiBrokerError) {
        this.transientError = e.message;
      } else {
        this.transientError = (e as Error).message ?? 'AI request failed.';
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
   * Full event log — used ONLY by paths that genuinely need the
   * coord-only-on-coord-device archive (currently: tests + future
   * coord-side full-archive export).  Autosave (Wave A1 fix) and
   * user-initiated file download both go through
   * buildShareableSaveDocument so a non-coord viewer's persisted
   * copy strips DM-only events.  The "every player's device keeps
   * the complete log for resilience" rationale was overridden by
   * the locked threat model treating outsiders (kid / spouse on a
   * player's laptop) as in-scope.
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
   * lands in a user-initiated download AND the JSON the autosave
   * writes to localStorage.  Per the Quire threat model + Wave A1
   * audit (2026-05-26):
   *
   *   - the currently-acting DM gets the full save (resilience for
   *     the DM device itself);
   *   - every other peer gets DM-only events filtered out so a
   *     player's autosave / saved-file can't leak scratch notes,
   *     NPC pins, thread-debt, caster-state, or AI audit even when
   *     the device is shared / handed off / picked up by a non-
   *     player (kid / spouse / IT).
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
    this.reclaimCtrl.hideReclaimConfirm();
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
    // B1 escape hatch (Phase 3b-2A): `/ai ` or `@ai ` prefix re-routes
    // an AI-intended message that was muscle-memoried into the chat
    // input.  Per the chat/AI confusion threat-model finding, this is
    // the load-bearing recovery affordance for a DM who would
    // otherwise broadcast a private query to all players.  Only the
    // DM (coordinator) can use this — players have no AI panel, so
    // their `/ai` would be a no-op.
    const aiMatch = trimmed.match(/^[/@]ai\s+(.+)$/is);
    if (aiMatch && this.isCoordinator()) {
      void this.submitAiPrompt(aiMatch[1]);
      this.chatDraft = '';
      this.chatError = null;
      return true;
    }
    // F2 fix: cap with explicit user-facing feedback instead of a
    // silent no-op.  The user can see what was over-cap and edit it
    // back down rather than wondering why their long message
    // disappeared.
    if (trimmed.length > CHAT_MAX_LENGTH) {
      this.chatError = `Message too long (${trimmed.length} characters; max ${CHAT_MAX_LENGTH}).`;
      return false;
    }
    // Task #293: DM-only chat-spoiler-lint.  See
    // `ChatSpoilerLintController`: the controller refuses the
    // broadcast when the coordinator's draft trips the substring
    // scanner; players still send through normally.
    if (!this.chatSpoilerLintCtrl.gateDraft(trimmed)) return false;
    this.session.append('chat', { text: trimmed });
    this.chatDraft = '';
    this.chatError = null;
    return true;
  }

  /**
   * Task #293 chat-spoiler-lint verbs.  Thin delegations to
   * `ChatSpoilerLintController` (extracted as part of E-LARGE-1
   * step 1, 2026-05-27).  See that file for the per-method
   * semantics.
   */
  confirmChatSpoilerLintSend(): boolean {
    return this.chatSpoilerLintCtrl.confirmSend();
  }

  routeChatSpoilerLintToAi(): boolean {
    return this.chatSpoilerLintCtrl.routeToAi();
  }

  /**
   * "Edit draft" — close the modal + restore the draft.
   */
  dismissChatSpoilerLint(): void {
    this.chatSpoilerLintCtrl.dismiss();
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
        .pcSlotBindings=${this.currentPcSlotBindings()}
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
        .onSetTrackValue=${(
          pcId: string,
          field: 'harm' | 'stress',
          value: number
        ) => this.setTrackValue(pcId, field, value)}
        .onSetMoneyBand=${(
          pcId: string,
          band: import('./character-loader').MoneyBand
        ) => this.submitPcEdit(pcId, 'moneyBand', band)}
        .onNavigate=${(e: Event, route: AppRoute) =>
          this.navigate(e, route)}
        .onToggleClaim=${() => this.toggleClaimCharacter(character)}
      ></player-rail>
      ${this.renderRollPanel()}
      ${this.renderDmPcDetail(character)}
    `;
  }

  /**
   * Phase B P3 Tier B (2026-05-26): DM-only companion card below
   * the player-rail showing DM-only state for the focused PC.
   * Coord-only, PC-only.  Reads from the (unfiltered) shared
   * state since the DM's filteredShared is identity-equal to
   * shared.  Pulls dmNotes from the pcEdits overlay (mirrors the
   * Stage Roster soft-notes path).
   */
  private renderDmPcDetail(
    character: LoadedCharacter
  ): TemplateResult | typeof nothing {
    if (character.kind !== 'pc') return nothing;
    if (!this.isCoordinator()) return nothing;
    const v = this.sessionView;
    if (!v || v.status !== 'active') return nothing;
    const record = this.effectiveCharacter(character);
    const edits = v.shared.pcEdits[character.id] ?? {};
    const dmNotesEdit = (edits as Record<string, unknown>).dmNotes;
    const dmNotes =
      typeof dmNotesEdit === 'string'
        ? dmNotesEdit
        : typeof record.dmNotes === 'string'
          ? record.dmNotes
          : undefined;
    const view: import('./ui/regions/dm-pc-detail').DmDetailView = {
      pcId: character.id,
      pcName:
        typeof record.name === 'string' && record.name.length > 0
          ? record.name
          : character.id
    };
    if (record.magicPhase !== undefined) view.magicPhase = record.magicPhase;
    if (record.knowsTheyCanCast !== undefined)
      view.knowsTheyCanCast = record.knowsTheyCanCast;
    if (record.tax !== undefined) view.tax = record.tax;
    if (record.threadDebt !== undefined) view.threadDebt = record.threadDebt;
    // Wave B (2026-05-26): merge disk-authored grants + session
    // grants from state.pcAccidentalGrants[pcId].  filterForViewer
    // wipes pcAccidentalGrants for non-coord, so this read is
    // DM-only by construction.
    const sessionGrants = v.shared.pcAccidentalGrants?.[character.id] ?? [];
    const diskGrants = record.accidentalGrants ?? [];
    const mergedGrants = [...diskGrants, ...sessionGrants];
    if (mergedGrants.length > 0) view.accidentalGrants = mergedGrants;
    // Wave B (2026-05-26): merge disk-authored foci + session
    // focus-grants.  Player-visible (pcFoci flows through
    // filterForViewer).
    const sessionFoci = v.shared.pcFoci?.[character.id] ?? [];
    const diskFoci = record.foci ?? [];
    const mergedFoci = [...diskFoci, ...sessionFoci];
    if (mergedFoci.length > 0) view.foci = mergedFoci;
    if (record.alignmentDrift !== undefined)
      view.alignmentDrift = record.alignmentDrift;
    if (dmNotes !== undefined) view.dmNotes = dmNotes;
    // D5 (2026-05-27): bonds (ratified) + proposals (pending) for
    // the DM view.  Coord viewer; non-coord doesn't mount
    // dm-pc-detail.  Pull from v.shared (DM read path) since
    // dm-pc-detail is coord-gated upstream by the parent render
    // method that branches on isCoordinator().
    //
    // D5-cleanup-2 (2026-05-27 scenario TTRPG-C parity bug):
    // DM-side view was previously OUTBOUND-only.  Player rail
    // includes inbound via `buildBondsCardEntries`; the DM view
    // needs the same so the DM sees the same bond set the
    // players do.  Pre-fix the DM saw fewer bonds than the
    // players on the same PC's sheet.
    const bondEntries: import('./ui/field-renderers/bonds-card').BondsCardEntry[] =
      [];
    const outboundBonds = v.shared.pcBonds?.[character.id] ?? [];
    for (const b of outboundBonds) {
      const target = v.shared.synthesizedPcs?.[b.targetPcId];
      const entry: import('./ui/field-renderers/bonds-card').BondsCardEntry = {
        id: b.id,
        targetPcId: b.targetPcId,
        text: b.text,
        targetLabel:
          (target?.name as string | undefined) ??
          `(unknown: ${b.targetPcId})`,
        direction: 'out'
      };
      if (b.dmNotes !== undefined) entry.dmNotes = b.dmNotes;
      bondEntries.push(entry);
    }
    // Inbound: scan every OTHER PC's bonds for targetPcId === character.id.
    for (const [sourcePcId, sourceBonds] of Object.entries(
      v.shared.pcBonds ?? {}
    )) {
      if (sourcePcId === character.id) continue;
      for (const b of sourceBonds) {
        if (b.targetPcId !== character.id) continue;
        const source = v.shared.synthesizedPcs?.[sourcePcId];
        const sourceLabel =
          (source?.name as string | undefined) ?? `(unknown: ${sourcePcId})`;
        const entry: import('./ui/field-renderers/bonds-card').BondsCardEntry =
          {
            id: b.id,
            targetPcId: character.id,
            text: b.text,
            targetLabel:
              (record.name as string | undefined) ?? character.id,
            direction: 'in',
            sourceLabel
          };
        if (b.dmNotes !== undefined) entry.dmNotes = b.dmNotes;
        bondEntries.push(entry);
      }
    }
    if (bondEntries.length > 0) view.bonds = bondEntries;
    const pendingBonds = v.shared.pcBondProposals?.[character.id] ?? [];
    if (pendingBonds.length > 0) {
      view.bondProposals = pendingBonds.map((p) => {
        // D5.5-B: a chargen placeholder bond has targetPcId === ''
        // + a free-text targetPlaceholder.  Show the placeholder as
        // the label + flag unresolved so the ratify form renders
        // the target-resolution picker.
        const isPlaceholder =
          p.targetPcId.length === 0 &&
          (p.targetPlaceholder?.length ?? 0) > 0;
        const target = v.shared.synthesizedPcs?.[p.targetPcId];
        const spoilerHits = this.bondTextSpoilerHits(
          p.text,
          p.targetPlaceholder
        );
        return {
          id: p.id,
          targetPcId: p.targetPcId,
          text: p.text,
          proposedByPeerId: p.proposedByPeerId,
          targetLabel: isPlaceholder
            ? (p.targetPlaceholder as string)
            : ((target?.name as string | undefined) ??
              `(unknown: ${p.targetPcId})`),
          unresolved: isPlaceholder,
          ...(spoilerHits.length > 0 ? { spoilerHits } : {})
        };
      });
    }
    // Wave B (2026-05-26): wire the 4 magic-arc runtime control
    // callbacks ONLY when the local viewer is the coord.  Non-coord
    // viewers see the read-only card without arc controls.
    // Wave C4 (2026-05-26): added thread-debt + reset-spam wiring
    // (moved here from <dm-aside> per UX expert's canonical-home
    // rule).  Same coord gate.
    const isCoord = this.isCoordinator();
    const liveCasterState =
      v.filteredShared.casterState?.[character.id] ?? null;
    return html`<dm-pc-detail
      .view=${view}
      .casterState=${liveCasterState}
      .onLogAccidentalGrant=${
        isCoord
          ? (pcId: string, note: string) =>
              this.appendAccidentalGrantLog(pcId, note)
          : null
      }
      .onMarkRealization=${
        isCoord ? (pcId: string) => this.appendMarkRealization(pcId) : null
      }
      .onGrantFocus=${
        isCoord
          ? (
              pcId: string,
              focus: { name: string; domain?: string; notes?: string }
            ) => this.appendFocusGrant(pcId, focus)
          : null
      }
      .onReleaseTax=${
        isCoord
          ? (pcId: string, moment: string) =>
              this.appendReleaseTax(pcId, moment)
          : null
      }
      .onSetThreadDebt=${
        isCoord
          ? (pcId: string, level: ThreadDebtLevel | '') =>
              this.setThreadDebt(pcId, level)
          : null
      }
      .onResetSpamCounter=${
        isCoord
          ? (pcId: string) => this.resetSpamCounter(pcId)
          : null
      }
      .bondTargetCandidates=${this.bondTargetCandidates(character.id)}
      .onRatifyBond=${
        isCoord
          ? (
              pcId: string,
              id: string,
              opts?: { dmNotes?: string; targetPcId?: string }
            ) =>
              this.ratifyBond({
                pcId,
                id,
                ...(opts?.dmNotes ? { dmNotes: opts.dmNotes } : {}),
                ...(opts?.targetPcId ? { targetPcId: opts.targetPcId } : {})
              })
          : null
      }
      .onRemoveBond=${
        isCoord
          ? (pcId: string, id: string) =>
              this.removeBond({ pcId, id })
          : null
      }
    ></dm-pc-detail>`;
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

  /**
   * Phase B P1d (2026-05-26): cleaner track-set handler used by the
   * new `<track-bar>` component (which computes the new fill level
   * internally and fires `onSetValue(newValue)`).  We just dispatch
   * the pc-edit.  Bound checks come from the same submitPcEdit path
   * the legacy toggleTrackBox uses.
   */
  private setTrackValue(
    pcId: string,
    field: 'harm' | 'stress',
    value: number
  ): void {
    const bounded = Math.max(0, Math.min(4, Math.floor(value)));
    this.submitPcEdit(pcId, field, bounded);
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

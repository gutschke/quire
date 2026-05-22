/**
 * State materialization: reduces an event log into a current SessionState.
 *
 * `materialize(events)` is a pure function — same input always produces the
 * same output.  The function is called with the deterministic causal ordering
 * produced by EventLog.events(), which is what makes state convergence
 * possible across peers even when events arrive in different real-time
 * orders.
 */

import type { PeerId, QuireEvent } from './event-log';

export interface PeerPresence {
  peerId: PeerId;
  name?: string;
  /**
   * Optional character / status string the peer authored about
   * themselves.  E.g. "Yui Tanaka" or "Tim (afk)".  Distinct from
   * `name` (which is the display name the peer registered with at
   * join).  Updated via `peer-rename` events.
   *
   * As of M3a.2, `pcId` (below) is the canonical PC linkage; this
   * field is kept for backward compatibility and for non-PC status
   * strings ("Tim (afk)").  Renderers that want "what character is
   * this player playing" should prefer `pcId` and fall back to
   * `character` when absent.
   */
  character?: string;
  /**
   * P-M3a-pc-binding: optional id of the PC character record the
   * peer has claimed.  When set, the renderer can resolve to the
   * canonical character via the campaign's loaded PCs map and
   * read stats, harm, stress, foci, etc.  Validated via the same
   * PC_ID_RE as character-loader's pcId field; PCs only (no NPCs).
   * Set / cleared via `peer-rename` with a `pcId` payload field.
   */
  pcId?: string;
  joinedAt: number;
  leftAt?: number;
  /**
   * P0-12: count of KNOWN_EVENT_KINDS the peer's runtime recognized
   * at peer-join time.  When this is < the local runtime's count,
   * the peer is running an older Quire and may not render some
   * events the local DM emits.  Used by the render layer to surface
   * a one-line "peer X is on an older version" banner.  Absent for
   * legacy peer-join events from pre-P0-12 runtimes (treat as
   * unknown rather than implicitly old).
   */
  knownKindsCount?: number;
}

export interface DiceRoll {
  peerId: PeerId;
  ts: number;
  expression: string;
  result: number;
  dice: number[];
}

export interface ChatMessage {
  peerId: PeerId;
  ts: number;
  text: string;
}

export interface Note {
  peerId: PeerId;
  ts: number;
  text: string;
  private?: boolean;
}

export interface CampaignRef {
  owner: string;
  repo: string;
  ref: string;
}

/**
 * Per-PC thread-debt rung.  Render-gated DM-only (see filterForViewer).
 * Materializer ships in M3a (P2-5).
 */
export type ThreadDebtLevel =
  | 'quiet'
  | 'noticed'
  | 'watched'
  | 'pushing-back'
  | 'hunted';

/**
 * Per-PC caster-ladder state — combines the magic-discovery
 * ladder (rules-reference.md L125-135), the trying-too-hard tax
 * (L179-186), and the Free/Cheap cast-spam counter (L141) into
 * a single tier-2 record the AI write API can propose updates
 * to.  Render-gated DM-only (the DM narrates the ladder in
 * fiction; players hear consequences, not labels).
 *
 * `ladderState: 'clear'` is the sentinel for "no ladder pressure
 * yet" (avoids the empty-string-as-sentinel fragility Engine
 * flagged on the prior M3c plan draft).
 */
export type CasterLadderState =
  | 'clear'
  | 'quiet'
  | 'noticed'
  | 'watched'
  | 'pushing-back'
  | 'hunted';

export interface CasterState {
  ladderState: CasterLadderState;
  /**
   * AI's suggested narration line for the current rung — the DM
   * reads or rewrites this rather than seeing the bare label.
   */
  reason?: string;
  /** Trying-too-hard tax active (PC suffers -2 on rolls). */
  taxActive: boolean;
  /**
   * Free/Cheap cast-spam counter for the current scene.  Reset
   * via DM-direct button (no scene-transition event yet — see
   * design/m3c-ai-write-api.md §Phase 1 "Reset emitter").
   */
  spamCount: number;
}

/**
 * DM scratch note — quick-jot during play, ingested by the
 * living-document AI post-session.  Render-gated DM-only AND
 * event-stripped from player save exports (see
 * `serializeSessionForViewer` in persistence.ts, lands in M3a).
 * Materializer ships in M3a (P2-3).
 */
export interface ScratchNote {
  peerId: PeerId;
  ts: number;
  text: string;
  scenePath?: string;
}

/**
 * Hash-chain audit entry for AI broker calls.  The full prompt and
 * response text lives in IndexedDB keyed by hash on the DM's
 * machine; only the chain head + token counts replicate via events.
 * Render-gated DM-only AND event-stripped from player save exports.
 * Materializer ships in M3b (P2-7).
 */
export interface AiAuditEntry {
  peerId: PeerId;
  ts: number;
  kind: 'prompt' | 'response' | 'accept' | 'reject';
  responseId?: string;
  promptHash?: string;
  responseHash?: string;
  prevHash?: string;
  tokensIn?: number;
  tokensOut?: number;
  category?: string;
}

/**
 * Single blob on a schematic map.  Materializer ships in M6 (P5-3).
 */
export interface MapBlob {
  id: string;
  label: string;
  x: number;
  y: number;
  kind?: 'token' | 'note' | 'hazard';
}

export interface SessionState {
  peers: Record<PeerId, PeerPresence>;
  /**
   * Campaign the session is anchored to.  Embedded in the host's
   * peer-join event so that guests who land on play.quire.games
   * without `?campaign=` URL params still learn what to load.
   * First-write-wins: set by the earliest peer-join that includes
   * a campaign reference; later ones don't override.
   */
  campaign?: CampaignRef;
  coordinator?: PeerId;
  /**
   * Every peer who has ever held coordinator at any point in the
   * event log (successful coord-claim OR coord-reclaim).  Used by
   * scene-reveal's authority check: a reveal is accepted if the
   * author was coord at SOME point, not just the current moment.
   *
   * This is important for multi-session continuity: when a new
   * host loads a save authored by a prior DM, the prior DM's
   * scene-reveal events should still apply even though the current
   * coordinator is the new host.  Without this, alphabetical
   * peerId tiebreak on coord-claim sorting determined whether
   * loaded reveals survived — non-deterministic.
   *
   * Trade-off: a peer who was briefly coord can keep authoring
   * reveals even after handoff (until kicked from session).  In a
   * TTRPG context this is acceptable — past-coord-authority
   * abuse is socially visible and the audit-trail chat captures
   * the original handoff.
   */
  coordHolders: Set<PeerId>;
  revealedScenes: string[];
  diceRolls: DiceRoll[];
  chat: ChatMessage[];
  pcEdits: Record<string, Record<string, unknown>>;
  notes: Note[];

  // ── M1+ fields (materializers land per-feature) ──

  /**
   * Block-hash set of revealed paragraphs per scene.  See
   * `redesign-plan.md` § "Event vocabulary additions" for the
   * content-addressed hashing rationale.  Materializer ships in
   * M3a (P2-2).  Player-visible (no DM-only gating); the player
   * Stage filters its rendered DOM by this set.
   */
  revealedParagraphs: Record<string /*scenePath*/, Set<string /*blockHash*/>>;

  /**
   * Per-PC thread-debt rung.  Authoritative shared state for co-DM
   * continuity; render-gated DM-only.  Materializer ships in M3a (P2-5).
   */
  threadDebt: Record<string /*pcId*/, ThreadDebtLevel>;

  /**
   * Ordered list of NPC ids the DM has pinned for quick reference.
   * Shared (co-DM continuity); render-gated DM-only.  Materializer
   * ships in M3a (P2-4).
   */
  pinnedNpcs: string[];

  /**
   * Map blobs per scene.  Shared; DM places, players see only
   * revealed blobs.  Materializer ships in M6 (P5-3).
   */
  mapBlobs: Record<string /*scenePath*/, MapBlob[]>;
  /**
   * Per-scene set of blob ids that are currently revealed to
   * players.  Materializer ships in M6 (P5-3).
   */
  mapBlobReveals: Record<string /*scenePath*/, Set<string /*blobId*/>>;

  /**
   * Most recent broadcast-view event (LWW single slot).  Players
   * navigate to this when it changes.  Materializer ships in M3a (P2-11).
   */
  broadcastView?: { stagePath: string; tab?: string; ts: number };

  /**
   * Peers with hand currently raised (self-only authorship).
   * Player-visible.  Materializer ships in M2 (P1-7).
   */
  raisedHands: Set<PeerId>;

  /**
   * DM scratch notes (chronological).  Authoritative shared
   * (events.jsonl needs them for AI ingestion), render-gated
   * DM-only, AND event-stripped from player save exports.
   * Materializer ships in M3a (P2-3).
   */
  scratchNotes: ScratchNote[];

  /**
   * AI audit chain entries.  Render-gated DM-only, event-stripped
   * from player save exports.  Materializer ships in M3b (P2-7).
   */
  aiAudit: AiAuditEntry[];

  /**
   * Per-PC caster-ladder state.  DM-only (wiped by filterForViewer);
   * stripped from shareable saves via PLAYER_SCOPE_STRIP_KINDS.
   * Authored exclusively via `caster-state-set` events.  Materializer
   * ships in M3c.
   */
  casterState: Record<string /*pcId*/, CasterState>;
}

export function emptyState(): SessionState {
  return {
    peers: {},
    coordHolders: new Set(),
    revealedScenes: [],
    diceRolls: [],
    chat: [],
    pcEdits: {},
    notes: [],
    // M1+ fields — materializers land per-feature; until then, empty.
    revealedParagraphs: {},
    threadDebt: {},
    pinnedNpcs: [],
    mapBlobs: {},
    mapBlobReveals: {},
    raisedHands: new Set(),
    scratchNotes: [],
    aiAudit: [],
    casterState: {}
  };
}

/**
 * Render-side filter that strips DM-only fields when the viewing peer
 * is NOT in the coordinator-holders set.  Use this at the boundary
 * between SessionController and UI region components — every region
 * MUST read from a filtered `SessionView`, never from the raw
 * `SessionState`.  Centralizing the gate here prevents per-region
 * regressions where a new field forgets to be gated.
 *
 * The complementary save-export filter (`serializeSessionForViewer`
 * in persistence.ts) handles the EVENT-LEVEL stripping for player
 * save exports; that lands in M3a alongside the first DM-only event.
 *
 * Note: M3a/M3b/M4/M5/M6 materializers populate the DM-only fields.
 * At M1, every DM-only field is empty (no materializers yet), so
 * this filter is effectively a no-op behaviorally — but its contract
 * is locked in now.
 *
 * Visibility classes:
 *   - Always-visible: peers, campaign, coordinator, coordHolders,
 *     revealedScenes, revealedParagraphs, diceRolls, chat, pcEdits,
 *     notes, raisedHands, broadcastView, mapBlobs (filtered),
 *     mapBlobReveals.
 *   - DM-only (stripped for non-coord-holders): threadDebt,
 *     pinnedNpcs, scratchNotes, aiAudit.
 *   - Reveal-mask-gated (DM sees all, players see only revealed):
 *     mapBlobs (filtered through mapBlobReveals).
 */
export function filterForViewer(
  state: SessionState,
  viewerPeerId: PeerId
): SessionState {
  // Key on the CURRENT coordinator, not the historical coordHolders
  // set.  A peer who briefly held coord and yielded should fall back
  // to a player-scoped view immediately — otherwise the rendered UI
  // continues to surface DM-only fields long after the role passed.
  //
  // The materializer still gates AUTHORSHIP on coordHolders (to
  // accept legitimate events from a prior coord in a loaded log),
  // but READS / RENDERS pivot on `state.coordinator` so the visible
  // surface tracks the live role.  This is the accidental-disclosure
  // guard for the yielded-coord scenario in
  // project_quire_threat_model.
  if (state.coordinator === viewerPeerId) {
    return state;
  }
  // Filter mapBlobs by the reveal mask, scene-by-scene.
  const filteredMapBlobs: Record<string, MapBlob[]> = {};
  for (const [scenePath, blobs] of Object.entries(state.mapBlobs)) {
    const reveals = state.mapBlobReveals[scenePath];
    if (reveals && reveals.size > 0) {
      const visible = blobs.filter((b) => reveals.has(b.id));
      if (visible.length > 0) filteredMapBlobs[scenePath] = visible;
    }
    // If no reveals for the scene, players see no blobs.  Skipping
    // the assignment leaves the entry absent (cleaner than an empty
    // array, signals "nothing here" semantically).
  }
  return {
    ...state,
    // DM-only fields wiped:
    threadDebt: {},
    pinnedNpcs: [],
    scratchNotes: [],
    aiAudit: [],
    casterState: {},
    // Reveal-mask-gated:
    mapBlobs: filteredMapBlobs
  };
}

export function materialize(events: readonly QuireEvent[]): SessionState {
  const state = emptyState();
  for (const event of events) {
    applyEventToState(state, event);
  }
  return state;
}

interface PeerJoinPayload {
  name?: string;
}

interface SceneRevealPayload {
  scenePath: string;
}

interface SceneRevealParagraphPayload {
  v: 1;
  scenePath: string;
  /** 16-hex-char content hash from `blockHash` in markdown.ts. */
  blockHash: string;
  /** Non-authoritative UI hint; materializer ignores its value. */
  paragraphIndex?: number;
}

/**
 * Validate a block-hash payload field.  Must be exactly 16 lowercase
 * hex characters (matching the {@link blockHash} output format —
 * `BLOCK_HASH_LENGTH` in redesign-plan.md).
 */
function isBlockHash(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);
}

/**
 * Per-scene cap on tracked revealed-block hashes — `REVEALED_BLOCKS_PER_SCENE_CAP`
 * in redesign-plan.md.  DoS guard: prevents a hostile coordinator
 * (or replayed compromised log) from growing a Set unboundedly.
 * 256 is well above any realistic scene length; if scenes ever do
 * exceed it, the campaign is structurally over-long.
 */
const REVEALED_BLOCKS_PER_SCENE_CAP = 256;

/**
 * Caps from redesign-plan.md § "New caps to add" — DoS guards for
 * the M3a cockpit materializers.  These match the spec verbatim;
 * see security.md for the threat model.
 */
const PINNED_NPC_CAP = 50;
const SCRATCH_NOTE_CAP = 5000;
const SCRATCH_NOTE_TEXT_CAP = 5000;

/**
 * Per-session cap on aiAudit entries — M3b.3.  Each AI exchange
 * is 2-4 events (prompt + response + optional accept/reject), so
 * 5000 entries allows ~1200 prompts before degradation.  Realistic
 * sessions never approach this; the cap exists to bound a hostile
 * coordinator from spamming the audit chain to grow shared state
 * memory unboundedly.
 */
const AI_AUDIT_CAP = 5000;

/**
 * Validate a hash payload field.  AI prompt / response hashes are
 * sha256-derived first-N hex characters; we accept lengths from 8
 * to 64 to tolerate provider-side variation while still rejecting
 * obvious junk like empty strings or non-hex content.
 */
function isHexHash(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8,64}$/.test(s);
}

interface AiPromptPayload {
  v: 1;
  promptHash: string;
  model: string;
  contextRefs?: string[];
  tokenIn: number;
}

interface AiResponsePayload {
  v: 1;
  responseId: string;
  tokenOut: number;
  hash: string;
  prevHash: string;
}

interface AiVerdictPayload {
  v: 1;
  responseId: string;
  category?: string;
}

interface NpcPinPayload {
  v: 1;
  npcId: string;
}

interface ScratchNotePayload {
  v: 1;
  text: string;
  scenePath?: string;
}

interface ThreadDebtSetPayload {
  v: 1;
  pcId: string;
  /** Empty string clears the entry; otherwise must be a valid level. */
  level: ThreadDebtLevel | '';
}

interface BroadcastViewPayload {
  v: 1;
  stagePath: string;
  tab?: string;
}

const THREAD_DEBT_LEVELS: ReadonlySet<ThreadDebtLevel> = new Set<ThreadDebtLevel>([
  'quiet',
  'noticed',
  'watched',
  'pushing-back',
  'hunted'
]);

function isThreadDebtLevel(s: unknown): s is ThreadDebtLevel {
  return typeof s === 'string' && THREAD_DEBT_LEVELS.has(s as ThreadDebtLevel);
}

interface CasterStateSetPayload {
  v: 1;
  pcId: string;
  /**
   * `'clear'` is the sentinel for "no ladder pressure" — see the
   * CasterLadderState comment.  Explicit-enum avoids the empty-
   * string-as-sentinel fragility.
   */
  ladderState: CasterLadderState;
  reason?: string;
  taxActive?: boolean;
  spamCount?: number;
  /**
   * Set when the event was synthesized from an AI-proposed
   * stateUpdate (M3c.5 hard-gate enforcement reads this).
   */
  causedByResponseId?: string;
}

const CASTER_LADDER_STATES: ReadonlySet<CasterLadderState> =
  new Set<CasterLadderState>([
    'clear',
    'quiet',
    'noticed',
    'watched',
    'pushing-back',
    'hunted'
  ]);

function isCasterLadderState(s: unknown): s is CasterLadderState {
  return (
    typeof s === 'string' &&
    CASTER_LADDER_STATES.has(s as CasterLadderState)
  );
}

/**
 * Cap on `casterState.spamCount`.  A defensive bound — the runtime
 * never approaches this; the cap protects against a hostile-payload
 * spamCount = Number.MAX_SAFE_INTEGER from corrupting the meter.
 */
const SPAM_COUNT_CAP = 100;

/** Cap on `caster-state-set.reason` length. */
const CASTER_REASON_CAP = 500;

interface DiceRollPayload {
  expression: string;
  result: number;
  dice: number[];
}

interface ChatPayload {
  text: string;
}

interface PcEditPayload {
  pcId: string;
  field: string;
  value: unknown;
}

interface NotePayload {
  text: string;
  private?: boolean;
}

// Builtin Object property names that, used as a key in pcEdits or
// similar plain-object maps, would pollute the prototype chain or
// shadow built-in methods.  Aligned with EventLog's POISONOUS_KEYS.
const POISONOUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString'
]);

const ID_CAP = 256;
const SCENE_PATH_CAP = 2048;
const CHAT_CAP = 5000;
const NOTE_CAP = 10000;
// Per-pc cap on stored edit fields.  Defends against a hostile peer
// spamming thousands of distinct `field` keys to bloat memory.
const PC_FIELD_COUNT_CAP = 100;
// Match the character-loader's ID_RE so a pcId that would never
// resolve to a real character never enters pcEdits.  Stricter than
// the prior "safe key" check.
const PC_ID_RE = /^[A-Za-z0-9._-]+$/;

function isSafeKey(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= ID_CAP &&
    !POISONOUS_KEYS.has(s)
  );
}

function isCharacterId(s: unknown): s is string {
  if (!isSafeKey(s)) return false;
  if (s === '.' || s === '..') return false;
  return PC_ID_RE.test(s);
}

function isBoundedString(s: unknown, cap: number): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= cap;
}

function isPlainObjectPayload(p: unknown): p is Record<string, unknown> {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

/**
 * Set of event kinds the materializer knows how to handle.  Kept in
 * sync with the switch below.  Used by persistence to flag
 * unknown-kind events in a save (forward-compat: still applied to
 * the log so they replicate, but counted so the loader can warn
 * "this save contains events your version doesn't understand").
 */
export const KNOWN_EVENT_KINDS = new Set([
  // v0 kinds (legacy; no payload version field)
  'peer-join',
  'peer-leave',
  'peer-rename',
  'peer-disconnect',
  'coordinator-claim',
  'coordinator-yield',
  'coordinator-reclaim',
  'scene-reveal',
  'scene-unreveal',
  'dice-roll',
  'chat',
  'pc-edit',
  'note',
  // M1 additions (P0-5).  Registered now so saves from intermediate
  // versions of the runtime stay forward-compatible; materializers
  // land per-feature in M3a/M3b/M4/M5/M6.  Every new payload schema
  // carries an explicit `v: 1` field — materializers added later
  // MUST check v and reject unknown versions, surfacing via the H-4
  // unknown-kind banner.  This buys freedom to revise payload shapes
  // through M3a/M3b without breaking saves.  Spec: redesign-plan.md
  // § "Event vocabulary additions" + "Payload versioning."
  'scene-reveal-paragraph',
  'scene-unreveal-paragraph',
  'thread-debt-set',
  'npc-pin',
  'npc-unpin',
  'map-blob-add',
  'map-blob-move',
  'map-blob-remove',
  'map-blob-reveal',
  'map-blob-unreveal',
  'broadcast-view',
  'raise-hand',
  'lower-hand',
  'scratch-note',
  'ai-prompt',
  'ai-response',
  'ai-accept',
  'ai-reject',
  'caster-state-set'
]);

/**
 * Payload version constant for M1+ event kinds.  Every materializer
 * added in M3a+ for the M1-registered kinds MUST validate
 * `payload.v === EVENT_PAYLOAD_V1` and reject unknown versions.
 * This lets payload schemas evolve through the project without
 * silently corrupting saves from intermediate versions.
 */
export const EVENT_PAYLOAD_V1 = 1;

/**
 * Predicate: does this payload carry the expected M1+ payload version?
 *
 * Returns true iff `payload` is a non-null object whose `v` property
 * strictly equals EVENT_PAYLOAD_V1.  Materializers for the 18 M1-
 * registered event kinds MUST call this before reading payload fields
 * and break (no-op) on false.  Hostile-input tests in
 * `state.hostile.test.ts` pin this contract.
 *
 * The 18 M1 kinds (scene-reveal-paragraph, thread-debt-set,
 * npc-pin, etc.) all use this; the legacy v0 kinds (peer-join,
 * chat, dice-roll, etc.) do NOT — they have their own payload
 * shapes documented above.
 */
export function isPayloadV1(payload: unknown): payload is { v: 1 } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    (payload as { v?: unknown }).v === EVENT_PAYLOAD_V1
  );
}

function applyEventToState(state: SessionState, event: QuireEvent): void {
  switch (event.kind) {
    case 'peer-join': {
      const p = event.payload as
        | (PeerJoinPayload & {
            campaign?: { owner?: unknown; repo?: unknown; ref?: unknown };
            knownKindsCount?: unknown;
          })
        | undefined;
      // P0-12: capture the joining peer's KNOWN_EVENT_KINDS count if
      // it announced one.  Bounded sanity check (no negative, no
      // larger than 10x current vocabulary) so a hostile payload
      // can't bloat or confuse the version-mismatch banner.
      let knownKindsCount: number | undefined;
      if (
        typeof p?.knownKindsCount === 'number' &&
        Number.isFinite(p.knownKindsCount) &&
        p.knownKindsCount >= 0 &&
        p.knownKindsCount <= 10000
      ) {
        knownKindsCount = p.knownKindsCount;
      }
      state.peers[event.peerId] = {
        peerId: event.peerId,
        name: p?.name,
        joinedAt: event.ts,
        knownKindsCount
      };
      // R3-C: a host's peer-join may embed the campaign reference
      // so guests who joined via a bare URL (play.quire.games +
      // code, no `?campaign=`) can discover what to load.  First-
      // write-wins: only the earliest peer-join with a campaign
      // sets it; later joiners can't override.
      if (
        !state.campaign &&
        p?.campaign &&
        typeof p.campaign === 'object' &&
        typeof p.campaign.owner === 'string' &&
        typeof p.campaign.repo === 'string' &&
        typeof p.campaign.ref === 'string' &&
        p.campaign.owner.length > 0 &&
        p.campaign.repo.length > 0 &&
        p.campaign.ref.length > 0
      ) {
        state.campaign = {
          owner: p.campaign.owner,
          repo: p.campaign.repo,
          ref: p.campaign.ref
        };
      }
      break;
    }
    case 'peer-leave': {
      const p = state.peers[event.peerId];
      if (p) p.leftAt = event.ts;
      // M2.8: a leaving peer's hand drops automatically — a stale
      // raised hand after departure would clutter the roster.
      state.raisedHands.delete(event.peerId);
      break;
    }
    case 'peer-disconnect': {
      // Coordinator-only: mark another peer as departed when the
      // network detects their connection closing.  Distinct from
      // self-authored 'peer-leave' (which is for clean exits).
      // Without this, closing a browser tab without leaving
      // cleanly leaves the peer permanently in the roster.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as { peerId?: unknown };
      if (typeof p.peerId !== 'string' || p.peerId.length === 0) break;
      const target = state.peers[p.peerId];
      if (target && target.leftAt === undefined) {
        target.leftAt = event.ts;
      }
      // M2.8: drop the disconnected peer's raised hand (same
      // reasoning as peer-leave — a stale hand on a vanished peer
      // is clutter).
      state.raisedHands.delete(p.peerId);
      break;
    }
    case 'peer-rename': {
      // Self-rename only — the event.peerId IS the author (R2.1
      // already enforces this on the wire).  A peer can update
      // their display name, their character status string, and/or
      // their PC binding (M3a.2 P-M3a-pc-binding).
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as {
        name?: unknown;
        character?: unknown;
        pcId?: unknown;
      };
      const presence = state.peers[event.peerId];
      if (!presence) break;
      if (typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 80) {
        presence.name = p.name;
      }
      if (typeof p.character === 'string' && p.character.length <= 80) {
        // Empty string explicitly clears the character.
        presence.character = p.character.length === 0 ? undefined : p.character;
      }
      // M3a.2: pcId follows the same set/clear semantics.  Empty
      // string clears.  Non-string / invalid id is ignored (so a
      // legacy peer that doesn't set pcId doesn't accidentally
      // unbind a previously-bound one — that's an explicit clear,
      // not an omission).
      if (typeof p.pcId === 'string') {
        if (p.pcId.length === 0) {
          presence.pcId = undefined;
        } else if (isCharacterId(p.pcId)) {
          presence.pcId = p.pcId;
        }
        // else: invalid id, silently dropped (defensive).
      }
      break;
    }
    case 'coordinator-claim': {
      // EXPRESSED claim — record the author in coordHolders even if
      // first-wins gates the actual transition.  This matters across
      // session boundaries: when a fresh-host loads a save authored
      // by a prior DM, the prior DM's coord-claim sorts at sum=2
      // tied with the fresh host's; first-wins on alphabetical
      // peerId may or may not let the prior DM "win" — but their
      // scene-reveals must still apply, which requires them to be
      // in coordHolders.  Authority comes from "ever expressed a
      // claim", not from "currently winning the claim race."
      state.coordHolders.add(event.peerId);
      if (!state.coordinator) {
        state.coordinator = event.peerId;
      }
      break;
    }
    case 'coordinator-yield': {
      if (state.coordinator === event.peerId) state.coordinator = undefined;
      // coordHolders intentionally NOT cleared — historical
      // authority is preserved for reveal-acceptance.
      break;
    }
    case 'coordinator-reclaim': {
      // Unlike coordinator-claim ("first claim wins"), reclaim is
      // unconditional: the issuing peer becomes coordinator.  The
      // R2.1 cross-check in Peer.handleMessage prevents non-DM
      // forgery on the wire; here we trust that the event reached
      // us legitimately.  Synthesizes a system chat entry as the
      // audit trail so every peer sees "who took over from whom."
      //
      // SECURITY (M1 gate finding): the audit-string interpolates
      // peerIds.  Today peerIds are opaque random codes (the
      // pairing-code alphabet) — safe to put in player-visible
      // chat.  If a future commit makes peerIds human-readable
      // (e.g. display-name-prefixed), this synthesizes player-
      // visible PII.  Keep peerIds opaque.
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as { fromPeerId?: unknown };
      const fromPeerId =
        typeof p.fromPeerId === 'string' && p.fromPeerId.length > 0
          ? p.fromPeerId
          : state.coordinator;
      state.coordinator = event.peerId;
      state.coordHolders.add(event.peerId);
      const auditText = fromPeerId
        ? `[system] ${event.peerId} took over as coordinator from ${fromPeerId}`
        : `[system] ${event.peerId} took over as coordinator`;
      state.chat.push({
        peerId: event.peerId,
        ts: event.ts,
        text: auditText
      });
      break;
    }
    case 'scene-reveal': {
      // Authority check: the author must have been coordinator at
      // SOME point in the event log, not necessarily now.  Without
      // this, loaded reveals from a prior session would be dropped
      // when the new host's coord-claim won the alphabetical
      // peerId tiebreak.  See coordHolders comment in SessionState.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as Partial<SceneRevealPayload>;
      if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) break;
      if (!state.revealedScenes.includes(p.scenePath)) {
        state.revealedScenes.push(p.scenePath);
      }
      break;
    }
    case 'scene-unreveal': {
      // DM-revoke for an accidental reveal.  Same authority check
      // as reveal.  Removes the scene path from revealedScenes;
      // players who were viewing that scene will be navigated
      // away by the UI layer on their next render.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as Partial<SceneRevealPayload>;
      if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) break;
      const idx = state.revealedScenes.indexOf(p.scenePath);
      if (idx >= 0) state.revealedScenes.splice(idx, 1);
      break;
    }
    case 'dice-roll': {
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as Partial<DiceRollPayload>;
      if (!isBoundedString(p.expression, ID_CAP)) break;
      if (typeof p.result !== 'number' || !Number.isFinite(p.result)) break;
      if (!Array.isArray(p.dice)) break;
      // Bound the dice array length and verify entries are numbers.
      if (p.dice.length > 100) break;
      if (!p.dice.every((d) => typeof d === 'number' && Number.isFinite(d))) {
        break;
      }
      state.diceRolls.push({
        peerId: event.peerId,
        ts: event.ts,
        expression: p.expression,
        result: p.result,
        dice: p.dice
      });
      break;
    }
    case 'chat': {
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as Partial<ChatPayload>;
      if (!isBoundedString(p.text, CHAT_CAP)) break;
      state.chat.push({
        peerId: event.peerId,
        ts: event.ts,
        text: p.text
      });
      break;
    }
    case 'pc-edit': {
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as Partial<PcEditPayload>;
      if (!isCharacterId(p.pcId)) break;
      if (!isSafeKey(p.field)) break;
      // value is intentionally unrestricted at this layer — the
      // character-edits helper (applyCharacterEdits) clamps and
      // type-checks on read so an unknown field is silently
      // dropped at render time.  Storing the raw value preserves
      // forward compatibility with future editable fields.
      const pc = state.pcEdits[p.pcId] ?? {};
      // DoS guard: bound the number of distinct fields stored per
      // PC.  Existing fields are still updatable (LWW) once the cap
      // is reached; only new keys get rejected.
      if (
        !Object.prototype.hasOwnProperty.call(pc, p.field) &&
        Object.keys(pc).length >= PC_FIELD_COUNT_CAP
      ) {
        break;
      }
      pc[p.field] = p.value;
      state.pcEdits[p.pcId] = pc;
      break;
    }
    case 'note': {
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as Partial<NotePayload>;
      if (!isBoundedString(p.text, NOTE_CAP)) break;
      // private must be a boolean if present (defaults to undefined
      // when omitted, which is fine).  Drops non-boolean values like
      // objects/strings rather than coercing.
      const priv =
        typeof p.private === 'boolean' ? p.private : undefined;
      state.notes.push({
        peerId: event.peerId,
        ts: event.ts,
        text: p.text,
        private: priv
      });
      break;
    }
    // -----------------------------------------------------------
    // M1-registered kinds (P0-5).  Materializers ship per-feature
    // in M3a/M3b/M4/M5/M6 — at M1 we only validate the payload
    // version and break.  This makes the v:1 invariant a real
    // contract: any future materializer that lands here MUST
    // continue to call isPayloadV1 (or its successor for v:2+) and
    // reject mismatched versions.  Tests in state.hostile.test.ts
    // pin the rejection behavior on synthetic events.
    // -----------------------------------------------------------
    case 'raise-hand': {
      // M2.8 (P1-7): the local peer raises their hand.  Self-only
      // authorship — event.peerId IS the author per R2.1 wire-layer
      // cross-check.  No DM gate; any peer can raise their own hand.
      if (!isPayloadV1(event.payload)) break;
      // Defensive: only track raised hands for known peers (a raise
      // before peer-join shouldn't materialize).  This naturally
      // dedupes — Set.add is idempotent.
      if (state.peers[event.peerId]) {
        state.raisedHands.add(event.peerId);
      }
      break;
    }
    case 'lower-hand': {
      // Self-only lower of own hand.  Mirrors raise-hand.
      if (!isPayloadV1(event.payload)) break;
      state.raisedHands.delete(event.peerId);
      break;
    }
    case 'scene-reveal-paragraph': {
      // Coord-authored per-block reveal.  Block identity is the
      // 16-hex-char content hash (`blockHash` in markdown.ts);
      // see redesign-plan.md § "Event vocabulary additions" for
      // the content-addressing rationale.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<SceneRevealParagraphPayload>;
      if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) break;
      if (!isBlockHash(p.blockHash)) break;
      // paragraphIndex is a UI hint only — accept absence or any
      // finite number, drop pathological values (huge floats, NaN,
      // non-numbers) before they reach the (unused) field.
      if (
        p.paragraphIndex !== undefined &&
        (typeof p.paragraphIndex !== 'number' ||
          !Number.isFinite(p.paragraphIndex))
      ) {
        break;
      }
      let set = state.revealedParagraphs[p.scenePath];
      if (!set) {
        set = new Set<string>();
        state.revealedParagraphs[p.scenePath] = set;
      }
      // Cap enforcement — protect against hostile peers or replayed
      // logs from a compromised session.  Silently drops once the
      // set is full; a sane DM never approaches the cap.
      if (set.size >= REVEALED_BLOCKS_PER_SCENE_CAP && !set.has(p.blockHash)) {
        break;
      }
      set.add(p.blockHash);
      break;
    }
    case 'scene-unreveal-paragraph': {
      // DM-revoke of a per-block reveal.  Symmetric to the reveal
      // path above; deletes from the set and prunes the empty set
      // so the keyed map doesn't grow unboundedly across sessions.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<SceneRevealParagraphPayload>;
      if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) break;
      if (!isBlockHash(p.blockHash)) break;
      if (
        p.paragraphIndex !== undefined &&
        (typeof p.paragraphIndex !== 'number' ||
          !Number.isFinite(p.paragraphIndex))
      ) {
        break;
      }
      const set = state.revealedParagraphs[p.scenePath];
      if (!set) break;
      set.delete(p.blockHash);
      if (set.size === 0) {
        delete state.revealedParagraphs[p.scenePath];
      }
      break;
    }
    case 'npc-pin': {
      // Coord-only DM affordance — pin an NPC id to the dm-aside
      // for quick reference.  Order preserved; the list acts like
      // a manually-curated stack.  Idempotent.  DoS-capped at 50.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<NpcPinPayload>;
      if (!isCharacterId(p.npcId)) break;
      if (state.pinnedNpcs.includes(p.npcId)) break;
      if (state.pinnedNpcs.length >= PINNED_NPC_CAP) break;
      state.pinnedNpcs.push(p.npcId);
      break;
    }
    case 'npc-unpin': {
      // DM-revoke of a pin.  Removes by id; absent-id is a no-op.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<NpcPinPayload>;
      if (!isCharacterId(p.npcId)) break;
      const idx = state.pinnedNpcs.indexOf(p.npcId);
      if (idx >= 0) state.pinnedNpcs.splice(idx, 1);
      break;
    }
    case 'thread-debt-set': {
      // Coord-only.  Sets the per-PC rung; level === '' clears
      // the entry (LWW semantics — last DM write wins).
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<ThreadDebtSetPayload>;
      if (!isCharacterId(p.pcId)) break;
      if (p.level === '') {
        delete state.threadDebt[p.pcId];
        break;
      }
      if (!isThreadDebtLevel(p.level)) break;
      state.threadDebt[p.pcId] = p.level;
      break;
    }
    case 'scratch-note': {
      // Coord-only quick-jot.  Append-only chronological log;
      // ingested by the post-session living-document AI.  Capped
      // at SCRATCH_NOTE_CAP entries to bound memory; once full,
      // silently drops new notes (DM is warned via dm-only UI).
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<ScratchNotePayload>;
      if (!isBoundedString(p.text, SCRATCH_NOTE_TEXT_CAP)) break;
      if (
        p.scenePath !== undefined &&
        !isBoundedString(p.scenePath, SCENE_PATH_CAP)
      ) {
        break;
      }
      if (state.scratchNotes.length >= SCRATCH_NOTE_CAP) break;
      state.scratchNotes.push({
        peerId: event.peerId,
        ts: event.ts,
        text: p.text,
        scenePath: p.scenePath
      });
      break;
    }
    case 'broadcast-view': {
      // Coord-only LWW single slot.  Players' Stage navigates to
      // {stagePath, tab?} when the field changes.  Older events
      // are ignored — the materializer keeps the newest by ts.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<BroadcastViewPayload>;
      if (!isBoundedString(p.stagePath, SCENE_PATH_CAP)) break;
      if (p.tab !== undefined && !isBoundedString(p.tab, ID_CAP)) break;
      // Clamp event.ts to a plausible wall-clock window.  Without
      // this guard a hostile coord (or a poisoned save file) could
      // emit ts = Number.MAX_SAFE_INTEGER and permanently lock the
      // LWW slot — every subsequent legitimate broadcast would
      // lose the strict-greater comparison forever.  The cap is
      // generous (a year past materialization start) so honest
      // clock skew between peers never trips it.
      const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
      if (event.ts > Date.now() + ONE_YEAR_MS) break;
      // LWW with append-order tie-break: equal-ts events from the
      // same materialization pass replace in log order.  Strict
      // less-than means an older (lower ts) broadcast loses
      // unconditionally; same ts → the later append wins because
      // we never short-circuit when ts equals current.ts.
      const current = state.broadcastView;
      if (current && current.ts > event.ts) break;
      state.broadcastView = {
        stagePath: p.stagePath,
        tab: p.tab,
        ts: event.ts
      };
      break;
    }
    case 'ai-prompt': {
      // Coord-only AI broker audit entry — prompt half.  Full
      // prompt text lives in IndexedDB keyed by promptHash on the
      // DM's machine; only the chain head + token count replicate
      // via this event.  Render-gated DM-only + stripped from
      // shareable saves.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<AiPromptPayload>;
      if (!isHexHash(p.promptHash)) break;
      if (!isBoundedString(p.model, ID_CAP)) break;
      if (typeof p.tokenIn !== 'number' || !Number.isFinite(p.tokenIn)) break;
      if (p.tokenIn < 0) break;
      if (p.contextRefs !== undefined) {
        if (!Array.isArray(p.contextRefs)) break;
        if (p.contextRefs.length > 50) break;
        if (
          !p.contextRefs.every((r) => isBoundedString(r, SCENE_PATH_CAP))
        ) {
          break;
        }
      }
      if (state.aiAudit.length >= AI_AUDIT_CAP) break;
      state.aiAudit.push({
        peerId: event.peerId,
        ts: event.ts,
        kind: 'prompt',
        promptHash: p.promptHash,
        tokensIn: p.tokenIn
      });
      break;
    }
    case 'ai-response': {
      // Coord-only AI broker audit entry — response half.
      // Hash-chained against the prior chain head (prevHash); the
      // materializer doesn't enforce chain continuity (that's the
      // broker's job at append time) but stores both hashes so a
      // post-session audit can reconstruct the chain.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<AiResponsePayload>;
      if (!isBoundedString(p.responseId, ID_CAP)) break;
      if (typeof p.tokenOut !== 'number' || !Number.isFinite(p.tokenOut)) break;
      if (p.tokenOut < 0) break;
      if (!isHexHash(p.hash)) break;
      // prevHash may be empty (very first response in a session has
      // no predecessor); accept empty string OR a valid hash.
      if (p.prevHash !== '' && !isHexHash(p.prevHash)) break;
      if (state.aiAudit.length >= AI_AUDIT_CAP) break;
      state.aiAudit.push({
        peerId: event.peerId,
        ts: event.ts,
        kind: 'response',
        responseId: p.responseId,
        responseHash: p.hash,
        prevHash: p.prevHash,
        tokensOut: p.tokenOut
      });
      break;
    }
    case 'ai-accept':
    case 'ai-reject': {
      // Coord-only DM verdict on an AI response.  The verdict is
      // a hint for future tuning — it doesn't change the audit
      // chain's hash continuity.  Category is optional + bounded;
      // when absent the audit row still lands.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<AiVerdictPayload>;
      if (!isBoundedString(p.responseId, ID_CAP)) break;
      if (
        p.category !== undefined &&
        !isBoundedString(p.category, ID_CAP)
      ) {
        break;
      }
      if (state.aiAudit.length >= AI_AUDIT_CAP) break;
      state.aiAudit.push({
        peerId: event.peerId,
        ts: event.ts,
        kind: event.kind === 'ai-accept' ? 'accept' : 'reject',
        responseId: p.responseId,
        category: p.category
      });
      break;
    }
    case 'caster-state-set': {
      // Coord-only DM-side caster ladder + tax + spam-counter
      // (rules-reference.md L125-141 + L179-186).  M3c.1
      // materializer; M3c.5 wires hard-gate enforcement on
      // causedByResponseId for the AI-write path.  Render-gated
      // DM-only via filterForViewer + stripped from shareable saves.
      if (!state.coordHolders.has(event.peerId)) break;
      if (!isPayloadV1(event.payload)) break;
      const p = event.payload as Partial<CasterStateSetPayload>;
      if (!isCharacterId(p.pcId)) break;
      if (!isCasterLadderState(p.ladderState)) break;
      if (
        p.reason !== undefined &&
        !isBoundedString(p.reason, CASTER_REASON_CAP)
      ) {
        break;
      }
      if (p.taxActive !== undefined && typeof p.taxActive !== 'boolean') {
        break;
      }
      if (p.spamCount !== undefined) {
        if (typeof p.spamCount !== 'number') break;
        if (!Number.isFinite(p.spamCount)) break;
        if (!Number.isInteger(p.spamCount)) break;
        if (p.spamCount < 0 || p.spamCount > SPAM_COUNT_CAP) break;
      }
      if (
        p.causedByResponseId !== undefined &&
        !isBoundedString(p.causedByResponseId, ID_CAP)
      ) {
        break;
      }
      const prior = state.casterState[p.pcId];
      const next: CasterState = {
        ladderState: p.ladderState,
        reason: p.reason,
        taxActive:
          p.taxActive !== undefined ? p.taxActive : (prior?.taxActive ?? false),
        spamCount:
          p.spamCount !== undefined ? p.spamCount : (prior?.spamCount ?? 0)
      };
      state.casterState[p.pcId] = next;
      break;
    }
    case 'map-blob-add':
    case 'map-blob-move':
    case 'map-blob-remove':
    case 'map-blob-reveal':
    case 'map-blob-unreveal': {
      // Forward-compat guard: every M1+ payload MUST carry { v: 1 }.
      // Until the per-kind materializer lands in M3a/M3b/M4/M5/M6,
      // we no-op — but the version check still runs, so a payload
      // missing v or with a future v (say v:2) is rejected by the
      // same code path that will reject it in production.
      if (!isPayloadV1(event.payload)) break;
      // TODO M3a/M3b/M4/M5/M6: per-kind state mutation goes here.
      break;
    }
    // Unknown kinds are silently ignored to allow forward compatibility.
  }
}

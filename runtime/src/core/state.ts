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
   */
  character?: string;
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
    aiAudit: []
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
  if (state.coordHolders.has(viewerPeerId)) {
    return state; // DM (or past coordinator) sees everything
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
  'ai-reject'
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
      break;
    }
    case 'peer-rename': {
      // Self-rename only — the event.peerId IS the author (R2.1
      // already enforces this on the wire).  A peer can update
      // either their display name, their character, or both.
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as { name?: unknown; character?: unknown };
      const presence = state.peers[event.peerId];
      if (!presence) break;
      if (typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 80) {
        presence.name = p.name;
      }
      if (typeof p.character === 'string' && p.character.length <= 80) {
        // Empty string explicitly clears the character.
        presence.character = p.character.length === 0 ? undefined : p.character;
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
    case 'scene-reveal-paragraph':
    case 'scene-unreveal-paragraph':
    case 'thread-debt-set':
    case 'npc-pin':
    case 'npc-unpin':
    case 'map-blob-add':
    case 'map-blob-move':
    case 'map-blob-remove':
    case 'map-blob-reveal':
    case 'map-blob-unreveal':
    case 'broadcast-view':
    case 'raise-hand':
    case 'lower-hand':
    case 'scratch-note':
    case 'ai-prompt':
    case 'ai-response':
    case 'ai-accept':
    case 'ai-reject': {
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

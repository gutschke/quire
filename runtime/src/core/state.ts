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
  joinedAt: number;
  leftAt?: number;
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

export interface SessionState {
  peers: Record<PeerId, PeerPresence>;
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
}

export function emptyState(): SessionState {
  return {
    peers: {},
    coordHolders: new Set(),
    revealedScenes: [],
    diceRolls: [],
    chat: [],
    pcEdits: {},
    notes: []
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
  'peer-join',
  'peer-leave',
  'coordinator-claim',
  'coordinator-yield',
  'coordinator-reclaim',
  'scene-reveal',
  'dice-roll',
  'chat',
  'pc-edit',
  'note'
]);

function applyEventToState(state: SessionState, event: QuireEvent): void {
  switch (event.kind) {
    case 'peer-join': {
      const p = event.payload as PeerJoinPayload | undefined;
      state.peers[event.peerId] = {
        peerId: event.peerId,
        name: p?.name,
        joinedAt: event.ts
      };
      break;
    }
    case 'peer-leave': {
      const p = state.peers[event.peerId];
      if (p) p.leftAt = event.ts;
      break;
    }
    case 'coordinator-claim': {
      if (!state.coordinator) {
        state.coordinator = event.peerId;
        state.coordHolders.add(event.peerId);
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
    // Unknown kinds are silently ignored to allow forward compatibility.
  }
}

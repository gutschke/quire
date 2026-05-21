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
  revealedScenes: string[];
  diceRolls: DiceRoll[];
  chat: ChatMessage[];
  pcEdits: Record<string, Record<string, unknown>>;
  notes: Note[];
}

export function emptyState(): SessionState {
  return {
    peers: {},
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

function isSafeKey(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= ID_CAP &&
    !POISONOUS_KEYS.has(s)
  );
}

function isBoundedString(s: unknown, cap: number): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= cap;
}

function isPlainObjectPayload(p: unknown): p is Record<string, unknown> {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

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
      if (!state.coordinator) state.coordinator = event.peerId;
      break;
    }
    case 'coordinator-yield': {
      if (state.coordinator === event.peerId) state.coordinator = undefined;
      break;
    }
    case 'scene-reveal': {
      if (state.coordinator !== event.peerId) break;
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
      if (!isSafeKey(p.pcId)) break;
      if (!isSafeKey(p.field)) break;
      // value is intentionally unrestricted at this layer — the
      // character-edits helper (applyCharacterEdits) clamps and
      // type-checks on read so an unknown field is silently
      // dropped at render time.  Storing the raw value preserves
      // forward compatibility with future editable fields.
      const pc = state.pcEdits[p.pcId] ?? {};
      pc[p.field] = p.value;
      state.pcEdits[p.pcId] = pc;
      break;
    }
    case 'note': {
      if (!isPlainObjectPayload(event.payload)) break;
      const p = event.payload as Partial<NotePayload>;
      if (!isBoundedString(p.text, NOTE_CAP)) break;
      state.notes.push({
        peerId: event.peerId,
        ts: event.ts,
        text: p.text,
        private: p.private
      });
      break;
    }
    // Unknown kinds are silently ignored to allow forward compatibility.
  }
}

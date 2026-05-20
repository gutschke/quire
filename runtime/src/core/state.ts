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
      const p = event.payload as SceneRevealPayload;
      if (!state.revealedScenes.includes(p.scenePath)) {
        state.revealedScenes.push(p.scenePath);
      }
      break;
    }
    case 'dice-roll': {
      const p = event.payload as DiceRollPayload;
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
      const p = event.payload as ChatPayload;
      state.chat.push({
        peerId: event.peerId,
        ts: event.ts,
        text: p.text
      });
      break;
    }
    case 'pc-edit': {
      const p = event.payload as PcEditPayload;
      const pc = state.pcEdits[p.pcId] ?? {};
      pc[p.field] = p.value;
      state.pcEdits[p.pcId] = pc;
      break;
    }
    case 'note': {
      const p = event.payload as NotePayload;
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

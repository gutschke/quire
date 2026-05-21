import { describe, it, expect } from 'vitest';
import { EventLog } from './event-log';
import {
  materialize,
  emptyState,
  filterForViewer,
  KNOWN_EVENT_KINDS,
  EVENT_PAYLOAD_V1,
  type SessionState
} from './state';

describe('materialize — empty', () => {
  it('produces an empty state from no events', () => {
    expect(materialize([])).toEqual(emptyState());
  });
});

describe('materialize — peers', () => {
  it('peer-join adds a peer to state.peers', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    const state = materialize(log.events());
    expect(state.peers).toHaveProperty('alice');
    expect(state.peers.alice.name).toBe('Alice');
    expect(state.peers.alice.joinedAt).toBeGreaterThan(0);
  });

  it('peer-leave marks the peer as having left', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('peer-leave', {});
    const state = materialize(log.events());
    expect(state.peers.alice.leftAt).toBeGreaterThan(0);
  });
});

describe('materialize — coordinator', () => {
  it('first claim wins', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    expect(materialize(log.events()).coordinator).toBe('alice');
  });

  it('subsequent claims are no-ops while a coordinator exists', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const a1 = alice.append('coordinator-claim', {});
    bob.apply(a1);
    bob.append('coordinator-claim', {});
    for (const ev of bob.events()) alice.apply(ev);
    expect(materialize(alice.events()).coordinator).toBe('alice');
  });

  it('coordinator-yield from the current coordinator clears the role', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('coordinator-yield', {});
    expect(materialize(log.events()).coordinator).toBeUndefined();
  });

  it('coordinator-yield from a non-coordinator is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    const yieldEv = bob.append('coordinator-yield', {});
    alice.apply(yieldEv);
    expect(materialize(alice.events()).coordinator).toBe('alice');
  });

  it('allows a new claim after a yield', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    alice.append('coordinator-yield', {});
    for (const ev of alice.events()) bob.apply(ev);
    bob.append('coordinator-claim', {});
    for (const ev of bob.events()) alice.apply(ev);
    expect(materialize(alice.events()).coordinator).toBe('bob');
  });
});

describe('materialize — scene reveal', () => {
  it('coordinator can reveal a scene', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal', { scenePath: 'episodes/001/scenes/01.md' });
    const state = materialize(log.events());
    expect(state.revealedScenes).toEqual(['episodes/001/scenes/01.md']);
  });

  it('non-coordinator scene reveal is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('scene-reveal', { scenePath: 'x.md' });
    alice.apply(ev);
    expect(materialize(alice.events()).revealedScenes).toEqual([]);
  });

  it('does not double-reveal the same scene', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal', { scenePath: 'a.md' });
    log.append('scene-reveal', { scenePath: 'a.md' });
    log.append('scene-reveal', { scenePath: 'b.md' });
    expect(materialize(log.events()).revealedScenes).toEqual(['a.md', 'b.md']);
  });
});

describe('materialize — scene-reveal-paragraph (P2-2)', () => {
  const VALID_HASH = '0123456789abcdef';
  const ANOTHER_HASH = 'abcdef0123456789';

  it('coordinator can reveal a block in a scene', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'episodes/001/scenes/01.md',
      blockHash: VALID_HASH
    });
    const state = materialize(log.events());
    expect(state.revealedParagraphs['episodes/001/scenes/01.md']).toEqual(
      new Set([VALID_HASH])
    );
  });

  it('non-coordinator paragraph reveal is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'x.md',
      blockHash: VALID_HASH
    });
    alice.apply(ev);
    expect(materialize(alice.events()).revealedParagraphs).toEqual({});
  });

  it('payload without v:1 is rejected', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      scenePath: 'x.md',
      blockHash: VALID_HASH
    } as unknown as { v: 1; scenePath: string; blockHash: string });
    expect(materialize(log.events()).revealedParagraphs).toEqual({});
  });

  it('malformed blockHash (wrong length or non-hex) is rejected', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'x.md',
      blockHash: 'too-short'
    });
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'x.md',
      blockHash: 'g123456789abcdef' // 'g' is not hex
    });
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'x.md',
      blockHash: 'ABCDEF0123456789' // uppercase rejected
    });
    expect(materialize(log.events()).revealedParagraphs).toEqual({});
  });

  it('multiple block reveals accumulate per scene', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: ANOTHER_HASH
    });
    const state = materialize(log.events());
    expect(state.revealedParagraphs['a.md']).toEqual(
      new Set([VALID_HASH, ANOTHER_HASH])
    );
  });

  it('re-revealing an already-revealed block is idempotent', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    expect(materialize(log.events()).revealedParagraphs['a.md']).toEqual(
      new Set([VALID_HASH])
    );
  });

  it('scene-unreveal-paragraph removes the hash and prunes empty sets', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    log.append('scene-unreveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    const state = materialize(log.events());
    expect(state.revealedParagraphs['a.md']).toBeUndefined();
    expect(state.revealedParagraphs).toEqual({});
  });

  it('scene-unreveal-paragraph leaves other blocks in the set intact', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: ANOTHER_HASH
    });
    log.append('scene-unreveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    expect(materialize(log.events()).revealedParagraphs['a.md']).toEqual(
      new Set([ANOTHER_HASH])
    );
  });

  it('caps at REVEALED_BLOCKS_PER_SCENE_CAP (256) per scene', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    // Append 260 distinct hashes; only the first 256 should land.
    for (let i = 0; i < 260; i++) {
      const hex = i.toString(16).padStart(16, '0');
      log.append('scene-reveal-paragraph', {
        v: 1,
        scenePath: 'big.md',
        blockHash: hex
      });
    }
    const state = materialize(log.events());
    expect(state.revealedParagraphs['big.md']!.size).toBe(256);
  });

  it('cap-saturated set still allows re-reveal of existing hashes (idempotent)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    for (let i = 0; i < 256; i++) {
      const hex = i.toString(16).padStart(16, '0');
      log.append('scene-reveal-paragraph', {
        v: 1,
        scenePath: 'big.md',
        blockHash: hex
      });
    }
    // Re-revealing the very first hash is a no-op on a saturated set
    // (not a "cap exceeded" rejection).
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'big.md',
      blockHash: '0'.padStart(16, '0')
    });
    expect(materialize(log.events()).revealedParagraphs['big.md']!.size).toBe(256);
  });

  it('accepts a valid paragraphIndex hint (no-op) and rejects malformed ones', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH,
      paragraphIndex: 3
    });
    // NaN / non-number / Infinity → reject the event.
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: ANOTHER_HASH,
      paragraphIndex: NaN
    });
    log.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: ANOTHER_HASH,
      paragraphIndex: 'three' as unknown as number
    });
    expect(materialize(log.events()).revealedParagraphs['a.md']).toEqual(
      new Set([VALID_HASH])
    );
  });

  it('non-coordinator scene-unreveal-paragraph is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    alice.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    bob.apply(alice.events()[1]);
    const ev = bob.append('scene-unreveal-paragraph', {
      v: 1,
      scenePath: 'a.md',
      blockHash: VALID_HASH
    });
    alice.apply(ev);
    expect(materialize(alice.events()).revealedParagraphs['a.md']).toEqual(
      new Set([VALID_HASH])
    );
  });
});

describe('materialize — npc-pin / npc-unpin (M3a.8)', () => {
  it('coordinator can pin an NPC; order preserved', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('npc-pin', { v: 1, npcId: 'alice-the-bartender' });
    log.append('npc-pin', { v: 1, npcId: 'bob-the-guard' });
    expect(materialize(log.events()).pinnedNpcs).toEqual([
      'alice-the-bartender',
      'bob-the-guard'
    ]);
  });

  it('non-coordinator npc-pin is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('npc-pin', { v: 1, npcId: 'rogue-npc' });
    alice.apply(ev);
    expect(materialize(alice.events()).pinnedNpcs).toEqual([]);
  });

  it('payload without v:1 is rejected', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('npc-pin', {
      npcId: 'x'
    } as unknown as { v: 1; npcId: string });
    expect(materialize(log.events()).pinnedNpcs).toEqual([]);
  });

  it('malformed npcId is rejected', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('npc-pin', { v: 1, npcId: '.' });
    log.append('npc-pin', { v: 1, npcId: 'has spaces' });
    log.append('npc-pin', { v: 1, npcId: '' });
    expect(materialize(log.events()).pinnedNpcs).toEqual([]);
  });

  it('re-pinning an already-pinned NPC is idempotent', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('npc-pin', { v: 1, npcId: 'x' });
    log.append('npc-pin', { v: 1, npcId: 'x' });
    expect(materialize(log.events()).pinnedNpcs).toEqual(['x']);
  });

  it('caps at PINNED_NPC_CAP (50)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    for (let i = 0; i < 60; i++) {
      log.append('npc-pin', { v: 1, npcId: `npc-${i}` });
    }
    expect(materialize(log.events()).pinnedNpcs.length).toBe(50);
  });

  it('npc-unpin removes the id', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('npc-pin', { v: 1, npcId: 'a' });
    log.append('npc-pin', { v: 1, npcId: 'b' });
    log.append('npc-unpin', { v: 1, npcId: 'a' });
    expect(materialize(log.events()).pinnedNpcs).toEqual(['b']);
  });

  it('npc-unpin on absent id is a no-op', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('npc-pin', { v: 1, npcId: 'a' });
    log.append('npc-unpin', { v: 1, npcId: 'never-pinned' });
    expect(materialize(log.events()).pinnedNpcs).toEqual(['a']);
  });
});

describe('materialize — thread-debt-set (M3a.8)', () => {
  it('coordinator can set a PC thread-debt level', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('thread-debt-set', { v: 1, pcId: 'yui', level: 'noticed' });
    expect(materialize(log.events()).threadDebt).toEqual({ yui: 'noticed' });
  });

  it('LWW: a later level overwrites an earlier one', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('thread-debt-set', { v: 1, pcId: 'yui', level: 'noticed' });
    log.append('thread-debt-set', { v: 1, pcId: 'yui', level: 'hunted' });
    expect(materialize(log.events()).threadDebt).toEqual({ yui: 'hunted' });
  });

  it('empty string clears the entry', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('thread-debt-set', { v: 1, pcId: 'yui', level: 'noticed' });
    log.append('thread-debt-set', { v: 1, pcId: 'yui', level: '' });
    expect(materialize(log.events()).threadDebt).toEqual({});
  });

  it('rejects an unknown level', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('thread-debt-set', {
      v: 1,
      pcId: 'yui',
      level: 'on-fire' as unknown as 'quiet'
    });
    expect(materialize(log.events()).threadDebt).toEqual({});
  });

  it('non-coordinator thread-debt-set is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('thread-debt-set', {
      v: 1,
      pcId: 'yui',
      level: 'noticed'
    });
    alice.apply(ev);
    expect(materialize(alice.events()).threadDebt).toEqual({});
  });
});

describe('materialize — scratch-note (M3a.8)', () => {
  it('coordinator can append a scratch note', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scratch-note', { v: 1, text: 'remember the locket' });
    const state = materialize(log.events());
    expect(state.scratchNotes).toHaveLength(1);
    expect(state.scratchNotes[0].text).toBe('remember the locket');
    expect(state.scratchNotes[0].peerId).toBe('alice');
  });

  it('rejects oversize text (over SCRATCH_NOTE_TEXT_CAP)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    const huge = 'x'.repeat(5001);
    log.append('scratch-note', { v: 1, text: huge });
    expect(materialize(log.events()).scratchNotes).toHaveLength(0);
  });

  it('non-coordinator scratch-note is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('scratch-note', { v: 1, text: 'rogue note' });
    alice.apply(ev);
    expect(materialize(alice.events()).scratchNotes).toHaveLength(0);
  });

  it('accepts an optional scenePath; rejects malformed ones', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('scratch-note', { v: 1, text: 'a', scenePath: 'scenes/x.md' });
    log.append('scratch-note', { v: 1, text: 'b', scenePath: 12 as unknown as string });
    const state = materialize(log.events());
    expect(state.scratchNotes).toHaveLength(1);
    expect(state.scratchNotes[0].scenePath).toBe('scenes/x.md');
  });
});

describe('materialize — broadcast-view (M3a.8)', () => {
  it('coordinator can broadcast a stage path', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('broadcast-view', { v: 1, stagePath: 'scenes/s.md' });
    const state = materialize(log.events());
    expect(state.broadcastView?.stagePath).toBe('scenes/s.md');
  });

  it('LWW by ts: newer broadcast replaces older', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('broadcast-view', { v: 1, stagePath: 'a.md' });
    log.append('broadcast-view', { v: 1, stagePath: 'b.md' });
    expect(materialize(log.events()).broadcastView?.stagePath).toBe('b.md');
  });

  it('clamps event.ts more than a year in the future (lock-out guard)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    // Manually inject a poisoned event with a far-future ts.  This
    // is what a malicious coord (or replayed compromised save)
    // could emit to lock the LWW slot.
    const poisoned = log.events()[0];
    log.apply({
      ...poisoned,
      kind: 'broadcast-view',
      ts: Number.MAX_SAFE_INTEGER,
      payload: { v: 1, stagePath: 'rogue.md' }
    });
    log.append('broadcast-view', { v: 1, stagePath: 'legit.md' });
    // The poisoned event was rejected; the legit one landed.
    expect(materialize(log.events()).broadcastView?.stagePath).toBe('legit.md');
  });

  it('non-coordinator broadcast-view is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('broadcast-view', { v: 1, stagePath: 'rogue.md' });
    alice.apply(ev);
    expect(materialize(alice.events()).broadcastView).toBeUndefined();
  });
});

describe('materialize — dice rolls', () => {
  it('appends rolls in causal order', () => {
    const log = new EventLog('alice');
    log.append('dice-roll', {
      expression: '2d6+3',
      result: 10,
      dice: [4, 3]
    });
    const state = materialize(log.events());
    expect(state.diceRolls).toHaveLength(1);
    expect(state.diceRolls[0].peerId).toBe('alice');
    expect(state.diceRolls[0].result).toBe(10);
    expect(state.diceRolls[0].expression).toBe('2d6+3');
    expect(state.diceRolls[0].dice).toEqual([4, 3]);
  });
});

describe('materialize — chat', () => {
  it('appends chat messages in causal order', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('chat', { text: 'hi' });
    bob.apply(alice.events()[0]);
    bob.append('chat', { text: 'hi back' });
    for (const ev of bob.events()) alice.apply(ev);
    const state = materialize(alice.events());
    expect(state.chat).toHaveLength(2);
    expect(state.chat[0].text).toBe('hi');
    expect(state.chat[1].text).toBe('hi back');
  });
});

describe('materialize — pc edits', () => {
  it('records the latest value per field', () => {
    const log = new EventLog('alice');
    log.append('pc-edit', { pcId: 'pc1', field: 'name', value: 'Aria' });
    log.append('pc-edit', { pcId: 'pc1', field: 'name', value: 'Aria H.' });
    const state = materialize(log.events());
    expect(state.pcEdits.pc1.name).toBe('Aria H.');
  });

  it('handles concurrent edits deterministically', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('pc-edit', { pcId: 'pc1', field: 'notes', value: 'alice' });
    bob.append('pc-edit', { pcId: 'pc1', field: 'notes', value: 'bob' });

    const obs1 = new EventLog('obs1');
    obs1.apply(alice.events()[0]);
    obs1.apply(bob.events()[0]);

    const obs2 = new EventLog('obs2');
    obs2.apply(bob.events()[0]);
    obs2.apply(alice.events()[0]);

    const s1 = materialize(obs1.events());
    const s2 = materialize(obs2.events());
    expect(s1.pcEdits.pc1.notes).toBe(s2.pcEdits.pc1.notes);
  });
});

describe('materialize — notes', () => {
  it('appends notes', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('note', { text: 'NPC plans to lie', private: true });
    const state = materialize(log.events());
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].text).toBe('NPC plans to lie');
    expect(state.notes[0].private).toBe(true);
  });
});

describe('materialize — unknown event kinds', () => {
  it('silently ignores unknown event kinds', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('future-feature-x', { data: 123 });
    log.append('chat', { text: 'hello' });
    const state = materialize(log.events());
    expect(state.chat).toHaveLength(1);
    expect(state.peers.alice).toBeDefined();
  });
});

describe('KNOWN_EVENT_KINDS (P0-5 — M1 additions)', () => {
  it('contains all 13 legacy v0 kinds', () => {
    const legacy = [
      'peer-join', 'peer-leave', 'peer-rename', 'peer-disconnect',
      'coordinator-claim', 'coordinator-yield', 'coordinator-reclaim',
      'scene-reveal', 'scene-unreveal',
      'dice-roll', 'chat', 'pc-edit', 'note'
    ];
    for (const k of legacy) {
      expect(KNOWN_EVENT_KINDS.has(k)).toBe(true);
    }
  });

  it('contains the 18 M1-registered new kinds (per redesign-plan.md)', () => {
    const m1 = [
      // per-paragraph reveal
      'scene-reveal-paragraph', 'scene-unreveal-paragraph',
      // thread debt
      'thread-debt-set',
      // NPC pinning
      'npc-pin', 'npc-unpin',
      // map state
      'map-blob-add', 'map-blob-move', 'map-blob-remove',
      'map-blob-reveal', 'map-blob-unreveal',
      // broadcast view
      'broadcast-view',
      // raise hand
      'raise-hand', 'lower-hand',
      // DM scratch
      'scratch-note',
      // AI audit chain
      'ai-prompt', 'ai-response', 'ai-accept', 'ai-reject'
    ];
    for (const k of m1) {
      expect(KNOWN_EVENT_KINDS.has(k)).toBe(true);
    }
    expect(m1.length).toBe(18);
  });

  it('total kind count is 31 (13 legacy + 18 M1)', () => {
    expect(KNOWN_EVENT_KINDS.size).toBe(31);
  });

  it('M1-registered kinds materialize as no-ops at M1 (materializers ship in M3a/M3b/etc.)', () => {
    // Materializers for the new kinds are NOT required at M1 — they
    // land per-feature in later milestones.  The kinds are registered
    // now so they replicate correctly in the event log; the
    // materializer's switch silently no-ops unknown cases until the
    // case lands.  This test pins that behavior so a future drop of
    // forward-compat would be caught immediately.
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('scene-reveal-paragraph', { v: EVENT_PAYLOAD_V1, scenePath: 'x', blockHash: 'abcdef0123456789' });
    log.append('scratch-note', { v: EVENT_PAYLOAD_V1, text: 'remember the cable' });
    log.append('thread-debt-set', { v: EVENT_PAYLOAD_V1, pcId: 'jules', level: 'noticed' });
    log.append('chat', { text: 'visible chat' });
    const state = materialize(log.events());
    // Existing v0 kinds materialize as before:
    expect(state.peers.alice).toBeDefined();
    expect(state.chat).toHaveLength(1);
    // M1 kinds do not produce state yet (materializers ship later):
    expect(state.revealedScenes).toEqual([]); // not yet derived from paragraph reveals
  });

  it('exports EVENT_PAYLOAD_V1 = 1', () => {
    expect(EVENT_PAYLOAD_V1).toBe(1);
  });
});

describe('peer-rename — pcId (M3a.2 P-M3a-pc-binding)', () => {
  it('sets pcId when a valid character id is supplied', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('peer-rename', { pcId: 'jules-aria-halloway' });
    const state = materialize(log.events());
    expect(state.peers.alice.pcId).toBe('jules-aria-halloway');
  });

  it('clears pcId when an empty string is supplied (explicit unbind)', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('peer-rename', { pcId: 'jules' });
    log.append('peer-rename', { pcId: '' });
    const state = materialize(log.events());
    expect(state.peers.alice.pcId).toBeUndefined();
  });

  it('drops invalid pcId silently without unbinding prior value', () => {
    // Defense against a legacy peer that omits pcId vs an explicit
    // clear — drop silently so a malformed payload doesn't wipe
    // the binding.  Explicit clear requires empty-string.
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('peer-rename', { pcId: 'jules' });
    log.append('peer-rename', { pcId: '../etc/passwd' });
    const state = materialize(log.events());
    expect(state.peers.alice.pcId).toBe('jules');
  });

  it('does not unbind on a rename that omits pcId entirely', () => {
    // peer-rename can update just name or just character without
    // touching pcId.  Verify pcId survives.
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('peer-rename', { pcId: 'jules' });
    log.append('peer-rename', { name: 'Alicia' });
    const state = materialize(log.events());
    expect(state.peers.alice.pcId).toBe('jules');
    expect(state.peers.alice.name).toBe('Alicia');
  });

  it('ignores non-string pcId (defensive)', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('peer-rename', { pcId: 42 });
    log.append('peer-rename', { pcId: null });
    log.append('peer-rename', { pcId: { id: 'x' } });
    const state = materialize(log.events());
    expect(state.peers.alice.pcId).toBeUndefined();
  });

  it('pcId, name, and character can update in one event', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('peer-rename', {
      name: 'Alicia',
      character: 'Jules Aria Halloway',
      pcId: 'jules'
    });
    const state = materialize(log.events());
    expect(state.peers.alice.name).toBe('Alicia');
    expect(state.peers.alice.character).toBe('Jules Aria Halloway');
    expect(state.peers.alice.pcId).toBe('jules');
  });
});

describe('peer-join — knownKindsCount (P0-12)', () => {
  it('captures the joining peer’s KNOWN_EVENT_KINDS count', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice', knownKindsCount: 31 });
    const state = materialize(log.events());
    expect(state.peers.alice.knownKindsCount).toBe(31);
  });

  it('treats absent count as undefined (legacy peer-join from older runtimes)', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    const state = materialize(log.events());
    expect(state.peers.alice.knownKindsCount).toBeUndefined();
  });

  it('rejects negative / NaN / non-number / oversize values', () => {
    const tests = [
      { name: 'A', knownKindsCount: -1 },
      { name: 'B', knownKindsCount: 'thirty-one' as unknown as number },
      { name: 'C', knownKindsCount: NaN },
      { name: 'D', knownKindsCount: 10001 }, // bound
      { name: 'E', knownKindsCount: Infinity }
    ];
    for (const payload of tests) {
      const log = new EventLog('alice');
      log.append('peer-join', payload);
      const state = materialize(log.events());
      expect(state.peers.alice.knownKindsCount).toBeUndefined();
    }
  });

  it('accepts the boundary value 10000', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice', knownKindsCount: 10000 });
    const state = materialize(log.events());
    expect(state.peers.alice.knownKindsCount).toBe(10000);
  });

  it('accepts 0 (legacy or minimal runtime)', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice', knownKindsCount: 0 });
    const state = materialize(log.events());
    expect(state.peers.alice.knownKindsCount).toBe(0);
  });
});

describe('filterForViewer (P0-4)', () => {
  function dmState(): SessionState {
    const s = emptyState();
    s.coordHolders.add('dm');
    s.coordinator = 'dm';
    s.peers['dm'] = { peerId: 'dm', name: 'DM', joinedAt: 1 };
    s.peers['alice'] = { peerId: 'alice', name: 'Alice', joinedAt: 2 };
    s.peers['bob'] = { peerId: 'bob', name: 'Bob', joinedAt: 3 };
    // Populate DM-only fields with synthetic content (materializers
    // for these arrive in M3a/M3b; the test constructs them by hand).
    s.threadDebt['alice'] = 'noticed';
    s.threadDebt['bob'] = 'quiet';
    s.pinnedNpcs = ['yui-tanaka', 'reggie-okeke'];
    s.scratchNotes.push({
      peerId: 'dm', ts: 100, text: 'remember the cable', scenePath: 'scenes/01.md'
    });
    s.aiAudit.push({
      peerId: 'dm', ts: 110, kind: 'prompt', promptHash: 'abc', tokensIn: 50
    });
    // Map state with a partial reveal mask.
    s.mapBlobs['scenes/sfo-gate.png'] = [
      { id: 'pc1', label: 'PC1', x: 100, y: 200 },
      { id: 'pc2', label: 'PC2', x: 150, y: 220 },
      { id: 'secret', label: 'hidden trap', x: 300, y: 400 }
    ];
    s.mapBlobReveals['scenes/sfo-gate.png'] = new Set(['pc1', 'pc2']);
    // Player-visible fields the filter should leave alone:
    s.revealedScenes = ['scenes/01.md'];
    s.revealedParagraphs['scenes/01.md'] = new Set(['hash1', 'hash2']);
    s.diceRolls.push({ peerId: 'alice', ts: 200, expression: '2d6+1', result: 9, dice: [4, 4] });
    s.chat.push({ peerId: 'alice', ts: 210, text: 'hello' });
    s.raisedHands.add('alice');
    s.broadcastView = { stagePath: 'scenes/01.md', ts: 220 };
    return s;
  }

  it('DM (coord-holder) sees the full state unchanged', () => {
    const s = dmState();
    const filtered = filterForViewer(s, 'dm');
    expect(filtered).toBe(s); // strict identity — no allocation
    expect(filtered.threadDebt['alice']).toBe('noticed');
    expect(filtered.pinnedNpcs).toEqual(['yui-tanaka', 'reggie-okeke']);
    expect(filtered.scratchNotes).toHaveLength(1);
    expect(filtered.aiAudit).toHaveLength(1);
    expect(filtered.mapBlobs['scenes/sfo-gate.png']).toHaveLength(3); // all blobs
  });

  it('non-coord viewer (player) sees DM-only fields wiped', () => {
    const s = dmState();
    const filtered = filterForViewer(s, 'alice');
    expect(filtered).not.toBe(s); // new object
    expect(filtered.threadDebt).toEqual({});
    expect(filtered.pinnedNpcs).toEqual([]);
    expect(filtered.scratchNotes).toEqual([]);
    expect(filtered.aiAudit).toEqual([]);
  });

  it('non-coord viewer sees player-visible fields preserved', () => {
    const s = dmState();
    const filtered = filterForViewer(s, 'alice');
    expect(filtered.peers['alice']).toBeDefined();
    expect(filtered.peers['dm']).toBeDefined(); // roster includes DM
    expect(filtered.coordinator).toBe('dm');
    expect(filtered.coordHolders.has('dm')).toBe(true);
    expect(filtered.revealedScenes).toEqual(['scenes/01.md']);
    expect(filtered.revealedParagraphs['scenes/01.md']).toEqual(new Set(['hash1', 'hash2']));
    expect(filtered.diceRolls).toHaveLength(1);
    expect(filtered.chat).toHaveLength(1);
    expect(filtered.raisedHands.has('alice')).toBe(true);
    expect(filtered.broadcastView?.stagePath).toBe('scenes/01.md');
  });

  it('non-coord viewer sees only revealed map blobs', () => {
    const s = dmState();
    const filtered = filterForViewer(s, 'alice');
    const blobs = filtered.mapBlobs['scenes/sfo-gate.png'];
    expect(blobs).toBeDefined();
    expect(blobs).toHaveLength(2); // pc1 + pc2; 'secret' filtered out
    expect(blobs.map((b) => b.id).sort()).toEqual(['pc1', 'pc2']);
  });

  it('non-coord viewer sees no blobs when reveal mask is empty', () => {
    const s = dmState();
    s.mapBlobReveals['scenes/sfo-gate.png'] = new Set(); // empty reveal set
    const filtered = filterForViewer(s, 'alice');
    expect(filtered.mapBlobs['scenes/sfo-gate.png']).toBeUndefined();
  });

  it('non-coord viewer sees no blobs for scenes without any reveal mask', () => {
    const s = dmState();
    s.mapBlobs['scenes/secret-room.png'] = [
      { id: 'trap', label: 'pit', x: 0, y: 0 }
    ];
    // No mapBlobReveals entry for secret-room
    const filtered = filterForViewer(s, 'alice');
    expect(filtered.mapBlobs['scenes/secret-room.png']).toBeUndefined();
  });

  it('does not mutate the source state', () => {
    const s = dmState();
    filterForViewer(s, 'alice');
    // Source state still has all the DM-only content
    expect(s.threadDebt['alice']).toBe('noticed');
    expect(s.scratchNotes).toHaveLength(1);
    expect(s.mapBlobs['scenes/sfo-gate.png']).toHaveLength(3);
  });

  it('handles a viewer with no roster entry (defensive)', () => {
    const s = dmState();
    // unknown viewer is treated as non-coord
    const filtered = filterForViewer(s, 'unknown-peer');
    expect(filtered.scratchNotes).toEqual([]);
  });

  it('handles empty state cleanly', () => {
    const s = emptyState();
    const filtered = filterForViewer(s, 'anyone');
    expect(filtered.peers).toEqual({});
    expect(filtered.scratchNotes).toEqual([]);
    expect(filtered.mapBlobs).toEqual({});
  });
});

describe('materialize — full session smoke test', () => {
  it('reduces a realistic multi-peer event sequence into the right state', () => {
    const alice = new EventLog('alice'); // DM
    const bob = new EventLog('bob'); // player
    const carol = new EventLog('carol'); // player

    alice.append('peer-join', { name: 'Alice' });
    alice.append('coordinator-claim', {});

    bob.apply(alice.events()[0]);
    bob.apply(alice.events()[1]);
    bob.append('peer-join', { name: 'Bob' });

    carol.apply(alice.events()[0]);
    carol.apply(alice.events()[1]);
    carol.apply(bob.events()[2]);
    carol.append('peer-join', { name: 'Carol' });

    alice.apply(bob.events()[2]);
    alice.apply(carol.events()[3]);

    alice.append('scene-reveal', { scenePath: 'episodes/001/scenes/01.md' });
    bob.append('dice-roll', {
      expression: '2d6+1',
      result: 8,
      dice: [4, 3]
    });
    carol.append('chat', { text: 'good roll' });

    // Bring everything to alice
    for (const ev of bob.events()) alice.apply(ev);
    for (const ev of carol.events()) alice.apply(ev);

    const state = materialize(alice.events());
    expect(state.coordinator).toBe('alice');
    expect(Object.keys(state.peers).sort()).toEqual([
      'alice',
      'bob',
      'carol'
    ]);
    expect(state.revealedScenes).toContain('episodes/001/scenes/01.md');
    expect(state.diceRolls).toHaveLength(1);
    expect(state.diceRolls[0].peerId).toBe('bob');
    expect(state.chat).toHaveLength(1);
    expect(state.chat[0].peerId).toBe('carol');
  });
});

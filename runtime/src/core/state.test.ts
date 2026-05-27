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

describe('materialize — ai-prompt / ai-response / ai-accept / ai-reject (M3b.3)', () => {
  const PROMPT_HASH = 'abc1234567890def';
  const RESP_HASH = '1234567890abcdef';
  const RESP_HASH_2 = '9876543210fedcba';

  it('coordinator can append an ai-prompt audit row', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('ai-prompt', {
      v: 1,
      promptHash: PROMPT_HASH,
      model: 'claude-sonnet-4-6',
      tokenIn: 42,
      contextRefs: ['episodes/001/scenes/intro.md']
    });
    const state = materialize(log.events());
    expect(state.aiAudit).toHaveLength(1);
    expect(state.aiAudit[0]).toMatchObject({
      kind: 'prompt',
      promptHash: PROMPT_HASH,
      tokensIn: 42
    });
  });

  it('non-coordinator ai-prompt is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('ai-prompt', {
      v: 1,
      promptHash: PROMPT_HASH,
      model: 'm',
      tokenIn: 1
    });
    alice.apply(ev);
    expect(materialize(alice.events()).aiAudit).toEqual([]);
  });

  it('rejects an ai-prompt with malformed hash', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('ai-prompt', {
      v: 1,
      promptHash: 'g'.repeat(16),
      model: 'm',
      tokenIn: 1
    });
    expect(materialize(log.events()).aiAudit).toEqual([]);
  });

  it('rejects an ai-prompt with negative tokenIn', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('ai-prompt', {
      v: 1,
      promptHash: PROMPT_HASH,
      model: 'm',
      tokenIn: -1
    });
    expect(materialize(log.events()).aiAudit).toEqual([]);
  });

  it('rejects an ai-prompt with too many contextRefs', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('ai-prompt', {
      v: 1,
      promptHash: PROMPT_HASH,
      model: 'm',
      tokenIn: 1,
      contextRefs: Array.from({ length: 51 }, (_, i) => `ref-${i}.md`)
    });
    expect(materialize(log.events()).aiAudit).toEqual([]);
  });

  it('appends ai-response with chain link (prevHash → responseHash)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('ai-prompt', {
      v: 1,
      promptHash: PROMPT_HASH,
      model: 'm',
      tokenIn: 5
    });
    log.append('ai-response', {
      v: 1,
      responseId: 'r-1',
      tokenOut: 10,
      hash: RESP_HASH,
      prevHash: '' // first response in the chain
    });
    log.append('ai-response', {
      v: 1,
      responseId: 'r-2',
      tokenOut: 20,
      hash: RESP_HASH_2,
      prevHash: RESP_HASH
    });
    const state = materialize(log.events());
    expect(state.aiAudit).toHaveLength(3);
    expect(state.aiAudit[1]).toMatchObject({
      kind: 'response',
      responseId: 'r-1',
      responseHash: RESP_HASH,
      prevHash: '',
      tokensOut: 10
    });
    expect(state.aiAudit[2]).toMatchObject({
      kind: 'response',
      responseId: 'r-2',
      prevHash: RESP_HASH
    });
  });

  it('rejects ai-response with invalid prevHash (non-empty + non-hex)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('ai-response', {
      v: 1,
      responseId: 'r-1',
      tokenOut: 5,
      hash: RESP_HASH,
      prevHash: 'definitely-not-hex'
    });
    expect(materialize(log.events()).aiAudit).toEqual([]);
  });

  it('records ai-accept / ai-reject verdicts referencing a prior responseId', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('ai-accept', {
      v: 1,
      responseId: 'r-1',
      category: 'narration'
    });
    log.append('ai-reject', { v: 1, responseId: 'r-2' });
    const state = materialize(log.events());
    expect(state.aiAudit).toHaveLength(2);
    expect(state.aiAudit[0]).toMatchObject({
      kind: 'accept',
      responseId: 'r-1',
      category: 'narration'
    });
    expect(state.aiAudit[1]).toMatchObject({
      kind: 'reject',
      responseId: 'r-2',
      category: undefined
    });
  });

  it('caps the audit at AI_AUDIT_CAP (5000)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    for (let i = 0; i < 5005; i++) {
      log.append('ai-prompt', {
        v: 1,
        promptHash: PROMPT_HASH,
        model: 'm',
        tokenIn: 1
      });
    }
    expect(materialize(log.events()).aiAudit.length).toBe(5000);
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

describe('MATERIALIZERS registry (M3C-1)', () => {
  it('has a registered materializer for every KNOWN_EVENT_KINDS entry', async () => {
    // Regression guard: when a future commit adds a new event kind
    // to KNOWN_EVENT_KINDS, the author MUST also register a
    // materializer in MATERIALIZERS — otherwise the new kind is
    // silently treated as unknown (forward-compat no-op), which is
    // rarely the intended behavior.  Importing both sets through
    // the module's public surface tests the invariant end-to-end.
    const { KNOWN_EVENT_KINDS, MATERIALIZER_KINDS } = await import('./state');
    const missing = [...KNOWN_EVENT_KINDS].filter(
      (k) => !MATERIALIZER_KINDS.has(k)
    );
    expect(missing).toEqual([]);
  });

  it('does not register any materializer for an unknown event kind', async () => {
    // The reverse parity: every materializer should be reachable
    // from KNOWN_EVENT_KINDS.  A registration without a matching
    // KNOWN_EVENT_KINDS entry would never fire (the kind would be
    // rejected upstream by the version-mismatch banner).
    const { KNOWN_EVENT_KINDS, MATERIALIZER_KINDS } = await import('./state');
    const orphaned = [...MATERIALIZER_KINDS].filter(
      (k) => !KNOWN_EVENT_KINDS.has(k)
    );
    expect(orphaned).toEqual([]);
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

  it('total kind count is 37 (13 legacy + 18 M1 + 1 caster-state-set + 1 pc-slot-bind + 1 pc-create + 3 Phase B-prime lifecycle)', () => {
    // Phase B' (2026-05-25): added seat-add + pc-retire + pc-archive
    // → 34 + 3 = 37.
    // P-R7 (2026-05-25): added pc-switch (audit-only) → 39.
    // P-R11 (2026-05-25): added pc-retire-request + pc-retire-reject → 41.
    // #301 (2026-05-26): added seat-reveal → 42.
    // #253 (2026-05-26): added chargen-pack-deliver + chargen-pack-clear → 44.
    // #294 (2026-05-26): added seat-memory-edit → 45.
    // Wave B (2026-05-26): added accidental-grant-log + focus-grant → 47.
    // Wave D-prep-2 (2026-05-26): added pc-mark-realization → 48.
    // D4 (2026-05-26): added session-digest → 49.
    // D1-D (2026-05-26): added proposal-create + proposal-accept +
    // proposal-reject → 52.
    expect(KNOWN_EVENT_KINDS.size).toBe(52);
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

  it('current DM sees the full state unchanged', () => {
    const s = dmState();
    const filtered = filterForViewer(s, 'dm');
    expect(filtered).toBe(s); // strict identity — no allocation
    expect(filtered.threadDebt['alice']).toBe('noticed');
    expect(filtered.pinnedNpcs).toEqual(['yui-tanaka', 'reggie-okeke']);
    expect(filtered.scratchNotes).toHaveLength(1);
    expect(filtered.aiAudit).toHaveLength(1);
    expect(filtered.mapBlobs['scenes/sfo-gate.png']).toHaveLength(3); // all blobs
  });

  it('yielded-coord peer falls back to player-scoped view (accidental-disclosure guard)', () => {
    // Threat model: a peer who briefly held coord then yielded
    // must not continue to render DM-only material in their UI.
    // The materializer's coordHolders set is still permissive
    // (their authored events remain authoritative), but the VIEW
    // filter pivots on the CURRENT coordinator only.
    const s = dmState();
    // Add a former-coord history entry — they once held the role.
    s.coordHolders.add('former-dm');
    s.peers['former-dm'] = {
      peerId: 'former-dm',
      name: 'Former DM',
      joinedAt: 0
    };
    const filtered = filterForViewer(s, 'former-dm');
    expect(filtered).not.toBe(s); // they get a stripped copy
    expect(filtered.threadDebt).toEqual({});
    expect(filtered.pinnedNpcs).toEqual([]);
    expect(filtered.scratchNotes).toEqual([]);
    expect(filtered.aiAudit).toEqual([]);
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

  // ---- Phase B P1b (2026-05-23): synthesizedPcs viewer-scope ----

  it('Phase B P1b: non-coord viewer sees DM-only PC fields stripped from synthesizedPcs', () => {
    const s = dmState();
    // Inject a synthesized PC with both player-visible + DM-only
    // fields populated.  The materializer wouldn't naturally
    // produce all of these (some come from pc-edit events), but
    // the projection's contract is shape-based: any DM-only field
    // present in the source must be absent in the player view.
    s.synthesizedPcs['pc-mei'] = {
      $schemaVersion: '0.1.0',
      name: 'Mei Tanaka',
      pronouns: 'she/her',
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      tags: ['junior engineer'],
      backstory: 'a paragraph',
      // ---- DM-only ----
      magicPhase: 'accidental',
      knowsTheyCanCast: true,
      tax: { active: false },
      threadDebt: { rung: 'noticed' },
      accidentalGrants: [{ ts: 100, note: 'silent nudge' }],
      alignmentDrift: { marks: 1 },
      dmNotes: 'remember the focus rename'
    };
    const filtered = filterForViewer(s, 'alice');
    const projected = filtered.synthesizedPcs['pc-mei'];
    expect(projected).toBeDefined();
    // Player-visible fields preserved.
    expect(projected.name).toBe('Mei Tanaka');
    expect(projected.stats?.int).toBe(2);
    expect(projected.skills).toEqual(['Tech', 'Knowledge']);
    expect(projected.backstory).toBe('a paragraph');
    // DM-only fields stripped — every one of them.
    expect('magicPhase' in projected).toBe(false);
    expect('knowsTheyCanCast' in projected).toBe(false);
    expect('tax' in projected).toBe(false);
    expect('threadDebt' in projected).toBe(false);
    expect('accidentalGrants' in projected).toBe(false);
    expect('alignmentDrift' in projected).toBe(false);
    expect('dmNotes' in projected).toBe(false);
  });

  it('Phase B P1b: DM-as-viewer sees synthesizedPcs unchanged (no projection cost)', () => {
    const s = dmState();
    s.synthesizedPcs['pc-mei'] = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      knowsTheyCanCast: true,
      dmNotes: 'note'
    };
    const filtered = filterForViewer(s, 'dm');
    // DM sees the full record.  Identity check: filterForViewer
    // returns the SAME state object when viewer is current coord
    // (no allocation), so synthesizedPcs is also untouched.
    expect(filtered).toBe(s);
    expect(filtered.synthesizedPcs['pc-mei'].knowsTheyCanCast).toBe(true);
    expect(filtered.synthesizedPcs['pc-mei'].dmNotes).toBe('note');
  });

  it('Phase B P1b: yielded-coord peer also gets DM-only PC fields stripped', () => {
    // Threat model parity: a peer who briefly held coord then
    // yielded must lose access to DM-only PC fields the same way
    // they lose access to threadDebt / scratchNotes etc.
    const s = dmState();
    s.coordHolders.add('former-dm');
    s.peers['former-dm'] = { peerId: 'former-dm', name: 'Former DM', joinedAt: 0 };
    s.synthesizedPcs['pc-mei'] = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      knowsTheyCanCast: true,
      dmNotes: 'note',
      tax: { active: true, sessionsRemaining: 3 }
    };
    const filtered = filterForViewer(s, 'former-dm');
    const projected = filtered.synthesizedPcs['pc-mei'];
    expect('knowsTheyCanCast' in projected).toBe(false);
    expect('dmNotes' in projected).toBe(false);
    expect('tax' in projected).toBe(false);
  });

  it('Phase B P1b: filter does not mutate the source state synthesizedPcs', () => {
    const s = dmState();
    s.synthesizedPcs['pc-mei'] = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      knowsTheyCanCast: true
    };
    filterForViewer(s, 'alice');
    // Source state retains the DM-only field — the projection is
    // a copy, not an in-place wipe.
    expect(s.synthesizedPcs['pc-mei'].knowsTheyCanCast).toBe(true);
  });

  it('Phase B P1b: empty synthesizedPcs map is handled cleanly', () => {
    const s = emptyState();
    const filtered = filterForViewer(s, 'alice');
    expect(filtered.synthesizedPcs).toEqual({});
  });

  // ---- Task #295 (2026-05-25): pcEdits viewer-scope ----

  it('Task #295: non-coord viewer sees dmNotes stripped from pcEdits', () => {
    const s = dmState();
    // Coordinator typed into the soft-notes textarea; the pc-edit
    // event lands in state.pcEdits[pcId][dmNotes].  Without the
    // projection strip, a player peer reading filteredShared would
    // see the value directly.
    s.pcEdits['pc-mei'] = {
      harm: 1, // player-visible — keep
      dmNotes: 'remember: their sister is the antagonist'
    };
    const filtered = filterForViewer(s, 'alice');
    expect(filtered.pcEdits['pc-mei'].harm).toBe(1);
    expect('dmNotes' in filtered.pcEdits['pc-mei']).toBe(false);
  });

  it('Task #295 + Phase B P3 verification: pcEdits projection strips DM-only fields AND their dotted sub-fields', () => {
    const s = dmState();
    // One-of-each across the DM_ONLY_CHARACTER_FIELDS list.
    s.pcEdits['pc-mei'] = {
      harm: 2, // KEEP
      stress: 1, // KEEP
      'stats.int': 3, // KEEP (`stats` is not DM-only)
      magicPhase: 'tax', // STRIP (top-level DM-only)
      knowsTheyCanCast: true, // STRIP (top-level DM-only)
      'tax.active': true, // STRIP (dotted sub-field of DM-only `tax`)
      'threadDebt.rung': 'noticed', // STRIP (dotted sub-field of DM-only `threadDebt`)
      'alignmentDrift.marks': 2, // STRIP (dotted sub-field of DM-only `alignmentDrift`)
      dmNotes: 'a paragraph' // STRIP
    };
    const filtered = filterForViewer(s, 'alice');
    const edits = filtered.pcEdits['pc-mei'];
    // Player-visible fields survive.
    expect(edits.harm).toBe(2);
    expect(edits.stress).toBe(1);
    expect(edits['stats.int']).toBe(3);
    // Top-level DM-only entries gone.
    expect('magicPhase' in edits).toBe(false);
    expect('knowsTheyCanCast' in edits).toBe(false);
    expect('dmNotes' in edits).toBe(false);
    // Verification a4d73ff05b8fad993 follow-up: dotted sub-field
    // overlays are now ALSO stripped — `tax.active`,
    // `threadDebt.rung`, `alignmentDrift.marks` were prior-art
    // leaks because the projection's set-based field-name check
    // only matched literal names.  Fixed by comparing the
    // before-first-dot prefix.
    expect('tax.active' in edits).toBe(false);
    expect('threadDebt.rung' in edits).toBe(false);
    expect('alignmentDrift.marks' in edits).toBe(false);
  });

  it('Task #295: DM-as-viewer sees pcEdits unchanged (identity fast-path)', () => {
    const s = dmState();
    s.pcEdits['pc-mei'] = {
      dmNotes: 'secret reminder',
      harm: 1
    };
    const filtered = filterForViewer(s, 'dm');
    // Coord-self fast-path: no allocation, full state returned.
    expect(filtered).toBe(s);
    expect(filtered.pcEdits['pc-mei'].dmNotes).toBe('secret reminder');
  });

  it('Task #295: yielded-coord peer also gets dmNotes stripped from pcEdits', () => {
    const s = dmState();
    s.coordHolders.add('former-dm');
    s.peers['former-dm'] = {
      peerId: 'former-dm', name: 'Former DM', joinedAt: 0
    };
    s.pcEdits['pc-mei'] = {
      dmNotes: 'note',
      magicPhase: 'realization'
    };
    const filtered = filterForViewer(s, 'former-dm');
    expect('dmNotes' in filtered.pcEdits['pc-mei']).toBe(false);
    expect('magicPhase' in filtered.pcEdits['pc-mei']).toBe(false);
  });

  it('Task #295: filter does not mutate the source pcEdits', () => {
    const s = dmState();
    s.pcEdits['pc-mei'] = {
      dmNotes: 'keep',
      harm: 1
    };
    filterForViewer(s, 'alice');
    // Source state retains the DM-only field.
    expect(s.pcEdits['pc-mei'].dmNotes).toBe('keep');
  });
});

/**
 * P-R9 (2026-05-25): regression tests for the spoiler-firewall
 * during a pre-realization PC swap.
 *
 * "Pre-realization" = before the magic-system arc reaches the
 * "knowsTheyCanCast" beat in Underleaf.  When a PC is replaced
 * mid-arc (a player drops, a DM swaps in a guest), the engine
 * MUST guarantee:
 *
 *   1. The departed PC's DM-only state (knowsTheyCanCast,
 *      accidentalGrants, threadDebt, magicPhase, dmNotes,
 *      alignmentDrift, tax) does NOT leak into the new PC's
 *      player-bound projection — even though sticky-N preserves
 *      the slot integer that links them.
 *   2. The departed PC's retire metadata (retireReason enum,
 *      retiredScene) does NOT leak via the player-bound seat
 *      projection — only the player-safe inFictionRetireReason
 *      survives.
 *   3. Other PCs' DM-only state from the same session is
 *      unaffected by the swap (defense-in-depth — no cross-PC
 *      bleed introduced by the swap event itself).
 *
 * These tests guard the locked threat-model assumption (civilized
 * players + accidental-DM-disclosure protection) by catching any
 * future code path that would leak swap-time state.
 */
describe('filterForViewer — P-R9 pre-realization PC swap (spoiler firewall)', () => {
  function setupWithDmOnly(): SessionState {
    const s = emptyState();
    s.coordHolders.add('dm');
    s.coordinator = 'dm';
    s.peers['dm'] = { peerId: 'dm', name: 'DM', joinedAt: 1 };
    s.peers['alice'] = { peerId: 'alice', name: 'Alice', joinedAt: 2 };
    // Departed PC: bound at slot 1, deep in the magic arc.
    s.synthesizedPcs['pc-mei'] = {
      $schemaVersion: '0.1.0',
      name: 'Mei Tanaka',
      pronouns: 'she/her',
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
      backstory: 'Mei grew up in the Mission.',
      harm: 0,
      stress: 0,
      foci: [],
      advancements: 1,
      marks: 2,
      magicPhase: 'accidental',
      knowsTheyCanCast: false,
      accidentalGrants: [
        { ts: 100, note: 'extinguished a candle', sceneId: 'ep1/s2' }
      ],
      tax: { active: true, sessionsRemaining: 2 },
      threadDebt: { rung: 'noticed' },
      dmNotes: 'has the Quiet but does not know yet',
      alignmentDrift: { marks: 2, lastUpdated: 100 }
    };
    s.threadDebt['pc-mei'] = 'noticed';
    return s;
  }

  it('swap-out: departed PC retired, slot kept, no DM-only fields leak', () => {
    const s = setupWithDmOnly();
    // DM retires Mei via pc-retire (state.pcSlots[1] flips to bound-retired).
    s.pcSlots[1] = {
      state: 'bound-retired',
      pcId: 'pc-mei',
      inFictionRetireReason: 'left after the betrayal',
      retireReason: 'departed',
      retiredScene: 'ep1/scene-quiet-call', // DM-only scene-id (spoiler!)
      retiredAt: 200
    };
    const filtered = filterForViewer(s, 'alice');
    const seat = filtered.pcSlots[1];
    // Player-safe label survives.
    expect(seat?.inFictionRetireReason).toBe('left after the betrayal');
    // DM-only metadata STRIPPED.
    expect(seat?.retireReason).toBeUndefined();
    expect(seat?.retiredScene).toBeUndefined();
    expect(seat?.retiredAt).toBeUndefined();
    // Departed PC's DM-only character fields ALSO stripped.
    const meiProj = filtered.synthesizedPcs['pc-mei'];
    expect(meiProj).toBeDefined();
    const meiAny = meiProj as unknown as Record<string, unknown>;
    expect(meiAny.knowsTheyCanCast).toBeUndefined();
    expect(meiAny.accidentalGrants).toBeUndefined();
    expect(meiAny.magicPhase).toBeUndefined();
    expect(meiAny.tax).toBeUndefined();
    expect(meiAny.threadDebt).toBeUndefined();
    expect(meiAny.dmNotes).toBeUndefined();
    expect(meiAny.alignmentDrift).toBeUndefined();
    // Per-session threadDebt map ALSO wiped.
    expect(filtered.threadDebt).toEqual({});
  });

  it('swap-in: new PC at the same slot (sticky-N) — no inherited DM-only state', () => {
    const s = setupWithDmOnly();
    // Mei retired.
    s.pcSlots[1] = {
      state: 'bound-retired',
      pcId: 'pc-mei',
      inFictionRetireReason: 'left',
      retireReason: 'departed'
    };
    // New guest PC bound at slot 2 (the slot Mei's old player would
    // have controlled — but sticky-N means slot 1 stays Mei forever
    // and the new player gets a fresh integer).
    s.synthesizedPcs['pc-guest'] = {
      $schemaVersion: '0.1.0',
      name: 'Guest Chen',
      pronouns: 'they/them',
      stats: { str: 1, dex: 1, con: 1, int: 2, wis: 0, cha: 0 },
      skills: ['Insight', 'Influence'],
      tags: ['journalist', 'late-night-radio host', 'three roommates'],
      backstory: 'Guest just moved to Oakland.',
      harm: 0,
      stress: 0,
      foci: [],
      advancements: 1, // catch-up seed from late-add
      marks: 2
      // No knowsTheyCanCast / accidentalGrants / etc. — fresh PC.
    };
    s.pcSlots[2] = {
      state: 'bound-active',
      pcId: 'pc-guest',
      controllerPeerId: 'alice'
    };
    const filtered = filterForViewer(s, 'alice');
    // Guest's projection should ALSO have no DM-only fields (defense-
    // in-depth: stripDmOnlyFromCharacter is idempotent on records
    // that never had them, but verifying the guard fires).
    const guestProj = filtered.synthesizedPcs['pc-guest'];
    const guestAny = guestProj as unknown as Record<string, unknown>;
    expect(guestAny.knowsTheyCanCast).toBeUndefined();
    expect(guestAny.accidentalGrants).toBeUndefined();
    expect(guestAny.magicPhase).toBeUndefined();
    expect(guestAny.dmNotes).toBeUndefined();
    // The new PC's catch-up advancements ARE visible (not DM-only).
    expect(guestProj.advancements).toBe(1);
    // Mei's projection (slot 1) does NOT carry over to slot 2 / the
    // new PC's record — the materializer never read across PC ids
    // and the projection is per-record.
    expect(guestAny.threadDebt).toBeUndefined();
  });

  it('same-slot re-bind: pc-slot-bind to a different pcId does NOT carry over DM-only state', () => {
    // This is the literal "swap a PC at the same slot integer" case,
    // even though sticky-N discourages it.  If a DM (or replay) re-
    // binds slot 1 from pc-mei to pc-replacement, the player's view
    // of slot 1's *new* PC must not inherit Mei's magic state.
    const s = setupWithDmOnly();
    s.pcSlots[1] = {
      state: 'bound-active',
      pcId: 'pc-mei',
      controllerPeerId: 'alice'
    };
    // Same-slot rebind: slot 1 now holds a fresh PC.
    s.synthesizedPcs['pc-replacement'] = {
      $schemaVersion: '0.1.0',
      name: 'Mai Chen',
      pronouns: 'they/them',
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Insight'],
      tags: ['hacker', 'insomniac', 'wears headphones'],
      backstory: 'Mai works the graveyard shift.',
      harm: 0,
      stress: 0,
      foci: [],
      advancements: 0,
      marks: 0
    };
    s.pcSlots[1] = {
      state: 'bound-active',
      pcId: 'pc-replacement',
      controllerPeerId: 'alice'
    };
    const filtered = filterForViewer(s, 'alice');
    // The new PC's record is the projection target — Mei's old
    // record is no longer referenced by the slot, but it's still in
    // synthesizedPcs (records aren't deleted; sticky-N could re-
    // reference via {{pc:1}} in archived narrative).  Both records
    // must be DM-only-stripped in the player view.
    const replProj = filtered.synthesizedPcs['pc-replacement'];
    const replAny = replProj as unknown as Record<string, unknown>;
    expect(replAny.knowsTheyCanCast).toBeUndefined();
    expect(replAny.accidentalGrants).toBeUndefined();
    expect(replAny.dmNotes).toBeUndefined();
    // Mei's record (still in the map) ALSO stripped.
    const meiProj = filtered.synthesizedPcs['pc-mei'];
    const meiAny = meiProj as unknown as Record<string, unknown>;
    expect(meiAny.knowsTheyCanCast).toBeUndefined();
    expect(meiAny.accidentalGrants).toBeUndefined();
    expect(meiAny.magicPhase).toBeUndefined();
  });

  it('cross-PC isolation: swap of PC1 does NOT touch PC2 dm-only state', () => {
    const s = setupWithDmOnly();
    // Add a second PC also in mid-magic-arc.
    s.synthesizedPcs['pc-reggie'] = {
      $schemaVersion: '0.1.0',
      name: 'Reggie Okeke',
      pronouns: 'he/him',
      stats: { str: 1, dex: 0, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Knowledge', 'Tech'],
      tags: ['paramedic', 'night-shift', 'collects vinyl'],
      backstory: 'Reggie has been on the truck for ten years.',
      harm: 0,
      stress: 0,
      foci: [],
      advancements: 1,
      marks: 2,
      magicPhase: 'accidental',
      knowsTheyCanCast: false
    };
    s.pcSlots[2] = {
      state: 'bound-active',
      pcId: 'pc-reggie',
      controllerPeerId: 'alice'
    };
    // Retire PC1.
    s.pcSlots[1] = {
      state: 'bound-retired',
      pcId: 'pc-mei',
      inFictionRetireReason: 'left',
      retireReason: 'departed'
    };
    const filtered = filterForViewer(s, 'alice');
    // Player CANNOT see PC2's magic state either — same DM-only
    // strip applies across the synthesizedPcs map.
    const reggieProj = filtered.synthesizedPcs['pc-reggie'];
    const reggieAny = reggieProj as unknown as Record<string, unknown>;
    expect(reggieAny.knowsTheyCanCast).toBeUndefined();
    expect(reggieAny.magicPhase).toBeUndefined();
    // But player-visible fields survive (sanity check):
    expect(reggieProj.name).toBe('Reggie Okeke');
    expect(reggieProj.advancements).toBe(1);
  });

  it('DM viewer (coord) sees ALL DM-only state — projection is for non-coords only', () => {
    const s = setupWithDmOnly();
    s.pcSlots[1] = {
      state: 'bound-retired',
      pcId: 'pc-mei',
      inFictionRetireReason: 'left',
      retireReason: 'departed',
      retiredScene: 'ep1/scene-quiet-call'
    };
    const filtered = filterForViewer(s, 'dm');
    expect(filtered).toBe(s); // strict identity — DM gets unmutated state
    expect(filtered.synthesizedPcs['pc-mei'].knowsTheyCanCast).toBe(false);
    expect(filtered.synthesizedPcs['pc-mei'].magicPhase).toBe('accidental');
    expect(filtered.pcSlots[1]?.retiredScene).toBe('ep1/scene-quiet-call');
  });
});

describe('materialize — caster-state-set (M3c.1)', () => {
  it('coordinator can set a PC caster ladder + tax + spam-counter', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'noticed',
      reason: 'the lights flicker',
      taxActive: false,
      spamCount: 1
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']).toEqual({
      ladderState: 'noticed',
      reason: 'the lights flicker',
      taxActive: false,
      spamCount: 1
    });
  });

  it("ladderState: 'clear' is a valid sentinel (no empty-string fragility)", () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'clear'
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']?.ladderState).toBe('clear');
  });

  it('omitted fields default sensibly (taxActive=false, spamCount=0)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'quiet'
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']?.taxActive).toBe(false);
    expect(state.casterState['yui']?.spamCount).toBe(0);
  });

  it('subsequent set carries forward prior tax/spamCount when omitted', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'noticed',
      taxActive: true,
      spamCount: 3
    });
    // Advance ladder without re-asserting tax/spam — should keep prior.
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'watched'
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']).toMatchObject({
      ladderState: 'watched',
      taxActive: true,
      spamCount: 3
    });
  });

  it('non-coordinator caster-state-set is ignored', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('coordinator-claim', {});
    bob.apply(alice.events()[0]);
    const ev = bob.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'watched'
    });
    alice.apply(ev);
    expect(materialize(alice.events()).casterState).toEqual({});
  });

  it('payload missing v:1 is rejected', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      pcId: 'yui',
      ladderState: 'noticed'
    } as unknown as { v: 1; pcId: string; ladderState: 'noticed' });
    expect(materialize(log.events()).casterState).toEqual({});
  });

  it('rejects an unknown ladderState (including the empty-string footgun)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: '' as unknown as 'clear'
    });
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'on-fire' as unknown as 'clear'
    });
    expect(materialize(log.events()).casterState).toEqual({});
  });

  it('rejects malformed pcId', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: '..',
      ladderState: 'quiet'
    });
    log.append('caster-state-set', {
      v: 1,
      pcId: 'has spaces',
      ladderState: 'quiet'
    });
    log.append('caster-state-set', {
      v: 1,
      pcId: '',
      ladderState: 'quiet'
    });
    expect(materialize(log.events()).casterState).toEqual({});
  });

  it('rejects hostile spamCount (negative, NaN, huge, non-int)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    for (const spamCount of [
      -1,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER,
      3.5
    ]) {
      log.append('caster-state-set', {
        v: 1,
        pcId: 'yui',
        ladderState: 'quiet',
        spamCount
      });
    }
    expect(materialize(log.events()).casterState).toEqual({});
  });

  it('rejects oversized reason (over CASTER_REASON_CAP=500)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'quiet',
      reason: 'x'.repeat(501)
    });
    expect(materialize(log.events()).casterState).toEqual({});
  });

  it('rejects non-boolean taxActive', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'quiet',
      taxActive: 'true' as unknown as boolean
    });
    expect(materialize(log.events()).casterState).toEqual({});
  });

  it('accepts a valid causedByResponseId (M3c.5 hard-gate plumbing)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'quiet',
      causedByResponseId: 'resp-123'
    });
    expect(materialize(log.events()).casterState['yui']?.ladderState).toBe(
      'quiet'
    );
  });

  it('filterForViewer wipes casterState for non-coord viewers', async () => {
    const { filterForViewer } = await import('./state');
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'noticed'
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']?.ladderState).toBe('noticed');
    const wiped = filterForViewer(state, 'bob');
    expect(wiped.casterState).toEqual({});
    // Coord still sees it.
    const dm = filterForViewer(state, 'alice');
    expect(dm.casterState['yui']?.ladderState).toBe('noticed');
  });
});

describe('materialize — hard-gate enforcement on AI-proposed events (M3c.5)', () => {
  const RESP_ID = 'resp-abc-123';

  function dmLog(): EventLog {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    return log;
  }

  it('AI-proposed pc-edit to harm box 3 WITHOUT ai-accept is rejected + audit-logged', () => {
    const log = dmLog();
    // Bring harm to 2 first (DM-direct, not AI).
    log.append('pc-edit', { pcId: 'yui', field: 'harm', value: 2 });
    // AI proposes harm → 3 without DM accepting.
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'harm',
      value: 3,
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.harm).toBe(2); // pinned at prior value
    // Audit gains a rejected-hard-gate entry.
    const rejected = state.aiAudit.find(
      (e) => e.kind === 'rejected-hard-gate'
    );
    expect(rejected).toBeDefined();
    expect(rejected?.responseId).toBe(RESP_ID);
    expect(rejected?.rejectedReason).toMatch(/harm box 3/);
    expect(rejected?.rejectedKind).toBe('pc-edit');
  });

  it('AI-proposed pc-edit to harm box 3 WITH matching ai-accept is allowed', () => {
    const log = dmLog();
    log.append('pc-edit', { pcId: 'yui', field: 'harm', value: 2 });
    log.append('ai-accept', { v: 1, responseId: RESP_ID });
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'harm',
      value: 3,
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.harm).toBe(3); // applied
    expect(
      state.aiAudit.some((e) => e.kind === 'rejected-hard-gate')
    ).toBe(false);
  });

  it('DM-direct pc-edit (no causedByResponseId) bypasses hard-gate even at harm 4', () => {
    // Out-of-scope for M3c — only AI-proposed events are gated.
    // A DM editing directly is a manual choice, not the AI's
    // proposal; gating it would be a separate concern.
    const log = dmLog();
    log.append('pc-edit', { pcId: 'yui', field: 'harm', value: 4 });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.harm).toBe(4);
    expect(state.aiAudit).toEqual([]);
  });

  it('AI-proposed stress to box 4 (Broken) without accept is rejected', () => {
    const log = dmLog();
    log.append('pc-edit', { pcId: 'yui', field: 'stress', value: 3 });
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'stress',
      value: 4,
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.stress).toBe(3);
    expect(
      state.aiAudit.some(
        (e) =>
          e.kind === 'rejected-hard-gate' &&
          e.rejectedReason?.includes('Broken')
      )
    ).toBe(true);
  });

  it('AI-proposed caster ladder → Hunted without accept is rejected', () => {
    const log = dmLog();
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'hunted',
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']).toBeUndefined();
    expect(
      state.aiAudit.some(
        (e) =>
          e.kind === 'rejected-hard-gate' &&
          e.rejectedReason?.includes('Hunted')
      )
    ).toBe(true);
  });

  it('AI-proposed ladder → Hunted WITH ai-accept is allowed', () => {
    const log = dmLog();
    log.append('ai-accept', { v: 1, responseId: RESP_ID });
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'hunted',
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']?.ladderState).toBe('hunted');
  });

  it('AI-proposed tax activation without accept is rejected', () => {
    const log = dmLog();
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'noticed',
      taxActive: true,
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.casterState['yui']).toBeUndefined();
    expect(
      state.aiAudit.some(
        (e) =>
          e.kind === 'rejected-hard-gate' &&
          e.rejectedReason?.includes('activating')
      )
    ).toBe(true);
  });

  it('Engine #1 hostile path: pc-edit appended BEFORE ai-accept on same peer is rejected', () => {
    // The plan claim (corrected): causal-sort puts the same-peer
    // ai-accept (smaller seq) before its state-update.  A hostile
    // coord trying to invert the order (state-update at seq N,
    // then a retroactive ai-accept at seq N+1) sees the
    // state-update apply FIRST (when aiAudit is empty for that
    // responseId), get rejected, then the ai-accept arrives
    // uselessly.
    const log = dmLog();
    log.append('pc-edit', { pcId: 'yui', field: 'harm', value: 2 });
    // Hostile: state-update FIRST, then ai-accept.  Same peer.
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'harm',
      value: 3,
      causedByResponseId: RESP_ID
    });
    log.append('ai-accept', { v: 1, responseId: RESP_ID });
    const state = materialize(log.events());
    // harm stays at 2 — the rejected event didn't apply.
    expect(state.pcEdits['yui']?.harm).toBe(2);
    // Audit captures: rejected-hard-gate, then the accept.
    const rejectedIdx = state.aiAudit.findIndex(
      (e) => e.kind === 'rejected-hard-gate'
    );
    const acceptIdx = state.aiAudit.findIndex(
      (e) => e.kind === 'accept'
    );
    expect(rejectedIdx).toBeGreaterThanOrEqual(0);
    expect(acceptIdx).toBeGreaterThan(rejectedIdx);
  });

  it('cross-PC pc-edit without accept is rejected', () => {
    const log = dmLog();
    log.append('peer-join', { name: 'Alice' });
    // Inject a second peer bound to "bob" PC.
    const bobLog = new EventLog('guest');
    bobLog.apply(log.events()[0]); // coord-claim
    bobLog.append('peer-join', { name: 'Guest' });
    bobLog.append('peer-rename', { pcId: 'bob' });
    for (const e of bobLog.events()) log.apply(e);
    // Alice (coord) proposes AI pc-edit on bob — cross-PC.
    log.append('pc-edit', {
      pcId: 'bob',
      field: 'harm',
      value: 1, // small delta; cross-PC gates regardless
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.pcEdits['bob']).toBeUndefined();
    expect(
      state.aiAudit.some(
        (e) =>
          e.kind === 'rejected-hard-gate' &&
          e.rejectedReason?.includes('cross-PC')
      )
    ).toBe(true);
  });

  // ---- Phase B P1c (2026-05-23): new hard-gates ----

  it('Phase B P1c: AI-proposed knowsTheyCanCast→true is rejected without ai-accept (one-way story gate)', () => {
    // Seed a synthesized PC at knowsTheyCanCast=false (the
    // Accidental phase).  The AI proposes flipping to true (the
    // Realization beat).  Per rules.md:179 + TTRPG R3 #1, this is
    // an irreversible narrative event; mirror the UI's deliberate
    // "Reveal magic" button by requiring DM accept at the
    // materializer.
    const log = dmLog();
    log.append('pc-create', {
      v: 1,
      pcId: 'yui',
      name: 'Yui',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      backstory: 'short'
    });
    log.append('pc-edit', { pcId: 'yui', field: 'knowsTheyCanCast', value: false });
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'knowsTheyCanCast',
      value: true,
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    // Edit blocked; pinned at the prior value.
    expect(state.pcEdits['yui']?.knowsTheyCanCast).toBe(false);
    const rejected = state.aiAudit.find(
      (e) => e.kind === 'rejected-hard-gate'
    );
    expect(rejected?.rejectedReason).toMatch(/Realization|knowsTheyCanCast/);
  });

  it('Phase B P1c: AI-proposed knowsTheyCanCast→true WITH ai-accept is allowed', () => {
    const log = dmLog();
    log.append('pc-create', {
      v: 1,
      pcId: 'yui',
      name: 'Yui',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      backstory: 'short'
    });
    log.append('ai-accept', { v: 1, responseId: RESP_ID });
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'knowsTheyCanCast',
      value: true,
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.knowsTheyCanCast).toBe(true);
  });

  it('Phase B P1c: AI-proposed knowsTheyCanCast→false (un-reveal) is also gated', () => {
    // The reverse flip is equally story-load-bearing — silently
    // un-revealing magic to a player would be a story violation.
    const log = dmLog();
    log.append('pc-create', {
      v: 1,
      pcId: 'yui',
      name: 'Yui',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      backstory: 'short'
    });
    log.append('pc-edit', { pcId: 'yui', field: 'knowsTheyCanCast', value: true });
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'knowsTheyCanCast',
      value: false,
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.knowsTheyCanCast).toBe(true);
    expect(
      state.aiAudit.some(
        (e) =>
          e.kind === 'rejected-hard-gate' &&
          /un-reveal|knowsTheyCanCast/.test(e.rejectedReason ?? '')
      )
    ).toBe(true);
  });

  it('Phase B P1c: AI-proposed threadDebt.rung=hunted is rejected without ai-accept', () => {
    const log = dmLog();
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'threadDebt.rung',
      value: 'hunted',
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    // Edit blocked.
    expect(state.pcEdits['yui']?.['threadDebt.rung']).toBeUndefined();
    expect(
      state.aiAudit.some(
        (e) =>
          e.kind === 'rejected-hard-gate' &&
          /Hunted/i.test(e.rejectedReason ?? '')
      )
    ).toBe(true);
  });

  it('Phase B P1c: AI-proposed threadDebt.rung→a non-hunted rung is NOT hard-gated', () => {
    const log = dmLog();
    log.append('pc-edit', {
      pcId: 'yui',
      field: 'threadDebt.rung',
      value: 'watched',
      causedByResponseId: RESP_ID
    });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.['threadDebt.rung']).toBe('watched');
    expect(state.aiAudit).toEqual([]);
  });

  it('Phase B P1c: DM-direct knowsTheyCanCast flip bypasses hard-gate (UI deliberate-button is the gate)', () => {
    // The hard-gate applies to AI-proposed edits only (those with
    // a causedByResponseId).  DM directly clicking "Reveal magic"
    // in the UI emits a pc-edit WITHOUT causedByResponseId; the
    // UI button IS the deliberate gate per TTRPG R3 #1.  The
    // materializer doesn't need to add a second confirmation.
    const log = dmLog();
    log.append('pc-edit', { pcId: 'yui', field: 'knowsTheyCanCast', value: true });
    const state = materialize(log.events());
    expect(state.pcEdits['yui']?.knowsTheyCanCast).toBe(true);
    expect(state.aiAudit).toEqual([]);
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

describe('materialize — pc-slot-bind (M3D-5 / CC-2)', () => {
  it('coordinator can bind a slot to a character id', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    const state = materialize(log.events());
    // Phase B' (2026-05-25): pcSlots is now Record<number,Seat>.
    // The bind writes state='bound-active' + pcId + controllerPeerId.
    expect(state.pcSlots[1]?.state).toBe('bound-active');
    expect(state.pcSlots[1]?.pcId).toBe('mei');
    expect(state.pcSlots[1]?.controllerPeerId).toBe('alice');
  });

  it('emptyState starts with no bindings', () => {
    expect(emptyState().pcSlots).toEqual({});
  });

  it('non-coord pc-slot-bind is dropped', () => {
    // The threat model (civilized players) doesn't strictly require
    // this gate, but the engine-side guarantee matters for hostile
    // saves + future modes-of-play where the DM hands out invite
    // tokens to async-mode players.
    const log = new EventLog('bob');
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    const state = materialize(log.events());
    expect(state.pcSlots[1]).toBeUndefined();
  });

  it('rejects payload missing v:1 (forward-compat)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { slot: 1, pcId: 'mei' });
    const state = materialize(log.events());
    expect(state.pcSlots[1]).toBeUndefined();
  });

  it('rejects slot below 1 (Phase B-prime dropped the upper cap; campaign-config gates it now)', () => {
    // Per the converged Phase B' design 2026-05-25: the engine
    // does not cap slot indices.  Cap-at-9 (or whatever) is a
    // campaign-config decision under V-10 ([C], not [E]).  The
    // sticky-N invariant means slot numbers grow monotonically
    // over a campaign's lifetime; the cap is a UI floor, not an
    // engine ceiling.
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 0, pcId: 'mei' });
    log.append('pc-slot-bind', { v: 1, slot: -1, pcId: 'eve' });
    // Slot 10 is now ACCEPTED at the engine layer:
    log.append('pc-slot-bind', { v: 1, slot: 10, pcId: 'bob' });
    const state = materialize(log.events());
    expect(state.pcSlots[0]).toBeUndefined();
    expect(state.pcSlots[-1]).toBeUndefined();
    expect(state.pcSlots[10]?.pcId).toBe('bob');
  });

  it('rejects non-integer slot', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1.5, pcId: 'mei' });
    log.append('pc-slot-bind', { v: 1, slot: NaN, pcId: 'bob' });
    log.append('pc-slot-bind', { v: 1, slot: Infinity, pcId: 'eve' });
    const state = materialize(log.events());
    expect(state.pcSlots).toEqual({});
  });

  it('rejects non-string pcId (except null)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 42 });
    log.append('pc-slot-bind', { v: 1, slot: 2, pcId: undefined });
    const state = materialize(log.events());
    expect(state.pcSlots).toEqual({});
  });

  it('null pcId explicitly clears the binding', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: null });
    const state = materialize(log.events());
    expect(state.pcSlots[1]).toBeUndefined();
    expect(1 in state.pcSlots).toBe(false);
  });

  it('subsequent bind to the same slot overrides (LWW)', () => {
    // Note: Phase B' sticky-N invariant says UI should NOT offer
    // re-bind on a bound slot — but the materializer stays
    // permissive (LWW) so corrupt-replay paths are recoverable.
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'lin' });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.pcId).toBe('lin');
  });

  it('multiple slots can be bound independently', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'bob' });
    log.append('pc-slot-bind', { v: 1, slot: 4, pcId: 'aiyana' });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.pcId).toBe('mei');
    expect(state.pcSlots[2]?.pcId).toBe('bob');
    expect(state.pcSlots[4]?.pcId).toBe('aiyana');
  });

  it('rejects invalid character id (defensive)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    // Character ids in Quire are bounded-length safe-key strings.
    // A path-traversal or excessive-length attempt is dropped.
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: '../escape' });
    log.append('pc-slot-bind', { v: 1, slot: 2, pcId: '' });
    const state = materialize(log.events());
    expect(state.pcSlots[1]).toBeUndefined();
    expect(state.pcSlots[2]).toBeUndefined();
  });

  it('survives filterForViewer (pcSlots is PLAYER-visible)', () => {
    // The substitution must render identical names for every viewer
    // at the table, so pcSlots flows through the filter with pcId
    // intact.  Phase B' (2026-05-25): DM-only seat metadata
    // (retireReason, retiredScene) IS stripped, but pcId stays.
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('peer-join', { name: 'Bob' }); // bob: player
    const state = materialize(log.events());
    const filtered = filterForViewer(state, 'bob');
    expect(filtered.pcSlots[1]?.pcId).toBe('mei');
  });
});

describe('materialize — pc-create (Phase 3b-1)', () => {
  // Helper: minimal valid pc-create payload.
  function validPayload(overrides: Record<string, unknown> = {}): unknown {
    return {
      v: 1,
      pcId: 'slot-1-a3f8b2c1',
      name: 'Mei Tanaka',
      pronouns: 'she/her',
      tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      backstory: 'Mei grew up in the Mission, listening to ferries leave.',
      causedByResponseId: 'syn-abc',
      ...overrides
    };
  }

  it('coord can materialize a synthesized PC', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload());
    const state = materialize(log.events());
    const record = state.synthesizedPcs['slot-1-a3f8b2c1'];
    expect(record).toBeDefined();
    expect(record.name).toBe('Mei Tanaka');
    expect(record.pronouns).toBe('she/her');
    expect(record.stats).toEqual({
      str: 0,
      dex: 1,
      con: 1,
      int: 2,
      wis: 1,
      cha: 0
    });
    expect(record.skills).toEqual(['Tech', 'Knowledge']);
    expect(record.tags?.length).toBe(3);
    expect(record.harm).toBe(0);
    expect(record.stress).toBe(0);
    expect(record.foci).toEqual([]);
    expect(record.advancements).toBe(0);
    expect(record.marks).toBe(0);
    expect(record.$schemaVersion).toBe('0.1.0');
  });

  it('emptyState starts with no synthesized PCs', () => {
    expect(emptyState().synthesizedPcs).toEqual({});
  });

  it('non-coord pc-create is dropped', () => {
    const log = new EventLog('bob');
    log.append('pc-create', validPayload());
    const state = materialize(log.events());
    expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
  });

  it('rejects payload missing v:1 (forward-compat)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload({ v: undefined }));
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects invalid pcId (path-traversal, empty, too long)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload({ pcId: '../escape' }));
    log.append('pc-create', validPayload({ pcId: '' }));
    log.append('pc-create', validPayload({ pcId: 42 as unknown as string }));
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('first-write-wins on pcId collision', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload({ name: 'Mei Tanaka' }));
    log.append('pc-create', validPayload({ name: 'Different Name' }));
    const state = materialize(log.events());
    expect(state.synthesizedPcs['slot-1-a3f8b2c1'].name).toBe('Mei Tanaka');
  });

  it('rejects name empty or too long', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload({ pcId: 'a1', name: '' }));
    log.append(
      'pc-create',
      validPayload({ pcId: 'a2', name: 'x'.repeat(81) })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects pronouns too long', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload({ pronouns: 'x'.repeat(41) }));
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects tags array out of [3, 5] range', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append(
      'pc-create',
      validPayload({ pcId: 'a1', tags: ['a', 'b'] }) // too few
    );
    log.append(
      'pc-create',
      validPayload({
        pcId: 'a2',
        tags: ['a', 'b', 'c', 'd', 'e', 'f'] // too many
      })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects empty or oversize tag entries', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append(
      'pc-create',
      validPayload({ pcId: 'a1', tags: ['valid', '', 'valid'] })
    );
    log.append(
      'pc-create',
      validPayload({
        pcId: 'a2',
        tags: ['x'.repeat(81), 'b', 'c']
      })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects out-of-range or non-integer stat values', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append(
      'pc-create',
      validPayload({
        pcId: 'a1',
        stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 4 }
      })
    );
    log.append(
      'pc-create',
      validPayload({
        pcId: 'a2',
        stats: { str: 1.5, dex: 1, con: 1, int: 2, wis: 1, cha: 0 }
      })
    );
    log.append(
      'pc-create',
      validPayload({
        pcId: 'a3',
        stats: {
          str: NaN,
          dex: 1,
          con: 1,
          int: 2,
          wis: 1,
          cha: 0
        }
      })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects missing-stat-key payload', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append(
      'pc-create',
      validPayload({
        stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1 } // no cha
      })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects backstory empty or > 8000 chars', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload({ pcId: 'a1', backstory: '' }));
    log.append(
      'pc-create',
      validPayload({ pcId: 'a2', backstory: 'x'.repeat(8001) })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('rejects too-many skills (max 4)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append(
      'pc-create',
      validPayload({
        skills: ['Tech', 'Knowledge', 'Insight', 'Influence', 'Craft']
      })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('accepts empty skills array (boundary)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload({ skills: [] }));
    const state = materialize(log.events());
    expect(state.synthesizedPcs['slot-1-a3f8b2c1'].skills).toEqual([]);
  });

  it('rejects oversize causedByResponseId', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append(
      'pc-create',
      validPayload({ causedByResponseId: 'x'.repeat(201) })
    );
    const state = materialize(log.events());
    expect(state.synthesizedPcs).toEqual({});
  });

  it('survives filterForViewer (synthesizedPcs is PLAYER-visible)', () => {
    // The player MUST see their own synthesized PC; the filter
    // must pass synthesizedPcs through untouched.
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload());
    log.append('peer-join', { name: 'Bob' });
    const state = materialize(log.events());
    const filtered = filterForViewer(state, 'bob');
    expect(filtered.synthesizedPcs['slot-1-a3f8b2c1'].name).toBe('Mei Tanaka');
  });

  it('replay produces the same shared state (idempotency)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload());
    const a = materialize(log.events());
    const b = materialize(log.events());
    expect(a.synthesizedPcs).toEqual(b.synthesizedPcs);
  });

  it('Wave 3 polish (TTRPG-R4 fix #3): startingAdvancements + startingMarks seed catch-up', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append(
      'pc-create',
      validPayload({ startingAdvancements: 2, startingMarks: 3 })
    );
    const state = materialize(log.events());
    const record = state.synthesizedPcs['slot-1-a3f8b2c1'];
    expect(record.advancements).toBe(2);
    expect(record.marks).toBe(3);
  });

  it('Wave 3 polish: defaults to 0/0 when starting fields omitted', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-create', validPayload()); // no starting fields
    const state = materialize(log.events());
    const record = state.synthesizedPcs['slot-1-a3f8b2c1'];
    expect(record.advancements).toBe(0);
    expect(record.marks).toBe(0);
  });

  it('Wave 3 polish: rejects negative / non-integer / out-of-range starting values', () => {
    for (const bad of [-1, 1.5, 100, 'two' as unknown]) {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append('pc-create', validPayload({ startingAdvancements: bad }));
      const state = materialize(log.events());
      // Bad payload → materializer rejects the whole event.
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    }
  });

  // ===================================================================
  // Phase B P2 (2026-05-26): languages + moneyBand additive fields.
  // ===================================================================
  describe('Phase B P2 — languages + moneyBand', () => {
    it('applies default languages + moneyBand when payload omits them', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append('pc-create', validPayload());
      const state = materialize(log.events());
      const record = state.synthesizedPcs['slot-1-a3f8b2c1'];
      expect(record).toBeDefined();
      expect(record.languages).toEqual(['English']);
      expect(record.moneyBand).toBe('tight');
    });

    it('accepts AI-supplied languages array verbatim', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ languages: ['English', 'Mandarin'] })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1'].languages).toEqual([
        'English',
        'Mandarin'
      ]);
    });

    it('accepts each of the 5 valid moneyBand values', () => {
      const bands = [
        'broke',
        'tight',
        'comfortable',
        'well-off',
        'wealthy'
      ] as const;
      for (let i = 0; i < bands.length; i++) {
        const log = new EventLog('alice');
        log.append('coordinator-claim', {});
        log.append(
          'pc-create',
          validPayload({ pcId: `b${i}`, moneyBand: bands[i] })
        );
        const state = materialize(log.events());
        expect(state.synthesizedPcs[`b${i}`].moneyBand).toBe(bands[i]);
      }
    });

    it('rejects unknown moneyBand enum', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ moneyBand: 'opulent' as unknown as string })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('rejects moneyBand that is not a string', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ moneyBand: 42 as unknown as string })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('rejects languages array exceeding 8 entries', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      const tooMany = Array.from({ length: 9 }, (_, i) => `lang${i}`);
      log.append('pc-create', validPayload({ languages: tooMany }));
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('rejects language string longer than 40 chars', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ languages: ['x'.repeat(41)] })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('rejects empty-string language entry', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append('pc-create', validPayload({ languages: ['English', ''] }));
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('rejects languages with non-string entries', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ languages: ['English', 42 as unknown as string] })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('rejects languages that is not an array', () => {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ languages: 'English' as unknown as string[] })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('accepts empty languages array (legal — defaults stay applied to record)', () => {
      // Payload-supplied empty array is technically valid (< maxItems
      // boundary).  The materializer treats it as an explicit empty
      // list — no default fallback because the caller intentionally
      // sent it.  Documents the behavior so a future change doesn't
      // accidentally "fill" empty arrays.
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append('pc-create', validPayload({ languages: [] }));
      const state = materialize(log.events());
      const record = state.synthesizedPcs['slot-1-a3f8b2c1'];
      expect(record).toBeDefined();
      expect(record.languages).toEqual([]);
    });

    it('still keeps foci empty even if payload tries to inject them (spoiler firewall)', () => {
      // Per TTRPG P2 verdict, foci stay OUT of chargen — phase=accidental
      // PCs have no cast actions.  The materializer clobbers foci to []
      // regardless of payload.  This is the TTRPG-firewall guard.
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({
          // Cast as unknown so the test can simulate a malicious /
          // out-of-spec payload that tries to add foci.
          foci: [{ id: 'magic-1', name: 'Forbidden' }] as unknown
        } as Record<string, unknown>)
      );
      const state = materialize(log.events());
      const record = state.synthesizedPcs['slot-1-a3f8b2c1'];
      expect(record).toBeDefined();
      expect(record.foci).toEqual([]);
    });

    it('threat-class: schema-mismatch — uppercase moneyBand variant ("WEALTHY") is rejected (no case-folding)', () => {
      // Hostile-or-buggy provider: enum is case-sensitive per
      // PC_CREATE_VALID_MONEY_BANDS.  An uppercase variant must NOT
      // slip past — otherwise the player rail would render an
      // unknown band token the rest of the engine has no styling for.
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ moneyBand: 'WEALTHY' as unknown as string })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('threat-class: schema-mismatch — moneyBand=null is rejected (null is not absent)', () => {
      // Explicit null is distinct from `undefined` — the
      // materializer's `!== undefined` guard would let null through
      // to the typeof string check.  Verify typeof catches it.
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({ moneyBand: null as unknown as string })
      );
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']).toBeUndefined();
    });

    it('threat-class: resource-exhaustion — boundary 8 languages × 40 chars accepted (caps are <=, not <)', () => {
      // Off-by-one regression guard: caps should be inclusive at
      // both axes.
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      const langs = Array.from({ length: 8 }, (_, i) =>
        `${String.fromCharCode(65 + i)}`.repeat(40)
      );
      log.append('pc-create', validPayload({ languages: langs }));
      const state = materialize(log.events());
      expect(state.synthesizedPcs['slot-1-a3f8b2c1']?.languages).toHaveLength(
        8
      );
      for (const l of state.synthesizedPcs['slot-1-a3f8b2c1'].languages!) {
        expect(l.length).toBe(40);
      }
    });

    it('T4 + threat-class: materializer payload-injection — DM-only-shaped fields (dmNotes, alignmentDrift, knowsTheyCanCast) NEVER written to record', () => {
      // A buggy or hostile controller could spread `dmNotes` or
      // any DM-only field onto the pc-create payload.  The
      // materializer reads field-by-field into a fixed
      // CharacterRecord shape, so extras MUST be dropped.  Pin the
      // firewall against any future "spread the payload" refactor.
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({
          dmNotes: 'AI says PC is destined for greatness',
          alignmentDrift: { current: 'fallen', history: [] },
          knowsTheyCanCast: true,
          magicPhase: 'awakened',
          tax: { active: true, since: 999 },
          threadDebt: { rung: 'hunted' },
          accidentalGrants: ['flame-grasp']
        })
      );
      const state = materialize(log.events());
      const record = state.synthesizedPcs[
        'slot-1-a3f8b2c1'
      ] as unknown as Record<string, unknown>;
      expect(record).toBeDefined();
      expect(record.dmNotes).toBeUndefined();
      expect(record.alignmentDrift).toBeUndefined();
      expect(record.knowsTheyCanCast).toBeUndefined();
      expect(record.magicPhase).toBeUndefined();
      expect(record.tax).toBeUndefined();
      expect(record.threadDebt).toBeUndefined();
      expect(record.accidentalGrants).toBeUndefined();
    });

    it('verification T6: languages + moneyBand SURVIVE player projection (not DM-only)', () => {
      // Spoiler-firewall positive control: the two new Phase B
      // fields are player-visible texture; they MUST survive the
      // viewer-scope projection so players see their own languages
      // and money band on their rail.  Regression test against
      // accidentally adding them to DM_ONLY_CHARACTER_FIELDS later.
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      log.append(
        'pc-create',
        validPayload({
          languages: ['English', 'Mandarin'],
          moneyBand: 'comfortable'
        })
      );
      const state = materialize(log.events());
      // Player-scope (non-coord) projection.
      const playerView = filterForViewer(state, 'bob');
      const record = playerView.synthesizedPcs['slot-1-a3f8b2c1'];
      expect(record).toBeDefined();
      expect(record.languages).toEqual(['English', 'Mandarin']);
      expect(record.moneyBand).toBe('comfortable');
      // Sanity-check the DM-only fields ARE still being stripped on
      // the same projection (no firewall regression elsewhere).
      expect((record as unknown as Record<string, unknown>).magicPhase).toBeUndefined();
      expect((record as unknown as Record<string, unknown>).knowsTheyCanCast).toBeUndefined();
    });
  });
});

// =====================================================================
// Phase B-prime (2026-05-25): roster lifecycle events — seat-add,
// pc-retire, pc-archive + DM-only seat metadata projection.
// =====================================================================

describe('materialize — seat-add (Phase B-prime)', () => {
  it('coord can allocate an unbound seat', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 5 });
    const state = materialize(log.events());
    expect(state.pcSlots[5]).toEqual({ state: 'unbound' });
  });

  it('coord can pre-assign the controller peer on a fresh seat', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 5, controllerPeerId: 'bob' });
    const state = materialize(log.events());
    expect(state.pcSlots[5]?.state).toBe('unbound');
    expect(state.pcSlots[5]?.controllerPeerId).toBe('bob');
  });

  it('non-coord seat-add is dropped', () => {
    const log = new EventLog('bob');
    log.append('seat-add', { v: 1, slot: 5 });
    const state = materialize(log.events());
    expect(state.pcSlots[5]).toBeUndefined();
  });

  it('seat-add is idempotent on an already-bound slot (no clobber)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('seat-add', { v: 1, slot: 1 }); // attempts to overwrite
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-active');
    expect(state.pcSlots[1]?.pcId).toBe('mei');
  });

  it('rejects invalid slot (zero / negative / non-integer)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 0 });
    log.append('seat-add', { v: 1, slot: -1 });
    log.append('seat-add', { v: 1, slot: 1.5 });
    const state = materialize(log.events());
    expect(state.pcSlots[0]).toBeUndefined();
    expect(state.pcSlots[-1]).toBeUndefined();
  });

  it('Phase B-prime: no upper cap on slot number (campaign-config gates it)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 15 });
    const state = materialize(log.events());
    expect(state.pcSlots[15]?.state).toBe('unbound');
  });
});

describe('materialize — pc-retire / pc-archive (Phase B-prime)', () => {
  function setup(): EventLog {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    return log;
  }

  it('pc-retire transitions a bound-active seat to bound-retired with metadata', () => {
    const log = setup();
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'left the story after a hard betrayal',
      reason: 'departed',
      scene: 'ep1/scene-3'
    });
    const state = materialize(log.events());
    const seat = state.pcSlots[1];
    expect(seat?.state).toBe('bound-retired');
    expect(seat?.pcId).toBe('mei');
    expect(seat?.inFictionRetireReason).toBe(
      'left the story after a hard betrayal'
    );
    expect(seat?.retireReason).toBe('departed');
    expect(seat?.retiredScene).toBe('ep1/scene-3');
    expect(seat?.retiredAt).toBeGreaterThan(0);
    // controllerPeerId stripped on retire.
    expect(seat?.controllerPeerId).toBeUndefined();
  });

  it('pc-archive transitions to bound-archived (same payload, different state)', () => {
    const log = setup();
    log.append('pc-archive', {
      v: 1,
      pcId: 'mei',
      state: 'bound-archived',
      inFictionReason: 'stepped back from the party',
      reason: 'other'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-archived');
  });

  it('non-coord retire is dropped', () => {
    const log = setup();
    const log2 = new EventLog('bob');
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'x',
      reason: 'other'
    });
    void log2; // mark used
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-retired'); // applied by alice (coord)
  });

  it('rejects missing inFictionReason (mandatory by design)', () => {
    const log = setup();
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      reason: 'departed'
      // inFictionReason intentionally missing
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-active'); // unchanged
  });

  it('rejects unknown reason enum', () => {
    const log = setup();
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'x',
      reason: 'banished' // not in the enum
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-active');
  });

  it('rejects retire targeting a pcId with no seat', () => {
    const log = setup();
    log.append('pc-retire', {
      v: 1,
      pcId: 'unknown-pc',
      state: 'bound-retired',
      inFictionReason: 'x',
      reason: 'died'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-active');
  });

  it('bound-retired ↔ bound-archived transition (DM changes their mind)', () => {
    const log = setup();
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'left',
      reason: 'departed'
    });
    log.append('pc-archive', {
      v: 1,
      pcId: 'mei',
      state: 'bound-archived',
      inFictionReason: 'left for now',
      reason: 'departed'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-archived');
    expect(state.pcSlots[1]?.inFictionRetireReason).toBe('left for now');
  });

  it('idempotent on same-state (no-op when already in target state)', () => {
    const log = setup();
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'first reason',
      reason: 'died'
    });
    // Second retire with a different reason — idempotency: ignored.
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'different reason',
      reason: 'departed'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.inFictionRetireReason).toBe('first reason');
  });
});

describe('materialize — pc-retire seatMemory + seat-memory-edit (#294)', () => {
  function setupRetiredSeat(opts?: {
    seatMemory?: string;
  }): { log: EventLog } {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'left after a hard betrayal',
      reason: 'departed',
      ...(opts?.seatMemory !== undefined ? { seatMemory: opts.seatMemory } : {})
    });
    return { log };
  }

  it('accepts an optional seatMemory at retire time', () => {
    const { log } = setupRetiredSeat({
      seatMemory: 'The medic whose silence said more than her words'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBe(
      'The medic whose silence said more than her words'
    );
  });

  it('omits seatMemory when payload omits the field', () => {
    const { log } = setupRetiredSeat();
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBeUndefined();
  });

  it('rejects the retire event when seatMemory exceeds 200 chars', () => {
    const { log } = setupRetiredSeat({ seatMemory: 'x'.repeat(201) });
    const state = materialize(log.events());
    // Retire payload rejected; seat stays bound-active.
    expect(state.pcSlots[1]?.state).toBe('bound-active');
  });

  it('rejects retire event when seatMemory is not a string', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'reason',
      reason: 'departed',
      seatMemory: 42 as unknown as string
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-active');
  });

  it('seat-memory-edit: coord can backfill memory on a retired seat', () => {
    const { log } = setupRetiredSeat();
    log.append('seat-memory-edit', {
      v: 1,
      slot: 1,
      text: 'The scout who never quite trusted the party'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBe(
      'The scout who never quite trusted the party'
    );
  });

  it('seat-memory-edit: empty string clears the memory', () => {
    const { log } = setupRetiredSeat({ seatMemory: 'placeholder' });
    log.append('seat-memory-edit', { v: 1, slot: 1, text: '' });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBeUndefined();
  });

  it('seat-memory-edit: rejected on a bound-active seat (memory is for terminal states only)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('seat-memory-edit', {
      v: 1,
      slot: 1,
      text: 'should not stick to an active seat'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBeUndefined();
  });

  it('seat-memory-edit: rejected on missing seat', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-memory-edit', { v: 1, slot: 99, text: 'phantom' });
    const state = materialize(log.events());
    expect(state.pcSlots[99]).toBeUndefined();
  });

  it('seat-memory-edit: non-coord (bob) attempts overwrite — silently dropped', () => {
    // Set up via alice (coord); merge events from bob (non-coord)
    // attempting the edit.  Materializer must drop bob's event.
    const alice = new EventLog('alice');
    alice.append('coordinator-claim', {});
    alice.append('peer-join', { name: 'Bob' });
    alice.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    alice.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'reason',
      reason: 'departed'
    });
    const bob = new EventLog('bob');
    bob.append('seat-memory-edit', {
      v: 1,
      slot: 1,
      text: 'bob should not be able to write this'
    });
    const merged = [...alice.events(), ...bob.events()];
    const state = materialize(merged);
    expect(state.pcSlots[1]?.seatMemory).toBeUndefined();
  });

  it('seat-memory-edit: text > 200 chars rejected', () => {
    const { log } = setupRetiredSeat({ seatMemory: 'original' });
    log.append('seat-memory-edit', {
      v: 1,
      slot: 1,
      text: 'x'.repeat(201)
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBe('original');
  });

  it('preserves seatMemory across bound-retired → bound-archived state flip', () => {
    const { log } = setupRetiredSeat({
      seatMemory: 'The chair memory'
    });
    log.append('pc-archive', {
      v: 1,
      pcId: 'mei',
      state: 'bound-archived',
      inFictionReason: 'left for good',
      reason: 'departed'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-archived');
    expect(state.pcSlots[1]?.seatMemory).toBe('The chair memory');
  });

  it('verification B1: re-emitted pc-retire on already-retired seat is idempotent — seatMemory NOT overwritten (canonical edit path is seat-memory-edit)', () => {
    // Documents the intended behavior the verifier called out: the
    // `pc-retire` materializer's same-state guard bails before
    // touching seatMemory.  The retire UI gates the Retire button to
    // bound-active seats so this only happens in adversarial /
    // corrupted replays; the canonical post-retire edit path is the
    // dedicated `seat-memory-edit` event.  Pin so a future refactor
    // doesn't accidentally leak the original-memory through a
    // re-emit.
    const { log } = setupRetiredSeat({
      seatMemory: 'first memory'
    });
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'still left after a hard betrayal',
      reason: 'departed',
      seatMemory: 'attempted overwrite via re-emit'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBe('first memory');
    // In-fiction reason also preserved (locked by the prior test in
    // the pc-retire block).
    expect(state.pcSlots[1]?.inFictionRetireReason).toBe(
      'left after a hard betrayal'
    );
  });

  it('archive event with explicit seatMemory in payload overrides prior memory', () => {
    const { log } = setupRetiredSeat({ seatMemory: 'before' });
    log.append('pc-archive', {
      v: 1,
      pcId: 'mei',
      state: 'bound-archived',
      inFictionReason: 'left for good',
      reason: 'departed',
      seatMemory: 'after archive'
    });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.seatMemory).toBe('after archive');
  });

  it('filterForViewer: seatMemory SURVIVES player projection (player-safe by construction)', () => {
    const { log } = setupRetiredSeat({
      seatMemory: 'The medic whose silence said more than her words'
    });
    const state = materialize(log.events());
    const playerView = filterForViewer(state, 'bob');
    expect(playerView.pcSlots[1]?.seatMemory).toBe(
      'The medic whose silence said more than her words'
    );
    // Sanity: DM-only retireReason + retiredScene + retiredAt still
    // stripped on the same projection.
    expect(playerView.pcSlots[1]?.retireReason).toBeUndefined();
    expect(playerView.pcSlots[1]?.retiredScene).toBeUndefined();
    expect(playerView.pcSlots[1]?.retiredAt).toBeUndefined();
  });
});

describe('materialize — accidental-grant-log + focus-grant (Wave B magic-arc)', () => {
  function setupBound(): { log: EventLog } {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    return { log };
  }

  it('accidental-grant-log: coord appends a grant to pcAccidentalGrants[pcId]', () => {
    const { log } = setupBound();
    log.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      note: 'Mei found her keys exactly where she needed them'
    });
    const state = materialize(log.events());
    expect(state.pcAccidentalGrants.mei).toHaveLength(1);
    expect(state.pcAccidentalGrants.mei[0].note).toBe(
      'Mei found her keys exactly where she needed them'
    );
    expect(state.pcAccidentalGrants.mei[0].ts).toBeGreaterThan(0);
  });

  it('accidental-grant-log: multiple events append in order', () => {
    const { log } = setupBound();
    log.append('accidental-grant-log', { v: 1, pcId: 'mei', note: 'first' });
    log.append('accidental-grant-log', { v: 1, pcId: 'mei', note: 'second' });
    log.append('accidental-grant-log', { v: 1, pcId: 'mei', note: 'third' });
    const state = materialize(log.events());
    expect(state.pcAccidentalGrants.mei.map((g) => g.note)).toEqual([
      'first',
      'second',
      'third'
    ]);
  });

  it('accidental-grant-log: optional sceneId is preserved when supplied', () => {
    const { log } = setupBound();
    log.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      note: 'in fiction',
      sceneId: 'ep1/scene-3'
    });
    const state = materialize(log.events());
    expect(state.pcAccidentalGrants.mei[0].sceneId).toBe('ep1/scene-3');
  });

  it('accidental-grant-log: non-coord is silently dropped', () => {
    const alice = new EventLog('alice');
    alice.append('coordinator-claim', {});
    alice.append('peer-join', { name: 'Bob' });
    alice.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    const bob = new EventLog('bob');
    bob.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      note: 'bob should not be able to write this'
    });
    const merged = [...alice.events(), ...bob.events()];
    const state = materialize(merged);
    expect(state.pcAccidentalGrants.mei).toBeUndefined();
  });

  it('accidental-grant-log: rejects empty note', () => {
    const { log } = setupBound();
    log.append('accidental-grant-log', { v: 1, pcId: 'mei', note: '' });
    const state = materialize(log.events());
    expect(state.pcAccidentalGrants.mei).toBeUndefined();
  });

  it('accidental-grant-log: rejects oversized note (>200 chars)', () => {
    const { log } = setupBound();
    log.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      note: 'x'.repeat(201)
    });
    const state = materialize(log.events());
    expect(state.pcAccidentalGrants.mei).toBeUndefined();
  });

  it('accidental-grant-log: rejects invalid pcId (path traversal)', () => {
    const { log } = setupBound();
    log.append('accidental-grant-log', {
      v: 1,
      pcId: '../escape',
      note: 'hostile'
    });
    const state = materialize(log.events());
    expect(state.pcAccidentalGrants['../escape']).toBeUndefined();
  });

  it('filterForViewer: pcAccidentalGrants STRIPPED from non-coord projection (DM-only spoiler firewall)', () => {
    const { log } = setupBound();
    log.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      note: 'DM-private aid'
    });
    const state = materialize(log.events());
    const playerView = filterForViewer(state, 'bob');
    expect(playerView.pcAccidentalGrants).toEqual({});
    // Belt-and-suspenders: secret text is nowhere in the projection
    expect(JSON.stringify(playerView)).not.toContain('DM-private aid');
  });

  it('focus-grant: coord appends a focus to pcFoci[pcId] with default active status', () => {
    const { log } = setupBound();
    log.append('focus-grant', {
      v: 1,
      pcId: 'mei',
      focus: { name: 'pattern-sense', domain: 'perception' }
    });
    const state = materialize(log.events());
    expect(state.pcFoci.mei).toHaveLength(1);
    expect(state.pcFoci.mei[0].name).toBe('pattern-sense');
    expect(state.pcFoci.mei[0].domain).toBe('perception');
    expect(state.pcFoci.mei[0].status).toBe('active');
  });

  it('focus-grant: caller-supplied status is preserved', () => {
    const { log } = setupBound();
    log.append('focus-grant', {
      v: 1,
      pcId: 'mei',
      focus: { name: 'old-bond', status: 'broken' }
    });
    const state = materialize(log.events());
    expect(state.pcFoci.mei[0].status).toBe('broken');
  });

  it('focus-grant: optional fields all flow through when valid', () => {
    const { log } = setupBound();
    log.append('focus-grant', {
      v: 1,
      pcId: 'mei',
      focus: {
        name: 'the-grandmother-stone',
        domain: 'memory',
        condition: 'when held to forehead',
        notes: 'inherited; warm to touch',
        status: 'active',
        boundFor: 'the recurring intent to remember home'
      }
    });
    const state = materialize(log.events());
    const f = state.pcFoci.mei[0];
    expect(f.condition).toBe('when held to forehead');
    expect(f.notes).toBe('inherited; warm to touch');
    expect(f.boundFor).toBe('the recurring intent to remember home');
  });

  it('focus-grant: non-coord is silently dropped', () => {
    const alice = new EventLog('alice');
    alice.append('coordinator-claim', {});
    alice.append('peer-join', { name: 'Bob' });
    alice.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    const bob = new EventLog('bob');
    bob.append('focus-grant', {
      v: 1,
      pcId: 'mei',
      focus: { name: 'bob-injected-focus' }
    });
    const merged = [...alice.events(), ...bob.events()];
    const state = materialize(merged);
    expect(state.pcFoci.mei).toBeUndefined();
  });

  it('focus-grant: rejects missing/empty/oversized name', () => {
    const { log } = setupBound();
    log.append('focus-grant', { v: 1, pcId: 'mei', focus: { name: '' } });
    log.append('focus-grant', {
      v: 1,
      pcId: 'mei',
      focus: { name: 'x'.repeat(81) }
    });
    log.append('focus-grant', { v: 1, pcId: 'mei', focus: {} });
    const state = materialize(log.events());
    expect(state.pcFoci.mei).toBeUndefined();
  });

  it('focus-grant: rejects unknown status enum', () => {
    const { log } = setupBound();
    log.append('focus-grant', {
      v: 1,
      pcId: 'mei',
      focus: { name: 'x', status: 'shattered' as unknown as 'active' }
    });
    const state = materialize(log.events());
    expect(state.pcFoci.mei).toBeUndefined();
  });

  it('filterForViewer: pcFoci SURVIVES player projection (player-visible at Realization)', () => {
    const { log } = setupBound();
    log.append('focus-grant', {
      v: 1,
      pcId: 'mei',
      focus: { name: 'pattern-sense', domain: 'perception' }
    });
    const state = materialize(log.events());
    const playerView = filterForViewer(state, 'bob');
    expect(playerView.pcFoci.mei).toHaveLength(1);
    expect(playerView.pcFoci.mei[0].name).toBe('pattern-sense');
  });

  it('emptyState includes pcAccidentalGrants + pcFoci as empty maps', () => {
    const state = emptyState();
    expect(state.pcAccidentalGrants).toEqual({});
    expect(state.pcFoci).toEqual({});
  });

  // --- Wave D-prep-2 (2026-05-26): atomic pc-mark-realization ---

  it('pc-mark-realization: applies all 4 fields atomically to pcEdits[pcId]', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-mark-realization', { v: 1, pcId: 'mei' });
    const state = materialize(log.events());
    const edits = state.pcEdits.mei;
    expect(edits.magicPhase).toBe('realization');
    expect(edits.knowsTheyCanCast).toBe(true);
    expect(edits['tax.active']).toBe(true);
    expect(edits['tax.sessionsRemaining']).toBe(3);
  });

  it('pc-mark-realization: honors a caller-supplied taxSessions value', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-mark-realization', { v: 1, pcId: 'mei', taxSessions: 2 });
    const state = materialize(log.events());
    expect(state.pcEdits.mei['tax.sessionsRemaining']).toBe(2);
  });

  it('pc-mark-realization: non-coord is silently dropped', () => {
    const alice = new EventLog('alice');
    alice.append('coordinator-claim', {});
    alice.append('peer-join', { name: 'Bob' });
    alice.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    const bob = new EventLog('bob');
    bob.append('pc-mark-realization', { v: 1, pcId: 'mei' });
    const merged = [...alice.events(), ...bob.events()];
    const state = materialize(merged);
    expect(state.pcEdits.mei).toBeUndefined();
  });

  it('pc-mark-realization: rejects invalid pcId / out-of-range taxSessions', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-mark-realization', { v: 1, pcId: '../escape' });
    log.append('pc-mark-realization', { v: 1, pcId: 'mei', taxSessions: 0 });
    log.append('pc-mark-realization', { v: 1, pcId: 'mei', taxSessions: 21 });
    log.append('pc-mark-realization', {
      v: 1,
      pcId: 'mei',
      taxSessions: 'three' as unknown as number
    });
    const state = materialize(log.events());
    expect(state.pcEdits.mei).toBeUndefined();
    expect(state.pcEdits['../escape']).toBeUndefined();
  });

  it('pc-mark-realization: preserves prior pcEdits (overlay merge, not clobber)', () => {
    // The atomic write merges its 4 fields onto whatever pcEdits
    // entry already exists.  Other prior edits (harm, stress,
    // tags, etc.) MUST survive the realization commit.
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-edit', { v: 1, pcId: 'mei', field: 'harm', value: 2 });
    log.append('pc-edit', { v: 1, pcId: 'mei', field: 'stress', value: 1 });
    log.append('pc-mark-realization', { v: 1, pcId: 'mei' });
    const state = materialize(log.events());
    const edits = state.pcEdits.mei;
    // Prior edits survive.
    expect(edits.harm).toBe(2);
    expect(edits.stress).toBe(1);
    // Realization fields applied.
    expect(edits.magicPhase).toBe('realization');
    expect(edits.knowsTheyCanCast).toBe(true);
    expect(edits['tax.active']).toBe(true);
    expect(edits['tax.sessionsRemaining']).toBe(3);
  });

  it('pc-mark-realization: atomicity guarantee — half-applied state is impossible', () => {
    // The TTRPG-expert "real risk, low frequency, high
    // embarrassment" case.  Pre-fix, a network drop between event
    // 2 and 3 of the 4-pc-edit batch left "player told they can
    // cast but tax not active" — destroyed table trust on the
    // one-way gate.  Post-fix, materialize is all-or-nothing
    // because a single materializer call writes all 4 fields.
    // Test: materialize the log AT TWO DIFFERENT EVENT-COUNT
    // CUT POINTS — neither point can yield a half-applied state.
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-mark-realization', { v: 1, pcId: 'mei' });
    const events = log.events();
    // Cut BEFORE the realization event: no realization fields.
    const before = materialize(events.slice(0, -1));
    expect(before.pcEdits.mei).toBeUndefined();
    // Cut AT the realization event: ALL fields land together.
    const after = materialize(events);
    expect(after.pcEdits.mei.magicPhase).toBe('realization');
    expect(after.pcEdits.mei.knowsTheyCanCast).toBe(true);
    expect(after.pcEdits.mei['tax.active']).toBe(true);
    expect(after.pcEdits.mei['tax.sessionsRemaining']).toBe(3);
  });

  // ---

  // --- D4 (2026-05-26): session-digest event ---

  describe('session-digest materializer (D4)', () => {
    function setupCoord(): EventLog {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      return log;
    }

    it('coord can save a digest; entry lands with ts + savedByPeerId + markdown', () => {
      const log = setupCoord();
      log.append('session-digest', {
        v: 1,
        sessionStartTs: 1_000,
        markdown: '# Session 1\n\nMei found the keys.'
      });
      const state = materialize(log.events());
      expect(state.sessionDigests).toHaveLength(1);
      const d = state.sessionDigests[0];
      expect(d.savedByPeerId).toBe('alice');
      expect(d.sessionStartTs).toBe(1_000);
      expect(d.markdown).toBe('# Session 1\n\nMei found the keys.');
      expect(d.ts).toBeGreaterThan(0);
    });

    it('append-only — multiple digests land in chronological order', () => {
      const log = setupCoord();
      log.append('session-digest', { v: 1, sessionStartTs: 1, markdown: 'first' });
      log.append('session-digest', { v: 1, sessionStartTs: 2, markdown: 'second' });
      log.append('session-digest', { v: 1, sessionStartTs: 3, markdown: 'third' });
      const state = materialize(log.events());
      expect(state.sessionDigests.map((d) => d.markdown)).toEqual([
        'first',
        'second',
        'third'
      ]);
    });

    it('non-coord cannot save a digest', () => {
      const alice = setupCoord();
      const bob = new EventLog('bob');
      bob.append('session-digest', {
        v: 1,
        sessionStartTs: 1,
        markdown: 'bob-attempt'
      });
      const merged = [...alice.events(), ...bob.events()];
      const state = materialize(merged);
      expect(state.sessionDigests).toEqual([]);
    });

    it('rejects empty markdown', () => {
      const log = setupCoord();
      log.append('session-digest', { v: 1, sessionStartTs: 1, markdown: '' });
      const state = materialize(log.events());
      expect(state.sessionDigests).toEqual([]);
    });

    it('rejects oversized markdown (>20000 chars)', () => {
      const log = setupCoord();
      log.append('session-digest', {
        v: 1,
        sessionStartTs: 1,
        markdown: 'x'.repeat(20_001)
      });
      const state = materialize(log.events());
      expect(state.sessionDigests).toEqual([]);
    });

    it('rejects negative sessionStartTs', () => {
      const log = setupCoord();
      log.append('session-digest', {
        v: 1,
        sessionStartTs: -1,
        markdown: 'x'
      });
      const state = materialize(log.events());
      expect(state.sessionDigests).toEqual([]);
    });

    it('preserves optional generatedByResponseId when present', () => {
      const log = setupCoord();
      log.append('session-digest', {
        v: 1,
        sessionStartTs: 1,
        markdown: 'x',
        generatedByResponseId: 'mock-r-123'
      });
      const state = materialize(log.events());
      expect(state.sessionDigests[0].generatedByResponseId).toBe('mock-r-123');
    });

    it('omits generatedByResponseId from stored entry when not supplied', () => {
      const log = setupCoord();
      log.append('session-digest', {
        v: 1,
        sessionStartTs: 1,
        markdown: 'hand-written'
      });
      const state = materialize(log.events());
      expect(state.sessionDigests[0].generatedByResponseId).toBeUndefined();
    });

    it('rejects oversized generatedByResponseId (>200 chars)', () => {
      const log = setupCoord();
      log.append('session-digest', {
        v: 1,
        sessionStartTs: 1,
        markdown: 'x',
        generatedByResponseId: 'x'.repeat(201)
      });
      const state = materialize(log.events());
      expect(state.sessionDigests).toEqual([]);
    });

    it('filterForViewer passes sessionDigests through to non-coord (player-visible)', () => {
      const log = setupCoord();
      log.append('peer-join', { name: 'bob' });
      log.append('session-digest', {
        v: 1,
        sessionStartTs: 1,
        markdown: '# Recap\n\nThe campfire memory.'
      });
      const state = materialize(log.events());
      const playerView = filterForViewer(state, 'bob');
      expect(playerView.sessionDigests).toHaveLength(1);
      expect(playerView.sessionDigests[0].markdown).toContain('campfire');
    });
  });

  it('verifier-S5: concurrent grants from two coordHolders both land (append-only, no LWW collision)', () => {
    // Co-DM scenario: alice yields to bob; both are in
    // coordHolders for authorship purposes.  Both fire
    // accidental-grant-log on the same PC at the same wall-clock.
    // Append-only semantics mean BOTH grants land; deterministic
    // event-log ordering means replays produce the same array.
    const alice = new EventLog('alice');
    alice.append('coordinator-claim', {});
    alice.append('peer-join', { name: 'Bob' });
    alice.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    // Bob takes coord (the test relies on a reclaim being valid;
    // the materializer puts bob in coordHolders).
    const bob = new EventLog('bob');
    bob.append('coordinator-reclaim', { fromPeerId: 'alice' });
    // Both coords append a grant.
    alice.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      note: 'alice-grant'
    });
    bob.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      note: 'bob-grant'
    });
    const merged = [...alice.events(), ...bob.events()];
    const state = materialize(merged);
    // Both grants land; order is deterministic by event-log
    // append order in `merged` (alice-events first, then bob).
    expect(state.pcAccidentalGrants.mei).toHaveLength(2);
    const notes = state.pcAccidentalGrants.mei.map((g) => g.note);
    expect(notes).toContain('alice-grant');
    expect(notes).toContain('bob-grant');
  });
});

describe('materialize — seat-remove (Wave 1 — phantom-seat removal)', () => {
  it('coord can remove an unbound seat with no content', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 5 });
    log.append('seat-remove', { v: 1, slot: 5 });
    const state = materialize(log.events());
    expect(state.pcSlots[5]).toBeUndefined();
  });

  it('seat-remove frees the slot integer for reuse by a later seat-add', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 3 });
    log.append('seat-remove', { v: 1, slot: 3 });
    log.append('seat-add', { v: 1, slot: 3 });
    const state = materialize(log.events());
    expect(state.pcSlots[3]).toEqual({ state: 'unbound' });
  });

  it('refuses to remove a bound-active seat (retire-flow only)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('seat-remove', { v: 1, slot: 1 });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-active');
    expect(state.pcSlots[1]?.pcId).toBe('mei');
  });

  it('refuses to remove a bound-retired seat (sticky-N preserves history)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'left after a hard betrayal',
      reason: 'departed'
    });
    log.append('seat-remove', { v: 1, slot: 1 });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-retired');
  });

  it('refuses to remove a bound-archived seat', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-archive', {
      v: 1,
      pcId: 'mei',
      state: 'bound-archived',
      inFictionReason: 'stepped back from the party',
      reason: 'other'
    });
    log.append('seat-remove', { v: 1, slot: 1 });
    const state = materialize(log.events());
    expect(state.pcSlots[1]?.state).toBe('bound-archived');
  });

  it('non-coord seat-remove is dropped', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const claim = alice.append('coordinator-claim', {});
    bob.apply(claim);
    const add = alice.append('seat-add', { v: 1, slot: 5 });
    bob.apply(add);
    bob.append('seat-remove', { v: 1, slot: 5 });
    for (const ev of bob.events()) alice.apply(ev);
    const state = materialize(alice.events());
    expect(state.pcSlots[5]?.state).toBe('unbound');
  });

  it('seat-remove on a non-existent slot is a no-op', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-remove', { v: 1, slot: 99 });
    const state = materialize(log.events());
    expect(state.pcSlots[99]).toBeUndefined();
  });

  it('rejects invalid slot (zero / negative / non-integer)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 1 });
    log.append('seat-remove', { v: 1, slot: 0 });
    log.append('seat-remove', { v: 1, slot: -1 });
    log.append('seat-remove', { v: 1, slot: 1.5 });
    const state = materialize(log.events());
    // Slot 1 should still be there — none of the bad seat-removes touched it.
    expect(state.pcSlots[1]?.state).toBe('unbound');
  });
});

describe('filterForViewer — Phase B-prime DM-only seat metadata strip', () => {
  function setup(): EventLog {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('peer-join', { name: 'Bob' });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'left the story after a hard betrayal',
      reason: 'departed', // DM-only
      scene: 'ep1/scene-3' // DM-only
    });
    return log;
  }

  it('player sees in-fiction reason but NOT retireReason or retiredScene', () => {
    const state = materialize(setup().events());
    const filtered = filterForViewer(state, 'bob');
    const seat = filtered.pcSlots[1];
    expect(seat?.state).toBe('bound-retired');
    expect(seat?.pcId).toBe('mei'); // for {{pc:1}} substitution
    expect(seat?.inFictionRetireReason).toBe(
      'left the story after a hard betrayal'
    );
    // DM-only fields stripped:
    expect(seat?.retireReason).toBeUndefined();
    expect(seat?.retiredScene).toBeUndefined();
    expect(seat?.retiredAt).toBeUndefined();
  });

  it('current coord sees full seat metadata (no projection)', () => {
    const state = materialize(setup().events());
    const filtered = filterForViewer(state, 'alice');
    const seat = filtered.pcSlots[1];
    expect(seat?.retireReason).toBe('departed');
    expect(seat?.retiredScene).toBe('ep1/scene-3');
    expect(seat?.retiredAt).toBeGreaterThan(0);
  });

  it('player view does not mutate source state (seat metadata preserved on source)', () => {
    const state = materialize(setup().events());
    filterForViewer(state, 'bob');
    expect(state.pcSlots[1]?.retireReason).toBe('departed');
    expect(state.pcSlots[1]?.retiredScene).toBe('ep1/scene-3');
  });
});

// =====================================================================
// #301 (2026-05-26): unrevealed-seat spoiler firewall — per-seat
// revealed flag.  Default ⇒ visible; `revealed: false` on seat-add
// hides the slot from non-coord views entirely; `seat-reveal` flips
// to visible (sticky once revealed).
// =====================================================================

describe('materialize — seat reveal gate (#301)', () => {
  it('seat-add with revealed:false marks the seat hidden', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 5, revealed: false });
    const state = materialize(dm.events());
    expect(state.pcSlots[5]?.state).toBe('unbound');
    expect(state.pcSlots[5]?.revealed).toBe(false);
  });

  it('seat-add without the revealed field defaults to visible', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 5 });
    const state = materialize(dm.events());
    expect(state.pcSlots[5]?.revealed).toBeUndefined();
  });

  it('filterForViewer drops unrevealed seats from non-coord view', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('peer-join', { name: 'Alice' });
    const bob = new EventLog('bob');
    bob.append('peer-join', { name: 'Bob' });
    for (const ev of bob.events()) dm.apply(ev);
    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 9, revealed: false });
    const state = materialize(dm.events());
    expect(Object.keys(state.pcSlots).sort()).toEqual(['1', '9']);
    const playerView = filterForViewer(state, 'bob');
    // Bob doesn't see slot 9 at all.
    expect(Object.keys(playerView.pcSlots)).toEqual(['1']);
    expect(playerView.pcSlots[9]).toBeUndefined();
  });

  it('DM-as-viewer sees unrevealed seats (identity fast-path)', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 9, revealed: false });
    const state = materialize(dm.events());
    const dmView = filterForViewer(state, 'alice');
    expect(dmView).toBe(state);
    expect(dmView.pcSlots[9]?.revealed).toBe(false);
  });

  it('seat-reveal flips revealed:false → revealed (player can now see)', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('peer-join', { name: 'Alice' });
    const bob = new EventLog('bob');
    bob.append('peer-join', { name: 'Bob' });
    for (const ev of bob.events()) dm.apply(ev);
    dm.append('seat-add', { v: 1, slot: 9, revealed: false });
    // Reveal.
    dm.append('seat-reveal', { v: 1, slot: 9 });
    const state = materialize(dm.events());
    expect(state.pcSlots[9]?.revealed).toBeUndefined();
    const playerView = filterForViewer(state, 'bob');
    // Now visible to Bob.
    expect(playerView.pcSlots[9]).toBeDefined();
  });

  it('seat-reveal from a non-coord peer is dropped', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('peer-join', { name: 'Alice' });
    const bob = new EventLog('bob');
    bob.append('peer-join', { name: 'Bob' });
    for (const ev of bob.events()) dm.apply(ev);
    dm.append('seat-add', { v: 1, slot: 9, revealed: false });
    for (const ev of dm.events()) bob.apply(ev);
    // Bob (non-coord) tries to reveal.
    const hostile = bob.append('seat-reveal', { v: 1, slot: 9 });
    dm.apply(hostile);
    const state = materialize(dm.events());
    expect(state.pcSlots[9]?.revealed).toBe(false);
  });

  it('seat-reveal on an already-revealed seat is a no-op', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 9 });
    dm.append('seat-reveal', { v: 1, slot: 9 });
    const state = materialize(dm.events());
    expect(state.pcSlots[9]?.revealed).toBeUndefined();
  });

  it('seat-reveal on a missing slot is a no-op', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('seat-reveal', { v: 1, slot: 99 });
    const state = materialize(dm.events());
    expect(state.pcSlots[99]).toBeUndefined();
  });

  it('QA verification: pc-slot-bind preserves revealed:false from prior seat-add', () => {
    // Regression for the bug where pc-slot-bind blindly overwrote
    // the seat and lost the hidden flag.  Surfaced during the
    // promote-npc test fixup; the fix lives at state.ts ~2110.
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1, revealed: false });
    // pc-slot-bind targeting the same slot.
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    const state = materialize(dm.events());
    expect(state.pcSlots[1]?.state).toBe('bound-active');
    expect(state.pcSlots[1]?.pcId).toBe('mei');
    expect(state.pcSlots[1]?.revealed).toBe(false);
  });

  it('QA verification: synthesizedPcs for a hidden seat is stripped from the player projection', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('peer-join', { name: 'Alice' });
    const bob = new EventLog('bob');
    bob.append('peer-join', { name: 'Bob' });
    for (const ev of bob.events()) dm.apply(ev);
    dm.append('seat-add', { v: 1, slot: 1, revealed: false });
    dm.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: [],
      backstory: 'X'
    });
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    const state = materialize(dm.events());
    // DM sees the full record.
    expect(state.synthesizedPcs['mei']).toBeDefined();
    const bobView = filterForViewer(state, 'bob');
    // Bob sees no seat AND no synthesized PC for the hidden pcId.
    expect(bobView.pcSlots[1]).toBeUndefined();
    expect(bobView.synthesizedPcs['mei']).toBeUndefined();
  });
});

// =====================================================================
// P-R11 (2026-05-25): player-initiated retire request + DM accept/reject.
// =====================================================================

describe('materialize — pc-retire-request / pc-retire-reject (P-R11)', () => {
  /**
   * Build merged event logs for a 2-peer scenario:
   *   - alice = DM (coord; binds slot 1 → 'mei')
   *   - bob   = player (peer-join, peer-rename to bind pcId='mei')
   *   - charlie = third party for hostile-author tests
   * Returns the merged ordered event log ready for materialize().
   */
  function bobOwnsMei(): {
    alice: EventLog;
    bob: EventLog;
    charlie: EventLog;
  } {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const charlie = new EventLog('charlie');
    alice.append('coordinator-claim', {});
    alice.append('peer-join', { name: 'Alice' });
    bob.append('peer-join', { name: 'Bob' });
    charlie.append('peer-join', { name: 'Charlie' });
    // Share peer-join + coord events.
    for (const ev of alice.events()) {
      bob.apply(ev);
      charlie.apply(ev);
    }
    for (const ev of bob.events()) {
      if (ev.peerId === 'bob') alice.apply(ev);
    }
    for (const ev of charlie.events()) {
      if (ev.peerId === 'charlie') alice.apply(ev);
    }
    // DM binds Mei to slot 1.
    const bind = alice.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    bob.apply(bind);
    charlie.apply(bind);
    // Bob binds himself to Mei via peer-rename.
    const claim = bob.append('peer-rename', { pcId: 'mei' });
    alice.apply(claim);
    charlie.apply(claim);
    return { alice, bob, charlie };
  }

  it('pc-retire-request from the seat controller appends a pending request', () => {
    const { alice, bob } = bobOwnsMei();
    const req = bob.append('pc-retire-request', {
      v: 1,
      pcId: 'mei',
      inFictionReason: 'Mei wants to leave the cell and never come back',
      reason: 'departed'
    });
    alice.apply(req);
    const state = materialize(alice.events());
    expect(state.pcRetireRequests).toHaveLength(1);
    expect(state.pcRetireRequests[0].requestingPeerId).toBe('bob');
    expect(state.pcRetireRequests[0].pcId).toBe('mei');
    expect(state.pcRetireRequests[0].reason).toBe('departed');
  });

  it('drops request from a peer who is NOT the PC controller', () => {
    const { alice, charlie } = bobOwnsMei();
    const req = charlie.append('pc-retire-request', {
      v: 1,
      pcId: 'mei',
      inFictionReason: 'sneaky',
      reason: 'died'
    });
    alice.apply(req);
    expect(materialize(alice.events()).pcRetireRequests).toHaveLength(0);
  });

  it('drops request with invalid reason enum / empty in-fiction text', () => {
    const { alice, bob } = bobOwnsMei();
    const empty = bob.append('pc-retire-request', {
      v: 1,
      pcId: 'mei',
      inFictionReason: '',
      reason: 'departed'
    });
    const badEnum = bob.append('pc-retire-request', {
      v: 1,
      pcId: 'mei',
      inFictionReason: 'ok',
      reason: 'made-up-reason' as never
    });
    alice.apply(empty);
    alice.apply(badEnum);
    expect(materialize(alice.events()).pcRetireRequests).toHaveLength(0);
  });

  it('duplicate requests from same peer replace the prior (LWW)', () => {
    const { alice, bob } = bobOwnsMei();
    const first = bob.append('pc-retire-request', {
      v: 1, pcId: 'mei', inFictionReason: 'first try', reason: 'departed'
    });
    const second = bob.append('pc-retire-request', {
      v: 1, pcId: 'mei', inFictionReason: 'revised', reason: 'died'
    });
    alice.apply(first);
    alice.apply(second);
    const state = materialize(alice.events());
    expect(state.pcRetireRequests).toHaveLength(1);
    expect(state.pcRetireRequests[0].inFictionReason).toBe('revised');
    expect(state.pcRetireRequests[0].reason).toBe('died');
  });

  it('pc-retire (DM accept) clears the pending request for that pcId', () => {
    const { alice, bob } = bobOwnsMei();
    const req = bob.append('pc-retire-request', {
      v: 1, pcId: 'mei', inFictionReason: 'go', reason: 'departed'
    });
    alice.apply(req);
    alice.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'go',
      reason: 'departed'
    });
    const state = materialize(alice.events());
    expect(state.pcRetireRequests).toHaveLength(0);
    expect(state.pcSlots[1]?.state).toBe('bound-retired');
  });

  it('pc-retire-reject (coord-authored) clears the request and records a rejection', () => {
    const { alice, bob } = bobOwnsMei();
    const req = bob.append('pc-retire-request', {
      v: 1, pcId: 'mei', inFictionReason: 'too soon', reason: 'died'
    });
    alice.apply(req);
    alice.append('pc-retire-reject', {
      v: 1,
      requestingPeerId: 'bob',
      pcId: 'mei',
      note: 'one more session — there is a scene I want her in'
    });
    const state = materialize(alice.events());
    expect(state.pcRetireRequests).toHaveLength(0);
    expect(state.pcRetireRejections).toHaveLength(1);
    expect(state.pcRetireRejections[0].requestingPeerId).toBe('bob');
    expect(state.pcRetireRejections[0].note).toMatch(/one more session/);
  });

  it('non-coord cannot author pc-retire-reject', () => {
    const { alice, bob, charlie } = bobOwnsMei();
    const req = bob.append('pc-retire-request', {
      v: 1, pcId: 'mei', inFictionReason: 'go', reason: 'departed'
    });
    alice.apply(req);
    charlie.apply(req);
    const hostile = charlie.append('pc-retire-reject', {
      v: 1, requestingPeerId: 'bob', pcId: 'mei'
    });
    alice.apply(hostile);
    const state = materialize(alice.events());
    expect(state.pcRetireRequests).toHaveLength(1);
    expect(state.pcRetireRejections).toHaveLength(0);
  });

  it('SHOULD-FIX-2: non-coord viewer sees ONLY their own retire requests + rejections', () => {
    // QA sanity-check: defense-in-depth strip in filterForViewer.
    // Build a 3-peer scenario where two players each have requests
    // pending + bob also has a rejection.  Project for each viewer
    // and check they only see their own entries.
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('peer-join', { name: 'Alice' });
    const bob = new EventLog('bob');
    bob.append('peer-join', { name: 'Bob' });
    const carol = new EventLog('carol');
    carol.append('peer-join', { name: 'Carol' });
    for (const ev of bob.events()) dm.apply(ev);
    for (const ev of carol.events()) dm.apply(ev);
    // Two PCs, two players bound.
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'reggie' });
    for (const ev of dm.events()) {
      bob.apply(ev);
      carol.apply(ev);
    }
    bob.append('peer-rename', { pcId: 'mei' });
    carol.append('peer-rename', { pcId: 'reggie' });
    for (const ev of bob.events()) {
      if (ev.peerId === 'bob' && ev.kind === 'peer-rename') dm.apply(ev);
    }
    for (const ev of carol.events()) {
      if (ev.peerId === 'carol' && ev.kind === 'peer-rename') dm.apply(ev);
    }
    // Both players request retire.
    bob.apply(
      dm.events()[dm.events().length - 1]
    ); // sync carol's rename to bob
    const bobReq = bob.append('pc-retire-request', {
      v: 1,
      pcId: 'mei',
      inFictionReason: "Mei realizes the Quiet has been speaking through her",
      reason: 'departed'
    });
    dm.apply(bobReq);
    carol.apply(bobReq);
    const carolReq = carol.append('pc-retire-request', {
      v: 1,
      pcId: 'reggie',
      inFictionReason: "Reggie wants to go home",
      reason: 'departed'
    });
    dm.apply(carolReq);
    // DM rejects bob's request with a spoilery note.
    dm.append('pc-retire-reject', {
      v: 1,
      requestingPeerId: 'bob',
      pcId: 'mei',
      note: 'the prophecy needs her one more scene'
    });
    const state = materialize(dm.events());
    expect(state.pcRetireRequests).toHaveLength(1); // bob's was cleared on reject
    expect(state.pcRetireRejections).toHaveLength(1);
    // Bob's view: sees his own rejection but NOT carol's request.
    const bobView = filterForViewer(state, 'bob');
    expect(bobView.pcRetireRequests).toEqual([]);
    expect(bobView.pcRetireRejections).toHaveLength(1);
    expect(bobView.pcRetireRejections[0].requestingPeerId).toBe('bob');
    // Carol's view: sees her own pending request, NOT bob's rejection
    // (and definitely not bob's spoilery in-fiction reason).
    const carolView = filterForViewer(state, 'carol');
    expect(carolView.pcRetireRequests).toHaveLength(1);
    expect(carolView.pcRetireRequests[0].requestingPeerId).toBe('carol');
    expect(carolView.pcRetireRejections).toEqual([]);
  });

  it('SHOULD-FIX-5: pc-retire-reject with empty requestingPeerId is dropped', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('pc-retire-reject', {
      v: 1,
      requestingPeerId: '',
      pcId: 'mei'
    });
    const state = materialize(dm.events());
    expect(state.pcRetireRejections).toHaveLength(0);
  });

  it('SHOULD-FIX-5: pc-retire-reject with oversized requestingPeerId is dropped', () => {
    const dm = new EventLog('alice');
    dm.append('coordinator-claim', {});
    dm.append('pc-retire-reject', {
      v: 1,
      requestingPeerId: 'x'.repeat(81),
      pcId: 'mei'
    });
    const state = materialize(dm.events());
    expect(state.pcRetireRejections).toHaveLength(0);
  });

  it('a fresh request after a rejection clears the stale rejection pip', () => {
    const { alice, bob } = bobOwnsMei();
    const first = bob.append('pc-retire-request', {
      v: 1, pcId: 'mei', inFictionReason: 'go', reason: 'departed'
    });
    alice.apply(first);
    alice.append('pc-retire-reject', {
      v: 1, requestingPeerId: 'bob', pcId: 'mei', note: 'wait'
    });
    // Sync the rejection back to bob so his log seq increments past it.
    for (const ev of alice.events()) bob.apply(ev);
    const second = bob.append('pc-retire-request', {
      v: 1, pcId: 'mei', inFictionReason: 'second try, please', reason: 'departed'
    });
    alice.apply(second);
    const state = materialize(alice.events());
    expect(state.pcRetireRequests).toHaveLength(1);
    expect(state.pcRetireRejections).toHaveLength(0);
  });

  // --- D1-D (2026-05-26): living-doc diff-review proposal lifecycle ---

  describe('proposal-create / accept / reject materializers (D1-D)', () => {
    function setupCoord(): EventLog {
      const log = new EventLog('alice');
      log.append('coordinator-claim', {});
      return log;
    }
    function validCreatePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        v: 1,
        id: 'prop-001',
        kind: 'npc-update',
        npcId: 'yui-tanaka',
        path: 'characters/npcs/yui-tanaka.json',
        field: 'disposition',
        before: 'friendly-distant',
        after: 'friendly-warm',
        rationale: 'PC1 was kind at the SFO gate',
        baseSha: 'sha-1',
        ...over
      };
    }

    it('coord creates → proposal lands with audit fields', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload());
      const state = materialize(log.events());
      expect(state.diffProposals).toHaveLength(1);
      const p = state.diffProposals[0];
      expect(p.id).toBe('prop-001');
      expect(p.proposedByPeerId).toBe('alice');
      expect(p.field).toBe('disposition');
      expect(p.after).toBe('friendly-warm');
      expect(p.ts).toBeGreaterThan(0);
    });

    it('non-coord proposal-create is silently rejected', () => {
      const alice = setupCoord();
      const bob = new EventLog('bob');
      bob.append('proposal-create', validCreatePayload({ id: 'prop-bob' }));
      const merged = [...alice.events(), ...bob.events()];
      const state = materialize(merged);
      expect(state.diffProposals).toEqual([]);
    });

    it('id-based replacement: re-create with the same id replaces the prior entry', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload({ after: 'first version' }));
      log.append('proposal-create', validCreatePayload({ after: 'second version' }));
      const state = materialize(log.events());
      expect(state.diffProposals).toHaveLength(1);
      expect(state.diffProposals[0].after).toBe('second version');
    });

    it('proposal-accept removes the proposal from the pending queue', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload());
      log.append('proposal-accept', { v: 1, id: 'prop-001' });
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('proposal-accept on unknown id is a no-op', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload());
      log.append('proposal-accept', { v: 1, id: 'prop-DOES-NOT-EXIST' });
      const state = materialize(log.events());
      expect(state.diffProposals).toHaveLength(1);
    });

    it('Adversarial B-4 idempotency: double-accept by two co-DMs is a no-op on the second', () => {
      const alice = setupCoord();
      alice.append('proposal-create', validCreatePayload());
      const bob = new EventLog('bob');
      bob.append('coordinator-claim', {});
      // Both coords accept the same proposal id (race).
      alice.append('proposal-accept', { v: 1, id: 'prop-001' });
      bob.append('proposal-accept', { v: 1, id: 'prop-001' });
      const merged = [...alice.events(), ...bob.events()];
      const state = materialize(merged);
      expect(state.diffProposals).toEqual([]);
    });

    it('proposal-reject removes from queue (same as accept, no file write)', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload());
      log.append('proposal-reject', { v: 1, id: 'prop-001', reason: 'nope' });
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('rejects proposal-create with path-traversal in path', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload({ path: '../../etc/passwd' }));
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('rejects proposal-create with shell-shaped id', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload({ id: 'prop;rm -rf /' }));
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('rejects proposal-create with oversized after payload', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload({ after: 'x'.repeat(20_001) }));
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('rejects unknown kind (forward-compat guard)', () => {
      const log = setupCoord();
      log.append(
        'proposal-create',
        validCreatePayload({ kind: 'scene-retcon' })
      );
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('rejects field with __proto__ segment (prototype-pollution defense)', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload({ field: '__proto__' }));
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('rejects field with constructor.prototype chain', () => {
      const log = setupCoord();
      log.append(
        'proposal-create',
        validCreatePayload({ field: 'constructor.prototype.x' })
      );
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('rejects nested __proto__ segment (background.__proto__.y)', () => {
      const log = setupCoord();
      log.append(
        'proposal-create',
        validCreatePayload({ field: 'background.__proto__.y' })
      );
      const state = materialize(log.events());
      expect(state.diffProposals).toEqual([]);
    });

    it('proposal-accept rejects shell-shaped id (defense-in-depth)', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload());
      log.append('proposal-accept', { v: 1, id: '; rm -rf /' });
      const state = materialize(log.events());
      // proposal still pending because the accept was rejected.
      expect(state.diffProposals).toHaveLength(1);
    });

    it('proposal-reject rejects shell-shaped id (defense-in-depth)', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload());
      log.append('proposal-reject', { v: 1, id: 'evil; cat /etc/passwd' });
      const state = materialize(log.events());
      expect(state.diffProposals).toHaveLength(1);
    });

    it('filterForViewer wipes diffProposals for non-coord viewers', () => {
      const log = setupCoord();
      log.append('proposal-create', validCreatePayload());
      const state = materialize(log.events());
      // Non-coord viewer.
      const playerView = filterForViewer(state, 'bob');
      expect(playerView.diffProposals).toEqual([]);
      // Coord identity fast-path preserves.
      const dmView = filterForViewer(state, 'alice');
      expect(dmView.diffProposals).toHaveLength(1);
    });
  });
});

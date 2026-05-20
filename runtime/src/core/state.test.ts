import { describe, it, expect } from 'vitest';
import { EventLog } from './event-log';
import { materialize, emptyState } from './state';

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

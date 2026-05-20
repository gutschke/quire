import { describe, it, expect } from 'vitest';
import { Peer } from './peer';
import { InMemoryNetwork, InMemoryTransport } from './transports/in-memory';

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net));
}

describe('Peer — single peer', () => {
  it('appends events locally and materializes its own state', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    alice.append('peer-join', { name: 'Alice' });
    alice.append('chat', { text: 'hi' });
    expect(alice.state().peers.alice).toBeDefined();
    expect(alice.state().chat).toHaveLength(1);
  });
});

describe('Peer — two peers convergence', () => {
  it('two peers converge after exchanging events', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);

    alice.append('peer-join', { name: 'Alice' });
    bob.append('peer-join', { name: 'Bob' });

    // Both peers should now have both events.
    expect(Object.keys(alice.state().peers).sort()).toEqual([
      'alice',
      'bob'
    ]);
    expect(Object.keys(bob.state().peers).sort()).toEqual(['alice', 'bob']);
  });

  it('chat from one peer is visible to the other', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    alice.append('chat', { text: 'hello bob' });
    expect(bob.state().chat).toHaveLength(1);
    expect(bob.state().chat[0].text).toBe('hello bob');
  });
});

describe('Peer — late join catchup', () => {
  it('a peer joining after events exist catches up via sync-request', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);

    alice.append('peer-join', { name: 'Alice' });
    alice.append('chat', { text: 'a' });
    bob.append('chat', { text: 'b' });

    // Carol joins after.
    const carol = makePeer('carol', net);
    // The peer-connect events from the transport trigger sync requests.
    // After the protocol settles, carol should have all events.
    expect(carol.state().chat).toHaveLength(2);
    expect(Object.keys(carol.state().peers)).toContain('alice');
  });
});

describe('Peer — partition / heal', () => {
  it('partitioned peer does not receive events from others', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    net.setPartition('bob', true);
    alice.append('chat', { text: 'while you were away' });
    expect(bob.state().chat).toHaveLength(0);
  });

  it('healed peer catches up via sync after reconnect', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    net.setPartition('bob', true);
    alice.append('chat', { text: 'while you were away' });
    expect(bob.state().chat).toHaveLength(0);
    net.setPartition('bob', false);
    // Heal triggers peer-connect events; sync follows.
    expect(bob.state().chat).toHaveLength(1);
    expect(bob.state().chat[0].text).toBe('while you were away');
  });
});

describe('Peer — coordinator workflow', () => {
  it('DM claims coordinator and reveals a scene; players see it', () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm', net);
    const player1 = makePeer('player1', net);
    const player2 = makePeer('player2', net);

    dm.append('coordinator-claim', {});
    dm.append('scene-reveal', {
      scenePath: 'episodes/001/scenes/01.md'
    });

    for (const p of [dm, player1, player2]) {
      expect(p.state().coordinator).toBe('dm');
      expect(p.state().revealedScenes).toEqual([
        'episodes/001/scenes/01.md'
      ]);
    }
  });

  it('a non-coordinator scene-reveal is ignored after replication', () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm', net);
    const player1 = makePeer('player1', net);
    dm.append('coordinator-claim', {});
    player1.append('scene-reveal', { scenePath: 'sneaky.md' });
    expect(dm.state().revealedScenes).toEqual([]);
    expect(player1.state().revealedScenes).toEqual([]);
  });
});

describe('Peer — concurrent edits resolve deterministically', () => {
  it('two concurrent pc-edits on the same field converge to the same value on both peers', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    // Partition so each peer's edit is unseen by the other at the moment of authoring.
    net.setPartition('alice', true);
    net.setPartition('bob', true);
    alice.append('pc-edit', {
      pcId: 'pc1',
      field: 'notes',
      value: 'alice'
    });
    bob.append('pc-edit', { pcId: 'pc1', field: 'notes', value: 'bob' });
    // Heal both.
    net.setPartition('alice', false);
    net.setPartition('bob', false);
    expect(alice.state().pcEdits.pc1.notes).toBe(
      bob.state().pcEdits.pc1.notes
    );
  });
});

describe('Peer — state change notifications', () => {
  it('notifies subscribers on local append', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    let calls = 0;
    alice.onStateChange(() => {
      calls++;
    });
    alice.append('chat', { text: 'hi' });
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it('notifies subscribers on remote event applied', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    let bobCalls = 0;
    bob.onStateChange(() => {
      bobCalls++;
    });
    alice.append('chat', { text: 'hi' });
    expect(bobCalls).toBeGreaterThanOrEqual(1);
  });

  it('unsubscribe stops notifications', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    let calls = 0;
    const unsub = alice.onStateChange(() => {
      calls++;
    });
    alice.append('chat', { text: 'a' });
    const after1 = calls;
    unsub();
    alice.append('chat', { text: 'b' });
    expect(calls).toBe(after1);
  });
});

describe('Peer — ignores malformed protocol messages', () => {
  it('does not throw on unknown payload shapes', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    const bobTransport = bob['transport' as keyof typeof bob] as unknown as InMemoryTransport;
    // Manually send a bad payload via the transport
    // (We do this by reaching into the transport for the test — production sends
    // never produce these shapes, but defense-in-depth is worth verifying.)
    expect(() => {
      bobTransport.send('alice', { kind: 'wat', foo: 'bar' });
      bobTransport.send('alice', null);
      bobTransport.send('alice', 'just a string');
      bobTransport.send('alice', 42);
    }).not.toThrow();
    // Alice's state should be unchanged.
    expect(alice.state().chat).toHaveLength(0);
  });
});

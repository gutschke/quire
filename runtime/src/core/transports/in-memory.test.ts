import { describe, it, expect, vi } from 'vitest';
import { InMemoryNetwork, InMemoryTransport } from './in-memory';

describe('InMemoryTransport — basic delivery', () => {
  it('two transports on the same network can exchange messages', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    bob.onMessage(bobReceived);
    alice.send('bob', { hello: 'world' });
    expect(bobReceived).toHaveBeenCalledWith('alice', { hello: 'world' });
  });

  it('broadcast reaches all peers except the sender', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const carol = new InMemoryTransport('carol', net);
    const aliceReceived = vi.fn();
    const bobReceived = vi.fn();
    const carolReceived = vi.fn();
    alice.onMessage(aliceReceived);
    bob.onMessage(bobReceived);
    carol.onMessage(carolReceived);
    alice.send('broadcast', { hi: 1 });
    expect(aliceReceived).not.toHaveBeenCalled();
    expect(bobReceived).toHaveBeenCalledWith('alice', { hi: 1 });
    expect(carolReceived).toHaveBeenCalledWith('alice', { hi: 1 });
  });

  it('point-to-point send does not reach other peers', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const carol = new InMemoryTransport('carol', net);
    const bobReceived = vi.fn();
    const carolReceived = vi.fn();
    bob.onMessage(bobReceived);
    carol.onMessage(carolReceived);
    alice.send('bob', { hi: 1 });
    expect(bobReceived).toHaveBeenCalled();
    expect(carolReceived).not.toHaveBeenCalled();
  });
});

describe('InMemoryTransport — peer events', () => {
  it('emits onPeerConnect for existing peers when a new transport joins', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const aliceConnect = vi.fn();
    alice.onPeerConnect(aliceConnect);
    const bob = new InMemoryTransport('bob', net);
    expect(aliceConnect).toHaveBeenCalledWith('bob');
    expect(alice.connectedPeers()).toContain('bob');
    expect(bob.connectedPeers()).toContain('alice');
  });

  it('emits onPeerDisconnect when a peer closes', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const aliceDisconnect = vi.fn();
    alice.onPeerDisconnect(aliceDisconnect);
    bob.close();
    expect(aliceDisconnect).toHaveBeenCalledWith('bob');
    expect(alice.connectedPeers()).not.toContain('bob');
  });
});

describe('InMemoryTransport — partitions', () => {
  it('partition isolates a peer from sending', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    bob.onMessage(bobReceived);
    net.setPartition('alice', true);
    alice.send('bob', { hi: 1 });
    expect(bobReceived).not.toHaveBeenCalled();
  });

  it('partition isolates a peer from receiving', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const aliceReceived = vi.fn();
    alice.onMessage(aliceReceived);
    net.setPartition('alice', true);
    bob.send('alice', { hi: 1 });
    expect(aliceReceived).not.toHaveBeenCalled();
  });

  it('healing a partition restores connectivity and emits connect events', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    const bobConnect = vi.fn();
    bob.onMessage(bobReceived);
    bob.onPeerConnect(bobConnect);
    net.setPartition('alice', true);
    net.setPartition('alice', false);
    expect(bobConnect).toHaveBeenCalledWith('alice');
    alice.send('bob', { hi: 1 });
    expect(bobReceived).toHaveBeenCalled();
  });

  it('partition emits onPeerDisconnect on both sides', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const aliceDisconnect = vi.fn();
    const bobDisconnect = vi.fn();
    alice.onPeerDisconnect(aliceDisconnect);
    bob.onPeerDisconnect(bobDisconnect);
    net.setPartition('alice', true);
    expect(aliceDisconnect).toHaveBeenCalledWith('bob');
    expect(bobDisconnect).toHaveBeenCalledWith('alice');
  });
});

describe('InMemoryTransport — close', () => {
  it('close stops the transport from receiving', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    bob.onMessage(bobReceived);
    bob.close();
    alice.send('bob', { hi: 1 });
    expect(bobReceived).not.toHaveBeenCalled();
  });

  it('close stops the transport from sending', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    bob.onMessage(bobReceived);
    alice.close();
    alice.send('bob', { hi: 1 });
    expect(bobReceived).not.toHaveBeenCalled();
  });

  it('close is idempotent', () => {
    const net = new InMemoryNetwork();
    const alice = new InMemoryTransport('alice', net);
    alice.close();
    expect(() => alice.close()).not.toThrow();
  });
});

describe('InMemoryNetwork — network conditions', () => {
  it('latency delays delivery', async () => {
    const net = new InMemoryNetwork();
    net.setLatency(30);
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    bob.onMessage(bobReceived);
    alice.send('bob', { hi: 1 });
    expect(bobReceived).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(bobReceived).toHaveBeenCalled();
  });

  it('drop rate 1.0 drops every packet', () => {
    const net = new InMemoryNetwork();
    net.setDropRate(1);
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    bob.onMessage(bobReceived);
    for (let i = 0; i < 10; i++) alice.send('bob', { i });
    expect(bobReceived).not.toHaveBeenCalled();
  });

  it('drop rate 0 delivers every packet', () => {
    const net = new InMemoryNetwork();
    net.setDropRate(0);
    const alice = new InMemoryTransport('alice', net);
    const bob = new InMemoryTransport('bob', net);
    const bobReceived = vi.fn();
    bob.onMessage(bobReceived);
    for (let i = 0; i < 10; i++) alice.send('bob', { i });
    expect(bobReceived).toHaveBeenCalledTimes(10);
  });
});

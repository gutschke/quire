/**
 * Simulator — multi-peer test harness on top of the in-memory transport.
 *
 * Spins up N peers on a shared in-memory network and exposes operations a
 * scenario test might want: add/remove peers, partition/heal, change
 * latency or drop rate, then verify that all peers have converged to the
 * same state.
 *
 * This is the load-bearing piece of the runtime test infrastructure.
 * Real-PeerJS integration tests will plug a different Transport into the
 * same Peer surface and reuse most of these scenarios.
 */

import { Peer } from '../../core/peer';
import { InMemoryNetwork, InMemoryTransport } from '../../core/transports/in-memory';

export class Simulator {
  readonly network: InMemoryNetwork;
  readonly peers = new Map<string, Peer>();

  constructor() {
    this.network = new InMemoryNetwork();
  }

  addPeer(peerId: string): Peer {
    if (this.peers.has(peerId)) {
      throw new Error(`Simulator already has peer "${peerId}"`);
    }
    const transport = new InMemoryTransport(peerId, this.network);
    const peer = new Peer(peerId, transport);
    this.peers.set(peerId, peer);
    return peer;
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.close();
    this.peers.delete(peerId);
  }

  partition(peerId: string, isolated: boolean): void {
    this.network.setPartition(peerId, isolated);
  }

  setLatency(ms: number): void {
    this.network.setLatency(ms);
  }

  setDropRate(rate: number): void {
    this.network.setDropRate(rate);
  }

  /**
   * Asserts all peers have converged to the same event log (same set of
   * events in the same causal order).  Throws with a descriptive message
   * if any peer diverges.  Heal any partitions before calling.
   */
  verifyConvergence(): void {
    const peers = Array.from(this.peers.values());
    if (peers.length <= 1) return;
    const ref = peers[0].events().map((e) => e.id);
    for (const p of peers.slice(1)) {
      const got = p.events().map((e) => e.id);
      if (got.length !== ref.length || got.some((id, i) => id !== ref[i])) {
        throw new Error(
          `Convergence failure: peer "${p.peerId}" has [${got.join(', ')}]; ` +
            `peer "${peers[0].peerId}" has [${ref.join(', ')}]`
        );
      }
    }
  }

  /** Returns true iff all peers have converged. */
  isConverged(): boolean {
    try {
      this.verifyConvergence();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.network.cleanup();
  }
}

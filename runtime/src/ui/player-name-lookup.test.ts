import { describe, it, expect } from 'vitest';
import { buildPlayerNameLookup } from './player-name-lookup';

describe('buildPlayerNameLookup (UX-MH-1)', () => {
  it('resolves pcId → controller peer name via the binding chain', () => {
    const lookup = buildPlayerNameLookup(
      { 1: { pcId: 'mei', controllerPeerId: 'alice' } },
      {
        alice: {
          peerId: 'alice',
          name: 'Alice',
          joinedAt: 0
        }
      }
    );
    expect(lookup('mei')).toBe('Alice');
  });

  it('returns null when no seat is bound to the pcId', () => {
    const lookup = buildPlayerNameLookup({}, {});
    expect(lookup('ghost')).toBe(null);
  });

  it('returns null when the seat has no controller (unbound or revoked)', () => {
    const lookup = buildPlayerNameLookup(
      { 1: { pcId: 'mei' } },
      { alice: { peerId: 'alice', name: 'Alice', joinedAt: 0 } }
    );
    expect(lookup('mei')).toBe(null);
  });

  it('returns null when the controller peer has no presence entry', () => {
    const lookup = buildPlayerNameLookup(
      { 1: { pcId: 'mei', controllerPeerId: 'alice' } },
      {}
    );
    expect(lookup('mei')).toBe(null);
  });

  it('returns null when the peer has joined but has no name yet', () => {
    const lookup = buildPlayerNameLookup(
      { 1: { pcId: 'mei', controllerPeerId: 'alice' } },
      { alice: { peerId: 'alice', joinedAt: 0 } }
    );
    expect(lookup('mei')).toBe(null);
  });

  it('rebind-safety: a fresh build picks up the new controller (UX-MH-1 Adversarial P1)', () => {
    // Initial binding: alice → mei.
    let lookup = buildPlayerNameLookup(
      { 1: { pcId: 'mei', controllerPeerId: 'alice' } },
      {
        alice: { peerId: 'alice', name: 'Alice', joinedAt: 0 },
        bob: { peerId: 'bob', name: 'Bob', joinedAt: 1 }
      }
    );
    expect(lookup('mei')).toBe('Alice');
    // Player leaves; seat rebinds to bob.  REBUILD the lookup from
    // the new snapshot; the OLD lookup is discarded.  This is the
    // pattern the host MUST follow (one build per render).
    lookup = buildPlayerNameLookup(
      { 1: { pcId: 'mei', controllerPeerId: 'bob' } },
      {
        alice: { peerId: 'alice', name: 'Alice', joinedAt: 0 },
        bob: { peerId: 'bob', name: 'Bob', joinedAt: 1 }
      }
    );
    expect(lookup('mei')).toBe('Bob');
  });
});

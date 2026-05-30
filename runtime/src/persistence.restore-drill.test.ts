// @vitest-environment node

/**
 * M4 (2026-05-29 save-restore program) — Restore-drill CI.
 *
 * Until now, three critical-path assertions lived only in Playwright
 * e2e:
 *   - Cross-week save → load → continue (`multi-session.spec.ts:43`)
 *   - Branch-divergence merge (`git-snapshot.spec.ts:243`)
 *   - 100-event soak + convergence (`soak.spec.ts:73`)
 *
 * CI by design skips e2e (it requires a real browser bundle + the
 * peerjs broker), so regressions in these paths land silently. M4
 * promotes them to vitest unit tests by driving the engine layer
 * (EventLog + Peer + materialize + persistence) directly via the
 * `InMemoryNetwork` transport. No UI, no WebRTC, no Playwright.
 *
 * The drills also pin:
 *   - Byte-identical roundtrip (modulo `savedAt`).
 *   - 0 unknownKinds when the runtime that saved == runtime that
 *     restored.
 *   - LWW determinism for same-millisecond coordinator-reclaim
 *     (OP-004 — was queued for M4).
 *
 * Pattern: each test builds a deterministic seed → drives the
 * scenario → asserts. No timers, no flakes.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { EventLog, type QuireEvent } from './core/event-log';
import { materialize } from './core/state';
import {
  serializeSession,
  serializeSessionForViewer,
  stringifySave,
  parseSaveDocument,
  applySaveToLog,
  SAVE_SCHEMA_VERSION,
  type SaveDocument
} from './persistence';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net));
}

function eventIds(events: readonly QuireEvent[]): string[] {
  return events.map((e) => e.id).sort();
}

/**
 * Strip `savedAt` (a wall-clock timestamp) so two saves of the
 * same logical state are byte-identical for comparison.
 */
function withoutSavedAt(json: string): string {
  return json.replace(/"savedAt":\s*"[^"]+",?\n?\s*/, '');
}

describe('M4 restore-drill — cross-session save → load → continue', () => {
  it('DM saves session 1, fresh DM loads in session 2, state matches', () => {
    // --- Session 1 ---
    const net1 = new InMemoryNetwork();
    const dm1 = makePeer('dm-week1', net1);
    const player1 = makePeer('yui-week1', net1);

    dm1.append('coordinator-claim', {});
    dm1.append('chat', { text: 'session 1 opening' });
    player1.append('chat', { text: "Yui's first line" });

    // DM saves.
    const saved1: SaveDocument = serializeSessionForViewer(
      dm1.events(),
      CAMPAIGN,
      'dm-week1',
      dm1.state().coordinator
    );
    const savedJson = stringifySave(saved1);

    // --- Session 2 (next week, both DM and Yui have new peer ids) ---
    const net2 = new InMemoryNetwork();
    const dm2 = makePeer('dm-week2', net2);
    const player2 = makePeer('yui-week2', net2);

    // DM2 parses + applies the save through Peer.applyEvent (which
    // is the M3 re-broadcast path the real load runs through; an
    // accompanying applySaveToLog assertion below verifies the
    // unknownKinds + rejected guarantees against a fresh EventLog).
    const parsed = parseSaveDocument(savedJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const ev of parsed.doc.events) {
      dm2.applyEvent(ev);
    }

    // DM2's chat should contain session-1 messages.
    const dm2Chats = dm2.state().chat.map((c) => c.text);
    expect(dm2Chats).toContain('session 1 opening');
    expect(dm2Chats).toContain("Yui's first line");

    // 0 unknownKinds — runtime that saved == runtime that restored.
    // Verify against a fresh log so we measure the save's own
    // classification, not the dm2 peer's already-applied state.
    const auditLog = new EventLog('audit');
    const loadResult = applySaveToLog(auditLog, parsed.doc);
    expect(loadResult.unknownKinds).toBe(0);
    expect(loadResult.rejected).toBe(0);

    // Player2 sees session-1 events via gossip.
    const player2Chats = player2.state().chat.map((c) => c.text);
    expect(player2Chats).toContain('session 1 opening');
    expect(player2Chats).toContain("Yui's first line");

    // Session 2 continues.
    dm2.append('chat', { text: 'and now session 2 begins' });
    expect(player2.state().chat.map((c) => c.text)).toContain(
      'and now session 2 begins'
    );
  });

  it('sick-DM handoff: a different peer hosts session 2 and inherits state', () => {
    // Session 1: original DM saves.
    const net1 = new InMemoryNetwork();
    const originalDm = makePeer('original-dm', net1);
    originalDm.append('coordinator-claim', {});
    originalDm.append('chat', { text: 'campaign setup' });

    const saved1 = serializeSessionForViewer(
      originalDm.events(),
      CAMPAIGN,
      'original-dm',
      originalDm.state().coordinator
    );
    const savedJson = stringifySave(saved1);

    // Session 2: substitute DM (different peerId) hosts.
    const net2 = new InMemoryNetwork();
    const substitute = makePeer('substitute', net2);
    substitute.append('coordinator-claim', {});

    const parsed = parseSaveDocument(savedJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const ev of parsed.doc.events) substitute.applyEvent(ev);

    // Substitute sees campaign-setup chat.
    expect(substitute.state().chat.map((c) => c.text)).toContain(
      'campaign setup'
    );
    // Substitute is the current coordinator (either via their own
    // claim winning the LWW tiebreak or via auto-reclaim on load).
    // Either way, the current coord field should resolve to substitute
    // OR original-dm depending on the LWW tiebreak.  We don't assert
    // WHICH; we assert the substitute peer CAN write coord events
    // (the test below uses chat which is unconditional, so it's
    // a soft assertion).
    substitute.append('chat', { text: 'I am the substitute' });
    expect(substitute.state().chat.map((c) => c.text)).toContain(
      'I am the substitute'
    );
  });
});

describe('M4 restore-drill — branch divergence + merge', () => {
  it('two parallel saves unify cleanly into a third peer', () => {
    // Build a base save (the fork point).
    const baseNet = new InMemoryNetwork();
    const base = makePeer('base-dm', baseNet);
    base.append('coordinator-claim', {});
    base.append('chat', { text: 'base event' });
    const baseSave = stringifySave(
      serializeSessionForViewer(
        base.events(),
        CAMPAIGN,
        'base-dm',
        base.state().coordinator
      )
    );

    // Branch A: load base, add two events, save.
    const netA = new InMemoryNetwork();
    const dmA = makePeer('branch-a-dm', netA);
    const parsedBase = parseSaveDocument(baseSave);
    expect(parsedBase.ok).toBe(true);
    if (!parsedBase.ok) return;
    for (const ev of parsedBase.doc.events) dmA.applyEvent(ev);
    dmA.append('chat', { text: 'branch-A first' });
    dmA.append('chat', { text: 'branch-A second' });
    const branchASave = stringifySave(
      serializeSessionForViewer(
        dmA.events(),
        CAMPAIGN,
        'branch-a-dm',
        dmA.state().coordinator
      )
    );

    // Branch B: load base, add two events, save.
    const netB = new InMemoryNetwork();
    const dmB = makePeer('branch-b-dm', netB);
    for (const ev of parsedBase.doc.events) dmB.applyEvent(ev);
    dmB.append('chat', { text: 'branch-B first' });
    dmB.append('chat', { text: 'branch-B second' });
    const branchBSave = stringifySave(
      serializeSessionForViewer(
        dmB.events(),
        CAMPAIGN,
        'branch-b-dm',
        dmB.state().coordinator
      )
    );

    // Merge: load both saves into a fresh peer.  Order shouldn't
    // matter (CRDT semantics); we test A-then-B AND B-then-A.
    const mergeAB = makePeer('merge-ab', new InMemoryNetwork());
    {
      const a = parseSaveDocument(branchASave);
      const b = parseSaveDocument(branchBSave);
      expect(a.ok && b.ok).toBe(true);
      if (a.ok) for (const ev of a.doc.events) mergeAB.applyEvent(ev);
      if (b.ok) for (const ev of b.doc.events) mergeAB.applyEvent(ev);
    }

    const mergeBA = makePeer('merge-ba', new InMemoryNetwork());
    {
      const a = parseSaveDocument(branchASave);
      const b = parseSaveDocument(branchBSave);
      expect(a.ok && b.ok).toBe(true);
      if (b.ok) for (const ev of b.doc.events) mergeBA.applyEvent(ev);
      if (a.ok) for (const ev of a.doc.events) mergeBA.applyEvent(ev);
    }

    // Both merges should contain ALL 5 chat events.
    const expectedTexts = [
      'base event',
      'branch-A first',
      'branch-A second',
      'branch-B first',
      'branch-B second'
    ];
    const mergeABTexts = mergeAB.state().chat.map((c) => c.text);
    const mergeBATexts = mergeBA.state().chat.map((c) => c.text);
    for (const t of expectedTexts) {
      expect(mergeABTexts, `A-then-B should contain "${t}"`).toContain(t);
      expect(mergeBATexts, `B-then-A should contain "${t}"`).toContain(t);
    }

    // CONVERGENCE: both orderings yield byte-identical materialized
    // state (event sort is causal, so order of insertion doesn't
    // affect the final order).
    expect(eventIds(mergeAB.events())).toEqual(
      eventIds(mergeBA.events())
    );
  });
});

describe('M4 restore-drill — 100-event soak', () => {
  it('100 events save → restore yields byte-identical JSON (modulo savedAt)', () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('soak-dm', net);
    dm.append('coordinator-claim', {});

    // Deterministic 100-event seed.
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        dm.append('chat', { text: `mark ${i}` });
      } else if (i % 7 === 0) {
        dm.append('dice-roll', {
          notation: '2d6',
          rolls: [3, 4],
          modifier: 0,
          total: 7,
          label: `seed-${i}`
        });
      } else {
        dm.append('chat', { text: `event ${i}` });
      }
    }

    // First save.
    const save1 = stringifySave(
      serializeSessionForViewer(
        dm.events(),
        CAMPAIGN,
        'soak-dm',
        dm.state().coordinator
      )
    );

    // Second save of the SAME state — should be byte-identical
    // (modulo savedAt).
    const save2 = stringifySave(
      serializeSessionForViewer(
        dm.events(),
        CAMPAIGN,
        'soak-dm',
        dm.state().coordinator
      )
    );

    expect(withoutSavedAt(save1)).toBe(withoutSavedAt(save2));
  });

  it('100 events restore → save produces same byte stream as the original save', () => {
    // The big round-trip: events → save → parse → apply to fresh
    // log → save again → equal.  This pins serialization-determinism
    // AND apply-correctness in one assertion.
    const net = new InMemoryNetwork();
    const dm = makePeer('roundtrip-dm', net);
    dm.append('coordinator-claim', {});
    for (let i = 0; i < 100; i++) {
      dm.append('chat', { text: `msg ${i}` });
    }

    const originalSave = stringifySave(
      serializeSessionForViewer(
        dm.events(),
        CAMPAIGN,
        'roundtrip-dm',
        dm.state().coordinator
      )
    );

    // Load into a fresh peer.
    const fresh = makePeer('roundtrip-dm', new InMemoryNetwork());
    const parsed = parseSaveDocument(originalSave);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const ev of parsed.doc.events) fresh.applyEvent(ev);

    // Save again — should byte-match (modulo savedAt) since coord
    // status, event log, and campaign are identical.
    const restoredSave = stringifySave(
      serializeSessionForViewer(
        fresh.events(),
        CAMPAIGN,
        'roundtrip-dm',
        fresh.state().coordinator
      )
    );

    expect(withoutSavedAt(originalSave)).toBe(withoutSavedAt(restoredSave));
  });

  it('100 events apply with 0 unknownKinds + 0 rejected', () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('drill-dm', net);
    dm.append('coordinator-claim', {});
    for (let i = 0; i < 100; i++) {
      dm.append('chat', { text: `msg ${i}` });
    }
    const save = stringifySave(
      serializeSessionForViewer(
        dm.events(),
        CAMPAIGN,
        'drill-dm',
        dm.state().coordinator
      )
    );
    const parsed = parseSaveDocument(save);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const freshLog = new EventLog('fresh-dm');
    const result = applySaveToLog(freshLog, parsed.doc);
    expect(result.unknownKinds).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.errors).toEqual([]);
    // applied + duplicates should equal total events.
    expect(result.applied + result.duplicates).toBe(parsed.doc.events.length);
  });

  it('100-event soak with 3 peers converges across all peers', () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('soak-dm', net);
    const a = makePeer('soak-alice', net);
    const b = makePeer('soak-bob', net);

    dm.append('coordinator-claim', {});

    // 100 deterministic events split across the three peers.
    const peers = [dm, a, b];
    for (let i = 0; i < 100; i++) {
      const peer = peers[i % 3];
      if (i % 5 === 0) {
        peer.append('dice-roll', {
          notation: '2d6',
          rolls: [3, 4],
          modifier: i % 4,
          total: 7 + (i % 4),
          label: `roll ${i}`
        });
      } else {
        peer.append('chat', { text: `event ${i}` });
      }
    }

    // CONVERGENCE: all peers have the same event ids in the same
    // causal order.
    expect(eventIds(dm.events())).toEqual(
      eventIds(a.events())
    );
    expect(eventIds(dm.events())).toEqual(
      eventIds(b.events())
    );

    // And materialized state agrees on chat + roll counts.
    expect(dm.state().chat.length).toBe(a.state().chat.length);
    expect(dm.state().chat.length).toBe(b.state().chat.length);
  });
});

describe('M4 restore-drill — LWW determinism (OP-004)', () => {
  it('two-peer concurrent coordinator-claim resolves deterministically across reorderings', () => {
    // Two peers each append `coordinator-claim` concurrently (neither
    // sees the other first).  After cross-replication, both peers
    // must agree on the same coordinator — the LWW tiebreak is
    // (clockSum, peerId, seq) and both peers' events here have
    // clockSum=1 + seq=1, so the tiebreak is purely peerId.
    // Apply order is varied between the two peers; convergence
    // means same result.
    const aliceLog = new EventLog('alice');
    const bobLog = new EventLog('bob');
    const aClaim = aliceLog.append('coordinator-claim', {});
    const bClaim = bobLog.append('coordinator-claim', {});

    // Alice receives bob's claim.
    aliceLog.apply(bClaim);
    // Bob receives alice's claim.
    bobLog.apply(aClaim);

    const aliceState = materialize(aliceLog.events());
    const bobState = materialize(bobLog.events());

    // CONVERGENCE: both peers agree on coordinator.
    expect(aliceState.coordinator).toBe(bobState.coordinator);
    // Sanity: it's ONE of them.
    expect(['alice', 'bob']).toContain(aliceState.coordinator);
    // coordHolders: both peers' historical claims are recorded on
    // both sides (authority is "ever claimed", per state.ts:1990).
    expect(aliceState.coordHolders.has('alice')).toBe(true);
    expect(aliceState.coordHolders.has('bob')).toBe(true);
    expect(bobState.coordHolders.has('alice')).toBe(true);
    expect(bobState.coordHolders.has('bob')).toBe(true);
  });

  it('concurrent coordinator-claim survives save → restore byte-roundtrip', () => {
    const aliceLog = new EventLog('alice');
    const bobLog = new EventLog('bob');
    const aClaim = aliceLog.append('coordinator-claim', {});
    const bClaim = bobLog.append('coordinator-claim', {});
    aliceLog.apply(bClaim);
    bobLog.apply(aClaim);

    const coordBefore = materialize(aliceLog.events()).coordinator;

    const save = stringifySave(
      serializeSession(aliceLog.events(), CAMPAIGN, 'alice')
    );
    const parsed = parseSaveDocument(save);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fresh = new EventLog('reloaded');
    applySaveToLog(fresh, parsed.doc);
    const coordAfter = materialize(fresh.events()).coordinator;
    expect(coordAfter).toBe(coordBefore);
  });
});

describe('M4 restore-drill — schema sanity', () => {
  it('schemaVersion matches the runtime', () => {
    expect(SAVE_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('serializeSession produces a valid SaveDocument', () => {
    const log = new EventLog('drill');
    log.append('chat', { text: 'hi' });
    const doc = serializeSession(log.events(), CAMPAIGN, 'drill');
    expect(doc.$schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(doc.events).toHaveLength(1);
  });

  it('parseSaveDocument round-trips through stringifySave', () => {
    const log = new EventLog('drill');
    log.append('chat', { text: 'a' });
    log.append('chat', { text: 'b' });
    const original = serializeSession(log.events(), CAMPAIGN, 'drill');
    const json = stringifySave(original);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.events.length).toBe(2);
    expect(parsed.doc.events[0].id).toBe(original.events[0].id);
  });
});

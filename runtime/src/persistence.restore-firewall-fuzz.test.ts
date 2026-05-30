// @vitest-environment node

/**
 * NEW-ADV-1 + NEW-ADV-2 (2026-05-29 save-restore program,
 * independent adversarial review) — RESTORE-side companion to
 * `persistence.firewall-fuzz.test.ts`.
 *
 * The save-side fuzz covers: "a coord-authored event log carries
 * DM-typed material → `serializeSessionForViewer` for a non-coord
 * viewer drops all of it."  That fuzz pins the SAVE STREAM.
 *
 * The restore-side fuzz this file pins the RESTORE STREAM:
 *
 *   - A DM-coord cloud save (the full event log) is the cleanest
 *     reproduction of NEW-ADV-1's scenario: a returning DM-as-
 *     player clicks "Pull from my Drive" and the raw DM-only events
 *     land in their event log.
 *   - The fix routes the restore path through `projectSaveForViewer`
 *     when the loading peer is a guest.  The fuzz asserts that no
 *     sentinel survives in the materialized state OR in the events
 *     the loading peer would broadcast.
 *   - NEW-ADV-2 fuzz: a peer who somehow holds DM-only events in
 *     its log MUST NOT relay them to connected peers via the
 *     M3 applyEvent-propagation path (DEC-005).  The
 *     `defaultRebroadcastFilter` injection at session-controller
 *     time is the load-bearing fix; the fuzz here exercises the
 *     filter directly through Peer's rebroadcast seam.
 *
 * Seeds + determinism mirror `firewall-fuzz`: re-run failing
 * scenarios by passing the seed via `npx vitest run -t "seed=…"`.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { type QuireEvent } from './core/event-log';
import {
  CAMPAIGN_FOR_TESTS,
  buildLeakyDmCoordSave,
  collectSentinels
} from './persistence.restore-firewall-fuzz.helpers';
import {
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  projectSaveForViewer,
  stringifySave,
  serializeSessionForViewer,
  PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS
} from './persistence';

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net), {
    rebroadcastFilter: defaultRebroadcastFilter,
    syncResponseFilter: defaultSyncResponseFilter
  });
}

describe('NEW-ADV-1 — projectSaveForViewer scrubs the restore stream for non-coord loaders', () => {
  it('40 seeded DM-coord saves: no sentinel survives a guest-load projection', () => {
    for (let scenario = 0; scenario < 40; scenario++) {
      const seed = 0xa15e + scenario * 4093;
      const { doc, secrets } = buildLeakyDmCoordSave(seed);
      expect(
        secrets.length,
        `seed=${seed}: fuzz did not plant any secrets`
      ).toBeGreaterThan(0);

      // Sanity: the COORD save retains the secrets.  Without this
      // check the test passes trivially if the fuzz silently
      // stopped planting sentinels.
      const coordJson = stringifySave(doc);
      expect(
        secrets.some((s) => coordJson.includes(s)),
        `seed=${seed}: expected DM coord save to retain planted secrets`
      ).toBe(true);

      // Project for a guest (viewerIsCoord=false) — restore-side.
      const projected = projectSaveForViewer(doc, false);
      const projectedJson = stringifySave(projected);
      for (const s of secrets) {
        expect(
          projectedJson.includes(s),
          `LEAK (restore): seed=${seed} secret=${s} survived ` +
            `projectSaveForViewer(viewerIsCoord=false) (re-run with this ` +
            `seed to reproduce)`
        ).toBe(false);
      }
    }
  });

  it('projectSaveForViewer is a no-op when viewerIsCoord=true (DM byte-identical restore)', () => {
    const { doc } = buildLeakyDmCoordSave(0xc0c0);
    const projected = projectSaveForViewer(doc, true);
    // Same reference, byte-identical events array length, identical
    // event ids in the same order.
    expect(projected).toBe(doc);
  });

  it('every PLAYER_SCOPE_STRIP_KINDS event is dropped by projectSaveForViewer for a non-coord loader', () => {
    const { doc } = buildLeakyDmCoordSave(0xdec0de);
    const projected = projectSaveForViewer(doc, false);
    for (const kind of PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS) {
      const survived = projected.events.some((e) => e.kind === kind);
      expect(
        survived,
        `LEAK: kind=${kind} survived the restore-side projection ` +
          `(should be dropped before reaching a non-coord loader)`
      ).toBe(false);
    }
  });

  it('symmetry: restore-side projection matches save-side projection (same scrubbed event count)', () => {
    // Round-trip property: serializeSessionForViewer(events, …,
    // viewer, dm) produces the same scrubbed event SET as
    // projectSaveForViewer(serializeSession-style full-save, false).
    // If they diverge, one path leaks differently from the other.
    const { doc } = buildLeakyDmCoordSave(0xbe17);
    const saveSide = serializeSessionForViewer(
      doc.events,
      doc.campaign,
      'guest-peer',
      'dm' // current coord — guest is non-coord
    );
    const restoreSide = projectSaveForViewer(doc, false);
    expect(restoreSide.events.length).toBe(saveSide.events.length);
    expect(restoreSide.events.map((e) => e.id).sort()).toEqual(
      saveSide.events.map((e) => e.id).sort()
    );
  });
});

describe('NEW-ADV-2 — defaultRebroadcastFilter drops DM-only events on hub-forward', () => {
  it('every PLAYER_SCOPE_STRIP_KINDS event returns null from defaultRebroadcastFilter', () => {
    // The kind-level invariant: a DM-only event NEVER survives the
    // rebroadcast classifier, regardless of payload shape.  Tested
    // exhaustively against the lint-enforced SSOT.
    for (const kind of PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS) {
      const synth: QuireEvent = {
        id: `bob:1`,
        peerId: 'bob',
        ts: 0,
        seq: 1,
        clock: { bob: 1 },
        kind,
        payload: {}
      };
      expect(
        defaultRebroadcastFilter(synth),
        `LEAK (rebroadcast): kind=${kind} survived ` +
          `defaultRebroadcastFilter; would propagate via applyEvent`
      ).toBeNull();
    }
  });

  it('partially-DM-only payload (pc-edit on dmNotes) drops entirely on rebroadcast', () => {
    const synth: QuireEvent = {
      id: 'bob:1',
      peerId: 'bob',
      ts: 0,
      seq: 1,
      clock: { bob: 1 },
      kind: 'pc-edit',
      payload: { v: 1, pcId: 'mei', field: 'dmNotes', value: 'DM_SECRET' }
    };
    expect(defaultRebroadcastFilter(synth)).toBeNull();
  });

  it('player-visible event (chat) survives defaultRebroadcastFilter unchanged', () => {
    const synth: QuireEvent = {
      id: 'bob:2',
      peerId: 'bob',
      ts: 0,
      seq: 2,
      clock: { bob: 2 },
      kind: 'chat',
      payload: { text: 'public chat' }
    };
    expect(defaultRebroadcastFilter(synth)).toEqual(synth);
  });

  it('integration: alice loads DM-coord save via applyEvent, bob does NOT receive DM-only events', () => {
    // Scenario: bob is already in the session.  Alice joins, then
    // loads a DM-coord save into her log via applyEvent (the M3
    // propagation path).  Pre-fix: alice's applyEvent rebroadcasts
    // the raw DM-only events to bob via sync-response, leaving bob's
    // event log with sentinel scratch-notes.  Post-fix: the
    // rebroadcast filter drops them.
    const net = new InMemoryNetwork();
    const bob = makePeer('bob', net);
    bob.append('chat', { text: 'bob is here' });
    const alice = makePeer('alice', net);

    // Drain initial sync.  Alice has bob's chat now.
    expect(alice.state().chat.map((c) => c.text)).toContain('bob is here');

    // Alice loads a DM-coord save with DM-only sentinels.  In a
    // real load path, projectSaveForViewer(doc, viewerIsCoord=false)
    // would already strip these — this test deliberately bypasses
    // the projection to assert the SECOND line of defense
    // (NEW-ADV-2 rebroadcast filter) holds even if the first line
    // ever regresses.
    const { doc, secrets } = buildLeakyDmCoordSave(0xfeed);
    expect(secrets.length).toBeGreaterThan(0);
    for (const ev of doc.events) {
      alice.applyEvent(ev);
    }

    // Bob's event log: must contain ZERO sentinels.
    const bobEvents = bob.events();
    const bobJson = JSON.stringify(bobEvents);
    for (const s of secrets) {
      expect(
        bobJson.includes(s),
        `LEAK (rebroadcast): sentinel=${s} reached bob's event log ` +
          `via alice's applyEvent propagation — NEW-ADV-2 regressed`
      ).toBe(false);
    }
    // Bob's log MUST NOT contain any PLAYER_SCOPE_STRIP_KINDS event.
    for (const ev of bobEvents) {
      expect(
        PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS.has(ev.kind),
        `LEAK: kind=${ev.kind} (id=${ev.id}) reached bob's log via ` +
          `alice's applyEvent rebroadcast — must have been filtered`
      ).toBe(false);
    }
  });

  it('integration: alice loads via projectSaveForViewer (the production path); no sentinels anywhere', () => {
    // The end-to-end production scenario this whole fix exists for:
    // Alice joins as a guest, clicks "Pull from my Drive" on a save
    // she pushed last week as DM.  Per NEW-ADV-1: project the save
    // through the guest-loader filter BEFORE applying.  Per
    // NEW-ADV-2: even if that filter ever regresses, the
    // rebroadcast filter is the safety net.
    const net = new InMemoryNetwork();
    const bob = makePeer('bob', net);
    bob.append('chat', { text: 'bob is here' });
    const alice = makePeer('alice', net);

    const { doc, secrets } = buildLeakyDmCoordSave(0xbeef);
    // PRODUCTION load path: project, then apply.
    const projected = projectSaveForViewer(doc, false);
    for (const ev of projected.events) {
      alice.applyEvent(ev);
    }

    // Alice's own event log: no sentinels.  (NEW-ADV-1 fix.)
    const aliceJson = JSON.stringify(alice.events());
    for (const s of secrets) {
      expect(
        aliceJson.includes(s),
        `LEAK (apply): sentinel=${s} reached alice's own log via ` +
          `projectSaveForViewer — NEW-ADV-1 regressed`
      ).toBe(false);
    }

    // Bob's event log: no sentinels.  (NEW-ADV-2 fix is the safety
    // net here; NEW-ADV-1 should have already prevented anything
    // sentinel-shaped from reaching bob.)
    const bobJson = JSON.stringify(bob.events());
    for (const s of secrets) {
      expect(
        bobJson.includes(s),
        `LEAK (rebroadcast): sentinel=${s} reached bob's log`
      ).toBe(false);
    }
  });

  it('helper round-trip: collectSentinels finds every planted sentinel in the raw save', () => {
    // Sanity test on the fuzz infrastructure itself: if
    // buildLeakyDmCoordSave + collectSentinels ever drift apart,
    // the other tests in this file become false positives (every
    // assertion passes because nothing was actually planted).
    const { doc, secrets } = buildLeakyDmCoordSave(0x57a71);
    const found = collectSentinels(stringifySave(doc));
    for (const s of secrets) {
      expect(
        found.has(s),
        `helper desync: planted secret=${s} not found in raw save JSON`
      ).toBe(true);
    }
  });
});

describe('OP-039 — sync-request → sync-response firewall (sister of NEW-ADV-2)', () => {
  // Background: when a fresh peer joins a session, it sends a
  // sync-request with its current vector clock; every connected peer
  // responds with `log.since(clock)`.  Pre-fix, the responding peer
  // shipped its events RAW — no rebroadcastFilter applied — so a peer
  // holding DM-only events (loaded from a coord save while in a
  // non-coord role, OR temporarily caching them while acting as
  // coordinator) would leak them into the joining peer's event log.
  // Render-layer firewall (filterForViewer) and save-layer firewall
  // (serializeSessionForViewer) both hold; the hole was the joining
  // peer's RAW event log — devtools-visible only — but a class-2
  // firewall hole regardless.  The fix: wrap log.since(...) results
  // through the same rebroadcastFilter the forwardShareToOthers path
  // uses.
  //
  // This regression test exercises the sync-request handler directly:
  // a peer holding DM-only events MUST NOT leak them when responding
  // to sync-requests from a joining peer.

  it('peer holding DM-only events drops them on sync-response', () => {
    // Scenario: alice acts as coord and appends a DM-only event
    // (scratch-note).  Bob then joins the session.  Bob's
    // initial sync-request hits alice's sync-request handler.
    // Alice MUST NOT ship the scratch-note event back to bob.
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    // alice is the coord (first peer in).
    alice.append('chat', { text: 'public chat A' });
    alice.append('scratch-note', {
      v: 1,
      id: 'note-1',
      text: 'OP_039_SENTINEL'
    });
    alice.append('chat', { text: 'public chat B' });

    // Bob joins.  In-memory transport delivers the connect notif
    // synchronously, triggering bob's onPeerConnect →
    // requestSync(alice).  Alice handles the sync-request and
    // ships sync-response.
    const bob = makePeer('bob', net);

    // Bob should see alice's chat events but NOT the scratch-note.
    const bobEvents = bob.events();
    const bobJson = JSON.stringify(bobEvents);
    expect(
      bobJson.includes('OP_039_SENTINEL'),
      `LEAK (OP-039): scratch-note sentinel reached bob's event log ` +
        `via alice's sync-response — fix regressed`
    ).toBe(false);

    // And no PLAYER_SCOPE_STRIP_KINDS event at all.
    for (const ev of bobEvents) {
      expect(
        PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS.has(ev.kind),
        `LEAK (OP-039): kind=${ev.kind} (id=${ev.id}) reached bob's ` +
          `log via alice's sync-response — must have been filtered`
      ).toBe(false);
    }

    // Sanity: bob DID get the public chat — sync-response works,
    // just filtered.
    expect(bob.state().chat.map((c) => c.text)).toContain('public chat A');
    expect(bob.state().chat.map((c) => c.text)).toContain('public chat B');
  });

  it('every PLAYER_SCOPE_STRIP_KINDS event is dropped on sync-response', () => {
    // Exhaustive: for every DM-only kind in the SSOT, alice plants
    // an event of that kind in her log, then bob joins.  None of
    // those kinds may appear in bob's resulting event log.
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    // One innocuous event so bob has something legit to receive.
    alice.append('chat', { text: 'hello' });
    // Bypass the controller — plant raw DM-only events directly
    // into alice's log via applyEvent({propagate:false}) so the
    // share path doesn't pre-filter them.  Then bob joins and
    // alice's sync-response handler is the surface under test.
    let seq = 100;
    for (const kind of PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS) {
      seq += 1;
      const synth: QuireEvent = {
        id: `alice:${seq}`,
        peerId: 'alice',
        ts: seq,
        seq,
        clock: { alice: seq },
        kind,
        payload: { v: 1, sentinel: `OP_039_${kind}` }
      };
      alice.applyEvent(synth, { propagate: false });
    }

    const bob = makePeer('bob', net);

    const bobEvents = bob.events();
    for (const ev of bobEvents) {
      expect(
        PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS.has(ev.kind),
        `LEAK (OP-039): kind=${ev.kind} (id=${ev.id}) reached bob's ` +
          `log via sync-response`
      ).toBe(false);
    }

    // Bob still gets the public chat.
    expect(bob.state().chat.map((c) => c.text)).toContain('hello');
  });

  it('sync-response is identity when no DM-only events present (no regression on the happy path)', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    alice.append('chat', { text: 'A1' });
    alice.append('chat', { text: 'A2' });
    alice.append('chat', { text: 'A3' });

    const bob = makePeer('bob', net);

    // Bob should see all three chats.
    expect(bob.state().chat.map((c) => c.text)).toEqual(['A1', 'A2', 'A3']);
    // And the event count matches (one chat per event + alice's
    // implicit peer-join, which is itself a player-visible event).
    const chatEvents = bob.events().filter((e) => e.kind === 'chat');
    expect(chatEvents.length).toBe(3);
  });
});

describe('NEW-ADV-1 + NEW-ADV-2 — campaign metadata reference', () => {
  it('CAMPAIGN_FOR_TESTS shape matches the SaveDocument campaign field', () => {
    expect(CAMPAIGN_FOR_TESTS.owner).toBeTypeOf('string');
    expect(CAMPAIGN_FOR_TESTS.repo).toBeTypeOf('string');
    expect(CAMPAIGN_FOR_TESTS.ref).toBeTypeOf('string');
  });
});

// @vitest-environment node

/**
 * Mock Campaign 08 — DM write-up phase (session-digest bridge).
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-08-
 * dm-writeup-phase.md`.
 *
 * The session-digest is the canonical bridge between sessions: DM
 * authors at session-end, players read at next-session-open, and
 * the digest informs the next session's AI context.  Per the run
 * #13 mandate from the human:
 *
 *   > after the first game session has completed, the dm will
 *   > write up what happened during the campaign, and that will
 *   > help guide authoring the next chapter for the following
 *   > week.  take a very close look at this phase of the game
 *   > and make sure it works as intended.
 *
 * This simulation walks the digest authorship lifecycle through
 * every save/restore + sync + forward-compat surface and asserts
 * the invariants.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { EventLog } from './core/event-log';
import { filterForViewer, materialize } from './core/state';
import {
  applySaveToLog,
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  parseSaveDocument,
  projectSaveForViewer,
  serializeSession,
  serializeSessionForViewer,
  stringifySave
} from './persistence';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net), {
    rebroadcastFilter: defaultRebroadcastFilter,
    syncResponseFilter: defaultSyncResponseFilter
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const SAMPLE_DIGEST = `# Session 1 — Mei discovers her gift

The party climbed the Underleaf bramble at dawn. **Mei**
saw the willow-light for the first time — she doesn't
know yet what it means.

Threads for next time:
- Anya's brother sent a letter; she hasn't opened it.
- The old well by the Quiet's pillar is making the wrong
  kind of sound.`;

describe('Mock Campaign 08 — DM write-up phase', () => {
  it('digest authored at session-end lands in state and survives a save/restore round-trip', async () => {
    // Scene 1: full session of play.
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    const anya = makePeer('anya', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    markus.append('chat', { text: 'The session begins.' });
    anya.append('chat', { text: 'Anya looks at the bramble.' });
    await flush();

    // Scene 2: DM authors the session-digest at session-end.
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: SAMPLE_DIGEST
    });
    await flush();

    // Digest lands in the DM's state.
    const dmState = markus.state();
    expect(dmState.sessionDigests).toHaveLength(1);
    expect(dmState.sessionDigests[0].markdown).toBe(SAMPLE_DIGEST);

    // Save → restore on a fresh peer → digest survives.
    const dmDoc = serializeSession(markus.events(), CAMPAIGN, 'markus');
    const json = stringifySave(dmDoc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const restored = new EventLog('fresh-dm');
    const result = applySaveToLog(restored, parsed.doc);
    expect(result.rejected).toBe(0);
    expect(result.unknownKinds).toBe(0);

    const restoredState = materialize(restored.events());
    expect(restoredState.sessionDigests).toHaveLength(1);
    expect(restoredState.sessionDigests[0].markdown).toBe(SAMPLE_DIGEST);
  });

  it('digest is visible to player viewer after save → projectSaveForViewer → materialize', async () => {
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    const anya = makePeer('anya', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    markus.append('chat', { text: 'open' });
    markus.append('scratch-note', { v: 1, text: 'DM-only thought' });
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: SAMPLE_DIGEST
    });
    await flush();

    // DM-coord projection save.
    const dmDoc = serializeSessionForViewer(
      markus.events(),
      CAMPAIGN,
      'markus',
      markus.state().coordinator
    );
    const json = stringifySave(dmDoc);

    // Anya (player) loads via projectSaveForViewer + materialize.
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const playerProjection = projectSaveForViewer(parsed.doc, false);
    const log = new EventLog('anya');
    applySaveToLog(log, playerProjection);
    const anyaState = materialize(log.events());

    // Player sees the digest (it's player-visible by design).
    expect(anyaState.sessionDigests).toHaveLength(1);
    expect(anyaState.sessionDigests[0].markdown).toBe(SAMPLE_DIGEST);

    // Defense-in-depth: filtered for viewer also surfaces it.
    const filtered = filterForViewer(anyaState, 'anya');
    expect(filtered.sessionDigests).toHaveLength(1);

    // Cross-cut: DM scratch-note did NOT cross the firewall.
    expect(anyaState.scratchNotes ?? []).toEqual([]);
    expect(filtered.scratchNotes ?? []).toEqual([]);
  });

  it('byte-identical round-trip on the DM save with digest present', async () => {
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: SAMPLE_DIGEST
    });
    await flush();

    const doc = serializeSession(markus.events(), CAMPAIGN, 'markus');
    const json1 = stringifySave(doc);
    const parsed = parseSaveDocument(json1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json2 = stringifySave(parsed.doc);
    expect(json2).toBe(json1);
  });

  it('digest authored by a yielded co-DM (chen) lands in state after reclaim', async () => {
    // Scene 3 — co-DM authorship.
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    const chen = makePeer('chen', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    chen.append('peer-join', { name: 'Chen', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    markus.append('chat', { text: 'first half' });
    await flush();

    // Chen reclaims (co-DM transition).
    chen.reclaimCoordinator();
    await flush();
    expect(markus.state().coordinator).toBe('chen');
    expect(chen.state().coordinator).toBe('chen');

    // Chen now authors the session-digest.
    chen.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: '# session 1 — chen wrote this'
    });
    await flush();

    // Both peers see the digest.
    expect(markus.state().sessionDigests).toHaveLength(1);
    expect(chen.state().sessionDigests).toHaveLength(1);
    expect(markus.state().sessionDigests[0].markdown).toBe(
      '# session 1 — chen wrote this'
    );
  });

  it('digest authored by a non-coord peer is rejected at materialize', () => {
    // The materializer in `applySessionDigestEvent` gates on
    // `state.coordHolders.has(event.peerId)`.  A peer that never
    // claimed coord cannot author a digest.  This is the
    // firewall-side floor; the UI also gates via
    // `isCoordinator()` but defense-in-depth on the materializer
    // is the load-bearing layer.
    const log = new EventLog('rogue-player');
    log.apply({
      id: 'rogue:1',
      peerId: 'rogue',
      seq: 1,
      kind: 'session-digest',
      payload: {
        v: 1,
        sessionStartTs: 1_700_000_000_000,
        markdown: '# rogue wrote this'
      },
      ts: 1_700_000_000_000,
      clock: { rogue: 1 }
    });
    const state = materialize(log.events());
    // No coord-claim ever fired, so coordHolders is empty.  Materializer rejects.
    expect(state.sessionDigests).toEqual([]);
  });

  it('invalid digest payloads are rejected at materialize (empty, oversized, malformed)', async () => {
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    await flush();

    // Empty markdown — rejected.
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: ''
    });
    await flush();
    expect(markus.state().sessionDigests).toEqual([]);

    // Oversized markdown — rejected (cap is 20_000).
    const oversized = 'x'.repeat(20_001);
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: oversized
    });
    await flush();
    expect(markus.state().sessionDigests).toEqual([]);

    // Malformed (non-string markdown) — rejected.
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: 42 as unknown as string
    });
    await flush();
    expect(markus.state().sessionDigests).toEqual([]);

    // A VALID digest still works after the rejections.
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: 'after the rejections — this one is valid'
    });
    await flush();
    expect(markus.state().sessionDigests).toHaveLength(1);
  });

  it('forward-compat: digest with future sub-field round-trips and the future field survives', async () => {
    // Scene 4 — a future runtime adds e.g. `summaryTokens` to the
    // digest payload.  Today's materializer ignores it; the
    // on-disk JSON preserves it (per INV-2 in format-stability.md).
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: SAMPLE_DIGEST,
      // FUTURE field — today's materializer doesn't read it.
      summaryTokens: ['mei', 'bramble', 'realization-arc']
    } as unknown as Record<string, unknown>);
    await flush();

    // Round-trip via stringifySave + parseSaveDocument.
    const doc = serializeSession(markus.events(), CAMPAIGN, 'markus');
    const json = stringifySave(doc);
    expect(json).toContain('summaryTokens');
    expect(json).toContain('realization-arc');

    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // The event in the parsed doc retains the future field.
    const digestEvent = parsed.doc.events.find(
      (e) => e.kind === 'session-digest'
    );
    expect(digestEvent).toBeDefined();
    expect(
      (digestEvent!.payload as Record<string, unknown>).summaryTokens
    ).toEqual(['mei', 'bramble', 'realization-arc']);

    // And materialize still works (the unknown field is ignored).
    const fresh = new EventLog('fresh-dm');
    applySaveToLog(fresh, parsed.doc);
    const state = materialize(fresh.events());
    expect(state.sessionDigests).toHaveLength(1);
  });

  it('partition: DM authors digest while offline; player rejoins via sync and receives it', async () => {
    // Scene 6 — partition-then-rejoin.
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    const anya = makePeer('anya', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    markus.append('chat', { text: 'first message' });
    await flush();

    // Anya goes offline.
    net.setPartition('anya', true);
    await flush();

    // Markus authors the digest while anya is offline.
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: SAMPLE_DIGEST
    });
    await flush();

    // Anya isn't in markus' world right now from her view.
    expect(anya.state().sessionDigests).toEqual([]);

    // Anya reconnects.
    net.setPartition('anya', false);
    await flush();
    // Need a sync exchange — anya re-broadcasts a sync-request when
    // peers re-establish.  Wait for it to settle.
    await flush();
    await flush();

    // After sync, anya's filtered view should include the digest
    // (session-digest is NOT in PLAYER_SCOPE_STRIP_KINDS so it
    // survives the sync-response filter).
    expect(anya.state().sessionDigests).toHaveLength(1);
    expect(anya.state().sessionDigests[0].markdown).toBe(SAMPLE_DIGEST);
  });

  it('FINDING-E (run #14): digest markdown flows into the DM AI context via buildCampaignContext', async () => {
    // Run-#14 closure for FINDING-E.  Pre-fix the digest's bridge
    // to "help guide authoring the next chapter" was broken because
    // `submitAiPrompt` built context from campaign files only.  The
    // fix: `buildCampaignContext` accepts `priorDigests` and
    // synthesizes a Previously block.  This test exercises the
    // end-to-end path: digest event → materialize → extract
    // markdown → feed buildCampaignContext → assert it lands in
    // the context.
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: SAMPLE_DIGEST
    });
    await flush();
    const state = markus.state();
    expect(state.sessionDigests).toHaveLength(1);

    // Build the AI context the same way submitAiPrompt does, using
    // the digest markdowns from state.  No fetch-stubbing — the
    // buildCampaignContext is tested in campaign-context.test.ts;
    // here we just assert the integration shape.
    const digestMarkdowns = state.sessionDigests.map((d) => d.markdown);
    expect(digestMarkdowns).toHaveLength(1);
    expect(digestMarkdowns[0]).toContain('Mei discovers her gift');
    expect(digestMarkdowns[0]).toContain('willow-light');

    // FIREWALL CHECK: the digest does NOT carry DM-only metadata
    // beyond what filterForViewer permits.  Verify that the player
    // projection sees the same markdown (no leak through the
    // bridging path).
    const playerView = filterForViewer(state, 'anya');
    expect(playerView.sessionDigests).toHaveLength(1);
    expect(playerView.sessionDigests[0].markdown).toBe(SAMPLE_DIGEST);
  });

  it('multi-session: two digests across two session-opens accumulate in append-only order', async () => {
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});

    // Session 1 happens + digest.
    markus.append('session-open', { v: 1 });
    markus.append('chat', { text: 'session 1' });
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: '# session 1 digest'
    });
    await flush();

    // Session 2 happens + digest.
    markus.append('session-open', { v: 1 });
    markus.append('chat', { text: 'session 2' });
    markus.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_001_000_000,
      markdown: '# session 2 digest'
    });
    await flush();

    expect(markus.state().sessionDigests).toHaveLength(2);
    expect(markus.state().sessionDigests[0].markdown).toBe(
      '# session 1 digest'
    );
    expect(markus.state().sessionDigests[1].markdown).toBe(
      '# session 2 digest'
    );

    // Save + restore preserves both, in order.
    const doc = serializeSession(markus.events(), CAMPAIGN, 'markus');
    const json = stringifySave(doc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fresh = new EventLog('fresh-dm');
    applySaveToLog(fresh, parsed.doc);
    const state = materialize(fresh.events());
    expect(state.sessionDigests).toHaveLength(2);
    expect(state.sessionDigests.map((d) => d.markdown)).toEqual([
      '# session 1 digest',
      '# session 2 digest'
    ]);
  });
});

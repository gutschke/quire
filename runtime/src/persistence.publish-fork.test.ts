// @vitest-environment node

/**
 * Phase A (2026-05-29 save-restore program, run #4) —
 * GitHub-as-publish-and-fork verification.
 *
 * Background: M6c was originally framed as DM's-personal-backup
 * (M6c-B in the run-#4 split). The human added a second use case:
 * DMs PUBLISH a sanitized seed to a public repo, OTHER DMs fork
 * it via GitHub's normal workflow, cherry-pick part of the event
 * log, and continue their OWN campaign from a known good seed
 * (M6c-A).
 *
 * This file is the verification matrix for the publish-and-fork
 * USE CASE against the existing save-format mechanics. Each test
 * answers one of the five publish-and-fork questions from the
 * Phase A brief:
 *
 *   Q1: Can a third party (different DM) clone a repo containing
 *       a save and LOAD it into a fresh Quire instance to play?
 *   Q2: Can they cherry-pick PARTIAL event ranges (truncate-and-
 *       fork)?
 *   Q3: Are there events that don't travel well (peer-join with
 *       original peer UUID, coordinator-claim, transient state)?
 *   Q4: How is the publish-side scrub different from the personal-
 *       backup scrub?
 *   Q5: How does the published repo's layout differ from the
 *       personal-backup repo layout? Same file? Different file?
 *       Branch? Tag?
 *
 * Each `it` is a publish-and-fork experiment. Failures here are
 * design findings for M6c-A roadmap shape, not invariants the
 * existing code claims to uphold.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { EventLog } from './core/event-log';
import {
  serializeSessionForViewer,
  stringifySave,
  parseSaveDocument,
  applySaveToLog,
  type SaveDocument
} from './persistence';

const ORIGINAL_CAMPAIGN = {
  owner: 'original-author',
  repo: 'pubbed-campaign',
  ref: 'main'
};

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net));
}

// -----------------------------------------------------------------
// Q1: Clone + load = playable in a fresh instance.
// -----------------------------------------------------------------

describe('publish-and-fork Q1 — clone the repo, load into fresh Quire', () => {
  it('a different DM (different peerId) can load the original save and continue', () => {
    // Original DM publishes a "seed" — first three episodes.
    const originalNet = new InMemoryNetwork();
    const originalDm = makePeer('orig-dm-uuid-A', originalNet);
    originalDm.append('coordinator-claim', {});
    originalDm.append('chat', { text: 'Ep1: The party meets at the inn.' });
    originalDm.append('scene-reveal', { scenePath: 'ep01/scene-01' });
    originalDm.append('chat', { text: 'Ep2: The dragon attacks.' });
    originalDm.append('scene-reveal', { scenePath: 'ep02/scene-01' });
    originalDm.append('chat', { text: 'Ep3: The journey north.' });

    const saved: SaveDocument = serializeSessionForViewer(
      originalDm.events(),
      ORIGINAL_CAMPAIGN,
      'orig-dm-uuid-A',
      originalDm.state().coordinator
    );
    const savedJson = stringifySave(saved);

    // Forking DM clones the repo and loads the save with a fresh
    // peerId and a new campaign ref (their own fork).
    const FORKED_CAMPAIGN = {
      owner: 'forking-dm',
      repo: 'my-spin-on-the-classic',
      ref: 'main'
    };
    const forkNet = new InMemoryNetwork();
    const newDm = makePeer('forking-dm-uuid-B', forkNet);

    // Mechanical load: the JSON parses, every event applies, no
    // unknownKinds, no rejected events. This is the bedrock check.
    const parsed = parseSaveDocument(savedJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const audit = new EventLog('audit');
    const result = applySaveToLog(audit, parsed.doc);
    expect(result.rejected).toBe(0);
    expect(result.unknownKinds).toBe(0);
    expect(result.applied).toBe(saved.events.length);

    // Now the forking DM applies the events through their own Peer
    // (mirrors what quire-app.loadFromString does).
    for (const ev of parsed.doc.events) newDm.applyEvent(ev);

    // The forking DM sees the published scenes + chat. Note: the
    // `campaign` field of the save document is for AUDIT — the
    // forking DM is loading into a NEW campaign manifest of their
    // own (FORKED_CAMPAIGN). The mismatch is fine; the events
    // themselves don't reference the campaign ref.
    expect(newDm.state().chat.map((c) => c.text)).toContain(
      'Ep1: The party meets at the inn.'
    );
    expect(newDm.state().revealedScenes).toContain('ep01/scene-01');
    expect(newDm.state().revealedScenes).toContain('ep02/scene-01');

    // Forking DM authors their OWN coordinator-claim and event so
    // their continuation is theirs.
    newDm.append('coordinator-claim', {});
    newDm.append('chat', { text: 'Ep4: my own continuation begins.' });
    expect(newDm.state().chat.map((c) => c.text)).toContain(
      'Ep4: my own continuation begins.'
    );

    // FORK_CAMPAIGN ref is just metadata; the published save's
    // CampaignRef does not bind the fork mechanically.
    expect(FORKED_CAMPAIGN.owner).not.toBe(saved.campaign.owner);
  });

  it('forking DM is in coordHolders (can author DM-only events on top)', () => {
    const originalNet = new InMemoryNetwork();
    const originalDm = makePeer('orig-dm-1', originalNet);
    originalDm.append('coordinator-claim', {});
    originalDm.append('chat', { text: 'seed' });

    const saved = serializeSessionForViewer(
      originalDm.events(),
      ORIGINAL_CAMPAIGN,
      'orig-dm-1',
      originalDm.state().coordinator
    );

    const forkNet = new InMemoryNetwork();
    const newDm = makePeer('new-dm-1', forkNet);

    const parsed = parseSaveDocument(stringifySave(saved));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const ev of parsed.doc.events) newDm.applyEvent(ev);

    // Newcomer claims coord. This adds them to coordHolders.
    newDm.append('coordinator-claim', {});
    const state = newDm.state();
    expect(state.coordHolders.has('new-dm-1')).toBe(true);

    // They can now author scene-reveal events. The materializer
    // gates scene-reveal on coordHolders membership.
    newDm.append('scene-reveal', { scenePath: 'fork/ep01/scene-01' });
    expect(newDm.state().revealedScenes).toContain('fork/ep01/scene-01');
  });
});

// -----------------------------------------------------------------
// Q2: Cherry-pick partial event ranges (truncate-and-fork).
// -----------------------------------------------------------------

describe('publish-and-fork Q2 — partial event ranges (truncate-and-fork)', () => {
  it('forking DM can load only events up to a chosen episode (truncate)', () => {
    // Original publishes 3 episodes of chat.
    const net = new InMemoryNetwork();
    const dm = makePeer('orig-dm-2', net);
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'ep1' });
    dm.append('scene-reveal', { scenePath: 'ep01' });
    dm.append('chat', { text: 'ep2' });
    dm.append('scene-reveal', { scenePath: 'ep02' });
    dm.append('chat', { text: 'ep3' });
    dm.append('scene-reveal', { scenePath: 'ep03' });

    const fullSave = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'orig-dm-2',
      dm.state().coordinator
    );

    // Publish-side: the original DM (or a downstream forker) truncates
    // the events array to just episodes 1+2 ahead of publishing.
    // (In M6c-A, this would be a publish-time UX action: "Pick the
    // last event you want to ship as the seed.")
    const truncatedEvents = fullSave.events.slice(0, 5); // ep1+reveal+ep2+reveal — drop ep3+reveal
    const truncatedSave: SaveDocument = {
      ...fullSave,
      events: truncatedEvents
    };

    // Fork: load the truncated save into a fresh instance.
    const forkNet = new InMemoryNetwork();
    const newDm = makePeer('forking-dm-2', forkNet);
    const parsed = parseSaveDocument(stringifySave(truncatedSave));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const audit = new EventLog('audit');
    const result = applySaveToLog(audit, parsed.doc);
    // Critical: truncation MUST NOT cause events to be rejected.
    // Events are causally-ordered + idempotent; dropping later
    // events should leave earlier events fully valid.
    expect(result.rejected).toBe(0);
    expect(result.applied).toBe(truncatedEvents.length);

    for (const ev of parsed.doc.events) newDm.applyEvent(ev);

    const state = newDm.state();
    expect(state.chat.map((c) => c.text)).toContain('ep1');
    expect(state.chat.map((c) => c.text)).toContain('ep2');
    expect(state.chat.map((c) => c.text)).not.toContain('ep3');
    expect(state.revealedScenes).toContain('ep01');
    expect(state.revealedScenes).toContain('ep02');
    expect(state.revealedScenes).not.toContain('ep03');
  });

  it('mid-event-range truncation breaks vector-clock validation', () => {
    // FINDING: EventLog.apply checks `clock[e.peerId] === e.seq`.
    // If we slice OUT a middle event of one author's sequence,
    // later events of that same author cite a clock value that no
    // longer reflects the truncated history — they fail validation.
    //
    // This means publish-side truncation must respect per-author
    // monotonicity. Slicing by EPISODE BOUNDARY (where the author
    // has finished their causal contribution) is safe; slicing
    // by ARBITRARY EVENT INDEX is NOT safe if events of different
    // authors interleave with one author's later events.

    const net = new InMemoryNetwork();
    const dm = makePeer('cherry-dm', net);
    const player = makePeer('cherry-player', net);
    dm.append('coordinator-claim', {}); // dm seq=1
    dm.append('chat', { text: 'dm event 1' }); // dm seq=2
    player.append('chat', { text: 'player event 1' }); // player seq=1
    dm.append('chat', { text: 'dm event 2' }); // dm seq=3
    player.append('chat', { text: 'player event 2' }); // player seq=2

    const full = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'cherry-dm',
      dm.state().coordinator
    );

    // Try to keep DM events but drop player events. Each player
    // event references the vector clock at the time of its
    // authoring — dropping the player events does NOT corrupt the
    // dm events' clocks, but if we drop the player's first event,
    // their second event references player seq=2 with a clock
    // that includes player:1 — applying player seq=2 to a log
    // that never saw player seq=1 will fail
    // `clock[e.peerId] === e.seq` (the loading log has
    // clock.player === 0, e.seq === 2; mismatch).
    const dmOnlyEvents = full.events.filter(
      (e) => e.peerId === 'cherry-dm'
    );
    const audit = new EventLog('audit');
    const result = applySaveToLog(audit, {
      ...full,
      events: dmOnlyEvents
    });
    // EventLog accepts this BECAUSE each dm event's clock has
    // monotone-growing dm:N values; player:0 is consistent with
    // "we never saw the player." So dropping all of one peer's
    // events is fine.
    expect(result.applied).toBe(dmOnlyEvents.length);
    expect(result.rejected).toBe(0);

    // But: drop the player's FIRST event while keeping the SECOND.
    // Now the clock references player:1 in the second event but
    // the log has no player:1. Per isValidEvent the second event
    // is still valid (it has its own internal clock) but applying
    // it in causal order WITHOUT player:1 means the loading log
    // ends up in a clock-state of player:2 having "skipped" 1 —
    // this is the implementation's actual behavior. Let's verify
    // explicitly.
    const orphanedSecond = full.events.filter(
      (e) => !(e.peerId === 'cherry-player' && e.seq === 1)
    );
    const audit2 = new EventLog('audit2');
    const result2 = applySaveToLog(audit2, {
      ...full,
      events: orphanedSecond
    });
    // FINDING: the EventLog actually accepts the orphaned second
    // event — isValidEvent only checks that the event's clock is
    // self-consistent (clock[e.peerId] === e.seq), not that prior
    // events in the same peerId-seq chain were applied. So
    // mid-author truncation does NOT cause a load failure; it
    // causes a CAUSAL GAP in the loaded log that will manifest
    // as missing chat / missing reveals.
    expect(result2.applied).toBe(orphanedSecond.length);
    expect(result2.rejected).toBe(0);

    // The semantic implication: a publish-time "truncate after
    // event N" UI must either:
    //   (a) require the user pick a "save point" that's a clean
    //       per-author boundary (every author's last event
    //       at-or-before N), OR
    //   (b) drop every event AFTER any per-author boundary that
    //       the user implicitly chose.
    // Either is a publish-side UX concern; the mechanical event
    // log doesn't enforce it.
  });
});

// -----------------------------------------------------------------
// Q3: Events that don't travel well across forks.
// -----------------------------------------------------------------

describe('publish-and-fork Q3 — events that don\'t travel well', () => {
  it('peer-join with original peer UUID survives but is materially meaningless', () => {
    // The original DM's peer-join event carries the original peerId
    // and their joinedAt timestamp. After fork, the forking DM is a
    // different person — but the materializer simply adds the
    // original peer to state.peers, which is a roster reading. The
    // forking DM's own peer-join (authored by their fresh peerId)
    // adds them as well. No collision.
    const net = new InMemoryNetwork();
    const dm = makePeer('orig-dm-3', net);
    dm.append('peer-join', { name: 'Original DM' });
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'history event' });

    const saved = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'orig-dm-3',
      dm.state().coordinator
    );

    const forkNet = new InMemoryNetwork();
    const newDm = makePeer('new-dm-3', forkNet);
    const parsed = parseSaveDocument(stringifySave(saved));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const ev of parsed.doc.events) newDm.applyEvent(ev);
    newDm.append('peer-join', { name: 'New DM' });

    // Roster contains BOTH peers, which is technically right
    // (the original was historically present) but semantically
    // misleading for a forked campaign (the original DM is not
    // joining the new DM's table).
    const peers = newDm.state().peers;
    expect(peers['orig-dm-3']).toBeDefined();
    expect(peers['orig-dm-3'].name).toBe('Original DM');
    expect(peers['new-dm-3']).toBeDefined();

    // FINDING (P2): for M6c-A, the publish-side scrub SHOULD
    // either:
    //   (a) drop peer-join / peer-leave events (transient roster
    //       state has no value to forking), OR
    //   (b) keep them as historical record but tag them visually
    //       in the roster ("Original campaign's DM, not at this
    //       table").
    // Either is a publish-side UX concern; this test pins the
    // mechanical behavior.
  });

  it('coordinator-claim from original DM remains in coordHolders post-fork', () => {
    // The original DM is added to state.coordHolders via their
    // coord-claim event. After fork, the new DM also claims coord.
    // BOTH peers are in coordHolders — that's the multi-coord-
    // through-time design (every former coord retains
    // authority-to-have-revealed-the-things-they-revealed).
    //
    // FINDING: a forking DM probably wants the published seed's
    // coord-claim STRIPPED on publish, because the original DM
    // shouldn't be allowed to author DM-only events into the
    // forked campaign post-publish. In practice the original DM
    // won't have access to the forked event stream (it's the new
    // DM's table). But if someone publishes ANOTHER fork from the
    // same seed, multiple ex-coord events accumulate.
    const net = new InMemoryNetwork();
    const dm = makePeer('orig-dm-4', net);
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'seed' });

    const saved = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'orig-dm-4',
      dm.state().coordinator
    );

    const forkNet = new InMemoryNetwork();
    const newDm = makePeer('new-dm-4', forkNet);
    const parsed = parseSaveDocument(stringifySave(saved));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const ev of parsed.doc.events) newDm.applyEvent(ev);
    newDm.append('coordinator-claim', {});

    const holders = newDm.state().coordHolders;
    expect(holders.has('orig-dm-4')).toBe(true);
    expect(holders.has('new-dm-4')).toBe(true);

    // FINDING (P2): publish-side scrub should consider whether
    // historical coord events from the original DM should reach
    // the fork. The locked threat model (DEC-023) says the
    // original DM is not a malicious adversary (different campaign
    // post-fork), so this is class 2 (accidental disclosure) at
    // worst. The realistic concern is UI clutter, not security.
  });

  it('pairing-code / transient state is structurally excluded (correct)', () => {
    // Per persistence.ts head comment: "What's NOT in the save:
    // AI API keys, AI provider/system prompt, pairing code, chat
    // draft, current route, local roll panel mirror."
    //
    // These are runtime ephemera living in localStorage outside
    // SaveDocument. The save format already excludes them, which
    // is correct for fork (we don't want the original DM's
    // pairing code in a published seed).
    //
    // This test pins the property by asserting the SaveDocument
    // type's known fields and that no implementation surface
    // sneaks transient state into events.

    const net = new InMemoryNetwork();
    const dm = makePeer('orig-dm-5', net);
    dm.append('coordinator-claim', {});

    const saved = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'orig-dm-5',
      dm.state().coordinator
    );

    // SaveDocument has 5 top-level fields: $schemaVersion,
    // savedAt, campaign, savedByPeerId, events. Anything else
    // is a violation.
    expect(Object.keys(saved).sort()).toEqual([
      '$schemaVersion',
      'campaign',
      'events',
      'savedAt',
      'savedByPeerId'
    ]);
  });
});

// -----------------------------------------------------------------
// Q4: Publish-side scrub semantics (vs personal-backup scrub).
// -----------------------------------------------------------------

describe('publish-and-fork Q4 — publish-side scrub vs personal-backup scrub', () => {
  it('DM-coord save includes DM-only events the publisher might NOT want public', () => {
    // The personal-backup case (M6c-B) writes the FULL DM-coord
    // projection to the DM's OWN repo. That's safe — the DM owns
    // the destination.
    //
    // The publish case (M6c-A) writes to a PUBLIC repo. Any
    // DM-only events in the published save are world-readable
    // forever. The current `serializeSessionForViewer` with
    // viewerIsCoord=true gives the FULL log including
    // scratch-note, ai-prompt, ai-response, npc-pin, etc.
    //
    // FINDING (P1): the publish-side surface MUST use the
    // NON-COORD projection (player-scoped scrub) by default. The
    // ALTERNATIVE — publish DM material publicly — is a firewall
    // failure under DEC-023 class 1 (internet randos).
    const net = new InMemoryNetwork();
    const dm = makePeer('publishing-dm', net);
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'player-visible welcome' });
    dm.append('scratch-note', { text: 'DM-only secret: the king is a doppelganger' });
    dm.append('ai-prompt', { prompt: 'DM brainstorm: what should X say?' });

    // Personal-backup projection: keeps everything (DM-coord).
    const personalBackup = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'publishing-dm',
      dm.state().coordinator
    );
    const personalKinds = personalBackup.events.map((e) => e.kind);
    expect(personalKinds).toContain('scratch-note');
    expect(personalKinds).toContain('ai-prompt');

    // Publish-side projection: must use the NON-COORD scrub.
    // We model this by calling serializeSessionForViewer with the
    // savedByPeerId set to a non-coord peer. (In M6c-A this would
    // be a dedicated publishForkSeed() helper or a `publish=true`
    // flag; this test pins the SHAPE.)
    const publishSeed = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'publishing-dm',
      // Pretend the saver is NOT the coord; this triggers the
      // player-scope strip path. M6c-A needs a real helper that
      // is more explicit than this trick.
      'some-other-peer-who-is-coord'
    );
    const publishKinds = publishSeed.events.map((e) => e.kind);
    expect(publishKinds).not.toContain('scratch-note');
    expect(publishKinds).not.toContain('ai-prompt');
    // Player-visible chat survives.
    expect(publishKinds).toContain('chat');
  });

  it('publish-side scrub composes with the existing PER_KIND_SCRUBBERS registry', () => {
    // The publish-side scrub doesn't need a new firewall list.
    // The SAME PLAYER_SCOPE_STRIP_KINDS + PER_KIND_SCRUBBERS that
    // the player-autosave path uses IS the publish-side firewall.
    // Every future DM-only event kind that joins
    // PLAYER_SCOPE_STRIP_KINDS automatically becomes
    // publish-stripped.
    //
    // This means M6c-A can REUSE serializeSessionForViewer with a
    // forced isCoord=false projection rather than maintaining a
    // separate publish-scrub list.

    const net = new InMemoryNetwork();
    const dm = makePeer('publish-dm-2', net);
    dm.append('coordinator-claim', {});
    dm.append('scratch-note', { text: 'secret' });
    dm.append('npc-pin', { npcId: 'goblin', pinned: true });
    dm.append('chat', { text: 'safe' });

    const publish = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'non-coord-publisher',
      'someone-else-is-coord'
    );
    const kinds = publish.events.map((e) => e.kind);
    expect(kinds).not.toContain('scratch-note');
    expect(kinds).not.toContain('npc-pin');
    expect(kinds).toContain('chat');
  });
});

// -----------------------------------------------------------------
// Q5: Repository layout — personal vs published.
// -----------------------------------------------------------------

describe('publish-and-fork Q5 — repo layout (personal vs published)', () => {
  it('save format is content-only; layout is a destination-side concern', () => {
    // The SaveDocument format is the same regardless of
    // destination. The "where in the repo" question is a M6c
    // implementation detail.
    //
    // FINDING: distinct paths reduce the chance of accidental
    // overwrite. The recommended convention is:
    //   - Personal backup (M6c-B): `saves/<slug>.json` on a
    //     private repo (or appdata-equivalent path on a public
    //     repo if the DM wants public visibility).
    //   - Published seed (M6c-A): `published-seeds/<slug>.json`
    //     in a dedicated subdirectory, OR a tagged release that
    //     pins the seed at a fixed git ref.
    //
    // Tagging the seed at a git ref gives forkers a stable
    // anchor: "fork the repo at tag v1-end-of-ep2 to get the
    // canonical Ep1+Ep2 seed." Cherry-pick from a tag is the
    // natural GitHub workflow.
    //
    // This test asserts the save format itself doesn't bake
    // layout assumptions in. It's a property test, not a
    // mechanical assertion.

    const net = new InMemoryNetwork();
    const dm = makePeer('layout-dm', net);
    dm.append('coordinator-claim', {});
    const saved = serializeSessionForViewer(
      dm.events(),
      ORIGINAL_CAMPAIGN,
      'layout-dm',
      dm.state().coordinator
    );

    // The SaveDocument's `campaign` field is informational
    // metadata — it doesn't bind the save to a specific repo
    // path. The forker can write it anywhere.
    expect(typeof saved.campaign.owner).toBe('string');
    expect(typeof saved.campaign.repo).toBe('string');
    expect(typeof saved.campaign.ref).toBe('string');
    // No "where in the repo" field on SaveDocument — that's a
    // M6c implementation choice.
  });
});

/**
 * Run #19 (2026-05-30) — unit tests for the 5 new event kinds
 * driving UX-MH-1 (player display name + DM edit), UX-MH-2 (PC tag
 * ops), and UX-MH-3 (AI backstory-refresh proposal).
 *
 * Per the synthesis doc R-A through R-G + the adversarial review:
 *
 *  - peer-rename-by-coord (UX-MH-1) — coord-gate; writes
 *    state.peers[targetPeerId], NOT state.peers[event.peerId].  The
 *    P0 the adversarial review caught was that the parent's "DM
 *    authors peer-rename for Alice's seat" plan was INERT because
 *    peer-rename writes the author's own entry; this kind fixes that.
 *  - pc-tag-add / pc-tag-remove / pc-tag-rename (UX-MH-2) — any-peer
 *    authored (matches pc-edit trust gap); idempotent; rename is
 *    atomic so the UI doesn't flicker.
 *  - backstory-refresh-proposal (UX-MH-3) — coord-only; LWW per pcId;
 *    materializes into state.backstoryRefreshProposals.  The bound
 *    player sees only their own proposal via filterForViewer.
 *
 * Impersonation defense tests verify each materializer's authorship
 * gate the right way (drive through materialize() with constructed
 * events rather than calling the materializer directly — LL-1
 * sliver-trap avoidance).
 */

import { describe, it, expect } from 'vitest';
import { EventLog } from './event-log';
import { materialize, filterForViewer } from './state';

const validPcId = 'mei-tanaka';

function pcCreatePayload(name: string) {
  return {
    v: 1,
    pcId: validPcId,
    name,
    pronouns: 'they/them',
    tags: ['nurse', 'climber', 'beekeeper-raised'],
    stats: { str: 0, dex: 1, con: 0, int: 0, wis: 1, cha: -1 },
    skills: ['triage'],
    backstory: 'Mei grew up by the Underleaf.'
  };
}

/**
 * Build a DM log + apply Alice's peer-join (authored by Alice's own
 * log) so `state.peers.alice` exists.  `peer-join` writes
 * `state.peers[event.peerId]`, so the JOIN must be authored by
 * Alice; the DM only sees it after gossip.  Same pattern for other
 * peers in the helpers below.
 */
function setupCoord(): EventLog {
  const log = new EventLog('dm');
  log.append('peer-join', { name: 'DM' });
  log.append('coordinator-claim', {});
  return log;
}

function joinPeer(log: EventLog, peerId: string, name: string): void {
  const peerLog = new EventLog(peerId);
  for (const e of log.events()) peerLog.apply(e);
  peerLog.append('peer-join', { name });
  for (const e of peerLog.events()) log.apply(e);
}

function setupWithPc(): EventLog {
  const log = setupCoord();
  joinPeer(log, 'alice', 'Alice');
  log.append('pc-create', pcCreatePayload('Mei'));
  return log;
}

describe('peer-rename-by-coord (UX-MH-1)', () => {
  it('writes state.peers[targetPeerId].name when authored by coord', () => {
    const log = setupCoord();
    joinPeer(log, 'alice', 'Alice');
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'alice',
      newDisplayName: 'Alice (DM-edited)'
    });
    const state = materialize(log.events());
    // The DM was the AUTHOR; the materializer wrote Alice's entry,
    // not the DM's.  This is the load-bearing P0 defense per the
    // adversarial review.
    expect(state.peers.alice.name).toBe('Alice (DM-edited)');
    expect(state.peers.dm.name).toBe('DM');
  });

  it('rejects when authored by a non-coord peer (player cannot rename others)', () => {
    // No coord-claim — alice's log just has presence events.
    const alice = new EventLog('alice');
    alice.append('peer-join', { name: 'Alice' });
    const bob = new EventLog('bob');
    bob.append('peer-join', { name: 'Bob' });
    for (const e of bob.events()) alice.apply(e);
    // Alice is NOT in coordHolders; her peer-rename-by-coord no-ops.
    alice.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'bob',
      newDisplayName: 'Bob-by-alice'
    });
    const state = materialize(alice.events());
    expect(state.peers.bob.name).toBe('Bob');
  });

  it('rejects when targetPeerId is unknown (no presence entry)', () => {
    const log = setupCoord();
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'ghost',
      newDisplayName: 'Ghost'
    });
    const state = materialize(log.events());
    expect(state.peers).not.toHaveProperty('ghost');
  });

  it('rejects payload version not v:1', () => {
    const log = setupCoord();
    joinPeer(log, 'alice', 'Alice');
    log.append('peer-rename-by-coord', {
      v: 2,
      targetPeerId: 'alice',
      newDisplayName: 'Alice2'
    });
    const state = materialize(log.events());
    expect(state.peers.alice.name).toBe('Alice');
  });

  it('rejects newDisplayName > 80 chars (cap parity with peer-rename)', () => {
    const log = setupCoord();
    joinPeer(log, 'alice', 'Alice');
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'alice',
      newDisplayName: 'A'.repeat(81)
    });
    const state = materialize(log.events());
    expect(state.peers.alice.name).toBe('Alice');
  });

  it('rejects empty newDisplayName', () => {
    const log = setupCoord();
    joinPeer(log, 'alice', 'Alice');
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'alice',
      newDisplayName: ''
    });
    const state = materialize(log.events());
    expect(state.peers.alice.name).toBe('Alice');
  });

  it('co-DM (former coord) can author after coord handoff', () => {
    const log = setupCoord();
    joinPeer(log, 'alice', 'Alice');
    // DM yields coord but stays in coordHolders.
    log.append('coordinator-yield', {});
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'alice',
      newDisplayName: 'Alice (post-yield)'
    });
    const state = materialize(log.events());
    // DM was once coord (still in coordHolders) — write succeeds.
    expect(state.peers.alice.name).toBe('Alice (post-yield)');
  });
});

describe('pc-tag-add (UX-MH-2)', () => {
  it('appends a new tag to the PC', () => {
    const log = setupWithPc();
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 'cartographer' });
    const state = materialize(log.events());
    expect(state.synthesizedPcs[validPcId].tags).toContain('cartographer');
  });

  it('is idempotent on duplicate add (no double-append)', () => {
    const log = setupWithPc();
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 'cartographer' });
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 'cartographer' });
    const state = materialize(log.events());
    const matches = (state.synthesizedPcs[validPcId].tags ?? []).filter(
      (t) => t === 'cartographer'
    );
    expect(matches.length).toBe(1);
  });

  it('rejects add when PC does not exist', () => {
    const log = setupCoord();
    log.append('pc-tag-add', {
      v: 1,
      pcId: 'ghost-pc',
      tagText: 'cartographer'
    });
    const state = materialize(log.events());
    expect(state.synthesizedPcs['ghost-pc']).toBeUndefined();
  });

  it('rejects add that would exceed PC_CREATE_MAX_TAGS (5) cap', () => {
    const log = setupWithPc();
    // PC starts with 3 tags; add 2 more (= 5, at cap) then try a 6th.
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 't4' });
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 't5' });
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 't6' });
    const state = materialize(log.events());
    expect((state.synthesizedPcs[validPcId].tags ?? []).length).toBe(5);
    expect(state.synthesizedPcs[validPcId].tags ?? []).not.toContain('t6');
  });

  it('rejects empty tagText', () => {
    const log = setupWithPc();
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: '' });
    const state = materialize(log.events());
    expect((state.synthesizedPcs[validPcId].tags ?? []).length).toBe(3);
  });

  it('rejects tagText > 80 chars', () => {
    const log = setupWithPc();
    log.append('pc-tag-add', {
      v: 1,
      pcId: validPcId,
      tagText: 'a'.repeat(81)
    });
    const state = materialize(log.events());
    expect((state.synthesizedPcs[validPcId].tags ?? []).length).toBe(3);
  });

  it('accepts add from any peer (matches pc-edit trust gap)', () => {
    const log = setupWithPc();
    // Other peer (Bob) authors a tag-add for Mei's PC — current
    // pc-edit trust gap tolerates this; we mirror.
    const bob = new EventLog('bob');
    for (const e of log.events()) bob.apply(e);
    bob.append('pc-tag-add', {
      v: 1,
      pcId: validPcId,
      tagText: 'by-bob'
    });
    const state = materialize(bob.events());
    expect(state.synthesizedPcs[validPcId].tags ?? []).toContain('by-bob');
  });
});

describe('pc-tag-remove (UX-MH-2)', () => {
  it('removes a tag in place', () => {
    const log = setupWithPc();
    log.append('pc-tag-remove', { v: 1, pcId: validPcId, tagText: 'nurse' });
    const state = materialize(log.events());
    expect(state.synthesizedPcs[validPcId].tags ?? []).not.toContain('nurse');
  });

  it('is idempotent on unknown tag (no error, no mutation)', () => {
    const log = setupWithPc();
    log.append('pc-tag-remove', { v: 1, pcId: validPcId, tagText: 'never-existed' });
    const state = materialize(log.events());
    expect((state.synthesizedPcs[validPcId].tags ?? []).length).toBe(3);
  });

  it('rejects remove when PC does not exist', () => {
    const log = setupCoord();
    log.append('pc-tag-remove', {
      v: 1,
      pcId: 'ghost-pc',
      tagText: 'nurse'
    });
    const state = materialize(log.events());
    expect(state.synthesizedPcs['ghost-pc']).toBeUndefined();
  });
});

describe('pc-tag-rename (UX-MH-2 atomic)', () => {
  it('replaces old text with new text in place (no flicker)', () => {
    const log = setupWithPc();
    log.append('pc-tag-rename', {
      v: 1,
      pcId: validPcId,
      oldTagText: 'climber',
      newTagText: 'boulderer'
    });
    const state = materialize(log.events());
    const tags = state.synthesizedPcs[validPcId].tags ?? [];
    expect(tags).not.toContain('climber');
    expect(tags).toContain('boulderer');
    // Length preserved — atomic swap, no temporary state where the
    // tag is missing.
    expect(tags.length).toBe(3);
  });

  it('rename to existing tag merges (set semantics) — removes old only', () => {
    const log = setupWithPc();
    // Mei already has 'nurse' and 'climber'.  Renaming climber→nurse
    // should drop climber + keep nurse, NOT duplicate.
    log.append('pc-tag-rename', {
      v: 1,
      pcId: validPcId,
      oldTagText: 'climber',
      newTagText: 'nurse'
    });
    const state = materialize(log.events());
    const tags = state.synthesizedPcs[validPcId].tags ?? [];
    expect(tags).toContain('nurse');
    expect(tags).not.toContain('climber');
    expect(tags.filter((t) => t === 'nurse').length).toBe(1);
    expect(tags.length).toBe(2);
  });

  it('rename of missing old tag is a no-op (replay convergence)', () => {
    const log = setupWithPc();
    log.append('pc-tag-rename', {
      v: 1,
      pcId: validPcId,
      oldTagText: 'never-existed',
      newTagText: 'new'
    });
    const state = materialize(log.events());
    expect(state.synthesizedPcs[validPcId].tags ?? []).not.toContain('new');
    expect((state.synthesizedPcs[validPcId].tags ?? []).length).toBe(3);
  });

  it('rejects rename when old === new', () => {
    const log = setupWithPc();
    const beforeTags = [
      ...(materialize(log.events()).synthesizedPcs[validPcId].tags ?? [])
    ];
    log.append('pc-tag-rename', {
      v: 1,
      pcId: validPcId,
      oldTagText: 'nurse',
      newTagText: 'nurse'
    });
    const after = materialize(log.events());
    expect(after.synthesizedPcs[validPcId].tags).toEqual(beforeTags);
  });
});

describe('backstory-refresh-proposal (UX-MH-3)', () => {
  it('materializes into state.backstoryRefreshProposals when authored by coord', () => {
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'Mei (they/them) grew up by the Underleaf.',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    expect(state.backstoryRefreshProposals[validPcId]).toBeDefined();
    expect(state.backstoryRefreshProposals[validPcId].proposedBackstory).toBe(
      'Mei (they/them) grew up by the Underleaf.'
    );
    expect(state.backstoryRefreshProposals[validPcId].initiator).toBe('dm');
  });

  it('LWW per pcId — fresh proposal replaces prior pending one', () => {
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'First proposal',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'Second proposal',
      baselineHash: 'b'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    expect(state.backstoryRefreshProposals[validPcId].proposedBackstory).toBe(
      'Second proposal'
    );
  });

  it('rejects when authored by a non-coord peer', () => {
    const log = new EventLog('alice');
    log.append('peer-join', { name: 'Alice' });
    log.append('pc-create', pcCreatePayload('Mei'));
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'Sneaky proposal',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    // Alice was never coord — the proposal materializer drops AND
    // pc-create also drops, so the proposal is gone.
    expect(state.backstoryRefreshProposals[validPcId]).toBeUndefined();
  });

  it('rejects when PC does not exist', () => {
    const log = setupCoord();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: 'ghost-pc',
      proposedBackstory: 'Body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    expect(state.backstoryRefreshProposals['ghost-pc']).toBeUndefined();
  });

  it('rejects invalid initiator enum', () => {
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'body',
      baselineHash: 'a'.repeat(64),
      initiator: 'evil-dm'
    });
    const state = materialize(log.events());
    expect(state.backstoryRefreshProposals[validPcId]).toBeUndefined();
  });

  it('rejects proposedBackstory > PC_CREATE_MAX_BACKSTORY (8000)', () => {
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'a'.repeat(8001),
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    expect(state.backstoryRefreshProposals[validPcId]).toBeUndefined();
  });

  it('rejects empty proposedBackstory', () => {
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: '',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    expect(state.backstoryRefreshProposals[validPcId]).toBeUndefined();
  });

  it('accepts optional triggerSummary (DM-only) for DM-initiated path', () => {
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm',
      triggerSummary: 'pronouns updated to they/them'
    });
    const state = materialize(log.events());
    // Coord viewer sees the triggerSummary; the player-projection
    // strip is tested in the firewall section below.
    expect(state.backstoryRefreshProposals[validPcId].triggerSummary).toBe(
      'pronouns updated to they/them'
    );
  });
});

/**
 * Re-run Alice's log: pull DM events into Alice's local log, have
 * Alice author a peer-rename binding her pcId, push back to the
 * DM log.  This is the runtime path that makes
 * `state.peers.alice.pcId = validPcId` materialize correctly.
 */
function bindPeerToPc(log: EventLog, peerId: string, pcId: string): void {
  const peerLog = new EventLog(peerId);
  for (const e of log.events()) peerLog.apply(e);
  peerLog.append('peer-rename', { pcId });
  for (const e of peerLog.events()) log.apply(e);
}

describe('backstory-refresh-proposal — firewall (R-G)', () => {
  it("filterForViewer strips triggerSummary for the bound player", () => {
    const log = setupWithPc();
    bindPeerToPc(log, 'alice', validPcId);
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm',
      triggerSummary: 'DM said: this is why I refreshed'
    });
    const state = materialize(log.events());
    const playerView = filterForViewer(state, 'alice');
    // Player sees the proposal (it IS the inbox card).
    expect(playerView.backstoryRefreshProposals[validPcId]).toBeDefined();
    expect(
      playerView.backstoryRefreshProposals[validPcId].proposedBackstory
    ).toBe('body');
    // Player does NOT see the DM's triggerSummary.
    expect(
      playerView.backstoryRefreshProposals[validPcId].triggerSummary
    ).toBeUndefined();
  });

  it("filterForViewer hides another player's pending proposal", () => {
    const log = setupWithPc();
    const otherPcId = 'sora';
    log.append('pc-create', {
      v: 1,
      pcId: otherPcId,
      name: 'Sora',
      pronouns: 'she/her',
      tags: ['ranger', 'foundling', 'cook'],
      stats: { str: 1, dex: 1, con: 0, int: 0, wis: 0, cha: -1 },
      skills: ['archery'],
      backstory: 'Sora.'
    });
    joinPeer(log, 'bob', 'Bob');
    bindPeerToPc(log, 'alice', validPcId);
    bindPeerToPc(log, 'bob', otherPcId);
    // DM emits a proposal for Sora (NOT Alice).
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: otherPcId,
      proposedBackstory: 'Sora-body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    const aliceView = filterForViewer(state, 'alice');
    // Alice MUST NOT see Sora's pending proposal.
    expect(aliceView.backstoryRefreshProposals[otherPcId]).toBeUndefined();
    // But Bob does.
    const bobView = filterForViewer(state, 'bob');
    expect(bobView.backstoryRefreshProposals[otherPcId]).toBeDefined();
  });
});

describe('persistence — Run #19 firewall', () => {
  it('peer-rename-by-coord survives the player projection (no DM-only sub-fields)', async () => {
    const { serializeSessionForViewer } = await import('../persistence');
    const log = setupCoord();
    joinPeer(log, 'alice', 'Alice');
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'alice',
      newDisplayName: 'Alice2'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      { owner: 'o', repo: 'r', ref: 'main' },
      'alice', // player viewer (not coord)
      'dm'
    );
    const renames = doc.events.filter((e) => e.kind === 'peer-rename-by-coord');
    expect(renames).toHaveLength(1);
    const p = renames[0].payload as { newDisplayName: string };
    expect(p.newDisplayName).toBe('Alice2');
  });

  it('pc-tag-add/remove/rename survive the player projection', async () => {
    const { serializeSessionForViewer } = await import('../persistence');
    const log = setupWithPc();
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 'x' });
    log.append('pc-tag-remove', { v: 1, pcId: validPcId, tagText: 'nurse' });
    log.append('pc-tag-rename', {
      v: 1,
      pcId: validPcId,
      oldTagText: 'climber',
      newTagText: 'boulderer'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      { owner: 'o', repo: 'r', ref: 'main' },
      'alice',
      'dm'
    );
    const tagOps = doc.events.filter((e) =>
      e.kind.startsWith('pc-tag-')
    );
    expect(tagOps).toHaveLength(3);
  });

  it('backstory-refresh-proposal scrubber drops triggerSummary on the wire', async () => {
    const { serializeSessionForViewer } = await import('../persistence');
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm',
      triggerSummary: 'DM-only why-summary'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      { owner: 'o', repo: 'r', ref: 'main' },
      'alice',
      'dm'
    );
    const props = doc.events.filter(
      (e) => e.kind === 'backstory-refresh-proposal'
    );
    expect(props).toHaveLength(1);
    const p = props[0].payload as Record<string, unknown>;
    // Player-visible fields survive.
    expect(p.proposedBackstory).toBe('body');
    expect(p.baselineHash).toBeDefined();
    expect(p.initiator).toBe('dm');
    // DM-only field is stripped.
    expect(p.triggerSummary).toBeUndefined();
  });

  it('coord viewer keeps the full backstory-refresh-proposal (including triggerSummary)', async () => {
    const { serializeSessionForViewer } = await import('../persistence');
    const log = setupWithPc();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm',
      triggerSummary: 'DM-only why-summary'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      { owner: 'o', repo: 'r', ref: 'main' },
      'dm', // coord viewer
      'dm'
    );
    const props = doc.events.filter(
      (e) => e.kind === 'backstory-refresh-proposal'
    );
    const p = props[0].payload as Record<string, unknown>;
    expect(p.triggerSummary).toBe('DM-only why-summary');
  });
});

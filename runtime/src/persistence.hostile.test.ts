/**
 * Hostile-input tests for serializeSessionForViewer (M3a.10 gate).
 *
 * Threat model (memory: project_quire_threat_model.md):
 *   - players STORING DM material on their device (autosave,
 *     local event log) is explicitly desired for data resilience.
 *   - players READING DM material — especially ACCIDENTALLY,
 *     via a file they downloaded and opened in a text editor —
 *     is the bug this filter exists to prevent.
 *
 * Each test exercises the boundary: a non-coord viewer's shareable
 * save must not contain DM-only event kinds, while the same save
 * from the currently-acting DM must contain everything (because
 * the DM authoring the save IS the audience of their own backup).
 */

import { describe, it, expect } from 'vitest';
import {
  serializeSessionForViewer,
  parseSaveDocument,
  stringifySave
} from './persistence';
import { EventLog } from './core/event-log';

const CAMPAIGN = { owner: 'x', repo: 'y', ref: 'main' };

function logWithDmMaterial(coord: string): EventLog {
  const log = new EventLog(coord);
  log.append('coordinator-claim', {});
  log.append('chat', { text: 'public chat' });
  log.append('scene-reveal', { scenePath: 'episodes/001/scenes/intro.md' });
  log.append('scene-reveal-paragraph', {
    v: 1,
    scenePath: 'episodes/001/scenes/intro.md',
    blockHash: '0123456789abcdef'
  });
  log.append('npc-pin', { v: 1, npcId: 'hadrian' });
  log.append('thread-debt-set', { v: 1, pcId: 'yui', level: 'hunted' });
  log.append('scratch-note', {
    v: 1,
    text: 'remember: hadrian betrays them in ep4'
  });
  log.append('broadcast-view', {
    v: 1,
    stagePath: '?scene=intro.md'
  });
  return log;
}

describe('serializeSessionForViewer — DM-only event stripping', () => {
  it('non-coord viewer save omits scratch-note', () => {
    const log = logWithDmMaterial('alice');
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    expect(doc.events.some((e) => e.kind === 'scratch-note')).toBe(false);
  });

  it('non-coord viewer save omits npc-pin and npc-unpin', () => {
    const log = logWithDmMaterial('alice');
    log.append('npc-unpin', { v: 1, npcId: 'hadrian' });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    expect(doc.events.some((e) => e.kind === 'npc-pin')).toBe(false);
    expect(doc.events.some((e) => e.kind === 'npc-unpin')).toBe(false);
  });

  it('non-coord viewer save omits thread-debt-set', () => {
    const log = logWithDmMaterial('alice');
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    expect(doc.events.some((e) => e.kind === 'thread-debt-set')).toBe(false);
  });

  it('non-coord viewer save omits caster-state-set (M3c.1)', () => {
    const log = logWithDmMaterial('alice');
    log.append('caster-state-set', {
      v: 1,
      pcId: 'yui',
      ladderState: 'noticed',
      reason: 'the lights flicker — DM-narration spoiler',
      taxActive: false,
      spamCount: 1
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    expect(doc.events.some((e) => e.kind === 'caster-state-set')).toBe(false);
  });

  it('non-coord viewer save omits ai-* audit kinds', () => {
    const log = logWithDmMaterial('alice');
    // ai-* materializers ship in M3b; payload shape unspecified
    // for the strip, so we use an opaque object — the kind check
    // is what matters.
    log.append('ai-prompt', { v: 1 } as never);
    log.append('ai-response', { v: 1 } as never);
    log.append('ai-accept', { v: 1 } as never);
    log.append('ai-reject', { v: 1 } as never);
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    for (const kind of ['ai-prompt', 'ai-response', 'ai-accept', 'ai-reject']) {
      expect(doc.events.some((e) => e.kind === kind)).toBe(false);
    }
  });

  it('non-coord viewer save KEEPS player-visible kinds', () => {
    const log = logWithDmMaterial('alice');
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    // Whole-scene + per-paragraph reveal stays in the save — the
    // player already saw the reveal at the table, so it's not
    // sensitive.  Broadcast-view stays — player-visible LWW state.
    expect(doc.events.some((e) => e.kind === 'scene-reveal')).toBe(true);
    expect(doc.events.some((e) => e.kind === 'scene-reveal-paragraph')).toBe(
      true
    );
    expect(doc.events.some((e) => e.kind === 'broadcast-view')).toBe(true);
    expect(doc.events.some((e) => e.kind === 'chat')).toBe(true);
    expect(doc.events.some((e) => e.kind === 'coordinator-claim')).toBe(true);
  });

  it('coordinator-author save contains ALL events (DM saves everything)', () => {
    const log = logWithDmMaterial('alice');
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'alice',
      'alice'
    );
    expect(doc.events.length).toBe(log.events().length);
    expect(doc.events.some((e) => e.kind === 'scratch-note')).toBe(true);
    expect(doc.events.some((e) => e.kind === 'thread-debt-set')).toBe(true);
    expect(doc.events.some((e) => e.kind === 'npc-pin')).toBe(true);
  });

  it('no current coordinator → treat author as non-coord (strip DM)', () => {
    const log = logWithDmMaterial('alice');
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'alice',
      undefined
    );
    // Defensive: when nobody currently holds coord, even Alice's
    // save strips DM events.  The earlier-coord scenario (Alice
    // yielded) → her save no longer leaks DM material.
    expect(doc.events.some((e) => e.kind === 'scratch-note')).toBe(false);
  });

  it('THE LEAK SCENARIO: shareable save text contains no DM scratch verbatim', () => {
    // Concretely simulate "player Cmd+S, opens JSON in text editor."
    const log = logWithDmMaterial('alice');
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const json = stringifySave(doc);
    // The scratch text in logWithDmMaterial is the spoiler we
    // care about — search the literal serialized JSON for it.
    expect(json).not.toContain('hadrian betrays them in ep4');
    // Pinned NPC id is also a quiet spoiler in some campaigns
    // (the DM picks which NPCs to keep front-of-mind).
    expect(json).not.toContain('"npc-pin"');
    expect(json).not.toContain('"thread-debt-set"');
  });

  it('round-trip: shareable save parses cleanly and applies', () => {
    const log = logWithDmMaterial('alice');
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const json = stringifySave(doc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // The shareable save is itself parseable + has all the
      // events it claimed to have.
      expect(parsed.doc.events.length).toBe(doc.events.length);
    }
  });

  // B-1 (2026-05-26 holistic-review Adversarial sweep): pc-retire
  // and pc-archive payloads carry DM-private `reason` + `scene`
  // alongside player-safe `inFictionReason` + `seatMemory`.
  it('non-coord viewer save STRIPS pc-retire reason + scene fields', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 1 });
    log.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0
    });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'she walked back into the rain',
      reason: 'died',
      scene: 'ep04/scene-07-secret-dm-only-path'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const retire = doc.events.find((e) => e.kind === 'pc-retire');
    expect(retire).toBeDefined();
    const p = (retire as { payload: Record<string, unknown> }).payload;
    // Player-safe fields preserved.
    expect(p.pcId).toBe('mei');
    expect(p.state).toBe('bound-retired');
    expect(p.inFictionReason).toBe('she walked back into the rain');
    // DM-private fields scrubbed.
    expect(p.reason).toBeUndefined();
    expect(p.scene).toBeUndefined();
    // Serialized JSON also clean — direct grep is the leak test.
    const json = stringifySave(doc);
    expect(json).not.toContain('ep04/scene-07-secret-dm-only-path');
  });

  it('non-coord viewer save STRIPS pc-archive reason + scene fields', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 1 });
    log.append('pc-create', {
      v: 1,
      pcId: 'iris',
      name: 'Iris',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0
    });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'iris' });
    log.append('pc-archive', {
      v: 1,
      pcId: 'iris',
      state: 'bound-archived',
      inFictionReason: 'returned to her old life',
      reason: 'converted-to-npc',
      scene: 'ep06/private-scene-name'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const archive = doc.events.find((e) => e.kind === 'pc-archive');
    expect(archive).toBeDefined();
    const p = (archive as { payload: Record<string, unknown> }).payload;
    expect(p.inFictionReason).toBe('returned to her old life');
    expect(p.reason).toBeUndefined();
    expect(p.scene).toBeUndefined();
    const json = stringifySave(doc);
    expect(json).not.toContain('ep06/private-scene-name');
  });

  it('SEC-1 (post-D5 sweep): non-coord viewer save STRIPS DM-only fields from pc-create payload', () => {
    // pc-create is player-visible (the synthesized PC IS the
    // player's character) but the payload carries the full
    // CharacterRecord shape — including optional DM-only fields
    // a DM may have edited at chargen review (dmNotes,
    // magicPhase, etc.).  Pre-fix those landed in player saves.
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 1 });
    log.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0,
      // DM ratified the synth with a spoiler-anchor dmNotes:
      dmNotes: 'Mei is the first accidental caster the Quiet noticed.',
      magicPhase: 'accidental',
      knowsTheyCanCast: false,
      tax: { active: false },
      threadDebt: { rung: 'quiet' },
      accidentalGrants: [{ ts: 1, note: 'a luck moment' }],
      alignmentDrift: { marks: 0 }
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const create = doc.events.find((e) => e.kind === 'pc-create');
    expect(create).toBeDefined();
    const p = (create as { payload: Record<string, unknown> }).payload;
    // Player-safe fields preserved.
    expect(p.pcId).toBe('mei');
    expect(p.name).toBe('Mei');
    expect(p.stats).toBeDefined();
    expect(p.harm).toBe(0);
    expect(p.stress).toBe(0);
    // DM-only fields scrubbed.
    expect(p.dmNotes).toBeUndefined();
    expect(p.magicPhase).toBeUndefined();
    expect(p.knowsTheyCanCast).toBeUndefined();
    expect(p.tax).toBeUndefined();
    expect(p.threadDebt).toBeUndefined();
    expect(p.accidentalGrants).toBeUndefined();
    expect(p.alignmentDrift).toBeUndefined();
    // Direct-grep leak test for the dmNotes spoiler text.
    const json = stringifySave(doc);
    expect(json).not.toContain('first accidental caster the Quiet noticed');
  });

  it('SEC-1: coord viewer save preserves pc-create DM-only fields (DM authoring own backup)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 1 });
    log.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0,
      dmNotes: 'spoiler anchor'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'alice', // coord viewer
      'alice'
    );
    const create = doc.events.find((e) => e.kind === 'pc-create');
    const p = (create as { payload: Record<string, unknown> }).payload;
    expect(p.dmNotes).toBe('spoiler anchor');
  });

  it('coord viewer save preserves pc-retire reason + scene (DM authoring own backup)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 1 });
    log.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0
    });
    log.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    log.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'she walked back into the rain',
      reason: 'died',
      scene: 'ep04/secret'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'alice', // coord viewer
      'alice'
    );
    const retire = doc.events.find((e) => e.kind === 'pc-retire');
    expect(retire).toBeDefined();
    const p = (retire as { payload: Record<string, unknown> }).payload;
    // DM keeps everything — full audit in their own save.
    expect(p.reason).toBe('died');
    expect(p.scene).toBe('ep04/secret');
  });

  // M1 (2026-05-29 four-expert review, Adversarial #1): map-blob-add
  // is correctly classified player-visible (the materializer projects
  // by reveal-mask, so a player's view of revealed blobs is correct),
  // but the save writes RAW EVENTS.  A DM-staged but unrevealed blob's
  // label landed verbatim in every player's autosave pre-fix.
  it('non-coord viewer save STRIPS map-blob-add label when blob is UNREVEALED', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    // Two staged blobs — one revealed, one DM-private.
    log.append('map-blob-add', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blob: {
        id: 'blob-public',
        label: 'tavern door',
        x: 10,
        y: 10
      }
    });
    log.append('map-blob-add', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blob: {
        id: 'blob-secret',
        label: 'the Quiet is watching from the alley',
        x: 20,
        y: 20
      }
    });
    // Reveal only the public one.
    log.append('map-blob-reveal', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blobId: 'blob-public'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const adds = doc.events.filter((e) => e.kind === 'map-blob-add') as Array<{
      payload?: { blob?: Record<string, unknown> };
    }>;
    expect(adds).toHaveLength(2);
    // Public blob keeps its label.
    const pub = adds.find((e) => e.payload?.blob?.id === 'blob-public');
    expect(pub?.payload?.blob?.label).toBe('tavern door');
    // Secret blob's label is scrubbed.
    const sec = adds.find((e) => e.payload?.blob?.id === 'blob-secret');
    expect(sec).toBeDefined();
    expect(sec?.payload?.blob?.label).toBeUndefined();
    // Direct-grep leak test.
    const json = stringifySave(doc);
    expect(json).not.toContain('the Quiet is watching from the alley');
    // Public label still in JSON (positive control).
    expect(json).toContain('tavern door');
  });

  it('non-coord viewer save STRIPS map-blob-add label when blob was revealed then UNREVEALED', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('map-blob-add', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blob: {
        id: 'blob-flip',
        label: 'DM-only spoiler text',
        x: 10,
        y: 10
      }
    });
    // Briefly revealed then re-hidden.
    log.append('map-blob-reveal', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blobId: 'blob-flip'
    });
    log.append('map-blob-unreveal', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blobId: 'blob-flip'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const json = stringifySave(doc);
    // Even though the player SAW the label briefly at the table,
    // hiding it again means the save shouldn't carry it: the
    // player who reads their JSON in a text editor after the DM
    // un-revealed sees nothing.  This matches the "DM owns when
    // material is visible" mental model.
    expect(json).not.toContain('DM-only spoiler text');
  });

  it('non-coord viewer save STRIPS map-blob-move label when blob is UNREVEALED', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('map-blob-add', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blob: {
        id: 'blob-secret',
        label: 'the betrayer is here',
        x: 0,
        y: 0
      }
    });
    log.append('map-blob-move', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blobId: 'blob-secret',
      // Some emission paths re-broadcast the full blob shape on
      // move so the materializer can carry-forward the label.
      // Scrubbing must catch both shapes.
      blob: {
        id: 'blob-secret',
        label: 'the betrayer is here',
        x: 50,
        y: 50
      }
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const json = stringifySave(doc);
    expect(json).not.toContain('the betrayer is here');
  });

  it('coord viewer save preserves map-blob-add labels for unrevealed blobs (DM resilience)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('map-blob-add', {
      v: 1,
      scenePath: 'ep01/scene-01.md',
      blob: {
        id: 'blob-secret',
        label: 'DM staging text',
        x: 10,
        y: 10
      }
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'alice', // coord viewer
      'alice'
    );
    const add = doc.events.find((e) => e.kind === 'map-blob-add') as
      | { payload: { blob: Record<string, unknown> } }
      | undefined;
    expect(add).toBeDefined();
    expect(add?.payload.blob.label).toBe('DM staging text');
  });

  // M1 (2026-05-29 Adversarial #2): causedByResponseId on pc-create
  // and pc-edit is a "this PC change came from the AI" indicator.
  // Not a spoiler today, but a future logging extension that
  // surfaces AI provenance to players would leak the DM's AI usage
  // pattern.  Same regression-class as the existing scrubber arms.
  it('non-coord viewer save STRIPS causedByResponseId from pc-create payload', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('seat-add', { v: 1, slot: 1 });
    log.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0,
      causedByResponseId: 'resp-ai-12345'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const create = doc.events.find((e) => e.kind === 'pc-create');
    expect(create).toBeDefined();
    const p = (create as { payload: Record<string, unknown> }).payload;
    expect(p.pcId).toBe('mei');
    expect(p.causedByResponseId).toBeUndefined();
    const json = stringifySave(doc);
    expect(json).not.toContain('resp-ai-12345');
  });

  it('non-coord viewer save STRIPS causedByResponseId from pc-edit payload', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'harm',
      value: 2,
      causedByResponseId: 'resp-ai-67890'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'bob',
      'alice'
    );
    const edit = doc.events.find((e) => e.kind === 'pc-edit');
    expect(edit).toBeDefined();
    const p = (edit as { payload: Record<string, unknown> }).payload;
    // Player-visible fields preserved.
    expect(p.pcId).toBe('mei');
    expect(p.field).toBe('harm');
    expect(p.value).toBe(2);
    // AI-provenance scrubbed.
    expect(p.causedByResponseId).toBeUndefined();
    const json = stringifySave(doc);
    expect(json).not.toContain('resp-ai-67890');
  });

  it('coord viewer save preserves causedByResponseId (DM keeps AI-provenance audit)', () => {
    const log = new EventLog('alice');
    log.append('coordinator-claim', {});
    log.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'harm',
      value: 2,
      causedByResponseId: 'resp-ai-67890'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'alice', // coord viewer
      'alice'
    );
    const edit = doc.events.find((e) => e.kind === 'pc-edit');
    const p = (edit as { payload: Record<string, unknown> }).payload;
    expect(p.causedByResponseId).toBe('resp-ai-67890');
  });
});

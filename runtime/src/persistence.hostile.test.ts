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
});

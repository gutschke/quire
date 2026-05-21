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
});

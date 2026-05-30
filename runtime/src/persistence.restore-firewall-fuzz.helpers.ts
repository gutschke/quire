/**
 * Test helpers for `persistence.restore-firewall-fuzz.test.ts`.
 *
 * Separated into a non-`.test.ts` file so the helper code is not
 * picked up by `vitest` as a test file in its own right; the file
 * has no top-level describe/it blocks but the suffix would otherwise
 * make vitest scan it.
 *
 * The factory `buildLeakyDmCoordSave` plants unique sentinel strings
 * into every event-kind surface the firewall classifies as DM-only
 * (kind-level strip OR partial-payload scrub).  The resulting
 * SaveDocument is the WHAT-A-DM-COORD-CLOUD-SAVE-LOOKS-LIKE shape:
 * coord-authored, every sub-shape in flight, sentinels traceable.
 *
 * Pairs with `collectSentinels` for the helper-round-trip test that
 * pins the fuzz infrastructure itself.
 */

import { EventLog } from './core/event-log';
import {
  SAVE_SCHEMA_VERSION,
  type CampaignRef,
  type SaveDocument
} from './persistence';

export const CAMPAIGN_FOR_TESTS: CampaignRef = {
  owner: 'gutschke',
  repo: 'underleaf',
  ref: 'main'
};

const SECRET_PREFIX = 'DM_SECRET_NEW_ADV_';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a DM-coord SaveDocument with sentinels planted in every
 * DM-only surface.  Returns the SaveDocument + the list of planted
 * sentinels so the test can assert each was either stripped or
 * survived (depending on the scenario).
 *
 * Surfaces covered:
 *   - Kind-level DM-only:
 *     scratch-note, npc-pin, caster-state-set, ai-prompt,
 *     accidental-grant-log, dm-clock-create/tick, proposal-create/accept/reject,
 *     bond-propose
 *   - Partial-payload (PER_KIND_SCRUBBERS):
 *     pc-edit (dmNotes field + causedByResponseId metadata),
 *     pc-create (dmNotes + causedByResponseId),
 *     focus-grant (boundFor + notes),
 *     pc-retire / pc-archive (reason + scene),
 *     map-blob-add (unrevealed label),
 *     bond-ratify (dmNotes)
 */
export function buildLeakyDmCoordSave(seed: number): {
  doc: SaveDocument;
  secrets: string[];
} {
  const rng = mulberry32(seed);
  const log = new EventLog('dm');
  const secrets: string[] = [];
  let n = 0;
  const secret = (): string => {
    const s = `${SECRET_PREFIX}${seed}_${n++}`;
    secrets.push(s);
    return s;
  };

  // Bootstrap: coord-claim + seats + PCs so the partial-payload
  // events have valid targets.
  log.append('coordinator-claim', {});
  log.append('seat-add', { v: 1, slot: 1 });
  log.append('seat-add', { v: 1, slot: 2 });
  log.append('pc-create', {
    v: 1,
    pcId: 'mei',
    name: 'Mei',
    pronouns: 'she/her',
    stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: ['Tech'],
    backstory: 'public'
  });
  log.append('pc-create', {
    v: 1,
    pcId: 'rho',
    name: 'Rho',
    pronouns: 'they/them',
    stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: ['Diplomacy'],
    backstory: 'public'
  });

  // Dense coverage of every DM-only kind surface.  Per-kind plant
  // (not random switch) so a regression on a single kind is
  // immediately attributable.
  log.append('scratch-note', { v: 1, text: secret() });
  log.append('npc-pin', { v: 1, npcId: secret() });
  log.append('caster-state-set', {
    v: 1,
    pcId: 'mei',
    ladderState: 'noticed',
    reason: secret(),
    taxActive: true,
    spamCount: 1
  });
  log.append('ai-prompt', {
    v: 1,
    promptId: `p-${n}`,
    text: secret()
  } as unknown as Record<string, unknown>);
  log.append('ai-response', {
    v: 1,
    promptId: `p-${n}`,
    text: secret()
  } as unknown as Record<string, unknown>);
  log.append('accidental-grant-log', {
    v: 1,
    pcId: 'mei',
    text: secret()
  } as unknown as Record<string, unknown>);
  log.append('dm-clock-create', {
    v: 1,
    clockId: 'clk-1',
    name: secret(),
    segments: 6
  } as unknown as Record<string, unknown>);
  log.append('dm-clock-tick', {
    v: 1,
    clockId: 'clk-1',
    note: secret()
  } as unknown as Record<string, unknown>);
  log.append('proposal-create', {
    v: 1,
    proposalId: 'p1',
    rationale: secret()
  } as unknown as Record<string, unknown>);
  log.append('proposal-accept', {
    v: 1,
    proposalId: 'p1',
    snapshotAfter: { dmNotes: secret() }
  } as unknown as Record<string, unknown>);
  log.append('proposal-reject', {
    v: 1,
    proposalId: 'p2',
    reason: secret()
  } as unknown as Record<string, unknown>);
  log.append('bond-propose', {
    v: 1,
    bondId: 'b1',
    a: 'mei',
    b: 'rho',
    text: secret()
  } as unknown as Record<string, unknown>);

  // Partial-payload events: sentinels in the DM-only sub-fields
  // only.  The wrapping event survives (player-visible) but the
  // sub-field is stripped by PER_KIND_SCRUBBERS.
  log.append('pc-edit', {
    v: 1,
    pcId: 'mei',
    field: 'dmNotes',
    value: secret()
  });
  log.append('pc-edit', {
    v: 1,
    pcId: 'mei',
    field: 'harm',
    value: 1,
    causedByResponseId: secret()
  });
  log.append('focus-grant', {
    v: 1,
    pcId: 'mei',
    focus: {
      name: 'pattern-sense',
      domain: 'perception',
      boundFor: secret(),
      notes: secret()
    }
  });
  log.append('pc-retire', {
    v: 1,
    pcId: 'rho',
    state: 'bound-retired',
    inFictionReason: 'left the table (player-visible)',
    reason: secret(),
    scene: secret()
  });
  // Run #18 (2026-05-30): pc-revoke (DEC-043).  The seat transition
  // + bondTombstoneName are player-safe by construction (player sees
  // the seat enter the revoked SlotState).  `narrativeShape` carries
  // the DM authorial choice and `causedByPeerId` is DM-side audit;
  // both must strip from the non-coord projection per scrubRevoke.
  log.append('pc-revoke', {
    v: 1,
    pcId: 'mei',
    slot: 1,
    narrativeShape: secret() as unknown as string,
    causedByPeerId: secret() as unknown as string,
    bondTombstoneName: 'a former friend' // player-safe
  });
  log.append('bond-ratify', {
    v: 1,
    bondId: 'br1',
    a: 'mei',
    b: 'rho',
    text: 'bond text (player-visible)',
    dmNotes: secret()
  } as unknown as Record<string, unknown>);
  // Run #19 (2026-05-30): backstory-refresh-proposal carries one
  // DM-only sub-field (`triggerSummary`) — must strip via the
  // per-kind scrubber.  Everything else (proposedBackstory,
  // baselineHash, initiator) is player-visible by design.
  log.append('backstory-refresh-proposal', {
    v: 1,
    pcId: 'mei',
    proposedBackstory: 'public refreshed prose (player-visible)',
    baselineHash: 'a'.repeat(64),
    initiator: 'dm',
    triggerSummary: secret()
  });
  // Unrevealed map-blob: label is DM-staging text.
  log.append('map-blob-add', {
    v: 1,
    scenePath: 'ep01/scene-a.md',
    blob: {
      id: `blob-${n}`,
      label: secret(),
      x: 10,
      y: 20
    }
  });
  // A few sentinel-free player-visible chats so the leak-detection
  // is more than a "found ANY sentinel" check (forces the test to
  // distinguish player events from DM events).
  const noise = 5 + Math.floor(rng() * 5);
  for (let i = 0; i < noise; i++) {
    log.append('chat', { text: `public chat ${i}` });
  }

  const doc: SaveDocument = {
    $schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: '2026-05-29T00:00:00.000Z',
    campaign: { ...CAMPAIGN_FOR_TESTS },
    savedByPeerId: 'dm',
    events: log.events().slice()
  };
  return { doc, secrets };
}

/**
 * Find every `DM_SECRET_NEW_ADV_*` sentinel in a string blob.  Used
 * by the helper-round-trip test to assert that the planting half of
 * the fuzz is actually producing sentinels (defends against silent
 * fuzz drift).
 */
export function collectSentinels(blob: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${SECRET_PREFIX}\\d+_\\d+`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    out.add(m[0]);
  }
  return out;
}

// @vitest-environment node

/**
 * #420 + M1 (2026-05-29 save-restore program, Adversarial #4): the
 * SAVE-PATH companion to `state.firewall-fuzz.test.ts`.
 *
 * The existing fuzz taints `filterForViewer` (the LIVE projection); a
 * symmetric leak class lives on `serializeSessionForViewer` (the
 * SAVE STREAM), which writes RAW EVENT PAYLOADS rather than the
 * materialized state.  A future DM-only sub-field added to a
 * player-visible kind silently leaks via the save path even when
 * the live projection filters it correctly.
 *
 * Threat being fuzzed:
 *   - Coord-authored event log carries DM-typed material across a
 *     variety of payload shapes (free-form text, structured
 *     sub-objects, optional metadata, AI-provenance tracers).
 *   - Each DM-only free-text value is a UNIQUE sentinel.
 *   - `serializeSessionForViewer(events, …, viewer, coord)` runs.
 *   - The JSON of the resulting save MUST contain NO sentinel.
 *
 * Seeds are logged + deterministic (mulberry32) so failures are
 * reproducible: re-run the failing seed with `npx vitest run -t
 * "seed=…"`.
 */

import { describe, it, expect } from 'vitest';
import { EventLog } from './core/event-log';
import {
  serializeSessionForViewer,
  stringifySave
} from './persistence';

const SECRET_PREFIX = 'DM_SECRET_';
const CAMPAIGN = { owner: 'o', repo: 'r', ref: 'main' };

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
 * Build a coord-authored log densely populated with DM-only material
 * across every event kind that has a known DM-private surface.  Each
 * DM-only free-text value is a unique sentinel string; the test
 * later asserts NONE survive in the player save's serialized JSON.
 */
function buildLeakyLog(seed: number): { log: EventLog; secrets: string[] } {
  const rng = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T =>
    arr[Math.floor(rng() * arr.length)];
  const log = new EventLog('dm');
  const secrets: string[] = [];
  let n = 0;
  const secret = (): string => {
    const s = `${SECRET_PREFIX}${seed}_${n++}`;
    secrets.push(s);
    return s;
  };

  log.append('coordinator-claim', {});
  // Seed seats + PCs (so pc-* events have valid pcIds).
  log.append('seat-add', { v: 1, slot: 1 });
  log.append('seat-add', { v: 1, slot: 2 });
  log.append('pc-create', {
    v: 1,
    pcId: 'mei',
    name: 'Mei',
    pronouns: 'she/her',
    stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: ['Tech'],
    backstory: 'public backstory'
  });
  log.append('pc-create', {
    v: 1,
    pcId: 'rho',
    name: 'Rho',
    pronouns: 'they/them',
    stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: ['Diplomacy'],
    backstory: 'public backstory'
  });

  const steps = 20 + Math.floor(rng() * 30);
  for (let i = 0; i < steps; i++) {
    const pcId = pick(['mei', 'rho']);
    const scenePath = `ep${pick(['01', '02', '03'])}/scene-${pick(['a', 'b', 'c'])}.md`;
    switch (Math.floor(rng() * 12)) {
      // ── DM-only kinds (kind-level strip) ──────────────────────
      case 0:
        // Sentinel buried in scratch-note text.  The whole event
        // should disappear from the player save.
        log.append('scratch-note', { v: 1, text: secret() });
        break;
      case 1:
        log.append('npc-pin', { v: 1, npcId: secret() });
        break;
      case 2:
        log.append('caster-state-set', {
          v: 1,
          pcId,
          ladderState: pick(['quiet', 'noticed', 'watched']),
          reason: secret(),
          taxActive: rng() < 0.5,
          spamCount: Math.floor(rng() * 3)
        });
        break;
      case 3:
        log.append('ai-prompt', {
          v: 1,
          promptId: `p-${n}`,
          text: secret()
        } as unknown as Record<string, unknown>);
        break;
      // ── Player-visible kinds with DM-only sub-fields (scrubber) ──
      case 4:
        // pc-edit on a DM-only field — drop entire event.
        log.append('pc-edit', {
          v: 1,
          pcId,
          field: 'dmNotes',
          value: secret()
        });
        break;
      case 5:
        // pc-edit on a player-visible field with AI provenance —
        // drop causedByResponseId only.
        log.append('pc-edit', {
          v: 1,
          pcId,
          field: 'harm',
          value: Math.floor(rng() * 4),
          causedByResponseId: secret()
        });
        break;
      case 6:
        // pc-create with DM-only fields set.
        log.append('pc-create', {
          v: 1,
          pcId: `synth-${n}`,
          name: `Synth-${n}`,
          stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
          harm: 0,
          stress: 0,
          dmNotes: secret(),
          causedByResponseId: secret()
        });
        break;
      case 7:
        // focus-grant with DM-only sub-fields.
        log.append('focus-grant', {
          v: 1,
          pcId,
          focus: {
            name: 'pattern-sense',
            domain: 'perception',
            condition: 'when held in moonlight', // PLAYER-VISIBLE; sentinel NOT planted here
            boundFor: secret(),
            notes: secret()
          }
        });
        break;
      case 8:
        // pc-retire with DM-only sub-fields.
        log.append('pc-retire', {
          v: 1,
          pcId,
          state: 'bound-retired',
          inFictionReason: 'she walked into the rain',
          reason: 'died',
          scene: secret() // scene path can carry spoiler shape
        });
        break;
      case 9:
        // map-blob-add on an UNREVEALED blob — label is DM-typed.
        log.append('map-blob-add', {
          v: 1,
          scenePath,
          blob: {
            id: `blob-secret-${n}`,
            label: secret(),
            x: Math.floor(rng() * 100),
            y: Math.floor(rng() * 100)
          }
        });
        break;
      case 10:
        // map-blob-add followed by REVEAL — label is now player-safe.
        // We do NOT plant a sentinel here; this branch exists to
        // exercise the "keep" path so the test would fail if the
        // scrubber accidentally over-strips.
        {
          const blobId = `blob-public-${n}`;
          log.append('map-blob-add', {
            v: 1,
            scenePath,
            blob: {
              id: blobId,
              label: 'PUBLIC_LABEL_KEEP_ME',
              x: 0,
              y: 0
            }
          });
          log.append('map-blob-reveal', { v: 1, scenePath, blobId });
        }
        break;
      case 11:
        // bond-ratify with DM-only dmNotes sub-field.
        log.append('bond-ratify', {
          v: 1,
          bondId: `bond-${n}`,
          a: 'mei',
          b: 'rho',
          text: 'bond text (player-visible)',
          dmNotes: secret()
        } as unknown as Record<string, unknown>);
        break;
    }
  }
  return { log, secrets };
}

describe('#420 save-path firewall taint-fuzz — no DM-only free-text reaches a player save', () => {
  it('40 seeded leaky scenarios: no sentinel survives serializeSessionForViewer for any non-coord viewer', () => {
    for (let scenario = 0; scenario < 40; scenario++) {
      const seed = 0x5a7e + scenario * 8191;
      const { log, secrets } = buildLeakyLog(seed);
      expect(
        secrets.length,
        `seed=${seed}: fuzz did not plant any secrets`
      ).toBeGreaterThan(0);

      // Sanity: the COORD's own save retains the secrets (otherwise
      // the test passes trivially because nothing was planted).
      const coordDoc = serializeSessionForViewer(
        log.events(),
        CAMPAIGN,
        'dm',
        'dm'
      );
      const coordJson = stringifySave(coordDoc);
      expect(
        secrets.some((s) => coordJson.includes(s)),
        `seed=${seed}: expected DM save to retain planted secrets`
      ).toBe(true);

      // Several non-coord viewers — NONE may see ANY sentinel.
      for (const viewer of ['player-a', 'player-b', 'outsider', 'zzz']) {
        const doc = serializeSessionForViewer(
          log.events(),
          CAMPAIGN,
          viewer,
          'dm'
        );
        const json = stringifySave(doc);
        for (const s of secrets) {
          expect(
            json.includes(s),
            `LEAK: seed=${seed} viewer=${viewer} secret=${s} survived in JSON ` +
              `(re-run with this seed to reproduce)`
          ).toBe(false);
        }
        // Positive control: the public-keep label survives the
        // non-coord projection.  Asserts the scrubber doesn't
        // over-strip (regression hedge against a future "strip
        // ALL map-blob labels" change).
        if (log.events().some((e) => e.kind === 'map-blob-reveal')) {
          expect(
            json.includes('PUBLIC_LABEL_KEEP_ME'),
            `OVER-STRIP: seed=${seed} viewer=${viewer} dropped a REVEALED ` +
              `map-blob label — scrubber is too aggressive`
          ).toBe(true);
        }
      }
    }
  });

  it('no-current-coordinator viewer is treated as non-coord (defense for yielded-DM case)', () => {
    // Same threat model as state.firewall-fuzz: even when nobody
    // currently holds coord, the save must not leak DM material.
    const seed = 0xabcdef;
    const { log, secrets } = buildLeakyLog(seed);
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'dm', // who saved
      undefined // current coord — nobody
    );
    const json = stringifySave(doc);
    for (const s of secrets) {
      expect(
        json.includes(s),
        `LEAK (no-coord): seed=${seed} secret=${s} survived in JSON`
      ).toBe(false);
    }
  });
});

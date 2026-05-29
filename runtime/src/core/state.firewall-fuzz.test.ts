// @vitest-environment node

/**
 * #406 (2026-05-28, senior Test/Architecture consultancy): a
 * taint-fuzz of the LIVE viewer projection (`filterForViewer`).
 *
 * The existing firewall tests are example-based (assert specific
 * named fields are absent) or schema-driven for the SAVE path
 * (persistence.coverage.test.ts).  This is the complementary fuzz of
 * the live STATE projection: every DM-only free-text value written
 * into state gets a UNIQUE sentinel (`DM_SECRET_<n>`), and after
 * projecting for a non-coord viewer we assert NO sentinel survives —
 * anywhere, by deep scan.  The taint approach catches a leak
 * regardless of WHICH field forgot to strip, so a future DM-only
 * field added without a strip surfaces here without anyone updating
 * an enumerated assertion list.
 *
 * Seed-logged + deterministic (mulberry32) so a failure is
 * reproducible.
 */

import { describe, it, expect } from 'vitest';
import { EventLog } from './event-log';
import { materialize, filterForViewer } from './state';

const SECRET_PREFIX = 'DM_SECRET_';

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
 * Deep scan for a substring across strings, arrays, plain objects,
 * Set + Map values.  (JSON.stringify alone drops Set/Map contents, so
 * a naive stringify could miss a sentinel hiding in one.)
 */
function deepContains(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle);
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof Set) {
    for (const v of value) if (deepContains(v, needle)) return true;
    return false;
  }
  if (value instanceof Map) {
    for (const [k, v] of value) {
      if (deepContains(k, needle) || deepContains(v, needle)) return true;
    }
    return false;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (deepContains(v, needle)) return true;
  }
  return false;
}

/**
 * Build a coordinator-authored log saturated with DM-only material.
 * Every DM-only FREE-TEXT value is a unique sentinel.  Covers three
 * distinct strip mechanisms: per-field record/overlay strip (dmNotes,
 * tax.releaseMoment, magicPhase), wholesale state-object wipe
 * (scratchNotes, casterState), and the curated #398 slice carve-out
 * (knowsTheyCanCast + tax.active stay; tax.releaseMoment must NOT).
 */
function buildLeakyLog(seed: number): { log: EventLog; secrets: string[] } {
  const rng = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const log = new EventLog('dm');
  const secrets: string[] = [];
  let n = 0;
  const secret = (): string => {
    const s = `${SECRET_PREFIX}${seed}_${n++}`;
    secrets.push(s);
    return s;
  };

  log.append('coordinator-claim', {});
  // A couple of PCs to attach DM-only material to.
  for (const pcId of ['pc1', 'pc2']) {
    log.append('pc-create', {
      v: 1,
      pcId,
      name: pcId,
      pronouns: 'they/them',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: ['Tech'],
      backstory: 'public backstory'
    });
  }

  const steps = 15 + Math.floor(rng() * 20);
  for (let i = 0; i < steps; i++) {
    const pcId = pick(['pc1', 'pc2']);
    switch (Math.floor(rng() * 6)) {
      case 0:
        log.append('pc-edit', { v: 1, pcId, field: 'dmNotes', value: secret() });
        break;
      case 1:
        log.append('pc-edit', {
          v: 1,
          pcId,
          field: 'tax.releaseMoment',
          value: secret()
        });
        break;
      case 2:
        log.append('scratch-note', { v: 1, text: secret() });
        break;
      case 3:
        log.append('caster-state-set', {
          v: 1,
          pcId,
          ladderState: pick(['quiet', 'noticed', 'watched']),
          reason: secret(),
          taxActive: rng() < 0.5,
          spamCount: Math.floor(rng() * 3)
        });
        break;
      case 4:
        // Player-visible noise (must NOT be a sentinel) — exercises the
        // pass-through path alongside the strips.
        log.append('pc-edit', {
          v: 1,
          pcId,
          field: 'harm',
          value: Math.floor(rng() * 4)
        });
        break;
      case 5:
        log.append('thread-debt-set', {
          v: 1,
          pcId,
          level: pick(['quiet', 'noticed', 'watched', 'hunted'])
        });
        break;
    }
  }
  return { log, secrets };
}

describe('#406 firewall taint-fuzz — no DM-only free-text reaches a player projection', () => {
  it('40 seeded leaky scenarios: no sentinel survives filterForViewer for any non-coord viewer', () => {
    for (let scenario = 0; scenario < 40; scenario++) {
      const seed = 0xf17e + scenario * 6151;
      const { log, secrets } = buildLeakyLog(seed);
      expect(secrets.length).toBeGreaterThan(0); // the fuzz actually planted secrets
      const state = materialize(log.events());

      // Sanity: the COORD's own (identity) view DOES still hold the
      // secrets — proves the test planted real DM-only data, not nothing.
      const coordView = filterForViewer(state, 'dm');
      expect(
        secrets.some((s) => deepContains(coordView, s)),
        `seed=${seed}: expected DM view to retain planted secrets`
      ).toBe(true);

      // Several non-coord viewers (none is the coord) — none may see ANY sentinel.
      for (const viewer of ['player-a', 'player-b', 'outsider', 'zzz']) {
        const projection = filterForViewer(state, viewer);
        for (const s of secrets) {
          expect(
            deepContains(projection, s),
            `LEAK: seed=${seed} viewer=${viewer} leaked ${s} ` +
              `(re-run with this seed to reproduce)`
          ).toBe(false);
        }
      }
    }
  });

  it('the curated #398 slice keeps booleans but still strips DM-only free-text on the viewer\'s OWN realized PC', () => {
    // Build a realized PC owned by the viewer, with a tainted
    // tax.releaseMoment + dmNotes.  The viewer SHOULD see
    // knowsTheyCanCast/tax.active (booleans), but NEVER the sentinels.
    const log = new EventLog('dm');
    log.append('coordinator-claim', {});
    log.append('peer-join', { v: 1, name: 'Alice' }); // dm-authored is fine; peers map
    log.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: ['Tech'],
      backstory: 'public'
    });
    // Realize mei (knowsTheyCanCast + tax.active) and taint the DM-only bits.
    log.append('pc-mark-realization', { v: 1, pcId: 'mei' });
    log.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'tax.releaseMoment',
      value: `${SECRET_PREFIX}release`
    });
    log.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'dmNotes',
      value: `${SECRET_PREFIX}notes`
    });
    const state = materialize(log.events());
    // Bind the viewer 'alice' to mei the way the runtime resolves own-PC.
    state.peers['alice'] = { peerId: 'alice', name: 'Alice', joinedAt: 1, pcId: 'mei' };
    state.pcSlots[1] = { state: 'bound-active', pcId: 'mei', controllerPeerId: 'alice' };

    const view = filterForViewer(state, 'alice');
    // The player-perceivable booleans survive (#398).
    expect(view.pcEdits['mei'].knowsTheyCanCast).toBe(true);
    expect(view.pcEdits['mei']['tax.active']).toBe(true);
    // But NO DM-only free-text sentinel leaks, even on the own PC.
    expect(deepContains(view, `${SECRET_PREFIX}release`)).toBe(false);
    expect(deepContains(view, `${SECRET_PREFIX}notes`)).toBe(false);
  });
});

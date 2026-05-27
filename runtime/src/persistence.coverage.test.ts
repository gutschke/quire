/**
 * Wave D-prep-1 (2026-05-26) CI lint — event-kind firewall
 * classification floor.
 *
 * Every event kind in KNOWN_EVENT_KINDS MUST appear in exactly
 * one of:
 *   - `PLAYER_SCOPE_STRIP_KINDS`         (DM-only payload)
 *   - `EVENT_KINDS_PLAYER_VISIBLE`       (player-visible payload)
 *
 * Adding a new event kind WITHOUT classifying it triggers this
 * test.  The fix is to read the new kind's materializer + payload
 * and decide: would a non-coord peer's autosave file contain
 * material the spoiler-firewall should hide?  Then add to the
 * appropriate set in `persistence.ts`.
 *
 * The Wave A → Wave B regression that motivated this lint:
 * Wave B added `accidental-grant-log` as a coord-only event
 * carrying DM-typed silent-grant text, but forgot to add it to
 * `PLAYER_SCOPE_STRIP_KINDS`.  Player autosaves silently leaked
 * the DM's silent-grant prose.  This test would have caught it.
 */

import { describe, it, expect } from 'vitest';
import { KNOWN_EVENT_KINDS } from './core/state';
import {
  EVENT_KINDS_PLAYER_VISIBLE,
  PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS
} from './persistence';

describe('event-kind firewall classification (Wave D-prep-1)', () => {
  it('every KNOWN_EVENT_KIND is classified in exactly one of the two visibility sets', () => {
    const strip = PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS;
    const visible = EVENT_KINDS_PLAYER_VISIBLE;
    const unclassified: string[] = [];
    const doubleClassified: string[] = [];
    for (const kind of KNOWN_EVENT_KINDS) {
      const inStrip = strip.has(kind);
      const inVisible = visible.has(kind);
      if (!inStrip && !inVisible) unclassified.push(kind);
      if (inStrip && inVisible) doubleClassified.push(kind);
    }
    // Both failure modes get distinct messages so the engineer who
    // sees the red CI knows what to do.
    expect(unclassified, [
      'New event kind(s) lack a visibility classification.',
      'Add each to PLAYER_SCOPE_STRIP_KINDS (DM-only payload) OR',
      'EVENT_KINDS_PLAYER_VISIBLE (player-visible payload) in',
      'src/persistence.ts.',
      `Unclassified: ${unclassified.join(', ')}`
    ].join(' ')).toEqual([]);
    expect(doubleClassified, [
      'Event kind(s) are in BOTH visibility sets — pick one.',
      `Double-classified: ${doubleClassified.join(', ')}`
    ].join(' ')).toEqual([]);
  });

  it('PLAYER_SCOPE_STRIP_KINDS does not include any player-visible kinds', () => {
    // Symmetric to the test above but phrased as a positive
    // invariant: anything in the strip list is, by definition,
    // not player-visible.
    const strip = PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS;
    const visible = EVENT_KINDS_PLAYER_VISIBLE;
    for (const kind of strip) {
      expect(visible.has(kind), `${kind} is in PLAYER_SCOPE_STRIP_KINDS but also EVENT_KINDS_PLAYER_VISIBLE`).toBe(false);
    }
  });

  it('regression: accidental-grant-log IS stripped (Wave A class regression in Wave B)', () => {
    // Pin the Wave D-prep-1 BLOCKER fix.  The original Wave A
    // commit fixed scratch-note + ai-prompt etc; Wave B added
    // accidental-grant-log but forgot the persistence-side strip.
    // Adversarial expert caught it 30 minutes after Wave B shipped.
    // Test ensures it stays fixed.
    expect(PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS.has('accidental-grant-log')).toBe(true);
    expect(EVENT_KINDS_PLAYER_VISIBLE.has('accidental-grant-log')).toBe(false);
  });

  it('focus-grant is player-visible (Realization-beat payoff)', () => {
    // Counterpart to the test above — proves the test correctly
    // distinguishes coord-authored-DM-only from coord-authored-
    // player-visible.  Foci are player-visible by design (the
    // Realization beat IS the player seeing their focus).
    expect(EVENT_KINDS_PLAYER_VISIBLE.has('focus-grant')).toBe(true);
    expect(PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS.has('focus-grant')).toBe(false);
  });

  it('seat-memory-edit is player-visible (player-safe by construction)', () => {
    expect(EVENT_KINDS_PLAYER_VISIBLE.has('seat-memory-edit')).toBe(true);
    expect(PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS.has('seat-memory-edit')).toBe(false);
  });
});

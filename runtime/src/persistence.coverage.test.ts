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
  EVENT_KINDS_NO_SCRUB_NEEDED,
  EVENT_KINDS_PLAYER_VISIBLE,
  PER_KIND_SCRUBBER_KINDS_FOR_TESTS,
  PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS,
  serializeSessionForViewer
} from './persistence';
import { DM_ONLY_CHARACTER_FIELDS } from './character-loader';
import type { QuireEvent } from './core/event-log';

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

describe('field-granularity firewall classification (Wave D-prep-2-A)', () => {
  /**
   * Verifier finding #8 (build d03f888 D-prep-2 audit): iterate
   * the SOURCE-OF-TRUTH list `DM_ONLY_CHARACTER_FIELDS` and assert
   * every field gets stripped when emitted as a `pc-edit` payload
   * for a non-coord viewer.  Pre-fix, the regression tests
   * hardcoded 6 example fields and missed `accidentalGrants`.
   * This lint converts "I remembered the examples I wrote" into
   * "every future addition to `DM_ONLY_CHARACTER_FIELDS` is
   * automatically covered" — same pattern that turned the Wave
   * A→B `accidental-grant-log` regression from a 30-minute
   * adversarial catch into a compile-time fail.
   */

  function pcEditEvent(
    field: string,
    value: unknown = 'DM-only test value'
  ): QuireEvent {
    return {
      id: `evt-${field}-${Math.random()}`,
      kind: 'pc-edit',
      ts: 1,
      peerId: 'p1',
      seq: 1,
      clock: {},
      payload: { v: 1, pcId: 'mei', field, value }
    };
  }

  it('every DM_ONLY_CHARACTER_FIELDS entry strips via serializeSessionForViewer when emitted as pc-edit', () => {
    // Build one pc-edit per DM-only field; serialize for a
    // non-coord viewer; assert ZERO of them survive.
    const events = DM_ONLY_CHARACTER_FIELDS.map((f) => pcEditEvent(f));
    // Plus a player-visible pc-edit as a positive control —
    // proves the test mechanism actually runs the filter.
    events.push(pcEditEvent('harm', 2));
    const doc = serializeSessionForViewer(
      events,
      { owner: 'o', repo: 'r', ref: 'main' },
      'PLAYER',
      'HOST'
    );
    const survivingFields = (
      doc.events.filter((e) => e.kind === 'pc-edit') as Array<{
        payload?: { field?: string };
      }>
    ).map((e) => e.payload?.field ?? '');
    // Positive control: harm survives.
    expect(survivingFields).toContain('harm');
    // Every DM-only field stripped.
    for (const f of DM_ONLY_CHARACTER_FIELDS) {
      expect(survivingFields, `field "${f}" leaked to player save`).not.toContain(f);
    }
  });

  it('dotted-field forms of DM-only fields ALSO strip (tax.releaseMoment, threadDebt.rung, etc.)', () => {
    // Top-level prefix match: any pc-edit whose field starts with
    // a DM-only top-level field name should drop.
    const dottedExamples: string[] = [];
    for (const f of DM_ONLY_CHARACTER_FIELDS) {
      // Two common dotted shapes per top-level field.
      dottedExamples.push(`${f}.someSubField`);
      dottedExamples.push(`${f}.deep.nested.path`);
    }
    const events = dottedExamples.map((f) => pcEditEvent(f));
    const doc = serializeSessionForViewer(
      events,
      { owner: 'o', repo: 'r', ref: 'main' },
      'PLAYER',
      'HOST'
    );
    // None of the dotted forms should survive.
    expect(
      doc.events.filter((e) => e.kind === 'pc-edit').length,
      'dotted DM-only pc-edits leaked'
    ).toBe(0);
  });

  it('coord viewer keeps every DM_ONLY_CHARACTER_FIELDS pc-edit (DM resilience)', () => {
    // The scrub is non-coord ONLY.  The DM's own save needs the
    // full DM-only event log for crash-recovery.
    const events = DM_ONLY_CHARACTER_FIELDS.map((f) => pcEditEvent(f));
    const doc = serializeSessionForViewer(
      events,
      { owner: 'o', repo: 'r', ref: 'main' },
      'HOST',
      'HOST'
    );
    const survivingFields = (
      doc.events.filter((e) => e.kind === 'pc-edit') as Array<{
        payload?: { field?: string };
      }>
    ).map((e) => e.payload?.field ?? '');
    for (const f of DM_ONLY_CHARACTER_FIELDS) {
      expect(survivingFields).toContain(f);
    }
  });

  /**
   * M1 (2026-05-29 save-restore program, Adversarial #3): the
   * `PER_KIND_SCRUBBERS` registry is now self-completing.  Every
   * kind in `EVENT_KINDS_PLAYER_VISIBLE` MUST appear in exactly one
   * of:
   *   - `PER_KIND_SCRUBBERS`        (payload has DM-only sub-fields)
   *   - `EVENT_KINDS_NO_SCRUB_NEEDED` (payload is uniformly safe)
   *
   * Adding a new player-visible kind without making this decision
   * trips the lint.  The fix is to read the new kind's payload
   * and ask: "if a player Cmd+S's the autosave and opens the JSON
   * in a text editor, does any field carry DM-typed text, AI
   * provenance, or cross-event-derived DM state?"  Yes → scrubber.
   * No → no-scrub-needed list with rationale.
   *
   * This catches the regression class that produced the Adversarial
   * #1 (map-blob label leak) finding — `map-blob-add` was in
   * `EVENT_KINDS_PLAYER_VISIBLE` for months without a scrubber.
   */
  it('every player-visible kind has a scrubber OR is in EVENT_KINDS_NO_SCRUB_NEEDED', () => {
    const visible = EVENT_KINDS_PLAYER_VISIBLE;
    const scrubbed = PER_KIND_SCRUBBER_KINDS_FOR_TESTS;
    const noScrub = EVENT_KINDS_NO_SCRUB_NEEDED;
    const unclassified: string[] = [];
    const doubleClassified: string[] = [];
    for (const kind of visible) {
      const inScrubbed = scrubbed.has(kind);
      const inNoScrub = noScrub.has(kind);
      if (!inScrubbed && !inNoScrub) unclassified.push(kind);
      if (inScrubbed && inNoScrub) doubleClassified.push(kind);
    }
    expect(unclassified, [
      'New player-visible event kind(s) lack a field-level scrubbing',
      'classification.  Read the kind\'s payload and add it to EITHER:',
      '  - PER_KIND_SCRUBBERS in persistence.ts (payload has DM-only',
      '    sub-fields), OR',
      '  - EVENT_KINDS_NO_SCRUB_NEEDED with a one-phrase rationale',
      '    (payload is uniformly player-safe).',
      `Unclassified: ${unclassified.join(', ')}`
    ].join(' ')).toEqual([]);
    expect(doubleClassified, [
      'Event kind(s) are in BOTH PER_KIND_SCRUBBERS and',
      'EVENT_KINDS_NO_SCRUB_NEEDED — pick one.',
      `Double-classified: ${doubleClassified.join(', ')}`
    ].join(' ')).toEqual([]);
  });

  it('EVENT_KINDS_NO_SCRUB_NEEDED only contains kinds classified player-visible', () => {
    // Symmetric guard: a kind in PLAYER_SCOPE_STRIP_KINDS doesn't need
    // to be in no-scrub-needed (it's stripped entirely first).  Adding
    // it here is a sign of confused intent.
    for (const kind of EVENT_KINDS_NO_SCRUB_NEEDED) {
      expect(
        EVENT_KINDS_PLAYER_VISIBLE.has(kind),
        `${kind} is in EVENT_KINDS_NO_SCRUB_NEEDED but not EVENT_KINDS_PLAYER_VISIBLE`
      ).toBe(true);
      expect(
        PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS.has(kind),
        `${kind} is in EVENT_KINDS_NO_SCRUB_NEEDED AND PLAYER_SCOPE_STRIP_KINDS — pick one`
      ).toBe(false);
    }
  });

  it('regression: map-blob-add is registered as a scrubber (Adversarial #1 fix)', () => {
    // Pin the M1 fix.  Pre-fix, map-blob-add was player-visible
    // with no scrubber — staged-but-unrevealed labels leaked to
    // every player's save.  Test ensures it stays registered.
    expect(PER_KIND_SCRUBBER_KINDS_FOR_TESTS.has('map-blob-add')).toBe(true);
    expect(PER_KIND_SCRUBBER_KINDS_FOR_TESTS.has('map-blob-move')).toBe(true);
    expect(EVENT_KINDS_NO_SCRUB_NEEDED.has('map-blob-add')).toBe(false);
  });

  it('focus-grant DM-only payload fields (boundFor, notes) strip; condition + name + domain survive', () => {
    // condition is player-visible per cross-expert resolution
    // (TTRPG over Adversarial — rules.md:139 says the player who
    // owns the focus needs to know when it fires).
    const event: QuireEvent = {
      id: 'evt-fg-1',
      kind: 'focus-grant',
      ts: 1,
      peerId: 'p1',
      seq: 1,
      clock: {},
      payload: {
        v: 1,
        pcId: 'mei',
        focus: {
          name: 'pattern-sense',
          domain: 'perception',
          condition: 'when held in moonlight',
          boundFor: 'DM-private narrative anchor',
          notes: 'DM observation about this focus'
        }
      }
    };
    const doc = serializeSessionForViewer(
      [event],
      { owner: 'o', repo: 'r', ref: 'main' },
      'PLAYER',
      'HOST'
    );
    const grants = doc.events.filter((e) => e.kind === 'focus-grant') as Array<{
      payload?: { focus?: Record<string, unknown> };
    }>;
    expect(grants).toHaveLength(1);
    const focus = grants[0].payload?.focus ?? {};
    // Player-visible fields survive.
    expect(focus.name).toBe('pattern-sense');
    expect(focus.domain).toBe('perception');
    expect(focus.condition).toBe('when held in moonlight');
    // DM-only fields stripped.
    expect(focus.boundFor).toBeUndefined();
    expect(focus.notes).toBeUndefined();
  });
});

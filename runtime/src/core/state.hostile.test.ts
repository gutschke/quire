/**
 * Materializer payload-validation tests.  The pc-edit case is the
 * highest-risk because a hostile peer can otherwise:
 *
 *   - shadow any real PC by sending pcId='<real-pc-id>' with
 *     arbitrary field/value (overwrites the live sheet)
 *   - corrupt iteration via prototype-key pcIds ('__proto__')
 *   - cause the renderer to crash with non-string pcId/field
 *
 * Other event kinds also depend on string-typed payload fields
 * (chat.text, scene-reveal.scenePath, dice-roll.expression); a
 * non-string or non-finite value passed through would render as
 * "[object Object]" / "NaN" or crash array helpers.  These are
 * pinned here so a future "loosen the type and trust the input"
 * change is caught.
 */

import { describe, it, expect } from 'vitest';
import { materialize } from './state';
import type { QuireEvent } from './event-log';

function ev(
  peerId: string,
  seq: number,
  kind: string,
  payload: unknown
): QuireEvent {
  return {
    id: `${peerId}:${seq}`,
    peerId,
    seq,
    clock: { [peerId]: seq },
    kind,
    payload,
    ts: Date.now()
  };
}

describe('materialize — pc-edit hostile payloads', () => {
  it('rejects pc-edit with non-string pcId', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: 42, field: 'harm', value: 1 })
    ]);
    expect(s.pcEdits).toEqual({});
  });

  it('rejects pc-edit with prototype-poisoning pcId', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: '__proto__', field: 'harm', value: 1 })
    ]);
    expect(s.pcEdits).toEqual({});
    // And the prototype is unpolluted.
    expect(({} as Record<string, unknown>).harm).toBeUndefined();
  });

  it('rejects pc-edit with empty / over-cap pcId', () => {
    const s1 = materialize([
      ev('alice', 1, 'pc-edit', { pcId: '', field: 'harm', value: 1 })
    ]);
    expect(s1.pcEdits).toEqual({});
    const huge = 'x'.repeat(257);
    const s2 = materialize([
      ev('alice', 1, 'pc-edit', { pcId: huge, field: 'harm', value: 1 })
    ]);
    expect(s2.pcEdits).toEqual({});
  });

  it('rejects pc-edit with non-string field', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: 'pc1', field: 42, value: 1 })
    ]);
    expect(s.pcEdits).toEqual({});
  });

  it('rejects pc-edit with prototype-poisoning field', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', {
        pcId: 'pc1',
        field: '__proto__',
        value: { polluted: true }
      })
    ]);
    expect(s.pcEdits).toEqual({});
  });

  it('accepts legitimate pc-edit', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: 'pc1', field: 'harm', value: 2 })
    ]);
    expect(s.pcEdits).toEqual({ pc1: { harm: 2 } });
  });

  it('rejects pcId with spaces / slashes / dot-segments', () => {
    // The state.ts validator now mirrors character-loader.ts's
    // ID_RE — pcIds that could never be loaded by loadCharacter
    // should never make it into pcEdits.
    for (const bad of ['has space', 'has/slash', '../escape', '.', '..']) {
      const s = materialize([
        ev('alice', 1, 'pc-edit', { pcId: bad, field: 'harm', value: 1 })
      ]);
      expect(s.pcEdits).toEqual({});
    }
  });

  it('caps the number of distinct fields per PC (DoS guard)', () => {
    const events: QuireEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(
        ev('alice', i + 1, 'pc-edit', {
          pcId: 'pc1',
          field: `f${i}`,
          value: i
        })
      );
    }
    const s = materialize(events);
    expect(Object.keys(s.pcEdits.pc1).length).toBeLessThanOrEqual(100);
  });

  it('allows continued updates to an existing field once cap reached', () => {
    const events: QuireEvent[] = [];
    for (let i = 0; i < 100; i++) {
      events.push(
        ev('alice', i + 1, 'pc-edit', {
          pcId: 'pc1',
          field: `f${i}`,
          value: i
        })
      );
    }
    // Add a 101st DISTINCT field — should be rejected.
    events.push(
      ev('alice', 101, 'pc-edit', {
        pcId: 'pc1',
        field: 'too-many',
        value: 99
      })
    );
    // But an UPDATE to an existing field should still land (LWW).
    events.push(
      ev('alice', 102, 'pc-edit', {
        pcId: 'pc1',
        field: 'f0',
        value: 999
      })
    );
    const s = materialize(events);
    expect(Object.keys(s.pcEdits.pc1).length).toBe(100);
    expect(s.pcEdits.pc1.f0).toBe(999);
    expect(s.pcEdits.pc1['too-many']).toBeUndefined();
  });
});

describe('materialize — note hostile payloads', () => {
  it('drops non-boolean private', () => {
    const events: QuireEvent[] = [
      ev('alice', 1, 'note', { text: 'a', private: 'yes' as unknown }),
      ev('alice', 2, 'note', { text: 'b', private: 1 as unknown }),
      ev('alice', 3, 'note', { text: 'c', private: { malicious: true } as unknown })
    ];
    const s = materialize(events);
    // All notes accepted (text is valid); only the private field
    // gets coerced to undefined when not strictly boolean.
    expect(s.notes).toHaveLength(3);
    for (const n of s.notes) expect(n.private).toBeUndefined();
  });

  it('preserves a true / false private', () => {
    const s = materialize([
      ev('alice', 1, 'note', { text: 'a', private: true }),
      ev('alice', 2, 'note', { text: 'b', private: false })
    ]);
    expect(s.notes[0].private).toBe(true);
    expect(s.notes[1].private).toBe(false);
  });
});

describe('materialize — chat hostile payloads', () => {
  it('drops non-string text', () => {
    const s = materialize([ev('alice', 1, 'chat', { text: 42 })]);
    expect(s.chat).toEqual([]);
  });

  it('drops over-length text', () => {
    const s = materialize([
      ev('alice', 1, 'chat', { text: 'x'.repeat(5001) })
    ]);
    expect(s.chat).toEqual([]);
  });

  it('drops missing payload', () => {
    const s = materialize([ev('alice', 1, 'chat', null)]);
    expect(s.chat).toEqual([]);
  });
});

describe('materialize — scene-reveal hostile payloads', () => {
  it('drops non-string scenePath', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('alice', 2, 'scene-reveal', { scenePath: 42 })
    ];
    const s = materialize(events);
    expect(s.revealedScenes).toEqual([]);
  });

  it('drops over-length scenePath', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('alice', 2, 'scene-reveal', { scenePath: 'x'.repeat(2049) })
    ];
    const s = materialize(events);
    expect(s.revealedScenes).toEqual([]);
  });
});

describe('materialize — dice-roll hostile payloads', () => {
  it('drops missing or non-string expression', () => {
    const s1 = materialize([ev('alice', 1, 'dice-roll', { result: 7, dice: [1, 6] })]);
    expect(s1.diceRolls).toEqual([]);
    const s2 = materialize([
      ev('alice', 1, 'dice-roll', { expression: 42, result: 7, dice: [1, 6] })
    ]);
    expect(s2.diceRolls).toEqual([]);
  });

  it('drops non-array dice', () => {
    const s = materialize([
      ev('alice', 1, 'dice-roll', {
        expression: '2d6',
        result: 7,
        dice: 'not an array'
      })
    ]);
    expect(s.diceRolls).toEqual([]);
  });
});

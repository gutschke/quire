// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { extractSlotFingerprints, type SourceDoc } from './slot-fingerprints';

describe('extractSlotFingerprints', () => {
  it('groups excerpts per slot with surrounding context', () => {
    const docs: SourceDoc[] = [
      {
        path: 'scenes/03-the-hack.md',
        body:
          '## What {{pc:3}} is actually doing\n\n' +
          '{{pc:3}} carries a small SDR — a USB-stick-sized receiver — and runs an open-source decoder.\n'
      },
      {
        path: 'scenes/07-the-gate.md',
        body:
          'At the gate the flight attendant briefly holds {{pc:1}}\'s anti-static bag while the line shifts.\n'
      },
      {
        path: 'dm/the-gate.md',
        body:
          '| {{pc:1}}\'s phone timeline | small gap | personal instrument; gaps are its natural state |'
      }
    ];

    const fps = extractSlotFingerprints(docs);
    expect(fps.map((f) => f.slot)).toEqual([1, 3]);
    const slot1 = fps.find((f) => f.slot === 1)!;
    expect(slot1.mentions).toBe(2);
    expect(slot1.excerpts).toHaveLength(2);
    expect(slot1.excerpts[0].path).toBe('scenes/07-the-gate.md');
    expect(slot1.excerpts[0].excerpt).toContain('anti-static bag');
    expect(slot1.excerpts[1].path).toBe('dm/the-gate.md');
    expect(slot1.excerpts[1].excerpt).toContain('phone timeline');

    const slot3 = fps.find((f) => f.slot === 3)!;
    expect(slot3.mentions).toBe(2);
    expect(slot3.excerpts.some((e) => e.excerpt.includes('SDR'))).toBe(true);
  });

  it('returns an empty list when no documents mention any slot', () => {
    const fps = extractSlotFingerprints([
      { path: 'scenes/cold.md', body: 'The scene opens at 3 a.m.  No pc refs here.' }
    ]);
    expect(fps).toEqual([]);
  });

  it('caps excerpts per slot at 6', () => {
    const body = '{{pc:1}} '.repeat(20);
    const docs: SourceDoc[] = [{ path: 'spam.md', body }];
    const fps = extractSlotFingerprints(docs);
    expect(fps[0].mentions).toBe(20);
    expect(fps[0].excerpts).toHaveLength(6);
  });

  it('ignores malformed pc refs', () => {
    const fps = extractSlotFingerprints([
      { path: 'bad.md', body: '{{pc:}} {{pc:0}} {{pc:abc}} {{pc:1}} {{pcc:1}}' }
    ]);
    expect(fps.map((f) => f.slot)).toEqual([1]);
    expect(fps[0].mentions).toBe(1);
  });
});

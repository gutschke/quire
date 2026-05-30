// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { computeLineDiff, InlineDiff } from './inline-diff';
import './inline-diff';

describe('computeLineDiff', () => {
  it('identical text → all-same hunks', () => {
    const a = 'one\ntwo\nthree';
    const hunks = computeLineDiff(a, a);
    expect(hunks).toHaveLength(3);
    expect(hunks.every((h) => h.kind === 'same')).toBe(true);
  });

  it('pure addition → adds at end', () => {
    const hunks = computeLineDiff('a\nb', 'a\nb\nc');
    expect(hunks).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'add', text: 'c' }
    ]);
  });

  it('pure deletion → dels at end', () => {
    const hunks = computeLineDiff('a\nb\nc', 'a\nb');
    expect(hunks).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'del', text: 'c' }
    ]);
  });

  it('substitution → del followed by add', () => {
    const hunks = computeLineDiff('alpha\nbeta\ngamma', 'alpha\nBETA\ngamma');
    // LCS picks beta vs BETA as different → del+add.
    expect(hunks).toEqual([
      { kind: 'same', text: 'alpha' },
      { kind: 'del', text: 'beta' },
      { kind: 'add', text: 'BETA' },
      { kind: 'same', text: 'gamma' }
    ]);
  });

  it('empty baseline → all adds', () => {
    const hunks = computeLineDiff('', 'new');
    expect(hunks).toEqual([
      { kind: 'del', text: '' },
      { kind: 'add', text: 'new' }
    ]);
  });

  it('UX-MH-3 pronoun-swap shape: surgical edit shows one del+add per changed line', () => {
    const baseline = [
      'Mei grew up by the Underleaf.',
      'She trained as a nurse.',
      'She climbs in her off-time.'
    ].join('\n');
    const proposed = [
      'Mei grew up by the Underleaf.',
      'They trained as a nurse.',
      'They climb in their off-time.'
    ].join('\n');
    const hunks = computeLineDiff(baseline, proposed);
    const adds = hunks.filter((h) => h.kind === 'add');
    const dels = hunks.filter((h) => h.kind === 'del');
    expect(adds.length).toBe(2);
    expect(dels.length).toBe(2);
    // First/last lines unchanged.
    expect(hunks[0]).toEqual({
      kind: 'same',
      text: 'Mei grew up by the Underleaf.'
    });
  });
});

describe('<inline-diff>', () => {
  it('renders one line per hunk with appropriate class', async () => {
    const el = document.createElement('inline-diff') as InlineDiff;
    el.baseline = 'a\nb';
    el.proposed = 'a\nc';
    document.body.appendChild(el);
    await el.updateComplete;
    const lines = el.querySelectorAll('.inline-diff-line');
    expect(lines.length).toBe(3); // same, del, add
    expect(lines[0].classList.contains('inline-diff-line-same')).toBe(true);
    expect(lines[1].classList.contains('inline-diff-line-del')).toBe(true);
    expect(lines[2].classList.contains('inline-diff-line-add')).toBe(true);
    el.remove();
  });

  it('has ARIA region label', async () => {
    const el = document.createElement('inline-diff') as InlineDiff;
    el.baseline = 'a';
    el.proposed = 'b';
    document.body.appendChild(el);
    await el.updateComplete;
    const region = el.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')).toContain('diff');
    el.remove();
  });
});

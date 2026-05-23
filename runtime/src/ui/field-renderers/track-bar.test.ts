// @vitest-environment happy-dom

/**
 * <track-bar> tests — Phase B P1d (2026-05-23).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './track-bar';
import type { TrackBar } from './track-bar';
import {
  DEFAULT_HARM_RULES,
  DEFAULT_STRESS_RULES
} from './track-bar';

function mount(props: Partial<TrackBar> = {}): TrackBar {
  const el = document.createElement('track-bar') as TrackBar;
  if (props.kind !== undefined) el.kind = props.kind;
  if (props.value !== undefined) el.value = props.value;
  if (props.editable !== undefined) el.editable = props.editable;
  if (props.ruleText !== undefined) el.ruleText = props.ruleText;
  if (props.onSetValue !== undefined) el.onSetValue = props.onSetValue;
  document.body.appendChild(el);
  return el;
}

describe('<track-bar>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders 4 boxes regardless of fill', async () => {
    const el = mount({ kind: 'harm', value: 0 });
    await el.updateComplete;
    expect(el.querySelectorAll('.track-bar-box').length).toBe(4);
  });

  it('marks boxes 1..value as filled', async () => {
    const el = mount({ kind: 'stress', value: 2 });
    await el.updateComplete;
    const boxes = el.querySelectorAll('.track-bar-box');
    expect(boxes[0]!.classList.contains('track-bar-box-filled')).toBe(true);
    expect(boxes[1]!.classList.contains('track-bar-box-filled')).toBe(true);
    expect(boxes[2]!.classList.contains('track-bar-box-filled')).toBe(false);
    expect(boxes[3]!.classList.contains('track-bar-box-filled')).toBe(false);
  });

  it('marks the box at position value+1 as track-bar-box-next', async () => {
    const el = mount({ kind: 'harm', value: 1 });
    await el.updateComplete;
    const boxes = el.querySelectorAll('.track-bar-box');
    expect(boxes[1]!.classList.contains('track-bar-box-next')).toBe(true);
    // No next when the track is full.
    document.body.innerHTML = '';
    const full = mount({ kind: 'harm', value: 4 });
    await full.updateComplete;
    expect(
      full.querySelectorAll('.track-bar-box-next').length
    ).toBe(0);
  });

  it('clamps a value outside 0..4 visually', async () => {
    const el = mount({ kind: 'harm', value: 99 });
    await el.updateComplete;
    // All 4 boxes filled, no "next" decoration past 4.
    expect(el.querySelectorAll('.track-bar-box-filled').length).toBe(4);
    expect(el.querySelectorAll('.track-bar-box-next').length).toBe(0);
  });

  it('disables boxes when editable=false', async () => {
    const el = mount({ kind: 'harm', value: 1, editable: false });
    await el.updateComplete;
    for (const box of el.querySelectorAll<HTMLButtonElement>('.track-bar-box')) {
      expect(box.disabled).toBe(true);
    }
  });

  it('fires onSetValue with the clicked box index when editable', async () => {
    const calls: number[] = [];
    const el = mount({
      kind: 'harm',
      value: 0,
      editable: true,
      onSetValue: (v) => calls.push(v)
    });
    await el.updateComplete;
    const box3 = el.querySelectorAll<HTMLButtonElement>('.track-bar-box')[2];
    box3!.click();
    expect(calls).toEqual([3]);
  });

  it('clicking the rightmost filled box clears it (down to value-1)', async () => {
    const calls: number[] = [];
    const el = mount({
      kind: 'stress',
      value: 3,
      editable: true,
      onSetValue: (v) => calls.push(v)
    });
    await el.updateComplete;
    const box3 = el.querySelectorAll<HTMLButtonElement>('.track-bar-box')[2];
    box3!.click();
    expect(calls).toEqual([2]);
  });

  it('clicking a box inside the filled stretch shrinks fill to that box', async () => {
    const calls: number[] = [];
    const el = mount({
      kind: 'harm',
      value: 3,
      editable: true,
      onSetValue: (v) => calls.push(v)
    });
    await el.updateComplete;
    const box1 = el.querySelectorAll<HTMLButtonElement>('.track-bar-box')[0];
    box1!.click();
    expect(calls).toEqual([1]);
  });

  it('clicking a box past the next-empty fills to that box', async () => {
    const calls: number[] = [];
    const el = mount({
      kind: 'harm',
      value: 1,
      editable: true,
      onSetValue: (v) => calls.push(v)
    });
    await el.updateComplete;
    const box4 = el.querySelectorAll<HTMLButtonElement>('.track-bar-box')[3];
    box4!.click();
    expect(calls).toEqual([4]);
  });

  it('does not fire onSetValue when editable=false', async () => {
    const calls: number[] = [];
    const el = mount({
      kind: 'harm',
      value: 0,
      editable: false,
      onSetValue: (v) => calls.push(v)
    });
    await el.updateComplete;
    el.querySelectorAll<HTMLButtonElement>('.track-bar-box')[0]!.click();
    expect(calls).toEqual([]);
  });

  it('wraps filled boxes AND the next-empty box in rule-hover (DM-glance hover)', async () => {
    const el = mount({ kind: 'stress', value: 2 });
    await el.updateComplete;
    // 2 filled + 1 next-empty = 3 hover wrappers.
    const hovers = el.querySelectorAll('rule-hover');
    expect(hovers.length).toBe(3);
  });

  it('uses default harm rule texts when kind=harm and ruleText is unset', async () => {
    const el = mount({ kind: 'harm', value: 0 });
    await el.updateComplete;
    const hover = el.querySelector('rule-hover');
    expect(hover?.getAttribute('text')).toBe(DEFAULT_HARM_RULES[0]);
  });

  it('uses default stress rule texts when kind=stress and ruleText is unset', async () => {
    const el = mount({ kind: 'stress', value: 0 });
    await el.updateComplete;
    const hover = el.querySelector('rule-hover');
    expect(hover?.getAttribute('text')).toBe(DEFAULT_STRESS_RULES[0]);
  });

  it('accepts a custom ruleText prop (V-10: campaign-declared track text)', async () => {
    const custom: [string, string, string, string] = [
      'rule 1',
      'rule 2',
      'rule 3',
      'rule 4'
    ];
    const el = mount({ kind: 'harm', value: 0, ruleText: custom });
    await el.updateComplete;
    const hover = el.querySelector('rule-hover');
    expect(hover?.getAttribute('text')).toBe('rule 1');
  });
});

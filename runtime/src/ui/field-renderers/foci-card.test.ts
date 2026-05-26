// @vitest-environment happy-dom

/**
 * <foci-card> tests — Phase B P1d (2026-05-26).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './foci-card';
import type { FociCard, FocusStatus } from './foci-card';
import type { Focus } from '../../character-loader';

function mount(props: Partial<FociCard> = {}): FociCard {
  const el = document.createElement('foci-card') as FociCard;
  if (props.foci !== undefined) el.foci = props.foci;
  if (props.editablePcId !== undefined) el.editablePcId = props.editablePcId;
  if (props.onSetFocusStatus !== undefined)
    el.onSetFocusStatus = props.onSetFocusStatus;
  document.body.appendChild(el);
  return el;
}

describe('<foci-card>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders empty state when foci array is empty', async () => {
    const el = mount({ foci: [] });
    await el.updateComplete;
    expect(el.querySelector('.foci-card-empty')).not.toBeNull();
    expect(el.textContent).toMatch(/No foci yet/);
  });

  it('renders one item per focus with name + status', async () => {
    const el = mount({
      foci: [
        { name: 'Yui\'s Promise', status: 'active' },
        { name: 'Old Library Card', status: 'faded' }
      ]
    });
    await el.updateComplete;
    const items = el.querySelectorAll('.foci-card-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toMatch(/Yui's Promise/);
    expect(items[0].textContent).toMatch(/active/);
    expect(items[1].textContent).toMatch(/Old Library Card/);
    expect(items[1].textContent).toMatch(/faded/);
  });

  it('defaults missing status to "active"', async () => {
    const el = mount({ foci: [{ name: 'No status' }] });
    await el.updateComplete;
    const item = el.querySelector('.foci-card-item');
    expect(item?.classList.contains('foci-card-status-active')).toBe(true);
  });

  it('renders optional fields (domain / boundFor / condition / notes) when present', async () => {
    const el = mount({
      foci: [
        {
          name: 'The Quiet',
          domain: 'silence between thoughts',
          boundFor: 'protecting Yui',
          condition: 'never spoken aloud',
          notes: 'manifested at the cabin'
        }
      ]
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/silence between thoughts/);
    expect(el.textContent).toMatch(/protecting Yui/);
    expect(el.textContent).toMatch(/never spoken aloud/);
    expect(el.textContent).toMatch(/manifested at the cabin/);
  });

  it('omits sections for fields that are absent', async () => {
    const el = mount({
      foci: [{ name: 'Bare focus' }]
    });
    await el.updateComplete;
    expect(el.querySelector('.foci-card-domain')).toBeNull();
    expect(el.querySelector('.foci-card-boundfor')).toBeNull();
    expect(el.querySelector('.foci-card-condition')).toBeNull();
    expect(el.querySelector('.foci-card-notes')).toBeNull();
  });

  it('read-only: status renders as <span>, not a button', async () => {
    const el = mount({
      foci: [{ name: 'Locked', status: 'broken' }],
      editablePcId: null
    });
    await el.updateComplete;
    const chip = el.querySelector('.foci-card-status-chip');
    expect(chip).not.toBeNull();
    expect(chip?.tagName).toBe('SPAN');
  });

  it('editable: status is a button that fires onSetFocusStatus on click', async () => {
    const calls: Array<[string, number, FocusStatus]> = [];
    const focus: Focus = { name: 'Cycle me', status: 'active' };
    const el = mount({
      foci: [focus],
      editablePcId: 'mei',
      onSetFocusStatus: (pcId, idx, next) => {
        calls.push([pcId, idx, next]);
      }
    });
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>('.foci-card-status-chip');
    expect(btn?.tagName).toBe('BUTTON');
    btn!.click();
    expect(calls).toEqual([['mei', 0, 'broken']]);
  });

  it('status cycle wraps: transformed → active', async () => {
    const calls: FocusStatus[] = [];
    const el = mount({
      foci: [{ name: 'Wrap', status: 'transformed' }],
      editablePcId: 'mei',
      onSetFocusStatus: (_pcId, _idx, next) => {
        calls.push(next);
      }
    });
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.foci-card-status-chip')!.click();
    expect(calls).toEqual(['active']);
  });

  it('editable but no callback: chip renders as button but click is no-op', async () => {
    // Defense-in-depth: the host might be mid-load where editablePcId
    // is set but the callback isn't wired yet.  Component should not
    // crash.
    const el = mount({
      foci: [{ name: 'X', status: 'active' }],
      editablePcId: 'mei',
      onSetFocusStatus: null
    });
    await el.updateComplete;
    // No callback → render as span (not editable).
    expect(el.querySelector('button.foci-card-status-chip')).toBeNull();
  });

  it('each altered status carries a distinct class for CSS theming', async () => {
    const el = mount({
      foci: [
        { name: 'a', status: 'active' },
        { name: 'b', status: 'broken' },
        { name: 'c', status: 'faded' },
        { name: 'd', status: 'corrupted' },
        { name: 'e', status: 'transformed' }
      ]
    });
    await el.updateComplete;
    const items = el.querySelectorAll('.foci-card-item');
    expect(items[0].classList.contains('foci-card-status-active')).toBe(true);
    expect(items[1].classList.contains('foci-card-status-broken')).toBe(true);
    expect(items[2].classList.contains('foci-card-status-faded')).toBe(true);
    expect(items[3].classList.contains('foci-card-status-corrupted')).toBe(
      true
    );
    expect(items[4].classList.contains('foci-card-status-transformed')).toBe(
      true
    );
  });

  it('cycles through every status in 5 clicks back to start', async () => {
    const sequence: FocusStatus[] = [];
    const el = mount({
      foci: [{ name: 'Walk', status: 'active' }],
      editablePcId: 'mei',
      onSetFocusStatus: (_pcId, _idx, next) => {
        sequence.push(next);
        el.foci = [{ name: 'Walk', status: next }];
      }
    });
    await el.updateComplete;
    for (let i = 0; i < 5; i++) {
      el.querySelector<HTMLButtonElement>('.foci-card-status-chip')!.click();
      await el.updateComplete;
    }
    expect(sequence).toEqual([
      'broken',
      'faded',
      'corrupted',
      'transformed',
      'active'
    ]);
  });
});

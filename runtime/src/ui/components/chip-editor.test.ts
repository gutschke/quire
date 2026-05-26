// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './chip-editor';
import type { ChipEditor } from './chip-editor';

function mount(): ChipEditor {
  const el = document.createElement('chip-editor') as ChipEditor;
  document.body.appendChild(el);
  return el;
}

describe('<chip-editor>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders each item as a chip', async () => {
    const el = mount();
    el.items = ['alpha', 'beta', 'gamma'];
    await el.updateComplete;
    const chips = el.querySelectorAll('.chargen-dm-review-chip');
    expect(chips.length).toBe(3);
    expect(chips[0].textContent).toMatch(/alpha/);
  });

  it('is display-only by default (no × or add button)', async () => {
    const el = mount();
    el.items = ['alpha'];
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-chip-remove')).toBeNull();
    expect(el.querySelector('.chargen-dm-review-chip-add')).toBeNull();
  });

  it('renders × on each chip when editable + onRemove is wired', async () => {
    const el = mount();
    el.items = ['alpha', 'beta'];
    el.editable = true;
    el.onRemove = () => {};
    el.onAdd = () => {};
    await el.updateComplete;
    const removes = el.querySelectorAll('.chargen-dm-review-chip-remove');
    expect(removes.length).toBe(2);
  });

  it('clicking × fires onRemove with the index', async () => {
    const el = mount();
    el.items = ['alpha', 'beta', 'gamma'];
    el.editable = true;
    el.onAdd = () => {};
    const removes: number[] = [];
    el.onRemove = (idx) => removes.push(idx);
    await el.updateComplete;
    el.querySelectorAll<HTMLButtonElement>(
      '.chargen-dm-review-chip-remove'
    )[1].click();
    expect(removes).toEqual([1]);
  });

  it('add button shows the configured label', async () => {
    const el = mount();
    el.editable = true;
    el.onAdd = () => {};
    el.onRemove = () => {};
    el.labelAdd = '+ tag';
    await el.updateComplete;
    const add = el.querySelector('.chargen-dm-review-chip-add');
    expect(add?.textContent?.trim()).toBe('+ tag');
  });

  it('clicking add (text kind) opens an inline input; Enter commits', async () => {
    const el = mount();
    el.items = ['alpha'];
    el.kind = 'text';
    el.editable = true;
    el.onRemove = () => {};
    const added: string[] = [];
    el.onAdd = (v) => added.push(v);
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-chip-add')!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-chip-input-tag'
    )!;
    input.value = 'beta';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(added).toEqual(['beta']);
  });

  it('Esc on the input cancels (no onAdd fired)', async () => {
    const el = mount();
    el.editable = true;
    el.onRemove = () => {};
    const added: unknown[] = [];
    el.onAdd = () => {
      added.push(true);
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-chip-add')!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-chip-input-tag'
    )!;
    input.value = 'beta';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await el.updateComplete;
    expect(added).toEqual([]);
    expect(el.querySelector('.chargen-dm-review-chip-input-tag')).toBeNull();
  });

  it('empty input commits as no-op', async () => {
    const el = mount();
    el.editable = true;
    el.onRemove = () => {};
    const added: unknown[] = [];
    el.onAdd = () => {
      added.push(true);
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-chip-add')!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-chip-input-tag'
    )!;
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(added).toEqual([]);
  });

  it('dedupe rejects duplicates', async () => {
    const el = mount();
    el.items = ['alpha'];
    el.editable = true;
    el.dedupe = true;
    el.onRemove = () => {};
    const added: unknown[] = [];
    el.onAdd = () => {
      added.push(true);
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-chip-add')!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-chip-input-tag'
    )!;
    input.value = 'alpha';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(added).toEqual([]);
  });

  it('select kind renders a dropdown of unused options only', async () => {
    const el = mount();
    el.items = ['Tech', 'Knowledge'];
    el.kind = 'select';
    el.options = [
      'Tech',
      'Knowledge',
      'Insight',
      'Influence',
      'Action',
      'Subterfuge'
    ];
    el.editable = true;
    el.onRemove = () => {};
    el.onAdd = () => {};
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-chip-add')!.click();
    await el.updateComplete;
    const select = el.querySelector<HTMLSelectElement>(
      '.chargen-dm-review-chip-input-skill'
    )!;
    const opts = Array.from(select.querySelectorAll('option'))
      .map((o) => o.value)
      .filter((v) => v.length > 0);
    expect(opts).not.toContain('Tech');
    expect(opts).not.toContain('Knowledge');
    expect(opts).toContain('Insight');
  });

  it('select kind hides add button when no unused options remain', async () => {
    const el = mount();
    el.items = ['A', 'B', 'C'];
    el.kind = 'select';
    el.options = ['A', 'B', 'C'];
    el.editable = true;
    el.onRemove = () => {};
    el.onAdd = () => {};
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-chip-add')).toBeNull();
  });

  it('chipClass is applied to every chip', async () => {
    const el = mount();
    el.items = ['alpha', 'beta'];
    el.chipClass = 'chargen-dm-review-chip-skill';
    await el.updateComplete;
    const chips = el.querySelectorAll(
      '.chargen-dm-review-chip.chargen-dm-review-chip-skill'
    );
    expect(chips.length).toBe(2);
  });

  it('per-instance add state: opening add on one instance does NOT close it on another', async () => {
    // UX-R4 #4 regression guard: the previous singleton bug was that
    // addingChip on the host component was per-component, so two
    // editors couldn't both be open.
    const el1 = mount();
    const el2 = mount();
    for (const el of [el1, el2]) {
      el.editable = true;
      el.onRemove = () => {};
      el.onAdd = () => {};
      await el.updateComplete;
    }
    el1.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-chip-add'
    )!.click();
    await el1.updateComplete;
    el2.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-chip-add'
    )!.click();
    await el2.updateComplete;
    // Both inputs are now in the DOM.
    expect(el1.querySelector('.chargen-dm-review-chip-input-tag')).not.toBeNull();
    expect(el2.querySelector('.chargen-dm-review-chip-input-tag')).not.toBeNull();
  });
});

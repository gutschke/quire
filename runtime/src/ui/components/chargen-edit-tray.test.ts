// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import './chargen-edit-tray';
import type { ChargenEditTray, ChargenEditTrayTagOp } from './chargen-edit-tray';

function makeTray(props: Partial<ChargenEditTray> = {}): ChargenEditTray {
  const el = document.createElement('chargen-edit-tray') as ChargenEditTray;
  el.open = true;
  el.pcName = 'Mei';
  el.pcPronouns = 'they/them';
  el.pcTags = ['nurse', 'climber'];
  el.pcBackstory = 'Mei grew up by the Underleaf.';
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

describe('<chargen-edit-tray>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('renders the disclosure toggle when collapsed', async () => {
    const el = document.createElement('chargen-edit-tray') as ChargenEditTray;
    el.open = false;
    document.body.appendChild(el);
    await el.updateComplete;
    const btn = el.querySelector('.chargen-edit-tray-toggle');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders all four field editors when open', async () => {
    const el = makeTray();
    await el.updateComplete;
    expect(el.querySelector('input[type="text"]')).not.toBeNull(); // name
    expect(el.querySelectorAll('input[type="text"]').length).toBe(2); // name + pronouns
    expect(el.querySelector('textarea.chargen-edit-tray-backstory')).not.toBeNull();
    expect(el.querySelectorAll('.chargen-edit-tray-tag')).toHaveLength(2);
  });

  it('emits the right copy strings (R-D + TTRPG/UX §3)', async () => {
    const el = makeTray();
    await el.updateComplete;
    expect(el.textContent).toContain('Editing this row will be visible');
    expect(el.textContent).toContain('Voice belongs to the player');
  });

  it('quick-pick pronoun button fires onPronounsChange', async () => {
    const onPronouns = vi.fn();
    const el = makeTray({ onPronounsChange: onPronouns });
    await el.updateComplete;
    const sheHer = Array.from(
      el.querySelectorAll('.chargen-edit-tray-quickpick')
    ).find((b) => b.textContent?.includes('she/her')) as HTMLButtonElement;
    sheHer.click();
    expect(onPronouns).toHaveBeenCalledWith('she/her');
  });

  it('tag remove button fires onTagOp({op:remove})', async () => {
    const onTagOp = vi.fn<(op: ChargenEditTrayTagOp) => void>();
    const el = makeTray({ onTagOp });
    await el.updateComplete;
    const removeBtn = el.querySelectorAll(
      '.chargen-edit-tray-tag-remove'
    )[0] as HTMLButtonElement;
    removeBtn.click();
    expect(onTagOp).toHaveBeenCalledWith({ op: 'remove', tagText: 'nurse' });
  });

  it('add-tag flow: opens input, commits on Enter, fires onTagOp({op:add})', async () => {
    const onTagOp = vi.fn<(op: ChargenEditTrayTagOp) => void>();
    const el = makeTray({ onTagOp });
    await el.updateComplete;
    const addBtn = el.querySelector(
      '.chargen-edit-tray-add-tag'
    ) as HTMLButtonElement;
    addBtn.click();
    await el.updateComplete;
    const input = el.querySelector(
      '.chargen-edit-tray-tag-input'
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'cartographer';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onTagOp).toHaveBeenCalledWith({
      op: 'add',
      tagText: 'cartographer'
    });
  });

  it('chip rename flow: click chip body opens inline rename → commit on Enter fires onTagOp({op:rename})', async () => {
    const onTagOp = vi.fn<(op: ChargenEditTrayTagOp) => void>();
    const el = makeTray({ onTagOp });
    await el.updateComplete;
    const chipText = el.querySelectorAll(
      '.chargen-edit-tray-tag-text'
    )[1] as HTMLButtonElement; // 'climber'
    chipText.click();
    await el.updateComplete;
    const renameInput = el.querySelector(
      '.chargen-edit-tray-tag-rename'
    ) as HTMLInputElement;
    expect(renameInput).not.toBeNull();
    renameInput.value = 'boulderer';
    renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onTagOp).toHaveBeenCalledWith({
      op: 'rename',
      oldTagText: 'climber',
      newTagText: 'boulderer'
    });
  });

  it('add-tag affordance hides at maxTags cap', async () => {
    const el = makeTray({
      pcTags: ['a', 'b', 'c', 'd', 'e'],
      maxTags: 5
    });
    await el.updateComplete;
    expect(el.querySelector('.chargen-edit-tray-add-tag')).toBeNull();
  });

  it('shows refresh button when showRefreshButton is true', async () => {
    const onRefresh = vi.fn();
    const el = makeTray({
      showRefreshButton: true,
      onRefreshBackstory: onRefresh
    });
    await el.updateComplete;
    const btn = el.querySelector(
      '.chargen-edit-tray-refresh'
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent?.trim()).toBe('↻ Refresh backstory');
    btn.click();
    expect(onRefresh).toHaveBeenCalled();
  });

  it('refresh button respects refreshButtonDisabledReason', async () => {
    const el = makeTray({
      showRefreshButton: true,
      refreshButtonDisabledReason: 'Backstory is up to date with current edits.'
    });
    await el.updateComplete;
    const btn = el.querySelector(
      '.chargen-edit-tray-refresh'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Backstory is up to date');
  });

  it('debounces name commits (400ms)', async () => {
    vi.useFakeTimers();
    const onName = vi.fn();
    const el = makeTray({ onNameChange: onName });
    await el.updateComplete;
    const nameInput = el.querySelectorAll(
      'input[type="text"]'
    )[0] as HTMLInputElement;
    nameInput.value = 'Mei2';
    nameInput.dispatchEvent(new Event('input'));
    nameInput.value = 'Mei3';
    nameInput.dispatchEvent(new Event('input'));
    expect(onName).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onName).toHaveBeenCalledTimes(1);
    expect(onName).toHaveBeenCalledWith('Mei3');
  });
});

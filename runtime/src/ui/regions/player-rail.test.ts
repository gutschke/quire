// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './player-rail';
import type { PlayerRail, SwitcherEntry } from './player-rail';
import type { LoadedCharacter } from '../../character-loader';

function mount(): PlayerRail {
  const el = document.createElement('player-rail') as PlayerRail;
  document.body.appendChild(el);
  return el;
}

function pc(id: string, name: string): LoadedCharacter {
  return {
    kind: 'pc',
    id,
    record: {
      $schemaVersion: '0.1.0',
      name,
      stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: -1 }
    },
    source: { owner: 'x', repo: 'y', ref: 'main' }
  };
}

describe('<player-rail> P-R7 switcher', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function configure(entries: SwitcherEntry[]): PlayerRail {
    const el = mount();
    el.character = pc('mei', 'Mei Tanaka');
    el.effective = el.character.record;
    el.campaignName = 'Underleaf';
    el.campaignSlug = 'underleaf';
    el.switcherEntries = entries;
    el.onSwitchToPc = () => {};
    return el;
  }

  it('renders plain h1 when no switcher entries supplied', async () => {
    const el = mount();
    el.character = pc('mei', 'Mei Tanaka');
    el.effective = el.character.record;
    await el.updateComplete;
    expect(el.querySelector('h1')?.textContent).toBe('Mei Tanaka');
    expect(el.querySelector('.player-rail-name-switcher')).toBeNull();
  });

  it('renders plain h1 with only one entry (nothing to switch to)', async () => {
    const el = configure([{ pcId: 'mei', name: 'Mei', isCurrent: true }]);
    await el.updateComplete;
    expect(el.querySelector('.player-rail-name-switcher')).toBeNull();
  });

  it('renders the chevron when 2+ entries exist', async () => {
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false }
    ]);
    await el.updateComplete;
    expect(el.querySelector('.player-rail-name-switcher')).not.toBeNull();
    // Dropdown closed by default.
    expect(el.querySelector('.player-rail-name-menu')).toBeNull();
  });

  it('hides the chevron when onSwitchToPc is null even with multiple entries', async () => {
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false }
    ]);
    el.onSwitchToPc = null;
    await el.updateComplete;
    expect(el.querySelector('.player-rail-name-switcher')).toBeNull();
  });

  it('clicking the chevron opens the dropdown', async () => {
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false }
    ]);
    await el.updateComplete;
    el
      .querySelector<HTMLButtonElement>('.player-rail-name-switcher')!
      .click();
    await el.updateComplete;
    const menu = el.querySelector('.player-rail-name-menu');
    expect(menu).not.toBeNull();
    const items = el.querySelectorAll('.player-rail-name-menu-item');
    expect(items.length).toBe(2);
  });

  it('current entry is disabled + tagged "current"', async () => {
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false }
    ]);
    await el.updateComplete;
    el
      .querySelector<HTMLButtonElement>('.player-rail-name-switcher')!
      .click();
    await el.updateComplete;
    const currentBtn = el
      .querySelector('.player-rail-name-menu-item-current')
      ?.querySelector<HTMLButtonElement>('button');
    expect(currentBtn?.disabled).toBe(true);
    expect(
      el
        .querySelector('.player-rail-name-menu-item-current')
        ?.textContent?.includes('current')
    ).toBe(true);
  });

  it('clicking an unclaimed entry fires onSwitchToPc immediately and closes menu', async () => {
    let called = '';
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false }
    ]);
    el.onSwitchToPc = (pcId) => {
      called = pcId;
    };
    await el.updateComplete;
    el
      .querySelector<HTMLButtonElement>('.player-rail-name-switcher')!
      .click();
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.player-rail-name-menu-button'
    );
    // Second button is Reggie (not current).
    buttons[1].click();
    expect(called).toBe('reggie');
    await el.updateComplete;
    expect(el.querySelector('.player-rail-name-menu')).toBeNull();
  });

  it('clicking a taken entry once enters confirm state (does NOT switch)', async () => {
    let called = '';
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false, takenBy: 'Bob' }
    ]);
    el.onSwitchToPc = (pcId) => {
      called = pcId;
    };
    await el.updateComplete;
    el
      .querySelector<HTMLButtonElement>('.player-rail-name-switcher')!
      .click();
    await el.updateComplete;
    const reggieBtn = el.querySelectorAll<HTMLButtonElement>(
      '.player-rail-name-menu-button'
    )[1];
    reggieBtn.click();
    await el.updateComplete;
    expect(called).toBe('');
    expect(
      el.querySelector('.player-rail-name-menu-item-confirming')
    ).not.toBeNull();
    expect(
      el.querySelector('.player-rail-name-menu-button-confirm')?.textContent
    ).toMatch(/Confirm take-over from Bob/);
  });

  it('second click on a confirming taken entry commits the switch', async () => {
    let called = '';
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false, takenBy: 'Bob' }
    ]);
    el.onSwitchToPc = (pcId) => {
      called = pcId;
    };
    await el.updateComplete;
    el
      .querySelector<HTMLButtonElement>('.player-rail-name-switcher')!
      .click();
    await el.updateComplete;
    const firstClick = el.querySelectorAll<HTMLButtonElement>(
      '.player-rail-name-menu-button'
    )[1];
    firstClick.click();
    await el.updateComplete;
    const secondClick = el.querySelector<HTMLButtonElement>(
      '.player-rail-name-menu-button-confirm'
    )!;
    secondClick.click();
    expect(called).toBe('reggie');
  });

  it('Escape on the chevron closes the dropdown', async () => {
    const el = configure([
      { pcId: 'mei', name: 'Mei', isCurrent: true },
      { pcId: 'reggie', name: 'Reggie', isCurrent: false }
    ]);
    await el.updateComplete;
    const chev = el.querySelector<HTMLButtonElement>(
      '.player-rail-name-switcher'
    )!;
    chev.click();
    await el.updateComplete;
    expect(el.querySelector('.player-rail-name-menu')).not.toBeNull();
    chev.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await el.updateComplete;
    expect(el.querySelector('.player-rail-name-menu')).toBeNull();
  });
});

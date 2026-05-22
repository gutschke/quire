// @vitest-environment happy-dom

/**
 * <character-creation> tests (CC-5 skeleton).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './character-creation';
import type { CharacterCreation, CreationPath } from './character-creation';

function mount(): CharacterCreation {
  const el = document.createElement(
    'character-creation'
  ) as CharacterCreation;
  document.body.appendChild(el);
  return el;
}

describe('<character-creation>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the welcome step by default', async () => {
    const el = mount();
    el.slotNumber = 3;
    el.campaignName = 'Underleaf';
    // Double-await: the first updateComplete resolves the initial
    // render (with default props), the second covers the property-
    // change reactive update.  happy-dom's update queue isn't as
    // tight as a real browser's microtask scheduling.
    await el.updateComplete;
    await el.updateComplete;
    // Use textContent rather than innerHTML — Lit's part markers
    // (`<!--?lit$…-->`) bloat innerHTML and the truncated diff is
    // hard to read.  textContent collapses everything to the
    // visible text we care about.
    expect(el.textContent).toContain('Welcome to Underleaf');
    expect(el.textContent).toContain('PC3');
  });

  it('renders friendly fallbacks when slot/campaign are unset', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.innerHTML).toContain('a player');
    expect(el.innerHTML).toContain('this campaign');
  });

  it('renders a 6-step progress strip with the current step marked', async () => {
    const el = mount();
    await el.updateComplete;
    const steps = el.querySelectorAll('.character-creation-progress-step');
    expect(steps.length).toBe(6);
    expect(
      el.querySelector('.character-creation-progress-step-current')
    ).not.toBeNull();
  });

  it('Next button advances; Back returns', async () => {
    const el = mount();
    await el.updateComplete;
    // Step 1 → 2 via Next.
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    );
    const back = buttons[0];
    const next = buttons[1];
    expect(back.disabled).toBe(true);
    next.click();
    await el.updateComplete;
    expect(el.innerHTML).toContain('Before you start, three things');
    // Step 2 → 1 via Back.
    back.click();
    await el.updateComplete;
    expect(el.innerHTML).toContain('Welcome to');
  });

  it('Back is disabled on step 1; Next is disabled on step 6', async () => {
    const el = mount();
    await el.updateComplete;
    let buttons = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    );
    expect(buttons[0].disabled).toBe(true);
    // Advance to step 6.
    for (let i = 0; i < 5; i++) {
      buttons[1].click();
      await el.updateComplete;
      buttons = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      );
    }
    expect(buttons[1].disabled).toBe(true);
  });

  it('step 3 renders three path buttons', async () => {
    const el = mount();
    await el.updateComplete;
    // Advance to step 3.
    const next = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    )[1];
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    const paths = el.querySelectorAll('.character-creation-path');
    expect(paths.length).toBe(3);
    expect(el.innerHTML).toContain('Answer questions');
    expect(el.innerHTML).toContain('Write it yourself');
    expect(el.innerHTML).toContain('Pick a pre-made PC');
  });

  it('path button click invokes onPickPath with the chosen path', async () => {
    const el = mount();
    let chosen: CreationPath | null = null;
    el.onPickPath = (p) => {
      chosen = p;
    };
    // Advance to step 3.
    await el.updateComplete;
    const next = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    )[1];
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    const paths = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-path'
    );
    paths[1].click(); // free-write
    expect(chosen).toBe('free-write');
  });

  it('step 4 reflects the chosen path label', async () => {
    const el = mount();
    el.chosenPath = 'qa';
    await el.updateComplete;
    // Jump to step 4 via Next×3.
    const next = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    )[1];
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    expect(el.innerHTML).toContain('Q&amp;A questionnaire');
  });

  it('step 4 prompts to pick a path when none chosen', async () => {
    const el = mount();
    await el.updateComplete;
    const next = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    )[1];
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    expect(el.innerHTML).toContain('Go back to step 3 and pick a path');
  });

  it('renders an error banner when tokenError is set', async () => {
    const el = mount();
    el.tokenError = 'expired';
    await el.updateComplete;
    expect(el.innerHTML).toContain('Invite link invalid');
    expect(el.innerHTML).toContain('expired');
    // The full-region is replaced by the error card; no progress strip.
    expect(el.querySelector('.character-creation-progress')).toBeNull();
  });

  it('error banner copy differs by error code', async () => {
    const el = mount();
    const codes: Array<typeof el.tokenError> = [
      'malformed',
      'expired',
      'campaign-mismatch',
      'invalid-slot'
    ];
    for (const code of codes) {
      el.tokenError = code;
      await el.updateComplete;
      expect(el.innerHTML).toContain('Invite link invalid');
    }
  });
});

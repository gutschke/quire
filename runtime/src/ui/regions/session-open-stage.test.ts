// @vitest-environment happy-dom

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import './session-open-stage';
import type { SessionOpenStage, CarryoverPcCard } from './session-open-stage';
import { ensureMarkdownPipeline } from '../../markdown';

// E-LH6: digest is rendered via the lazy pipeline.
beforeAll(async () => {
  await ensureMarkdownPipeline();
});

function mount(): SessionOpenStage {
  const el = document.createElement('session-open-stage') as SessionOpenStage;
  document.body.appendChild(el);
  return el;
}

function card(over: Partial<CarryoverPcCard> = {}): CarryoverPcCard {
  return {
    pcId: 'mei',
    name: 'Mei Sandwalker',
    slot: 1,
    harm: 0,
    stress: 0,
    marks: 0,
    advancementReady: false,
    ...over
  };
}

describe('<session-open-stage>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders heading + framing copy', async () => {
    const el = mount();
    await el.updateComplete;
    expect(
      el.querySelector('.session-open-stage-head h2')?.textContent
    ).toMatch(/Open session — pick up the thread/);
  });

  it('renders digest markdown as HTML when supplied', async () => {
    const el = mount();
    el.lastDigestMarkdown = '## Recap\n\nWe found the **keys**.';
    await el.updateComplete;
    const digest = el.querySelector('.session-open-stage-digest');
    expect(digest).not.toBeNull();
    expect(digest?.querySelector('h2')?.textContent).toBe('Recap');
    expect(digest?.querySelector('strong')?.textContent).toBe('keys');
  });

  it('hides recap section when no prior digest', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector('.session-open-stage-recap')).toBeNull();
  });

  it('renders carryover cards with name + slot', async () => {
    const el = mount();
    el.carryover = [
      card({ pcId: 'mei', name: 'Mei', slot: 1 }),
      card({ pcId: 'iris', name: 'Iris', slot: 2 })
    ];
    await el.updateComplete;
    const cards = el.querySelectorAll('.session-open-stage-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toMatch(/Mei/);
    expect(cards[1].textContent).toMatch(/Iris/);
  });

  it('omits harm/stress rows when below threshold', async () => {
    const el = mount();
    el.carryover = [card({ harm: 1, stress: 1 })];
    await el.updateComplete;
    const stats = el.querySelectorAll('.session-open-stage-card-stat');
    // Only marks row remains.
    expect(stats).toHaveLength(1);
    expect(stats[0].textContent).toMatch(/marks/);
  });

  it('shows harm/stress rows when ≥ 2', async () => {
    const el = mount();
    el.carryover = [card({ harm: 2, stress: 3 })];
    await el.updateComplete;
    const text = el.textContent ?? '';
    expect(text).toMatch(/harm 2\/4/);
    expect(text).toMatch(/stress 3\/4/);
  });

  it('shows advancement-ready badge when marks ≥ 5', async () => {
    const el = mount();
    el.carryover = [card({ marks: 5, advancementReady: true })];
    await el.updateComplete;
    expect(
      el.querySelector('.session-open-stage-badge-adv')?.textContent
    ).toMatch(/Advancement ready/);
  });

  it('renders DM-only tax + thread-debt rows when supplied', async () => {
    const el = mount();
    el.carryover = [
      card({ taxSessionsRemaining: 2, threadDebtRung: 'noticed' })
    ];
    await el.updateComplete;
    const dmRows = el.querySelectorAll('.session-open-stage-dm-only');
    expect(dmRows.length).toBeGreaterThanOrEqual(2);
    expect(el.textContent).toMatch(/tax: 2 sessions remaining/);
    expect(el.textContent).toMatch(/thread-debt: noticed/);
  });

  it('omits tax/thread-debt rows when DM-only fields not supplied (player viewer)', async () => {
    const el = mount();
    // No taxSessionsRemaining, threadDebtRung, driftMarks — simulating
    // a host call where coord check would have stripped these.
    el.carryover = [card({ harm: 2, marks: 3 })];
    await el.updateComplete;
    expect(el.querySelector('.session-open-stage-dm-only')).toBeNull();
    expect(el.querySelector('.session-open-stage-badge-drift')).toBeNull();
  });

  it('shows Realignment-due banner when driftMarks ≥ 5', async () => {
    const el = mount();
    el.carryover = [card({ driftMarks: 5 })];
    el.onBegin = async () => ({ ok: true });
    await el.updateComplete;
    expect(el.querySelector('.session-open-stage-badge-drift')).not.toBeNull();
    expect(el.querySelector('.session-open-stage-drift-ack')).not.toBeNull();
  });

  it('hides Realignment banner after acknowledge (local receipt)', async () => {
    const el = mount();
    el.carryover = [card({ driftMarks: 5 })];
    el.onBegin = async () => ({ ok: true });
    await el.updateComplete;
    (
      el.querySelector('.session-open-stage-drift-ack') as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(el.querySelector('.session-open-stage-badge-drift')).toBeNull();
  });

  it('footer summary counts advancement-due + drift-due', async () => {
    const el = mount();
    el.carryover = [
      card({ marks: 5, advancementReady: true }),
      card({ pcId: 'iris', name: 'Iris', driftMarks: 5 })
    ];
    el.onBegin = async () => ({ ok: true });
    await el.updateComplete;
    const summary = el.querySelector('.session-open-stage-summary')?.textContent ?? '';
    expect(summary).toMatch(/1 advancement-due/);
    expect(summary).toMatch(/1 drift-due/);
  });

  it('Begin button label changes when unresolved counts present', async () => {
    const el = mount();
    el.carryover = [card({ marks: 5, advancementReady: true })];
    el.onBegin = async () => ({ ok: true });
    await el.updateComplete;
    const btn = el.querySelector('.session-open-stage-begin') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toMatch(/Begin session anyway/);
  });

  it('Begin button invokes onBegin', async () => {
    const el = mount();
    el.carryover = [card()];
    let called = 0;
    el.onBegin = async () => {
      called++;
      return { ok: true };
    };
    await el.updateComplete;
    (el.querySelector('.session-open-stage-begin') as HTMLButtonElement).click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (called > 0) break;
      await Promise.resolve();
    }
    expect(called).toBe(1);
  });

  it('surfaces onBegin failure message', async () => {
    const el = mount();
    el.carryover = [card()];
    el.onBegin = async () => ({
      ok: false,
      code: 'no-coord',
      message: 'DM-only'
    });
    await el.updateComplete;
    (el.querySelector('.session-open-stage-begin') as HTMLButtonElement).click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-open-stage-error')) break;
      await Promise.resolve();
    }
    expect(el.querySelector('.session-open-stage-error')?.textContent).toMatch(
      /DM-only/
    );
  });

  it('no Begin button rendered for player viewer (no onBegin)', async () => {
    const el = mount();
    el.carryover = [card()];
    await el.updateComplete;
    expect(el.querySelector('.session-open-stage-footer')).toBeNull();
    expect(el.querySelector('.session-open-stage-begin')).toBeNull();
  });
});

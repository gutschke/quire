// @vitest-environment happy-dom

/**
 * <chargen-dm-review> tests — Phase 3a Cluster E step 2 scaffold.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import './chargen-dm-review';
import type { ChargenDmReview } from './chargen-dm-review';
import type { SynthesizeBackstoryResult } from '../../ai/backstory-synthesizer';

function mount(): ChargenDmReview {
  const el = document.createElement('chargen-dm-review') as ChargenDmReview;
  document.body.appendChild(el);
  return el;
}

function okResult(name = 'Mei Tanaka'): SynthesizeBackstoryResult {
  return {
    ok: true,
    response: {
      name,
      pronouns: 'she/her',
      tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
      stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
      skillMastery: ['Tech', 'Knowledge'],
      backstory: 'Mei grew up in the Mission.',
      raw: '{}',
      tokensIn: 100,
      tokensOut: 250,
      responseId: 'syn-1'
    },
    warnings: [],
    retried: false
  };
}

describe('<chargen-dm-review> — structure', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders 9 seat cards (one per slot)', async () => {
    const el = mount();
    await el.updateComplete;
    const seats = el.querySelectorAll('.chargen-dm-review-seat');
    expect(seats.length).toBe(9);
  });

  it('marks bound vs open seats correctly', async () => {
    const el = mount();
    el.pcSlots = { 1: 'mei-tanaka', 3: 'reggie-okeke' };
    await el.updateComplete;
    const seats = el.querySelectorAll('.chargen-dm-review-seat');
    expect(seats[0].textContent).toMatch(/mei-tanaka/);
    expect(seats[1].textContent).toMatch(/open/);
    expect(seats[2].textContent).toMatch(/reggie-okeke/);
  });

  it('renders the Mode-B warning at the top of the card', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-mode-b')).not.toBeNull();
  });
});

describe('<chargen-dm-review> — Generate invite link', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Generate button calls the callback with the seat slot', async () => {
    const el = mount();
    const calls: number[] = [];
    el.onGenerate = async (slot) => {
      calls.push(slot);
      return `https://x/?slot=${slot}`;
    };
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.chargen-dm-review-generate'
    );
    buttons[2].click(); // PC3
    expect(calls).toEqual([3]);
  });

  it('disables the Generate button while in-flight + re-enables after', async () => {
    const el = mount();
    let resolve!: (v: string | null) => void;
    el.onGenerate = (slot: number) =>
      new Promise<string | null>((r) => {
        void slot;
        resolve = r;
      });
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-generate'
    )!;
    btn.click();
    await el.updateComplete;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent?.trim()).toBe('Generating…');
    resolve('https://x/?slot=1');
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(btn.disabled).toBe(false);
  });

  it('renders the generated URL on success', async () => {
    const el = mount();
    el.onGenerate = async () => 'https://example.com/?invite=abc';
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-generate')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-invite-url'
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe('https://example.com/?invite=abc');
  });

  it('omits the URL when the callback returns null (failure)', async () => {
    const el = mount();
    el.onGenerate = async () => null;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-generate')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-invite-url')).toBeNull();
  });
});

describe('<chargen-dm-review> — Synthesize + result rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Synthesize button calls the callback with the seat slot', async () => {
    const el = mount();
    const calls: number[] = [];
    el.onSynthesize = async (slot) => {
      calls.push(slot);
      return okResult();
    };
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.chargen-dm-review-synthesize'
    );
    buttons[1].click(); // PC2
    expect(calls).toEqual([2]);
  });

  it('renders ok result: name + warnings count when present', async () => {
    const el = mount();
    const r = okResult('Reggie Okeke');
    r.warnings = [
      { severity: 'warning', code: 'tags-too-many', message: 'too many' }
    ];
    el.synthResults = new Map([[2, r]]);
    await el.updateComplete;
    const synth = el.querySelectorAll('.chargen-dm-review-synth-ok');
    expect(synth.length).toBe(1);
    expect(synth[0].textContent).toMatch(/Reggie Okeke/);
    expect(synth[0].textContent).toMatch(/1 validator warning/);
  });

  it('renders fail result with the error message', async () => {
    const r: SynthesizeBackstoryResult = {
      ok: false,
      code: 'parse-failed',
      message: 'JSON malformed'
    };
    const el = mount();
    el.synthResults = new Map([[3, r]]);
    await el.updateComplete;
    const synth = el.querySelector('.chargen-dm-review-synth-err');
    expect(synth).not.toBeNull();
    expect(synth!.textContent).toMatch(/JSON malformed/);
    expect(synth!.textContent).toMatch(/Synthesis failed/);
  });

  it('renders spoiler-leak-persistent with the spoiler banner', async () => {
    const r: SynthesizeBackstoryResult = {
      ok: false,
      code: 'spoiler-leak-persistent',
      message: 'AI repeated forbidden tokens.',
      persistentTokens: ['quiet']
    };
    const el = mount();
    el.synthResults = new Map([[1, r]]);
    await el.updateComplete;
    const synth = el.querySelector('.chargen-dm-review-synth-spoiler');
    expect(synth).not.toBeNull();
    expect(synth!.textContent).toMatch(/Spoiler leak persisted/);
  });

  it('marks accepted seats with the accepted CSS class', async () => {
    const el = mount();
    el.synthResults = new Map([[1, okResult()]]);
    el.acceptedSlots = new Set([1]);
    await el.updateComplete;
    const seat = el.querySelector('.chargen-dm-review-seat-accepted');
    expect(seat).not.toBeNull();
  });

  it('disables Synthesize while in-flight', async () => {
    const el = mount();
    el.onSynthesize = async () => okResult();
    el.synthInFlight = new Set([2]);
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.chargen-dm-review-synthesize'
    );
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[1].textContent?.trim()).toBe('Synthesizing…');
    expect(buttons[0].disabled).toBe(false);
  });
});

describe('<chargen-dm-review> — clipboard copy', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Copy button calls navigator.clipboard.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
    const el = mount();
    el.onGenerate = async () => 'https://x/abc';
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-generate')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-invite-copy'
    )!.click();
    expect(writeText).toHaveBeenCalledWith('https://x/abc');
  });
});

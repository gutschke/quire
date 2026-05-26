// @vitest-environment happy-dom

/**
 * <chargen-dm-review> tests — Phase 3a Cluster E step 2 scaffold.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import './chargen-dm-review';
import type { ChargenDmReview } from './chargen-dm-review';
import type { SynthesizeBackstoryResult } from '../../ai/backstory-synthesizer';
import type { Seat } from '../../core/state';

function mount(): ChargenDmReview {
  const el = document.createElement('chargen-dm-review') as ChargenDmReview;
  document.body.appendChild(el);
  return el;
}

/**
 * Phase B-prime helper: mount a component with 9 unbound seats
 * pre-seeded.  Most legacy tests assume a 9-row grid where seats
 * for unbound slots still surface the Generate-invite / Synthesize
 * buttons.  The new component renders only seats present in
 * pcSlots — so legacy tests use this helper to keep working.
 * Newly-written tests should prefer `mount()` + explicit seeding.
 */
function mountWith9Seats(): ChargenDmReview {
  const el = mount();
  el.pcSlots = nineUnbound();
  return el;
}

/**
 * Phase B' (2026-05-25): tests pre-roster-lifecycle used the
 * simpler `Record<number, string>` shape (slot → pcId).  The
 * shape is now `Record<number, Seat>`; this helper wraps a pcId
 * in a bound-active Seat for test brevity.
 */
function bound(pcId: string): Seat {
  return { state: 'bound-active', pcId };
}

/**
 * Phase B-prime helper: an `unbound` seat at slot N.  Tests that
 * exercise the seat's chargen affordances (Generate invite link,
 * Synthesize, etc.) seed this so the slot renders before clicking.
 * Mirrors what the seat-add event materializer produces.
 */
function unbound(): Seat {
  return { state: 'unbound' };
}

/**
 * Phase B-prime helper: seed pcSlots with N unbound seats numbered
 * 1..N.  Used by tests that pre-date the chargen-grid replacement
 * and still need 9 slots to exist for arbitrary slot-index clicks.
 */
function nineUnbound(): Record<number, Seat> {
  const out: Record<number, Seat> = {};
  for (let i = 1; i <= 9; i++) out[i] = unbound();
  return out;
}

function okResult(name = 'Mei Tanaka'): Extract<
  SynthesizeBackstoryResult,
  { ok: true }
> {
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

  it('Phase B-prime: renders an empty-state message when no seats exist', async () => {
    // Pre-Phase-B-prime this rendered 9 fixed slot cards.  Post-
    // Phase-B-prime the panel adapts to the actual roster — empty
    // means "no players yet" copy + the "+ add player" verb.
    // Uses plain `mount()` (no pre-seed) to exercise the empty
    // pcSlots path; legacy tests use `mountWith9Seats()`.
    const el = mount();
    await el.updateComplete;
    expect(el.querySelectorAll('.chargen-dm-review-seat').length).toBe(0);
    expect(el.querySelector('.chargen-dm-review-seats-empty')).not.toBeNull();
    expect(el.querySelector('.chargen-dm-review-add-seat')).not.toBeNull();
  });

  it('Phase B-prime: renders only the bound seats (no 9-slot grid)', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei-tanaka'), 3: bound('reggie-okeke') };
    await el.updateComplete;
    const seats = el.querySelectorAll('.chargen-dm-review-seat');
    expect(seats.length).toBe(2);
    expect(seats[0].textContent).toMatch(/mei-tanaka/);
    expect(seats[1].textContent).toMatch(/reggie-okeke/);
  });

  it('P3U-12: renders display name when displayNameLookup resolves', async () => {
    const el = mountWith9Seats();
    el.pcSlots = { 1: bound('mei-tanaka') };
    el.displayNameLookup = (pcId) => {
      return pcId === 'mei-tanaka' ? 'Mei Tanaka' : null;
    };
    await el.updateComplete;
    const seat = el.querySelector('.chargen-dm-review-seat');
    expect(
      seat?.querySelector('.chargen-dm-review-seat-display-name')?.textContent
    ).toBe('Mei Tanaka');
    expect(
      seat?.querySelector('.chargen-dm-review-seat-id')?.textContent
    ).toMatch(/mei-tanaka/);
  });

  it('P3U-12: falls back to raw pcId while display name is loading', async () => {
    const el = mountWith9Seats();
    el.pcSlots = { 1: bound('mei-tanaka') };
    el.displayNameLookup = () => null; // not yet resolved
    await el.updateComplete;
    const seat = el.querySelector('.chargen-dm-review-seat');
    expect(seat?.textContent).toMatch(/mei-tanaka/);
    expect(
      seat?.querySelector('.chargen-dm-review-seat-display-name')
    ).toBeNull();
  });

  it('P3U-12: Lit auto-escapes a hostile name field (XSS defense)', async () => {
    const el = mountWith9Seats();
    el.pcSlots = { 1: bound('evil') };
    el.displayNameLookup = () => '<script>alert(1)</script>';
    await el.updateComplete;
    const seat = el.querySelector('.chargen-dm-review-seat');
    expect(seat?.querySelector('script')).toBeNull();
    expect(seat?.textContent).toMatch(/script.alert/);
  });

  it('renders the Mode-B warning at the top of the card', async () => {
    const el = mountWith9Seats();
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-mode-b')).not.toBeNull();
  });
});

describe('<chargen-dm-review> — Generate invite link', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Generate button calls the callback with the seat slot', async () => {
    const el = mountWith9Seats();
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
    const el = mountWith9Seats();
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
    const el = mountWith9Seats();
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
    const el = mountWith9Seats();
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
    const el = mountWith9Seats();
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
    const el = mountWith9Seats();
    const r: SynthesizeBackstoryResult = {
      ...okResult('Reggie Okeke'),
      warnings: [
        { severity: 'warning', code: 'tags-too-many', message: 'too many' }
      ]
    } as SynthesizeBackstoryResult;
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
    const el = mountWith9Seats();
    el.synthResults = new Map([[3, r]]);
    await el.updateComplete;
    const synth = el.querySelector('.chargen-dm-review-synth-err');
    expect(synth).not.toBeNull();
    expect(synth!.textContent).toMatch(/JSON malformed/);
    expect(synth!.textContent).toMatch(/Synthesis failed/);
  });

  it('renders spoiler-leak-persistent with the spoiler banner + token chips', async () => {
    // Phase 3b polish (2026-05-23): banner label dropped "persisted"
    // (DM-unfriendly internal-jargon); the per-token chips replace
    // the prose "(tokens: …)" so the leaked words pop visually.
    const r: SynthesizeBackstoryResult = {
      ok: false,
      code: 'spoiler-leak-persistent',
      message:
        'AI used forbidden words: "quiet".  These reveal campaign secrets.',
      persistentTokens: ['quiet']
    };
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, r]]);
    await el.updateComplete;
    const synth = el.querySelector('.chargen-dm-review-synth-spoiler');
    expect(synth).not.toBeNull();
    expect(synth!.textContent).toMatch(/Spoiler leak/);
    // Each token renders as a chip in the list.
    const chips = el.querySelectorAll('.chargen-dm-review-spoiler-token');
    expect(chips.length).toBe(1);
    expect(chips[0]!.textContent).toMatch(/quiet/);
  });

  it('marks accepted seats with the accepted CSS class', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult()]]);
    el.acceptedSlots = new Set([1]);
    await el.updateComplete;
    const seat = el.querySelector('.chargen-dm-review-seat-accepted');
    expect(seat).not.toBeNull();
  });

  it('disables Synthesize while in-flight', async () => {
    const el = mountWith9Seats();
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

describe('<chargen-dm-review> — accept + revise (CC-24 + P3T-19)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows Accept button only when synth result is ok', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map<number, SynthesizeBackstoryResult>([
      [2, { ok: false, code: 'parse-failed', message: 'bad' }],
      [3, okResult()]
    ]);
    el.onAccept = () => {};
    el.onRevise = () => {};
    await el.updateComplete;
    const acceptButtons = el.querySelectorAll('.chargen-dm-review-accept');
    expect(acceptButtons.length).toBe(1);
    // Should be inside seat 3 only.
    const seat3 = el.querySelector('[data-slot="3"]');
    expect(seat3?.querySelector('.chargen-dm-review-accept')).not.toBeNull();
    const seat2 = el.querySelector('[data-slot="2"]');
    expect(seat2?.querySelector('.chargen-dm-review-accept')).toBeNull();
  });

  it('Accept click calls onAccept with the seat slot', async () => {
    const el = mountWith9Seats();
    const calls: number[] = [];
    el.synthResults = new Map([[4, okResult()]]);
    el.onAccept = (slot) => calls.push(slot);
    el.onRevise = () => {};
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-accept')!.click();
    expect(calls).toEqual([4]);
  });

  it('Accept button is disabled (and labeled "Accepted") when slot is in acceptedSlots', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[5, okResult()]]);
    el.acceptedSlots = new Set([5]);
    el.onAccept = () => {};
    el.onRevise = () => {};
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-accept'
    );
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent?.trim()).toBe('Accepted');
  });

  it('OK results show Revise; failure results show Discard (both wire to onRevise)', async () => {
    // Phase 3b polish (2026-05-23): failed-synth UI no longer
    // labels the discard path as "Ask player to revise" — that
    // wording was misleading when the DM drove the synth
    // (quick-gen) AND when the failure was the AI's fault
    // (spoiler leak).  The button is now "Discard + try again"
    // (.chargen-dm-review-discard) but still fires onRevise so
    // the audit-trail behavior is unchanged.
    const el = mountWith9Seats();
    el.synthResults = new Map<number, SynthesizeBackstoryResult>([
      [2, { ok: false, code: 'parse-failed', message: 'bad' }],
      [6, okResult()]
    ]);
    el.onAccept = () => {};
    el.onRevise = () => {};
    await el.updateComplete;
    // OK card → existing 'Ask player to revise' button.
    expect(
      el.querySelectorAll('.chargen-dm-review-revise').length
    ).toBe(1);
    // Failure card → new 'Discard + try again' button (same wire).
    expect(
      el.querySelectorAll('.chargen-dm-review-discard').length
    ).toBe(1);
  });

  it('Revise click prompts for a reason and forwards to onRevise', async () => {
    const el = mountWith9Seats();
    const calls: Array<[number, string]> = [];
    el.synthResults = new Map([[1, okResult()]]);
    el.onAccept = () => {};
    el.onRevise = (slot, reason) => calls.push([slot, reason]);
    const origPrompt = window.prompt;
    window.prompt = () => 'Item is too vague';
    try {
      await el.updateComplete;
      el.querySelector<HTMLButtonElement>('.chargen-dm-review-revise')!.click();
      expect(calls).toEqual([[1, 'Item is too vague']]);
    } finally {
      window.prompt = origPrompt;
    }
  });

  it('Revise with cancelled prompt forwards an empty reason', async () => {
    const el = mountWith9Seats();
    const calls: Array<[number, string]> = [];
    el.synthResults = new Map([[2, okResult()]]);
    el.onAccept = () => {};
    el.onRevise = (slot, reason) => calls.push([slot, reason]);
    const origPrompt = window.prompt;
    window.prompt = () => null; // user cancelled the dialog
    try {
      await el.updateComplete;
      el.querySelector<HTMLButtonElement>('.chargen-dm-review-revise')!.click();
      expect(calls).toEqual([[2, '']]);
    } finally {
      window.prompt = origPrompt;
    }
  });
});

describe('<chargen-dm-review> — full review card (Step 5)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders stats grid + skill chips + tag chips on an ok result', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult()]]);
    el.onAccept = () => {};
    el.onRevise = () => {};
    await el.updateComplete;
    expect(el.querySelectorAll('.chargen-dm-review-stat-cell').length).toBe(6);
    const skills = el.querySelectorAll('.chargen-dm-review-chip-skill');
    expect(skills.length).toBe(2);
    expect(skills[0].textContent).toBe('Tech');
    expect(skills[1].textContent).toBe('Knowledge');
    const tags = el.querySelectorAll(
      '.chargen-dm-review-tags .chargen-dm-review-chip'
    );
    expect(tags.length).toBe(3);
  });

  it('formats stat modifiers with signs (+2, +0, etc.)', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult()]]);
    await el.updateComplete;
    const mods = Array.from(
      el.querySelectorAll('.chargen-dm-review-stat-mod')
    ).map((n) => n.textContent);
    // Default okResult stats: STR 0 DEX 1 CON 1 INT 2 WIS 1 CHA 0.
    expect(mods).toEqual(['+0', '+1', '+1', '+2', '+1', '+0']);
  });

  it('renders the warning list inline when warnings are present', async () => {
    const r: SynthesizeBackstoryResult = {
      ...okResult(),
      warnings: [
        {
          severity: 'warning',
          code: 'tags-too-many',
          message: 'too many tags'
        },
        {
          severity: 'warning',
          code: 'place-token-missing',
          message: 'no Bay Area place'
        }
      ]
    } as SynthesizeBackstoryResult;
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, r]]);
    await el.updateComplete;
    const items = el.querySelectorAll('.chargen-dm-review-warning-list li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toMatch(/tags-too-many/);
    expect(items[1].textContent).toMatch(/no Bay Area place/);
  });

  it('opens and closes the review modal on the toggle button', async () => {
    // Phase 3b polish (2026-05-22): the inline-expand was replaced
    // with a centered <dialog> modal because the DM aside column was
    // too narrow for the two-column diff.  The toggle now opens the
    // modal; a Close button inside the modal closes it.
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult()]]);
    el.answersLookup = () => ({
      'intent-moment': 'I held the line when my dad lost his job.',
      'meaningful-item':
        "My dad's old leather wallet from his time in Taipei.",
      'prior-connection': 'work',
      'flight-reason': 'work'
    });
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-diff')).toBeNull();
    expect(el.querySelector('dialog.chargen-dm-review-modal')).toBeNull();
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    // The dialog is in the DOM with the diff inside it.
    expect(el.querySelector('dialog.chargen-dm-review-modal')).not.toBeNull();
    expect(el.querySelector('.chargen-dm-review-diff')).not.toBeNull();
    // Click the modal's Close button (footer one).  The header × is
    // also wired — either should close.
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-modal-foot button'
    )!.click();
    await el.updateComplete;
    expect(el.querySelector('dialog.chargen-dm-review-modal')).toBeNull();
    expect(el.querySelector('.chargen-dm-review-diff')).toBeNull();
  });

  it('renders SA answers on the left and backstory on the right when expanded', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([
      [
        1,
        {
          ...okResult(),
          response: {
            ...okResult().response!,
            backstory: 'Mei worked at the Marina.\n\nShe held the line.'
          }
        } as SynthesizeBackstoryResult
      ]
    ]);
    el.answersLookup = () => ({
      'intent-moment': 'I held the line when my dad lost his job.',
      'meaningful-item': "My dad's leather wallet from Taipei.",
      'prior-connection': 'work',
      'flight-reason': 'work'
    });
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    const answers = el.querySelector('.chargen-dm-review-diff-answers');
    const backstory = el.querySelector('.chargen-dm-review-diff-backstory');
    expect(answers?.textContent).toMatch(/held the line/);
    expect(backstory?.textContent).toMatch(/Marina/);
    expect(backstory?.textContent).toMatch(/held the line/);
  });

  it('Phase 3b polish (2026-05-23): backstory no longer highlights arbitrary word matches', async () => {
    // The prior token-substring highlight produced an "angry
    // fruitsalad" of arbitrary words.  Per user feedback, the
    // side-by-side layout is enough — no highlight noise.  This
    // test pins the new behavior: no <mark> elements appear.
    const el = mountWith9Seats();
    el.synthResults = new Map([
      [
        1,
        {
          ...okResult(),
          response: {
            ...okResult().response!,
            backstory: 'She walked the Marina at dusk.'
          }
        } as SynthesizeBackstoryResult
      ]
    ]);
    el.answersLookup = () => ({
      'intent-moment': 'I learned to hold a line at the marina.',
      'meaningful-item': 'a marina pass'
    });
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    expect(el.querySelectorAll('.chargen-dm-review-mark').length).toBe(0);
    // The backstory text itself is still rendered.
    expect(el.textContent).toMatch(/Marina/);
  });

  it('Phase 3b polish (2026-05-23): MC option values render as their labels', async () => {
    // Player answers stored as the MC option's internal `value`
    // (e.g. "last-72h") need to surface as the option's
    // human-readable `label` ("Booked in the last 72 hours") in
    // the diff view; otherwise the DM sees internal tokens.
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult()]]);
    el.questions = [
      {
        id: 'flight-reason',
        kind: 'mc',
        prompt: 'Why on this flight?',
        required: true,
        options: [
          { value: 'work', label: 'Work — meeting or handoff' },
          {
            value: 'last-72h',
            label: 'Booked in the last 72 hours — urgent'
          }
        ]
      },
      {
        id: 'prior-connection',
        kind: 'mc',
        prompt: 'Prior connection',
        required: true,
        options: [
          { value: 'none', label: 'No prior connection to anyone aboard' },
          { value: 'colleague', label: 'A colleague is also on the flight' }
        ]
      }
    ];
    el.answersLookup = () => ({
      'flight-reason': 'last-72h',
      'prior-connection': 'none'
    });
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    const answers = el.querySelector('.chargen-dm-review-diff-answers');
    expect(answers).not.toBeNull();
    expect(answers!.textContent).toMatch(/Booked in the last 72 hours/);
    expect(answers!.textContent).toMatch(/No prior connection/);
    // Internal tokens MUST NOT leak when a matching label exists.
    expect(answers!.textContent).not.toMatch(/last-72h/);
  });

  it('shows "no saved answers" copy when answersLookup returns null', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult()]]);
    el.answersLookup = () => null;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    const answers = el.querySelector('.chargen-dm-review-diff-answers');
    expect(answers?.textContent).toMatch(/No saved answers/);
  });

  it('P3T-16: Lit auto-escapes hostile content from player answers + backstory', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([
      [
        1,
        {
          ...okResult(),
          response: {
            ...okResult().response!,
            backstory: 'A line <script>alert(1)</script> here.'
          }
        } as SynthesizeBackstoryResult
      ]
    ]);
    el.answersLookup = () => ({
      'intent-moment': '<img onerror=alert(1) src=x>',
      'meaningful-item': 'item',
      'prior-connection': 'none',
      'flight-reason': 'work'
    });
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    // Auto-escape means no real <script> / <img> nodes get created.
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
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
    const el = mountWith9Seats();
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

// ---- Phase 3b polish (2026-05-23): spoiler-leak hand-edit ----

describe('<chargen-dm-review> — spoiler-leak hand-edit flow', () => {
  function rejectedResult(): SynthesizeBackstoryResult {
    return {
      ok: false,
      code: 'spoiler-leak-persistent',
      message:
        'AI used forbidden words: "Quiet".  These reveal campaign secrets.',
      persistentTokens: ['Quiet'],
      rawResponse: '{"name":"Mei","backstory":"..."}',
      rejectedResponse: {
        name: 'Mei Tanaka',
        pronouns: 'she/her',
        tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory:
          'Mei felt the Quiet of the apartment after her father left.',
        raw: '{}',
        tokensIn: 0,
        tokensOut: 0,
        responseId: 'r-spoiler'
      },
      retried: true
    } as unknown as SynthesizeBackstoryResult;
  }

  it('surfaces the rejected PC preview + leaked-token chips', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, rejectedResult()]]);
    await el.updateComplete;
    // Preview card shows the AI's generated name + tags + stats so
    // the DM can decide whether the salvageable content is worth
    // editing or whether to discard and try again.
    const preview = el.querySelector('.chargen-dm-review-rejected-preview');
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toMatch(/Mei Tanaka/);
    // Leaked-token chip is rendered.
    const chip = el.querySelector('.chargen-dm-review-spoiler-token');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toMatch(/Quiet/);
  });

  it('"Edit + accept" opens an editable dialog seeded from the rejected response', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, rejectedResult()]]);
    el.onAcceptWithEdits = () => true;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-edit-accept'
    )!.click();
    await el.updateComplete;
    // Edit dialog is in the DOM with the rejected name + backstory
    // pre-filled into the form fields.
    const dialog = el.querySelector('dialog.chargen-dm-review-edit-modal');
    expect(dialog).not.toBeNull();
    const nameInput = dialog!.querySelector<HTMLInputElement>(
      '.chargen-dm-review-edit-field input'
    );
    const backstoryArea = dialog!.querySelector<HTMLTextAreaElement>(
      '.chargen-dm-review-edit-field textarea'
    );
    expect(nameInput?.value).toBe('Mei Tanaka');
    expect(backstoryArea?.value).toMatch(/felt the Quiet/);
  });

  it('"Save + accept" forwards edits to onAcceptWithEdits', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, rejectedResult()]]);
    const calls: Array<{ slot: number; name: string; backstory: string }> = [];
    el.onAcceptWithEdits = (slot, edits) => {
      calls.push({ slot, ...edits });
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-edit-accept'
    )!.click();
    await el.updateComplete;
    // Simulate the DM cleaning up the backstory.
    const backstoryArea = el.querySelector<HTMLTextAreaElement>(
      'dialog.chargen-dm-review-edit-modal textarea'
    )!;
    backstoryArea.value =
      'Mei felt the silence of the apartment after her father left.';
    backstoryArea.dispatchEvent(new Event('input'));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-edit-save'
    )!.click();
    expect(calls.length).toBe(1);
    expect(calls[0].slot).toBe(1);
    expect(calls[0].name).toBe('Mei Tanaka');
    expect(calls[0].backstory).toMatch(/silence/);
  });
});

describe('<chargen-dm-review> — Wave 1 seat-remove (X-glyph + 4s undo)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the X-glyph on an unbound empty seat when onRemoveSeat is wired', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.onRemoveSeat = () => true;
    await el.updateComplete;
    const x = el.querySelector('.chargen-dm-review-seat-remove');
    expect(x).not.toBeNull();
    expect(x?.getAttribute('aria-label')).toBe('Remove PC3');
  });

  it('hides the X-glyph on a bound seat (retire-flow only)', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei') };
    el.onRemoveSeat = () => true;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-remove')).toBeNull();
  });

  it('hides the X-glyph when onRemoveSeat callback is null', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    // onRemoveSeat intentionally not set
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-remove')).toBeNull();
  });

  it('clicking X fires onRemoveSeat with the slot number', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    const calls: number[] = [];
    el.onRemoveSeat = (slot: number) => {
      calls.push(slot);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-remove'
    )!.click();
    expect(calls).toEqual([3]);
  });

  it('renders the undo banner after a successful remove', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.onRemoveSeat = () => true;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-remove'
    )!.click();
    await el.updateComplete;
    const banner = el.querySelector('.chargen-dm-review-remove-undo');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/PC3 removed/);
    expect(banner!.textContent).toMatch(/Undo \(4s\)/);
  });

  it('clicking Undo invokes onReaddSeat with the same slot', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.onRemoveSeat = () => true;
    const readds: number[] = [];
    el.onReaddSeat = (slot: number) => {
      readds.push(slot);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-remove'
    )!.click();
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-remove-undo-btn'
    )!.click();
    await el.updateComplete;
    expect(readds).toEqual([3]);
    // Banner should clear after undo.
    expect(el.querySelector('.chargen-dm-review-remove-undo')).toBeNull();
  });

  it('does not surface the X-glyph on a seat with a cached synth result', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.synthResults = new Map([[3, okResult('Mei')]]);
    el.onRemoveSeat = () => true;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-remove')).toBeNull();
  });

  it('does not surface the X-glyph on an accepted seat', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.acceptedSlots = new Set([3]);
    el.onRemoveSeat = () => true;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-remove')).toBeNull();
  });

  it('does not show the banner when onRemoveSeat returns false (engine refused)', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.onRemoveSeat = () => false; // simulate engine reject
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-remove'
    )!.click();
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-remove-undo')).toBeNull();
  });

  it('post-Wave-2 regression: × renders on the workingSlot (the just-added seat)', async () => {
    // TTRPG-R3 critical: previously isSeatRemovable excluded the
    // workingSlot, hiding the X on exactly the seat the DM most
    // often wants to undo (the accidental + add player click).
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.onRemoveSeat = () => true;
    el.onAddSeat = () => 3; // simulate add-seat callback returning slot 3
    await el.updateComplete;
    // Click + add player → workingSlot becomes 3.
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-add-seat'
    )!.click();
    await el.updateComplete;
    // X glyph MUST still appear (regression: previously hidden).
    expect(
      el.querySelector('.chargen-dm-review-seat-remove')
    ).not.toBeNull();
  });

  it('post-Wave-2: remove of the workingSlot clears workingSlot so no orphan chargen card lingers', async () => {
    const el = mount();
    el.pcSlots = { 3: unbound() };
    el.onRemoveSeat = (slot: number) => {
      delete el.pcSlots[slot];
      return true;
    };
    el.onAddSeat = () => 3;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-add-seat'
    )!.click();
    await el.updateComplete;
    // Now workingSlot=3.  Remove it.
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-remove'
    )!.click();
    await el.updateComplete;
    // workingSlot internal state should be cleared.  Check via:
    // the empty-state message reappears (no working seat).
    expect(
      el.querySelector('.chargen-dm-review-seats-empty')
    ).not.toBeNull();
  });
});

describe('<chargen-dm-review> — Wave 2 click-to-edit + drift banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the name as a click-to-edit button when onEditPreAccept is wired', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const btn = el.querySelector('.chargen-dm-review-header-edit-name');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toMatch(/Mei/);
  });

  it('renders name as a static span when onEditPreAccept callback is null', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    // onEditPreAccept intentionally null
    await el.updateComplete;
    expect(
      el.querySelector('.chargen-dm-review-header-edit-name')
    ).toBeNull();
  });

  it('clicking the name swaps into an input field', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei Tanaka')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-header-edit-name'
    )!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-header-input-name'
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe('Mei Tanaka');
  });

  it('Enter commits the edit via onEditPreAccept', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: Array<{ slot: number; patch: Record<string, unknown> }> = [];
    el.onEditPreAccept = (slot, patch) => {
      patches.push({ slot, patch });
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-header-edit-name'
    )!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-header-input-name'
    )!;
    input.value = 'Mai Tanaka';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(patches).toEqual([{ slot: 1, patch: { name: 'Mai Tanaka' } }]);
  });

  it('Esc cancels the edit without calling onEditPreAccept', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: unknown[] = [];
    el.onEditPreAccept = () => {
      patches.push(true);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-header-edit-name'
    )!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-header-input-name'
    )!;
    input.value = 'Should not save';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await el.updateComplete;
    expect(patches).toEqual([]);
    // Back to the click-to-edit button display.
    expect(
      el.querySelector('.chargen-dm-review-header-edit-name')
    ).not.toBeNull();
  });

  it('empty input is treated as no-op (no patch fired)', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: unknown[] = [];
    el.onEditPreAccept = () => {
      patches.push(true);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-header-edit-name'
    )!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-header-input-name'
    )!;
    input.value = '  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(patches).toEqual([]);
  });

  it('renders the drift banner when preAcceptDrift has entries for the slot', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai Tanaka')]]);
    el.preAcceptDrift = new Map([[1, { name: 'Mei Tanaka' }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    await el.updateComplete;
    const banner = el.querySelector('.chargen-dm-review-drift');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/name/);
    expect(banner!.textContent).toMatch(/Mei Tanaka/); // before
    expect(banner!.textContent).toMatch(/Mai Tanaka/); // after
  });

  it('clicking Leave drift fires onDismissDrift with the slot + field', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai Tanaka')]]);
    el.preAcceptDrift = new Map([[1, { name: 'Mei Tanaka' }]]);
    const dismissed: Array<{ slot: number; field: string }> = [];
    el.onDismissDrift = (slot, field) => {
      dismissed.push({ slot, field: String(field) });
    };
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-drift-leave'
    )!.click();
    expect(dismissed).toEqual([{ slot: 1, field: 'name' }]);
  });

  it('Wave 3 action stubs: Re-sync is still NOT rendered as a broken-looking disabled button', async () => {
    // UX + TTRPG R3 review: disabled stubs read as broken UI.
    // Wave 3a lit Patch (deterministic find-replace); Re-sync
    // (AI call) waits for Wave 3b and remains absent (not a
    // disabled button) until then.
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai Tanaka')]]);
    // Use a non-patchable drift to keep this assertion focused on
    // the absence of disabled stubs.
    el.preAcceptDrift = new Map([[1, { tags: ['old', 't2', 't3'] }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    await el.updateComplete;
    // No Patch button (no patchable drift here) AND no Re-sync stub.
    expect(
      el.querySelector('.chargen-dm-review-drift-patch')
    ).toBeNull();
    expect(
      el.querySelector('.chargen-dm-review-drift-resync')
    ).toBeNull();
    // The explanation pip IS there.
    const pip = el.querySelector('.chargen-dm-review-drift-pip');
    expect(pip).not.toBeNull();
    expect(pip!.textContent).toMatch(/edit/);
    expect(pip!.textContent).toMatch(/re-sync tool/);
  });

  it('drift banner does not render when no drift is recorded', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.preAcceptDrift = new Map();
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-drift')).toBeNull();
  });

  it('post-Wave-2: stats drift renders as a delta string (not JSON dump)', async () => {
    const el = mountWith9Seats();
    const r = okResult('Mei');
    // DM swapped STR and INT.
    r.response.stats = { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 1, CHA: 0 };
    el.synthResults = new Map([[1, r]]);
    el.preAcceptDrift = new Map([
      [
        1,
        {
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 }
        }
      ]
    ]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    await el.updateComplete;
    const statsRow = el.querySelector('.chargen-dm-review-drift-stats');
    expect(statsRow).not.toBeNull();
    // Shows only the keys that changed, not all 6.
    expect(statsRow!.textContent).toMatch(/STR \+0 → \+2/);
    expect(statsRow!.textContent).toMatch(/INT \+2 → \+0/);
    expect(statsRow!.textContent).not.toMatch(/DEX/); // unchanged
    expect(statsRow!.textContent).not.toMatch(/[{}"]/); // no JSON
  });

  it('post-Wave-2: header-edit button has a useful aria-label', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei Tanaka')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const nameBtn = el.querySelector(
      '.chargen-dm-review-header-edit-name'
    );
    expect(nameBtn?.getAttribute('aria-label')).toMatch(/Edit name/);
    expect(nameBtn?.getAttribute('aria-label')).toMatch(/Mei Tanaka/);
  });

  it('post-Wave-2: stat cell has aria-pressed reflecting selection state', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const cells = el.querySelectorAll<HTMLButtonElement>(
      'button.chargen-dm-review-stat-cell-editable'
    );
    expect(cells[0].getAttribute('aria-pressed')).toBe('false');
    cells[0].click();
    await el.updateComplete;
    expect(cells[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('post-Wave-2: lock glyph is aria-hidden (state lives on the cell)', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]); // +2 on INT
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const lock = el.querySelector('.chargen-dm-review-stat-lock');
    expect(lock).not.toBeNull();
    expect(lock!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('<chargen-dm-review> — P-R2 campaign-configured seatCap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('"+ add player" stays available when not at cap', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('a'), 2: bound('b'), 3: bound('c') };
    el.seatCap = 5;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-add-seat')).not.toBeNull();
  });

  it('"+ add player" hides when cap is reached (campaign-declared)', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('a'), 2: bound('b'), 3: bound('c') };
    el.seatCap = 3;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-add-seat')).toBeNull();
    expect(el.querySelector('.chargen-dm-review-cap-note')).not.toBeNull();
    expect(el.querySelector('.chargen-dm-review-cap-note')!.textContent).toMatch(
      /Seat cap reached \(3\)/
    );
  });

  it('default seatCap is the engine default (9)', async () => {
    const el = mount();
    // Default property value should be 9 — confirmed by the cap
    // note's text below.
    el.pcSlots = {};
    for (let i = 1; i <= 9; i++) el.pcSlots[i] = bound(`pc${i}`);
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-cap-note')!.textContent).toMatch(
      /Seat cap reached \(9\)/
    );
  });
});

describe('<chargen-dm-review> — Wave 3a Patch-in-place', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the Patch button when name is drifted + callback wired', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai Tanaka')]]);
    el.preAcceptDrift = new Map([[1, { name: 'Mei Tanaka' }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    el.onPatchInPlace = () => true;
    await el.updateComplete;
    const patch = el.querySelector('.chargen-dm-review-drift-patch');
    expect(patch).not.toBeNull();
    expect(patch!.textContent).toMatch(/Patch name/);
  });

  it('renders Patch button covering both name + pronouns when both drifted', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai Tanaka')]]);
    el.preAcceptDrift = new Map([
      [1, { name: 'Mei Tanaka', pronouns: 'she/her' }]
    ]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    el.onPatchInPlace = () => true;
    await el.updateComplete;
    const patch = el.querySelector('.chargen-dm-review-drift-patch');
    expect(patch!.textContent).toMatch(/name \+ pronouns/);
  });

  it('does NOT render Patch when only non-patchable fields drifted', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.preAcceptDrift = new Map([[1, { tags: ['old', 't2', 't3'] }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    el.onPatchInPlace = () => true;
    await el.updateComplete;
    expect(
      el.querySelector('.chargen-dm-review-drift-patch')
    ).toBeNull();
  });

  it('shows the right pip text when a mix of patchable + unpatchable drift exists', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai')]]);
    el.preAcceptDrift = new Map([
      [1, { name: 'Mei', tags: ['old', 't2', 't3'] }]
    ]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    el.onPatchInPlace = () => true;
    await el.updateComplete;
    const pip = el.querySelector('.chargen-dm-review-drift-pip');
    expect(pip!.textContent).toMatch(/Patch covers name/);
    expect(pip!.textContent).toMatch(/re-sync tool/);
  });

  it('clicking Patch fires onPatchInPlace with the slot', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai Tanaka')]]);
    el.preAcceptDrift = new Map([[1, { name: 'Mei Tanaka' }]]);
    const patched: number[] = [];
    el.onPatchInPlace = (slot) => {
      patched.push(slot);
      return true;
    };
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-drift-patch'
    )!.click();
    expect(patched).toEqual([1]);
  });
});

describe('<chargen-dm-review> — Wave 3b Re-sync', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders Re-sync button when drift has non-patchable fields + callback wired', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.preAcceptDrift = new Map([[1, { tags: ['old', 't2', 't3'] }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    el.onResyncBackstory = async () => {};
    await el.updateComplete;
    const resync = el.querySelector('.chargen-dm-review-drift-resync');
    expect(resync).not.toBeNull();
    expect(resync!.textContent).toMatch(/Re-sync backstory/);
  });

  it('does NOT render Re-sync when only patchable fields drifted', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mai')]]);
    el.preAcceptDrift = new Map([[1, { name: 'Mei' }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    el.onResyncBackstory = async () => {};
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-drift-resync')).toBeNull();
  });

  it('does NOT render Re-sync when callback is not wired', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.preAcceptDrift = new Map([[1, { tags: ['old', 't2', 't3'] }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    // onResyncBackstory intentionally null
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-drift-resync')).toBeNull();
  });

  it('clicking Re-sync invokes onResyncBackstory with the slot', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.preAcceptDrift = new Map([[1, { tags: ['old', 't2', 't3'] }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    const calls: number[] = [];
    el.onResyncBackstory = async (slot) => {
      calls.push(slot);
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-drift-resync'
    )!.click();
    expect(calls).toEqual([1]);
  });

  it('shows the in-flight label + disables during the AI call', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.preAcceptDrift = new Map([[1, { tags: ['old', 't2', 't3'] }]]);
    el.onEditPreAccept = () => true;
    el.onDismissDrift = () => {};
    // Keep the promise pending so we can observe in-flight state.
    let resolve!: () => void;
    el.onResyncBackstory = () =>
      new Promise<void>((r) => {
        resolve = r;
      });
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-drift-resync'
    )!;
    btn.click();
    await el.updateComplete;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent?.trim()).toBe('Re-syncing…');
    resolve();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    // Banner may have cleared itself (drift dismissed on success in
    // real flow); we only assert that the button is re-enabled IF
    // it's still rendered.
    const after = el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-drift-resync'
    );
    if (after) expect(after.disabled).toBe(false);
  });
});

describe('<chargen-dm-review> — P-R6 retire flow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders Retire button on bound-active seats when callback wired', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei-pc') };
    el.onRetirePc = () => true;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-retire')).not.toBeNull();
  });

  it('hides Retire button when no callback wired', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei-pc') };
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-retire')).toBeNull();
  });

  it('hides Retire button on unbound seats', async () => {
    const el = mount();
    el.pcSlots = { 1: unbound() };
    el.onRetirePc = () => true;
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-retire')).toBeNull();
  });

  it('shows "retired" tag on bound-retired seats', async () => {
    const el = mount();
    el.pcSlots = {
      1: {
        state: 'bound-retired',
        pcId: 'mei-pc',
        inFictionRetireReason: 'left after a hard betrayal'
      }
    };
    await el.updateComplete;
    const tag = el.querySelector('.chargen-dm-review-seat-tag-retired');
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toMatch(/retired/);
  });

  it('clicking Retire opens the dialog', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei-pc') };
    el.onRetirePc = () => true;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-retire'
    )!.click();
    await el.updateComplete;
    expect(el.querySelector('dialog.chargen-dm-review-retire-modal')).not.toBeNull();
  });

  it('commit is disabled until an in-fiction reason is typed', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei-pc') };
    el.onRetirePc = () => true;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-retire'
    )!.click();
    await el.updateComplete;
    const commit = el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-retire-commit'
    )!;
    expect(commit.disabled).toBe(true);
    const ta = el.querySelector<HTMLTextAreaElement>(
      '.chargen-dm-review-retire-reason-text'
    )!;
    ta.value = 'left the city';
    ta.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(commit.disabled).toBe(false);
  });

  it('commit fires onRetirePc with the typed reason + selected enum', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei-pc') };
    const calls: Array<Record<string, unknown>> = [];
    el.onRetirePc = (payload) => {
      calls.push(payload);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-retire'
    )!.click();
    await el.updateComplete;
    const ta = el.querySelector<HTMLTextAreaElement>(
      '.chargen-dm-review-retire-reason-text'
    )!;
    ta.value = 'left the city after a betrayal';
    ta.dispatchEvent(new Event('input'));
    // Pick 'died'
    const radio = el.querySelector<HTMLInputElement>(
      'input[name="retire-reason"][value="died"]'
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-retire-commit'
    )!.click();
    expect(calls.length).toBe(1);
    expect(calls[0].pcId).toBe('mei-pc');
    expect(calls[0].inFictionReason).toBe('left the city after a betrayal');
    expect(calls[0].reason).toBe('died');
  });

  it('Cancel closes the dialog without firing onRetirePc', async () => {
    const el = mount();
    el.pcSlots = { 1: bound('mei-pc') };
    const calls: unknown[] = [];
    el.onRetirePc = () => {
      calls.push(true);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-retire'
    )!.click();
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-retire-cancel'
    )!.click();
    await el.updateComplete;
    expect(calls).toEqual([]);
    expect(el.querySelector('dialog.chargen-dm-review-retire-modal')).toBeNull();
  });
});

describe('<chargen-dm-review> — Wave 2 stat swap-pair editor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the lock glyph on the +2 cell when synth holds the player-pick', async () => {
    const el = mountWith9Seats();
    // okResult puts +2 on INT.
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const cells = el.querySelectorAll('.chargen-dm-review-stat-cell');
    expect(cells.length).toBe(6);
    const picked = el.querySelector('.chargen-dm-review-stat-cell-pick');
    expect(picked?.textContent).toMatch(/INT/);
    expect(picked?.querySelector('.chargen-dm-review-stat-lock')).not.toBeNull();
  });

  it('cells become buttons when onEditPreAccept is wired', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const btns = el.querySelectorAll(
      'button.chargen-dm-review-stat-cell-editable'
    );
    expect(btns.length).toBe(6);
  });

  it('cells are display-only when no onEditPreAccept callback is wired', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    // onEditPreAccept intentionally null
    await el.updateComplete;
    const btns = el.querySelectorAll(
      'button.chargen-dm-review-stat-cell-editable'
    );
    expect(btns.length).toBe(0);
  });

  it('click-pair swap between two non-pick cells commits immediately', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: Array<Record<string, unknown>> = [];
    el.onEditPreAccept = (slot, patch) => {
      patches.push({ slot, ...patch });
      return true;
    };
    await el.updateComplete;
    // okResult: STR=0, DEX=1, CON=1, INT=2, WIS=1, CHA=0.
    // Swap STR (0) with DEX (1) — neither is the +2 holder.
    const cells = el.querySelectorAll<HTMLButtonElement>(
      'button.chargen-dm-review-stat-cell-editable'
    );
    cells[0].click(); // STR
    await el.updateComplete;
    cells[1].click(); // DEX
    await el.updateComplete;
    expect(patches.length).toBe(1);
    expect(patches[0].slot).toBe(1);
    const newStats = patches[0].stats as { STR: number; DEX: number };
    expect(newStats.STR).toBe(1);
    expect(newStats.DEX).toBe(0);
  });

  it('clicking the same cell twice cancels the selection', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: unknown[] = [];
    el.onEditPreAccept = () => {
      patches.push(true);
      return true;
    };
    await el.updateComplete;
    const cells = el.querySelectorAll<HTMLButtonElement>(
      'button.chargen-dm-review-stat-cell-editable'
    );
    cells[0].click();
    await el.updateComplete;
    cells[0].click();
    await el.updateComplete;
    expect(patches).toEqual([]);
    expect(
      el.querySelector('.chargen-dm-review-stat-cell-selected')
    ).toBeNull();
  });

  it('swap involving the +2 pick surfaces a confirm strip (does NOT commit)', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: unknown[] = [];
    el.onEditPreAccept = () => {
      patches.push(true);
      return true;
    };
    await el.updateComplete;
    const cells = el.querySelectorAll<HTMLButtonElement>(
      'button.chargen-dm-review-stat-cell-editable'
    );
    // INT (idx 3) is the +2 pick.  Swap STR with INT.
    cells[0].click(); // STR
    await el.updateComplete;
    cells[3].click(); // INT
    await el.updateComplete;
    expect(patches).toEqual([]); // no commit yet
    expect(
      el.querySelector('.chargen-dm-review-stat-confirm')
    ).not.toBeNull();
  });

  it('clicking Override on the confirm strip commits the swap', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: Array<Record<string, unknown>> = [];
    el.onEditPreAccept = (slot, patch) => {
      patches.push({ slot, ...patch });
      return true;
    };
    await el.updateComplete;
    const cells = el.querySelectorAll<HTMLButtonElement>(
      'button.chargen-dm-review-stat-cell-editable'
    );
    cells[0].click(); // STR
    await el.updateComplete;
    cells[3].click(); // INT (the +2 holder)
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-stat-confirm-yes'
    )!.click();
    await el.updateComplete;
    expect(patches.length).toBe(1);
    const stats = patches[0].stats as { STR: number; INT: number };
    expect(stats.STR).toBe(2);
    expect(stats.INT).toBe(0);
    expect(
      el.querySelector('.chargen-dm-review-stat-confirm')
    ).toBeNull();
  });

  it('clicking Cancel on the confirm strip drops the swap (no commit)', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: unknown[] = [];
    el.onEditPreAccept = () => {
      patches.push(true);
      return true;
    };
    await el.updateComplete;
    const cells = el.querySelectorAll<HTMLButtonElement>(
      'button.chargen-dm-review-stat-cell-editable'
    );
    cells[0].click();
    await el.updateComplete;
    cells[3].click();
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-stat-confirm-no'
    )!.click();
    await el.updateComplete;
    expect(patches).toEqual([]);
    expect(
      el.querySelector('.chargen-dm-review-stat-confirm')
    ).toBeNull();
  });

  it('lock stays on the original-pick cell after the +2 moves (drift snapshot wins)', async () => {
    const el = mountWith9Seats();
    // Original AI output put +2 on INT.  DM has already swapped to put +2 on STR.
    // The drift snapshot remembers INT as the original.
    const r = okResult('Mei');
    r.response.stats = { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 1, CHA: 0 };
    el.synthResults = new Map([[1, r]]);
    el.preAcceptDrift = new Map([
      [
        1,
        {
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 }
        }
      ]
    ]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const picked = el.querySelector('.chargen-dm-review-stat-cell-pick');
    expect(picked?.textContent).toMatch(/INT/);
  });
});

describe('<chargen-dm-review> — Wave 2 tag/skill chip editing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders × on each tag chip when editable', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const removes = el.querySelectorAll(
      '.chargen-dm-review-tags .chargen-dm-review-chip-remove'
    );
    // okResult has 3 tags.
    expect(removes.length).toBe(3);
  });

  it('clicking × on a tag fires onEditPreAccept with the tag removed', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: Array<Record<string, unknown>> = [];
    el.onEditPreAccept = (slot, patch) => {
      patches.push({ slot, ...patch });
      return true;
    };
    await el.updateComplete;
    const removes = el.querySelectorAll<HTMLButtonElement>(
      '.chargen-dm-review-tags .chargen-dm-review-chip-remove'
    );
    removes[0].click();
    expect(patches.length).toBe(1);
    expect(patches[0].slot).toBe(1);
    const tags = patches[0].tags as string[];
    expect(tags).toEqual(['reluctant insomniac', 'sister of a pilot']);
  });

  it('clicking + opens the add-tag input', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    const add = el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-tags .chargen-dm-review-chip-add'
    );
    expect(add).not.toBeNull();
    add!.click();
    await el.updateComplete;
    expect(
      el.querySelector('.chargen-dm-review-chip-input-tag')
    ).not.toBeNull();
  });

  it('Enter on the add-tag input commits the new tag', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: Array<Record<string, unknown>> = [];
    el.onEditPreAccept = (slot, patch) => {
      patches.push({ slot, ...patch });
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-tags .chargen-dm-review-chip-add'
    )!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-chip-input-tag'
    )!;
    input.value = 'night-shift mechanic';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(patches.length).toBe(1);
    const tags = patches[0].tags as string[];
    expect(tags).toContain('night-shift mechanic');
    expect(tags.length).toBe(4);
  });

  it('refuses to add a duplicate tag', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: unknown[] = [];
    el.onEditPreAccept = () => {
      patches.push(true);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-tags .chargen-dm-review-chip-add'
    )!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-chip-input-tag'
    )!;
    input.value = 'junior engineer'; // already in the tag list
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(patches).toEqual([]);
  });

  it('Esc on the add-tag input cancels without firing', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: unknown[] = [];
    el.onEditPreAccept = () => {
      patches.push(true);
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-tags .chargen-dm-review-chip-add'
    )!.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.chargen-dm-review-chip-input-tag'
    )!;
    input.value = 'foo';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await el.updateComplete;
    expect(patches).toEqual([]);
    expect(
      el.querySelector('.chargen-dm-review-chip-input-tag')
    ).toBeNull();
  });

  it('skill add dropdown lists only categories not already chosen', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]); // Tech + Knowledge
    el.onEditPreAccept = () => true;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-skills .chargen-dm-review-chip-add'
    )!.click();
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
    expect(opts.length).toBe(6);
  });

  it('picking a skill from the dropdown commits the add', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: Array<Record<string, unknown>> = [];
    el.onEditPreAccept = (slot, patch) => {
      patches.push({ slot, ...patch });
      return true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-skills .chargen-dm-review-chip-add'
    )!.click();
    await el.updateComplete;
    const select = el.querySelector<HTMLSelectElement>(
      '.chargen-dm-review-chip-input-skill'
    )!;
    select.value = 'Insight';
    select.dispatchEvent(new Event('change'));
    expect(patches.length).toBe(1);
    const skills = patches[0].skillMastery as string[];
    expect(skills).toContain('Insight');
  });

  it('clicking × on a skill chip removes it', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    const patches: Array<Record<string, unknown>> = [];
    el.onEditPreAccept = (slot, patch) => {
      patches.push({ slot, ...patch });
      return true;
    };
    await el.updateComplete;
    const removes = el.querySelectorAll<HTMLButtonElement>(
      '.chargen-dm-review-skills .chargen-dm-review-chip-remove'
    );
    removes[0].click();
    expect(patches.length).toBe(1);
    const skills = patches[0].skillMastery as string[];
    expect(skills).toEqual(['Knowledge']);
  });

  it('chips are display-only when onEditPreAccept callback is null', async () => {
    const el = mountWith9Seats();
    el.synthResults = new Map([[1, okResult('Mei')]]);
    await el.updateComplete;
    expect(
      el.querySelector('.chargen-dm-review-chip-remove')
    ).toBeNull();
    expect(
      el.querySelector('.chargen-dm-review-chip-add')
    ).toBeNull();
  });
});

describe('<chargen-dm-review> — Wave 2 party-stats nudge', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not render with fewer than 3 ok PCs (post-Wave-2 review fix)', async () => {
    const el = mount();
    el.pcSlots = { 1: unbound(), 2: unbound() };
    // Even a +4-sum CHA party of 2 should not nudge — two players
    // sharing a +2 emphasis is a legit party-design choice.
    const r1 = okResult('A');
    r1.response.stats = { STR: 0, DEX: 1, CON: 1, INT: 1, WIS: 0, CHA: 2 };
    const r2 = okResult('B');
    r2.response.stats = { STR: 0, DEX: 0, CON: 1, INT: 1, WIS: 1, CHA: 2 };
    el.synthResults = new Map([
      [1, r1],
      [2, r2]
    ]);
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-party-nudge')).toBeNull();
  });

  it('does not render when distribution is balanced (3 PCs)', async () => {
    const el = mount();
    el.pcSlots = { 1: unbound(), 2: unbound(), 3: unbound() };
    const r1 = okResult('A');
    r1.response.stats = { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 };
    const r2 = okResult('B');
    r2.response.stats = { STR: 2, DEX: 1, CON: 0, INT: 0, WIS: 1, CHA: 1 };
    const r3 = okResult('C');
    r3.response.stats = { STR: 1, DEX: 0, CON: 2, INT: 1, WIS: 1, CHA: 0 };
    el.synthResults = new Map([
      [1, r1],
      [2, r2],
      [3, r3]
    ]);
    await el.updateComplete;
    // Each stat sums 2-3 across 3 PCs; threshold scales to 3, so
    // none triggers.
    expect(el.querySelector('.chargen-dm-review-party-nudge')).toBeNull();
  });

  it('renders nudge when a stat sums above the scaled threshold (3 PCs share CHA emphasis)', async () => {
    const el = mount();
    el.pcSlots = { 1: unbound(), 2: unbound(), 3: unbound() };
    // 3 PCs all with +2 in CHA = sum +6, well above 3-PC threshold of 3.
    const r1 = okResult('A');
    r1.response.stats = { STR: 0, DEX: 1, CON: 1, INT: 1, WIS: 0, CHA: 2 };
    const r2 = okResult('B');
    r2.response.stats = { STR: 0, DEX: 0, CON: 1, INT: 1, WIS: 1, CHA: 2 };
    const r3 = okResult('C');
    r3.response.stats = { STR: 1, DEX: 0, CON: 1, INT: 1, WIS: 0, CHA: 2 };
    el.synthResults = new Map([
      [1, r1],
      [2, r2],
      [3, r3]
    ]);
    await el.updateComplete;
    const nudge = el.querySelector('.chargen-dm-review-party-nudge');
    expect(nudge).not.toBeNull();
    expect(nudge!.textContent).toMatch(/CHA/);
    expect(nudge!.textContent).toMatch(/\+6/);
    expect(nudge!.textContent).toMatch(/leans/);
  });

  // Note: the "light on" (sum ≤ -2) branch can't trigger from valid
  // chargen synth data (fixed-array stats: one +2, three +1, two 0,
  // no negatives).  The branch is in place for post-accept / in-
  // session contexts where harm can push a stat below 0.  Not
  // exercised in chargen tests.

  it('picks the most extreme stat when multiple trigger', async () => {
    const el = mount();
    el.pcSlots = { 1: unbound(), 2: unbound(), 3: unbound() };
    // Three PCs all stacking CHA — sum +6 vs other triggers smaller.
    const r1 = okResult('A');
    r1.response.stats = { STR: 0, DEX: 1, CON: 1, INT: 1, WIS: 0, CHA: 2 };
    const r2 = okResult('B');
    r2.response.stats = { STR: 0, DEX: 1, CON: 1, INT: 1, WIS: 0, CHA: 2 };
    const r3 = okResult('C');
    r3.response.stats = { STR: 0, DEX: 1, CON: 1, INT: 1, WIS: 0, CHA: 2 };
    el.synthResults = new Map([
      [1, r1],
      [2, r2],
      [3, r3]
    ]);
    await el.updateComplete;
    const nudge = el.querySelector('.chargen-dm-review-party-nudge');
    expect(nudge!.textContent).toMatch(/CHA/);
    expect(nudge!.textContent).toMatch(/\+6/);
  });
});

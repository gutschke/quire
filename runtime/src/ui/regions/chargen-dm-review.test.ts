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

  it('P3U-12: renders display name when displayNameLookup resolves', async () => {
    const el = mount();
    el.pcSlots = { 1: 'mei-tanaka' };
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
    const el = mount();
    el.pcSlots = { 1: 'mei-tanaka' };
    el.displayNameLookup = () => null; // not yet resolved
    await el.updateComplete;
    const seat = el.querySelector('.chargen-dm-review-seat');
    expect(seat?.textContent).toMatch(/mei-tanaka/);
    expect(
      seat?.querySelector('.chargen-dm-review-seat-display-name')
    ).toBeNull();
  });

  it('P3U-12: Lit auto-escapes a hostile name field (XSS defense)', async () => {
    const el = mount();
    el.pcSlots = { 1: 'evil' };
    el.displayNameLookup = () => '<script>alert(1)</script>';
    await el.updateComplete;
    const seat = el.querySelector('.chargen-dm-review-seat');
    expect(seat?.querySelector('script')).toBeNull();
    expect(seat?.textContent).toMatch(/script.alert/);
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
    const el = mount();
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
    const el = mount();
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

describe('<chargen-dm-review> — accept + revise (CC-24 + P3T-19)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows Accept button only when synth result is ok', async () => {
    const el = mount();
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
    const el = mount();
    const calls: number[] = [];
    el.synthResults = new Map([[4, okResult()]]);
    el.onAccept = (slot) => calls.push(slot);
    el.onRevise = () => {};
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-accept')!.click();
    expect(calls).toEqual([4]);
  });

  it('Accept button is disabled (and labeled "Accepted") when slot is in acceptedSlots', async () => {
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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

  it('highlights anchor phrases inside the backstory body', async () => {
    const el = mount();
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
      'meaningful-item': 'a marina pass',
      'prior-connection': 'none',
      'flight-reason': 'work'
    });
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    const marks = el.querySelectorAll('.chargen-dm-review-mark');
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].some((m) => /marina/i.test(m.textContent ?? ''))).toBe(
      true
    );
  });

  it('shows "no saved answers" copy when answersLookup returns null', async () => {
    const el = mount();
    el.synthResults = new Map([[1, okResult()]]);
    el.answersLookup = () => null;
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.chargen-dm-review-expand')!.click();
    await el.updateComplete;
    const answers = el.querySelector('.chargen-dm-review-diff-answers');
    expect(answers?.textContent).toMatch(/No saved answers/);
  });

  it('P3T-16: Lit auto-escapes hostile content from player answers + backstory', async () => {
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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
    const el = mount();
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

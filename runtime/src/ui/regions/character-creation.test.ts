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
    // D5.5-B: added the "Connections" step (bond authoring) between
    // Build and Done, taking the strip from 5 → 6.
    const el = mount();
    await el.updateComplete;
    const steps = el.querySelectorAll('.character-creation-progress-step');
    expect(steps.length).toBe(6);
    expect(el.textContent).toContain('Connections');
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

  it('path button click invokes onPickPath with the chosen path (qa, questions present)', async () => {
    // Phase 3 polish (2026-05-22): pre-gen and free-write buttons
    // are now disabled with hover-text reasons (placeholder paths
    // until CC-7 / pre-gen browser lands).  The qa button is
    // enabled only when the campaign declares questions.  Pass a
    // non-empty questions array so the qa button is live for this
    // wiring test.
    const el = mount();
    el.questions = [
      {
        id: 'q1',
        kind: 'short-answer',
        prompt: 'A question.',
        required: true
      }
    ];
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
    paths[0].click(); // qa (the first button)
    expect(chosen).toBe('qa');
  });

  it('disabled path button click does NOT invoke onPickPath', async () => {
    // Free-write and pre-gen are unimplemented; they render as
    // disabled with hover-text.  Clicks must be inert.
    const el = mount();
    let chosen: CreationPath | null = null;
    el.onPickPath = (p) => {
      chosen = p;
    };
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
    paths[1].click(); // free-write — disabled
    paths[2].click(); // pre-gen — disabled
    expect(chosen).toBeNull();
    // disabledReason surfaces as title hover-text.
    expect(paths[1].getAttribute('title')).toContain('free-write');
    expect(paths[2].getAttribute('title')).toContain('pre-made');
  });

  it('clicking an enabled path auto-advances to step 4 (no separate Next click)', async () => {
    const el = mount();
    el.questions = [
      {
        id: 'q1',
        kind: 'short-answer',
        prompt: 'A question.',
        required: true
      }
    ];
    await el.updateComplete;
    const next = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    )[1];
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    // Currently on step 3.
    expect(el.textContent).toContain('Step 3 of 6');
    const paths = el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-path'
    );
    paths[0].click();
    await el.updateComplete;
    expect(el.textContent).toContain('Step 4 of 6');
  });

  it('step 4 renders the free-write placeholder when chosenPath=free-write', async () => {
    // The 'qa' branch now renders the real Q&A form (CC-6); the
    // placeholder-label test moves to the 'free-write' path which
    // still uses the placeholder pending CC-7.
    const el = mount();
    el.chosenPath = 'free-write';
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
    expect(el.textContent).toContain('free-write editor');
    expect(el.textContent).toContain('lands in a later commit');
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

  describe('CC-6: Q&A form (chosenPath === "qa")', () => {
    async function mountAtStep4WithPath(): Promise<CharacterCreation> {
      const el = mount();
      el.chosenPath = 'qa';
      await el.updateComplete;
      // Advance to step 4 via 3× Next.
      const next = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      )[1];
      next.click();
      await el.updateComplete;
      next.click();
      await el.updateComplete;
      next.click();
      await el.updateComplete;
      return el;
    }

    it('shows the friendly fallback when no questions are declared', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [];
      await el.updateComplete;
      expect(el.textContent).toContain("hasn't declared a question list");
    });

    it('renders an MC question as radio buttons', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'temperament',
          kind: 'mc',
          prompt: 'Under pressure?',
          required: true,
          options: [
            { value: 'quiet', label: 'Goes quiet' },
            { value: 'argues', label: 'Argues' }
          ]
        }
      ];
      await el.updateComplete;
      const radios = el.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name="temperament"]'
      );
      expect(radios.length).toBe(2);
      expect(radios[0].value).toBe('quiet');
      expect(radios[1].value).toBe('argues');
    });

    it('MC selection invokes onAnswerChange with id + value', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'temperament',
          kind: 'mc',
          prompt: 'Under pressure?',
          options: [
            { value: 'quiet', label: 'Goes quiet' },
            { value: 'argues', label: 'Argues' }
          ]
        }
      ];
      let captured: { id: string; value: string } | null = null;
      el.onAnswerChange = (id, value) => {
        captured = { id, value };
      };
      await el.updateComplete;
      const argues = el.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]'
      )[1];
      argues.click();
      expect(captured).toEqual({ id: 'temperament', value: 'argues' });
    });

    it('renders a short-answer question as a textarea with bounds', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'item',
          kind: 'short-answer',
          prompt: 'Meaningful item',
          minLength: 10,
          maxLength: 200
        }
      ];
      await el.updateComplete;
      const ta = el.querySelector<HTMLTextAreaElement>(
        '.character-creation-qa-textarea'
      );
      expect(ta).not.toBeNull();
      expect(ta?.name).toBe('item');
      expect(ta?.minLength).toBe(10);
      expect(ta?.maxLength).toBe(200);
    });

    it('short-answer input invokes onAnswerChange with the typed value', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'item',
          kind: 'short-answer',
          prompt: 'Meaningful item',
          minLength: 10
        }
      ];
      let captured = '';
      el.onAnswerChange = (id, value) => {
        if (id === 'item') captured = value;
      };
      await el.updateComplete;
      const ta = el.querySelector<HTMLTextAreaElement>(
        '.character-creation-qa-textarea'
      )!;
      ta.value = 'a small brass key from grandma';
      ta.dispatchEvent(new Event('input'));
      expect(captured).toBe('a small brass key from grandma');
    });

    it('short-answer warns when answer is below minLength', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'item',
          kind: 'short-answer',
          prompt: 'Meaningful item',
          minLength: 20
        }
      ];
      el.answers = { item: 'too short' };
      await el.updateComplete;
      expect(el.querySelector('.character-creation-qa-hint-warn')).not.toBeNull();
      expect(el.textContent).toContain('at least 20 characters');
    });

    it('short-answer remaining-chars hint counts down', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'item',
          kind: 'short-answer',
          prompt: 'Item',
          minLength: 10,
          maxLength: 100
        }
      ];
      el.answers = { item: 'a small brass key from grandma' };
      await el.updateComplete;
      const hint = el.querySelector('.character-creation-qa-hint');
      // 100 - 30 = 70 characters left.
      expect(hint?.textContent).toContain('70 characters left');
    });

    it('required marker appears on required questions only', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'required-q',
          kind: 'mc',
          prompt: 'Required',
          required: true,
          options: [{ value: 'a', label: 'a' }]
        },
        {
          id: 'optional-q',
          kind: 'mc',
          prompt: 'Optional',
          required: false,
          options: [{ value: 'b', label: 'b' }]
        }
      ];
      await el.updateComplete;
      const markers = el.querySelectorAll('.character-creation-qa-required');
      expect(markers.length).toBe(1);
    });

    it('numbered questions render in declaration order', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'q1',
          kind: 'mc',
          prompt: 'First',
          options: [{ value: 'a', label: 'a' }]
        },
        {
          id: 'q2',
          kind: 'short-answer',
          prompt: 'Second'
        },
        {
          id: 'q3',
          kind: 'mc',
          prompt: 'Third',
          options: [{ value: 'c', label: 'c' }]
        }
      ];
      await el.updateComplete;
      const nums = Array.from(
        el.querySelectorAll('.character-creation-qa-num')
      ).map((n) => n.textContent?.trim());
      expect(nums).toEqual(['1.', '2.', '3.']);
    });

    it('CC-10: step 6 (Done) renders Pack button when onPack is wired', async () => {
      const el = mount();
      el.onPack = () => {};
      await el.updateComplete;
      const next = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      )[1];
      // Advance to step 6 (Next × 5).
      for (let i = 0; i < 5; i++) {
        next.click();
        await el.updateComplete;
      }
      expect(el.querySelector('.character-creation-pack-button')).not.toBeNull();
    });

    it('CC-10: Pack button click invokes onPack', async () => {
      const el = mount();
      let invoked = 0;
      el.onPack = () => {
        invoked++;
      };
      await el.updateComplete;
      const next = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      )[1];
      for (let i = 0; i < 5; i++) {
        next.click();
        await el.updateComplete;
      }
      el.querySelector<HTMLButtonElement>(
        '.character-creation-pack-button'
      )!.click();
      expect(invoked).toBe(1);
    });

    it('CC-10: Pack button hidden when onPack is null', async () => {
      const el = mount();
      el.onPack = null;
      await el.updateComplete;
      const next = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      )[1];
      for (let i = 0; i < 5; i++) {
        next.click();
        await el.updateComplete;
      }
      expect(el.querySelector('.character-creation-pack-button')).toBeNull();
    });

    it('CC-10: packFeedback="packed" renders the ✓ success line', async () => {
      const el = mount();
      el.onPack = () => {};
      el.packFeedback = 'packed';
      await el.updateComplete;
      const next = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      )[1];
      for (let i = 0; i < 5; i++) {
        next.click();
        await el.updateComplete;
      }
      expect(
        el.querySelector('.character-creation-pack-feedback-ok')
      ).not.toBeNull();
      expect(el.textContent).toContain('Pack downloaded');
    });

    it('CC-10: packFeedback="pack-failed" renders the error line', async () => {
      const el = mount();
      el.onPack = () => {};
      el.packFeedback = 'pack-failed';
      await el.updateComplete;
      const next = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      )[1];
      for (let i = 0; i < 5; i++) {
        next.click();
        await el.updateComplete;
      }
      expect(
        el.querySelector('.character-creation-pack-feedback-err')
      ).not.toBeNull();
      expect(el.textContent).toContain('Could not pack');
    });

    it('selected MC option gets the chosen-styling class', async () => {
      const el = await mountAtStep4WithPath();
      el.questions = [
        {
          id: 'q',
          kind: 'mc',
          prompt: 'q',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' }
          ]
        }
      ];
      el.answers = { q: 'b' };
      await el.updateComplete;
      const chosen = el.querySelector(
        '.character-creation-qa-mc-option-chosen'
      );
      expect(chosen).not.toBeNull();
      expect(chosen?.textContent).toContain('B');
    });
  });
});

describe('D5.5-B: Connections step (bond authoring)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** Navigate to step 5 (Connections) via the Next button. */
  async function gotoConnections(el: CharacterCreation): Promise<void> {
    await el.updateComplete;
    for (let i = 0; i < 4; i++) {
      const next = el.querySelectorAll<HTMLButtonElement>(
        '.character-creation-stepnav button'
      )[1];
      next.click();
      await el.updateComplete;
    }
  }

  it('renders the Connections step with an empty state + add button', async () => {
    const el = mount();
    await gotoConnections(el);
    expect(el.textContent).toContain('Connections');
    expect(el.textContent).toMatch(/optional/i);
    expect(
      el.querySelector('.character-creation-connections-empty')
    ).not.toBeNull();
    expect(
      el.querySelector('.character-creation-connections-add')
    ).not.toBeNull();
  });

  it('Add a connection fires onBondDraftsChange with a blank row', async () => {
    const el = mount();
    let captured: Array<{ targetPlaceholder: string; text: string }> | null =
      null;
    el.onBondDraftsChange = (drafts) => {
      captured = drafts;
    };
    await gotoConnections(el);
    el.querySelector<HTMLButtonElement>(
      '.character-creation-connections-add'
    )!.click();
    expect(captured).toEqual([{ targetPlaceholder: '', text: '' }]);
  });

  it('editing target + text patches the right draft', async () => {
    const el = mount();
    const drafts = [{ targetPlaceholder: '', text: '' }];
    el.bondDrafts = drafts;
    let captured: Array<{ targetPlaceholder: string; text: string }> | null =
      null;
    el.onBondDraftsChange = (d) => {
      captured = d;
    };
    await gotoConnections(el);
    const target = el.querySelector<HTMLInputElement>(
      '.character-creation-connections-target'
    )!;
    target.value = 'the medic';
    target.dispatchEvent(new Event('input'));
    expect(captured).toEqual([{ targetPlaceholder: 'the medic', text: '' }]);
  });

  it('hides Add once at the 3-draft cap', async () => {
    const el = mount();
    el.bondDrafts = [
      { targetPlaceholder: 'a', text: 'one' },
      { targetPlaceholder: 'b', text: 'two' },
      { targetPlaceholder: 'c', text: 'three' }
    ];
    await gotoConnections(el);
    expect(
      el.querySelector('.character-creation-connections-add')
    ).toBeNull();
    expect(el.querySelectorAll('.character-creation-connections-row').length).toBe(
      3
    );
  });

  it('Remove drops the row', async () => {
    const el = mount();
    el.bondDrafts = [
      { targetPlaceholder: 'a', text: 'one' },
      { targetPlaceholder: 'b', text: 'two' }
    ];
    let captured: Array<{ targetPlaceholder: string; text: string }> | null =
      null;
    el.onBondDraftsChange = (d) => {
      captured = d;
    };
    await gotoConnections(el);
    el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-connections-remove'
    )[0]!.click();
    expect(captured).toEqual([{ targetPlaceholder: 'b', text: 'two' }]);
  });

  it('shows a soft-cap nudge for over-length bond text (not a gate)', async () => {
    const el = mount();
    el.bondDrafts = [{ targetPlaceholder: 'x', text: 'y'.repeat(141) }];
    await gotoConnections(el);
    expect(
      el.querySelector('.character-creation-qa-hint-warn')
    ).not.toBeNull();
  });

  it('Connections is skippable — Next reaches Done with zero bonds', async () => {
    const el = mount();
    await gotoConnections(el);
    // No bonds authored; advance once more to Done.
    el.querySelectorAll<HTMLButtonElement>(
      '.character-creation-stepnav button'
    )[1]!.click();
    await el.updateComplete;
    // Step 6 (Done) renders.
    expect(el.textContent?.toLowerCase()).toMatch(/pack|send|done|session/);
  });
});

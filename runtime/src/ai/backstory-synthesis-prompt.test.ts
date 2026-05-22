/**
 * backstory-synthesis-prompt tests (CC-19).
 */

import { describe, it, expect } from 'vitest';
import {
  buildBackstorySynthesisPrompt,
  assembleUserPrompt,
  UNDERLEAF_BACKSTORY_SYSTEM_PROMPT,
  type SynthesisPromptInput
} from './backstory-synthesis-prompt';
import type { CampaignCharCreationQuestion } from '../campaign-loader';

function mc(
  id: string,
  prompt: string,
  options: Array<[string, string]>
): CampaignCharCreationQuestion {
  return {
    id,
    kind: 'mc',
    prompt,
    options: options.map(([value, label]) => ({ value, label })),
    required: true
  };
}

function sa(id: string, prompt: string): CampaignCharCreationQuestion {
  return { id, kind: 'short-answer', prompt, required: true };
}

const BASE: SynthesisPromptInput = {
  campaignContext: [],
  dmConstraints: '',
  playerDisplayName: 'Markus',
  answers: []
};

describe('UNDERLEAF_BACKSTORY_SYSTEM_PROMPT', () => {
  it('contains the canonical tone anchors (Avoid + Prefer)', () => {
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('Avoid:');
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('Prefer:');
  });

  it('lists the JSON output fields', () => {
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('"name"');
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('"pronouns"');
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('"tags"');
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('"backstory"');
  });

  it('includes the magic-realization-arc hard constraint', () => {
    // Load-bearing for the spoiler-firewall layer (CC-20 catches
    // violations post-generation; CC-19 tells the AI not to
    // produce them in the first place).
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('magic');
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('The Quiet');
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('fate');
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('chosen');
  });

  it('includes the intent-against-pressure mandatory question', () => {
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain(
      'intention against pressure'
    );
  });

  it('includes the player-name-uniqueness constraint', () => {
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain(
      "name MUST differ from the player's name"
    );
  });

  it('includes the do-not-invent-secret guidance', () => {
    expect(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT).toContain('dark secret');
  });
});

describe('assembleUserPrompt', () => {
  it('returns a non-empty string for the minimal input', () => {
    const out = assembleUserPrompt(BASE);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('Your task');
  });

  it('includes the player display name as a negative constraint', () => {
    const out = assembleUserPrompt({ ...BASE, playerDisplayName: 'Mei' });
    expect(out).toContain('DO NOT REUSE');
    expect(out).toContain('Mei');
  });

  it('handles empty playerDisplayName with a fallback', () => {
    const out = assembleUserPrompt({ ...BASE, playerDisplayName: '' });
    expect(out).toContain('(none provided)');
  });

  it('omits the DM constraints section when empty', () => {
    const out = assembleUserPrompt({ ...BASE, dmConstraints: '' });
    expect(out).not.toContain('DM constraints for this player');
  });

  it('includes DM constraints when non-empty', () => {
    const out = assembleUserPrompt({
      ...BASE,
      dmConstraints: 'must have a Taipei connection'
    });
    expect(out).toContain('DM constraints');
    expect(out).toContain('must have a Taipei connection');
  });

  it('omits campaign-canon section when context is empty', () => {
    const out = assembleUserPrompt({ ...BASE, campaignContext: [] });
    expect(out).not.toContain('Campaign canon');
  });

  it('includes the campaign-canon section when context provided', () => {
    const out = assembleUserPrompt({
      ...BASE,
      campaignContext: [
        { path: 'campaign.json', content: '{"name":"Underleaf"}' }
      ]
    });
    expect(out).toContain('Campaign canon');
    expect(out).toContain('Underleaf');
  });

  it('formats an MC question with the option label, not the raw value', () => {
    const q = mc('archetype', 'Pick an archetype', [
      ['hacker', 'Hacker — works with networks'],
      ['engineer', 'Engineer — builds, fixes']
    ]);
    const out = assembleUserPrompt({
      ...BASE,
      answers: [{ question: q, answer: 'hacker' }]
    });
    expect(out).toContain('Pick an archetype');
    expect(out).toContain('Hacker — works with networks');
    // The raw value isn't displayed (the AI sees the human label).
    // Confirm it doesn't appear standalone (the label is what shows).
    expect(out).not.toMatch(/Answer: hacker\b(?!\s—)/);
  });

  it('formats a short-answer question with the player text in triple quotes', () => {
    const q = sa(
      'intent-moment',
      'Describe the moment your PC learned to hold an intention'
    );
    const out = assembleUserPrompt({
      ...BASE,
      answers: [
        {
          question: q,
          answer: 'I stood up to a teacher who was lying about a friend.'
        }
      ]
    });
    expect(out).toContain(
      'Describe the moment your PC learned to hold an intention'
    );
    expect(out).toContain('"""');
    expect(out).toContain(
      'I stood up to a teacher who was lying about a friend.'
    );
  });

  it('preserves answer order (declared sequence is canonical)', () => {
    const q1 = mc('q1', 'First question', [['a', 'A']]);
    const q2 = sa('q2', 'Second question');
    const q3 = mc('q3', 'Third question', [['c', 'C']]);
    const out = assembleUserPrompt({
      ...BASE,
      answers: [
        { question: q1, answer: 'a' },
        { question: q2, answer: 'middle text' },
        { question: q3, answer: 'c' }
      ]
    });
    const i1 = out.indexOf('First question');
    const i2 = out.indexOf('Second question');
    const i3 = out.indexOf('Third question');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it('falls back to raw value if MC option lookup fails', () => {
    // A poisoned answers list (option value not in the question's
    // options[]) shouldn't crash; the assembler shows the raw
    // value rather than guessing.
    const q = mc('archetype', 'Pick', [['hacker', 'Hacker']]);
    const out = assembleUserPrompt({
      ...BASE,
      answers: [{ question: q, answer: 'invented-value' }]
    });
    expect(out).toContain('invented-value');
  });

  it('places the task instruction LAST', () => {
    const out = assembleUserPrompt({
      ...BASE,
      campaignContext: [{ path: 'c.json', content: '{}' }],
      dmConstraints: 'something',
      answers: [
        { question: sa('q1', 'Q1'), answer: 'something' }
      ]
    });
    const taskIdx = out.indexOf('Your task');
    const answersIdx = out.indexOf("Player's answers");
    expect(taskIdx).toBeGreaterThan(answersIdx);
    // No section appears after the task line.
    const afterTask = out.slice(taskIdx);
    expect(afterTask).not.toMatch(/^# /m);
  });
});

describe('buildBackstorySynthesisPrompt', () => {
  it('returns both system and user halves', () => {
    const r = buildBackstorySynthesisPrompt(BASE);
    expect(r).toHaveProperty('system');
    expect(r).toHaveProperty('user');
  });

  it('system half is the canonical Underleaf prompt', () => {
    const r = buildBackstorySynthesisPrompt(BASE);
    expect(r.system).toBe(UNDERLEAF_BACKSTORY_SYSTEM_PROMPT);
  });

  it('user half reflects the answers passed in', () => {
    const q = mc('archetype', 'Pick', [['hacker', 'Hacker']]);
    const r = buildBackstorySynthesisPrompt({
      ...BASE,
      answers: [{ question: q, answer: 'hacker' }]
    });
    expect(r.user).toContain('Hacker');
  });
});

/**
 * backstory-validator tests (CC-21).
 */

import { describe, it, expect } from 'vitest';
import {
  validatePcBackstory,
  countWords,
  containsAnyPlaceToken,
  partitionIssues,
  type BackstoryValidationIssue
} from './backstory-validator';
import type { PcBackstorySynthesisResponse } from './schema';

function makeBackstory(
  words: number,
  prefix: string = 'Mei lived in San Francisco.'
): string {
  const padded = Array.from({ length: words }, () => 'lorem').join(' ');
  return prefix + ' ' + padded;
}

function valid(
  overrides: Partial<PcBackstorySynthesisResponse> = {}
): PcBackstorySynthesisResponse {
  return {
    name: 'Mei Tanaka',
    pronouns: 'she/her',
    tags: [
      'junior engineer',
      'reluctant insomniac',
      'sister of a pilot'
    ],
    backstory: makeBackstory(300),
    raw: '{}',
    tokensIn: 100,
    tokensOut: 250,
    responseId: 'syn-1',
    ...overrides
  };
}

describe('countWords', () => {
  it('returns 0 for empty / whitespace-only', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('\n\t  ')).toBe(0);
  });

  it('counts single word', () => {
    expect(countWords('hello')).toBe(1);
  });

  it('counts words separated by mixed whitespace', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('a\tb\nc')).toBe(3);
    expect(countWords('  a   b   c  ')).toBe(3);
  });

  it('counts markdown-flavored words as one (no special parsing)', () => {
    // **bold** is one "word" — at this layer we don't strip
    // markdown.  Close enough for word-count bounds checks.
    expect(countWords('**bold** _italic_ text')).toBe(3);
  });
});

describe('containsAnyPlaceToken', () => {
  it('returns false for empty text or empty allowlist', () => {
    expect(containsAnyPlaceToken('', ['San Francisco'])).toBe(false);
    expect(containsAnyPlaceToken('any text', [])).toBe(false);
  });

  it('matches a single token with word boundaries', () => {
    expect(
      containsAnyPlaceToken('She lived in the Mission for years.', [
        'Mission',
        'Outer Sunset'
      ])
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      containsAnyPlaceToken('She lived in the mission.', ['Mission'])
    ).toBe(true);
    expect(
      containsAnyPlaceToken('MISSION district', ['mission'])
    ).toBe(true);
  });

  it('honors word boundaries (does not match "missionary")', () => {
    expect(
      containsAnyPlaceToken('A missionary visited her.', ['Mission'])
    ).toBe(false);
  });

  it('matches multi-word place tokens', () => {
    expect(
      containsAnyPlaceToken(
        'she grew up in the Outer Sunset before moving away',
        ['Outer Sunset', 'Mission']
      )
    ).toBe(true);
  });

  it('escapes regex metacharacters in tokens', () => {
    expect(
      containsAnyPlaceToken('she met them at Pier 39 last summer', [
        'Pier 39'
      ])
    ).toBe(true);
  });
});

describe('validatePcBackstory', () => {
  it('accepts a clean response (no issues)', () => {
    expect(validatePcBackstory(valid())).toEqual([]);
  });

  describe('name checks', () => {
    it('flags empty name', () => {
      const issues = validatePcBackstory(valid({ name: '' }));
      expect(issues.some((i) => i.code === 'name-empty')).toBe(true);
      expect(issues.find((i) => i.code === 'name-empty')?.severity).toBe(
        'error'
      );
    });

    it('flags whitespace-only name', () => {
      const issues = validatePcBackstory(valid({ name: '   ' }));
      expect(issues.some((i) => i.code === 'name-empty')).toBe(true);
    });

    it('flags name matching player display name (case-insensitive)', () => {
      const issues = validatePcBackstory(valid({ name: 'Alice Smith' }), {
        playerDisplayName: 'alice smith'
      });
      expect(issues.some((i) => i.code === 'name-matches-player')).toBe(true);
    });

    it('does NOT flag when player name is undefined', () => {
      // No display name → name-match check is skipped.
      const issues = validatePcBackstory(valid({ name: 'Alice' }));
      expect(issues.some((i) => i.code === 'name-matches-player')).toBe(
        false
      );
    });

    it('does NOT flag when player name is empty', () => {
      const issues = validatePcBackstory(valid({ name: 'Alice' }), {
        playerDisplayName: '   '
      });
      expect(issues.some((i) => i.code === 'name-matches-player')).toBe(
        false
      );
    });
  });

  describe('tag checks', () => {
    it('flags too few tags (< 3 default)', () => {
      const issues = validatePcBackstory(valid({ tags: ['only-one'] }));
      expect(issues.some((i) => i.code === 'tags-too-few')).toBe(true);
      expect(issues.find((i) => i.code === 'tags-too-few')?.severity).toBe(
        'error'
      );
    });

    it('flags too many tags (> 5 default) as warning', () => {
      const issues = validatePcBackstory(
        valid({
          tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g']
        })
      );
      expect(issues.some((i) => i.code === 'tags-too-many')).toBe(true);
      expect(issues.find((i) => i.code === 'tags-too-many')?.severity).toBe(
        'warning'
      );
    });

    it('flags empty tag', () => {
      const issues = validatePcBackstory(
        valid({ tags: ['ok', '', 'ok'] })
      );
      expect(issues.some((i) => i.code === 'tag-empty')).toBe(true);
    });

    it('flags whitespace-only tag', () => {
      const issues = validatePcBackstory(
        valid({ tags: ['ok', '   ', 'ok'] })
      );
      expect(issues.some((i) => i.code === 'tag-empty')).toBe(true);
    });

    it('flags overly long tag', () => {
      const long = 'x'.repeat(100);
      const issues = validatePcBackstory(
        valid({ tags: ['ok', long, 'ok'] })
      );
      expect(issues.some((i) => i.code === 'tag-too-long')).toBe(true);
    });

    it('honors custom min/max tag counts', () => {
      const issues = validatePcBackstory(
        valid({ tags: ['a', 'b'] }),
        { minTags: 2 }
      );
      // 2 tags is OK when minTags is 2.
      expect(issues.some((i) => i.code === 'tags-too-few')).toBe(false);
    });
  });

  describe('backstory length checks', () => {
    it('flags too-short backstory (error)', () => {
      const issues = validatePcBackstory(
        valid({ backstory: makeBackstory(50) })
      );
      expect(issues.some((i) => i.code === 'backstory-too-short')).toBe(true);
      expect(
        issues.find((i) => i.code === 'backstory-too-short')?.severity
      ).toBe('error');
    });

    it('flags too-long backstory (warning, not error)', () => {
      // 400+ word backstory: warning, not blocking.
      const issues = validatePcBackstory(
        valid({ backstory: makeBackstory(500) })
      );
      expect(issues.some((i) => i.code === 'backstory-too-long')).toBe(true);
      expect(
        issues.find((i) => i.code === 'backstory-too-long')?.severity
      ).toBe('warning');
    });

    it('honors custom min/max word bounds', () => {
      const issues = validatePcBackstory(
        valid({ backstory: makeBackstory(50) }),
        { minWords: 30 }
      );
      expect(issues.some((i) => i.code === 'backstory-too-short')).toBe(
        false
      );
    });
  });

  describe('place-grounding (optional)', () => {
    it('flags missing place token when allowlist provided', () => {
      const issues = validatePcBackstory(
        valid({ backstory: makeBackstory(300, 'No place mentioned.') }),
        { placeAllowlist: ['Mission', 'Outer Sunset', 'Embarcadero'] }
      );
      expect(issues.some((i) => i.code === 'place-token-missing')).toBe(
        true
      );
    });

    it('does not flag when at least one allowlist token appears', () => {
      const issues = validatePcBackstory(
        valid({
          backstory: makeBackstory(
            300,
            'Mei grew up in the Mission district.'
          )
        }),
        { placeAllowlist: ['Mission', 'Outer Sunset'] }
      );
      expect(issues.some((i) => i.code === 'place-token-missing')).toBe(
        false
      );
    });

    it('skips the check when allowlist is empty / absent', () => {
      const issues = validatePcBackstory(
        valid({ backstory: makeBackstory(300, 'No place mentioned.') })
      );
      expect(issues.some((i) => i.code === 'place-token-missing')).toBe(
        false
      );
    });
  });

  it('accumulates multiple issues (does not stop at first error)', () => {
    // Synthetic worst-case: name empty, tags too few, backstory too short,
    // place missing.  All four should appear.
    const issues = validatePcBackstory(
      {
        name: '',
        pronouns: 'they/them',
        tags: ['only-one'],
        backstory: 'too short',
        raw: '',
        tokensIn: 0,
        tokensOut: 0,
        responseId: ''
      },
      { placeAllowlist: ['Mission'] }
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('name-empty');
    expect(codes).toContain('tags-too-few');
    expect(codes).toContain('backstory-too-short');
    expect(codes).toContain('place-token-missing');
  });
});

describe('partitionIssues', () => {
  it('splits errors from warnings', () => {
    const issues: BackstoryValidationIssue[] = [
      { severity: 'error', code: 'name-empty', message: 'a' },
      { severity: 'warning', code: 'tags-too-many', message: 'b' },
      { severity: 'error', code: 'backstory-too-short', message: 'c' }
    ];
    const { errors, warnings } = partitionIssues(issues);
    expect(errors.length).toBe(2);
    expect(warnings.length).toBe(1);
    expect(errors[0].code).toBe('name-empty');
    expect(warnings[0].code).toBe('tags-too-many');
  });

  it('handles empty list', () => {
    const { errors, warnings } = partitionIssues([]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

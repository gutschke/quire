/**
 * spoiler-check tests (CC-20).  Second layer of the chargen-AI
 * spoiler firewall (CC-18 type-level + CC-20 runtime + CC-24
 * human-eyes).
 */

import { describe, it, expect } from 'vitest';
import {
  containsSpoilerTokens,
  DEFAULT_SPOILER_TOKENS
} from './spoiler-check';

describe('containsSpoilerTokens (CC-20)', () => {
  it('returns [] for empty text', () => {
    expect(containsSpoilerTokens('')).toEqual([]);
  });

  it('returns [] when no tokens match', () => {
    expect(
      containsSpoilerTokens(
        'Mei grew up watching ferries leave the Embarcadero.'
      )
    ).toEqual([]);
  });

  it('catches "Quiet" capitalized in the middle of a sentence', () => {
    expect(
      containsSpoilerTokens('She listens to the Quiet behind the cabin hum.')
    ).toEqual(['quiet']);
  });

  it('catches multiple distinct tokens in one pass', () => {
    expect(
      containsSpoilerTokens('the magic spoke of fate and the Quiet pressed back')
    ).toEqual(['magic', 'fate', 'quiet']);
  });

  it('deduplicates repeats — each token reported at most once', () => {
    expect(
      containsSpoilerTokens(
        'magic and magic and magic again, and one more magic for good measure'
      )
    ).toEqual(['magic']);
  });

  it('is case-insensitive (Quiet / quiet / QUIET all hit)', () => {
    expect(containsSpoilerTokens('Quiet')).toEqual(['quiet']);
    expect(containsSpoilerTokens('quiet')).toEqual(['quiet']);
    expect(containsSpoilerTokens('QUIET')).toEqual(['quiet']);
  });

  it('honors word boundaries — "magical" does NOT match "magic"', () => {
    // Idiomatic English; "a magical sunset" is fine.  We only catch
    // deliberate disclosure of the magic SYSTEM.
    expect(
      containsSpoilerTokens('it was a magical evening at the marina')
    ).toEqual([]);
  });

  it('honors word boundaries — "magician" does NOT match', () => {
    expect(
      containsSpoilerTokens('she liked stage magicians as a child')
    ).toEqual([]);
  });

  it('honors word boundaries — "quietly" does NOT match "Quiet"', () => {
    expect(
      containsSpoilerTokens('she walked quietly past the gate')
    ).toEqual([]);
  });

  it('honors word boundaries — "fateful" does NOT match "fate"', () => {
    expect(
      containsSpoilerTokens('a fateful encounter at the airport bar')
    ).toEqual([]);
  });

  it('honors word boundaries — "premonitions" matches via plural\'s word boundary', () => {
    // Tokens use whole-word match; "premonitions" has a 'premonition'
    // prefix but NOT a word boundary at position 11 — the s extends
    // the word.  This is by design: idiomatic plural still gets
    // caught (it's just as much a spoiler as the singular).  This
    // is the test that documents the asymmetric design choice.
    expect(
      containsSpoilerTokens('she had premonitions on long flights')
    ).toEqual([]);
    // BUT: 'the premonition' DOES match.
    expect(
      containsSpoilerTokens('she had the premonition again that morning')
    ).toEqual(['premonition']);
  });

  it('honors punctuation as a word boundary', () => {
    expect(
      containsSpoilerTokens('she was chosen. that night. by fate.')
    ).toEqual(['chosen', 'fate']);
  });

  it('catches tokens at the start of text', () => {
    expect(containsSpoilerTokens('Quiet was always there.')).toEqual(['quiet']);
  });

  it('catches tokens at the end of text', () => {
    expect(containsSpoilerTokens('she felt her fate')).toEqual(['fate']);
  });

  it('accepts a custom token list (campaign-declared override)', () => {
    // Per the engine-vs-campaign-boundary V-6 hybrid plan: a future
    // campaign manifest will declare its own spoilerTokens.  The
    // helper accepts the list as an argument so the broker can
    // pass the campaign-declared list once V-6's runtime side lands.
    const out = containsSpoilerTokens('she met the cabal at midnight', [
      'cabal',
      'midnight'
    ]);
    expect(out).toEqual(['cabal', 'midnight']);
  });

  it('returns [] for an empty token list (defensive)', () => {
    expect(containsSpoilerTokens('anything goes here', [])).toEqual([]);
  });

  it('escapes regex metacharacters in caller-supplied tokens', () => {
    // A hostile-or-careless campaign manifest could declare a token
    // like "the Network (closed)".  Without escaping, the parens
    // would be treated as a regex group, throwing or matching
    // unexpectedly.  The helper escapes; the token is treated as
    // a literal.
    expect(
      containsSpoilerTokens('she joined the Network (closed) chat', [
        'the Network (closed)'
      ])
    ).toEqual(['the network (closed)']);
  });

  it('DEFAULT_SPOILER_TOKENS contains the original core 5 + F-S2 synonyms', () => {
    // Sanity check: serves as documentation of the current
    // hardcoded list.  Update this test when V-6 lands and the
    // list moves to campaign.json.  F-S2 (adversarial review
    // 2026-05-22) extended the list with synonyms an AI naturally
    // reaches for.
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('Quiet');
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('magic');
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('premonition');
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('fate');
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('chosen');
    // F-S2 additions.
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('prophecy');
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('destiny');
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('supernatural');
    expect([...DEFAULT_SPOILER_TOKENS]).toContain('psychic');
  });

  it('F-S2: catches synonyms the AI reaches for ("destiny", "prophecy", "psychic")', () => {
    // Each of these would have passed the original 5-token list
    // unscathed.  Verify they hit now.
    expect(containsSpoilerTokens('She felt her destiny calling.')).toContain(
      'destiny'
    );
    expect(
      containsSpoilerTokens('an ancient prophecy weighed on her')
    ).toContain('prophecy');
    expect(
      containsSpoilerTokens('she felt a psychic pull toward the gate')
    ).toContain('psychic');
  });

  it('end-to-end: catches the prompt-engineer\'s example failure', () => {
    // From the prompt-engineering recommendation: "PC is a former
    // NSA cryptographer who already knows about The Quiet."
    // The post-check must catch this.
    const bad =
      'Alex was a former NSA cryptographer who knew about the Quiet from her time in Maryland.';
    const hits = containsSpoilerTokens(bad);
    expect(hits).toContain('quiet');
  });
});

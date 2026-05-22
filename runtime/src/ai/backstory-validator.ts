/**
 * CC-21 (M4 char-creation): structural validator for AI-synthesized
 * backstories.  Third layer of the chargen-AI quality pipeline:
 *
 *   1. CC-18 — player-facing scope override (no DM-only context to
 *              the synthesis prompt).
 *   2. CC-20 — forbidden-token post-check (no Quiet/magic/etc.).
 *   3. CC-21 — structural validator (this file): word count, tag
 *              count, name uniqueness, optional place-token
 *              presence.
 *   4. CC-24 — DM approval gate (human-eyes; lands later).
 *
 * The validator is NON-BLOCKING: it returns a list of issues with
 * severities (`error` / `warning`) but doesn't reject the response.
 * The caller (broker glue, lands later) decides whether to auto-
 * retry (single retry on `error`) or surface as a DM warning at the
 * approval gate.
 *
 * Engine-vs-campaign positioning:
 * - The validator's STRUCTURE checks (tag count, word count, name
 *   uniqueness) are [E] — they're independent of campaign content.
 * - The CONTENT bounds (min/max word range, min/max tag count,
 *   place-token allowlist) are [H] — engine defaults at v1; campaign
 *   override per `campaign.json` later.
 */

import type { PcBackstorySynthesisResponse } from './schema';

export interface BackstoryValidationIssue {
  /**
   * `error` = single auto-retry recommended at the broker layer.
   * `warning` = surface at the DM approval gate but don't auto-retry.
   */
  severity: 'error' | 'warning';
  /** Stable code for testing + UI keying. */
  code:
    | 'name-empty'
    | 'name-matches-player'
    | 'pronouns-empty'
    | 'tags-too-few'
    | 'tags-too-many'
    | 'tag-empty'
    | 'tag-too-long'
    | 'backstory-too-short'
    | 'backstory-too-long'
    | 'place-token-missing';
  /** Human-friendly description; used in the retry prompt + DM banner. */
  message: string;
}

export interface BackstoryValidationOptions {
  /**
   * The inviting player's display name.  When provided, the validator
   * flags name collisions with this value (case-insensitive); the
   * prompt-engineering memo flags player-character collapse as a
   * common AI synthesis failure mode.
   */
  playerDisplayName?: string;
  /** Min words in `backstory`.  Default 250 per prompt-engineering recommendation. */
  minWords?: number;
  /** Max words in `backstory`.  Default 400. */
  maxWords?: number;
  /** Min tags.  Default 3. */
  minTags?: number;
  /** Max tags.  Default 5. */
  maxTags?: number;
  /** Max chars per tag (defensive cap). Default 80. */
  maxTagLength?: number;
  /**
   * When provided + non-empty, the validator flags an issue if NONE
   * of the supplied allowlist tokens appear (word-boundary, case-
   * insensitive) in the backstory.  Useful for the Bay Area place-
   * grounding check (CC-26 / CC-30 for Underleaf).  Pass an empty
   * array (or omit) to skip the check.
   */
  placeAllowlist?: readonly string[];
}

const DEFAULTS = {
  minWords: 250,
  maxWords: 400,
  minTags: 3,
  maxTags: 5,
  maxTagLength: 80
} as const;

/**
 * Count words in a string.  Splits on whitespace; trims edges.
 * Markdown formatting (asterisks, brackets) is treated as part of
 * the surrounding word for the bound — close enough at this layer.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Word-boundary-anchored case-insensitive scan for any token in the
 * allowlist.  Same lookaround semantics as `containsSpoilerTokens`
 * in `spoiler-check.ts` — multi-word tokens with punctuation match
 * cleanly.  Returns true if ANY token hits.
 */
export function containsAnyPlaceToken(
  text: string,
  allowlist: readonly string[]
): boolean {
  if (text.length === 0 || allowlist.length === 0) return false;
  const escaped = allowlist.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const re = new RegExp(`(?<!\\w)(${escaped.join('|')})(?!\\w)`, 'i');
  return re.test(text);
}

/**
 * Validate a parsed backstory response against structural rules.
 * Returns a list of issues; empty array means "clean."  Pure
 * function — no side effects, no network, no Date.now / random
 * dependency.
 */
export function validatePcBackstory(
  response: PcBackstorySynthesisResponse,
  options: BackstoryValidationOptions = {}
): BackstoryValidationIssue[] {
  const issues: BackstoryValidationIssue[] = [];
  const minWords = options.minWords ?? DEFAULTS.minWords;
  const maxWords = options.maxWords ?? DEFAULTS.maxWords;
  const minTags = options.minTags ?? DEFAULTS.minTags;
  const maxTags = options.maxTags ?? DEFAULTS.maxTags;
  const maxTagLength = options.maxTagLength ?? DEFAULTS.maxTagLength;

  // --- name ---
  if (!response.name || response.name.trim().length === 0) {
    issues.push({
      severity: 'error',
      code: 'name-empty',
      message: 'Character name is empty.'
    });
  } else if (
    options.playerDisplayName &&
    options.playerDisplayName.trim().length > 0 &&
    response.name.trim().toLowerCase() ===
      options.playerDisplayName.trim().toLowerCase()
  ) {
    issues.push({
      severity: 'error',
      code: 'name-matches-player',
      message: `Character name "${response.name}" matches the player's display name.  The AI should give the PC a different name.`
    });
  }

  // --- pronouns ---
  // The schema allows empty pronouns (some players prefer to set
  // their own); but a missing-but-not-empty value is worth a
  // warning so the DM knows to ask.
  if (response.pronouns === undefined || response.pronouns === null) {
    issues.push({
      severity: 'warning',
      code: 'pronouns-empty',
      message: 'Pronouns field is missing.  Player may want to fill in manually.'
    });
  }

  // --- tags ---
  if (response.tags.length < minTags) {
    issues.push({
      severity: 'error',
      code: 'tags-too-few',
      message: `Tags array has ${response.tags.length} entries; minimum is ${minTags}.`
    });
  } else if (response.tags.length > maxTags) {
    issues.push({
      severity: 'warning',
      code: 'tags-too-many',
      message: `Tags array has ${response.tags.length} entries; maximum is ${maxTags}.  Consider trimming.`
    });
  }
  for (const tag of response.tags) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      issues.push({
        severity: 'error',
        code: 'tag-empty',
        message: 'One or more tags are empty.'
      });
      break;
    }
    if (tag.length > maxTagLength) {
      issues.push({
        severity: 'warning',
        code: 'tag-too-long',
        message: `Tag "${tag.slice(0, 30)}…" exceeds ${maxTagLength} characters.`
      });
      break;
    }
  }

  // --- backstory ---
  const words = countWords(response.backstory);
  if (words < minWords) {
    issues.push({
      severity: 'error',
      code: 'backstory-too-short',
      message: `Backstory has ${words} words; minimum is ${minWords}.  AI was too brief.`
    });
  } else if (words > maxWords) {
    issues.push({
      severity: 'warning',
      code: 'backstory-too-long',
      message: `Backstory has ${words} words; maximum is ${maxWords}.  AI was over-verbose.`
    });
  }

  // --- place-grounding (optional) ---
  if (options.placeAllowlist && options.placeAllowlist.length > 0) {
    if (!containsAnyPlaceToken(response.backstory, options.placeAllowlist)) {
      issues.push({
        severity: 'warning',
        code: 'place-token-missing',
        message: `Backstory doesn't reference any of the campaign's named places.  Consider asking AI to ground the PC geographically.`
      });
    }
  }

  return issues;
}

/**
 * Convenience: split issues into errors + warnings.  The broker
 * uses `errors.length > 0` as the auto-retry trigger; the DM-side
 * approval gate surfaces both lists.
 */
export function partitionIssues(
  issues: readonly BackstoryValidationIssue[]
): {
  errors: BackstoryValidationIssue[];
  warnings: BackstoryValidationIssue[];
} {
  const errors: BackstoryValidationIssue[] = [];
  const warnings: BackstoryValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.severity === 'error') errors.push(issue);
    else warnings.push(issue);
  }
  return { errors, warnings };
}

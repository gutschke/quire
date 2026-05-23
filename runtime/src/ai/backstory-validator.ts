/**
 * CC-21 (M4 char-creation): SEMANTIC validator for AI-synthesized
 * backstories.  Third layer of the chargen-AI quality pipeline:
 *
 *   1. CC-18 — player-facing scope override (no DM-only context to
 *              the synthesis prompt).
 *   2. CC-20 — forbidden-token post-check (no Quiet/magic/etc.).
 *   3. CC-21 — semantic validator (this file): name-uniqueness vs
 *              the player's display name, word count, stat
 *              distribution multiset, place-token presence.
 *   4. CC-24 — DM approval gate (human-eyes; cluster E).
 *
 * The validator is NON-BLOCKING: it returns a list of issues with
 * severities (`error` / `warning`) but doesn't reject the response.
 * The synthesizer's auto-retry path runs once on `error`-severity
 * issues; warnings surface at the DM approval gate.
 *
 * **Phase 3b-X step 6 — shape-subsumed-by-schema posture:**
 *
 * Constrained decoding (Anthropic strict tool use; Gemini
 * responseSchema) at the provider boundary now enforces the
 * structural shape of the response — stats has all 6 keys with
 * integer values in range; skillMastery is a subset of
 * QUIRE_SKILL_CATEGORIES with uniqueItems; tags has 3-5 entries.
 * Several issue codes below are no longer reachable in the happy
 * path:
 *
 *   - `stats-shape-invalid`           — schema requires all 6 keys.
 *   - `stats-out-of-range`            — schema enforces -2..+3 bound.
 *   - `skill-mastery-shape-invalid`   — schema requires array.
 *   - `skill-mastery-unknown-category`— schema enum forbids.
 *   - `skill-mastery-duplicate`       — schema uniqueItems forbids.
 *   - `tags-too-few` / `tags-too-many`— schema minItems/maxItems.
 *   - `tag-empty` / `tag-too-long`    — schema item minLength/maxLength.
 *
 * Per the Phase 3b-X plan's Q1 (locked: keep as defense-in-depth),
 * these checks STAY in the validator but document themselves as
 * "schema-subsumed" — they fire only on schema drift (consumer
 * code path that bypasses the schema, future provider regression,
 * test mocks that don't enforce shapes).  The codes remain in the
 * STABLE CONTRACT issue-code union so downstream switches don't
 * break.
 *
 * The SEMANTIC checks below are NOT schema-subsumed and remain
 * load-bearing:
 *   - `name-empty` / `name-matches-player` (cross-checks player
 *     display name; impossible to express in a JSON Schema).
 *   - `pronouns-empty` (semantic empty-vs-missing distinction).
 *   - `backstory-too-short` / `backstory-too-long` (WORD count —
 *     the schema's minLength/maxLength is CHARACTER count, kept
 *     conservative; this is the load-bearing 250-400 word bound).
 *   - `place-token-missing` (campaign-declared allowlist; can't
 *     be expressed in a static JSON Schema).
 *   - `stats-shape-invalid` — multiset distribution check (one
 *     +2, three +1s, two 0s) IS load-bearing semantic; the
 *     schema's range bound (-2..+3) is insufficient.  The shape-
 *     error code is reused for this stricter check.
 *
 * Engine-vs-campaign positioning:
 * - STRUCTURE checks ([E]): name uniqueness, word count, stat
 *   multiset — independent of campaign content.
 * - CONTENT bounds ([H]): min/max word range, place-token
 *   allowlist — engine defaults at v1; campaign override per
 *   `campaign.json` later.
 */

import {
  QUIRE_SKILL_CATEGORIES,
  type PcBackstorySynthesisResponse,
  type PcStats
} from './schema';

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
    | 'place-token-missing'
    | 'stats-shape-invalid'
    | 'stats-out-of-range'
    | 'skill-mastery-shape-invalid'
    | 'skill-mastery-too-few'
    | 'skill-mastery-too-many'
    | 'skill-mastery-unknown-category'
    | 'skill-mastery-duplicate'
    /** Phase 3b polish (2026-05-23): synthesizer attached this code
        when the DM hand-edited a spoiler-leak-rejected backstory and
        chose to accept the cleaned version.  Audit-only — surfaces
        as a "DM edited" pip in the review card. */
    | 'dm-hand-edited';
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
  maxTagLength: 80,
  /**
   * P3T-2: starting skill-mastery picks.  Two to four picks based
   * on archetype.  Below 2 leaves the sheet underspecified; above 4
   * collides with the +2 modifier cap.
   */
  minSkillMastery: 2,
  maxSkillMastery: 4
} as const;

/**
 * P3T-2: the canonical quire-v0.1 starting stat distribution.  One
 * +2, three +1s, two 0s.  Multiset, not order — validator counts
 * occurrences.  Range bound is [-2, +3] per rules.md §Stats but the
 * fixed starting array never reaches the edges; deviation by even
 * one slot is a sign the AI ignored the constraint.
 */
const STARTING_STAT_DISTRIBUTION = [2, 1, 1, 1, 0, 0] as const;
const STAT_VALUE_MIN = -2;
const STAT_VALUE_MAX = 3;

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

  // --- P3T-2: stats shape (quire-v0.1 fixed starting array) ---
  validateStats(response.stats, issues);

  // --- P3T-2: skill mastery ---
  validateSkillMastery(response.skillMastery, issues);

  return issues;
}

/**
 * P3T-2: enforce the quire-v0.1 fixed starting array (one +2, three
 * +1s, two 0s) and the -2..+3 range bound from rules.md §Stats.
 * Distribution mismatch is an ERROR (auto-retry); out-of-range is
 * also ERROR.  Helper takes the issues array so the caller batches.
 */
function validateStats(
  stats: PcStats | undefined,
  issues: BackstoryValidationIssue[]
): void {
  // Defensive: in production the type guard runs first and rejects
  // missing/malformed stats outright, but the validator may be
  // called directly in tests (or by future call sites that skip the
  // guard) — so treat undefined / non-numeric values as a shape
  // error rather than throwing.
  if (!stats || typeof stats !== 'object') {
    issues.push({
      severity: 'error',
      code: 'stats-shape-invalid',
      message: 'Stats object is missing or malformed.'
    });
    return;
  }
  const values = [stats.STR, stats.DEX, stats.CON, stats.INT, stats.WIS, stats.CHA];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v))) {
    issues.push({
      severity: 'error',
      code: 'stats-shape-invalid',
      message: 'Stats object has missing or non-integer values.'
    });
    return;
  }
  for (const v of values) {
    if (v < STAT_VALUE_MIN || v > STAT_VALUE_MAX) {
      issues.push({
        severity: 'error',
        code: 'stats-out-of-range',
        message: `Stat value ${v} is outside the allowed range [${STAT_VALUE_MIN}, ${STAT_VALUE_MAX}].`
      });
      return;
    }
  }
  // Multiset check: sort + compare to canonical distribution.
  const sorted = [...values].sort((a, b) => b - a);
  const canonical = [...STARTING_STAT_DISTRIBUTION].sort((a, b) => b - a);
  for (let i = 0; i < canonical.length; i++) {
    if (sorted[i] !== canonical[i]) {
      issues.push({
        severity: 'error',
        code: 'stats-shape-invalid',
        message: `Stat distribution must be one +2, three +1s, two 0s (got [${sorted.join(', ')}] in descending order).`
      });
      return;
    }
  }
}

/**
 * P3T-2: enforce skillMastery is a 2-4 subset of the quire-v0.1
 * 8-category list.  Unknown categories are an ERROR (auto-retry);
 * too-few / too-many are warnings (DM can hand-tune at the gate).
 */
function validateSkillMastery(
  skills: readonly string[] | undefined,
  issues: BackstoryValidationIssue[]
): void {
  if (!Array.isArray(skills)) {
    issues.push({
      severity: 'error',
      code: 'skill-mastery-shape-invalid',
      message: 'skillMastery is missing or not an array.'
    });
    return;
  }
  // P3-sanity Adv B4: dedup check.  Without this, ["Tech","Tech","Tech"]
  // passed validation — the AI could collapse to a single mastery
  // category without the validator flagging the bug.  Treat as ERROR
  // (auto-retry-worthy) since dedup is a content correctness issue,
  // not a sheet-tuning preference.
  const dupes = skills.filter((s, i) => skills.indexOf(s) !== i);
  if (dupes.length > 0) {
    issues.push({
      severity: 'error',
      code: 'skill-mastery-duplicate',
      message: `skillMastery contains duplicate categor${dupes.length === 1 ? 'y' : 'ies'}: ${[...new Set(dupes)].map((d) => `"${d}"`).join(', ')}.  Each category may be listed at most once.`
    });
    return;
  }
  const allowed = new Set<string>(QUIRE_SKILL_CATEGORIES);
  const unknown = skills.filter((s) => !allowed.has(s));
  if (unknown.length > 0) {
    issues.push({
      severity: 'error',
      code: 'skill-mastery-unknown-category',
      message: `Unknown skill categor${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.map((u) => `"${u}"`).join(', ')}.  Allowed: ${QUIRE_SKILL_CATEGORIES.join(', ')}.`
    });
    return;
  }
  if (skills.length < DEFAULTS.minSkillMastery) {
    issues.push({
      severity: 'warning',
      code: 'skill-mastery-too-few',
      message: `Only ${skills.length} skill categor${skills.length === 1 ? 'y' : 'ies'} picked; ${DEFAULTS.minSkillMastery}-${DEFAULTS.maxSkillMastery} is the recommended starting range.`
    });
  } else if (skills.length > DEFAULTS.maxSkillMastery) {
    issues.push({
      severity: 'warning',
      code: 'skill-mastery-too-many',
      message: `${skills.length} skill categories picked; ${DEFAULTS.minSkillMastery}-${DEFAULTS.maxSkillMastery} is the recommended starting range.  DM may want to trim.`
    });
  }
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

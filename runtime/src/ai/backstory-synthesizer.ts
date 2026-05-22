/**
 * CC-19/CC-20/CC-21 integration: end-to-end backstory synthesis.
 *
 * Ties together every chargen-AI primitive landed in Phase 2:
 *   - CC-19 `buildBackstorySynthesisPrompt`  — system + user prompts.
 *   - Provider `call`                        — HTTP round-trip.
 *   - JSON parse + `isPcBackstorySynthesisResponse`  — shape check.
 *   - CC-20 `containsSpoilerTokens`          — single auto-retry.
 *   - CC-21 `validatePcBackstory`            — structural check.
 *
 * Returns a typed `SynthesizeBackstoryResult` so the UI layer can
 * distinguish "OK with warnings" from each failure category and
 * surface appropriate messaging:
 *   - `ok: true`   → DM approves at the gate (CC-24).
 *   - `parse-failed` / `validation-failed` → DM-side error banner;
 *     player may retry or hand-edit.
 *   - `spoiler-leak-persistent` → spoiler firewall caught a repeat
 *     leak after auto-retry; DM should hand-edit before sharing.
 *   - `provider-error` → network / API issue; transient retry path.
 *
 * Engine-vs-campaign positioning:
 * - The synthesizer mechanism is ENGINE.
 * - Spoiler tokens + system prompt + validator bounds are CAMPAIGN
 *   POLICY supplied via `req`.  The synthesizer doesn't hardcode
 *   Underleaf-specific lists.
 */

import type { AiProvider } from './broker';
import type { ContextFile } from './campaign-context';
import {
  buildBackstorySynthesisPrompt,
  type AnsweredQuestion
} from './backstory-synthesis-prompt';
import {
  isPcBackstorySynthesisResponse,
  type PcBackstorySynthesisResponse
} from './schema';
import {
  containsSpoilerTokens,
  DEFAULT_SPOILER_TOKENS
} from './spoiler-check';
import {
  validatePcBackstory,
  partitionIssues,
  type BackstoryValidationIssue,
  type BackstoryValidationOptions
} from './backstory-validator';

export interface SynthesizeBackstoryRequest {
  /** Player-facing campaign context (CC-18 buildPlayerFacingContext). */
  campaignContext: ContextFile[];
  /** DM-authored per-player constraints (free text). */
  dmConstraints: string;
  /** Inviting player's display name; AI is told NOT to reuse it. */
  playerDisplayName: string;
  /** Questionnaire answers in declaration order. */
  answers: AnsweredQuestion[];
  /** Provider API key; the caller (DM cockpit) supplies. */
  apiKey: string;
  /** Provider model id (e.g., 'claude-sonnet-4-6'). */
  model: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /**
   * Spoiler tokens to scan for in the AI's backstory output.
   * Defaults to `DEFAULT_SPOILER_TOKENS` (Underleaf-tuned: Quiet,
   * magic, etc.).  Caller passes a campaign-declared list when
   * V-6 hybrid lands.
   */
  spoilerTokens?: readonly string[];
  /** Structural-validator options forwarded to `validatePcBackstory`. */
  validatorOptions?: BackstoryValidationOptions;
}

export type SynthesizeBackstoryResult =
  | {
      ok: true;
      response: PcBackstorySynthesisResponse;
      /** Issues with `severity: 'warning'` from the validator; non-blocking. */
      warnings: BackstoryValidationIssue[];
      /** True when the auto-retry path ran (helpful diagnostic for DM logs). */
      retried: boolean;
    }
  | {
      ok: false;
      code:
        | 'parse-failed'
        | 'validation-failed'
        | 'spoiler-leak-persistent'
        | 'provider-error'
        | 'aborted';
      message: string;
      /** Present on validation-failed; lists the error-severity issues. */
      errors?: BackstoryValidationIssue[];
      /** Present on parse-failed / spoiler-leak — for DM audit. */
      rawResponse?: string;
      /** Present on spoiler-leak-persistent — which tokens kept hitting. */
      persistentTokens?: string[];
    };

/**
 * End-to-end synthesis.  Pure orchestration — no DOM, no Date.now
 * dependency, deterministic given identical provider responses.
 */
export async function synthesizeBackstory(
  provider: AiProvider,
  req: SynthesizeBackstoryRequest
): Promise<SynthesizeBackstoryResult> {
  const { system, user } = buildBackstorySynthesisPrompt({
    campaignContext: req.campaignContext,
    dmConstraints: req.dmConstraints,
    playerDisplayName: req.playerDisplayName,
    answers: req.answers
  });

  // ----- First attempt -----
  const first = await callAndParse(provider, req, system, user);
  if (!first.ok) return first;

  // ----- Spoiler check -----
  const tokens = req.spoilerTokens ?? DEFAULT_SPOILER_TOKENS;
  let active = first.response;
  let activeRaw = first.rawResponse;
  let retried = false;

  const firstHits = containsSpoilerTokens(active.backstory, tokens);
  if (firstHits.length > 0) {
    // Single auto-retry with a "do not use" appendix.  Per prompt-
    // engineering recommendation: name the caught tokens so the AI
    // knows exactly what to avoid; otherwise it tends to repeat
    // the same vocabulary.
    retried = true;
    const retryUser =
      user +
      '\n\n# Retry instruction\n' +
      `The previous attempt used these forbidden words: ${firstHits.join(', ')}.  ` +
      'Re-write the backstory WITHOUT using any of them.  Same JSON output format as before.';
    const second = await callAndParse(provider, req, system, retryUser);
    if (!second.ok) return second;
    active = second.response;
    activeRaw = second.rawResponse;
    const secondHits = containsSpoilerTokens(active.backstory, tokens);
    if (secondHits.length > 0) {
      return {
        ok: false,
        code: 'spoiler-leak-persistent',
        message:
          `AI repeated forbidden tokens (${secondHits.join(', ')}) ` +
          'after retry.  Surface to the DM at the approval gate for ' +
          'hand-edit before sharing with the player.',
        rawResponse: activeRaw,
        persistentTokens: secondHits
      };
    }
  }

  // ----- Structural validation -----
  const issues = validatePcBackstory(active, req.validatorOptions);
  const { errors, warnings } = partitionIssues(issues);
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'validation-failed',
      message: `Validation found ${errors.length} error(s); see \`errors\` for details.`,
      errors,
      rawResponse: activeRaw
    };
  }

  return {
    ok: true,
    response: active,
    warnings,
    retried
  };
}

/**
 * Inner helper return shape.  Either a successful parse OR one of
 * the three early-exit failure codes from `SynthesizeBackstoryResult`.
 * Spelled out as a direct union (rather than via `Extract`) because
 * TypeScript's literal-narrowing on the discriminant doesn't reach
 * through the parent's `SynthesizeBackstoryResult` definition.
 */
type CallParseResult =
  | { ok: true; response: PcBackstorySynthesisResponse; rawResponse: string }
  | {
      ok: false;
      code: 'parse-failed' | 'provider-error' | 'aborted';
      message: string;
      rawResponse?: string;
    };

async function callAndParse(
  provider: AiProvider,
  req: SynthesizeBackstoryRequest,
  system: string,
  user: string
): Promise<CallParseResult> {
  let callResult;
  try {
    callResult = await provider.call({
      apiKey: req.apiKey,
      model: req.model,
      systemPrompt: system,
      prompt: user,
      signal: req.signal
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return {
        ok: false,
        code: 'aborted',
        message: 'Synthesis was cancelled.'
      };
    }
    return {
      ok: false,
      code: 'provider-error',
      message: `Provider call failed: ${(e as Error).message}`
    };
  }

  // The AI may wrap the JSON in a fenced code block (```json ... ```)
  // or include preamble text before the JSON.  Strip both before
  // parsing.
  const cleaned = extractJsonObject(callResult.raw);
  if (cleaned === null) {
    return {
      ok: false,
      code: 'parse-failed',
      message: 'Response did not contain a parseable JSON object.',
      rawResponse: callResult.raw
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      ok: false,
      code: 'parse-failed',
      message: 'Extracted JSON object failed to parse.',
      rawResponse: callResult.raw
    };
  }

  // Augment with broker-filled fields BEFORE shape-checking; the
  // type guard allows them to be absent (provider-side parse can
  // satisfy the shape), but downstream code expects them filled.
  const augmented = {
    ...(typeof parsed === 'object' && parsed !== null ? parsed : {}),
    raw: callResult.raw,
    tokensIn: callResult.tokensIn,
    tokensOut: callResult.tokensOut,
    responseId: callResult.responseId
  };

  if (!isPcBackstorySynthesisResponse(augmented)) {
    return {
      ok: false,
      code: 'parse-failed',
      message:
        'Response is missing required fields (name / pronouns / tags / backstory).',
      rawResponse: callResult.raw
    };
  }

  return {
    ok: true,
    response: augmented,
    rawResponse: callResult.raw
  };
}

/**
 * Extract a JSON object substring from a raw provider response.
 * Handles three common cases:
 *   1. Raw text is already a JSON object — return as-is.
 *   2. Wrapped in a fenced code block (```json ... ``` or ``` ... ```)
 *      — strip the fence.
 *   3. Object embedded in surrounding prose ("Here's the JSON: { ... }")
 *      — substring from first `{` to last matching `}`.
 *
 * Returns null when no candidate object substring is found.  The
 * caller treats null as a parse failure.
 *
 * Exported via the test file for unit coverage.
 */
export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Case 1: already a JSON object.
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  // Case 2: fenced code block.  Conservative — match common
  // variants: ```json\n{...}\n```  and  ```\n{...}\n```.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      return inner;
    }
  }

  // Case 3: object embedded in prose.  Find the FIRST `{` and the
  // LAST `}` and try that substring.  Brittle (won't handle a JSON
  // string containing `}` followed by trailing prose ending in `}`)
  // but good enough for the "preamble + JSON + trailing newline"
  // pattern most providers fall into.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  return null;
}

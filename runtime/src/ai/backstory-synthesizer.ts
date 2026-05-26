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
import { PC_BACKSTORY_SYNTHESIS_CALL_SCHEMA } from './schema-json';
import type { ContextFile } from './campaign-context';
import {
  buildBackstorySynthesisPrompt,
  type AnsweredQuestion,
  type ResyncContext
} from './backstory-synthesis-prompt';
export type { ResyncContext } from './backstory-synthesis-prompt';
import {
  isPcBackstorySynthesisResponse,
  type PcBackstorySynthesisResponse
} from './schema';
import {
  aiSemanticSpoilerCheck,
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
  /**
   * Wave 3b (2026-05-25): when present, the synthesizer runs in
   * re-sync mode — the prompt anchors on the previous backstory +
   * locked-in DM-edited fields.  Same pipeline (parse, spoiler-
   * check, validate, single auto-retry) otherwise.
   */
  resync?: ResyncContext;
}

/**
 * **STABLE CONTRACT** — load-bearing for the chargen flow and
 * downstream UI surfaces.  Pre-Cluster-E freeze (Engine reviewer
 * recommendation): the discriminated union's variants + their `code`
 * strings are part of the public contract; the unified DM-review
 * surface (Cluster E) will consume this shape, as will the
 * ChargenController extraction.  Do NOT widen or rename without
 * touching every consumer (currently `quire-app.ts:synthesizeBackstoryForSlot`
 * + `invite-manager.ts` adapter).
 *
 * Adding a new failure code is safe because consumers use the
 * discriminated `code` as a switch discriminant; removing or
 * renaming a code is a breaking change.
 */
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
        | 'aborted'
        // Phase 3b-X step 5 ADDITIVE: provider declined the request
        // OR the chosen model doesn't support constrained decoding.
        // Safe to add per the STABLE CONTRACT note above (additive,
        // not breaking).  UI distinguishes from generic provider-error
        // for clearer DM messaging.
        | 'provider-refused';
      message: string;
      /** Present on validation-failed; lists the error-severity issues. */
      errors?: BackstoryValidationIssue[];
      /** Present on parse-failed / spoiler-leak — for DM audit. */
      rawResponse?: string;
      /** Present on spoiler-leak-persistent — which tokens kept hitting. */
      persistentTokens?: string[];
      /**
       * Phase 3b polish (2026-05-23): present on spoiler-leak-
       * persistent (and could be wired for validation-failed
       * later).  The parsed PC the synthesizer was about to
       * return — failed the spoiler firewall but is otherwise
       * structurally valid.  The DM UI uses this to offer a hand-
       * edit-and-accept path so the synth isn't wasted: the DM
       * removes the leaked tokens and commits.
       */
      rejectedResponse?: PcBackstorySynthesisResponse;
      /** Present on provider-refused — the refusal sub-kind. */
      refusalKind?: 'safety' | 'model-unsupported' | 'truncated';
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
    answers: req.answers,
    ...(req.resync ? { resync: req.resync } : {})
  });

  // ----- First attempt -----
  const first = await callAndParse(provider, req, system, user);
  if (!first.ok) return first;

  // ----- Spoiler check -----
  //
  // Phase 3b polish (2026-05-23): two-tier check.  Substring scanner
  // is a fast first pass; when it hits common-English words ("chosen",
  // "fate", "magic"), the AI semantic-check second pass decides
  // whether the usage is everyday English (false positive — allow)
  // or a genuine campaign-lore leak (proceed to retry/reject).
  // Without the second pass, the user reported a "chosen" false-
  // positive on "problems you'd chosen" against Underleaf's broad
  // token list.
  const tokens = req.spoilerTokens ?? DEFAULT_SPOILER_TOKENS;
  let active = first.response;
  let activeRaw = first.rawResponse;
  let retried = false;

  // Phase B P2 (2026-05-26) adversarial-B1 fix: scan ALL player-
  // visible string fields together, not just the backstory.  A
  // language called "Quietspeak" or future free-text field would
  // bypass the per-field-backstory scanner.  Concatenating into one
  // buffer also lets the AI semantic check see cross-field gestalt
  // leaks ("chosen" + "fate" across two fields would each look
  // ordinary in isolation).  `affectedFields` lets the retry
  // instruction name what to rewrite.
  const firstScan = scanResponseForSpoilers(active, tokens);
  let firstSemanticLeaks: string[] = firstScan.hits;
  if (firstScan.hits.length > 0) {
    const semantic = await aiSemanticSpoilerCheck(provider, {
      apiKey: req.apiKey,
      model: req.model,
      backstory: firstScan.combinedText,
      candidateWords: firstScan.hits,
      signal: req.signal
    });
    // Use the AI's narrowed list (genuine leaks) for the retry +
    // failure message.  When the AI check fails, it returns the
    // candidates verbatim — conservative fallback.
    firstSemanticLeaks = semantic.leakingWords;
  }
  if (firstSemanticLeaks.length > 0) {
    // Single auto-retry with a "do not use" appendix.  The retry
    // instruction names ONLY the genuine-leak words (not the
    // false-positive ordinary-usage words), so the AI's second
    // attempt doesn't waste effort rewriting prose that was fine.
    // Phase B P2: names AFFECTED FIELDS so the AI rewrites every
    // field that leaked, not just backstory (adversarial nit N3).
    retried = true;
    const retryUser =
      user +
      '\n\n# Retry instruction\n' +
      `The previous attempt revealed campaign secrets via these words: ${firstSemanticLeaks.join(', ')}.  ` +
      `Affected fields: ${firstScan.affectedFields.join(', ')}.  ` +
      'Re-write the affected fields WITHOUT using any of those words ' +
      'in their spoiler-revealing sense.  Same JSON output format as before.';
    const second = await callAndParse(provider, req, system, retryUser);
    if (!second.ok) return second;
    active = second.response;
    activeRaw = second.rawResponse;
    const secondScan = scanResponseForSpoilers(active, tokens);
    let secondSemanticLeaks: string[] = secondScan.hits;
    if (secondScan.hits.length > 0) {
      const semantic = await aiSemanticSpoilerCheck(provider, {
        apiKey: req.apiKey,
        model: req.model,
        backstory: secondScan.combinedText,
        candidateWords: secondScan.hits,
        signal: req.signal
      });
      secondSemanticLeaks = semantic.leakingWords;
    }
    if (secondSemanticLeaks.length > 0) {
      // Phase 3b polish (2026-05-23): attach the parsed PC so the
      // DM-review UI can offer hand-edit-and-accept.  The synth
      // isn't wasted — most of the backstory is fine, the DM just
      // needs to remove the leaked words (or use the auto-redact
      // helper).
      return {
        ok: false,
        code: 'spoiler-leak-persistent',
        message:
          `AI used forbidden words: ${secondSemanticLeaks.map((t) => `"${t}"`).join(', ')}.  ` +
          'These reveal campaign secrets and must be removed before ' +
          'the player sees the backstory.  Use "Edit + accept" to clean ' +
          'up locally, or "Discard + try again" to re-synthesize.',
        rawResponse: activeRaw,
        persistentTokens: secondSemanticLeaks,
        rejectedResponse: active
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
      code: 'parse-failed' | 'provider-error' | 'aborted' | 'provider-refused';
      message: string;
      rawResponse?: string;
      refusalKind?: 'safety' | 'model-unsupported' | 'truncated';
    };

/**
 * Phase 3b-X step 5: invoke the provider via constrained-decoding
 * `callStructured`.  Replaces the prior `provider.call() + regex
 * JSON-extract + JSON.parse + shape guard` pipeline — the
 * provider now emits a typed payload by construction.
 *
 * `parse-failed` becomes nearly unreachable: it survives ONLY for
 * the case where constrained decoding succeeded structurally but
 * the result somehow fails the runtime type guard (defense-in-
 * depth against future schema drift).  Provider refusals + safety
 * blocks + model-unsupported land as `provider-refused`; network
 * errors land as `provider-error`; aborts as `aborted`.
 */
async function callAndParse(
  provider: AiProvider,
  req: SynthesizeBackstoryRequest,
  system: string,
  user: string
): Promise<CallParseResult> {
  let result;
  try {
    result = await provider.callStructured<PcBackstorySynthesisResponse>(
      {
        apiKey: req.apiKey,
        model: req.model,
        systemPrompt: system,
        prompt: user,
        signal: req.signal
      },
      PC_BACKSTORY_SYNTHESIS_CALL_SCHEMA
    );
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

  if (!result.ok) {
    if (result.refusal.kind === 'provider-error') {
      return {
        ok: false,
        code: 'provider-error',
        message: result.refusal.message,
        rawResponse: result.raw || undefined
      };
    }
    // Refused: safety, model-unsupported, or truncated.  Distinct
    // from provider-error so the DM-facing UI can give a precise
    // message ("AI declined" vs "AI is misconfigured" vs "network
    // dropped").
    return {
      ok: false,
      code: 'provider-refused',
      message: result.refusal.message,
      rawResponse: result.raw || undefined,
      refusalKind: result.refusal.kind
    };
  }

  // Augment with broker-filled fields.  Under constrained decoding
  // the schema does NOT include these (the synthesizer attaches
  // them post-call) — that's why they're added here.
  const augmented: PcBackstorySynthesisResponse = {
    ...result.value,
    raw: result.raw,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    responseId: result.responseId
  };

  // Defense-in-depth: the schema enforces shape, but if a future
  // provider regresses + emits something that satisfies the schema
  // but not the TS guard (theoretically impossible, practically
  // worth guarding), surface as parse-failed.
  if (!isPcBackstorySynthesisResponse(augmented)) {
    return {
      ok: false,
      code: 'parse-failed',
      message:
        'Provider returned schema-valid JSON that fails the runtime type guard.  Likely a schema drift; surface to maintainers.',
      rawResponse: result.raw
    };
  }

  return {
    ok: true,
    response: augmented,
    rawResponse: result.raw
  };
}

// Phase 3b-X step 5: `extractJsonObject` deleted.  Under constrained
// decoding, providers emit schema-conforming JSON by construction;
// the regex-based prose-stripping the function did is no longer
// needed.  Step-1 shim's JSON.parse handles the legacy-mock test
// path (which now treats fenced/prose responses as `truncated`,
// surfaced to the synthesizer as `code: 'provider-refused'`).

/**
 * Phase B P2 (2026-05-26) adversarial-B1 fix: scan ALL player-
 * visible string fields in the synth response for spoiler tokens,
 * not just `backstory`.  Returns:
 *   - `hits`: deduplicated list of token matches across all fields
 *   - `combinedText`: concatenated buffer for the AI semantic check
 *     (cross-field gestalt leaks visible there)
 *   - `affectedFields`: which fields contained at least one hit
 *     (drives the retry instruction so the AI rewrites the right
 *     ones, not just backstory)
 *
 * `moneyBand` is an enum (5 fixed values, none of which are spoiler
 * tokens) — included in the scan as defense-in-depth, but it can
 * never legitimately fire.  Future free-text fields added to the
 * synthesis schema MUST be added to this scanner too.
 */
export function scanResponseForSpoilers(
  response: PcBackstorySynthesisResponse,
  tokens: readonly string[]
): {
  hits: string[];
  combinedText: string;
  affectedFields: string[];
} {
  const buffers: Array<{ field: string; text: string }> = [];
  if (typeof response.backstory === 'string' && response.backstory.length > 0) {
    buffers.push({ field: 'backstory', text: response.backstory });
  }
  if (Array.isArray(response.languages) && response.languages.length > 0) {
    buffers.push({ field: 'languages', text: response.languages.join(' ') });
  }
  if (typeof response.moneyBand === 'string' && response.moneyBand.length > 0) {
    buffers.push({ field: 'moneyBand', text: response.moneyBand });
  }
  const allHits = new Set<string>();
  const affectedSet = new Set<string>();
  for (const { field, text } of buffers) {
    const fieldHits = containsSpoilerTokens(text, tokens);
    if (fieldHits.length > 0) {
      affectedSet.add(field);
      for (const t of fieldHits) allHits.add(t);
    }
  }
  return {
    hits: [...allHits],
    combinedText: buffers.map((b) => b.text).join('\n\n'),
    affectedFields: [...affectedSet]
  };
}

/**
 * AiBroker — the single AI surface the UI calls (M3b.2, P2-6).
 *
 * Wraps the existing `callAnthropic` / `callGemini` text-in/text-out
 * functions with the AiResponse contract.  Provider impls (Anthropic
 * tool_use, Gemini response schema) parse to `{safe, dmOnly, sources}`;
 * the broker normalizes both, validates with `isAiResponse`, and
 * falls back to `parseFailureResponse(rawText)` if parsing fails
 * — never throws on a model-side parse error.
 *
 * Coord-only enforcement (audit chain invariant): only the
 * currently-acting coordinator may call `complete()`.  A peer who
 * historically held coord but has since yielded is rejected — the
 * audit chain is strict (single appender), not a fork-prone DAG.
 */

import type { AiResponse } from './schema';
import { isAiResponse, parseFailureResponse } from './schema';
import { validateContextRef, type ContextScope } from './context';
import { assertWithinBudget } from './budget';
import type { AiAuditEntry } from '../core/state';

/**
 * The shape an HTTP-callable provider impl must satisfy.  Returns
 * the raw provider text (or stringified JSON) so the broker can
 * audit it verbatim; parsing happens via the provider's `parse`.
 */
export interface AiProvider {
  /** Provider id, e.g. 'claude' or 'gemini' — for audit + UI. */
  id: 'claude' | 'gemini';
  /**
   * Issue a structured request; return raw text + token counts.
   *
   * @deprecated Phase 3b-X: prefer `callStructured<T>` — constrained-
   * decoding APIs (Anthropic strict tool use, Gemini responseSchema)
   * eliminate the "AI returned prose I expected as JSON" failure
   * mode that this method's downstream regex-extraction tries to
   * paper over.  Will be removed in 3b-X step 9 after all callers
   * migrate.
   */
  call(req: AiProviderCallRequest): Promise<AiProviderCallResult>;
  /**
   * Parse provider raw response to (best-effort) AiResponse shape.
   *
   * @deprecated Phase 3b-X: callStructured<T> returns typed parsed
   * objects directly; this best-effort parser becomes redundant.
   */
  parse(raw: string): Partial<AiResponse> | null;
  /**
   * Phase 3b-X step 1 (seam): issue a constrained-decoding request
   * and return the already-parsed typed object.  Provider-side
   * structured-output APIs (Anthropic strict tool use; Gemini
   * responseSchema) enforce the schema at decoding time — the
   * caller gets a typed value or a typed refusal, never prose that
   * needs regex-extraction.
   *
   * Default implementation in step 1 SHIMS to the legacy `call()` +
   * `parse()` pair so the seam exists without behavior change;
   * steps 3-4 (Anthropic) and 4 (Gemini) replace the shim with
   * real constrained decoding.  Steps 5 + 8 migrate the chargen
   * synthesizer + the DM-aide broker over.  Step 9 deletes the
   * legacy pair.
   *
   * @param req — the call envelope (apiKey, model, prompts, abort
   *   signal) — same shape as `call()`.
   * @param schema — JSON Schema describing the expected output;
   *   provided by the caller from `src/ai/schema-json.ts`.
   * @returns the typed parsed value (on success) OR a typed
   *   refusal arm (when the provider declined to emit a payload).
   *   `raw` carries the serialized JSON (or the refusal message)
   *   for audit-log purposes.  `tokensIn`/`tokensOut`/`responseId`
   *   carry the same metering as `call()`.
   */
  callStructured<T>(
    req: AiProviderCallRequest,
    schema: AiStructuredCallSchema
  ): Promise<AiProviderStructuredResult<T>>;
}

export interface AiProviderCallRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface AiProviderCallResult {
  /** Raw response text or stringified-JSON tool output. */
  raw: string;
  tokensIn: number;
  tokensOut: number;
  responseId: string;
}

/**
 * Phase 3b-X: schema-side metadata the broker hands to a provider
 * to drive constrained decoding.  Carries the canonical JSON
 * Schema (the source of truth) + a `name` the provider uses to
 * identify the tool/output (Anthropic strict tool use requires a
 * tool name; Gemini doesn't but the field is harmless).
 *
 * Schemas live in `src/ai/schema-json.ts` colocated with their TS
 * interfaces in `schema.ts`.  Hand-written `as const` literals
 * with a sample-based mirror test that asserts a known-good
 * object satisfies BOTH the schema AND the TS type guard.
 */
export interface AiStructuredCallSchema {
  /** Stable identifier — used as Anthropic tool name; included in audit. */
  name: string;
  /**
   * Canonical JSON Schema.  Per-provider adapters (`toAnthropicSchema`,
   * `toGeminiSchema` in `src/ai/schema-json.ts`) translate to each
   * provider's dialect.  Hand-rolled within Anthropic's strict-mode
   * subset: no `$ref`, no `format`, no `additionalProperties: true`.
   */
  schema: Record<string, unknown>;
}

/**
 * Phase 3b-X: result shape for `AiProvider.callStructured<T>`.
 * Either the AI complied (`ok: true` + typed value) OR the provider
 * surfaced a refusal/safety-block (`ok: false` + kind + message).
 *
 * The discriminated union mirrors `SynthesizeBackstoryResult`'s
 * STABLE CONTRACT discipline — additive new variants are safe;
 * removing/renaming is breaking.
 */
/**
 * Phase 3b-X step 1: shared shim that delegates to the legacy
 * `call()` + a JSON.parse pass.  Steps 3 / 4 / 8 replace this with
 * real constrained decoding in each provider; until then, this
 * lets the new `callStructured<T>` seam exist without behavior
 * change.  Also reused by test-mock providers so the mocks don't
 * each re-implement the shim.
 */
export async function shimCallStructuredViaLegacy<T>(
  provider: AiProvider,
  req: AiProviderCallRequest
): Promise<AiProviderStructuredResult<T>> {
  let result: AiProviderCallResult;
  try {
    result = await provider.call(req);
  } catch (e) {
    // AbortError must propagate up — the synthesizer's outer try/
    // catch checks `(e as Error).name === 'AbortError'` to set
    // `code: 'aborted'`.  If the shim swallows it as a refusal,
    // cancellation looks like a network failure.
    if ((e as Error).name === 'AbortError') throw e;
    return {
      ok: false,
      refusal: {
        kind: 'provider-error',
        message: (e as Error).message
      },
      raw: '',
      tokensIn: 0,
      tokensOut: 0,
      responseId: ''
    };
  }
  try {
    const value = JSON.parse(result.raw) as T;
    return {
      ok: true,
      value,
      raw: result.raw,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      responseId: result.responseId
    };
  } catch {
    return {
      ok: false,
      refusal: {
        kind: 'truncated',
        message:
          'Provider returned unparseable text; shim cannot recover.  Constrained decoding (steps 3/4) replaces this path.'
      },
      raw: result.raw,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      responseId: result.responseId
    };
  }
}

export type AiProviderStructuredResult<T> =
  | {
      ok: true;
      value: T;
      /** Serialized JSON of `value` (for audit chain + raw card). */
      raw: string;
      tokensIn: number;
      tokensOut: number;
      responseId: string;
    }
  | {
      ok: false;
      refusal: {
        /**
         * `safety` — provider-side safety filter blocked the response
         *   (Anthropic stop_reason='refusal'; Gemini finishReason
         *   ∈ {SAFETY, RECITATION}).
         * `model-unsupported` — the chosen model doesn't support
         *   constrained decoding (Anthropic pre-3.5; Gemini pre-1.5).
         * `provider-error` — HTTP/network/SDK failure; fall back path.
         * `truncated` — the structured response was cut off; the
         *   `raw` carries whatever the provider returned for forensics.
         */
        kind: 'safety' | 'model-unsupported' | 'provider-error' | 'truncated';
        /** Human-friendly message; surfaced in the DM-facing UI. */
        message: string;
      };
      raw: string;
      tokensIn: number;
      tokensOut: number;
      responseId: string;
    };

export interface AiCompleteRequest {
  prompt: string;
  scope: ContextScope;
  /** Campaign-relative paths to include as untrusted context. */
  contextRefs?: string[];
  /** System prompt prepended to the model request. */
  systemPrompt?: string;
  /** Model name override (provider-specific). */
  model: string;
  signal?: AbortSignal;
}

/**
 * Surface checked by the broker before calling a provider — both
 * the api key and the current-coord guard live here.  The host
 * supplies a getter (rather than a static value) so the broker
 * always reads the LATEST state at call time, not at construction
 * time.
 */
export interface AiBrokerHost {
  /** Returns the current coordinator's peerId, or undefined. */
  getCoordinator(): string | undefined;
  /** Returns the local peerId, or undefined when offline. */
  getLocalPeerId(): string | undefined;
  /** Returns the API key for the active provider, or empty. */
  getApiKey(): string;
  /** Returns the current session's aiAudit entries (for budget). */
  getAiAudit(): readonly AiAuditEntry[];
  /** Returns the configured per-session token ceiling. */
  getBudgetCeiling(): number;
}

export class AiBrokerError extends Error {
  override readonly name = 'AiBrokerError';
  constructor(
    message: string,
    public readonly code:
      | 'not-coordinator'
      | 'no-api-key'
      | 'context-ref-invalid'
      | 'budget-exceeded'
      | 'provider-error'
  ) {
    super(message);
  }
}

export class AiBroker {
  constructor(
    private readonly provider: AiProvider,
    private readonly host: AiBrokerHost
  ) {}

  /**
   * Execute a structured AI completion.  Returns an AiResponse
   * (possibly the degraded `parseFailureResponse` shape on a
   * provider-side parse failure, never throws on parse failure).
   * Throws AiBrokerError for the up-front guards (not coord,
   * missing API key, invalid context ref) — those are user-facing
   * errors that the UI should surface in the prompt panel.
   */
  async complete(req: AiCompleteRequest): Promise<AiResponse> {
    const coord = this.host.getCoordinator();
    const me = this.host.getLocalPeerId();
    // When a coordinator is set, only they may fire — strict single-
    // appender to the audit chain (per redesign-plan.md L149).  When
    // NO coordinator is set (solo mode), the local peer is the
    // de-facto coordinator and is allowed; the audit chain is still
    // a chain, just with one author.
    if (coord !== undefined && coord !== me) {
      throw new AiBrokerError(
        'AI broker calls are restricted to the current DM (coordinator).',
        'not-coordinator'
      );
    }
    const apiKey = this.host.getApiKey();
    if (!apiKey) {
      throw new AiBrokerError(
        'No API key configured for the active provider.',
        'no-api-key'
      );
    }
    // Validate every context ref up-front; fail closed.
    for (const ref of req.contextRefs ?? []) {
      const v = validateContextRef(ref, req.scope);
      if (!v.ok) {
        throw new AiBrokerError(v.error, 'context-ref-invalid');
      }
    }
    // Budget gate — checked AFTER coord/key/refs so the most
    // common rejection messages take precedence.  When already
    // over the ceiling, no provider request fires.
    try {
      assertWithinBudget(this.host.getAiAudit(), this.host.getBudgetCeiling());
    } catch (e) {
      throw new AiBrokerError(
        (e as Error).message,
        'budget-exceeded'
      );
    }
    let providerResult: AiProviderCallResult;
    try {
      providerResult = await this.provider.call({
        apiKey,
        model: req.model,
        systemPrompt: req.systemPrompt ?? '',
        prompt: req.prompt,
        signal: req.signal
      });
    } catch (e) {
      // Re-throw network / HTTP errors with a typed wrapper so the
      // UI distinguishes "provider down" from "parse failure."
      throw new AiBrokerError(
        e instanceof Error ? e.message : String(e),
        'provider-error'
      );
    }
    const parsed = this.provider.parse(providerResult.raw);
    if (
      parsed &&
      isAiResponse({
        ...parsed,
        raw: '',
        tokensIn: 0,
        tokensOut: 0,
        responseId: ''
      })
    ) {
      return {
        safe: parsed.safe ?? '',
        dmOnly: parsed.dmOnly ?? '',
        sources: parsed.sources ?? [],
        // M3c.2: providers MAY return stateUpdates; absent → [].
        stateUpdates: parsed.stateUpdates ?? [],
        raw: providerResult.raw,
        tokensIn: providerResult.tokensIn,
        tokensOut: providerResult.tokensOut,
        responseId: providerResult.responseId
      };
    }
    // Provider returned text that didn't match the AiResponse shape;
    // degrade rather than throw so the DM at least sees what
    // happened (raw text lands in the audit chain regardless).
    const fallback = parseFailureResponse(providerResult.raw);
    return {
      ...fallback,
      tokensIn: providerResult.tokensIn,
      tokensOut: providerResult.tokensOut,
      responseId: providerResult.responseId
    };
  }
}

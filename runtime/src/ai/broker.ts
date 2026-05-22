/**
 * AiBroker — the single AI surface the UI calls.
 *
 * Routes through provider-side constrained decoding (Phase 3b-X):
 * the broker hands a JSON Schema to `provider.callStructured<T>`,
 * which uses Anthropic strict tool use or Gemini responseSchema to
 * coerce the model's decoder into emitting a schema-conforming
 * payload.  The broker gets a typed parsed value (or a typed
 * refusal arm) back — no regex extraction, no JSON.parse on prose.
 *
 * Refusal handling:
 *   - `provider-error` (HTTP / network / SDK failure) throws as
 *     AiBrokerError so the UI surfaces an error banner.
 *   - `safety` / `model-unsupported` / `truncated` return a
 *     degraded AiResponse (empty safe + "(AI <kind>: <msg>)"
 *     dmOnly) so the audit chain still records the exchange.
 *
 * Coord-only enforcement (audit chain invariant): only the
 * currently-acting coordinator may call `complete()`.  A peer who
 * historically held coord but has since yielded is rejected — the
 * audit chain is strict (single appender), not a fork-prone DAG.
 */

import type { AiResponse } from './schema';
import { isAiResponse, isStateUpdate, parseFailureResponse } from './schema';
import { validateContextRef, type ContextScope } from './context';
import { assertWithinBudget } from './budget';
import { AI_RESPONSE_CALL_SCHEMA } from './schema-json';
import type { AiAuditEntry } from '../core/state';

/**
 * The shape an HTTP-callable provider impl must satisfy.  Drives
 * provider-side constrained decoding (Anthropic strict tool use,
 * Gemini responseSchema) — the caller hands over a JSON Schema and
 * gets a typed parsed value back, or a typed refusal arm if the
 * provider declined to emit a payload.
 */
export interface AiProvider {
  /** Provider id, e.g. 'claude' or 'gemini' — for audit + UI. */
  id: 'claude' | 'gemini';
  /**
   * Issue a constrained-decoding request and return the already-
   * parsed typed object.  Provider-side structured-output APIs
   * enforce the schema at decoding time — the caller gets a typed
   * value or a typed refusal, never prose that needs regex-
   * extraction.
   *
   * @param req — the call envelope (apiKey, model, prompts, abort
   *   signal).
   * @param schema — JSON Schema describing the expected output;
   *   provided by the caller from `src/ai/schema-json.ts`.
   * @returns the typed parsed value (on success) OR a typed
   *   refusal arm (when the provider declined to emit a payload).
   *   `raw` carries the serialized JSON (or the refusal message)
   *   for audit-log purposes.  `tokensIn`/`tokensOut`/`responseId`
   *   carry per-exchange metering.
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
    // Phase 3b-X step 8: route through callStructured (constrained
    // decoding) instead of call() + parse().  Under strict tool use
    // (Anthropic) / responseSchema (Gemini), the provider emits a
    // schema-conforming AiResponse payload directly — parse-failure
    // becomes nearly unreachable in the happy path.
    let providerResult: AiProviderStructuredResult<Partial<AiResponse>>;
    try {
      providerResult = await this.provider.callStructured<Partial<AiResponse>>(
        {
          apiKey,
          model: req.model,
          systemPrompt: req.systemPrompt ?? '',
          prompt: req.prompt,
          signal: req.signal
        },
        AI_RESPONSE_CALL_SCHEMA
      );
    } catch (e) {
      // AbortError propagates up to the caller; other errors land
      // as the typed wrapper.
      if ((e as Error).name === 'AbortError') throw e;
      throw new AiBrokerError(
        e instanceof Error ? e.message : String(e),
        'provider-error'
      );
    }
    if (!providerResult.ok) {
      const reason = providerResult.refusal;
      // `provider-error` (HTTP / network / SDK failure) throws as
      // AiBrokerError so the UI surfaces a clear error banner —
      // there's no partial outcome worth logging in dmOnly.  The
      // other refusal kinds (safety / model-unsupported / truncated)
      // represent a completed-but-degraded exchange: surface as a
      // degraded AiResponse so the audit chain still records it
      // and the DM sees a precise message in dmOnly.
      if (reason.kind === 'provider-error') {
        throw new AiBrokerError(reason.message, 'provider-error');
      }
      return {
        safe: '',
        dmOnly: `(AI ${reason.kind}: ${reason.message})`,
        sources: [],
        stateUpdates: [],
        raw: providerResult.raw,
        tokensIn: providerResult.tokensIn,
        tokensOut: providerResult.tokensOut,
        responseId:
          providerResult.responseId ||
          `provider-${reason.kind}-${Date.now().toString(36)}`
      };
    }
    // Successful structured response.  Run isAiResponse as defense-
    // in-depth (schema enforces shape; this catches drift).
    const parsed = providerResult.value;
    if (
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
        // Filter out malformed entries defensively.
        stateUpdates: (parsed.stateUpdates ?? []).filter((u) =>
          isStateUpdate(u)
        ),
        raw: providerResult.raw,
        tokensIn: providerResult.tokensIn,
        tokensOut: providerResult.tokensOut,
        responseId: providerResult.responseId
      };
    }
    // Defense-in-depth: schema-valid JSON that fails the TS guard.
    // Under constrained decoding this is structurally near-impossible;
    // surface as the legacy parseFailureResponse for forensics.
    const fallback = parseFailureResponse(providerResult.raw);
    return {
      ...fallback,
      tokensIn: providerResult.tokensIn,
      tokensOut: providerResult.tokensOut,
      responseId: providerResult.responseId
    };
  }
}

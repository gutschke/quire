/**
 * AI response schema (M3b.1, P2-6).
 *
 * The AiBroker contract: both Anthropic and Gemini provider impls
 * return the same `AiResponse` shape — `{safe, dmOnly, sources, …}`
 * — regardless of underlying tool/schema mechanism.  The dual-card
 * renderer in `<dm-aside>` (M3b.5, P2-12) consumes this directly:
 * `safe` is read aloud to the table, `dmOnly` stays private.
 *
 * Parse failures degrade gracefully (the broker synthesizes a
 * `{safe: '', dmOnly: '(AI response was not in the expected format…)' }`
 * rather than throwing) — see `parseFailureResponse` below.
 */

export interface SourceRef {
  /** Display label — usually the file's slug or document title. */
  label: string;
  /** Campaign-relative path; passes the same validator as contextRefs. */
  path?: string;
}

/**
 * M3c.2: discriminated union of state-write proposals the AI may
 * include alongside its prose response.  The DM accepts (apply-all
 * or per-entry) before any event lands in the log; hard-gated
 * entries (harm 3-4, stress 4, ladder→Hunted, tax activation/release,
 * double-1, cross-PC pc-edit) require explicit individual click.
 *
 * Subset rationale:
 * - `pc-edit` is intentionally narrower than the manual one (harm
 *   / stress only).  Other field types (arbitrary stat / skill
 *   changes) belong to the DM-direct path; the AI doesn't propose
 *   them via stateUpdates.
 * - `dice-roll` carries `purpose` (what the roll resolves) +
 *   `expression` + `modifierBreakdown` (the math, shown to the DM
 *   in the one-liner) so the DM can verify before applying.
 * - `caster-state-set` mirrors the materializer payload at
 *   `core/state.ts`'s CasterStateSetPayload — see that file for
 *   the field validators.
 */
export type StateUpdate =
  | {
      kind: 'pc-edit';
      pcId: string;
      field: 'harm' | 'stress';
      delta: number;
      reason?: string;
    }
  | {
      kind: 'dice-roll';
      purpose: string;
      expression: string;
      modifierBreakdown?: string;
    }
  | {
      kind: 'caster-state-set';
      pcId: string;
      ladderState:
        | 'clear'
        | 'quiet'
        | 'noticed'
        | 'watched'
        | 'pushing-back'
        | 'hunted';
      reason?: string;
      taxActive?: boolean;
      spamCount?: number;
    };

export interface AiResponse {
  /**
   * The portion of the response the DM may freely read aloud.
   * NEVER contains DM-only material — both providers' tool/schema
   * shape encodes the separation, and parse failures default safe
   * to the empty string rather than guessing.
   */
  safe: string;
  /**
   * DM-only narrative / mechanics / spoilers.  Rendered in the
   * amber-rail card with the "copy (do not read aloud)" affordance.
   * MUST NOT leak into the player Stage / Aside under any code
   * path (see e2e/ai-content-safety.spec.ts at M3b.7 gate).
   */
  dmOnly: string;
  /** Citations into the campaign repo — null when none are returned. */
  sources: SourceRef[];
  /**
   * M3c: structured state writes the AI proposes.  Defaults to []
   * for backward compat — old providers / parse failures don't
   * inject any writes.  See StateUpdate above.
   */
  stateUpdates: StateUpdate[];
  /** Raw provider text (or JSON) for the audit chain. */
  raw: string;
  /** Tokens consumed by the prompt half of this exchange. */
  tokensIn: number;
  /** Tokens consumed by the completion half of this exchange. */
  tokensOut: number;
  /** Stable provider-side id, used for `ai-accept` / `ai-reject` events. */
  responseId: string;
}

/**
 * Type guard: does `value` shape-match the AiResponse interface
 * tightly enough that the dual-card renderer can consume it
 * without further defensive coding?  Used by the broker to decide
 * between "structured success" and "parse failure → fallback."
 */
export function isAiResponse(value: unknown): value is AiResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (typeof r.safe !== 'string') return false;
  if (typeof r.dmOnly !== 'string') return false;
  if (!Array.isArray(r.sources)) return false;
  if (!r.sources.every(isSourceRef)) return false;
  // M3c.2: stateUpdates is optional (back-compat); when present
  // must be an array of valid entries.  The broker fills `[]`
  // before validation when the provider omitted it.
  if (r.stateUpdates !== undefined) {
    if (!Array.isArray(r.stateUpdates)) return false;
    if (!r.stateUpdates.every(isStateUpdate)) return false;
  }
  // raw / tokens / id are broker-filled; tolerate absence here so a
  // pre-normalization provider parse can still satisfy the shape.
  return true;
}

/**
 * Type guard for a single StateUpdate entry.  Rejects unknown
 * `kind`, missing required fields, wrong-type fields, and the
 * known footguns (empty-string ladderState, non-finite delta).
 */
export function isStateUpdate(value: unknown): value is StateUpdate {
  if (!value || typeof value !== 'object') return false;
  const u = value as Record<string, unknown>;
  switch (u.kind) {
    case 'pc-edit':
      if (typeof u.pcId !== 'string' || u.pcId.length === 0) return false;
      if (u.field !== 'harm' && u.field !== 'stress') return false;
      if (typeof u.delta !== 'number' || !Number.isFinite(u.delta)) return false;
      if (!Number.isInteger(u.delta)) return false;
      if (u.reason !== undefined && typeof u.reason !== 'string') return false;
      return true;
    case 'dice-roll':
      if (typeof u.purpose !== 'string' || u.purpose.length === 0) return false;
      if (typeof u.expression !== 'string' || u.expression.length === 0)
        return false;
      if (
        u.modifierBreakdown !== undefined &&
        typeof u.modifierBreakdown !== 'string'
      ) {
        return false;
      }
      return true;
    case 'caster-state-set':
      if (typeof u.pcId !== 'string' || u.pcId.length === 0) return false;
      if (
        u.ladderState !== 'clear' &&
        u.ladderState !== 'quiet' &&
        u.ladderState !== 'noticed' &&
        u.ladderState !== 'watched' &&
        u.ladderState !== 'pushing-back' &&
        u.ladderState !== 'hunted'
      ) {
        return false;
      }
      if (u.reason !== undefined && typeof u.reason !== 'string') return false;
      if (u.taxActive !== undefined && typeof u.taxActive !== 'boolean')
        return false;
      if (u.spamCount !== undefined) {
        if (typeof u.spamCount !== 'number') return false;
        if (!Number.isFinite(u.spamCount)) return false;
        if (!Number.isInteger(u.spamCount)) return false;
        if (u.spamCount < 0) return false;
      }
      return true;
    default:
      return false;
  }
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (typeof s.label !== 'string') return false;
  if (s.path !== undefined && typeof s.path !== 'string') return false;
  return true;
}

/**
 * The fallback response synthesized when a provider's reply cannot
 * be parsed into the AiResponse shape.  Documented in the design
 * (`redesign-plan.md` L137, L154) and load-bearing: by surfacing
 * the parse failure in the DM-only card we don't accidentally
 * stage hallucinated content in the safe card.
 *
 * `responseId` defaults to an empty string; the broker fills it
 * with a generated id so accept/reject events can still reference
 * the degraded response.
 */
export function parseFailureResponse(rawText: string): AiResponse {
  // responseId synthesized from a content-hash-ish fingerprint so the
  // DM can still hit Accept / Reject on a degraded response (the UI
  // verdict buttons gate on responseId being truthy).  Not
  // cryptographically meaningful — just unique enough that two
  // parse failures in the same session land as distinct rows.
  const fingerprint = `parse-fail-${rawText.length}-${rawText.slice(0, 8).replace(/[^A-Za-z0-9]/g, '')}`;
  return {
    safe: '',
    dmOnly:
      '(AI response was not in the expected format; raw text saved to audit log.)',
    sources: [],
    stateUpdates: [],
    raw: rawText,
    tokensIn: 0,
    tokensOut: 0,
    responseId: fingerprint
  };
}

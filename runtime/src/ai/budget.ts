/**
 * AI token-budget accounting (M3b.4, P2-9).
 *
 * The session's running token total is DERIVED from `state.aiAudit`
 * — every `ai-prompt` / `ai-response` audit entry carries the
 * token count for its half of the exchange.  No separate
 * persistence layer is needed; the event log (already autosaved
 * and replicated) IS the budget store.  A replayed log produces
 * the same total.
 *
 * Ceiling is per-DM configuration; the default is generous (1M
 * tokens ≈ a long campaign's worth of DM-aide use) but documented
 * so a frugal DM can pull it down in settings.
 *
 * The broker calls `assertWithinBudget(audit, ceiling)` before
 * issuing a prompt and surfaces a typed error when the ceiling
 * is exceeded — the UI catches and disables the prompt input.
 */

import type { AiAuditEntry } from '../core/state';

/** Default per-session budget when the DM hasn't customized it. */
export const DEFAULT_BUDGET_CEILING = 1_000_000;

/** Fraction of the ceiling at which the UI shows the warning state. */
export const BUDGET_WARN_RATIO = 0.8;

export interface BudgetUsage {
  /** Sum of every `ai-prompt` entry's tokensIn. */
  tokensIn: number;
  /** Sum of every `ai-response` entry's tokensOut. */
  tokensOut: number;
  /** tokensIn + tokensOut. */
  total: number;
  /** Configured per-DM ceiling (defaulted by caller). */
  ceiling: number;
  /** total / ceiling, clamped to [0, 1]. */
  fraction: number;
  /** `total >= ceiling`. */
  exceeded: boolean;
  /** `fraction >= BUDGET_WARN_RATIO` && !exceeded. */
  warning: boolean;
}

export function computeUsage(
  aiAudit: readonly AiAuditEntry[],
  ceiling: number = DEFAULT_BUDGET_CEILING
): BudgetUsage {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const e of aiAudit) {
    if (e.kind === 'prompt' && typeof e.tokensIn === 'number') {
      tokensIn += e.tokensIn;
    }
    if (e.kind === 'response' && typeof e.tokensOut === 'number') {
      tokensOut += e.tokensOut;
    }
  }
  const total = tokensIn + tokensOut;
  // Defensive: a misconfigured ceiling (0, negative, NaN) should
  // not pin fraction at Infinity or NaN — fall back to the default
  // ceiling.  This keeps the meter visually sensible during a
  // mid-session settings edit.
  const effectiveCeiling =
    Number.isFinite(ceiling) && ceiling > 0
      ? ceiling
      : DEFAULT_BUDGET_CEILING;
  const fraction = Math.min(1, total / effectiveCeiling);
  const exceeded = total >= effectiveCeiling;
  return {
    tokensIn,
    tokensOut,
    total,
    ceiling: effectiveCeiling,
    fraction,
    exceeded,
    warning: !exceeded && fraction >= BUDGET_WARN_RATIO
  };
}

export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';
  constructor(public readonly usage: BudgetUsage) {
    super(
      `AI token budget reached for this session (${usage.total} / ${usage.ceiling}).`
    );
  }
}

/**
 * Throw BudgetExceededError when the running total has met or
 * exceeded the ceiling.  Called by the broker before issuing the
 * provider request so a no-op prompt doesn't burn the in-flight
 * request slot.
 */
export function assertWithinBudget(
  aiAudit: readonly AiAuditEntry[],
  ceiling?: number
): void {
  const usage = computeUsage(aiAudit, ceiling);
  if (usage.exceeded) {
    throw new BudgetExceededError(usage);
  }
}

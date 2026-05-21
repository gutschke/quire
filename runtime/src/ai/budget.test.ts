/**
 * AI token-budget tests (M3b.4).
 *
 * computeUsage sums prompt/response token counts; warning + exceeded
 * derived from fraction.  assertWithinBudget throws when full.
 */

import { describe, it, expect } from 'vitest';
import {
  computeUsage,
  assertWithinBudget,
  BudgetExceededError,
  DEFAULT_BUDGET_CEILING,
  BUDGET_WARN_RATIO
} from './budget';
import type { AiAuditEntry } from '../core/state';

function promptRow(tokensIn: number): AiAuditEntry {
  return { peerId: 'a', ts: 1, kind: 'prompt', tokensIn };
}
function responseRow(tokensOut: number): AiAuditEntry {
  return { peerId: 'a', ts: 2, kind: 'response', tokensOut };
}

describe('computeUsage', () => {
  it('returns zeros for an empty audit', () => {
    const u = computeUsage([]);
    expect(u.tokensIn).toBe(0);
    expect(u.tokensOut).toBe(0);
    expect(u.total).toBe(0);
    expect(u.exceeded).toBe(false);
    expect(u.warning).toBe(false);
  });

  it('sums tokensIn across ai-prompt rows and tokensOut across ai-response rows', () => {
    const audit: AiAuditEntry[] = [
      promptRow(100),
      responseRow(50),
      promptRow(30),
      responseRow(20)
    ];
    const u = computeUsage(audit);
    expect(u.tokensIn).toBe(130);
    expect(u.tokensOut).toBe(70);
    expect(u.total).toBe(200);
  });

  it('uses the default ceiling when none is passed', () => {
    expect(computeUsage([]).ceiling).toBe(DEFAULT_BUDGET_CEILING);
  });

  it('falls back to the default ceiling when given a bad value', () => {
    expect(computeUsage([], 0).ceiling).toBe(DEFAULT_BUDGET_CEILING);
    expect(computeUsage([], -1).ceiling).toBe(DEFAULT_BUDGET_CEILING);
    expect(computeUsage([], NaN).ceiling).toBe(DEFAULT_BUDGET_CEILING);
  });

  it('marks warning state at the 80% threshold', () => {
    const ceiling = 100;
    const warnAt = ceiling * BUDGET_WARN_RATIO;
    const audit: AiAuditEntry[] = [promptRow(warnAt)];
    const u = computeUsage(audit, ceiling);
    expect(u.warning).toBe(true);
    expect(u.exceeded).toBe(false);
  });

  it('marks exceeded once total >= ceiling', () => {
    const audit: AiAuditEntry[] = [promptRow(100), responseRow(1)];
    const u = computeUsage(audit, 100);
    expect(u.exceeded).toBe(true);
    expect(u.warning).toBe(false);
    expect(u.fraction).toBe(1);
  });

  it('clamps fraction to 1 even when total exceeds ceiling', () => {
    const audit: AiAuditEntry[] = [promptRow(1000)];
    const u = computeUsage(audit, 100);
    expect(u.fraction).toBe(1);
  });

  it('ignores rows without numeric token counts (forward compat)', () => {
    const audit = [
      { peerId: 'a', ts: 1, kind: 'prompt' } as AiAuditEntry,
      { peerId: 'a', ts: 2, kind: 'accept', responseId: 'r' } as AiAuditEntry,
      promptRow(5)
    ];
    expect(computeUsage(audit).total).toBe(5);
  });
});

describe('assertWithinBudget', () => {
  it('is a no-op when under the ceiling', () => {
    expect(() => assertWithinBudget([promptRow(10)], 100)).not.toThrow();
  });

  it('throws BudgetExceededError once total meets the ceiling', () => {
    const audit = [promptRow(100)];
    expect(() => assertWithinBudget(audit, 100)).toThrow(BudgetExceededError);
  });

  it('the error message includes the total and ceiling', () => {
    const audit = [promptRow(50), responseRow(60)];
    try {
      assertWithinBudget(audit, 100);
      expect.fail('expected BudgetExceededError');
    } catch (e) {
      const err = e as BudgetExceededError;
      expect(err.message).toContain('110');
      expect(err.message).toContain('100');
      expect(err.usage.total).toBe(110);
    }
  });
});

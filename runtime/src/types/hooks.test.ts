import { describe, it, expect } from 'vitest';
import type { QuireAppHooks, AppStateHook } from './hooks';
import type { QuireApp } from '../quire-app';

/**
 * Type-level contract: QuireApp must implement the QuireAppHooks
 * surface.  This file does no runtime work — vitest just needs the
 * type-check pass to verify the contract.  If a future commit
 * renames a hook field on QuireApp without updating QuireAppHooks
 * (or vice versa), the build fails.
 *
 * Verification pattern: assign a QuireApp to a QuireAppHooks-typed
 * variable.  TypeScript's structural assignability is one-way — a
 * QuireApp (with all its HTMLElement methods + Lit lifecycle) is
 * assignable to QuireAppHooks (a strict subset).  The reverse would
 * fail, which is the point.
 *
 * For value-level e2e behavior tests, see the spec files in e2e/.
 */
describe('QuireAppHooks — type contract', () => {
  it('QuireApp is assignable to QuireAppHooks (compile-time check)', () => {
    // Compile-time: if QuireApp is not assignable to QuireAppHooks,
    // this function reference fails to type-check.
    const check: (app: QuireApp) => QuireAppHooks = (app) => app;
    expect(typeof check).toBe('function');
  });

  it('AppStateHook.kind union includes the documented kinds', () => {
    const kinds: AppStateHook['kind'][] = [
      'idle',
      'loading',
      'campaign',
      'episode',
      'scene',
      'character',
      'error'
    ];
    expect(kinds).toHaveLength(7);
  });
});

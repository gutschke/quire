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
/**
 * Mutual-assignability helper.  `MutuallyAssignable<A, B>` evaluates
 * to `true` iff A and B are bidirectionally assignable — neither can
 * be widened or narrowed relative to the other.  Returns `false`
 * otherwise (so a `const _ok: true = MutuallyAssignable<X, Y>` fails
 * to compile when they diverge).
 *
 * P0-11-followup (M1 gate Adversarial finding): the original test
 * only checked `QuireApp → QuireAppHooks` assignability.  Method-
 * signature widening (e.g. `submitChat(text, retry?)`) passed
 * silently because TS treats wider source signatures as assignable
 * to narrower target signatures.  Bidirectional check catches both
 * widening and narrowing of any method.
 */
type MutuallyAssignable<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T
>() => T extends B ? 1 : 2
  ? true
  : false;

describe('QuireAppHooks — type contract', () => {
  it('QuireApp is assignable to QuireAppHooks (forward direction)', () => {
    const check: (app: QuireApp) => QuireAppHooks = (app) => app;
    expect(typeof check).toBe('function');
  });

  it('submitChat signatures are mutually assignable (no widening or narrowing)', () => {
    // If a future commit changes QuireApp.submitChat to
    // (text: string, retry?: boolean): boolean, this fails because
    // the optional parameter widens the signature.
    const ok: MutuallyAssignable<
      QuireApp['submitChat'],
      QuireAppHooks['submitChat']
    > = true;
    expect(ok).toBe(true);
  });

  it('effectiveCharacter signatures are mutually assignable', () => {
    const ok: MutuallyAssignable<
      QuireApp['effectiveCharacter'],
      QuireAppHooks['effectiveCharacter']
    > = true;
    expect(ok).toBe(true);
  });

  it('sessionView fields are mutually assignable', () => {
    const ok: MutuallyAssignable<
      QuireApp['sessionView'],
      QuireAppHooks['sessionView']
    > = true;
    expect(ok).toBe(true);
  });

  it('QuireApp.appState is assignable to QuireAppHooks.appState (one-way subtype)', () => {
    // appState is the one field where mutual-assignability is
    // intentionally NOT the contract — QuireApp.appState is a
    // 7-kind discriminated union with payload fields per kind,
    // while QuireAppHooks.appState is a structural minimum
    // (just `kind` + optional `character`).  The hook is a
    // supertype; QuireApp is a subtype.  We only check the
    // forward direction here.
    const check: (s: QuireApp['appState']) => QuireAppHooks['appState'] =
      (s) => s;
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

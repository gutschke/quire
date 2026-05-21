/**
 * QuireAppHooks — the public-runtime surface that ~11 e2e tests
 * pull via `document.querySelector('quire-app') as unknown as
 * QuireAppHooks`.
 *
 * Defined in M1 (P0-11) so the facade-migration pattern stays
 * honest: as renderXxx templates extract per-region in M2 and
 * handlers migrate off `QuireApp` in M3a, the hooks here MUST
 * remain valid.  When a hook needs to change shape, update the
 * interface AND the affected e2e tests in the same commit.
 *
 * Stability target: through M3a.  After M3a, hooks may fragment
 * per-region (e.g. `quire-app.diceDock.submitRoll(...)`); that
 * transition is its own follow-up.
 *
 * What goes here:
 *   - Read access to reactive @state fields the tests poll
 *     (sessionView, appState).
 *   - Write methods the tests invoke directly (submitChat,
 *     effectiveCharacter, etc.).
 *
 * What does NOT go here:
 *   - Private helpers (their signatures may freely change).
 *   - Static class methods (those are accessed via the class
 *     import, e.g. `QuireApp.extractJoinCode`, and their stability
 *     is governed by the file they live in).
 *   - Render templates (extracted region components own their
 *     surface).
 *
 * If you find yourself reaching for an internal not listed here in
 * an e2e test, prefer (a) adding a `data-test` attribute to a
 * visible element and using Playwright's `locator()`, or (b)
 * promoting the field/method to QuireAppHooks with a deliberate
 * note about why it's part of the test surface.  The class-shaped
 * "as unknown as { ... }" inline cast that grew organically in
 * sync.spec.ts / full-session.spec.ts is now considered legacy.
 */

import type { SessionView } from '../session-controller';
import type { CharacterRecord, LoadedCharacter } from '../character-loader';

/** Shape of the appState @state field on QuireApp. */
export type AppStateKind =
  | 'idle'
  | 'loading'
  | 'campaign'
  | 'episode'
  | 'scene'
  | 'character'
  | 'error';

export interface AppStateHook {
  kind: AppStateKind;
  /** Present when kind === 'character'. */
  character?: LoadedCharacter;
  // Other fields exist (campaign, episode, scene); tests should not
  // depend on them via hooks — use visible DOM or the routing
  // helpers in e2e/helpers.ts instead.
}

/**
 * Stable hook surface for e2e tests.  Cast `document.querySelector(
 * 'quire-app')` to `QuireAppHooks` (not to a custom inline shape).
 */
export interface QuireAppHooks {
  /** Current SessionController view. */
  readonly sessionView: SessionView | null;

  /** Current app state (campaign / episode / scene / character / etc). */
  readonly appState: AppStateHook;

  /**
   * Submit a chat message (programmatic; bypasses the input UI).
   * Returns true on success, false when over the cap or no session.
   */
  submitChat(text: string): boolean;

  /**
   * Apply any session-level pcEdits to a loaded character record.
   * Used by e2e tests to verify character-sheet replication.
   */
  effectiveCharacter(character: LoadedCharacter): CharacterRecord;
}

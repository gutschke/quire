/**
 * App-mode state machine.
 *
 * Five modes per `quire/design/ui.md`:
 *   - 'pre-session'   — DM solo, players joining; campaign loader visible
 *   - 'in-session'    — default; play with shared session active
 *   - 'post-session'  — wrap-session diff review (living-document)
 *   - 'authoring'     — markdown editor + frontmatter form (DM)
 *   - 'solo-browse'   — implicit when no live session; binder view
 *
 * Mode is encoded in the URL as `?mode=...` so a reload preserves it:
 *
 *   /?campaign=owner/repo&mode=in-session       (default; mode is omitted)
 *   /?campaign=owner/repo&mode=authoring&path=episodes/001/scenes/01.md
 *   /?campaign=owner/repo&mode=post-session&session=2026-05-21
 *
 * Default is 'in-session'.  When the URL has no `mode=` and there's no
 * live session, the UI implicitly treats it as 'solo-browse' (a runtime
 * decision in quire-app.ts; not encoded in the URL).
 *
 * Validation: an unknown mode string in the URL falls back to
 * 'in-session' rather than throwing — bad URLs from external sources
 * (chat pastes, share links from older versions) should degrade
 * gracefully.
 *
 * M1 deliverable (P0-2): parser + serializer exist and have unit tests.
 * The QuireApp component holds an `appMode` @state and re-parses on
 * popstate.  Region components don't yet branch on mode — that lands
 * with each region's migration in M2 (player), M3a/M3b (DM cockpit),
 * M4 (post-session diff), M5 (authoring).
 */

export type AppMode =
  | 'pre-session'
  | 'in-session'
  | 'post-session'
  | 'session-wrap-marks'
  | 'authoring'
  | 'solo-browse';

export const APP_MODES: ReadonlySet<AppMode> = new Set<AppMode>([
  'pre-session',
  'in-session',
  'post-session',
  'session-wrap-marks',
  'authoring',
  'solo-browse'
]);

export const DEFAULT_APP_MODE: AppMode = 'in-session';

/**
 * Parse the `?mode=` URL parameter into an AppMode.  Unknown values
 * fall back to the default.
 */
export function parseMode(input: string | URLSearchParams): AppMode {
  const params =
    typeof input === 'string'
      ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
      : input;
  const m = params.get('mode');
  if (m && APP_MODES.has(m as AppMode)) return m as AppMode;
  return DEFAULT_APP_MODE;
}

/**
 * Mutate a URLSearchParams in place to encode the given mode.  The
 * default mode is omitted from the URL (cleaner share links); other
 * modes are written explicitly.  Returns the same params object for
 * chaining.
 */
export function setMode(
  params: URLSearchParams,
  mode: AppMode
): URLSearchParams {
  if (mode === DEFAULT_APP_MODE) {
    params.delete('mode');
  } else {
    params.set('mode', mode);
  }
  return params;
}

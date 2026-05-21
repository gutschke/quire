/**
 * Session-bootstrap helpers — pure functions extracted from
 * `src/quire-app.ts` during M1 (P0-8).
 *
 * Scope at M1 (minimal, low-risk):
 *   - extractJoinCode(): URL-or-bare-code → bare-code
 *   - parseRevealedPath(): `episodes/<ep>/<scene>` → {episode, scene}
 *   - scenePathFor(): inverse of parseRevealedPath
 *   - buildInviteLink(): SessionView + current URL → invite URL
 *
 * Deferred to a follow-up commit (potentially within M1 if the gate
 * demands the LOC reduction, otherwise M2):
 *   - navigateToRoute() — the campaign/episode/scene loader.  Tightly
 *     coupled to @state appState/abortController/isConnected and
 *     to the AI key + autosave controllers (applyCampaignDefault,
 *     checkResumePrompt).  Extracting cleanly requires either a
 *     callbacks-heavy interface or moving @state into the controller.
 *   - host/join/leave/regeneratePairingCode — coupled to
 *     joinCodeDraft, displayNameDraft @state fields used by the
 *     render templates.  Cleanest to extract alongside the M2 region
 *     migration when those @state fields move into their owning
 *     region components.
 *
 * These deferrals are explicit in execution-plan.md's adjustment-
 * authority section; reviewers at the M1 gate may flag the residual
 * size of quire-app.ts and require additional extraction here.
 */

/**
 * Encode an episode + scene-within-episode into the full repo path
 * used for the `revealedScenes` event-log entries.
 */
export function scenePathFor(episodeSlug: string, scenePath: string): string {
  return `episodes/${episodeSlug}/${scenePath}`;
}

/**
 * Parse a revealedScenes entry back into URL components.  Returns
 * null when the entry doesn't have the expected
 * `episodes/<episode>/<scene>` shape.
 */
export function parseRevealedPath(
  full: string
): { episode: string; scene: string } | null {
  if (!full.startsWith('episodes/')) return null;
  const rest = full.slice('episodes/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const episode = rest.slice(0, slash);
  const scene = rest.slice(slash + 1);
  if (!episode || !scene) return null;
  return { episode, scene };
}

/**
 * Accept either a raw pairing code or a full invite URL and return
 * the bare code (uppercased, capped at 12 chars).  Players who paste
 * the URL they received in chat shouldn't have to clean it up
 * themselves.
 *
 * R3-B fix: a pasted URL without `?join=` is NOT a valid invite.
 * Pasting the DM's address-bar URL with only `?campaign=&episode=`
 * was the actual leak path that produced "HTTPS://PLAY" in the
 * user's clipboard.  We return empty in that case so the field
 * stays empty (Join stays disabled), rather than silently mangling
 * the URL into junk.
 */
export function extractJoinCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const join = url.searchParams.get('join');
      return join ? join.toUpperCase().slice(0, 12) : '';
    } catch {
      // Malformed URL — empty is safer than a literal cast.
      return '';
    }
  }
  // Bare code — uppercase + cap.
  return trimmed.toUpperCase().slice(0, 12);
}

/**
 * Build a click-to-join URL for the current active session's pairing
 * code.  Returns null when there's no active pairingCode.  Pure
 * function: takes the (current) URL string and the pairingCode; the
 * caller is responsible for passing window.location.href and the
 * sessionView pairingCode.
 *
 * Strips session-control params that don't make sense in an invite
 * (?episode=, ?scene=, ?pc=, ?npc=) so the recipient lands on the
 * campaign clean rather than at the DM's exact cursor.
 */
export function buildInviteLink(
  currentUrl: string,
  pairingCode: string | null | undefined
): string | null {
  if (!pairingCode) return null;
  try {
    const url = new URL(currentUrl);
    url.searchParams.set('join', pairingCode);
    url.searchParams.delete('episode');
    url.searchParams.delete('scene');
    url.searchParams.delete('pc');
    url.searchParams.delete('npc');
    return url.toString();
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------
// Session lifecycle helpers (P0-8b, M1 gate Adversarial finding).
//
// These take bare arguments rather than reading from a host's
// @state, which makes them testable without instantiating QuireApp
// and lets M2 region components call them once the input @state
// fields move into the regions that own the relevant input UI.
// -----------------------------------------------------------------

/**
 * Minimal session interface the lifecycle helpers depend on.  Lets
 * tests inject a fake session without importing SessionController.
 */
export interface SessionLike {
  host(
    displayName?: string,
    campaign?: { owner: string; repo: string; ref: string }
  ): Promise<void>;
  join(code: string, displayName?: string): Promise<void>;
  leave(): void;
  regenerateCode(
    displayName?: string,
    campaign?: { owner: string; repo: string; ref: string }
  ): Promise<{ oldCode: string | null; newCode: string | null }>;
}

/**
 * Start hosting a session.  Trim displayName; '' becomes undefined
 * so the SessionController uses its own default.  Silently no-ops
 * when session is null (defensive — caller may invoke before mount
 * completes).  Errors are swallowed at this layer; the SessionView
 * status reflects them.
 */
export function doHostSession(
  session: SessionLike | null,
  displayName: string,
  campaign?: { owner: string; repo: string; ref: string }
): void {
  if (!session) return;
  const name = displayName.trim() || undefined;
  void session.host(name, campaign).catch(() => {
    /* surfaced via sessionView */
  });
}

/**
 * Join an existing session by pairing code.  Returns true when the
 * join was dispatched, false when ignored (no session OR empty
 * code).  The code is uppercased + trimmed by the caller's own
 * `extractJoinCode` invocation; this helper doesn't re-normalize.
 */
export function doJoinSession(
  session: SessionLike | null,
  code: string,
  displayName: string
): boolean {
  if (!session) return false;
  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) return false;
  const name = displayName.trim() || undefined;
  void session.join(trimmedCode, name).catch(() => {
    /* surfaced via sessionView */
  });
  return true;
}

/**
 * Leave the current session.  No-op when session is null.
 * Returns the SessionLike so the caller can chain UI state resets.
 */
export function doLeaveSession(session: SessionLike | null): void {
  session?.leave();
}

/**
 * Regenerate the pairing code.  Calls the `confirm` callback first
 * (so the host has a chance to back out); resolves with the result
 * of session.regenerateCode or null when cancelled / no session.
 * The confirm callback is dependency-injected for testability.
 */
export async function doRegenerateCode(
  session: SessionLike | null,
  displayName: string,
  campaign: { owner: string; repo: string; ref: string } | undefined,
  confirm: () => boolean
): Promise<{ oldCode: string | null; newCode: string | null } | null> {
  if (!session) return null;
  if (!confirm()) return null;
  const name = displayName.trim() || undefined;
  return session.regenerateCode(name, campaign);
}

/**
 * Copy an invite link to the system clipboard, falling back to
 * window.prompt() when the Clipboard API is unavailable (some HTTP
 * contexts, some sandboxes).  Returns true on clipboard success,
 * false on prompt fallback.  Both `clipboard` and `prompt` are
 * injected so tests don't need to fake navigator / window.
 */
export async function doCopyInviteLink(
  link: string,
  clipboard: { writeText(text: string): Promise<void> } | undefined,
  prompt: (message: string, defaultValue?: string) => string | null
): Promise<boolean> {
  if (clipboard) {
    try {
      await clipboard.writeText(link);
      return true;
    } catch {
      /* fall through */
    }
  }
  prompt('Copy this invite link:', link);
  return false;
}

/**
 * Route gating policy (M3a.4 — P-M3a-route-policy).
 *
 * Pure function extracted from `QuireApp.navigateToRoute` so the
 * load pipeline can do load + dispatch + abort, and the policy
 * rules (R3-A pre-session block, non-coord episode/scene gates,
 * NPC DM-only check) live in one testable place.
 *
 * Rules enforced:
 *
 *   1. NPC sheets are DM-only in an active session.  A non-
 *      coordinator who URL-hops to ?npc=foo gets a CharacterLoadError-
 *      shaped denial.  In solo mode (no session), NPC browsing is
 *      free (the lone reader is doing campaign-prep, not playing).
 *
 *   2. R3-A pre-session route gate.  Without an active session,
 *      episode + scene routes leak story content to a not-yet-
 *      joined player who clicked a DM-shared URL.  The gate
 *      denies with CampaignLoadError shape and a "join first"
 *      message.
 *
 *   3. Non-coordinator in active session:
 *      - Episode route: denied entirely (lists are DM-only).
 *      - Scene route: allowed only when the scene is in
 *        revealedScenes (the B5 gating).
 *
 *   4. Campaign + Character (PC) routes are always allowed.
 *
 * The function returns a tagged discriminated union so the caller
 * can either dispatch to load or throw the appropriate error
 * class.  Two error classes (`character` vs `campaign`) are
 * distinguished because the original navigateToRoute uses
 * different exception types — preserving the existing catch
 * semantics in QuireApp without coupling this module to those
 * error classes.
 */

import type { AppRoute } from '../routing';
import type { SessionView } from '../session-controller';

/**
 * Minimal scene-id encoder; matches `QuireApp.scenePathFor`.
 * Exported so tests can verify the encoding without reaching into
 * session-bootstrap.ts.
 */
export function scenePath(episodeSlug: string, scenePath: string): string {
  return `episodes/${episodeSlug}/${scenePath}`;
}

export type RouteDecision =
  | { kind: 'allow' }
  | {
      kind: 'deny';
      /**
       * Which error class the caller should throw.  Keeps the
       * pure function decoupled from QuireApp's CharacterLoadError /
       * CampaignLoadError imports.
       */
      errorClass: 'character' | 'campaign';
      message: string;
      details: string;
    };

/**
 * Decide whether a route is allowed given the current session
 * view.  `sessionView === null` indicates pre-session (mid-mount
 * race or solo) — treat as not-active per the R3-A gate.
 */
export function decideRoute(
  route: AppRoute,
  sessionView: SessionView | null
): RouteDecision {
  // 1. NPC DM-only in active session.
  if (route.kind === 'character' && route.characterKind === 'npc') {
    const inActiveSession = sessionView?.status === 'active';
    if (inActiveSession) {
      const isCoord =
        sessionView!.shared.coordinator === sessionView!.peerId;
      if (!isCoord) {
        return {
          kind: 'deny',
          errorClass: 'character',
          message:
            'NPC sheets are only visible to the DM in an active session.',
          details: `Requested NPC: ${route.characterId}`
        };
      }
    }
    return { kind: 'allow' };
  }

  // 2. R3-A: scene/episode routes require an active session.
  const inActiveSession = sessionView?.status === 'active';
  if (
    !inActiveSession &&
    (route.kind === 'episode' || route.kind === 'scene')
  ) {
    return {
      kind: 'deny',
      errorClass: 'campaign',
      message:
        'Scenes and episodes are only visible inside an active session.  Click "Host session" if you are the DM, or paste a code from your DM to join.',
      details: `Requested route: ${
        route.kind === 'scene'
          ? `${route.episode}/${route.scene}`
          : route.episode
      }`
    };
  }

  // 3. Non-coordinator scopes in active session.
  if (inActiveSession) {
    const isCoord =
      sessionView!.shared.coordinator === sessionView!.peerId;
    if (!isCoord && route.kind === 'episode') {
      return {
        kind: 'deny',
        errorClass: 'campaign',
        message:
          'Episode lists are only visible to the DM.  Wait for the DM to reveal a scene.',
        details: `Requested episode: ${route.episode}`
      };
    }
    if (!isCoord && route.kind === 'scene') {
      const full = scenePath(route.episode, route.scene);
      if (!sessionView!.filteredShared.revealedScenes.includes(full)) {
        return {
          kind: 'deny',
          errorClass: 'campaign',
          message:
            'That scene has not been revealed by the DM yet.',
          details: `Requested scene: ${route.episode}/${route.scene}`
        };
      }
    }
  }

  return { kind: 'allow' };
}

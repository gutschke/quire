/**
 * URL → app-state mapping.  Pure functions; no DOM.
 *
 * Routes are encoded as query parameters on the canonical play URL so a
 * pasted link reproduces the same view:
 *
 *   /                                                    → home
 *   /?campaign=<owner>/<repo>[@ref]                       → campaign overview
 *   /?campaign=...&episode=<slug>                          → episode scene list
 *   /?campaign=...&episode=<slug>&scene=<scene-path>       → single scene
 *
 * Routes that don't make sense (scene without episode, episode without
 * campaign) fall back to the most-specific valid prefix.
 */

export type CharacterKind = 'pc' | 'npc';

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'campaign'; slug: string }
  | { kind: 'episode'; slug: string; episode: string }
  | { kind: 'scene'; slug: string; episode: string; scene: string }
  | {
      kind: 'character';
      slug: string;
      characterKind: CharacterKind;
      characterId: string;
    }
  | {
      /**
       * CC-3 (M4 char-creation): an invite-token route for a player
       * filling in their PC asynchronously before session 1.  The
       * token is an opaque base64url-encoded JSON payload — see
       * `src/invite-token.ts` for the encoder/decoder.
       *
       * Per the F1 resolution (prioritized-backlog.md §"Phase 2
       * design notes"), the token carries `{slot, issuedAt,
       * campaignFingerprint}` and DELIBERATELY OMITS archetypeHint /
       * displayHint — those leak DM intent if the URL is
       * screenshot / forwarded.  The DM communicates archetype
       * hints in the email body alongside the URL.
       */
      kind: 'character-creation';
      slug: string;
      inviteToken: string;
    };

export function parseRoute(input: string | URLSearchParams): AppRoute {
  const params =
    typeof input === 'string'
      ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
      : input;

  const slug = params.get('campaign') ?? '';
  const episode = params.get('episode') ?? '';
  const scene = params.get('scene') ?? '';
  const pc = params.get('pc') ?? '';
  const npc = params.get('npc') ?? '';
  const invite = params.get('invite') ?? '';

  if (!slug) return { kind: 'home' };
  // CC-3: the chargen invite-token route.  `?campaign=...&invite=...`
  // takes precedence over other routes — a player visiting an
  // invite link should land on chargen, not on the campaign
  // overview.  Token validation lives in `src/invite-token.ts`;
  // the parser here just plumbs the string.
  if (invite) {
    return { kind: 'character-creation', slug, inviteToken: invite };
  }
  // Character route (pc wins over npc when both set).
  if (pc) {
    return { kind: 'character', slug, characterKind: 'pc', characterId: pc };
  }
  if (npc) {
    return {
      kind: 'character',
      slug,
      characterKind: 'npc',
      characterId: npc
    };
  }
  if (!episode) return { kind: 'campaign', slug };
  if (!scene) return { kind: 'episode', slug, episode };
  return { kind: 'scene', slug, episode, scene };
}

export function routeToSearch(route: AppRoute): string {
  if (route.kind === 'home') return '';
  const params = new URLSearchParams();
  params.set('campaign', route.slug);
  if (route.kind === 'episode' || route.kind === 'scene') {
    params.set('episode', route.episode);
  }
  if (route.kind === 'scene') {
    params.set('scene', route.scene);
  }
  if (route.kind === 'character') {
    params.set(route.characterKind, route.characterId);
  }
  if (route.kind === 'character-creation') {
    params.set('invite', route.inviteToken);
  }
  return '?' + params.toString();
}

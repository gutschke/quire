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

  if (!slug) return { kind: 'home' };
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
  return '?' + params.toString();
}

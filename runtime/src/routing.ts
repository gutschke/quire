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

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'campaign'; slug: string }
  | { kind: 'episode'; slug: string; episode: string }
  | { kind: 'scene'; slug: string; episode: string; scene: string };

export function parseRoute(input: string | URLSearchParams): AppRoute {
  const params =
    typeof input === 'string'
      ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
      : input;

  const slug = params.get('campaign') ?? '';
  const episode = params.get('episode') ?? '';
  const scene = params.get('scene') ?? '';

  if (!slug) return { kind: 'home' };
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
  return '?' + params.toString();
}

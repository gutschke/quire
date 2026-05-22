/**
 * Episode loader — fetches and minimally validates episode manifests and
 * scene content from a campaign repository.
 *
 * Mirrors campaign-loader's approach: $schemaVersion + name are required;
 * everything else is best-effort.  Schema-strict validation lives in the
 * CLI (`quire lint`).
 */

import {
  fetchCampaignFile,
  CampaignLoadError,
  type CampaignSource,
  type FetchOptions
} from './campaign-loader';

export interface EpisodeManifest {
  $schemaVersion: string;
  name: string;
  summary?: string;
  prerequisites?: string[];
  hooks?: string[];
  scenes?: string[];
  /**
   * M3D-7: DM-only docs to surface in `<dm-rail>` alongside scenes
   * for the active episode.  Authorial-list because raw.gh.com has
   * no directory enumeration; the campaign author declares which
   * files are navigation-relevant (typically pacing / npcs /
   * stakes / coincidences / etc.).  Each entry is a path relative
   * to the episode root (e.g., `dm/pacing.md`).
   *
   * Optional + falls back to `[]` so legacy campaigns that don't
   * declare it continue to work — dm files remain reachable via
   * URL but not surfaced in the rail's navigation list.
   */
  dmDocs?: string[];
  arcBeats?: string[];
  inGameDate?: string;
  tags?: string[];
}

export interface LoadedEpisode {
  slug: string;
  manifest: EpisodeManifest;
  source: CampaignSource;
}

const EPISODE_SLUG_RE = /^[A-Za-z0-9._-]+$/;
const SCHEMA_VERSION_RE = /^0\.\d+\.\d+$/;

function validateSlug(slug: string): void {
  if (!slug || !EPISODE_SLUG_RE.test(slug) || slug === '.' || slug === '..') {
    throw new CampaignLoadError(
      `Invalid episode slug "${slug}".`,
      'Episode slugs must match [A-Za-z0-9._-]+ and cannot be . or ..'
    );
  }
}

export async function loadEpisode(
  source: CampaignSource,
  slug: string,
  options: FetchOptions = {}
): Promise<LoadedEpisode> {
  validateSlug(slug);

  const path = `episodes/${slug}/episode.json`;
  const text = await fetchCampaignFile(source, path, options);
  if (text === null) {
    throw new CampaignLoadError(`Episode "${slug}" not found.`, `Path: ${path}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new CampaignLoadError(
      `Episode "${slug}" is not valid JSON.`,
      (e as Error).message
    );
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CampaignLoadError(
      `Episode "${slug}" manifest must be a JSON object.`
    );
  }

  const m = data as Record<string, unknown>;

  if (
    typeof m.$schemaVersion !== 'string' ||
    !SCHEMA_VERSION_RE.test(m.$schemaVersion)
  ) {
    throw new CampaignLoadError(
      `Episode "${slug}" has missing or invalid $schemaVersion.`,
      `Expected "0.x.y"; got ${JSON.stringify(m.$schemaVersion)}.`
    );
  }

  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new CampaignLoadError(
      `Episode "${slug}" is missing the required "name" field.`
    );
  }

  return {
    slug,
    manifest: m as unknown as EpisodeManifest,
    source
  };
}

export async function loadScene(
  source: CampaignSource,
  slug: string,
  scenePath: string,
  options: FetchOptions = {}
): Promise<string | null> {
  validateSlug(slug);
  // fetchCampaignFile validates the full path further (no traversal, no leading
  // slash, etc.), so we don't need to duplicate the segment check here.
  const path = `episodes/${slug}/${scenePath}`;
  return fetchCampaignFile(source, path, options);
}

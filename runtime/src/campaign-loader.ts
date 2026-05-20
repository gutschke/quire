/**
 * Campaign loader.  Pure data layer — no DOM, no Lit.
 *
 * Resolves a `?campaign=<owner>/<repo>[@ref]` slug into a fetched + minimally
 * validated campaign manifest.  Schema-strict validation lives in the CLI;
 * the browser does a tight required-field check so the bundle stays small.
 *
 * Identifier validation is deliberately strict: owner / repo / ref / path are
 * each checked against the actual GitHub character set before any URL is
 * constructed, so a campaign slug cannot use `..`, control chars, query
 * markers, or other URL metacharacters to escape the raw.githubusercontent.com
 * path prefix.
 */

export interface CampaignManifest {
  $schemaVersion: string;
  name: string;
  summary?: string;
  license?: string;
  ip?: string;
  ageBand?: string;
  contentNotes?: string[];
  defaultAiProvider?: 'claude' | 'gemini' | 'none';
  ruleset?: string;
  authors?: string[];
  homepage?: string;
  episodes?: string[];
  characters?: {
    pcs?: string[];
    npcs?: string[];
  };
}

export interface CampaignSource {
  owner: string;
  repo: string;
  ref: string;
}

export interface LoadedCampaign {
  manifest: CampaignManifest;
  source: CampaignSource;
}

export interface FetchOptions {
  signal?: AbortSignal;
}

export class CampaignLoadError extends Error {
  override readonly name = 'CampaignLoadError';
  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
  }
}

// Conservative subsets of what GitHub actually allows, minus path-traversal
// and URL metacharacters.  Verified against GitHub's documented rules for
// usernames, repository names, and ref names.
const OWNER_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._\-/]{1,250}$/;
const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const SCHEMA_VERSION_RE = /^0\.\d+\.\d+$/;

export function parseCampaignSlug(slug: string): CampaignSource {
  const trimmed = slug.trim();
  if (trimmed === '') {
    throw new CampaignLoadError(
      'Empty campaign reference.',
      'Expected the form "owner/repo" or "owner/repo@ref".'
    );
  }
  const atIdx = trimmed.indexOf('@');
  const ownerRepoPart = atIdx === -1 ? trimmed : trimmed.slice(0, atIdx);
  const refPart = atIdx === -1 ? '' : trimmed.slice(atIdx + 1);

  const slashIdx = ownerRepoPart.indexOf('/');
  if (slashIdx === -1 || ownerRepoPart.indexOf('/', slashIdx + 1) !== -1) {
    throw new CampaignLoadError(
      `Invalid campaign reference: "${slug}".`,
      'Expected the form "owner/repo" or "owner/repo@ref".'
    );
  }
  const owner = ownerRepoPart.slice(0, slashIdx);
  const repo = ownerRepoPart.slice(slashIdx + 1);
  const ref = refPart || 'main';

  if (!OWNER_RE.test(owner)) {
    throw new CampaignLoadError(
      `Invalid campaign reference: "${slug}".`,
      `Owner "${owner}" does not match GitHub's username/org rules.`
    );
  }
  if (
    !REPO_RE.test(repo) ||
    repo === '.' ||
    repo === '..' ||
    repo.includes('..')
  ) {
    throw new CampaignLoadError(
      `Invalid campaign reference: "${slug}".`,
      `Repository name "${repo}" is not allowed.`
    );
  }
  if (
    !REF_RE.test(ref) ||
    ref.includes('..') ||
    ref.startsWith('/') ||
    ref.endsWith('/')
  ) {
    throw new CampaignLoadError(
      `Invalid campaign reference: "${slug}".`,
      `Ref "${ref}" is not allowed.`
    );
  }

  return { owner, repo, ref };
}

function validatePath(path: string): void {
  if (!path) {
    throw new CampaignLoadError('Path is empty.');
  }
  if (path.startsWith('/') || path.endsWith('/')) {
    throw new CampaignLoadError(
      `Invalid path "${path}".`,
      'Path must not start or end with "/".'
    );
  }
  for (const seg of path.split('/')) {
    if (!seg || seg === '.' || seg === '..' || !PATH_SEGMENT_RE.test(seg)) {
      throw new CampaignLoadError(
        `Invalid path segment "${seg}" in "${path}".`
      );
    }
  }
}

export function rawContentUrl(source: CampaignSource, path: string): string {
  // Defence in depth: validate `path` here even if the caller validated it.
  // Owner/repo/ref are already validated by parseCampaignSlug.
  validatePath(path);
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/${path}`;
}

function isAbortError(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError';
}

/**
 * Fetch an arbitrary file from the campaign's repository at the pinned ref.
 * Returns `null` if the file is missing (HTTP 404) — the caller decides
 * whether absence is OK.  Other HTTP errors, network failures, and aborts
 * throw (aborts surface as the underlying AbortError so callers can ignore).
 */
export async function fetchCampaignFile(
  source: CampaignSource,
  path: string,
  options: FetchOptions = {}
): Promise<string | null> {
  const url = rawContentUrl(source, path);
  let response: Response;
  try {
    response = await fetch(url, { signal: options.signal });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new CampaignLoadError(
      `Could not fetch ${path}.`,
      `Network error fetching ${url}: ${(e as Error).message}`
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new CampaignLoadError(
      `Failed to fetch ${path} (HTTP ${response.status}).`,
      `URL: ${url}`
    );
  }
  return await response.text();
}

export async function loadCampaign(
  slug: string,
  options: FetchOptions = {}
): Promise<LoadedCampaign> {
  const source = parseCampaignSlug(slug);
  const url = rawContentUrl(source, 'campaign.json');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: options.signal
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new CampaignLoadError(
      'Could not reach raw.githubusercontent.com.',
      `Network error fetching ${url}: ${(e as Error).message}`
    );
  }

  if (!response.ok) {
    throw new CampaignLoadError(
      response.status === 404
        ? `Campaign not found at ${source.owner}/${source.repo} (ref: ${source.ref}).`
        : `Failed to fetch campaign manifest (HTTP ${response.status}).`,
      `URL: ${url}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (e) {
    throw new CampaignLoadError(
      'Campaign manifest is not valid JSON.',
      `${url}: ${(e as Error).message}`
    );
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CampaignLoadError('Campaign manifest must be a JSON object.');
  }

  const m = data as Record<string, unknown>;

  if (
    typeof m.$schemaVersion !== 'string' ||
    !SCHEMA_VERSION_RE.test(m.$schemaVersion)
  ) {
    throw new CampaignLoadError(
      'Campaign manifest is missing or has an invalid $schemaVersion.',
      `Expected something like "0.1.0"; got ${JSON.stringify(m.$schemaVersion)}.`
    );
  }

  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new CampaignLoadError(
      'Campaign manifest is missing the required "name" field.'
    );
  }

  return {
    manifest: m as unknown as CampaignManifest,
    source
  };
}

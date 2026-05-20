/**
 * Campaign loader.  Pure data layer — no DOM, no Lit.
 *
 * Resolves a `?campaign=<owner>/<repo>[@ref]` slug into a fetched + minimally
 * validated campaign manifest.  Schema-strict validation lives in the CLI;
 * the browser does a tight required-field check so the bundle stays small.
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

export class CampaignLoadError extends Error {
  override readonly name = 'CampaignLoadError';
  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
  }
}

const SLUG_RE = /^([^/@\s]+)\/([^/@\s]+)(?:@([^\s]+))?$/;
const SCHEMA_VERSION_RE = /^0\.\d+\.\d+$/;

export function parseCampaignSlug(slug: string): CampaignSource {
  const trimmed = slug.trim();
  const match = trimmed.match(SLUG_RE);
  if (!match) {
    throw new CampaignLoadError(
      `Invalid campaign reference: "${slug}".`,
      'Expected the form "owner/repo" or "owner/repo@ref".'
    );
  }
  const [, owner, repo, ref] = match;
  return { owner, repo, ref: ref ?? 'main' };
}

export function rawContentUrl(source: CampaignSource, path: string): string {
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/${path}`;
}

export async function loadCampaign(slug: string): Promise<LoadedCampaign> {
  const source = parseCampaignSlug(slug);
  const url = rawContentUrl(source, 'campaign.json');

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
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

  if (typeof m.$schemaVersion !== 'string' || !SCHEMA_VERSION_RE.test(m.$schemaVersion)) {
    throw new CampaignLoadError(
      'Campaign manifest is missing or has an invalid $schemaVersion.',
      `Expected something like "0.1.0"; got ${JSON.stringify(m.$schemaVersion)}.`
    );
  }

  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new CampaignLoadError('Campaign manifest is missing the required "name" field.');
  }

  return {
    manifest: m as unknown as CampaignManifest,
    source
  };
}

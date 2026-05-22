import { containsUcCloseSentinel } from './ai/context';

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

/**
 * V-5 schema-half (engine-vs-campaign boundary doc): declared
 * primary-resolution roll for the campaign.  The engine reads this
 * field when rendering the dice surface (M3D-4) and falls back to
 * a hardcoded `2d6+{stat}` default when absent — preserving today's
 * Underleaf-only behavior with no campaign-side change required.
 *
 * `expression` accepts the standard dice expression grammar from
 * `dice.ts` PLUS `{stat}` and `{mod}` placeholders.  The dice UI
 * substitutes the bound PC's chosen stat modifier at click time.
 *
 * `statSource` is currently always `boundPc` (the PC bound to the
 * roller's peer).  Reserved for future expansion (e.g. NPC-roll
 * surfaces).
 *
 * `modifierCap` bounds the user-adjustable modifier in the stepper.
 * The rules cap stacked tag/skill modifiers at +2 per
 * `underleaf/world/rules.md`.
 */
export interface CampaignPrimaryRoll {
  expression: string;
  statSource?: 'boundPc';
  modifierCap?: { min: number; max: number };
}

/**
 * V-5 schema-half: the engine/campaign contract for rules-related
 * policy.  Today only `primaryRoll` lives here; V-1..V-4 (caster
 * ladder, hard-gates, tracks, stat keys) remain hardcoded in the
 * engine until they're cheap to extract.  Adding the schema field
 * upfront is the engine's "no-regret" position — declaring it now
 * lets M3D-4 read it without retrofitting; campaigns that omit it
 * inherit the hardcoded default.
 */
export interface CampaignRules {
  primaryRoll?: CampaignPrimaryRoll;
}

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
  rules?: CampaignRules;
  authors?: string[];
  homepage?: string;
  episodes?: string[];
  characters?: {
    pcs?: string[];
    npcs?: string[];
  };
}

/**
 * Engine default for the primary roll when a campaign doesn't
 * declare `rules.primaryRoll`.  Matches Underleaf's `2d6+stat`
 * resolution (see `underleaf/world/rules.md` §Resolution).  When
 * V-1..V-4 are eventually extracted to the campaign schema, this
 * constant lives alongside the other engine defaults — but for now
 * it serves both as the fallback AND as the documentation of the
 * current hardcoded assumption.
 *
 * TODO(campaign-policy): once a second campaign exists, audit
 * whether engine defaults should exist at all or whether every
 * campaign should declare its own rules block explicitly.
 */
export const DEFAULT_PRIMARY_ROLL: CampaignPrimaryRoll = {
  expression: '2d6+{stat}',
  statSource: 'boundPc',
  modifierCap: { min: -2, max: 2 }
};

/**
 * Resolve the effective primary roll for a campaign, applying the
 * engine default when the manifest omits `rules.primaryRoll`.  The
 * dice UI (M3D-4) calls this rather than reading the manifest field
 * directly so the default surfaces consistently across the codebase.
 */
export function getPrimaryRoll(
  manifest: CampaignManifest
): CampaignPrimaryRoll {
  const declared = manifest.rules?.primaryRoll;
  if (!declared) return DEFAULT_PRIMARY_ROLL;
  // The declared field is partial — fall back per sub-field so
  // campaigns can override only the parts they care about.
  return {
    expression: declared.expression || DEFAULT_PRIMARY_ROLL.expression,
    statSource: declared.statSource ?? DEFAULT_PRIMARY_ROLL.statSource,
    modifierCap: declared.modifierCap ?? DEFAULT_PRIMARY_ROLL.modifierCap
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
  const text = await response.text();
  // M3b.6 — Reject raw content that contains the literal
  // <!--UC_CLOSE--> sentinel.  This is the load-time half of the
  // wrapUntrusted() smuggling defense in src/ai/context.ts: a
  // hostile campaign author can't embed the sentinel directly
  // and break out of the model-prompt wrapper later.  H-2-now
  // followup from M1.
  if (containsUcCloseSentinel(text)) {
    throw new CampaignLoadError(
      `Campaign file ${path} contains a reserved sentinel marker.`,
      `The marker <!--UC_CLOSE--> is used internally to wrap untrusted content for AI prompts and must not appear in raw campaign files.`
    );
  }
  return text;
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

  // M3b.7 unblock (Security S-2): mirror the UC_CLOSE sentinel
  // guard from fetchCampaignFile on the manifest.  The manifest
  // doesn't flow into AI prompts today, but a future "campaign
  // summary" contextRef must not be the path that bypasses the
  // wrapper-safety contract.  Inspect the raw response text
  // before parsing as JSON; reject either way.
  const rawText = await response.text();
  if (containsUcCloseSentinel(rawText)) {
    throw new CampaignLoadError(
      `Campaign manifest contains a reserved sentinel marker.`,
      `The marker <!--UC_CLOSE--> is used internally to wrap untrusted content for AI prompts and must not appear in raw campaign files.`
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(rawText);
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

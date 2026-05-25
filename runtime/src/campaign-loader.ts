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

/**
 * CC-6 (M4 char-creation): one question in the campaign's
 * chargen questionnaire.  Campaign-declared via
 * `characterCreation.questions[]` in `campaign.json` (per F5
 * critique disposition: inline in campaign.json, not in a sibling
 * file).
 *
 * Two kinds:
 *   - `mc` (multiple choice) — `options[]` is required.  The
 *     player picks exactly one; `value` is the canonical answer
 *     stored in IndexedDB and fed to the AI synthesis prompt.
 *   - `short-answer` — `minLength` / `maxLength` bound the text.
 *     Required by default; toggle `required: false` for optional
 *     items.
 *
 * `aiRole` is a hint to the prompt assembler (CC-19) about how to
 * use the answer in the system prompt: `skeleton` (closed-form
 * categorical anchor — the AI can't invert), `voice-sample` (the
 * AI quotes verbatim or paraphrases tightly), `grounder` (single
 * concrete detail for specificity).  Optional; the prompt
 * assembler defaults to "skeleton" when missing.
 */
export interface CampaignCharCreationQuestion {
  id: string;
  kind: 'mc' | 'short-answer';
  prompt: string;
  /** MC questions only.  Each option has a stored `value` + display `label`. */
  options?: Array<{ value: string; label: string }>;
  /** short-answer only; defaults [10, 400]. */
  minLength?: number;
  maxLength?: number;
  /** When omitted, defaults to true.  Optional questions stay un-answered with no warning. */
  required?: boolean;
  /** Hint to the AI synthesis prompt assembler. */
  aiRole?: 'skeleton' | 'voice-sample' | 'grounder';
}

/**
 * Campaign-declared character-creation block.  Today only
 * `questions[]` is declared; future fields (per-archetype tag
 * suggestions per CC-29, Bay Area place allowlist per CC-30 for
 * Underleaf) slot in here.
 */
export interface CampaignCharacterCreation {
  questions?: CampaignCharCreationQuestion[];
  /**
   * Wave 2 follow-up (2026-05-25, P-R2): soft cap on the number of
   * PC seats this campaign supports.  The engine accepts any
   * positive integer slot number (Phase B-prime dropped the hard
   * 1..9 cap); this field gates the UI's "+ add player" verb +
   * the host-API guard.  Defaults to `DEFAULT_SEAT_CAP` when
   * omitted.  Most campaigns leave this alone (9 is a reasonable
   * tabletop default); campaigns expecting larger parties (e.g.
   * a megagame or correspondence campaign) raise it.
   */
  seatCap?: number;
}

/**
 * Phase 3a-2 (P3D-1 hybrid seam): campaign-declared AI-backstory
 * policy.  The synthesis engine reads this block to scope spoiler
 * detection and place-grounding to the campaign's actual setting,
 * instead of relying on Underleaf-tuned engine defaults.
 *
 * `spoilerTokens` is the list of words a synthesized backstory must
 * NOT contain — the campaign's hidden-system vocabulary.  Underleaf
 * uses "Quiet", "magic", "premonition", etc. (the magic system is
 * a discovery-arc reveal).  When the manifest omits this field, the
 * engine falls back to `DEFAULT_SPOILER_TOKENS` for backward
 * compatibility; any new campaign should declare its own list.
 *
 * `placeAllowlist` is the canonical-place vocabulary for the
 * setting.  The validator emits a soft warning when a backstory
 * mentions no allowlisted places (P3T-8 for Underleaf's Bay Area).
 * Optional — campaigns with no place-specificity simply omit it.
 */
export interface CampaignAiBackstory {
  spoilerTokens?: readonly string[];
  placeAllowlist?: readonly string[];
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
  characterCreation?: CampaignCharacterCreation;
  aiBackstory?: CampaignAiBackstory;
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
 * Engine default for the seat cap when a campaign doesn't declare
 * `characterCreation.seatCap`.  Nine is a generous tabletop default
 * (most TTRPGs run 3-5 PCs); the engine accepts arbitrary positive
 * integers per Phase B-prime, this cap only gates the "+ add
 * player" verb in the UI.
 */
export const DEFAULT_SEAT_CAP = 9;

/**
 * Resolve the effective seat cap for a campaign.  Reads
 * `manifest.characterCreation.seatCap` and falls back to
 * DEFAULT_SEAT_CAP when omitted.  Sub-1 / non-integer values fall
 * back to the default (defensive — bad manifest data shouldn't
 * lock the DM out of chargen).
 */
export function resolveSeatCap(
  manifest: CampaignManifest | undefined | null
): number {
  const raw = manifest?.characterCreation?.seatCap;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return DEFAULT_SEAT_CAP;
  }
  return raw;
}

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

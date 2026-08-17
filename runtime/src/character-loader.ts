/**
 * Character loader — fetches and minimally validates PC and NPC records.
 *
 * PCs and NPCs share enough fields that one loader handles both; the
 * caller specifies which kind via the `kind` parameter, and the loader
 * routes to characters/{pcs|npcs}/<id>.json.
 */

import {
  fetchCampaignFile,
  CampaignLoadError,
  type CampaignSource,
  type FetchOptions
} from './campaign-loader';

export type CharacterKind = 'pc' | 'npc';

/**
 * Phase 3b polish (Phase B / P1a, 2026-05-23): the TTRPG expert's
 * field audit added several Underleaf-specific fields the engine
 * needs to carry through the materializer.  All new fields are
 * OPTIONAL (back-compat with the Underleaf-shipped character JSON
 * files that pre-date this expansion) and DM-only-by-default
 * (P1b's viewer-scope projection strips them for player peers).
 *
 * Engine vs campaign: these field NAMES + ranges are Underleaf-
 * specific (quire-v0.1 ruleset).  V-10 in
 * design/engine-vs-campaign-boundary.md tracks the future refactor
 * that makes magic / thread-debt / harm-stress shape campaign-
 * declarable.
 */

/**
 * Phase B P1a: a focus is an item / image / motion / etc the PC
 * casts through (rules.md:139).  The existing fields stay; we add
 * a `status` enum (active/broken/faded/corrupted/transformed) and
 * an optional `boundFor` field that describes what casting it's
 * the anchor of.
 */
export interface Focus {
  name: string;
  domain?: string;
  condition?: string;
  notes?: string;
  /** Phase B P1a: status enum per the TTRPG expert's review. */
  status?: 'active' | 'broken' | 'faded' | 'corrupted' | 'transformed';
  /** Phase B P1a: optional description of what this focus is bound to (a recurring intent, a domain anchor). */
  boundFor?: string;
}

/**
 * Phase B P1a: a stable, ordered tracker for the 5-bullet
 * advancement marks per cycle (rules.md:149-154).  Each cycle, at
 * end-of-session, the player may check at most one bullet.  At 5
 * checked, the player picks an advancement (rules.md:157-164),
 * which resets the bullets.
 */
export interface AdvancementMarkBullets {
  /** "resolved a hard moment in alignment" */
  hardMoment?: boolean;
  /** "learned something about themselves or the world" */
  learned?: boolean;
  /** "took a risk for someone else" */
  risk?: boolean;
  /** "acted against short-term interest" */
  against?: boolean;
  /** "a complication came back to bite them" */
  complication?: boolean;
}

/** The 5 advancement-mark bullet keys, in stable rules order. */
export const ADVANCEMENT_MARK_BULLET_KEYS = [
  'hardMoment',
  'learned',
  'risk',
  'against',
  'complication'
] as const satisfies ReadonlyArray<keyof AdvancementMarkBullets>;

/**
 * rules.md:166 — a PC may take at most 8 advancements over the whole
 * campaign.  Used to cap the running `advancements` counter.
 */
export const ADVANCEMENT_CAP = 8;

/**
 * The current-cycle mark count is DERIVED from the ticked bullets,
 * NOT a separately-stored number.  `markBullets` is the single source
 * of truth (the DM ticks them at wrap); the old `marks` count field
 * was never synced from them, so anything reading `record.marks`
 * directly was inert.  Always go through this helper.
 */
export function countAdvancementMarks(
  bullets: AdvancementMarkBullets | undefined
): number {
  if (!bullets) return 0;
  let n = 0;
  for (const k of ADVANCEMENT_MARK_BULLET_KEYS) if (bullets[k] === true) n++;
  return n;
}

/**
 * Phase B P1a: a condition is a temporary or persistent modifier
 * applied to the PC from fiction (DM grants), a cast (Hard-cast
 * cost), or a tag effect.  The TTRPG expert specifically called
 * these out as easy to lose without a dedicated UI slot.
 */
export interface Condition {
  /** Short label, e.g. "Drunk", "Aided", "Blessed-by-Yui". */
  name: string;
  /** What it does mechanically, e.g. "-1 INT until end of scene". */
  effect: string;
  /** Where it came from. */
  source?: 'fiction' | 'cast' | 'tag' | 'item';
  /** How long it lasts. */
  scope?: 'scene' | 'persistent' | 'until-rest' | 'until-released';
  /** Epoch-ms when it was applied (for sorting + auto-clear). */
  appliedTs?: number;
}

/**
 * Phase B P1a: an inventory item is a fiction-anchored thing the
 * PC carries.  Distinct from the looser `tags` (which describe
 * the PC) and `resources` (open-ended free text).  The TTRPG
 * expert recommended explicit inventory so the AI's tier-
 * adjudication ("can you afford a private jet?") has a slot.
 */
export interface InventoryItem {
  name: string;
  notes?: string;
  /** Whether the item is on the PC's person right now or stowed. */
  carriedBy?: 'on-person' | 'stowed';
}

/** Phase B P1a: caster-ladder rung enum.  DM-only field. */
export type ThreadDebtRung =
  | 'quiet'
  | 'noticed'
  | 'watched'
  | 'pushing-back'
  | 'hunted';

/**
 * Phase B P1a: thread-debt tracker for the antagonist-attention
 * ladder (rules.md:125-141).  DM-only; surfaced for DM viewers
 * only via the viewer-scope projection (P1b).
 */
export interface ThreadDebt {
  rung: ThreadDebtRung;
  /** Number of Free/Cheap casts this scene (DM judgment cue per rules.md:141). */
  spamCount?: number;
}

/**
 * Phase B P1a: magic-discovery arc phase (rules.md:174-188).
 * Engine-tracked, DM-only.  Drives whether the player's sheet
 * renders the magic section at all (spoiler-firewall, P1b).
 */
export type MagicPhase = 'accidental' | 'realization' | 'tax' | 'free';

/**
 * D5 (2026-05-27): per-PC bond entry.  Player-authored connection
 * anchor to another PC.  See `CharacterRecord.bonds` for the
 * higher-level contract.  `dmNotes` is field-granularity DM-only
 * (stripped per-entry by `filterForViewer` + by the
 * `bond-ratify` arm of `scrubEventForPlayer`).
 */
export interface Bond {
  /** PC-id of the bond's target (PC-only in MVP). */
  targetPcId: string;
  /** Player-visible bond text. */
  text: string;
  /** Optional DM-only spoiler anchor. */
  dmNotes?: string;
}

/**
 * D5 field names that are DM-only AT THE PER-ENTRY LEVEL inside
 * each bond.  Stripped from each entry of `bonds[]` by
 * `filterForViewer` for non-coord viewers, and from `bond-ratify`
 * payloads by `scrubEventForPlayer`.  Mirrors the per-entry
 * focus-grant strip pattern.
 */
export const BOND_DM_ONLY_ENTRY_FIELDS = ['dmNotes'] as const;

/**
 * Phase B P1a: trying-too-hard tax (rules.md:180-184).  Activated
 * at Realization; released at a fiction beat.  DM-only.
 */
export interface TaxState {
  /** Whether the -2 cast penalty is currently in effect. */
  active: boolean;
  /** Sessions remaining of the tax (default 2-3 at Realization). */
  sessionsRemaining?: number;
  /** Fiction beat that released the tax (set when active flips false). */
  releaseMoment?: string;
}

/**
 * Phase B P1a: DM-private append-only log of Accidental-phase
 * grants the DM made silently (rules.md:178).  Useful for
 * narrative callbacks at Realization and for the post-session
 * recap AI prompt.  DM-only field.
 */
export interface AccidentalGrant {
  /** Epoch-ms when the DM made the grant. */
  ts: number;
  /** What the DM granted (a coincidence, a near-miss, a remembered moment). */
  note: string;
  /** Scene id where the grant landed, if applicable. */
  sceneId?: string;
}

/**
 * Phase B P1a: alignment-drift counter (rules.md:172).  Per-PC,
 * DM-private observation.  TTRPG R3 #5: drift surfaces only in
 * per-PC diff-review, NOT in the end-of-session roster sheet (to
 * avoid inviting cross-PC comparison the rules don't intend).
 */
export interface AlignmentDrift {
  /** Number of drift marks accumulated this cycle (0-5). */
  marks: number;
  /** Epoch-ms of the most recent drift mark, for the "is a realignment conversation due?" cue. */
  lastUpdated?: number;
}

/**
 * Phase B P1a: money-band per TTRPG expert recommendation.  Not a
 * numeric currency — Underleaf is theater-of-the-mind (rules.md:11
 * "no farming") so exact-gp tracking is anti-pattern.  Fictional
 * band feeds AI tier-adjudication without forcing player ledger-
 * keeping.
 */
export type MoneyBand = 'broke' | 'tight' | 'comfortable' | 'well-off' | 'wealthy';

export interface CharacterRecord {
  $schemaVersion: string;
  name: string;
  pronouns?: string;
  alignment?: string;
  role?: string; // NPC-only typically
  disposition?: string; // NPC-only
  stats?: {
    str?: number;
    dex?: number;
    con?: number;
    int?: number;
    wis?: number;
    cha?: number;
  };
  skills?: string[];
  tags?: string[];
  harm?: number;
  stress?: number;
  /** Phase B P1a: focus list now uses the richer Focus type with status enum. */
  foci?: Focus[];
  /** Running total of advancements taken (rules.md:166 caps at 8). */
  advancements?: number;
  /** Current-cycle mark count (rules.md:149); see `markBullets` for the per-bullet detail. */
  marks?: number;
  /**
   * Phase B P1a: which of the 5 advancement-mark bullets are
   * currently checked in this cycle.  Resets to all-false when an
   * advancement is taken (the `marks` counter resets too).
   */
  markBullets?: AdvancementMarkBullets;
  /**
   * Phase B P1a: narrative log of advancements taken so far —
   * what was picked, when, and the in-fiction reason.  Useful for
   * end-of-arc retrospectives and AI summaries.
   */
  advancementHistory?: Array<{
    ts: number;
    kind: 'stat' | 'category' | 'tag' | 'focus';
    note?: string;
  }>;
  backstory?: string;
  /**
   * Player-visible: verbatim answer to the chargen "what in your life
   * taught you to hold an intention against pressure?" question
   * (id: `intent-moment`).  Preserved as a first-class structured
   * field (not just folded into `backstory` prose) so it survives
   * synthesis/re-sync without loss and remains accessible for the
   * Phase-2 realization mechanic (`world/rules.md`:182 — tax
   * recovery requires the DM grant a "quiet moment of release"
   * that mirrors this formative intent).  DM-only mechanical
   * gloss lives at `dmNotes.intentionUnderPressureNote`.
   */
  intentionUnderPressure?: string;
  /**
   * Player-authored short-answer chargen artifact preservation
   * (2026-08-17 sweep — see chargen-artifact-loss docs).  Each
   * field mirrors a `characterCreation.questions[]` entry from
   * `underleaf/campaign.json`; the runtime preserves the answer
   * verbatim (short-answer) or as a canonical value string (MC)
   * so it survives AI backstory synthesis/re-sync without loss.
   * All player-visible (not in DM_ONLY_CHARACTER_FIELDS).  All
   * optional; DM-direct-authored PCs / campaigns without the
   * question can omit any of them.
   */
  meaningfulItem?: string;
  specificPlace?: string;
  temperamentUnderPressure?: string;
  priorConnectionKind?: string;
  flightReason?: string;
  intentionHorizon?: string;
  description?: string; // NPC-typical
  voice?: string;
  signature?: string[];
  dmNotes?: string;
  relationships?: Array<{ who: string; kind?: string; notes?: string }>;
  /**
   * D5 (2026-05-27): per-PC bonds — player-authored connection
   * anchors to other PCs in the same campaign.  Distinct from
   * the legacy `relationships` field (which is NPC-side, DM-
   * authored, free-form).  Bonds are STRUCTURED and PC-side:
   *
   *   - `targetPcId`: PC-id of the bound peer's PC (PC-only in
   *     MVP; NPC bonds deferred to D5.5)
   *   - `text`: player-visible, player-authored bond text
   *   - `dmNotes`: optional DM-only spoiler-anchor sub-field
   *     (e.g. "Hadrian saw her cast and never knew it was magic")
   *
   * Authoring: chargen flow, after backstory, before DM review.
   * Event triplet `bond-propose` → `bond-ratify` → `bond-remove`
   * (see state.ts D5 materializers).
   *
   * Field-firewall: `dmNotes` is per-entry stripped by
   * `filterForViewer` for non-coord viewers + by
   * `scrubEventForPlayer` on the `bond-ratify` event.
   */
  bonds?: Bond[];
  resources?: string[];
  // Background sub-object some NPCs include (free-form).
  background?: Record<string, string>;
  /**
   * Phase B P1a — TTRPG-recommended additions.  All optional; DM-
   * only fields are stripped by the P1b viewer-scope projection
   * before the record reaches a player peer's renderer.
   */
  /** Explicit inventory list (replaces ad-hoc use of `resources` for items). */
  inventory?: InventoryItem[];
  /** Conditions / blessings / handicaps currently active on the PC. */
  conditions?: Condition[];
  /** Languages the PC speaks (rules.md:21 ties to INT). */
  languages?: string[];
  /** Fictional money band, NOT a numeric currency. */
  moneyBand?: MoneyBand;
  /** Magic-discovery arc phase (rules.md:174-188).  DM-only. */
  magicPhase?: MagicPhase;
  /**
   * Whether the player knows their PC can cast.  DM-only — flipping
   * this to true is the Realization beat (one-way story gate).
   * Stripped from player-bound projections (P1b).
   */
  knowsTheyCanCast?: boolean;
  /** Trying-too-hard tax state.  DM-only. */
  tax?: TaxState;
  /** Antagonist-attention ladder.  DM-only. */
  threadDebt?: ThreadDebt;
  /** Append-only log of DM's silent Accidental-phase grants.  DM-only. */
  accidentalGrants?: AccidentalGrant[];
  /** Alignment-drift counter.  DM-only. */
  alignmentDrift?: AlignmentDrift;
  /**
   * V-10-strict (2026-05-25): bag for forward-compat fields the
   * runtime doesn't recognize.  Previously we used an
   * `[key: string]: unknown` index signature, which defeated the
   * named-field strip enforcement that PlayerVisiblePc / DmPc want
   * to express (TypeScript's Omit can't drop named fields out of an
   * index signature — the index re-includes them as `unknown`).
   *
   * Author/loader code that needs to round-trip unknown JSON fields
   * should park them in `extras` rather than as siblings of known
   * fields.  The materialized loader doesn't currently route extras
   * through `extras` (it relies on the runtime-permissive cast at
   * `loadCharacter` end), but the type-level contract is now strict
   * — the compile-time field strip via `Omit<CharacterRecord,
   * 'dmNotes' | …>` works correctly.
   */
  extras?: Record<string, unknown>;
}

/**
 * Phase B P1b enabler: the set of CharacterRecord field names
 * that are DM-only and must be stripped before a player peer
 * sees the record.  Exported as a single source-of-truth so the
 * viewer-scope projection (P1b) and any future audit / test can
 * reference the SAME list — no chance of the projection and the
 * "is this field DM-only" check drifting apart.
 *
 * Per TTRPG R1 matrix + R3 #5 decision: alignmentDrift surfaces
 * only in per-PC diff-review, never in roster-wide grids; treated
 * as DM-only on the player-bound projection regardless.
 *
 * NOTE: `dmNotes` is already-existing prior-art DM-only field;
 * include it here so the new projection picks it up too.
 */
export const DM_ONLY_CHARACTER_FIELDS = [
  'magicPhase',
  'knowsTheyCanCast',
  'tax',
  'threadDebt',
  'accidentalGrants',
  'alignmentDrift',
  'dmNotes'
] as const satisfies ReadonlyArray<keyof CharacterRecord>;
export type DmOnlyCharacterField = (typeof DM_ONLY_CHARACTER_FIELDS)[number];

const DM_ONLY_CHARACTER_FIELDS_SET = new Set<string>(DM_ONLY_CHARACTER_FIELDS);

/**
 * Wave D4-cleanup (2026-05-26) — shared "is this dotted field path
 * targeting a DM-only top-level character field" predicate.
 *
 * pc-edit payloads carry a `field` string that may be flat
 * (`dmNotes`, `harm`) or dotted (`tax.releaseMoment`,
 * `threadDebt.rung`, `alignmentDrift.marks`).  The DM-only-ness
 * check matches by TOP-LEVEL prefix only — once the root field is
 * in DM_ONLY_CHARACTER_FIELDS, any sub-path under it inherits
 * DM-only status (a tax.releaseMoment write reveals as much as a
 * full tax payload would).
 *
 * Three call sites need this exact logic and used to maintain
 * three copies; D-prep-2-A introduced the firewall in
 * `persistence.ts:scrubEventForPlayer`, D4 added a second copy in
 * `quire-app.ts:generateSessionDigest`, and D1 needs an NPC
 * analog.  Centralizing here eliminates the drift risk.
 *
 * Returns false for empty/non-string input so callers can pipe
 * arbitrary payload material through without pre-validation.
 */
export function isDmOnlyCharacterFieldPath(field: unknown): boolean {
  if (typeof field !== 'string' || field.length === 0) return false;
  const topLevel = field.split('.', 1)[0];
  return topLevel !== undefined && DM_ONLY_CHARACTER_FIELDS_SET.has(topLevel);
}

/**
 * D1-A (2026-05-26) — NPC analog to DM_ONLY_CHARACTER_FIELDS.
 *
 * The pc-side magic-arc fields (magicPhase, tax, threadDebt,
 * accidentalGrants, alignmentDrift, knowsTheyCanCast) are PC-only
 * concerns and don't apply to NPCs.  What's DM-only on an NPC is
 * narrower: `dmNotes` (the DM's private narrative anchor — see
 * yui-tanaka.json for the canonical example) and `knownTo` (which
 * PCs have met this NPC; players don't know which other PCs have
 * met whom).
 *
 * Used by:
 *   - D1 living-doc diff-review to classify proposal visibility
 *     (per-pointer DM-only / player-eligible)
 *   - the D1 broadcast-payload firewall on `proposal-accept` events
 *
 * This list MUST stay narrow.  Widening over-strips and breaks
 * the "AI proposes NPC memory updates that DM ratifies" loop —
 * if too many fields are DM-only, the AI can't see enough to
 * propose useful relationship/memory updates.
 */
export const DM_ONLY_NPC_FIELDS = ['dmNotes', 'knownTo'] as const;
export type DmOnlyNpcField = (typeof DM_ONLY_NPC_FIELDS)[number];

const DM_ONLY_NPC_FIELDS_SET = new Set<string>(DM_ONLY_NPC_FIELDS);

export function isDmOnlyNpcFieldPath(field: unknown): boolean {
  if (typeof field !== 'string' || field.length === 0) return false;
  const topLevel = field.split('.', 1)[0];
  return topLevel !== undefined && DM_ONLY_NPC_FIELDS_SET.has(topLevel);
}

/**
 * Phase B P1b: type alias for a character record the local viewer is
 * authorized to render in DM mode (full record, all DM-only fields
 * visible).  Same shape as CharacterRecord — the alias is a
 * documentation handle for reviewers.
 */
export type DmPc = CharacterRecord;

/**
 * Phase B P1b: type alias for a character record AFTER the viewer-
 * scope projection has stripped DM-only fields.  Used as INTENT
 * documentation on props / args whose viewer-scope is `player`.
 *
 * **Now compile-time enforced** (V-10-strict, completed 2026-05-26):
 * the previous `[key: string]: unknown` index signature was removed,
 * so this `Omit` actually drops the named DM-only fields at the
 * type level.  Reading `pc.knowsTheyCanCast` on a `PlayerVisiblePc`
 * is now a TypeScript error rather than `unknown`.  Forward-compat
 * extras live under the typed `extras?` bag.
 *
 * The load-bearing runtime guard is still
 * `stripDmOnlyFromCharacter` (runtime delete) + the materializer-
 * level wipe in `filterForViewer` — type-level enforcement is
 * defense-in-depth alongside, not a replacement.
 */
export type PlayerVisiblePc = Omit<CharacterRecord, DmOnlyCharacterField>;

/**
 * Phase B P1b: pure function that strips every DM-only field from a
 * character record.  Returns a structurally-identical-but-narrower
 * record (same TS type per the caveat above — but the actual
 * runtime object has the DM-only keys absent).  Idempotent; safe to
 * call on already-stripped records.
 *
 * Used by `filterForViewer` in `core/state.ts` to project the
 * coord's full synthesizedPcs map down to a player-safe map before
 * it reaches a player peer's renderer.  Also exported for direct
 * use by render-layer code that loads records from disk (the
 * loader's records aren't routed through state.ts).
 */
export function stripDmOnlyFromCharacter(
  record: CharacterRecord
): PlayerVisiblePc {
  // Shallow copy, then delete the DM-only keys.  Shallow is safe
  // because every DM-only field is either a primitive or an object
  // the player should not see — we don't need to deep-clone the
  // surviving fields.
  const result: Record<string, unknown> = { ...record };
  for (const field of DM_ONLY_CHARACTER_FIELDS) {
    delete result[field];
  }
  // D5-8 (per-entry sub-field strip): `bonds` itself is player-
  // visible, but each bond's `dmNotes` is DM-only.  Per-entry
  // strip (B-1 / D-prep-2-A class) — mirrors the focus-grant
  // payload-field strip pattern.
  if (Array.isArray(result.bonds)) {
    result.bonds = (result.bonds as Bond[]).map((bond) => {
      const safe: Record<string, unknown> = { ...bond };
      for (const f of BOND_DM_ONLY_ENTRY_FIELDS) {
        delete safe[f];
      }
      return safe as unknown as Bond;
    });
  }
  return result as unknown as PlayerVisiblePc;
}

export interface LoadedCharacter {
  kind: CharacterKind;
  id: string;
  record: CharacterRecord;
  source: CampaignSource;
}

export class CharacterLoadError extends Error {
  override readonly name = 'CharacterLoadError';
  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
  }
}

const ID_RE = /^[A-Za-z0-9._-]+$/;
const SCHEMA_VERSION_RE = /^0\.\d+\.\d+$/;

function pathFor(kind: CharacterKind, id: string): string {
  const folder = kind === 'pc' ? 'pcs' : 'npcs';
  return `characters/${folder}/${id}.json`;
}

export async function loadCharacter(
  source: CampaignSource,
  kind: CharacterKind,
  id: string,
  options: FetchOptions = {}
): Promise<LoadedCharacter> {
  if (!id || !ID_RE.test(id) || id === '.' || id === '..') {
    throw new CharacterLoadError(
      `Invalid character id "${id}".`,
      'Character ids must match [A-Za-z0-9._-]+ and cannot be . or ..'
    );
  }

  const path = pathFor(kind, id);
  let text: string | null;
  try {
    text = await fetchCampaignFile(source, path, options);
  } catch (e) {
    if (e instanceof CampaignLoadError) {
      throw new CharacterLoadError(e.message, e.details);
    }
    throw e;
  }
  if (text === null) {
    throw new CharacterLoadError(
      `Character "${id}" (${kind}) not found.`,
      `Path: ${path}`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new CharacterLoadError(
      `Character "${id}" is not valid JSON.`,
      (e as Error).message
    );
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CharacterLoadError(
      `Character "${id}" manifest must be a JSON object.`
    );
  }

  const m = data as Record<string, unknown>;

  if (
    typeof m.$schemaVersion !== 'string' ||
    !SCHEMA_VERSION_RE.test(m.$schemaVersion)
  ) {
    throw new CharacterLoadError(
      `Character "${id}" has missing or invalid $schemaVersion.`,
      `Expected "0.x.y"; got ${JSON.stringify(m.$schemaVersion)}.`
    );
  }

  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new CharacterLoadError(
      `Character "${id}" is missing the required "name" field.`
    );
  }

  return {
    kind,
    id,
    record: m as unknown as CharacterRecord,
    source
  };
}

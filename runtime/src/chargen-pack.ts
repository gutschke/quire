/**
 * CC-10 (M4 char-creation): "Pack my character" export.
 *
 * Produces a portable JSON document the player can download as a
 * backup before session 1.  The DM imports it at session-1 intake
 * (CC-13) — paste-token route into the in-cockpit invite-manager,
 * or drag-drop the file into the chargen-receive surface.
 *
 * **Versioning.**  `$schemaVersion: '0.1.0'` — bumped when the
 * shape changes incompatibly.  Today's shape is intentionally
 * minimal (slot + chosenPath + answers).  Future fields land here
 * with backward-compat read paths.
 *
 * **Cross-campaign safety.**  Includes the `campaignFingerprint`
 * the player's invite token carried, so the DM-side import path
 * (CC-13) can refuse if the file is for the wrong campaign — same
 * defense as the invite token itself (see `invite-token.ts`).
 *
 * **Pure data layer.**  No DOM, no Blob, no download trigger.  The
 * caller (QuireApp) wraps the produced JSON string in a Blob +
 * anchor-click trick to fire the actual download.  Keeps this
 * module testable in node + e2e-environment-agnostic.
 */

/**
 * 0.2.0 (2026-05-27 D5.5-B): added optional `bondDrafts` field.
 * Read path is backward-compatible — a 0.1.0 pack parses cleanly
 * with `bondDrafts: undefined`; the DM-side intake treats missing
 * drafts as "player skipped the optional step."
 */
export const CHARGEN_PACK_SCHEMA_VERSION = '0.2.0';

/**
 * D5.5-B (2026-05-27): pre-acceptance bond draft.  Captured during
 * chargen step 4.5 ("Connections") so the player can author 0-3
 * relationships alongside their backstory.
 *
 * `targetPlaceholder` is free text the player typed for the other
 * person (a name, a role, "the medic on our team", "my brother").
 * The DM resolves this to a real `targetPcId` at ratify time via
 * the existing dm-aside bond-queue flow — at chargen time the
 * target PC may not exist yet (parallel chargen) or may live on
 * the player's mental model only.
 *
 * Per the chargen-authorship triage: player owns the voice (text +
 * placeholder), AI may suggest in a later ship (Ship 2), DM owns
 * the fit (review + resolve).
 */
export interface BondDraft {
  /** Free-text label for the relationship target.  1-80 chars. */
  targetPlaceholder: string;
  /** Bond text (the actual relationship sentence).  1-500 chars. */
  text: string;
}

/**
 * Stable on-the-wire shape.  Fields are author-tuned to be minimal:
 * just enough to recreate the player's chargen state on the DM's
 * machine at intake.
 */
export interface ChargenPackDocument {
  $schemaVersion: string;
  /** Stable campaign fingerprint from the invite token. */
  campaignFingerprint: string;
  /** Slot index from the invite token (1-9). */
  slot: number;
  /** Chosen path on step 3 (empty when the player didn't pick — pack still valid). */
  chosenPath: 'qa' | 'free-write' | 'pre-gen' | '';
  /** Map of question-id → answer.  Empty when no answers entered. */
  answers: Record<string, string>;
  /**
   * D5.5-B (2026-05-27): optional pre-acceptance bond drafts.
   * Player authors 0-3 entries during chargen step 4.5.  Missing
   * field means "0.1.0 pack from a pre-D5.5-B device" — treat as
   * empty.  Always present (possibly empty) for 0.2.0+.
   */
  bondDrafts?: BondDraft[];
  /** Epoch ms when the player packed.  Useful for the DM to spot stale packs. */
  packedAt: number;
}

export interface ChargenPackInput {
  campaignFingerprint: string;
  slot: number;
  chosenPath: 'qa' | 'free-write' | 'pre-gen' | '';
  answers: Record<string, string>;
  /** D5.5-B: optional bond drafts.  Caller passes [] when unused. */
  bondDrafts?: BondDraft[];
  /** Optional injection for tests.  Defaults to `Date.now()` at the boundary. */
  nowMs?: number;
}

export class ChargenPackError extends Error {
  override readonly name = 'ChargenPackError';
  constructor(
    public readonly code:
      | 'invalid-slot'
      | 'invalid-fingerprint'
      | 'malformed'
      | 'schema-version',
    message: string
  ) {
    super(message);
  }
}

const MIN_SLOT = 1;
const MAX_SLOT = 9;
const MAX_FINGERPRINT_LEN = 64;
const MAX_ANSWER_KEY_LEN = 80;
const MAX_ANSWER_VALUE_LEN = 4000;
const MAX_ANSWER_COUNT = 50;

/** D5.5-B caps.  Matches the engine bond limits (D5-3). */
export const MAX_BOND_DRAFTS = 3;
export const MAX_BOND_TARGET_LEN = 80;
export const MAX_BOND_TEXT_LEN = 500;

/**
 * #253 (2026-05-26): hard cap on the stringified pack size at the
 * `chargen-pack-deliver` event materializer + the sender-side
 * pre-send check.  Defense-in-depth — the per-field caps above
 * already bound a realistic pack to a few KB, but this top-level
 * gate makes the bound explicit and lets the sender surface
 * "pack too large — use file fallback" cleanly.  32 KB is
 * comfortable for the realistic ceiling (50 × 4000 = ~200 KB
 * worst case; typical packs run ~5 KB).
 */
export const CHARGEN_PACK_MAX_SIZE_BYTES = 32 * 1024;

/**
 * Serialize chargen state into a portable JSON document.  Throws
 * `ChargenPackError` on invalid input (slot out of range, etc.) so
 * the caller surfaces a "Couldn't pack — try again" banner rather
 * than silently producing a broken file.
 */
export function packChargen(input: ChargenPackInput): ChargenPackDocument {
  if (!Number.isInteger(input.slot)) {
    throw new ChargenPackError(
      'invalid-slot',
      `Pack slot must be an integer; got ${input.slot}`
    );
  }
  if (input.slot < MIN_SLOT || input.slot > MAX_SLOT) {
    throw new ChargenPackError(
      'invalid-slot',
      `Pack slot must be in [${MIN_SLOT}, ${MAX_SLOT}]; got ${input.slot}`
    );
  }
  if (
    typeof input.campaignFingerprint !== 'string' ||
    input.campaignFingerprint.length === 0 ||
    input.campaignFingerprint.length > MAX_FINGERPRINT_LEN
  ) {
    throw new ChargenPackError(
      'invalid-fingerprint',
      'Pack campaignFingerprint must be a non-empty short string.'
    );
  }
  const bondDrafts = validateBondDrafts(input.bondDrafts ?? []);
  return {
    $schemaVersion: CHARGEN_PACK_SCHEMA_VERSION,
    campaignFingerprint: input.campaignFingerprint,
    slot: input.slot,
    chosenPath: input.chosenPath,
    answers: { ...input.answers },
    bondDrafts,
    packedAt: input.nowMs ?? Date.now()
  };
}

/**
 * D5.5-B helper: validate + normalize an array of bond drafts.
 * Throws `ChargenPackError('malformed', …)` on out-of-spec input.
 * Returns a fresh array (caller-mutation safe).  Empty input is
 * valid — bonds are optional throughout chargen.
 */
function validateBondDrafts(input: BondDraft[]): BondDraft[] {
  if (!Array.isArray(input)) {
    throw new ChargenPackError(
      'malformed',
      'Pack bondDrafts must be an array.'
    );
  }
  if (input.length > MAX_BOND_DRAFTS) {
    throw new ChargenPackError(
      'malformed',
      `Pack bondDrafts has ${input.length} entries; cap is ${MAX_BOND_DRAFTS}.`
    );
  }
  const out: BondDraft[] = [];
  for (let i = 0; i < input.length; i++) {
    const d = input[i];
    if (!d || typeof d !== 'object') {
      throw new ChargenPackError(
        'malformed',
        `Pack bondDrafts[${i}] is not an object.`
      );
    }
    if (typeof d.targetPlaceholder !== 'string') {
      throw new ChargenPackError(
        'malformed',
        `Pack bondDrafts[${i}].targetPlaceholder must be a string.`
      );
    }
    if (typeof d.text !== 'string') {
      throw new ChargenPackError(
        'malformed',
        `Pack bondDrafts[${i}].text must be a string.`
      );
    }
    const target = d.targetPlaceholder.trim();
    const text = d.text.trim();
    if (target.length === 0 || target.length > MAX_BOND_TARGET_LEN) {
      throw new ChargenPackError(
        'malformed',
        `Pack bondDrafts[${i}].targetPlaceholder must be 1-${MAX_BOND_TARGET_LEN} chars (after trim).`
      );
    }
    if (text.length === 0 || text.length > MAX_BOND_TEXT_LEN) {
      throw new ChargenPackError(
        'malformed',
        `Pack bondDrafts[${i}].text must be 1-${MAX_BOND_TEXT_LEN} chars (after trim).`
      );
    }
    out.push({ targetPlaceholder: target, text });
  }
  return out;
}

/**
 * Stringify a packed document into the JSON form for download.
 * Pretty-printed (2-space indent) so a curious player can inspect
 * the file without an editor; the file is small enough that the
 * size cost doesn't matter.
 */
export function stringifyChargenPack(doc: ChargenPackDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse a packed document from JSON string.  Throws
 * `ChargenPackError` on malformed input.  Validates the shape but
 * does NOT validate against a campaign fingerprint — caller
 * (CC-13 DM-side intake) provides the expected fingerprint as a
 * separate check.
 */
export function parseChargenPack(raw: string): ChargenPackDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ChargenPackError(
      'malformed',
      'Pack file is not valid JSON.'
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ChargenPackError(
      'malformed',
      'Pack file root must be a JSON object.'
    );
  }
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.$schemaVersion !== 'string' ||
    !/^0\.\d+\.\d+$/.test(p.$schemaVersion)
  ) {
    throw new ChargenPackError(
      'schema-version',
      `Pack file has an unrecognized $schemaVersion: ${JSON.stringify(p.$schemaVersion)}.`
    );
  }
  if (
    typeof p.campaignFingerprint !== 'string' ||
    p.campaignFingerprint.length === 0 ||
    p.campaignFingerprint.length > MAX_FINGERPRINT_LEN
  ) {
    throw new ChargenPackError(
      'invalid-fingerprint',
      'Pack campaignFingerprint must be a non-empty short string.'
    );
  }
  if (typeof p.slot !== 'number' || !Number.isInteger(p.slot)) {
    throw new ChargenPackError(
      'invalid-slot',
      'Pack slot must be an integer.'
    );
  }
  if (p.slot < MIN_SLOT || p.slot > MAX_SLOT) {
    throw new ChargenPackError(
      'invalid-slot',
      `Pack slot is out of range [${MIN_SLOT}, ${MAX_SLOT}].`
    );
  }
  if (
    p.chosenPath !== 'qa' &&
    p.chosenPath !== 'free-write' &&
    p.chosenPath !== 'pre-gen' &&
    p.chosenPath !== ''
  ) {
    throw new ChargenPackError(
      'malformed',
      `Pack chosenPath has unexpected value: ${JSON.stringify(p.chosenPath)}.`
    );
  }
  if (typeof p.answers !== 'object' || p.answers === null || Array.isArray(p.answers)) {
    throw new ChargenPackError(
      'malformed',
      'Pack answers must be a JSON object.'
    );
  }
  const answersIn = p.answers as Record<string, unknown>;
  const answerKeys = Object.keys(answersIn);
  if (answerKeys.length > MAX_ANSWER_COUNT) {
    throw new ChargenPackError(
      'malformed',
      `Pack answers has ${answerKeys.length} entries; cap is ${MAX_ANSWER_COUNT}.`
    );
  }
  const answers: Record<string, string> = {};
  for (const k of answerKeys) {
    if (k.length === 0 || k.length > MAX_ANSWER_KEY_LEN) {
      throw new ChargenPackError(
        'malformed',
        'Pack answer key is empty or exceeds length cap.'
      );
    }
    const v = answersIn[k];
    if (typeof v !== 'string') {
      throw new ChargenPackError(
        'malformed',
        `Pack answer for "${k}" must be a string.`
      );
    }
    if (v.length > MAX_ANSWER_VALUE_LEN) {
      throw new ChargenPackError(
        'malformed',
        `Pack answer for "${k}" exceeds length cap.`
      );
    }
    answers[k] = v;
  }
  if (typeof p.packedAt !== 'number' || !Number.isFinite(p.packedAt)) {
    throw new ChargenPackError(
      'malformed',
      'Pack packedAt must be a finite number.'
    );
  }
  // D5.5-B: bondDrafts is optional for 0.1.0 packs from pre-D5.5-B
  // devices.  Missing → []; present → validated as 0.2.0+ shape.
  let bondDrafts: BondDraft[] = [];
  if (p.bondDrafts !== undefined) {
    bondDrafts = validateBondDrafts(p.bondDrafts as BondDraft[]);
  }
  return {
    $schemaVersion: p.$schemaVersion,
    campaignFingerprint: p.campaignFingerprint,
    slot: p.slot,
    chosenPath: p.chosenPath,
    answers,
    bondDrafts,
    packedAt: p.packedAt
  };
}

/**
 * Produce a suggested filename for the download.  The DM seeing a
 * folder of `quire-pc-mei-slot3-2026-05-22.json` files is easier
 * than parsing free-form names players invent.
 */
export function suggestedPackFilename(
  doc: ChargenPackDocument,
  campaignSlug?: string
): string {
  // ISO 8601 yyyy-mm-dd for the timestamp.
  const d = new Date(doc.packedAt);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  // Sanitize the campaign slug for filesystem safety: replace
  // slashes + special chars.
  const slugPart = campaignSlug
    ? campaignSlug.replace(/[^A-Za-z0-9_-]/g, '-')
    : 'campaign';
  return `quire-pc-${slugPart}-slot${doc.slot}-${date}.json`;
}

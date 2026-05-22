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

export const CHARGEN_PACK_SCHEMA_VERSION = '0.1.0';

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
  /** Epoch ms when the player packed.  Useful for the DM to spot stale packs. */
  packedAt: number;
}

export interface ChargenPackInput {
  campaignFingerprint: string;
  slot: number;
  chosenPath: 'qa' | 'free-write' | 'pre-gen' | '';
  answers: Record<string, string>;
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
  return {
    $schemaVersion: CHARGEN_PACK_SCHEMA_VERSION,
    campaignFingerprint: input.campaignFingerprint,
    slot: input.slot,
    chosenPath: input.chosenPath,
    answers: { ...input.answers },
    packedAt: input.nowMs ?? Date.now()
  };
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
  return {
    $schemaVersion: p.$schemaVersion,
    campaignFingerprint: p.campaignFingerprint,
    slot: p.slot,
    chosenPath: p.chosenPath,
    answers,
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

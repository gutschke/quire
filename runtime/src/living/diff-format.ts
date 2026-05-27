/**
 * D1-A (2026-05-26) — DiffProposal: the engine primitive for the
 * living-document diff-review workflow.
 *
 * Flow:
 *   1. Post-session AI proposes structural updates to NPC files
 *      (MVP: NPC memory of player choices).  Each suggestion is
 *      one DiffProposal targeting one dotted-field path on one
 *      NPC.
 *   2. The DM ratifies / edits / rejects each proposal in the
 *      diff-review Stage surface.
 *   3. Ratified proposals apply to the WorkingCopy via
 *      `applyProposalToWorkingCopy`; baseSha staleness rejects
 *      proposals whose NPC file was touched out-of-band since the
 *      AI saw it.
 *   4. Per-category git commits (per ui.md L298-363).
 *
 * **Per-pointer card design** (TTRPG-expert + Adversarial B-1
 * agreement): one proposal = one pointer = one card.  A change
 * touching `/dmNotes` is a DIFFERENT proposal than a change
 * touching `/disposition`.  This is what lets the broadcast-
 * payload firewall classify visibility per-proposal: the
 * `proposal-accept` event broadcasts the resolved field value,
 * and the visibility classification is determined by whether the
 * pointer's top-level field is in `DM_ONLY_NPC_FIELDS`.
 *
 * **baseSha contract** (Adversarial B-3): proposals carry the
 * NPC file's SHA at AI-call time.  If the WorkingCopy's stored
 * baseSha differs at apply time, the file changed under us — the
 * AI's `before` text is stale and applying blindly would clobber
 * out-of-band edits.  Reject with a staleness error so the DM
 * regenerates.
 *
 * Pure validation + apply functions — no IDB, no IO, no
 * randomness.  Host wires the broker call + persistence.
 */

import { isDmOnlyNpcFieldPath } from '../character-loader';
import { WorkingCopy } from '../sync/working-copy';

/**
 * Dotted-field path into an NPC JSON record.  Examples:
 *   - `disposition`            (top-level player-visible)
 *   - `dmNotes`                (top-level DM-only)
 *   - `background.currentStress` (nested player-visible)
 *   - `relationships.0.notes`  (array-indexed nested)
 *
 * Same notation as pc-edit field paths; deliberately simpler
 * than full RFC-6901 JSON Pointer to match existing conventions.
 */
export type NpcFieldPath = string;

export type ProposalVisibility = 'player-eligible' | 'dm-only';

export interface DiffProposal {
  /**
   * Per-proposal id used by the materializer to dedupe concurrent
   * co-DM accepts (Adversarial B-4).  Caller-generated; the engine
   * does not assume a specific id shape, only that two proposals
   * for the same change carry the same id.
   */
  id: string;
  /**
   * Kind tag — initial scope is `npc-update`; future kinds (scene-
   * retcon, faction-shift, etc.) follow the same shape.  Anchored
   * here so the materializer can dispatch.
   */
  kind: 'npc-update';
  /**
   * Which NPC file this proposal targets, identified by the file
   * id (matches `LoadedCharacter.id`, the basename of the JSON
   * file under `characters/npcs/`).
   */
  npcId: string;
  /**
   * Campaign-relative path of the NPC file.  Caller derives this;
   * the engine uses it to address the WorkingCopy entry.
   * Validated against the WorkingCopy path policy at apply time.
   */
  path: string;
  /**
   * The single dotted-field path the proposal touches.  See
   * `NpcFieldPath` for syntax.
   */
  field: NpcFieldPath;
  /**
   * The current value the AI observed at the targeted path.  Used
   * for diff display ONLY — the apply step does not re-check this
   * against the file (baseSha is the source of truth for "did the
   * file change under us").
   */
  before: unknown;
  /**
   * The proposed new value.  May be primitive, array, object, or
   * null.  The DM may edit this before accept; the apply step
   * writes whatever's in `after` at the moment of acceptance.
   */
  after: unknown;
  /**
   * DM-only free-text rationale — why the AI proposed this
   * change.  Never broadcast to peers; lives only on the
   * `proposal-create` event (which is DM-private) and on the
   * Stage diff card.  Wrapping in `<untrusted_content>` at prompt
   * time is the caller's responsibility (rationale comes back
   * from the AI; treat as untrusted output).
   */
  rationale: string;
  /**
   * Event ids that motivated this proposal — the AI cites which
   * session events drove the suggestion.  Stage's Context pane
   * surfaces these so the DM can quickly review the underlying
   * beats.  Optional because not every proposal cleanly maps to
   * specific events.
   */
  sourceEventIds?: string[];
  /**
   * The NPC file's SHA at the moment the AI was called.  At apply
   * time, the engine compares this against the WorkingCopy
   * entry's `baseSha`; mismatch = stale, reject.  May be omitted
   * when the NPC was freshly loaded with no SHA tracking (apply
   * then skips the staleness check).
   */
  baseSha?: string;
}

/**
 * Classify the proposal's broadcast visibility from its field
 * path.  This drives whether `proposal-accept`'s broadcast
 * payload carries the resolved value (player-eligible) or
 * strips it (dm-only — only the DM sees the result; player peers
 * see only the id + path).
 *
 * Engineering note: visibility is DERIVED, not stored in the
 * proposal.  This prevents the "AI marked it visibility=public
 * but the field is dmNotes" failure mode — the structural
 * firewall is the source of truth, the AI's claim is ignored.
 */
export function proposalVisibility(p: DiffProposal): ProposalVisibility {
  return isDmOnlyNpcFieldPath(p.field) ? 'dm-only' : 'player-eligible';
}

/**
 * Validation result — returned by `validateProposal` and the
 * apply functions.  Discriminated by `ok` so callers can pattern-
 * match cleanly.
 */
export type ProposalValidation =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'invalid-id'
        | 'invalid-kind'
        | 'invalid-npcId'
        | 'invalid-path'
        | 'invalid-field'
        | 'after-too-large'
        | 'rationale-too-large';
      message: string;
    };

const MAX_PROPOSAL_FIELD_LEN = 200;
const MAX_PROPOSAL_RATIONALE_LEN = 2000;
const MAX_PROPOSAL_AFTER_JSON_LEN = 20_000;
const VALID_ID = /^[A-Za-z0-9._\-:]+$/;
const VALID_NPC_ID = /^[A-Za-z0-9._\-]+$/;
const VALID_FIELD = /^[A-Za-z0-9._\-]+$/;

/**
 * D1-D verifier-found BLOCKER (2026-05-26): the AI is an untrusted
 * input source.  An AI proposal carrying `field: '__proto__.polluted'`
 * or `field: 'constructor.prototype.x'` would walk JS prototype
 * machinery during `setByDottedPath`'s bracket assignment, mutating
 * `Object.prototype` of the cloned root and poisoning every plain-
 * object lookup process-wide.  `VALID_FIELD` permits these segments
 * (they're all `[A-Za-z0-9._-]`); add an explicit segment-name
 * denylist at every entry point (validator + materializer + apply
 * function) — defense-in-depth, since each layer has a different
 * blast radius if a future change opens a hole in another.
 */
export const PROTOTYPE_POLLUTION_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype'
]);

export function hasPrototypePollutionSegment(field: string): boolean {
  for (const seg of field.split('.')) {
    if (PROTOTYPE_POLLUTION_SEGMENTS.has(seg)) return true;
  }
  return false;
}

/**
 * Validate a proposal's shape.  Returns ok or a structured error
 * the host surfaces to the DM ("this proposal is malformed; AI
 * misbehaved").  Does NOT check the proposal applies cleanly to
 * the current WorkingCopy state — that's `applyProposalToWorkingCopy`.
 */
export function validateProposal(p: DiffProposal): ProposalValidation {
  if (!p.id || !VALID_ID.test(p.id) || p.id.length > 200) {
    return { ok: false, code: 'invalid-id', message: 'proposal id is missing or malformed' };
  }
  if (p.kind !== 'npc-update') {
    return { ok: false, code: 'invalid-kind', message: `unknown proposal kind: ${String(p.kind)}` };
  }
  if (!p.npcId || !VALID_NPC_ID.test(p.npcId) || p.npcId.length > 200) {
    return { ok: false, code: 'invalid-npcId', message: 'npcId is missing or malformed' };
  }
  if (!p.path || p.path.length > 4096 || p.path.includes('..') || p.path.startsWith('/')) {
    return { ok: false, code: 'invalid-path', message: 'path is missing or unsafe' };
  }
  if (!p.field || !VALID_FIELD.test(p.field) || p.field.length > MAX_PROPOSAL_FIELD_LEN) {
    return { ok: false, code: 'invalid-field', message: 'field is missing or malformed' };
  }
  if (hasPrototypePollutionSegment(p.field)) {
    return {
      ok: false,
      code: 'invalid-field',
      message: 'field contains a prototype-pollution segment (__proto__, constructor, prototype)'
    };
  }
  try {
    const afterJson = JSON.stringify(p.after);
    if (typeof afterJson === 'string' && afterJson.length > MAX_PROPOSAL_AFTER_JSON_LEN) {
      return { ok: false, code: 'after-too-large', message: `after exceeds ${MAX_PROPOSAL_AFTER_JSON_LEN} chars when serialized` };
    }
  } catch {
    return { ok: false, code: 'after-too-large', message: 'after is not JSON-serializable' };
  }
  if (typeof p.rationale !== 'string' || p.rationale.length > MAX_PROPOSAL_RATIONALE_LEN) {
    return { ok: false, code: 'rationale-too-large', message: `rationale must be a string <= ${MAX_PROPOSAL_RATIONALE_LEN} chars` };
  }
  return { ok: true };
}

/**
 * Apply a single proposal's `after` value to the NPC JSON file in
 * the WorkingCopy.  Returns a discriminated result:
 *
 *   - { ok: true, updated }      — applied; the new file content
 *   - { ok: false, code: ... }   — rejected; reason encoded for UI
 *
 * Reject conditions:
 *   - validation fails (see validateProposal)
 *   - WC entry's baseSha differs from p.baseSha (staleness — file
 *     changed out-of-band)
 *   - WC entry is missing and no `fallbackJson` was supplied (the
 *     caller must seed the WC with the loaded file content before
 *     applying)
 *   - parse error on existing content
 *
 * Pure with respect to the WC's IO surface: takes a WorkingCopy
 * (which abstracts the store) and mutates only via its `write`.
 */
export type ApplyProposalResult =
  | { ok: true; updatedJson: string }
  | {
      ok: false;
      code:
        | 'validation-failed'
        | 'stale-base-sha'
        | 'no-working-copy-entry'
        | 'malformed-json'
        | 'invalid-pointer';
      message: string;
    };

export async function applyProposalToWorkingCopy(
  proposal: DiffProposal,
  wc: WorkingCopy,
  opts?: { fallbackJson?: string }
): Promise<ApplyProposalResult> {
  const v = validateProposal(proposal);
  if (!v.ok) return { ok: false, code: 'validation-failed', message: v.message };

  const entry = await wc.read(proposal.path);
  const sourceJson = entry?.content ?? opts?.fallbackJson;
  if (sourceJson === undefined) {
    return {
      ok: false,
      code: 'no-working-copy-entry',
      message: `no working-copy entry at ${proposal.path} and no fallbackJson supplied`
    };
  }
  // Adversarial B-3: staleness rejection — only meaningful when
  // both the entry and the proposal carry a baseSha to compare.
  if (entry?.baseSha && proposal.baseSha && entry.baseSha !== proposal.baseSha) {
    return {
      ok: false,
      code: 'stale-base-sha',
      message: `file changed since the AI saw it (${proposal.baseSha} → ${entry.baseSha}); regenerate the proposal`
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceJson);
  } catch (e) {
    return {
      ok: false,
      code: 'malformed-json',
      message: `existing NPC file is not valid JSON: ${(e as Error).message}`
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'malformed-json', message: 'NPC file root is not a JSON object' };
  }

  const setResult = setByDottedPath(parsed as Record<string, unknown>, proposal.field, proposal.after);
  if (!setResult.ok) {
    return { ok: false, code: 'invalid-pointer', message: setResult.message };
  }

  const updatedJson = JSON.stringify(setResult.value, null, 2) + '\n';
  await wc.write(proposal.path, updatedJson, entry?.baseSha ?? proposal.baseSha);
  return { ok: true, updatedJson };
}

/**
 * Apply many proposals.  Iterates with last-writer-wins on
 * duplicate field paths within a single batch; failures are
 * reported per-proposal so the caller can surface which ones
 * couldn't apply.
 *
 * Atomic-within-WC: each successful proposal writes; failures
 * skip and continue.  Caller's responsibility to compose with
 * the per-category git commit (D1-D).
 */
export interface BatchApplyResult {
  applied: DiffProposal[];
  failed: Array<{ proposal: DiffProposal; result: Extract<ApplyProposalResult, { ok: false }> }>;
}

export async function applyProposalsToWorkingCopy(
  proposals: ReadonlyArray<DiffProposal>,
  wc: WorkingCopy,
  opts?: { fallbackJsonByPath?: Record<string, string> }
): Promise<BatchApplyResult> {
  const applied: DiffProposal[] = [];
  const failed: BatchApplyResult['failed'] = [];
  for (const p of proposals) {
    const fallback = opts?.fallbackJsonByPath?.[p.path];
    const result = await applyProposalToWorkingCopy(
      p,
      wc,
      fallback !== undefined ? { fallbackJson: fallback } : undefined
    );
    if (result.ok) {
      applied.push(p);
    } else {
      failed.push({ proposal: p, result });
    }
  }
  return { applied, failed };
}

// -----------------------------------------------------------------
// Internal: dotted-field path set
// -----------------------------------------------------------------

type SetResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Set a value at a dotted-field path inside a JSON object.
 * Supports numeric segments for array index access
 * (`relationships.0.notes`).  Creates missing intermediate
 * objects when traversing into them; refuses to overwrite a
 * primitive with a path-extension (returns an error).
 *
 * Returns a NEW root object — does not mutate the input.
 */
function setByDottedPath(
  root: Record<string, unknown>,
  field: string,
  value: unknown
): SetResult {
  const segments = field.split('.');
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    return { ok: false, message: `field path has empty segment(s): ${field}` };
  }
  // Defense-in-depth (verifier B-1): refuse prototype-pollution
  // segments even if the validator was somehow bypassed.  Bracket
  // assignment to `__proto__` / `constructor.prototype` mutates
  // JS prototype machinery; the validator is the primary guard
  // but this layer enforces the invariant locally.
  for (const seg of segments) {
    if (PROTOTYPE_POLLUTION_SEGMENTS.has(seg)) {
      return {
        ok: false,
        message: `prototype-pollution segment refused: ${seg}`
      };
    }
  }
  // Clone the spine we'll touch; leave untouched branches by-reference.
  const newRoot: Record<string, unknown> = { ...root };
  let cursor: Record<string, unknown> | unknown[] = newRoot;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg === undefined) {
      return { ok: false, message: `field path has undefined segment at index ${i}` };
    }
    const isArrayIndex = /^\d+$/.test(seg);
    const key: string | number = isArrayIndex ? Number(seg) : seg;
    const existing: unknown = Array.isArray(cursor)
      ? (cursor as unknown[])[key as number]
      : (cursor as Record<string, unknown>)[key as string];
    let next: Record<string, unknown> | unknown[];
    if (existing === undefined || existing === null) {
      // Auto-create: object by default, array if next segment is numeric.
      const nextSeg = segments[i + 1];
      const nextIsArrayIndex = typeof nextSeg === 'string' && /^\d+$/.test(nextSeg);
      next = nextIsArrayIndex ? [] : {};
    } else if (typeof existing === 'object') {
      // Clone so we don't mutate the input tree.
      next = Array.isArray(existing) ? [...existing] : { ...(existing as Record<string, unknown>) };
    } else {
      return {
        ok: false,
        message: `cannot extend non-object at ${segments.slice(0, i + 1).join('.')} (got ${typeof existing})`
      };
    }
    if (Array.isArray(cursor)) {
      (cursor as unknown[])[key as number] = next;
    } else {
      (cursor as Record<string, unknown>)[key as string] = next;
    }
    cursor = next;
  }
  const lastSeg = segments[segments.length - 1];
  if (lastSeg === undefined) {
    return { ok: false, message: 'field path is empty' };
  }
  if (Array.isArray(cursor)) {
    const idx = /^\d+$/.test(lastSeg) ? Number(lastSeg) : NaN;
    if (Number.isNaN(idx)) {
      return { ok: false, message: `array index expected at final segment, got ${lastSeg}` };
    }
    (cursor as unknown[])[idx] = value;
  } else {
    (cursor as Record<string, unknown>)[lastSeg] = value;
  }
  return { ok: true, value: newRoot };
}

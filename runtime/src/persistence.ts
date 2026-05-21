/**
 * Save/load primitives for Quire sessions.  The event log is the
 * source of truth; a save is a JSON snapshot of the log + the
 * minimum metadata needed to restore: which campaign it belongs to,
 * who saved it, when.
 *
 * Determinism: stringifySave produces byte-identical output for
 * byte-identical inputs.  Keys are sorted at every level; events
 * are ordered by the EventLog's causal sort (sum-of-clock, peerId,
 * seq).  This is what makes the save format git-friendly: appending
 * a single event produces a small diff, not a re-serialize.
 *
 * What's NOT in the save: AI API keys, AI provider/system prompt,
 * pairing code, chat draft, current route, local roll panel mirror.
 * (Per multi-session-test-plan.md: avoid leaking credentials when
 * DMs share saves; and pairing codes become stale anyway.)
 */

import { EventLog, type QuireEvent } from './core/event-log';
import { KNOWN_EVENT_KINDS } from './core/state';

export interface CampaignRef {
  owner: string;
  repo: string;
  ref: string;
}

export interface SaveDocument {
  $schemaVersion: string;
  savedAt: string;
  campaign: CampaignRef;
  savedByPeerId: string;
  events: QuireEvent[];
}

export const SAVE_SCHEMA_VERSION = '0.1.0';

export type ParseResult =
  | { ok: true; doc: SaveDocument }
  | { ok: false; error: string };

export function serializeSession(
  events: readonly QuireEvent[],
  campaign: CampaignRef,
  savedByPeerId: string
): SaveDocument {
  return {
    $schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    campaign: { ...campaign },
    savedByPeerId,
    // Defensive copy; consumer shouldn't be able to mutate our slice.
    events: events.slice()
  };
}

/**
 * Produce a deterministic JSON string for the save document.  Keys
 * sorted alphabetically at every depth; events ordered by causal
 * sort (which they already are if they came from EventLog.events()).
 *
 * Pretty-printed (2-space indent) for git-friendly diffs.
 */
export function stringifySave(doc: SaveDocument): string {
  return stableStringify(doc, 2);
}

export function parseSaveDocument(input: string): ParseResult {
  if (!input || input.trim() === '') {
    return { ok: false, error: 'Empty save input.' };
  }
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch (e) {
    return {
      ok: false,
      error: `Save is not valid JSON: ${(e as Error).message}`
    };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Save must be a JSON object.' };
  }
  const d = data as Record<string, unknown>;

  // $schemaVersion: required, semver pattern, major must match.
  if (typeof d.$schemaVersion !== 'string') {
    return { ok: false, error: 'Save is missing required $schemaVersion.' };
  }
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(d.$schemaVersion);
  if (!versionMatch) {
    return {
      ok: false,
      error: `Save $schemaVersion "${d.$schemaVersion}" is not a valid semver.`
    };
  }
  const major = parseInt(versionMatch[1], 10);
  const ourMajor = parseInt(SAVE_SCHEMA_VERSION.split('.')[0], 10);
  if (major !== ourMajor) {
    return {
      ok: false,
      error: `Save was written by a different major schema version (${d.$schemaVersion} vs ${SAVE_SCHEMA_VERSION}). Update the runtime to load it.`
    };
  }

  // savedAt: required, parseable.
  if (typeof d.savedAt !== 'string' || Number.isNaN(Date.parse(d.savedAt))) {
    return { ok: false, error: 'Save savedAt is missing or unparseable.' };
  }

  // campaign: required object with string owner/repo/ref.
  if (
    !d.campaign ||
    typeof d.campaign !== 'object' ||
    Array.isArray(d.campaign)
  ) {
    return { ok: false, error: 'Save campaign is missing or not an object.' };
  }
  const c = d.campaign as Record<string, unknown>;
  for (const field of ['owner', 'repo', 'ref'] as const) {
    if (typeof c[field] !== 'string' || (c[field] as string).length === 0) {
      return {
        ok: false,
        error: `Save campaign.${field} is missing or not a non-empty string.`
      };
    }
  }

  // savedByPeerId: required non-empty string.
  if (
    typeof d.savedByPeerId !== 'string' ||
    d.savedByPeerId.length === 0
  ) {
    return {
      ok: false,
      error: 'Save savedByPeerId is missing or not a non-empty string.'
    };
  }

  // events: required array.  Per-event validation happens at apply
  // time (Phase 1b) — here we just check the container shape.
  if (!Array.isArray(d.events)) {
    return { ok: false, error: 'Save events is missing or not an array.' };
  }

  const doc: SaveDocument = {
    $schemaVersion: d.$schemaVersion,
    savedAt: d.savedAt,
    campaign: {
      owner: c.owner as string,
      repo: c.repo as string,
      ref: c.ref as string
    },
    savedByPeerId: d.savedByPeerId,
    events: d.events as QuireEvent[]
  };
  return { ok: true, doc };
}

/**
 * Result of applying a save document to a target event log.
 *
 * - applied: events accepted into the log (new ids)
 * - duplicates: events whose id was already present (idempotency)
 * - rejected: events that failed EventLog.apply validation
 *   (malformed; the per-event error is recorded in errors[])
 * - unknownKinds: events whose `kind` is not known to this
 *   runtime's materializer (forward-compat: still applied to the
 *   log because EventLog dedups by id and the events replicate,
 *   but the materializer's switch will silently drop them)
 * - errors[]: human-readable error per rejected event, with the
 *   event id when one was present
 */
export interface LoadResult {
  applied: number;
  duplicates: number;
  rejected: number;
  unknownKinds: number;
  errors: string[];
}

export function applySaveToLog(
  log: EventLog,
  doc: SaveDocument
): LoadResult {
  const result: LoadResult = {
    applied: 0,
    duplicates: 0,
    rejected: 0,
    unknownKinds: 0,
    errors: []
  };
  const existingIds = new Set(log.events().map((e) => e.id));
  for (const event of doc.events) {
    const id =
      event && typeof event === 'object' && typeof event.id === 'string'
        ? event.id
        : '<no-id>';
    // Was it already there?  EventLog.apply itself returns false for
    // duplicates AND for invalid events; we disambiguate here so the
    // user sees "your save contained 3 events we already had" vs
    // "your save contained 3 corrupt events."
    if (existingIds.has(id)) {
      result.duplicates++;
      continue;
    }
    const applied = log.apply(event);
    if (!applied) {
      result.rejected++;
      result.errors.push(
        `Rejected event ${id}: failed EventLog validation.`
      );
      continue;
    }
    result.applied++;
    if (
      typeof event.kind !== 'string' ||
      !KNOWN_EVENT_KINDS.has(event.kind)
    ) {
      result.unknownKinds++;
    }
  }
  return result;
}

// -----------------------------------------------------------------
// Stable JSON stringifier.  JSON.stringify's key order is insertion
// order, which makes byte-equality across saves fragile.  This
// version sorts object keys alphabetically at every depth.  Arrays
// are kept in their existing order (events are already causally
// sorted by the EventLog).
// -----------------------------------------------------------------

function stableStringify(value: unknown, indent: number): string {
  return formatValue(value, indent, 0);
}

function formatValue(value: unknown, indent: number, depth: number): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return formatArray(value, indent, depth);
  if (typeof value === 'object') return formatObject(value as Record<string, unknown>, indent, depth);
  // Unsupported (function, symbol, bigint) — emit as null.
  return 'null';
}

function formatArray(arr: unknown[], indent: number, depth: number): string {
  if (arr.length === 0) return '[]';
  const pad = ' '.repeat(indent * (depth + 1));
  const closePad = ' '.repeat(indent * depth);
  const items = arr.map((v) => pad + formatValue(v, indent, depth + 1));
  return `[\n${items.join(',\n')}\n${closePad}]`;
}

function formatObject(
  obj: Record<string, unknown>,
  indent: number,
  depth: number
): string {
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return '{}';
  const pad = ' '.repeat(indent * (depth + 1));
  const closePad = ' '.repeat(indent * depth);
  const pairs = keys.map((k) => {
    const key = JSON.stringify(k);
    const val = formatValue(obj[k], indent, depth + 1);
    return `${pad}${key}: ${val}`;
  });
  return `{\n${pairs.join(',\n')}\n${closePad}}`;
}

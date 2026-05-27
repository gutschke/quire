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
import { isDmOnlyCharacterFieldPath } from './character-loader';

/**
 * Wave D-prep-2-A (2026-05-26) — field-granularity firewall.
 *
 * Adversarial sweep on build `d03f888` found that the kind-level
 * `PLAYER_SCOPE_STRIP_KINDS` filter, while correct for events
 * whose payload is uniformly DM-only, leaks DM-typed material on
 * events whose payload is PARTIALLY DM-only:
 *
 *   - `pc-edit` is correctly classified player-visible (most
 *     writes target harm/stress/stats which the bound player
 *     sees on their own sheet) but writes whose `payload.field`
 *     is a DM-only field (dmNotes, magicPhase, tax.*,
 *     threadDebt.*, alignmentDrift.*) reach non-coord autosaves
 *     verbatim.  Real `dmNotes: "the Quiet is speaking through
 *     Mei"` text lands in player-autosave-localStorage.json
 *     pre-fix.  See `filterForViewer` at state.ts which DOES
 *     strip the materialized state — the event log itself wasn't
 *     scrubbed.
 *
 *   - `focus-grant` is correctly classified player-visible (foci
 *     are the Realization-beat payoff) but optional payload
 *     fields `boundFor` / `notes` / `condition` may carry DM-
 *     typed spoiler-shaped text.  D-prep-3 hid `boundFor` from
 *     the RENDER path via `<foci-card hideBoundFor>` but the
 *     SAVE STREAM still carries the raw event.  Latent today
 *     (UI form captures only name+domain) — becomes a real leak
 *     the moment T-LT4 ships the `condition` field UI.
 *
 * `scrubEventForPlayer` runs AFTER `PLAYER_SCOPE_STRIP_KINDS` on
 * each surviving event:
 *
 *   - `pc-edit` whose top-level field is DM-only → DROP entirely.
 *     The player's view of that PC's state is rebuilt from other
 *     events; dropping the DM-only edits doesn't break replay.
 *
 *   - `focus-grant` → strip the 3 optional DM-shaped fields from
 *     payload.focus.  The event still lands (name + domain are
 *     player-safe by design).
 *
 * Returns null when the event should be dropped entirely; returns
 * the (possibly scrubbed) event otherwise.
 */
/**
 * Wave D-prep-2-A (2026-05-26) cross-expert resolution: adversarial
 * named `condition` as DM-only on `focus-grant`, but TTRPG-expert
 * advice clarifies that `condition` IS player-visible (the player
 * owns the focus + needs to know when it triggers — rules.md:139).
 * Only `boundFor` (DM's narrative anchor) and `notes` (free-form
 * DM observation) are DM-only.  Keep this list narrow; widening
 * would over-strip and break the AI-write-API composition T-LT4
 * unlocked.
 */
const FOCUS_DM_ONLY_PAYLOAD_FIELDS = ['boundFor', 'notes'] as const;

function scrubEventForPlayer(event: QuireEvent): QuireEvent | null {
  if (event.kind === 'pc-edit') {
    const p = event.payload as { field?: unknown } | null | undefined;
    if (isDmOnlyCharacterFieldPath(p?.field)) {
      return null;
    }
    return event;
  }
  if (event.kind === 'focus-grant') {
    const p = event.payload as
      | { v?: number; pcId?: string; focus?: Record<string, unknown> }
      | null
      | undefined;
    if (!p || !p.focus || typeof p.focus !== 'object') return event;
    let touched = false;
    const safeFocus: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.focus)) {
      if ((FOCUS_DM_ONLY_PAYLOAD_FIELDS as readonly string[]).includes(k)) {
        touched = true;
        continue;
      }
      safeFocus[k] = v;
    }
    if (!touched) return event;
    return { ...event, payload: { ...p, focus: safeFocus } };
  }
  return event;
}

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

/**
 * Cap on the number of events accepted in a single save document.
 * A 4-hour DM session typically generates <50k events; 100k is a
 * generous ceiling above any realistic play.  A hostile save with
 * millions of events would otherwise exhaust memory during the
 * applyEvents loop; this is the container-level guard alongside
 * per-event payload caps in core/state.ts.
 *
 * Surfaced by the M1 gate's Security review.
 */
export const MAX_EVENTS_PER_SAVE = 100_000;

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
 * Event kinds whose payloads carry DM-only material and must be
 * stripped when a non-coordinator viewer saves or autosaves the
 * session.  Per the Quire threat model: civilized players who
 * share their save file should not accidentally leak the DM's
 * scratch notes, pinned NPCs, thread-debt rungs, or AI prompts
 * into a JSON the recipient opens in a text editor.
 *
 * The materialized state already filters these via filterForViewer
 * at render time; this filter does the same for the EVENT LOG
 * before serialization, closing the only remaining accidental-
 * disclosure path.
 *
 * Kept in sync with the DM-only fields in `SessionState`:
 * scratchNotes, pinnedNpcs, threadDebt, aiAudit.  When a new
 * DM-only event kind ships, add it here and to the corresponding
 * filterForViewer wipe.
 */
const PLAYER_SCOPE_STRIP_KINDS: ReadonlySet<string> = new Set([
  'scratch-note',
  'npc-pin',
  'npc-unpin',
  'thread-debt-set',
  'ai-prompt',
  'ai-response',
  'ai-accept',
  'ai-reject',
  'caster-state-set',
  // Wave D-prep-1 (2026-05-26) firewall regression fix: Wave B
  // added `accidental-grant-log` as a coord-only event carrying
  // DM-typed silent-grant text (pre-Realization aid the player
  // doesn't know about).  Adversarial audit caught that the
  // event-log strip list was NOT updated alongside the state-view
  // strip in filterForViewer — same Wave A class regression that
  // shipped autosaves with raw scratch-notes.  Added here so a
  // non-coord peer's autosave / saved file never carries the
  // silent-grant prose.  The CI lint at
  // `coordOnlyEventKinds.test.ts` enforces this list stays in
  // sync with the coord-gated materializers in state.ts.
  'accidental-grant-log',
  // Wave D-prep-2 (2026-05-26): atomic Realization-beat event.
  // The payload itself reveals the DM-private arc-state transition
  // — even though it carries no narrative text, the FACT that
  // realization happened to PC X is DM-private bookkeeping the
  // player learns at the table, not from their save file.  Same
  // rationale as ai-prompt/ai-response (no spoiler text, but the
  // existence of the event is DM-internal).
  'pc-mark-realization',
  // D1-D (2026-05-26): living-doc diff-review proposal lifecycle.
  // All three are DM-private — proposals carry AI-prose (rationale,
  // proposed `after` values including dmNotes prose); accept events
  // carry the snapshot of the resolved `after`; reject events carry
  // optional DM-typed reasons.  Players see updated NPC files only
  // after the DM commits the WorkingCopy back to git (out-of-band
  // from the session event log per Adversarial B-5 simplified MVP).
  'proposal-create',
  'proposal-accept',
  'proposal-reject',
  // D3 (2026-05-26): DM-only progress clocks.  Hidden threat /
  // pacing trackers; clock NAMES can carry magic-arc spoilers
  // ("the Quiet is closing in") so the entire family stays
  // DM-private.  Shared (player-visible) clocks deferred to D3.5
  // under a separate `clock-*` family with appropriate name-
  // confirm + AI hard-gate.
  'dm-clock-create',
  'dm-clock-tick',
  'dm-clock-delete'
]);

/**
 * Test-only export of `PLAYER_SCOPE_STRIP_KINDS`.  The set is
 * module-local to prevent accidental import from production code
 * (callers should use `serializeSessionForViewer` rather than
 * inspecting the set directly); the test file needs read access
 * to verify the firewall classification invariants.
 */
export const PLAYER_SCOPE_STRIP_KINDS_FOR_TESTS = PLAYER_SCOPE_STRIP_KINDS;

/**
 * Wave D-prep-1 (2026-05-26) — CI lint floor: every event kind in
 * KNOWN_EVENT_KINDS MUST appear in either PLAYER_SCOPE_STRIP_KINDS
 * (DM-only payload) OR this set (player-visible payload).  The
 * test `persistence.coverage.test.ts` enumerates KNOWN_EVENT_KINDS
 * and fails when a kind is in NEITHER set, forcing the engineer
 * adding a new event kind to make the visibility-classification
 * decision EXPLICITLY rather than defaulting one way silently.
 *
 * Why a curated allowlist instead of "infer from materializer":
 * coord-authored (`coordHolders.has(event.peerId)`) does NOT imply
 * DM-only payload.  `scene-reveal` is coord-authored but the
 * REVEAL ITSELF is what players see; `seat-memory-edit` is coord-
 * authored but its text is "shown to all players including any
 * future occupant of seat N"; `focus-grant` is coord-authored but
 * the granted focus is the Realization-beat payoff the player
 * sees on their rail.  No automatic inference; classify per kind.
 *
 * Add new kinds in the same commit that adds the event to
 * KNOWN_EVENT_KINDS.  When in doubt, ASK: "if a non-coord peer
 * downloads their save file and opens it in a text editor, is the
 * content the DM intended them to see, or DM-private bookkeeping
 * the spoiler-firewall protects?"  DM-private → strip.  Player-
 * visible → here.
 */
export const EVENT_KINDS_PLAYER_VISIBLE: ReadonlySet<string> = new Set([
  // Foundational session events (presence, coord transitions).
  'peer-join',
  'peer-leave',
  'peer-disconnect',
  'peer-rename',
  'coordinator-claim',
  'coordinator-yield',
  'coordinator-reclaim',
  // Stage / scene events — the REVEAL ITSELF is the player-visible
  // payload.  See doc comment above.
  'scene-reveal',
  'scene-unreveal',
  'scene-reveal-paragraph',
  'scene-unreveal-paragraph',
  'broadcast-view',
  // Chat (visible to all players by definition) + dice (rolls are
  // visible too — the result is the play-audible payload).  `note`
  // is the per-player notes channel (NOT scratch-note which is
  // DM-private — different kind, easy to confuse).
  'chat',
  'dice-roll',
  'note',
  // Player-rail-visible cosmetic / structural state.
  'raise-hand',
  'lower-hand',
  // Map blobs are coord-authored content the players see when
  // revealed.  The unreveal/move/remove counterparts are also
  // player-visible (the map UI must reflect them).
  'map-blob-add',
  'map-blob-move',
  'map-blob-remove',
  'map-blob-reveal',
  'map-blob-unreveal',
  // Per-PC edits + lifecycle — payloads are PC-state changes the
  // bound player sees on their own sheet.
  'pc-edit',
  'pc-create',
  'pc-slot-bind',
  'seat-add',
  'seat-remove',
  'seat-reveal',
  'pc-retire',
  'pc-archive',
  'pc-switch',
  // P-R11 retire-request flow: player-initiated request + DM
  // accept/reject.  Both carry player-visible text.
  'pc-retire-request',
  'pc-retire-reject',
  // Chargen pack delivery — player-authored content + DM-side
  // clear is just bookkeeping the player sees on their own UI.
  'chargen-pack-deliver',
  'chargen-pack-clear',
  // #294: seat memory — player-safe by construction ("shown to
  // all players including any future occupant of seat N").
  'seat-memory-edit',
  // Wave B: foci are player-visible at Realization; the focus-
  // grant event IS the moment the player sees it.
  'focus-grant',
  // D4 (2026-05-26): session-digest is the player-facing recap
  // (DM-saved markdown that players read at session-open next
  // time).  Player-visible by design.
  'session-digest',
  // D2 (2026-05-26): session-open marker recording WHO began the
  // session.  Player-visible audit trail (per D2-3 lock).
  'session-open'
]);

/**
 * Serialize the session for a non-coordinator viewer.  Drops events
 * whose payloads carry DM-only material — see PLAYER_SCOPE_STRIP_KINDS.
 *
 * Whole-scene `scene-reveal` / per-block `scene-reveal-paragraph` /
 * `broadcast-view` are PLAYER-VISIBLE state, so their events stay
 * in the save (a player who reloads must see what was already
 * revealed to them).
 *
 * When `viewerPeerId === currentCoordinator`, this returns the full
 * unfiltered save — the DM saves everything.  When the viewer is
 * NOT the coordinator (regardless of past coord history), DM-only
 * events are stripped.  This matches the accidental-disclosure
 * model: only the currently-acting DM holds DM material.
 */
export function serializeSessionForViewer(
  events: readonly QuireEvent[],
  campaign: CampaignRef,
  savedByPeerId: string,
  currentCoordinator: string | undefined
): SaveDocument {
  const isCoord =
    currentCoordinator !== undefined && savedByPeerId === currentCoordinator;
  // Wave D-prep-2-A (2026-05-26): two-stage filter for non-coord
  // viewers.  Stage 1: drop DM-only event kinds (the existing
  // strip).  Stage 2: field-level scrub on pc-edit + focus-grant
  // for the partially-DM-only payloads adversarial found.  Coord
  // viewer keeps the full event log unchanged.
  let filtered: QuireEvent[];
  if (isCoord) {
    filtered = events.slice();
  } else {
    filtered = [];
    for (const e of events) {
      if (PLAYER_SCOPE_STRIP_KINDS.has(e.kind)) continue;
      const scrubbed = scrubEventForPlayer(e);
      if (scrubbed !== null) filtered.push(scrubbed);
    }
  }
  return {
    $schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    campaign: { ...campaign },
    savedByPeerId,
    events: filtered
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
  // DoS guard (M1 gate Security finding): a hostile save with a
  // multi-million-event log would exhaust memory during apply.
  // A 4-hour DM session is typically <50k events; 100k is a
  // generous cap that catches obvious attacks without rejecting
  // any realistic save.  Per-event payload caps (CHAT_CAP=5000,
  // NOTE_CAP=10000, PC_FIELD_COUNT_CAP=100) bound the per-event
  // cost; this caps the count.
  if (d.events.length > MAX_EVENTS_PER_SAVE) {
    return {
      ok: false,
      error: `Save has too many events (${d.events.length} > ${MAX_EVENTS_PER_SAVE}).  Refusing to apply.`
    };
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

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
import {
  isDmOnlyCharacterFieldPath,
  DM_ONLY_CHARACTER_FIELDS
} from './character-loader';

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

/**
 * Holistic-review BLOCKER B-1 (2026-05-26, post-D3 sweep): pc-retire
 * / pc-archive payloads carry DM-private `reason` enum + `scene`
 * (spoiler-shaped path string like `ep04/scene-07-secret-dm-only-path`)
 * alongside the player-safe `inFictionReason` + `seatMemory`.
 *
 * The kind is correctly classified as player-visible (the seat
 * transition + in-fiction reason + seat memory all surface to the
 * player), but the raw payload landed verbatim in player autosaves
 * pre-fix.  Same structural class as D-prep-2-A (kind-level firewall
 * doesn't catch sub-field DM-only).  D4-cleanup-4 added a scrub at
 * the AI-digest BUNDLING stage in quire-app.ts:generateSessionDigest,
 * but never updated the save-stream firewall here — the comment on
 * that fix even acknowledged the gap.  Closing now.
 *
 * Fields stripped: `reason`, `scene`.  Preserves `v`, `pcId`,
 * `state`, `inFictionReason`, `seatMemory` (all player-safe per
 * state.ts:applyPcRetireOrArchiveEvent contract).
 */
const RETIRE_DM_ONLY_PAYLOAD_FIELDS = ['reason', 'scene'] as const;

/**
 * D5-1 (2026-05-27 holistic-review Adversarial recommendation):
 * `scrubEventForPlayer` converted to a registry as the 4th arm
 * (bond-ratify) joins.  Each kind that carries a DM-only
 * sub-field payload registers a scrubber.  Returns `null` to
 * drop the event entirely; returns a (possibly scrubbed) event
 * otherwise.  Per-kind scrubbers are documented inline at the
 * registry.
 *
 * The registry approach catches the "engineer added a new
 * DM-only-sub-field event kind but forgot the scrub arm" failure
 * class — analogous to the materializer registry in state.ts.
 *
 * M1 (2026-05-29 save-restore program, Adversarial #1): scrubbers
 * are now `(event, ctx) => …` so they can consult cross-event
 * context.  The current consumer is `map-blob-add` / `map-blob-move`:
 * the label is only player-safe when the blob is REVEALED at save
 * time, so the scrubber needs to know the reveal-mask precomputed
 * from the full log.  Future cross-event scrubs reuse the same hook.
 */
export interface ScrubContext {
  /** Set of `${scenePath}\0${blobId}` for blobs currently revealed. */
  revealedMapBlobs: ReadonlySet<string>;
}

type EventScrubber = (
  event: QuireEvent,
  ctx: ScrubContext
) => QuireEvent | null;

/**
 * Common drop-keys for any PC-event payload heading to a non-coord
 * viewer.  `causedByResponseId` is the AI-provenance indicator (M3c
 * write-API tracer); it survives the existing field-name scrub
 * because it's not in `DM_ONLY_CHARACTER_FIELDS` (which gates
 * character-record edits, not the wrapping event metadata).  Per
 * Adversarial #2: latent leak today, becomes real the moment a
 * future logging extension surfaces AI provenance.
 */
const PC_EVENT_DM_ONLY_PAYLOAD_FIELDS = ['causedByResponseId'] as const;

function dropPcEventMetadata(payload: Record<string, unknown>): {
  safe: Record<string, unknown>;
  touched: boolean;
} {
  let touched = false;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((PC_EVENT_DM_ONLY_PAYLOAD_FIELDS as readonly string[]).includes(k)) {
      touched = true;
      continue;
    }
    safe[k] = v;
  }
  return { safe, touched };
}

/**
 * M1 (2026-05-29): compute the set of map blobs that are currently
 * revealed.  Walks the event log applying the LWW reveal/unreveal
 * sequence per (scenePath, blobId).  Returns `${scenePath}\0${blobId}`
 * for every (scene, blob) pair whose final state is REVEALED.
 *
 * The map-blob materializer in state.ts is a no-op stub today
 * (M3a/M6 future work), so we cannot reuse the materialized
 * `state.mapBlobReveals`.  We re-derive from events here.  The
 * algorithm mirrors what the materializer will do when it lands.
 *
 * Note: `map-blob-remove` does NOT count as a reveal-clear by
 * itself — the materializer will likely emit both, but defensively
 * we treat remove as un-reveal here so a removed-then-re-added blob
 * doesn't accidentally inherit the prior reveal state.
 */
function computeRevealedMapBlobs(
  events: readonly QuireEvent[]
): Set<string> {
  const revealed = new Set<string>();
  for (const event of events) {
    const p = event.payload as
      | { scenePath?: unknown; blobId?: unknown; blob?: { id?: unknown } }
      | null
      | undefined;
    if (!p || typeof p !== 'object') continue;
    const scenePath = typeof p.scenePath === 'string' ? p.scenePath : null;
    if (!scenePath) continue;
    const blobId =
      typeof p.blobId === 'string'
        ? p.blobId
        : p.blob && typeof p.blob === 'object' && typeof p.blob.id === 'string'
          ? p.blob.id
          : null;
    if (!blobId) continue;
    const key = `${scenePath} ${blobId}`;
    switch (event.kind) {
      case 'map-blob-reveal':
        revealed.add(key);
        break;
      case 'map-blob-unreveal':
      case 'map-blob-remove':
        revealed.delete(key);
        break;
      // map-blob-add and map-blob-move don't change reveal state.
    }
  }
  return revealed;
}

/**
 * Shared scrubber for `map-blob-add` + `map-blob-move`: when the
 * blob is REVEALED, the label is the play-audible payload the
 * player already saw at the table — keep it (so a player who
 * reloads from save still sees the revealed map content).  When
 * the blob is UNREVEALED, the label is DM-staging text — drop it.
 *
 * The `label` field is the only player-spoiler-shaped field on the
 * payload today.  Coordinates + id are DM-stage-position data; a
 * leak of "blob X is at (10, 20)" doesn't carry narrative spoiler
 * weight comparable to a DM's free-form label string.  If future
 * payload fields gain spoiler weight (e.g. a `note` field on the
 * blob), extend `MAP_BLOB_DM_ONLY_PAYLOAD_FIELDS`.
 */
const MAP_BLOB_DM_ONLY_PAYLOAD_FIELDS = ['label'] as const;

function scrubMapBlobIfUnrevealed(
  event: QuireEvent,
  ctx: ScrubContext
): QuireEvent | null {
  const p = event.payload as
    | { scenePath?: unknown; blob?: Record<string, unknown> }
    | null
    | undefined;
  if (!p || typeof p !== 'object') return event;
  const scenePath = typeof p.scenePath === 'string' ? p.scenePath : null;
  if (!scenePath) return event;
  const blobId =
    p.blob && typeof p.blob === 'object' && typeof p.blob.id === 'string'
      ? (p.blob.id as string)
      : null;
  if (!blobId) return event;
  const key = `${scenePath} ${blobId}`;
  if (ctx.revealedMapBlobs.has(key)) return event;
  // Strip DM-only fields from `blob`.
  const blob = p.blob as Record<string, unknown>;
  let touched = false;
  const safeBlob: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(blob)) {
    if (
      (MAP_BLOB_DM_ONLY_PAYLOAD_FIELDS as readonly string[]).includes(k)
    ) {
      touched = true;
      continue;
    }
    safeBlob[k] = v;
  }
  if (!touched) return event;
  return {
    ...event,
    payload: { ...(p as Record<string, unknown>), blob: safeBlob }
  };
}

const PER_KIND_SCRUBBERS: Record<string, EventScrubber> = {
  // pc-edit: drop entirely when `field` is a DM-only top-level
  // (per the dotted-field-path check from D-prep-2-A).  M1
  // (2026-05-29 Adversarial #2): also strip the wrapper-level
  // `causedByResponseId` AI-provenance tracer.
  'pc-edit': (event) => {
    const p = event.payload as { field?: unknown } | null | undefined;
    if (isDmOnlyCharacterFieldPath(p?.field)) return null;
    if (!p || typeof p !== 'object') return event;
    const { safe, touched } = dropPcEventMetadata(
      p as unknown as Record<string, unknown>
    );
    if (!touched) return event;
    return { ...event, payload: safe };
  },
  // M1 (2026-05-29 Adversarial #1): map-blob-add / map-blob-move
  // labels are DM-staging text until the blob is revealed.  See
  // `scrubMapBlobIfUnrevealed` for the reveal-mask check.
  'map-blob-add': scrubMapBlobIfUnrevealed,
  'map-blob-move': scrubMapBlobIfUnrevealed,
  // focus-grant: strip DM-only sub-fields from the `focus` payload
  // (boundFor + notes per D-prep-2-A).
  'focus-grant': (event) => {
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
  },
  // pc-retire + pc-archive: strip DM-private `reason` + `scene`
  // (D4-cleanup-4 / B-1 BLOCKER fix).
  'pc-retire': scrubRetireOrArchive,
  'pc-archive': scrubRetireOrArchive,
  // bond-ratify (D5-9): strip the optional DM-only `dmNotes`
  // sub-field from the payload.  Player save keeps the bond text
  // (the player-visible part) but never the dmNotes.
  'bond-ratify': (event) => {
    const p = event.payload;
    if (!p || typeof p !== 'object') return event;
    const obj = p as Record<string, unknown>;
    if (!('dmNotes' in obj)) return event;
    const { dmNotes: _omit, ...safe } = obj;
    void _omit;
    return { ...event, payload: safe };
  },
  // SEC-1 (2026-05-27 post-D5 holistic Adversarial sweep): pc-create
  // is correctly classified player-visible (the synthesized PC is
  // the player's own character), but the payload carries the full
  // CharacterRecord shape including OPTIONAL DM-only fields.  Pre-
  // fix: a DM ratifying chargen with `dmNotes` set would land that
  // dmNotes verbatim in EVERY player's autosave.  Same D-prep-2-A
  // bug class as pc-edit + focus-grant + pc-retire — the scrubber
  // family started on edits and missed creates.  Strip every
  // top-level DM-only character field by name (reuse the SSOT
  // constant from character-loader so the lint stays load-bearing).
  // M1 (2026-05-29 Adversarial #2): also drop the wrapper-level
  // `causedByResponseId` AI-provenance tracer.
  'pc-create': (event) => {
    const p = event.payload;
    if (!p || typeof p !== 'object') return event;
    const obj = p as Record<string, unknown>;
    let touched = false;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if ((DM_ONLY_CHARACTER_FIELDS as readonly string[]).includes(k)) {
        touched = true;
        continue;
      }
      if (
        (PC_EVENT_DM_ONLY_PAYLOAD_FIELDS as readonly string[]).includes(k)
      ) {
        touched = true;
        continue;
      }
      safe[k] = v;
    }
    if (!touched) return event;
    return { ...event, payload: safe };
  }
};

function scrubRetireOrArchive(event: QuireEvent): QuireEvent | null {
  const p = event.payload;
  if (!p || typeof p !== 'object') return event;
  const obj = p as Record<string, unknown>;
  let touched = false;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if ((RETIRE_DM_ONLY_PAYLOAD_FIELDS as readonly string[]).includes(k)) {
      touched = true;
      continue;
    }
    safe[k] = v;
  }
  if (!touched) return event;
  return { ...event, payload: safe };
}

function scrubEventForPlayer(
  event: QuireEvent,
  ctx: ScrubContext
): QuireEvent | null {
  const scrubber = PER_KIND_SCRUBBERS[event.kind];
  if (scrubber) return scrubber(event, ctx);
  return event;
}

/**
 * Test-only export of the scrubber registry kind set.  Used by
 * `persistence.coverage.test.ts` to enforce that every kind in
 * `EVENT_KINDS_PLAYER_VISIBLE` that COULD carry DM-only sub-fields
 * either registers a scrubber here or appears in the explicit
 * `NO_SCRUB_NEEDED` list (with rationale).  See
 * `EVENT_KINDS_NO_SCRUB_NEEDED` below.
 */
export const PER_KIND_SCRUBBER_KINDS_FOR_TESTS: ReadonlySet<string> = new Set(
  Object.keys(PER_KIND_SCRUBBERS)
);

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
  /**
   * Forward-compat passthrough bag for top-level fields a future
   * runtime added that today's runtime doesn't recognize.  The
   * parser populates this from any keys in the parsed object that
   * aren't on the known list; `stringifySave` merges them back in.
   *
   * Required for INV-1 ("unknown top-level fields round-trip") per
   * `design/playtest-readiness/format-stability.md`.  Without this,
   * a future runtime that adds e.g. `dmAnnotations` and a today's
   * runtime that load-then-save the doc would silently strip the
   * field, dropping data on cross-version round-trips.
   *
   * NEVER use `extraFields` for known-DM-only data added by today's
   * runtime — that would bypass the firewall.  All firewall-
   * classified data MUST go through `events` (the SSOT).
   * `extraFields` is purely a forward-compat passthrough for keys
   * unknown to this runtime at load time.
   */
  extraFields?: Record<string, unknown>;
}

export const SAVE_SCHEMA_VERSION = '0.1.0';

/**
 * Keys that `parseSaveDocument` MUST recognize as first-class
 * SaveDocument fields.  Any OTHER key encountered on the wire is
 * passed through `extraFields` per INV-1 (forward-compat).
 */
const KNOWN_SAVE_DOCUMENT_KEYS = new Set<string>([
  '$schemaVersion',
  'savedAt',
  'campaign',
  'savedByPeerId',
  'events'
]);

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
  'dm-clock-delete',
  // D5 (2026-05-27): un-ratified bond drafts are DM-private.
  // Players don't see other players' (or their own) un-ratified
  // bonds — proposals are a holding area for DM ratification.
  'bond-propose'
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
  'session-open',
  // D5 (2026-05-27): bond-ratify is player-visible (the bond
  // text IS what players see).  `scrubEventForPlayer` strips
  // the optional `dmNotes` sub-field from the payload.
  // bond-remove is coord-only authored but player-visible (a
  // bond going away is a story signal).
  'bond-ratify',
  'bond-remove'
]);

/**
 * M1 (2026-05-29 save-restore program, Adversarial #3 self-completing
 * tripwire): every kind in `EVENT_KINDS_PLAYER_VISIBLE` must either
 * register a scrubber in `PER_KIND_SCRUBBERS` (because its payload
 * carries DM-only sub-fields) OR appear in this set with an inline
 * rationale (because its payload is uniformly player-safe).
 *
 * The CI lint at `persistence.coverage.test.ts` enforces the
 * partition: a new player-visible kind is forced to make the
 * decision EXPLICITLY rather than defaulting to silent-passthrough.
 * This is the field-level companion to the kind-level lint that
 * caught the Wave A→B `accidental-grant-log` regression.
 *
 * When in doubt, ASK: "if I add this kind's payload verbatim to a
 * player's autosave JSON they open in a text editor, is any field
 * (a) free-form DM-typed text, (b) cross-event metadata derived
 * from DM state, or (c) AI provenance?"  If yes → register a
 * scrubber.  If every field is structurally player-safe (timestamp,
 * enum, peer-id, shared coordinator transition) → list here.
 *
 * EXPLICIT no-scrub entries (each line has a one-phrase rationale):
 */
export const EVENT_KINDS_NO_SCRUB_NEEDED: ReadonlySet<string> = new Set([
  // Presence/lifecycle — peerId + role transitions, no DM text.
  'peer-join',
  'peer-leave',
  'peer-disconnect',
  'peer-rename',
  'coordinator-claim',
  'coordinator-yield',
  'coordinator-reclaim',
  // Scene reveal events — the reveal IS the player-visible payload;
  // scenePath is already player-visible by definition.
  'scene-reveal',
  'scene-unreveal',
  'scene-reveal-paragraph',
  'scene-unreveal-paragraph',
  'broadcast-view',
  // Chat + dice + notes — payload is player-authored or play-audible.
  'chat',
  'dice-roll',
  'note',
  // Hand-raise (no payload text beyond peerId).
  'raise-hand',
  'lower-hand',
  // Map-blob lifecycle (non-add/move) — IDs only, no labels.
  'map-blob-remove',
  'map-blob-reveal',
  'map-blob-unreveal',
  // Seat lifecycle — slot numbers, no DM text.
  'pc-slot-bind',
  'seat-add',
  'seat-remove',
  'seat-reveal',
  // Player-initiated retire-request flow.  The note is player-authored
  // and player-visible by design.
  'pc-retire-request',
  'pc-retire-reject',
  // Chargen pack delivery — player-authored content.
  'chargen-pack-deliver',
  'chargen-pack-clear',
  // #294 seat-memory-edit — text is player-safe by construction
  // ("shown to all players including any future occupant of seat N").
  'seat-memory-edit',
  // PC switch — audit-only, peer-id + scenePath.
  'pc-switch',
  // D4 session-digest — player-facing recap by design.
  'session-digest',
  // D2 session-open — audit trail (who started the session).
  'session-open',
  // D5 bond-remove — coord-authored player-visible signal, no DM text.
  'bond-remove'
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
    // M1 (2026-05-29) Adversarial #1: precompute the reveal-mask so
    // `map-blob-add` / `map-blob-move` scrubbers can keep labels for
    // REVEALED blobs (player already saw them at the table) and
    // drop them for UNREVEALED blobs (DM-staging text).
    const ctx: ScrubContext = {
      revealedMapBlobs: computeRevealedMapBlobs(events)
    };
    filtered = [];
    for (const e of events) {
      if (PLAYER_SCOPE_STRIP_KINDS.has(e.kind)) continue;
      const scrubbed = scrubEventForPlayer(e, ctx);
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
 * NEW-ADV-1 (2026-05-29 save-restore program, independent
 * adversarial review): the restore-as-player path.
 *
 * `serializeSessionForViewer` answers "what does THIS viewer's save
 * look like?" at SAVE TIME, keyed on who's currently coord.  The
 * symmetric question — "I'm loading someone else's save; what's
 * safe for ME to see?" — was unmodeled before the independent
 * review.  The scenario: a DM saves their coord-projection to Drive
 * appdata, then comes back next week as a PLAYER in someone else's
 * session, then clicks "Pull from my Drive."  Pre-fix, the raw
 * DM-only events from the save land in the loading peer's
 * event log AND get rebroadcast via the M3 `applyEvent` propagation
 * (DEC-005) to every connected peer — same accidental-disclosure
 * class as #392/#393/#395 + the M1 map-blob leak.
 *
 * `projectSaveForViewer` runs the SAME viewer-scope filter that
 * `serializeSessionForViewer` applies at save time, but on the way
 * IN rather than out.  Callers pass `viewerIsCoord = true` when the
 * loading peer is about to be (or is already) the session's
 * coordinator (the host-load auto-reclaim path); pass `false` when
 * the loader is a guest who will materialize as a player.
 *
 * When `viewerIsCoord` is true, returns the save unchanged.  When
 * false, returns a NEW SaveDocument whose `events` have been
 * scrubbed identically to a player's autosave: DM-only kinds
 * dropped, partially-DM-only payloads field-stripped via the
 * shared `PER_KIND_SCRUBBERS` registry.
 *
 * Side note on `savedByPeerId`: the field records who AUTHORED the
 * save (not who's loading it).  We keep it intact so audit / debug
 * tooling can still say "this save was authored by peer X."  The
 * sensitive payloads have already been removed by the time it
 * reaches the loading peer's log.
 */
export function projectSaveForViewer(
  doc: SaveDocument,
  viewerIsCoord: boolean
): SaveDocument {
  if (viewerIsCoord) return doc;
  const ctx: ScrubContext = {
    revealedMapBlobs: computeRevealedMapBlobs(doc.events)
  };
  const filtered: QuireEvent[] = [];
  for (const e of doc.events) {
    if (PLAYER_SCOPE_STRIP_KINDS.has(e.kind)) continue;
    const scrubbed = scrubEventForPlayer(e, ctx);
    if (scrubbed !== null) filtered.push(scrubbed);
  }
  return { ...doc, events: filtered };
}

/**
 * NEW-ADV-2 (2026-05-29 save-restore program, independent
 * adversarial review): the rebroadcast-after-restore path.
 *
 * DEC-005 made `Peer.applyEvent({propagate:true})` forward newly-
 * applied events to connected peers via the sync-response gossip
 * path.  The defense it landed (the R2.1 impersonation cross-check
 * is exempt for sync-response) is correct for the M3 broadcast-
 * after-restore goal — but it is structurally a firewall hole:
 * if the loading peer's event log contains DM-only events (because
 * the load was projected as full-coord, or because a future bug
 * leaves a non-coord peer holding DM material), the rebroadcast
 * pushes those events to every connected peer.
 *
 * `defaultRebroadcastFilter` runs at the seam between `applyEvent`
 * and `forwardShareToOthers`: every event the peer is about to
 * broadcast to others is first classified.  DM-only-kind events
 * are DROPPED (return null).  Player-visible-with-DM-subfields
 * events are scrubbed via `PER_KIND_SCRUBBERS`.  This is the same
 * registry the save-side filter uses; the SSOT keeps the
 * classification load-bearing across both surfaces.
 *
 * The filter takes only the event itself (not a viewer context)
 * because rebroadcast is many-to-many.  Send the strictest
 * projection that's safe for any potential receiver.  Coord-to-
 * coord co-DM sync of DM-only events still works through `append`
 * (which uses the `share` envelope subject to the R2.1
 * impersonation defense; only the AUTHOR can author).  `applyEvent`
 * is for restore + relay, not for fanning out new DM material.
 *
 * Note on map-blob payloads: at rebroadcast time we don't have the
 * full log context the save-time `serializeSessionForViewer` uses
 * to compute the reveal-mask.  Without that, the map-blob scrubber
 * conservatively assumes the blob is UNREVEALED (drops the label).
 * The receiving peer will, on its own log, see the matching
 * `map-blob-reveal` event later in causal order and re-materialize
 * the player-visible state correctly — but the label text itself
 * is owner-side.  Concrete cost: a player who receives a
 * rebroadcast `map-blob-add` for a not-yet-revealed blob will see
 * it appear on their map without a label until the reveal fires.
 * Acceptable; the alternative (sending the label and trusting the
 * receiver to strip on render) is the exact class of regression
 * NEW-ADV-2 catches.
 */
const REBROADCAST_SCRUB_CONTEXT: ScrubContext = {
  // Empty reveal-mask = treat every map-blob as unrevealed.  See
  // the function doc above for why this is the safe conservative
  // choice at rebroadcast time.
  revealedMapBlobs: new Set<string>()
};

export function defaultRebroadcastFilter(
  event: QuireEvent
): QuireEvent | null {
  if (PLAYER_SCOPE_STRIP_KINDS.has(event.kind)) return null;
  return scrubEventForPlayer(event, REBROADCAST_SCRUB_CONTEXT);
}

/**
 * OP-039 (2026-05-29 save-restore program, mock campaign 01
 * finding): sync-response firewall — the sister surface to
 * `defaultRebroadcastFilter` for the `sync-request → sync-response`
 * catch-up path.
 *
 * When a fresh peer joins an existing session, every connected peer
 * responds to its sync-request with `log.since(clock)` — every
 * event in the responder's log the joiner hasn't seen.  Pre-fix,
 * these events were shipped RAW.  A peer holding DM-only events
 * (e.g. the DM herself, having appended scratch-notes during play)
 * would leak them into the joining peer's RAW event log.  Render-
 * layer firewall (`filterForViewer`) and save-layer firewall
 * (`serializeSessionForViewer`) both hold; the hole is the joining
 * peer's raw log on disk / in devtools.
 *
 * Why this filter is NARROWER than `defaultRebroadcastFilter`:
 * the rebroadcast path runs at hub-forward time, when a peer who
 * received a SHARE relays it to other peers; at that point every
 * legitimate recipient has either already received the share
 * directly OR is connected and will receive a future share.  The
 * sync-response path is different — it is the JOINING peer's only
 * catch-up channel for events that happened before they connected.
 * If we drop a `pc-edit` event scrubbed to null by the per-field
 * scrubber (e.g. `pc-edit knowsTheyCanCast=true` for the joining
 * player's OWN PC), the joining peer permanently loses that
 * player-visible state.  Their render-layer firewall has the
 * viewer context (boundCharacter, role) the rebroadcast filter
 * lacks, so it's the right defense surface for partial-DM-only
 * events.
 *
 * Therefore: drop only WHOLE-KIND DM-only events
 * (`PLAYER_SCOPE_STRIP_KINDS`).  Let everything else through; let
 * the receiver's `filterForViewer` + `serializeSessionForViewer`
 * handle per-field strip with full viewer context.
 *
 * For the SSOT alignment: this function shares
 * `PLAYER_SCOPE_STRIP_KINDS` with `defaultRebroadcastFilter` and
 * `projectSaveForViewer` — same source of truth, narrower
 * application.
 */
export function defaultSyncResponseFilter(
  event: QuireEvent
): QuireEvent | null {
  if (PLAYER_SCOPE_STRIP_KINDS.has(event.kind)) return null;
  return event;
}

/**
 * Produce a deterministic JSON string for the save document.  Keys
 * sorted alphabetically at every depth; events ordered by causal
 * sort (which they already are if they came from EventLog.events()).
 *
 * Pretty-printed (2-space indent) for git-friendly diffs.
 *
 * Forward-compat (INV-1): `doc.extraFields` (if present) is FLATTENED
 * back into the top-level JSON object — these are top-level keys a
 * future runtime added that we preserved on parse.  Their keys must
 * NOT collide with our known fields (the parser guarantees this; the
 * stringifier checks defensively).
 */
export function stringifySave(doc: SaveDocument): string {
  if (doc.extraFields === undefined) {
    return stableStringify(doc, 2);
  }
  // Drop our placeholder property + merge the passthrough keys back
  // in at the top level so the serialized form is indistinguishable
  // from a save that simply HAD those keys natively.
  const { extraFields, ...known } = doc;
  const flattened: Record<string, unknown> = { ...known };
  for (const key of Object.keys(extraFields)) {
    if (KNOWN_SAVE_DOCUMENT_KEYS.has(key)) {
      // Defensive: a caller passed extraFields with a known-key
      // collision.  The known field wins; the extra is dropped to
      // protect determinism + correctness.  In practice the parser
      // never produces this state.
      continue;
    }
    flattened[key] = extraFields[key];
  }
  return stableStringify(flattened, 2);
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

  // INV-1: preserve unknown top-level fields so cross-version round-
  // trips don't shed data.  Any key in `d` not on the known list is
  // copied to `extraFields`.  See format-stability.md §INV-1.
  let extraFields: Record<string, unknown> | undefined;
  for (const key of Object.keys(d)) {
    if (KNOWN_SAVE_DOCUMENT_KEYS.has(key)) continue;
    if (extraFields === undefined) extraFields = {};
    extraFields[key] = d[key];
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
  if (extraFields !== undefined) doc.extraFields = extraFields;
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

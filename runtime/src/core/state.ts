/**
 * State materialization: reduces an event log into a current SessionState.
 *
 * `materialize(events)` is a pure function — same input always produces the
 * same output.  The function is called with the deterministic causal ordering
 * produced by EventLog.events(), which is what makes state convergence
 * possible across peers even when events arrive in different real-time
 * orders.
 */

import type { PeerId, QuireEvent } from './event-log';
import type {
  CharacterRecord,
  AccidentalGrant,
  Focus
} from '../character-loader';
import type { ChargenPackDocument } from '../chargen-pack';
import { CHARGEN_PACK_MAX_SIZE_BYTES } from '../chargen-pack';
import {
  stripDmOnlyFromCharacter,
  DM_ONLY_CHARACTER_FIELDS
} from '../character-loader';

export interface PeerPresence {
  peerId: PeerId;
  name?: string;
  /**
   * Optional character / status string the peer authored about
   * themselves.  E.g. "Yui Tanaka" or "Tim (afk)".  Distinct from
   * `name` (which is the display name the peer registered with at
   * join).  Updated via `peer-rename` events.
   *
   * As of M3a.2, `pcId` (below) is the canonical PC linkage; this
   * field is kept for backward compatibility and for non-PC status
   * strings ("Tim (afk)").  Renderers that want "what character is
   * this player playing" should prefer `pcId` and fall back to
   * `character` when absent.
   */
  character?: string;
  /**
   * P-M3a-pc-binding: optional id of the PC character record the
   * peer has claimed.  When set, the renderer can resolve to the
   * canonical character via the campaign's loaded PCs map and
   * read stats, harm, stress, foci, etc.  Validated via the same
   * PC_ID_RE as character-loader's pcId field; PCs only (no NPCs).
   * Set / cleared via `peer-rename` with a `pcId` payload field.
   */
  pcId?: string;
  joinedAt: number;
  leftAt?: number;
  /**
   * P0-12: count of KNOWN_EVENT_KINDS the peer's runtime recognized
   * at peer-join time.  When this is < the local runtime's count,
   * the peer is running an older Quire and may not render some
   * events the local DM emits.  Used by the render layer to surface
   * a one-line "peer X is on an older version" banner.  Absent for
   * legacy peer-join events from pre-P0-12 runtimes (treat as
   * unknown rather than implicitly old).
   */
  knownKindsCount?: number;
}

export interface DiceRoll {
  peerId: PeerId;
  ts: number;
  expression: string;
  result: number;
  dice: number[];
}

export interface ChatMessage {
  peerId: PeerId;
  ts: number;
  text: string;
}

export interface Note {
  peerId: PeerId;
  ts: number;
  text: string;
  private?: boolean;
}

export interface CampaignRef {
  owner: string;
  repo: string;
  ref: string;
}

/**
 * Per-PC thread-debt rung.  Render-gated DM-only (see filterForViewer).
 * Materializer ships in M3a (P2-5).
 */
export type ThreadDebtLevel =
  | 'quiet'
  | 'noticed'
  | 'watched'
  | 'pushing-back'
  | 'hunted';

/**
 * Per-PC caster-ladder state — combines the magic-discovery
 * ladder (underleaf/world/rules.md L125-135), the trying-too-hard tax
 * (L179-186), and the Free/Cheap cast-spam counter (L141) into
 * a single tier-2 record the AI write API can propose updates
 * to.  Render-gated DM-only (the DM narrates the ladder in
 * fiction; players hear consequences, not labels).
 *
 * `ladderState: 'clear'` is the sentinel for "no ladder pressure
 * yet" (avoids the empty-string-as-sentinel fragility Engine
 * flagged on the prior M3c plan draft).
 */
export type CasterLadderState =
  | 'clear'
  | 'quiet'
  | 'noticed'
  | 'watched'
  | 'pushing-back'
  | 'hunted';

export interface CasterState {
  ladderState: CasterLadderState;
  /**
   * AI's suggested narration line for the current rung — the DM
   * reads or rewrites this rather than seeing the bare label.
   */
  reason?: string;
  /** Trying-too-hard tax active (PC suffers -2 on rolls). */
  taxActive: boolean;
  /**
   * Free/Cheap cast-spam counter for the current scene.  Reset
   * via DM-direct button (no scene-transition event yet — see
   * design/m3c-ai-write-api.md §Phase 1 "Reset emitter").
   */
  spamCount: number;
}

/**
 * Phase B' (2026-05-25): roster-lifecycle slot states.
 *
 *   - `unbound`     — seat exists but no PC + no controller yet
 *                     (DM has added the seat but chargen hasn't run).
 *   - `bound-active`— PC is the currently-played character at this seat.
 *   - `bound-retired`— PC is gone for good (death / departed / converted
 *                     to NPC).  Retain pcId so `{{pc:N}}` substitution
 *                     keeps resolving to the retired PC's name
 *                     (narrative continuity per the converged design).
 *   - `bound-archived`— PC is gone but the DM marked them as
 *                     "potentially returnable."  UI surfaces in the
 *                     Archive browser.  Slot stays sticky to this PC;
 *                     restoring binds the PC into a NEW seat (N+1).
 */
export type SlotState =
  | 'unbound'
  | 'bound-active'
  | 'bound-retired'
  | 'bound-archived';

/**
 * Reason a PC retired.  DM-private — stripped from player-bound
 * projection.  The player-safe label is `inFictionRetireReason`.
 */
export type RetireReason =
  | 'died'
  | 'departed'
  | 'converted-to-npc'
  | 'other';

/**
 * P-R11 (2026-05-25): a player-initiated request to retire their
 * own PC.  The DM sees a pip + Accept/Reject; accept emits the
 * existing `pc-retire` event with the player's narrative reason,
 * reject emits `pc-retire-reject` with an optional note.
 *
 * The request is identified by `(requestingPeerId, pcId, ts)` —
 * a player can't have two requests for the same PC at once (a
 * duplicate event clobbers the prior entry's ts).
 */
export interface PcRetireRequest {
  /** Peer who authored the request — also the seat's controller. */
  requestingPeerId: PeerId;
  /** The PC the player wants to retire. */
  pcId: string;
  /** Player-safe in-fiction reason (becomes pc-retire's reason on accept). */
  inFictionReason: string;
  /** Retire reason enum (becomes pc-retire's `reason` on accept). */
  reason: RetireReason;
  /** Epoch-ms request authored. */
  ts: number;
}

/**
 * #253 (2026-05-26): an in-flight chargen pack the player has
 * "Sent to DM" via the live WebRTC pack delivery affordance.
 * Materializes from a player-authored `chargen-pack-deliver` event;
 * cleared by a coord-authored `chargen-pack-clear` when the DM
 * imports or dismisses.  Keyed by `(senderPeerId, slot)` — a
 * resend overwrites the prior pack's timestamp (LWW).
 *
 * The `pack` field is the full `ChargenPackDocument` (player's
 * chargen answers + chosen path + fingerprint).  Content is
 * DM-only in the viewer-scope projection — other players see only
 * the metadata (sender + slot + delivered status), never another
 * player's answer text.  Per the chat/AI confusion threat-model
 * the answer text often contains the player's private intent for
 * their PC ("I want her to find out she's the chosen one"), which
 * shouldn't be readable by teammates.
 *
 * Payload size cap is enforced at the materializer (32 KB
 * stringified) so a hostile / buggy peer can't balloon shared
 * state.  The chargen-pack validator already caps individual
 * fields; this is the belt-and-suspenders top-level gate.
 */
export interface ChargenPackDelivery {
  /** Peer who sent the pack.  Also the controlling player at the slot. */
  senderPeerId: PeerId;
  /** Slot the pack is for. */
  slot: number;
  /** Full pack document — DM-only content via projection. */
  pack: ChargenPackDocument;
  /** Epoch-ms the delivery was authored. */
  ts: number;
}

/**
 * P-R11: a DM's rejection of a player's request, surfaced to the
 * requesting peer.  Cleared when the player submits a fresh request.
 */
export interface PcRetireRejection {
  /** The peer the rejection is delivered to (the requesting player). */
  requestingPeerId: PeerId;
  /** The PC the rejected request was about. */
  pcId: string;
  /** Optional DM note explaining the rejection (player-safe). */
  note?: string;
  /** Epoch-ms rejection authored. */
  ts: number;
}

/**
 * Phase B' (2026-05-25): a seat in the roster.  Slots are
 * sticky-N: once bound, the integer is reserved for that PC for
 * the life of the campaign.
 */
export interface Seat {
  /** Slot state per the lifecycle. */
  state: SlotState;
  /**
   * The bound PC's id — present on every state EXCEPT `unbound`.
   * Sticky after first bind: stays the same through retire/archive.
   */
  pcId?: string;
  /**
   * The peer playing this seat — present only on `bound-active`.
   * Stripped on retire/archive.
   */
  controllerPeerId?: PeerId;
  /**
   * Player-safe in-fiction reason for retirement (DM-authored at
   * retire time).  Player Aside roster renders this as the tile's
   * subtitle.  Never the literal scene name.  Example:
   * "left the story after a hard betrayal."
   * Present only on bound-retired / bound-archived.
   */
  inFictionRetireReason?: string;
  /**
   * DM-private retire metadata — STRIPPED by filterForViewer for
   * non-coord viewers.  These fields surface only behind the DM's
   * amber-rail ▸ disclosure on the retire tile.
   */
  retireReason?: RetireReason;
  retiredScene?: string;
  /** Epoch-ms when retirement landed (for chronological display). */
  retiredAt?: number;
  /**
   * #294 (2026-05-26): "seat memory" — player-safe one-line essence
   * authored by the DM at retire time (optional).  Persists on the
   * seat after retire so future readers of `{{pc:N}}` references in
   * archived narrative + the Stage roster's Retired tab can see
   * "the medic whose silence said more than her words" instead of
   * just the raw display name.  Player-safe BY CONSTRUCTION (the
   * UI tells the DM "this text is shown to all players") so it
   * survives `filterForViewer` unchanged.  Editable later via the
   * `seat-memory-edit` event.  Capped at 200 chars to keep it a
   * sentence, not an essay.
   */
  seatMemory?: string;
  /**
   * #301 (2026-05-26): per-seat reveal gate.  When `revealed === false`,
   * `filterForViewer` drops this seat entirely from non-coord views —
   * players don't see the slot exist at all.  Lets the DM stage a
   * future-twist PC (NPC-becomes-PC reveal, late-joining guest, etc.)
   * without the seat appearing in lobby/roster/switcher and spoiling
   * the surprise.
   *
   * Default semantics: `undefined === true` (omitted ⇒ revealed) so
   * legacy saves + existing seat-add events continue to behave
   * identically.  Only explicit `revealed: false` triggers the
   * projection strip.  Flips to true via the `seat-reveal` event;
   * sticky once revealed (can't be un-revealed without removing the
   * seat).
   */
  revealed?: boolean;
}

/**
 * Phase B' (2026-05-25): PC entity lifecycle state.  Orthogonal to
 * Seat.state — mostly tracks the slot, but the `sidelined` state
 * is per-PC only (the seat remains `bound-active` while the player
 * runs a sub-PC during the sidelining).
 *
 * Lives as `lifecycle?: PcLifecycleState` on CharacterRecord
 * (see character-loader.ts Phase B' additions).
 *
 *   - `nascent`  — chargen in progress; sheet incomplete.
 *   - `active`   — currently playable.
 *   - `sidelined`— temporarily out (harm-4 incapacitation / coord-
 *                  holding / voluntary session skip).  Player may
 *                  have a parallel sub-PC during this state.
 *   - `retired`  — gone for good; mirrors seat's bound-retired.
 *   - `archived` — dormant but potentially returnable; mirrors
 *                  seat's bound-archived.
 *
 * `npc` is NOT a state — once a PC is converted to NPC, the PC
 * record retires/archives and a new NPC record (in `npcs/<id>.md`
 * or `dm/npcs.md`) takes over.  Provenance lives in git history.
 */
export type PcLifecycleState =
  | 'nascent'
  | 'active'
  | 'sidelined'
  | 'retired'
  | 'archived';

/**
 * Phase B' (2026-05-25): why a PC is in `sidelined` state.  Drives
 * the distinct chip visual in the roster ("Out: Critical" vs "Out:
 * DM" vs "Out: Skipped").
 */
export type SidelinedSource =
  | 'harm-4'
  | 'coord-holding'
  | 'voluntary-skip';

/**
 * DM scratch note — quick-jot during play, ingested by the
 * living-document AI post-session.  Render-gated DM-only AND
 * event-stripped from player save exports (see
 * `serializeSessionForViewer` in persistence.ts, lands in M3a).
 * Materializer ships in M3a (P2-3).
 */
export interface ScratchNote {
  peerId: PeerId;
  ts: number;
  text: string;
  scenePath?: string;
}

/**
 * Hash-chain audit entry for AI broker calls.  The full prompt and
 * response text lives in IndexedDB keyed by hash on the DM's
 * machine; only the chain head + token counts replicate via events.
 * Render-gated DM-only AND event-stripped from player save exports.
 * Materializer ships in M3b (P2-7).
 */
export interface AiAuditEntry {
  peerId: PeerId;
  ts: number;
  kind: 'prompt' | 'response' | 'accept' | 'reject' | 'rejected-hard-gate';
  responseId?: string;
  promptHash?: string;
  responseHash?: string;
  prevHash?: string;
  tokensIn?: number;
  tokensOut?: number;
  category?: string;
  /**
   * M3c.5: when `kind === 'rejected-hard-gate'`, a human-readable
   * reason the materializer used to reject an AI-proposed event
   * that failed the hard-gate check.  Surfaced in the DM banner
   * + audit log so silent drops can't happen.
   */
  rejectedReason?: string;
  /** Set on rejected-hard-gate entries — which event kind was refused. */
  rejectedKind?: string;
}

/**
 * Single blob on a schematic map.  Materializer ships in M6 (P5-3).
 */
export interface MapBlob {
  id: string;
  label: string;
  x: number;
  y: number;
  kind?: 'token' | 'note' | 'hazard';
}

export interface SessionState {
  peers: Record<PeerId, PeerPresence>;
  /**
   * Campaign the session is anchored to.  Embedded in the host's
   * peer-join event so that guests who land on play.quire.games
   * without `?campaign=` URL params still learn what to load.
   * First-write-wins: set by the earliest peer-join that includes
   * a campaign reference; later ones don't override.
   */
  campaign?: CampaignRef;
  coordinator?: PeerId;
  /**
   * Every peer who has ever held coordinator at any point in the
   * event log (successful coord-claim OR coord-reclaim).  Used by
   * scene-reveal's authority check: a reveal is accepted if the
   * author was coord at SOME point, not just the current moment.
   *
   * This is important for multi-session continuity: when a new
   * host loads a save authored by a prior DM, the prior DM's
   * scene-reveal events should still apply even though the current
   * coordinator is the new host.  Without this, alphabetical
   * peerId tiebreak on coord-claim sorting determined whether
   * loaded reveals survived — non-deterministic.
   *
   * Trade-off: a peer who was briefly coord can keep authoring
   * reveals even after handoff (until kicked from session).  In a
   * TTRPG context this is acceptable — past-coord-authority
   * abuse is socially visible and the audit-trail chat captures
   * the original handoff.
   */
  coordHolders: Set<PeerId>;
  revealedScenes: string[];
  diceRolls: DiceRoll[];
  chat: ChatMessage[];
  pcEdits: Record<string, Record<string, unknown>>;
  notes: Note[];

  // ── M1+ fields (materializers land per-feature) ──

  /**
   * Block-hash set of revealed paragraphs per scene.  See
   * `redesign-plan.md` § "Event vocabulary additions" for the
   * content-addressed hashing rationale.  Materializer ships in
   * M3a (P2-2).  Player-visible (no DM-only gating); the player
   * Stage filters its rendered DOM by this set.
   */
  revealedParagraphs: Record<string /*scenePath*/, Set<string /*blockHash*/>>;

  /**
   * Per-PC thread-debt rung.  Authoritative shared state for co-DM
   * continuity; render-gated DM-only.  Materializer ships in M3a (P2-5).
   */
  threadDebt: Record<string /*pcId*/, ThreadDebtLevel>;

  /**
   * Ordered list of NPC ids the DM has pinned for quick reference.
   * Shared (co-DM continuity); render-gated DM-only.  Materializer
   * ships in M3a (P2-4).
   */
  pinnedNpcs: string[];

  /**
   * Map blobs per scene.  Shared; DM places, players see only
   * revealed blobs.  Materializer ships in M6 (P5-3).
   */
  mapBlobs: Record<string /*scenePath*/, MapBlob[]>;
  /**
   * Per-scene set of blob ids that are currently revealed to
   * players.  Materializer ships in M6 (P5-3).
   */
  mapBlobReveals: Record<string /*scenePath*/, Set<string /*blobId*/>>;

  /**
   * Most recent broadcast-view event (LWW single slot).  Players
   * navigate to this when it changes.  Materializer ships in M3a (P2-11).
   */
  broadcastView?: { stagePath: string; tab?: string; ts: number };

  /**
   * Peers with hand currently raised (self-only authorship).
   * Player-visible.  Materializer ships in M2 (P1-7).
   */
  raisedHands: Set<PeerId>;

  /**
   * DM scratch notes (chronological).  Authoritative shared
   * (events.jsonl needs them for AI ingestion), render-gated
   * DM-only, AND event-stripped from player save exports.
   * Materializer ships in M3a (P2-3).
   */
  scratchNotes: ScratchNote[];

  /**
   * AI audit chain entries.  Render-gated DM-only, event-stripped
   * from player save exports.  Materializer ships in M3b (P2-7).
   */
  aiAudit: AiAuditEntry[];

  /**
   * Per-PC caster-ladder state.  DM-only (wiped by filterForViewer);
   * stripped from shareable saves via PLAYER_SCOPE_STRIP_KINDS.
   * Authored exclusively via `caster-state-set` events.  Materializer
   * ships in M3c.
   */
  casterState: Record<string /*pcId*/, CasterState>;
  /**
   * Roster-lifecycle slot map.  Maps the campaign-stable slot index
   * (N in `{{pc:N}}`) to a `Seat` record carrying the slot's state +
   * bound PC + controller peer + retire metadata.
   *
   * **Sticky-N invariant** (Phase B' converged design 2026-05-25):
   * once seat N is first bound, N stays sticky to that PC for the
   * life of the campaign — even after retire/archive.  New PCs (for
   * the same player or any other) allocate the NEXT unused integer.
   * This preserves `{{pc:N}}` authoring contracts: scenes written
   * around "{{pc:3}}'s bag" keep resolving to the original PC after
   * retirement (narrative continuity).
   *
   * Substitution: the renderer (substitutePcSlots in markdown.ts)
   * still receives a `Record<number, string>` of slot → display name;
   * quire-app.ts builds that view by looking up each Seat.pcId in
   * synthesizedPcs + character records.  Retired/archived seats
   * still carry pcId, so substitution keeps working.
   *
   * Coord-authored via `pc-slot-bind`, `seat-add`, `pc-retire`,
   * `pc-archive` events.  Player-visible BUT the DM-only fields
   * (retireReason enum, retiredScene) are stripped by
   * filterForViewer; `inFictionRetireReason` (the DM-authored
   * player-safe label) stays player-visible.
   */
  pcSlots: Record<number, Seat>;
  /**
   * P-R11 (2026-05-25): pending player-initiated retire requests.
   * Authored by the bound player via `pc-retire-request`; the DM
   * sees a pip + Accept/Reject pair.  Accept emits the existing
   * `pc-retire` event (with the player's narrative reason); reject
   * emits `pc-retire-reject` with an optional note.
   *
   * Player-visible (the requesting player needs to see their own
   * pending status; reject messages must reach them).  The list
   * is short (typically 0-1 entries); per-PC append-only with the
   * pc-retire and pc-retire-reject materializers responsible for
   * removing settled entries.
   */
  pcRetireRequests: PcRetireRequest[];
  /**
   * P-R11: most recent rejected request per requesting peer.  The
   * player's UI shows a "DM declined: <note>" pip when their last
   * request was rejected.  Cleared by a subsequent successful
   * request.  Player-visible.
   */
  pcRetireRejections: PcRetireRejection[];
  /**
   * #253 (2026-05-26): live-WebRTC pack deliveries pending DM
   * review.  Each entry carries the full ChargenPackDocument the
   * player authored.  Materialized by `chargen-pack-deliver`
   * (player-authored); cleared by `chargen-pack-clear` (coord-
   * authored) when the DM accepts (import + clear) or dismisses
   * (clear without import).
   *
   * Viewer-scope projection:
   *   - DM (coord): sees all entries with full content.
   *   - Sender (the player who packed): sees ONLY their own entry,
   *     and with `pack` stripped to a placeholder so the player
   *     gets a "delivered" pip but the answer text isn't echoed.
   *   - Other peers: stripped entirely (existence is DM-only).
   */
  pendingChargenPacks: ChargenPackDelivery[];
  /**
   * Phase 3b-1: PC records materialized from AI chargen synthesis.
   * Cluster-E `acceptSlot()` emits a `pc-create` event that lands a
   * full `CharacterRecord` here, keyed by the derived pcId.  The
   * loader-overlay (in `quire-app.ts:resolvePcFromOverlay`) consults
   * this map before falling through to the read-only GitHub-raw
   * fetch, so a synthesized PC behaves identically to a
   * campaign-shipped one at every read site (bound-character render,
   * dice-Dock stat chips, display-name resolution).
   *
   * First-write-wins on pcId collision (cheap protection against
   * replay double-creates).  Re-synth produces a fresh pcId so
   * orphan records accumulate harmlessly in this map — orphan
   * cleanup is a Phase 3b+ hygiene concern, not a blocker.
   *
   * Player-visible: synthesized PCs flow through `filterForViewer`
   * untouched because the player MUST see their own PC.  Coord-only
   * authorship via `pc-create` events.
   */
  synthesizedPcs: Record<string /*pcId*/, CharacterRecord>;

  /**
   * Wave B (2026-05-26): append-only log of DM-private Accidental-
   * phase grants (rules.md:178).  Coord-authored via the new
   * `accidental-grant-log` event.  Surfaced ONLY to the DM via
   * `dm-pc-detail`; stripped from the non-coord projection in
   * `filterForViewer` (it carries spoiler material — pre-Realization
   * the player doesn't know they're being silently aided).
   *
   * Render merges `record.accidentalGrants ∪ pcAccidentalGrants[pcId]`
   * so legacy disk-authored grants stay visible alongside session
   * additions.
   */
  pcAccidentalGrants: Record<string /*pcId*/, AccidentalGrant[]>;

  /**
   * Wave B (2026-05-26): append-only list of foci granted to a PC
   * during the session, via the new `focus-grant` event.  Coord-
   * only authorship.  Player-visible at Realization (foci is NOT a
   * DM-only field; players see their own foci once the DM grants
   * them — that's the Realization-beat payoff).
   *
   * Render merges `record.foci ∪ pcFoci[pcId]`.  The TTRPG-firewall
   * gate lives in the UI: `<dm-pc-detail>` only exposes "Grant
   * focus" when magicPhase >= 'realization', so pre-realization
   * accidents can't sneak a focus onto a player's sheet.
   */
  pcFoci: Record<string /*pcId*/, Focus[]>;

  /**
   * D4 (2026-05-26): append-only log of session-digest entries.
   * Each entry is the DM-saved end-of-session recap (AI-drafted,
   * DM-edited).  Player-visible: the recap IS what players read
   * at the start of the next session ("the campfire recap" per
   * TTRPG-expert framing).  Coord-only authorship; the materializer
   * gates on coordHolders.
   *
   * One entry per session-wrap commit.  Ordered chronologically
   * (append-only, no LWW collisions); future "edit prior digest"
   * surface would re-emit a fresh entry rather than mutate the
   * old one (audit trail preserved).
   *
   * Stored as an Array (not keyed by sessionStartTs) because
   * session boundaries are themselves narrative — a campaign that
   * splits a single play-session into multiple digests should
   * land them in order.
   */
  sessionDigests: SessionDigest[];
  /**
   * D2 (2026-05-26): session-open ritual marker entries.  Each
   * entry records WHO began a session and WHEN.  Used to drive the
   * auto-open trigger in QuireApp: when
   * `sessionDigests.length > sessionOpens.length`, there's a
   * pending open ritual to fire.  Player-visible by design (the
   * audit trail is part of the campaign chronology).
   */
  sessionOpens: SessionOpen[];
  /**
   * D1-D (2026-05-26): pending NPC living-doc proposals awaiting
   * DM ratification.  DM-only state — never shipped to player
   * peers (`filterForViewer` wipes for non-coord).  Materialized
   * from the proposal-create / proposal-accept / proposal-reject
   * event triplet (all coord-only, all in PLAYER_SCOPE_STRIP_KINDS).
   *
   * Lifecycle: create appends (dedup by id); accept removes (the
   * resolved value is applied to the WorkingCopy by the host, NOT
   * by the materializer — keeps the materializer pure); reject
   * removes.  Empty by default; populated when DM calls
   * `generateDiffProposals` in the wrap-stepper diff-review pane.
   *
   * Why DM-only-state (not coord-replicated state):
   *   - Players never see proposals (no leak surface for AI prose)
   *   - Co-DMs see proposals via the event log (PLAYER_SCOPE_STRIP_KINDS
   *     keeps players blind; event log itself replicates among coords)
   *   - The git commit of the WorkingCopy is the player-visible
   *     broadcast channel — out-of-band from the session event log
   */
  diffProposals: PendingDiffProposal[];
  /**
   * D5 (2026-05-27): per-PC bonds — ratified entries only.
   * Player-visible at the array level; each entry's `dmNotes`
   * sub-field is DM-only (per-entry stripped by
   * `filterForViewer` for non-coord).  Merged onto
   * `synthesizedPcs[pcId].bonds` at render time.
   *
   * Event lifecycle: `bond-propose` lands a draft in
   * `pcBondProposals[pcId]`; DM `bond-ratify` moves an entry to
   * `pcBonds[pcId]` (with optional DM-side `dmNotes`); coord-only
   * `bond-remove` deletes by index.  Authoring gate (D5-3):
   * proposals accepted only from the seat's controllerPeerId OR
   * coord.
   */
  pcBonds: Record<string /*pcId*/, BondEntry[]>;
  /**
   * D5 (2026-05-27): un-ratified bond drafts awaiting DM ratification.
   * DM-only: in `PLAYER_SCOPE_STRIP_KINDS` (bond-propose) +
   * wiped by `filterForViewer` for non-coord.  Players don't see
   * un-ratified bonds at all — neither their own nor other PCs'.
   */
  pcBondProposals: Record<string /*pcId*/, BondProposal[]>;
  /**
   * D3 (2026-05-26): DM-only progress clocks.  Keyed by clock id
   * (DM-typed slug-shaped string).  Wiped by `filterForViewer`
   * for non-coord viewers.  Event kinds: `dm-clock-create` /
   * `dm-clock-tick` / `dm-clock-delete`, all coord-only and all
   * in PLAYER_SCOPE_STRIP_KINDS.
   *
   * Shared (player-visible) clocks deferred to D3.5; that family
   * will live in a SEPARATE `state.clocks` object with its own
   * `clock-*` event kinds (Adversarial D3-1: avoid the unified
   * `dmOnly: boolean` flag — that's the D-prep-2-A bug class).
   */
  dmClocks: Record<string, DmClock>;
}

/**
 * D3 (2026-05-26): one DM-only progress clock.  Filled count is
 * the sum of `dm-clock-tick.by` deltas, clamped to `[0, size]`
 * at each materialization step for replay determinism.
 */
export interface DmClock {
  id: string;
  name: string;
  /** Total segments (FitD canon, narrowed to {4, 6} for MVP). */
  size: 4 | 6;
  /** Filled segments, in [0, size].  Sum of ticks, clamped on
   *  each event apply. */
  filled: number;
  /** Coord peer that created the clock (audit). */
  createdByPeerId: PeerId;
  /** Epoch-ms creation timestamp. */
  createdAt: number;
  /** Epoch-ms of the most-recent tick (used for "tick last-
   *  modified" UX hooks; falls back to createdAt). */
  lastTickedAt: number;
}

/**
 * D5 (2026-05-27): a ratified per-PC bond, materialized from a
 * `bond-ratify` event.  Mirrors the `Bond` interface in
 * `character-loader.ts` but adds audit fields (who proposed,
 * who ratified, timestamps).  Player-visible at the entry level;
 * `dmNotes` is DM-only and stripped per-entry by
 * `filterForViewer` for non-coord viewers.
 */
export interface BondEntry {
  /** Stable id (DM-typed/uuid; supports remove-by-id). */
  id: string;
  /** Target PC's pcId. */
  targetPcId: string;
  /** Player-visible bond text. */
  text: string;
  /** Optional DM-only spoiler-anchor. */
  dmNotes?: string;
  /** Peer that proposed (audit). */
  proposedByPeerId: PeerId;
  /** Coord peer that ratified (audit). */
  ratifiedByPeerId: PeerId;
  /** Epoch-ms when the ratify landed. */
  ts: number;
}

/**
 * D5 (2026-05-27): a pre-ratification bond draft.  DM-only in
 * shared state.  Same shape as BondEntry minus the ratify audit
 * fields.
 *
 * D5.5-B (2026-05-27): chargen-time bonds may target a PC that
 * doesn't exist yet — the proposal carries `targetPlaceholder`
 * instead of a real `targetPcId`, with `targetPcId === ''`.  The
 * DM resolves the placeholder to a real pcId at ratify time
 * (via the `targetPcId` field on `BondRatifyPayload`).  Either
 * `targetPcId` is a valid CharacterId OR `targetPlaceholder` is
 * a 1-80 char string; the propose materializer rejects both
 * empty + both set.
 */
export interface BondProposal {
  id: string;
  /** Empty when `targetPlaceholder` is the live target. */
  targetPcId: string;
  /** D5.5-B placeholder; mutually exclusive with targetPcId. */
  targetPlaceholder?: string;
  text: string;
  proposedByPeerId: PeerId;
  ts: number;
}

/**
 * D2 (2026-05-26): one session-open ritual marker.  Recorded when
 * the DM clicks "Begin session" in the open-ritual surface.
 * Player-visible per D2-3 (audit trail of WHO opened the session).
 */
export interface SessionOpen {
  /** Coord peer that began the session. */
  openedByPeerId: PeerId;
  /** Epoch-ms when the open landed. */
  ts: number;
}

/**
 * D4 (2026-05-26): one session-recap entry.  AI-drafted, DM-
 * edited, DM-saved.  See `applySessionDigestEvent` materializer.
 */
export interface SessionDigest {
  /** Coord peer that saved the digest. */
  savedByPeerId: PeerId;
  /** Epoch-ms when the digest was saved. */
  ts: number;
  /** Epoch-ms of the session-start the digest covers (input boundary). */
  sessionStartTs: number;
  /** DM-saved markdown body. */
  markdown: string;
  /**
   * AI responseId that drafted the markdown.  Optional — the DM
   * can also hand-write a digest from scratch without invoking
   * the AI broker.
   */
  generatedByResponseId?: string;
}

export function emptyState(): SessionState {
  return {
    peers: {},
    coordHolders: new Set(),
    revealedScenes: [],
    diceRolls: [],
    chat: [],
    pcEdits: {},
    notes: [],
    // M1+ fields — materializers land per-feature; until then, empty.
    revealedParagraphs: {},
    threadDebt: {},
    pinnedNpcs: [],
    mapBlobs: {},
    mapBlobReveals: {},
    raisedHands: new Set(),
    scratchNotes: [],
    aiAudit: [],
    casterState: {},
    pcSlots: {},
    synthesizedPcs: {},
    pcRetireRequests: [],
    pcRetireRejections: [],
    pendingChargenPacks: [],
    pcAccidentalGrants: {},
    pcFoci: {},
    sessionDigests: [],
    sessionOpens: [],
    diffProposals: [],
    dmClocks: {},
    pcBonds: {},
    pcBondProposals: {}
  };
}

/**
 * Render-side filter that strips DM-only fields when the viewing peer
 * is NOT in the coordinator-holders set.  Use this at the boundary
 * between SessionController and UI region components — every region
 * MUST read from a filtered `SessionView`, never from the raw
 * `SessionState`.  Centralizing the gate here prevents per-region
 * regressions where a new field forgets to be gated.
 *
 * The complementary save-export filter (`serializeSessionForViewer`
 * in persistence.ts) handles the EVENT-LEVEL stripping for player
 * save exports; that lands in M3a alongside the first DM-only event.
 *
 * Note: M3a/M3b/M4/M5/M6 materializers populate the DM-only fields.
 * At M1, every DM-only field is empty (no materializers yet), so
 * this filter is effectively a no-op behaviorally — but its contract
 * is locked in now.
 *
 * Visibility classes:
 *   - Always-visible: peers, campaign, coordinator, coordHolders,
 *     revealedScenes, revealedParagraphs, diceRolls, chat, pcEdits,
 *     notes, raisedHands, broadcastView, mapBlobs (filtered),
 *     mapBlobReveals.
 *   - DM-only (stripped for non-coord-holders): threadDebt,
 *     pinnedNpcs, scratchNotes, aiAudit.
 *   - Reveal-mask-gated (DM sees all, players see only revealed):
 *     mapBlobs (filtered through mapBlobReveals).
 */
export function filterForViewer(
  state: SessionState,
  viewerPeerId: PeerId
): SessionState {
  // Key on the CURRENT coordinator, not the historical coordHolders
  // set.  A peer who briefly held coord and yielded should fall back
  // to a player-scoped view immediately — otherwise the rendered UI
  // continues to surface DM-only fields long after the role passed.
  //
  // The materializer still gates AUTHORSHIP on coordHolders (to
  // accept legitimate events from a prior coord in a loaded log),
  // but READS / RENDERS pivot on `state.coordinator` so the visible
  // surface tracks the live role.  This is the accidental-disclosure
  // guard for the yielded-coord scenario in
  // project_quire_threat_model.
  if (state.coordinator === viewerPeerId) {
    return state;
  }
  // Filter mapBlobs by the reveal mask, scene-by-scene.
  const filteredMapBlobs: Record<string, MapBlob[]> = {};
  for (const [scenePath, blobs] of Object.entries(state.mapBlobs)) {
    const reveals = state.mapBlobReveals[scenePath];
    if (reveals && reveals.size > 0) {
      const visible = blobs.filter((b) => reveals.has(b.id));
      if (visible.length > 0) filteredMapBlobs[scenePath] = visible;
    }
    // If no reveals for the scene, players see no blobs.  Skipping
    // the assignment leaves the entry absent (cleaner than an empty
    // array, signals "nothing here" semantically).
  }
  // Phase B P1b: strip DM-only fields from every synthesized PC
  // record before it reaches the player-bound view.  The
  // materialized state holds the full record (the DM authored it);
  // the projection is a defense-in-depth layer between materializer
  // and renderer.  Without this, a player peer's React/Lit render
  // pipeline could pluck `record.knowsTheyCanCast` or
  // `record.accidentalGrants` and leak the magic-discovery arc to
  // the player whose PC is in Accidental phase.
  //
  // Note: characters loaded fresh from disk (character-loader's
  // GitHub fetches) bypass this projection.  Those reads must
  // call `stripDmOnlyFromCharacter` themselves at the render
  // boundary.  See P3/P4 for the render-side enforcement.
  // QA verification (run ac428a0d30ced0e3d) follow-up: a
  // synthesizedPc whose seat is hidden (revealed===false) should
  // be stripped entirely from the player projection.  Without this,
  // a player can read `filteredShared.synthesizedPcs[hiddenPcId]`
  // even though `filteredShared.pcSlots` doesn't reference it —
  // defeating the firewall whenever an attacker peer iterates the
  // record map directly.  Build the set of pcIds whose ONLY seat
  // is hidden, then skip them in the filtered map.
  const hiddenSeatPcIds = new Set<string>();
  for (const seat of Object.values(state.pcSlots)) {
    if (seat.revealed === false && seat.pcId) {
      hiddenSeatPcIds.add(seat.pcId);
    }
  }
  const filteredSynthesizedPcs: Record<string, CharacterRecord> = {};
  for (const [pcId, record] of Object.entries(state.synthesizedPcs)) {
    if (hiddenSeatPcIds.has(pcId)) continue;
    filteredSynthesizedPcs[pcId] = stripDmOnlyFromCharacter(record);
  }
  // Phase B' (2026-05-25): strip DM-only seat metadata.  Player-bound
  // projection sees only the in-fiction reason — never the
  // retireReason enum or the literal scene name.  Per the converged
  // spoiler-firewall design: retired-tile "Retired in §the-gate"
  // tells players a scene name they may not have unlocked AND the
  // reason ("turned by The Quiet") could spoil DM-only plot.
  const filteredPcSlots: Record<number, Seat> = {};
  for (const [slotStr, seat] of Object.entries(state.pcSlots)) {
    const slot = Number(slotStr);
    // #301 (2026-05-26): unrevealed seats are stripped ENTIRELY
    // from the non-coord projection.  The slot integer goes
    // missing — players don't see the gap as "something hidden",
    // they see the seat as not-yet-existing.  Sticky-N tolerates
    // gaps already (retired/archived seats leave their integer
    // bound), so the renderer doesn't need to compact.
    if (seat.revealed === false) continue;
    const out: Seat = { state: seat.state };
    if (seat.pcId !== undefined) out.pcId = seat.pcId;
    if (seat.controllerPeerId !== undefined) {
      out.controllerPeerId = seat.controllerPeerId;
    }
    // Player-safe: in-fiction reason stays.
    if (seat.inFictionRetireReason !== undefined) {
      out.inFictionRetireReason = seat.inFictionRetireReason;
    }
    // #294 (2026-05-26): seat memory is player-safe by construction
    // (DM authors it knowing the UI labels it player-visible).  Flows
    // to player projection so future readers of {{pc:N}} references
    // and the Retired tile see the one-liner.
    if (seat.seatMemory !== undefined) {
      out.seatMemory = seat.seatMemory;
    }
    // The revealed flag itself isn't projected — its only role is
    // gating visibility, and the seat being present in the map IS
    // the player-visible signal.
    // DM-only fields STRIPPED: retireReason, retiredScene, retiredAt.
    filteredPcSlots[slot] = out;
  }
  // Task #295 (2026-05-25): strip DM-only field overlays from
  // `pcEdits` too.  `synthesizedPcs` filtering above only protects
  // the on-disk character record; once a DM types into the soft-
  // notes textarea, the value lands in
  // `state.pcEdits[pcId].dmNotes` and would otherwise be visible
  // to any peer reading raw shared state.  Same field list as
  // `DM_ONLY_CHARACTER_FIELDS` — single source of truth so the two
  // projections can't drift.
  const dmOnlyFieldSet = new Set<string>(DM_ONLY_CHARACTER_FIELDS);
  const filteredPcEdits: Record<string, Record<string, unknown>> = {};
  for (const [pcId, edits] of Object.entries(state.pcEdits)) {
    const safe: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(edits)) {
      // Phase B P3 verification (run ac7a1cdcc81285f0c) follow-up:
      // strip dotted sub-field overlays too.  Without this, edits
      // to `tax.active`, `threadDebt.rung`, `alignmentDrift.marks`
      // (DM-only state via the parent field's DM_ONLY membership)
      // would leak to player viewers since the per-field key
      // doesn't match the set.  Compare the prefix-before-first-dot.
      const topLevel =
        field.indexOf('.') >= 0 ? field.slice(0, field.indexOf('.')) : field;
      if (dmOnlyFieldSet.has(topLevel)) continue;
      safe[field] = value;
    }
    filteredPcEdits[pcId] = safe;
  }
  // QA sanity-check (run af29809d2760df714) SHOULD-FIX-2: project
  // pcRetireRequests + pcRetireRejections so a non-coord viewer
  // sees ONLY their own pending request / rejection.  Other
  // players' in-fiction reasons can carry spoilers ("Mei realizes
  // the Quiet has been speaking through her") — even though no
  // current surface reads other peers' entries, defense-in-depth
  // strips them here so a future surface can't leak them by
  // forgetting the local-peer filter.
  const filteredPcRetireRequests = state.pcRetireRequests.filter(
    (r) => r.requestingPeerId === viewerPeerId
  );
  const filteredPcRetireRejections = state.pcRetireRejections.filter(
    (r) => r.requestingPeerId === viewerPeerId
  );
  // #253: project pendingChargenPacks.  Sender sees ONLY their
  // own entry, content replaced with a placeholder so the
  // "delivered" pip works without the answers echoing back.
  // Other peers see nothing — pack existence is DM-only.
  const filteredPendingChargenPacks: ChargenPackDelivery[] = [];
  for (const entry of state.pendingChargenPacks) {
    if (entry.senderPeerId !== viewerPeerId) continue;
    // Strip the answer text for the sender — they don't need it
    // echoed; only the metadata for the pip.  Pack still parses
    // because the empty answers + empty chosenPath are valid.
    filteredPendingChargenPacks.push({
      senderPeerId: entry.senderPeerId,
      slot: entry.slot,
      ts: entry.ts,
      pack: {
        $schemaVersion: entry.pack.$schemaVersion,
        campaignFingerprint: entry.pack.campaignFingerprint,
        slot: entry.pack.slot,
        chosenPath: '',
        answers: {},
        packedAt: entry.pack.packedAt
      }
    });
  }
  return {
    ...state,
    // DM-only fields wiped:
    threadDebt: {},
    pinnedNpcs: [],
    scratchNotes: [],
    aiAudit: [],
    casterState: {},
    synthesizedPcs: filteredSynthesizedPcs,
    pcSlots: filteredPcSlots,
    pcEdits: filteredPcEdits,
    pcRetireRequests: filteredPcRetireRequests,
    pcRetireRejections: filteredPcRetireRejections,
    pendingChargenPacks: filteredPendingChargenPacks,
    // Wave B (2026-05-26): the DM-private Accidental-phase grant
    // log is wiped from non-coord projections.  Pre-Realization
    // the player doesn't know they're being aided (rules.md:178);
    // post-Realization the DM can choose to narrate callbacks but
    // the grant log itself stays DM-only.
    pcAccidentalGrants: {},
    // D1-D (2026-05-26): pending living-doc diff proposals are
    // DM-only.  Players see updated NPCs only after the DM commits
    // the WorkingCopy back to git (out-of-band channel).
    diffProposals: [],
    // D3 (2026-05-26): DM-only progress clocks.  Hidden threat
    // trackers; players see nothing until D3.5 ships the shared
    // family.
    dmClocks: {},
    // D5 (2026-05-27): un-ratified bond drafts are DM-only.
    // Players don't see other PCs' un-ratified bonds (nor their
    // own — proposals are a DM-private holding area).
    pcBondProposals: {},
    // D5 (2026-05-27): per-PC bonds (ratified) pass through to
    // players AT THE ARRAY LEVEL, but each entry's `dmNotes`
    // sub-field is stripped per-entry (per D5-8; mirrors the
    // D-prep-2-A per-entry strip pattern).
    pcBonds: stripBondDmNotesPerEntry(state.pcBonds, hiddenSeatPcIds),
    // SEC-2 (2026-05-27 post-D5 holistic Adversarial sweep): pcFoci
    // for HIDDEN-seat PCs leaks the hidden seat's existence (the
    // pcId key exists in the projection's pcFoci even though
    // synthesizedPcs is wiped for the same key).  Same shape as
    // the D5-cleanup-2 bond hidden-seat fix.  Foci entries
    // themselves are player-visible by design at Realization
    // onward, but a foci array keyed by a pcId whose seat is
    // hidden is a structural firewall hole.
    pcFoci: stripHiddenSeatKeys(state.pcFoci, hiddenSeatPcIds),
    // Reveal-mask-gated:
    mapBlobs: filteredMapBlobs
  };
}

export function materialize(events: readonly QuireEvent[]): SessionState {
  const state = emptyState();
  for (const event of events) {
    applyEventToState(state, event);
  }
  return state;
}

interface PeerJoinPayload {
  name?: string;
}

interface SceneRevealPayload {
  scenePath: string;
}

interface SceneRevealParagraphPayload {
  v: 1;
  scenePath: string;
  /** 16-hex-char content hash from `blockHash` in markdown.ts. */
  blockHash: string;
  /** Non-authoritative UI hint; materializer ignores its value. */
  paragraphIndex?: number;
}

/**
 * Validate a block-hash payload field.  Must be exactly 16 lowercase
 * hex characters (matching the {@link blockHash} output format —
 * `BLOCK_HASH_LENGTH` in redesign-plan.md).
 */
function isBlockHash(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);
}

/**
 * Per-scene cap on tracked revealed-block hashes — `REVEALED_BLOCKS_PER_SCENE_CAP`
 * in redesign-plan.md.  DoS guard: prevents a hostile coordinator
 * (or replayed compromised log) from growing a Set unboundedly.
 * 256 is well above any realistic scene length; if scenes ever do
 * exceed it, the campaign is structurally over-long.
 */
const REVEALED_BLOCKS_PER_SCENE_CAP = 256;

/**
 * Caps from redesign-plan.md § "New caps to add" — DoS guards for
 * the M3a cockpit materializers.  These match the spec verbatim;
 * see security.md for the threat model.
 */
const PINNED_NPC_CAP = 50;
const SCRATCH_NOTE_CAP = 5000;
const SCRATCH_NOTE_TEXT_CAP = 5000;

/**
 * Per-session cap on aiAudit entries — M3b.3.  Each AI exchange
 * is 2-4 events (prompt + response + optional accept/reject), so
 * 5000 entries allows ~1200 prompts before degradation.  Realistic
 * sessions never approach this; the cap exists to bound a hostile
 * coordinator from spamming the audit chain to grow shared state
 * memory unboundedly.
 */
const AI_AUDIT_CAP = 5000;

/**
 * Validate a hash payload field.  AI prompt / response hashes are
 * sha256-derived first-N hex characters; we accept lengths from 8
 * to 64 to tolerate provider-side variation while still rejecting
 * obvious junk like empty strings or non-hex content.
 */
function isHexHash(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8,64}$/.test(s);
}

interface AiPromptPayload {
  v: 1;
  promptHash: string;
  model: string;
  contextRefs?: string[];
  tokenIn: number;
}

interface AiResponsePayload {
  v: 1;
  responseId: string;
  tokenOut: number;
  hash: string;
  prevHash: string;
}

interface AiVerdictPayload {
  v: 1;
  responseId: string;
  category?: string;
}

interface NpcPinPayload {
  v: 1;
  npcId: string;
}

interface ScratchNotePayload {
  v: 1;
  text: string;
  scenePath?: string;
}

interface ThreadDebtSetPayload {
  v: 1;
  pcId: string;
  /** Empty string clears the entry; otherwise must be a valid level. */
  level: ThreadDebtLevel | '';
}

interface BroadcastViewPayload {
  v: 1;
  stagePath: string;
  tab?: string;
}

const THREAD_DEBT_LEVELS: ReadonlySet<ThreadDebtLevel> = new Set<ThreadDebtLevel>([
  'quiet',
  'noticed',
  'watched',
  'pushing-back',
  'hunted'
]);

function isThreadDebtLevel(s: unknown): s is ThreadDebtLevel {
  return typeof s === 'string' && THREAD_DEBT_LEVELS.has(s as ThreadDebtLevel);
}

/**
 * M3D-5 / CC-2: payload for the `pc-slot-bind` event.  Binds slot
 * `slot` (1-9) to character id `pcId`.  Passing `null` clears the
 * binding (the renderer falls back to the literal `PC<N>` form).
 *
 * Coord-only.  Players see the resulting `state.pcSlots` changes
 * because the substitution must render identically across the table.
 */
interface PcSlotBindPayload {
  v: 1;
  slot: number;
  pcId: string | null;
  /**
   * D5 (2026-05-27): optional explicit controller assignment.
   * When supplied, overrides the default (`event.peerId`, the
   * coord doing the bind).  Enables player-controller binding
   * for the chargen invite-token flow + the D5 bond authoring
   * gate.  Falls back to the prior seat's controllerPeerId
   * (preserved from seat-add) if neither field is present.
   */
  controllerPeerId?: string;
}

/**
 * Phase 3b-1: payload for the `pc-create` event.  Materializes a
 * synthesized PC into `state.synthesizedPcs[pcId]` so the
 * loader-overlay can resolve it without a GitHub-raw fetch.
 *
 * Field naming matches `CharacterRecord` (lowercase stat keys,
 * `skills` not `skillMastery`) so the materializer writes the
 * record directly — translation from the synthesizer's uppercase
 * `PcStats` happens in the controller (`acceptSlot`) before the
 * append.
 *
 * Coord-only authorship; per the threat model, peers receiving an
 * event from a non-coord author drop it silently.
 */
interface PcCreatePayload {
  v: 1;
  pcId: string;
  name: string;
  pronouns: string;
  tags: string[];
  stats: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  };
  skills: string[];
  backstory: string;
  /**
   * Set when the event was authored from an AI-proposed accept
   * (Cluster E acceptSlot).  The DM-direct path doesn't set this
   * (no AI involvement); future audit tooling can trace the chain.
   */
  causedByResponseId?: string;
  /**
   * Wave 3 polish (2026-05-25, TTRPG-R4 fix #3): starting
   * advancements + marks for a late-arriving PC.  When omitted,
   * both default to 0 (the fresh-PC baseline).  Mid-campaign
   * adds use this to seed a catch-up advancement so the new PC
   * isn't mechanically behind the rest of the party.  The full
   * "joining at session N" picker UX lands in P-R12; this field
   * is the engine half so campaigns / future UX can wire it.
   */
  startingAdvancements?: number;
  startingMarks?: number;
  /**
   * Phase B P2 (2026-05-26): optional languages from the AI
   * synthesis.  When omitted, the materializer defaults to
   * `['English']`.  When present, validated against the same
   * per-field caps as `tags` (max 8 entries, each 1-80 chars).
   */
  languages?: string[];
  /**
   * Phase B P2 (2026-05-26): optional money-band enum from
   * the AI synthesis.  When omitted, the materializer defaults
   * to `'tight'` (conservative bias per the TTRPG-craft P2
   * review: under-shoot wealth rather than overshoot).
   */
  moneyBand?: 'broke' | 'tight' | 'comfortable' | 'well-off' | 'wealthy';
}

const PC_CREATE_MAX_NAME = 80;
const PC_CREATE_MAX_PRONOUNS = 40;
const PC_CREATE_MAX_TAGS = 5;
const PC_CREATE_MIN_TAGS = 3;
const PC_CREATE_MAX_TAG_LEN = 80;
const PC_CREATE_MAX_BACKSTORY = 8000;
const PC_CREATE_STAT_MIN = -3;
const PC_CREATE_STAT_MAX = 3;
const PC_CREATE_MAX_SKILLS = 4;
const PC_CREATE_MAX_LANG = 8;
const PC_CREATE_MAX_LANG_LEN = 40;
const PC_CREATE_VALID_MONEY_BANDS = [
  'broke',
  'tight',
  'comfortable',
  'well-off',
  'wealthy'
] as const;
const PC_CREATE_DEFAULT_LANGUAGES: readonly string[] = ['English'];
const PC_CREATE_DEFAULT_MONEY_BAND = 'tight';

/**
 * Phase 3b-1: shared schema-version constant for both
 * `character-loader.ts` (validates campaign-shipped records) and
 * the `pc-create` materializer (stamps synthesized records).  The
 * runtime loader accepts any 0.x.y; synthesized PCs pin to the
 * current version so future schema migrations apply uniformly.
 */
export const CHARACTER_SCHEMA_VERSION = '0.1.0';

function isLowercaseStatNumber(n: unknown): n is number {
  if (typeof n !== 'number') return false;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
  if (n < PC_CREATE_STAT_MIN || n > PC_CREATE_STAT_MAX) return false;
  return true;
}

function isPcCreateStats(value: unknown): value is PcCreatePayload['stats'] {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    if (!isLowercaseStatNumber(s[k])) return false;
  }
  return true;
}

interface CasterStateSetPayload {
  v: 1;
  pcId: string;
  /**
   * `'clear'` is the sentinel for "no ladder pressure" — see the
   * CasterLadderState comment.  Explicit-enum avoids the empty-
   * string-as-sentinel fragility.
   */
  ladderState: CasterLadderState;
  reason?: string;
  taxActive?: boolean;
  spamCount?: number;
  /**
   * Set when the event was synthesized from an AI-proposed
   * stateUpdate (M3c.5 hard-gate enforcement reads this).
   */
  causedByResponseId?: string;
}

const CASTER_LADDER_STATES: ReadonlySet<CasterLadderState> =
  new Set<CasterLadderState>([
    'clear',
    'quiet',
    'noticed',
    'watched',
    'pushing-back',
    'hunted'
  ]);

function isCasterLadderState(s: unknown): s is CasterLadderState {
  return (
    typeof s === 'string' &&
    CASTER_LADDER_STATES.has(s as CasterLadderState)
  );
}

/**
 * Cap on `casterState.spamCount`.  A defensive bound — the runtime
 * never approaches this; the cap protects against a hostile-payload
 * spamCount = Number.MAX_SAFE_INTEGER from corrupting the meter.
 */
const SPAM_COUNT_CAP = 100;

/** Cap on `caster-state-set.reason` length. */
const CASTER_REASON_CAP = 500;

/**
 * M3c.5: scan state.aiAudit for a matching ai-accept entry.  The
 * coord owns both the ai-accept and the AI-proposed state-update
 * events; both come from the same peer's seq counter, so the
 * ai-accept (smaller seq) materializes first.  This scan finds
 * an existing entry in O(audit-depth) which is bounded by
 * AI_AUDIT_CAP.
 */
function hasMatchingAiAccept(
  state: SessionState,
  responseId: string
): boolean {
  for (let i = state.aiAudit.length - 1; i >= 0; i--) {
    const e = state.aiAudit[i];
    if (e.kind === 'accept' && e.responseId === responseId) return true;
  }
  return false;
}

/**
 * M3c.5: append a rejected-hard-gate audit entry.  Visible to the
 * DM in the cockpit banner so silent rejection can't happen.
 */
function recordRejectedHardGate(
  state: SessionState,
  event: { peerId: PeerId; ts: number; kind: string },
  responseId: string,
  reason: string
): void {
  if (state.aiAudit.length >= AI_AUDIT_CAP) return;
  state.aiAudit.push({
    peerId: event.peerId,
    ts: event.ts,
    kind: 'rejected-hard-gate',
    responseId,
    rejectedReason: reason,
    rejectedKind: event.kind
  });
}

/**
 * M3c.5: is the proposed pc-edit hard-gated?  Returns a non-empty
 * reason when yes; empty string otherwise.  Compares the new value
 * to the prior recorded value (event hasn't applied yet).
 */
function pcEditHardGateReason(
  state: SessionState,
  event: { peerId: PeerId },
  pcId: string,
  field: string,
  newValue: unknown
): string {
  // Phase B P1c (2026-05-23): knowsTheyCanCast true-flip is a
  // one-way story gate per rules.md:179 — the Realization beat is
  // an irreversible narrative event.  Per the TTRPG expert R2
  // critique: in the UI, this is a deliberate "Reveal magic"
  // button (not an inline checkbox).  Mirror that intent at the
  // materializer's hard-gate so an AI-proposed flip-to-true also
  // requires explicit DM accept.  Flip-to-false (an accidental
  // un-reveal) is the equally-load-bearing reverse — also gated.
  if (field === 'knowsTheyCanCast' && typeof newValue === 'boolean') {
    // Read the EFFECTIVE current value: pc-edit overlays (most
    // recent LWW value) win over the pc-create synthesizedPcs
    // baseline.  Without this, a DM-direct flip via pc-edit
    // wouldn't be visible to a subsequent AI-proposed flip's
    // hard-gate check.
    const editedValue = state.pcEdits[pcId]?.knowsTheyCanCast;
    const prior =
      typeof editedValue === 'boolean'
        ? editedValue
        : (state.synthesizedPcs[pcId]?.knowsTheyCanCast ?? false);
    if (newValue !== prior) {
      return newValue
        ? 'Realization beat (knowsTheyCanCast → true) is a one-way story gate'
        : 'un-revealing magic (knowsTheyCanCast → false) cannot be silent';
    }
  }
  // Phase B P1c: threadDebt.rung advancing to 'hunted' (rules.md:
  // 132) is fictionally severe — the world is hunting the PC.
  // Mirror the existing caster-state-set hard-gate that already
  // covers ladderState='hunted' (the caster-state-set path); the
  // pc-edit path needs the same gate because the rung lives in
  // the character record now too.
  if (
    field === 'threadDebt.rung' &&
    typeof newValue === 'string' &&
    newValue === 'hunted'
  ) {
    return 'threadDebt.rung → Hunted is a hard escalation';
  }
  if (typeof newValue !== 'number') return '';
  if (field === 'harm') {
    if (newValue >= 3) {
      return `harm box ${Math.min(4, Math.floor(newValue))} is out-of-action`;
    }
  }
  if (field === 'stress') {
    if (newValue >= 4) {
      return 'stress box 4 (Broken)';
    }
  }
  // Cross-PC: the event's coord is editing a PC bound by another
  // active peer.  Same heuristic as AiWriteController.
  for (const p of Object.values(state.peers)) {
    if (p.leftAt !== undefined) continue;
    if (p.peerId === event.peerId) continue;
    if (p.pcId === pcId) {
      return `cross-PC edit on ${pcId}`;
    }
  }
  return '';
}

/**
 * M3c.5: is the proposed caster-state-set hard-gated?
 */
function casterStateHardGateReason(
  state: SessionState,
  pcId: string,
  proposed: {
    ladderState: CasterLadderState;
    taxActive?: boolean;
  }
): string {
  if (proposed.ladderState === 'hunted') {
    return 'ladder advancing to Hunted';
  }
  const prior = state.casterState[pcId];
  const priorTax = prior?.taxActive ?? false;
  if (proposed.taxActive !== undefined && proposed.taxActive !== priorTax) {
    return proposed.taxActive
      ? 'trying-too-hard activating'
      : 'trying-too-hard releasing';
  }
  return '';
}

interface DiceRollPayload {
  expression: string;
  result: number;
  dice: number[];
}

interface ChatPayload {
  text: string;
}

interface PcEditPayload {
  pcId: string;
  field: string;
  value: unknown;
}

interface NotePayload {
  text: string;
  private?: boolean;
}

// Builtin Object property names that, used as a key in pcEdits or
// similar plain-object maps, would pollute the prototype chain or
// shadow built-in methods.  Aligned with EventLog's POISONOUS_KEYS.
const POISONOUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString'
]);

const ID_CAP = 256;
const SCENE_PATH_CAP = 2048;
const CHAT_CAP = 5000;
const NOTE_CAP = 10000;
// Per-pc cap on stored edit fields.  Defends against a hostile peer
// spamming thousands of distinct `field` keys to bloat memory.
const PC_FIELD_COUNT_CAP = 100;
// Match the character-loader's ID_RE so a pcId that would never
// resolve to a real character never enters pcEdits.  Stricter than
// the prior "safe key" check.
const PC_ID_RE = /^[A-Za-z0-9._-]+$/;

function isSafeKey(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= ID_CAP &&
    !POISONOUS_KEYS.has(s)
  );
}

/**
 * N-2 (2026-05-26) defense-in-depth, post-D3 holistic Adversarial
 * sweep: `isSafeKey` rejects WHOLE-STRING poisonous keys but
 * permits dotted forms like `'tax.__proto__'` or `'foo.constructor'`.
 * Today's downstream path is safe (applyCharacterEdits uses a
 * prefix allowlist), but practice memo 6c says "every layer."
 * Mirrors `DM_CLOCK_PROTO_SEGMENTS` (D3) + the diff-format proto
 * check (D1-D).
 */
function hasPoisonousDottedSegment(field: unknown): boolean {
  if (typeof field !== 'string') return false;
  for (const seg of field.split('.')) {
    if (POISONOUS_KEYS.has(seg)) return true;
  }
  return false;
}

function isCharacterId(s: unknown): s is string {
  if (!isSafeKey(s)) return false;
  if (s === '.' || s === '..') return false;
  return PC_ID_RE.test(s);
}

function isBoundedString(s: unknown, cap: number): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= cap;
}

function isPlainObjectPayload(p: unknown): p is Record<string, unknown> {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

/**
 * Set of event kinds the materializer knows how to handle.  Kept in
 * sync with the switch below.  Used by persistence to flag
 * unknown-kind events in a save (forward-compat: still applied to
 * the log so they replicate, but counted so the loader can warn
 * "this save contains events your version doesn't understand").
 */
export const KNOWN_EVENT_KINDS = new Set([
  // v0 kinds (legacy; no payload version field)
  'peer-join',
  'peer-leave',
  'peer-rename',
  'peer-disconnect',
  'coordinator-claim',
  'coordinator-yield',
  'coordinator-reclaim',
  'scene-reveal',
  'scene-unreveal',
  'dice-roll',
  'chat',
  'pc-edit',
  'note',
  // M1 additions (P0-5).  Registered now so saves from intermediate
  // versions of the runtime stay forward-compatible; materializers
  // land per-feature in M3a/M3b/M4/M5/M6.  Every new payload schema
  // carries an explicit `v: 1` field — materializers added later
  // MUST check v and reject unknown versions, surfacing via the H-4
  // unknown-kind banner.  This buys freedom to revise payload shapes
  // through M3a/M3b without breaking saves.  Spec: redesign-plan.md
  // § "Event vocabulary additions" + "Payload versioning."
  'scene-reveal-paragraph',
  'scene-unreveal-paragraph',
  'thread-debt-set',
  'npc-pin',
  'npc-unpin',
  'map-blob-add',
  'map-blob-move',
  'map-blob-remove',
  'map-blob-reveal',
  'map-blob-unreveal',
  'broadcast-view',
  'raise-hand',
  'lower-hand',
  'scratch-note',
  'ai-prompt',
  'ai-response',
  'ai-accept',
  'ai-reject',
  'caster-state-set',
  // M3D-5 / CC-2: PC-slot bindings (the `{{pc:N}}` placeholders in
  // campaign markdown).  Coord-only authorship; player-visible
  // state so the substitution renders identically across the table.
  'pc-slot-bind',
  // Phase 3b-1: materialize a synthesized PC from chargen accept.
  // Coord-only authorship; player-visible (the player MUST see
  // their own PC).  Carries the full CharacterRecord shape; the
  // materializer stores it in `state.synthesizedPcs[pcId]`.
  'pc-create',
  // Phase B' (2026-05-25): roster lifecycle events.  All coord-
  // authored; payload validation in their respective materializers.
  // - `seat-add` allocates an unbound seat at slot N.
  // - `pc-retire` transitions a bound-active seat to bound-retired.
  // - `pc-archive` transitions a bound-active or bound-retired
  //   seat to bound-archived.
  'seat-add',
  // Wave 1 (2026-05-25): seat-remove — DM can drop an unbound seat
  // that was added accidentally.  Bound (active/retired/archived)
  // seats use the retire-flow instead — sticky-N preserves history.
  'seat-remove',
  'pc-retire',
  'pc-archive',
  // P-R7 (2026-05-25): audit-only event for player-rail name-row
  // switcher.  Recorded alongside the state-changing peer-rename so
  // post-session attribution can answer "who controlled which PC
  // when scene X happened" without reconstructing from peer-rename
  // chronology.  No materializer needed — the audit IS the event in
  // the log.  Per TTRPG-R7 verdict, BLOCKING-3a.
  'pc-switch',
  // P-R11 (2026-05-25): player-initiated retire request + DM
  // accept/reject.  Request authored by the bound player; accept
  // routes through the existing `pc-retire` event (coord-authored,
  // pre-filled from the request); reject surfaces a player-visible
  // declined-with-note pip.
  'pc-retire-request',
  'pc-retire-reject',
  // #301 (2026-05-26): flip an unrevealed seat to revealed.  Pairs
  // with the optional `revealed: false` field on `seat-add` to let
  // the DM stage a future-twist PC without the slot appearing in
  // player views until the moment of reveal.
  'seat-reveal',
  // #253 (2026-05-26): live WebRTC chargen pack delivery.  Player
  // sends their packed chargen answers directly via the session
  // instead of file download → physical send → file import.
  // `chargen-pack-deliver` is player-authored; `chargen-pack-clear`
  // is coord-authored (DM accepts after local import, or dismisses).
  'chargen-pack-deliver',
  'chargen-pack-clear',
  // #294 (2026-05-26): edit the player-safe "seat memory" on a
  // retired or archived seat.  Authored by the coord; DM may
  // backfill or revise the one-liner that future readers of
  // `{{pc:N}}` will see at the seat's Retired tile.  Idempotent —
  // re-emitting with the same text is a no-op.
  'seat-memory-edit',
  // Wave B (2026-05-26): magic-arc DM runtime controls.
  // `accidental-grant-log` appends to a PC's DM-private grant log
  // during the Accidental phase (rules.md:178); `focus-grant`
  // appends to a PC's foci list at Realization onward (one-way
  // append; rules.md:139).  Both coord-only.
  'accidental-grant-log',
  'focus-grant',
  // Wave D-prep-2 (2026-05-26): atomic one-way Realization-beat
  // event.  Replaces the Wave B 4-pc-edit batch (TTRPG-expert
  // verifier S2: half-applied state on the one-way gate destroys
  // DM trust on the most-narratively-loaded moment in the
  // campaign).  Applies magicPhase + knowsTheyCanCast + tax in
  // ONE materializer call.  Coord-only.
  'pc-mark-realization',
  // D4 (2026-05-26): session-digest event.  Coord-saves an end-of-
  // session recap (AI-drafted, DM-edited).  Player-visible — the
  // recap IS what players read at the start of the next session.
  // Append-only; each save lands as a fresh entry.
  'session-digest',
  // D2 (2026-05-26): session-open ritual.  Coord emits when the
  // DM clicks "Begin session" after walking through the carryover
  // ritual.  Player-visible (per Adversarial D2-3: "session N
  // started" is fine for players to see; the audit trail captures
  // WHICH coord opened the session).
  'session-open',
  // D3 (2026-05-26): DM-only progress clocks.  All three coord-
  // only AND DM-private (PLAYER_SCOPE_STRIP_KINDS).  Sizes
  // restricted to {4, 6}.  Delta-tick semantics — clamp on each
  // event apply for replay determinism.  Shared (player-visible)
  // clocks deferred to D3.5 (separate `clock-*` family).
  'dm-clock-create',
  'dm-clock-tick',
  'dm-clock-delete',
  // D5 (2026-05-27): per-PC bonds.  Player-authored draft →
  // DM-ratified.  bond-propose is DM-private (proposals are a
  // holding area); bond-ratify is player-visible w/ dmNotes
  // stripped on the wire; bond-remove is coord-only player-
  // visible.  See PendingDiffProposal-shaped lifecycle.
  'bond-propose',
  'bond-ratify',
  'bond-remove',
  // D1-D (2026-05-26): living-doc diff-review proposal lifecycle.
  // All three are coord-only AND DM-private (PLAYER_SCOPE_STRIP_KINDS)
  // — the diff-review is the DM's pre-publication review.  Players
  // see updated NPCs only after the DM commits the WorkingCopy
  // back to the campaign repo (out-of-band — git push).
  // Per Adversarial B-5 simplified MVP: keep proposals entirely
  // DM-private in the event log; the git commit IS the broadcast
  // channel to players, not the event log.
  // Materializer maintains `state.diffProposals` (DM-only state).
  'proposal-create',
  'proposal-accept',
  'proposal-reject'
]);

/**
 * Payload version constant for M1+ event kinds.  Every materializer
 * added in M3a+ for the M1-registered kinds MUST validate
 * `payload.v === EVENT_PAYLOAD_V1` and reject unknown versions.
 * This lets payload schemas evolve through the project without
 * silently corrupting saves from intermediate versions.
 */
export const EVENT_PAYLOAD_V1 = 1;

/**
 * Predicate: does this payload carry the expected M1+ payload version?
 *
 * Returns true iff `payload` is a non-null object whose `v` property
 * strictly equals EVENT_PAYLOAD_V1.  Materializers for the 18 M1-
 * registered event kinds MUST call this before reading payload fields
 * and break (no-op) on false.  Hostile-input tests in
 * `state.hostile.test.ts` pin this contract.
 *
 * The 18 M1 kinds (scene-reveal-paragraph, thread-debt-set,
 * npc-pin, etc.) all use this; the legacy v0 kinds (peer-join,
 * chat, dice-roll, etc.) do NOT — they have their own payload
 * shapes documented above.
 */
export function isPayloadV1(payload: unknown): payload is { v: 1 } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    (payload as { v?: unknown }).v === EVENT_PAYLOAD_V1
  );
}

/**
 * M3C-1 (engine prioritization 2026-05-22): per-kind materializer
 * dispatch.  Replaces the original 32-arm `switch (event.kind)` with
 * a top-level function-per-kind + a registry map.  Each new event
 * kind in M3D/M4 adds one function + one map entry — no growing
 * switch.  Behavior is byte-identical to the original switch (the
 * tests in state.test.ts + state.hostile.test.ts pin every case
 * arm).
 *
 * `EventApplier` is the contract.  Functions mutate `state` in place
 * and return void.  Each function is responsible for its own payload
 * validation; the dispatcher does no type-narrowing.
 */
type EventApplier = (state: SessionState, event: QuireEvent) => void;

function applyPeerJoinEvent(state: SessionState, event: QuireEvent): void {
  const p = event.payload as
    | (PeerJoinPayload & {
        campaign?: { owner?: unknown; repo?: unknown; ref?: unknown };
        knownKindsCount?: unknown;
      })
    | undefined;
  // P0-12: capture the joining peer's KNOWN_EVENT_KINDS count if
  // it announced one.  Bounded sanity check (no negative, no
  // larger than 10x current vocabulary) so a hostile payload
  // can't bloat or confuse the version-mismatch banner.
  let knownKindsCount: number | undefined;
  if (
    typeof p?.knownKindsCount === 'number' &&
    Number.isFinite(p.knownKindsCount) &&
    p.knownKindsCount >= 0 &&
    p.knownKindsCount <= 10000
  ) {
    knownKindsCount = p.knownKindsCount;
  }
  state.peers[event.peerId] = {
    peerId: event.peerId,
    name: p?.name,
    joinedAt: event.ts,
    knownKindsCount
  };
  // R3-C: a host's peer-join may embed the campaign reference
  // so guests who joined via a bare URL (play.quire.games +
  // code, no `?campaign=`) can discover what to load.  First-
  // write-wins: only the earliest peer-join with a campaign
  // sets it; later joiners can't override.
  if (
    !state.campaign &&
    p?.campaign &&
    typeof p.campaign === 'object' &&
    typeof p.campaign.owner === 'string' &&
    typeof p.campaign.repo === 'string' &&
    typeof p.campaign.ref === 'string' &&
    p.campaign.owner.length > 0 &&
    p.campaign.repo.length > 0 &&
    p.campaign.ref.length > 0
  ) {
    state.campaign = {
      owner: p.campaign.owner,
      repo: p.campaign.repo,
      ref: p.campaign.ref
    };
  }
}

function applyPeerLeaveEvent(state: SessionState, event: QuireEvent): void {
  const p = state.peers[event.peerId];
  if (p) p.leftAt = event.ts;
  // M2.8: a leaving peer's hand drops automatically — a stale
  // raised hand after departure would clutter the roster.
  state.raisedHands.delete(event.peerId);
}

function applyPeerDisconnectEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // Coordinator-only: mark another peer as departed when the
  // network detects their connection closing.  Distinct from
  // self-authored 'peer-leave' (which is for clean exits).
  // Without this, closing a browser tab without leaving
  // cleanly leaves the peer permanently in the roster.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as { peerId?: unknown };
  if (typeof p.peerId !== 'string' || p.peerId.length === 0) return;
  const target = state.peers[p.peerId];
  if (target && target.leftAt === undefined) {
    target.leftAt = event.ts;
  }
  // M2.8: drop the disconnected peer's raised hand (same
  // reasoning as peer-leave — a stale hand on a vanished peer
  // is clutter).
  state.raisedHands.delete(p.peerId);
}

function applyPeerRenameEvent(state: SessionState, event: QuireEvent): void {
  // Self-rename only — the event.peerId IS the author (R2.1
  // already enforces this on the wire).  A peer can update
  // their display name, their character status string, and/or
  // their PC binding (M3a.2 P-M3a-pc-binding).
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as {
    name?: unknown;
    character?: unknown;
    pcId?: unknown;
  };
  const presence = state.peers[event.peerId];
  if (!presence) return;
  if (typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 80) {
    presence.name = p.name;
  }
  if (typeof p.character === 'string' && p.character.length <= 80) {
    // Empty string explicitly clears the character.
    presence.character = p.character.length === 0 ? undefined : p.character;
  }
  // M3a.2: pcId follows the same set/clear semantics.  Empty
  // string clears.  Non-string / invalid id is ignored (so a
  // legacy peer that doesn't set pcId doesn't accidentally
  // unbind a previously-bound one — that's an explicit clear,
  // not an omission).
  if (typeof p.pcId === 'string') {
    if (p.pcId.length === 0) {
      presence.pcId = undefined;
    } else if (isCharacterId(p.pcId)) {
      presence.pcId = p.pcId;
    }
    // else: invalid id, silently dropped (defensive).
  }
}

function applyCoordinatorClaimEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // EXPRESSED claim — record the author in coordHolders even if
  // first-wins gates the actual transition.  This matters across
  // session boundaries: when a fresh-host loads a save authored
  // by a prior DM, the prior DM's coord-claim sorts at sum=2
  // tied with the fresh host's; first-wins on alphabetical
  // peerId may or may not let the prior DM "win" — but their
  // scene-reveals must still apply, which requires them to be
  // in coordHolders.  Authority comes from "ever expressed a
  // claim", not from "currently winning the claim race."
  state.coordHolders.add(event.peerId);
  if (!state.coordinator) {
    state.coordinator = event.peerId;
  }
}

function applyCoordinatorYieldEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (state.coordinator === event.peerId) state.coordinator = undefined;
  // coordHolders intentionally NOT cleared — historical
  // authority is preserved for reveal-acceptance.
}

function applyCoordinatorReclaimEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // Unlike coordinator-claim ("first claim wins"), reclaim is
  // unconditional: the issuing peer becomes coordinator.  The
  // R2.1 cross-check in Peer.handleMessage prevents non-DM
  // forgery on the wire; here we trust that the event reached
  // us legitimately.  Synthesizes a system chat entry as the
  // audit trail so every peer sees "who took over from whom."
  //
  // SECURITY (M1 gate finding): the audit-string interpolates
  // peerIds.  Today peerIds are opaque random codes (the
  // pairing-code alphabet) — safe to put in player-visible
  // chat.  If a future commit makes peerIds human-readable
  // (e.g. display-name-prefixed), this synthesizes player-
  // visible PII.  Keep peerIds opaque.
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as { fromPeerId?: unknown };
  const fromPeerId =
    typeof p.fromPeerId === 'string' && p.fromPeerId.length > 0
      ? p.fromPeerId
      : state.coordinator;
  state.coordinator = event.peerId;
  state.coordHolders.add(event.peerId);
  const auditText = fromPeerId
    ? `[system] ${event.peerId} took over as coordinator from ${fromPeerId}`
    : `[system] ${event.peerId} took over as coordinator`;
  state.chat.push({
    peerId: event.peerId,
    ts: event.ts,
    text: auditText
  });
}

function applySceneRevealEvent(state: SessionState, event: QuireEvent): void {
  // Authority check: the author must have been coordinator at
  // SOME point in the event log, not necessarily now.  Without
  // this, loaded reveals from a prior session would be dropped
  // when the new host's coord-claim won the alphabetical
  // peerId tiebreak.  See coordHolders comment in SessionState.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as Partial<SceneRevealPayload>;
  if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) return;
  if (!state.revealedScenes.includes(p.scenePath)) {
    state.revealedScenes.push(p.scenePath);
  }
}

function applySceneUnrevealEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // DM-revoke for an accidental reveal.  Same authority check
  // as reveal.  Removes the scene path from revealedScenes;
  // players who were viewing that scene will be navigated
  // away by the UI layer on their next render.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as Partial<SceneRevealPayload>;
  if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) return;
  const idx = state.revealedScenes.indexOf(p.scenePath);
  if (idx >= 0) state.revealedScenes.splice(idx, 1);
}

function applyDiceRollEvent(state: SessionState, event: QuireEvent): void {
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as Partial<DiceRollPayload>;
  if (!isBoundedString(p.expression, ID_CAP)) return;
  if (typeof p.result !== 'number' || !Number.isFinite(p.result)) return;
  if (!Array.isArray(p.dice)) return;
  // Bound the dice array length and verify entries are numbers.
  if (p.dice.length > 100) return;
  if (!p.dice.every((d) => typeof d === 'number' && Number.isFinite(d))) {
    return;
  }
  state.diceRolls.push({
    peerId: event.peerId,
    ts: event.ts,
    expression: p.expression,
    result: p.result,
    dice: p.dice
  });
}

function applyChatEvent(state: SessionState, event: QuireEvent): void {
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as Partial<ChatPayload>;
  if (!isBoundedString(p.text, CHAT_CAP)) return;
  state.chat.push({
    peerId: event.peerId,
    ts: event.ts,
    text: p.text
  });
}

function applyPcEditEvent(state: SessionState, event: QuireEvent): void {
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as Partial<PcEditPayload> & {
    causedByResponseId?: string;
  };
  if (!isCharacterId(p.pcId)) return;
  if (!isSafeKey(p.field)) return;
  // N-2 (2026-05-26): defense-in-depth — reject dotted-field paths
  // whose segments include POISONOUS_KEYS.  See hasPoisonousDottedSegment.
  if (hasPoisonousDottedSegment(p.field)) return;
  // M3c.5: hard-gate enforcement for AI-proposed pc-edits.
  // When causedByResponseId is set, the event is the result of
  // the AiWriteController's dispatch path.  Hard-gated
  // transitions (harm 3-4, stress 4, cross-PC) require a
  // matching ai-accept already in state.aiAudit (the coord's
  // ai-accept has a smaller seq → materializes first; see
  // design/m3c-ai-write-api.md §Phase 3).  No match → reject
  // and log the refusal.
  if (
    typeof p.causedByResponseId === 'string' &&
    p.causedByResponseId.length > 0
  ) {
    const reason = pcEditHardGateReason(
      state,
      event,
      p.pcId,
      p.field,
      p.value
    );
    if (reason && !hasMatchingAiAccept(state, p.causedByResponseId)) {
      recordRejectedHardGate(state, event, p.causedByResponseId, reason);
      return;
    }
  }
  // value is intentionally unrestricted at this layer — the
  // character-edits helper (applyCharacterEdits) clamps and
  // type-checks on read so an unknown field is silently
  // dropped at render time.  Storing the raw value preserves
  // forward compatibility with future editable fields.
  const pc = state.pcEdits[p.pcId] ?? {};
  // DoS guard: bound the number of distinct fields stored per
  // PC.  Existing fields are still updatable (LWW) once the cap
  // is reached; only new keys get rejected.
  if (
    !Object.prototype.hasOwnProperty.call(pc, p.field) &&
    Object.keys(pc).length >= PC_FIELD_COUNT_CAP
  ) {
    return;
  }
  pc[p.field] = p.value;
  state.pcEdits[p.pcId] = pc;
}

function applyNoteEvent(state: SessionState, event: QuireEvent): void {
  if (!isPlainObjectPayload(event.payload)) return;
  const p = event.payload as Partial<NotePayload>;
  if (!isBoundedString(p.text, NOTE_CAP)) return;
  // private must be a boolean if present (defaults to undefined
  // when omitted, which is fine).  Drops non-boolean values like
  // objects/strings rather than coercing.
  const priv = typeof p.private === 'boolean' ? p.private : undefined;
  state.notes.push({
    peerId: event.peerId,
    ts: event.ts,
    text: p.text,
    private: priv
  });
}

// ---------------------------------------------------------------
// M1-registered kinds (P0-5).  Materializers ship per-feature in
// M3a/M3b/M4/M5/M6 — at M1 they only validate the payload version
// and return.  This makes the v:1 invariant a real contract: any
// future materializer that lands here MUST continue to call
// isPayloadV1 (or its successor for v:2+) and reject mismatched
// versions.  Tests in state.hostile.test.ts pin the rejection
// behavior on synthetic events.
// ---------------------------------------------------------------

function applyRaiseHandEvent(state: SessionState, event: QuireEvent): void {
  // M2.8 (P1-7): the local peer raises their hand.  Self-only
  // authorship — event.peerId IS the author per R2.1 wire-layer
  // cross-check.  No DM gate; any peer can raise their own hand.
  if (!isPayloadV1(event.payload)) return;
  // Defensive: only track raised hands for known peers (a raise
  // before peer-join shouldn't materialize).  This naturally
  // dedupes — Set.add is idempotent.
  if (state.peers[event.peerId]) {
    state.raisedHands.add(event.peerId);
  }
}

function applyLowerHandEvent(state: SessionState, event: QuireEvent): void {
  // Self-only lower of own hand.  Mirrors raise-hand.
  if (!isPayloadV1(event.payload)) return;
  state.raisedHands.delete(event.peerId);
}

function applySceneRevealParagraphEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // Coord-authored per-block reveal.  Block identity is the
  // 16-hex-char content hash (`blockHash` in markdown.ts);
  // see redesign-plan.md § "Event vocabulary additions" for
  // the content-addressing rationale.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<SceneRevealParagraphPayload>;
  if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) return;
  if (!isBlockHash(p.blockHash)) return;
  // paragraphIndex is a UI hint only — accept absence or any
  // finite number, drop pathological values (huge floats, NaN,
  // non-numbers) before they reach the (unused) field.
  if (
    p.paragraphIndex !== undefined &&
    (typeof p.paragraphIndex !== 'number' ||
      !Number.isFinite(p.paragraphIndex))
  ) {
    return;
  }
  let set = state.revealedParagraphs[p.scenePath];
  if (!set) {
    set = new Set<string>();
    state.revealedParagraphs[p.scenePath] = set;
  }
  // Cap enforcement — protect against hostile peers or replayed
  // logs from a compromised session.  Silently drops once the
  // set is full; a sane DM never approaches the cap.
  if (set.size >= REVEALED_BLOCKS_PER_SCENE_CAP && !set.has(p.blockHash)) {
    return;
  }
  set.add(p.blockHash);
}

function applySceneUnrevealParagraphEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // DM-revoke of a per-block reveal.  Symmetric to the reveal
  // path above; deletes from the set and prunes the empty set
  // so the keyed map doesn't grow unboundedly across sessions.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<SceneRevealParagraphPayload>;
  if (!isBoundedString(p.scenePath, SCENE_PATH_CAP)) return;
  if (!isBlockHash(p.blockHash)) return;
  if (
    p.paragraphIndex !== undefined &&
    (typeof p.paragraphIndex !== 'number' ||
      !Number.isFinite(p.paragraphIndex))
  ) {
    return;
  }
  const set = state.revealedParagraphs[p.scenePath];
  if (!set) return;
  set.delete(p.blockHash);
  if (set.size === 0) {
    delete state.revealedParagraphs[p.scenePath];
  }
}

function applyNpcPinEvent(state: SessionState, event: QuireEvent): void {
  // Coord-only DM affordance — pin an NPC id to the dm-aside
  // for quick reference.  Order preserved; the list acts like
  // a manually-curated stack.  Idempotent.  DoS-capped at 50.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<NpcPinPayload>;
  if (!isCharacterId(p.npcId)) return;
  if (state.pinnedNpcs.includes(p.npcId)) return;
  if (state.pinnedNpcs.length >= PINNED_NPC_CAP) return;
  state.pinnedNpcs.push(p.npcId);
}

function applyNpcUnpinEvent(state: SessionState, event: QuireEvent): void {
  // DM-revoke of a pin.  Removes by id; absent-id is a no-op.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<NpcPinPayload>;
  if (!isCharacterId(p.npcId)) return;
  const idx = state.pinnedNpcs.indexOf(p.npcId);
  if (idx >= 0) state.pinnedNpcs.splice(idx, 1);
}

function applyThreadDebtSetEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // Coord-only.  Sets the per-PC rung; level === '' clears
  // the entry (LWW semantics — last DM write wins).
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<ThreadDebtSetPayload>;
  if (!isCharacterId(p.pcId)) return;
  if (p.level === '') {
    delete state.threadDebt[p.pcId];
    return;
  }
  if (!isThreadDebtLevel(p.level)) return;
  state.threadDebt[p.pcId] = p.level;
}

function applyScratchNoteEvent(state: SessionState, event: QuireEvent): void {
  // Coord-only quick-jot.  Append-only chronological log;
  // ingested by the post-session living-document AI.  Capped
  // at SCRATCH_NOTE_CAP entries to bound memory; once full,
  // silently drops new notes (DM is warned via dm-only UI).
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<ScratchNotePayload>;
  if (!isBoundedString(p.text, SCRATCH_NOTE_TEXT_CAP)) return;
  if (
    p.scenePath !== undefined &&
    !isBoundedString(p.scenePath, SCENE_PATH_CAP)
  ) {
    return;
  }
  if (state.scratchNotes.length >= SCRATCH_NOTE_CAP) return;
  state.scratchNotes.push({
    peerId: event.peerId,
    ts: event.ts,
    text: p.text,
    scenePath: p.scenePath
  });
}

function applyBroadcastViewEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // Coord-only LWW single slot.  Players' Stage navigates to
  // {stagePath, tab?} when the field changes.  Older events
  // are ignored — the materializer keeps the newest by ts.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<BroadcastViewPayload>;
  if (!isBoundedString(p.stagePath, SCENE_PATH_CAP)) return;
  if (p.tab !== undefined && !isBoundedString(p.tab, ID_CAP)) return;
  // Clamp event.ts to a plausible wall-clock window.  Without
  // this guard a hostile coord (or a poisoned save file) could
  // emit ts = Number.MAX_SAFE_INTEGER and permanently lock the
  // LWW slot — every subsequent legitimate broadcast would
  // lose the strict-greater comparison forever.  The cap is
  // generous (a year past materialization start) so honest
  // clock skew between peers never trips it.
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  if (event.ts > Date.now() + ONE_YEAR_MS) return;
  // LWW with append-order tie-break: equal-ts events from the
  // same materialization pass replace in log order.  Strict
  // less-than means an older (lower ts) broadcast loses
  // unconditionally; same ts → the later append wins because
  // we never short-circuit when ts equals current.ts.
  const current = state.broadcastView;
  if (current && current.ts > event.ts) return;
  state.broadcastView = {
    stagePath: p.stagePath,
    tab: p.tab,
    ts: event.ts
  };
}

function applyAiPromptEvent(state: SessionState, event: QuireEvent): void {
  // Coord-only AI broker audit entry — prompt half.  Full
  // prompt text lives in IndexedDB keyed by promptHash on the
  // DM's machine; only the chain head + token count replicate
  // via this event.  Render-gated DM-only + stripped from
  // shareable saves.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<AiPromptPayload>;
  if (!isHexHash(p.promptHash)) return;
  if (!isBoundedString(p.model, ID_CAP)) return;
  if (typeof p.tokenIn !== 'number' || !Number.isFinite(p.tokenIn)) return;
  if (p.tokenIn < 0) return;
  if (p.contextRefs !== undefined) {
    if (!Array.isArray(p.contextRefs)) return;
    if (p.contextRefs.length > 50) return;
    if (!p.contextRefs.every((r) => isBoundedString(r, SCENE_PATH_CAP))) {
      return;
    }
  }
  if (state.aiAudit.length >= AI_AUDIT_CAP) return;
  state.aiAudit.push({
    peerId: event.peerId,
    ts: event.ts,
    kind: 'prompt',
    promptHash: p.promptHash,
    tokensIn: p.tokenIn
  });
}

function applyAiResponseEvent(state: SessionState, event: QuireEvent): void {
  // Coord-only AI broker audit entry — response half.
  // Hash-chained against the prior chain head (prevHash); the
  // materializer doesn't enforce chain continuity (that's the
  // broker's job at append time) but stores both hashes so a
  // post-session audit can reconstruct the chain.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<AiResponsePayload>;
  if (!isBoundedString(p.responseId, ID_CAP)) return;
  if (typeof p.tokenOut !== 'number' || !Number.isFinite(p.tokenOut)) return;
  if (p.tokenOut < 0) return;
  if (!isHexHash(p.hash)) return;
  // prevHash may be empty (very first response in a session has
  // no predecessor); accept empty string OR a valid hash.
  if (p.prevHash !== '' && !isHexHash(p.prevHash)) return;
  if (state.aiAudit.length >= AI_AUDIT_CAP) return;
  state.aiAudit.push({
    peerId: event.peerId,
    ts: event.ts,
    kind: 'response',
    responseId: p.responseId,
    responseHash: p.hash,
    prevHash: p.prevHash,
    tokensOut: p.tokenOut
  });
}

function applyAiVerdictEvent(state: SessionState, event: QuireEvent): void {
  // Handles both 'ai-accept' and 'ai-reject'.  Coord-only DM
  // verdict on an AI response.  The verdict is a hint for future
  // tuning — it doesn't change the audit chain's hash continuity.
  // Category is optional + bounded; when absent the audit row
  // still lands.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<AiVerdictPayload>;
  if (!isBoundedString(p.responseId, ID_CAP)) return;
  if (p.category !== undefined && !isBoundedString(p.category, ID_CAP)) {
    return;
  }
  if (state.aiAudit.length >= AI_AUDIT_CAP) return;
  state.aiAudit.push({
    peerId: event.peerId,
    ts: event.ts,
    kind: event.kind === 'ai-accept' ? 'accept' : 'reject',
    responseId: p.responseId,
    category: p.category
  });
}

function applyCasterStateSetEvent(
  state: SessionState,
  event: QuireEvent
): void {
  // Coord-only DM-side caster ladder + tax + spam-counter
  // (underleaf/world/rules.md L125-141 + L179-186).  M3c.1
  // materializer; M3c.5 wires hard-gate enforcement on
  // causedByResponseId for the AI-write path.  Render-gated
  // DM-only via filterForViewer + stripped from shareable saves.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<CasterStateSetPayload>;
  if (!isCharacterId(p.pcId)) return;
  if (!isCasterLadderState(p.ladderState)) return;
  if (
    p.reason !== undefined &&
    !isBoundedString(p.reason, CASTER_REASON_CAP)
  ) {
    return;
  }
  if (p.taxActive !== undefined && typeof p.taxActive !== 'boolean') {
    return;
  }
  if (p.spamCount !== undefined) {
    if (typeof p.spamCount !== 'number') return;
    if (!Number.isFinite(p.spamCount)) return;
    if (!Number.isInteger(p.spamCount)) return;
    if (p.spamCount < 0 || p.spamCount > SPAM_COUNT_CAP) return;
  }
  if (
    p.causedByResponseId !== undefined &&
    !isBoundedString(p.causedByResponseId, ID_CAP)
  ) {
    return;
  }
  // M3c.5: hard-gate enforcement.  Same shape as pc-edit.
  if (
    typeof p.causedByResponseId === 'string' &&
    p.causedByResponseId.length > 0
  ) {
    const reason = casterStateHardGateReason(state, p.pcId, {
      ladderState: p.ladderState,
      taxActive: p.taxActive
    });
    if (reason && !hasMatchingAiAccept(state, p.causedByResponseId)) {
      recordRejectedHardGate(state, event, p.causedByResponseId, reason);
      return;
    }
  }
  const prior = state.casterState[p.pcId];
  const next: CasterState = {
    ladderState: p.ladderState,
    reason: p.reason,
    taxActive:
      p.taxActive !== undefined ? p.taxActive : (prior?.taxActive ?? false),
    spamCount:
      p.spamCount !== undefined ? p.spamCount : (prior?.spamCount ?? 0)
  };
  state.casterState[p.pcId] = next;
}

function applyPcCreateEvent(state: SessionState, event: QuireEvent): void {
  // Phase 3b-1: materialize a synthesized PC into shared state so
  // the loader-overlay (quire-app.ts:resolvePcFromOverlay) can
  // resolve it without a GitHub-raw fetch.  Coord-only authorship;
  // player-visible because the player MUST see their own PC.
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<PcCreatePayload>;

  // ---- pcId ----
  if (!isCharacterId(p.pcId)) return;

  // First-write-wins: a replay or duplicate emission of the same
  // pcId is a no-op.  Re-synth produces a different pcId, so this
  // doesn't block legitimate re-create flows; it just protects
  // against double-applied events on the same id.
  if (Object.prototype.hasOwnProperty.call(state.synthesizedPcs, p.pcId)) {
    return;
  }

  // ---- name / pronouns ----
  if (typeof p.name !== 'string') return;
  if (p.name.length === 0 || p.name.length > PC_CREATE_MAX_NAME) return;
  if (typeof p.pronouns !== 'string') return;
  if (p.pronouns.length > PC_CREATE_MAX_PRONOUNS) return;

  // ---- tags ----
  if (!Array.isArray(p.tags)) return;
  if (p.tags.length < PC_CREATE_MIN_TAGS) return;
  if (p.tags.length > PC_CREATE_MAX_TAGS) return;
  for (const t of p.tags) {
    if (typeof t !== 'string' || t.length === 0) return;
    if (t.length > PC_CREATE_MAX_TAG_LEN) return;
  }

  // ---- stats ----
  if (!isPcCreateStats(p.stats)) return;

  // ---- skills ----
  if (!Array.isArray(p.skills)) return;
  if (p.skills.length > PC_CREATE_MAX_SKILLS) return;
  for (const s of p.skills) {
    if (typeof s !== 'string' || s.length === 0) return;
    if (s.length > PC_CREATE_MAX_TAG_LEN) return;
  }

  // ---- backstory ----
  if (typeof p.backstory !== 'string') return;
  if (p.backstory.length === 0 || p.backstory.length > PC_CREATE_MAX_BACKSTORY) return;

  // ---- causedByResponseId (optional) ----
  if (p.causedByResponseId !== undefined) {
    if (typeof p.causedByResponseId !== 'string') return;
    if (p.causedByResponseId.length > 200) return;
  }
  // ---- startingAdvancements / startingMarks (optional) ----
  // Wave 3 polish: catch-up seed for late-arriving PCs.  Bounded
  // defensively (0..20 for both) so corrupt payloads can't write
  // absurd values.  Defaults to 0 when omitted (fresh-PC baseline).
  let startingAdvancements = 0;
  if (p.startingAdvancements !== undefined) {
    if (
      typeof p.startingAdvancements !== 'number' ||
      !Number.isInteger(p.startingAdvancements) ||
      p.startingAdvancements < 0 ||
      p.startingAdvancements > 20
    ) {
      return;
    }
    startingAdvancements = p.startingAdvancements;
  }
  let startingMarks = 0;
  if (p.startingMarks !== undefined) {
    if (
      typeof p.startingMarks !== 'number' ||
      !Number.isInteger(p.startingMarks) ||
      p.startingMarks < 0 ||
      p.startingMarks > 20
    ) {
      return;
    }
    startingMarks = p.startingMarks;
  }

  // ---- languages (optional, Phase B P2) ----
  // Validated with the same defensive bounds as `tags`.  When the
  // payload omits the field, the record falls back to
  // PC_CREATE_DEFAULT_LANGUAGES (['English'] per the locked
  // campaign-baseline default; campaign-config will override later).
  let languages: string[] = [...PC_CREATE_DEFAULT_LANGUAGES];
  if (p.languages !== undefined) {
    if (!Array.isArray(p.languages)) return;
    if (p.languages.length > PC_CREATE_MAX_LANG) return;
    for (const l of p.languages) {
      if (typeof l !== 'string' || l.length === 0) return;
      if (l.length > PC_CREATE_MAX_LANG_LEN) return;
    }
    languages = [...p.languages];
  }

  // ---- moneyBand (optional, Phase B P2) ----
  // Enum-validated against the locked 5-band ladder.  Defaults to
  // 'tight' when omitted (TTRPG-craft P2 review: bias under-shoot,
  // not overshoot — DM can promote at the gate; demotion is harder
  // to justify in fiction).
  let moneyBand: typeof PC_CREATE_VALID_MONEY_BANDS[number] =
    PC_CREATE_DEFAULT_MONEY_BAND;
  if (p.moneyBand !== undefined) {
    if (typeof p.moneyBand !== 'string') return;
    if (
      !(PC_CREATE_VALID_MONEY_BANDS as readonly string[]).includes(p.moneyBand)
    ) {
      return;
    }
    moneyBand = p.moneyBand;
  }

  // Build the CharacterRecord.  harm/stress/foci default per the
  // rules.md fresh-PC baseline; advancements/marks honor the
  // optional catch-up seed for late-arriving PCs.  foci stay empty
  // — Phase B P2 spoiler-firewall: chargen PCs have `magicPhase:
  // accidental` and no cast actions; foci appear at Realization.
  // Subsequent `pc-edit` events overlay normally via
  // `state.pcEdits[pcId]`.
  const record: CharacterRecord = {
    $schemaVersion: CHARACTER_SCHEMA_VERSION,
    name: p.name,
    pronouns: p.pronouns,
    stats: { ...p.stats },
    skills: [...p.skills],
    tags: [...p.tags],
    backstory: p.backstory,
    harm: 0,
    stress: 0,
    foci: [],
    languages,
    moneyBand,
    advancements: startingAdvancements,
    marks: startingMarks
  };
  state.synthesizedPcs[p.pcId] = record;
}

function applyPcSlotBindEvent(state: SessionState, event: QuireEvent): void {
  // Coord-only binding of a `{{pc:N}}` slot to a character id.
  // Phase B' (2026-05-25): pcSlots is now Record<number, Seat>;
  // bind writes a `bound-active` seat with pcId + optional
  // controllerPeerId.  Slot cap (1..9 in M3D-5) was dropped —
  // sticky-N appends without a fixed ceiling; campaign-config can
  // cap if needed (P-R2 follow-up).
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<PcSlotBindPayload>;
  if (typeof p.slot !== 'number') return;
  if (!Number.isFinite(p.slot)) return;
  if (!Number.isInteger(p.slot)) return;
  // Phase B' floor: slot ≥ 1 (zero / negative would break {{pc:0}}
  // which is reserved sentinel territory; same as the old gate).
  if (p.slot < 1) return;
  // `null` explicitly clears the binding entirely — the seat goes
  // back to fully-unallocated (slot is removed from the map, not
  // marked unbound).  Use seat-add to re-allocate.
  if (p.pcId === null) {
    delete state.pcSlots[p.slot];
    return;
  }
  if (!isCharacterId(p.pcId)) return;
  // Bind writes a fresh bound-active seat OR rebinds an existing
  // unbound seat.  If the slot was already bound (to another PC),
  // we OVERWRITE — sticky-N is enforced at the AUTHOR layer (UI
  // never offers re-bind on bound slots), not the materializer.
  // Materializer stays permissive so corrupt-replay paths are
  // recoverable.
  //
  // QA sanity-check (run af29809d2760df714) follow-up: preserve
  // the `revealed: false` flag across the bind so a seat staged
  // hidden via seat-add(revealed:false) STAYS hidden after a
  // subsequent pc-slot-bind (the canonical NPC→PC promotion
  // sequence + the future "DM stages chargen for a hidden seat"
  // workflow).  Without this, the bind would silently re-reveal
  // and break the firewall.
  const prior = state.pcSlots[p.slot];
  // D5-3: controller resolution — explicit payload override wins;
  // otherwise preserve the prior seat's controllerPeerId (set by
  // seat-add for invite-token flows); otherwise default to the
  // coord doing the bind.
  let controllerPeerId: PeerId = event.peerId;
  if (
    typeof p.controllerPeerId === 'string' &&
    p.controllerPeerId.length > 0
  ) {
    controllerPeerId = p.controllerPeerId;
  } else if (prior?.controllerPeerId) {
    controllerPeerId = prior.controllerPeerId;
  }
  const seat: Seat = {
    state: 'bound-active',
    pcId: p.pcId,
    controllerPeerId
  };
  if (prior?.revealed === false) {
    seat.revealed = false;
  }
  state.pcSlots[p.slot] = seat;
}

/**
 * Phase B' (2026-05-25): seat-add — DM allocates a new seat
 * without yet binding a PC.  The slot enters `unbound` state and
 * waits for the chargen flow to produce a pcId, which then fires
 * pc-slot-bind to promote it to `bound-active`.  Lets the DM
 * pre-allocate a seat for an invite link (slot index gets baked
 * into the token) before the player redeems.
 */
interface SeatAddPayload {
  v: 1;
  slot: number;
  /** Optional: pre-assign the controller peer (e.g., from an invite token). */
  controllerPeerId?: PeerId;
}
function applySeatAddEvent(state: SessionState, event: QuireEvent): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<SeatAddPayload> & {
    revealed?: unknown;
  };
  if (typeof p.slot !== 'number') return;
  if (!Number.isFinite(p.slot)) return;
  if (!Number.isInteger(p.slot)) return;
  if (p.slot < 1) return;
  // Idempotent: re-adding an already-bound seat is a no-op
  // (don't clobber a bound PC with an unbound seat).
  if (state.pcSlots[p.slot] !== undefined) return;
  const seat: Seat = { state: 'unbound' };
  if (typeof p.controllerPeerId === 'string' && p.controllerPeerId.length > 0) {
    seat.controllerPeerId = p.controllerPeerId;
  }
  // #301: explicit revealed=false marks the seat hidden from the
  // player projection.  Omitted / true ⇒ visible (default).
  if (p.revealed === false) {
    seat.revealed = false;
  }
  state.pcSlots[p.slot] = seat;
}

/**
 * #301 (2026-05-26): flip an unrevealed seat to revealed.  Coord-
 * authored.  Idempotent — re-revealing an already-revealed seat is
 * a no-op.  Sticky: once revealed, can't be un-revealed via this
 * event (engine refuses; matches the scene-reveal semantics).
 */
interface SeatRevealPayload {
  v: 1;
  slot: number;
}
function applySeatRevealEvent(state: SessionState, event: QuireEvent): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<SeatRevealPayload>;
  if (typeof p.slot !== 'number') return;
  if (!Number.isFinite(p.slot)) return;
  if (!Number.isInteger(p.slot)) return;
  if (p.slot < 1) return;
  const seat = state.pcSlots[p.slot];
  if (!seat) return;
  if (seat.revealed === false) {
    // Mutate in place — Seat is a plain object reference.  The
    // shared state's identity changes per materialize() pass so
    // subscribers re-render correctly.
    delete seat.revealed;
  }
}

/**
 * #253 (2026-05-26): record a live-WebRTC pack delivery into shared
 * state.  Player-authored — `event.peerId` IS the sender.  Strict
 * shape validation: the pack must already be a well-formed
 * `ChargenPackDocument`-ish payload AND its stringified size must
 * be ≤ CHARGEN_PACK_MAX_SIZE_BYTES (defense-in-depth against a
 * hostile peer building a pack that bypasses the chargen-pack
 * module's per-field caps).  Silent reject on any failure — same
 * shape as other validators.
 *
 * LWW on duplicate `(senderPeerId, slot)`: resend overwrites the
 * prior entry's `pack` + `ts` so the DM always sees the freshest
 * answers.
 */
function applyChargenPackDeliverEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as {
    v?: unknown;
    slot?: unknown;
    pack?: unknown;
  };
  if (typeof p.slot !== 'number') return;
  if (!Number.isFinite(p.slot)) return;
  if (!Number.isInteger(p.slot)) return;
  if (p.slot < 1) return;
  if (!isPlainObjectPayload(p.pack)) return;
  const pack = p.pack as Record<string, unknown>;
  // Stringified-size cap.  Bound the encode at the materializer so
  // a malicious / buggy peer can't balloon state.  Drops silently;
  // sender-side pre-check surfaces "pack too large — use file
  // fallback" before submit.
  let encoded: string;
  try {
    encoded = JSON.stringify(pack);
  } catch {
    return;
  }
  if (encoded.length > CHARGEN_PACK_MAX_SIZE_BYTES) return;
  // Minimal shape gate.  Trust the per-field caps in chargen-pack
  // for the deeper validation; here we just ensure the shape is a
  // ChargenPackDocument so downstream readers don't crash.
  if (typeof pack.$schemaVersion !== 'string') return;
  if (typeof pack.campaignFingerprint !== 'string') return;
  if (typeof pack.slot !== 'number' || pack.slot !== p.slot) return;
  if (typeof pack.chosenPath !== 'string') return;
  // Verification a8af6419725d20f92 NIT: reject arrays-as-objects
  // for the `answers` field so a hostile pack with an array (which
  // is `typeof 'object'`) doesn't slip past.  The chargen-pack
  // module's per-field caps still apply when the importPack flow
  // runs, but defense-in-depth at the materializer prevents
  // shape-confused state from materializing.
  if (
    typeof pack.answers !== 'object' ||
    pack.answers === null ||
    Array.isArray(pack.answers)
  ) {
    return;
  }
  if (typeof pack.packedAt !== 'number') return;
  // LWW: drop any existing entry from the same (sender, slot).
  const filtered = state.pendingChargenPacks.filter(
    (e) => !(e.senderPeerId === event.peerId && e.slot === p.slot)
  );
  filtered.push({
    senderPeerId: event.peerId,
    slot: p.slot,
    pack: pack as unknown as ChargenPackDocument,
    ts: event.ts
  });
  state.pendingChargenPacks = filtered;
}

/**
 * #253 (2026-05-26): clear a pending pack delivery.  Coord-only
 * (DM accepts after local import, or dismisses).  Identifies the
 * target by `(senderPeerId, slot)` — both fields required.
 * Idempotent on no-match.
 */
function applyChargenPackClearEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as {
    v?: unknown;
    senderPeerId?: unknown;
    slot?: unknown;
  };
  if (typeof p.senderPeerId !== 'string') return;
  if (p.senderPeerId.length === 0 || p.senderPeerId.length > 80) return;
  if (typeof p.slot !== 'number') return;
  if (!Number.isFinite(p.slot)) return;
  if (!Number.isInteger(p.slot)) return;
  state.pendingChargenPacks = state.pendingChargenPacks.filter(
    (e) => !(e.senderPeerId === p.senderPeerId && e.slot === p.slot)
  );
}

/**
 * Wave 1 (2026-05-25): seat-remove — DM drops an unbound seat
 * that was added accidentally.  Refuses to touch bound seats of
 * any flavor (active / retired / archived) — those follow the
 * retire-flow so sticky-N references survive.  The slot integer
 * is freed for reuse by a subsequent seat-add.
 */
interface SeatRemovePayload {
  v: 1;
  slot: number;
}
function applySeatRemoveEvent(state: SessionState, event: QuireEvent): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<SeatRemovePayload>;
  if (typeof p.slot !== 'number') return;
  if (!Number.isFinite(p.slot)) return;
  if (!Number.isInteger(p.slot)) return;
  if (p.slot < 1) return;
  const seat = state.pcSlots[p.slot];
  if (!seat) return;
  // Only unbound seats may be removed.  Bound seats (active /
  // retired / archived) require retire-flow so sticky-N keeps
  // resolving across the campaign's narrative history.
  if (seat.state !== 'unbound') return;
  delete state.pcSlots[p.slot];
}

/**
 * Phase B' (2026-05-25): pc-retire — flips a bound-active seat to
 * bound-retired.  Carries the DM-authored player-safe label
 * (`inFictionRetireReason`) + DM-private metadata (retireReason
 * enum, optional retiredScene).  Player projection sees only the
 * in-fiction label.
 *
 * `pc-archive` is the same event with state='bound-archived'
 * (the materializer accepts both; the UI distinguishes which to
 * emit based on the DM's choice).
 */
interface PcRetireOrArchivePayload {
  v: 1;
  pcId: string;
  /** Which terminal state: 'bound-retired' or 'bound-archived'. */
  state: 'bound-retired' | 'bound-archived';
  /** Player-safe in-fiction reason (e.g., "left the story after a hard betrayal"). */
  inFictionReason: string;
  /** DM-private retire reason enum. */
  reason: RetireReason;
  /** DM-private optional scene-id where retirement happened. */
  scene?: string;
  /**
   * #294 (2026-05-26): optional player-safe "seat memory" — a
   * one-line essence the DM authors at retire time.  When omitted,
   * the seat falls back to displaying the `inFictionReason` alone.
   * Editable later via `seat-memory-edit`.  Cap: 200 chars.
   */
  seatMemory?: string;
}
function applyPcRetireOrArchiveEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<PcRetireOrArchivePayload>;
  if (!isCharacterId(p.pcId)) return;
  if (p.state !== 'bound-retired' && p.state !== 'bound-archived') return;
  if (typeof p.inFictionReason !== 'string' || p.inFictionReason.length === 0) {
    return;
  }
  if (p.inFictionReason.length > 200) return;
  if (
    p.reason !== 'died' &&
    p.reason !== 'departed' &&
    p.reason !== 'converted-to-npc' &&
    p.reason !== 'other'
  ) {
    return;
  }
  if (p.scene !== undefined) {
    if (typeof p.scene !== 'string') return;
    if (p.scene.length > 200) return;
  }
  // #294: optional seat memory.  Player-safe one-liner; cap at 200
  // chars (matches inFictionReason / scene caps).  Empty string IS
  // legal (DM may want to clear an older memory); the materializer
  // stores it as-is, and the UI treats empty as "no memory set".
  if (p.seatMemory !== undefined) {
    if (typeof p.seatMemory !== 'string') return;
    if (p.seatMemory.length > 200) return;
  }
  // Find the seat by pcId.  Sticky-N: a PC has at most one seat.
  let targetSlot: number | undefined;
  for (const [slotStr, seat] of Object.entries(state.pcSlots)) {
    if (seat.pcId === p.pcId) {
      targetSlot = Number(slotStr);
      break;
    }
  }
  if (targetSlot === undefined) return;
  const prior = state.pcSlots[targetSlot];
  // Already in the target state → idempotent no-op.
  if (prior.state === p.state) return;
  // Only transition from bound-active OR between bound-retired↔bound-archived.
  // Don't allow re-binding via this event.
  if (
    prior.state !== 'bound-active' &&
    prior.state !== 'bound-retired' &&
    prior.state !== 'bound-archived'
  ) {
    return;
  }
  // Hostile-bundle regression (2026-05-26): preserve the
  // revealed:false flag across the retire so a hidden bound seat
  // stays hidden after retiring.  Mirrors the same preservation
  // logic in pc-slot-bind (#303 follow-up).  Without this,
  // retiring a #301 hidden seat would silently re-reveal it
  // to all players via the projection — defeating the firewall.
  const wasHidden = prior.revealed === false;
  const newSeat: Seat = {
    state: p.state,
    pcId: p.pcId,
    // controllerPeerId is intentionally dropped — retired/archived
    // seats have no active player.
    inFictionRetireReason: p.inFictionReason,
    retireReason: p.reason,
    retiredScene: p.scene,
    retiredAt: event.ts
  };
  if (wasHidden) newSeat.revealed = false;
  // #294: preserve any pre-existing seatMemory across a state flip
  // (bound-retired ↔ bound-archived) so the DM doesn't lose the
  // memory by archiving a retired seat.  When the retire payload
  // explicitly supplies seatMemory, it wins (DM is updating it
  // alongside the state change).
  if (p.seatMemory !== undefined) {
    if (p.seatMemory.length > 0) newSeat.seatMemory = p.seatMemory;
    // Explicit '' clears the memory — honor it.
  } else if (typeof prior.seatMemory === 'string' && prior.seatMemory.length > 0) {
    newSeat.seatMemory = prior.seatMemory;
  }
  state.pcSlots[targetSlot] = newSeat;
  // P-R11: when this retire was driven by a player's pending request,
  // clear the request so it doesn't keep pinging the DM.  Also clear
  // any stale rejection records for the same (peer, pc) pair so the
  // player's UI doesn't show "declined" alongside the accomplished
  // retire.
  state.pcRetireRequests = state.pcRetireRequests.filter(
    (r) => r.pcId !== p.pcId
  );
  state.pcRetireRejections = state.pcRetireRejections.filter(
    (r) => r.pcId !== p.pcId
  );
}

/**
 * #294 (2026-05-26): edit the player-safe "seat memory" on a
 * retired or archived seat.  Coord-only.  Refuses silently when
 * the seat doesn't exist or isn't in a terminal state — the
 * memory is for retired/archived seats only (active seats have
 * the live PC's name + tags doing the work).  Empty string IS
 * legal (the DM may want to clear the memory); the materializer
 * drops the field when empty so the seat reads "no memory set"
 * rather than carrying a literal empty string forever.
 *
 * LWW per event-log order: when two coords edit concurrently, the
 * event appended later (peer/seq tie-break in EventLog) wins.
 * This is the canonical edit path for retired/archived seats —
 * the `pc-retire` materializer's same-state guard bails BEFORE
 * touching seatMemory, so re-emitting pc-retire with a different
 * seatMemory is a no-op (intentional: the retire UI gates the
 * retire button to bound-active seats only, so this only happens
 * in adversarial / corrupted replays).
 */
interface SeatMemoryEditPayload {
  v: 1;
  slot: number;
  /** Player-safe one-liner.  Empty string clears.  ≤ 200 chars. */
  text: string;
}
function applySeatMemoryEditEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<SeatMemoryEditPayload>;
  if (typeof p.slot !== 'number') return;
  if (!Number.isFinite(p.slot) || !Number.isInteger(p.slot)) return;
  if (p.slot < 1) return;
  if (typeof p.text !== 'string') return;
  if (p.text.length > 200) return;
  const seat = state.pcSlots[p.slot];
  if (!seat) return;
  if (
    seat.state !== 'bound-retired' &&
    seat.state !== 'bound-archived'
  ) {
    // Memory only applies to terminal-state seats.  Reject silently
    // for active / unbound — those should use the live PC's edits.
    return;
  }
  if (p.text.length === 0) {
    delete seat.seatMemory;
  } else {
    seat.seatMemory = p.text;
  }
}

/**
 * Wave B (2026-05-26): DM logs a silent Accidental-phase grant.
 * Coord-only.  Append-only — each event records one moment in the
 * arc (a coincidence, a near-miss, a remembered detail per
 * rules.md:178).  Useful for narrative callbacks at Realization
 * and for the post-session recap.  Carries spoiler material
 * (pre-Realization the player doesn't know they're being aided);
 * the grant log is stripped from the non-coord projection.
 *
 * LWW does NOT apply — every event creates a new entry, ordered by
 * event.ts.  Replays preserve order.
 */
interface AccidentalGrantLogPayload {
  v: 1;
  pcId: string;
  /** What the DM granted — short narrative line.  ≤200 chars. */
  note: string;
  /** Scene id where the grant landed, if applicable. */
  sceneId?: string;
}
const ACCIDENTAL_GRANT_NOTE_MAX = 200;
const ACCIDENTAL_GRANT_SCENE_MAX = 200;
function applyAccidentalGrantLogEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<AccidentalGrantLogPayload>;
  if (!isCharacterId(p.pcId)) return;
  if (typeof p.note !== 'string') return;
  if (p.note.length === 0 || p.note.length > ACCIDENTAL_GRANT_NOTE_MAX) {
    return;
  }
  if (p.sceneId !== undefined) {
    if (typeof p.sceneId !== 'string') return;
    if (p.sceneId.length > ACCIDENTAL_GRANT_SCENE_MAX) return;
  }
  const grant: AccidentalGrant = {
    ts: event.ts,
    note: p.note
  };
  if (p.sceneId !== undefined) grant.sceneId = p.sceneId;
  const prior = state.pcAccidentalGrants[p.pcId] ?? [];
  state.pcAccidentalGrants[p.pcId] = [...prior, grant];
}

/**
 * Wave B (2026-05-26): DM grants a focus to a PC.  Coord-only.
 * Append-only — once granted, a focus exists for the PC's life;
 * status changes (active → broken / faded / corrupted / transformed
 * per rules.md:139) flow through a future focus-edit event.  The
 * TTRPG firewall lives in the UI: `<dm-pc-detail>` only exposes
 * "Grant focus" when magicPhase >= 'realization' so a pre-
 * realization accident can't sneak a focus onto a player's sheet.
 *
 * Player-visible: foci are NOT a DM-only field.  Once a focus
 * lands, the player sees it on their rail — that's the
 * Realization-beat payoff.
 *
 * [E] Engine policy DELIBERATELY does NOT enforce the
 * `magicPhase >= 'realization'` gate at the materializer.  Per
 * the locked engine-vs-campaign-policy boundary, a future
 * campaign might want pre-Realization foci for narrative reasons
 * (e.g., heritage focus a PC inherits but doesn't know how to
 * use yet).  The UI is the firewall, and the civilized-peers
 * threat model tolerates UI-only gates.  Do NOT add a phase
 * check here without a campaign-config opt-in.
 */
interface FocusGrantPayload {
  v: 1;
  pcId: string;
  focus: {
    name: string;
    domain?: string;
    condition?: string;
    notes?: string;
    status?: 'active' | 'broken' | 'faded' | 'corrupted' | 'transformed';
    boundFor?: string;
  };
}
const FOCUS_NAME_MAX = 80;
const FOCUS_TEXT_MAX = 200;
const FOCUS_VALID_STATUSES = new Set([
  'active',
  'broken',
  'faded',
  'corrupted',
  'transformed'
]);
function applyFocusGrantEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<FocusGrantPayload>;
  if (!isCharacterId(p.pcId)) return;
  if (!p.focus || typeof p.focus !== 'object') return;
  const f = p.focus as Partial<FocusGrantPayload['focus']>;
  if (typeof f.name !== 'string') return;
  if (f.name.length === 0 || f.name.length > FOCUS_NAME_MAX) return;
  // Optional fields — validate each shape when present.
  if (f.domain !== undefined) {
    if (typeof f.domain !== 'string') return;
    if (f.domain.length > FOCUS_TEXT_MAX) return;
  }
  if (f.condition !== undefined) {
    if (typeof f.condition !== 'string') return;
    if (f.condition.length > FOCUS_TEXT_MAX) return;
  }
  if (f.notes !== undefined) {
    if (typeof f.notes !== 'string') return;
    if (f.notes.length > FOCUS_TEXT_MAX) return;
  }
  if (f.status !== undefined) {
    if (typeof f.status !== 'string') return;
    if (!FOCUS_VALID_STATUSES.has(f.status)) return;
  }
  if (f.boundFor !== undefined) {
    if (typeof f.boundFor !== 'string') return;
    if (f.boundFor.length > FOCUS_TEXT_MAX) return;
  }
  const focus: Focus = { name: f.name };
  if (f.domain !== undefined) focus.domain = f.domain;
  if (f.condition !== undefined) focus.condition = f.condition;
  if (f.notes !== undefined) focus.notes = f.notes;
  if (f.status !== undefined) {
    focus.status = f.status;
  } else {
    // Default to 'active' on grant per rules.md:139 (a focus you
    // hold IS active; status enum is for later state transitions).
    focus.status = 'active';
  }
  if (f.boundFor !== undefined) focus.boundFor = f.boundFor;
  const prior = state.pcFoci[p.pcId] ?? [];
  state.pcFoci[p.pcId] = [...prior, focus];
}

/**
 * Wave D-prep-2 (2026-05-26): atomic Realization-beat event.
 *
 * Replaces the Wave B 4-pc-edit batch (TTRPG expert verifier S2:
 * "real risk, low frequency, high embarrassment when it hits" —
 * half-applied state on the one-way Realization gate destroys DM
 * trust on the most-narratively-loaded moment in the campaign).
 * The 4 field changes (magicPhase → 'realization', knowsTheyCanCast
 * → true, tax.active → true, tax.sessionsRemaining → taxSessions
 * with default 3) apply ATOMICALLY in one materializer call —
 * either all four flip or none does, even if the event log is
 * partially synced.
 *
 * Coord-only.  Idempotent: re-applying on an already-realized PC
 * resets tax.sessionsRemaining to the supplied value (intentional;
 * lets the DM extend the tax via a fresh emit when the campaign
 * calls for it).
 *
 * Payload is DM-only (the event itself reveals the arc-state
 * transition).  Stripped from player autosaves via
 * PLAYER_SCOPE_STRIP_KINDS in `persistence.ts`.
 */
interface PcMarkRealizationPayload {
  v: 1;
  pcId: string;
  /**
   * Default 3 per rules.md:180-184 ("the tax lasts 2-3 sessions").
   * Bounded [1, 20] defensively.
   */
  taxSessions?: number;
}
function applyPcMarkRealizationEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<PcMarkRealizationPayload>;
  if (!isCharacterId(p.pcId)) return;
  let taxSessions = 3;
  if (p.taxSessions !== undefined) {
    if (typeof p.taxSessions !== 'number') return;
    if (!Number.isFinite(p.taxSessions) || !Number.isInteger(p.taxSessions)) {
      return;
    }
    if (p.taxSessions < 1 || p.taxSessions > 20) return;
    taxSessions = p.taxSessions;
  }
  // Atomic 4-field write to state.pcEdits[pcId].  Single materializer
  // call — replay-safe and partial-sync-safe.
  const prior = state.pcEdits[p.pcId] ?? {};
  state.pcEdits[p.pcId] = {
    ...prior,
    magicPhase: 'realization',
    knowsTheyCanCast: true,
    'tax.active': true,
    'tax.sessionsRemaining': taxSessions
  };
}

/**
 * D4 (2026-05-26): record a DM-saved session digest.  Coord-only.
 * Player-visible payload — the digest IS the campfire recap the
 * players read at session-open next time.
 *
 * Validation bounds:
 *   - `markdown`: ≤ SESSION_DIGEST_MAX_MARKDOWN chars (generous
 *     enough for a multi-paragraph recap, bounded so a runaway
 *     AI response can't balloon state).
 *   - `sessionStartTs`: non-negative epoch-ms.
 *   - `generatedByResponseId`: optional; ≤ 200 chars.
 *
 * Append-only: each save lands as a fresh entry, ordered by
 * event.ts.  Replays are deterministic.  Two coords saving
 * concurrently → both digests land (audit trail preserved); the
 * UI surfaces the latest at the top of the list.
 */
const SESSION_DIGEST_MAX_MARKDOWN = 20_000;
const SESSION_DIGEST_RESPONSE_ID_MAX = 200;
interface SessionDigestPayload {
  v: 1;
  sessionStartTs: number;
  markdown: string;
  generatedByResponseId?: string;
}
function applySessionDigestEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<SessionDigestPayload>;
  if (typeof p.sessionStartTs !== 'number') return;
  if (!Number.isFinite(p.sessionStartTs) || p.sessionStartTs < 0) return;
  if (typeof p.markdown !== 'string') return;
  if (p.markdown.length === 0) return;
  if (p.markdown.length > SESSION_DIGEST_MAX_MARKDOWN) return;
  if (p.generatedByResponseId !== undefined) {
    if (typeof p.generatedByResponseId !== 'string') return;
    if (p.generatedByResponseId.length > SESSION_DIGEST_RESPONSE_ID_MAX) {
      return;
    }
  }
  const digest: SessionDigest = {
    savedByPeerId: event.peerId,
    ts: event.ts,
    sessionStartTs: p.sessionStartTs,
    markdown: p.markdown
  };
  if (p.generatedByResponseId !== undefined) {
    digest.generatedByResponseId = p.generatedByResponseId;
  }
  state.sessionDigests = [...state.sessionDigests, digest];
}

/**
 * D2 (2026-05-26): record a coord clicking "Begin session" in the
 * session-open ritual.  Player-visible audit entry — the count of
 * opens drives the auto-open trigger (a fresh open is needed when
 * `sessionDigests.length > sessionOpens.length`).
 *
 * Coord-only.  Payload v: 1 with no other fields (event.peerId +
 * event.ts carry the entire signal).  Append-only.  Replay
 * deterministic.
 *
 * Race semantics (D2-3): two co-DMs clicking Begin produce two
 * `session-open` entries.  Each is its own audit record; the
 * trigger condition is satisfied by the FIRST one.  No dedup —
 * the second is a no-op for the trigger but stays in the log for
 * "co-DM also opened" history.
 */
// -----------------------------------------------------------------
// D3 (2026-05-26): DM-only progress clocks.  See `DmClock`
// interface for shape.  All three kinds are coord-only AND in
// PLAYER_SCOPE_STRIP_KINDS — players see nothing.  Shared
// (player-visible) clocks are reserved for D3.5 under a separate
// state object + separate event-kind family.
//
// Event shapes (all v: 1):
//   - dm-clock-create { id, name, size }
//   - dm-clock-tick   { id, by }       — delta, clamped [0, size]
//   - dm-clock-delete { id }
//
// Validation (Adversarial D3-4):
//   - id matches DM_CLOCK_ID_RE; ≤ 64 chars
//   - id segments don't include __proto__ / constructor / prototype
//   - name 1-200 chars after trim
//   - size in {4, 6}
//   - by integer in [-size, +size]
//   - max DM_CLOCK_MAX_PER_CAMPAIGN clocks per campaign
//   - tick refuses unknown ids (no auto-create per Adversarial D3-4)
// -----------------------------------------------------------------

const DM_CLOCK_ID_RE = /^[A-Za-z0-9._-]+$/;
const DM_CLOCK_ID_MAX = 64;
const DM_CLOCK_NAME_MAX = 200;
const DM_CLOCK_MAX_PER_CAMPAIGN = 64;
const DM_CLOCK_PROTO_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype'
]);

function isValidDmClockId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > DM_CLOCK_ID_MAX) return false;
  if (!DM_CLOCK_ID_RE.test(id)) return false;
  // Defense-in-depth against prototype-pollution (practice memo 6c).
  for (const seg of id.split('.')) {
    if (DM_CLOCK_PROTO_SEGMENTS.has(seg)) return false;
  }
  return true;
}

interface DmClockCreatePayload {
  v: 1;
  id: string;
  name: string;
  size: number;
}

function applyDmClockCreateEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<DmClockCreatePayload>;
  if (!isValidDmClockId(p.id)) return;
  if (typeof p.name !== 'string') return;
  const trimmedName = p.name.trim();
  if (trimmedName.length === 0 || trimmedName.length > DM_CLOCK_NAME_MAX) {
    return;
  }
  if (p.size !== 4 && p.size !== 6) return;
  // DoS guard + duplicate-create no-op.
  if (state.dmClocks[p.id] !== undefined) return;
  if (Object.keys(state.dmClocks).length >= DM_CLOCK_MAX_PER_CAMPAIGN) {
    return;
  }
  state.dmClocks = {
    ...state.dmClocks,
    [p.id]: {
      id: p.id,
      name: trimmedName,
      size: p.size,
      filled: 0,
      createdByPeerId: event.peerId,
      createdAt: event.ts,
      lastTickedAt: event.ts
    }
  };
}

interface DmClockTickPayload {
  v: 1;
  id: string;
  by: number;
}

function applyDmClockTickEvent(state: SessionState, event: QuireEvent): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<DmClockTickPayload>;
  if (!isValidDmClockId(p.id)) return;
  if (typeof p.by !== 'number') return;
  if (!Number.isFinite(p.by) || !Number.isInteger(p.by)) return;
  const clock = state.dmClocks[p.id];
  if (clock === undefined) return; // No auto-create.
  // |by| ≤ size: rejects 1e308, MAX_SAFE_INTEGER, etc.
  if (Math.abs(p.by) > clock.size) return;
  const next = Math.max(0, Math.min(clock.size, clock.filled + p.by));
  if (next === clock.filled) {
    // Still update lastTickedAt — the DM clicked + the audit
    // entry exists, even if clamping makes the value-change a
    // no-op.  Helps "tick last-modified" UX hooks stay sensible.
    state.dmClocks = {
      ...state.dmClocks,
      [p.id]: { ...clock, lastTickedAt: event.ts }
    };
    return;
  }
  state.dmClocks = {
    ...state.dmClocks,
    [p.id]: { ...clock, filled: next, lastTickedAt: event.ts }
  };
}

interface DmClockDeletePayload {
  v: 1;
  id: string;
}

function applyDmClockDeleteEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<DmClockDeletePayload>;
  if (!isValidDmClockId(p.id)) return;
  if (state.dmClocks[p.id] === undefined) return;
  const next = { ...state.dmClocks };
  delete next[p.id];
  state.dmClocks = next;
}

// -----------------------------------------------------------------
// D5 (2026-05-27): per-PC bonds.  See `BondEntry` + `BondProposal`
// for shape.  Event triplet:
//   - bond-propose: player or coord drafts (DM-private)
//   - bond-ratify: coord-only; moves proposal → pcBonds (player-
//     visible, dmNotes per-entry stripped on the wire)
//   - bond-remove: coord-only; deletes by id
//
// Authoring gate (D5-3): bond-propose is accepted only when:
//   (a) the peerId controls the seat whose pcId matches the
//       proposal's pcId (`seat.controllerPeerId === event.peerId`),
//   OR
//   (b) the peerId is in coordHolders.
// This is the FIRST event kind to use the seat-binding gate
// (pc-edit remains universal-write per the Q-LT1 trust gap).
// -----------------------------------------------------------------

const BOND_ID_MAX = 64;
/**
 * Exported so the chargen-pack draft validator + a cross-module
 * guard test can assert their caps match (the two modules can't
 * share one definition without coupling the player-device pack
 * module to the engine core).  See `bond-cap-parity.test.ts`.
 */
export const BOND_TEXT_MAX = 500;
const BOND_DM_NOTES_MAX = 2000;
export const BOND_MAX_PER_PC = 8;
/**
 * D5.5-B (2026-05-27): cap on the free-text placeholder used when a
 * chargen-time bond targets a PC that doesn't exist yet (parallel
 * chargen) or lives only in the player's mental model.  DM resolves
 * to a real `targetPcId` at ratify.  80 chars matches the
 * ChargenPack-side cap (`MAX_BOND_TARGET_LEN`).
 */
export const BOND_TARGET_PLACEHOLDER_MAX = 80;
const BOND_ID_RE = /^[A-Za-z0-9._-]+$/;

function isValidBondId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > BOND_ID_MAX) return false;
  if (!BOND_ID_RE.test(id)) return false;
  // D5-C-fix #7 (2026-05-27): reuse the canonical
  // `hasPoisonousDottedSegment` helper (covers __proto__ +
  // constructor + prototype + toString + hasOwnProperty + …) per
  // practice memo 6c "every layer."  Previously this used a
  // narrow 3-key set; the canonical set is broader.
  if (hasPoisonousDottedSegment(id)) return false;
  return true;
}

/**
 * D5-3 (Adversarial BLOCKER): authoring gate for bond-propose.
 * Returns true if the event's peer is allowed to author a bond
 * for the given pcId — either as the seat's controller or as
 * coord.  Mirrors the seat-binding logic that materializers like
 * `applyPcRetireRequestEvent` use.
 */
function isBondAuthorAllowed(
  state: SessionState,
  event: QuireEvent,
  pcId: string
): boolean {
  if (state.coordHolders.has(event.peerId)) return true;
  for (const seat of Object.values(state.pcSlots)) {
    if (seat.pcId === pcId && seat.controllerPeerId === event.peerId) {
      return true;
    }
  }
  return false;
}

/**
 * D5-8 helper: per-entry `dmNotes` strip for `pcBonds`.  Applied
 * by `filterForViewer` when projecting to a non-coord viewer.
 * Mirrors the focus-grant payload-field strip pattern but at the
 * record-level (an array of bond entries).
 */
/**
 * SEC-2 helper: strip entries whose key is a hidden-seat pcId
 * from a `Record<pcId, T>`-shaped projection.  Same shape as the
 * pc-by-pcId firewall pattern in filterForViewer (e.g.
 * synthesizedPcs map gets entries deleted for hidden-seat pcIds).
 *
 * Generic so callers can use it for pcFoci, future per-pc maps,
 * etc.  Empty-set passthrough is identity (cheap).
 */
function stripHiddenSeatKeys<T>(
  byPcId: Record<string, T>,
  hiddenSeatPcIds: ReadonlySet<string>
): Record<string, T> {
  if (hiddenSeatPcIds.size === 0) return byPcId;
  const out: Record<string, T> = {};
  for (const [pcId, value] of Object.entries(byPcId)) {
    if (hiddenSeatPcIds.has(pcId)) continue;
    out[pcId] = value;
  }
  return out;
}

function stripBondDmNotesPerEntry(
  pcBonds: Record<string, BondEntry[]>,
  hiddenSeatPcIds: ReadonlySet<string> = new Set()
): Record<string, BondEntry[]> {
  const out: Record<string, BondEntry[]> = {};
  for (const [pcId, bonds] of Object.entries(pcBonds)) {
    // D5-cleanup-2 BLOCKER (2026-05-27 scenario-sweep Adv-B):
    // hidden-seat source bonds must not pass through to non-coord
    // viewers.  Pre-fix, a DM-authored bond from hidden-seat PC
    // `mystery` targeting `iris` leaked "(unknown PC) → me · <text>"
    // to iris's player via cross-side inbound rendering — both the
    // existence of the hidden PC AND the bond text.
    if (hiddenSeatPcIds.has(pcId)) continue;
    const safeBonds: BondEntry[] = [];
    for (const b of bonds) {
      // Also filter inbound bonds whose TARGET is a hidden PC:
      // even if source is visible, leaking "<source> → <hidden>"
      // is a spoiler about the hidden PC.
      if (hiddenSeatPcIds.has(b.targetPcId)) continue;
      if (b.dmNotes === undefined) {
        safeBonds.push(b);
      } else {
        const { dmNotes: _omit, ...rest } = b;
        void _omit;
        safeBonds.push(rest as BondEntry);
      }
    }
    out[pcId] = safeBonds;
  }
  return out;
}

interface BondProposePayload {
  v: 1;
  id: string;
  pcId: string;
  /**
   * Real target PC's id.  Empty (or absent) when the proposal is
   * a D5.5-B chargen placeholder — `targetPlaceholder` carries the
   * free-text target instead.
   */
  targetPcId: string;
  /**
   * D5.5-B: free-text placeholder for a target PC that doesn't
   * exist yet.  Mutually exclusive with a real targetPcId.
   */
  targetPlaceholder?: string;
  text: string;
}

function applyBondProposeEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<BondProposePayload>;
  if (!isValidBondId(p.id)) return;
  if (!isCharacterId(p.pcId)) return;
  // D5.5-B: target is EITHER a real pcId OR a free-text
  // placeholder, never both, never neither.  Determine the mode
  // up front so the downstream validation branches cleanly.
  const hasRealTarget = isCharacterId(p.targetPcId);
  const placeholderRaw =
    typeof p.targetPlaceholder === 'string' ? p.targetPlaceholder.trim() : '';
  const hasPlaceholder = placeholderRaw.length > 0;
  if (hasRealTarget === hasPlaceholder) return; // both or neither → reject
  if (hasPlaceholder && placeholderRaw.length > BOND_TARGET_PLACEHOLDER_MAX) {
    return;
  }
  // D5: self-bonds are nonsense; reject (only meaningful for the
  // real-target path — a placeholder can't collide with pcId).
  if (hasRealTarget && p.pcId === p.targetPcId) return;
  if (typeof p.text !== 'string') return;
  const trimmedText = p.text.trim();
  if (trimmedText.length === 0 || trimmedText.length > BOND_TEXT_MAX) return;
  // D5-3 authoring gate.
  if (!isBondAuthorAllowed(state, event, p.pcId)) return;
  // DoS guard + duplicate-create no-op.
  const proposals = state.pcBondProposals[p.pcId] ?? [];
  const ratified = state.pcBonds[p.pcId] ?? [];
  // D5-cleanup-2 (2026-05-27 scenario Adv-C harden): dup-id check
  // now covers BOTH pcBondProposals AND pcBonds — a re-emitted
  // proposal whose id collides with an already-ratified bond is
  // silently rejected (was previously only checked against
  // proposals).  40-bit entropy makes collision non-exploitable
  // in practice; this closes the loop for defense-in-depth.
  if (proposals.some((q) => q.id === p.id)) return;
  if (ratified.some((q) => q.id === p.id)) return;
  // Cap counts proposals + ratified together; the proposal-then-
  // ratify path is the same logical entry.
  if (proposals.length + ratified.length >= BOND_MAX_PER_PC) return;
  // D5-C-fix #7 (2026-05-27 scenario Adv-MFN-2): replace the
  // dead whole-string POISONOUS_KEYS check (already caught by
  // `isCharacterId` above) with a defense-in-depth dotted-
  // segment check on both pcId AND targetPcId.  PC_ID_RE accepts
  // dots; while neither is used as an object key TODAY, practice
  // memo 6c says "every layer."
  if (hasPoisonousDottedSegment(p.pcId)) return;
  if (hasRealTarget && hasPoisonousDottedSegment(p.targetPcId)) return;
  const newProposal: BondProposal = {
    id: p.id,
    targetPcId: hasRealTarget ? (p.targetPcId as string) : '',
    text: trimmedText,
    proposedByPeerId: event.peerId,
    ts: event.ts
  };
  if (hasPlaceholder) newProposal.targetPlaceholder = placeholderRaw;
  state.pcBondProposals = {
    ...state.pcBondProposals,
    [p.pcId]: [
      ...proposals,
      newProposal
    ]
  };
}

interface BondRatifyPayload {
  v: 1;
  id: string;
  pcId: string;
  /** Optional DM-typed text override; if absent, use proposal text. */
  text?: string;
  /** Optional DM-only spoiler-anchor. */
  dmNotes?: string;
  /**
   * D5.5-B: DM-supplied real target pcId.  REQUIRED when the
   * proposal is a placeholder (proposal.targetPcId === '') — the
   * DM resolves "the medic" → an actual pcId at ratify.  Optional
   * override when the proposal already had a real target (lets the
   * DM redirect a bond).  A ratify that leaves a placeholder
   * unresolved is rejected (the bond can't enter pcBonds without
   * a valid target).
   */
  targetPcId?: string;
}

function applyBondRatifyEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<BondRatifyPayload>;
  if (!isValidBondId(p.id)) return;
  if (!isCharacterId(p.pcId)) return;
  const proposals = state.pcBondProposals[p.pcId] ?? [];
  const proposal = proposals.find((q) => q.id === p.id);
  if (!proposal) return; // No matching draft to ratify.
  if (p.text !== undefined && typeof p.text !== 'string') return;
  if (p.dmNotes !== undefined) {
    if (typeof p.dmNotes !== 'string') return;
    if (p.dmNotes.length > BOND_DM_NOTES_MAX) return;
  }
  // D5.5-B: resolve the effective target.  Ratify's targetPcId
  // override wins when present; otherwise fall back to the
  // proposal's (which is empty for an unresolved placeholder).
  // The ratified bond MUST carry a real pcId — a placeholder that
  // the DM never resolved is rejected here rather than entering
  // pcBonds with an empty target (which would render as a
  // dangling "(unknown PC)" in the bonds card).
  let effectiveTargetPcId = proposal.targetPcId;
  if (p.targetPcId !== undefined) {
    if (!isCharacterId(p.targetPcId)) return;
    if (hasPoisonousDottedSegment(p.targetPcId)) return;
    effectiveTargetPcId = p.targetPcId;
  }
  if (!isCharacterId(effectiveTargetPcId)) return; // unresolved placeholder
  if (effectiveTargetPcId === p.pcId) return; // self-bond after resolve
  const ratifiedText =
    p.text !== undefined ? p.text.trim() : proposal.text;
  if (ratifiedText.length === 0 || ratifiedText.length > BOND_TEXT_MAX) return;
  // Move from proposals → bonds.
  const newProposals = proposals.filter((q) => q.id !== p.id);
  state.pcBondProposals = {
    ...state.pcBondProposals,
    [p.pcId]: newProposals
  };
  const entry: BondEntry = {
    id: proposal.id,
    targetPcId: effectiveTargetPcId,
    text: ratifiedText,
    proposedByPeerId: proposal.proposedByPeerId,
    ratifiedByPeerId: event.peerId,
    ts: event.ts
  };
  if (p.dmNotes !== undefined && p.dmNotes.length > 0) {
    entry.dmNotes = p.dmNotes;
  }
  const existing = state.pcBonds[p.pcId] ?? [];
  state.pcBonds = {
    ...state.pcBonds,
    [p.pcId]: [...existing, entry]
  };
}

interface BondRemovePayload {
  v: 1;
  id: string;
  pcId: string;
}

function applyBondRemoveEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<BondRemovePayload>;
  if (!isValidBondId(p.id)) return;
  if (!isCharacterId(p.pcId)) return;
  // Remove from both proposals AND ratified bonds, idempotently.
  const proposals = state.pcBondProposals[p.pcId] ?? [];
  const bonds = state.pcBonds[p.pcId] ?? [];
  const nextProposals = proposals.filter((q) => q.id !== p.id);
  const nextBonds = bonds.filter((q) => q.id !== p.id);
  if (
    nextProposals.length === proposals.length &&
    nextBonds.length === bonds.length
  ) {
    return; // No-op.
  }
  state.pcBondProposals = {
    ...state.pcBondProposals,
    [p.pcId]: nextProposals
  };
  state.pcBonds = { ...state.pcBonds, [p.pcId]: nextBonds };
}

function applySessionOpenEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  // No other fields to validate — payload is just `v: 1`.  The
  // isPayloadV1 gate above is sufficient.
  state.sessionOpens = [
    ...state.sessionOpens,
    { openedByPeerId: event.peerId, ts: event.ts }
  ];
}

// -----------------------------------------------------------------
// D1-D (2026-05-26): living-doc diff-review proposal lifecycle.
// All three events are coord-only AND DM-private; the materializer
// is the SOLE source-of-truth for `state.diffProposals`.
//
// Per-event responsibilities:
//   - proposal-create: validate + append (id-based dedup; second
//     create with the same id replaces — supports AI regenerate
//     before any accept)
//   - proposal-accept: remove by id (the actual file write happens
//     in the HOST via applyProposalToWorkingCopy; the materializer
//     only manages the pending-queue state)
//   - proposal-reject: remove by id
//
// Engineering choice: keep the materializer pure (no IO, no WC).
// The host owns the wc.write side-effect on accept; if the host
// fails to apply, the proposal still leaves the pending queue
// (per Adversarial B-4 idempotency — both accept events on the
// same id are equivalent no-ops).
// -----------------------------------------------------------------

const PROPOSAL_ID_MAX = 200;
const PROPOSAL_FIELD_MAX = 200;
const PROPOSAL_NPCID_MAX = 200;
const PROPOSAL_RATIONALE_MAX = 2000;
const PROPOSAL_AFTER_JSON_MAX = 20_000;
const PROPOSAL_PATH_MAX = 4096;
const PROPOSAL_SOURCE_EVENT_IDS_MAX = 32;
const PROPOSAL_ID_RE = /^[A-Za-z0-9._\-:]+$/;
const PROPOSAL_FIELD_RE = /^[A-Za-z0-9._\-]+$/;
const PROPOSAL_NPCID_RE = /^[A-Za-z0-9._\-]+$/;

/**
 * D1-D verifier-found BLOCKER (2026-05-26): explicit denylist on
 * proposal field segments to block prototype-pollution via AI-
 * controlled `field` strings.  Mirrors the denylist in
 * `src/living/diff-format.ts`; duplicated here to keep core/state.ts
 * self-contained (no dep on the living/ tree).
 */
const PROPOSAL_PROTO_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype'
]);

/**
 * Materialized view of a DiffProposal in shared state.  Subset of
 * the `DiffProposal` shape from `src/living/diff-format.ts` —
 * imports avoided to keep `core/state.ts` engine-pure.  The fields
 * are intentionally the same NAMES so the host can spread between
 * the two without re-mapping.
 */
export interface PendingDiffProposal {
  id: string;
  kind: 'npc-update';
  npcId: string;
  path: string;
  field: string;
  before: unknown;
  after: unknown;
  rationale: string;
  sourceEventIds?: string[];
  baseSha?: string;
  /** Coord that emitted the proposal-create event (audit trail). */
  proposedByPeerId: PeerId;
  /** Epoch-ms the proposal landed. */
  ts: number;
}

interface ProposalCreatePayload {
  v: 1;
  id: string;
  kind: 'npc-update';
  npcId: string;
  path: string;
  field: string;
  before: unknown;
  after: unknown;
  rationale: string;
  sourceEventIds?: string[];
  baseSha?: string;
}

function applyProposalCreateEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<ProposalCreatePayload>;
  if (typeof p.id !== 'string' || !PROPOSAL_ID_RE.test(p.id)) return;
  if (p.id.length > PROPOSAL_ID_MAX) return;
  if (p.kind !== 'npc-update') return;
  if (typeof p.npcId !== 'string' || !PROPOSAL_NPCID_RE.test(p.npcId)) return;
  if (p.npcId.length > PROPOSAL_NPCID_MAX) return;
  if (typeof p.path !== 'string' || p.path.length === 0) return;
  if (p.path.length > PROPOSAL_PATH_MAX) return;
  if (p.path.startsWith('/') || p.path.includes('..')) return;
  if (typeof p.field !== 'string' || !PROPOSAL_FIELD_RE.test(p.field)) return;
  if (p.field.length > PROPOSAL_FIELD_MAX) return;
  for (const seg of p.field.split('.')) {
    if (PROPOSAL_PROTO_SEGMENTS.has(seg)) return;
  }
  if (typeof p.rationale !== 'string') return;
  if (p.rationale.length > PROPOSAL_RATIONALE_MAX) return;
  let afterJson: string;
  try {
    afterJson = JSON.stringify(p.after) ?? '';
  } catch {
    return;
  }
  if (afterJson.length > PROPOSAL_AFTER_JSON_MAX) return;
  if (p.sourceEventIds !== undefined) {
    if (!Array.isArray(p.sourceEventIds)) return;
    if (p.sourceEventIds.length > PROPOSAL_SOURCE_EVENT_IDS_MAX) return;
    for (const id of p.sourceEventIds) {
      if (typeof id !== 'string' || id.length > PROPOSAL_ID_MAX) return;
    }
  }
  if (p.baseSha !== undefined) {
    if (typeof p.baseSha !== 'string' || p.baseSha.length > 200) return;
  }
  const proposal: PendingDiffProposal = {
    id: p.id,
    kind: 'npc-update',
    npcId: p.npcId,
    path: p.path,
    field: p.field,
    before: p.before,
    after: p.after,
    rationale: p.rationale,
    proposedByPeerId: event.peerId,
    ts: event.ts
  };
  if (p.sourceEventIds !== undefined) proposal.sourceEventIds = [...p.sourceEventIds];
  if (p.baseSha !== undefined) proposal.baseSha = p.baseSha;
  // Id-based replacement: a re-create with the same id REPLACES
  // the prior entry.  Supports the AI-regenerate-before-accept
  // flow without leaving duplicate proposals in the queue.
  state.diffProposals = [
    ...state.diffProposals.filter((q) => q.id !== p.id),
    proposal
  ];
}

interface ProposalAcceptPayload {
  v: 1;
  id: string;
  /**
   * Snapshot of the resolved `after` at accept-time, in case the
   * DM edited the proposal before clicking Accept.  Stored in the
   * audit trail (event log) but NOT re-applied by the materializer
   * — the host already wrote it to the WorkingCopy.
   */
  resolvedAfter?: unknown;
}

function applyProposalAcceptEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<ProposalAcceptPayload>;
  if (typeof p.id !== 'string' || !PROPOSAL_ID_RE.test(p.id)) return;
  if (p.id.length > PROPOSAL_ID_MAX) return;
  // Idempotent: removing an already-removed id is a no-op (Adversarial B-4).
  state.diffProposals = state.diffProposals.filter((q) => q.id !== p.id);
}

interface ProposalRejectPayload {
  v: 1;
  id: string;
  /** Optional DM-typed reason — audit only.  Not surfaced anywhere
   *  for MVP; reserved for future "rejection patterns" telemetry. */
  reason?: string;
}

function applyProposalRejectEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as Partial<ProposalRejectPayload>;
  if (typeof p.id !== 'string' || !PROPOSAL_ID_RE.test(p.id)) return;
  if (p.id.length > PROPOSAL_ID_MAX) return;
  if (p.reason !== undefined && typeof p.reason !== 'string') return;
  if (p.reason !== undefined && p.reason.length > 1000) return;
  state.diffProposals = state.diffProposals.filter((q) => q.id !== p.id);
}

/**
 * P-R11 (2026-05-25): record a player's request to retire their own
 * PC.  Player-authored — the event.peerId IS the requesting peer.
 * Validates the seat is bound-active and that the peer actually
 * controls it (no one else can request retire on someone else's PC).
 * Duplicate requests for the same (peer, pc) replace the prior
 * entry's timestamp so the DM sees the freshest request.
 */
function applyPcRetireRequestEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as {
    v?: unknown;
    pcId?: unknown;
    inFictionReason?: unknown;
    reason?: unknown;
  };
  if (!isCharacterId(p.pcId)) return;
  if (
    typeof p.inFictionReason !== 'string' ||
    p.inFictionReason.length === 0 ||
    p.inFictionReason.length > 200
  ) {
    return;
  }
  if (
    p.reason !== 'died' &&
    p.reason !== 'departed' &&
    p.reason !== 'converted-to-npc' &&
    p.reason !== 'other'
  ) {
    return;
  }
  // Authorship gate: requesting peer must own the PC via their own
  // peer-rename pcId binding (the source of truth for who plays
  // which PC at runtime — seat.controllerPeerId tracks the binding
  // AUTHOR, typically the DM, not the actual player).  Defense-in-
  // depth — the engine refuses to record requests for someone
  // else's PC.
  const requester = state.peers[event.peerId];
  if (!requester || requester.pcId !== p.pcId) return;
  // Also require the seat is bound-active (no requests on already-
  // retired / archived seats).
  let controllingSlot: number | undefined;
  for (const [slotStr, seat] of Object.entries(state.pcSlots)) {
    if (seat.pcId === p.pcId && seat.state === 'bound-active') {
      controllingSlot = Number(slotStr);
      break;
    }
  }
  if (controllingSlot === undefined) return;
  // Replace any prior request from the same peer for the same PC.
  state.pcRetireRequests = state.pcRetireRequests.filter(
    (r) => !(r.requestingPeerId === event.peerId && r.pcId === p.pcId)
  );
  state.pcRetireRequests.push({
    requestingPeerId: event.peerId,
    pcId: p.pcId,
    inFictionReason: p.inFictionReason,
    reason: p.reason,
    ts: event.ts
  });
  // A fresh request clears any stale rejection for the same (peer, pc) —
  // the player has moved on; the rejection pip should go away.
  state.pcRetireRejections = state.pcRetireRejections.filter(
    (r) => !(r.requestingPeerId === event.peerId && r.pcId === p.pcId)
  );
}

/**
 * P-R11 (2026-05-25): record the DM's rejection of a pending
 * player request.  Coord-authored.  Removes the request from
 * `pcRetireRequests` and records a `PcRetireRejection` so the
 * requesting player's UI surfaces a "DM declined: <note>" pip.
 */
function applyPcRetireRejectEvent(
  state: SessionState,
  event: QuireEvent
): void {
  if (!state.coordHolders.has(event.peerId)) return;
  if (!isPayloadV1(event.payload)) return;
  const p = event.payload as {
    v?: unknown;
    requestingPeerId?: unknown;
    pcId?: unknown;
    note?: unknown;
  };
  if (typeof p.requestingPeerId !== 'string') return;
  // QA sanity-check SHOULD-FIX-5: bounded length on the peer id so
  // a malformed payload can't pollute pcRetireRejections.  Same
  // shape as peer-name's 80-char cap (peer ids are short pairing
  // codes; 80 is generous).
  if (p.requestingPeerId.length === 0 || p.requestingPeerId.length > 80) {
    return;
  }
  if (!isCharacterId(p.pcId)) return;
  const note =
    typeof p.note === 'string' && p.note.length <= 200 ? p.note : undefined;
  // Drop the matching request (idempotent: if no match, still record
  // the rejection so the player at least sees the verdict).
  state.pcRetireRequests = state.pcRetireRequests.filter(
    (r) => !(r.requestingPeerId === p.requestingPeerId && r.pcId === p.pcId)
  );
  // Replace any prior rejection for the same (peer, pc).
  state.pcRetireRejections = state.pcRetireRejections.filter(
    (r) => !(r.requestingPeerId === p.requestingPeerId && r.pcId === p.pcId)
  );
  state.pcRetireRejections.push({
    requestingPeerId: p.requestingPeerId,
    pcId: p.pcId,
    ...(note !== undefined ? { note } : {}),
    ts: event.ts
  });
}

function applyMapBlobEvent(_state: SessionState, event: QuireEvent): void {
  // Handles all 5 map-blob-* kinds.  Forward-compat guard: every
  // M1+ payload MUST carry { v: 1 }.  Until the per-kind
  // materializer lands in M3a/M3b/M4/M5/M6, we no-op — but the
  // version check still runs, so a payload missing v or with a
  // future v (say v:2) is rejected by the same code path that
  // will reject it in production.
  if (!isPayloadV1(event.payload)) return;
  // TODO M3a/M3b/M4/M5/M6: per-kind state mutation goes here.
}

/**
 * MATERIALIZERS registry.  Add new event kinds here AND in
 * REGISTERED_EVENT_KINDS.  Unknown kinds (no entry in this map)
 * are silently ignored to allow forward compatibility — see the
 * P0-5 / R-FUTURE comment thread.
 */
const MATERIALIZERS: Record<string, EventApplier> = {
  'peer-join': applyPeerJoinEvent,
  'peer-leave': applyPeerLeaveEvent,
  'peer-disconnect': applyPeerDisconnectEvent,
  'peer-rename': applyPeerRenameEvent,
  'coordinator-claim': applyCoordinatorClaimEvent,
  'coordinator-yield': applyCoordinatorYieldEvent,
  'coordinator-reclaim': applyCoordinatorReclaimEvent,
  'scene-reveal': applySceneRevealEvent,
  'scene-unreveal': applySceneUnrevealEvent,
  'dice-roll': applyDiceRollEvent,
  'chat': applyChatEvent,
  'pc-edit': applyPcEditEvent,
  'note': applyNoteEvent,
  'raise-hand': applyRaiseHandEvent,
  'lower-hand': applyLowerHandEvent,
  'scene-reveal-paragraph': applySceneRevealParagraphEvent,
  'scene-unreveal-paragraph': applySceneUnrevealParagraphEvent,
  'npc-pin': applyNpcPinEvent,
  'npc-unpin': applyNpcUnpinEvent,
  'thread-debt-set': applyThreadDebtSetEvent,
  'scratch-note': applyScratchNoteEvent,
  'broadcast-view': applyBroadcastViewEvent,
  'ai-prompt': applyAiPromptEvent,
  'ai-response': applyAiResponseEvent,
  'ai-accept': applyAiVerdictEvent,
  'ai-reject': applyAiVerdictEvent,
  'caster-state-set': applyCasterStateSetEvent,
  'pc-slot-bind': applyPcSlotBindEvent,
  'pc-create': applyPcCreateEvent,
  // Phase B' (2026-05-25): both pc-retire and pc-archive route to
  // the same materializer; the payload's `state` field discriminates.
  'seat-add': applySeatAddEvent,
  'seat-remove': applySeatRemoveEvent,
  'pc-retire': applyPcRetireOrArchiveEvent,
  'pc-archive': applyPcRetireOrArchiveEvent,
  'map-blob-add': applyMapBlobEvent,
  'map-blob-move': applyMapBlobEvent,
  'map-blob-remove': applyMapBlobEvent,
  'map-blob-reveal': applyMapBlobEvent,
  'map-blob-unreveal': applyMapBlobEvent,
  // P-R7: audit-only — peer-rename carries the state change; this
  // event records the from/to + scene context for post-session
  // attribution.  No state mutation.
  'pc-switch': applyAuditOnlyEvent,
  // P-R11 (2026-05-25): player → DM retire workflow.
  'pc-retire-request': applyPcRetireRequestEvent,
  'pc-retire-reject': applyPcRetireRejectEvent,
  // #301 (2026-05-26): flip an unrevealed seat to revealed.
  'seat-reveal': applySeatRevealEvent,
  // #253 (2026-05-26): live WebRTC chargen pack delivery.
  'chargen-pack-deliver': applyChargenPackDeliverEvent,
  'chargen-pack-clear': applyChargenPackClearEvent,
  // #294 (2026-05-26): edit the player-safe "seat memory" on a
  // retired or archived seat.
  'seat-memory-edit': applySeatMemoryEditEvent,
  // Wave B (2026-05-26): magic-arc DM runtime controls.
  'accidental-grant-log': applyAccidentalGrantLogEvent,
  'focus-grant': applyFocusGrantEvent,
  // Wave D-prep-2 (2026-05-26): atomic Realization-beat event.
  'pc-mark-realization': applyPcMarkRealizationEvent,
  // D4 (2026-05-26): DM-saved session-digest recap.
  'session-digest': applySessionDigestEvent,
  // D2 (2026-05-26): session-open ritual marker.
  'session-open': applySessionOpenEvent,
  // D3 (2026-05-26): DM-only progress clocks.  Coord-only,
  // DM-private — see PendingDmClock interface for shape contract.
  'dm-clock-create': applyDmClockCreateEvent,
  'dm-clock-tick': applyDmClockTickEvent,
  'dm-clock-delete': applyDmClockDeleteEvent,
  // D1-D (2026-05-26): living-doc diff-review proposal lifecycle.
  // All three coord-only AND DM-private; see PendingDiffProposal
  // doc-comment for the lifecycle contract.
  'proposal-create': applyProposalCreateEvent,
  'proposal-accept': applyProposalAcceptEvent,
  'proposal-reject': applyProposalRejectEvent,
  // D5 (2026-05-27): per-PC bonds lifecycle.
  'bond-propose': applyBondProposeEvent,
  'bond-ratify': applyBondRatifyEvent,
  'bond-remove': applyBondRemoveEvent
};

/**
 * P-R7 (2026-05-25): no-op materializer for audit-only events.
 * The event lives in the log (replicates, persists, surfaces in
 * the post-session living-doc AI) but mutates no shared state.
 * Validates payload version to keep forward-compat with future
 * v:2+ schemas that DO mutate state.
 */
function applyAuditOnlyEvent(_state: SessionState, event: QuireEvent): void {
  if (!isPayloadV1(event.payload)) return;
}

function applyEventToState(state: SessionState, event: QuireEvent): void {
  const fn = MATERIALIZERS[event.kind];
  if (fn) fn(state, event);
  // Unknown kinds are silently ignored to allow forward compat.
}

/**
 * Test surface: kinds registered in the MATERIALIZERS map.  Exported
 * so a regression test can assert parity with KNOWN_EVENT_KINDS — if
 * a future kind is added to KNOWN_EVENT_KINDS but not to MATERIALIZERS,
 * the new kind would be silently treated as unknown (forward-compat
 * no-op), which is rarely what the author intended.
 */
export const MATERIALIZER_KINDS: ReadonlySet<string> = new Set(
  Object.keys(MATERIALIZERS)
);

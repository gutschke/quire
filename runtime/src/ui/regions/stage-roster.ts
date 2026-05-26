// @vitest-environment happy-dom

/**
 * <stage-roster> — DM-facing PC roster surface (Active / Retired /
 * Archived sub-tabs).
 *
 * P-R5 MVP (2026-05-25): the Stage panel today renders scene
 * content via `<scene-stage>`.  Per `ui.md`'s planned "Stage tabs
 * (Scene · Outline · NPCs · Map)" the DM also needs a Roster tab
 * to see who's at the table at a glance.  This region is that
 * Roster surface.
 *
 * Sub-tabs:
 *   - Active   — `bound-active` seats; shows PC name + tags + harm/
 *                stress glance + Retire affordance
 *   - Retired  — `bound-retired`; shows in-fiction reason
 *   - Archived — `bound-archived`; same as retired
 *
 * Browse-NPCs sub-tab is part of the full P-R5 spec but deferred
 * (no NPC catalog surface exists yet).
 *
 * Read-only on the data: this region doesn't mutate state directly.
 * Retire/edit affordances delegate through callbacks to the host
 * (quire-app → controller).  Re-uses `<seat-card>` for the per-PC
 * tile shell.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CharacterRecord } from '../../character-loader';
import '../components/seat-card';
import type { SeatCardSeat } from '../components/seat-card';

export type RetirePcCallback = (slot: number) => void;
export type DisplayNameLookup = (pcId: string) => string | null;
/**
 * Task #295: persist a soft-notes edit on an accepted PC.  Returns
 * true when the host accepted the edit (coord, length ok, session
 * active); false when rejected.  The component does not depend on
 * the return value — it's there for callers / tests.
 */
export type SetDmNotesCallback = (pcId: string, value: string) => boolean;

/**
 * P-R11 (2026-05-25): player-initiated retire request rendered on the
 * DM-facing Active tile.  The DM clicks Accept (opens the existing
 * retire dialog pre-filled with the player's reason) or Reject
 * (opens an inline note input).
 */
export interface PendingRetireRequest {
  pcId: string;
  requestingPeerName: string;
  inFictionReason: string;
  reason: 'died' | 'departed' | 'converted-to-npc' | 'other';
}

export type AcceptRetireRequestCallback = (
  pcId: string,
  reason: 'died' | 'departed' | 'converted-to-npc' | 'other',
  inFictionReason: string
) => boolean;

export type RejectRetireRequestCallback = (
  pcId: string,
  note: string
) => boolean;

/**
 * P-R10 (2026-05-25): one NPC available for promotion in the
 * Browse NPCs sub-tab.  Promotion makes a new PC seat with the
 * NPC's record copied (stats + description); the NPC entry in
 * the campaign manifest stays put (the DM can manually retire
 * the NPC if they prefer).
 */
export interface BrowseNpcEntry {
  id: string;
  name?: string;
  description?: string;
}

export type PromoteNpcCallback = (npcId: string) => void;

/**
 * #301 (2026-05-26): allocate an unrevealed seat (revealed: false).
 * Used to stage a future-twist PC without players seeing the slot
 * appear in their lobby/roster.  Returns the allocated slot integer
 * or null (no session / non-coord).
 */
export type AddHiddenSeatCallback = () => number | null;

/**
 * #301: flip an unrevealed seat to revealed.  Called from the
 * Stage Roster Active tile when the DM is ready to introduce the
 * staged PC to the table.  Returns true on dispatch.
 */
export type RevealSeatCallback = (slot: number) => boolean;

/**
 * #301: seats are reported with their revealed flag so the Stage
 * Roster Active tile can mark hidden ones with a lock badge + Reveal
 * button.  Tile renders normally (DM sees full state) — the
 * projection strip lives engine-side in `filterForViewer`.
 */
export interface HiddenSeatInfo {
  isHidden: boolean;
}

type SubTab = 'active' | 'retired' | 'archived' | 'browse-npcs';

@customElement('stage-roster')
export class StageRoster extends LitElement {
  /** Light-DOM render so callers' CSS reaches. */
  createRenderRoot(): this {
    return this;
  }

  /**
   * Per-slot Seat map (post viewer-scope filter).  The region
   * filters this by `seat.state` per sub-tab.
   */
  @property({ attribute: false })
  pcSlots: Record<number, SeatCardSeat> = {};

  /**
   * Synthesized PC records by pcId — fed from
   * `sessionView.filteredShared.synthesizedPcs`.  Used to render
   * the body content (tags, harm/stress, etc.) for active PCs.
   */
  @property({ attribute: false })
  synthesizedPcs: Record<string, CharacterRecord> = {};

  /** Resolve a pcId to a display name (P3U-12 deferred-load shape). */
  @property({ attribute: false })
  displayNameLookup: DisplayNameLookup | null = null;

  /**
   * P-R6 retire callback; invoked when the DM clicks the Retire…
   * action on an Active tile.  Same shape as
   * chargen-dm-review's onRetirePc.  Hidden when null.
   */
  @property({ attribute: false })
  onRetirePc: RetirePcCallback | null = null;

  /**
   * Task #295: per-PC dmNotes overlay.  Map from pcId to the
   * current notes value (typically taken from
   * filteredShared.pcEdits[pcId].dmNotes, falling back to the
   * loaded record's dmNotes).  Coord-only — never populated in
   * a player-bound view because the viewer-scope projection
   * strips dmNotes from both surfaces.
   */
  @property({ attribute: false })
  dmNotesByPcId: Record<string, string> = {};

  /**
   * Task #295: persist a soft-notes edit.  When non-null, the
   * Active-tile notes editor renders; when null, the disclosure
   * is hidden (player-bound view, or coord without the wiring).
   */
  @property({ attribute: false })
  onSetDmNotes: SetDmNotesCallback | null = null;

  /**
   * P-R11: pending player retire requests, keyed by pcId.  Active
   * tiles render an amber accept/reject strip when an entry is
   * present.  Empty / absent → no strip.
   */
  @property({ attribute: false })
  pendingRetireRequests: Record<string, PendingRetireRequest> = {};
  @property({ attribute: false })
  onAcceptRetireRequest: AcceptRetireRequestCallback | null = null;
  @property({ attribute: false })
  onRejectRetireRequest: RejectRetireRequestCallback | null = null;

  /**
   * P-R10: NPCs the DM can promote to playable PCs.  Empty array
   * + null callback → the Browse NPCs sub-tab still renders (empty
   * state), but no Promote buttons appear.  When the callback is
   * set, each entry sprouts a Promote button.
   */
  @property({ attribute: false }) npcsList: BrowseNpcEntry[] = [];
  @property({ attribute: false }) onPromoteNpc: PromoteNpcCallback | null =
    null;

  /**
   * #301 (2026-05-26): pcIds whose seat is currently hidden from
   * players (revealed === false on the engine side).  Active-tile
   * renderer marks these with a 🔒 badge + Reveal button.  Empty
   * map / undefined → no special treatment (all seats visible).
   */
  @property({ attribute: false })
  hiddenSeatPcIds: Set<string> = new Set();
  @property({ attribute: false })
  onAddHiddenSeat: AddHiddenSeatCallback | null = null;
  @property({ attribute: false })
  onRevealSeat: RevealSeatCallback | null = null;

  @state() private activeSubTab: SubTab = 'active';

  /**
   * Task #295: per-PC "notes panel open" toggle.  Defaults closed
   * so the Active tab stays compact; the DM clicks 📝 to expand.
   */
  @state() private openNotesPcId: Set<string> = new Set();

  /**
   * P-R11: per-PC reject-note draft for the DM's "Reject" action.
   * Keyed by pcId.  Empty / absent means "the DM hasn't started
   * typing a reject reason."  Submitting clears the entry.
   */
  @state() private rejectNoteDrafts: Record<string, string> = {};
  @state() private rejectOpenForPcId: string | null = null;

  override render(): TemplateResult {
    const slots = this.getSortedSlots();
    const active = slots.filter(([, s]) => s.state === 'bound-active');
    const retired = slots.filter(([, s]) => s.state === 'bound-retired');
    const archived = slots.filter(([, s]) => s.state === 'bound-archived');
    return html`
      <section class="card stage-roster" aria-label="PC roster">
        <header class="stage-roster-head">
          <h2>Roster</h2>
          <nav class="stage-roster-tabs" role="tablist">
            ${this.renderTabButton('active', 'Active', active.length)}
            ${this.renderTabButton('retired', 'Retired', retired.length)}
            ${this.renderTabButton('archived', 'Archived', archived.length)}
            ${this.onPromoteNpc !== null || this.npcsList.length > 0
              ? this.renderTabButton(
                  'browse-npcs',
                  'NPCs',
                  this.npcsList.length
                )
              : nothing}
          </nav>
        </header>
        <div class="stage-roster-body" role="tabpanel">
          ${this.activeSubTab === 'active'
            ? this.renderActiveList(active)
            : this.activeSubTab === 'retired'
              ? this.renderRetiredList(retired)
              : this.activeSubTab === 'archived'
                ? this.renderArchivedList(archived)
                : this.renderBrowseNpcs()}
        </div>
      </section>
    `;
  }

  private getSortedSlots(): Array<[number, SeatCardSeat]> {
    return Object.entries(this.pcSlots)
      .map(([s, seat]) => [Number(s), seat as SeatCardSeat] as const)
      .filter(([s]) => Number.isInteger(s) && s >= 1)
      .sort(([a], [b]) => a - b)
      .map(([s, seat]) => [s, seat]);
  }

  private renderTabButton(
    tab: SubTab,
    label: string,
    count: number
  ): TemplateResult {
    const active = this.activeSubTab === tab;
    return html`<button
      type="button"
      class="stage-roster-tab ${active ? 'stage-roster-tab-active' : ''}"
      role="tab"
      aria-selected=${active ? 'true' : 'false'}
      @click=${() => {
        this.activeSubTab = tab;
      }}
    >
      ${label}
      <span class="stage-roster-tab-count" aria-label="${count} ${label.toLowerCase()}">
        ${count}
      </span>
    </button>`;
  }

  private renderActiveList(
    slots: Array<[number, SeatCardSeat]>
  ): TemplateResult | typeof nothing {
    if (slots.length === 0) {
      return html`<div>
        <p class="muted stage-roster-empty">
          No active PCs.  Add one from the chargen panel.
        </p>
        ${this.renderAddHiddenSeat()}
      </div>`;
    }
    return html`
      <ol class="stage-roster-list">
        ${slots.map(([slot, seat]) => this.renderActiveTile(slot, seat))}
      </ol>
      ${this.renderAddHiddenSeat()}
    `;
  }

  /**
   * #301: small "Add hidden seat" affordance at the bottom of the
   * Active sub-tab.  Only renders when the host wired
   * `onAddHiddenSeat` (DM view, active session).  Stays separate
   * from the regular ⊕ in dm-roster-strip so the common-case (add
   * a normal seat) doesn't get cluttered with the rare workflow.
   */
  private renderAddHiddenSeat(): TemplateResult | typeof nothing {
    if (!this.onAddHiddenSeat) return nothing;
    return html`<p class="stage-roster-add-hidden-row">
      <button
        type="button"
        class="stage-roster-add-hidden-btn"
        title="Stage a future-twist PC.  The seat is invisible to
players until you click Reveal."
        @click=${() => this.onAddHiddenSeat?.()}
      >
        🔒 + Add hidden seat
      </button>
    </p>`;
  }

  private renderActiveTile(
    slot: number,
    seat: SeatCardSeat
  ): TemplateResult {
    const pcId = seat.pcId ?? '';
    const name = this.displayNameLookup?.(pcId) ?? pcId;
    const record = pcId ? this.synthesizedPcs[pcId] : undefined;
    return html`<li class="stage-roster-item" data-slot=${slot}>
      <seat-card
        .slotNumber=${slot}
        .seat=${seat}
        .boundName=${name}
        .boundId=${pcId}
        ?canRetire=${!!this.onRetirePc}
        .onRetire=${(s: number) => this.onRetirePc?.(s)}
      >
        ${this.renderActiveBody(record)}
        ${this.renderHiddenSeatStrip(slot, pcId)}
        ${this.renderRetireRequestStrip(pcId)}
        ${this.renderDmNotes(pcId)}
      </seat-card>
    </li>`;
  }

  /**
   * #301 (2026-05-26): hidden-seat badge + Reveal button.  Renders
   * only when the local viewer's seat for this pcId is unrevealed
   * (per `hiddenSeatPcIds`).  Players never get this branch — the
   * engine projection has already stripped the whole seat by the
   * time the projection reaches a player viewer.
   */
  private renderHiddenSeatStrip(
    slot: number,
    pcId: string
  ): TemplateResult | typeof nothing {
    if (!pcId) return nothing;
    if (!this.hiddenSeatPcIds.has(pcId)) return nothing;
    if (!this.onRevealSeat) {
      // Read-only badge — host might want to show "hidden" without
      // a reveal action (e.g. transitional state).
      return html`<p class="stage-roster-hidden-row muted">
        🔒 Hidden from players
      </p>`;
    }
    return html`<p class="stage-roster-hidden-row">
      <span class="stage-roster-hidden-tag">🔒 Hidden from players</span>
      <button
        type="button"
        class="stage-roster-hidden-reveal"
        title="Make this PC visible to all players from now on (sticky — can't be re-hidden)"
        @click=${() => this.onRevealSeat?.(slot)}
      >
        Reveal
      </button>
    </p>`;
  }

  /**
   * P-R11: DM-facing accept/reject strip for a pending player
   * retire request.  Renders nothing when no request is pending
   * for this PC OR when the wiring isn't present (player view).
   *
   * Accept: passes the player's stated reason through to the host,
   * which dispatches the existing pc-retire event.  Reject: opens
   * an inline note input; submitting it dispatches pc-retire-reject.
   */
  private renderRetireRequestStrip(
    pcId: string
  ): TemplateResult | typeof nothing {
    if (!pcId) return nothing;
    if (!this.onAcceptRetireRequest || !this.onRejectRetireRequest) {
      return nothing;
    }
    const req = this.pendingRetireRequests[pcId];
    if (!req) return nothing;
    const rejectOpen = this.rejectOpenForPcId === pcId;
    const draft = this.rejectNoteDrafts[pcId] ?? '';
    return html`<div class="stage-roster-retire-req">
      <p class="stage-roster-retire-req-head">
        <strong>${req.requestingPeerName}</strong> requested to retire
        ${req.reason === 'died'
          ? '(died)'
          : req.reason === 'converted-to-npc'
            ? '(becomes NPC)'
            : req.reason === 'other'
              ? '(other)'
              : '(departed)'}
      </p>
      <blockquote class="stage-roster-retire-req-reason muted">
        ${req.inFictionReason}
      </blockquote>
      <div class="stage-roster-retire-req-actions">
        <button
          type="button"
          class="stage-roster-retire-req-accept"
          @click=${() =>
            this.onAcceptRetireRequest?.(
              pcId,
              req.reason,
              req.inFictionReason
            )}
        >
          Accept retire
        </button>
        ${rejectOpen
          ? nothing
          : html`<button
              type="button"
              class="stage-roster-retire-req-reject-open"
              @click=${() => {
                this.rejectOpenForPcId = pcId;
              }}
            >
              Reject…
            </button>`}
      </div>
      ${rejectOpen
        ? html`<div class="stage-roster-retire-req-reject">
            <label class="stage-roster-retire-req-reject-label">
              Note for ${req.requestingPeerName} (optional)
              <input
                type="text"
                class="stage-roster-retire-req-reject-text"
                maxlength="200"
                placeholder="e.g. one more scene — there's a beat I want for them"
                .value=${draft}
                @input=${(e: Event) => {
                  this.rejectNoteDrafts = {
                    ...this.rejectNoteDrafts,
                    [pcId]: (e.target as HTMLInputElement).value
                  };
                }}
              />
            </label>
            <div class="stage-roster-retire-req-reject-actions">
              <button
                type="button"
                class="stage-roster-retire-req-reject-cancel"
                @click=${() => {
                  this.rejectOpenForPcId = null;
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                class="stage-roster-retire-req-reject-submit"
                @click=${() => {
                  this.onRejectRetireRequest?.(pcId, draft.trim());
                  this.rejectOpenForPcId = null;
                  const next = { ...this.rejectNoteDrafts };
                  delete next[pcId];
                  this.rejectNoteDrafts = next;
                }}
              >
                Send rejection
              </button>
            </div>
          </div>`
        : nothing}
    </div>`;
  }

  /**
   * Task #295: DM-private soft-notes editor.  Rendered inside the
   * seat-card body slot, below the harm/stress strip.  Defense-in-
   * depth: when `onSetDmNotes` is null (player-bound view, or a
   * coord-less context) the entire block is hidden — players never
   * even see the disclosure toggle.
   *
   * The 📝 toggle shows a faint "·" indicator when the PC already
   * has notes (so the DM knows-at-a-glance without expanding).
   * Auto-saves on textarea blur — typical TTRPG DM workflow is "jot
   * something then move on," not "save button."
   */
  private renderDmNotes(pcId: string): TemplateResult | typeof nothing {
    if (!this.onSetDmNotes || !pcId) return nothing;
    const current = this.dmNotesByPcId[pcId] ?? '';
    const open = this.openNotesPcId.has(pcId);
    const hasContent = current.length > 0;
    return html`<div class="stage-roster-dmnotes">
      <button
        type="button"
        class="stage-roster-dmnotes-toggle ${hasContent
          ? 'stage-roster-dmnotes-toggle-filled'
          : ''}"
        aria-expanded=${open ? 'true' : 'false'}
        title=${hasContent
          ? 'DM notes — has content (click to view/edit)'
          : 'Add DM notes (private — only you see these)'}
        @click=${() => this.toggleDmNotes(pcId)}
      >
        📝 ${open ? 'Hide notes' : hasContent ? 'Notes ·' : 'Add notes'}
      </button>
      ${open
        ? html`<textarea
            class="stage-roster-dmnotes-text"
            rows="3"
            maxlength="2000"
            placeholder="Private to the DM — players never see this.  e.g. 'remember: her sister is in the antagonist's cell'"
            aria-label="DM-private notes for ${pcId}"
            .value=${current}
            @blur=${(e: Event) =>
              this.commitDmNotes(
                pcId,
                (e.target as HTMLTextAreaElement).value
              )}
          ></textarea>`
        : nothing}
    </div>`;
  }

  private toggleDmNotes(pcId: string): void {
    const next = new Set(this.openNotesPcId);
    if (next.has(pcId)) next.delete(pcId);
    else next.add(pcId);
    this.openNotesPcId = next;
  }

  private commitDmNotes(pcId: string, value: string): void {
    // Only dispatch when the value actually changed — avoids
    // ricocheting through the autosave path on every focus/blur
    // cycle where the DM didn't actually edit.
    const prior = this.dmNotesByPcId[pcId] ?? '';
    if (value === prior) return;
    this.onSetDmNotes?.(pcId, value);
  }

  /**
   * Body of an Active tile: short tag glance + harm/stress
   * indicators.  Defense-in-depth: harm/stress are player-visible
   * (per the threat model + viewer-scope projection); the DM-only
   * fields are stripped before the record reaches us.
   */
  private renderActiveBody(
    record: CharacterRecord | undefined
  ): TemplateResult | typeof nothing {
    if (!record) {
      return html`<p class="muted stage-roster-body-empty">
        Character data loading…
      </p>`;
    }
    const tags = record.tags ?? [];
    const harm = typeof record.harm === 'number' ? record.harm : 0;
    const stress = typeof record.stress === 'number' ? record.stress : 0;
    return html`
      <div class="stage-roster-active-body">
        ${tags.length > 0
          ? html`<div class="stage-roster-tags">
              ${tags.slice(0, 4).map(
                (t) =>
                  html`<span class="stage-roster-tag-chip">${t}</span>`
              )}
              ${tags.length > 4
                ? html`<span class="muted">+${tags.length - 4} more</span>`
                : nothing}
            </div>`
          : nothing}
        <div class="stage-roster-status">
          <span
            class="stage-roster-stat stage-roster-stat-harm stage-roster-stat-level-${harm}"
            title="Harm level"
            >harm <strong>${harm}</strong></span
          >
          <span
            class="stage-roster-stat stage-roster-stat-stress stage-roster-stat-level-${stress}"
            title="Stress level"
            >stress <strong>${stress}</strong></span
          >
        </div>
      </div>
    `;
  }

  private renderRetiredList(
    slots: Array<[number, SeatCardSeat]>
  ): TemplateResult {
    if (slots.length === 0) {
      return html`<p class="muted stage-roster-empty">
        No retired PCs yet.
      </p>`;
    }
    return html`<ol class="stage-roster-list">
      ${slots.map(([slot, seat]) => this.renderInactiveTile(slot, seat))}
    </ol>`;
  }

  private renderArchivedList(
    slots: Array<[number, SeatCardSeat]>
  ): TemplateResult {
    if (slots.length === 0) {
      return html`<p class="muted stage-roster-empty">
        No archived PCs yet.
      </p>`;
    }
    return html`<ol class="stage-roster-list">
      ${slots.map(([slot, seat]) => this.renderInactiveTile(slot, seat))}
    </ol>`;
  }

  /**
   * P-R10: Browse NPCs sub-tab.  Lists campaign NPCs with a
   * Promote button per entry; click fires `onPromoteNpc(npcId)`
   * which kicks off the host's load + pc-create + seat-add +
   * pc-slot-bind sequence.  No confirmation modal here — the host
   * can choose to confirm or surface a toast on its side.
   *
   * Empty state when the list is empty (campaign has no NPCs).
   */
  private renderBrowseNpcs(): TemplateResult {
    if (this.npcsList.length === 0) {
      return html`<p class="muted stage-roster-empty">
        No NPCs in this campaign yet.
      </p>`;
    }
    return html`<ol class="stage-roster-list stage-roster-npc-list">
      ${this.npcsList.map(
        (entry) => html`<li class="stage-roster-item" data-npc-id=${entry.id}>
          <div class="stage-roster-npc-head">
            <strong class="stage-roster-npc-name"
              >${entry.name ?? entry.id}</strong
            >
            ${entry.name && entry.name !== entry.id
              ? html`<span class="stage-roster-npc-id muted"
                  >· ${entry.id}</span
                >`
              : nothing}
          </div>
          ${entry.description
            ? html`<p class="stage-roster-npc-desc muted">
                ${entry.description.length > 200
                  ? entry.description.slice(0, 200) + '…'
                  : entry.description}
              </p>`
            : nothing}
          ${this.onPromoteNpc
            ? html`<button
                type="button"
                class="stage-roster-npc-promote"
                title="Promote ${entry.name ?? entry.id} to a playable PC (allocates a new seat)"
                @click=${() => this.onPromoteNpc?.(entry.id)}
              >
                Promote to PC →
              </button>`
            : nothing}
        </li>`
      )}
    </ol>`;
  }

  private renderInactiveTile(
    slot: number,
    seat: SeatCardSeat
  ): TemplateResult {
    const pcId = seat.pcId ?? '';
    const name = this.displayNameLookup?.(pcId) ?? pcId;
    return html`<li class="stage-roster-item" data-slot=${slot}>
      <seat-card
        .slotNumber=${slot}
        .seat=${seat}
        .boundName=${name}
        .boundId=${pcId}
      >
        ${seat.inFictionRetireReason
          ? html`<p class="stage-roster-retire-reason muted">
              ${seat.inFictionRetireReason}
            </p>`
          : nothing}
      </seat-card>
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stage-roster': StageRoster;
  }
}

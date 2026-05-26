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

type SubTab = 'active' | 'retired' | 'archived';

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

  @state() private activeSubTab: SubTab = 'active';

  /**
   * Task #295: per-PC "notes panel open" toggle.  Defaults closed
   * so the Active tab stays compact; the DM clicks 📝 to expand.
   */
  @state() private openNotesPcId: Set<string> = new Set();

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
          </nav>
        </header>
        <div class="stage-roster-body" role="tabpanel">
          ${this.activeSubTab === 'active'
            ? this.renderActiveList(active)
            : this.activeSubTab === 'retired'
              ? this.renderRetiredList(retired)
              : this.renderArchivedList(archived)}
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
      return html`<p class="muted stage-roster-empty">
        No active PCs.  Add one from the chargen panel.
      </p>`;
    }
    return html`
      <ol class="stage-roster-list">
        ${slots.map(([slot, seat]) => this.renderActiveTile(slot, seat))}
      </ol>
    `;
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
        ${this.renderDmNotes(pcId)}
      </seat-card>
    </li>`;
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

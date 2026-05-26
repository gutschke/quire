// @vitest-environment happy-dom

/**
 * <seat-card> — shared seat-tile shell for DM-facing PC roster
 * surfaces.
 *
 * Phase 3c extraction (2026-05-25) per Engineering-R6.  The
 * chargen-dm-review's renderSeat (~125 LOC) had a chargen-specific
 * body but a generic header (PC pill + bound-name + retired/
 * archived state tag + remove/retire affordances).  P-R5 Stage
 * roster will want the same shell but with a different body
 * (compact stats glance, switch-to-pc verb, etc.).  Pulling the
 * header shell here avoids the duplication.
 *
 * Scope: this primitive owns ONLY the seat HEADER — pill, name
 * (with optional id subtitle), state tags, and the remove/retire
 * action buttons.  Everything below the header is the surface's
 * concern (a `<slot>` carries the body).  Drag-and-drop, generate-
 * invite, synth controls, etc., stay on the chargen-specific
 * region — they don't belong on the Stage roster.
 *
 * Contract:
 *
 *   <seat-card
 *     class="chargen-dm-review-seat..."        // host's class scope
 *     .slotNumber=${1}                         // PC slot integer (1..N)
 *     .seat=${seat}                            // Seat from core/state
 *     .boundName=${"Mei Tanaka"}               // resolved display name
 *     .boundId=${"slot-1-abc"}                 // pcId; rendered as subtitle if differs from name
 *     ?canRemove=${true}                       // show × button
 *     ?canRetire=${true}                       // show Retire… button
 *     .onRemove=${(slot) => this.removeSeat(slot)}
 *     .onRetire=${(slot) => this.openRetireDialog(slot)}
 *   >
 *     <!-- body content (chargen surface, Stage tile, etc.) -->
 *     <div class="my-chargen-body">...</div>
 *   </seat-card>
 *
 * Behavior:
 *   - The host element's `class` passthrough preserves existing
 *     per-region CSS targeting (chargen-dm-review-seat, etc.).
 *   - When canRemove=true and onRemove is wired, the × button
 *     renders.  Defense-in-depth: it also requires the callback,
 *     so an empty default doesn't expose the affordance.
 *   - Same for canRetire / onRetire.
 *   - Slot content renders below the header inside the same
 *     primitive — host doesn't need to manage layout.
 *   - Light-DOM render so callers' CSS reaches.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Minimal Seat shape — duplicated here to avoid pulling the full
 * core/state Seat type (which carries DM-only metadata not
 * relevant to the primitive's render).  Compatible by structural
 * typing; callers pass their `Seat` directly.
 */
export interface SeatCardSeat {
  state: 'unbound' | 'bound-active' | 'bound-retired' | 'bound-archived';
  pcId?: string;
  inFictionRetireReason?: string;
  /**
   * #294 (2026-05-26): player-safe "seat memory" — a one-line
   * legacy authored by the DM at retire time (or backfilled later
   * via `seat-memory-edit`).  When present, the seat-card surfaces
   * it under the retired/archived tag as the seat's primary
   * narrative anchor.  Player-safe by construction.
   */
  seatMemory?: string;
}

@customElement('seat-card')
export class SeatCard extends LitElement {
  /** Light-DOM render so callers' CSS reaches without ::slotted. */
  createRenderRoot(): this {
    return this;
  }

  /**
   * The PC slot number (1..N).  Named `slotNumber` (not `slot`)
   * because `slot` is a reserved HTMLElement property for shadow-
   * DOM slot assignment.
   */
  @property({ type: Number }) slotNumber: number = 0;

  @property({ attribute: false }) seat: SeatCardSeat | null = null;

  /** Resolved display name; renders as the primary label. */
  @property() boundName: string = '';

  /**
   * The pcId; rendered as a `(slot-1-abc)` subtitle when it
   * differs from `boundName`.  When the name is missing, the
   * pcId renders alone as a `<code>`.
   */
  @property() boundId: string = '';

  @property({ type: Boolean }) canRemove = false;
  @property({ type: Boolean }) canRetire = false;

  @property({ attribute: false })
  onRemove: ((slot: number) => void) | null = null;

  @property({ attribute: false })
  onRetire: ((slot: number) => void) | null = null;

  override render(): TemplateResult {
    const seat = this.seat;
    const slot = this.slotNumber;
    const hasName = this.boundName.length > 0;
    const showSubtitle = hasName && this.boundId && this.boundName !== this.boundId;
    return html`
      <header class="chargen-dm-review-seat-head">
        <span class="chargen-dm-review-seat-pill">PC${slot}</span>
        <span class="chargen-dm-review-seat-name">
          ${hasName
            ? showSubtitle
              ? html`<span class="chargen-dm-review-seat-display-name"
                    >${this.boundName}</span
                  ><code
                    class="chargen-dm-review-seat-id"
                    title="Character id"
                    >(${this.boundId})</code
                  >`
              : html`<code title="Character id">${this.boundName}</code>`
            : html`<span class="muted">open</span>`}
        </span>
        ${seat?.state === 'bound-retired'
          ? html`<span
              class="chargen-dm-review-seat-tag chargen-dm-review-seat-tag-retired"
              title="${seat.inFictionRetireReason ?? 'Retired from the story'}"
              >retired</span
            >`
          : nothing}
        ${seat?.state === 'bound-archived'
          ? html`<span
              class="chargen-dm-review-seat-tag chargen-dm-review-seat-tag-archived"
              title="${seat.inFictionRetireReason ?? 'Archived from the roster'}"
              >archived</span
            >`
          : nothing}
        ${this.canRemove && this.onRemove
          ? html`<button
              type="button"
              class="chargen-dm-review-seat-remove"
              title="Remove this empty seat (undoable for 4 seconds)"
              aria-label="Remove PC${slot}"
              @click=${() => this.onRemove?.(slot)}
            >
              ×
            </button>`
          : nothing}
        ${this.canRetire && this.onRetire
          ? html`<button
              type="button"
              class="chargen-dm-review-seat-retire"
              title="Retire this PC from the story (with an in-fiction reason)"
              aria-label="Retire PC${slot}"
              @click=${() => this.onRetire?.(slot)}
            >
              Retire…
            </button>`
          : nothing}
      </header>
      ${seat?.seatMemory &&
      (seat.state === 'bound-retired' || seat.state === 'bound-archived')
        ? html`<p
            class="chargen-dm-review-seat-memory"
            title="Seat memory — a player-safe legacy line authored by the DM"
          >
            <span aria-hidden="true">“</span>${seat.seatMemory}<span
              aria-hidden="true"
              >”</span
            >
          </p>`
        : nothing}
      <slot></slot>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'seat-card': SeatCard;
  }
}

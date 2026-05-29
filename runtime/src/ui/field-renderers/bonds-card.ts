// @vitest-environment happy-dom

/**
 * <bonds-card> — D5 (2026-05-27) renderer for the PC's bonds list.
 *
 * A bond = a relationship anchor between this PC and another PC
 * (PC-only target in MVP; NPC bonds deferred to D5.5).
 *
 * Per the D5 pre-design lock:
 * - Player owns voice (`text` is player-authored, player-visible)
 * - DM owns fit (`dmNotes` is DM-only, field-firewalled per-entry)
 * - Authoring at chargen, ratification by DM, surfacing here
 *   read-only
 * - Inline-edit on player-rail / dm-pc-detail comes as the
 *   FOLLOWUP affordance (this component supports both modes)
 *
 * Rendering modes:
 * - Read-only (default): chips with target + bond text
 * - Coord/DM (editable): adds a delete affordance per bond + a
 *   prominent dmNotes line (amber-rail) when present
 * - Compose mode (chargen flow): a separate `<bonds-compose>`
 *   surface; this card is the READ side only
 *
 * Mirrors `<foci-card>` patterns: one chip per entry, click-to-
 * cycle deferred (bonds don't have a status enum per D5 lock),
 * `editablePcId` switches to coord mode.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Bond } from '../../character-loader';

export interface BondsCardEntry extends Bond {
  /**
   * Stable id mirroring the BondEntry materialized id.  Required
   * so the host can route delete events back to the right entry
   * (text is mutable; index can shift; only id is stable).
   */
  id: string;
  /** Display label for the target (resolved by the host from
   *  `synthesizedPcs[targetPcId].name` or `seatMemory` fallback
   *  for retired PCs). */
  targetLabel: string;
  /**
   * D5-cleanup (2026-05-27): direction of the bond relative to
   * the PC being viewed.
   *   - 'out': this PC bonded to someone else (the source PC)
   *   - 'in': someone else bonded to this PC (cross-side render)
   * Default 'out' for backwards compatibility.  Scenario TTRPG-A.5
   * found that without inbound rendering, Iris doesn't see Mei's
   * bond pointing at her — the whole "shared anchor" semantic
   * breaks.  Engine isn't changing; state.pcBonds is still keyed
   * by source PC.  Host collects inbound from other PCs' bond
   * arrays where targetPcId === viewing pcId.
   */
  direction?: 'out' | 'in';
  /**
   * When direction === 'in', this is the PC who authored the
   * bond pointing at the viewer.  Used for the "Mei → me" label
   * in the bonds-card display.
   */
  sourceLabel?: string;
}

export type RemoveBondCallback = (pcId: string, bondId: string) => void;

@customElement('bonds-card')
export class BondsCard extends LitElement {
  /** Light-DOM render so the existing CSS cascade applies. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Array of bonds for the PC.  Read-side data; host adapts from
   *  `state.pcBonds[pcId]` + lookup helpers. */
  @property({ attribute: false }) bonds: BondsCardEntry[] = [];

  /**
   * D5-C-fix (2026-05-27 scenario-playthrough UX-1): pending bond
   * proposal count surfaced to the LOCAL player so they have
   * after-state feedback when they propose a bond.  Pre-fix the
   * compose form closed silently and the player saw zero
   * indication their proposal landed (pcBondProposals is wiped
   * for non-coord by filterForViewer per design D5-3).  Surfaces
   * as a muted pip "1 awaiting DM review" when > 0.
   */
  @property({ attribute: false }) pendingProposalCount: number = 0;

  /**
   * When non-null, the card renders in coord/DM mode: dmNotes
   * lines are visible (already stripped for non-coord by
   * filterForViewer), per-bond delete affordance appears, and the
   * card heading flips to "DM view."  Pass the PC id so callbacks
   * route correctly.
   */
  @property() editablePcId: string | null = null;

  /** Host callback for the coord-only delete affordance. */
  @property({ attribute: false }) onRemove: RemoveBondCallback | null = null;

  /**
   * #387: which bond is in the "confirm removal" state.  A ratified
   * bond is an established in-fiction tie; removing it is a story beat,
   * not an undo, so the ✕ arms a confirm rather than deleting on the
   * first click.  Local @state, ephemeral.
   */
  @state() private removeConfirmId: string | null = null;

  /** Clear a stale confirm if the bond list or PC changes underfoot
   *  (e.g. a switcher PC change, or the bond got removed/ratified). */
  override willUpdate(changed: Map<string, unknown>): void {
    if (
      (changed.has('bonds') || changed.has('editablePcId')) &&
      this.removeConfirmId !== null &&
      !this.bonds.some((b) => b.id === this.removeConfirmId)
    ) {
      this.removeConfirmId = null;
    }
  }

  override render(): TemplateResult {
    const isCoord = this.editablePcId !== null;
    return html`<section class="bonds-card">
      <header class="bonds-card-head">
        <h4>Bonds${this.bonds.length > 0 ? ` (${this.bonds.length})` : ''}</h4>
        ${this.pendingProposalCount > 0
          ? html`<span class="muted bonds-card-pending-pip"
              >${this.pendingProposalCount} awaiting DM review</span
            >`
          : nothing}
      </header>
      ${this.bonds.length === 0
        ? html`<p class="muted bonds-card-empty">No bonds yet.</p>`
        : html`<ul class="bonds-card-list">
            ${this.bonds.map((b) => this.renderBond(b, isCoord))}
          </ul>`}
    </section>`;
  }

  private renderBond(b: BondsCardEntry, isCoord: boolean): TemplateResult {
    const isInbound = b.direction === 'in';
    const rowClasses = [
      'bonds-card-row',
      isInbound ? 'bonds-card-row-inbound' : ''
    ]
      .filter(Boolean)
      .join(' ');
    return html`<li class=${rowClasses}>
      <div class="bonds-card-target">
        ${isInbound
          ? html`<span class="bonds-card-inbound-pip" aria-label="Inbound bond"
              >Inbound</span
            >
            <strong>${b.sourceLabel ?? '(unknown)'}</strong>
            <span class="muted"> → me</span>`
          : html`<strong>${b.targetLabel}</strong>`}
      </div>
      <p class="bonds-card-text">${b.text}</p>
      ${isInbound
        ? html`<p class="bonds-card-inbound-consent muted">
            Another player's character claims this tie.  If it doesn't
            fit yours, that's a conversation for the table — your DM
            can adjust or drop it.
          </p>`
        : nothing}
      ${isCoord && b.dmNotes
        ? html`<aside class="bonds-card-dm-notes" aria-label="DM note">
            <strong>DM:</strong> ${b.dmNotes}
          </aside>`
        : nothing}
      ${isCoord && this.onRemove !== null && !isInbound
        ? this.removeConfirmId === b.id
          ? html`<span class="bonds-card-remove-confirm" role="alert">
              <span class="bonds-card-remove-confirm-msg"
                >Sever this tie?  It's an established connection — a
                table-fiction call, not an undo.</span
              >
              <button
                type="button"
                class="bonds-card-remove-confirm-yes"
                @click=${() => {
                  this.removeConfirmId = null;
                  this.onRemove?.(this.editablePcId!, b.id);
                }}
              >
                Remove
              </button>
              <button
                type="button"
                class="bonds-card-remove-confirm-no"
                @click=${() => {
                  this.removeConfirmId = null;
                }}
              >
                Keep
              </button>
            </span>`
          : html`<button
              type="button"
              class="bonds-card-remove"
              title="Remove this bond"
              @click=${() => {
                this.removeConfirmId = b.id;
              }}
            >
              ✕
            </button>`
        : nothing}
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bonds-card': BondsCard;
  }
}

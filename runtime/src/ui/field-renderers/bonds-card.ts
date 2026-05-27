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
import { customElement, property } from 'lit/decorators.js';
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
   * When non-null, the card renders in coord/DM mode: dmNotes
   * lines are visible (already stripped for non-coord by
   * filterForViewer), per-bond delete affordance appears, and the
   * card heading flips to "DM view."  Pass the PC id so callbacks
   * route correctly.
   */
  @property() editablePcId: string | null = null;

  /** Host callback for the coord-only delete affordance. */
  @property({ attribute: false }) onRemove: RemoveBondCallback | null = null;

  override render(): TemplateResult {
    const isCoord = this.editablePcId !== null;
    return html`<section class="bonds-card">
      <header class="bonds-card-head">
        <h4>Bonds${this.bonds.length > 0 ? ` (${this.bonds.length})` : ''}</h4>
      </header>
      ${this.bonds.length === 0
        ? html`<p class="muted bonds-card-empty">
            No bonds yet.${isCoord ? ' Bonds are authored at chargen.' : ''}
          </p>`
        : html`<ul class="bonds-card-list">
            ${this.bonds.map((b) => this.renderBond(b, isCoord))}
          </ul>`}
    </section>`;
  }

  private renderBond(b: BondsCardEntry, isCoord: boolean): TemplateResult {
    return html`<li class="bonds-card-row">
      <div class="bonds-card-target">
        <strong>${b.targetLabel}</strong>
      </div>
      <p class="bonds-card-text">${b.text}</p>
      ${isCoord && b.dmNotes
        ? html`<aside class="bonds-card-dm-notes" aria-label="DM note">
            <strong>DM:</strong> ${b.dmNotes}
          </aside>`
        : nothing}
      ${isCoord && this.onRemove !== null
        ? html`<button
            type="button"
            class="bonds-card-remove"
            title="Remove this bond"
            @click=${() => this.onRemove?.(this.editablePcId!, b.id)}
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

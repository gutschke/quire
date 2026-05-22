/**
 * <seat-strip> — modes-of-play seat list (M3D-6, CC-1 subset).
 *
 * Renders one row per slot in `pcSlots`.  The "seat" concept is the
 * primary abstraction for the modes-of-play polymorphism (memory
 * `project_quire_modes_of_play`): a seat at the table may or may not
 * have a connected peer.  In distributed mode, peers fill seats; in
 * DM-only-computer mode, seats exist without peers and the DM plays
 * proxy for absent players.
 *
 * Today's renderer is the MINIMUM VIABLE subset:
 *   - One row per occupied slot (slots 1-9; empty slots not rendered).
 *   - Slot number + bound character id as display.
 *   - DM-direct unbind button per row (calls onUnbind).
 *
 * Deferred for later commits (each its own backlog item):
 *   - Display-name resolution from character data (today shows the id).
 *   - Per-PC AI-approval pill (CC-24; lives here once chargen lands).
 *   - "Add slot" affordance (Phase 2 CC-12 in <invite-manager>).
 *   - Whisper event integration (CC-6 stretch; M3e).
 *   - Print stylesheet (M5+).
 *
 * Light-DOM rendering: `createRenderRoot()` returns `this` so the
 * existing legacy CSS cascade reaches the rendered markup.
 *
 * DM-only: parents only mount this region when the local peer is
 * coordinator.  The region itself doesn't enforce that — the gate
 * lives at the mount site (dm-aside).
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type UnbindCallback = (slot: number) => void;

@customElement('seat-strip')
export class SeatStrip extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Mapping of slot number (1-9) to bound character id.  Empty slots
   * (no binding) are not rendered.  See `state.pcSlots` for the
   * canonical shape; this prop is the player-visible filtered copy.
   */
  @property({ attribute: false }) pcSlots: Record<number, string> = {};

  /**
   * DM-direct unbind callback.  Invoked when the DM clicks the
   * remove-binding affordance on a seat row.  Parent (QuireApp) wires
   * to `bindPcSlot(slot, null)` so the materializer clears the binding.
   */
  @property({ attribute: false }) onUnbind: UnbindCallback | null = null;

  override render(): TemplateResult {
    const entries = this.collectEntries();
    if (entries.length === 0) {
      return html`
        <section class="card seat-strip-empty">
          <h2>Seats at the table</h2>
          <p class="muted">
            No seats bound yet.  Bind a slot to a character to surface
            them here — players will see their assigned PC in scene
            prose where the script uses <code>{{pc:N}}</code>.
          </p>
        </section>
      `;
    }
    return html`
      <section class="card seat-strip">
        <h2>Seats at the table</h2>
        <ul class="seat-strip-list">
          ${entries.map((e) => this.renderEntry(e))}
        </ul>
      </section>
    `;
  }

  /**
   * Stable-sorted list of [slot, pcId] entries.  Slot 1 first, slot 9
   * last.  Filters out non-numeric / out-of-range keys defensively —
   * the materializer rejects them, but a poisoned save or older
   * runtime version might surface them via filterForViewer.
   */
  private collectEntries(): Array<{ slot: number; pcId: string }> {
    const out: Array<{ slot: number; pcId: string }> = [];
    for (const [k, pcId] of Object.entries(this.pcSlots ?? {})) {
      const slot = Number(k);
      if (!Number.isInteger(slot)) continue;
      if (slot < 1 || slot > 9) continue;
      if (typeof pcId !== 'string' || pcId.length === 0) continue;
      out.push({ slot, pcId });
    }
    out.sort((a, b) => a.slot - b.slot);
    return out;
  }

  private renderEntry(entry: {
    slot: number;
    pcId: string;
  }): TemplateResult {
    return html`
      <li class="seat-strip-row" data-slot=${entry.slot}>
        <span class="seat-strip-slot" aria-label="Slot ${entry.slot}">
          PC${entry.slot}
        </span>
        <span class="seat-strip-pc-id" title="Character id">
          ${entry.pcId}
        </span>
        ${this.onUnbind
          ? html`<button
              type="button"
              class="seat-strip-unbind"
              aria-label="Unbind slot ${entry.slot}"
              title="Unbind ${entry.pcId} from PC${entry.slot}"
              @click=${() => this.onUnbind?.(entry.slot)}
            >
              ×
            </button>`
          : nothing}
      </li>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'seat-strip': SeatStrip;
  }
}

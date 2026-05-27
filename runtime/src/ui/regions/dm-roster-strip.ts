// @vitest-environment happy-dom

/**
 * <dm-roster-strip> — always-visible compact PC roster for the DM
 * aside.
 *
 * P-R4 MVP (2026-05-25): per UX-R5 "the most-felt gap" — after
 * chargen accepts, the DM has no at-a-glance "who's at the table"
 * during play.  The Stage roster tab (P-R5) is full detail but
 * hidden when the DM is on the Scene tab.  This strip is the
 * always-visible companion: one row per bound-active PC, with
 * name + harm/stress mini-pips + retired/archived dim treatment.
 *
 * The ⊕ glyph at the top opens a new chargen seat (lowest unused
 * slot).  F1 keyboard shortcut fires the same action — TTRPG
 * memory ergonomic: late-add a guest player without leaving the
 * scene.  Hotkey is wired in quire-app's central hotkey handler,
 * not here.
 *
 * Retired/archived seats render dimmed below the active rows
 * rather than hidden — gives the DM a quick reminder of who's
 * left the story without needing to switch to the Stage tab.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CharacterRecord } from '../../character-loader';
import type { SeatCardSeat } from '../components/seat-card';

// Wave C3 (2026-05-26): import + re-export shared callback-types.
import type { AddSeatCallback, DisplayNameLookup } from '../callback-types';
export type { AddSeatCallback, DisplayNameLookup };

@customElement('dm-roster-strip')
export class DmRosterStrip extends LitElement {
  createRenderRoot(): this {
    return this;
  }

  @property({ attribute: false })
  pcSlots: Record<number, SeatCardSeat> = {};

  @property({ attribute: false })
  synthesizedPcs: Record<string, CharacterRecord> = {};

  @property({ attribute: false })
  displayNameLookup: DisplayNameLookup | null = null;

  /**
   * Called when the DM clicks ⊕ or presses F1.  Returns the
   * allocated slot integer or null (cap reached / non-coord).
   * Hidden when null.
   */
  @property({ attribute: false })
  onAddSeat: AddSeatCallback | null = null;

  override render(): TemplateResult {
    const slots = this.getSortedSlots();
    const active = slots.filter(([, s]) => s.state === 'bound-active');
    const inactive = slots.filter(
      ([, s]) => s.state === 'bound-retired' || s.state === 'bound-archived'
    );
    return html`
      <section class="card dm-roster-strip" aria-label="Player roster">
        <header class="dm-roster-strip-head">
          <h3>Players</h3>
          ${this.onAddSeat
            ? html`<button
                type="button"
                class="dm-roster-strip-add"
                title="Add a new player seat (hotkey: F1)"
                aria-label="Add player seat (F1)"
                @click=${() => this.handleAddSeat()}
              >
                ⊕
              </button>`
            : nothing}
        </header>
        ${active.length === 0 && inactive.length === 0
          ? html`<p class="muted dm-roster-strip-empty">
              No players yet.  Click ⊕ (or press F1) to add a seat.
            </p>`
          : html`<ol class="dm-roster-strip-list">
              ${active.map(([slot, seat]) =>
                this.renderRow(slot, seat, false)
              )}
              ${inactive.map(([slot, seat]) =>
                this.renderRow(slot, seat, true)
              )}
            </ol>`}
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

  private renderRow(
    slot: number,
    seat: SeatCardSeat,
    dimmed: boolean
  ): TemplateResult {
    const pcId = seat.pcId ?? '';
    const name = this.displayNameLookup?.(pcId) ?? pcId;
    const record = pcId ? this.synthesizedPcs[pcId] : undefined;
    const harm = typeof record?.harm === 'number' ? record.harm : 0;
    const stress = typeof record?.stress === 'number' ? record.stress : 0;
    const stateTag =
      seat.state === 'bound-retired'
        ? 'retired'
        : seat.state === 'bound-archived'
          ? 'archived'
          : null;
    return html`<li
      class="dm-roster-strip-row ${dimmed ? 'dm-roster-strip-row-dim' : ''}"
      data-slot=${slot}
    >
      <span class="dm-roster-strip-pill">PC${slot}</span>
      <span class="dm-roster-strip-name" title=${name}>${name}</span>
      ${stateTag
        ? html`<span
            class="dm-roster-strip-state dm-roster-strip-state-${stateTag}"
            title=${seat.inFictionRetireReason ?? stateTag}
            >${stateTag}</span
          >`
        : html`
            <span
              class="dm-roster-strip-stat dm-roster-strip-stat-level-${harm}"
              title="Harm level"
              >h:${harm}</span
            >
            <span
              class="dm-roster-strip-stat dm-roster-strip-stat-level-${stress}"
              title="Stress level"
              >s:${stress}</span
            >
          `}
    </li>`;
  }

  /**
   * Public so the central hotkey handler in quire-app can call it
   * directly when F1 fires.  Returns the allocated slot integer
   * (or null) so the caller can surface a toast.
   */
  triggerAddSeat(): number | null {
    return this.handleAddSeat();
  }

  private handleAddSeat(): number | null {
    if (!this.onAddSeat) return null;
    return this.onAddSeat();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-roster-strip': DmRosterStrip;
  }
}

// @vitest-environment happy-dom

/**
 * <clock-strip> — D3 (2026-05-26) DM-only progress clocks.
 *
 * Sits below the roster strip in the DM aside.  Roster is
 * identity (who's here); clocks are pressure (what's coming).
 *
 * MVP scope (locked by pre-design expert round):
 *   - DM-only clocks ONLY (no shared / player-visible clocks).
 *     Players never see this surface — it's not even mounted on
 *     non-coord viewers (host gates via isCoordinator()).
 *   - Sizes 4 and 6 ONLY (TTRPG narrowed from FitD canon {4,6,8}).
 *   - No AI write surface (clocks encode DM pacing intent;
 *     ceding to AI inverts the prime directive).
 *   - Insertion-order only (no reorder / drag-sort).
 *
 * UX patterns (per UX-expert pre-design):
 *   - SVG pie glyph; filled wedges show progress
 *   - Left-click pie = +1, Shift-click pie = -1 (mistake recovery)
 *   - ⊕ in header opens inline create row (NOT modal — modal
 *     breaks scene flow)
 *   - Click clock-name to inline-rename (consistent with foci-
 *     card status-chip cycle pattern)
 *   - Full clock = warm-red wedges + slow pulse until DM clicks
 *     → acknowledged → 60% opacity (no auto-archive)
 *   - 4px left rail amber (Stage DM-only convention)
 *
 * Conscious MVP debt:
 *   - No reorder
 *   - No D4 session-digest auto-surface
 *   - No D2 session-open carryover surface
 *   - No size-8
 *
 * **Renaming flow note**: D3 MVP does NOT ship rename — the
 * event-kind family `dm-clock-rename` is reserved for D3.5.
 * For MVP, the DM deletes and recreates if they want to rename.
 * (The component's render still uses an inline-name <span> as
 * the visual hook for the future rename affordance.)
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/** Read-side shape — host adapts `state.dmClocks` into this. */
export interface DmClockView {
  id: string;
  name: string;
  size: 4 | 6;
  filled: number;
}

export type CreateClockCallback = (
  name: string,
  size: 4 | 6
) => boolean;
export type TickClockCallback = (id: string, by: number) => boolean;
export type DeleteClockCallback = (id: string) => boolean;

@customElement('clock-strip')
export class ClockStrip extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Clocks to render (insertion-order; host preserves order). */
  @property({ attribute: false }) clocks: DmClockView[] = [];

  /** Wired only on the coord viewer. */
  @property({ attribute: false }) onCreate: CreateClockCallback | null = null;
  @property({ attribute: false }) onTick: TickClockCallback | null = null;
  @property({ attribute: false }) onDelete: DeleteClockCallback | null = null;

  /** Inline-create row visibility. */
  @state() private creating: boolean = false;
  @state() private draftName: string = '';
  @state() private draftSize: 4 | 6 = 4;

  /**
   * Local-only acknowledgments for FULL clocks (filled === size).
   * Acknowledged clocks dim to 60% opacity and stop pulsing.
   * Ephemeral — re-fires on reload.  Many filled clocks in a
   * session is itself a story signal so we don't auto-archive
   * (per UX-expert).
   */
  @state() private acknowledged: Record<string, boolean> = {};

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('clocks')) {
      // Prune acknowledged entries for deleted clocks.
      const live = new Set(this.clocks.map((c) => c.id));
      let dirty = false;
      for (const k of Object.keys(this.acknowledged)) {
        if (!live.has(k)) {
          dirty = true;
          break;
        }
      }
      if (dirty) {
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(this.acknowledged)) {
          if (live.has(k)) next[k] = v;
        }
        this.acknowledged = next;
      }
    }
  }

  override render(): TemplateResult {
    const canCoord = this.onCreate !== null && this.onTick !== null;
    return html`<section class="card clock-strip" aria-label="DM clocks">
      <header class="clock-strip-head">
        <h3>Clocks</h3>
        ${canCoord
          ? html`<button
              type="button"
              class="clock-strip-add"
              title="Add a new clock"
              ?disabled=${this.creating}
              @click=${() => this.startCreate()}
            >
              ⊕
            </button>`
          : nothing}
      </header>
      ${this.creating ? this.renderCreateRow() : nothing}
      ${this.clocks.length === 0 && !this.creating
        ? html`<p class="muted clock-strip-empty">
            No clocks.  Click ⊕ to track a between-session pressure.
          </p>`
        : nothing}
      ${this.clocks.length > 0
        ? html`<ul class="clock-strip-list">
            ${this.clocks.map((c) => this.renderClock(c, canCoord))}
          </ul>`
        : nothing}
    </section>`;
  }

  private renderCreateRow(): TemplateResult {
    return html`<div class="clock-strip-create">
      <input
        type="text"
        class="clock-strip-create-name"
        placeholder="e.g., The Engineer ships"
        maxlength="200"
        .value=${this.draftName}
        @input=${(e: Event) => {
          this.draftName = (e.target as HTMLInputElement).value;
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter') this.submitCreate();
          else if (e.key === 'Escape') this.cancelCreate();
        }}
      />
      <div class="clock-strip-create-sizes">
        ${([4, 6] as const).map(
          (s) => html`<button
            type="button"
            class=${this.draftSize === s
              ? 'clock-strip-create-size clock-strip-create-size-selected'
              : 'clock-strip-create-size'}
            @click=${() => {
              this.draftSize = s;
            }}
          >
            ${s}
          </button>`
        )}
      </div>
      <button
        type="button"
        class="clock-strip-create-submit"
        @click=${() => this.submitCreate()}
      >
        Add
      </button>
      <button
        type="button"
        class="clock-strip-create-cancel"
        @click=${() => this.cancelCreate()}
      >
        Cancel
      </button>
    </div>`;
  }

  private renderClock(c: DmClockView, canCoord: boolean): TemplateResult {
    const isFull = c.filled >= c.size;
    const isAcked = this.acknowledged[c.id] === true;
    const classes = [
      'clock-strip-row',
      isFull && !isAcked ? 'clock-strip-row-full' : '',
      isAcked ? 'clock-strip-row-acked' : ''
    ]
      .filter(Boolean)
      .join(' ');
    return html`<li class=${classes}>
      <button
        type="button"
        class="clock-strip-pie"
        title="${c.filled}/${c.size} — click +1, shift-click −1"
        ?disabled=${!canCoord}
        @click=${(e: MouseEvent) => this.handlePieClick(c, e)}
      >
        ${this.renderPie(c)}
      </button>
      <span class="clock-strip-name" title=${c.name}>${c.name}</span>
      <span class="clock-strip-counter">${c.filled}/${c.size}</span>
      ${canCoord
        ? html`<button
            type="button"
            class="clock-strip-delete"
            title="Delete clock"
            @click=${() => this.handleDelete(c)}
          >
            ✕
          </button>`
        : nothing}
    </li>`;
  }

  /**
   * SVG pie chart.  N wedges of (360 / size) degrees each;
   * filled wedges colored, empty wedges show stroke only.
   * Diameter scales with size (16px for 4-seg, 18px for 6-seg).
   */
  private renderPie(c: DmClockView): TemplateResult {
    const diameter = c.size === 4 ? 16 : 18;
    const cx = diameter / 2;
    const cy = diameter / 2;
    const r = diameter / 2 - 1;
    const wedges: TemplateResult[] = [];
    for (let i = 0; i < c.size; i++) {
      const startAngle = (i * 360) / c.size - 90;
      const endAngle = ((i + 1) * 360) / c.size - 90;
      const filled = i < c.filled;
      wedges.push(this.renderWedge(cx, cy, r, startAngle, endAngle, filled));
    }
    return html`<svg
      class="clock-strip-svg"
      width=${diameter}
      height=${diameter}
      viewBox="0 0 ${diameter} ${diameter}"
      aria-hidden="true"
    >
      ${wedges}
    </svg>`;
  }

  private renderWedge(
    cx: number,
    cy: number,
    r: number,
    startDeg: number,
    endDeg: number,
    filled: boolean
  ): TemplateResult {
    const start = this.polar(cx, cy, r, startDeg);
    const end = this.polar(cx, cy, r, endDeg);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    const path = `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
    return html`<path
      d=${path}
      class=${filled ? 'clock-strip-wedge-filled' : 'clock-strip-wedge-empty'}
    />`;
  }

  private polar(
    cx: number,
    cy: number,
    r: number,
    deg: number
  ): { x: number; y: number } {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  // -----------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------

  private handlePieClick(c: DmClockView, e: MouseEvent): void {
    const isFull = c.filled >= c.size;
    // Full clock + plain click toggles the local ack state; does
    // NOT emit a tick (the materializer would clamp the no-op
    // anyway, but emitting wastes a log entry).  Per UX-expert
    // pre-design: "Full clock = warm-red wedges + slow pulse
    // until DM clicks → acknowledged → 60% opacity."
    if (isFull && !e.shiftKey) {
      this.acknowledged = {
        ...this.acknowledged,
        [c.id]: this.acknowledged[c.id] !== true
      };
      return;
    }
    if (!this.onTick) return;
    const by = e.shiftKey ? -1 : 1;
    if (this.onTick(c.id, by)) {
      // If we just un-filled the clock, clear any ack (the clock
      // is "alive" again).
      if (c.filled + by < c.size && this.acknowledged[c.id]) {
        const next = { ...this.acknowledged };
        delete next[c.id];
        this.acknowledged = next;
      }
    }
  }

  private handleDelete(c: DmClockView): void {
    if (!this.onDelete) return;
    this.onDelete(c.id);
  }

  private startCreate(): void {
    this.creating = true;
    this.draftName = '';
    this.draftSize = 4;
  }

  private cancelCreate(): void {
    this.creating = false;
    this.draftName = '';
  }

  private submitCreate(): void {
    if (!this.onCreate) return;
    const name = this.draftName.trim();
    if (name.length === 0) return;
    if (this.onCreate(name, this.draftSize)) {
      this.cancelCreate();
    }
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'clock-strip': ClockStrip;
  }
}

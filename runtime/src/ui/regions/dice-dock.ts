/**
 * <dice-dock> — dice roller region (M2.6 — P1-4).
 *
 * Extracted from `QuireApp.renderRollPanel` during M2.6.  Renders
 * the roll input form + recent-roll history + error display.
 *
 * Per the design spec (ui.md), the Dock will eventually hold:
 *   - 6 stat chips (one-click pre-fill)
 *   - modifier stepper
 *   - last-3 pills
 *   - DM-only verbs (Reveal, Broadcast, scratch column)
 *
 * M2.6 keeps the existing single-input form unchanged so the visual
 * is identical to pre-extraction.  Future polish passes will add
 * stat chips + chip-driven pre-fill (M3a / M3b cockpit work).
 *
 * Light-DOM rendering: createRenderRoot returns this.  Legacy
 * .roll-form / .roll-history / .roll-error / .muted CSS continues
 * to apply via the QuireApp shadow cascade.
 *
 * Handlers stay on root: the component receives pre-computed
 * history entries (so it doesn't need access to displayNameFor or
 * the sessionView), rollDraft + rollError @state values, and
 * callback props for input changes + submit.  QuireApp's submitRoll
 * method stays on the root per the facade pattern.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface DiceHistoryEntry {
  key: string;
  label: string;
  /** CSS class like "roll-tier-hit" / "roll-tier-miss" for local rolls. */
  tierClass: string;
  /**
   * M3D-4: when the entry represents a 2d6 roll with doubles, the
   * UI surfaces a colored halo (red double-1s, gold double-6s) so
   * the DM doesn't miss the complication / positive beat.  The
   * caller (`QuireApp.renderRollPanel`) computes the flag from the
   * roll event's `dice: [a, b]` array.
   */
  doubles?: 'snake-eyes' | 'box-cars' | null;
}

/**
 * M3D-4: bounds on the inline modifier stepper.  Matches the
 * rules cap on stacked skill/tag bonuses
 * (`underleaf/world/rules.md` §Resolution).  A future
 * campaign-declared cap from `CampaignPrimaryRoll.modifierCap` will
 * pass via prop once the dice-Dock consumes the campaign manifest
 * (V-5 wire-through).  For now hardcoded to the engine default.
 */
const STEPPER_MIN = -2;
const STEPPER_MAX = 2;

@customElement('dice-dock')
export class DiceDock extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property() rollDraft: string = '';
  @property() rollError: string | null = null;
  @property({ attribute: false }) entries: DiceHistoryEntry[] = [];
  @property({ attribute: false }) onRollDraftChange:
    | ((value: string) => void)
    | null = null;
  @property({ attribute: false }) onSubmitRoll:
    | ((value: string) => void)
    | null = null;
  /**
   * M2.8 (P1-7): raise-hand affordance for the local player.  When
   * `handAvailable` is true (active session, local peer is a player
   * — not the DM), the dock renders a "Raise hand" / "Lower hand"
   * toggle.  `handRaised` reflects the local peer's current state.
   * `onToggleHand` invokes SessionController.toggleHand via the
   * QuireApp wrapper.
   */
  @property({ type: Boolean }) handAvailable: boolean = false;
  @property({ type: Boolean }) handRaised: boolean = false;
  @property({ attribute: false }) onToggleHand:
    | (() => void)
    | null = null;
  /**
   * M3a.6 (P-M3a-stat-chips): stat modifiers for the bound PC.
   * When provided, the dock renders 6 click-to-roll chips ABOVE
   * the dice form.  Each chip shows the stat label + modifier
   * (e.g. "STR +1") and on click sets the dice draft to
   * "2d6+<mod>", priming a Roll.  Quire's 2d6+stat resolution
   * (underleaf/world/rules.md) is the load-bearing reason this exists:
   * a new player who hasn't memorized the notation can roll
   * without composing a dice expression.
   *
   * `stats` is null when no PC is bound (chips hidden).
   */
  @property({ attribute: false }) stats: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  } | null = null;

  /**
   * M3D-4: inline modifier offset applied to the next chip roll
   * (skill/tag bonus, harm/stress penalty, situational modifier).
   * Bounded [STEPPER_MIN, STEPPER_MAX] per the rules cap.  Resets
   * to 0 after each roll so the offset doesn't carry forward by
   * surprise; the DM/player re-applies it deliberately.
   */
  @state() private modifierOffset: number = 0;

  private bumpOffset(delta: number): void {
    const next = this.modifierOffset + delta;
    if (next < STEPPER_MIN || next > STEPPER_MAX) return;
    this.modifierOffset = next;
  }

  private resetOffset(): void {
    this.modifierOffset = 0;
  }

  override render(): TemplateResult {
    return html`
      <section class="card">
        <h2>Dice</h2>
        ${this.stats ? this.renderStatChips() : nothing}
        <form
          class="roll-form"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.onSubmitRoll?.(this.rollDraft);
          }}
        >
          <label>
            <span class="roll-label">/roll</span>
            <input
              type="text"
              .value=${this.rollDraft}
              placeholder="2d6+1"
              aria-label="Dice expression"
              @input=${(e: Event) =>
                this.onRollDraftChange?.(
                  (e.target as HTMLInputElement).value
                )}
            />
          </label>
          <button type="submit">Roll</button>
          ${this.handAvailable
            ? html`<button
                type="button"
                class="raise-hand ${this.handRaised
                  ? 'raise-hand-active'
                  : ''}"
                aria-label=${this.handRaised
                  ? 'Lower hand'
                  : 'Raise hand'}
                title=${this.handRaised
                  ? 'Lower hand'
                  : 'Raise hand'}
                @click=${() => this.onToggleHand?.()}
              >
                ✋ ${this.handRaised ? 'Lower' : 'Raise'}
              </button>`
            : nothing}
        </form>
        ${this.rollError
          ? html`<p class="roll-error">${this.rollError}</p>`
          : nothing}
        ${this.entries.length
          ? html`
              <ul class="roll-history">
                ${this.entries.map((e) => {
                  const doublesClass =
                    e.doubles === 'snake-eyes'
                      ? ' roll-doubles-snake-eyes'
                      : e.doubles === 'box-cars'
                        ? ' roll-doubles-box-cars'
                        : '';
                  return html`<li>
                    <code class="${e.tierClass}${doublesClass}">${e.label}</code>
                  </li>`;
                })}
              </ul>
            `
          : html`<p class="muted">No rolls yet.</p>`}
      </section>
    `;
  }

  private renderStatChips(): TemplateResult {
    const s = this.stats!;
    const formatMod = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
    const offset = this.modifierOffset;
    const chip = (
      label: string,
      key: keyof NonNullable<typeof this.stats>
    ): TemplateResult => {
      const mod = s[key];
      const totalMod = mod + offset;
      const expr = totalMod === 0 ? '2d6' : `2d6${formatMod(totalMod)}`;
      const summary =
        offset === 0
          ? `Roll ${expr} (${label} check)`
          : `Roll ${expr} (${label} ${formatMod(mod)} + ${formatMod(offset)} situational)`;
      return html`<button
        type="button"
        class="dice-stat-chip"
        title=${summary}
        aria-label=${summary}
        @click=${() => {
          this.onRollDraftChange?.(expr);
          this.onSubmitRoll?.(expr);
          // M3D-4: reset the offset after rolling so it doesn't
          // silently carry into the next roll.  TTRPG-craft norm:
          // situational modifiers are per-roll, not persistent.
          this.resetOffset();
        }}
      >
        <span class="dice-stat-label">${label}</span>
        <span class="dice-stat-mod">${formatMod(mod)}</span>
      </button>`;
    };
    return html`
      <div class="dice-stat-chips">
        ${chip('STR', 'str')} ${chip('DEX', 'dex')} ${chip('CON', 'con')}
        ${chip('INT', 'int')} ${chip('WIS', 'wis')} ${chip('CHA', 'cha')}
      </div>
      ${this.renderModifierStepper(formatMod)}
    `;
  }

  /**
   * M3D-4: inline modifier stepper.  Bounded ±2 (engine default;
   * future V-5 wire-through honors campaign-declared bounds).  The
   * label shows the current offset; − / + buttons adjust.  Applied
   * to the NEXT chip roll, then auto-resets.
   *
   * Per ui.md L156 + TTRPG-expert recommendation, the stepper is
   * always visible so a DM/player who needs a +1 from a skill or
   * tag (or a -1 from harm) can adjust before clicking a chip.
   */
  private renderModifierStepper(
    formatMod: (n: number) => string
  ): TemplateResult {
    const offset = this.modifierOffset;
    return html`
      <div class="dice-modifier-stepper" role="group" aria-label="Roll modifier">
        <button
          type="button"
          class="dice-modifier-step dice-modifier-step-minus"
          ?disabled=${offset <= STEPPER_MIN}
          aria-label="Decrease modifier"
          title="Modifier −1 (current: ${formatMod(offset)})"
          @click=${() => this.bumpOffset(-1)}
        >
          −
        </button>
        <span
          class="dice-modifier-value ${offset !== 0
            ? 'dice-modifier-value-active'
            : ''}"
          aria-live="polite"
          title=${offset === 0
            ? 'No situational modifier'
            : `Situational modifier ${formatMod(offset)} (applied to next chip roll, then resets)`}
        >
          ${formatMod(offset)}
        </span>
        <button
          type="button"
          class="dice-modifier-step dice-modifier-step-plus"
          ?disabled=${offset >= STEPPER_MAX}
          aria-label="Increase modifier"
          title="Modifier +1 (current: ${formatMod(offset)})"
          @click=${() => this.bumpOffset(1)}
        >
          +
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dice-dock': DiceDock;
  }
}

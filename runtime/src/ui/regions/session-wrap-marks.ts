// @vitest-environment happy-dom

/**
 * <session-wrap-marks> — Phase B P5 (2026-05-26) end-of-session
 * roster sheet.  At wrap time, the DM walks through each
 * bound-active PC and ticks the 5 advancement-mark bullets
 * (rules.md:149-154) the player earned this session.  When a PC
 * accumulates 5 ticked bullets, the next session they pick an
 * advancement and the bullets reset (rules.md:157-164).
 *
 * Five bullets per the rules:
 *   - hardMoment    — "resolved a hard moment in alignment"
 *   - learned       — "learned something about themselves or the world"
 *   - risk          — "took a risk for someone else"
 *   - against       — "acted against short-term interest"
 *   - complication  — "a complication came back to bite them"
 *
 * Surface shows one card per PC with:
 *   - PC name + dominant-stat label
 *   - 5 labeled checkboxes for the bullets
 *   - Cumulative-marks counter ("3/5 marks → 2 more for advancement")
 *
 * Per the planning-expert P1d verdict: 5 checkboxes inline, no
 * dedicated child component.  Component is a thin host that
 * iterates PCs and renders the bullet rows.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import {
  ADVANCEMENT_MARK_BULLET_KEYS,
  countAdvancementMarks,
  type CharacterRecord,
  type AdvancementMarkBullets
} from '../../character-loader';

const BULLET_KEYS = ADVANCEMENT_MARK_BULLET_KEYS;

const BULLET_LABEL: Record<keyof AdvancementMarkBullets, string> = {
  hardMoment: 'Resolved a hard moment in alignment',
  learned: 'Learned something about themselves or the world',
  risk: 'Took a risk for someone else',
  against: 'Acted against short-term interest',
  complication: 'A complication came back to bite them'
};

export interface WrapMarksPcEntry {
  pcId: string;
  name: string;
  bullets: AdvancementMarkBullets;
}

export type SetMarkBulletCallback = (
  pcId: string,
  bullet: keyof AdvancementMarkBullets,
  value: boolean
) => void;

/**
 * Optional "back to play" exit callback the DM clicks to leave the
 * wrap sheet and return to the active session.  When null, no exit
 * button renders; the host handles navigation elsewhere.
 */
export type ExitWrapMarksCallback = () => void;

const countTicked = countAdvancementMarks;

@customElement('session-wrap-marks')
export class SessionWrapMarks extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) pcs: WrapMarksPcEntry[] = [];

  @property({ attribute: false }) onSetMarkBullet:
    | SetMarkBulletCallback
    | null = null;

  @property({ attribute: false }) onExit: ExitWrapMarksCallback | null = null;

  override render(): TemplateResult {
    return html`
      <section class="card session-wrap-marks">
        <header class="session-wrap-marks-head">
          <h2>Session wrap — advancement marks</h2>
          <p class="muted">
            Tick the bullets each PC earned this session.  At 5
            ticks, the PC picks an advancement at the start of
            next session and the bullets reset.
          </p>
          ${this.onExit
            ? html`<button
                type="button"
                class="session-wrap-marks-exit"
                @click=${() => this.onExit?.()}
              >
                Done — back to session
              </button>`
            : nothing}
        </header>
        ${this.pcs.length === 0
          ? html`<p class="muted">No active PCs.</p>`
          : html`<ol class="session-wrap-marks-list">
              ${this.pcs.map((entry) => this.renderPcCard(entry))}
            </ol>`}
      </section>
    `;
  }

  private renderPcCard(entry: WrapMarksPcEntry): TemplateResult {
    const ticked = countTicked(entry.bullets);
    const remainingForAdvancement = Math.max(0, 5 - ticked);
    const advancementReady = ticked >= 5;
    return html`<li class="session-wrap-marks-pc">
      <header class="session-wrap-marks-pc-head">
        <strong>${entry.name}</strong>
        <span
          class="session-wrap-marks-counter ${advancementReady
            ? 'session-wrap-marks-counter-ready'
            : ''}"
          >${ticked}/5
          ${advancementReady
            ? ' — advancement ready'
            : ` — ${remainingForAdvancement} more`}
        </span>
      </header>
      <ul class="session-wrap-marks-bullets">
        ${BULLET_KEYS.map((key) =>
          this.renderBullet(entry.pcId, key, entry.bullets[key] === true)
        )}
      </ul>
    </li>`;
  }

  private renderBullet(
    pcId: string,
    key: keyof AdvancementMarkBullets,
    checked: boolean
  ): TemplateResult {
    const editable = this.onSetMarkBullet !== null;
    return html`<li class="session-wrap-marks-bullet">
      <label
        class="session-wrap-marks-bullet-label ${checked
          ? 'session-wrap-marks-bullet-checked'
          : ''}"
      >
        <input
          type="checkbox"
          ?checked=${checked}
          ?disabled=${!editable}
          @change=${(e: Event) =>
            this.onSetMarkBullet?.(
              pcId,
              key,
              (e.target as HTMLInputElement).checked
            )}
        />
        <span>${BULLET_LABEL[key]}</span>
      </label>
    </li>`;
  }
}

/**
 * Build a WrapMarksPcEntry array from a record map.  Exported for
 * test fixtures + the host adapter; pure data transformation.
 */
export function buildWrapMarksEntries(
  records: Record<string, CharacterRecord>,
  bulletsByPcId: Record<string, AdvancementMarkBullets>,
  pcIds: string[]
): WrapMarksPcEntry[] {
  const out: WrapMarksPcEntry[] = [];
  for (const pcId of pcIds) {
    const record = records[pcId];
    if (!record) continue;
    const name = typeof record.name === 'string' ? record.name : pcId;
    const bullets = bulletsByPcId[pcId] ?? {};
    out.push({ pcId, name, bullets });
  }
  return out;
}

declare global {
  interface HTMLElementTagNameMap {
    'session-wrap-marks': SessionWrapMarks;
  }
}

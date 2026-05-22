/**
 * <player-rail> — character-sheet region (M2.3 — P1-1).
 *
 * Extracted from `QuireApp.renderCharacter` / `renderStatBlock` /
 * `renderTrackBoxes` during the M2 facade-migration.  Renders the
 * character sheet (PC or NPC, route-driven at M2) for the
 * currently-loaded character.
 *
 * Light-DOM rendering: `createRenderRoot()` returns `this` so the
 * legacy CSS in `src/ui/styles/quire-app.css.ts` (still applied to
 * QuireApp's shadow root) continues to style the sheet via the
 * normal cascade.  When M3+ polishes the visual treatment to use
 * the design tokens, the component can move to shadow DOM with
 * scoped styles.
 *
 * Handlers stay on root per the facade-migration pattern: this
 * component receives `onBumpStat` / `onToggleTrackBox` / `onNavigate`
 * callbacks as properties and invokes them on user interaction.
 * QuireApp's `bumpStat` / `toggleTrackBox` / `navigate` methods
 * stay where they are, preserving the existing test surface
 * (quire-app.pc-edit.test.ts asserts state mutations on QuireApp).
 *
 * Roll-panel rendering stays on QuireApp at M2.3 — M2.6 (dice-dock)
 * will relocate it to the Dock slot of the shell.  The roll panel
 * is currently invoked *outside* `<player-rail>` by QuireApp's
 * renderCharacter wrapper so that intermediate behavior is
 * preserved.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { LoadedCharacter, CharacterRecord } from '../../character-loader';
import {
  HARM_MAX,
  STRESS_MAX,
  STAT_MIN,
  STAT_MAX
} from '../../character-edits';
import {
  renderMarkdown,
  substitutePcSlots,
  type PcSlotBindings
} from '../../markdown';
import { routeToSearch, type AppRoute } from '../../routing';

function formatStat(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

type StatKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type BumpStatCallback = (
  pcId: string,
  key: StatKey,
  current: number,
  delta: number
) => void;

export type ToggleTrackBoxCallback = (
  pcId: string,
  field: 'harm' | 'stress',
  box: number,
  current: number
) => void;

export type NavigateCallback = (e: Event, route: AppRoute) => void;

@customElement('player-rail')
export class PlayerRail extends LitElement {
  // Light-DOM rendering so the legacy quireAppStyles cascade applies.
  // See file header for rationale.  When this region migrates to
  // shadow DOM in a later polish pass, restore the default behavior
  // (delete this method) and add a `static styles` with the relevant
  // CSS rules copied from quire-app.css.ts.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) character: LoadedCharacter | null = null;
  @property({ attribute: false }) effective: CharacterRecord | null = null;
  @property() campaignName: string = '';
  @property() campaignSlug: string = '';
  @property({ type: Boolean }) editable: boolean = false;
  @property({ attribute: false }) onBumpStat: BumpStatCallback | null = null;
  @property({ attribute: false }) onToggleTrackBox: ToggleTrackBoxCallback | null = null;
  @property({ attribute: false }) onNavigate: NavigateCallback | null = null;
  /**
   * M3a.2 (P-M3a-pc-binding): claim affordances.  When a PC is
   * displayed in an active session, the local player can claim it
   * as their bound character.  `claimState` describes the current
   * binding:
   *   'unclaimable' — no session, or this is an NPC, or local
   *                   peer can't claim (DM-only scenario).  No
   *                   button rendered.
   *   'unclaimed'   — no peer is bound to this PC; local peer can
   *                   claim it (primary action).
   *   'mine'        — this PC is the local peer's bound character.
   *                   Shows "Release" affordance (clears pcId).
   *   'taken'       — another peer has claimed this PC.  Shows a
   *                   readout ("Played by <name>") and a "Switch
   *                   to playing X" button — confirmation TBD in
   *                   M3a.6 polish (M3a.2 ships the data binding,
   *                   not the conflict-resolution UX).
   */
  @property() claimState: 'unclaimable' | 'unclaimed' | 'mine' | 'taken' =
    'unclaimable';
  /** Display name of the peer who claimed this PC (when claimState='taken'). */
  @property() claimedBy: string = '';
  /** Fires when the local peer wants to claim / release this PC. */
  @property({ attribute: false }) onToggleClaim:
    | (() => void)
    | null = null;
  /**
   * M3c-polish: `{{pc:N}}` slot substitution map for the
   * character's description + backstory.  Empty by default;
   * unbound slots fall back to the literal `PC<N>` form.
   */
  @property({ attribute: false }) pcSlotBindings: PcSlotBindings = {};

  override render(): TemplateResult {
    const character = this.character;
    const r = this.effective;
    if (!character || !r) return html``;
    const kindLabel = character.kind === 'pc' ? 'PC' : 'NPC';
    const editable = this.editable;
    return html`
      <header>
        <nav class="breadcrumb">
          <a
            href=${routeToSearch({ kind: 'campaign', slug: this.campaignSlug })}
            @click=${(e: Event) =>
              this.onNavigate?.(e, { kind: 'campaign', slug: this.campaignSlug })}
            >${this.campaignName}</a
          >
          → ${kindLabel}
        </nav>
        <h1>${r.name}</h1>
        ${r.pronouns
          ? html`<p class="summary">${r.pronouns}</p>`
          : nothing}
        ${this.renderClaimAffordance()}
      </header>
      <section class="card">
        <h2>Details</h2>
        <dl>
          ${r.role ? html`<dt>Role</dt><dd>${r.role}</dd>` : nothing}
          ${r.disposition
            ? html`<dt>Disposition</dt><dd>${r.disposition}</dd>`
            : nothing}
          ${r.alignment
            ? html`<dt>Alignment</dt><dd>${r.alignment}</dd>`
            : nothing}
          ${typeof r.harm === 'number' || editable
            ? html`
                <dt>Harm</dt>
                <dd>${this.renderTrackBoxes(
                  'harm',
                  r.harm ?? 0,
                  HARM_MAX,
                  character.id,
                  editable
                )}</dd>
              `
            : nothing}
          ${typeof r.stress === 'number' || editable
            ? html`
                <dt>Stress</dt>
                <dd>${this.renderTrackBoxes(
                  'stress',
                  r.stress ?? 0,
                  STRESS_MAX,
                  character.id,
                  editable
                )}</dd>
              `
            : nothing}
        </dl>
        ${r.stats || editable
          ? this.renderStatBlock(
              r.stats ?? {},
              editable ? character.id : null
            )
          : nothing}
        ${r.skills?.length
          ? html`
              <h3>Skills</h3>
              <ul>
                ${r.skills.map((s) => html`<li>${s}</li>`)}
              </ul>
            `
          : nothing}
        ${r.tags?.length
          ? html`
              <h3>Tags</h3>
              <ul>
                ${r.tags.map((t) => html`<li>${t}</li>`)}
              </ul>
            `
          : nothing}
        ${r.foci?.length
          ? html`
              <h3>Foci</h3>
              <ul>
                ${r.foci.map(
                  (f) => html`
                    <li>
                      <strong>${f.name}</strong>${f.domain
                        ? html` — ${f.domain}`
                        : nothing}${f.condition
                        ? html` (${f.condition})`
                        : nothing}
                    </li>
                  `
                )}
              </ul>
            `
          : nothing}
        ${r.signature?.length
          ? html`
              <h3>Signature</h3>
              <ul>
                ${r.signature.map((s) => html`<li>${s}</li>`)}
              </ul>
            `
          : nothing}
        ${r.voice ? html`<h3>Voice</h3><p>${r.voice}</p>` : nothing}
      </section>
      ${r.description
        ? html`
            <section class="card">
              <h2>Description</h2>
              <div class="markdown">
                ${unsafeHTML(substitutePcSlots(renderMarkdown(r.description), this.pcSlotBindings))}
              </div>
            </section>
          `
        : nothing}
      ${r.backstory
        ? html`
            <section class="card">
              <h2>Backstory</h2>
              <div class="markdown">
                ${unsafeHTML(substitutePcSlots(renderMarkdown(r.backstory), this.pcSlotBindings))}
              </div>
            </section>
          `
        : nothing}
    `;
  }

  private renderClaimAffordance(): TemplateResult | typeof nothing {
    switch (this.claimState) {
      case 'unclaimable':
        return nothing;
      case 'unclaimed':
        return html`
          <p class="pc-claim">
            <button
              type="button"
              class="pc-claim-button"
              @click=${() => this.onToggleClaim?.()}
            >
              Claim this character
            </button>
          </p>
        `;
      case 'mine':
        return html`
          <p class="pc-claim pc-claim-mine">
            <span class="pc-claim-tag">Your character</span>
            <button
              type="button"
              class="pc-claim-button"
              @click=${() => this.onToggleClaim?.()}
            >
              Release
            </button>
          </p>
        `;
      case 'taken':
        return html`
          <p class="pc-claim pc-claim-taken">
            <span class="pc-claim-tag">
              Played by ${this.claimedBy || 'another player'}
            </span>
            <button
              type="button"
              class="pc-claim-button"
              @click=${() => this.onToggleClaim?.()}
            >
              Take over
            </button>
          </p>
        `;
    }
  }

  private renderStatBlock(
    stats: Partial<Record<StatKey, number>>,
    editablePcId: string | null
  ): TemplateResult {
    const rows: Array<[string, StatKey, number | undefined]> = [
      ['STR', 'str', stats.str],
      ['DEX', 'dex', stats.dex],
      ['CON', 'con', stats.con],
      ['INT', 'int', stats.int],
      ['WIS', 'wis', stats.wis],
      ['CHA', 'cha', stats.cha]
    ];
    return html`
      <h3>Stats</h3>
      <dl class="stat-grid">
        ${rows.map(
          ([label, key, val]) => html`
            <dt>${label}</dt>
            <dd>
              ${typeof val === 'number' ? formatStat(val) : '—'}
              ${editablePcId
                ? html`
                    <span class="stat-bumpers">
                      <button
                        type="button"
                        aria-label="Decrease ${label}"
                        ?disabled=${typeof val === 'number' && val <= STAT_MIN}
                        @click=${() =>
                          this.onBumpStat?.(editablePcId, key, val ?? 0, -1)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label="Increase ${label}"
                        ?disabled=${typeof val === 'number' && val >= STAT_MAX}
                        @click=${() =>
                          this.onBumpStat?.(editablePcId, key, val ?? 0, +1)}
                      >
                        +
                      </button>
                    </span>
                  `
                : nothing}
            </dd>
          `
        )}
      </dl>
    `;
  }

  private renderTrackBoxes(
    field: 'harm' | 'stress',
    current: number,
    max: number,
    pcId: string,
    editable: boolean
  ): TemplateResult {
    const boxes: TemplateResult[] = [];
    for (let i = 1; i <= max; i++) {
      const filled = i <= current;
      boxes.push(
        editable
          ? html`<button
              type="button"
              class="track-box ${filled ? 'track-box-filled' : ''}"
              aria-label="${field} box ${i}, ${filled ? 'filled' : 'empty'}"
              @click=${() =>
                this.onToggleTrackBox?.(pcId, field, i, current)}
            >
              ${filled ? '■' : '□'}
            </button>`
          : html`<span
              class="track-box ${filled ? 'track-box-filled' : ''}"
              aria-label="${field} box ${i}, ${filled ? 'filled' : 'empty'}"
            >
              ${filled ? '■' : '□'}
            </span>`
      );
    }
    return html`<span class="track-boxes">${boxes} <span class="track-count">${current}/${max}</span></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'player-rail': PlayerRail;
  }
}

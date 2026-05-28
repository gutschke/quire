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
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import {
  countAdvancementMarks,
  type LoadedCharacter,
  type CharacterRecord
} from '../../character-loader';
import {
  HARM_MAX,
  STRESS_MAX
} from '../../character-edits';
import {
  renderMarkdown,
  substitutePcSlots,
  type PcSlotBindings
} from '../../markdown';
import { routeToSearch } from '../../routing';
import '../field-renderers/track-bar';
import '../field-renderers/stat-grid';
import '../field-renderers/foci-card';
import '../field-renderers/bonds-card';
import type { BondsCardEntry } from '../field-renderers/bonds-card';
import '../field-renderers/conditions-list';
import '../field-renderers/money-band-selector';

// Wave C3 (2026-05-26): import + re-export shared BumpStatCallback.
import type { BumpStatCallback } from '../callback-types';
export type { BumpStatCallback };

export type ToggleTrackBoxCallback = (
  pcId: string,
  field: 'harm' | 'stress',
  box: number,
  current: number
) => void;

/**
 * Phase B P1d (2026-05-26): cleaner track-set callback used by the
 * `<track-bar>` component.  Component computes the new fill level
 * internally (click box i when current = v → next per the
 * toggle-fill rules in track-bar.ts) and fires this callback with
 * the resolved value.  Caller just dispatches the pc-edit.  The
 * legacy `ToggleTrackBoxCallback` stays for callers that still
 * need the (box, current) signature.
 */
export type SetTrackValueCallback = (
  pcId: string,
  field: 'harm' | 'stress',
  value: number
) => void;

import type { NavigateCallback } from '../callback-types';
export type { NavigateCallback };

/**
 * P-R7 (2026-05-25): one entry in the player-rail name-row
 * switcher dropdown.  The list is computed by the host
 * (quire-app) from filteredShared so player-bound viewers never
 * see PCs they shouldn't know about.
 */
export interface SwitcherEntry {
  pcId: string;
  name: string;
  /** True when this is the local player's CURRENT bound PC. */
  isCurrent: boolean;
  /** True when this PC is bound by ANOTHER live peer (take-over). */
  takenBy?: string;
}

export type SwitchToPcCallback = (pcId: string) => void;

/**
 * P-R11 (2026-05-25): submit a retire request to the DM.  Receives
 * the in-fiction reason + the RetireReason enum; returns true when
 * the request was appended (false outside an active session or for
 * a viewer with no bound PC).
 */
export type RequestRetireCallback = (
  reason: 'died' | 'departed' | 'converted-to-npc' | 'other',
  inFictionReason: string
) => boolean;

/**
 * P-R11: the player-visible pip state for the retire-request flow.
 *   - 'none'     — no pending request (hide pip, show submit affordance)
 *   - 'pending'  — request submitted; waiting for DM
 *   - 'declined' — DM rejected; show note + re-submit affordance
 */
export interface RetireRequestPip {
  status: 'none' | 'pending' | 'declined';
  /** DM's note when status='declined' (player-safe). */
  note?: string;
}

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
  /**
   * Phase B P1d (2026-05-26): cleaner callback wired to the
   * `<track-bar>` component's `onSetValue`.  Receives the
   * already-resolved new fill level.  When set, the rail uses
   * `<track-bar>` instead of the legacy inline track-box renderer.
   * Both callbacks can co-exist during the migration window;
   * track-bar wiring prefers `onSetTrackValue` when available.
   */
  @property({ attribute: false }) onSetTrackValue:
    | SetTrackValueCallback
    | null = null;
  /**
   * Phase B P1d (2026-05-26): callback for the `<foci-card>` status
   * cycle button.  Host translates this into a focus-status pc-edit
   * (or AI-write proposal).  Today the chargen + pc-edit flows don't
   * yet support array writes on `foci`, so a host might NO-OP this
   * until that surface lands; the component still cycles visually.
   */
  @property({ attribute: false }) onSetFocusStatus:
    | import('../field-renderers/foci-card').SetFocusStatusCallback
    | null = null;
  /**
   * Phase B P4 (2026-05-26): callback for releasing a condition.
   * Host translates into a future array-write pc-edit when that
   * lands; today's host can NO-OP and the chip still highlights
   * visually.
   */
  @property({ attribute: false }) onReleaseCondition:
    | import('../field-renderers/conditions-list').ReleaseConditionCallback
    | null = null;
  /**
   * Phase B P4 (2026-05-26): callback for changing the money band.
   * Host wires to a pc-edit('moneyBand', value).  When null, the
   * money-band-selector renders read-only.
   */
  @property({ attribute: false }) onSetMoneyBand:
    | import('../field-renderers/money-band-selector').SetMoneyBandCallback
    | null = null;
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
  /**
   * P-R7 (2026-05-25): PCs the local peer can switch to without
   * leaving the rail.  Hosts compute this from filteredShared so
   * the spoiler firewall stays intact (PCs hidden from the player
   * by the viewer-scope projection never appear here).
   *
   * Empty array → no chevron, h1 renders as plain text (current
   * behavior preserved when there's nothing to switch to).  Single
   * entry === only this PC → no chevron either.  Two-or-more
   * entries → name-row gets the ▾ affordance.
   *
   * Use cases per task #284 — M-pc-incapacitated (player's main
   * PC is down this scene, switch to a fallback) and M-double-up
   * (one peer rotating between two PCs they've agreed to play).
   * Each switch dispatches the existing peer-rename(pcId) — no
   * engine change required.
   */
  @property({ attribute: false }) switcherEntries: SwitcherEntry[] = [];
  @property({ attribute: false }) onSwitchToPc: SwitchToPcCallback | null =
    null;

  /**
   * P-R7: open/closed state for the switcher dropdown.  Local @state
   * so successive opens don't ping the host; closes on selection +
   * on Escape via the keydown handler attached during render.
   */
  @state() private switcherOpen = false;
  /**
   * P-R11 (2026-05-25): player retire-request pip + submit affordance.
   * Hosts populate `retirePip` from filteredShared.pcRetireRequests +
   * pcRetireRejections (filtered to the local peer + bound pcId) so
   * the data flow stays inside the existing viewer-scope.  When null
   * the entire surface is hidden (DM view, NPC sheet, no session).
   */
  @property({ attribute: false }) retirePip: RetireRequestPip | null = null;
  /**
   * D5 (2026-05-27): per-PC ratified bonds for THIS PC.
   * Adapted by the host from `state.pcBonds[character.id]` +
   * targetLabel lookups against `synthesizedPcs`.  Empty/null =
   * no bonds card rendered.
   */
  @property({ attribute: false }) bonds: BondsCardEntry[] = [];
  /**
   * D5-C-fix (2026-05-27 scenario-playthrough UX-1): pending bond
   * proposal count for THIS PC.  Surfaces "N awaiting DM review"
   * to the local player so a freshly-submitted proposal isn't a
   * silent void.  Host counts via `pcBondProposals[pcId].length`
   * — though filterForViewer wipes that map for non-coord, the
   * host can read it from `v.shared` when the local peer
   * controls the seat (player sees their own pending count).
   */
  @property({ attribute: false }) pendingBondProposalCount: number = 0;
  /**
   * D5 (2026-05-27): inline-add affordance.  When set, the bonds
   * card shows a "Propose bond" form.  Host wires to
   * `QuireApp.proposeBond`.
   */
  @property({ attribute: false }) onProposeBond:
    | ((targetPcId: string, text: string) => void)
    | null = null;
  /**
   * D5 (2026-05-27): list of other PCs this PC can bond to (id +
   * display name).  Used by the propose-bond form's target picker.
   */
  @property({ attribute: false }) bondTargetCandidates: Array<{
    pcId: string;
    name: string;
  }> = [];
  @property({ attribute: false }) onRequestRetire:
    | RequestRetireCallback
    | null = null;
  /**
   * P-R11: inline-form @state — kept local so the host doesn't see
   * the partial draft.  Opens via the "Request retire" button, closes
   * on submit / cancel.
   */
  @state() private retireFormOpen = false;
  /** D5 (2026-05-27): bond-propose inline-form state. */
  @state() private bondFormOpen = false;
  @state() private bondFormTarget = '';
  @state() private bondFormText = '';
  @state() private retireFormReason: 'died' | 'departed' | 'converted-to-npc' | 'other' =
    'departed';
  @state() private retireFormText = '';
  /**
   * P-R7 take-over inline confirm.  When the player clicks an
   * entry owned by another peer, we don't immediately fire the
   * switch — we replace the row with a "Confirm take-over from
   * <name>" button.  Tracks which pcId is in the confirm state
   * so a second click commits.  Closes the menu on commit or on
   * a click outside the confirming entry.
   */
  @state() private takeOverConfirmPcId: string | null = null;

  /**
   * D5-C-fix (2026-05-27 scenario-playthrough UX-7): draft-leak
   * guard for the bond compose form @state when the rendered
   * `character` prop changes (PC switch via name-row switcher).
   * Without this, Bob typing on Mei → opens switcher → picks
   * Iris would land Iris's bonds-card with Mei-context draft text
   * pre-loaded + a `bondFormTarget` pcId that may not be in
   * Iris's candidate list.  Third strike of practice-memo rule
   * #2 (draft-leak across data-identity changes); mirrors the
   * Wave C5 magic-arc-controls willUpdate hook.
   */
  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('character')) {
      const prior = changed.get('character') as LoadedCharacter | null;
      const next = this.character;
      const priorId = prior?.id;
      const nextId = next?.id;
      if (priorId !== undefined && nextId !== undefined && priorId !== nextId) {
        this.bondFormOpen = false;
        this.bondFormTarget = '';
        this.bondFormText = '';
      }
    }
  }

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
        ${this.renderNameRow(r.name)}
        ${r.pronouns
          ? html`<p class="summary">${r.pronouns}</p>`
          : nothing}
        ${this.renderClaimAffordance()}
        ${this.renderRetireRequest()}
      </header>
      ${character.kind === 'pc' ? this.renderAdvancementSignal(r) : nothing}
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
                <dd>
                  ${this.onSetTrackValue
                    ? html`<track-bar
                        .kind=${'harm' as const}
                        .value=${r.harm ?? 0}
                        .editable=${editable}
                        .onSetValue=${(newValue: number) =>
                          this.onSetTrackValue?.(
                            character.id,
                            'harm',
                            newValue
                          )}
                      ></track-bar>`
                    : this.renderTrackBoxes(
                        'harm',
                        r.harm ?? 0,
                        HARM_MAX,
                        character.id,
                        editable
                      )}
                </dd>
              `
            : nothing}
          ${typeof r.stress === 'number' || editable
            ? html`
                <dt>Stress</dt>
                <dd>
                  ${this.onSetTrackValue
                    ? html`<track-bar
                        .kind=${'stress' as const}
                        .value=${r.stress ?? 0}
                        .editable=${editable}
                        .onSetValue=${(newValue: number) =>
                          this.onSetTrackValue?.(
                            character.id,
                            'stress',
                            newValue
                          )}
                      ></track-bar>`
                    : this.renderTrackBoxes(
                        'stress',
                        r.stress ?? 0,
                        STRESS_MAX,
                        character.id,
                        editable
                      )}
                </dd>
              `
            : nothing}
        </dl>
        ${r.stats || editable
          ? html`<stat-grid
              .stats=${r.stats ?? {}}
              .editablePcId=${editable ? character.id : null}
              .onBumpStat=${this.onBumpStat}
            ></stat-grid>`
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
          ? html`<foci-card
              .foci=${r.foci}
              .editablePcId=${editable ? character.id : null}
              .onSetFocusStatus=${this.onSetFocusStatus}
              ?hideBoundFor=${true}
            ></foci-card>`
          : nothing}
        ${this.bonds.length > 0 ||
        (editable && this.onProposeBond !== null)
          ? html`<bonds-card
              .bonds=${this.bonds}
              .editablePcId=${null}
              .pendingProposalCount=${this.pendingBondProposalCount}
            ></bonds-card>
            ${editable && this.onProposeBond !== null
              ? this.renderProposeBondForm(character.id)
              : nothing}`
          : nothing}
        ${r.conditions?.length
          ? html`<conditions-list
              .conditions=${r.conditions}
              .editablePcId=${editable ? character.id : null}
              .onRelease=${this.onReleaseCondition}
            ></conditions-list>`
          : nothing}
        ${r.languages?.length
          ? html`
              <h3>Languages</h3>
              <ul class="player-rail-language-chips">
                ${r.languages.map(
                  (l) => html`<li class="player-rail-language-chip">${l}</li>`
                )}
              </ul>
            `
          : nothing}
        ${r.moneyBand
          ? html`<money-band-selector
              .value=${r.moneyBand}
              .editablePcId=${editable ? character.id : null}
              .onSetBand=${this.onSetMoneyBand}
            ></money-band-selector>`
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

  /**
   * P-R7: name row.  Plain `<h1>` when no switcher is available;
   * `<h1>` + chevron-button + dropdown when 2+ switchable PCs are
   * known to the host.  Clicking the chevron toggles the dropdown;
   * clicking an entry fires `onSwitchToPc` and closes the dropdown.
   * Escape also closes.  Plain-text fallback when `onSwitchToPc`
   * is null (a player view that doesn't wire the switcher).
   */
  private renderNameRow(name: string): TemplateResult {
    const entries = this.switcherEntries;
    const canSwitch = !!this.onSwitchToPc && entries.length >= 2;
    if (!canSwitch) {
      return html`<h1>${name}</h1>`;
    }
    return html`
      <div class="player-rail-name-row">
        <h1>${name}</h1>
        <button
          type="button"
          class="player-rail-name-switcher"
          aria-haspopup="listbox"
          aria-expanded=${this.switcherOpen ? 'true' : 'false'}
          aria-label="Switch character"
          title="Switch character"
          @click=${() => {
            this.switcherOpen = !this.switcherOpen;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Escape') this.switcherOpen = false;
          }}
        >
          ▾
        </button>
        ${this.switcherOpen
          ? html`<ul
              class="player-rail-name-menu"
              role="listbox"
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Escape') this.switcherOpen = false;
              }}
            >
              ${entries.map((entry) => this.renderSwitcherEntry(entry))}
            </ul>`
          : nothing}
      </div>
    `;
  }

  /**
   * P-R7: render one entry in the switcher dropdown.  Three shapes:
   *
   *   - Current PC: disabled "current" tag.
   *   - Unclaimed other PC: plain "Switch to <name>" button.
   *   - Claimed by another peer + not yet confirming: shows
   *     "Take over from <peer>" button; click puts the entry in
   *     the confirm state.
   *   - Claimed by another peer + currently confirming: shows the
   *     red "Confirm take-over from <peer>" button; second click
   *     commits the switch.  Per TTRPG-R7 verdict, inline-affirm
   *     instead of a modal — the take-over is a deliberate
   *     two-step action without breaking the player's focus.
   */
  private renderSwitcherEntry(entry: SwitcherEntry): TemplateResult {
    const isTakenByOther = !!entry.takenBy && !entry.isCurrent;
    const isConfirming =
      isTakenByOther && this.takeOverConfirmPcId === entry.pcId;
    return html`<li
      class="player-rail-name-menu-item ${entry.isCurrent
        ? 'player-rail-name-menu-item-current'
        : ''} ${isConfirming
        ? 'player-rail-name-menu-item-confirming'
        : ''}"
      role="option"
      aria-selected=${entry.isCurrent ? 'true' : 'false'}
    >
      <button
        type="button"
        class="player-rail-name-menu-button ${isConfirming
          ? 'player-rail-name-menu-button-confirm'
          : ''}"
        ?disabled=${entry.isCurrent}
        @click=${() => this.handleSwitcherClick(entry, isConfirming)}
      >
        <span class="player-rail-name-menu-name">
          ${isConfirming
            ? `Confirm take-over from ${entry.takenBy}`
            : entry.name}
        </span>
        ${entry.isCurrent
          ? html`<span class="player-rail-name-menu-tag muted">current</span>`
          : isTakenByOther && !isConfirming
            ? html`<span class="player-rail-name-menu-tag muted"
                >take over from ${entry.takenBy}</span
              >`
            : nothing}
      </button>
    </li>`;
  }

  private handleSwitcherClick(
    entry: SwitcherEntry,
    isConfirming: boolean
  ): void {
    if (entry.isCurrent) return;
    const isTakenByOther = !!entry.takenBy;
    if (isTakenByOther && !isConfirming) {
      // First click on a taken PC: enter confirm state, leave menu
      // open so the player can re-click to commit (or click elsewhere
      // to cancel).
      this.takeOverConfirmPcId = entry.pcId;
      return;
    }
    this.handleSwitchTo(entry.pcId);
  }

  private handleSwitchTo(pcId: string): void {
    this.switcherOpen = false;
    this.takeOverConfirmPcId = null;
    this.onSwitchToPc?.(pcId);
  }

  /**
   * P-R11: player-side retire-request affordance.  Three states:
   *
   *   - none:     "Request retire…" button → opens inline form
   *   - pending:  muted "Retire request pending DM review" pip
   *   - declined: amber "DM declined: <note>" pip + retry button
   *
   * Hidden entirely when no retirePip data is supplied (e.g., DM
   * view, NPC sheet, unbound viewer).
   */
  private renderRetireRequest(): TemplateResult | typeof nothing {
    const pip = this.retirePip;
    if (!pip || !this.onRequestRetire) return nothing;
    if (this.retireFormOpen) return this.renderRetireForm();
    switch (pip.status) {
      case 'none':
        return html`<p class="player-rail-retire">
          <button
            type="button"
            class="player-rail-retire-open"
            @click=${() => this.openRetireForm()}
          >
            Request retire…
          </button>
        </p>`;
      case 'pending':
        return html`<p class="player-rail-retire player-rail-retire-pending">
          <span class="player-rail-retire-tag muted"
            >Retire request pending DM review</span
          >
        </p>`;
      case 'declined':
        return html`<p class="player-rail-retire player-rail-retire-declined">
          <span class="player-rail-retire-tag">DM declined</span>
          ${pip.note
            ? html`<span class="player-rail-retire-note">${pip.note}</span>`
            : nothing}
          <button
            type="button"
            class="player-rail-retire-open"
            @click=${() => this.openRetireForm()}
          >
            Resubmit
          </button>
        </p>`;
    }
  }

  private renderRetireForm(): TemplateResult {
    const canSubmit = this.retireFormText.trim().length > 0;
    return html`
      <div class="player-rail-retire-form">
        <label class="player-rail-retire-form-label">
          Why is your PC retiring? (player-safe — visible to the DM)
          <textarea
            class="player-rail-retire-form-text"
            rows="2"
            maxlength="200"
            placeholder="e.g. Mei steps away to look after her sister"
            .value=${this.retireFormText}
            @input=${(e: Event) => {
              this.retireFormText = (e.target as HTMLTextAreaElement).value;
            }}
          ></textarea>
        </label>
        <label class="player-rail-retire-form-reason">
          Reason
          <select
            .value=${this.retireFormReason}
            @change=${(e: Event) => {
              this.retireFormReason = (
                e.target as HTMLSelectElement
              ).value as typeof this.retireFormReason;
            }}
          >
            <option value="departed">Departed</option>
            <option value="died">Died</option>
            <option value="converted-to-npc">Becomes an NPC</option>
            <option value="other">Other</option>
          </select>
        </label>
        <div class="player-rail-retire-form-actions">
          <button
            type="button"
            class="player-rail-retire-form-cancel"
            @click=${() => {
              this.retireFormOpen = false;
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            class="player-rail-retire-form-submit"
            ?disabled=${!canSubmit}
            @click=${() => this.submitRetireForm()}
          >
            Send request
          </button>
        </div>
      </div>
    `;
  }

  private openRetireForm(): void {
    this.retireFormOpen = true;
    this.retireFormText = '';
    this.retireFormReason = 'departed';
  }

  private submitRetireForm(): void {
    const ok = this.onRequestRetire?.(
      this.retireFormReason,
      this.retireFormText.trim()
    );
    if (ok) {
      this.retireFormOpen = false;
      this.retireFormText = '';
    }
  }

  /**
   * D5 (2026-05-27): inline form for proposing a bond.  Opens
   * inside the bonds-card area when the local peer controls the
   * PC.  Target picker is a `<select>` of other PCs in the
   * campaign; text is a free-form string (200 char soft cap per
   * UX-expert pre-design).  Submits via `onProposeBond` then
   * clears + closes.
   */
  private renderProposeBondForm(pcId: string): TemplateResult {
    void pcId;
    if (!this.bondFormOpen) {
      return html`<button
        type="button"
        class="bonds-card-add"
        @click=${() => this.openBondForm()}
      >
        + Add bond
      </button>`;
    }
    const candidates = this.bondTargetCandidates;
    return html`<div class="bonds-card-compose">
      <label class="bonds-card-compose-label">
        Bond to
        <select
          class="bonds-card-compose-target"
          .value=${this.bondFormTarget}
          @change=${(e: Event) => {
            this.bondFormTarget = (e.target as HTMLSelectElement).value;
          }}
        >
          <option value="" ?selected=${this.bondFormTarget === ''}>
            — pick a PC —
          </option>
          ${candidates.map(
            (c) =>
              html`<option
                value=${c.pcId}
                ?selected=${this.bondFormTarget === c.pcId}
              >
                ${c.name}
              </option>`
          )}
        </select>
      </label>
      <label class="bonds-card-compose-label">
        Bond text
        <textarea
          class="bonds-card-compose-text"
          rows="2"
          maxlength="500"
          placeholder="e.g., we were classmates at Berkeley"
          .value=${this.bondFormText}
          @input=${(e: Event) => {
            this.bondFormText = (e.target as HTMLTextAreaElement).value;
          }}
        ></textarea>
      </label>
      <div class="bonds-card-compose-actions">
        <button
          type="button"
          class="bonds-card-compose-submit"
          ?disabled=${this.bondFormTarget === '' ||
          this.bondFormText.trim().length === 0}
          @click=${() => this.submitBondForm()}
        >
          Propose bond
        </button>
        <button
          type="button"
          class="bonds-card-compose-cancel"
          @click=${() => this.cancelBondForm()}
        >
          Cancel
        </button>
      </div>
      <p class="muted bonds-card-compose-hint">
        DM will review + ratify before others see this bond.
      </p>
    </div>`;
  }

  private openBondForm(): void {
    this.bondFormOpen = true;
    this.bondFormTarget = '';
    this.bondFormText = '';
  }

  private cancelBondForm(): void {
    this.bondFormOpen = false;
    this.bondFormTarget = '';
    this.bondFormText = '';
  }

  private submitBondForm(): void {
    if (!this.onProposeBond) return;
    const text = this.bondFormText.trim();
    if (text.length === 0 || this.bondFormTarget === '') return;
    this.onProposeBond(this.bondFormTarget, text);
    this.cancelBondForm();
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

  /**
   * First-session Gap A (2026-05-28): surface advancement progress
   * on the player's OWN Rail.  Per rules.md:149-166, the DM ticks up
   * to one mark per session; every 5 marks → one advancement the
   * player picks at the next session's start.
   *
   * The count is DERIVED from the ticked `markBullets` (the single
   * source of truth the DM edits at wrap) — NOT from `record.marks`,
   * which was never synced from the bullets and so left this chip
   * inert in normal play (review 2026-05-28).  markBullets is not a
   * DM-only field, so it survives filterForViewer to the player's
   * own record.
   *
   * At 5/5: a warm "ready" chip (role="note" — persistent state, not
   * a live update, so it isn't re-announced on every render).  The
   * actual pick is a between-sessions table beat, so the copy points
   * there rather than promising an in-app picker.
   * At 1-4: a faint progress line, kept low-key per the prime
   * directive (growth in the background, not a meter to grind).
   * At 0: nothing.
   */
  private renderAdvancementSignal(
    r: import('../../character-loader').CharacterRecord
  ): TemplateResult {
    const marks = countAdvancementMarks(r.markBullets);
    if (marks <= 0) return html``;
    if (marks >= 5) {
      return html`<p class="player-rail-advancement-ready" role="note">
        ✦ Advancement ready — pick one with your DM between sessions.
      </p>`;
    }
    return html`<p class="player-rail-advancement-progress">
      Growth: ${marks} / 5
    </p>`;
  }

  // Phase B P1d (2026-05-26): renderStatBlock removed; replaced
  // by <stat-grid> component which adds rule-hover tooltips.

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

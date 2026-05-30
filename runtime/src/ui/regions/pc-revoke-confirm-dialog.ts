// @vitest-environment happy-dom

/**
 * <pc-revoke-confirm-dialog> — two-step confirm gate for the DM's
 * "Remove player / Reset character" affordance per the TTRPG-expert
 * player-removal advisory + DEC-044.
 *
 * # Why this exists
 *
 * Run #18 ships the engine primitive `pc-revoke` (DEC-043) which
 * removes a PC and transitions its seat into the new `revoked`
 * SlotState — distinct from `pc-retire` / `pc-archive` (which
 * memorialize).  The DM needs an explicit two-step gate before
 * emitting the event because:
 *
 *   - The action is irreversible (no in-engine undo; reloading an
 *     earlier backup is the recovery path).
 *   - The DM has to consciously consent to the silent-player
 *     firewall: players will see the seat enter `revoked` but
 *     won't be told why — they'll see "fiction shifted under them"
 *     the way fiction always shifts.  Per the TTRPG expert (Q8 +
 *     Q10), this is the load-bearing UX moment: the copy must
 *     explicitly name the silence so the DM consents.
 *   - The DM picks `narrativeShape` ('never-arrived' /
 *     'offstage-forever' / 'recast') here — the choice is DM-side
 *     authorial framing, stripped from non-coord saves.
 *   - When the revoked PC has inbound cross-PC bonds, the DM picks
 *     the tombstone name (DM-supplied stand-in) so the remaining
 *     player's bond reads "(former friend) Mateo" instead of
 *     vanishing or pointing to the deleted PC.
 *
 * # Shape
 *
 * Same Lit-region shape as `<start-fresh-confirm-dialog>` (run #17
 * idiom): host calls `open(spec)`; returns a promise resolving to
 * the chosen settings (Confirm) or null (Cancel / Escape /
 * backdrop).  Disconnected pending promise resolves null to avoid
 * hung callers.
 *
 * # Silent-player firewall
 *
 * DM-only by host gating (only the DM operational view surfaces
 * this dialog).  Defense-in-depth: emits no chrome until `open()`
 * is called.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

export type PcRevokeNarrativeShape =
  | 'never-arrived'
  | 'offstage-forever'
  | 'recast';

export interface PcRevokeConfirmSpec {
  /** Slot the seat lives at (1..N). */
  readonly slot: number;
  /** pcId of the PC about to be revoked. */
  readonly pcId: string;
  /** Human display name of the PC ("Mei").  Used in body copy. */
  readonly pcDisplayName: string;
  /**
   * IDs of OTHER PCs that hold ratified bonds TO this PC.  The
   * dialog renders an information line naming them so the DM
   * understands which players will see bond changes; the
   * tombstone name + optional NPC id apply uniformly via the
   * single `bondTombstoneName` / `bondTombstoneNpcId` payload
   * fields (per the expert's payload shape; per-bond decisions
   * defer to a future iteration if playtest demands it).
   */
  readonly inboundBondSourceDisplayNames: readonly string[];
  /**
   * Existing NPCs the DM can reassign the bonds to.  When the DM
   * picks one, the tombstone gets both a `name` (NPC name) and
   * a `targetNpcId` (so the renderer can resolve to the NPC).
   * Per DEC-040: existing-NPC selector only in v1; on-the-fly NPC
   * creation defers to follow-up.
   */
  readonly availableNpcs: readonly { id: string; name: string }[];
  /** Preset variant — drives default narrativeShape + title copy. */
  readonly variant: 'remove-player' | 'reset-character';
}

export interface PcRevokeConfirmResult {
  readonly narrativeShape: PcRevokeNarrativeShape;
  /**
   * Player-safe tombstone stand-in name for inbound bonds.  Empty
   * string when no inbound bonds exist (renderer ignores).  When
   * present, all inbound bonds adopt this name.
   */
  readonly bondTombstoneName: string;
  /**
   * Optional NPC id the bonds are reassigned to.  When the DM
   * picked an existing-NPC selector, this carries the id; the
   * tombstone name above is the NPC's display name.
   */
  readonly bondTombstoneNpcId?: string;
}

const DEFAULT_TOMBSTONE_NAME = 'a former friend';

@customElement('pc-revoke-confirm-dialog')
export class PcRevokeConfirmDialog extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @state() private spec: PcRevokeConfirmSpec | null = null;
  @state() private isOpen: boolean = false;
  @state() private narrativeShape: PcRevokeNarrativeShape = 'offstage-forever';
  /**
   * Selected NPC id for bond reassignment, or '' for "no NPC —
   * tombstone with stand-in name".  Initialized to '' on open.
   */
  @state() private selectedNpcId: string = '';
  /**
   * Free-text tombstone name when no NPC is selected.  Defaults to
   * a generic "a former friend" so the renderer always has a name
   * to print.  Editable to let the DM pick something more
   * specific like "an old colleague" or a stand-in name.
   */
  @state() private freeTextTombstone: string = DEFAULT_TOMBSTONE_NAME;
  private resolver: ((value: PcRevokeConfirmResult | null) => void) | null =
    null;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
    if (this.resolver) {
      this.resolver(null);
      this.resolver = null;
    }
  }

  private readonly handleKeydown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.resolve(null);
    }
  };

  /**
   * Open the dialog with the given spec.  Returns a promise that
   * resolves to a `PcRevokeConfirmResult` (Confirm) or null
   * (Cancel / Escape / backdrop).  Double-open: prior promise
   * resolves null first to avoid leaks.
   */
  open(spec: PcRevokeConfirmSpec): Promise<PcRevokeConfirmResult | null> {
    if (this.resolver) {
      this.resolver(null);
      this.resolver = null;
    }
    this.spec = spec;
    this.isOpen = true;
    // Sensible defaults per variant:
    //   - 'reset-character' (PC rebirth) → 'recast'.
    //   - 'remove-player' (vanished / departed) → 'offstage-forever';
    //     the DM can switch to 'never-arrived' if no fiction lands.
    this.narrativeShape =
      spec.variant === 'reset-character' ? 'recast' : 'offstage-forever';
    this.selectedNpcId = '';
    this.freeTextTombstone = DEFAULT_TOMBSTONE_NAME;
    return new Promise<PcRevokeConfirmResult | null>((resolve) => {
      this.resolver = resolve;
    });
  }

  private resolve(value: PcRevokeConfirmResult | null): void {
    const r = this.resolver;
    this.resolver = null;
    this.isOpen = false;
    this.spec = null;
    if (r) r(value);
  }

  private onConfirm(): void {
    if (!this.spec) return;
    const npcMatch = this.spec.availableNpcs.find(
      (n) => n.id === this.selectedNpcId
    );
    const result: PcRevokeConfirmResult = {
      narrativeShape: this.narrativeShape,
      bondTombstoneName: npcMatch
        ? npcMatch.name
        : this.freeTextTombstone.trim() || DEFAULT_TOMBSTONE_NAME,
      ...(npcMatch ? { bondTombstoneNpcId: npcMatch.id } : {})
    };
    this.resolve(result);
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.isOpen || !this.spec) return nothing;
    const spec = this.spec;
    const title =
      spec.variant === 'reset-character'
        ? `Reset character at PC${spec.slot} (${spec.pcDisplayName})?`
        : `Remove player from PC${spec.slot} (${spec.pcDisplayName})?`;
    const hasInboundBonds = spec.inboundBondSourceDisplayNames.length > 0;
    const inboundNamesLine = hasInboundBonds
      ? `Other PCs with bonds to ${spec.pcDisplayName}: ` +
        spec.inboundBondSourceDisplayNames.join(', ')
      : '';
    return html`<div
      class="pc-revoke-backdrop"
      data-testid="pc-revoke-backdrop"
      @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) {
          this.resolve(null);
        }
      }}
    >
      <section
        class="pc-revoke-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-revoke-title"
        data-testid="pc-revoke-dialog"
        data-variant=${spec.variant}
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <h2 id="pc-revoke-title" class="pc-revoke-title">${title}</h2>
        <p
          class="pc-revoke-firewall-reminder"
          data-testid="pc-revoke-firewall-reminder"
        >
          Your players won't be told this happened. Choose the fictional
          explanation you want to use.
        </p>
        <fieldset class="pc-revoke-shape" data-testid="pc-revoke-shape">
          <legend>What does this look like in fiction?</legend>
          <label>
            <input
              type="radio"
              name="narrativeShape"
              value="never-arrived"
              data-testid="pc-revoke-shape-never-arrived"
              ?checked=${this.narrativeShape === 'never-arrived'}
              @change=${() => (this.narrativeShape = 'never-arrived')}
            />
            <span>
              <strong>Never arrived</strong> — the table retells the story
              as if this seat was empty from the start.
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="narrativeShape"
              value="offstage-forever"
              data-testid="pc-revoke-shape-offstage-forever"
              ?checked=${this.narrativeShape === 'offstage-forever'}
              @change=${() => (this.narrativeShape = 'offstage-forever')}
            />
            <span>
              <strong>Gone for good</strong> — they're not coming back; no
              memorial, no in-fiction reason surfaced.
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="narrativeShape"
              value="recast"
              data-testid="pc-revoke-shape-recast"
              ?checked=${this.narrativeShape === 'recast'}
              @change=${() => (this.narrativeShape = 'recast')}
            />
            <span>
              <strong>Recast</strong> — the player + you agree it was
              always the new PC at this seat from the start.
            </span>
          </label>
        </fieldset>
        ${hasInboundBonds
          ? html`<fieldset
              class="pc-revoke-bonds"
              data-testid="pc-revoke-bonds"
            >
              <legend>Bonds to ${spec.pcDisplayName}</legend>
              <p class="pc-revoke-bond-list" data-testid="pc-revoke-bond-list">
                ${inboundNamesLine}
              </p>
              ${spec.availableNpcs.length > 0
                ? html`<label class="pc-revoke-npc-label">
                    Reassign to an existing NPC:
                    <select
                      class="pc-revoke-npc-select"
                      data-testid="pc-revoke-npc-select"
                      .value=${this.selectedNpcId}
                      @change=${(e: Event) => {
                        this.selectedNpcId = (e.target as HTMLSelectElement)
                          .value;
                      }}
                    >
                      <option value="">— Don't reassign; use stand-in name —</option>
                      ${spec.availableNpcs.map(
                        (n) =>
                          html`<option value=${n.id}>${n.name}</option>`
                      )}
                    </select>
                  </label>`
                : nothing}
              ${this.selectedNpcId === ''
                ? html`<label class="pc-revoke-tombstone-label">
                    Stand-in name on remaining players' bond lists:
                    <input
                      type="text"
                      class="pc-revoke-tombstone-input"
                      data-testid="pc-revoke-tombstone-input"
                      maxlength="80"
                      .value=${this.freeTextTombstone}
                      @input=${(e: Event) => {
                        this.freeTextTombstone = (
                          e.target as HTMLInputElement
                        ).value;
                      }}
                    />
                  </label>`
                : nothing}
            </fieldset>`
          : nothing}
        <div class="pc-revoke-actions">
          <button
            type="button"
            class="pc-revoke-cancel"
            data-testid="pc-revoke-cancel"
            autofocus
            @click=${() => this.resolve(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            class="pc-revoke-confirm"
            data-testid="pc-revoke-confirm"
            data-destructive="true"
            @click=${() => this.onConfirm()}
          >
            ${spec.variant === 'reset-character'
              ? 'Reset character'
              : 'Remove player'}
          </button>
        </div>
      </section>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pc-revoke-confirm-dialog': PcRevokeConfirmDialog;
  }
}

// @vitest-environment happy-dom

/**
 * <dm-operational-view> — the DM-only "engineering reality"
 * surface (per `ux-strategy.md` locked principle 3 + DEC-029).
 *
 * # Why this exists as a discrete surface
 *
 * DEC-029 (run #8): instead of embedding `<backups-card>` as an
 * inline card inside the existing campaign render path, we
 * stand up the operational view as its own AppMode.  Three
 * reasons:
 *
 *   1. The ux-strategy.md locked principle 3 specified a
 *      separate hidden advanced surface for engineering reality
 *      — admitting the surface into the play cockpit would
 *      contradict the doc set the program has been writing
 *      toward.
 *   2. Future engineering-reality surfaces (local autosave
 *      health, eviction status, account-mismatch chip,
 *      browser-storage budget) want a single home.  Inlining
 *      each as a card on the play cockpit would multiply
 *      surfaces.
 *   3. Silent-player firewall is cleaner: one
 *      `appMode === 'dm-operational'` short-circuit + one
 *      `isCoordinator()` short-circuit covers the whole surface.
 *
 * # What this surface contains today
 *
 * - Backups (M6a-FS via `<backups-card>`; M6a-OAuth's parallel
 *   "My Drive" line lands inside the same card later).
 *
 * # What this surface will contain later
 *
 * - Local autosave health line (eviction status, last-flush
 *   time).
 * - Browser-storage budget chip (NEW-PRV-1 / persisted-storage
 *   visibility).
 * - Account-mismatch chip (NEW-SEC-4 — when M6a-OAuth ships).
 * - Manual-save download button (already exists in saveToFile;
 *   could migrate here for consistency).
 *
 * # Silent-player firewall
 *
 * Defense-in-depth: this element renders an empty `nothing`
 * when `renderForDm` is false.  The host gates the render at
 * `quire-app.ts`'s renderBody dispatch (appMode +
 * isCoordinator).  Both gates must pass for the surface to be
 * visible.  A player who somehow lands on this mode sees the
 * "DM is administering" placeholder (similar to the
 * `session-open` mode's player-side fallback).
 *
 * # Closing the surface
 *
 * Escape key returns to `'in-session'`.  The host listens for
 * the `dm-operational-close` custom event; this element fires
 * it on the Close button and on the Escape keydown.  The host
 * is the source of truth for the appMode transition.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './backups-card';
import './pc-revoke-confirm-dialog';
import type { FsApiCloudPush } from '../../auth/fs-api-cloud-push';
import type { RequestFsApiConsent } from './backups-card';
import type {
  PcRevokeConfirmDialog,
  PcRevokeConfirmResult,
  PcRevokeNarrativeShape
} from './pc-revoke-confirm-dialog';

/**
 * Run #18 (2026-05-30) — minimal seat snapshot the operational-view's
 * "Manage seats" section reads.  Structural subset of `SessionState`'s
 * `pcSlots[N]` + `synthesizedPcs[pcId]` + `pcBonds` projection — kept
 * shallow so this region doesn't depend on `core/state`'s heavy types.
 */
export interface ManageSeatRow {
  /** Slot integer (1..N). */
  readonly slot: number;
  /** SlotState; only bound-active surfaces revoke affordances today. */
  readonly state:
    | 'unbound'
    | 'bound-active'
    | 'bound-retired'
    | 'bound-archived'
    | 'revoked';
  /** pcId when bound; undefined on unbound / revoked. */
  readonly pcId?: string;
  /** Display name lookup result (e.g. `synthesizedPcs[pcId].name`). */
  readonly pcDisplayName: string;
  /**
   * IDs of other PCs that hold ratified bonds TO this PC.  Empty when
   * this PC has no inbound bonds (the dialog won't show the bond
   * tombstone section).  Display names resolved via the same
   * `pcDisplayName` lookup the host does for the current PC.
   */
  readonly inboundBondSourceDisplayNames: readonly string[];
}

/**
 * Run #18 — payload the operational view emits when the DM confirms
 * a revoke.  Host listens for `pc-revoke-request` and emits the
 * canonical `pc-revoke` event on the session log.
 */
export interface PcRevokeRequestDetail {
  readonly pcId: string;
  readonly slot: number;
  readonly narrativeShape: PcRevokeNarrativeShape;
  readonly bondTombstoneName: string;
  readonly bondTombstoneNpcId?: string;
}

@customElement('dm-operational-view')
export class DmOperationalView extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Host-gated DM-only flag.  Player viewers MUST see nothing
   * (or a generic placeholder if they end up here via URL).
   */
  @property({ type: Boolean })
  renderForDm: boolean = false;

  /**
   * Campaign whose operational state we're surfacing.  Empty
   * string → render the "no active session" placeholder.
   */
  @property({ type: String })
  campaignId: string = '';

  /**
   * The host's wired FS-API cloud push.  Null while loading or
   * when the host hasn't built one yet.  Passed through to
   * `<backups-card>`.
   */
  @property({ attribute: false })
  fsApiCloudPush: FsApiCloudPush | null = null;

  /**
   * Host callback for the FS-API consent ceremony.  Passed
   * through to `<backups-card>`.
   */
  @property({ attribute: false })
  requestFsApiConsent: RequestFsApiConsent | null = null;

  /**
   * Run #18 (2026-05-30) — seats the host wants to surface in the
   * "Manage seats" section.  Host responsibility to filter to
   * bound-active rows + sort by slot.  Empty array → renders the
   * "no players yet" placeholder.
   */
  @property({ attribute: false })
  manageSeats: readonly ManageSeatRow[] = [];

  /**
   * Run #18 — list of existing NPCs the bond-tombstone selector
   * can offer.  When empty, the dialog only shows the free-text
   * stand-in name input.  Host pulls from the campaign manifest
   * or `state.synthesizedNpcs` (M4 follow-up) — for now the host
   * passes an empty list and the DM types the stand-in name.
   */
  @property({ attribute: false })
  availableNpcs: readonly { id: string; name: string }[] = [];

  /**
   * Run #18 — track which seat row is currently expanded for
   * "Manage seat ▾".  Multiple seats may be expanded; using a
   * Set so the DM can compare two seats side-by-side.
   */
  @state() private expandedSeats: Set<number> = new Set();

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private readonly handleKeydown = (e: KeyboardEvent): void => {
    if (!this.renderForDm) return;
    if (e.key !== 'Escape') return;
    // Don't steal Escape from a child surface that's already
    // handling it (e.g. the consent dialog).  Check focus.
    const inside = document.activeElement?.closest(
      'cloud-push-consent-dialog'
    );
    if (inside) return;
    e.preventDefault();
    this.requestClose();
  };

  private requestClose(): void {
    this.dispatchEvent(
      new CustomEvent('dm-operational-close', {
        bubbles: true,
        composed: true
      })
    );
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.renderForDm) {
      // Player-side fallback per the session-open mode pattern.
      // We acknowledge that the DM is doing something so the
      // player isn't confused by an unexplained empty body —
      // but we leak no information about WHAT.
      return html`<section class="card dm-operational-player-fallback">
        <h2>The DM is checking the table's gear</h2>
        <p class="muted">One moment.  Play resumes shortly.</p>
      </section>`;
    }

    return html`<section
      class="card dm-operational-view"
      data-testid="dm-operational-view"
    >
      <header class="dm-operational-head">
        <h2>Operational view</h2>
        <button
          type="button"
          class="dm-operational-close"
          data-testid="dm-operational-close"
          title="Return to play (Esc)"
          @click=${() => this.requestClose()}
        >
          Close
        </button>
      </header>
      <p class="muted dm-operational-intro">
        The engineering reality behind your table.  Players don't
        see this.
      </p>
      ${this.renderManageSeatsSection()}
      ${this.renderBackupsSection()}
      <pc-revoke-confirm-dialog
        data-testid="dm-operational-pc-revoke-dialog"
      ></pc-revoke-confirm-dialog>
    </section>`;
  }

  /**
   * Run #18 (2026-05-30) — "Manage seats" section per the TTRPG-
   * expert player-removal advisory + DEC-044.  Per-seat collapsible
   * disclosure with "Reset character" (recast variant) + "Remove
   * player from this slot" (offstage-forever variant) destructive
   * options.  Retire / archive affordances continue to live in the
   * existing chargen-dm-review surface; this section explicitly
   * routes only to `pc-revoke`.
   */
  private renderManageSeatsSection(): TemplateResult {
    return html`<section
      class="dm-operational-section dm-operational-manage-seats"
      data-testid="dm-operational-manage-seats-section"
    >
      <h3>Manage seats</h3>
      <p class="muted dm-operational-section-intro">
        Reset a character or remove a player from a seat between
        sessions.  Use this when a player won't continue or you've
        agreed to recast their PC. Distinct from <em>Retire</em> /
        <em>Archive</em> (which keep the PC as a referenced narrative
        entity).
      </p>
      ${this.manageSeats.length === 0
        ? html`<p
            class="muted"
            data-testid="dm-operational-manage-seats-empty"
          >
            No bound seats to manage.
          </p>`
        : html`<ol
            class="dm-operational-manage-seats-list"
            data-testid="dm-operational-manage-seats-list"
          >
            ${this.manageSeats.map((row) => this.renderManageSeatRow(row))}
          </ol>`}
    </section>`;
  }

  private renderManageSeatRow(row: ManageSeatRow): TemplateResult {
    const expanded = this.expandedSeats.has(row.slot);
    return html`<li
      class="dm-operational-manage-seat-row"
      data-testid="dm-operational-manage-seat-row"
      data-slot=${row.slot}
      data-pc-id=${row.pcId ?? ''}
    >
      <button
        type="button"
        class="dm-operational-manage-seat-toggle"
        data-testid=${'dm-operational-manage-seat-toggle-' + row.slot}
        aria-expanded=${expanded ? 'true' : 'false'}
        @click=${() => this.toggleSeatExpanded(row.slot)}
      >
        <span aria-hidden="true">${expanded ? '▾' : '▸'}</span>
        Manage seat — PC${row.slot} (${row.pcDisplayName})
      </button>
      ${expanded
        ? html`<div
            class="dm-operational-manage-seat-body"
            data-testid=${'dm-operational-manage-seat-body-' + row.slot}
          >
            ${row.state === 'bound-active'
              ? html`<button
                    type="button"
                    class="dm-operational-manage-seat-reset"
                    data-testid=${'dm-operational-manage-seat-reset-' +
                    row.slot}
                    title="Recast the character at this seat without retiring the player"
                    @click=${() =>
                      void this.requestRevoke(row, 'reset-character')}
                  >
                    Reset character (recast)…
                  </button>
                  <button
                    type="button"
                    class="dm-operational-manage-seat-remove"
                    data-testid=${'dm-operational-manage-seat-remove-' +
                    row.slot}
                    title="Remove the player from this seat (vanished player / clean exit)"
                    @click=${() =>
                      void this.requestRevoke(row, 'remove-player')}
                  >
                    Remove player from this seat…
                  </button>`
              : html`<p class="muted">
                  This seat is in
                  <code>${row.state}</code> — revoke affordances only
                  apply to bound-active seats.
                </p>`}
          </div>`
        : nothing}
    </li>`;
  }

  private toggleSeatExpanded(slot: number): void {
    const next = new Set(this.expandedSeats);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    this.expandedSeats = next;
  }

  private async requestRevoke(
    row: ManageSeatRow,
    variant: 'remove-player' | 'reset-character'
  ): Promise<void> {
    if (!row.pcId) return;
    const dlg = this.querySelector(
      'pc-revoke-confirm-dialog'
    ) as PcRevokeConfirmDialog | null;
    if (!dlg) return;
    const result: PcRevokeConfirmResult | null = await dlg.open({
      slot: row.slot,
      pcId: row.pcId,
      pcDisplayName: row.pcDisplayName,
      inboundBondSourceDisplayNames: row.inboundBondSourceDisplayNames,
      availableNpcs: this.availableNpcs,
      variant
    });
    if (!result) return; // Cancel / Escape / backdrop — no event.
    const detail: PcRevokeRequestDetail = {
      pcId: row.pcId,
      slot: row.slot,
      narrativeShape: result.narrativeShape,
      bondTombstoneName: result.bondTombstoneName,
      ...(result.bondTombstoneNpcId !== undefined
        ? { bondTombstoneNpcId: result.bondTombstoneNpcId }
        : {})
    };
    this.dispatchEvent(
      new CustomEvent<PcRevokeRequestDetail>('pc-revoke-request', {
        detail,
        bubbles: true,
        composed: true
      })
    );
    // Collapse the row after a successful submission so the next
    // action starts from a clean state.
    const next = new Set(this.expandedSeats);
    next.delete(row.slot);
    this.expandedSeats = next;
  }

  private renderBackupsSection(): TemplateResult {
    if (!this.campaignId) {
      return html`<section class="dm-operational-section">
        <p class="muted">No active session — backups appear here once a campaign is loaded.</p>
      </section>`;
    }
    return html`<section
      class="dm-operational-section dm-operational-backups"
      data-testid="dm-operational-backups-section"
    >
      <backups-card
        .cloudPush=${this.fsApiCloudPush}
        .campaignId=${this.campaignId}
        ?renderForDm=${this.renderForDm}
        .requestConsent=${this.requestFsApiConsent}
      ></backups-card>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-operational-view': DmOperationalView;
  }
}

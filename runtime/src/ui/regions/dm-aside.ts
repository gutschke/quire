/**
 * <dm-aside> — DM-only Aside content.
 *
 * Sits alongside the player Aside (roster + chat + AI panel) when
 * the local peer is the coordinator.  Surfaces:
 *   - pinned NPC list with quick-nav + unpin buttons
 *
 * **Wave C4 (2026-05-26):** thread-debt + caster-state +
 * reset-spam editing all moved to `<dm-pc-detail>` per UX expert
 * "Rail wins as the canonical home; dm-aside sheds thread-debt +
 * caster-state entirely" (ui.md L170 + dual-home elimination).
 * The DM navigates to a PC's character page to adjust per-PC arc
 * state; dm-aside is now strictly the pinned-NPC aide.
 *
 * **Deferred surface gap:** previously dm-aside listed orphan
 * thread-debt rungs (PCs no peer has bound but who carry non-zero
 * debt).  No surface in v1 of C4; the DM can navigate to the
 * PC's page directly via the Stage roster's Retired/Archived
 * tabs.  Watch-item: if DMs report losing track of orphan rungs,
 * promote the readout into Stage roster instead of restoring it
 * here (preserves the one-canonical-home invariant).
 *
 * Render-gated DM-only by the caller in QuireApp; `pinnedNpcs`
 * is also wiped from filteredShared for non-coord viewers as a
 * belt-and-suspenders.
 *
 * Light-DOM rendering: createRenderRoot returns this.  Styles
 * live in src/ui/styles/quire-app.css.ts under .dm-aside-*
 * classes.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { routeToSearch } from '../../routing';
// Wave C3 (2026-05-26): callback-type consolidation — import +
// re-export so local usage AND any external import keeps working.
import type { NavigateCallback } from '../callback-types';
import type { AppRoute } from '../../routing';
export type { NavigateCallback };
export type UnpinCallback = (npcId: string) => void;

/**
 * D5-cleanup (2026-05-27): pending bond proposal entry for the
 * campaign-level DM queue.  Surfaces in dm-aside so the DM
 * doesn't have to navigate to every PC's page to discover
 * pending work.  Per scenario TTRPG-A.4 + UX-2.
 */
export interface DmAsideBondProposal {
  /** Bond id (proposal id). */
  id: string;
  /** PC the bond is FOR (the source PC). */
  pcId: string;
  /** Display name of the source PC. */
  pcLabel: string;
  /** Display name of the target PC. */
  targetLabel: string;
  /** The proposed bond text. */
  text: string;
  /** Player peer who proposed it. */
  proposedByPeerId: string;
  /**
   * D5-cleanup-2 (2026-05-27 scenario UX-6 + Adv-E): epoch-ms
   * timestamp when the proposal landed.  Host populates from
   * `BondProposal.ts`; renderer uses it for FIFO sort (oldest
   * pending first).  Pre-fix the queue sorted by random id,
   * giving DMs pseudo-random triage order despite a
   * locked-FIFO design intent.
   */
  ts: number;
}

@customElement('dm-aside')
export class DmAside extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property() campaignSlug: string = '';
  @property({ attribute: false }) pinnedNpcs: string[] = [];
  @property({ attribute: false }) onUnpin: UnpinCallback | null = null;
  @property({ attribute: false }) onNavigate: NavigateCallback | null = null;
  /**
   * D5-cleanup (2026-05-27 TTRPG-A.4 / UX-2): campaign-level
   * pending bond proposal queue.  Host fills this with EVERY
   * pending proposal across all PCs so the DM has a single
   * scannable surface.  Empty when no proposals; section
   * hidden in that case.  Per-row "Go to PC" link routes to
   * the PC's character page where the dm-pc-detail Ratify form
   * lives.
   */
  @property({ attribute: false }) pendingBondProposals: DmAsideBondProposal[] =
    [];

  override render(): TemplateResult {
    const pinned = this.pinnedNpcs ?? [];
    const proposals = this.pendingBondProposals;
    if (pinned.length === 0 && proposals.length === 0) {
      return html`
        <section class="card dm-aside-empty">
          <h2>Pinned NPCs</h2>
          <p class="muted">
            Pin NPCs from any NPC page to surface them here.
          </p>
        </section>
      `;
    }
    return html`
      ${proposals.length > 0 ? this.renderBondQueue(proposals) : nothing}
      ${pinned.length > 0
        ? html`<section class="card dm-aside-card">
            <h2>Pinned NPCs <span class="muted">(${pinned.length})</span></h2>
            ${this.renderPinned(pinned)}
          </section>`
        : nothing}
    `;
  }

  private renderBondQueue(
    proposals: DmAsideBondProposal[]
  ): TemplateResult {
    return html`<section class="card dm-aside-bond-queue">
      <h2>
        Pending bond proposals
        <span class="muted">(${proposals.length})</span>
      </h2>
      <ul class="dm-aside-bond-queue-list">
        ${proposals.map((p) => this.renderBondQueueRow(p))}
      </ul>
    </section>`;
  }

  private renderBondQueueRow(p: DmAsideBondProposal): TemplateResult {
    const route: AppRoute = {
      kind: 'character',
      slug: this.campaignSlug,
      characterKind: 'pc',
      characterId: p.pcId
    };
    return html`<li class="dm-aside-bond-queue-row">
      <p class="dm-aside-bond-queue-summary">
        <strong>${p.pcLabel}</strong>
        <span class="muted"> → </span>
        <strong>${p.targetLabel}</strong>
        <span class="muted"> · ${p.proposedByPeerId}</span>
      </p>
      <p class="dm-aside-bond-queue-text">${p.text}</p>
      <a
        class="dm-aside-bond-queue-link"
        href=${routeToSearch(route)}
        @click=${(e: Event) => this.onNavigate?.(e, route)}
        >Review on ${p.pcLabel}'s sheet →</a
      >
    </li>`;
  }

  private renderPinned(pinned: string[]): TemplateResult {
    return html`
      <ul class="dm-aside-pinned">
        ${pinned.map(
          (npcId) => html`
            <li class="dm-aside-pinned-row">
              <a
                href=${routeToSearch({
                  kind: 'character',
                  slug: this.campaignSlug,
                  characterKind: 'npc',
                  characterId: npcId
                })}
                @click=${(e: Event) =>
                  this.onNavigate?.(e, {
                    kind: 'character',
                    slug: this.campaignSlug,
                    characterKind: 'npc',
                    characterId: npcId
                  })}
                >${npcId}</a
              >
              <button
                type="button"
                class="dm-aside-unpin"
                title="Unpin ${npcId}"
                @click=${() => this.onUnpin?.(npcId)}
              >
                ✕
              </button>
            </li>
          `
        )}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-aside': DmAside;
  }
}

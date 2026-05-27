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

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { routeToSearch } from '../../routing';
// Wave C3 (2026-05-26): callback-type consolidation — import +
// re-export so local usage AND any external import keeps working.
import type { NavigateCallback } from '../callback-types';
export type { NavigateCallback };
export type UnpinCallback = (npcId: string) => void;

@customElement('dm-aside')
export class DmAside extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property() campaignSlug: string = '';
  @property({ attribute: false }) pinnedNpcs: string[] = [];
  @property({ attribute: false }) onUnpin: UnpinCallback | null = null;
  @property({ attribute: false }) onNavigate: NavigateCallback | null = null;

  override render(): TemplateResult {
    const pinned = this.pinnedNpcs ?? [];
    if (pinned.length === 0) {
      return html`
        <section class="card dm-aside-empty">
          <h2>DM aide</h2>
          <p class="muted">
            Pin NPCs from any NPC page to surface them here.
          </p>
        </section>
      `;
    }
    return html`
      <section class="card dm-aside-card">
        <h2>DM aide</h2>
        ${this.renderPinned(pinned)}
      </section>
    `;
  }

  private renderPinned(pinned: string[]): TemplateResult {
    return html`
      <h3 class="dm-aside-subhead">Pinned NPCs (${pinned.length})</h3>
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

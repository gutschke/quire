/**
 * <dm-aside> — DM-only Aside content (M3a.9 P1-5).
 *
 * Sits alongside the player Aside (roster + chat + AI panel) when
 * the local peer is the coordinator.  Surfaces:
 *   - pinned NPC list with quick-nav + unpin buttons
 *   - thread-debt summary (per PC currently with a non-zero rung)
 *
 * Render-gated DM-only by the caller in QuireApp; the fields
 * (pinnedNpcs, threadDebt) are also wiped from filteredShared for
 * non-coord viewers as a belt-and-suspenders.
 *
 * Light-DOM rendering: createRenderRoot returns this.  Styles live
 * in src/ui/styles/quire-app.css.ts under .dm-aside-* classes.
 *
 * Handlers stay on root: the component takes data props + an
 * onUnpin callback + an onNavigate callback (re-using the
 * existing AppRoute shape from `routing.ts`).
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { routeToSearch, type AppRoute } from '../../routing';
import type { ThreadDebtLevel } from '../../core/state';

export type NavigateCallback = (e: Event, route: AppRoute) => void;
export type UnpinCallback = (npcId: string) => void;

@customElement('dm-aside')
export class DmAside extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property() campaignSlug: string = '';
  @property({ attribute: false }) pinnedNpcs: string[] = [];
  /** Per-PC thread-debt rungs.  Keys absent → rung is "none". */
  @property({ attribute: false }) threadDebt: Record<string, ThreadDebtLevel> =
    {};
  @property({ attribute: false }) onUnpin: UnpinCallback | null = null;
  @property({ attribute: false }) onNavigate: NavigateCallback | null = null;

  override render(): TemplateResult {
    const pinned = this.pinnedNpcs ?? [];
    const debts = Object.entries(this.threadDebt ?? {});
    if (pinned.length === 0 && debts.length === 0) {
      return html`
        <section class="card dm-aside-empty">
          <h2>DM aide</h2>
          <p class="muted">
            Pin NPCs and set thread-debt rungs to surface them here.
          </p>
        </section>
      `;
    }
    return html`
      <section class="card dm-aside-card">
        <h2>DM aide</h2>
        ${pinned.length > 0 ? this.renderPinned(pinned) : nothing}
        ${debts.length > 0 ? this.renderThreadDebt(debts) : nothing}
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

  private renderThreadDebt(
    debts: Array<[string, ThreadDebtLevel]>
  ): TemplateResult {
    return html`
      <h3 class="dm-aside-subhead">Thread debt</h3>
      <ul class="dm-aside-debts">
        ${debts.map(
          ([pcId, level]) => html`
            <li class="dm-aside-debt-row">
              <a
                href=${routeToSearch({
                  kind: 'character',
                  slug: this.campaignSlug,
                  characterKind: 'pc',
                  characterId: pcId
                })}
                @click=${(e: Event) =>
                  this.onNavigate?.(e, {
                    kind: 'character',
                    slug: this.campaignSlug,
                    characterKind: 'pc',
                    characterId: pcId
                  })}
                >${pcId}</a
              >
              <span class="dm-aside-debt-level dm-aside-debt-${level}"
                >${level}</span
              >
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

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
export type SetThreadDebtCallback = (
  pcId: string,
  level: ThreadDebtLevel | ''
) => void;

/**
 * Bound-PC summary row for the dm-aside thread-debt section.  The
 * DM consults thread-debt while consulting the PC — this lets
 * them adjust the rung without navigating away from the cockpit.
 */
export interface BoundPcSummary {
  /** PC id from the campaign's pcs/ directory. */
  pcId: string;
  /** Display name (the peer's chosen handle, falls back to pcId). */
  name: string;
  /** Optional peer that has this PC claimed (informational). */
  peerId?: string;
}

const THREAD_DEBT_OPTIONS: ReadonlyArray<{
  key: '' | ThreadDebtLevel;
  label: string;
}> = [
  { key: '', label: '— none —' },
  { key: 'quiet', label: 'quiet' },
  { key: 'noticed', label: 'noticed' },
  { key: 'watched', label: 'watched' },
  { key: 'pushing-back', label: 'pushing back' },
  { key: 'hunted', label: 'hunted' }
];

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
  /**
   * FU-3: bound-PC peers in the current session (peer-rename pcId).
   * Each gets an inline thread-debt selector so the DM can adjust
   * the rung from the cockpit without navigating to the PC page.
   * Empty when no peers have claimed a PC yet.
   */
  @property({ attribute: false }) boundPcs: BoundPcSummary[] = [];
  @property({ attribute: false }) onUnpin: UnpinCallback | null = null;
  @property({ attribute: false }) onNavigate: NavigateCallback | null = null;
  @property({ attribute: false }) onSetThreadDebt:
    | SetThreadDebtCallback
    | null = null;

  override render(): TemplateResult {
    const pinned = this.pinnedNpcs ?? [];
    const bound = this.boundPcs ?? [];
    // Orphan rungs: thread-debt entries for PCs that no peer
    // currently has bound.  Surfaced separately so the DM can see
    // them but doesn't lose the inline edit affordance for
    // currently-bound PCs.
    const debt = this.threadDebt ?? {};
    const boundPcIds = new Set(bound.map((p) => p.pcId));
    const orphanRungs = Object.entries(debt).filter(
      ([pcId]) => !boundPcIds.has(pcId)
    );
    if (
      pinned.length === 0 &&
      bound.length === 0 &&
      orphanRungs.length === 0
    ) {
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
        ${bound.length > 0 || orphanRungs.length > 0
          ? this.renderThreadDebt(bound, debt, orphanRungs)
          : nothing}
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
    bound: BoundPcSummary[],
    debt: Record<string, ThreadDebtLevel>,
    orphans: Array<[string, ThreadDebtLevel]>
  ): TemplateResult {
    return html`
      <h3 class="dm-aside-subhead">Thread debt</h3>
      <ul class="dm-aside-debts">
        ${bound.map((pc) =>
          this.renderDebtRow(pc.pcId, pc.name, debt[pc.pcId] ?? '')
        )}
        ${orphans.map(([pcId, level]) =>
          this.renderDebtRow(pcId, pcId, level, /* orphan */ true)
        )}
      </ul>
    `;
  }

  private renderDebtRow(
    pcId: string,
    label: string,
    level: ThreadDebtLevel | '',
    orphan: boolean = false
  ): TemplateResult {
    return html`
      <li
        class="dm-aside-debt-row ${orphan ? 'dm-aside-debt-orphan' : ''}"
      >
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
          >${label}</a
        >
        ${this.onSetThreadDebt
          ? html`<select
              class="dm-aside-debt-select"
              aria-label="Thread debt for ${label}"
              @change=${(e: Event) =>
                this.onSetThreadDebt?.(
                  pcId,
                  (e.target as HTMLSelectElement).value as
                    | ThreadDebtLevel
                    | ''
                )}
            >
              ${THREAD_DEBT_OPTIONS.map(
                (o) => html`<option value=${o.key} ?selected=${o.key === level}>
                  ${o.label}
                </option>`
              )}
            </select>`
          : html`<span
              class="dm-aside-debt-level dm-aside-debt-${level || 'none'}"
              >${level || '—'}</span
            >`}
      </li>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-aside': DmAside;
  }
}

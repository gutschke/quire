/**
 * <dm-rail> — DM-only Rail content (M3a.9 P1-5).
 *
 * Per ui.md, the DM's Rail is the scene navigator — an at-a-glance
 * map of the campaign's episodes / scenes with the current one
 * highlighted, plus quick links to jump.  The "active-PC focus
 * card" is deferred (requires the DM to mark a PC as focus, which
 * has no UI yet; M3a polish or M3b will add it).
 *
 * When NOT in a campaign (idle / loading / error), renders nothing.
 *
 * Light-DOM rendering: createRenderRoot returns this.  Handlers
 * stay on root via onNavigate.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { routeToSearch, type AppRoute } from '../../routing';

export type NavigateCallback = (e: Event, route: AppRoute) => void;

export interface DmRailEpisode {
  slug: string;
  name: string;
  scenes: string[];
  /**
   * M3D-7: DM-only docs from `episode.json.dmDocs` (pacing, npcs,
   * stakes, coincidences, etc.).  Rendered as a sibling group
   * beneath the scene list when the episode is current.  Empty
   * array when the manifest didn't declare any — the section
   * collapses to nothing.
   */
  dmDocs?: string[];
}

@customElement('dm-rail')
export class DmRail extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property() campaignSlug: string = '';
  @property() campaignName: string = '';
  @property({ attribute: false }) episodes: DmRailEpisode[] = [];
  /** Currently-viewed episode slug + scene path; used for highlight. */
  @property() currentEpisode: string = '';
  @property() currentScene: string = '';
  @property({ attribute: false }) onNavigate: NavigateCallback | null = null;

  override render(): TemplateResult {
    if (!this.campaignSlug || (this.episodes ?? []).length === 0) {
      return html`
        <section class="card dm-rail-empty">
          <h2>Scene navigator</h2>
          <p class="muted">Load a campaign to see its scenes here.</p>
        </section>
      `;
    }
    return html`
      <section class="card dm-rail">
        <h2>Scene navigator</h2>
        <ul class="dm-rail-episodes">
          ${this.episodes.map((ep) => this.renderEpisode(ep))}
        </ul>
      </section>
    `;
  }

  private renderEpisode(ep: DmRailEpisode): TemplateResult {
    const isCurrent = ep.slug === this.currentEpisode;
    const dmDocs = ep.dmDocs ?? [];
    return html`
      <li class="dm-rail-episode ${isCurrent ? 'dm-rail-episode-current' : ''}">
        <a
          class="dm-rail-episode-name"
          href=${routeToSearch({
            kind: 'episode',
            slug: this.campaignSlug,
            episode: ep.slug
          })}
          @click=${(e: Event) =>
            this.onNavigate?.(e, {
              kind: 'episode',
              slug: this.campaignSlug,
              episode: ep.slug
            })}
          >${ep.name}</a
        >
        ${isCurrent && ep.scenes.length > 0
          ? html`
              <ul class="dm-rail-scenes">
                ${ep.scenes.map((scenePath) =>
                  this.renderSceneEntry(ep.slug, scenePath, 'scene')
                )}
              </ul>
            `
          : nothing}
        ${isCurrent && dmDocs.length > 0
          ? html`
              <div class="dm-rail-dmdocs-label" aria-hidden="true">
                DM notes
              </div>
              <ul class="dm-rail-scenes dm-rail-dmdocs">
                ${dmDocs.map((docPath) =>
                  this.renderSceneEntry(ep.slug, docPath, 'dmdoc')
                )}
              </ul>
            `
          : nothing}
      </li>
    `;
  }

  /**
   * Render one entry in the scenes-or-dm-docs list.  Same shape
   * whether the entry is a scene or a dm doc; only the class differs
   * so CSS can render dm-docs with the amber-rail caution affordance
   * (existing dm-only-path styling kicks in inside `<scene-stage>`
   * once the user navigates).
   */
  private renderSceneEntry(
    episodeSlug: string,
    scenePath: string,
    variant: 'scene' | 'dmdoc'
  ): TemplateResult {
    const isCurrent = scenePath === this.currentScene;
    const classes = [
      'dm-rail-scene',
      isCurrent ? 'dm-rail-scene-current' : '',
      variant === 'dmdoc' ? 'dm-rail-scene-dmdoc' : ''
    ]
      .filter(Boolean)
      .join(' ');
    return html`
      <li class=${classes}>
        <a
          href=${routeToSearch({
            kind: 'scene',
            slug: this.campaignSlug,
            episode: episodeSlug,
            scene: scenePath
          })}
          @click=${(e: Event) =>
            this.onNavigate?.(e, {
              kind: 'scene',
              slug: this.campaignSlug,
              episode: episodeSlug,
              scene: scenePath
            })}
          >${scenePath}</a
        >
      </li>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-rail': DmRail;
  }
}

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
                ${ep.scenes.map((scenePath) => {
                  const isCurrentScene = scenePath === this.currentScene;
                  return html`
                    <li
                      class="dm-rail-scene ${isCurrentScene
                        ? 'dm-rail-scene-current'
                        : ''}"
                    >
                      <a
                        href=${routeToSearch({
                          kind: 'scene',
                          slug: this.campaignSlug,
                          episode: ep.slug,
                          scene: scenePath
                        })}
                        @click=${(e: Event) =>
                          this.onNavigate?.(e, {
                            kind: 'scene',
                            slug: this.campaignSlug,
                            episode: ep.slug,
                            scene: scenePath
                          })}
                        >${scenePath}</a
                      >
                    </li>
                  `;
                })}
              </ul>
            `
          : nothing}
      </li>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-rail': DmRail;
  }
}

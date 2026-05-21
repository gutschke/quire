/**
 * <scene-stage> — scene-prose region (M2.4 — P1-2).
 *
 * Extracted from `QuireApp.renderScene` during the M2 facade-
 * migration.  Renders the breadcrumb, scene title, and sanitized
 * scene-markdown HTML for the currently-loaded scene.
 *
 * Per the design spec, the Stage will eventually carry a "scene-
 * strip" header (location · mood · duration · presentNpcs from
 * frontmatter) and, for DM views, per-paragraph reveal gutter pips
 * (M3a / P2-1).  M2 keeps the existing breadcrumb-and-title format
 * unchanged so the visual is identical to pre-extraction.
 *
 * Light-DOM rendering: `createRenderRoot()` returns `this` so the
 * legacy CSS in `src/ui/styles/quire-app.css.ts` continues to apply.
 *
 * Reveal-control + character-menus + roll-panel render OUTSIDE the
 * scene-stage element today: the reveal-control is injected via the
 * `revealControl` TemplateResult prop (renders inline in the header
 * next to the scene title), and the menus + roll panel render as
 * siblings of <scene-stage> from QuireApp's renderScene wrapper.
 * M2.6 (dice-dock) and later milestones will relocate the roll panel
 * and tighten the scene-strip details.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { SanitizedHtml } from '../../markdown';
import { routeToSearch, type AppRoute } from '../../routing';

export type NavigateCallback = (e: Event, route: AppRoute) => void;

@customElement('scene-stage')
export class SceneStage extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property() campaignName: string = '';
  @property() campaignSlug: string = '';
  @property() episodeName: string = '';
  @property() episodeSlug: string = '';
  @property() scenePath: string = '';
  /**
   * Pre-sanitized scene HTML.  Caller is responsible for running it
   * through the runtime's sanitize pipeline (this region trusts the
   * already-sanitized input via Lit's unsafeHTML directive).
   */
  @property({ attribute: false }) sceneHtml: SanitizedHtml | null = null;
  @property({ attribute: false }) onNavigate: NavigateCallback | null = null;
  /**
   * Optional inline content rendered next to the scene title in the
   * header.  At M2 this carries the reveal-control (DM "Reveal /
   * Un-reveal" buttons + state badge).  At M3a the per-paragraph
   * pip gutter will own this responsibility instead.
   */
  @property({ attribute: false }) headerExtras: TemplateResult | typeof nothing = nothing;

  override render(): TemplateResult {
    return html`
      <header>
        <nav class="breadcrumb">
          <a
            href=${routeToSearch({ kind: 'campaign', slug: this.campaignSlug })}
            @click=${(e: Event) =>
              this.onNavigate?.(e, {
                kind: 'campaign',
                slug: this.campaignSlug
              })}
            >${this.campaignName}</a
          >
          →
          <a
            href=${routeToSearch({
              kind: 'episode',
              slug: this.campaignSlug,
              episode: this.episodeSlug
            })}
            @click=${(e: Event) =>
              this.onNavigate?.(e, {
                kind: 'episode',
                slug: this.campaignSlug,
                episode: this.episodeSlug
              })}
            >${this.episodeName}</a
          >
          →
        </nav>
        <h1>${this.scenePath}</h1>
        ${this.headerExtras}
      </header>
      <section class="card">
        <div class="markdown">
          ${this.sceneHtml ? unsafeHTML(this.sceneHtml) : nothing}
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scene-stage': SceneStage;
  }
}

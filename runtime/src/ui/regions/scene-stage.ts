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
import type { MarkdownBlock } from '../../markdown';
import { routeToSearch, type AppRoute } from '../../routing';

export type NavigateCallback = (e: Event, route: AppRoute) => void;
export type ToggleBlockCallback = (blockHash: string) => void;

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
   * Pre-rendered scene blocks (M3a.7 P2-2).  Each block carries its
   * own sanitized HTML + content-hash identifier.  The renderer
   * iterates these to support per-block reveal.
   */
  @property({ attribute: false }) sceneBlocks: MarkdownBlock[] = [];
  /**
   * M3a.7 P2-2: set of revealedParagraphs[scenePath] for the
   * current scene.  Players see only blocks whose hash is in this
   * set (unless sceneFullyRevealed is true).  DM sees all blocks
   * with a gutter pip indicating reveal state.
   */
  @property({ attribute: false }) revealedBlocks: Set<string> = new Set();
  /**
   * M3a.7 P2-2: true when the whole scene path is in revealedScenes
   * (legacy whole-scene reveal).  When true, every block is treated
   * as revealed for player rendering — preserves backward compat
   * for scenes revealed via the existing scene-reveal event.
   */
  @property({ type: Boolean }) sceneFullyRevealed: boolean = false;
  /**
   * M3a.7 P2-2: when true, the viewer is the coordinator (DM).
   * DM sees every block with a gutter pip; players see only the
   * revealed subset.  Player-side filtering happens at the DOM
   * level (not CSS) — this is a paced-disclosure boundary, NOT
   * a confidentiality boundary: scene markdown lives in the
   * unencrypted campaign repo per design/security.md (only `dm/*`
   * is age-encrypted), so a determined player can fetch the
   * source directly.  DOM-omission keeps spoilers out of the
   * page for the curious-but-not-adversarial viewer.
   */
  @property({ type: Boolean }) isCoordinator: boolean = false;
  @property({ attribute: false }) onToggleBlock: ToggleBlockCallback | null =
    null;
  /**
   * M3a.6c (P-M3a-scene-strip): parsed YAML frontmatter from the
   * scene file.  Renders the "what am I in" strip below the
   * breadcrumb: location · mood · expectedDuration · presentNpcs
   * (the player's primary glanceability cue per ui.md).  Fields
   * are optional; absent frontmatter renders nothing extra.
   */
  @property({ attribute: false }) sceneFrontmatter: Record<string, unknown> = {};
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
        ${this.renderSceneStrip()}
        ${this.headerExtras}
      </header>
      <section class="card">
        <div class="markdown">${this.renderBlocks()}</div>
      </section>
    `;
  }

  /**
   * M3a.7 P2-2: per-block rendering.  For the DM (coordinator), all
   * blocks render with a gutter pip indicating revealed state; the
   * pip is clickable to toggle reveal.  For players, only blocks
   * whose hash is in `revealedBlocks` (or every block, if
   * `sceneFullyRevealed`) are rendered — non-revealed blocks are
   * omitted from the DOM entirely, not CSS-hidden.  This is a
   * paced-disclosure boundary (keep spoilers out of the casual
   * viewer's page) and NOT a confidentiality boundary — the
   * underlying scene markdown is fetchable from the campaign
   * repo per design/security.md.
   */
  private renderBlocks(): TemplateResult | TemplateResult[] | typeof nothing {
    // Consumers can pass `undefined` explicitly via Lit property
    // bindings (bypassing the field initializer), so we coalesce
    // here.  Same defensive pattern as `sceneFrontmatter`.
    const blocks = this.sceneBlocks ?? [];
    const revealedSet = this.revealedBlocks ?? new Set<string>();
    if (blocks.length === 0) return nothing;
    if (this.isCoordinator) {
      return blocks.map((block) => {
        const revealed =
          this.sceneFullyRevealed || revealedSet.has(block.blockHash);
        return html`
          <div
            class="scene-block scene-block-dm ${revealed
              ? 'scene-block-revealed'
              : 'scene-block-hidden'}"
          >
            <button
              type="button"
              class="scene-block-pip"
              aria-pressed=${revealed ? 'true' : 'false'}
              title=${revealed
                ? `Hide block ${block.index + 1} (currently revealed)`
                : `Reveal block ${block.index + 1} (currently hidden)`}
              @click=${() => this.onToggleBlock?.(block.blockHash)}
            >
              ${revealed ? '●' : '○'}
            </button>
            <div class="scene-block-body">${unsafeHTML(block.html)}</div>
          </div>
        `;
      });
    }
    // Player view: omit non-revealed blocks from the DOM.
    const visible = this.sceneFullyRevealed
      ? blocks
      : blocks.filter((b) => revealedSet.has(b.blockHash));
    return visible.map(
      (block) => html`<div class="scene-block">${unsafeHTML(block.html)}</div>`
    );
  }

  private renderSceneStrip(): TemplateResult | typeof nothing {
    // `sceneFrontmatter` defaults to {} but Lit consumers can pass an
    // explicit `undefined`, which bypasses the field initializer.
    const fm = this.sceneFrontmatter ?? {};
    const parts: TemplateResult[] = [];

    const location =
      typeof fm.location === 'string' ? fm.location : null;
    const mood = typeof fm.mood === 'string' ? fm.mood : null;
    const duration =
      typeof fm.expectedDuration === 'string'
        ? fm.expectedDuration
        : null;
    // presentNpcs is an array per the scene schema; render as a
    // comma-separated list.
    const npcsRaw = fm.presentNpcs;
    const npcs = Array.isArray(npcsRaw)
      ? npcsRaw.filter((n): n is string => typeof n === 'string')
      : [];

    if (location) {
      parts.push(html`<span class="scene-strip-item scene-strip-location"
        >${location}</span
      >`);
    }
    if (mood) {
      parts.push(html`<span class="scene-strip-item scene-strip-mood"
        >${mood}</span
      >`);
    }
    if (duration) {
      parts.push(html`<span class="scene-strip-item scene-strip-duration"
        >${duration}</span
      >`);
    }
    if (npcs.length > 0) {
      parts.push(html`<span class="scene-strip-item scene-strip-npcs"
        >NPCs: ${npcs.join(', ')}</span
      >`);
    }

    if (parts.length === 0) return nothing;
    return html`<div class="scene-strip" role="note">${parts.map((p, i) =>
      i === 0
        ? p
        : html`<span class="scene-strip-sep" aria-hidden="true">·</span>${p}`
    )}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scene-stage': SceneStage;
  }
}

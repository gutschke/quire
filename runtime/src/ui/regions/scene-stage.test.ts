/**
 * <scene-stage> DOM-omission test (M3a.7 P2-2-followup).
 *
 * The load-bearing claim from redesign-plan.md's per-paragraph
 * reveal design is: when a viewer is NOT the coordinator and a
 * block's hash is NOT in `revealedBlocks` (and the whole scene is
 * not in `revealedScenes`), the block's text MUST NOT appear in
 * the rendered DOM.  This test renders the component directly and
 * asserts the negative — non-revealed prose absent from the DOM.
 *
 * Per the comment in scene-stage.ts, this is a paced-disclosure
 * boundary (not a confidentiality boundary — the source markdown
 * is fetchable from the campaign repo).  Even so, the omission is
 * the load-bearing behavior tests must lock.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './scene-stage';
import type { SceneStage } from './scene-stage';
import type { MarkdownBlock } from '../../markdown';
import type { SanitizedHtml } from '../../markdown';

function mountStage(): SceneStage {
  const el = document.createElement('scene-stage') as SceneStage;
  document.body.appendChild(el);
  return el;
}

function block(hash: string, text: string, index: number): MarkdownBlock {
  return {
    blockHash: hash,
    html: `<p>${text}</p>` as SanitizedHtml,
    raw: text,
    index
  };
}

describe('<scene-stage> per-block reveal rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('player view omits non-revealed block text from the DOM', async () => {
    const stage = mountStage();
    stage.campaignName = 'C';
    stage.campaignSlug = 'c';
    stage.episodeName = 'E';
    stage.episodeSlug = 'e';
    stage.scenePath = 's.md';
    stage.sceneBlocks = [
      block('0000000000000001', 'PUBLIC paragraph', 0),
      block('0000000000000002', 'SECRET paragraph', 1),
      block('0000000000000003', 'AFTERWARD paragraph', 2)
    ];
    stage.revealedBlocks = new Set(['0000000000000001']);
    stage.sceneFullyRevealed = false;
    stage.isCoordinator = false;
    await stage.updateComplete;
    const dom = stage.innerHTML;
    expect(dom).toContain('PUBLIC paragraph');
    expect(dom).not.toContain('SECRET paragraph');
    expect(dom).not.toContain('AFTERWARD paragraph');
  });

  it('player view renders everything when sceneFullyRevealed is true', async () => {
    const stage = mountStage();
    stage.scenePath = 's.md';
    stage.sceneBlocks = [
      block('0000000000000001', 'first', 0),
      block('0000000000000002', 'second', 1)
    ];
    stage.revealedBlocks = new Set();
    stage.sceneFullyRevealed = true;
    stage.isCoordinator = false;
    await stage.updateComplete;
    expect(stage.innerHTML).toContain('first');
    expect(stage.innerHTML).toContain('second');
  });

  it('DM view renders every block even when unrevealed (with pip)', async () => {
    const stage = mountStage();
    stage.scenePath = 's.md';
    stage.sceneBlocks = [
      block('0000000000000001', 'visible', 0),
      block('0000000000000002', 'invisible-to-players', 1)
    ];
    stage.revealedBlocks = new Set(['0000000000000001']);
    stage.sceneFullyRevealed = false;
    stage.isCoordinator = true;
    await stage.updateComplete;
    const dom = stage.innerHTML;
    expect(dom).toContain('visible');
    expect(dom).toContain('invisible-to-players');
    // DM view has the gutter pip column.
    expect(stage.querySelectorAll('.scene-block-pip').length).toBe(2);
    // The revealed block has aria-pressed=true; the hidden one false.
    const pips = stage.querySelectorAll<HTMLButtonElement>('.scene-block-pip');
    expect(pips[0].getAttribute('aria-pressed')).toBe('true');
    expect(pips[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('player view renders an empty card when no blocks are revealed', async () => {
    const stage = mountStage();
    stage.scenePath = 's.md';
    stage.sceneBlocks = [block('0000000000000001', 'SECRET', 0)];
    stage.revealedBlocks = new Set();
    stage.sceneFullyRevealed = false;
    stage.isCoordinator = false;
    await stage.updateComplete;
    expect(stage.innerHTML).not.toContain('SECRET');
    // The header still renders (breadcrumb + title).
    expect(stage.innerHTML).toContain('s.md');
  });

  it('clicking a DM pip invokes onToggleBlock with the block hash', async () => {
    const stage = mountStage();
    stage.scenePath = 's.md';
    stage.sceneBlocks = [block('00000000000000ff', 'click-me', 0)];
    stage.revealedBlocks = new Set();
    stage.sceneFullyRevealed = false;
    stage.isCoordinator = true;
    let receivedHash: string | null = null;
    stage.onToggleBlock = (hash: string) => {
      receivedHash = hash;
    };
    await stage.updateComplete;
    const pip = stage.querySelector<HTMLButtonElement>('.scene-block-pip');
    pip!.click();
    expect(receivedHash).toBe('00000000000000ff');
  });

  it('renders the dm-caution banner for dm/ scene paths (P2-10)', async () => {
    const stage = mountStage();
    stage.scenePath = 'dm/secret-truths.md';
    stage.sceneBlocks = [block('0000000000000001', 'spoiler', 0)];
    stage.revealedBlocks = new Set();
    stage.sceneFullyRevealed = true;
    stage.isCoordinator = true;
    await stage.updateComplete;
    expect(stage.innerHTML).toContain('[!CAUTION]');
    expect(stage.querySelector('.dm-caution-banner')).not.toBeNull();
    expect(stage.querySelector('.dm-caution-card')).not.toBeNull();
  });

  it('case-insensitive caution match (DM/, /DM/, /Dm/)', async () => {
    for (const p of ['DM/secret.md', 'scenes/DM/inner.md', 'foo/Dm/x.md']) {
      const stage = mountStage();
      stage.scenePath = p;
      stage.sceneBlocks = [block('0000000000000001', 'x', 0)];
      stage.revealedBlocks = new Set();
      stage.sceneFullyRevealed = true;
      stage.isCoordinator = true;
      await stage.updateComplete;
      expect(
        stage.querySelector('.dm-caution-banner'),
        `expected banner for ${p}`
      ).not.toBeNull();
    }
  });

  it('renders the dm-caution banner for nested /dm/ segments', async () => {
    const stage = mountStage();
    stage.scenePath = 'scenes/dm/aftermath.md';
    stage.sceneBlocks = [block('0000000000000001', 'spoiler', 0)];
    stage.revealedBlocks = new Set(['0000000000000001']);
    stage.sceneFullyRevealed = false;
    stage.isCoordinator = true;
    await stage.updateComplete;
    expect(stage.querySelector('.dm-caution-banner')).not.toBeNull();
  });

  it('does NOT render the caution banner for ordinary scene paths', async () => {
    const stage = mountStage();
    stage.scenePath = 'scenes/intro.md';
    stage.sceneBlocks = [block('0000000000000001', 'body', 0)];
    stage.revealedBlocks = new Set(['0000000000000001']);
    stage.sceneFullyRevealed = false;
    stage.isCoordinator = true;
    await stage.updateComplete;
    expect(stage.querySelector('.dm-caution-banner')).toBeNull();
    expect(stage.querySelector('.dm-caution-card')).toBeNull();
  });

  it('frontmatter strip still renders in player view (it is metadata, not body)', async () => {
    const stage = mountStage();
    stage.scenePath = 's.md';
    stage.sceneBlocks = [block('0000000000000001', 'SECRET-PROSE', 0)];
    stage.sceneFrontmatter = {
      location: 'A bar',
      mood: 'tense'
    };
    stage.revealedBlocks = new Set();
    stage.sceneFullyRevealed = false;
    stage.isCoordinator = false;
    await stage.updateComplete;
    // The body prose stays omitted.
    expect(stage.innerHTML).not.toContain('SECRET-PROSE');
    // Scene-strip frontmatter is fine to surface for players (it
    // describes context the player should know to engage).
    expect(stage.innerHTML).toContain('A bar');
    expect(stage.innerHTML).toContain('tense');
  });
});

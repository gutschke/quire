/**
 * <dm-rail> tests — scene navigator.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import './dm-rail';
import type { DmRail } from './dm-rail';

function mount(): DmRail {
  const el = document.createElement('dm-rail') as DmRail;
  document.body.appendChild(el);
  return el;
}

describe('<dm-rail>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders empty-state when no episodes are loaded', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.innerHTML).toContain('Load a campaign');
  });

  it('renders the list of episodes with their names', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.episodes = [
      { slug: '001', name: 'The Inn', scenes: [] },
      { slug: '002', name: 'The Forest', scenes: [] }
    ];
    await el.updateComplete;
    expect(el.innerHTML).toContain('The Inn');
    expect(el.innerHTML).toContain('The Forest');
  });

  it('expands scenes only under the current episode', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.episodes = [
      { slug: '001', name: 'The Inn', scenes: ['scenes/intro.md'] },
      { slug: '002', name: 'The Forest', scenes: ['scenes/path.md'] }
    ];
    el.currentEpisode = '001';
    el.currentScene = 'scenes/intro.md';
    await el.updateComplete;
    expect(el.innerHTML).toContain('scenes/intro.md');
    // Forest's scene should be hidden since 002 isn't current.
    expect(el.innerHTML).not.toContain('scenes/path.md');
    // Current scene gets the highlight class.
    expect(el.querySelector('.dm-rail-scene-current')).not.toBeNull();
  });

  it('episode click invokes onNavigate with the episode route', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.episodes = [{ slug: '001', name: 'The Inn', scenes: [] }];
    let receivedKind = '';
    el.onNavigate = (_e, route) => {
      receivedKind = route.kind;
    };
    await el.updateComplete;
    el.querySelector<HTMLAnchorElement>('.dm-rail-episode-name')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    expect(receivedKind).toBe('episode');
  });
});

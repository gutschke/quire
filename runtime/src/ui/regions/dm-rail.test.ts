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

  describe('M3D-7: dmDocs sublist', () => {
    it('renders dmDocs beneath scenes when episode is current', async () => {
      const el = mount();
      el.campaignSlug = 'x/y';
      el.episodes = [
        {
          slug: '001',
          name: 'Ep1',
          scenes: ['scenes/01.md'],
          dmDocs: ['dm/pacing.md', 'dm/stakes.md']
        }
      ];
      el.currentEpisode = '001';
      await el.updateComplete;
      expect(el.innerHTML).toContain('dm/pacing.md');
      expect(el.innerHTML).toContain('dm/stakes.md');
      // Sibling group label is present.
      expect(el.querySelector('.dm-rail-dmdocs-label')).not.toBeNull();
      // Dm-docs get the variant class so CSS can amber-tint them.
      expect(el.querySelectorAll('.dm-rail-scene-dmdoc').length).toBe(2);
    });

    it('hides dmDocs when the episode is NOT current', async () => {
      const el = mount();
      el.campaignSlug = 'x/y';
      el.episodes = [
        { slug: '001', name: 'Ep1', scenes: [], dmDocs: ['dm/pacing.md'] },
        { slug: '002', name: 'Ep2', scenes: [], dmDocs: ['dm/stakes.md'] }
      ];
      el.currentEpisode = '001';
      await el.updateComplete;
      // Ep1 is current, its dm-docs render.
      expect(el.innerHTML).toContain('dm/pacing.md');
      // Ep2 is NOT current, its dm-docs are hidden.
      expect(el.innerHTML).not.toContain('dm/stakes.md');
    });

    it('omits the dm-docs label when the array is empty / undefined', async () => {
      const el = mount();
      el.campaignSlug = 'x/y';
      el.episodes = [{ slug: '001', name: 'Ep1', scenes: ['scenes/01.md'] }];
      el.currentEpisode = '001';
      await el.updateComplete;
      expect(el.querySelector('.dm-rail-dmdocs-label')).toBeNull();
    });

    it('dm-doc click invokes onNavigate with kind=scene (same route as scenes)', async () => {
      const el = mount();
      el.campaignSlug = 'x/y';
      el.episodes = [
        { slug: '001', name: 'Ep1', scenes: [], dmDocs: ['dm/pacing.md'] }
      ];
      el.currentEpisode = '001';
      let receivedScene = '';
      el.onNavigate = (_e, route) => {
        if (route.kind === 'scene') receivedScene = route.scene;
      };
      await el.updateComplete;
      const a = el.querySelector<HTMLAnchorElement>(
        '.dm-rail-scene-dmdoc a'
      )!;
      a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(receivedScene).toBe('dm/pacing.md');
    });

    it('current scene highlight applies to dm-docs too', async () => {
      const el = mount();
      el.campaignSlug = 'x/y';
      el.episodes = [
        { slug: '001', name: 'Ep1', scenes: [], dmDocs: ['dm/pacing.md'] }
      ];
      el.currentEpisode = '001';
      el.currentScene = 'dm/pacing.md';
      await el.updateComplete;
      const docLi = el.querySelector('.dm-rail-scene-dmdoc');
      expect(docLi?.classList.contains('dm-rail-scene-current')).toBe(true);
    });
  });
});

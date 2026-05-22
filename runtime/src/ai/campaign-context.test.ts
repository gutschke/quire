/**
 * buildCampaignContext + wrapCampaignContext tests (M3b followup).
 *
 * Selection rules + scope-honored filtering + wrap-each-file round
 * trip.  Network mocking via vi.stubGlobal('fetch') so the suite
 * is hermetic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCampaignContext,
  wrapCampaignContext
} from './campaign-context';

const SOURCE = { owner: 'g', repo: 'underleaf', ref: 'main' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Helper: route the fetch mock so any URL whose path ends with
 * one of the given keys returns the matching body; everything
 * else returns 404.
 */
function mockFetchByPath(bodies: Record<string, string>): void {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [key, body] of Object.entries(bodies)) {
      if (url.endsWith(key)) {
        return new Response(body, { status: 200 });
      }
    }
    return new Response('', { status: 404 });
  });
}

describe('buildCampaignContext — selection', () => {
  it('always includes campaign.json + world/overview.md', async () => {
    mockFetchByPath({
      'campaign.json': '{"name":"X"}',
      'world/overview.md': '# World'
    });
    const ctx = await buildCampaignContext({ source: SOURCE, scope: 'public' });
    const paths = ctx.map((c) => c.path);
    expect(paths).toContain('campaign.json');
    expect(paths).toContain('world/overview.md');
  });

  it('includes episode.json + every scene file when in episode context', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '',
      'episodes/001/episode.json': '{"name":"Ep1"}',
      'episodes/001/scenes/01.md': '# Scene 1',
      'episodes/001/scenes/02.md': '# Scene 2'
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'public',
      episodes: [{ slug: '001', scenes: ['scenes/01.md', 'scenes/02.md'] }]
    });
    const paths = ctx.map((c) => c.path);
    expect(paths).toContain('episodes/001/episode.json');
    expect(paths).toContain('episodes/001/scenes/01.md');
    expect(paths).toContain('episodes/001/scenes/02.md');
  });

  it('excludes dm/* files when scope=public (even when episode loaded)', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '',
      'episodes/001/episode.json': '{}',
      'episodes/001/dm/the-cable.md': 'SPOILER',
      'design/DM-ONLY/antagonist.md': 'ANTAG_SPOILER'
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'public',
      episodes: [{ slug: '001', scenes: [] }]
    });
    const concat = ctx.map((c) => c.content).join('\n');
    expect(concat).not.toContain('SPOILER');
    expect(concat).not.toContain('ANTAG_SPOILER');
  });

  it('includes dm/* files when scope=dm', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '',
      'episodes/001/episode.json': '{}',
      'episodes/001/dm/the-cable.md': 'CABLE_IS_HERE',
      'design/DM-ONLY/antagonist.md': 'ANTAG_IS'
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'dm',
      episodes: [{ slug: '001', scenes: [] }]
    });
    const concat = ctx.map((c) => c.content).join('\n');
    expect(concat).toContain('CABLE_IS_HERE');
    expect(concat).toContain('ANTAG_IS');
  });

  it('tolerates 404s — missing files are silently dropped', async () => {
    mockFetchByPath({
      'campaign.json': '{"only":"this"}'
      // everything else 404s
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'public',
      episodes: [{ slug: '001', scenes: ['scenes/missing.md'] }]
    });
    expect(ctx).toHaveLength(1);
    expect(ctx[0].path).toBe('campaign.json');
  });

  it('returns only safe files (validateContextRef gate applied)', async () => {
    // No way to inject a bad path through the public API today;
    // the safety is in the spec contract — this test guards
    // against a regression where a future caller adds an unsafe
    // ref.  We verify the implementation honors validateContextRef
    // by checking that no fetch URL contains a `..` or schemed path.
    mockFetchByPath({ 'campaign.json': '{}', 'world/overview.md': '' });
    await buildCampaignContext({ source: SOURCE, scope: 'public' });
    const urls = vi
      .mocked(fetch)
      .mock.calls.map(([u]) => (typeof u === 'string' ? u : u.toString()));
    for (const u of urls) {
      expect(u).not.toContain('..');
      expect(u).not.toMatch(/^[a-z]+:\/\/[a-z]+:/i); // no embedded scheme
    }
  });
});

describe('wrapCampaignContext', () => {
  it('returns empty string for empty input', () => {
    expect(wrapCampaignContext([])).toBe('');
  });

  it('wraps each file in an untrusted_content block', () => {
    const out = wrapCampaignContext([
      { path: 'a.md', content: 'hello' },
      { path: 'b.md', content: 'world' }
    ]);
    expect(out).toContain('<untrusted_content source="a.md">');
    expect(out).toContain('hello');
    expect(out).toContain('<untrusted_content source="b.md">');
    expect(out).toContain('world');
    // Two open tags, two close tags.
    expect(out.match(/<untrusted_content/g)?.length).toBe(2);
    expect(out.match(/<\/untrusted_content>/g)?.length).toBe(2);
  });
});

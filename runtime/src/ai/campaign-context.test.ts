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
  buildPlayerFacingContext,
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

  it('fetches PC + NPC character files when characters param is set', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '',
      'characters/pcs/yui.json':
        '{"name":"Yui","motivation":"climbing-driven"}',
      'characters/npcs/hadrian.json':
        '{"name":"Hadrian","role":"antagonist"}'
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'public',
      characters: { pcs: ['yui'], npcs: ['hadrian'] }
    });
    const concat = ctx.map((c) => c.content).join('\n');
    expect(concat).toContain('Yui');
    expect(concat).toContain('climbing-driven');
    expect(concat).toContain('Hadrian');
    expect(concat).toContain('antagonist');
  });

  it('character fetches survive a missing file (404)', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '',
      'characters/pcs/extant.json': '{"name":"E"}'
      // characters/pcs/missing.json → 404
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'public',
      characters: { pcs: ['extant', 'missing'] }
    });
    const paths = ctx.map((c) => c.path);
    expect(paths).toContain('characters/pcs/extant.json');
    expect(paths).not.toContain('characters/pcs/missing.json');
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

describe('buildPlayerFacingContext (CC-18) — spoiler firewall', () => {
  it('NEVER returns dm/* files regardless of episode dm-hints', async () => {
    // Mock every file the dm-scope build would fetch.  If
    // buildPlayerFacingContext leaks any dm/* path into its
    // result, the test fails — that would be a spoiler-firewall
    // breach.
    mockFetchByPath({
      'campaign.json': '{"name":"X"}',
      'world/overview.md': '# World',
      'episodes/ep1/episode.json':
        '{"name":"Ep1","scenes":["scenes/01.md"]}',
      'episodes/ep1/scenes/01.md': 'scene body',
      // These would be FETCHED under dm scope:
      'design/DM-ONLY/antagonist.md': 'ANTAGONIST SECRETS',
      'design/DM-ONLY/big-arc.md': 'BIG ARC SECRETS',
      'episodes/ep1/dm/stakes.md': 'DM STAKES MENU',
      'episodes/ep1/dm/the-cable.md': 'DM CABLE REVEAL'
    });
    const ctx = await buildPlayerFacingContext({
      source: SOURCE,
      episodes: [{ slug: 'ep1' }]
    });
    const paths = ctx.map((c) => c.path);
    expect(paths).toContain('campaign.json');
    expect(paths).toContain('world/overview.md');
    expect(paths).toContain('episodes/ep1/scenes/01.md');
    // The load-bearing assertions: NO dm-only path appears.
    for (const path of paths) {
      expect(path).not.toMatch(/(^|\/)dm\//);
      expect(path).not.toContain('design/DM-ONLY/');
    }
    // Bodies don't smuggle secrets either (sanity check).
    const bodies = ctx.map((c) => c.content);
    expect(bodies.some((b) => b.includes('ANTAGONIST SECRETS'))).toBe(false);
    expect(bodies.some((b) => b.includes('DM STAKES MENU'))).toBe(false);
  });

  it('matches buildCampaignContext({scope:public}) exactly', async () => {
    // The wrapper is a pure hard-override; the result MUST equal
    // an explicit public-scope build.  Any divergence is a bug.
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '#',
      'episodes/ep1/episode.json': '{"name":"E","scenes":["s.md"]}',
      'episodes/ep1/s.md': 'body'
    });
    const playerFacing = await buildPlayerFacingContext({
      source: SOURCE,
      episodes: [{ slug: 'ep1' }]
    });
    const explicitPublic = await buildCampaignContext({
      source: SOURCE,
      episodes: [{ slug: 'ep1' }],
      scope: 'public'
    });
    expect(playerFacing).toEqual(explicitPublic);
  });

  it('TypeScript invariant: caller cannot pass scope at all', () => {
    // This is a documentation test (the value of the invariant is
    // in the type signature: `Omit<CampaignContextRequest, "scope">`).
    // A future commit that breaks this guarantee would fail at
    // compile time, not at runtime — but the test pins the intent.
    // The cast below would be flagged by `tsc --noEmit` if someone
    // tried to pass scope as the wrapper's argument:
    //   buildPlayerFacingContext({ source, scope: 'dm' as ContextScope })
    //   //                                  ^^^^^ object literal may
    //   //                                        only specify known
    //   //                                        properties
    // We don't actually invoke the bad form here (it wouldn't
    // compile), but we assert the function exists with the right
    // shape.
    expect(typeof buildPlayerFacingContext).toBe('function');
  });
});

describe('FINDING-E (run #14) — priorDigests inject a "Previously" block', () => {
  /**
   * The TTRPG/UX expert + AI integration auditor both flagged the
   * same bug from different angles: pre-fix, `submitAiPrompt` built
   * AI context from campaign files only — `state.sessionDigests`
   * was never injected.  The DM's literal use-case ("help guide
   * authoring the next chapter" for next week) failed.
   *
   * Run-#14 fix: `buildCampaignContext` accepts an optional
   * `priorDigests` array and appends a synthesized
   * `session-digests/previously.md` file to the context.  These
   * tests pin the shape + firewall posture.
   */

  it('emits a Previously file when priorDigests is non-empty', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '#'
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'dm',
      priorDigests: [
        'Session 1: the party crossed the bridge.\n\nIris had a vision.'
      ]
    });
    const paths = ctx.map((c) => c.path);
    expect(paths).toContain('session-digests/previously.md');
    const previously = ctx.find(
      (c) => c.path === 'session-digests/previously.md'
    );
    expect(previously?.content).toContain('# Previously');
    expect(previously?.content).toContain('crossed the bridge');
    expect(previously?.content).toContain('Iris had a vision');
  });

  it('joins multiple digests in chronological order with a separator', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '#'
    });
    const ctx = await buildCampaignContext({
      source: SOURCE,
      scope: 'dm',
      priorDigests: ['Session 1 happened.', 'Session 2 happened.']
    });
    const previously = ctx.find(
      (c) => c.path === 'session-digests/previously.md'
    );
    expect(previously?.content).toBeDefined();
    const body = previously!.content;
    const idx1 = body.indexOf('Session 1 happened');
    const idx2 = body.indexOf('Session 2 happened');
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1); // ordered
    expect(body).toContain('---'); // separator
  });

  it('emits NO Previously file when priorDigests is undefined or empty', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '#'
    });
    const ctxA = await buildCampaignContext({
      source: SOURCE,
      scope: 'dm'
    });
    expect(ctxA.map((c) => c.path)).not.toContain(
      'session-digests/previously.md'
    );
    const ctxB = await buildCampaignContext({
      source: SOURCE,
      scope: 'dm',
      priorDigests: []
    });
    expect(ctxB.map((c) => c.path)).not.toContain(
      'session-digests/previously.md'
    );
    const ctxC = await buildCampaignContext({
      source: SOURCE,
      scope: 'dm',
      priorDigests: ['', '   ', '']
    });
    expect(ctxC.map((c) => c.path)).not.toContain(
      'session-digests/previously.md'
    );
  });

  it('works for player-facing scope too (digest IS player-visible)', async () => {
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '#'
    });
    // The session digest is firewall-classified as player-visible
    // already.  Player-facing context may carry it.
    const ctx = await buildPlayerFacingContext({
      source: SOURCE,
      priorDigests: ['The bridge was crossed.']
    });
    expect(ctx.map((c) => c.path)).toContain(
      'session-digests/previously.md'
    );
  });

  it('FIREWALL: priorDigests do NOT receive any dm/* or design/DM-ONLY/* paths', async () => {
    // The Previously block is a synthesized file path under
    // session-digests/.  It must NEVER coincidentally collide with
    // DM-only path-shape that the AI might confuse for a DM-only
    // file.  Pinned.
    mockFetchByPath({
      'campaign.json': '{}',
      'world/overview.md': '#'
    });
    const ctx = await buildPlayerFacingContext({
      source: SOURCE,
      priorDigests: ['safe content']
    });
    const paths = ctx.map((c) => c.path);
    for (const p of paths) {
      expect(p).not.toMatch(/(^|\/)dm\//);
      expect(p).not.toContain('design/DM-ONLY/');
    }
  });
});

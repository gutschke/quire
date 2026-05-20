import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadEpisode, loadScene } from './episode-loader';
import { CampaignLoadError, type CampaignSource } from './campaign-loader';

const SRC: CampaignSource = {
  owner: 'gutschke',
  repo: 'underleaf',
  ref: 'main'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('loadEpisode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a LoadedEpisode for a valid manifest', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        $schemaVersion: '0.1.0',
        name: 'Unattended Baggage',
        summary: 'A test summary.',
        scenes: ['scenes/01-wheels-up.md', 'scenes/02-the-threads.md']
      })
    );

    const result = await loadEpisode(SRC, '001-unattended-baggage');
    expect(result.slug).toBe('001-unattended-baggage');
    expect(result.manifest.name).toBe('Unattended Baggage');
    expect(result.manifest.scenes).toHaveLength(2);
    expect(result.source).toEqual(SRC);
  });

  it('throws on missing episode (404)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    await expect(loadEpisode(SRC, 'missing-slug')).rejects.toThrow(
      CampaignLoadError
    );
  });

  it('throws on invalid JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('not json{{{', { status: 200 })
    );
    await expect(loadEpisode(SRC, '001-x')).rejects.toThrow(/valid JSON/i);
  });

  it('throws on missing name when $schemaVersion is present', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0', summary: 'no name' })
    );
    await expect(loadEpisode(SRC, '001-x')).rejects.toThrow(/name/i);
  });

  it('throws on invalid $schemaVersion', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '1.0', name: 'X' })
    );
    await expect(loadEpisode(SRC, '001-x')).rejects.toThrow(/\$schemaVersion/);
  });

  it('rejects malicious slug input before fetching', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
    await expect(loadEpisode(SRC, '../escape')).rejects.toThrow(
      CampaignLoadError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes AbortSignal through', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0', name: 'X' })
    );
    const ac = new AbortController();
    await loadEpisode(SRC, '001-x', { signal: ac.signal });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: ac.signal })
    );
  });
});

describe('loadScene', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the scene text on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('# Wheels Up\n\nThe cabin is quiet.', { status: 200 })
    );
    const text = await loadScene(
      SRC,
      '001-unattended-baggage',
      'scenes/01-wheels-up.md'
    );
    expect(text).toContain('Wheels Up');
  });

  it('returns null on 404 (optional content)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    const text = await loadScene(SRC, '001-unattended-baggage', 'missing.md');
    expect(text).toBeNull();
  });

  it('rejects scene paths with traversal', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));
    await expect(
      loadScene(SRC, '001-unattended-baggage', '../../etc/passwd')
    ).rejects.toThrow(CampaignLoadError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects scenes outside the scenes folder by composition', async () => {
    // loadScene composes the path episodes/<slug>/<scenePath>.  Path traversal
    // in scenePath is caught by validatePath inside fetchCampaignFile.
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));
    await expect(
      loadScene(SRC, '001-unattended-baggage', '/absolute/path.md')
    ).rejects.toThrow(CampaignLoadError);
  });

  it('uses the correct URL', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }));
    await loadScene(SRC, '001-x', 'scenes/01.md');
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/gutschke/underleaf/main/episodes/001-x/scenes/01.md',
      expect.any(Object)
    );
  });
});

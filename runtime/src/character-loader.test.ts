import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadCharacter,
  CharacterLoadError,
  type CharacterKind
} from './character-loader';
import { type CampaignSource } from './campaign-loader';

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

describe('loadCharacter — basic', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads a PC record', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        $schemaVersion: '0.1.0',
        name: 'Example PC',
        pronouns: 'they/them',
        stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: 1 }
      })
    );
    const result = await loadCharacter(SRC, 'pc', 'example-character');
    expect(result.kind).toBe('pc');
    expect(result.id).toBe('example-character');
    expect(result.record.name).toBe('Example PC');
    expect(result.record.pronouns).toBe('they/them');
  });

  it('loads an NPC record', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        $schemaVersion: '0.1.0',
        name: 'Yui Tanaka',
        role: 'flight attendant'
      })
    );
    const result = await loadCharacter(SRC, 'npc', 'yui-tanaka');
    expect(result.kind).toBe('npc');
    expect(result.id).toBe('yui-tanaka');
    expect(result.record.name).toBe('Yui Tanaka');
  });

  it('uses the correct URL for PCs', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0', name: 'X' })
    );
    await loadCharacter(SRC, 'pc', 'example-character');
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/gutschke/underleaf/main/characters/pcs/example-character.json',
      expect.any(Object)
    );
  });

  it('uses the correct URL for NPCs', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0', name: 'X' })
    );
    await loadCharacter(SRC, 'npc', 'yui-tanaka');
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/gutschke/underleaf/main/characters/npcs/yui-tanaka.json',
      expect.any(Object)
    );
  });
});

describe('loadCharacter — error paths', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    await expect(loadCharacter(SRC, 'pc', 'missing')).rejects.toThrow(
      CharacterLoadError
    );
  });

  it('throws on invalid JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('not json{{{', { status: 200 })
    );
    await expect(loadCharacter(SRC, 'pc', 'x')).rejects.toThrow(/valid JSON/i);
  });

  it('throws on missing name', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0' })
    );
    await expect(loadCharacter(SRC, 'pc', 'x')).rejects.toThrow(/name/i);
  });

  it('throws on invalid $schemaVersion', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '1.0', name: 'X' })
    );
    await expect(loadCharacter(SRC, 'pc', 'x')).rejects.toThrow(
      /\$schemaVersion/
    );
  });

  it('rejects malicious id', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
    await expect(loadCharacter(SRC, 'pc', '../escape')).rejects.toThrow(
      CharacterLoadError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<CharacterKind>(['pc', 'npc'])(
    'passes AbortSignal through (%s)',
    async (kind) => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ $schemaVersion: '0.1.0', name: 'X' })
      );
      const ac = new AbortController();
      await loadCharacter(SRC, kind, 'x', { signal: ac.signal });
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: ac.signal })
      );
    }
  );
});

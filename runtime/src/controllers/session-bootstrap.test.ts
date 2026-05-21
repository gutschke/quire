import { describe, it, expect, vi } from 'vitest';
import {
  extractJoinCode,
  parseRevealedPath,
  scenePathFor,
  buildInviteLink,
  doHostSession,
  doJoinSession,
  doLeaveSession,
  doRegenerateCode,
  doCopyInviteLink,
  type SessionLike
} from './session-bootstrap';

function makeSession(): SessionLike & {
  hostCalls: Array<[string?, unknown?]>;
  joinCalls: Array<[string, string?]>;
  leaveCalls: number;
  regenerateCalls: Array<[string?, unknown?]>;
} {
  return {
    hostCalls: [],
    joinCalls: [],
    leaveCalls: 0,
    regenerateCalls: [],
    async host(displayName, campaign) {
      this.hostCalls.push([displayName, campaign]);
    },
    async join(code, displayName) {
      this.joinCalls.push([code, displayName]);
    },
    leave() {
      this.leaveCalls++;
    },
    async regenerateCode(displayName, campaign) {
      this.regenerateCalls.push([displayName, campaign]);
      return { oldCode: 'OLD123', newCode: 'NEW456' };
    }
  };
}

describe('scenePathFor', () => {
  it('encodes episode + scene into a revealedScenes entry', () => {
    expect(scenePathFor('001-unattended-baggage', 'scenes/01-wheels-up.md'))
      .toBe('episodes/001-unattended-baggage/scenes/01-wheels-up.md');
  });
});

describe('parseRevealedPath', () => {
  it('parses a valid path back to components', () => {
    expect(parseRevealedPath('episodes/001/scenes/01.md'))
      .toEqual({ episode: '001', scene: 'scenes/01.md' });
  });

  it('returns null for non-episode prefix', () => {
    expect(parseRevealedPath('characters/pc/jules.json')).toBeNull();
  });

  it('returns null for missing scene part', () => {
    expect(parseRevealedPath('episodes/')).toBeNull();
    expect(parseRevealedPath('episodes/001')).toBeNull();
  });

  it('round-trips with scenePathFor', () => {
    const orig = scenePathFor('ep', 'scenes/x.md');
    expect(parseRevealedPath(orig)).toEqual({ episode: 'ep', scene: 'scenes/x.md' });
  });
});

describe('extractJoinCode', () => {
  it('uppercases a bare code', () => {
    expect(extractJoinCode('abcd2345')).toBe('ABCD2345');
    expect(extractJoinCode('ABCD2345')).toBe('ABCD2345');
  });

  it('caps a long bare code at 12 chars', () => {
    expect(extractJoinCode('A'.repeat(20))).toHaveLength(12);
  });

  it('returns empty for empty / whitespace input', () => {
    expect(extractJoinCode('')).toBe('');
    expect(extractJoinCode('   ')).toBe('');
  });

  it('extracts the join code from a full invite URL', () => {
    expect(extractJoinCode('https://play.quire.games/?join=ABCD2345')).toBe('ABCD2345');
    expect(extractJoinCode('https://play.quire.games/?campaign=x&join=hello'))
      .toBe('HELLO');
  });

  it('R3-B: returns empty for a URL with no ?join= (no literal-fallback mangling)', () => {
    expect(extractJoinCode('https://example.com/no-join-param')).toBe('');
    expect(
      extractJoinCode('https://play.quire.games/?campaign=gutschke/underleaf')
    ).toBe('');
  });

  it('returns empty for malformed URLs', () => {
    expect(extractJoinCode('https://[malformed')).toBe('');
  });

  it('caps URL-extracted codes at 12 chars', () => {
    expect(extractJoinCode('https://x/?join=' + 'A'.repeat(20))).toHaveLength(12);
  });
});

describe('buildInviteLink', () => {
  it('returns null without a pairing code', () => {
    expect(buildInviteLink('https://play.quire.games/?campaign=x', null)).toBeNull();
    expect(buildInviteLink('https://play.quire.games/?campaign=x', '')).toBeNull();
    expect(buildInviteLink('https://play.quire.games/?campaign=x', undefined)).toBeNull();
  });

  it('appends ?join= when present', () => {
    const link = buildInviteLink('https://play.quire.games/?campaign=x', 'ABC123');
    expect(link).toContain('campaign=x');
    expect(link).toContain('join=ABC123');
  });

  it('strips episode / scene / pc / npc params from the invite', () => {
    const src =
      'https://play.quire.games/?campaign=x&episode=001&scene=scenes/01.md&pc=jules';
    const link = buildInviteLink(src, 'ABC123');
    expect(link).toContain('campaign=x');
    expect(link).toContain('join=ABC123');
    expect(link).not.toContain('episode=');
    expect(link).not.toContain('scene=');
    expect(link).not.toContain('pc=');
  });

  it('returns null on malformed currentUrl', () => {
    expect(buildInviteLink('not a url', 'ABC123')).toBeNull();
  });
});

describe('doHostSession', () => {
  it('calls session.host with trimmed name + campaign', () => {
    const s = makeSession();
    doHostSession(s, '  Alice  ', { owner: 'g', repo: 'u', ref: 'main' });
    expect(s.hostCalls).toHaveLength(1);
    expect(s.hostCalls[0]).toEqual(['Alice', { owner: 'g', repo: 'u', ref: 'main' }]);
  });

  it('treats empty/whitespace name as undefined', () => {
    const s = makeSession();
    doHostSession(s, '   ');
    expect(s.hostCalls[0][0]).toBeUndefined();
  });

  it('no-ops when session is null', () => {
    expect(() => doHostSession(null, 'Alice')).not.toThrow();
  });

  it('swallows host() rejection', async () => {
    const s = {
      ...makeSession(),
      async host() {
        throw new Error('peer broker down');
      }
    } as unknown as SessionLike;
    expect(() => doHostSession(s, 'Alice')).not.toThrow();
    // Wait for the microtask the catch is attached to
    await Promise.resolve();
  });
});

describe('doJoinSession', () => {
  it('uppercases + trims the code and forwards to session.join', () => {
    const s = makeSession();
    const ok = doJoinSession(s, '  abc123  ', 'Bob');
    expect(ok).toBe(true);
    expect(s.joinCalls).toHaveLength(1);
    expect(s.joinCalls[0]).toEqual(['ABC123', 'Bob']);
  });

  it('returns false on empty / whitespace code without calling join', () => {
    const s = makeSession();
    expect(doJoinSession(s, '', 'Bob')).toBe(false);
    expect(doJoinSession(s, '   ', 'Bob')).toBe(false);
    expect(s.joinCalls).toHaveLength(0);
  });

  it('returns false when session is null', () => {
    expect(doJoinSession(null, 'CODE', 'Bob')).toBe(false);
  });

  it('treats empty name as undefined', () => {
    const s = makeSession();
    doJoinSession(s, 'CODE', '');
    expect(s.joinCalls[0][1]).toBeUndefined();
  });
});

describe('doLeaveSession', () => {
  it('calls session.leave when session is set', () => {
    const s = makeSession();
    doLeaveSession(s);
    expect(s.leaveCalls).toBe(1);
  });

  it('no-ops when session is null', () => {
    expect(() => doLeaveSession(null)).not.toThrow();
  });
});

describe('doRegenerateCode', () => {
  it('forwards to session.regenerateCode when confirm returns true', async () => {
    const s = makeSession();
    const r = await doRegenerateCode(
      s,
      'DM',
      { owner: 'g', repo: 'u', ref: 'main' },
      () => true
    );
    expect(s.regenerateCalls).toHaveLength(1);
    expect(s.regenerateCalls[0]).toEqual(['DM', { owner: 'g', repo: 'u', ref: 'main' }]);
    expect(r?.newCode).toBe('NEW456');
  });

  it('returns null without calling session when confirm returns false', async () => {
    const s = makeSession();
    const r = await doRegenerateCode(s, 'DM', undefined, () => false);
    expect(r).toBeNull();
    expect(s.regenerateCalls).toHaveLength(0);
  });

  it('returns null when session is null', async () => {
    const r = await doRegenerateCode(null, 'DM', undefined, () => true);
    expect(r).toBeNull();
  });
});

describe('doCopyInviteLink', () => {
  it('writes to clipboard and returns true on success', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const prompt = vi.fn();
    const ok = await doCopyInviteLink(
      'https://play/?join=ABC',
      clipboard,
      prompt
    );
    expect(ok).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('https://play/?join=ABC');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('falls back to prompt when clipboard rejects', async () => {
    const clipboard = {
      writeText: vi.fn().mockRejectedValue(new Error('no clipboard'))
    };
    const prompt = vi.fn().mockReturnValue('https://play/?join=ABC');
    const ok = await doCopyInviteLink(
      'https://play/?join=ABC',
      clipboard,
      prompt
    );
    expect(ok).toBe(false);
    expect(prompt).toHaveBeenCalledWith('Copy this invite link:', 'https://play/?join=ABC');
  });

  it('falls back to prompt when clipboard is undefined', async () => {
    const prompt = vi.fn().mockReturnValue(null);
    const ok = await doCopyInviteLink(
      'https://play/?join=ABC',
      undefined,
      prompt
    );
    expect(ok).toBe(false);
    expect(prompt).toHaveBeenCalled();
  });
});

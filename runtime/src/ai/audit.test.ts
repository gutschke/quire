/**
 * AI audit chain tests (M3b.3).
 *
 * Hash determinism + chain-head extraction from state.aiAudit.
 */

import { describe, it, expect } from 'vitest';
import { promptHashFor, responseHashFor, chainHead } from './audit';
import type { AiAuditEntry } from '../core/state';

describe('promptHashFor', () => {
  it('returns 64-char full + 16-char short hex', async () => {
    const r = await promptHashFor('Hello', 'sonnet', []);
    expect(r.full).toMatch(/^[0-9a-f]{64}$/);
    expect(r.short).toMatch(/^[0-9a-f]{16}$/);
    expect(r.full.slice(0, 16)).toBe(r.short);
  });

  it('is deterministic for identical inputs', async () => {
    const a = await promptHashFor('Hello', 'sonnet', ['intro.md']);
    const b = await promptHashFor('Hello', 'sonnet', ['intro.md']);
    expect(a.full).toBe(b.full);
  });

  it('changes when model differs', async () => {
    const a = await promptHashFor('Hello', 'sonnet', []);
    const b = await promptHashFor('Hello', 'opus', []);
    expect(a.full).not.toBe(b.full);
  });

  it('changes when contextRefs differ', async () => {
    const a = await promptHashFor('Hello', 'sonnet', ['a.md']);
    const b = await promptHashFor('Hello', 'sonnet', ['b.md']);
    expect(a.full).not.toBe(b.full);
  });
});

describe('responseHashFor', () => {
  it('returns 64-char full + 16-char short hex', async () => {
    const r = await responseHashFor('{"safe":"Hi"}');
    expect(r.full).toMatch(/^[0-9a-f]{64}$/);
    expect(r.short).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic', async () => {
    const a = await responseHashFor('content');
    const b = await responseHashFor('content');
    expect(a.full).toBe(b.full);
  });

  it('domain-separates from promptHashFor (no collision via shared input)', async () => {
    // Hashing "abc" as prompt and "abc" as response must differ
    // because the helpers prepend a domain tag.
    const p = await promptHashFor('abc', '', []);
    const r = await responseHashFor('abc');
    expect(p.full).not.toBe(r.full);
  });
});

describe('chainHead', () => {
  it('returns empty string for an empty audit', () => {
    expect(chainHead([])).toBe('');
  });

  it('returns empty string when only prompts have landed', () => {
    const entries: AiAuditEntry[] = [
      { peerId: 'a', ts: 1, kind: 'prompt', promptHash: 'pppp' }
    ];
    expect(chainHead(entries)).toBe('');
  });

  it('returns the most recent response hash', () => {
    const entries: AiAuditEntry[] = [
      { peerId: 'a', ts: 1, kind: 'prompt', promptHash: 'p1' },
      {
        peerId: 'a',
        ts: 2,
        kind: 'response',
        responseId: 'r-1',
        responseHash: 'r1',
        prevHash: ''
      },
      { peerId: 'a', ts: 3, kind: 'prompt', promptHash: 'p2' },
      {
        peerId: 'a',
        ts: 4,
        kind: 'response',
        responseId: 'r-2',
        responseHash: 'r2',
        prevHash: 'r1'
      }
    ];
    expect(chainHead(entries)).toBe('r2');
  });

  it('skips accept/reject entries when locating the head', () => {
    const entries: AiAuditEntry[] = [
      {
        peerId: 'a',
        ts: 1,
        kind: 'response',
        responseId: 'r-1',
        responseHash: 'r1',
        prevHash: ''
      },
      { peerId: 'a', ts: 2, kind: 'accept', responseId: 'r-1' },
      { peerId: 'a', ts: 3, kind: 'reject', responseId: 'r-1' }
    ];
    expect(chainHead(entries)).toBe('r1');
  });
});

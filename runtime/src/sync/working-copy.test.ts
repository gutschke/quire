import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingCopy, InMemoryWorkingCopyStore } from './working-copy';

let wc: WorkingCopy;

beforeEach(() => {
  wc = new WorkingCopy(new InMemoryWorkingCopyStore());
});

describe('WorkingCopy — read / write / list', () => {
  it('write then read returns the content', async () => {
    await wc.write('episodes/001/scenes/01.md', '# Hello');
    const entry = await wc.read('episodes/001/scenes/01.md');
    expect(entry?.content).toBe('# Hello');
  });

  it('read returns null for missing paths', async () => {
    expect(await wc.read('not/written.md')).toBeNull();
  });

  it('list returns the current dirty set', async () => {
    await wc.write('a.md', 'A');
    await wc.write('b.md', 'B');
    const paths = (await wc.list()).sort();
    expect(paths).toEqual(['a.md', 'b.md']);
  });

  it('overwrite updates content and preserves baseSha from initial write', async () => {
    await wc.write('foo.md', 'v1', 'abc123');
    await wc.write('foo.md', 'v2'); // no baseSha on second write
    const entry = await wc.read('foo.md');
    expect(entry?.content).toBe('v2');
    expect(entry?.baseSha).toBe('abc123');
  });

  it('write records modifiedAt timestamp', async () => {
    const t0 = Date.now();
    await wc.write('x.md', 'X');
    const entry = await wc.read('x.md');
    expect(entry?.modifiedAt).toBeGreaterThanOrEqual(t0);
  });

  it('revert removes the entry', async () => {
    await wc.write('a.md', 'A');
    await wc.revert('a.md');
    expect(await wc.read('a.md')).toBeNull();
    expect(await wc.list()).toEqual([]);
  });

  it('revert is no-op for missing path', async () => {
    await expect(wc.revert('not-there.md')).resolves.toBeUndefined();
  });
});

describe('WorkingCopy — path validation', () => {
  it('rejects empty path', async () => {
    await expect(wc.write('', 'content')).rejects.toThrow(/Invalid/);
  });

  it('rejects leading slash', async () => {
    await expect(wc.write('/abs.md', 'content')).rejects.toThrow(/Invalid/);
  });

  it('rejects .. segments', async () => {
    await expect(wc.write('../escape.md', 'content')).rejects.toThrow(/Invalid/);
    await expect(wc.write('a/../b.md', 'content')).rejects.toThrow(/Invalid/);
  });

  it('rejects double slashes', async () => {
    await expect(wc.write('a//b.md', 'content')).rejects.toThrow(/Invalid/);
  });

  it('rejects invalid characters', async () => {
    await expect(wc.write('a b.md', 'content')).rejects.toThrow(/Invalid/);
    await expect(wc.write('a?.md', 'content')).rejects.toThrow(/Invalid/);
    await expect(wc.write('a\x00.md', 'content')).rejects.toThrow(/Invalid/);
  });

  it('rejects oversized paths', async () => {
    await expect(wc.write('a'.repeat(5000), 'content')).rejects.toThrow(/Invalid/);
  });

  it('accepts realistic campaign paths', async () => {
    const paths = [
      'campaign.json',
      'episodes/001-unattended-baggage/episode.json',
      'episodes/001-unattended-baggage/scenes/01-wheels-up.md',
      'episodes/001-unattended-baggage/dm/npcs.md',
      'characters/pcs/jules-aria-halloway.json'
    ];
    for (const p of paths) {
      await wc.write(p, 'test');
    }
    expect((await wc.list()).length).toBe(paths.length);
  });

  it('read also validates paths', async () => {
    await expect(wc.read('../etc/passwd')).rejects.toThrow(/Invalid/);
  });

  it('revert also validates paths', async () => {
    await expect(wc.revert('/abs')).rejects.toThrow(/Invalid/);
  });
});

describe('WorkingCopy — commits', () => {
  it('commit captures the current dirty set', async () => {
    await wc.write('a.md', 'A');
    await wc.write('b.md', 'B');
    const c = await wc.commit({ message: 'living-doc: npc-update' });
    expect(c.message).toBe('living-doc: npc-update');
    expect([...c.files].sort()).toEqual(['a.md', 'b.md']);
    expect(c.id).toBeTruthy();
    expect(c.committedAt).toBeGreaterThan(0);
  });

  it('commit does NOT clear the working copy', async () => {
    await wc.write('a.md', 'A');
    await wc.commit({ message: 'first' });
    expect(await wc.read('a.md')).not.toBeNull();
  });

  it('listCommits returns commits oldest-first', async () => {
    await wc.write('a.md', 'A');
    const first = await wc.commit({ message: 'first' });
    // small delay to ensure distinct timestamps; otherwise sort is no-op
    await new Promise((r) => setTimeout(r, 5));
    await wc.write('b.md', 'B');
    const second = await wc.commit({ message: 'second' });
    const commits = await wc.listCommits();
    expect(commits.map((c) => c.message)).toEqual(['first', 'second']);
    expect(commits[0].id).toBe(first.id);
    expect(commits[1].id).toBe(second.id);
  });

  it('empty commit (no dirty files) is allowed', async () => {
    const c = await wc.commit({ message: 'empty' });
    expect(c.files).toEqual([]);
  });
});

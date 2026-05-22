/**
 * Unit tests for the M3D-2 campaign-link linter.  Tests run via
 * vitest against the .mjs source so the linter stays runnable as a
 * standalone Node script.
 */

import { describe, it, expect } from 'vitest';
import { extractMdLinks, resolveLink } from './lint-campaign-links.mjs';
import { resolve } from 'node:path';

describe('extractMdLinks', () => {
  it('returns [] for an empty body', () => {
    expect(extractMdLinks('')).toEqual([]);
  });

  it('returns [] when the body has no markdown links', () => {
    expect(extractMdLinks('# Just a heading\nplain text.')).toEqual([]);
  });

  it('extracts a relative .md link', () => {
    expect(
      extractMdLinks('See [the stakes](../dm/stakes.md) for details.')
    ).toEqual([{ href: '../dm/stakes.md', line: 1 }]);
  });

  it('captures the line number (1-based)', () => {
    const body = [
      '# Scene 2',
      '',
      'A link on line 3: [docs](../dm/stakes.md).',
      '',
      'Another on line 5: [coincidences](../dm/coincidences.md).'
    ].join('\n');
    const out = extractMdLinks(body);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ href: '../dm/stakes.md', line: 3 });
    expect(out[1]).toEqual({ href: '../dm/coincidences.md', line: 5 });
  });

  it('strips anchors from .md paths', () => {
    expect(
      extractMdLinks('[the gate](../dm/the-gate.md#act-iii)')
    ).toEqual([{ href: '../dm/the-gate.md', line: 1 }]);
  });

  it('skips external schemes', () => {
    expect(
      extractMdLinks(
        'See [Quire](https://github.com/gutschke/quire) or [email](mailto:a@b.com).'
      )
    ).toEqual([]);
  });

  it('skips protocol-relative URLs', () => {
    expect(extractMdLinks('[ext](//evil.com/x.md)')).toEqual([]);
  });

  it('skips pure-anchor links (no path)', () => {
    expect(extractMdLinks('[jump](#section)')).toEqual([]);
  });

  it('skips non-.md links (images, json refs)', () => {
    expect(
      extractMdLinks('[manifest](campaign.json) [img](./logo.png)')
    ).toEqual([]);
  });

  it('matches multiple links on the same line', () => {
    expect(
      extractMdLinks('[a](one.md) and [b](two.md)')
    ).toEqual([
      { href: 'one.md', line: 1 },
      { href: 'two.md', line: 1 }
    ]);
  });

  it('handles CRLF line endings', () => {
    const body = '[a](one.md)\r\n[b](two.md)';
    expect(extractMdLinks(body)).toEqual([
      { href: 'one.md', line: 1 },
      { href: 'two.md', line: 2 }
    ]);
  });
});

describe('resolveLink', () => {
  const root = '/home/test/campaign';

  it('resolves a sibling-scene link', () => {
    const r = resolveLink(
      '/home/test/campaign/episodes/001/scenes/01.md',
      '02.md',
      root
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.resolved).toBe(
        '/home/test/campaign/episodes/001/scenes/02.md'
      );
  });

  it('resolves a ../ link across folders', () => {
    const r = resolveLink(
      '/home/test/campaign/episodes/001/scenes/02-the-threads.md',
      '../dm/stakes.md',
      root
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.resolved).toBe(
        '/home/test/campaign/episodes/001/dm/stakes.md'
      );
  });

  it('rejects absolute paths', () => {
    const r = resolveLink(
      '/home/test/campaign/x.md',
      '/etc/passwd',
      root
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('absolute');
  });

  it('rejects links that escape the project root', () => {
    const r = resolveLink(
      '/home/test/campaign/x.md',
      '../../../etc/passwd',
      root
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('escape');
  });

  it('accepts a link that resolves to the exact root', () => {
    // edge case: `..` from a 1-deep file lands at root.  A
    // hypothetical link from `root/foo.md` to `..` doesn't make
    // semantic sense for our domain but we accept it as in-tree
    // rather than escape.  We test the case where the target IS
    // exactly the root.
    const r = resolveLink('/home/test/campaign/x.md', '.', root);
    expect(r.ok).toBe(true);
  });

  it('does not false-match prefix-similar paths', () => {
    // If root is /a/b and target resolves to /a/bb, it should be
    // an escape.  Without the trailing-separator check this would
    // pass a string-prefix test.
    const r = resolveLink(
      '/a/b/x.md',
      '../bb/leak.md',
      '/a/b'
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('escape');
  });

  it('handles a target dir given as relative path (normalizes via resolve)', () => {
    // The CLI accepts a relative target-dir; the script normalizes
    // via resolve() before passing here.  Mimic that behavior in
    // the test.
    const r = resolveLink('/a/b/x.md', 'y.md', resolve('/a/b'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toBe('/a/b/y.md');
  });
});

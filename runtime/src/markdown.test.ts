import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  renderMarkdown,
  renderMarkdownDocument,
  renderMarkdownParagraphs,
  blockHash,
  normalizeBlock,
  CryptoUnavailableError
} from './markdown';

describe('parseFrontmatter', () => {
  it('returns empty frontmatter and full body when there is no frontmatter block', () => {
    const text = '# Hello\n\nworld';
    const r = parseFrontmatter(text);
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe(text);
  });

  it('parses simple key/value frontmatter and strips it from the body', () => {
    const text = '---\nname: Test scene\nlocation: A bar\n---\nbody here';
    const r = parseFrontmatter(text);
    expect(r.frontmatter).toEqual({ name: 'Test scene', location: 'A bar' });
    expect(r.body).toBe('body here');
  });

  it('parses lists in frontmatter as arrays', () => {
    const text =
      '---\nname: x\npresentNpcs:\n  - Alice\n  - Bob\n---\nbody';
    const r = parseFrontmatter(text);
    expect(r.frontmatter.presentNpcs).toEqual(['Alice', 'Bob']);
  });

  it('treats malformed frontmatter (missing close) as if absent', () => {
    const text = '---\nname: incomplete\nbody here';
    const r = parseFrontmatter(text);
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe(text);
  });

  it('handles CRLF line endings', () => {
    const text = '---\r\nname: Test\r\n---\r\nbody';
    const r = parseFrontmatter(text);
    expect(r.frontmatter).toEqual({ name: 'Test' });
    expect(r.body).toBe('body');
  });

  it('handles a UTF-8 BOM-prefixed file', () => {
    const text = '﻿---\nname: BOM Test\n---\nbody';
    const r = parseFrontmatter(text);
    expect(r.frontmatter).toEqual({ name: 'BOM Test' });
    expect(r.body).toBe('body');
  });

  it('treats a top-level YAML list as absent frontmatter', () => {
    const text = '---\n- one\n- two\n---\nbody';
    const r = parseFrontmatter(text);
    expect(r.frontmatter).toEqual({});
  });

  it('treats invalid YAML as absent frontmatter', () => {
    const text = '---\nkey: : double colons\n  bad: indent\n---\nbody';
    const r = parseFrontmatter(text);
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe(text);
  });

  it('does not pollute Object.prototype when frontmatter contains __proto__', () => {
    const text =
      '---\n__proto__:\n  polluted: true\n---\nbody';
    parseFrontmatter(text);
    // If pollution occurred, this lookup would return true.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('renderMarkdown', () => {
  it('renders basic Markdown to HTML', () => {
    const html = renderMarkdown('# Hello\n\n**world**');
    expect(html).toContain('<h1');
    expect(html).toContain('Hello');
    expect(html).toContain('<strong>world</strong>');
  });

  it('strips embedded <script> tags', () => {
    const html = renderMarkdown('paragraph\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips inline event handlers on raw HTML elements', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)" alt="x">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('strips javascript: URLs from links', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toMatch(/href=["']?\s*javascript:/i);
  });

  it('strips mixed-case JaVaScRiPt: URLs', () => {
    const html = renderMarkdown('<a href="JaVaScRiPt:alert(1)">click</a>');
    expect(html).not.toMatch(/href=["']?\s*javascript:/i);
  });

  it('strips entity-encoded javascript: URLs', () => {
    const html = renderMarkdown(
      '<a href="&#106;avascript:alert(1)">click</a>'
    );
    expect(html).not.toMatch(/href=["']?\s*javascript:/i);
  });

  it('strips vbscript: URLs from links', () => {
    const html = renderMarkdown('<a href="vbscript:msgbox(1)">click</a>');
    expect(html).not.toMatch(/href=["']?\s*vbscript:/i);
  });

  it('strips data: URLs from links', () => {
    const html = renderMarkdown('<a href="data:text/html,evil">click</a>');
    expect(html).not.toMatch(/href=["']?\s*data:/i);
  });

  it('strips data: URLs from <img src> (SVG XSS vector)', () => {
    const html = renderMarkdown(
      '<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="x">'
    );
    expect(html).not.toMatch(/src=["']?\s*data:/i);
  });

  it('strips blob: URLs from src/href', () => {
    const html = renderMarkdown('<a href="blob:https://evil/x">click</a>');
    expect(html).not.toMatch(/href=["']?\s*blob:/i);
  });

  it('strips filesystem: URLs from src/href', () => {
    const html = renderMarkdown(
      '<a href="filesystem:https://evil/temporary/x">click</a>'
    );
    expect(html).not.toMatch(/href=["']?\s*filesystem:/i);
  });

  it('strips <iframe> entirely (not in HTML profile defaults)', () => {
    const html = renderMarkdown('<iframe src="https://evil"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('strips inline <svg> (excluded from HTML profile)', () => {
    const html = renderMarkdown('<svg onload="alert(1)"><circle /></svg>');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('onload');
  });

  it('adds target=_blank and rel=noopener noreferrer to external https links', () => {
    const html = renderMarkdown('[ext](https://example.com)');
    expect(html).toMatch(/target=["']_blank["']/);
    expect(html).toMatch(/rel=["']noopener noreferrer["']/);
  });

  it('does not add target/rel to relative path links', () => {
    const html = renderMarkdown('[rel](./local.md)');
    expect(html).not.toMatch(/target=["']_blank["']/);
  });

  it('does not add target/rel to relative path links without a leading dot', () => {
    const html = renderMarkdown('[rel](npcs/alice.md)');
    expect(html).toContain('npcs/alice.md');
    expect(html).not.toMatch(/target=["']_blank["']/);
  });

  it('does not add target/rel to hash-only links', () => {
    const html = renderMarkdown('[hash](#section)');
    expect(html).not.toMatch(/target=["']_blank["']/);
  });

  it('does not promote protocol-relative //host links to a new tab', () => {
    const html = renderMarkdown('<a href="//evil.com/x">click</a>');
    expect(html).not.toMatch(/target=["']_blank["']/);
  });

  it('renders fenced code blocks', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```\n');
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('const x = 1');
  });

  it('renders GFM tables', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<td>1</td>');
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> a quote\n');
    expect(html).toContain('<blockquote');
    expect(html).toContain('a quote');
  });
});

describe('renderMarkdownDocument', () => {
  it('returns parsed frontmatter and rendered HTML body', () => {
    const text = '---\nname: Test\n---\n\n# Hello\n\nworld';
    const r = renderMarkdownDocument(text);
    expect(r.frontmatter).toEqual({ name: 'Test' });
    expect(r.html).toContain('<h1');
    expect(r.html).toContain('Hello');
  });

  it('works when there is no frontmatter', () => {
    const r = renderMarkdownDocument('plain markdown');
    expect(r.frontmatter).toEqual({});
    expect(r.html).toContain('plain markdown');
  });
});

describe('normalizeBlock', () => {
  it('collapses internal whitespace runs and trims edges', () => {
    expect(normalizeBlock('  a   b\n\tc  ')).toBe('a b c');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeBlock('   \n\t  \n')).toBe('');
  });

  it('preserves single-space-separated content unchanged', () => {
    expect(normalizeBlock('hello world')).toBe('hello world');
  });
});

describe('blockHash', () => {
  it('returns a 16-character lowercase hex string', async () => {
    const h = await blockHash('hello world');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('equal-after-normalize inputs produce the same hash', async () => {
    const a = await blockHash('a paragraph here');
    const b = await blockHash('  a   paragraph\n  here  ');
    expect(a).toBe(b);
  });

  it('different content produces different hashes', async () => {
    const a = await blockHash('one');
    const b = await blockHash('two');
    expect(a).not.toBe(b);
  });

  it('is deterministic across calls', async () => {
    const a = await blockHash('same text');
    const b = await blockHash('same text');
    expect(a).toBe(b);
  });

  it('throws CryptoUnavailableError when crypto.subtle is missing', async () => {
    // Simulate an insecure-context environment where crypto.subtle
    // is undefined.  vi.stubGlobal restores after the test ends.
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true
    });
    try {
      await expect(blockHash('x')).rejects.toBeInstanceOf(
        CryptoUnavailableError
      );
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: original,
        configurable: true
      });
    }
  });
});

describe('renderMarkdownParagraphs', () => {
  it('splits a simple two-paragraph document into two blocks', async () => {
    const r = await renderMarkdownParagraphs('Para one.\n\nPara two.\n');
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].html).toContain('Para one');
    expect(r.blocks[1].html).toContain('Para two');
  });

  it('hashes each block independently with 16-char hex', async () => {
    const r = await renderMarkdownParagraphs('A.\n\nB.\n');
    expect(r.blocks[0].blockHash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.blocks[1].blockHash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.blocks[0].blockHash).not.toBe(r.blocks[1].blockHash);
  });

  it('treats a heading as its own block', async () => {
    const r = await renderMarkdownParagraphs('# Title\n\nBody.\n');
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].html).toContain('<h1');
    expect(r.blocks[1].html).toContain('Body');
  });

  it('keeps a list as a single block', async () => {
    const r = await renderMarkdownParagraphs(
      '- item one\n- item two\n- item three\n'
    );
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].html).toContain('<ul');
    expect(r.blocks[0].html).toContain('item one');
    expect(r.blocks[0].html).toContain('item three');
  });

  it('keeps a fenced code block as a single block', async () => {
    const r = await renderMarkdownParagraphs(
      '```\nconst x = 1;\nconst y = 2;\n```\n'
    );
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].html).toContain('<pre');
    expect(r.blocks[0].html).toContain('const x');
  });

  it('keeps a blockquote as a single block', async () => {
    const r = await renderMarkdownParagraphs(
      '> Whisper one.\n> Whisper two.\n'
    );
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].html).toContain('<blockquote');
  });

  it('keeps a GFM table as a single block', async () => {
    const r = await renderMarkdownParagraphs(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    );
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].html).toContain('<table');
  });

  it('strips frontmatter before splitting', async () => {
    const r = await renderMarkdownParagraphs(
      '---\nlocation: A bar\n---\n\nFirst para.\n\nSecond para.\n'
    );
    expect(r.frontmatter).toEqual({ location: 'A bar' });
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].html).toContain('First');
  });

  it('identical paragraph text in two places produces identical hashes', async () => {
    const r = await renderMarkdownParagraphs(
      'Same text.\n\nDifferent.\n\nSame text.\n'
    );
    expect(r.blocks).toHaveLength(3);
    expect(r.blocks[0].blockHash).toBe(r.blocks[2].blockHash);
    expect(r.blocks[0].blockHash).not.toBe(r.blocks[1].blockHash);
  });

  it('paragraph reordering does not invalidate block hashes', async () => {
    const original = await renderMarkdownParagraphs(
      'Alpha line.\n\nBeta line.\n\nGamma line.\n'
    );
    const reordered = await renderMarkdownParagraphs(
      'Gamma line.\n\nAlpha line.\n\nBeta line.\n'
    );
    const origHashes = new Set(original.blocks.map((b) => b.blockHash));
    const reorHashes = new Set(reordered.blocks.map((b) => b.blockHash));
    expect(reorHashes).toEqual(origHashes);
  });

  it('editing one paragraph leaves siblings hashes stable', async () => {
    const before = await renderMarkdownParagraphs(
      'Keep this.\n\nEdit me original.\n\nKeep too.\n'
    );
    const after = await renderMarkdownParagraphs(
      'Keep this.\n\nEdit me revised.\n\nKeep too.\n'
    );
    expect(after.blocks[0].blockHash).toBe(before.blocks[0].blockHash);
    expect(after.blocks[2].blockHash).toBe(before.blocks[2].blockHash);
    expect(after.blocks[1].blockHash).not.toBe(before.blocks[1].blockHash);
  });

  it('blocks include their sanitized HTML (no script tags survive)', async () => {
    const r = await renderMarkdownParagraphs(
      'Safe text.\n\n<script>alert(1)</script>\n'
    );
    // Even though the second "block" is just a script tag, the
    // sanitizer strips it — the surviving HTML must not contain a
    // <script> element.
    for (const b of r.blocks) {
      expect(b.html).not.toContain('<script');
    }
  });

  it('returns an empty blocks array for empty input', async () => {
    const r = await renderMarkdownParagraphs('');
    expect(r.blocks).toEqual([]);
    expect(r.frontmatter).toEqual({});
  });
});

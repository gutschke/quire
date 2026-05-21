/**
 * M3a per-paragraph reveal e2e (P2-2 acceptance test from
 * design/redesign-plan.md L437+):
 *
 *   "DM hosts, reveals scene 1 paragraph-by-paragraph; player's
 *    Stage DOM contains paragraphs 1-N only; paragraph N+1's
 *    source text is NOT present in the player's DOM."
 *
 * Threat model framing (project_quire_threat_model): this is a
 * paced-disclosure boundary, not a confidentiality one — the
 * scene markdown lives in the campaign repo and any player can
 * fetch it directly.  The DOM-omission test exists to prevent
 * the ACCIDENTAL spoiler path where a curious player opens the
 * browser inspector and sees text the DM hasn't read aloud yet.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  joinSession
} from './helpers';

const SLUG = 'test-camp';

async function openCampaignPeer(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.log('[browser pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  return page;
}

async function navigateToIntro(page: Page): Promise<void> {
  await page.evaluate(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('episode', '001-test');
    u.searchParams.set('scene', 'scenes/intro.md');
    history.pushState({}, '', u.pathname + u.search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

test.describe('M3a per-paragraph reveal — player DOM omission', () => {
  test('player Stage omits unrevealed block text from the DOM', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx);
      const guest = await openCampaignPeer(guestCtx);
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');
      await navigateToIntro(host);

      // DM whole-scene reveals first so the player can navigate to
      // the page (R3-A bounces non-coord from unrevealed scenes).
      const revealBtn = host.locator(
        '.reveal-control button:has-text("Reveal to players")'
      );
      await expect(revealBtn).toBeVisible({ timeout: 10000 });
      await revealBtn.click();
      await navigateToIntro(guest);
      await expect(guest.locator('header h1')).toContainText(
        'scenes/intro.md',
        { timeout: 10000 }
      );

      // DM Stage shows every block with a clickable gutter pip.
      // intro.md has 3 top-level blocks: H1 "Intro scene",
      // paragraph "A small room…", and a bullet list ("slow drip"
      // / "rust" / "presence").
      await expect(host.locator('.scene-block-pip').first()).toBeVisible({
        timeout: 10000
      });
      await expect(host.locator('.scene-block-pip')).toHaveCount(3);

      // DM clicks the H1 pip (index 0).  Paced mode engages on
      // the player side: only the H1 is now visible.
      await host.locator('.scene-block-pip').nth(0).click();
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('Intro scene');

      // Paragraph + list text MUST NOT appear in the player DOM
      // — this is the load-bearing claim from redesign-plan.md L437.
      const guestHtmlAfterH1 = await guest
        .locator('quire-stage')
        .innerHTML();
      expect(guestHtmlAfterH1).not.toContain('A small room');
      expect(guestHtmlAfterH1).not.toContain('slow drip');
      expect(guestHtmlAfterH1).not.toContain('rust');

      // DM reveals the paragraph (index 1).
      await host.locator('.scene-block-pip').nth(1).click();
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('A small room');
      // Still no list text — that block remains hidden.
      const guestHtmlAfterPara = await guest
        .locator('quire-stage')
        .innerHTML();
      expect(guestHtmlAfterPara).not.toContain('slow drip');

      // DM reveals the list (index 2).
      await host.locator('.scene-block-pip').nth(2).click();
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('slow drip');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});

/**
 * B5 (manual-testing finding): players could see the full episode +
 * scene list in their campaign view, navigate to any episode, and
 * read any scene directly.  This broke the "never leak DM-only
 * material" rule far worse than B4 (NPC sheets) because it lets
 * players read ahead of the DM's reveals.
 *
 * Fix: non-coordinator players in an active session see no
 * episode list, no scene list, and can only navigate to scenes
 * the DM has revealed via the reveal banner.  URL-hopping to
 * non-revealed scenes is refused.
 *
 * Solo mode is unaffected: a solo reader is free to browse the
 * entire campaign (it's public on GitHub anyway).
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  soloPanel,
  activePanel
} from './helpers';

const SLUG = 'test-camp';

async function openCampaignPage(context: BrowserContext, extra: Record<string, string> = {}) {
  const page = await context.newPage();
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG, extra));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

async function joinAsPlayer(
  context: BrowserContext,
  code: string,
  extra: Record<string, string> = {}
): Promise<Page> {
  const page = await openCampaignPage(context, extra);
  await soloPanel(page).locator('input.session-name').fill('Player');
  await soloPanel(page).locator('input.session-code').fill(code);
  await soloPanel(page).getByRole('button', { name: /^join$/i }).click();
  await expect(activePanel(page)).toBeVisible({ timeout: 30000 });
  return page;
}

test.describe('R3-A — pre-session URL arrivals do not leak scene content', () => {
  test('opening a scene URL without a session bounces to error view', async ({
    browser
  }) => {
    // The exact scenario the user reported: DM shares their address-bar
    // URL `?campaign=X&episode=Y&scene=Z` in a group chat.  A player
    // clicks it in an incognito window.  Previously they saw the
    // rendered scene immediately.  Now they're bounced to an error
    // view explaining they need to join the session first.
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await mockFixtureCampaign(page, SLUG);
      await page.goto(
        campaignUrl(SLUG, {
          episode: '001-test',
          scene: 'scenes/intro.md'
        })
      );
      await expect(page.locator('.card.error')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.card.error')).toContainText(
        /only visible inside an active session/i
      );
      // The scene markdown content must NOT have rendered.  The
      // body has no .markdown element at all (we're on the error
      // view, not the scene view).  Asserting via innerHTML on the
      // visible content avoids a locator-not-found wait.
      const visibleText = await page.locator('body').innerText();
      expect(visibleText).not.toContain('Intro scene');
      expect(visibleText).not.toContain('a slow drip');
    } finally {
      await ctx.close();
    }
  });

  test('opening an episode URL without a session is blocked too', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await mockFixtureCampaign(page, SLUG);
      await page.goto(
        campaignUrl(SLUG, { episode: '001-test' })
      );
      await expect(page.locator('.card.error')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.card.error')).toContainText(
        /only visible inside an active session/i
      );
    } finally {
      await ctx.close();
    }
  });

  test('DM solo-prep: can navigate to scene after clicking Host', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      await hostSession(page, 'DM');
      // In-app navigation via pushState preserves the session.
      await page.evaluate(() => {
        const u = new URL(window.location.href);
        u.searchParams.set('episode', '001-test');
        u.searchParams.set('scene', 'scenes/intro.md');
        history.pushState({}, '', u.pathname + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page.locator('header h1')).toContainText(
        'scenes/intro.md',
        { timeout: 10000 }
      );
      await expect(page.locator('.markdown')).toContainText('Intro scene');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('DM-screen guard for scenes/episodes (B5)', () => {
  test('solo: episode + scene lists visible (no session, no DM secret)', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      // Episode list is in the campaign view.
      await expect(page.getByRole('link', { name: '001-test' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('active session, coordinator (DM): episode + scene lists visible', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      await hostSession(page, 'DM');
      // The DM Rail also surfaces the episode link (M3a.9); scope
      // to the Stage so the campaign-body assertion is unambiguous.
      await expect(
        page.locator('quire-stage').getByRole('link', { name: '001-test' })
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });

  test('active session, non-coordinator: episode list is HIDDEN on campaign view', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openCampaignPage(hostCtx);
      const code = await hostSession(hostPage, 'DM');
      const guestPage = await joinAsPlayer(guestCtx, code);
      // Episode link should NOT appear.
      await expect(
        guestPage.getByRole('link', { name: '001-test' })
      ).not.toBeVisible();
      // The "Episodes" heading should also be absent.
      await expect(guestPage.getByText(/^Episodes$/i)).not.toBeVisible();
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('active session, non-coordinator URL-hop to episode is blocked', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openCampaignPage(hostCtx);
      const code = await hostSession(hostPage, 'DM');
      const guestPage = await joinAsPlayer(guestCtx, code);
      // In-page navigation to the episode route.
      await guestPage.evaluate(() => {
        const u = new URL(window.location.href);
        u.searchParams.set('episode', '001-test');
        history.pushState({}, '', u.pathname + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(guestPage.locator('.card.error')).toBeVisible({
        timeout: 10000
      });
      await expect(guestPage.locator('.card.error')).toContainText(
        /only visible to the DM/i
      );
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('active session, non-coordinator URL-hop to non-revealed scene is blocked', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openCampaignPage(hostCtx);
      const code = await hostSession(hostPage, 'DM');
      const guestPage = await joinAsPlayer(guestCtx, code);
      // DM has not revealed anything yet.  Guest tries scene URL.
      await guestPage.evaluate(() => {
        const u = new URL(window.location.href);
        u.searchParams.set('episode', '001-test');
        u.searchParams.set('scene', 'scenes/intro.md');
        history.pushState({}, '', u.pathname + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(guestPage.locator('.card.error')).toBeVisible({
        timeout: 10000
      });
      await expect(guestPage.locator('.card.error')).toContainText(
        /not been revealed/i
      );
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('active session, non-coordinator CAN reach a scene the DM revealed (via banner)', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openCampaignPage(hostCtx);
      const code = await hostSession(hostPage, 'DM');
      const guestPage = await joinAsPlayer(guestCtx, code);
      // DM navigates to scene 1, reveals.
      await hostPage.evaluate(() => {
        const u = new URL(window.location.href);
        u.searchParams.set('episode', '001-test');
        u.searchParams.set('scene', 'scenes/intro.md');
        history.pushState({}, '', u.pathname + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await hostPage
        .locator('.reveal-control button:has-text("Reveal to players")')
        .click();
      // Guest sees banner.
      const banner = guestPage.locator('.reveal-banner');
      await expect(banner).toBeVisible({ timeout: 10000 });
      // Click → lands on scene.
      await banner.locator('a').first().click();
      await expect(guestPage.locator('header h1')).toContainText(
        'scenes/intro.md',
        { timeout: 10000 }
      );
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});

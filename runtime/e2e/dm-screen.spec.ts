/**
 * DM-screen guard: NPC sheets carry dmNotes / signature / voice /
 * disposition that are story spoilers.  In an active session,
 * players (non-coordinators) must not be able to navigate to those
 * pages or see them listed in the campaign-view menu.
 *
 * In solo mode, the gate is lifted — a solo reader is free to
 * browse NPC content.
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import {
  openCampaign,
  campaignUrl,
  mockFixtureCampaign,
  hostSession,
  soloPanel,
  activePanel
} from './helpers';

const SLUG = 'test-camp';

async function joinAsPlayer(
  ctx: BrowserContext,
  code: string,
  extra: Record<string, string> = {}
): Promise<import('@playwright/test').Page> {
  const page = await ctx.newPage();
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG, extra));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  await soloPanel(page).locator('input.session-name').fill('Player');
  await soloPanel(page).locator('input.session-code').fill(code);
  await soloPanel(page).getByRole('button', { name: /^join$/i }).click();
  await expect(activePanel(page)).toBeVisible({ timeout: 30000 });
  return page;
}

test.describe('DM-screen guard (B4) — NPC visibility', () => {
  test('solo mode: NPC menu visible and sheet loadable (no session, no DM secret)', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      // Campaign view shows NPC link.
      await expect(page.getByRole('link', { name: 'test-npc' })).toBeVisible();
      // NPC sheet loads.
      const npcPage = await openCampaign(ctx, SLUG, { npc: 'test-npc' });
      await expect(npcPage.locator('header h1')).toContainText('Test NPC');
    } finally {
      await ctx.close();
    }
  });

  test('active session, coordinator (DM): NPC menu + sheet visible', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      await hostSession(page, 'DM');
      // Reload to ensure the active session is reflected when rendering
      // the campaign view's menu.
      await page.reload();
      await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
      // DM still sees NPC menu entry.
      await expect(
        page.getByRole('link', { name: 'test-npc' })
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });

  test('active session, non-coordinator: NPC menu hidden on campaign view', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openCampaign(hostCtx, SLUG);
      const code = await hostSession(hostPage, 'DM');
      // joinAsPlayer leaves the guest on the campaign view in active
      // session.  Do NOT page.goto() again — that reloads, destroys
      // the SessionController, and drops the guest back to solo.
      const guestPage = await joinAsPlayer(guestCtx, code);
      // PCs section still shows.
      await expect(
        guestPage.getByRole('link', { name: 'test-pc' })
      ).toBeVisible({ timeout: 10000 });
      // NPCs section is GONE (the menu is gated on
      // isCoordinator() in renderCharacterMenus).
      await expect(
        guestPage.getByRole('link', { name: 'test-npc' })
      ).not.toBeVisible();
      // No "Non-player characters" heading.
      await expect(
        guestPage.getByText(/non-player characters/i)
      ).not.toBeVisible();
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('active session, non-coordinator in-page nav to NPC: blocked', async ({
    browser
  }) => {
    // The realistic threat: a player who knows the URL pattern tries
    // to in-page navigate (history.pushState + navigateToRoute) to an
    // NPC sheet while remaining in the session.  The router's
    // character-route handler rejects with a CharacterLoadError that
    // bubbles to the error view.
    //
    // Note: a determined player could open a second tab in solo
    // mode and view the NPC there — we can't sandbox browser tabs.
    // What we can guarantee is "no NPC content while in the
    // session", which is what this test asserts.
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openCampaign(hostCtx, SLUG);
      const code = await hostSession(hostPage, 'DM');
      const guestPage = await joinAsPlayer(guestCtx, code);

      // Simulate an in-page navigation via history.pushState +
      // popstate, which is the same path the runtime's own
      // navigate() click-handler uses.
      await guestPage.evaluate(() => {
        const url = window.location.pathname + window.location.search.replace(
          /(\?[^#]*)/,
          '$1&npc=test-npc'
        );
        history.pushState({}, '', url);
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

  test('solo-mode NPC visibility: documented trade-off, not a bug', async ({
    browser
  }) => {
    // A determined player can open a second tab outside the
    // session and browse the campaign's public content, including
    // NPC sheets, because the source repo is public on GitHub
    // anyway.  This test documents that gap so it's not surprising:
    // we protect the session, not the campaign.  If a campaign
    // genuinely needs NPC secrets, the author should keep them in
    // a separate private repo or a DM-only file the loader doesn't
    // fetch in the public campaign view.
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG, { npc: 'test-npc' });
      await expect(page.locator('header h1')).toContainText('Test NPC');
    } finally {
      await ctx.close();
    }
  });
});

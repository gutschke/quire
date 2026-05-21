/**
 * Multi-peer sync e2e: dice rolls, PC stat edits, scene reveal banner.
 * Both browsers open the same fixture campaign so they share the
 * surfaces that gate these features (roll panel needs a campaign;
 * PC edit needs a PC sheet; scene reveal needs a scene view).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  joinSession,
  rollInput,
  rollHistory
} from './helpers';

const SLUG = 'test-camp';

async function openCampaignPeer(
  ctx: BrowserContext,
  extra: Record<string, string> = {}
): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.log('[browser pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG, extra));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

test.describe('Multi-peer sync — dice', () => {
  test('host rolls are visible in guest chat (chat fallback)', async ({
    browser
  }) => {
    // Dice rolls aren't surfaced in a UI panel on the guest yet — they
    // ARE captured as 'dice-roll' events in shared state, but only the
    // local roll panel renders dice for the user, and that's
    // intentionally per-peer.  We verify the cross-peer signal by
    // checking that the event reached the guest's state through the
    // window via evaluate(); the panel-level "visible" guarantee can
    // come later if we surface a shared rolls log.
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx);
      const guest = await openCampaignPeer(guestCtx);
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');

      await rollInput(host).fill('2d6+1');
      await rollInput(host).press('Enter');
      // Host's own roll panel shows it locally.
      await expect(rollHistory(host)).toContainText('2d6+1');
      // Guest's shared state contains the dice-roll event.
      await expect
        .poll(
          async () =>
            await guest.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: { shared: { diceRolls: unknown[] } } | null;
              };
              return app?.sessionView?.shared.diceRolls.length ?? 0;
            }),
          { timeout: 15000 }
        )
        .toBeGreaterThan(0);
      const guestRoll = await guest.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          sessionView: {
            shared: { diceRolls: Array<{ expression: string; result: number }> };
          };
        };
        return app.sessionView.shared.diceRolls[0];
      });
      expect(guestRoll.expression).toBe('2d6+1');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});

test.describe('Multi-peer sync — PC stat edits', () => {
  test('host edit propagates to guest', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      // Both peers open the same PC sheet.
      const host = await openCampaignPeer(hostCtx, { pc: 'test-pc' });
      const guest = await openCampaignPeer(guestCtx, { pc: 'test-pc' });
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');

      // Bumpers appear in active session (PC sheet, both sides).
      const hostStrPlus = host.locator(
        'button[aria-label="Increase STR"]'
      );
      await expect(hostStrPlus).toBeVisible({ timeout: 10000 });
      await hostStrPlus.click();
      // Guest sees STR bump from 0 to +1.
      await expect.poll(
        async () =>
          await guest.evaluate(() => {
            const app = document.querySelector('quire-app') as unknown as {
              effectiveCharacter: (c: unknown) => { stats?: { str?: number } };
              appState: {
                kind: string;
                character?: unknown;
              };
            };
            if (app.appState.kind !== 'character') return null;
            return app.effectiveCharacter(app.appState.character).stats?.str;
          }),
        { timeout: 15000 }
      ).toBe(1);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('guest edit propagates to host (harm/stress boxes)', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx, { pc: 'test-pc' });
      const guest = await openCampaignPeer(guestCtx, { pc: 'test-pc' });
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');

      // Guest clicks harm box 2.
      const guestHarmBox2 = guest.locator(
        'button.track-box[aria-label*="harm box 2"]'
      );
      await expect(guestHarmBox2).toBeVisible({ timeout: 10000 });
      await guestHarmBox2.click();
      // Host's shared state harm should be 2.
      await expect
        .poll(
          async () =>
            await host.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                effectiveCharacter: (c: unknown) => { harm?: number };
                appState: { kind: string; character?: unknown };
              };
              if (app.appState.kind !== 'character') return null;
              return app.effectiveCharacter(app.appState.character).harm;
            }),
          { timeout: 15000 }
        )
        .toBe(2);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});

test.describe('Multi-peer sync — scene reveal', () => {
  test('host reveal: guest sees banner with click-to-follow', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      // Post-R3-A: scene routes need an active session.  Host
      // first, then in-app navigate to the scene.
      const host = await openCampaignPeer(hostCtx);
      const guest = await openCampaignPeer(guestCtx);
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');
      await host.evaluate(() => {
        const u = new URL(window.location.href);
        u.searchParams.set('episode', '001-test');
        u.searchParams.set('scene', 'scenes/intro.md');
        history.pushState({}, '', u.pathname + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      // Host clicks "Reveal to players".
      const revealBtn = host.locator(
        '.reveal-control button:has-text("Reveal to players")'
      );
      await expect(revealBtn).toBeVisible({ timeout: 10000 });
      await revealBtn.click();

      // Guest sees the banner above the body with intro.md chip.
      const banner = guest.locator('.reveal-banner');
      await expect(banner).toBeVisible({ timeout: 10000 });
      await expect(banner).toContainText('intro.md');
      // Click-to-follow navigates the guest to the scene.
      await banner.locator('a').first().click();
      await expect(guest.locator('header h1')).toContainText('scenes/intro.md', {
        timeout: 10000
      });
      // F4 change: banner stays visible (so multi-scene reveals
      // remain navigable), but the current-scene chip is marked
      // with "(here)" so it's obvious which one you're on.
      await expect(banner).toBeVisible();
      await expect(banner.locator('.reveal-chip-current')).toContainText(
        'intro.md'
      );
      await expect(banner.locator('.reveal-chip-current')).toContainText('here');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});

/**
 * Solo-mode flows that don't require multi-peer setup.  These
 * exercise the UI surface that a single browser sees: the session
 * bar's solo / connecting / error / active transitions, the dice
 * panel in solo mode (local-only), and the AI panel's visibility +
 * settings persistence.
 *
 * The campaign isn't loaded here (no GitHub fetches).  Tests that
 * need a real campaign go into routing.spec.ts with fixture
 * interception.
 */

import { test, expect } from '@playwright/test';
import {
  openApp,
  soloPanel,
  activePanel,
  errorPanel,
  hostSession,
  aiPanel
} from './helpers';

test.describe('Solo session flow', () => {
  test('starts in solo / idle and shows the Host / Join controls', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await expect(soloPanel(page)).toBeVisible();
      await expect(
        soloPanel(page).getByRole('button', { name: /host session/i })
      ).toBeVisible();
      await expect(
        soloPanel(page).getByRole('button', { name: /^join$/i })
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('leave-session returns from active to solo', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await hostSession(page, 'DM');
      await expect(activePanel(page)).toBeVisible();
      await activePanel(page).getByRole('button', { name: /leave/i }).click();
      await expect(soloPanel(page)).toBeVisible({ timeout: 5000 });
      await expect(activePanel(page)).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('join with an unknown code surfaces a typed error to the user', async ({
    browser
  }) => {
    // R2.3 fix: PeerJSTransport translates PeerJS's async
    // "peer-unavailable" event into a TransportError, which
    // SessionController bubbles into the error panel.  Before the
    // fix, the panel transitioned to "active" with 0 peers and
    // stayed there — visually a successful join.
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await soloPanel(page).locator('input.session-name').fill('Player');
      await soloPanel(page).locator('input.session-code').fill('NOSUCHCODE');
      await soloPanel(page).getByRole('button', { name: /^join$/i }).click();
      await expect(errorPanel(page)).toBeVisible({ timeout: 15000 });
      await expect(errorPanel(page)).toContainText(/peer|unavailable/i);
    } finally {
      await ctx.close();
    }
  });
});

// Dice panel tests live in routing.spec.ts (Phase D), where the
// fixture campaign provides the campaign view that surfaces the
// roll panel.  In the home / idle view the roll panel is hidden by
// design — there's no campaign context for the rolls to belong to.

test.describe('AI panel — solo visibility + settings persistence', () => {
  test('AI panel is visible in solo mode', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await expect(aiPanel(page)).toBeVisible();
      await expect(aiPanel(page).locator('h2')).toContainText(/DM aide/i);
    } finally {
      await ctx.close();
    }
  });

  test('settings round-trip via localStorage', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      // Fill the API key field.
      await aiPanel(page).locator('input[type=password]').fill('sk-ant-fake');
      // Read back from localStorage.
      const stored = await page.evaluate(() =>
        window.localStorage.getItem('quire.ai.claude.apiKey')
      );
      expect(stored).toBe('sk-ant-fake');
      // Reload and verify hydration.
      await page.reload();
      await page.locator('.session-bar').first().waitFor();
      const hydrated = await page.evaluate(() =>
        window.localStorage.getItem('quire.ai.claude.apiKey')
      );
      expect(hydrated).toBe('sk-ant-fake');
    } finally {
      await ctx.close();
    }
  });

  test('provider radio swaps the API key field placeholder', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      // Default is Claude; placeholder should mention sk-ant-.
      const keyInput = aiPanel(page).locator('input[type=password]');
      await expect(keyInput).toHaveAttribute('placeholder', /sk-ant/);
      // Switch to Gemini.
      await aiPanel(page)
        .locator('input[type=radio][name=ai-provider]')
        .nth(1)
        .check();
      await expect(keyInput).toHaveAttribute('placeholder', /AIza/);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('AI panel — hidden from non-coordinator guests', () => {
  test('guest in active session sees no AI panel', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openApp(hostCtx);
      const guestPage = await openApp(guestCtx);
      const code = await hostSession(hostPage, 'DM');
      await guestPage
        .locator('.session-bar.session-solo input.session-name')
        .fill('Player');
      await guestPage
        .locator('.session-bar.session-solo input.session-code')
        .fill(code);
      await guestPage
        .locator('.session-bar.session-solo')
        .getByRole('button', { name: /^join$/i })
        .click();
      await expect(guestPage.locator('.session-bar.session-active')).toBeVisible(
        { timeout: 30000 }
      );
      await expect(guestPage.locator('.ai-panel')).not.toBeVisible();
      // Host (coordinator) still sees it.
      await expect(hostPage.locator('.ai-panel')).toBeVisible();
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});

/**
 * Manual-testing finding: pre-host UX was ambiguous about when a
 * player should join.  Three fixes landed:
 *
 *   1. Role hint above the solo bar tells DM and player what to do.
 *   2. Pairing-code placeholder is action-focused ("paste code from
 *      your DM"), not a fake example (was "ABCD2345").
 *   3. Copy-invite button on the active host bar produces a
 *      ?join=CODE URL; opening that URL pre-fills the join field.
 *
 * Also fixed in this round: the DM-aide Settings/Hide-Settings
 * toggle was non-functional when no key was set (settings forced
 * open by !hasKey).  The button is now hidden when no key —
 * settings are always shown until a key is provided.
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import {
  mockFixtureCampaign,
  campaignUrl,
  appUrl,
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

test.describe('Pre-host UX (manual-testing follow-ups)', () => {
  test('role hint appears on solo bar with both DM and player guidance', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      const hint = page.locator('.session-role-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toContainText(/DM/);
      await expect(hint).toContainText(/Player/);
    } finally {
      await ctx.close();
    }
  });

  test('pairing-code placeholder is action-focused (not a fake example)', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      const codeInput = soloPanel(page).locator('input.session-code');
      const placeholder = await codeInput.getAttribute('placeholder');
      expect(placeholder).toBeTruthy();
      // Must not look like a real code; must describe the action.
      expect(placeholder).not.toMatch(/^[A-Z2-9]{4,}$/);
      expect(placeholder!.toLowerCase()).toMatch(/paste|code/);
    } finally {
      await ctx.close();
    }
  });

  test('Copy-invite button appears on host bar and produces ?join= URL', async ({
    browser
  }) => {
    const ctx = await browser.newContext({
      // Grant clipboard permission so navigator.clipboard.writeText works.
      permissions: ['clipboard-read', 'clipboard-write']
    });
    try {
      const page = await openCampaignPage(ctx);
      const code = await hostSession(page, 'DM');
      const copyBtn = page.locator('button.session-copy-invite');
      await expect(copyBtn).toBeVisible({ timeout: 5000 });
      await copyBtn.click();
      await expect(copyBtn).toContainText('Copied!', { timeout: 3000 });
      // Verify clipboard contents.
      const clipText = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      expect(clipText).toContain(`join=${code}`);
      expect(clipText).toContain(`campaign=test%2F${SLUG}`);
    } finally {
      await ctx.close();
    }
  });

  test('?join= URL pre-fills the pairing code input', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await mockFixtureCampaign(page, SLUG);
      await page.goto(
        appUrl({ campaign: `test/${SLUG}`, join: 'M3K7N2PQ' })
      );
      await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
      const codeInput = soloPanel(page).locator('input.session-code');
      await expect(codeInput).toHaveValue('M3K7N2PQ');
    } finally {
      await ctx.close();
    }
  });

  test('DM-aide Settings toggle is hidden when no key is set', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      // Solo + no API key → settings forced open.  The toggle button
      // should NOT be visible (its click would be a no-op).
      await expect(page.locator('.ai-settings')).toBeVisible();
      await expect(page.locator('button.ai-settings-toggle')).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('DM-aide Settings toggle appears once a key is set and works', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      // Enter a key.  Once present, settings auto-collapse (they
      // were force-shown only because of the missing key) — toggle
      // appears with label "Settings", clicking reopens them.
      await page
        .locator('.ai-settings input[type=password]')
        .fill('sk-ant-test');
      const toggle = page.locator('button.ai-settings-toggle');
      await expect(toggle).toBeVisible({ timeout: 3000 });
      // Settings auto-hid once the key was provided.
      await expect(page.locator('.ai-settings')).not.toBeVisible({
        timeout: 3000
      });
      // First click ("Settings") reopens them.
      await toggle.click();
      await expect(page.locator('.ai-settings')).toBeVisible();
      // Second click ("Hide settings") collapses them again — this
      // is the actual behavior the original bug report was about.
      await toggle.click();
      await expect(page.locator('.ai-settings')).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('API key hint with link is visible in settings', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaignPage(ctx);
      const hint = page.locator('.ai-key-hint');
      await expect(hint).toBeVisible();
      // Default provider is Claude — should link to Anthropic console.
      const linkHref = await hint.locator('a').getAttribute('href');
      expect(linkHref).toContain('anthropic.com');
      // Switch to Gemini — link should change.
      await page
        .locator('input[type=radio][name=ai-provider]')
        .nth(1)
        .check();
      await expect(hint.locator('a')).toHaveAttribute(
        'href',
        /aistudio\.google\.com/
      );
    } finally {
      await ctx.close();
    }
  });

  test('Solo session-bar shows active panel after auto-joining via ?join= + name', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const playerCtx = await browser.newContext();
    try {
      const host = await openCampaignPage(hostCtx);
      const code = await hostSession(host, 'DM');
      // Player opens via invite link.
      const player = await ctxFromInvite(playerCtx, code);
      // Fills name, clicks Join.
      await soloPanel(player).locator('input.session-name').fill('Sam');
      await soloPanel(player).getByRole('button', { name: /^join$/i }).click();
      await expect(activePanel(player)).toBeVisible({ timeout: 30000 });
    } finally {
      await hostCtx.close();
      await playerCtx.close();
    }
  });
});

async function ctxFromInvite(
  context: BrowserContext,
  joinCode: string
) {
  const page = await context.newPage();
  await mockFixtureCampaign(page, SLUG);
  await page.goto(appUrl({ campaign: `test/${SLUG}`, join: joinCode }));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

/**
 * Error-state e2e: campaign 404, malformed manifest, malformed JSON.
 * These exercise the loader's defensive paths through the real
 * fetch + display chain (vs the unit tests which mock fetch directly).
 */

import { test, expect } from '@playwright/test';
import { appUrl } from './helpers';

test.describe('Error states', () => {
  test('404 on campaign manifest renders an error card', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      // Don't register any fixture route — the GitHub raw URL fetch
      // will fail at the network level (or hit real GitHub and 404).
      await page.route(
        '**/raw.githubusercontent.com/**',
        async (route) => {
          await route.fulfill({ status: 404, body: '' });
        }
      );
      await page.goto(appUrl({ campaign: 'nonsense/nope' }));
      await expect(page.locator('.card.error')).toBeVisible({
        timeout: 15000
      });
      await expect(page.locator('.card.error')).toContainText(
        /couldn[’']t load|not found/i
      );
    } finally {
      await ctx.close();
    }
  });

  test('malformed JSON in manifest surfaces a JSON parse error', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.route(
        '**/raw.githubusercontent.com/**/campaign.json',
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{ "name": "broken'
          });
        }
      );
      await page.goto(appUrl({ campaign: 'badjson/badjson' }));
      await expect(page.locator('.card.error')).toBeVisible({
        timeout: 15000
      });
      await expect(page.locator('.card.error')).toContainText(
        /json|parse|valid/i
      );
    } finally {
      await ctx.close();
    }
  });

  test('manifest missing required name field surfaces a schema error', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      // Order: register the broad route FIRST, then the specific one.
      // Playwright tries the most-recently-registered matching route
      // first, so this ordering makes campaign.json win.
      await page.route(
        '**/raw.githubusercontent.com/**',
        async (route) => {
          await route.fulfill({ status: 404, body: '' });
        }
      );
      await page.route(
        '**/raw.githubusercontent.com/**/campaign.json',
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ $schemaVersion: '0.1.0' })
          });
        }
      );
      await page.goto(appUrl({ campaign: 'noname/noname' }));
      await expect(page.locator('.card.error')).toBeVisible({
        timeout: 15000
      });
      await expect(page.locator('.card.error')).toContainText(/name/i);
    } finally {
      await ctx.close();
    }
  });
});

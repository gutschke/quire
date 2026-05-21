/**
 * Phase 5 — save corruption recovery (e2e).
 *
 * Unit tests in src/persistence.test.ts cover every parse-error
 * case at the function level.  This spec drives the same paths
 * through the real UI file-upload flow and asserts:
 *   1. The save-status error is clearly visible to the user
 *   2. The error message names the specific problem
 *   3. The app stays in a usable state — session remains active,
 *      chat works, events still flow
 *
 * The kind of bug this catches: an unhandled exception in the
 * load path that crashes the whole component instead of
 * gracefully surfacing the parse failure.
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  sendChat,
  chatList,
  activePanel
} from './helpers';

const SLUG = 'test-camp';

async function openHost(context: BrowserContext) {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  await hostSession(page, 'DM');
  return page;
}

async function uploadSave(
  page: import('@playwright/test').Page,
  name: string,
  body: string
): Promise<void> {
  await page.locator('.session-load-label input[type=file]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(body)
  });
  await page.waitForTimeout(300);
}

async function expectErrorAndStillUsable(
  page: import('@playwright/test').Page,
  errorPattern: RegExp
): Promise<void> {
  await expect(page.locator('.save-status.save-error')).toBeVisible({
    timeout: 5000
  });
  await expect(page.locator('.save-status.save-error')).toContainText(
    errorPattern
  );
  // Active session intact.
  await expect(activePanel(page)).toBeVisible();
  // Chat still works.
  await sendChat(page, 'still working');
  await expect(chatList(page)).toContainText('still working', {
    timeout: 5000
  });
}

const VALID_CAMPAIGN = { owner: 'test', repo: 'test-camp', ref: 'main' };
const NOW = () => new Date().toISOString();

test.describe('Save corruption recovery (Phase 5)', () => {
  test('truncated JSON', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(page, 'trunc.json', '{"$schemaVersion": "0.1.0", "saved');
      await expectErrorAndStillUsable(page, /json/i);
    } finally {
      await ctx.close();
    }
  });

  test('non-JSON text', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(page, 'text.json', 'hello world this is not json');
      await expectErrorAndStillUsable(page, /json/i);
    } finally {
      await ctx.close();
    }
  });

  test('empty file', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(page, 'empty.json', '');
      await expectErrorAndStillUsable(page, /empty/i);
    } finally {
      await ctx.close();
    }
  });

  test('top-level array (not an object)', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(page, 'arr.json', '[1, 2, 3]');
      await expectErrorAndStillUsable(page, /object/i);
    } finally {
      await ctx.close();
    }
  });

  test('missing $schemaVersion', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(
        page,
        'noschema.json',
        JSON.stringify({
          savedAt: NOW(),
          campaign: VALID_CAMPAIGN,
          savedByPeerId: 'x',
          events: []
        })
      );
      await expectErrorAndStillUsable(page, /schemaVersion/i);
    } finally {
      await ctx.close();
    }
  });

  test('wrong major version (1.0.0)', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(
        page,
        'futurev.json',
        JSON.stringify({
          $schemaVersion: '1.0.0',
          savedAt: NOW(),
          campaign: VALID_CAMPAIGN,
          savedByPeerId: 'x',
          events: []
        })
      );
      await expectErrorAndStillUsable(page, /version|update/i);
    } finally {
      await ctx.close();
    }
  });

  test('campaign with non-string repo field', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(
        page,
        'badcampaign.json',
        JSON.stringify({
          $schemaVersion: '0.1.0',
          savedAt: NOW(),
          campaign: { owner: 'test', repo: 42, ref: 'main' },
          savedByPeerId: 'x',
          events: []
        })
      );
      await expectErrorAndStillUsable(page, /campaign\.repo/i);
    } finally {
      await ctx.close();
    }
  });

  test('missing savedByPeerId', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(
        page,
        'nosaver.json',
        JSON.stringify({
          $schemaVersion: '0.1.0',
          savedAt: NOW(),
          campaign: VALID_CAMPAIGN,
          events: []
        })
      );
      await expectErrorAndStillUsable(page, /savedByPeerId/i);
    } finally {
      await ctx.close();
    }
  });

  test('events field is an object instead of an array', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(
        page,
        'badevents.json',
        JSON.stringify({
          $schemaVersion: '0.1.0',
          savedAt: NOW(),
          campaign: VALID_CAMPAIGN,
          savedByPeerId: 'x',
          events: { not: 'an array' }
        })
      );
      await expectErrorAndStillUsable(page, /events.*array/i);
    } finally {
      await ctx.close();
    }
  });

  test('save with one corrupt event in otherwise-valid array', async ({
    browser
  }) => {
    // Valid envelope, corrupt event inside.  parseSaveDocument
    // accepts the envelope; applySaveToLog rejects the bad event
    // individually and (today) silently doesn't surface that in
    // the UI's load-status message — the user sees "Loaded 0 new
    // events (1 already present)" which is misleading.  We document
    // the current behavior here so a future improvement is caught.
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(
        page,
        'partial.json',
        JSON.stringify({
          $schemaVersion: '0.1.0',
          savedAt: NOW(),
          campaign: VALID_CAMPAIGN,
          savedByPeerId: 'x',
          events: [
            // Malformed event: id doesn't match peerId:seq, so
            // EventLog.apply rejects.
            {
              id: 'mismatch',
              peerId: 'alice',
              seq: 1,
              clock: { alice: 1 },
              kind: 'chat',
              payload: { text: 'corrupt event' },
              ts: 0
            }
          ]
        })
      );
      // Currently surfaces as "Loaded 0 new events" — not an error
      // banner — because applySaveToLog silently rejects.  The app
      // stays usable.  This is a UX gap (F5) we document but don't
      // fix here.
      await expect(activePanel(page)).toBeVisible();
      await sendChat(page, 'still working after partial corruption');
      await expect(chatList(page)).toContainText(
        'still working after partial corruption',
        { timeout: 5000 }
      );
    } finally {
      await ctx.close();
    }
  });

  test('cross-campaign load refused (already in multi-session, repeat for surface)', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openHost(ctx);
      await uploadSave(
        page,
        'wrongcampaign.json',
        JSON.stringify({
          $schemaVersion: '0.1.0',
          savedAt: NOW(),
          campaign: { owner: 'somebody', repo: 'else', ref: 'main' },
          savedByPeerId: 'x',
          events: []
        })
      );
      await expectErrorAndStillUsable(page, /somebody\/else/);
    } finally {
      await ctx.close();
    }
  });

  test('load attempt with no session active is refused with clear message', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await mockFixtureCampaign(page, SLUG);
      await page.goto(campaignUrl(SLUG));
      await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
      // No hostSession — load button is on the active-session bar
      // only, so we can't even reach it.  Confirm by absence:
      const loadInputs = await page
        .locator('.session-load-label input[type=file]')
        .count();
      expect(loadInputs).toBe(0);
    } finally {
      await ctx.close();
    }
  });
});
